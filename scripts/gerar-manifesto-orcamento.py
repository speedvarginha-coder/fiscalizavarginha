"""Gera o manifesto SHA-256 do acervo orcamentario (LDO, LOA e PPA).

Os PDFs ficam fora do git por peso (cerca de 215 MB). O que entra no
repositorio e este manifesto: sem ele voce tem o arquivo, mas nao consegue
provar que e o mesmo que baixou da fonte oficial na data da coleta.

Uso:
    py scripts/gerar-manifesto-orcamento.py            # grava e resume
    py scripts/gerar-manifesto-orcamento.py --conferir # so confere, nao grava
"""
from __future__ import annotations

import csv
import hashlib
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parents[1] / "docs" / "orcamento-varginha"
INVENTARIO = BASE / "arquivos-baixados.csv"
MANIFESTO = BASE / "MANIFESTO-SHA256.csv"


def _rel(caminho: Path) -> str:
    return caminho.relative_to(BASE).as_posix()


def carregar_origens() -> dict[str, str]:
    """Le a origem de cada arquivo do inventario gerado na coleta."""
    if not INVENTARIO.exists():
        return {}
    origens: dict[str, str] = {}
    # utf-8-sig: o inventario vem com BOM.
    with open(INVENTARIO, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            bruto = (row.get("Arquivo") or "").strip()
            if not bruto:
                continue
            try:
                origens[_rel(Path(bruto).resolve())] = (row.get("Origem") or "").strip()
            except ValueError:
                # caminho fora da pasta do acervo: ignora em vez de quebrar
                continue
    return origens


def coletar() -> list[dict]:
    origens = carregar_origens()
    linhas = []
    for pdf in sorted(BASE.rglob("*.pdf")):
        conteudo = pdf.read_bytes()
        rel = _rel(pdf)
        linhas.append({
            "arquivo": rel,
            "bytes": len(conteudo),
            "sha256": hashlib.sha256(conteudo).hexdigest(),
            "origem": origens.get(rel, ""),
        })
    return linhas


def gravar(linhas: list[dict]) -> None:
    with open(MANIFESTO, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["arquivo", "bytes", "sha256", "origem"])
        w.writeheader()
        w.writerows(linhas)


def conferir(linhas: list[dict]) -> int:
    """Compara o disco com o manifesto ja gravado. Retorna a qtd de divergencias."""
    if not MANIFESTO.exists():
        print("Manifesto ainda nao existe. Rode sem --conferir para criar.")
        return 1
    with open(MANIFESTO, encoding="utf-8", newline="") as f:
        registrado = {r["arquivo"]: r["sha256"] for r in csv.DictReader(f)}

    atual = {l["arquivo"]: l["sha256"] for l in linhas}
    divergencias = 0

    for arquivo, sha in sorted(atual.items()):
        esperado = registrado.get(arquivo)
        if esperado is None:
            print(f"NOVO (fora do manifesto): {arquivo}")
            divergencias += 1
        elif esperado != sha:
            print(f"ALTERADO: {arquivo}")
            print(f"   manifesto: {esperado}")
            print(f"   disco    : {sha}")
            divergencias += 1

    for arquivo in sorted(set(registrado) - set(atual)):
        print(f"AUSENTE no disco: {arquivo}")
        divergencias += 1

    return divergencias


def main() -> int:
    if not BASE.exists():
        print(f"Acervo nao encontrado: {BASE}")
        return 1

    linhas = coletar()
    if not linhas:
        print("Nenhum PDF encontrado no acervo.")
        return 1

    if "--conferir" in sys.argv:
        divergencias = conferir(linhas)
        if divergencias:
            print(f"\n{divergencias} divergencia(s) entre disco e manifesto.")
            return 1
        print(f"Acervo integro: {len(linhas)} PDFs conferem com o manifesto.")
        return 0

    gravar(linhas)
    sem_origem = sum(1 for l in linhas if not l["origem"])
    print(f"Manifesto gravado: {MANIFESTO}")
    print(f"  PDFs .............. {len(linhas)}")
    print(f"  com origem ........ {len(linhas) - sem_origem}")
    print(f"  sem origem ........ {sem_origem}")
    print(f"  bytes totais ...... {sum(l['bytes'] for l in linhas):,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
