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

OPEN_CNPJ = "https://publica.cnpj.ws/cnpj/{cnpj}"


def _digits(cnpj: str) -> str:
    return re.sub(r"\D", "", cnpj or "")


def _get_json(url: str, timeout: int = 30):
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "ZelaVarginha/1.0 (controle-social)"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", errors="replace"))


def _normaliza(cnpj: str, payload: dict) -> dict:
    # cnpj.ws retorna: razao_social, nome_fantasia, descricao_situacao_cadastral,
    # data_inicio_atividade, cnae_fiscal_principal{codigo,descricao}, municipio, uf
    return {
        "cnpj": cnpj,
        "razao_social":  payload.get("razao_social")  or "",
        "nome_fantasia": payload.get("nome_fantasia")  or "",
        "situacao":      payload.get("descricao_situacao_cadastral") or "",
        "abertura":      payload.get("data_inicio_atividade") or "",
        "cnae":          (payload.get("cnae_fiscal_principal") or {}).get("descricao") or "",
        "municipio":     payload.get("municipio") or "",
        "uf":            payload.get("uf") or "",
        "fonte":         "CNPJ.ws / base pública da Receita Federal",
    }


def coletar(emendas: list[dict], limite: int = 40) -> dict:
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
            payload = _get_json(OPEN_CNPJ.format(cnpj=cnpj))
            empresas.append({
                **_normaliza(cnpj, payload),
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
