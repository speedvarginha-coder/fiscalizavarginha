"""Coletor de publicações estruturadas — Fase 2: Diário Oficial (PDF).

Baixa o PDF de cada edição do Diário Oficial de Varginha, extrai o texto,
separa ATO POR ATO (regex de cabeçalho) e estrutura cada um no schema único —
dados duros (CNPJ, valores) por regex; resumo cidadão e pontos de atenção pela
IA (enriquecedor_ia). Mesmo schema da Câmara → alimenta painel + WhatsApp.

Uso:
    python coletor_diario.py --edicoes 3          # mescla 3 edições mais recentes
    python coletor_diario.py --edicoes 0 --full   # refaz todas as edições

Saída: data/chunks/publicacoes_diario.json
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from pypdf import PdfReader

import enriquecedor_ia

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
DIARIO_JSON = ROOT / "data" / "chunks" / "diario.json"
SAIDA = ROOT / "data" / "chunks" / "publicacoes_diario.json"
CACHE_PDF = ROOT / "data" / "cache_diario"   # texto extraído por edição
BASE = "https://www.varginha.mg.gov.br"
UA = {"User-Agent": "Mozilla/5.0 (ZelaVarginha)"}

# Tipos de ato aceitos (todos os 4 grupos escolhidos pelo usuário).
TIPOS_ACEITOS = {"contrato", "aditivo", "licitacao", "dispensa", "inexigibilidade",
                 "pessoal", "norma"}

TIPOS_PAT = (
    r"LEI\s+COMPLEMENTAR|LEI|DECRETO\s+LEGISLATIVO|DECRETO|PORTARIA|"
    r"RESOLU[ÇC][ÃA]O|EXTRATO\s+D[EO]\s+[\wÇÃÕÂÊÉÚÓÁÍ\s]{3,40}?|"
    r"EDITAL(?:\s+D[EO]\s+[\wÇÃÕÂÊÉÚÓÁÍ]+)?|AVISO\s+D[EO]\s+[\wÇÃÕÂÊÉÚÓÁÍ\s]{3,30}?|"
    r"T[EÊ]RMO\s+ADITIVO|DISPENSA\s+D[EO]\s+LICITA[ÇC][ÃA]O|INEXIGIBILIDADE|"
    r"HOMOLOGA[ÇC][ÃA]O|RATIFICA[ÇC][ÃA]O|ATA\s+DE\s+REGISTRO"
)
CABECALHO = re.compile(r"^\s*(" + TIPOS_PAT + r")\s+N?[º°]?\s*[\d./-]{2,}",
                       re.MULTILINE | re.IGNORECASE)

CNPJ_RE = re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b")
MONEY_RE = re.compile(r"R\$\s*([\d.]+,\d{2})")
NUM_ATO_RE = re.compile(r"N?[º°]?\s*([\d.]+/?\d*)")
# Razão social: nome seguido de sufixo societário/entidade. Bem mais preciso
# que "EMPRESA: ..." (que pegava frases inteiras do texto).
RAZAO_RE = re.compile(
    r"\b([A-ZÀ-Ú][A-Za-zÀ-ú0-9&.,'\-/ ]{3,70}?\s"
    r"(?:LTDA|EIRELI|EPP|S/A|S\.A\.?|\bME\b|MEI|ASSOCIA[ÇC][ÃA]O|"
    r"INSTITUTO|FUNDA[ÇC][ÃA]O|COOPERATIVA|SOCIEDADE)"
    r"\b\.?(?:\s*[-–]\s*(?:EPP|ME))?)"
)


def _get(url: str, timeout: int = 45) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


def _baixar_texto(publicacao_id: int) -> tuple[str, str, str]:
    """Retorna (texto, url_pdf, url_leitor). Usa cache de texto por edição."""
    leitor = f"{BASE}/portal/diario-oficial/ver/{publicacao_id}/"
    cache = CACHE_PDF / f"{publicacao_id}.txt"
    if cache.exists():
        return cache.read_text(encoding="utf-8"), "", leitor
    html = _get(leitor).decode("utf-8", "replace")
    m = re.search(r'href="(/portal/download/diario-oficial/[^"]+)"', html)
    if not m:
        return "", "", leitor
    ref = _get(BASE + m.group(1)).decode("utf-8", "replace")
    m2 = re.search(r"url=([^'\"]+\.pdf)", ref)
    if not m2:
        return "", "", leitor
    url_pdf = BASE + m2.group(1)
    reader = PdfReader(io.BytesIO(_get(url_pdf)))
    texto = "\n".join((p.extract_text() or "") for p in reader.pages)
    CACHE_PDF.mkdir(parents=True, exist_ok=True)
    cache.write_text(texto, encoding="utf-8")
    return texto, url_pdf, leitor


def _classifica(titulo: str) -> tuple[str, str]:
    """Retorna (tipo_norm, rótulo legível)."""
    t = titulo.upper()
    if "ADITIVO" in t:
        return "aditivo", "Termo aditivo"
    if t.startswith("EXTRATO") and "CONTRATO" in t:
        return "contrato", "Extrato de contrato"
    if "DISPENSA" in t:
        return "dispensa", "Dispensa de licitação"
    if "INEXIG" in t:
        return "inexigibilidade", "Inexigibilidade"
    if "EDITAL" in t or "PREG" in t or "CONCORR" in t or "HOMOLOGA" in t or "ATA DE REGISTRO" in t:
        return "licitacao", "Licitação"
    if "PORTARIA" in t:
        return "pessoal", "Portaria"
    if t.startswith("LEI"):
        return "norma", "Lei"
    if t.startswith("DECRETO"):
        return "norma", "Decreto"
    if "RESOLU" in t:
        return "norma", "Resolução"
    return "outro", "Ato"


def _segmentar(texto: str) -> list[tuple[str, str, str, str]]:
    """[(tipo_norm, rótulo, título, trecho)] dos atos do texto."""
    matches = list(CABECALHO.finditer(texto))
    out = []
    for i, m in enumerate(matches):
        ini = m.start()
        fim = matches[i + 1].start() if i + 1 < len(matches) else len(texto)
        trecho = texto[ini:fim].strip()
        titulo = re.sub(r"\s+", " ", trecho.split("\n")[0])[:120]
        tipo, rotulo = _classifica(titulo)
        out.append((tipo, rotulo, titulo, trecho))
    return out


def _valor_brl(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


def _parse_ia_valor(val_str: str) -> float | None:
    if not val_str:
        return None
    val_clean = val_str.lower().strip()

    # Se tem palavra de milhão/bilhão
    multiplicador = 1.0
    if "milh" in val_clean: # milhão, milhões, milhoes
        multiplicador = 1000000.0
    elif "bilh" in val_clean: # bilhão, bilhões, bilhoes
        multiplicador = 1000000000.0
    elif "mil" in val_clean and "milh" not in val_clean:
        multiplicador = 1000.0

    # Remove R$, espaços e caracteres não numéricos. Mantém apenas dígitos, ponto e vírgula.
    val_clean = re.sub(r"[^\d.,]", "", val_clean)
    val_clean = val_clean.strip(".,")
    if not val_clean:
        return None

    # Se tiver vírgula e ponto, ex: 2.404.755,50
    if "," in val_clean and "." in val_clean:
        if val_clean.rfind(",") > val_clean.rfind("."):
            val_clean = val_clean.replace(".", "").replace(",", ".")
        else:
            val_clean = val_clean.replace(",", "")
    elif "," in val_clean:
        # Só tem vírgula, ex: 2,4 ou 2404755,50
        partes = val_clean.split(",")
        if len(partes) == 2 and len(partes[1]) <= 2:
            val_clean = val_clean.replace(",", ".")
        else:
            val_clean = val_clean.replace(",", "")
    elif "." in val_clean:
        # Só tem ponto, ex: 2.404.755 ou 1500.50
        partes = val_clean.split(".")
        if len(partes) == 2 and len(partes[1]) <= 2:
            pass
        else:
            val_clean = val_clean.replace(".", "")

    try:
        val_float = float(val_clean)
        return round(val_float * multiplicador, 2)
    except ValueError:
        return None


def _extrai_valores(trecho: str) -> dict:
    # Remove linhas de tabelas de projeção de faturamento para evitar falsos positivos gigantes
    # Ex: "2026 R$ 13.000.000,00" ou "2026: R$ 13.000.000,00" ou "2026 - R$ 13.000.000,00"
    trecho_limpo = re.sub(r"(?im)^\s*(?:20\d{2})\b.*?(?:R\$|R\s*\$)\s*[\d.,]+.*$", "", trecho)
    vals = sorted({_valor_brl(v) for v in MONEY_RE.findall(trecho_limpo)}, reverse=True)
    return {"total": vals[0] if vals else None, "encontrados": vals[:6]}


def _extrai_envolvidos(trecho: str) -> list[dict]:
    nomes = []
    for m in RAZAO_RE.finditer(trecho):
        nome = re.sub(r"\s+", " ", m.group(1)).strip(" .,:-")
        # corta prefixo de frase que sobrou antes da razão social
        nome = re.sub(r"^.*?\b(?=[A-ZÀ-Ú][A-Za-zÀ-ú0-9&'\-/ ]*\s(?:LTDA|EIRELI|EPP|S/A|ME|MEI))",
                      "", nome).strip()
        if 6 <= len(nome) <= 80 and nome not in nomes:
            nomes.append(nome)
    cnpjs = []
    for c in CNPJ_RE.findall(trecho):
        if len(re.sub(r"\D", "", c)) == 14 and c not in cnpjs:
            cnpjs.append(c)
    env = [{"nome": n, "papel": "empresa"} for n in nomes[:4]]
    for i, c in enumerate(cnpjs[:4]):
        if i < len(env):
            env[i]["cnpj"] = c
        else:
            env.append({"nome": "", "cnpj": c, "papel": "cnpj"})
    return env[:6]


def _numero(titulo: str) -> str:
    m = NUM_ATO_RE.search(titulo)
    return m.group(1) if m else ""


def _monta_ato(tipo, rotulo, titulo, trecho, edicao, url_pdf, leitor) -> dict:
    ano = edicao.get("ano")
    data = (edicao.get("data") or "")[:10]
    numero = _numero(titulo)
    envolvidos = _extrai_envolvidos(trecho)

    ia = enriquecedor_ia.enriquecer({
        "fonte": "diario",
        "tipo": rotulo,
        "titulo": titulo,
        "texto": trecho,
        "autor": "Prefeitura de Varginha",
        "data": data,
    })

    # Extrai valores com regex
    valores = _extrai_valores(trecho)
    # Refina com o valor principal identificado pela IA
    valor_ia_str = ia.get("valor_principal")
    val_ia = _parse_ia_valor(valor_ia_str)
    if val_ia is not None:
        valores["total"] = val_ia
        if val_ia not in valores["encontrados"]:
            valores["encontrados"].insert(0, val_ia)

    slug = re.sub(r"[^a-z0-9]", "", titulo.lower())[:16]
    return {
        "id": f"DIARIO-{ano}-{edicao.get('edicao')}-{tipo}-{slug}",
        "fonte": "diario",
        "tipo": tipo,
        "tipo_label": rotulo,
        "orgao": "Prefeitura de Varginha",
        "titulo": titulo,
        "numero": numero,
        "data": data,
        "categoria": "Diário Oficial",
        "relevancia": ia["interesse_publico"],
        "tema": ia["tema"],
        "resumo": ia["resumo"] or titulo,
        "pontos_atencao": ia["pontos_atencao"],
        "envolvidos": envolvidos,
        "valores": valores,
        "edicao": edicao.get("edicao"),
        "links": {
            "publicacao": leitor,
            "anexo_pdf": url_pdf,
        },
        "origem_ia": ia.get("_origem_ia", ""),
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def coletar_diario(limite_edicoes: int = 3) -> list[dict]:
    dados = json.loads(DIARIO_JSON.read_text(encoding="utf-8"))
    edicoes = dados.get("ultimas", [])
    edicoes.sort(key=lambda e: (e.get("data") or ""), reverse=True)
    if limite_edicoes > 0:
        edicoes = edicoes[:limite_edicoes]
    print(f"→ Diário: {len(edicoes)} edição(ões) "
          f"(IA: {'ON' if enriquecedor_ia.tem_ia() else 'OFF (fallback)'})", flush=True)

    # Fase 1: baixa o texto de cada edição (cacheado) e junta todos os atos aceitos.
    tarefas: list[tuple] = []
    for e in edicoes:
        pid = e.get("publicacao_id")
        if not pid:
            continue
        try:
            texto, url_pdf, leitor = _baixar_texto(pid)
        except Exception as ex:
            print(f"  ! edição {e.get('edicao')}: download falhou ({ex})", flush=True)
            continue
        if not texto:
            print(f"  ! edição {e.get('edicao')}: sem texto", flush=True)
            continue
        atos = _segmentar(texto)
        aceitos = [a for a in atos if a[0] in TIPOS_ACEITOS]
        print(f"  edição {e.get('edicao')}: {len(atos)} ato(s), {len(aceitos)} aceito(s)", flush=True)
        for tipo, rotulo, titulo, trecho in aceitos:
            tarefas.append((tipo, rotulo, titulo, trecho, e, url_pdf, leitor))

    # Fase 2: enriquece os atos (IA) — em paralelo quando GEMINI_WORKERS>1.
    total = len(tarefas)
    feito = [0]
    trava = threading.Lock()

    def _proc(t):
        pub = _monta_ato(*t)
        with trava:
            feito[0] += 1
            if feito[0] % 25 == 0 or feito[0] == total:
                print(f"    {feito[0]}/{total} atos…", flush=True)
        return pub

    workers = max(1, int(os.getenv("GEMINI_WORKERS", "1")))
    if workers > 1 and tarefas:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            pubs = list(ex.map(_proc, tarefas))
    else:
        pubs = [_proc(t) for t in tarefas]
    print(f"  ✓ {len(pubs)} publicação(ões) do Diário", flush=True)
    return pubs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--edicoes", type=int, default=3, help="0 = todas")
    ap.add_argument("--full", action="store_true", help="substitui a base em vez de mesclar")
    args = ap.parse_args()
    novas = coletar_diario(args.edicoes)
    pubs = novas

    # No uso diário, troca apenas as edições que foram processadas com sucesso
    # e preserva todo o histórico anterior. Isso também protege uma edição cuja
    # página/PDF esteja temporariamente indisponível.
    if not args.full and SAIDA.exists():
        try:
            anterior = json.loads(SAIDA.read_text(encoding="utf-8"))
            existentes = anterior.get("publicacoes", [])
            edicoes_atualizadas = {str(pub.get("edicao")) for pub in novas if pub.get("edicao") is not None}
            preservadas = [
                pub for pub in existentes
                if str(pub.get("edicao")) not in edicoes_atualizadas
            ]
            pubs = preservadas + novas
            print(
                f"  incremental: {len(preservadas)} anterior(es) preservada(s), "
                f"{len(novas)} registro(s) atualizado(s)",
                flush=True,
            )
        except Exception as exc:
            print(f"  ! base anterior não pôde ser mesclada: {exc}", flush=True)

    pubs.sort(key=lambda pub: (pub.get("data") or "", str(pub.get("edicao") or ""), pub.get("id") or ""), reverse=True)
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fonte": "diario",
        "total": len(pubs),
        "publicacoes": pubs,
    }
    temporario = SAIDA.with_suffix(".json.tmp")
    temporario.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(temporario, SAIDA)
    print(f"✓ Salvo: {SAIDA}  ({len(pubs)} publicações)")


if __name__ == "__main__":
    main()
