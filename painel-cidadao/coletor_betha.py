"""
Coletor Betha — busca dados ao vivo do Portal de Transparência da Prefeitura.

Fluxo:
  1. Abre Betha em navegador headless (Playwright) e captura o token OAuth
     (anonymous mode — sem login, apenas auto-grant)
  2. Cacheia o token em .betha-token.json (~30 min de validade)
  3. Faz requests à API REST com Bearer + header app-context
  4. Retorna dataset agregado consumível pelo painel

API descoberta:
  Base   : https://api.transparencia.betha.cloud/transparencia/api
  Auth   : Authorization: Bearer <token>  +  app-context: <base64({portal:hash})>
  Dados  : POST /busca-textual/{consultaId}    body {}    paginado
  Schema : GET  /consulta/{id}/tabular
  Total  : POST /busca-textual/{id}/totalizadores
"""
from __future__ import annotations

import base64
import json
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Optional

PORTAL_HASH = "y7mn01LGqd_HCvGtj6VPwA=="
API_BASE = "https://api.transparencia.betha.cloud/transparencia/api"
DADOS_ABERTOS_BASE = "https://dados.transparencia.betha.cloud/transparencia/dados-abertos/api"
PORTAL_URL = f"https://transparencia.betha.cloud/#/{PORTAL_HASH}"

# Consultas conhecidas (descobertas via /menu)
CONSULTA_DESPESAS_POR_CREDOR  = 83034
CONSULTA_CONTRATOS            = 83043
CONSULTA_LICITACOES_ABERTAS   = 82967  # Em andamento
CONSULTA_LICITACOES_FECHADAS  = 82965  # Finalizadas
CONSULTA_COMPRAS_DIRETAS      = 83045
CONSULTA_OBRAS_PUBLICAS       = 83026
CONSULTA_DIARIAS              = 83059
CONSULTA_INEXIGIBILIDADE      = 83022
CONSULTA_DISPENSADA           = 83062

ROOT = Path(__file__).resolve().parent
# Tokens ficam em ../private/tokens/ — FORA da pasta pública do painel.
# Esta pasta nunca deve ser publicada. Veja .gitignore na raiz.
TOKEN_DIR = ROOT.parent / "private" / "tokens"
TOKEN_DIR.mkdir(parents=True, exist_ok=True)
TOKEN_CACHE = TOKEN_DIR / ".betha-token.json"


# ============================================================
# Auth
# ============================================================

def _app_context(portal_hash: str = PORTAL_HASH) -> str:
    # Importante: separadores compactos (sem espaço) — o servidor
    # dados.transparencia rejeita JSON com espaço entre chave e valor.
    return base64.b64encode(
        json.dumps({"portal": portal_hash}, separators=(",", ":")).encode()
    ).decode()


def _token_valid(payload: dict) -> bool:
    expires_ms = payload.get("accessTokenExpires", 0)
    # 60s de margem
    return expires_ms / 1000 > time.time() + 60


def _grab_token_via_browser(portal_hash: str = PORTAL_HASH) -> dict:
    """Abre headless e captura o token gerado pelo OAuth implicit grant
    (anonymousMode = true)."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        raise RuntimeError(
            "playwright não está instalado. Rode:\n"
            "  pip install playwright\n"
            "  python -m playwright install chromium"
        ) from e

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(f"https://transparencia.betha.cloud/#/{portal_hash}", wait_until="networkidle", timeout=45000)
        tok = page.evaluate("""
            () => {
              for (const k of Object.keys(sessionStorage)) {
                try {
                  const v = JSON.parse(atob(sessionStorage.getItem(k)));
                  if (v && v.accessToken) return v;
                } catch (_) {}
              }
              return null;
            }
        """)
        browser.close()
    if not tok or not tok.get("accessToken"):
        raise RuntimeError("Não foi possível capturar token Betha (sessionStorage vazio).")
    return tok


def get_token(force: bool = False, portal_hash: str = PORTAL_HASH) -> str:
    """Retorna token válido (usa cache em .betha-token.json se não expirou)."""
    cache = TOKEN_CACHE if portal_hash == PORTAL_HASH else TOKEN_DIR / (".betha-token-" + "".join(ch for ch in portal_hash if ch.isalnum())[:16] + ".json")
    if not force and cache.exists():
        try:
            cached = json.loads(cache.read_text(encoding="utf-8"))
            if _token_valid(cached):
                return cached["accessToken"]
        except Exception:
            pass

    print("  -> Capturando token Betha (Playwright)...")
    tok = _grab_token_via_browser(portal_hash)
    cache.write_text(json.dumps(tok, indent=2), encoding="utf-8")
    return tok["accessToken"]


# ============================================================
# HTTP
# ============================================================

def _api(method: str, path: str, token: str,
         body: Optional[dict] = None,
         params: Optional[dict] = None,
         timeout: int = 60,
         portal_hash: str = PORTAL_HASH) -> dict:
    url = API_BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = None
    headers = {
        "Authorization": "Bearer " + token,
        "app-context": _app_context(portal_hash),
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "ZelaVarginha/1.0",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


# ============================================================
# Dados Abertos — endpoint paralelo que retorna ZIP com CSVs
# ============================================================

# Cada consulta tem nome de campo de ano diferente. Descoberto via /filtros.
ANO_FIELD = {
    CONSULTA_DESPESAS_POR_CREDOR:  "ano",
    CONSULTA_CONTRATOS:            "anoLicitacao",
    CONSULTA_LICITACOES_ABERTAS:   "anoLicitacao",
    CONSULTA_LICITACOES_FECHADAS:  "anoLicitacao",
    CONSULTA_COMPRAS_DIRETAS:      "ano",
    CONSULTA_INEXIGIBILIDADE:      "anoLicitacao",
    CONSULTA_DISPENSADA:           "anoLicitacao",
    CONSULTA_OBRAS_PUBLICAS:       None,         # sem filtro de ano
    CONSULTA_DIARIAS:              "anoExercicio",
}


def baixar_dados_abertos(token: str, consulta_id: int,
                         ano: Optional[str] = None,
                         portal_hash: str = PORTAL_HASH,
                         ano_field: Optional[str] = None) -> dict:
    """Baixa o ZIP da consulta no endpoint dados-abertos e retorna um dict
    {main: [linhas], main_filename: str, files_in_zip: int}. O ZIP contém o
    CSV principal + arquivos linkados (publicações, aditivos, etc) — só o
    principal é processado."""
    import csv as csvmod
    import zipfile
    import io

    url = f"{DADOS_ABERTOS_BASE}/consulta/{consulta_id}?formato=CSV"

    fld = ano_field if ano_field is not None else ANO_FIELD.get(consulta_id, "ano")
    if fld is None:
        body = {}
    else:
        body = {fld: [str(ano or time.localtime().tm_year)]}

    # IMPORTANTE: nada de "Accept: application/json" aqui — esse endpoint
    # devolve a string base64 do ZIP e responde 500 se forçarmos JSON.
    import urllib.error

    def _do_request(tok: str) -> str:
        rq = urllib.request.Request(
            url, data=json.dumps(body).encode(), method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + tok,
                "app-context": _app_context(portal_hash),
                "User-Agent": "Mozilla/5.0",
            },
        )
        with urllib.request.urlopen(rq, timeout=180) as r:
            return r.read().decode("utf-8")

    try:
        raw = _do_request(token)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            print(f"  AVISO: 401 em dados-abertos/{consulta_id} - renovando token...")
            fresh = get_token(force=True, portal_hash=portal_hash)
            raw = _do_request(fresh)
        else:
            raise
    if raw.startswith('"') and raw.endswith('"'):
        raw = raw[1:-1]
    zb = base64.b64decode(raw)
    zf = zipfile.ZipFile(io.BytesIO(zb))

    main_name = next((n for n in zf.namelist() if n.startswith("959_")), None)
    if not main_name:
        main_name = next((n for n in zf.namelist() if n.lower().endswith(".csv")), None)
    if not main_name:
        return {"main": [], "main_filename": None, "files_in_zip": len(zf.namelist()), "linked": {}}

    csv_text = zf.read(main_name).decode("utf-8", errors="ignore")
    rows = list(csvmod.DictReader(io.StringIO(csv_text)))
    linked = {}
    for name in zf.namelist():
        if name == main_name or not name.lower().endswith(".csv"):
            continue
        try:
            txt = zf.read(name).decode("utf-8", errors="ignore")
            sub = list(csvmod.DictReader(io.StringIO(txt)))
            if sub:
                linked[name] = sub[0]
        except Exception:
            pass
    return {"main": rows, "main_filename": main_name,
            "files_in_zip": len(zf.namelist()), "linked": linked}


# ============================================================
# Consultas de alto nível
# ============================================================

def top_credores(token: str, n: int = 200) -> list[dict]:
    """Top N credores do exercício atual, ordenados por valor pago desc."""
    res = _api(
        "POST",
        f"/busca-textual/{CONSULTA_DESPESAS_POR_CREDOR}",
        token,
        body={},
        params={
            "sortBy": "valorPagamentoAno",
            "sortDirection": "DESC",
            "offset": 0,
            "limit": n,
            "hiperlink": "false",
        },
    )
    return [h["sourceAsMap"] for h in res.get("hits", [])]


def totalizadores_credores(token: str) -> dict:
    """Totais agregados de Despesas por Credor."""
    return _api(
        "POST",
        f"/busca-textual/{CONSULTA_DESPESAS_POR_CREDOR}/totalizadores",
        token,
        body={},
    )


def todos_credores_generico(token: str, consulta_id: int,
                             portal_hash: str = PORTAL_HASH,
                             batch: int = 200) -> list[dict]:
    """Baixa TODOS os credores de qualquer consulta/portal (Prefeitura ou Câmara)."""
    out: list[dict] = []
    offset = 0
    total: Optional[int] = None
    while True:
        res = _api(
            "POST",
            f"/busca-textual/{consulta_id}",
            token,
            body={},
            params={
                "sortBy": "valorPagamentoAno",
                "sortDirection": "DESC",
                "offset": offset,
                "limit": batch,
                "hiperlink": "false",
            },
            portal_hash=portal_hash,
        )
        if total is None:
            total = res.get("totalHits", 0)
            print(f"  -> Total de registros: {total:,}")
        hits = res.get("hits", [])
        if not hits:
            break
        out.extend(h["sourceAsMap"] for h in hits)
        offset += batch
        if offset >= total:
            break
        if offset % 1000 == 0:
            print(f"  baixado {offset}/{total}…")
    return out


def todos_credores(token: str, batch: int = 200) -> list[dict]:
    """Baixa TODOS os credores paginando até o fim. Retorna lista plana.
    Cada item = (ano × entidade × credor) — credor pode aparecer múltiplas vezes
    (um registro por ano e por entidade pagadora)."""
    out: list[dict] = []
    offset = 0
    total: Optional[int] = None
    while True:
        res = _api(
            "POST",
            f"/busca-textual/{CONSULTA_DESPESAS_POR_CREDOR}",
            token,
            body={},
            params={
                "sortBy": "valorPagamentoAno",
                "sortDirection": "DESC",
                "offset": offset,
                "limit": batch,
                "hiperlink": "false",
            },
        )
        if total is None:
            total = res.get("totalHits", 0)
            print(f"  -> Total de registros: {total:,}")
        hits = res.get("hits", [])
        if not hits:
            break
        out.extend(h["sourceAsMap"] for h in hits)
        offset += batch
        if offset >= total:
            break
        if offset % 1000 == 0:
            print(f"  baixado {offset}/{total}…")
    return out


# ============================================================
# Agregações
# ============================================================

PREFIXOS_ENTIDADES_INTERNAS = (
    "PREFEITURA",
    "FUNDO MUNICIPAL",
    "MUNICIPIO DE VARGINHA",
    "INPREV",  # Instituto de Previdência Municipal — autarquia
    "FUNDA",   # Fundações municipais (Fundação Hospitalar do Município, etc.)
    "CAMARA MUNICIPAL",
)


def _eh_externo(nome: str) -> bool:
    n = (nome or "").upper().strip()
    return not any(n.startswith(p) for p in PREFIXOS_ENTIDADES_INTERNAS)


def _cnpj_raiz(s: str) -> str:
    """Primeiros 8 dígitos do CNPJ — identifica a empresa (matriz/filiais)."""
    return "".join(c for c in (s or "") if c.isdigit())[:8]


def top_fornecedores(credores: list[dict], ano: Optional[int] = None,
                      apenas_externos: bool = True, n: int = 30) -> list[dict]:
    """Agrupa por raiz de CNPJ e retorna o ranking de fornecedores."""
    grupos: dict[str, dict] = {}
    for c in credores:
        if ano and c.get("ano") != ano:
            continue
        nome = c.get("nomeCredor") or ""
        if apenas_externos and not _eh_externo(nome):
            continue
        cnpj = c.get("cnpjCpf") or ""
        chave = _cnpj_raiz(cnpj) or nome.upper()
        g = grupos.setdefault(chave, {
            "nome": nome, "cnpj": cnpj, "valor_total": 0.0,
            "registros": 0, "anos": set(),
        })
        g["valor_total"] += c.get("valorPagamentoAno") or 0
        g["registros"] += 1
        g["anos"].add(c.get("ano"))
        # mantém o nome mais frequente (alguns têm variações)
        if len(nome) > len(g["nome"]):
            g["nome"] = nome

    lista = sorted(grupos.values(), key=lambda x: -x["valor_total"])
    for it in lista:
        it["valor_total"] = round(it["valor_total"], 2)
        it["anos"] = sorted(it.pop("anos"))
    return lista[:n]


def total_pago(credores: list[dict], ano: Optional[int] = None,
                apenas_externos: bool = False) -> float:
    s = 0.0
    for c in credores:
        if ano and c.get("ano") != ano:
            continue
        if apenas_externos and not _eh_externo(c.get("nomeCredor") or ""):
            continue
        s += c.get("valorPagamentoAno") or 0
    return round(s, 2)


# ============================================================
# Cruzamento Câmara × Prefeitura
# ============================================================

def cruzar_emendas(emendas: list[dict], credores: list[dict]) -> list[dict]:
    """Cruza cada emenda da Câmara com pagamentos da Prefeitura ao mesmo CNPJ
    (raiz). Como o portal mascara os últimos 4 dígitos por LGPD, o match é
    feito pela raiz (8 primeiros dígitos)."""
    # Index: cnpj_raiz -> list of credores
    idx: dict[str, list[dict]] = defaultdict(list)
    for c in credores:
        raiz = _cnpj_raiz(c.get("cnpjCpf") or "")
        # Ignora o CNPJ da própria prefeitura para evitar falso-positivo massivo de cruzamento
        if raiz and raiz != "18240119":
            idx[raiz].append(c)

    out = []
    for e in emendas:
        raiz = _cnpj_raiz(e.get("cnpj") or "")
        if not raiz:
            out.append({**e, "status": "sem_cnpj",
                       "pagamentos": [], "valor_pago_total": 0})
            continue
        
        if raiz == "18240119":
            out.append({
                **e,
                "pagamentos": [],
                "valor_pago_total": 0.0,
                "status": "execucao_direta",
            })
            continue

        matches = idx.get(raiz, [])
        # Considera pagamentos do ano da emenda em diante
        ano_e = int(e.get("ano") or 0)
        relevantes = [m for m in matches if int(m.get("ano") or 0) >= ano_e]
        total = sum((m.get("valorPagamentoAno") or 0) for m in relevantes)

        # amostra: até 5 registros (ano + entidade + valor)
        amostra = sorted(relevantes, key=lambda x: -(x.get("valorPagamentoAno") or 0))[:5]
        amostra = [{
            "ano": m.get("ano"),
            "entidade": m.get("nomeEntidade"),
            "credor": m.get("nomeCredor"),
            "valor": m.get("valorPagamentoAno") or 0,
        } for m in amostra]

        out.append({
            **e,
            "pagamentos": amostra,
            "valor_pago_total": round(total, 2),
            "status": "encontrado" if total > 0 else "sem_pagamento",
        })
    return out


# ============================================================
# Quando rodado direto
# ============================================================

if __name__ == "__main__":
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    print("\n=== Coletor Betha ===\n")
    print("Obtendo token…")
    tok = get_token()
    print(f"Token: {tok[:8]}…")

    print("\nTop 5 credores:")
    for c in top_credores(tok, n=5):
        print(f"  R$ {c.get('valorPagamentoAno', 0):>15,.2f}  "
              f"{c.get('nomeCredor', '')[:50]}")
