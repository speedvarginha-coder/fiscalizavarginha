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
import re
import sys
import unicodedata
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
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


def centavos(value) -> int:
    try:
        return int((Decimal(str(value or 0)) * 100).quantize(Decimal("1"), ROUND_HALF_UP))
    except (InvalidOperation, ValueError):
        raise ValueError(f"valor inválido: {value!r}")


def somente_digitos(value) -> str:
    return re.sub(r"\D", "", str(value or ""))


def cnpj_valido(value) -> bool:
    digits = somente_digitos(value)
    if len(digits) != 14 or digits == digits[0] * 14:
        return False
    for tamanho in (12, 13):
        trecho = digits[:tamanho]
        pesos = list(range(tamanho - 7, 1, -1)) + list(range(9, 1, -1))
        resto = sum(int(n) * p for n, p in zip(trecho, pesos)) % 11
        digito = 0 if resto < 2 else 11 - resto
        if int(digits[tamanho]) != digito:
            return False
    return True


def fonte_pdf(registro: dict) -> str:
    url = str(registro.get("pdf") or registro.get("arquivoUrl") or "").strip()
    if url:
        return normalize(url)
    fontes = registro.get("fontes") or []
    if fontes and isinstance(fontes[0], dict):
        return normalize(fontes[0].get("arquivoUrl") or fontes[0].get("arquivo"))
    return ""


def chave_forte(registro: dict) -> tuple:
    numero_ano = str(registro.get("emenda") or "").strip()
    if not numero_ano:
        numero = str(registro.get("numero") or "").strip()
        ano = str(registro.get("ano") or registro.get("anoEmenda") or "").strip()
        numero_ano = f"{numero.zfill(3)}/{ano}"
    return (
        numero_ano,
        normalize(registro.get("autor")),
        normalize(registro.get("beneficiario")),
        somente_digitos(registro.get("cnpj") or registro.get("documentoBeneficiario")),
        normalize(registro.get("objeto")),
        centavos(registro.get("valor_brl") if "valor_brl" in registro else registro.get("valor")),
        fonte_pdf(registro),
    )


def chaves_base_velha() -> set:
    """Chaves completas; coincidência de número/ano/valor não exclui registro."""
    if not BASE_VELHA.exists():
        return set()
    txt = BASE_VELHA.read_text(encoding="utf-8")
    data, _ = json.JSONDecoder().raw_decode(txt[txt.find("{"):])
    chaves = set()
    for r in data.get("emendas", []):
        if r.get("tipo") != "Municipal":
            continue
        chaves.add(chave_forte(r))
    return chaves


def main() -> int:
    if not CHUNK.exists():
        print(f"❌ Chunk não encontrado: {CHUNK}")
        return 1

    regs = json.loads(CHUNK.read_text(encoding="utf-8"))
    if isinstance(regs, dict):
        regs = regs.get("emendas") or regs.get("registros") or []
    if not isinstance(regs, list) or not regs:
        print("ERRO: chunk vazio ou em formato inesperado; saída preservada")
        return 1

    ja_publicadas = chaves_base_velha()
    puladas = 0
    emendas = []
    vistas = set()
    for r in regs:
        ano = str(r.get("ano") or "").strip()
        numero = str(r.get("numero") or "").strip()
        autor = str(r.get("autor") or "").strip()
        valor_centavos = centavos(r.get("valor_brl"))
        valor = valor_centavos / 100
        beneficiario = str(r.get("beneficiario") or "").strip()
        cnpj = str(r.get("cnpj") or "").strip()
        objeto = str(r.get("objeto") or "").strip()
        pdf = str(r.get("pdf") or "").strip()
        if not ano or not numero:
            print("ERRO: registro SAPL sem número/ano; saída preservada")
            return 1

        emenda_num = f"{numero.zfill(3)}/{ano}"
        chave = chave_forte(r)
        if chave in vistas:
            puladas += 1
            continue
        vistas.add(chave)
        if chave in ja_publicadas:
            puladas += 1
            continue
        autores = [nome.strip() for nome in autor.split(",") if nome.strip()]
        status_cnpj = "valido" if cnpj_valido(cnpj) else ("invalido" if cnpj else "ausente")
        status_pdf = "disponivel" if pdf else "ausente"
        confianca = "alta" if status_cnpj == "valido" and pdf and all(
            (autor, beneficiario, objeto, valor_centavos)
        ) else "media"
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
            "estagio": "indicada/proposta",
            "financeiro": {"indicado": valor, "pago": None, "recebido": None},
            "aprovado": "",
            "autoria": {"tipo": "individual" if len(autores) == 1 else "coautoria", "autores": autores},
            "emendaIndividual": "Sim" if len(autores) == 1 else "Não",
            "cnpjStatus": status_cnpj,
            "pdfStatus": status_pdf,
            "confianca": confianca,
            "proveniencia": {
                "fonte": "SAPL/Câmara Municipal de Varginha",
                "chunk": "data/chunks/emendas.json",
                "pdf": pdf or None,
                "campos": "ementa e metadados da matéria legislativa",
            },
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

    if len(emendas) + puladas != len(regs):
        print("ERRO: nem todos os registros do chunk foram contabilizados; saída preservada")
        return 1
    if len(regs) == 357 and len(emendas) != 357:
        print(f"ERRO: chunk atual tem 357 registros, mas {len(emendas)} seriam publicados; saída preservada")
        return 1

    payload = {
        "metadata": {
            "geradoEm": datetime.now(timezone.utc).isoformat(),
            "fonte": "data/chunks/emendas.json (coleta SAPL/Câmara)",
            "legislatura": "20ª (2025-2028)",
            "totalRegistros": len(emendas),
            "valorTotal": round(sum(e["valor"] for e in emendas), 2),
            "qualidade": {
                "cnpjValido": sum(e["cnpjStatus"] == "valido" for e in emendas),
                "cnpjInvalido": sum(e["cnpjStatus"] == "invalido" for e in emendas),
                "cnpjAusente": sum(e["cnpjStatus"] == "ausente" for e in emendas),
                "pdfAusente": sum(e["pdfStatus"] == "ausente" for e in emendas),
            },
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
