# -*- coding: utf-8 -*-
"""
Coletor Federal — Fiscaliza Varginha
=====================================
Coleta dados reais de fontes federais oficiais sobre Varginha-MG (IBGE 3170701).

Fontes:
  1. API CGU — /emendas?codigoMunicipio=3170701  (chave ativa)
  2. API CGU — /convenios?uf=MG (filtra por município)
  3. API CGU — /ceis (dataset sancionados, cruza com Betha)
  4. Dataset aberto — emendas-parlamentares/UNICO (sem token, redundante com /emendas)

Saída: painel-cidadao/data/federal.json
"""
from __future__ import annotations

import datetime as dt
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import unicodedata
from numbers import Real
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

# Identificadores de Varginha
IBGE = "3170701"
CNPJ_PREFEITURA_RAIZ = "18240380"  # primeiros 8 dígitos

# Chave API CGU (gratuita, sem escopo restrito para emendas/convenios/ceis)
_TOKEN_FILE = ROOT.parent / "private" / "tokens" / ".portal-transparencia.json"
API_BASE = "https://api.portaldatransparencia.gov.br/api-de-dados"

MUNICIPIO_LABEL = "Varginha/MG"


def _to_float(v) -> float:
    """Converte valores monetários brasileiros (1.234,56 ou 1234.56) para float."""
    if v is None or v == "":
        return 0.0
    if isinstance(v, Real) and not isinstance(v, bool):
        return float(v)
    s = str(v).strip().replace("R$", "").replace(" ", "")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _norm(v) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", str(v or "")).upper()
        if not unicodedata.combining(c)
    ).strip()


def _localidade_confirmada(row: dict) -> bool:
    """Exige evidência explícita de Varginha/MG ou do IBGE no próprio registro."""
    codigos, municipios, ufs, textos = set(), set(), set(), []

    def visitar(value, key=""):
        chave = _norm(key).replace("_", "")
        if isinstance(value, dict):
            for k, v in value.items():
                visitar(v, k)
        elif isinstance(value, list):
            for item in value:
                visitar(item, key)
        else:
            texto = _norm(value)
            if not texto:
                return
            if "IBGE" in chave or chave in {"CODIGOMUNICIPIO", "CODMUNICIPIO"}:
                codigos.add("".join(c for c in texto if c.isdigit()))
            elif "MUNICIP" in chave or "LOCALIDADE" in chave:
                municipios.add(texto)
            elif chave in {"UF", "SIGLAUF"} or chave.endswith("UF"):
                ufs.add(texto)
            textos.append(texto)

    visitar(row)
    if IBGE in codigos:
        return True
    municipio_ok = any("VARGINHA" in v for v in municipios)
    uf_ok = "MG" in ufs or any("VARGINHA/MG" in v or "VARGINHA - MG" in v for v in textos)
    return municipio_ok and uf_ok


def _autoria_tipo(tipo) -> str:
    t = _norm(tipo)
    for termo, valor in (("INDIVIDUAL", "individual"), ("BANCADA", "bancada"),
                         ("COMISSAO", "comissao"), ("RELATOR", "relator")):
        if termo in t:
            return valor
    return "desconhecida"


def _modalidade(row: dict) -> str:
    texto = _norm(" ".join(str(row.get(k) or "") for k in
                           ("tipoEmenda", "modalidade", "tipoTransferencia", "instrumento")))
    for termos, valor in (
        (("TRANSFERENCIA ESPECIAL", "PIX"), "especial_pix"),
        (("FINALIDADE DEFINIDA",), "finalidade_definida"),
        (("FUNDO A FUNDO",), "fundo_a_fundo"),
        (("CONVENIO",), "convenio"),
        (("CONTRATO DE REPASSE",), "contrato_repasse"),
    ):
        if any(termo in texto for termo in termos):
            return valor
    return "desconhecida"


def _campo_confirmado(row: dict, *nomes):
    for nome in nomes:
        valor = row.get(nome)
        if valor not in (None, ""):
            return str(valor)
    return None


def _situacao_cancelada(situacao) -> bool:
    s = _norm(situacao)
    return "CANCELAD" in s or "ANULAD" in s


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_token() -> str:
    """Lê a chave da API CGU do arquivo de tokens (fora do repositório)."""
    if _TOKEN_FILE.exists():
        try:
            data = json.loads(_TOKEN_FILE.read_text(encoding="utf-8"))
            tok = data.get("chave-api-dados") or data.get("token") or data.get("key") or ""
            if tok:
                return tok
        except Exception:
            pass
    raise RuntimeError(
        f"Chave API CGU não encontrada em {_TOKEN_FILE}\n"
        "Cadastre em https://portaldatransparencia.gov.br/api e salve "
        'em private/tokens/.portal-transparencia.json como {"chave-api-dados": "SUA_CHAVE"}'
    )


def _api_get(path: str, params: dict, token: str, timeout: int = 30, max_pages: int = 50) -> tuple[list[dict], bool, str]:
    """GET paginado na API CGU. Retorna todos os registros."""
    out: list[dict] = []
    pagina = 1
    while pagina <= max_pages:
        params_pg = {**params, "pagina": pagina}
        url = API_BASE + path + "?" + urllib.parse.urlencode(params_pg)
        req = urllib.request.Request(url, headers={
            "chave-api-dados": token,
            "Accept": "application/json",
            "User-Agent": "FiscalizaVarginha/2.0",
        })
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read())
                if not isinstance(data, list) or not data:
                    break
                out.extend(data)
                if len(data) < 15:
                    break  # última página (a API CGU retorna 15 registros por página)
                pagina += 1
                time.sleep(0.3)  # respeita rate-limit da CGU
        except urllib.error.HTTPError as e:
            print(f"  ! HTTP {e.code} em {path}: {e.reason}")
            return out, False, f"HTTP {e.code}: {e.reason}"
        except Exception as e:
            print(f"  ! Erro em {path}: {e}")
            return out, False, str(e)
    if pagina > max_pages:
        return out, False, f"paginação truncada no limite de {max_pages} páginas (partial)"
    return out, True, ""


# ── 1) Emendas federais via API CGU ──────────────────────────────────────────

def _coletar_emendas_api(token: str) -> tuple[list[dict], bool, str]:
    """Busca emendas parlamentares federais destinadas a Varginha via API CGU.
    Retorna campos: codigoEmenda, tipoEmenda, nomeAutor, funcao, subfuncao,
    valorEmpenhado, valorLiquidado, valorPago."""
    print("  -> API CGU /emendas (Varginha)...")
    rows, ok, erro = _api_get("/emendas", {"codigoMunicipio": IBGE}, token)
    print(f"     {len(rows)} registros obtidos")
    out = []
    for r in rows:
        if not _localidade_confirmada(r):
            continue
        tipo = str(r.get("tipoEmenda", ""))
        item = {
            "codigo": str(r.get("codigoEmenda", "")),
            "ano": str(r.get("ano", "")),
            "tipo": tipo,
            "autor": str(r.get("nomeAutor", "") or r.get("autor", "")),
            "funcao": str(r.get("funcao", "")),
            "subfuncao": str(r.get("subfuncao", "")),
            "localidade": MUNICIPIO_LABEL,
            "valorEmpenhado": _to_float(r.get("valorEmpenhado")),
            "valorLiquidado": _to_float(r.get("valorLiquidado")),
            "valorPago": _to_float(r.get("valorPago")),
            "autoria_tipo": _autoria_tipo(tipo),
            "transferencia_modalidade": _modalidade(r),
            "destino_confirmado": True,
            "nivel_confianca": "alto",
            "granularidade": "emenda_localidade",
            "fonte": "API CGU /emendas",
            "linkFonte": f"https://portaldatransparencia.gov.br/emendas/consulta?codigoEmenda={r.get('codigoEmenda', '')}",
        }
        cargo = _campo_confirmado(r, "cargoAutor", "cargo")
        uf_autor = _campo_confirmado(r, "ufAutor", "siglaUfAutor")
        if cargo:
            item["cargo"] = cargo
        if uf_autor:
            item["uf"] = uf_autor
        out.append(item)
    if rows and not out:
        return [], False, "filtro local rejeitou todos os registros sem destino Varginha/MG confirmado (partial)"
    return out, ok, erro


# ── 2) Convênios via API CGU ──────────────────────────────────────────────────

def _coletar_convenios(token: str) -> tuple[list[dict], bool, str]:
    """Busca convênios federais destinados a Varginha via API CGU."""
    print("  -> API CGU /convenios (Varginha)...")
    rows, ok, erro = _api_get("/convenios", {"codigoIBGE": IBGE}, token)
    print(f"     {len(rows)} registros obtidos")
    out = []
    for r in rows:
        if not _localidade_confirmada(r):
            continue
        convenente_raw = r.get("convenente") or {}
        convenente_nome = (
            convenente_raw.get("nome") if isinstance(convenente_raw, dict)
            else str(convenente_raw or "")
        )
        orgao_raw = r.get("orgao") or {}
        orgao_nome = (
            orgao_raw.get("nome") if isinstance(orgao_raw, dict)
            else str(orgao_raw or "")
        )
        situacao = (r.get("situacao") or {}).get("descricao") if isinstance(r.get("situacao"), dict) else str(r.get("situacao") or "")
        cancelado = _situacao_cancelada(situacao)
        identificador = str(r.get("id") or r.get("dimConvenio") or "")
        out.append({
            "id": identificador,
            "numeroProcesso": str(r.get("numeroProcesso") or ""),
            "orgaoConcedenteNome": str(orgao_nome),
            "convenente": str(convenente_nome),
            "situacao": str(situacao),
            "dataInicioVigencia": str(r.get("dataInicioVigencia") or ""),
            "dataFinalVigencia": str(r.get("dataFinalVigencia") or ""),
            "valor": _to_float(r.get("valor")),
            "valorLiberado": _to_float(r.get("valorLiberado")),
            "valorRecebido": 0.0 if cancelado else _to_float(r.get("valorLiberado")),
            "subfuncao": str(r.get("subfuncao") or ""),
            "fonte": "API CGU /convenios",
            "linkFonte": ("https://portaldatransparencia.gov.br/convenios/consulta?" +
                          urllib.parse.urlencode({"codigoMunicipio": IBGE, "numeroConvenio": identificador})),
            "transferencia_modalidade": _modalidade({**r, "instrumento": "convenio"}),
            "destino_confirmado": True,
            "nivel_confianca": "alto",
            "granularidade": "convenio",
            "cancelado_ou_anulado": cancelado,
        })
    if rows and not out:
        return [], False, "filtro local rejeitou todos os registros sem destino Varginha/MG confirmado (partial)"
    return out, ok, erro


# ── 3) Sancionados (CEIS) ─────────────────────────────────────────────────────

def _coletar_ceis(token: str, cnpjs_alvo: set[str]) -> tuple[list[dict], bool, str]:
    """Busca no CEIS (sancionados) por CNPJ raiz dos fornecedores de Varginha.
    Retorna apenas empresas que constam como sancionadas E receberam de Varginha."""
    if not cnpjs_alvo:
        return [], True, "nenhum fornecedor com CNPJ disponível"
    print(f"  -> API CGU /ceis ({len(cnpjs_alvo)} CNPJs para verificar)...")
    alertas = []
    vistos = set()
    consultados = 0
    for cnpj in list(cnpjs_alvo)[:50]:  # limita para não sobrecarregar a API
        # Uma página basta para o alerta. A API já demonstrou ignorar o filtro e
        # devolver o catálogo inteiro; o filtro local abaixo é a garantia final.
        rows, ok, erro = _api_get(
            "/ceis", {"cnpjSancionado": cnpj}, token, timeout=20, max_pages=1
        )
        if not ok:
            return alertas, False, erro
        consultados += 1
        for r in rows:
            sancionado = r.get("sancionado") or {}
            codigo = str(sancionado.get("codigoFormatado") or "") if isinstance(sancionado, dict) else ""
            codigo_digits = "".join(c for c in codigo if c.isdigit())
            alvo_digits = "".join(c for c in cnpj if c.isdigit())
            # A API pode ignorar cnpjSancionado e devolver o catálogo inteiro.
            # Nunca aceite uma sanção que não corresponda ao CNPJ consultado.
            if not codigo_digits or codigo_digits[:8] != alvo_digits[:8]:
                continue
            nome = sancionado.get("nome") if isinstance(sancionado, dict) else str(sancionado)
            alerta = {
                "cnpj": codigo or cnpj,
                "nome": str(nome or ""),
                "tipoSancao": str((r.get("tipoSancao") or {}).get("descricao") if isinstance(r.get("tipoSancao"), dict) else r.get("tipoSancao") or ""),
                "dataInicioSancao": str(r.get("dataInicioSancao") or r.get("dataSancao") or ""),
                "dataFimSancao": str(r.get("dataFimSancao") or ""),
                "orgaoSancionador": str((r.get("orgaoSancionador") or {}).get("nome") if isinstance(r.get("orgaoSancionador"), dict) else r.get("orgaoSancionador") or ""),
                "fundamentacao": str(r.get("fundamentacao") or ""),
                "fonte": "CGU CEIS",
                "linkFonte": "https://portaldatransparencia.gov.br/sancoes/consulta?tipoPessoa=J",
            }
            chave = (
                codigo_digits,
                alerta["tipoSancao"],
                alerta["dataInicioSancao"],
                alerta["orgaoSancionador"],
            )
            if chave not in vistos:
                vistos.add(chave)
                alertas.append(alerta)
        time.sleep(0.2)
    print(f"     {consultados} CNPJs consultados -> {len(alertas)} sanções encontradas")
    return alertas, True, ""


# ── Carrega CNPJs dos fornecedores Betha (para cruzamento CEIS) ───────────────

def _load_cnpjs_betha() -> set[str]:
    """Lê os CNPJs raiz dos top fornecedores da Prefeitura (chunk gerado pelo coletor_betha)."""
    candidatos: set[str] = set()
    for nome_chunk in ("prefeitura.json", "federal.json"):
        chunk = DATA / "chunks" / nome_chunk
        if not chunk.exists():
            chunk = DATA / nome_chunk
        if not chunk.exists():
            continue
        try:
            payload = json.loads(chunk.read_text(encoding="utf-8"))
            top = payload.get("top_fornecedores_atual") or payload.get("topFornecedores") or payload.get("fornecedores") or []
            for item in top:
                cnpj = str(item.get("cnpj") or "")
                raiz = "".join(c for c in cnpj if c.isdigit())[:14]
                if len(raiz) >= 8:
                    candidatos.add(raiz)
        except Exception:
            pass
    return candidatos


# ── Resumo ─────────────────────────────────────────────────────────────────────

def _resumo(emendas: list[dict], convenios: list[dict], alertas_ceis: list[dict]) -> dict:
    total_empenhado = sum(e["valorEmpenhado"] for e in emendas)
    total_liquidado = sum(e["valorLiquidado"] for e in emendas)
    total_pago = sum(e["valorPago"] for e in emendas)
    validos = [c for c in convenios if not c.get("cancelado_ou_anulado")]
    total_convenios = sum(c["valor"] for c in validos)
    total_recebido = sum(c["valorRecebido"] for c in validos)
    convenios_ativos = [c for c in validos if "EXECUC" in _norm(c.get("situacao")) or "VIGENTE" in _norm(c.get("situacao"))]

    return {
        "municipio": "Varginha-MG",
        "codigoIbge": IBGE,
        "atualizadoEm": dt.datetime.now().strftime("%d/%m/%Y %H:%M"),
        "emendas": {
            "qtd": len(emendas),
            "totalEmpenhado": round(total_empenhado, 2),
            "totalLiquidado": round(total_liquidado, 2),
            "totalPago": round(total_pago, 2),
        },
        "convenios": {
            "qtd": len(convenios),
            "qtdAtivos": len(convenios_ativos),
            "totalValor": round(total_convenios, 2),
            "totalRecebido": round(total_recebido, 2),
        },
        "alertasCeis": {
            "qtd": len(alertas_ceis),
            "descricao": "Fornecedores de Varginha com sanção federal (CEIS/CGU)",
        },
        "fontes": [
            "Portal da Transparência Federal (CGU) — api.portaldatransparencia.gov.br",
            "CEIS — Cadastro de Empresas Inidôneas e Suspensas (CGU)",
        ],
        "nota": (
            "Dados obtidos diretamente da API oficial do Portal da Transparência (CGU). "
            "Valores em Reais. Indicação, empenho, liquidação e pagamento são estágios distintos. "
            "Convênio é acordo específico; valor pactuado e valor liberado são exibidos separadamente. "
            "CEIS = empresa sancionada que recebeu recursos municipais (alerta para conferência)."
        ),
    }


# ── Principal ──────────────────────────────────────────────────────────────────

def coletar() -> dict:
    print("⇣ Coletor Federal — Portal da Transparência (CGU)...")
    try:
        token = _load_token()
        print("  Token CGU carregado.")
    except RuntimeError as e:
        print(f"  ! {e}")
        return _fallback()

    emendas, emendas_ok, emendas_erro = _coletar_emendas_api(token)
    convenios, convenios_ok, convenios_erro = _coletar_convenios(token)

    existente = _fallback(silencioso=True)
    anteriores_emendas = existente.get("emendas_api") or []
    anteriores_convenios = existente.get("convenios") or []
    anteriores_emendas_validas = bool(anteriores_emendas) and all(
        item.get("destino_confirmado") is True for item in anteriores_emendas
    )
    anteriores_convenios_validos = bool(anteriores_convenios) and all(
        item.get("destino_confirmado") is True for item in anteriores_convenios
    )

    emendas_status = "ok"
    convenios_status = "ok"
    if not emendas_ok or not emendas:
        if anteriores_emendas_validas:
            emendas = anteriores_emendas
            emendas_status = "preservado"
        else:
            emendas = []
            emendas_status = "partial" if "partial" in emendas_erro else "erro"
    if not convenios_ok or not convenios:
        if anteriores_convenios_validos:
            convenios = anteriores_convenios
            convenios_status = "preservado"
        else:
            convenios = []
            convenios_status = "partial" if "partial" in convenios_erro else "erro"

    tinha_dados_emendas = len(anteriores_emendas) > 0
    if convenios_status in ("erro", "partial") or (emendas_status in ("erro", "partial") and tinha_dados_emendas):
        raise RuntimeError(
            f"Falha critica na coleta federal (dados parciais/erro): "
            f"emendas={emendas_status} (tinha={tinha_dados_emendas}, erro={emendas_erro}), "
            f"convenios={convenios_status} (erro={convenios_erro})"
        )

    # Cruzamento CEIS apenas com CNPJs reais dos fornecedores Betha
    cnpjs_betha = _load_cnpjs_betha()
    alertas_ceis, ceis_ok, ceis_erro = _coletar_ceis(token, cnpjs_betha)
    if not ceis_ok and existente.get("alertas_ceis"):
        alertas_ceis = existente["alertas_ceis"]

    payload = {
        "fonte": "Portal da Transparência Federal (CGU) — api.portaldatransparencia.gov.br",
        "atualizado_em": dt.datetime.now().isoformat(),
        "resumo": _resumo(emendas, convenios, alertas_ceis),
        "emendas_api": emendas,
        "convenios": convenios,
        "alertas_ceis": alertas_ceis,
        "sancoes_fornecedores": alertas_ceis,
        "status_fontes": {
            "emendas": {"status": emendas_status, "motivo": emendas_erro},
            "convenios": {"status": convenios_status, "motivo": convenios_erro},
            "ceis": {"status": "ok" if ceis_ok else "preservado", "motivo": ceis_erro},
        },
        "links_auditoria": [
            {
                "titulo": "Transferências para Varginha (Portal da Transparência)",
                "url": f"https://portaldatransparencia.gov.br/localidades/{IBGE}",
                "desc": "Resumo de todos os recursos federais que entraram no município.",
            },
            {
                "titulo": "Convênios Federais em Varginha",
                "url": "https://portaldatransparencia.gov.br/convenios/consulta?codigoMunicipio=3170701",
                "desc": "Acordos específicos para obras e projetos (asfalto, prédios, equipamentos).",
            },
            {
                "titulo": "Emendas Parlamentares Federais para Varginha",
                "url": "https://portaldatransparencia.gov.br/emendas/consulta?codigoMunicipio=3170701",
                "desc": "Verbas enviadas por Deputados Federais e Senadores para a cidade.",
            },
            {
                "titulo": "Emendas Pix (Transferências Especiais) para Varginha",
                "url": f"https://portaldatransparencia.gov.br/transferencias-especiais?codigoMunicipio={IBGE}",
                "desc": "Emendas sem destinação obrigatória — Pix direto para a Prefeitura.",
            },
        ],
    }
    return payload


def _fallback(silencioso: bool = False) -> dict:
    """Retorna payload mínimo quando a API não está disponível, preservando dados existentes."""
    existente_path = DATA / "chunks" / "federal.json"
    if not existente_path.exists():
        existente_path = DATA / "federal.json"
    if existente_path.exists():
        try:
            existente = json.loads(existente_path.read_text(encoding="utf-8"))
            existente["_preservado"] = True
            existente["_motivo"] = "API CGU indisponível — dado preservado da última coleta"
            if not silencioso:
                print("  ! Retornando dado preservado da última coleta federal.")
            return existente
        except Exception:
            pass
    return {
        "fonte": "Portal da Transparência Federal (CGU)",
        "atualizado_em": dt.datetime.now().isoformat(),
        "resumo": {"erro": "API CGU indisponível. Verifique a chave em private/tokens/.portal-transparencia.json"},
        "emendas_api": [],
        "convenios": [],
        "alertas_ceis": [],
        "links_auditoria": [],
    }


def salvar(payload: dict | None = None) -> dict:
    payload = payload or coletar()
    out = DATA / "federal.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    chunks_dir = DATA / "chunks"
    chunks_dir.mkdir(exist_ok=True)
    (chunks_dir / "federal.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print("  OK: federal.json salvo.")
    return payload


if __name__ == "__main__":
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    salvar()
