"""
Zela Varginha — Coletor de Dados Públicos
==========================================
Reúne dados públicos das três fontes oficiais e monta os JSONs que o
painel cidadão (index.html) lê:

  1. SAPL Câmara Municipal de Varginha (CSV já baixado)
  2. Portal de Dados Abertos da Prefeitura — Diário Oficial (JSON aberto)
  3. (Opcional) Portal de Transparência Betha — via token captado do navegador

Saídas em /data:
  - resumo.json
  - vereadores.json
  - emendas.json
  - diario.json
  - atualizado_em.json

Uso:
  python coletor.py            # coleta tudo o que dá sem captcha
  python coletor.py --so-sapl  # apenas reprocessa o CSV local
  python coletor.py --sem-pncp # pula consulta ao PNCP
  python coletor.py --sem-pessoal # pula remuneração/comissionados
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path
from collections import Counter, defaultdict

# Garante que o stdout aceite UTF-8 no Windows (cp1252 é o padrão).
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

CSV_SAPL = Path(
    r"C:/Users/Desktop/Desktop/Ações Prefeitura Varginha/Camara De Varginha/Ano 2025/sapl_pesquisar_materia (2).csv"
)
JSON_SAPL_2026 = Path(
    r"C:/Users/Desktop/Desktop/Ações Prefeitura Varginha/Camara De Varginha/Ano 2026/sapl_pesquisar_materia.json"
)

DIARIO_URLS = {
    2025: "https://www.varginha.mg.gov.br/portal/dados-abertos/diario-oficial/2025",
    2026: "https://www.varginha.mg.gov.br/portal/dados-abertos/diario-oficial/2026",
}
DIARIO_EDICAO_OFFSET = 1593

# ----------------------------- helpers --------------------------------- #

# Chunks sem timestamp interno proprio: o monitor de freshness os marcava
# como "manual" (sem idade verificavel). Carimbar coletado_em na gravacao
# da coleta os torna auditaveis — o carimbo so muda quando a coleta roda.
# camara_anos e dict de blocos por ano (consumidores iteram .values()
# esperando dicts), entao o carimbo vai DENTRO de cada bloco; o scanner
# de freshness da auditoria e recursivo e o encontra do mesmo jeito.
_CHUNKS_CARIMBO = {"camara_betha.json", "pessoal.json"}


def _save(name: str, payload) -> None:
    agora = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    if name in _CHUNKS_CARIMBO and isinstance(payload, dict) and payload:
        payload.setdefault("coletado_em", agora)
    elif name == "camara_anos.json" and isinstance(payload, dict):
        for bloco in payload.values():
            if isinstance(bloco, dict) and bloco:
                bloco.setdefault("coletado_em", agora)
    out = DATA / name
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  ✓ {name}  ({out.stat().st_size // 1024} KB)")

    # Also save to chunks directory if it's a chunk file
    chunk_names = {
        "resumo.json", "atualizado_em.json", "prefeitura.json", "emendas.json",
        "vereadores.json", "pncp.json", "diarias.json", "cnpjs.json",
        "camara_anos.json", "camara_betha.json", "camara_transparencia.json", "fontes_emendas_2026.json",
        "fundacao_cultural.json",
        "federal.json", "pessoal.json", "diario.json",
        "remuneracao_vereadores.json", "sancoes_fornecedores.json",
        "auditoria_dados.json", "atualizacoes.json", "indice_relevancia.json",
    }
    if name in chunk_names:
        chunks_dir = DATA / "chunks"
        chunks_dir.mkdir(exist_ok=True)
        chunk_out = chunks_dir / name
        chunk_out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")



def _load_existing(name: str, default):
    path = DATA / name
    if not path.exists():
        path = DATA / "chunks" / name
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _http_get_json(url: str, timeout: int = 30):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "ZelaVarginha/1.0 (cidadao)"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


# --------------------------- 1) SAPL CSV ------------------------------- #

def _norm_txt(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").lower())
    return "".join(ch for ch in s if unicodedata.category(ch) != "Mn")


def _tipo_count(c: Counter, *nomes: str) -> int:
    alvos = {_norm_txt(n) for n in nomes}
    return sum(v for k, v in c.items() if _norm_txt(k) in alvos)


def _impacto_zero(tipo: str, ementa: str) -> tuple[bool, str]:
    texto = _norm_txt(f"{tipo} {ementa}")
    tipo_n = _norm_txt(tipo)
    if tipo_n == "mocao":
        return True, "mocao/aplauso/homenagem"
    if any(k in texto for k in [
        "denominacao de logradouro", "denomina logradouro", "nome de rua",
        "dar nome", "denominar", "denominacao da rua", "denominacao de rua",
        "praca", "avenida",
    ]) and any(k in texto for k in ["rua", "logradouro", "avenida", "praca"]):
        return True, "nome de rua/logradouro"
    if tipo_n == "projeto de decreto legislativo" and any(k in texto for k in [
        "titulo", "honorario", "honraria", "benemerito", "diploma",
        "comenda", "aplauso", "louvor", "homenagem", "reconhecimento",
    ]):
        return True, "homenagem a terceiro"
    return False, ""


def _linha_padrao_sapl(r: dict, tipo_map: dict = None, autor_map: dict = None) -> dict:
    tipo_id = r.get("tipo")
    tipo_sigla = ""
    tipo_descricao = ""
    if tipo_id is not None and tipo_map:
        info = tipo_map.get(tipo_id)
        if info:
            tipo_sigla = info.get("sigla") or ""
            tipo_descricao = info.get("descricao") or ""

    autores_ids = r.get("autores") or []
    autoria = ""
    if autores_ids and autor_map:
        nomes = []
        for aid in autores_ids:
            nome = autor_map.get(aid)
            if nome:
                nomes.append(nome)
        autoria = ", ".join(nomes)

    return {
        "id": str(r.get("ID") or r.get("id") or ""),
        "ano": str(r.get("Ano") or r.get("ano") or ""),
        "numero": str(r.get("Número") or r.get("Nmero") or r.get("numero") or tipo_id or ""),
        "tipo_sigla": r.get("Tipo de Matéria Legislativa/Sigla") or r.get("Tipo de Matria Legislativa/Sigla") or r.get("tipo__sigla") or tipo_sigla or "",
        "tipo_descricao": r.get("Tipo de Matéria Legislativa/Descrição") or r.get("Tipo de Matria Legislativa/Descrio") or r.get("tipo__descricao") or tipo_descricao or "",
        "autoria": r.get("Autorias") or r.get("autoria") or autoria or "",
        "texto_original": r.get("Texto Original") or r.get("texto_original") or "",
        "ementa": r.get("Ementa") or r.get("ementa") or "",
    }



def _fetch_datas_sapl(anos: list[int]) -> dict[str, str]:
    """Pagina a API SAPL e retorna {id: data_apresentacao} para os anos pedidos.
    Tolerante a falha de rede — retorna o que conseguiu."""
    BASE = "https://sapl.varginha.mg.leg.br/api/materia/materialegislativa/"
    datas: dict[str, str] = {}
    for ano in anos:
        url: str | None = f"{BASE}?ano={ano}&page_size=200&page=1"
        paginas = 0
        while url:
            try:
                d = _http_get_json(url, timeout=20)
            except Exception as e:
                print(f"  ! SAPL API {ano} p{paginas+1}: {e}")
                break
            for item in d.get("results", []):
                iid = str(item.get("id", ""))
                data = item.get("data_apresentacao") or item.get("data_publicacao") or ""
                if iid and data:
                    datas[iid] = data[:10]  # YYYY-MM-DD
            pag = d.get("pagination", {})
            url = pag.get("links", {}).get("next")
            paginas += 1
        print(f"  ✓ SAPL API {ano}: {paginas} páginas, {len(datas)} datas acumuladas")
    return datas


# Desfecho legislativo a partir da sigla do status de tramitação do SAPL.
# Mecânico, da fonte oficial — sem atribuição subjetiva.
SAPL_STATUS_APROVADO = {
    "TRANSFLEI", "LEIPROMUL", "NORMPROMUL", "NORPU", "APROVAD2", "APROVADU",
    "AGPROMLEI", "AGPROMNOR", "AGSANCAO", "AGPN", "REDFIN", "AGPROMVET", "PROMULVETO",
}
SAPL_STATUS_NEGADO = {
    "ARQUIVADA", "REJEITADA", "INAD", "PREJUD", "RETAUTOR", "PARARQ", "VETOMANT",
}
SAPL_API = "https://sapl.varginha.mg.leg.br/api/materia"


def _sapl_status_map() -> dict:
    """{id_status: (sigla, indicador)} do vocabulário statustramitacao do SAPL."""
    out: dict = {}
    try:
        d = _http_get_json(f"{SAPL_API}/statustramitacao/?page=1&page_size=200", timeout=20)
        for s in (d.get("results") or []):
            out[s.get("id")] = (s.get("sigla") or "", s.get("indicador") or "")
    except Exception as e:
        print(f"  ! SAPL statustramitacao: {e}")
    return out


def _classifica_desfecho(sigla: str, indicador: str) -> str:
    if sigla in SAPL_STATUS_APROVADO:
        return "lei"          # aprovado / virou lei
    if sigla in SAPL_STATUS_NEGADO:
        return "arquivado"    # arquivado / rejeitado / retirado
    if indicador == "F":
        return "encerrado"    # fim de tramitação, desfecho neutro
    return "tramitando"


def _fetch_desfechos_sapl(anos: list[int], max_consultas: int = 150) -> dict[str, str]:
    """{id_materia: desfecho} via API SAPL. desfecho ∈ lei|arquivado|encerrado|tramitando.
    Em tramitação não custa request (vem na lista). Tolerante a falha de rede."""
    status_map = _sapl_status_map()
    if not status_map:
        return {}

    # Cache local carregado do camara_anos.json existente para evitar requisições redundantes
    cache: dict[str, str] = {}
    try:
        existing = _load_existing("camara_anos.json", {})
        for ano_key, ano_data in existing.items():
            if isinstance(ano_data, dict) and "materias" in ano_data:
                for mat in ano_data["materias"]:
                    mid = str(mat.get("id", ""))
                    desf = mat.get("desfecho", "")
                    if mid and desf and desf in ("lei", "arquivado", "encerrado"):
                        cache[mid] = desf
    except Exception as e:
        print(f"  ! Falha ao carregar cache de desfechos: {e}")

    desfechos: dict[str, str] = {}
    decididos: list[str] = []
    has_errors = False
    for ano in anos:
        url = f"{SAPL_API}/materialegislativa/?ano={ano}&page_size=200&page=1"
        while url:
            try:
                d = _http_get_json(url, timeout=20)
            except Exception as e:
                print(f"  ! SAPL lista {ano}: {e}")
                has_errors = True
                break
            for item in d.get("results", []):
                iid = str(item.get("id", ""))
                if not iid:
                    continue
                if item.get("em_tramitacao"):
                    desfechos[iid] = "tramitando"
                else:
                    decididos.append(iid)
            url = (d.get("pagination", {}) or {}).get("links", {}).get("next")

    # Se a API de listagem falhou ou apresentou instabilidade, pula as consultas individuais
    if has_errors:
        print("  ! API SAPL apresentou instabilidade na listagem; pulando consultas individuais de desfecho.")
        max_consultas = 0

    consultas = 0
    for iid in decididos:
        if iid in cache:
            desfechos[iid] = cache[iid]
            continue
        if consultas >= max_consultas:
            desfechos.setdefault(iid, "")
            continue
        try:
            t = _http_get_json(f"{SAPL_API}/tramitacao/?materia={iid}", timeout=3)
            consultas += 1
            tl = t.get("results", []) or []
            tl.sort(key=lambda x: x.get("data_tramitacao") or "", reverse=True)
            ult = tl[0] if tl else None
            sigla, ind = status_map.get(ult.get("status"), ("", "")) if ult else ("", "")
            desfechos[iid] = _classifica_desfecho(sigla, ind)
        except Exception:
            desfechos[iid] = ""  # sem dado — degrada sem quebrar
    leis = sum(1 for v in desfechos.values() if v == "lei")
    arq = sum(1 for v in desfechos.values() if v == "arquivado")
    tram = sum(1 for v in desfechos.values() if v == "tramitando")
    print(f"  ✓ SAPL desfechos: {leis} viraram lei, {arq} arquivados/rejeitados, "
          f"{tram} em tramitação ({consultas} novas consultas)")
    return desfechos



def _sapl_paginate(url: str, timeout: int = 20) -> list[dict]:
    """Segue pagination.links.next do SAPL e devolve todos os results. Tolerante a falha."""
    out: list[dict] = []
    nxt: str | None = url
    while nxt:
        try:
            d = _http_get_json(nxt, timeout=timeout)
        except Exception as e:
            print(f"  ! SAPL paginate: {e}")
            break
        out += d.get("results", [])
        nxt = d.get("pagination", {}).get("links", {}).get("next")
    return out


# Presença em plenário — fonte oficial SAPL, denominador por JANELA DE MANDATO
# (titular que saiu / suplente que entrou no meio do ano não é penalizado).
# Conta sessões deliberativas: Ordinária (tipo 1) e Extraordinária (tipo 2).
SAPL_TIPOS_DELIBERATIVOS = {1, 2}


def _fetch_presenca_sapl(anos: list[int]) -> dict[int, dict[str, dict]]:
    """{ano: {nome_parlamentar: {presentes, elegiveis, pct, janela}}}.
    Tolerante a falha — sem dado, devolve {} e a presença segue pendente no índice."""
    base = "https://sapl.varginha.mg.leg.br/api"
    resultado: dict[int, dict[str, dict]] = {}

    # id -> nome do parlamentar (mapeamento que destrava a presença)
    parl = _sapl_paginate(f"{base}/parlamentares/parlamentar/?page_size=200")
    if not parl:
        print("  ! SAPL presença: lista de parlamentares vazia — pulando")
        return {}
    id2nome = {p.get("id"): (p.get("nome_parlamentar") or "") for p in parl}

    # mandatos: janela de serviço por parlamentar (intersectada ao ano)
    mandatos = _sapl_paginate(f"{base}/parlamentares/mandato/?page_size=200")

    for ano in anos:
        ini_ano, fim_ano = f"{ano}-01-01", f"{ano}-12-31"
        # janela [inicio, fim] de cada parlamentar dentro do ano
        janela: dict[int, tuple[str, str]] = {}
        for m in mandatos:
            ini = (m.get("data_inicio_mandato") or "")[:10]
            fim = (m.get("data_fim_mandato") or "")[:10]
            if not ini or ini > fim_ano or (fim and fim < ini_ano):
                continue
            pid = m.get("parlamentar")
            ini_c = max(ini, ini_ano)
            fim_c = min(fim or fim_ano, fim_ano)
            if pid not in janela or ini_c < janela[pid][0]:
                janela[pid] = (ini_c, fim_c)

        # sessões deliberativas do ano, com data
        sess = _sapl_paginate(f"{base}/sessao/sessaoplenaria/?data_inicio__year={ano}&page_size=200")
        delib = [s for s in sess if s.get("tipo") in SAPL_TIPOS_DELIBERATIVOS]
        sess_data = {s.get("id"): (s.get("data_inicio") or "")[:10] for s in delib}
        if not delib:
            print(f"  ! SAPL presença {ano}: nenhuma sessão deliberativa — pulando ano")
            continue

        # presença registrada por sessão (set de ids presentes)
        presentes_por_sessao: dict[int, set] = {}
        for sid in sess_data:
            rows = _sapl_paginate(f"{base}/sessao/sessaoplenariapresenca/?sessao_plenaria={sid}&page_size=200")
            presentes_por_sessao[sid] = {r.get("parlamentar") for r in rows}

        # tally por parlamentar dentro da janela — só quem teve mandato vigente no ano
        por_nome: dict[str, dict] = {}
        for pid, janela_pid in janela.items():
            nome = id2nome.get(pid)
            if not nome:
                continue
            ji, jf = janela_pid
            elegiveis = [sid for sid, dt in sess_data.items() if dt and ji <= dt <= jf]
            if not elegiveis:
                continue
            pres = sum(1 for sid in elegiveis if pid in presentes_por_sessao.get(sid, set()))
            por_nome[nome] = {
                "presentes": pres,
                "elegiveis": len(elegiveis),
                "pct": round(pres / len(elegiveis) * 100, 1),
                "janela": f"{ji} a {jf}",
            }
        resultado[ano] = por_nome
        print(f"  ✓ SAPL presença {ano}: {len(delib)} sessões deliberativas, "
              f"{len(por_nome)} parlamentares com presença apurada")

    return resultado


def _fetch_sessoes_votacoes_sapl(anos: list[int], data_minima: str = "2026-07-01") -> dict[int, list[dict]]:
    """Coleta sessões, presença registrada e votos nominais desde o piso editorial.

    A API do SAPL relaciona a votação à ordem do dia/expediente. Por isso a
    coleta percorre somente sessões deliberativas dentro da janela aprovada,
    evitando baixar novamente todo o histórico legislativo.
    """
    base = "https://sapl.varginha.mg.leg.br/api"
    parl = _sapl_paginate(f"{base}/parlamentares/parlamentar/?page_size=200")
    id2nome = {p.get("id"): (p.get("nome_parlamentar") or "") for p in parl}
    tipos = _sapl_paginate(f"{base}/sessao/tiposessaoplenaria/?page_size=100")
    id2tipo = {t.get("id"): (t.get("nome") or t.get("__str__") or "Sessão") for t in tipos}
    resultado: dict[int, list[dict]] = {}

    for ano in anos:
        piso_ano = max(data_minima, f"{ano}-01-01")
        sessoes = _sapl_paginate(
            f"{base}/sessao/sessaoplenaria/?data_inicio__year={ano}&page_size=200"
        )
        sessoes = [
            sessao for sessao in sessoes
            if sessao.get("tipo") in SAPL_TIPOS_DELIBERATIVOS
            and (sessao.get("data_inicio") or "")[:10] >= piso_ano
        ]
        saida_ano: list[dict] = []

        for sessao in sorted(sessoes, key=lambda s: (s.get("data_inicio") or "", s.get("numero") or 0)):
            sid = sessao.get("id")
            presentes = _sapl_paginate(
                f"{base}/sessao/sessaoplenariapresenca/?sessao_plenaria={sid}&page_size=200"
            )
            nomes_presentes = sorted(
                {id2nome.get(item.get("parlamentar"), "") for item in presentes if id2nome.get(item.get("parlamentar"))}
            )
            votacoes: list[dict] = []

            pautas = []
            for endpoint, campo in (("ordemdia", "ordem"), ("expedientemateria", "expediente")):
                itens = _sapl_paginate(
                    f"{base}/sessao/{endpoint}/?sessao_plenaria={sid}&page_size=200"
                )
                pautas.extend((campo, item) for item in itens)

            for campo, pauta in pautas:
                registros = _sapl_paginate(
                    f"{base}/sessao/registrovotacao/?{campo}={pauta.get('id')}&page_size=50"
                )
                for registro in registros:
                    votos_raw = _sapl_paginate(
                        f"{base}/sessao/votoparlamentar/?votacao={registro.get('id')}&page_size=200"
                    )
                    votos = [
                        {
                            "parlamentar": id2nome.get(voto.get("parlamentar"), "Não identificado"),
                            "voto": voto.get("voto") or "Não informado",
                        }
                        for voto in votos_raw
                    ]
                    votacoes.append({
                        "id": registro.get("id"),
                        "materia_id": registro.get("materia") or pauta.get("materia"),
                        "descricao": registro.get("__str__") or "",
                        "resultado": pauta.get("resultado") or registro.get("__str__") or "Não informado",
                        "sim": registro.get("numero_votos_sim", 0),
                        "nao": registro.get("numero_votos_nao", 0),
                        "abstencoes": registro.get("numero_abstencoes", 0),
                        "votos": votos,
                    })

            # Sessão ainda aberta e sem registro não deve aparecer como ausência
            # coletiva ou votação inexistente no resumo cidadão.
            if not sessao.get("finalizada") and not nomes_presentes and not votacoes:
                continue

            saida_ano.append({
                "id": sid,
                "numero": sessao.get("numero"),
                "tipo": id2tipo.get(sessao.get("tipo"), "Sessão deliberativa"),
                "data": (sessao.get("data_inicio") or "")[:10],
                "finalizada": bool(sessao.get("finalizada")),
                "url_video": sessao.get("url_video") or "",
                "presentes_qtd": len(nomes_presentes),
                "presentes": nomes_presentes,
                "votacoes": votacoes,
                "fonte": f"https://sapl.varginha.mg.leg.br/sessao/{sid}",
            })
        resultado[ano] = saida_ano
        print(f"  ✓ SAPL sessões/votos {ano}: {len(saida_ano)} sessões desde {piso_ano}")
    return resultado


def _load_sapl_rows(path: Path, tipo_map: dict = None, autor_map: dict = None) -> list[dict]:
    if not path.exists():
        print(f"  ! Arquivo SAPL nao encontrado: {path}")
        return []
    if path.suffix.lower() == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        return [_linha_padrao_sapl(r, tipo_map, autor_map) for r in payload.get("results", [])]
    with path.open(encoding="utf-8") as f:
        return [_linha_padrao_sapl(r, tipo_map, autor_map) for r in csv.DictReader(f, delimiter=";")]



def _autor_excluido(nome: str) -> bool:
    n = _norm_txt(nome)
    return (
        not nome
        or nome in EXCLUI_AUTOR
        or "comissao" in n
        or n.startswith("cjus")
        or n.startswith("cfin")
        or n.startswith("csael")
        or n.startswith("mesa diretora")
        or "tribunal de contas" in n
        or n not in PARLAMENTARES_MONITORADOS
    )


def _processa_sapl_rows(ano: int, rows: list[dict],
                        datas_sapl: dict[str, str] | None = None,
                        desfechos: dict[str, str] | None = None,
                        presenca: dict[str, dict] | None = None) -> dict:
    tipos = Counter(r["tipo_descricao"] for r in rows)
    ver_tipo: dict[str, Counter] = defaultdict(Counter)
    ver_zero: dict[str, Counter] = defaultdict(Counter)
    ver_lei: dict[str, int] = defaultdict(int)  # matérias do vereador que viraram lei
    materias = []
    datas_sapl = datas_sapl or {}
    desfechos = desfechos or {}
    # presença por nome normalizado (case/acento-insensível) — destrava a 4ª dimensão
    presenca_norm = {_norm_txt(k): v for k, v in (presenca or {}).items()}

    def _presenca_de(nome: str) -> dict:
        p = presenca_norm.get(_norm_txt(nome))
        if not p:
            return {"presenca_pct": None, "presenca_presentes": None,
                    "presenca_elegiveis": None, "presenca_janela": ""}
        return {"presenca_pct": p.get("pct"), "presenca_presentes": p.get("presentes"),
                "presenca_elegiveis": p.get("elegiveis"), "presenca_janela": p.get("janela", "")}

    for r in rows:
        tipo = r["tipo_descricao"]
        zero, motivo = _impacto_zero(tipo, r["ementa"])
        desfecho = desfechos.get(str(r.get("id", "")), "")
        materia = {
            "id": r.get("id", ""),
            "ano": r["ano"],
            "numero": r["numero"],
            "tipo": tipo,
            "sigla": r["tipo_sigla"],
            "autor": r["autoria"],
            "pdf": r["texto_original"],
            "ementa": r["ementa"],
            "data": datas_sapl.get(r.get("id", ""), ""),
            "impacto_zero": zero,
            "motivo_impacto_zero": motivo,
            "desfecho": desfecho,
        }
        materias.append(materia)
        if desfecho == "lei" and not zero:
            for nome in (x.strip() for x in r["autoria"].split(",")):
                if not _autor_excluido(nome):
                    ver_lei[nome] += 1
        for nome in (x.strip() for x in r["autoria"].split(",")):
            if _autor_excluido(nome):
                continue
            ver_tipo[nome][tipo] += 1
            if zero:
                ver_zero[nome][motivo or "impacto zero"] += 1

    vereadores = []
    for nome, c in sorted(ver_tipo.items(), key=lambda x: -sum(x[1].values())):
        mocoes = _tipo_count(c, "MoÃ§Ã£o", "Moção")
        pdl = _tipo_count(c, "Projeto de Decreto Legislativo")
        vereadores.append({
            "nome": nome,
            "total": sum(c.values()),
            "indicacoes": _tipo_count(c, "IndicaÃ§Ã£o", "Indicação"),
            "requerimentos": _tipo_count(c, "Requerimento"),
            "projetos_lei": _tipo_count(c, "Projeto de Lei OrdinÃ¡ria do Legislativo", "Projeto de Lei Ordinária do Legislativo"),
            "emendas": _tipo_count(c, "Emenda Impositiva ao OrÃ§amento", "Emenda Impositiva ao Orçamento"),
            "leis_aprovadas": ver_lei.get(nome, 0),
            "mocoes": mocoes,
            "pdl": pdl,
            "impacto_zero": sum(ver_zero[nome].values()),
            "nome_rua": ver_zero[nome].get("nome de rua/logradouro", 0),
            "homenagens_terceiros": ver_zero[nome].get("homenagem a terceiro", 0),
            "outros": sum(v for k, v in c.items() if _norm_txt(k) not in {
                _norm_txt("IndicaÃ§Ã£o"), _norm_txt("Indicação"),
                _norm_txt("Requerimento"),
                _norm_txt("Projeto de Lei OrdinÃ¡ria do Legislativo"),
                _norm_txt("Projeto de Lei Ordinária do Legislativo"),
                _norm_txt("Emenda Impositiva ao OrÃ§amento"),
                _norm_txt("Emenda Impositiva ao Orçamento"),
                _norm_txt("MoÃ§Ã£o"), _norm_txt("Moção"),
            }),
            **_presenca_de(nome),
        })

    presentes = {_norm_txt(v["nome"]) for v in vereadores}
    for nome in [
        "Zilda Silva", "Alexandre Prado", "Ana Rios Fontoura", "Dandan",
        "Davi Martins", "Rogério Bueno", "Joãozinho Enfermeiro", "Zé Morais",
        "Dudu Ottoni", "Bruno Leandro Coletor", "Pastor Faustinho",
        "Thulyo Paiva", "Marquinho da Cooperativa", "Cássio Chiodi",
        "Miguel da Saúde", "Dr. Guedes", "Dr. Lucas",
    ]:
        if _norm_txt(nome) in presentes:
            continue
        vereadores.append({
            "nome": nome, "total": 0, "indicacoes": 0, "requerimentos": 0,
            "projetos_lei": 0, "emendas": 0, "leis_aprovadas": 0, "mocoes": 0, "pdl": 0,
            "impacto_zero": 0, "nome_rua": 0, "homenagens_terceiros": 0,
            "outros": 0,
            **_presenca_de(nome),
        })

    emendas_raw = [r for r in rows if _norm_txt(r["tipo_descricao"]) == _norm_txt("Emenda Impositiva ao Orçamento")]
    emendas = []
    valor_total = 0.0
    for r in emendas_raw:
        parsed = _parse_emenda(r["ementa"])
        valor_total += parsed["valor_brl"]
        emendas.append({
            "ano": r["ano"],
            "numero": r["numero"],
            "autor": r["autoria"],
            "pdf": r["texto_original"],
            **parsed,
        })

    texto_all = " ".join(_norm_txt(r["ementa"]) for r in rows)
    palavras = [
        "saude", "educacao", "seguranca", "iluminacao", "asfalto",
        "pavimentacao", "transporte", "crianca", "idoso", "mulher",
        "animal", "meio ambiente", "cultura", "esporte", "praca",
    ]
    temas = [{"tema": p, "mencoes": texto_all.count(p)} for p in palavras]
    temas.sort(key=lambda x: -x["mencoes"])

    resumo = {
        "ano": ano,
        "total_materias": len(rows),
        "vereadores_ativos": sum(1 for v in vereadores if _norm_txt(v["nome"]) in PARLAMENTARES_MONITORADOS),
        "emendas_qtd": len(emendas),
        "emendas_valor_total_brl": round(valor_total, 2),
        "impacto_zero_qtd": sum(1 for m in materias if m["impacto_zero"]),
        "desfechos": {
            "lei": sum(1 for m in materias if m.get("desfecho") == "lei"),
            "arquivado": sum(1 for m in materias if m.get("desfecho") == "arquivado"),
            "tramitando": sum(1 for m in materias if m.get("desfecho") == "tramitando"),
            "encerrado": sum(1 for m in materias if m.get("desfecho") == "encerrado"),
            "sem_dado": sum(1 for m in materias if not m.get("desfecho")),
        },
        "tipos": [{"tipo": k, "qtd": v} for k, v in tipos.most_common()],
        "temas_top": temas,
    }
    return {"resumo": resumo, "vereadores": vereadores, "emendas": emendas, "materias": materias}

EXCLUI_AUTOR = {
    "Mesa Diretora - MDIR",
    "Tribunal de Contas de MG - TCEMG",
    "Legislação e Redação Final",
}

# Os 15 vereadores TITULARES da legislatura 2025-2028 (lista oficial da Câmara).
# Não inclui suplentes (ex.: Mônica Junqueira substitui Rogério Bueno, em licença
# de saúde, mas o titular é o Rogério) nem ex-vereadores que saíram (Dr. Guedes,
# Dr. Lucas, Marco Antônio "Marquinho da Cooperativa"). Afonso Monticeli é
# titular e entra no ranking quando o CSV do SAPL trouxer matérias dele.
PARLAMENTARES_DISPLAY = [
        "Zilda Silva", "Alexandre Prado", "Ana Rios Fontoura", "Dandan",
        "Davi Martins", "Rogerio Bueno", "Rogério Bueno",
        "Joaozinho Enfermeiro", "Joãozinho Enfermeiro", "Ze Morais",
        "Zé Morais", "Dudu Ottoni", "Bruno Leandro Coletor",
        "Pastor Faustinho", "Thulyo Paiva",
        "Cassio Chiodi", "Cássio Chiodi", "Miguel da Saude",
        "Miguel da Saúde", "Afonso Monticeli",
]
PARLAMENTARES_MONITORADOS = {_norm_txt(n) for n in PARLAMENTARES_DISPLAY}

def _parse_emenda(ementa: str) -> dict:
    """Extrai campos estruturados de uma ementa de emenda impositiva."""
    def grab(label: str) -> str:
        rotulos = (
            r"Entidade benefici[áa]ria|CNPJ do recebedor|Munic[íi]pio|Objeto|Valor"
        )
        m = re.search(
            rf"{label}\s*:\s*(.*?)(?=\s*(?:{rotulos})\s*:|\n|$)",
            ementa,
            re.IGNORECASE,
        )
        return m.group(1).strip() if m else ""

    valor_raw = grab("Valor")
    valor_num = 0.0
    m = re.search(r"R\$\s*([\d\.]+,\d{2})", valor_raw)
    if m:
        valor_num = float(m.group(1).replace(".", "").replace(",", "."))

    return {
        "beneficiario": grab(r"Entidade benefici[áa]ria"),
        "cnpj": grab("CNPJ do recebedor"),
        "municipio": grab(r"Munic[íi]pio"),
        "objeto": grab("Objeto"),
        "valor_brl": valor_num,
    }


def _processa_sapl() -> dict:
    print("⇣ Lendo SAPL (Câmara de Varginha)…")

    tipo_map = {}
    autor_map = {}

    # ── 1. Carrega mapeamentos da API do SAPL se online ───────────────────
    if "--offline-sapl" not in sys.argv:
        print("  ⇣ Buscando mapeamentos de tipos e autores do SAPL API…")
        try:
            tipos_data = _sapl_paginate("https://sapl.varginha.mg.leg.br/api/materia/tipomaterialegislativa/?page_size=100", timeout=20)
            for t in tipos_data:
                tid = t.get("id")
                if tid is not None:
                    tipo_map[tid] = {
                        "sigla": t.get("sigla") or "",
                        "descricao": t.get("descricao") or ""
                    }
        except Exception as e:
            print(f"  ! Não foi possível carregar tipos do SAPL API: {e}")

        try:
            autores_data = _sapl_paginate("https://sapl.varginha.mg.leg.br/api/base/autor/?page_size=100", timeout=20)
            for a in autores_data:
                aid = a.get("id")
                if aid is not None:
                    autor_map[aid] = a.get("nome") or a.get("__str__") or ""
        except Exception as e:
            print(f"  ! Não foi possível carregar autores do SAPL API: {e}")

    # Fallback estático para tipos caso a API de tipos falhe ou estejamos offline
    static_tipos = {
        3: {"sigla": "PLOM", "descricao": "Proposta de Emenda à Lei Orgânica Municipal"},
        14: {"sigla": "VET", "descricao": "Mensagem de Veto"},
        20: {"sigla": "PLC", "descricao": "Projeto de Lei Complementar"},
        17: {"sigla": "PLOE", "descricao": "Projeto de Lei Ordinária do Executivo"},
        4: {"sigla": "PLOL", "descricao": "Projeto de Lei Ordinária do Legislativo"},
        6: {"sigla": "PDL", "descricao": "Projeto de Decreto Legislativo"},
        7: {"sigla": "PRES", "descricao": "Projeto de Resolução"},
        24: {"sigla": "SUBS", "descricao": "Substitutivo"},
        25: {"sigla": "PPTCE", "descricao": "Parecer Prévio do TCE"},
        8: {"sigla": "REQ", "descricao": "Requerimento"},
        9: {"sigla": "IND", "descricao": "Indicação"},
        10: {"sigla": "MOC", "descricao": "Moção"},
        12: {"sigla": "REC", "descricao": "Recurso"},
        13: {"sigla": "EMEN", "descricao": "Emenda"},
        26: {"sigla": "EMEIM", "descricao": "Emenda Impositiva ao Orçamento"},
        11: {"sigla": "PRO", "descricao": "Pronunciamento"},
        28: {"sigla": "PAR", "descricao": "Parecer"}
    }
    for k, v in static_tipos.items():
        if k not in tipo_map:
            tipo_map[k] = v

    # ── 2. Coleta matérias por ano ──────────────────────────────────────────
    rows_2025 = []
    rows_2026 = []

    if "--offline-sapl" not in sys.argv:
        # Coleta 2025 via API
        url_2025 = "https://sapl.varginha.mg.leg.br/api/materia/materialegislativa/?ano=2025&page_size=200"
        tentativa_2025 = _sapl_paginate(url_2025, timeout=20)
        if tentativa_2025:
            print(f"  ✓ SAPL API 2025: {len(tentativa_2025)} matérias")
            rows_2025 = [_linha_padrao_sapl(r, tipo_map, autor_map) for r in tentativa_2025]
        else:
            print("  ! SAPL API 2025: sem resposta, usando fallback offline")

        # Coleta 2026 via API
        url_2026 = "https://sapl.varginha.mg.leg.br/api/materia/materialegislativa/?ano=2026&page_size=200"
        tentativa_2026 = _sapl_paginate(url_2026, timeout=20)
        if tentativa_2026:
            print(f"  ✓ SAPL API 2026: {len(tentativa_2026)} matérias")
            rows_2026 = [_linha_padrao_sapl(r, tipo_map, autor_map) for r in tentativa_2026]
        else:
            print("  ! SAPL API 2026: sem resposta, usando fallback offline")

    # ── 3. Fallbacks Offline ────────────────────────────────────────────────
    if not rows_2025:
        if CSV_SAPL.exists():
            with CSV_SAPL.open(encoding="utf-8") as f:
                rows_2025 = [_linha_padrao_sapl(r, tipo_map, autor_map) for r in csv.DictReader(f, delimiter=";")]
            print(f"  (fallback CSV 2025): {len(rows_2025)} matérias do arquivo local.")
        else:
            print(f"  ! CSV do SAPL 2025 ausente ({CSV_SAPL})")

    if not rows_2026:
        if JSON_SAPL_2026.exists():
            try:
                with JSON_SAPL_2026.open(encoding="utf-8") as f:
                    payload = json.load(f)
                    results_2026 = payload.get("results") or []
                    rows_2026 = [_linha_padrao_sapl(r, tipo_map, autor_map) for r in results_2026]
                print(f"  (fallback JSON 2026): {len(rows_2026)} matérias do arquivo local.")
            except Exception as e:
                print(f"  ! Falha ao ler JSON 2026 ({JSON_SAPL_2026}): {e}")
        else:
            print(f"  ! JSON do SAPL 2026 ausente ({JSON_SAPL_2026})")

    if not rows_2025 and not rows_2026:
        print("  ! Sem dados do SAPL carregados; preservando dados existentes.")
        return {
            "resumo": _load_existing("resumo.json", {}),
            "vereadores": _load_existing("vereadores.json", []),
            "emendas": _load_existing("emendas.json", []),
            "camara_anos": _load_existing("camara_anos.json", {}),
        }

    # ── 4. Enriquecimento de metadados via API se online ───────────────────
    anos_com_dados = []
    if rows_2025:
        anos_com_dados.append(2025)
    if rows_2026:
        anos_com_dados.append(2026)

    datas_sapl: dict[str, str] = {}
    desfechos_sapl: dict[str, str] = {}
    presenca_sapl: dict[int, dict[str, dict]] = {}
    sessoes_sapl: dict[int, list[dict]] = {}

    if "--offline-sapl" not in sys.argv:
        try:
            datas_sapl = _fetch_datas_sapl(anos_com_dados)
            print(f"  ✓ {len(datas_sapl)} datas obtidas da API SAPL")
        except Exception as e:
            print(f"  ! API SAPL indisponível, materias sem data: {e}")

        try:
            desfechos_sapl = _fetch_desfechos_sapl(anos_com_dados)
        except Exception as e:
            print(f"  ! Desfechos SAPL indisponíveis: {e}")

        try:
            presenca_sapl = _fetch_presenca_sapl(anos_com_dados)
        except Exception as e:
            print(f"  ! Presença SAPL indisponível: {e}")

        try:
            sessoes_sapl = _fetch_sessoes_votacoes_sapl(anos_com_dados)
        except Exception as e:
            print(f"  ! Sessões e votos SAPL indisponíveis: {e}")

    # ── 5. Processamento dos dados estruturados ─────────────────────────────
    ano_2025 = _processa_sapl_rows(2025, rows_2025, datas_sapl, desfechos_sapl, presenca_sapl.get(2025)) if rows_2025 else {
        "resumo": {}, "vereadores": [], "emendas": [], "materias": []
    }

    camara_anos = {}
    if rows_2025:
        camara_anos["2025"] = ano_2025
    if rows_2026:
        camara_anos["2026"] = _processa_sapl_rows(2026, rows_2026, datas_sapl, desfechos_sapl, presenca_sapl.get(2026))
        print(f"  {len(rows_2026)} materias de 2026 processadas.")

    for ano, sessoes in sessoes_sapl.items():
        bloco = camara_anos.get(str(ano))
        if bloco is not None:
            bloco["sessoes"] = sessoes

    main_year_data = ano_2025 if rows_2025 else camara_anos.get("2026", {
        "resumo": {}, "vereadores": [], "emendas": []
    })

    return {
        "resumo": main_year_data["resumo"],
        "vereadores": main_year_data["vereadores"],
        "emendas": main_year_data["emendas"],
        "camara_anos": camara_anos,
    }



# ----------------------- 2) Diário Oficial ----------------------------- #

def _processa_diario() -> dict:
    print("⇣ Diário Oficial (varginha.mg.gov.br)…")
    edicoes_all = []
    for ano, url in DIARIO_URLS.items():
        try:
            j = _http_get_json(url)
            print(f"  {ano}: {len(j.get('dados', []))} edições")
            for d in j.get("dados", []):
                ed = d.get("edicao") or d.get("Edicao") or ""
                try:
                    publicacao_id = int(str(ed).strip()) - DIARIO_EDICAO_OFFSET
                except Exception:
                    publicacao_id = 0
                url_leitor = (
                    f"https://www.varginha.mg.gov.br/portal/diario-oficial/ver/{publicacao_id}/"
                    if publicacao_id > 0 else ""
                )
                edicoes_all.append({
                    "ano": ano,
                    "edicao": ed,
                    "data": d.get("data") or d.get("Data") or "",
                    "data_atualizacao": d.get("dataAtualizacao") or d.get("DataAtualizacao") or "",
                    "descricao": d.get("descricao") or d.get("Descricao") or "",
                    "extra": (d.get("edicaoExtra") or d.get("EdicaoExtra") or "N") == "S",
                    "publicacao_id": publicacao_id or "",
                    "url_pdf": url_leitor,
                    "url_leitor": url_leitor,
                })
        except Exception as e:
            print(f"  ✗ {ano}: {e}")

    edicoes_all.sort(key=lambda x: (x["ano"], x["edicao"]), reverse=True)
    return {
        "total": len(edicoes_all),
        "ultimas": edicoes_all[:60],
    }


# ----------------------- Fontes complementares -------------------------- #

def _processa_pncp() -> dict:
    print("⇣ PNCP — Portal Nacional de Contratações Públicas…")
    try:
        import coletor_pncp
        payload = coletor_pncp.coletar()
        r = payload.get("resumo", {})
        print(f"  ✓ {r.get('compras_qtd', 0)} contratações e "
              f"{r.get('contratos_qtd', 0)} contratos mapeados")
        return payload
    except Exception as e:
        print(f"  ✗ PNCP: {e}")
        return {"fonte": "PNCP", "erro": str(e), "compras": [], "contratos": []}


def _processa_camara_transparencia() -> dict:
    print("⇣ Câmara — Portal de Transparência…")
    try:
        import coletor_camara_transparencia as camara_transp
        import coletor_federal as federal
        import coletor_pessoal as pessoal
        payload = camara_transp.coletar()
        r = payload.get("resumo", {})
        if payload.get("erro"):
            print(f"  ✗ {payload['erro']}")
        else:
            print(f"  ✓ {r.get('links_mapeados', 0)} links oficiais mapeados")
        return payload
    except Exception as e:
        print(f"  ✗ Transparência Câmara: {e}")
        return {"fonte": "Transparência Câmara", "erro": str(e), "links": []}


def _processa_cnpj(emendas: list[dict]) -> dict:
    print("⇣ CNPJ — apoio cadastral de beneficiários…")
    try:
        import coletor_cnpj
        payload = coletor_cnpj.coletar(emendas)
        r = payload.get("resumo", {})
        print(f"  ✓ {r.get('consultados', 0)} CNPJs consultados "
              f"({r.get('falhas', 0)} falhas)")
        return payload
    except Exception as e:
        print(f"  ✗ CNPJ: {e}")
        return {"fonte": "CNPJ", "erro": str(e), "empresas": [], "erros": []}


def _processa_pessoal() -> dict:
    print("⇣ Pessoal — comissionados e remuneração…")
    try:
        import coletor_pessoal
        payload = coletor_pessoal.coletar()
        existente = _load_existing("pessoal.json", {})
        novos_pref = payload.get("prefeitura", {}).get("servidores", [])
        antigos_pref = existente.get("prefeitura", {}).get("servidores", []) if isinstance(existente, dict) else []
        if (
            isinstance(novos_pref, list)
            and isinstance(antigos_pref, list)
            and len(antigos_pref) >= 1000
            and len(novos_pref) < max(100, int(len(antigos_pref) * 0.5))
        ):
            payload["prefeitura"] = existente.get("prefeitura", {})
            payload["prefeitura"]["status_cobertura"] = "preservada_por_cobertura"
            payload["observacao"] = (
                f"{payload.get('observacao', '')} "
                f"Prefeitura: a nova coleta trouxe apenas {len(novos_pref)} registro(s); "
                f"foi preservada a ultima base completa com {len(antigos_pref)} servidores para evitar regressao de cobertura."
            ).strip()
            print(
                f"  ! Prefeitura: coleta parcial ({len(novos_pref)} registro[s]); "
                f"preservando base completa anterior ({len(antigos_pref)} servidores)"
            )
        cr = payload.get("camara", {}).get("resumo", {})
        pr = payload.get("prefeitura", {}).get("resumo", {})
        print(f"  ✓ Câmara: {cr.get('comissionados_qtd', 0)} comissionados/similares")
        if pr.get("comissionados_qtd", 0):
            print(f"  ✓ Prefeitura: {pr.get('comissionados_qtd', 0)} comissionados/similares")
        else:
            print("  ! Prefeitura: campo criado; coleta automática ainda pendente")
        return payload
    except Exception as e:
        print(f"  ✗ Pessoal: {e}")
        return {"fonte": "Pessoal", "erro": str(e), "camara": {}, "prefeitura": {}}


def _processa_federal() -> dict:
    print("⇣ Federal — recursos da União para Varginha...")
    import coletor_federal
    payload = coletor_federal.coletar()
    print(f"  ✓ {len(payload.get('links_auditoria', []))} trilhas de auditoria federais mapeadas")
    return payload


def _processa_fontes_emendas_2026() -> dict:
    print("⇣ Emendas impositivas 2026 — investigação de fontes abertas…")
    try:
        import coletor_emendas_2026
        payload = coletor_emendas_2026.coletar()
        r = payload.get("resumo", {})
        print(
            f"  ✓ {r.get('fontes_ok', 0)}/{r.get('fontes_verificadas', 0)} fontes verificadas; "
            f"{r.get('achados_qtd', 0)} achados"
        )
        if not r.get("lista_estruturada_encontrada"):
            print("  ! Lista estruturada 2026 ainda não localizada em fonte aberta")
        return payload
    except Exception as e:
        print(f"  ✗ Fontes emendas 2026: {e}")
        return {
            "fonte": "Investigação de fontes abertas sobre emendas impositivas 2026",
            "erro": str(e),
            "resumo": {
                "fontes_verificadas": 0,
                "fontes_ok": 0,
                "achados_qtd": 0,
                "lista_estruturada_encontrada": False,
                "candidatos_com_valor_cnpj": 0,
                "conclusao": "A investigação automática não conseguiu consultar as fontes abertas.",
            },
            "achados": [],
            "fontes_verificadas": [],
            "proximos_passos": [],
        }


# --------------------------- main -------------------------------------- #

def _save_data_js(payload: dict) -> None:
    """Grava data.js com window.ZELA_DATA = {...} para o painel funcionar offline (file://)."""
    out = ROOT / "data.js"
    out.write_text(
        "/* Gerado por coletor.py — não editar à mão. */\n"
        "window.ZELA_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print(f"  ✓ data.js  ({out.stat().st_size // 1024} KB)")


def _enriquece_materias_cidadas(camara_anos: dict) -> None:
    """Aplica tema/grau no mesmo formato usado pela interface cidada."""
    try:
        import classificador_materia
    except Exception as e:
        print(f"  ! Classificador de materias indisponivel: {e}")
        return

    total = 0
    contagem = Counter()
    for bloco in (camara_anos or {}).values():
        for materia in bloco.get("materias", []):
            c = classificador_materia.classificar(materia)
            materia["tema"] = c["tema"]
            materia["tema_label"] = c["tema_label"]
            materia["grau"] = c["grau"]
            contagem[c["grau"]] += 1
            total += 1
    if total:
        print(
            f"  ✓ materias classificadas: {total} "
            f"(alto {contagem['alto']}, medio {contagem['medio']}, baixo {contagem['baixo']})"
        )


# ----------------- 3) Câmara (Betha) ------------------------------------ #

PORTAL_HASH_CAMARA = "-iAWLe1kr2VQcrW9k2AUBg=="
CONSULTA_CAMARA_DESPESAS   = 324767
CONSULTA_CAMARA_LICITACOES = 324786
CONSULTA_CAMARA_CONTRATOS  = 324812


_INTERNOS_CAMARA = ("CAMARA MUNICIPAL", "CÂMARA MUNICIPAL", "FUNDO MUNICIPAL")


def _eh_externo_camara(nome: str) -> bool:
    n = (nome or "").upper().strip()
    return not any(n.startswith(p.upper()) for p in _INTERNOS_CAMARA)


def _agrega_empenhos_camara(empenhos: list[dict], ano: int, n: int = 20):
    """Agrega empenhos da Câmara (schema: credor.nomeCredor + valorEmpenho + dataEmpenho).
    Exclui transferências internas (CÂMARA MUNICIPAL, FUNDO MUNICIPAL)."""
    from collections import defaultdict
    grupos: dict[str, dict] = defaultdict(lambda: {"nome": "", "valor_total": 0.0, "qtd": 0})
    total = 0.0
    for r in empenhos:
        data = r.get("dataEmpenho") or ""
        if data[:4] != str(ano):
            continue
        credor_obj = r.get("credor") or {}
        nome = (credor_obj.get("nomeCredor") if isinstance(credor_obj, dict) else str(credor_obj)) or "Desconhecido"
        if not _eh_externo_camara(nome):
            continue
        valor = float(r.get("valorEmpenho") or 0)
        total += valor
        # CNPJ do credor: agrupar pela raiz evita duplicar matriz/filial e
        # permite ao portão de auditoria casar despesa↔contrato sem depender
        # do nome (razão social varia entre consultas do Betha).
        cnpj = ""
        if isinstance(credor_obj, dict):
            cnpj = credor_obj.get("cnpjCpf") or credor_obj.get("cnpj") or ""
        raiz = "".join(c for c in cnpj if c.isdigit())[:8]
        g = grupos[raiz or nome.upper()]
        g["nome"] = nome
        if cnpj and not g.get("cnpj"):
            g["cnpj"] = cnpj
        g["valor_total"] += valor
        g["qtd"] += 1
    top = sorted(grupos.values(), key=lambda x: -x["valor_total"])[:n]
    for it in top:
        it["valor_total"] = round(it["valor_total"], 2)
    return round(total, 2), top


def _processa_camara_betha() -> dict:
    """Puxa dados financeiros ao vivo do Portal Betha da Câmara:
       - total empenhado por fornecedores no ano
       - top 20 fornecedores
       - contratos e licitações
    """
    print("⇣ Câmara — Portal Transparência Betha (despesas)…")
    try:
        import coletor_betha as cb
    except ImportError as e:
        print(f"  ✗ módulo coletor_betha indisponível: {e}")
        return {}

    try:
        token = cb.get_token(portal_hash=PORTAL_HASH_CAMARA)
    except Exception as e:
        print(f"  ✗ não foi possível obter token Câmara: {e}")
        return {}

    print("  baixando empenhos da Câmara (pode levar ~20s)…")
    try:
        empenhos = cb.todos_credores_generico(
            token, CONSULTA_CAMARA_DESPESAS, portal_hash=PORTAL_HASH_CAMARA
        )
    except Exception as e:
        print(f"  ✗ falha empenhos Câmara: {e}")
        empenhos = []

    ano_atual = dt.datetime.now().year
    total_atual, top_atual       = _agrega_empenhos_camara(empenhos, ano_atual,     n=20)
    total_anterior, top_anterior = _agrega_empenhos_camara(empenhos, ano_atual - 1, n=20)

    print(f"  ✓ {len(empenhos):,} empenhos — total {ano_atual}: R${total_atual:,.2f}")

    contratos = []
    licitacoes = []
    try:
        res = cb.baixar_dados_abertos(token, CONSULTA_CAMARA_CONTRATOS, ano=ano_atual,
                                       portal_hash=PORTAL_HASH_CAMARA, ano_field="anoLicitacao")
        contratos = _normaliza_contratos(res.get("main", []))
        print(f"  ✓ Contratos Câmara: {len(contratos)} registros")
    except Exception as e:
        print(f"  ✗ Contratos Câmara: {e}")

    try:
        res = cb.baixar_dados_abertos(token, CONSULTA_CAMARA_LICITACOES, ano=ano_atual,
                                       portal_hash=PORTAL_HASH_CAMARA, ano_field="anoLicitacao")
        licitacoes = _normaliza_licitacoes(res.get("main", []))
        print(f"  ✓ Licitações Câmara: {len(licitacoes)} registros")
    except Exception as e:
        print(f"  ✗ Licitações Câmara: {e}")

    return {
        "ano_atual":              ano_atual,
        "ano_anterior":           ano_atual - 1,
        "total_externo_atual":    total_atual,
        "total_externo_anterior": total_anterior,
        "empenhos_qtd":           len(empenhos),
        "top_fornecedores_atual":    top_atual,
        "top_fornecedores_anterior": top_anterior,
        "contratos":   contratos,
        "licitacoes":  licitacoes,
    }


# ----------------- 3b) Fundacao Cultural (Betha) ------------------------- #

PORTAL_HASH_FUNDACAO = "Y3P0PCFbAxmzg0qvgnMnYw=="
CONSULTA_FUNDACAO_DESPESAS_CREDOR = 80528
CONSULTA_FUNDACAO_EXEC_DETALHADA = 80382
CONSULTA_FUNDACAO_CONTRATOS = 80579
CONSULTA_FUNDACAO_PROCESSOS = 80466
CONSULTA_FUNDACAO_LICIT_ABERTAS = 80317
CONSULTA_FUNDACAO_DISPENSAS = 80477
CONSULTA_FUNDACAO_INEXIGIBILIDADES = 80471
CONSULTA_FUNDACAO_DIARIAS_ORC = 83072
CONSULTA_FUNDACAO_DIARIAS_DET = 211697
CONSULTA_FUNDACAO_SERVIDORES_ATIVOS = 80361
CONSULTA_FUNDACAO_TRANSFERENCIAS = 80403

_INTERNOS_FUNDACAO = (
    "FUNDACAO CULTURAL DO MUNICIPIO DE VARGINHA",
    "FUNDAÇÃO CULTURAL DO MUNICÍPIO DE VARGINHA",
    "FUNDACAO CULTURAL MUNICIPIO DE VARGINHA",
    "INPREV",
    "INSS",
    "MINISTERIO DA FAZENDA",
    "MINISTÉRIO DA FAZENDA",
    "SECRETARIA DA RECEITA",
    "MUNICIPIO DE VARGINHA",
    "MUNICÍPIO DE VARGINHA",
    "PREFEITURA",
    "CAIXA ECONOMICA FEDERAL",
)


def _eh_externo_fundacao(nome: str) -> bool:
    n = (nome or "").upper().strip()
    return bool(n) and not any(p in n for p in _INTERNOS_FUNDACAO)


def _agrega_despesas_fundacao(rows: list[dict], ano: int, n: int = 20) -> tuple[float, float, list[dict]]:
    grupos: dict[str, dict] = {}
    total = 0.0
    total_externo = 0.0
    for r in rows:
        if int(r.get("ano") or 0) != ano:
            continue
        nome = r.get("nomeCredor") or ""
        valor = _f(r.get("valorPagamentoAno", 0))
        total += valor
        if not _eh_externo_fundacao(nome):
            continue
        total_externo += valor
        cnpj = r.get("cnpjCpf") or ""
        chave = (cnpj or nome).upper()
        g = grupos.setdefault(chave, {
            "nome": nome,
            "cnpj": cnpj,
            "valor_total": 0.0,
            "registros": 0,
        })
        g["valor_total"] += valor
        g["registros"] += 1
        if len(nome) > len(g["nome"]):
            g["nome"] = nome
    top = sorted(grupos.values(), key=lambda x: -x["valor_total"])[:n]
    for it in top:
        it["valor_total"] = round(it["valor_total"], 2)
    return round(total, 2), round(total_externo, 2), top


def _normaliza_execucao_fundacao(rows: list[dict], ano: int, n: int = 80) -> list[dict]:
    out = []
    for r in rows:
        data = (r.get("dataEmpenho") or "")[:10]
        if data[:4] != str(ano):
            continue
        credor = r.get("credor") or {}
        nome_credor = credor.get("nomeCredor", "") if isinstance(credor, dict) else str(credor or "")
        out.append({
            "data": data,
            "numero": r.get("numeroEmpenho", ""),
            "orgao": r.get("descricaoOrgao", ""),
            "credor": nome_credor,
            "historico": (r.get("historicoEmpenho", "") or "").strip(),
            "valor_empenhado": _f(r.get("valorEmpenho", 0)),
            "valor_liquidado": _f(r.get("valorLiquidadoEmpenho", 0)),
            "valor_pago": _f(r.get("valorPagoEmpenho", 0)),
            "saldo_a_pagar": _f(r.get("saldoAPagar", 0)),
        })
    out.sort(key=lambda x: -x["valor_empenhado"])
    return out[:n]


def _normaliza_diarias_fundacao(rows: list[dict], fonte: str) -> list[dict]:
    out = []
    for r in rows:
        credor_obj = r.get("credor") or {}
        credor = r.get("credor") if isinstance(r.get("credor"), str) else (
            credor_obj.get("nomeCredor", "") if isinstance(credor_obj, dict) else ""
        )
        valor = _f(r.get("valorTotal") or r.get("valorPagoEmpenho") or r.get("valorEmpenho"))
        out.append({
            "ano": str(r.get("ano") or (r.get("dataEmpenho", "")[:4]) or ""),
            "funcionario": credor or "",
            "cargo": r.get("cargoCredor", ""),
            "numero": r.get("numeroDiaria") or r.get("numeroEmpenho", ""),
            "quantidade": _f(r.get("quantidade")) or 1,
            "valor_total": valor,
            "periodo": r.get("periodoDiarias", ""),
            "destino": r.get("localDestino", ""),
            "finalidade": (r.get("finalidade", "") or r.get("descricaoProjetoAtividade", "") or "").strip(),
            "fonte": fonte,
        })
    out.sort(key=lambda x: -x["valor_total"])
    return out


def _normaliza_servidores_fundacao(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        out.append({
            "nome": r.get("nomeServidor", ""),
            "cargo": r.get("cargoAtual", ""),
            "orgao": r.get("orgao", ""),
            "data_admissao": r.get("dataAdmissao", ""),
            "tipo_matricula": r.get("tipoMatricula", ""),
            "vinculo": r.get("vinculoEmpregaticio", ""),
            "carga_horaria_mensal": r.get("cargaHorariaMensal", ""),
            "carga_horaria_semanal": r.get("cargaHorariaSemanal", ""),
            "remuneracao_contratual": _f(r.get("valorRemuneracaoContratual", 0)),
            "situacao": r.get("situacao", ""),
        })
    out.sort(key=lambda x: (x["nome"] or "").upper())
    return out


def _normaliza_transferencias_fundacao(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        out.append({
            "numero": r.get("numero", ""),
            "data": r.get("data", ""),
            "ano": (r.get("data", "") or "")[:4],
            "orgao_concedente": r.get("orgaoConcedente", ""),
            "fonte_recurso": r.get("fonteRecurso", ""),
            "finalidade": r.get("finalidade", ""),
            "valor": _f(r.get("valor", 0)),
        })
    out.sort(key=lambda x: x["data"], reverse=True)
    return out


def _processa_fundacao_cultural() -> dict:
    """Puxa dados do Portal Betha proprio da Fundacao Cultural de Varginha."""
    print("⇣ Fundação Cultural — Portal Transparência Betha…")
    try:
        import coletor_betha as cb
    except ImportError as e:
        print(f"  ✗ módulo coletor_betha indisponível: {e}")
        return {}

    try:
        token = cb.get_token(portal_hash=PORTAL_HASH_FUNDACAO)
    except Exception as e:
        print(f"  ✗ não foi possível obter token Fundação Cultural: {e}")
        return {}

    ano_atual = dt.datetime.now().year
    ano_anterior = ano_atual - 1
    portal_url = f"https://transparencia.betha.cloud/#/{PORTAL_HASH_FUNDACAO}"

    def baixar_busca(label: str, consulta_id: int, body: dict | None = None,
                     sort_by: str = "id", batch: int = 500) -> list[dict]:
        print(f"  baixando {label}…")
        try:
            rows = cb.baixar_busca_textual(
                token, consulta_id, body=body or {}, sort_by=sort_by,
                portal_hash=PORTAL_HASH_FUNDACAO, batch=batch,
            )
            print(f"  ✓ {label}: {len(rows)} registros")
            return rows
        except Exception as e:
            print(f"  ✗ {label}: {e}")
            return []

    despesas_atual = baixar_busca(
        f"Despesas por credor ({ano_atual})",
        CONSULTA_FUNDACAO_DESPESAS_CREDOR,
        {"ano": [str(ano_atual)]},
        sort_by="valorPagamentoAno",
    )
    despesas_anterior = baixar_busca(
        f"Despesas por credor ({ano_anterior})",
        CONSULTA_FUNDACAO_DESPESAS_CREDOR,
        {"ano": [str(ano_anterior)]},
        sort_by="valorPagamentoAno",
    )
    despesas = despesas_atual + despesas_anterior
    total_atual, total_externo_atual, top_atual = _agrega_despesas_fundacao(despesas, ano_atual)
    total_anterior, total_externo_anterior, top_anterior = _agrega_despesas_fundacao(despesas, ano_anterior)

    exec_atual = baixar_busca(
        f"Execução detalhada ({ano_atual})",
        CONSULTA_FUNDACAO_EXEC_DETALHADA,
    )
    exec_norm_full = _normaliza_execucao_fundacao(exec_atual, ano_atual, n=10_000)
    exec_norm = exec_norm_full[:80]
    exec_resumo = {
        "registros": len(exec_norm_full),
        "empenhado": round(sum(i["valor_empenhado"] for i in exec_norm_full), 2),
        "liquidado": round(sum(i["valor_liquidado"] for i in exec_norm_full), 2),
        "pago": round(sum(i["valor_pago"] for i in exec_norm_full), 2),
    }

    contratos_raw = baixar_busca("Contratos", CONSULTA_FUNDACAO_CONTRATOS)
    contratos = _normaliza_contratos(contratos_raw)
    hoje_iso = dt.date.today().isoformat()
    contratos_vigentes = [
        c for c in contratos
        if (c.get("data_fim") and c["data_fim"] >= hoje_iso)
        or "EXECU" in (c.get("situacao", "") or "").upper()
    ]
    contratos_futuros = [
        c for c in contratos
        if c.get("data_fim") and c["data_fim"] >= hoje_iso
    ]

    licitacoes = _normaliza_licitacoes(baixar_busca("Processos licitatórios", CONSULTA_FUNDACAO_PROCESSOS))
    licit_abertas = _normaliza_licitacoes(baixar_busca("Licitações abertas/em andamento", CONSULTA_FUNDACAO_LICIT_ABERTAS))
    dispensas = _normaliza_licitacoes(baixar_busca("Dispensas", CONSULTA_FUNDACAO_DISPENSAS))
    inexigibilidades = _normaliza_licitacoes(baixar_busca("Inexigibilidades", CONSULTA_FUNDACAO_INEXIGIBILIDADES))

    diarias_detalhe = _normaliza_diarias_fundacao(
        baixar_busca("Diárias detalhadas", CONSULTA_FUNDACAO_DIARIAS_DET),
        "Betha Fundação Cultural - Diárias",
    )
    diarias_orc = _normaliza_diarias_fundacao(
        baixar_busca(f"Diárias orçamentárias ({ano_atual})", CONSULTA_FUNDACAO_DIARIAS_ORC, {"ano": [str(ano_atual)]}),
        "Betha Fundação Cultural - Diárias orçamentárias",
    )
    servidores = _normaliza_servidores_fundacao(
        baixar_busca("Servidores públicos ativos", CONSULTA_FUNDACAO_SERVIDORES_ATIVOS)
    )
    transferencias = _normaliza_transferencias_fundacao(
        baixar_busca("Transferências financeiras recebidas", CONSULTA_FUNDACAO_TRANSFERENCIAS)
    )

    def soma_ano(lista: list[dict], campo: str, ano: int) -> float:
        return round(sum(_f(i.get(campo, 0)) for i in lista if str(i.get("ano", "")) == str(ano)), 2)

    print(f"  ✓ Fundação Cultural: {len(contratos)} contratos, {len(servidores)} servidores ativos")
    return {
        "fonte": "Portal Betha da Fundação Cultural de Varginha",
        "portal_hash": PORTAL_HASH_FUNDACAO,
        "portal_url": portal_url,
        "cnpj": "18.987.735/0001-16",
        "nome": "Fundação Cultural de Varginha",
        "ano_atual": ano_atual,
        "ano_anterior": ano_anterior,
        "despesas": {
            "total_atual": total_atual,
            "total_anterior": total_anterior,
            "total_externo_atual": total_externo_atual,
            "total_externo_anterior": total_externo_anterior,
            "credores_atual_qtd": len(despesas_atual),
            "credores_anterior_qtd": len(despesas_anterior),
            "top_fornecedores_atual": top_atual,
            "top_fornecedores_anterior": top_anterior,
            "fonte_url": f"{portal_url}/consulta/{CONSULTA_FUNDACAO_DESPESAS_CREDOR}",
        },
        "execucao": {
            "resumo_atual": exec_resumo,
            "maiores_empenhos_atual": exec_norm,
            "fonte_url": f"{portal_url}/consulta/{CONSULTA_FUNDACAO_EXEC_DETALHADA}",
        },
        "contratos": contratos,
        "contratos_vigentes": contratos_vigentes,
        "contratos_futuros": contratos_futuros,
        "contratos_resumo": {
            "qtd_total": len(contratos),
            "valor_total": round(sum(c.get("valor", 0) for c in contratos), 2),
            "qtd_vigentes": len(contratos_vigentes),
            "valor_vigentes": round(sum(c.get("valor", 0) for c in contratos_vigentes), 2),
            "qtd_vigencia_futura": len(contratos_futuros),
            "valor_vigencia_futura": round(sum(c.get("valor", 0) for c in contratos_futuros), 2),
            "fonte_url": f"{portal_url}/consulta/{CONSULTA_FUNDACAO_CONTRATOS}",
        },
        "licitacoes": licitacoes,
        "licit_abertas": licit_abertas,
        "dispensas": dispensas,
        "inexigibilidades": inexigibilidades,
        "licitacoes_resumo": {
            "processos_qtd": len(licitacoes),
            "processos_valor": round(sum(l.get("valor", 0) for l in licitacoes), 2),
            "dispensas_qtd": len(dispensas),
            "inexigibilidades_qtd": len(inexigibilidades),
            "abertas_qtd": len(licit_abertas),
            "fonte_url": f"{portal_url}/consulta/{CONSULTA_FUNDACAO_PROCESSOS}",
        },
        "diarias": {
            "detalhadas": diarias_detalhe,
            "orcamentarias": diarias_orc,
            "resumo": {
                "detalhadas_qtd": len(diarias_detalhe),
                "detalhadas_valor_total": round(sum(d.get("valor_total", 0) for d in diarias_detalhe), 2),
                "atual_qtd": len([d for d in diarias_detalhe if d.get("ano") == str(ano_atual)]),
                "atual_valor": soma_ano(diarias_detalhe, "valor_total", ano_atual),
                "orcamentarias_atual_valor": soma_ano(diarias_orc, "valor_total", ano_atual),
            },
            "fonte_url": f"{portal_url}/consulta/{CONSULTA_FUNDACAO_DIARIAS_DET}",
        },
        "pessoal": {
            "servidores": servidores,
            "resumo": {
                "ativos_qtd": len(servidores),
                "comissionados_qtd": sum(1 for s in servidores if "COMISSION" in (s.get("vinculo", "") or "").upper()),
                "efetivos_qtd": sum(1 for s in servidores if "EFETIVO" in (s.get("vinculo", "") or "").upper()),
            },
            "fonte_url": f"{portal_url}/consulta/{CONSULTA_FUNDACAO_SERVIDORES_ATIVOS}",
        },
        "transferencias": {
            "itens": transferencias,
            "resumo": {
                "qtd": len(transferencias),
                "valor_total": round(sum(t.get("valor", 0) for t in transferencias), 2),
                "valor_atual": soma_ano(transferencias, "valor", ano_atual),
                "valor_anterior": soma_ano(transferencias, "valor", ano_anterior),
            },
            "fonte_url": f"{portal_url}/consulta/{CONSULTA_FUNDACAO_TRANSFERENCIAS}",
        },
    }


# ----------------- 4) Prefeitura (Betha) -------------------------------- #

def _processa_prefeitura(emendas: list[dict]) -> dict:
    """Puxa dados ao vivo do Portal de Transparência Betha:
       - todos os credores (paginação completa)
       - top 30 fornecedores externos no ano corrente
       - cruzamento com as emendas impositivas (promessa × pagamento)
       - totalizadores
    """
    print("⇣ Prefeitura — Portal Transparência Betha…")
    try:
        import coletor_betha as cb
    except ImportError as e:
        print(f"  ✗ módulo coletor_betha indisponível: {e}")
        return {}

    try:
        token = cb.get_token()
    except Exception as e:
        print(f"  ✗ não foi possível obter token: {e}")
        print("    (a seção Prefeitura ficará apenas com os atalhos estáticos)")
        return {}

    print("  baixando todos os credores (pode levar ~30s)…")
    try:
        credores = cb.todos_credores(token)
    except Exception as e:
        print(f"  ✗ falha no download de credores: {e}")
        return {}

    print(f"  ✓ {len(credores):,} registros (ano × entidade × credor)")

    ano_atual = dt.datetime.now().year
    top_atual    = cb.top_fornecedores(credores, ano=ano_atual,    n=30)
    top_anterior = cb.top_fornecedores(credores, ano=ano_atual - 1, n=30)

    total_atual    = cb.total_pago(credores, ano=ano_atual,    apenas_externos=True)
    total_anterior = cb.total_pago(credores, ano=ano_atual - 1, apenas_externos=True)

    cruzadas = cb.cruzar_emendas(emendas, credores)
    com_pagamento  = sum(1 for e in cruzadas if e["status"] == "encontrado")
    sem_pagamento  = sum(1 for e in cruzadas if e["status"] == "sem_pagamento")
    sem_cnpj       = sum(1 for e in cruzadas if e["status"] == "sem_cnpj")
    execucao_direta = sum(1 for e in cruzadas if e["status"] == "execucao_direta")

    print(f"  Cruzamento: {com_pagamento} com pagamento, "
          f"{sem_pagamento} sem encontrar pagamento, {sem_cnpj} sem CNPJ, "
          f"{execucao_direta} execução direta (órgão público)")

    # ===== Dados Abertos (Onda 3): contratos, licitações, compras diretas e obras =====
    # A consulta de contratos filtra por anoLicitacao. Os 2 anos correntes vêm
    # inteiros; dos anteriores resgatamos só os plurianuais AINDA vigentes —
    # ex.: agência de publicidade (VERSAO BR, R$ 8,9 mi) assinada em 2024 e
    # vigente até 2026, que sem isto ficava de fora da base.
    hoje_iso        = dt.date.today().isoformat()
    contratos       = _baixar_dados_abertos_safe(cb, token, "Contratos",               cb.CONSULTA_CONTRATOS,          ano_atual)
    contratos      += _baixar_dados_abertos_safe(cb, token, "Contratos (ano anterior)", cb.CONSULTA_CONTRATOS,          ano_atual - 1)
    # Janela longa (ate ano-8): plurianuais antigos renovados por aditivo —
    # ex.: ERP Betha e vale-refeicao Verocheque — apareciam como "fornecedor
    # sem contrato" na auditoria porque a licitacao original e anterior a
    # ano-3. So os AINDA vigentes entram, entao a base nao incha.
    for ano_old in range(ano_atual - 2, ano_atual - 9, -1):
        brutos   = _baixar_dados_abertos_safe(cb, token, f"Contratos vigentes ({ano_old})", cb.CONSULTA_CONTRATOS, ano_old)
        vigentes = [r for r in brutos if _contrato_vigente(r, hoje_iso)]
        print(f"    → {len(vigentes)}/{len(brutos)} ainda vigentes")
        contratos += vigentes
    licit_andamento = _baixar_dados_abertos_safe(cb, token, "Licitações em andamento", cb.CONSULTA_LICITACOES_ABERTAS, ano_atual)
    licit_finaliz   = _baixar_dados_abertos_safe(cb, token, "Licitações finalizadas",  cb.CONSULTA_LICITACOES_FECHADAS, ano_atual)
    compras_diretas = _baixar_dados_abertos_safe(cb, token, "Compras diretas",         cb.CONSULTA_COMPRAS_DIRETAS,    ano_atual - 1)
    obras_rows, obras_linked, _ = _baixar_dados_abertos_full_safe(
        cb, token, "Obras públicas", cb.CONSULTA_OBRAS_PUBLICAS, ano_atual
    )
    frota_rows, frota_linked, frota_linked_rows = _baixar_dados_abertos_full_safe(
        cb, token, "Veículos municipais", cb.CONSULTA_VEICULOS_MUNICIPAIS, ano_atual
    )

    return {
        "ano_atual":     ano_atual,
        "ano_anterior":  ano_atual - 1,
        "total_externo_atual":    total_atual,
        "total_externo_anterior": total_anterior,
        "credores_qtd":  len(credores),
        "top_fornecedores_atual":    top_atual,
        "top_fornecedores_anterior": top_anterior,
        "emendas_cruzadas": cruzadas,
        "stats_cruzamento": {
            "com_pagamento":   com_pagamento,
            "sem_pagamento":   sem_pagamento,
            "sem_cnpj":        sem_cnpj,
            "execucao_direta": execucao_direta,
        },
        "contratos":        _normaliza_contratos(contratos),
        "licit_andamento":  _normaliza_licitacoes(licit_andamento),
        "licit_finalizadas": _normaliza_licitacoes(licit_finaliz),
        "compras_diretas":  _normaliza_compras(compras_diretas),
        "obras_publicas":   _normaliza_obras_publicas(obras_rows, obras_linked),
        "frota":            _normaliza_frota(frota_rows, frota_linked, frota_linked_rows),
    }


def _baixar_dados_abertos_safe(cb, token: str, label: str, consulta_id: int,
                                ano: int) -> list[dict]:
    print(f"  baixando {label} ({ano})…")
    try:
        res = cb.baixar_dados_abertos(token, consulta_id, ano=ano)
        rows = res.get("main", [])
        print(f"  ✓ {len(rows)} registros")
        return rows
    except Exception as e:
        print(f"  ✗ {label}: {e}")
        return []


def _contrato_vigente(r: dict, hoje_iso: str) -> bool:
    """Contrato de ano anterior que ainda vale: em execução ou com vigência
    final no futuro. Resgata plurianuais ativos (ex.: agência de publicidade
    assinada em 2024 e vigente até 2026). dataVigenciaFinal vem em ISO
    (YYYY-MM-DD), então a comparação lexicográfica equivale à cronológica."""
    fim = str(r.get("dataVigenciaFinal", "")).strip()[:10]
    if fim:
        # Data explícita decide: o campo situacao do Betha fica desatualizado
        # ("EM EXECUÇÃO" em contrato com vigência encerrada ha anos) e, com a
        # janela longa de resgate, confiar nele traria contratos mortos.
        return fim >= hoje_iso
    sit = str(r.get("situacao", "")).strip().upper()
    return sit in ("EXECUCAO", "EXECUÇÃO", "EM EXECUCAO", "VIGENTE", "ATIVO")


def _baixar_dados_abertos_full_safe(cb, token: str, label: str, consulta_id: int,
                                    ano: int) -> tuple[list[dict], dict, dict]:
    print(f"  baixando {label} ({ano})…")
    try:
        res = cb.baixar_dados_abertos(token, consulta_id, ano=ano)
        rows = res.get("main", [])
        linked = res.get("linked", {})
        linked_rows = res.get("linked_rows", {})
        print(f"  ✓ {len(rows)} registros ({res.get('files_in_zip', 0)} arquivos no ZIP)")
        return rows, linked, linked_rows
    except Exception as e:
        print(f"  ✗ {label}: {e}")
        return [], {}, {}


# Os CSVs Betha vêm com colunas diferentes por consulta. Normalizamos para o
# painel só os campos relevantes ao cidadão.

def _cell(value) -> str:
    s = str(value or "").strip()
    return "" if s in {"-", "--"} else s


def _linked(linked: dict, ref: str) -> dict:
    key = _cell(ref)
    if not key or not key.lower().endswith(".csv"):
        return {}
    item = linked.get(key)
    return item if isinstance(item, dict) else {}


def _linked_rows(linked_rows: dict, ref: str) -> list[dict]:
    key = _cell(ref)
    if not key or not key.lower().endswith(".csv"):
        return []
    rows = linked_rows.get(key)
    return rows if isinstance(rows, list) else []


def _f(s) -> float:
    """Converte string monetária do CSV para float."""
    if not s:
        return 0.0
    s = str(s).strip()
    if not s:
        return 0.0
    try:
        return float(s.replace(",", "."))
    except (ValueError, TypeError):
        return 0.0


def _normaliza_contratos(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        out.append({
            "numero":        r.get("numero", ""),
            "ano":           r.get("ano", ""),
            "data_assinatura": r.get("dataAssinatura", ""),
            "data_fim":      r.get("dataVigenciaFinal", ""),
            "modalidade":    r.get("modalidadeLicitacao", ""),
            "tipo":          r.get("tipo", ""),
            "objeto":        r.get("objeto", "").strip(),
            "contratado":    r.get("nomeContratado", ""),
            "cnpj":          r.get("cnpjCpfContratado", ""),
            "valor":         _f(r.get("valorFinal", 0)),
            "situacao":      r.get("situacao", ""),
            "entidade":      r.get("nomeEntidade", ""),
        })
    out.sort(key=lambda x: -x["valor"])
    return out


def _normaliza_licitacoes(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        out.append({
            "numero":      r.get("numero", "") or r.get("numeroProcesso", ""),
            "ano":         r.get("ano", ""),
            "modalidade":  r.get("modalidade", "") or r.get("modalidadeLicitacao", ""),
            "objeto":      (r.get("objeto", "") or r.get("descricao", "")).strip(),
            "data":        r.get("dataAbertura", "") or r.get("dataPublicacao", ""),
            "valor":       _f(r.get("valorEstimado", 0) or r.get("valorTotal", 0)),
            "situacao":    r.get("situacao", "") or r.get("status", ""),
            "entidade":    r.get("nomeEntidade", ""),
        })
    out.sort(key=lambda x: -x["valor"])
    return out


def _normaliza_compras(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        out.append({
            "numero":      r.get("numero", ""),
            "ano":         r.get("ano", ""),
            "data":        r.get("dataAbertura", "") or r.get("dataAssinatura", ""),
            "objeto":      (r.get("objeto", "") or r.get("descricao", "")).strip(),
            "fornecedor":  r.get("nomeFornecedor", "") or r.get("nomeContratado", ""),
            "cnpj":        r.get("cnpjCpfFornecedor", "") or r.get("cnpjCpfContratado", ""),
            "valor":       _f(r.get("valorTotal", 0) or r.get("valorFinal", 0)),
            "modalidade":  r.get("tipoCompra", "") or r.get("modalidadeLicitacao", ""),
            "entidade":    r.get("nomeEntidade", ""),
        })
    out.sort(key=lambda x: -x["valor"])
    return out


def _normaliza_obras_publicas(rows: list[dict], linked: dict) -> list[dict]:
    out = []
    fonte_url = "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83026"
    for r in rows:
        endereco = _linked(linked, r.get("endereco", ""))
        geo = _linked(linked, r.get("geolocalizacao", ""))
        medicao = _linked(linked, r.get("medicoes", ""))
        responsavel = _linked(linked, r.get("responsaveis", ""))
        contrato = _linked(linked, r.get("contratos", ""))
        licitacao = _linked(linked, r.get("licitacoes", ""))
        situacao = _linked(linked, r.get("situacoes", ""))

        logradouro = _cell(endereco.get("logradouro", ""))
        numero_endereco = _cell(endereco.get("numeroEndereço", "") or endereco.get("numeroEndereco", ""))
        bairro = _cell(endereco.get("bairro", ""))
        cidade = _cell(endereco.get("municipio", ""))
        endereco_partes = [
            p for p in [
                logradouro,
                f"nº {numero_endereco}" if numero_endereco else "",
                bairro,
                cidade,
            ] if p
        ]

        valor_previsto = _f(r.get("valorPrevisto", 0))
        valor_atualizado = _f(r.get("valorAtualizado", 0))
        valor_efetivo = _f(r.get("valorEfetivo", 0))
        valor_contrato = _f(contrato.get("valor", 0))
        valor_medicao = _f(medicao.get("valor", 0))
        valor = valor_efetivo or valor_atualizado or valor_previsto or valor_contrato or valor_medicao
        data_inicio = _cell(r.get("dataInicio", ""))
        ano = data_inicio[:4] or _cell(contrato.get("ano", "")) or _cell(r.get("dataPrevistaConclusao", ""))[:4]
        percentual = _f(r.get("percentualExecutado", 0) or situacao.get("percentualExecucao", 0))
        fornecedor = _cell(r.get("nomeFornecedor", "")) or _cell(contrato.get("nomeContratado", ""))

        out.append({
            "id_obra": _cell(r.get("idObra", "")),
            "numero": _cell(r.get("idObra", "")),
            "ano": ano,
            "matricula_obra": _cell(r.get("matriculaObra", "")),
            "entidade": _cell(r.get("nomeEntidade", "")),
            "tipo_obra": _cell(r.get("tipoObra", "")),
            "categoria": _cell(r.get("categoria", "")),
            "objeto": _cell(r.get("descricaoObra", "")),
            "situacao": _cell(r.get("situacaoAtual", "")) or _cell(situacao.get("situacao", "")),
            "data_inicio": data_inicio,
            "data_prevista_conclusao": _cell(r.get("dataPrevistaConclusao", "")),
            "data_efetiva_conclusao": _cell(r.get("dataEfetivaConclusao", "")),
            "data_ordem_servico": _cell(r.get("dataOrdemServico", "")),
            "data_ultima_medicao": _cell(r.get("dataUltimaMedicao", "")) or _cell(medicao.get("data", "")),
            "fornecedor": fornecedor,
            "contratado": fornecedor,
            "cnpj": _cell(r.get("CnpjCpfFornecedor", "")) or _cell(r.get("cnpjCpfFornecedor", "")),
            "valor": valor,
            "valor_previsto": valor_previsto,
            "valor_atualizado": valor_atualizado,
            "valor_efetivo": valor_efetivo,
            "valor_contrato": valor_contrato,
            "valor_medicao": valor_medicao,
            "percentual_executado": percentual,
            "area_m2": _f(r.get("tamanhoMetrosQuadrados", 0)),
            "extensao": _f(r.get("tamanhoDistanciaPercorrida", 0)),
            "tipo_empreitada": _cell(r.get("tipoEmpreitada", "")),
            "tipo_execucao": _cell(r.get("tipoExecucao", "")),
            "tipo_recurso": _cell(r.get("tipoRecurso", "")),
            "endereco": ", ".join(endereco_partes),
            "logradouro": logradouro,
            "bairro": bairro,
            "municipio": cidade,
            "latitude": _cell(geo.get("latitude", "")),
            "longitude": _cell(geo.get("longitude", "")),
            "responsavel": _cell(responsavel.get("nome", "")) or _cell(situacao.get("responsavel", "")),
            "responsavel_registro": _cell(responsavel.get("registroProfissional", "")),
            "responsavel_funcao": _cell(responsavel.get("funcao", "")),
            "medicao_responsavel": _cell(medicao.get("responsavel", "")),
            "medicao_observacao": _cell(medicao.get("observacao", "")),
            "contrato_numero": _cell(contrato.get("numero", "")),
            "contrato_ano": _cell(contrato.get("ano", "")),
            "contrato_data_assinatura": _cell(contrato.get("dataAssinatura", "")),
            "licitacao_numero": _cell(licitacao.get("numeroLicitacao", "")) or _cell(licitacao.get("numeroProcesso", "")),
            "licitacao_modalidade": _cell(licitacao.get("modalidade", "")),
            "fonte_url": fonte_url,
        })
    out.sort(key=lambda x: -x["valor"])
    return out


def _normaliza_frota(rows: list[dict], linked: dict, linked_rows: dict) -> list[dict]:
    out = []
    fonte_url = "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83061"

    def _is_combustivel(txt: str) -> bool:
        t = _norm_txt(txt)
        return any(k in t for k in ["abastecimento", "combustivel", "gasolina", "diesel", "etanol", "arla"])

    def _is_manutencao(txt: str) -> bool:
        t = _norm_txt(txt)
        return any(k in t for k in ["manutencao", "peca", "pecas", "servico", "revisao", "oficina", "lubrificante", "oleo"])

    for r in rows:
        hist_cc = _linked(linked, r.get("historicoCentroDeCustos", ""))
        gastos_raw = _linked_rows(linked_rows, r.get("gastos", ""))
        if not gastos_raw:
            gasto_unico = _linked(linked, r.get("gastos", ""))
            gastos_raw = [gasto_unico] if gasto_unico else []

        gastos = []
        total_gastos = 0.0
        total_gastos_bruto = 0.0
        total_atipico = 0.0
        total_combustivel = 0.0
        total_manutencao = 0.0
        litros_combustivel = 0.0
        tipos = Counter()
        fornecedores = Counter()
        gastos_atipicos = []

        for g in gastos_raw:
            tipo = _cell(g.get("tipoDespesa", ""))
            fornecedor = _cell(g.get("nomeFornecedor", ""))
            valor = _f(g.get("valorDespesa", 0))
            itens = _linked_rows(linked_rows, g.get("itensDespesa", ""))
            itens_resumo = []
            litros_gasto = 0.0
            for item in itens[:4]:
                desc = _cell(item.get("descricao", ""))
                unidade = _cell(item.get("unidadeMedida", ""))
                qtd = _f(item.get("quantidade", 0))
                valor_item = _f(item.get("valorTotal", 0))
                if unidade.upper() == "L" and _is_combustivel(f"{tipo} {desc}"):
                    litros_gasto += qtd
                if desc:
                    prefix = f"{qtd:g} {unidade}".strip() if qtd else ""
                    itens_resumo.append({
                        "descricao": desc,
                        "quantidade": qtd,
                        "unidade": unidade,
                        "valor_total": valor_item,
                        "resumo": f"{prefix} - {desc}" if prefix else desc,
                    })

            texto_gasto = f"{tipo} {' '.join(i.get('descricao', '') for i in itens_resumo)}"
            combustivel = _is_combustivel(texto_gasto)
            manutencao = _is_manutencao(texto_gasto)
            valor_por_litro = valor / litros_gasto if litros_gasto else 0
            atipico = valor > 500_000 or (combustivel and (valor > 100_000 or (litros_gasto and valor_por_litro > 50)))
            total_gastos_bruto += valor
            if not atipico:
                total_gastos += valor
                tipos[tipo or "Nao informado"] += valor
                if combustivel:
                    total_combustivel += valor
                    litros_combustivel += litros_gasto
                if manutencao:
                    total_manutencao += valor
            else:
                total_atipico += valor
            if fornecedor and not atipico:
                fornecedores[fornecedor] += valor

            gasto_norm = {
                "data": _cell(g.get("data", "")),
                "tipo": tipo,
                "fornecedor": fornecedor,
                "descricao": _cell(g.get("descricaoGasto", "")),
                "forma_aquisicao": _cell(g.get("formaAquisicao", "")),
                "documento": _cell(g.get("documentoDespesa", "")),
                "empenho": _cell(g.get("numeroEmpenho", "")),
                "centro_custo": _cell(g.get("centroCustoDespesa", "")),
                "valor": valor,
                "valor_atipico": atipico,
                "motivo_atipico": "valor fora de escala; conferir lançamento original" if atipico else "",
                "itens": itens_resumo,
            }
            gastos.append(gasto_norm)
            if atipico:
                gastos_atipicos.append(gasto_norm)

        gastos.sort(key=lambda x: x.get("data", ""), reverse=True)
        centro_custo = _cell(r.get("centroCusto", "")) or _cell(hist_cc.get("centroDeCustos", ""))
        alertas = []
        if not centro_custo:
            alertas.append("Centro de custo nao informado")
        if _cell(r.get("situacao", "")).upper() == "INATIVO" and total_gastos > 0:
            alertas.append("Veiculo inativo com gasto vinculado")
        if _cell(r.get("tipoAquisicao", "")).upper() == "LOCADO":
            alertas.append("Veiculo locado: conferir contrato e custo mensal")
        if total_atipico > 0:
            alertas.append("Possui lançamento atípico separado do total principal")
        if total_gastos > 50_000:
            alertas.append("Gasto acumulado alto")

        out.append({
            "placa": _cell(r.get("placa", "")),
            "tipo": _cell(r.get("tipo", "")),
            "descricao": _cell(r.get("descricao", "")),
            "ano_fabricacao": _cell(r.get("anoFabricacao", "")),
            "ano_modelo": _cell(r.get("anoModelo", "")),
            "data_aquisicao": _cell(r.get("dataAquisicao", "")),
            "tipo_aquisicao": _cell(r.get("tipoAquisicao", "")),
            "valor_aquisicao": _f(r.get("valorAquisicao", 0)),
            "centro_custo": centro_custo,
            "situacao": _cell(r.get("situacao", "")),
            "renavam": _cell(r.get("renavam", "")),
            "chassi": _cell(r.get("chassi", "")),
            "gastos_total": round(total_gastos, 2),
            "gastos_total_bruto": round(total_gastos_bruto, 2),
            "gastos_atipicos_total": round(total_atipico, 2),
            "gastos_atipicos_qtd": len(gastos_atipicos),
            "gastos_qtd": len(gastos),
            "gastos_auditaveis_qtd": len(gastos) - len(gastos_atipicos),
            "combustivel_total": round(total_combustivel, 2),
            "manutencao_total": round(total_manutencao, 2),
            "litros_combustivel": round(litros_combustivel, 3),
            "ultimo_gasto_data": gastos[0]["data"] if gastos else "",
            "ultimo_gasto_tipo": gastos[0]["tipo"] if gastos else "",
            "ultimo_gasto_valor": gastos[0]["valor"] if gastos else 0,
            "gastos_recentes": gastos[:6],
            "gastos_atipicos": gastos_atipicos[:5],
            "gastos_por_tipo": [
                {"tipo": tipo, "valor": round(valor, 2)}
                for tipo, valor in tipos.most_common(6)
            ],
            "fornecedores_gastos": [
                {"nome": nome, "valor": round(valor, 2)}
                for nome, valor in fornecedores.most_common(6)
            ],
            "historico_centro_custo": {
                "centro_custo": _cell(hist_cc.get("centroDeCustos", "")),
                "data_inicial": _cell(hist_cc.get("dataInicial", "")),
                "data_final": _cell(hist_cc.get("dataFinal", "")),
            } if hist_cc else {},
            "alertas": alertas,
            "fonte_url": fonte_url,
        })
    out.sort(key=lambda x: (-x["gastos_total"], x["placa"]))
    return out


def _normaliza_diarias_prefeitura(rows: list[dict], linked: dict) -> list[dict]:
    out = []
    for r in rows:
        credor_ref = (r.get("credor") or "").strip()
        credor = linked.get(credor_ref, {}) if credor_ref else {}
        valor = _f(r.get("valorPagoEmpenho") or r.get("valorEmpenho") or r.get("valorEmpenhado"))
        out.append({
            "poder": "Prefeitura",
            "ano": str(r.get("anoExercicio") or r.get("anoCadastro") or ""),
            "entidade": r.get("nomeEntidade", ""),
            "secretaria": r.get("descricaoOrgao", "") or r.get("descricaoUnidade", ""),
            "unidade": r.get("descricaoUnidade", ""),
            "funcionario": credor.get("nomeCredor", "") or credor_ref,
            "cpf": credor.get("cnpjCpfCredor", ""),
            "cargo": credor.get("naturezaJuridicaCredor", ""),
            "numero": r.get("numeroEmpenho", ""),
            "data_inicial": r.get("dataEmpenho", ""),
            "data_final": r.get("dataEmpenho", ""),
            "quantidade": 1,
            "valor_unitario": valor,
            "valor_total": valor,
            "destino": "",
            "finalidade": r.get("finalidade", "").strip() or r.get("descricaoProjetoAtividade", "").strip() or r.get("descricaoPrograma", "").strip(),
            "historico": r.get("descricaoElemento", "") or r.get("descricaoDetalhamentoElemento", ""),
            "fonte": "Betha Prefeitura - Diarias",
        })
    out.sort(key=lambda x: -x["valor_total"])
    return out


def _normaliza_diarias_camara(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        valor = _f(r.get("valorTotal"))
        qtd = _f(r.get("quantidade")) or 1
        out.append({
            "poder": "Câmara",
            "ano": str(r.get("ano") or ""),
            "entidade": r.get("nomeEntidade", ""),
            "secretaria": "Câmara Municipal",
            "unidade": "Câmara Municipal",
            "funcionario": r.get("credor", ""),
            "cpf": r.get("cnpjCpfCredor", ""),
            "cargo": r.get("cargoCredor", ""),
            "numero": r.get("numeroDiaria", ""),
            "data_inicial": r.get("dataInicial", ""),
            "data_final": r.get("dataFinal", ""),
            "quantidade": qtd,
            "valor_unitario": _f(r.get("valorUnitario")) or (valor / qtd if qtd else valor),
            "valor_total": valor,
            "destino": r.get("localDestino", ""),
            "origem": r.get("localOrigem", ""),
            "finalidade": r.get("finalidade", "").strip(),
            "historico": r.get("historico", "").strip(),
            "fonte": "Betha Câmara - Diarias de Viagem",
        })
    out.sort(key=lambda x: -x["valor_total"])
    return out


def _processa_diarias_betha() -> dict:
    print("⇣ Diárias — Prefeitura e Câmara (Betha)…")
    try:
        import coletor_betha as cb
    except ImportError as e:
        print(f"  ✗ módulo coletor_betha indisponível: {e}")
        return {"prefeitura": [], "camara": [], "erro": str(e)}

    ano_atual = dt.datetime.now().year
    anos = [ano_atual - 1, ano_atual]
    prefeitura = []
    camara = []

    try:
        tok_pref = cb.get_token()
        for ano in anos:
            res = cb.baixar_dados_abertos(tok_pref, cb.CONSULTA_DIARIAS, ano=ano)
            rows = _normaliza_diarias_prefeitura(res.get("main", []), res.get("linked", {}))
            prefeitura.extend(rows)
            print(f"  ✓ Prefeitura diárias {ano}: {len(rows)} registros")
    except Exception as e:
        print(f"  ✗ Prefeitura diárias: {e}")

    try:
        portal_camara = "-iAWLe1kr2VQcrW9k2AUBg=="
        tok_cam = cb.get_token(portal_hash=portal_camara)
        for ano in anos:
            res = cb.baixar_dados_abertos(tok_cam, 324755, ano=ano, portal_hash=portal_camara, ano_field="ano")
            rows = _normaliza_diarias_camara(res.get("main", []))
            camara.extend(rows)
            print(f"  ✓ Câmara diárias {ano}: {len(rows)} registros")
    except Exception as e:
        print(f"  ✗ Câmara diárias: {e}")

    def resumo(lista: list[dict]) -> dict:
        return {
            "registros": len(lista),
            "valor_total": round(sum(d.get("valor_total", 0) for d in lista), 2),
            "quantidade_total": round(sum(d.get("quantidade", 0) for d in lista), 2),
            "servidores": len({(d.get("funcionario") or "").upper() for d in lista if d.get("funcionario")}),
        }

    return {
        "anos": anos,
        "prefeitura": prefeitura,
        "camara": camara,
        "resumo": {
            "prefeitura": resumo(prefeitura),
            "camara": resumo(camara),
        },
        "fontes": {
            "prefeitura": "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83059",
            "camara": "https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324755",
        },
    }


# ----------------- main ------------------------------------------------- #

def main() -> int:
    print("\n=== Zela Varginha — Coletor ===\n")
    so_sapl   = "--so-sapl"   in sys.argv
    sem_betha = "--sem-betha" in sys.argv
    sem_pncp  = "--sem-pncp"  in sys.argv
    sem_camara_transp = "--sem-camara-transparencia" in sys.argv
    sem_cnpj  = "--sem-cnpj"  in sys.argv
    sem_pessoal = "--sem-pessoal" in sys.argv
    sem_fontes_emendas = "--sem-fontes-emendas" in sys.argv

    sapl = _processa_sapl()
    _enriquece_materias_cidadas(sapl.get("camara_anos", {}))
    _save("resumo.json", sapl["resumo"])
    _save("vereadores.json", sapl["vereadores"])
    _save("emendas.json", sapl["emendas"])
    _save("camara_anos.json", sapl.get("camara_anos", {}))

    diario = {"total": 0, "ultimas": []}
    if not so_sapl:
        diario = _processa_diario()
        _save("diario.json", diario)

    pncp = {}
    camara_transparencia = {}
    cnpjs = {}
    remuneracao_vereadores = _load_existing("remuneracao_vereadores.json", {})
    sancoes_fornecedores = _load_existing("sancoes_fornecedores.json", {})
    auditoria_dados = _load_existing("auditoria_dados.json", {})
    atualizacoes = _load_existing("atualizacoes.json", {})
    fontes_emendas_2026 = _load_existing("fontes_emendas_2026.json", {})
    indice_relevancia = _load_existing("indice_relevancia.json", {})
    if not so_sapl and not sem_pncp:
        pncp = _processa_pncp()
        _save("pncp.json", pncp)

    if not so_sapl and not sem_camara_transp:
        camara_transparencia = _processa_camara_transparencia()
        _save("camara_transparencia.json", camara_transparencia)

    if not so_sapl and not sem_cnpj:
        cnpjs = _processa_cnpj(sapl["emendas"])
        _save("cnpjs.json", cnpjs)

    pessoal = {}
    diarias = {}
    if not so_sapl and not sem_pessoal:
        pessoal = _processa_pessoal()
        _save("pessoal.json", pessoal)

        fontes_emendas_2026 = _processa_fontes_emendas_2026()
        _save("fontes_emendas_2026.json", fontes_emendas_2026)
    elif sem_pessoal:
        pessoal = _load_existing("pessoal.json", {})
        fontes_emendas_2026 = _load_existing("fontes_emendas_2026.json", fontes_emendas_2026)
        if pessoal:
            print("  ✓ pessoal.json existente preservado no data.js")

    diarias = {}
    if not so_sapl and not sem_betha:
        diarias = _processa_diarias_betha()
        # Guarda-chuva: se a coleta falhar por completo (ex.: navegador do
        # Playwright ausente, token Betha inacessivel), _processa_diarias_betha
        # devolve listas vazias sem levantar excecao — sem esta checagem o
        # _save gravava um diarias.json vazio por cima de milhares de
        # registros bons (ja aconteceu: 5709 registros -> 0 em producao).
        existente_diarias = _load_existing("diarias.json", {})
        for org in ("prefeitura", "camara"):
            novos = diarias.get(org, [])
            antigos = existente_diarias.get(org, []) if isinstance(existente_diarias, dict) else []
            if isinstance(antigos, list) and len(antigos) >= 50 and len(novos) == 0:
                diarias[org] = antigos
                antigo_resumo = (existente_diarias.get("resumo") or {}).get(org)
                if antigo_resumo:
                    diarias.setdefault("resumo", {})[org] = antigo_resumo
                print(f"  ! Diarias {org}: coleta vazia; preservando base anterior ({len(antigos)} registros)")
        if diarias.get("prefeitura") or diarias.get("camara"):
            _save("diarias.json", diarias)
        else:
            print("  ✗ Diarias: nada coletado e nada preservado — mantendo diarias.json existente intacto")

    federal = {}
    if not so_sapl:
        federal = _processa_federal()
        _save("federal.json", federal)
    else:
        federal = _load_existing("federal.json", {})

    prefeitura = {}
    camara_betha = {}
    fundacao_cultural = {}
    if not so_sapl and not sem_betha:
        # Fallback: se o SAPL retornou lista vazia (ex: timeout), usa emendas.json
        # salvo no disco para não quebrar o cruzamento com o Betha.
        emendas_para_cruzamento = sapl["emendas"]
        if not emendas_para_cruzamento:
            emendas_para_cruzamento = _load_existing("emendas.json", [])
            if emendas_para_cruzamento:
                print("  ℹ SAPL retornou emendas vazias — usando emendas.json do disco para cruzamento Betha.")
        prefeitura = _processa_prefeitura(emendas_para_cruzamento)
        if prefeitura:
            _save("prefeitura.json", prefeitura)

        camara_betha = _processa_camara_betha()
        if camara_betha:
            _save("camara_betha.json", camara_betha)

        fundacao_cultural = _processa_fundacao_cultural()
        if fundacao_cultural:
            _save("fundacao_cultural.json", fundacao_cultural)

        # Enriquece top fornecedores Betha (CNPJs mascarados → reconstruídos via raiz)
        if not sem_cnpj and prefeitura:
            top = prefeitura.get("top_fornecedores_atual", [])
            if top:
                try:
                    import coletor_cnpj
                    print("⇣ CNPJ — enriquecendo top fornecedores Betha (raiz→0001)…")
                    fornecedores = coletor_cnpj.coletar_fornecedores(top)
                    ok = sum(1 for f in fornecedores if "razao_social" in f)
                    print(f"  ✓ {ok}/{len(fornecedores)} fornecedores enriquecidos")
                    cnpjs["fornecedores"] = fornecedores
                    _save("cnpjs.json", cnpjs)
                except Exception as _e:
                    print(f"  ✗ enriquecimento fornecedores: {_e}")
    elif sem_betha:
        prefeitura = _load_existing("prefeitura.json", {})
        if prefeitura:
            print("  ✓ prefeitura.json existente preservado no data.js")
        camara_betha = _load_existing("camara_betha.json", {})
        if camara_betha:
            print("  ✓ camara_betha.json existente preservado no data.js")

        fundacao_cultural = _load_existing("fundacao_cultural.json", {})
        if fundacao_cultural:
            print("  ✓ fundacao_cultural.json existente preservado no data.js")

    if so_sapl:
        diario = _load_existing("diario.json", {"total": 0, "ultimas": []})
        pncp = _load_existing("pncp.json", {})
        camara_transparencia = _load_existing("camara_transparencia.json", {})
        cnpjs = _load_existing("cnpjs.json", {})
        pessoal = _load_existing("pessoal.json", {})
        fontes_emendas_2026 = _load_existing("fontes_emendas_2026.json", {})
        diarias = _load_existing("diarias.json", {})
        prefeitura = _load_existing("prefeitura.json", {})
        camara_betha = _load_existing("camara_betha.json", {})
        fundacao_cultural = _load_existing("fundacao_cultural.json", {})
        remuneracao_vereadores = _load_existing("remuneracao_vereadores.json", {})
        sancoes_fornecedores = _load_existing("sancoes_fornecedores.json", {})
        auditoria_dados = _load_existing("auditoria_dados.json", {})
        atualizacoes = _load_existing("atualizacoes.json", {})
        indice_relevancia = _load_existing("indice_relevancia.json", {})
        print("  bases existentes preservadas no data.js")

    atualizado = {
        "iso": dt.datetime.now().isoformat(timespec="seconds"),
        "data_humana": dt.datetime.now().strftime("%d/%m/%Y - %H:%M"),
    }
    _save("atualizado_em.json", atualizado)

    # Bundle único para o painel — funciona com duplo-clique (sem servidor).
    # Inclui pessoal slim no bundle: apenas resumo + servidores da Câmara.
    # Prefeitura.servidores (5000+ itens) fica só em pessoal.json para carga lazy.
    pessoal_slim = {}
    if isinstance(pessoal, dict):
        for org, val in pessoal.items():
            if not isinstance(val, dict):
                continue
            pessoal_slim[org] = {
                "resumo":  val.get("resumo", {}),
                "status":  val.get("status", ""),
                "fonte":   val.get("fonte", ""),
                "competencia": val.get("competencia", ""),
                # Câmara tem ~262 servidores (pequeno) — mantém para cross-ref.
                # Prefeitura tem ~5000 (grande) — carregado via fetch em pessoal.html.
                "servidores": val.get("servidores", []) if org == "camara" else [],
            }

    _save_data_js({
        "resumo": sapl["resumo"],
        "vereadores": sapl["vereadores"],
        "emendas": sapl["emendas"],
        "camara_anos": sapl.get("camara_anos", {}),
        "diario": diario,
        "prefeitura": prefeitura,
        "camara_betha": camara_betha,
        "fundacao_cultural": fundacao_cultural,
        "pncp": pncp,
        "camara_transparencia": camara_transparencia,
        "cnpjs": cnpjs,
        "pessoal": pessoal_slim,
        "diarias": diarias,
        "fontes_emendas_2026": fontes_emendas_2026,
        "federal": federal,
        "remuneracao_vereadores": remuneracao_vereadores,
        "sancoes_fornecedores": sancoes_fornecedores,
        "auditoria_dados": auditoria_dados,
        "atualizacoes": atualizacoes,
        "indice_relevancia": indice_relevancia,
        "atualizado_em": atualizado,
    })

    # Update/Write manifest.json
    chunks_dir = DATA / "chunks"
    chunks_dir.mkdir(exist_ok=True)
    manifest = {
        "gerado_em": dt.datetime.now().isoformat(timespec="seconds"),
        "chunks": {}
    }
    for chunk_file in chunks_dir.glob("*.json"):
        content = chunk_file.read_bytes()
        manifest["chunks"][chunk_file.stem] = {
            "arquivo": f"data/chunks/{chunk_file.name}",
            "bytes": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        }
    manifest_out = DATA / "manifest.json"
    manifest_out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  ✓ manifest.json  ({manifest_out.stat().st_size} bytes)")

    print("\n✓ Pronto. Abra index.html no navegador.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
