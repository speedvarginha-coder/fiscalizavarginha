"""
Coletor de dados cadastrais públicos de CNPJ.

Consulta CNPJs completos das emendas (SAPL) e reconstrói CNPJs de fornecedores
Betha a partir da raiz (8 dígitos) — calcula dígitos verificadores para filial
0001, que é a mais comum. O resultado é marcado como "reconstruído/conferir".
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


def _calc_digitos(raiz12: str) -> str:
    """Dada uma string de 12 dígitos (CNPJ sem os 2 verificadores), calcula e
    acrescenta os 2 dígitos verificadores conforme algoritmo da Receita Federal."""
    nums = [int(c) for c in raiz12]
    # primeiro dígito
    pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    s = sum(n * p for n, p in zip(nums, pesos1))
    r = s % 11
    d1 = 0 if r < 2 else 11 - r
    # segundo dígito
    pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    nums13 = nums + [d1]
    s = sum(n * p for n, p in zip(nums13, pesos2))
    r = s % 11
    d2 = 0 if r < 2 else 11 - r
    return raiz12 + str(d1) + str(d2)


def _cnpj_de_raiz(raiz: str, filial: str = "0001") -> str:
    """Reconstrói CNPJ completo (14 dígitos) a partir da raiz de 8 dígitos.
    Assume filial 0001 (matriz), a mais comum. Retorna '' se raiz inválida."""
    r = _digits(raiz)[:8]
    if len(r) < 8:
        return ""
    return _calc_digitos(r + filial.zfill(4))


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


def coletar_fornecedores(top: list[dict], limite: int = 30) -> list[dict]:
    """Enriquece top fornecedores Betha cujo CNPJ chega mascarado (raiz/****-**).
    Reconstrói como RAIZ/0001-XX (filial mais comum) e consulta BrasilAPI para
    obter razão social, CNAE e sócios. Marca 'cnpj_reconstruido=True' para que
    a UI avise que é inferido e deve ser conferido."""
    resultado = []
    for item in top[:limite]:
        cnpj_raw = _digits(item.get("cnpj", ""))
        raiz = cnpj_raw[:8]
        if len(raiz) < 8:
            resultado.append({
                "nome": item.get("nome", ""),
                "cnpj_raiz": raiz or "",
                "cnpj_completo": "",
                "cnpj_reconstruido": False,
                "valor_total": item.get("valor_total", 0),
                "erro": "raiz indisponível",
            })
            continue
        cnpj14 = _cnpj_de_raiz(raiz)
        try:
            dados = _consulta(cnpj14)
            resultado.append({
                "nome": item.get("nome", ""),
                "cnpj_raiz": raiz,
                "cnpj_completo": cnpj14,
                "cnpj_reconstruido": True,
                "valor_total": item.get("valor_total", 0),
                **{k: dados[k] for k in ("razao_social", "nome_fantasia", "situacao",
                                          "abertura", "cnae", "municipio", "uf",
                                          "socios", "fonte")},
            })
            time.sleep(1.2)
        except Exception as e:  # noqa: BLE001
            resultado.append({
                "nome": item.get("nome", ""),
                "cnpj_raiz": raiz,
                "cnpj_completo": cnpj14,
                "cnpj_reconstruido": True,
                "valor_total": item.get("valor_total", 0),
                "erro": str(e),
            })
    return resultado


if __name__ == "__main__":
    print(json.dumps(coletar([]), ensure_ascii=False, indent=2))
