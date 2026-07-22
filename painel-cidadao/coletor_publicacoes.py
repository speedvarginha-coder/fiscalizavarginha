"""Coletor de publicações estruturadas — Fase 1: Câmara (SAPL).

Cada matéria legislativa do SAPL de Varginha vira uma "publicação estruturada"
no schema único do projeto, enriquecida pela IA (enriquecedor_ia). O mesmo JSON
alimenta depois o painel web e o bot de WhatsApp (canais são só renderizadores).

Uso:
    python coletor_publicacoes.py --ano 2026             # incremental (padrão)
    python coletor_publicacoes.py --ano 2026 --limite 20 # teste com 20 matérias
    python coletor_publicacoes.py --ano 2026 --full      # reenriquece tudo

Saída: data/chunks/publicacoes_estruturadas.json
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import threading
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import enriquecedor_ia
from pypdf import PdfReader

# Console do Windows (cp1252) quebra com ✓/→ — força UTF-8 na saída.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
SAIDA = ROOT / "data" / "chunks" / "publicacoes_estruturadas.json"
SAPL = "https://sapl.varginha.mg.leg.br/api"
SAPL_PUB = "https://sapl.varginha.mg.leg.br"
UA = "ZelaVarginha/1.0 (fiscalizacao cidada)"
MONEY_RE = re.compile(r"R\s*\$\s*([\d.]+,\d{2})", re.IGNORECASE)
CACHE_DOCUMENTOS = ROOT.parent / "private" / "cache" / "camara_documentos"

# id do tipo no SAPL -> (sigla, rótulo legível, tipo normalizado do schema)
TIPO_INFO = {
    3:  ("PLOM",  "Proposta de Emenda à Lei Orgânica",        "emenda_lom"),
    14: ("VET",   "Mensagem de Veto",                          "veto"),
    20: ("PLC",   "Projeto de Lei Complementar",               "projeto_lei"),
    17: ("PLOE",  "Projeto de Lei Ordinária do Executivo",     "projeto_lei"),
    4:  ("PLOL",  "Projeto de Lei Ordinária do Legislativo",   "projeto_lei"),
    6:  ("PDL",   "Projeto de Decreto Legislativo",            "decreto_legislativo"),
    7:  ("PRES",  "Projeto de Resolução",                      "resolucao"),
    24: ("SUBS",  "Substitutivo",                              "substitutivo"),
    25: ("PPTCE", "Parecer Prévio do TCE",                     "parecer"),
    8:  ("REQ",   "Requerimento",                              "requerimento"),
    9:  ("IND",   "Indicação",                                 "indicacao"),
    10: ("MOC",   "Moção",                                     "mocao"),
    12: ("REC",   "Recurso",                                   "recurso"),
    13: ("EMEN",  "Emenda",                                    "emenda"),
    26: ("EMEIM", "Emenda Impositiva ao Orçamento",            "emenda_impositiva"),
    11: ("PRO",   "Pronunciamento",                            "pronunciamento"),
    28: ("PAR",   "Parecer",                                   "parecer"),
}


def _get(url: str, timeout: int = 25) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _paginate(url: str, max_paginas: int = 50) -> list[dict]:
    out: list[dict] = []
    nxt: str | None = url
    paginas = 0
    while nxt and paginas < max_paginas:
        try:
            d = _get(nxt)
        except Exception as e:
            print(f"  ! SAPL paginate: {e}")
            break
        out += d.get("results", [])
        nxt = (d.get("pagination", {}) or {}).get("links", {}).get("next")
        paginas += 1
    return out


def _mapa_autores() -> dict:
    """{id_autor: nome}. Tolerante: se o endpoint falhar, devolve {} e o
    coletor cai no fallback por tipo (Executivo/parlamentar)."""
    mapa: dict = {}
    for endpoint in (f"{SAPL}/base/autor/?page_size=200",
                     f"{SAPL}/base/autor/?page=1"):
        try:
            rows = _paginate(endpoint)
            for a in rows:
                nome = a.get("nome") or a.get("__str__") or ""
                if a.get("id") and nome:
                    mapa[a["id"]] = re.sub(r"\s+", " ", nome).strip()
            if mapa:
                return mapa
        except Exception:
            continue
    return mapa


def _autor_legivel(materia: dict, autores_map: dict, sigla: str) -> str:
    ids = materia.get("autores") or []
    nomes = [autores_map.get(i) for i in ids if autores_map.get(i)]
    nomes = [n for n in nomes if n]
    if nomes:
        return "; ".join(nomes[:4])
    # Fallback por tipo quando não há nome resolvido.
    if sigla == "PLOE":
        return "Poder Executivo"
    if sigla in ("PLOL", "REQ", "IND", "MOC", "PRES", "PDL"):
        return "Poder Legislativo"
    return "Autoria não identificada"


def _situacao(materia: dict) -> str:
    if materia.get("em_tramitacao"):
        return "em tramitação"
    resultado = re.sub(r"\s+", " ", str(materia.get("resultado") or "")).strip()
    return resultado or "tramitação encerrada"


def _fonte_hash(tipo_label: str, titulo: str, ementa: str, autor: str, data: str) -> str:
    base = json.dumps(
        [tipo_label, titulo, ementa, autor, data],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha1(base.encode("utf-8")).hexdigest()


def _hash_publicacao_existente(pub: dict) -> str:
    return pub.get("fonte_hash") or _fonte_hash(
        str(pub.get("tipo_label") or ""),
        str(pub.get("titulo") or ""),
        re.sub(r"\s+", " ", str(pub.get("ementa") or "")).strip(),
        str(pub.get("autor") or ""),
        str(pub.get("data") or "")[:10],
    )


def _ia_da_publicacao(pub: dict) -> dict:
    valores = pub.get("valores") or {}
    return {
        "interesse_publico": pub.get("interesse_publico") or "medio",
        "tema": pub.get("tema") or "",
        "resumo": pub.get("resumo") or "",
        "o_que_propoe": pub.get("o_que_propoe") or "",
        "por_que_acompanhar": pub.get("por_que_acompanhar") or [],
        "pontos_atencao": pub.get("pontos_atencao") or [],
        "valor_principal": valores.get("valor_principal_ia") or "",
        "_origem_ia": pub.get("origem_ia") or "",
    }


def _valor_brl(texto: str) -> float | None:
    try:
        return round(float(str(texto).replace(".", "").replace(",", ".")), 2)
    except (TypeError, ValueError):
        return None


def _documento_financeiro(sigla: str, ementa: str) -> bool:
    if sigla not in {"PLOE", "PLOM", "PLC", "EMEIM", "EMEN", "SUBS"}:
        return False
    texto = ementa.lower()
    termos = (
        "subven", "credito", "crédito", "orcament", "orçament", "repasse",
        "recurso", "remuner", "gratifica", "impacto financeiro", "despesa",
    )
    return any(termo in texto for termo in termos)


def _documento_oficial(url: str) -> tuple[str, list[str]]:
    if not url:
        return "", []
    url = str(url).replace("http://sapl.varginha.mg.leg.br", "https://sapl.varginha.mg.leg.br")
    chave = hashlib.sha1(url.encode("utf-8")).hexdigest()
    cache = CACHE_DOCUMENTOS / f"{chave}.txt"
    cache_paginas = CACHE_DOCUMENTOS / f"{chave}.pages.json"
    if cache_paginas.exists():
        paginas = json.loads(cache_paginas.read_text(encoding="utf-8"))
        return " ".join(paginas), paginas
    if cache.exists() and not url.lower().split("?", 1)[0].endswith(".pdf"):
        return cache.read_text(encoding="utf-8"), []
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=35) as resposta:
            conteudo = resposta.read()
        if url.lower().split("?", 1)[0].endswith(".pdf"):
            paginas = [re.sub(r"\s+", " ", pagina.extract_text() or "").strip() for pagina in PdfReader(io.BytesIO(conteudo)).pages]
            texto = " ".join(paginas)
        elif url.lower().split("?", 1)[0].endswith(".docx"):
            with zipfile.ZipFile(io.BytesIO(conteudo)) as documento:
                xml = documento.read("word/document.xml").decode("utf-8", errors="replace")
            texto = re.sub(r"<[^>]+>", " ", xml)
            paginas = []
        else:
            return "", []
        texto = re.sub(r"\s+", " ", texto).strip()
        CACHE_DOCUMENTOS.mkdir(parents=True, exist_ok=True)
        cache.write_text(texto, encoding="utf-8")
        if paginas:
            cache_paginas.write_text(json.dumps(paginas, ensure_ascii=False), encoding="utf-8")
        return texto, paginas
    except Exception as exc:
        print(f"  ! documento oficial nao lido ({url}): {exc}")
        return "", []


def _texto_documento_oficial(url: str) -> str:
    return _documento_oficial(url)[0]


def _valores_publicacao(
    ementa: str,
    ia: dict,
    texto_oficial: str = "",
    fonte_documento: str = "",
    paginas_oficiais: list[str] | None = None,
    url_documento: str = "",
) -> dict:
    """Mantém apenas valores verificáveis na ementa oficial do SAPL.

    O valor sugerido pela IA serve para escolher o principal, mas nunca cria um
    valor que não apareça literalmente na ementa.
    """
    base_textual = texto_oficial or ementa or ""
    encontrados = []
    for bruto in MONEY_RE.findall(base_textual):
        valor = _valor_brl(bruto)
        if valor is not None and valor not in encontrados:
            encontrados.append(valor)

    ia_bruto = str(ia.get("valor_principal") or "").strip()
    valor_ia = _valor_brl(re.sub(r"[^\d.,]", "", ia_bruto)) if ia_bruto else None
    principal = valor_ia if valor_ia in encontrados else None
    metodo = "valor principal da IA confirmado no documento oficial" if principal is not None else ""
    if principal is None:
        padrao_principal = re.search(
            r"(?:totalizando|valor\s+global(?:\s+estimado)?(?:\s+de)?|valor\s+total(?:\s+de)?|"
            r"subven[cç][aã]o.{0,80}?no\s+valor\s+de)\s*R\s*\$\s*([\d.]+,\d{2})",
            base_textual,
            re.IGNORECASE,
        )
        if padrao_principal:
            principal = _valor_brl(padrao_principal.group(1))
            metodo = "rótulo de valor total localizado no documento oficial"
    if principal is None and len(encontrados) == 1:
        principal = encontrados[0]
        metodo = "único valor monetário localizado no documento oficial"
    confianca = "alta" if principal is not None and valor_ia == principal else ("media" if principal is not None else "indisponivel")
    fonte = fonte_documento or "ementa oficial do SAPL"
    pagina = None
    if principal is not None and paginas_oficiais:
        alvo = f"{principal:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        for indice, texto_pagina in enumerate(paginas_oficiais, start=1):
            if alvo in texto_pagina:
                pagina = indice
                break
    link_verificacao = ""
    if url_documento:
        link_verificacao = str(url_documento).replace("http://sapl.varginha.mg.leg.br", "https://sapl.varginha.mg.leg.br")
        if pagina:
            link_verificacao += f"#page={pagina}"
    return {
        "total": principal,
        "encontrados": encontrados[:6],
        "natureza": "valor citado na matéria legislativa",
        "fonte_total": fonte if principal is not None else "",
        "confianca": confianca,
        "metodo": metodo,
        "documento_consultado": fonte_documento,
        "pagina": pagina,
        "link_verificacao": link_verificacao,
        "valor_principal_ia": ia_bruto,
    }


def _monta_publicacao(
    materia: dict,
    autores_map: dict,
    publicacao_existente: dict | None = None,
) -> dict | None:
    tipo_id = materia.get("tipo")
    info = TIPO_INFO.get(tipo_id)
    if not info:
        return None
    sigla, rotulo, tipo_norm = info
    numero = materia.get("numero")
    ano = materia.get("ano")
    if not numero or not ano:
        return None

    ementa = re.sub(r"\s+", " ", str(materia.get("ementa") or "")).strip()
    titulo = f"{rotulo} nº {numero}/{ano}"
    autor = _autor_legivel(materia, autores_map, sigla)
    data = (materia.get("data_apresentacao") or materia.get("data_publicacao") or "")[:10]
    mid = materia.get("id")

    hash_atual = _fonte_hash(rotulo, titulo, ementa, autor, data)
    pode_reusar = bool(
        publicacao_existente
        and _hash_publicacao_existente(publicacao_existente) == hash_atual
    )
    if pode_reusar:
        ia = _ia_da_publicacao(publicacao_existente)
    else:
        # Camada de IA — somente itens novos, alterados ou antes degradados.
        ia = enriquecedor_ia.enriquecer({
            "fonte": "camara",
            "tipo": rotulo,
            "titulo": titulo,
            "texto": ementa,
            "autor": autor,
            "data": data,
        })

    documento_url = str(materia.get("texto_original") or "")
    texto_documento, paginas_documento = _documento_oficial(documento_url) if _documento_financeiro(sigla, ementa) else ("", [])
    valores = _valores_publicacao(
        ementa,
        ia,
        texto_documento,
        "documento original no SAPL" if texto_documento else "",
        paginas_documento,
        documento_url,
    )

    return {
        "id": f"CAMARA-{ano}-{sigla}-{numero}",
        "fonte": "camara",
        "tipo": tipo_norm,
        "tipo_label": rotulo,
        "orgao": "Câmara de Varginha",
        "titulo": titulo,
        "numero": f"{numero}/{ano}",
        "data": data,
        "categoria": "Legislativo",
        "interesse_publico": ia["interesse_publico"],
        "tema": ia["tema"],
        "resumo": ia["resumo"] or ementa[:240],
        "o_que_propoe": ia["o_que_propoe"],
        "por_que_acompanhar": ia["por_que_acompanhar"],
        "pontos_atencao": ia["pontos_atencao"],
        "valores": valores,
        "autor": autor,
        "situacao": _situacao(materia),
        "ementa": ementa,
        "links": {
            "consulta": f"{SAPL_PUB}/materia/{mid}" if mid else "",
            "inteiro_teor": materia.get("texto_original") or "",
        },
        "localizacao": {
            "pagina_inicial": 1 if str(materia.get("texto_original") or "").lower().split("?", 1)[0].endswith(".pdf") else None,
            "link_direto": (
                str(materia.get("texto_original") or "").replace("http://sapl.varginha.mg.leg.br", "https://sapl.varginha.mg.leg.br") + "#page=1"
                if str(materia.get("texto_original") or "").lower().split("?", 1)[0].endswith(".pdf")
                else str(materia.get("texto_original") or "")
            ),
        },
        "origem_ia": ia.get("_origem_ia", ""),
        "fonte_hash": hash_atual,
        "gerado_em": (
            publicacao_existente.get("gerado_em")
            if pode_reusar and publicacao_existente
            else datetime.now(timezone.utc).isoformat(timespec="seconds")
        ),
    }


def coletar_camara(ano: int, limite: int = 0, full: bool = False) -> list[dict]:
    print(f"→ Coletando matérias SAPL {ano} (IA: {'ON' if enriquecedor_ia.tem_ia() else 'OFF (fallback)'})")
    materias = _paginate(f"{SAPL}/materia/materialegislativa/?ano={ano}&page=1&page_size=100")
    # mais recentes primeiro
    materias.sort(key=lambda m: (m.get("data_apresentacao") or ""), reverse=True)
    if limite > 0:
        materias = materias[:limite]
    print(f"  {len(materias)} matéria(s) para processar")

    autores_map = _mapa_autores()
    print(f"  autores resolvidos: {len(autores_map)}")

    existentes: list[dict] = []
    if not full and SAIDA.exists():
        try:
            payload_existente = json.loads(SAIDA.read_text(encoding="utf-8"))
            existentes = [
                pub for pub in payload_existente.get("publicacoes", [])
                if str(pub.get("numero") or "").endswith(f"/{ano}")
            ]
        except Exception as exc:
            print(f"  ! base anterior não pôde ser reutilizada: {exc}")
    existentes_por_id = {pub.get("id"): pub for pub in existentes if pub.get("id")}
    if existentes_por_id:
        print(f"  base incremental: {len(existentes_por_id)} publicação(ões) existente(s)")

    total = len(materias)
    feito = [0]
    trava = threading.Lock()

    estatisticas = {"reusadas": 0, "enriquecidas": 0}

    def _proc(m):
        info = TIPO_INFO.get(m.get("tipo"))
        pid = None
        existente = None
        if info and m.get("numero") and m.get("ano"):
            pid = f"CAMARA-{m.get('ano')}-{info[0]}-{m.get('numero')}"
            existente = existentes_por_id.get(pid)
        pub = _monta_publicacao(m, autores_map, existente)
        with trava:
            if pub and existente and pub.get("gerado_em") == existente.get("gerado_em"):
                estatisticas["reusadas"] += 1
            elif pub:
                estatisticas["enriquecidas"] += 1
            feito[0] += 1
            if feito[0] % 25 == 0 or feito[0] == total:
                print(f"    {feito[0]}/{total}…", flush=True)
        return pub

    # GEMINI_WORKERS>1 processa em paralelo (paid tier aguenta). map preserva ordem.
    workers = max(1, int(os.getenv("GEMINI_WORKERS", "1")))
    if workers > 1:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            resultados = list(ex.map(_proc, materias))
    else:
        resultados = [_proc(m) for m in materias]

    pubs = [p for p in resultados if p]
    ids_coletados = {p.get("id") for p in pubs}
    preservadas = [pub for pid, pub in existentes_por_id.items() if pid not in ids_coletados]
    if preservadas:
        print(f"  ! {len(preservadas)} publicação(ões) anterior(es) não vieram na consulta; preservadas por segurança")
        pubs.extend(preservadas)
    pubs.sort(key=lambda p: (p.get("data") or "", p.get("id") or ""), reverse=True)
    print(
        f"  incremental: {estatisticas['reusadas']} reutilizada(s), "
        f"{estatisticas['enriquecidas']} enriquecida(s)",
        flush=True,
    )
    print(f"  ✓ {len(pubs)} publicação(ões) estruturada(s)", flush=True)
    return pubs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ano", type=int, default=datetime.now().year)
    ap.add_argument("--limite", type=int, default=0, help="0 = todas")
    ap.add_argument("--full", action="store_true", help="reenriquece todas as matérias")
    args = ap.parse_args()

    pubs = coletar_camara(args.ano, args.limite, full=args.full)
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fonte": "camara",
        "total": len(pubs),
        "publicacoes": pubs,
    }
    temporario = SAIDA.with_suffix(".json.tmp")
    temporario.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(temporario, SAIDA)
    print(f"✓ Salvo: {SAIDA}  ({len(pubs)} publicações)")


if __name__ == "__main__":
    main()
