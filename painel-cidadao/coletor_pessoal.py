"""
Coletor de pessoal, comissionados e remuneracao.

Usa consultas Betha de dados abertos quando disponiveis. A Camara possui
consulta nominal de remuneracoes. A Prefeitura, na fonte aberta mapeada ate
agora, expoe remuneracoes da Educacao/FUNDEB; por isso o payload marca o
escopo como parcial em vez de fingir cobertura completa da folha.
"""
from __future__ import annotations

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
        headers={"User-Agent": "ZelaVarginha/1.0 (controle-social)"},
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


def _resumo(nome: str, servidores: list[dict]) -> dict:
    comissionados = [s for s in servidores if s.get("comissionado_ou_similar")]
    todos_venc = sum(float(s.get("vencimentos") or 0) for s in servidores)
    com_venc = sum(float(s.get("vencimentos") or 0) for s in comissionados)
    return {
        "orgao": nome,
        "servidores_qtd": len(servidores),
        "comissionados_qtd": len(comissionados),
        "folha_bruta_total": round(todos_venc, 2),
        "folha_bruta_comissionados": round(com_venc, 2),
        "maior_vencimento_comissionado": round(max([float(s.get("vencimentos") or 0) for s in comissionados] or [0]), 2),
    }


def _coletar_camara_betha(ano: int) -> list[dict]:
    token = betha.get_token(portal_hash=CAMARA_PORTAL_HASH)
    res = betha.baixar_dados_abertos(
        token,
        CAMARA_REMUNERACOES_ID,
        ano=ano,
        portal_hash=CAMARA_PORTAL_HASH,
        ano_field="ano",
    )
    return _normaliza_betha(res.get("main", []), "Camara", "Folha nominal da Camara")


def _coletar_prefeitura_educacao_betha(ano: int) -> list[dict]:
    token = betha.get_token()
    res = betha.baixar_dados_abertos(
        token,
        PREFEITURA_EDUCACAO_REMUNERACOES_ID,
        ano=ano,
        ano_field="ano",
    )
    return _normaliza_betha(res.get("main", []), "Prefeitura", "Educacao/FUNDEB")


def _coletar_prefeitura_folha_completa() -> tuple[list[dict], str]:
    """Folha completa da Prefeitura (todas as secretarias) na competencia
    mais recente. Retorna (servidores, competencia)."""
    token = betha.get_token()
    comp = betha.filtro_max(token, PREFEITURA_FOLHA_COMPLETA_ID, "competencia")
    if not comp:
        raise RuntimeError("Nao foi possivel descobrir a competencia mais recente da folha.")
    rows = betha.baixar_busca_textual(
        token,
        PREFEITURA_FOLHA_COMPLETA_ID,
        body={"competencia": [comp]},
        sort_by="nomeServidor",
    )
    escopo = f"Folha completa da Prefeitura (competencia {comp})"
    servidores = _normaliza_betha(rows, "Prefeitura", escopo)
    # campo extra: secretaria de origem (ajuda filtros futuros no painel)
    for s, r in zip(servidores, rows):
        s["orgao"] = r.get("orgao", "")
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
        payload["camara"]["resumo"] = _resumo("Camara", servidores)
        payload["camara"]["status"] = "Coletado automaticamente via Betha"
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
        payload["prefeitura"]["resumo"] = _resumo("Prefeitura", servidores)
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
            payload["prefeitura"]["resumo"] = _resumo("Prefeitura", servidores)
            payload["prefeitura"]["status"] = "Coletado automaticamente via Betha (escopo Educacao/FUNDEB)"
            payload["prefeitura"]["erro_folha_completa"] = str(e)
        except Exception as e2:
            payload["prefeitura"]["erro"] = f"folha completa: {e}; educacao: {e2}"

    return payload


if __name__ == "__main__":
    print(json.dumps(coletar(), ensure_ascii=False, indent=2))
