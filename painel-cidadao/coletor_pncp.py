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
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://pncp.gov.br/api"
PREFEITURA_CNPJ = "18240119000105"
CAMARA_CNPJ = "04366790000184"
VARGINHA_IBGE = "3170701"
DATA = Path(__file__).resolve().parent / "data"
ORGAOS = {
    "prefeitura": PREFEITURA_CNPJ,
    "camara": CAMARA_CNPJ,
}
MODALIDADES_FALLBACK = tuple(range(1, 20))
RETRY_HTTP_CODES = {408, 425, 429, 500, 502, 503, 504}
REQUEST_ATTEMPTS = 5
# A API publica aplica rate limit sem sempre enviar Retry-After. Manter a
# coleta deliberadamente abaixo de 30 requisicoes/minuto evita 429 em cascata.
REQUEST_PAUSE = 2.2


def _retry_after(headers, fallback: float) -> float:
    try:
        return max(0.0, min(float(headers.get("Retry-After", "")), 60.0))
    except (TypeError, ValueError, AttributeError):
        return fallback


def _get_json(url: str, timeout: int = 45):
    """GET publico com tratamento explicito de 204, rate limit e 5xx."""
    last_error = None
    for attempt in range(REQUEST_ATTEMPTS):
        req = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "FiscalizaVarginha/1.0 (controle-social)",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                if response.status == 204:
                    return {"data": [], "totalPaginas": 0, "totalRegistros": 0}
                raw = response.read().decode("utf-8", errors="replace").strip()
                if not raw:
                    return {"data": [], "totalPaginas": 0, "totalRegistros": 0}
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code not in RETRY_HTTP_CODES or attempt + 1 >= REQUEST_ATTEMPTS:
                raise
            fallback = min(60.0, 15.0 * (attempt + 1)) if exc.code == 429 else 2 ** attempt
            time.sleep(_retry_after(exc.headers, fallback))
        except (urllib.error.URLError, TimeoutError, socket.timeout, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt + 1 >= REQUEST_ATTEMPTS:
                raise
            time.sleep(2 ** attempt)
    raise last_error or RuntimeError("Falha desconhecida ao consultar PNCP")


def _modalidades_ativas() -> tuple[list[int], list[str]]:
    url = f"{API}/pncp/v1/modalidades?statusAtivo=true"
    try:
        payload = _get_json(url)
        ids = sorted({int(item["id"]) for item in payload if item.get("id") is not None})
        if ids:
            return ids, [url]
        raise ValueError("lista de modalidades vazia")
    except Exception as exc:
        return list(MODALIDADES_FALLBACK), [f"modalidades: {exc}"]


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


def _query(path: str, params: dict) -> tuple[list[dict], list[str]]:
    rows: list[dict] = []
    urls: list[str] = []
    pagina = 1
    while True:
        params_pg = {**params, "pagina": pagina}
        url = API + path + "?" + urllib.parse.urlencode(params_pg)
        payload = _get_json(url)
        page_rows = _items(payload)
        rows.extend(page_rows)
        urls.append(url)

        total_paginas = None
        if isinstance(payload, dict):
            total_paginas = payload.get("totalPaginas") or payload.get("totalPages")
            paginacao = payload.get("paginacao") or payload.get("pagination") or {}
            if isinstance(paginacao, dict):
                total_paginas = total_paginas or paginacao.get("totalPaginas") or paginacao.get("totalPages")
        tamanho = int(params.get("tamanhoPagina", 50))
        if (total_paginas is not None and pagina >= int(total_paginas)) or len(page_rows) < tamanho:
            break
        pagina += 1
        time.sleep(REQUEST_PAUSE)
    return rows, urls


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


def _dedupe(rows: list[dict]) -> list[dict]:
    vistos = set()
    out = []
    for row in rows:
        chave = row.get("numero_controle_pncp") or json.dumps(row, sort_keys=True, ensure_ascii=False)
        if chave not in vistos:
            vistos.add(chave)
            out.append(row)
    return out


def _coleta_compras(ano: int) -> tuple[list[dict], list[str], bool, dict]:
    data_inicial, data_final = _periodo(ano)
    modalidades, modalidades_meta = _modalidades_ativas()
    erros = []
    out = []
    consultas = list(modalidades_meta)
    details = {"modalidades": modalidades, "orgaos": {}}
    for orgao, cnpj in ORGAOS.items():
        org_rows = []
        org_errors = []
        for modalidade in modalidades:
            params = {
                "dataInicial": data_inicial,
                "dataFinal": data_final,
                # Nesta rota o parametro oficial e `cnpj`; `cnpjOrgao` e
                # ignorado e pode devolver dados nacionais.
                "cnpj": cnpj,
                "codigoModalidadeContratacao": modalidade,
                "tamanhoPagina": 50,
            }
            try:
                rows, urls = _query("/consulta/v1/contratacoes/publicacao", params)
                consultas.extend(urls)
                org_rows.extend(rows)
            except Exception as exc:
                message = f"contratacoes/{orgao}/modalidade-{modalidade}: {exc}"
                erros.append(message)
                org_errors.append(message)
            time.sleep(REQUEST_PAUSE)
        out.extend(_normaliza_compra(item) for item in org_rows)
        details["orgaos"][orgao] = {
            "status": "ok" if not org_errors else "partial",
            "registros": len(_dedupe([_normaliza_compra(item) for item in org_rows])),
            "falhas": org_errors,
        }
    return _dedupe(out), consultas + erros, not erros, details


def _coleta_contratos(ano: int) -> tuple[list[dict], list[str], bool, dict]:
    data_inicial, data_final = _periodo(ano)
    erros = []
    out = []
    consultas = []
    details = {"orgaos": {}}
    for orgao, cnpj in ORGAOS.items():
        params = {
            "dataInicial": data_inicial,
            "dataFinal": data_final,
            "cnpjOrgao": cnpj,
            "tamanhoPagina": 50,
        }
        try:
            rows, urls = _query("/consulta/v1/contratos", params)
            consultas.extend(urls)
            normalized = _dedupe([_normaliza_contrato(item) for item in rows])
            out.extend(normalized)
            details["orgaos"][orgao] = {"status": "ok", "registros": len(normalized), "falhas": []}
        except Exception as exc:
            message = f"contratos/{orgao}: {exc}"
            erros.append(message)
            details["orgaos"][orgao] = {"status": "failed", "registros": 0, "falhas": [message]}
        time.sleep(REQUEST_PAUSE)
    return _dedupe(out), consultas + erros, not erros, details


def _existente() -> dict:
    for path in (DATA / "chunks" / "pncp.json", DATA / "pncp.json"):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
    return {}


def _merge_partial(current: list[dict], previous: list[dict]) -> list[dict]:
    """Mescla resposta parcial sem apagar registros validos ja publicados."""
    merged = {}
    for row in previous or []:
        key = row.get("numero_controle_pncp") or json.dumps(row, sort_keys=True, ensure_ascii=False)
        merged[key] = row
    for row in current or []:
        key = row.get("numero_controle_pncp") or json.dumps(row, sort_keys=True, ensure_ascii=False)
        merged[key] = row
    return list(merged.values())


def _coverage_drop(current: list[dict], previous: list[dict]) -> bool:
    return bool(previous) and len(current) < max(1, int(len(previous) * 0.75))


def coletar(ano: int | None = None) -> dict:
    ano = ano or dt.datetime.now().year
    attempted_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    compras, compras_meta, compras_ok, compras_details = _coleta_compras(ano)
    contratos, contratos_meta, contratos_ok, contratos_details = _coleta_contratos(ano)
    anterior = _existente()
    compras_anteriores = anterior.get("compras") if anterior.get("ano") == ano else []
    contratos_anteriores = anterior.get("contratos") if anterior.get("ano") == ano else []
    status = {
        "compras": {"status": "ok" if compras_ok else "partial", **compras_details},
        "contratos": {"status": "ok" if contratos_ok else "partial", **contratos_details},
    }
    compras_drop = compras_ok and _coverage_drop(compras, compras_anteriores)
    contratos_drop = contratos_ok and _coverage_drop(contratos, contratos_anteriores)
    if (not compras_ok or compras_drop) and compras_anteriores:
        compras = _merge_partial(compras, compras_anteriores)
        status["compras"]["status"] = "preserved" if not any(
            item.get("registros") for item in compras_details["orgaos"].values()
        ) else "partial"
        status["compras"]["motivo"] = (
            "queda anormal de cobertura" if compras_drop else "falha parcial na API PNCP"
        )
    if (not contratos_ok or contratos_drop) and contratos_anteriores:
        contratos = _merge_partial(contratos, contratos_anteriores)
        status["contratos"]["status"] = "preserved" if not any(
            item.get("registros") for item in contratos_details["orgaos"].values()
        ) else "partial"
        status["contratos"]["motivo"] = (
            "queda anormal de cobertura" if contratos_drop else "falha parcial na API PNCP"
        )
    all_current = status["compras"]["status"] == "ok" and status["contratos"]["status"] == "ok"
    return {
        "fonte": "Portal Nacional de Contratações Públicas (PNCP)",
        "ano": ano,
        "gerado_em": attempted_at,
        "ultima_tentativa_em": attempted_at,
        "ultima_coleta_bem_sucedida_em": (
            attempted_at if all_current else anterior.get("ultima_coleta_bem_sucedida_em")
            or anterior.get("gerado_em")
        ),
        "compras": compras,
        "contratos": contratos,
        "resumo": {
            "compras_qtd": len(compras),
            "contratos_qtd": len(contratos),
            "valor_compras_estimado": round(sum(float(x.get("valor_estimado") or 0) for x in compras), 2),
            "valor_contratos": round(sum(float(x.get("valor") or 0) for x in contratos), 2),
        },
        "consultas": compras_meta + contratos_meta,
        "status_fontes": status,
        "observacao": (
            "Dados usados para conferência cruzada. Ausência no PNCP não prova ausência "
            "de contratação local: a completude depende do envio feito por cada órgão."
        ),
    }


if __name__ == "__main__":
    print(json.dumps(coletar(), ensure_ascii=False, indent=2))
