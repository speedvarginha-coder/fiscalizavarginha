"""Preenche valores de materias financeiras usando somente anexos oficiais do SAPL."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAINEL = ROOT / "painel-cidadao"
CHUNK = PAINEL / "data" / "chunks" / "publicacoes_estruturadas.json"
sys.path.insert(0, str(PAINEL))

import coletor_publicacoes as coletor


def main() -> None:
    payload = json.loads(CHUNK.read_text(encoding="utf-8-sig"))
    publicacoes = payload.get("publicacoes") or []
    consultados = 0
    enriquecidos = 0

    for pub in publicacoes:
        partes_id = str(pub.get("id") or "").split("-")
        sigla = partes_id[2] if len(partes_id) > 2 else ""
        ementa = str(pub.get("ementa") or "")
        url = str((pub.get("links") or {}).get("inteiro_teor") or "")
        if not url or not coletor._documento_financeiro(sigla, ementa):
            continue
        consultados += 1
        texto, paginas = coletor._documento_oficial(url)
        if not texto:
            continue
        anterior = pub.get("valores") or {}
        ia = {"valor_principal": anterior.get("valor_principal_ia") or ""}
        valores = coletor._valores_publicacao(
            ementa,
            ia,
            texto,
            "documento original no SAPL",
            paginas,
            url,
        )
        pub["valores"] = valores
        if valores.get("total") is not None:
            enriquecidos += 1

    temporario = CHUNK.with_suffix(".json.tmp")
    temporario.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(temporario, CHUNK)
    print(f"Documentos oficiais consultados: {consultados}")
    print(f"Materias com valor principal comprovavel: {enriquecidos}")


if __name__ == "__main__":
    main()
