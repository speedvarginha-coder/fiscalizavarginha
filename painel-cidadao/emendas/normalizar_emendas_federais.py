# -*- coding: utf-8 -*-
"""Completa a taxonomia de evidência da base federal já publicada.

O normalizador é seguro para rodar após cada coleta: só acrescenta campos de
classificação e nunca converte referência Betha em repasse confirmado.
"""
from __future__ import annotations

import json
from pathlib import Path

ARQUIVO = Path(__file__).resolve().parent / "data" / "emendas_federais.js"


def carregar() -> dict:
    text = ARQUIVO.read_text(encoding="utf-8")
    start = text.find("{")
    data, _ = json.JSONDecoder().raw_decode(text[start:])
    return data


def main() -> int:
    payload = carregar()
    changed = 0
    for item in payload.get("emendas", []):
        if item.get("somenteNoBetha"):
            defaults = {
                "granularidade": "referencia_betha_sem_repasse",
                "identificador_repasse_confirmado": False,
                "contabilizado_como_repasse_individual": False,
                "classificacaoComprovacao": "Parcial",
            }
        else:
            defaults = {
                "granularidade": "emenda_favorecido_agregado",
                "identificador_repasse_confirmado": False,
                "contabilizado_como_repasse_individual": False,
            }
        for key, value in defaults.items():
            if key not in item:
                item[key] = value
                changed += 1
    ARQUIVO.write_text(
        "window.EMENDAS_FEDERAIS = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print(f"OK: taxonomia federal normalizada ({changed} campos incluídos)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
