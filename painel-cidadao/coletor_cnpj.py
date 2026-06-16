"""
Coletor de dados cadastrais públicos de CNPJ.

Consulta apenas CNPJs completos já presentes nas emendas, em pequeno volume, e
usa os dados como apoio de conferência. Fornecedores da Prefeitura aparecem
mascarados no Betha, então não são consultados nesta etapa.
"""
from __future__ import annotations

import json
import re
import time
import urllib.request

# Fontes públicas com schemas distintos; tentadas em ordem. Se a primeira
# falhar (timeout, rate-limit, WinError 10060), cai para a próxima.
FONTES_CNPJ = [
    ("brasilapi", "https://brasilapi.com.br/api/cnpj/v1/{cnpj}"),
    ("cnpj.ws",   "https://publica.cnpj.ws/cnpj/{cnpj}"),
]


def _digits(cnpj: str) -> str:
    return re.sub(r"\D", "", cnpj or "")


def _get_json(url: str, timeout: int = 30, tentativas: int = 3):
    """GET JSON com retry e backoff exponencial — sobrevive a timeout transitório."""
    erro = None
    for i in range(tentativas):
        try:
            req = urllib.request.Request(
                url,
                headers={"Accept": "application/json", "User-Agent": "FiscalizaVarginha/1.0 (controle-social)"},
            )
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", errors="replace"))
        except Exception as e:  # noqa: BLE001 — relança após esgotar tentativas
            erro = e
            if i < tentativas - 1:
                time.sleep(2 ** i)  # 1s, 2s, 4s
    raise erro


def _consulta(cnpj: str) -> dict:
    """Tenta cada fonte em ordem; retorna o payload normalizado da primeira que responder."""
    ultimo_erro = None
    for nome, tpl in FONTES_CNPJ:
        try:
            return _normaliza(cnpj, _get_json(tpl.format(cnpj=cnpj)), fonte=nome)
        except Exception as e:  # noqa: BLE001
            ultimo_erro = e
    raise ultimo_erro


def _normaliza(cnpj: str, payload: dict, fonte: str = "cnpj.ws") -> dict:
    # cnpj.ws:   razao_social, nome_fantasia, descricao_situacao_cadastral,
    #            data_inicio_atividade, cnae_fiscal_principal{codigo,descricao}, municipio, uf
    # brasilapi: razao_social, nome_fantasia, descricao_situacao_cadastral,
    #            data_inicio_atividade, cnae_fiscal_descricao, municipio, uf
    cnae = (payload.get("cnae_fiscal_principal") or {}).get("descricao") \
        or payload.get("cnae_fiscal_descricao") or ""
    # QSA (sócios) — base do cruzamento "sócio em comum / sócio doador (TSE)".
    # Só NOMES (públicos no QSA da Receita); nunca CPF (LGPD).
    qsa = payload.get("qsa") or payload.get("socios") or []
    socios = []
    for s in qsa if isinstance(qsa, list) else []:
        if not isinstance(s, dict):
            continue
        nome = s.get("nome_socio") or s.get("nome") \
            or (s.get("pessoa") or {}).get("nome") or ""
        nome = (nome or "").strip()
        if nome:
            socios.append(nome)
    rotulo = {
        "cnpj.ws":   "CNPJ.ws / base pública da Receita Federal",
        "brasilapi": "BrasilAPI / base pública da Receita Federal",
    }.get(fonte, "base pública da Receita Federal")
    return {
        "cnpj": cnpj,
        "razao_social":  payload.get("razao_social")  or "",
        "nome_fantasia": payload.get("nome_fantasia")  or "",
        "situacao":      payload.get("descricao_situacao_cadastral") or "",
        "abertura":      payload.get("data_inicio_atividade") or "",
        "cnae":          cnae,
        "municipio":     payload.get("municipio") or "",
        "uf":            payload.get("uf") or "",
        "socios":        socios[:10],
        "fonte":         rotulo,
    }


def coletar(emendas: list[dict], limite: int = 90) -> dict:
    valores: dict[str, float] = {}
    nomes: dict[str, set[str]] = {}
    for e in emendas:
        cnpj = _digits(e.get("cnpj", ""))
        if len(cnpj) != 14:
            continue
        valores[cnpj] = valores.get(cnpj, 0.0) + float(e.get("valor_brl") or 0)
        nomes.setdefault(cnpj, set()).add(e.get("beneficiario") or "")

    cnpjs = sorted(valores, key=lambda c: valores[c], reverse=True)[:limite]
    empresas = []
    erros = []
    for cnpj in cnpjs:
        try:
            empresas.append({
                **_consulta(cnpj),
                "valor_emendas": round(valores[cnpj], 2),
                "nomes_no_sapl": sorted(x for x in nomes.get(cnpj, set()) if x)[:5],
            })
            time.sleep(1.2)
        except Exception as e:
            erros.append({"cnpj": cnpj, "erro": str(e), "valor_emendas": round(valores[cnpj], 2)})

    return {
        "fonte": "Dados públicos de CNPJ (apoio cadastral)",
        "empresas": empresas,
        "erros": erros,
        "resumo": {
            "consultados": len(empresas),
            "falhas": len(erros),
            "cnpjs_candidatos": len(cnpjs),
        },
        "observacao": "Uso auxiliar. Para documento oficial, conferir comprovante de inscrição no site da Receita Federal.",
    }


if __name__ == "__main__":
    print(json.dumps(coletar([]), ensure_ascii=False, indent=2))
