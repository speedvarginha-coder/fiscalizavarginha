"""
Coletor PNCP — Portal Nacional de Contratações Públicas.

Objetivo: cruzar o que aparece nos dados locais da Prefeitura/Câmara com a
base nacional de contratações. A API pública do PNCP muda detalhes de filtros
com alguma frequência; por isso o coletor tenta mais de uma rota de consulta e
sempre retorna um payload estruturado, mesmo quando a fonte falha.
"""
from __future__ import annotations

import datetime as dt
import json
import urllib.parse
import urllib.request

API = "https://pncp.gov.br/api"
PREFEITURA_CNPJ = "18240119000105"
CAMARA_CNPJ = "04366790000184"
VARGINHA_IBGE = "3170701"


def _get_json(url: str, timeout: int = 35):
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "ZelaVarginha/1.0 (controle-social)",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", errors="replace"))


def _items(payload) -> list[dict]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("data", "content", "items", "resultado", "resultados"):
        val = payload.get(key)
        if isinstance(val, list):
            return val
    return []


def _query(path: str, params: dict) -> tuple[list[dict], str]:
    url = API + path + "?" + urllib.parse.urlencode(params)
    return _items(_get_json(url)), url


def _periodo(ano: int) -> tuple[str, str]:
    return f"{ano}0101", f"{ano}1231"


def _normaliza_compra(x: dict) -> dict:
    return {
        "numero_controle_pncp": x.get("numeroControlePNCP", ""),
        "orgao": (
            x.get("orgaoEntidade", {}).get("razaoSocial")
            if isinstance(x.get("orgaoEntidade"), dict) else x.get("orgaoEntidade", "")
        ),
        "cnpj_orgao": (
            x.get("orgaoEntidade", {}).get("cnpj")
            if isinstance(x.get("orgaoEntidade"), dict) else x.get("cnpjOrgao", "")
        ),
        "ano": x.get("anoCompra") or x.get("ano") or "",
        "sequencial": x.get("sequencialCompra") or x.get("sequencial") or "",
        "modalidade": x.get("modalidadeNome") or x.get("modalidade") or "",
        "modo_disputa": x.get("modoDisputaNome") or "",
        "objeto": x.get("objetoCompra") or x.get("objeto") or "",
        "situacao": x.get("situacaoCompraNome") or x.get("situacao") or "",
        "valor_estimado": x.get("valorTotalEstimado") or 0,
        "valor_homologado": x.get("valorTotalHomologado") or 0,
        "data_publicacao": x.get("dataPublicacaoPncp") or x.get("dataPublicacao") or "",
        "fonte": "PNCP",
    }


def _normaliza_contrato(x: dict) -> dict:
    return {
        "numero_controle_pncp": x.get("numeroControlePNCP", ""),
        "orgao": (
            x.get("orgaoEntidade", {}).get("razaoSocial")
            if isinstance(x.get("orgaoEntidade"), dict) else x.get("orgaoEntidade", "")
        ),
        "cnpj_orgao": (
            x.get("orgaoEntidade", {}).get("cnpj")
            if isinstance(x.get("orgaoEntidade"), dict) else x.get("cnpjOrgao", "")
        ),
        "numero": x.get("numeroContratoEmpenho") or x.get("numeroContrato") or "",
        "ano": x.get("anoContrato") or x.get("ano") or "",
        "fornecedor": x.get("nomeRazaoSocialFornecedor") or x.get("fornecedor") or "",
        "cnpj_fornecedor": x.get("niFornecedor") or x.get("cnpjFornecedor") or "",
        "objeto": x.get("objetoContrato") or x.get("objeto") or "",
        "valor": x.get("valorInicial") or x.get("valorGlobal") or 0,
        "data_assinatura": x.get("dataAssinatura") or "",
        "data_vigencia_inicio": x.get("dataVigenciaInicio") or "",
        "data_vigencia_fim": x.get("dataVigenciaFim") or "",
        "fonte": "PNCP",
    }


def _coleta_compras(ano: int) -> tuple[list[dict], list[str]]:
    data_inicial, data_final = _periodo(ano)
    tentativas = [
        ("/consulta/v1/contratacoes/publicacao", {
            "dataInicial": data_inicial,
            "dataFinal": data_final,
            "codigoMunicipioIbge": VARGINHA_IBGE,
            "pagina": 1,
            "tamanhoPagina": 50,
        }),
        ("/consulta/v1/contratacoes/publicacao", {
            "dataInicial": data_inicial,
            "dataFinal": data_final,
            "cnpjOrgao": PREFEITURA_CNPJ,
            "pagina": 1,
            "tamanhoPagina": 50,
        }),
    ]
    erros = []
    for path, params in tentativas:
        try:
            rows, url = _query(path, params)
            if rows:
                return [_normaliza_compra(x) for x in rows], [url]
            erros.append(f"{path}: retornou 0 registros")
        except Exception as e:
            erros.append(f"{path}: {e}")
    return [], erros


def _coleta_contratos(ano: int) -> tuple[list[dict], list[str]]:
    data_inicial, data_final = _periodo(ano)
    tentativas = [
        ("/consulta/v1/contratos", {
            "dataInicial": data_inicial,
            "dataFinal": data_final,
            "codigoMunicipioIbge": VARGINHA_IBGE,
            "pagina": 1,
            "tamanhoPagina": 50,
        }),
        ("/consulta/v1/contratos", {
            "dataInicial": data_inicial,
            "dataFinal": data_final,
            "cnpjOrgao": PREFEITURA_CNPJ,
            "pagina": 1,
            "tamanhoPagina": 50,
        }),
    ]
    erros = []
    for path, params in tentativas:
        try:
            rows, url = _query(path, params)
            if rows:
                return [_normaliza_contrato(x) for x in rows], [url]
            erros.append(f"{path}: retornou 0 registros")
        except Exception as e:
            erros.append(f"{path}: {e}")
    return [], erros


def coletar(ano: int | None = None) -> dict:
    ano = ano or dt.datetime.now().year
    compras, compras_meta = _coleta_compras(ano)
    contratos, contratos_meta = _coleta_contratos(ano)
    return {
        "fonte": "Portal Nacional de Contratações Públicas (PNCP)",
        "ano": ano,
        "compras": compras,
        "contratos": contratos,
        "resumo": {
            "compras_qtd": len(compras),
            "contratos_qtd": len(contratos),
            "valor_compras_estimado": round(sum(float(x.get("valor_estimado") or 0) for x in compras), 2),
            "valor_contratos": round(sum(float(x.get("valor") or 0) for x in contratos), 2),
        },
        "consultas": compras_meta + contratos_meta,
        "observacao": (
            "Dados usados para conferência cruzada. Se a API pública não retornar "
            "registros, consulte manualmente o PNCP pelo município ou CNPJ do órgão."
        ),
    }


if __name__ == "__main__":
    print(json.dumps(coletar(), ensure_ascii=False, indent=2))
