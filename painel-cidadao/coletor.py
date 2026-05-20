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
    r"C:/Users/Desktop/Desktop/Camara De Varginha/Ano 2025/sapl_pesquisar_materia (2).csv"
)
JSON_SAPL_2026 = Path(
    r"C:/Users/Desktop/Desktop/Camara De Varginha/Ano 2026/sapl_pesquisar_materia.json"
)

DIARIO_URLS = {
    2025: "https://www.varginha.mg.gov.br/portal/dados-abertos/diario-oficial/2025",
    2026: "https://www.varginha.mg.gov.br/portal/dados-abertos/diario-oficial/2026",
}

# ----------------------------- helpers --------------------------------- #

def _save(name: str, payload) -> None:
    out = DATA / name
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  ✓ {name}  ({out.stat().st_size // 1024} KB)")


def _load_existing(name: str, default):
    path = DATA / name
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


def _linha_padrao_sapl(r: dict) -> dict:
    return {
        "ano": r.get("Ano") or r.get("ano") or "",
        "numero": r.get("NÃºmero") or r.get("Número") or r.get("numero") or "",
        "tipo_sigla": r.get("Tipo de MatÃ©ria Legislativa/Sigla") or r.get("Tipo de Matéria Legislativa/Sigla") or r.get("tipo__sigla") or "",
        "tipo_descricao": r.get("Tipo de MatÃ©ria Legislativa/DescriÃ§Ã£o") or r.get("Tipo de Matéria Legislativa/Descrição") or r.get("tipo__descricao") or "",
        "autoria": r.get("Autorias") or r.get("autoria") or "",
        "texto_original": r.get("Texto Original") or r.get("texto_original") or "",
        "ementa": r.get("Ementa") or r.get("ementa") or "",
    }


def _load_sapl_rows(path: Path) -> list[dict]:
    if not path.exists():
        print(f"  ! Arquivo SAPL nao encontrado: {path}")
        return []
    if path.suffix.lower() == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        return [_linha_padrao_sapl(r) for r in payload.get("results", [])]
    with path.open(encoding="utf-8") as f:
        return [_linha_padrao_sapl(r) for r in csv.DictReader(f, delimiter=";")]


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


def _processa_sapl_rows(ano: int, rows: list[dict]) -> dict:
    tipos = Counter(r["tipo_descricao"] for r in rows)
    ver_tipo: dict[str, Counter] = defaultdict(Counter)
    ver_zero: dict[str, Counter] = defaultdict(Counter)
    materias = []

    for r in rows:
        tipo = r["tipo_descricao"]
        zero, motivo = _impacto_zero(tipo, r["ementa"])
        materia = {
            "ano": r["ano"],
            "numero": r["numero"],
            "tipo": tipo,
            "sigla": r["tipo_sigla"],
            "autor": r["autoria"],
            "pdf": r["texto_original"],
            "ementa": r["ementa"],
            "impacto_zero": zero,
            "motivo_impacto_zero": motivo,
        }
        materias.append(materia)
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
            "projetos_lei": 0, "emendas": 0, "mocoes": 0, "pdl": 0,
            "impacto_zero": 0, "nome_rua": 0, "homenagens_terceiros": 0,
            "outros": 0,
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
        "vereadores_ativos": len(vereadores),
        "emendas_qtd": len(emendas),
        "emendas_valor_total_brl": round(valor_total, 2),
        "impacto_zero_qtd": sum(1 for m in materias if m["impacto_zero"]),
        "tipos": [{"tipo": k, "qtd": v} for k, v in tipos.most_common()],
        "temas_top": temas,
    }
    return {"resumo": resumo, "vereadores": vereadores, "emendas": emendas, "materias": materias}

EXCLUI_AUTOR = {
    "Mesa Diretora - MDIR",
    "Tribunal de Contas de MG - TCEMG",
    "Legislação e Redação Final",
}

PARLAMENTARES_DISPLAY = [
        "Zilda Silva", "Alexandre Prado", "Ana Rios Fontoura", "Dandan",
        "Davi Martins", "Rogerio Bueno", "Rogério Bueno",
        "Joaozinho Enfermeiro", "Joãozinho Enfermeiro", "Ze Morais",
        "Zé Morais", "Dudu Ottoni", "Bruno Leandro Coletor",
        "Pastor Faustinho", "Thulyo Paiva", "Marquinho da Cooperativa",
        "Cassio Chiodi", "Cássio Chiodi", "Miguel da Saude",
        "Miguel da Saúde", "Dr. Guedes", "Dr. Lucas",
]
PARLAMENTARES_MONITORADOS = {_norm_txt(n) for n in PARLAMENTARES_DISPLAY}

def _parse_emenda(ementa: str) -> dict:
    """Extrai campos estruturados de uma ementa de emenda impositiva."""
    def grab(label: str) -> str:
        m = re.search(rf"{label}\s*:\s*(.+?)(?:\n|$)", ementa, re.IGNORECASE)
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
    with CSV_SAPL.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter=";"))
    print(f"  {len(rows)} matérias carregadas.")

    tipos = Counter(r["Tipo de Matéria Legislativa/Descrição"] for r in rows)

    # Por vereador
    ver_tipo: dict[str, Counter] = defaultdict(Counter)
    for r in rows:
        tipo = r["Tipo de Matéria Legislativa/Descrição"]
        for nome in (x.strip() for x in r["Autorias"].split(",")):
            if (
                not nome
                or nome in EXCLUI_AUTOR
                or "Comissão" in nome
                or nome.startswith("CJUS")
                or nome.startswith("CFIN")
            ):
                continue
            ver_tipo[nome][tipo] += 1

    vereadores = []
    for nome, c in sorted(ver_tipo.items(), key=lambda x: -sum(x[1].values())):
        vereadores.append({
            "nome": nome,
            "total": sum(c.values()),
            "indicacoes": c.get("Indicação", 0),
            "requerimentos": c.get("Requerimento", 0),
            "projetos_lei": c.get("Projeto de Lei Ordinária do Legislativo", 0),
            "emendas": c.get("Emenda Impositiva ao Orçamento", 0),
            "mocoes": c.get("Moção", 0),
            "outros": sum(v for k, v in c.items() if k not in {
                "Indicação", "Requerimento",
                "Projeto de Lei Ordinária do Legislativo",
                "Emenda Impositiva ao Orçamento", "Moção"
            }),
        })

    # Emendas detalhadas
    emendas_raw = [r for r in rows if r["Tipo de Matéria Legislativa/Descrição"] == "Emenda Impositiva ao Orçamento"]
    emendas = []
    valor_total = 0.0
    for r in emendas_raw:
        parsed = _parse_emenda(r["Ementa"])
        valor_total += parsed["valor_brl"]
        emendas.append({
            "ano": r["Ano"],
            "numero": r["Número"],
            "autor": r["Autorias"],
            "pdf": r["Texto Original"],
            **parsed,
        })

    # Top temas (palavras‐chave nas ementas)
    texto_all = " ".join(r["Ementa"].lower() for r in rows)
    palavras = [
        "saúde", "educação", "segurança", "iluminação", "asfalto",
        "pavimentação", "transporte", "criança", "idoso", "mulher",
        "animal", "meio ambiente", "cultura", "esporte", "praça",
    ]
    temas = [{"tema": p, "mencoes": texto_all.count(p)} for p in palavras]
    temas.sort(key=lambda x: -x["mencoes"])

    resumo = {
        "total_materias": len(rows),
        "vereadores_ativos": len(vereadores),
        "emendas_qtd": len(emendas),
        "emendas_valor_total_brl": round(valor_total, 2),
        "tipos": [
            {"tipo": k, "qtd": v}
            for k, v in tipos.most_common()
        ],
        "temas_top": temas,
    }

    ano_2025 = _processa_sapl_rows(2025, [_linha_padrao_sapl(r) for r in rows])
    camara_anos = {"2025": ano_2025}
    rows_2026 = _load_sapl_rows(JSON_SAPL_2026)
    if rows_2026:
        camara_anos["2026"] = _processa_sapl_rows(2026, rows_2026)
        print(f"  {len(rows_2026)} materias de 2026 carregadas.")

    return {
        "resumo": ano_2025["resumo"],
        "vereadores": ano_2025["vereadores"],
        "emendas": ano_2025["emendas"],
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
                edicoes_all.append({
                    "ano": ano,
                    "edicao": ed,
                    "data": d.get("data") or d.get("Data") or "",
                    "extra": (d.get("edicaoExtra") or d.get("EdicaoExtra") or "N") == "S",
                    "url_pdf": (
                        f"https://www.varginha.mg.gov.br/portal/diario-oficial/ver/{ano}/{ed}"
                        if ed else ""
                    ),
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
    try:
        import coletor_federal
        payload = coletor_federal.coletar()
        print(f"  ✓ {len(payload.get('links_auditoria', []))} trilhas de auditoria federais mapeadas")
        return payload
    except Exception as e:
        print(f"  ✗ Federal: {e}")
        return {"fonte": "Federal", "erro": str(e), "links_auditoria": []}


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
        g = grupos[nome.upper()]
        g["nome"] = nome
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

    print(f"  Cruzamento: {com_pagamento} com pagamento, "
          f"{sem_pagamento} sem encontrar pagamento, {sem_cnpj} sem CNPJ")

    # ===== Dados Abertos (Onda 3): contratos, licitações, compras diretas =====
    contratos       = _baixar_dados_abertos_safe(cb, token, "Contratos",               cb.CONSULTA_CONTRATOS,          ano_atual)
    contratos_ant   = _baixar_dados_abertos_safe(cb, token, "Contratos (ano anterior)", cb.CONSULTA_CONTRATOS,          ano_atual - 1)
    contratos      += contratos_ant  # junta os 2 anos pra ter base mais rica
    licit_andamento = _baixar_dados_abertos_safe(cb, token, "Licitações em andamento", cb.CONSULTA_LICITACOES_ABERTAS, ano_atual)
    licit_finaliz   = _baixar_dados_abertos_safe(cb, token, "Licitações finalizadas",  cb.CONSULTA_LICITACOES_FECHADAS, ano_atual)
    compras_diretas = _baixar_dados_abertos_safe(cb, token, "Compras diretas",         cb.CONSULTA_COMPRAS_DIRETAS,    ano_atual - 1)

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
            "com_pagamento":  com_pagamento,
            "sem_pagamento":  sem_pagamento,
            "sem_cnpj":       sem_cnpj,
        },
        "contratos":        _normaliza_contratos(contratos),
        "licit_andamento":  _normaliza_licitacoes(licit_andamento),
        "licit_finalizadas": _normaliza_licitacoes(licit_finaliz),
        "compras_diretas":  _normaliza_compras(compras_diretas),
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


# Os CSVs Betha vêm com colunas diferentes por consulta. Normalizamos para o
# painel só os campos relevantes ao cidadão.

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

    diarias = {}
    if not so_sapl and not sem_betha:
        diarias = _processa_diarias_betha()
        _save("diarias.json", diarias)

    federal = _processa_federal()
    _save("federal.json", federal)

    prefeitura = {}
    camara_betha = {}
    if not so_sapl and not sem_betha:
        prefeitura = _processa_prefeitura(sapl["emendas"])
        if prefeitura:
            _save("prefeitura.json", prefeitura)

        camara_betha = _processa_camara_betha()
        if camara_betha:
            _save("camara_betha.json", camara_betha)
    elif sem_betha:
        prefeitura = _load_existing("prefeitura.json", {})
        if prefeitura:
            print("  ✓ prefeitura.json existente preservado no data.js")
        camara_betha = _load_existing("camara_betha.json", {})
        if camara_betha:
            print("  ✓ camara_betha.json existente preservado no data.js")

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
        "pncp": pncp,
        "camara_transparencia": camara_transparencia,
        "cnpjs": cnpjs,
        "pessoal": pessoal_slim,
        "diarias": diarias,
        "fontes_emendas_2026": fontes_emendas_2026,
        "federal": federal,
        "atualizado_em": atualizado,
    })

    print("\n✓ Pronto. Abra index.html no navegador.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
