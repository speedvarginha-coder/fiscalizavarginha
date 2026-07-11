# -*- coding: utf-8 -*-
"""Gera data/emendas_municipais_atuais.js a partir da coleta da Câmara.

Fonte: ../data/chunks/emendas.json (emendas impositivas propostas em 2025
pela 20ª Legislatura, coletadas do SAPL/Câmara). O portal de emendas só
tinha o lote da legislatura anterior (PDFs de execução, anoEmenda 2024);
este script publica o lote atual no schema do portal, sem tocar nos
arquivos gerados pelos outros coletores.

Reprodutível: rode de novo sempre que a coleta atualizar o chunk.
    python gerar_municipais_atuais.py
"""
from __future__ import annotations

import json
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHUNK = HERE.parent / "data" / "chunks" / "emendas.json"
BASE_VELHA = HERE / "data" / "emendas.js"
SAIDA = HERE / "data" / "emendas_municipais_atuais.js"

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def normalize(value) -> str:
    """Espelha o normalize() do app.js (NFD, sem acentos, minúsculas)."""
    s = unicodedata.normalize("NFD", str(value or ""))
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def valor_texto(v: float) -> str:
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def chaves_base_velha() -> set:
    """(emenda, anoEmenda, valor arredondado) dos municipais já publicados na
    base de execução (PDFs). A mesma emenda aparece lá com o nome civil do
    autor e dados bancários; sem este dedup ela contaria em dobro no painel.
    Números coincidentes com valor diferente são emendas distintas e ficam."""
    if not BASE_VELHA.exists():
        return set()
    txt = BASE_VELHA.read_text(encoding="utf-8")
    data, _ = json.JSONDecoder().raw_decode(txt[txt.find("{"):])
    chaves = set()
    for r in data.get("emendas", []):
        if r.get("tipo") != "Municipal":
            continue
        chaves.add((str(r.get("emenda")), str(r.get("anoEmenda")), round(float(r.get("valor") or 0))))
    return chaves


def main() -> int:
    if not CHUNK.exists():
        print(f"❌ Chunk não encontrado: {CHUNK}")
        return 1

    regs = json.loads(CHUNK.read_text(encoding="utf-8"))
    if isinstance(regs, dict):
        regs = regs.get("emendas") or regs.get("registros") or []

    ja_publicadas = chaves_base_velha()
    puladas = 0
    emendas = []
    for r in regs:
        ano = str(r.get("ano") or "").strip()
        numero = str(r.get("numero") or "").strip()
        autor = str(r.get("autor") or "").strip()
        valor = float(r.get("valor_brl") or 0)
        beneficiario = str(r.get("beneficiario") or "").strip()
        cnpj = str(r.get("cnpj") or "").strip()
        objeto = str(r.get("objeto") or "").strip()
        pdf = str(r.get("pdf") or "").strip()
        if not ano or not numero:
            continue

        emenda_num = f"{numero.zfill(3)}/{ano}"
        if (emenda_num, ano, round(valor)) in ja_publicadas:
            puladas += 1
            continue
        registro = {
            "id": f"MUN-{ano}-{numero.zfill(3)}",
            "tipo": "Municipal",
            "ano": ano,
            "anoEmenda": ano,
            "anosRelacionados": [ano],
            "emenda": emenda_num,
            "emendaOriginal": emenda_num,
            "autor": autor,
            "partido": "",
            "valor": valor,
            "valorTexto": valor_texto(valor),
            "beneficiario": beneficiario,
            "documentoBeneficiario": cnpj,
            "orgao": beneficiario,
            "objeto": objeto,
            "descricao": objeto,
            "aprovado": "",
            "emendaIndividual": "Sim" if "," not in autor else "Não",
            "fontes": ["Câmara Municipal de Varginha (SAPL)"],
            "arquivo": pdf.rsplit("/", 1)[-1] if pdf else "",
            "arquivoUrl": pdf,
        }
        registro["textoBusca"] = normalize(
            " ".join(
                str(x)
                for x in (
                    emenda_num, autor, beneficiario, cnpj, objeto, ano, "municipal",
                )
            )
        )
        emendas.append(registro)

    payload = {
        "metadata": {
            "geradoEm": datetime.now(timezone.utc).isoformat(),
            "fonte": "data/chunks/emendas.json (coleta SAPL/Câmara)",
            "legislatura": "20ª (2025-2028)",
            "totalRegistros": len(emendas),
            "valorTotal": round(sum(e["valor"] for e in emendas), 2),
        },
        "emendas": emendas,
    }

    SAIDA.write_text(
        "window.EMENDAS_MUNICIPAIS_ATUAIS = "
        + json.dumps(payload, ensure_ascii=False, indent=1)
        + ";\n",
        encoding="utf-8",
    )
    print(f"✅ {len(emendas)} emendas municipais (legislatura atual) → {SAIDA.name}")
    print(f"   Valor total: R$ {valor_texto(payload['metadata']['valorTotal'])}")
    print(f"   Dedup: {puladas} já publicadas na base de execução (emendas.js) — puladas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
