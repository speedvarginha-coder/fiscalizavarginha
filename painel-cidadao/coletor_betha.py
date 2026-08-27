"""
Coletor Betha — busca dados ao vivo do Portal de Transparência da Prefeitura.

Fluxo:
  1. Abre Betha em navegador isolado (Playwright) e captura o token OAuth
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
import binascii
import csv as csvmod
import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
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
CONSULTA_VEICULOS_MUNICIPAIS  = 83061
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
    """Abre um navegador isolado e captura o token gerado pelo OAuth implicit grant
    (anonymousMode = true)."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        raise RuntimeError(
            "playwright não está instalado. Rode:\n"
            "  pip install playwright\n"
            "  python -m playwright install chromium"
        ) from e

    # Mesma extração de sempre: o objeto cujo valor base64 decodifica num JSON
    # com accessToken. So muda que agora navegamos numa consulta (forca o grant
    # anonimo) e aguardamos o token surgir, em vez de ler uma unica vez no root.
    extrair = """
        () => {
          for (const store of [sessionStorage, localStorage]) {
            for (const k of Object.keys(store)) {
              try {
                const v = JSON.parse(atob(store.getItem(k)));
                if (v && v.accessToken) return v;
              } catch (_) {}
            }
          }
          return null;
        }
    """
    consulta = f"https://transparencia.betha.cloud/#/{portal_hash}/consulta/{CONSULTA_CONTRATOS}"
    with sync_playwright() as p:
        # A Betha nao conclui o grant anonimo em Chromium headless. A tarefa
        # agendada e oculta, mas o browser precisa manter o modo headed.
        browser = p.chromium.launch(headless=False)
        tok = None
        try:
            ctx = browser.new_context()
            page = ctx.new_page()
            # A SPA mantem conexoes de telemetria abertas; esperar networkidle
            # fazia uma renovacao simples consumir ate 45s sem necessidade.
            page.goto(consulta, wait_until="domcontentloaded", timeout=45000)
            for _ in range(25):  # o grant pode levar alguns segundos
                tok = page.evaluate(extrair)
                if tok and tok.get("accessToken"):
                    break
                page.wait_for_timeout(1000)
        finally:
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
    cache.write_text(json.dumps(tok, indent=2), encoding="utf-8", newline="\n")
    return tok["accessToken"]


def _dados_abertos_sem_token(consulta_id: int, body: dict,
                              portal_hash: str = PORTAL_HASH,
                              timeout: int = 120) -> str:
    """Tenta baixar o endpoint dados-abertos SEM token de autenticação.

    Os portais Betha de transparência são públicos (anonymousMode=true). Em
    muitos casos o endpoint dados-abertos aceita requisições sem Bearer,
    evitando a dependência do Playwright para capturar o token.

    Retorna a string base64 do ZIP ou lança exceção se o servidor exigir auth.
    """
    url = f"{DADOS_ABERTOS_BASE}/consulta/{consulta_id}?formato=CSV"
    rq = urllib.request.Request(
        url, data=json.dumps(body).encode(), method="POST",
        headers={
            "Content-Type": "application/json",
            "app-context": _app_context(portal_hash),
            "User-Agent": "Mozilla/5.0",
        },
    )
    with urllib.request.urlopen(rq, timeout=timeout) as r:
        return r.read().decode("utf-8")


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
        "User-Agent": "FiscalizaVarginha/1.0",
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
    CONSULTA_VEICULOS_MUNICIPAIS:  None,         # sem filtro de ano
    CONSULTA_DIARIAS:              "anoExercicio",
}


class BethaExportError(RuntimeError):
    """Falha controlada na exportacao de dados abertos da Betha."""


_EXPORT_HOSTS = {
    "s3.sa-east-1.amazonaws.com",
    "transparencia.betha.cloud",
    "dados.transparencia.betha.cloud",
}
_EXPORT_RETRY_CODES = {404, 408, 425, 429, 500, 502, 503, 504}


def _export_url(raw: str) -> Optional[str]:
    """Reconhece a URL temporaria retornada pela versao nova da Betha."""
    value = (raw or "").strip()
    try:
        decoded = json.loads(value)
        if isinstance(decoded, str):
            value = decoded.strip()
    except (TypeError, ValueError):
        pass
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        return None
    host = parsed.hostname.lower()
    if host not in _EXPORT_HOSTS:
        raise BethaExportError(f"host de exportacao Betha nao permitido: {host}")
    if host == "s3.sa-east-1.amazonaws.com" and not parsed.path.startswith(
        "/transparencia.betha.cloud/dados-abertos/"
    ):
        raise BethaExportError("caminho S3 fora do bucket de dados abertos da Betha")
    return value


def _retry_after_seconds(headers, fallback: float) -> float:
    try:
        value = float(headers.get("Retry-After", ""))
        return max(0.0, min(value, 30.0))
    except (TypeError, ValueError, AttributeError):
        return fallback


def _download_export_url(url: str, attempts: int = 5) -> tuple[bytes, str]:
    """Baixa URL assinada com espera para a geracao assincrona do arquivo."""
    last_error: Optional[Exception] = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "Accept": "text/csv, application/zip, application/octet-stream, */*",
                    "User-Agent": "FiscalizaVarginha/1.0",
                },
            )
            with urllib.request.urlopen(req, timeout=180) as response:
                payload = response.read()
                if not payload:
                    raise BethaExportError("arquivo de exportacao vazio")
                return payload, response.headers.get("Content-Type", "")
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code not in _EXPORT_RETRY_CODES or attempt + 1 >= attempts:
                break
            delay = _retry_after_seconds(exc.headers, (1, 2, 5, 10, 20)[attempt])
            time.sleep(delay)
        except (TimeoutError, urllib.error.URLError, BethaExportError) as exc:
            last_error = exc
            if attempt + 1 >= attempts:
                break
            time.sleep((1, 2, 5, 10, 20)[attempt])
    code = getattr(last_error, "code", None)
    suffix = f" (HTTP {code})" if code else ""
    raise BethaExportError(
        f"Betha forneceu URL de exportacao, mas o arquivo nao ficou disponivel{suffix}"
    ) from last_error


def _decode_export_payload(raw: str) -> tuple[bytes, str, Optional[str]]:
    """Aceita URL temporaria, ZIP base64 ou CSV direto."""
    url = _export_url(raw)
    if url:
        payload, content_type = _download_export_url(url)
        return payload, "url", urllib.parse.urlparse(url).path.rsplit("/", 1)[-1]

    value = (raw or "").strip()
    try:
        decoded = json.loads(value)
        if isinstance(decoded, str):
            value = decoded
    except (TypeError, ValueError):
        pass
    try:
        payload = base64.b64decode(value, validate=True)
        if payload:
            return payload, "base64", None
    except (binascii.Error, ValueError):
        pass

    direct = value.encode("utf-8")
    if b"\n" in direct and (b"," in direct.splitlines()[0] or b";" in direct.splitlines()[0]):
        return direct, "csv-direto", None
    raise BethaExportError("formato de resposta de dados abertos nao reconhecido")


def _parse_export(payload: bytes, consulta_id: int,
                  suggested_name: Optional[str] = None) -> dict:
    """Normaliza ZIP ou CSV para o contrato historico do coletor."""
    if payload.startswith(b"PK"):
        zf = zipfile.ZipFile(io.BytesIO(payload))
        main_name = next((n for n in zf.namelist() if n.startswith("959_")), None)
        if not main_name:
            main_name = next((n for n in zf.namelist() if n.lower().endswith(".csv")), None)
        if not main_name:
            return {"main": [], "main_filename": None, "files_in_zip": len(zf.namelist()),
                    "linked": {}, "linked_rows": {}}
        csv_text = zf.read(main_name).decode("utf-8-sig", errors="replace")
        rows = list(csvmod.DictReader(io.StringIO(csv_text)))
        linked = {}
        linked_rows = {}
        for name in zf.namelist():
            if name == main_name or not name.lower().endswith(".csv"):
                continue
            try:
                sub = list(csvmod.DictReader(io.StringIO(
                    zf.read(name).decode("utf-8-sig", errors="replace")
                )))
                if sub:
                    linked[name] = sub[0]
                    linked_rows[name] = sub
            except Exception:
                pass
        return {"main": rows, "main_filename": main_name,
                "files_in_zip": len(zf.namelist()), "linked": linked,
                "linked_rows": linked_rows}

    text = payload.decode("utf-8-sig", errors="replace")
    sample = text[:4096]
    try:
        dialect = csvmod.Sniffer().sniff(sample, delimiters=",;")
    except csvmod.Error:
        dialect = csvmod.excel
    rows = list(csvmod.DictReader(io.StringIO(text), dialect=dialect))
    if not rows or not rows[0]:
        raise BethaExportError("CSV de dados abertos vazio ou sem cabecalho")
    return {
        "main": rows,
        "main_filename": suggested_name or f"consulta_{consulta_id}.csv",
        "files_in_zip": 0,
        "linked": {},
        "linked_rows": {},
    }


def baixar_dados_abertos(token: str, consulta_id: int,
                         ano: Optional[str] = None,
                         portal_hash: str = PORTAL_HASH,
                         ano_field: Optional[str] = None) -> dict:
    """Baixa o ZIP da consulta no endpoint dados-abertos e retorna um dict
    {main: [linhas], main_filename: str, files_in_zip: int}. O ZIP contém o
    CSV principal + arquivos linkados (publicações, aditivos, etc) — só o
    principal é processado."""
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

    # Estratégia de 3 tentativas em ordem de menor para maior custo:
    # 1. Sem token (funciona em portais públicos Betha — sem Playwright)
    # 2. Com token cacheado (se 1 falhar com 401)
    # 3. Renovação de token via Playwright (se 2 falhar com 401)
    raw = None
    try:
        raw = _dados_abertos_sem_token(consulta_id, body, portal_hash=portal_hash)
        print(f"  (dados-abertos/{consulta_id}: acesso público ok — sem token necessário)")
    except urllib.error.HTTPError as e_pub:
        if e_pub.code not in (401, 403):
            raise
        # Servidor exige auth — tentar com token existente
        try:
            raw = _do_request(token)
        except urllib.error.HTTPError as e:
            if e.code != 401:
                raise
            print(f"  AVISO: 401 em dados-abertos/{consulta_id} - atualizando token...")
            # O chamador conserva o token recebido no inicio do coletor. Depois
            # da primeira renovacao ele fica obsoleto, mas o cache em disco ja
            # contem o token novo. Consultar o cache antes de forcar Playwright
            # evita abrir um navegador novamente para cada ano historico.
            cached = get_token(force=False, portal_hash=portal_hash)
            try:
                raw = _do_request(cached)
            except urllib.error.HTTPError as cached_error:
                if cached_error.code != 401:
                    raise
                fresh = get_token(force=True, portal_hash=portal_hash)
                raw = _do_request(fresh)
    except Exception:
        # Qualquer outro erro (timeout, SSL) — cai para o token
        try:
            raw = _do_request(token)
        except urllib.error.HTTPError as e:
            if e.code != 401:
                raise
            print(f"  AVISO: 401 em dados-abertos/{consulta_id} - atualizando token...")
            cached = get_token(force=False, portal_hash=portal_hash)
            try:
                raw = _do_request(cached)
            except urllib.error.HTTPError as cached_error:
                if cached_error.code != 401:
                    raise
                fresh = get_token(force=True, portal_hash=portal_hash)
                raw = _do_request(fresh)
    try:
        payload, response_mode, suggested_name = _decode_export_payload(raw)
        result = _parse_export(payload, consulta_id, suggested_name)
        result["coleta_status"] = "ok"
        result["coleta_modo"] = response_mode
        return result
    except BethaExportError as export_error:
        # O endpoint de exportacao passou a devolver URLs S3 que podem ficar
        # permanentemente em 404. A busca textual e a segunda rota oficial do
        # mesmo portal e mantem o site atualizado, ainda que sem os CSVs
        # auxiliares/linkados presentes no ZIP antigo.
        print(
            f"  AVISO: dados-abertos/{consulta_id} indisponivel ({export_error}); "
            "tentando busca-textual."
        )
        try:
            fallback_token = get_token(force=False, portal_hash=portal_hash)
            rows = baixar_busca_textual(
                fallback_token,
                consulta_id,
                body=body,
                portal_hash=portal_hash,
            )
        except Exception as fallback_error:
            raise BethaExportError(
                f"exportacao e busca textual falharam para a consulta {consulta_id}: "
                f"{fallback_error}"
            ) from fallback_error
        if not rows:
            raise BethaExportError(
                f"busca textual retornou zero registros para a consulta {consulta_id}"
            ) from export_error
        return {
            "main": rows,
            "main_filename": None,
            "files_in_zip": 0,
            "linked": {},
            "linked_rows": {},
            "coleta_status": "partial",
            "coleta_modo": "busca-textual-fallback",
            "coleta_observacao": "Exportacao Betha indisponivel; anexos relacionados ausentes.",
        }


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


def filtro_max(token: str, consulta_id: int, campo: str,
               portal_hash: str = PORTAL_HASH) -> Optional[str]:
    """Maior valor disponível de um campo filtrável (ex.: competência mais
    recente da folha). Endpoint: GET /busca-textual/{id}/filtro/{campo}/MAX."""
    res = _api("GET", f"/busca-textual/{consulta_id}/filtro/{campo}/MAX",
               token, portal_hash=portal_hash)
    buckets = res.get("buckets") or []
    return buckets[0].get("id") if buckets else None


def baixar_busca_textual(token: str, consulta_id: int,
                         body: Optional[dict] = None,
                         sort_by: str = "id",
                         portal_hash: str = PORTAL_HASH,
                         batch: int = 200) -> list[dict]:
    """Baixa todas as páginas de uma consulta via busca-textual, com filtro
    opcional no body (formato Betha: {"campo": ["valor", ...]})."""
    out: list[dict] = []
    offset = 0
    total: Optional[int] = None
    while True:
        res = _api(
            "POST",
            f"/busca-textual/{consulta_id}",
            token,
            body=body or {},
            params={
                "sortBy": sort_by,
                "sortDirection": "ASC",
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
    return out


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
        try:
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
        except urllib.error.HTTPError as e:
            # O token expira durante o download longo (10k+ registros). Renova
            # e retenta o mesmo offset em vez de abortar a coleta inteira.
            if e.code == 401:
                print("  AVISO: 401 na paginacao de credores - renovando token Betha…")
                token = get_token(force=True)
                continue
            raise
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
                       "pagamentos": [], "valor_pago_total": 0,
                       "cruzamento": {
                           "estado": "indisponivel",
                           "metodo": "sem_identificador",
                           "confianca": "indisponivel",
                           "evidencias": [],
                           "limitacoes": ["A emenda nao possui CNPJ suficiente para cruzamento automatico."],
                       }})
            continue
        
        beneficiario_lower = (e.get("beneficiario") or "").lower()
        eh_publico = (
            raiz in ("18240119", "06204990") or
            "guarda civil" in beneficiario_lower or
            "camara municipal" in beneficiario_lower or
            "prefeitura" in beneficiario_lower or
            "secretaria municipal" in beneficiario_lower or
            "fundo municipal" in beneficiario_lower
        )
        if eh_publico:
            out.append({
                **e,
                "pagamentos": [],
                "valor_pago_total": 0.0,
                "status": "execucao_direta",
                "cruzamento": {
                    "estado": "nao_aplicavel",
                    "metodo": "classificacao_entidade_publica",
                    "confianca": "media",
                    "evidencias": [f"CNPJ raiz {raiz}", e.get("beneficiario") or ""],
                    "limitacoes": ["Execucao direta nao produz pagamento a beneficiario externo para comparar."],
                },
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
            "cruzamento": {
                "estado": "correspondencia_localizada" if total > 0 else "nao_localizado",
                "metodo": "raiz_cnpj_e_periodo",
                "confianca": "media" if total > 0 else "baixa",
                "evidencias": [
                    f"CNPJ raiz {raiz}",
                    f"{len(relevantes)} registro(s) de pagamento do ano da emenda em diante",
                ],
                "limitacoes": [
                    "Mesmo CNPJ e periodo nao comprovam que o pagamento veio desta emenda.",
                    "Ausencia de pagamento localizado nao comprova que a emenda nao foi executada.",
                    "Matriz e filiais compartilham a mesma raiz de CNPJ.",
                ],
            },
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
