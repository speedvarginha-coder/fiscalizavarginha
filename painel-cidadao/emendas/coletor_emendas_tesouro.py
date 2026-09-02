# -*- coding: utf-8 -*-
"""Coleta ordens bancárias federais destinadas a Varginha no Tesouro Transparente.

Esta camada é evidência de pagamento/transferência por OB. Ela permanece separada
das emendas da CGU e do Transferegov para impedir dupla contagem.
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import json
import os
import re
import ssl
import tempfile
import urllib.request
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import certifi


BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[1]
DESTINO = BASE / "data" / "emendas_tesouro.js"
CACHE_DIR = ROOT / "private" / "cache" / "emendas-tesouro"
CACHE_CSV = CACHE_DIR / "emendas-parlamentares-latest.csv"
CACHE_META = CACHE_DIR / "metadados-latest.json"
DATASET_ID = "emendas-parlamentares-individuais-e-de-bancada"
CKAN_API = f"https://www.tesourotransparente.gov.br/ckan/api/3/action/package_show?id={DATASET_ID}"
PAINEL_URL = "https://www.tesourotransparente.gov.br/consultas/painel-das-emendas-parlamentares-individuais-e-de-bancada"
IBGE_VARGINHA = "3170701"
USER_AGENT = "FiscalizaVarginha/1.0 (+https://fiscalizavarginha.com.br)"


def agora_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def obter(url: str, timeout: int = 240) -> tuple[bytes, dict[str, str]]:
    context = ssl.create_default_context(cafile=certifi.where())
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
        return response.read(), {
            "etag": response.headers.get("ETag", ""),
            "last_modified": response.headers.get("Last-Modified", ""),
            "content_type": response.headers.get("Content-Type", ""),
        }


def recurso_csv(package: dict[str, Any]) -> dict[str, Any]:
    resources = package.get("result", {}).get("resources", [])
    matches = [resource for resource in resources if str(resource.get("format") or "").upper() == "CSV"]
    if len(matches) != 1 or not str(matches[0].get("url") or "").startswith("https://"):
        raise ValueError("Recurso CSV do Tesouro ausente ou ambíguo")
    return matches[0]


def dinheiro_centavos(value: Any) -> int:
    raw = str(value or "").strip().replace("R$", "").replace(" ", "")
    if not raw:
        return 0
    if "," in raw:
        raw = raw.replace(".", "").replace(",", ".")
    try:
        return int((Decimal(raw) * 100).quantize(Decimal("1")))
    except InvalidOperation as exc:
        raise ValueError(f"Valor inválido no Tesouro: {value!r}") from exc


def data_tesouro(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if re.fullmatch(r"\d+(?:\.0)?", raw):
        date = dt.date(1899, 12, 30) + dt.timedelta(days=int(float(raw)))
        return date.isoformat()
    for pattern in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(raw[:10], pattern).date().isoformat()
        except ValueError:
            pass
    return raw


def ler_csv(content: bytes) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(content.decode("latin-1")), delimiter=";")
    required = {
        "Nome Ente", "UF", "Código IBGE", "Data", "Ano", "OB",
        "CNPJ do Favorecido", "Nome Favorecido", "Nome Emenda",
        "Transferência Especial", "Categoria Econômica Despesa", "Valor",
    }
    if not reader.fieldnames or not required.issubset(reader.fieldnames):
        missing = sorted(required - set(reader.fieldnames or []))
        raise ValueError("Colunas do Tesouro ausentes: " + ", ".join(missing))

    rows: list[dict[str, Any]] = []
    seen: Counter[tuple[str, str, str, int]] = Counter()
    for source in reader:
        if str(source.get("Código IBGE") or "").strip() != IBGE_VARGINHA:
            continue
        cents = dinheiro_centavos(source.get("Valor"))
        if cents < 0:
            raise ValueError(f"Valor negativo no Tesouro: {source.get('OB')}")
        key = (
            str(source.get("OB") or "").strip(),
            re.sub(r"\D", "", str(source.get("CNPJ do Favorecido") or "")),
            str(source.get("Categoria Econômica Despesa") or "").strip(),
            cents,
        )
        seen[key] += 1
        suffix = f"-{seen[key]}" if seen[key] > 1 else ""
        rows.append({
            "id": f"tesouro-ob-{key[0] or len(rows)}{suffix}",
            "ano": str(source.get("Ano") or "").strip(),
            "data": data_tesouro(source.get("Data")),
            "ordemBancaria": key[0] or None,
            "cnpjFavorecido": key[1] or None,
            "favorecido": str(source.get("Nome Favorecido") or "").strip(),
            "tipoEmenda": str(source.get("Nome Emenda") or "").strip(),
            "transferenciaEspecial": str(source.get("Transferência Especial") or "").strip(),
            "categoriaEconomica": key[2],
            "valorPago": cents / 100,
            "codigoIbge": IBGE_VARGINHA,
            "municipio": "Varginha",
            "fonteSistema": "Tesouro Transparente",
            "granularidade": "ordem_bancaria_federal",
            "contabilizarNaBaseEmendas": False,
            "observacao": (
                "Ordem bancária registrada pelo Tesouro. Serve para conciliação de pagamento; "
                "não deve ser somada novamente aos registros da CGU ou do Transferegov."
            ),
            "fonteUrl": PAINEL_URL,
        })
    if not rows:
        raise ValueError("Nenhuma ordem bancária de Varginha encontrada no Tesouro")
    rows.sort(key=lambda item: (item["ano"], item["data"] or "", item["ordemBancaria"] or ""), reverse=True)
    return rows


def somar(rows: list[dict[str, Any]]) -> float:
    return round(sum(float(row["valorPago"]) for row in rows), 2)


def escrever_atomico(path: Path, content: str | bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = "wb" if isinstance(content, bytes) else "w"
    kwargs = {} if isinstance(content, bytes) else {"encoding": "utf-8", "newline": "\n"}
    fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    os.close(fd)
    try:
        with open(temp_name, mode, **kwargs) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def coletar() -> dict[str, Any]:
    package_bytes, _ = obter(CKAN_API, timeout=60)
    package = json.loads(package_bytes.decode("utf-8"))
    resource = recurso_csv(package)
    csv_bytes, headers = obter(resource["url"])
    rows = ler_csv(csv_bytes)
    by_year: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_year[row["ano"]].append(row)
    metadata = {
        "criterio": "Ordens bancárias cujo código IBGE do ente é 3170701 (Varginha).",
        "fonte": "Tesouro Transparente — Emendas Parlamentares Individuais e de Bancada",
        "fontePagina": PAINEL_URL,
        "fonteArquivo": resource["url"],
        "fonteApi": CKAN_API,
        "arquivoSha256": hashlib.sha256(csv_bytes).hexdigest(),
        "arquivoEtag": headers.get("etag") or None,
        "arquivoUltimaModificacao": headers.get("last_modified") or resource.get("last_modified"),
        "metadataAtualizadaEm": package.get("result", {}).get("metadata_modified"),
        "extraidoEm": agora_iso(),
        "codigoIbge": IBGE_VARGINHA,
        "totalRegistros": len(rows),
        "totalPago": somar(rows),
        "anos": {
            year: {"registros": len(items), "totalPago": somar(items)}
            for year, items in sorted(by_year.items())
        },
        "favorecidos": dict(sorted(Counter(row["favorecido"] for row in rows).items())),
        "observacao": (
            "Esta camada é uma trilha de conciliação por ordem bancária. "
            "Ela não integra as somas da lista principal para evitar dupla contagem."
        ),
    }
    payload = {"metadata": metadata, "pagamentos": rows}
    escrever_atomico(DESTINO, "window.EMENDAS_TESOURO = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n")
    escrever_atomico(CACHE_CSV, csv_bytes)
    escrever_atomico(CACHE_META, json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    return payload


def main() -> int:
    try:
        payload = coletar()
    except Exception as exc:
        if DESTINO.exists():
            print(f"AVISO: coleta do Tesouro falhou ({exc}); base anterior preservada.")
            return 2
        raise
    print(json.dumps(payload["metadata"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
