"""
Coletor de pessoal, comissionados e remuneracao.

Usa consultas Betha de dados abertos quando disponiveis. A Camara possui
consulta nominal de remuneracoes. A Prefeitura, na fonte aberta mapeada ate
agora, expoe remuneracoes da Educacao/FUNDEB; por isso o payload marca o
escopo como parcial em vez de fingir cobertura completa da folha.
"""
from __future__ import annotations

from collections import Counter
from html.parser import HTMLParser
import datetime as dt
import html
import json
import re
import urllib.request

import coletor_betha as betha

CAMARA_REMUNERACAO_URL = "https://portaltransparencia.app.br/servidoresMunicipal.aspx?p_i=59&p_t=1&t="
CAMARA_PORTAL_HASH = "-iAWLe1kr2VQcrW9k2AUBg=="
CAMARA_BETHA_URL = "https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324807"
CAMARA_REMUNERACOES_ID = 324807

PREFEITURA_EDUCACAO_REMUNERACOES_ID = 82991
PREFEITURA_EDUCACAO_URL = "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/82991"
PREFEITURA_BETHA_URL = "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA=="

# Folha COMPLETA da Prefeitura (todas as secretarias). Consulta sem dados
# abertos (CSV); baixada via busca-textual filtrando a competencia mais
# recente — body {"competencia": ["MM/AAAA"]}.
PREFEITURA_FOLHA_COMPLETA_ID = 97583
PREFEITURA_FOLHA_COMPLETA_URL = "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/97583"


def _br_money(value: str) -> float:
    if not value:
        return 0.0
    value = str(value).strip()
    if "," in value:
        value = value.replace(".", "").replace(",", ".")
    try:
        return float(value)
    except ValueError:
        return 0.0


def _clean(text: str) -> str:
    text = html.unescape(re.sub(r"<br\s*/?>", "\n", text, flags=re.I))
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"[ \t\r\f\v]+", " ", text).strip()


class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows: list[list[str]] = []
        self._in_tr = False
        self._in_cell = False
        self._cell_parts: list[str] = []
        self._row: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "tr":
            self._in_tr = True
            self._row = []
        elif self._in_tr and tag.lower() in ("td", "th"):
            self._in_cell = True
            self._cell_parts = []
        elif self._in_cell and tag.lower() == "br":
            self._cell_parts.append("\n")

    def handle_data(self, data):
        if self._in_cell:
            self._cell_parts.append(data)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self._in_cell and tag in ("td", "th"):
            self._row.append(_clean(" ".join(self._cell_parts)))
            self._in_cell = False
            self._cell_parts = []
        elif self._in_tr and tag == "tr":
            if self._row:
                self.rows.append(self._row)
            self._in_tr = False


def _get_text(url: str, timeout: int = 35) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "FiscalizaVarginha/1.0 (controle-social)"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def _parse_camara_html(html_text: str) -> list[dict]:
    parser = _TableParser()
    parser.feed(html_text)
    servidores = []
    for row in parser.rows:
        if len(row) < 4:
            continue
        ano, pessoa, remuneracao, lotacao = row[:4]
        if not re.search(r"\b20\d{2}\b", ano):
            continue
        matricula = re.search(r"Matr[íi]cula:\s*([0-9]+)", pessoa, re.I)
        nome = re.sub(r"Matr[íi]cula:\s*[0-9]+", "", pessoa, flags=re.I)
        nome = re.sub(r"CPF:\s*[\d\.\*\-]+", "", nome, flags=re.I).strip()
        venc = re.search(r"Vencimentos:\s*R\$\s*([\d\.,]+)", remuneracao, re.I)
        desc = re.search(r"Desconto:\s*R\$\s*([\d\.,]+)", remuneracao, re.I)
        liq = re.search(r"L[íi]quido:\s*R\$\s*([\d\.,]+)", remuneracao, re.I)
        servidores.append({
            "ano": int(re.search(r"\b20\d{2}\b", ano).group(0)),
            "matricula": matricula.group(1) if matricula else "",
            "nome": nome,
            "cargo": "",
            "lotacao": lotacao,
            "vinculo": "",
            "vencimentos": _br_money(venc.group(1) if venc else ""),
            "descontos": _br_money(desc.group(1) if desc else ""),
            "liquido": _br_money(liq.group(1) if liq else ""),
            "comissionado_ou_similar": "COMISSION" in lotacao.upper(),
            "escopo": "Folha nominal da Camara",
        })
    return servidores


def _is_comissionado(row: dict) -> bool:
    texto = " ".join(str(row.get(k, "")) for k in [
        "cargoAtual", "classificacaoCargoAtual", "tipoMatricula",
        "vinculoEmpregaticio", "lotacao", "organograma",
        "efetivoEmCargoComissionado",
    ]).upper()
    return "COMISSION" in texto or "AMPLO" in texto


def _normaliza_betha(rows: list[dict], orgao: str, escopo: str) -> list[dict]:
    servidores = []
    for r in rows:
        cargo = r.get("cargoAtual", "")
        lotacao = r.get("lotacao", "") or r.get("organograma", "") or r.get("orgao", "")
        vinculo = r.get("vinculoEmpregaticio", "") or r.get("tipoMatricula", "")
        servidores.append({
            "ano": int(r.get("ano") or dt.datetime.now().year),
            "matricula": r.get("matriculaServidor", ""),
            "nome": r.get("nomeServidor", ""),
            "cargo": cargo,
            "lotacao": " - ".join(x for x in [cargo, lotacao] if x),
            "vinculo": vinculo,
            "vencimentos": _br_money(str(r.get("valorRemuneracaoBruta") or r.get("valorRemuneracaoContratual") or "0")),
            "descontos": 0,
            "liquido": _br_money(str(r.get("valorRemuneracaoLiquida") or "0")),
            "comissionado_ou_similar": _is_comissionado(r),
            "orgao_fonte": orgao,
            "escopo": escopo,
        })
    return servidores


def _ordem_comp(comp: str) -> str:
    """MM/AAAA -> AAAAMM, para ordenar competencia como texto."""
    c = str(comp or "")
    return c[3:7] + c[0:2] if len(c) == 7 else ""


def _competencia_referencia(servidores: list[dict]):
    """Escolhe a competencia que representa UM mes de folha.

    A consulta da Camara devolve uma linha por servidor POR MES (388 linhas para
    ~70 pessoas, cobrindo 7 competencias). Somar tudo da o custo de sete meses e
    contar linhas infla o numero de servidores em 5x.

    A competencia mais recente tambem nao serve de referencia: costuma vir
    parcial, com a folha do mes ainda em processamento ou so lancamentos de
    ferias e 13o (em 07/2026 eram 7 linhas de 65).

    Regra: entre as competencias com pelo menos 80% da maior cobertura, fica com
    a mais recente. Devolve (referencia, parcial_descartada).
    """
    cont = Counter(s.get("competencia") for s in servidores if s.get("competencia"))
    if not cont:
        return None, None
    maior = max(cont.values())
    completas = [c for c, n in cont.items() if n >= 0.8 * maior]
    ref = max(completas, key=_ordem_comp)
    recente = max(cont, key=_ordem_comp)
    parcial = (recente, cont[recente]) if recente != ref else None
    return ref, parcial


def _resumo(nome: str, servidores: list[dict], competencia_unica: str | None = None) -> dict:
    """Resume UM mes de folha.

    `competencia_unica` e a garantia do chamador de que as linhas ja vem de uma
    unica competencia — a consulta da folha completa filtra o mes na origem.
    So nesse caso cada linha e um VINCULO, e nao a repeticao do mesmo servidor
    em outros meses: a mesma pessoa pode ser estagiaria em duas lotacoes e
    efetiva numa terceira, e ali somar as linhas e o correto.

    Sem essa garantia e sem competencia carimbada na linha nao da para saber
    quantos meses estao no array. Antes daqui o resumo somava tudo assim mesmo,
    e a folha da Prefeitura pelo escopo Educacao/FUNDEB (consulta por ANO, nao
    por competencia) virou R$ 914 mi de "folha mensal" com 303.818 "servidores".
    Agora os campos mensais saem nulos e o painel publica a limitacao em vez de
    um numero que nao consegue defender.
    """
    if competencia_unica:
        ref, parcial = competencia_unica, None
        linhas = list(servidores)
    else:
        ref, parcial = _competencia_referencia(servidores)
        linhas = [s for s in servidores if s.get("competencia") == ref] if ref else None

    if linhas is None:
        return {
            "orgao": nome,
            "competencia_referencia": None,
            "competencia_indeterminada": True,
            "servidores_qtd": None,
            "vinculos_qtd": None,
            "pessoas_qtd": None,
            "linhas_todas_competencias": len(servidores),
            "comissionados_qtd": None,
            "folha_bruta_total": None,
            "folha_bruta_comissionados": None,
            "maior_vencimento_comissionado": None,
        }

    # A fonte não publica CPF ou outro identificador civil. Para não chamar dois
    # vínculos da mesma pessoa de duas pessoas, a melhor aproximação disponível
    # é o nome normalizado; matrícula identifica o vínculo, não necessariamente
    # a pessoa. Se o nome vier vazio, usa matrícula e, em último caso, a linha.
    pessoas = set()
    for idx, s in enumerate(linhas):
        nome_pessoa = (s.get("nome") or "").strip().upper()
        matricula = str(s.get("matricula") or "").strip()
        chave = ("nome", nome_pessoa) if nome_pessoa else (
            ("matricula", matricula) if matricula else ("linha", idx)
        )
        pessoas.add(chave)
    comissionados = [s for s in linhas if s.get("comissionado_ou_similar")]
    todos_venc = sum(float(s.get("vencimentos") or 0) for s in linhas)
    com_venc = sum(float(s.get("vencimentos") or 0) for s in comissionados)

    resumo = {
        "orgao": nome,
        "competencia_referencia": ref,
        # servidores_qtd e vinculos_qtd sao o mesmo numero: vinculos ativos na
        # competencia. pessoas_qtd aproxima pessoas distintas pelo nome, pois a
        # fonte nao oferece identificador civil unico.
        "servidores_qtd": len(linhas),
        "vinculos_qtd": len(linhas),
        "pessoas_qtd": len(pessoas),
        "linhas_todas_competencias": len(servidores),
        "comissionados_qtd": len(comissionados),
        "folha_bruta_total": round(todos_venc, 2),
        "folha_bruta_comissionados": round(com_venc, 2),
        "maior_vencimento_comissionado": round(max([float(s.get("vencimentos") or 0) for s in comissionados] or [0]), 2),
    }
    if parcial:
        resumo["competencia_parcial"] = {"competencia": parcial[0], "linhas": parcial[1]}
    return resumo


def _coletar_camara_betha(ano: int) -> list[dict]:
    token = betha.get_token(portal_hash=CAMARA_PORTAL_HASH)
    res = betha.baixar_dados_abertos(
        token,
        CAMARA_REMUNERACOES_ID,
        ano=ano,
        portal_hash=CAMARA_PORTAL_HASH,
        ano_field="ano",
    )
    rows = res.get("main", [])
    servidores = _normaliza_betha(rows, "Camara", "Folha nominal da Camara")
    # A consulta da Camara traz UMA linha por servidor/mes, mas a competencia
    # mora no CSV linkado (processamentos_*.csv, campo 'competencia' AAAA-MM,
    # com descricao Mensal/Ferias/13o). Sem ela o painel escolhia o "mes mais
    # recente" pela ordem das linhas — chute — e nao exibia referencia.
    linked_rows = res.get("linked_rows") or {}
    for s, r in zip(servidores, rows):
        ref = str(r.get("processamentos") or "").strip()
        procs = linked_rows.get(ref) or []
        comps = sorted({str(p.get("competencia") or "") for p in procs
                        if str(p.get("competencia") or "").strip()})
        if comps:
            ult = comps[-1]  # 'AAAA-MM'
            s["competencia"] = f"{ult[5:7]}/{ult[0:4]}"
        tipos = sorted({str(p.get("descricao") or "").strip() for p in procs
                        if str(p.get("descricao") or "").strip()})
        if tipos:
            s["tipos_folha"] = tipos[:4]
    return servidores


def _coletar_prefeitura_educacao_betha(ano: int) -> list[dict]:
    token = betha.get_token()
    res = betha.baixar_dados_abertos(
        token,
        PREFEITURA_EDUCACAO_REMUNERACOES_ID,
        ano=ano,
        ano_field="ano",
    )
    return _normaliza_betha(res.get("main", []), "Prefeitura", "Educacao/FUNDEB")


def _competencia_anterior(comp: str) -> str:
    """'06/2026' -> '05/2026'. Retorna '' se o formato nao for MM/AAAA."""
    try:
        mes, ano = comp.split("/")
        mes, ano = int(mes), int(ano)
    except Exception:
        return ""
    mes -= 1
    if mes == 0:
        mes, ano = 12, ano - 1
    return f"{mes:02d}/{ano}"


def _coletar_prefeitura_folha_completa() -> tuple[list[dict], str]:
    """Folha completa da Prefeitura (todas as secretarias) na competencia
    completa mais recente. Retorna (servidores, competencia)."""
    token = betha.get_token()
    comp = betha.filtro_max(token, PREFEITURA_FOLHA_COMPLETA_ID, "competencia")
    if not comp:
        raise RuntimeError("Nao foi possivel descobrir a competencia mais recente da folha.")
    # A competencia mais recente costuma vir incompleta (folha do mes ainda nao
    # publicada — vinha so 2 registros). Recua mes a mes ate achar um mes com a
    # folha completa (~4 mil servidores).
    rows: list[dict] = []
    for _ in range(4):
        rows = betha.baixar_busca_textual(
            token,
            PREFEITURA_FOLHA_COMPLETA_ID,
            body={"competencia": [comp]},
            sort_by="nomeServidor",
        )
        if len(rows) >= 500:
            break
        anterior = _competencia_anterior(comp)
        if not anterior:
            break
        print(f"  ! Folha {comp}: so {len(rows)} registro(s); tentando competencia anterior {anterior}…")
        comp = anterior
    escopo = f"Folha completa da Prefeitura (competencia {comp})"
    servidores = _normaliza_betha(rows, "Prefeitura", escopo)
    # campo extra: secretaria de origem (ajuda filtros futuros no painel)
    for s, r in zip(servidores, rows):
        s["orgao"] = r.get("orgao", "")
        # A consulta filtra o mes na origem, entao a linha nao vem carimbada.
        # Carimbar aqui e o que torna cada linha auto-explicativa: linha de
        # salario sem mes foi exatamente o que deixou somar 28 meses e publicar
        # R$ 914 mi como folha mensal. Quem reprocessar este chunk depois nao
        # depende de saber que a consulta era de um mes so.
        s["competencia"] = comp
    return servidores, comp


def coletar() -> dict:
    ano = dt.datetime.now().year
    payload = {
        "fonte": "Remuneracao de servidores e comissionados",
        "ano_referencia": ano,
        "camara": {
            "fonte": CAMARA_BETHA_URL,
            "betha": CAMARA_BETHA_URL,
            "servidores": [],
            "resumo": _resumo("Camara", []),
        },
        "prefeitura": {
            "fonte": PREFEITURA_EDUCACAO_URL,
            "portal_geral": PREFEITURA_BETHA_URL,
            "servidores": [],
            "resumo": _resumo("Prefeitura", []),
            "status": "Coleta parcial: remuneracoes abertas da Educacao/FUNDEB. A folha geral da Prefeitura ainda precisa de consulta oficial aberta equivalente.",
        },
        "observacao": "Valores sao remuneracao bruta/vencimentos informados na fonte publica. Conferir mes de referencia no portal oficial. Prefeitura esta com escopo parcial de Educacao/FUNDEB.",
    }

    try:
        servidores = _coletar_camara_betha(ano)
        payload["camara"]["servidores"] = servidores
        resumo_cam = _resumo("Camara", servidores)
        payload["camara"]["resumo"] = resumo_cam
        # A competencia do orgao tem que ser a MESMA que o resumo somou, senao o
        # painel carimba "julho" num valor de junho. Antes daqui saia o mes mais
        # recente, que costuma vir parcial e nao corresponde ao total exibido.
        ref = resumo_cam.get("competencia_referencia")
        if ref:
            payload["camara"]["competencia"] = ref
            payload["camara"]["status"] = (
                f"Coletado automaticamente via Betha (competencia {ref})"
            )
        else:
            # Sem o CSV de processamentos nao da para dizer de que mes e a folha,
            # e o resumo ja veio com os totais mensais nulos. O status precisa
            # dizer isso, senao a pagina mostra numero vazio sem explicacao.
            payload["camara"]["status"] = (
                "Coletado automaticamente via Betha, mas a competencia de cada linha nao "
                "veio na fonte: mes de referencia e totais mensais ficam indisponiveis."
            )
    except Exception as e:
        try:
            servidores = _parse_camara_html(_get_text(CAMARA_REMUNERACAO_URL))
            payload["camara"]["servidores"] = servidores
            payload["camara"]["resumo"] = _resumo("Camara", servidores)
            payload["camara"]["status"] = "Coletado automaticamente via fonte alternativa"
        except Exception as e2:
            payload["camara"]["erro"] = f"Betha: {e}; alternativa: {e2}"
            payload["camara"]["status"] = "Falha na coleta automatica"

    # 1a opcao: folha completa (todas as secretarias, competencia mais recente)
    try:
        servidores, comp = _coletar_prefeitura_folha_completa()
        payload["prefeitura"]["servidores"] = servidores
        payload["prefeitura"]["resumo"] = _resumo("Prefeitura", servidores, competencia_unica=comp)
        payload["prefeitura"]["fonte"] = PREFEITURA_FOLHA_COMPLETA_URL
        payload["prefeitura"]["competencia"] = comp
        payload["prefeitura"]["status"] = f"Coletado automaticamente via Betha (folha completa, competencia {comp})"
        payload["observacao"] = (
            f"Valores sao remuneracao bruta informada na fonte publica, competencia {comp} "
            "para a Prefeitura (folha completa, todas as secretarias). Camara segue folha "
            "nominal propria. Conferir mes de referencia no portal oficial."
        )
    except Exception as e:
        # fallback: escopo parcial Educacao/FUNDEB (consulta antiga)
        try:
            servidores = _coletar_prefeitura_educacao_betha(ano)
            payload["prefeitura"]["servidores"] = servidores
            resumo_pref = _resumo("Prefeitura", servidores)
            payload["prefeitura"]["resumo"] = resumo_pref
            if resumo_pref.get("competencia_indeterminada"):
                payload["prefeitura"]["status"] = (
                    "Coletado automaticamente via Betha (escopo Educacao/FUNDEB, consulta por ano): "
                    "a fonte nao carimba a competencia na linha, entao o mes de referencia e os "
                    "totais mensais ficam indisponiveis."
                )
            else:
                payload["prefeitura"]["competencia"] = resumo_pref["competencia_referencia"]
                payload["prefeitura"]["status"] = (
                    "Coletado automaticamente via Betha (escopo Educacao/FUNDEB, competencia "
                    f"{resumo_pref['competencia_referencia']})"
                )
            payload["prefeitura"]["erro_folha_completa"] = str(e)
        except Exception as e2:
            payload["prefeitura"]["erro"] = f"folha completa: {e}; educacao: {e2}"

    return payload


if __name__ == "__main__":
    print(json.dumps(coletar(), ensure_ascii=False, indent=2))
