"""Acrescenta pagina e link direto aos valores do Diario sem reprocessar IA."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAINEL = ROOT / "painel-cidadao"
CHUNK = PAINEL / "data" / "chunks" / "publicacoes_diario.json"
DIARIO = PAINEL / "data" / "chunks" / "diario.json"
sys.path.insert(0, str(PAINEL))

import coletor_diario as coletor


def _id_ato(edicao: dict, tipo: str, titulo: str) -> str:
    slug = re.sub(r"[^a-z0-9]", "", titulo.lower())[:16]
    return f"DIARIO-{edicao.get('ano')}-{edicao.get('edicao')}-{tipo}-{slug}"


def _valor_brl(valor: float) -> str:
    return f"{float(valor):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def main() -> None:
    payload = json.loads(CHUNK.read_text(encoding="utf-8-sig"))
    publicacoes = payload.get("publicacoes") or []
    por_id = {pub.get("id"): pub for pub in publicacoes if pub.get("id")}
    edicoes = (json.loads(DIARIO.read_text(encoding="utf-8-sig")).get("ultimas") or [])[:3]
    localizados = 0
    paginas_atribuidas = 0

    for edicao in edicoes:
        texto, url_pdf, _ = coletor._baixar_texto(edicao["publicacao_id"])
        for tipo, _, titulo, trecho, pagina_inicial in coletor._segmentar(texto):
            pub = por_id.get(_id_ato(edicao, tipo, titulo))
            if not pub:
                continue
            localizados += 1
            pub.setdefault("links", {})["anexo_pdf"] = url_pdf
            pub["localizacao"] = {
                "pagina_inicial": int(pagina_inicial),
                "link_direto": f"{url_pdf}#page={int(pagina_inicial)}" if url_pdf else "",
            }
            valores = pub.get("valores") or {}
            total = valores.get("total")
            if total is None:
                continue
            posicao = trecho.find(_valor_brl(float(total)))
            if posicao < 0:
                continue
            pagina = int(pagina_inicial) + trecho[:posicao].count("\f")
            valores["pagina"] = pagina
            valores["link_verificacao"] = f"{url_pdf}#page={pagina}"
            pub["valores"] = valores
            paginas_atribuidas += 1

    temporario = CHUNK.with_suffix(".json.tmp")
    temporario.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(temporario, CHUNK)
    print(f"Atos localizados nas edicoes recentes: {localizados}")
    print(f"Valores com pagina exata: {paginas_atribuidas}")


if __name__ == "__main__":
    main()
