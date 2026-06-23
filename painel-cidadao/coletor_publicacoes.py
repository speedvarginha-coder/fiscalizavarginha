"""Coletor de publicações estruturadas — Fase 1: Câmara (SAPL).

Cada matéria legislativa do SAPL de Varginha vira uma "publicação estruturada"
no schema único do projeto, enriquecida pela IA (enriquecedor_ia). O mesmo JSON
alimenta depois o painel web e o bot de WhatsApp (canais são só renderizadores).

Uso:
    python coletor_publicacoes.py --ano 2026 --limite 20
    python coletor_publicacoes.py --ano 2026            # tudo do ano

Saída: data/chunks/publicacoes_estruturadas.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import enriquecedor_ia

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


def _monta_publicacao(materia: dict, autores_map: dict) -> dict | None:
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

    # Camada de IA — resumo cidadão, pontos de atenção, interesse público.
    ia = enriquecedor_ia.enriquecer({
        "fonte": "camara",
        "tipo": rotulo,
        "titulo": titulo,
        "texto": ementa,
        "autor": autor,
        "data": data,
    })

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
        "autor": autor,
        "situacao": _situacao(materia),
        "ementa": ementa,
        "links": {
            "consulta": f"{SAPL_PUB}/materia/{mid}" if mid else "",
            "inteiro_teor": materia.get("texto_original") or "",
        },
        "origem_ia": ia.get("_origem_ia", ""),
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def coletar_camara(ano: int, limite: int = 0) -> list[dict]:
    print(f"→ Coletando matérias SAPL {ano} (IA: {'ON' if enriquecedor_ia.tem_ia() else 'OFF (fallback)'})")
    materias = _paginate(f"{SAPL}/materia/materialegislativa/?ano={ano}&page=1&page_size=100")
    # mais recentes primeiro
    materias.sort(key=lambda m: (m.get("data_apresentacao") or ""), reverse=True)
    if limite > 0:
        materias = materias[:limite]
    print(f"  {len(materias)} matéria(s) para processar")

    autores_map = _mapa_autores()
    print(f"  autores resolvidos: {len(autores_map)}")

    total = len(materias)
    feito = [0]
    trava = threading.Lock()

    def _proc(m):
        pub = _monta_publicacao(m, autores_map)
        with trava:
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
    print(f"  ✓ {len(pubs)} publicação(ões) estruturada(s)", flush=True)
    return pubs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ano", type=int, default=datetime.now().year)
    ap.add_argument("--limite", type=int, default=0, help="0 = todas")
    args = ap.parse_args()

    pubs = coletar_camara(args.ano, args.limite)
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fonte": "camara",
        "total": len(pubs),
        "publicacoes": pubs,
    }
    SAIDA.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"✓ Salvo: {SAIDA}  ({len(pubs)} publicações)")


if __name__ == "__main__":
    main()
