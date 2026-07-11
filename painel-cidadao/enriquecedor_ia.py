"""Enriquecedor de publicações com IA (Gemini).

Recebe um item bruto (ato do Diário Oficial ou matéria da Câmara) e devolve os
campos "cidadãos": resumo acessível, pontos de atenção, relevância/interesse
público, "por que acompanhar" etc. — a camada que falta para Varginha chegar no
formato estruturado do projeto de Jaraguá do Sul.

Princípios:
- SEGURANÇA: a chave Gemini é lida de GEMINI_API_KEY (variável de ambiente) ou de
  um arquivo local fora do git. NUNCA hardcode a chave neste arquivo.
- TOLERANTE A FALHA: sem chave ou com erro de rede, devolve um enriquecimento
  mínimo (degradado, baseado em regras) para a coleta nunca quebrar.
- CACHE: resultados são guardados por hash do conteúdo em data/cache_ia/, para
  não reprocessar nem pagar Gemini à toa em cada coleta diária.
"""
from __future__ import annotations

import json
import os
import re
import time
import hashlib
import urllib.request
import urllib.error
from pathlib import Path

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "{model}:generateContent?key={key}"
)

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / "data" / "cache_ia"

# Versão do enriquecimento. Suba quando mudar o prompt/schema para invalidar o
# cache antigo sem apagar arquivos na mão.
ENRICH_VERSION = "v2"

# Rate limiting. Free tier do Gemini limita a ~20 req/min (intervalo 3.3s ≈
# 18/min). No paid tier o limite sobe muito — passe GEMINI_RATE=0.4 (ou menos)
# para acelerar o backfill. _cota_acabou só liga após várias 429 seguidas
# (cota diária real), não por um pico isolado do limite por minuto.
_MIN_INTERVALO = float(os.getenv("GEMINI_RATE", "3.3"))
_ultima_chamada = [0.0]
_cota_acabou = [False]
_falhas_429 = [0]
_MAX_FALHAS_429 = 5


def _api_key() -> str:
    """Chave Gemini, na ordem: env var > arquivo local fora do git.
    Retorna "" se não houver — o chamador cai no fallback sem IA."""
    k = os.getenv("GEMINI_API_KEY")
    if k and k.strip():
        return k.strip()
    # Arquivos locais aceitos (todos gitignorados). Inclui o gemini_key.php que
    # o usuário já conhece do servidor — basta colar a chave nele.
    candidatos = [
        ROOT.parent / "gemini_key.txt",      # uma pasta acima do projeto
        ROOT / "gemini_key.local",           # dentro do painel-cidadao
        ROOT.parent / "gemini_key.php",      # template que já existe na raiz
        ROOT / "gemini_key.php",
    ]
    for p in candidatos:
        try:
            if p.exists():
                conteudo = p.read_text(encoding="utf-8").strip()
                if "COLE_SUA_CHAVE" in conteudo:
                    continue  # ainda é o template, não preenchido
                # aceita a chave pura ou a linha $apiKey = '...';
                # classe ampla (inclui '.') p/ não tropeçar em formatos variados
                m = re.search(r"['\"]([^'\"\s]{20,})['\"]", conteudo)
                if m:
                    return m.group(1)
                if conteudo and len(conteudo) >= 20 and "\n" not in conteudo:
                    return conteudo
        except Exception:
            pass
    return ""


# ----------------------------- cache em disco ----------------------------- #

def _cache_key(item: dict) -> str:
    base = "|".join([
        ENRICH_VERSION,
        str(item.get("fonte", "")),
        str(item.get("tipo", "")),
        str(item.get("titulo", "")),
        str(item.get("texto", ""))[:4000],
    ])
    return hashlib.sha1(base.encode("utf-8")).hexdigest()


def _cache_get(chave: str):
    f = CACHE_DIR / f"{chave}.json"
    if f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def _cache_set(chave: str, valor: dict) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (CACHE_DIR / f"{chave}.json").write_text(
            json.dumps(valor, ensure_ascii=False), encoding="utf-8"
        )
    except Exception:
        pass


# ------------------------------- prompt ----------------------------------- #

# Campos que a IA deve devolver. responseSchema garante JSON parseável.
_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "resumo": {"type": "string"},
        "o_que_propoe": {"type": "string"},
        "por_que_acompanhar": {"type": "array", "items": {"type": "string"}},
        "pontos_atencao": {"type": "array", "items": {"type": "string"}},
        "interesse_publico": {"type": "string", "enum": ["alto", "medio", "baixo"]},
        "tema": {"type": "string"},
        "valor_principal": {"type": "string"},
    },
    "required": ["resumo", "interesse_publico", "tema", "valor_principal"],
}


def _prompt(item: dict) -> str:
    fonte = item.get("fonte", "")
    contexto = (
        "uma matéria legislativa da Câmara Municipal de Varginha-MG"
        if fonte == "camara"
        else "um ato publicado no Diário Oficial da Prefeitura de Varginha-MG"
    )
    return (
        "Você é um analista de transparência pública. Resuma para o cidadão comum "
        f"{contexto}, de forma NEUTRA e factual — informar, não acusar. Não invente "
        "dados que não estejam no texto.\n\n"
        f"Tipo: {item.get('tipo','')}\n"
        f"Identificação: {item.get('titulo','')}\n"
        f"Autor/Órgão: {item.get('autor','')}\n"
        f"Data: {item.get('data','')}\n"
        f"Texto/Ementa:\n{(item.get('texto') or '')[:6000]}\n\n"
        "Responda em JSON com:\n"
        "- resumo: 1-2 frases simples explicando o que é (linguagem acessível);\n"
        "- o_que_propoe: o que muda na prática, 1-2 frases (vazio se não souber);\n"
        "- por_que_acompanhar: 2 a 3 motivos cívicos objetivos para o cidadão acompanhar;\n"
        "- pontos_atencao: 1 a 3 pontos de atenção (impacto orçamentário, "
        "sem licitação, beneficiário, prazo etc.);\n"
        "- interesse_publico: 'alto', 'medio' ou 'baixo';\n"
        "- tema: uma palavra-chave (ex.: orçamento, saúde, educação, tributos, "
        "mobilidade, pessoal);\n"
        "- valor_principal: o valor monetário principal do ato/contrato (apenas o número "
        "formatado, ex.: '2.404.755,50' ou '60.000,00'). Ignore tabelas de projeções futuras "
        "ou valores secundários. Se não houver valor principal ou for ato geral, deixe vazio."
    )


def _rate_limit() -> None:
    dt = _MIN_INTERVALO - (time.time() - _ultima_chamada[0])
    if dt > 0:
        time.sleep(dt)
    _ultima_chamada[0] = time.time()


def _retry_delay(err: urllib.error.HTTPError) -> float:
    """Segundos sugeridos pela API no corpo do 429 (campo retryDelay)."""
    try:
        body = json.loads(err.read().decode("utf-8"))
        for d in body.get("error", {}).get("details", []):
            if "RetryInfo" in d.get("@type", ""):
                m = re.match(r"(\d+)", str(d.get("retryDelay", "")))
                if m:
                    return float(m.group(1))
    except Exception:
        pass
    return 0.0


def _chamar_gemini(item: dict, key: str, _tentativa: int = 0) -> dict:
    payload = {
        "contents": [{"parts": [{"text": _prompt(item)}]}],
        "generationConfig": {
            "temperature": 0.2,
            "response_mime_type": "application/json",
            "response_schema": _RESPONSE_SCHEMA,
        },
    }
    url = GEMINI_URL.format(model=GEMINI_MODEL, key=key)
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    _rate_limit()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            resp = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as ex:
        # 429 = limite por minuto: espera o delay sugerido e tenta 1× mais.
        if ex.code == 429 and _tentativa == 0:
            delay = _retry_delay(ex)
            if 0 < delay <= 65:
                time.sleep(delay + 1)
                return _chamar_gemini(item, key, _tentativa=1)
        raise
    texto = (
        resp.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )
    dados = json.loads(texto)
    return _normaliza(dados, fonte="ia")


# ------------------------------- fallback --------------------------------- #

# Palavras que sugerem alto interesse público quando não há IA.
_ALTO = re.compile(
    r"\b(or[çc]ament|cr[ée]dito|tribut|imposto|taxa|sa[úu]de|educa[çc]|"
    r"licita|contrat|d[íi]vida|emenda|cargo|sal[áa]rio|conv[êe]ni|"
    r"isen[çc]|aliquota|al[íi]quota)\w*", re.IGNORECASE,
)


def _fallback(item: dict, erro: str = "") -> dict:
    """Enriquecimento mínimo sem IA — mantém a estrutura válida para testar o
    pipeline e degrada sem quebrar quando não há chave/rede."""
    texto = (item.get("texto") or "").strip()
    resumo = re.sub(r"\s+", " ", texto)[:240]
    interesse = "alto" if _ALTO.search(texto) else "medio"
    return _normaliza({
        "resumo": resumo or item.get("titulo", ""),
        "o_que_propoe": "",
        "por_que_acompanhar": [],
        "pontos_atencao": [],
        "interesse_publico": interesse,
        "tema": "",
        "_modo": "fallback" + (f":{erro[:60]}" if erro else ""),
    }, fonte="fallback")


def _normaliza(d: dict, fonte: str) -> dict:
    def _lista(x):
        if isinstance(x, list):
            return [str(i).strip() for i in x if str(i).strip()][:4]
        if isinstance(x, str) and x.strip():
            return [x.strip()]
        return []
    interesse = str(d.get("interesse_publico", "medio")).lower().strip()
    if interesse not in ("alto", "medio", "baixo"):
        interesse = "medio"
    return {
        "resumo": str(d.get("resumo", "")).strip(),
        "o_que_propoe": str(d.get("o_que_propoe", "")).strip(),
        "por_que_acompanhar": _lista(d.get("por_que_acompanhar")),
        "pontos_atencao": _lista(d.get("pontos_atencao")),
        "interesse_publico": interesse,
        "tema": str(d.get("tema", "")).strip().lower(),
        "valor_principal": str(d.get("valor_principal", "")).strip(),
        "_origem_ia": fonte,
        **({"_modo": d["_modo"]} if d.get("_modo") else {}),
    }


# ------------------------------- API pública ------------------------------ #

def enriquecer(item: dict, usar_cache: bool = True) -> dict:
    """Enriquece um item bruto. item = {fonte, tipo, titulo, texto, autor, data}.
    Devolve sempre um dict válido (IA, cache ou fallback)."""
    chave = _cache_key(item)
    if usar_cache:
        cached = _cache_get(chave)
        if cached is not None:
            return cached
    key = _api_key()
    if not key or _cota_acabou[0]:
        res = _fallback(item)
    else:
        try:
            res = _chamar_gemini(item, key)
            _falhas_429[0] = 0  # sucesso reseta o contador de falhas
        except urllib.error.HTTPError as e:
            # Se for erro de permissão (403) ou chave inválida (400), desativa a IA para
            # o restante da execução para evitar lentidão extrema de timeouts/rate limiting.
            if e.code in (403, 400):
                _cota_acabou[0] = True
            # Conta 429 seguidas. Só desiste após várias (cota diária real) —
            # um pico isolado do limite por minuto não derruba a execução toda.
            elif e.code == 429:
                _falhas_429[0] += 1
                if _falhas_429[0] >= _MAX_FALHAS_429:
                    _cota_acabou[0] = True
            res = _fallback(item, erro=f"HTTP {e.code}")
        except Exception as e:
            res = _fallback(item, erro=str(e))
    # Só cacheia resultado de IA real. Fallback é degradado e deve ser
    # reprocessado quando a chave/rede voltar — não polui o cache.
    if res.get("_origem_ia") == "ia":
        _cache_set(chave, res)
    return res


def tem_ia() -> bool:
    """True se há chave Gemini configurada (para logs/diagnóstico)."""
    return bool(_api_key())
