# -*- coding: utf-8 -*-
"""Coletor de sanções CEIS/CNEP (Portal da Transparência federal).

Cruza fornecedores e contratados do município contra o CEIS (Cadastro de
Empresas Inidôneas e Suspensas) e o CNEP (Cadastro Nacional de Empresas
Punidas). Fornecedor com sanção vigente recebendo dinheiro público é o
alerta de maior severidade do painel.

Método: a API ignora o filtro por CNPJ, mas filtra por nomeSancionado.
Consultamos por token distintivo do nome e confirmamos o match localmente
por raiz de CNPJ (8 dígitos — visível mesmo mascarado por LGPD) ou por
nome normalizado. Falso positivo aqui seria acusação injusta: só entra no
resultado o que casar por CNPJ ou por nome inteiro.

Saída: data/chunks/sancoes.json
Chave da API: private/cgu_api_key.txt (cadastro gratuito no Portal da
Transparência). Sem chave, o coletor preserva o chunk anterior.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
CHUNKS = ROOT / "data" / "chunks"
KEY_PATH = ROOT.parent / "private" / "cgu_api_key.txt"
OUT_PATH = CHUNKS / "sancoes.json"

API = "https://api.portaldatransparencia.gov.br/api-de-dados"
# Limite oficial diurno: 90 req/min. Ficamos folgados.
PAUSA_SEGUNDOS = 0.8

STOPWORDS = {
    "LTDA", "ME", "EPP", "SA", "S", "A", "EIRELI", "CIA", "E", "DE", "DA",
    "DO", "DAS", "DOS", "COMERCIO", "SERVICOS", "SERVICO", "EMPRESA",
    "BRASILEIRA", "MUNICIPAL", "VARGINHA", "LOCACOES", "LOCACAO",
    "CONSTRUCOES", "CONSTRUTORA", "TRANSPORTES", "ALIMENTOS", "SISTEMAS",
}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").upper())
    s = s.encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]", " ", s)).strip()


def _cnpj_raiz(s: str) -> str:
    return "".join(c for c in (s or "") if c.isdigit())[:8]


def _token_distintivo(nome: str) -> str:
    """Token mais raro do nome para a consulta por nomeSancionado."""
    tokens = [t for t in _norm(nome).split() if len(t) >= 4 and t not in STOPWORDS]
    if not tokens:
        tokens = [t for t in _norm(nome).split() if len(t) >= 3]
    if not tokens:
        return ""
    # O mais longo tende a ser o mais distintivo (razões sociais brasileiras)
    return max(tokens, key=len)


def _api_get(caminho: str, params: dict, chave: str) -> list:
    url = f"{API}/{caminho}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "chave-api-dados": chave,
        "Accept": "application/json",
        "User-Agent": "FiscalizaVarginha/1.0 (transparencia municipal)",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data if isinstance(data, list) else []


def _ler_json(path: Path) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _carregar_verificacoes_manuais() -> dict:
    """Le painel-cidadao/data/verificacoes_manuais.json (mantido a mao,
    versionado) e devolve dict cnpj_raiz -> registro de verificacao. Arquivo
    separado da coleta automatica para que a verificacao humana sobreviva ao
    proximo ciclo, que sobrescreve sancoes.json inteiro."""
    dados = _ler_json(ROOT / "data" / "verificacoes_manuais.json")
    out = {}
    for v in dados.get("verificacoes", []):
        raiz = "".join(c for c in str(v.get("cnpj_raiz", "")) if c.isdigit())
        if raiz:
            out[raiz] = v
    return out


def coletar_universo() -> list[dict]:
    """Fornecedores e contratados a verificar: tops de despesa + contratos
    vigentes + base cadastral. Dedup por raiz de CNPJ (ou nome)."""
    pref = _ler_json(CHUNKS / "prefeitura.json")
    cam = _ler_json(CHUNKS / "camara_betha.json")
    cnpjs = _ler_json(CHUNKS / "cnpjs.json")
    licit = _ler_json(CHUNKS / "licitacoes_resultados.json")

    universo: dict[str, dict] = {}

    def add(nome: str, cnpj: str, origem: str):
        nome = (nome or "").strip()
        if not nome:
            return
        chave = _cnpj_raiz(cnpj) or _norm(nome)
        if not chave:
            return
        item = universo.setdefault(chave, {
            "nome": nome, "cnpj_raiz": _cnpj_raiz(cnpj), "origens": [],
        })
        if origem not in item["origens"]:
            item["origens"].append(origem)

    for f in pref.get("top_fornecedores_atual", []) or []:
        add(f.get("nome"), f.get("cnpj"), "despesa_prefeitura")
    for f in cam.get("top_fornecedores_atual", []) or []:
        add(f.get("nome"), f.get("cnpj"), "despesa_camara")
    for c in pref.get("contratos_vigentes", []) or pref.get("contratos", []) or []:
        add(c.get("contratado"), c.get("cnpj"), "contrato_prefeitura")
    for c in cam.get("contratos", []) or []:
        add(c.get("contratado"), c.get("cnpj"), "contrato_camara")
    for e in cnpjs.get("empresas", []) or []:
        add(e.get("razao_social"), e.get("cnpj"), "base_cadastral")
    for compra in licit.get("registros", []) or []:
        for r in compra.get("resultados", []) or []:
            add(r.get("vencedor"), r.get("cnpj_vencedor"), "vencedor_licitacao")

    return list(universo.values())


def casa(sancionado: dict, fornecedor: dict) -> bool:
    """Match conservador: raiz de CNPJ igual, ou nome normalizado igual.
    Contenção parcial de nome NÃO basta — evitaria acusação injusta."""
    p = sancionado.get("pessoa") or {}
    raiz_s = _cnpj_raiz(p.get("cnpjFormatado") or p.get("codigoFormatado") or "")
    if raiz_s and fornecedor["cnpj_raiz"]:
        return raiz_s == fornecedor["cnpj_raiz"]
    nome_s = _norm(p.get("nome") or p.get("razaoSocialReceita") or "")
    nome_f = _norm(fornecedor["nome"])
    return bool(nome_s) and nome_s == nome_f


def _resumo_sancao(s: dict, base: str) -> dict:
    p = s.get("pessoa") or {}
    orgao = s.get("orgaoSancionador") or {}
    return {
        "base": base,
        "sancionado": p.get("nome") or p.get("razaoSocialReceita") or "",
        "cnpj": p.get("cnpjFormatado") or "",
        "tipo": (s.get("tipoSancao") or {}).get("descricaoResumida") or "",
        "data_inicio": s.get("dataInicioSancao") or "",
        "data_fim": s.get("dataFimSancao") or "",
        "orgao_sancionador": orgao.get("nome") or "",
        "uf_orgao": orgao.get("siglaUf") or "",
        "fundamentacao": ((s.get("fundamentacao") or [{}])[0] or {}).get("descricao", "")[:200],
    }


def _vigente(s: dict, hoje: str) -> bool:
    fim = (s.get("dataFimSancao") or "").strip()
    # Sem data de fim = sanção por prazo indeterminado (ex.: inidoneidade)
    if not fim:
        return True
    try:
        return datetime.strptime(fim, "%d/%m/%Y").date().isoformat() >= hoje
    except ValueError:
        return fim >= hoje  # já em ISO


def main() -> int:
    if not KEY_PATH.exists():
        print("⚠️ Sem chave da API CGU (private/cgu_api_key.txt) — chunk anterior preservado.")
        return 0
    chave = KEY_PATH.read_text(encoding="utf-8").strip()

    universo = coletar_universo()
    print(f"🔎 CEIS/CNEP: verificando {len(universo)} fornecedores/contratados…")

    hoje = datetime.now().date().isoformat()
    cache_consulta: dict[tuple[str, str], list] = {}
    achados: list[dict] = []
    erros: list[str] = []
    consultas = 0

    for forn in universo:
        token = _token_distintivo(forn["nome"])
        if not token:
            continue
        for base, caminho in (("CEIS", "ceis"), ("CNEP", "cnep")):
            chave_cache = (base, token)
            if chave_cache not in cache_consulta:
                try:
                    cache_consulta[chave_cache] = _api_get(
                        caminho, {"nomeSancionado": token, "pagina": 1}, chave)
                    consultas += 1
                    time.sleep(PAUSA_SEGUNDOS)
                except Exception as e:
                    erros.append(f"{base}/{token}: {e}")
                    cache_consulta[chave_cache] = []
            for s in cache_consulta[chave_cache]:
                if casa(s, forn):
                    item = _resumo_sancao(s, base)
                    item["fornecedor_local"] = forn["nome"]
                    item["cnpj_raiz"] = forn["cnpj_raiz"]
                    item["origens"] = forn["origens"]
                    item["sancao_vigente"] = _vigente(s, hoje)
                    if item not in achados:
                        achados.append(item)

    # Rastreabilidade: acha grave verificado manualmente contra a fonte
    # primaria (CGU) carrega o registro — nao fica so na conversa. Sobrevive
    # a esta mesma coleta (que sobrescreve sancoes.json) porque o registro
    # mora em verificacoes_manuais.json, versionado e mantido a parte.
    verificacoes = _carregar_verificacoes_manuais()
    for item in achados:
        v = verificacoes.get(item.get("cnpj_raiz", ""))
        if v:
            item["verificacao_manual"] = v

    # Guarda-chuva: se o universo verificado desabar (universo vazio/quebrado
    # ou API do CGU falhando em bloco), nao sobrescreve uma base saudavel
    # anterior com achados quase vazios — mesma classe de incidente que
    # ocorreu com licitacoes_resultados.json em 20/07/2026.
    if len(universo) < 200 and OUT_PATH.exists():
        try:
            anterior = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except Exception:
            anterior = {}
        if isinstance(anterior, dict) and (anterior.get("verificados") or 0) >= 500:
            print(f"⚠️ Universo verificado caiu para {len(universo)} (base anterior tinha "
                  f"{anterior['verificados']}) — preservando base anterior, nao sobrescrevendo.")
            return 0

    vigentes = [a for a in achados if a["sancao_vigente"]]
    payload = {
        "fonte": "Portal da Transparencia (CGU) - CEIS e CNEP",
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "metodo": ("Consulta por nome na API api-de-dados; confirmacao local por "
                   "raiz de CNPJ ou nome normalizado identico. Cobertura limitada "
                   "a fornecedores com nome consultavel — nao e prova de ausencia "
                   "de sancao."),
        "verificados": len(universo),
        "consultas_api": consultas,
        "sancoes_encontradas": len(achados),
        "sancoes_vigentes": len(vigentes),
        "achados": achados,
        "erros": erros[:20],
    }
    _tmp = OUT_PATH.with_name(f".{OUT_PATH.name}.tmp{os.getpid()}")
    _tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(_tmp, OUT_PATH)
    print(f"✓ {len(universo)} verificados em {consultas} consultas — "
          f"{len(achados)} sanção(ões), {len(vigentes)} vigente(s). → sancoes.json")
    if vigentes:
        for v in vigentes[:5]:
            print(f"  🚨 {v['fornecedor_local']}: {v['tipo']} ({v['base']}, "
                  f"{v['orgao_sancionador']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
