#!/usr/bin/env python3
"""Reaplica a regra atual do coletor de pessoal ao dado JA publicado.

Por que existe
--------------
Em 15/08/2026 o coletor passou a exigir competencia carimbada para publicar
qualquer total mensal de folha (commit "fix(pessoal): nao publicar folha de
varios meses como custo mensal"). O codigo foi corrigido, mas o chunk
versionado continuou sendo o da coleta de 11/08 — e ele publica R$ 56,3 milhoes
como folha mensal da Camara, com 12.486 "servidores" para 246 pessoas reais.

Recoletar resolve. Quando a recoleta nao esta disponivel (fonte fora do ar,
token ausente, maquina de coleta parada), este script reconcilia o dado
publicado com a regra vigente sem inventar nada:

  - Orgao com a garantia de mes unico na origem (a folha completa filtra a
    competencia na consulta, e o proprio status registra qual mes): carimba a
    competencia em cada linha e recalcula o resumo com competencia_unica. Os
    totais nao mudam — eles ja eram de um mes so; o que faltava era o dado
    dizer isso.
  - Orgao sem essa garantia e sem competencia nas linhas: recalcula pelo
    caminho normal, que zera os campos mensais e marca
    competencia_indeterminada. O painel passa a publicar a limitacao em vez de
    um numero que nao consegue defender.

A regra nao e reescrita aqui: o script importa _resumo do proprio
coletor_pessoal. Se a regra mudar la, este script acompanha.

Idempotente: rodar duas vezes nao muda nada na segunda.

Uso:
    python scripts/reparar-folha-publicada.py [--dry-run]

Depois de rodar, regenere o manifesto:
    npm run data:bundle
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAINEL = ROOT / "painel-cidadao"
if str(PAINEL) not in sys.path:
    sys.path.insert(0, str(PAINEL))

from coletor_pessoal import _resumo  # noqa: E402

ALVOS = [
    PAINEL / "data" / "chunks" / "pessoal.json",
    PAINEL / "data" / "pessoal.json",
]

# "…(folha completa, competencia 07/2026)" — a marca que o proprio coletor
# grava quando a consulta filtrou o mes na origem. E essa frase, e nao a
# presenca de um campo `competencia` solto, que autoriza tratar o array como
# um unico mes.
GARANTIA_MES_UNICO = re.compile(
    r"folha\s+completa.*?compet[eê]ncia\s+(\d{2}/\d{4})",
    re.IGNORECASE | re.DOTALL,
)

STATUS_INDETERMINADO = (
    "Coletado automaticamente via Betha, mas a competencia de cada linha nao "
    "veio na fonte: mes de referencia e totais mensais ficam indisponiveis."
)


def competencia_garantida(orgao: dict) -> str | None:
    """Mes que a fonte garante ser unico, ou None se nao houver garantia."""
    m = GARANTIA_MES_UNICO.search(str(orgao.get("status") or ""))
    if not m:
        return None
    declarada = str(orgao.get("competencia") or "").strip()
    mes = m.group(1)
    # Se o orgao carimbou um mes diferente do que o status descreve, nao da
    # para escolher entre os dois: sem garantia.
    if declarada and declarada != mes:
        return None
    return mes


def repara_orgao(nome: str, orgao: dict) -> list[str]:
    servidores = orgao.get("servidores")
    if not isinstance(servidores, list):
        return []

    mudancas: list[str] = []
    mes = competencia_garantida(orgao)

    if mes:
        faltando = [s for s in servidores if isinstance(s, dict) and not s.get("competencia")]
        if faltando:
            for s in faltando:
                s["competencia"] = mes
            mudancas.append(f"carimbou competencia {mes} em {len(faltando)} linha(s)")
        novo = _resumo(orgao.get("resumo", {}).get("orgao") or nome, servidores, competencia_unica=mes)
        orgao["competencia"] = mes
    else:
        novo = _resumo(orgao.get("resumo", {}).get("orgao") or nome, servidores)
        ref = novo.get("competencia_referencia")
        if ref:
            orgao["competencia"] = ref
            orgao["status"] = f"Coletado automaticamente via Betha (competencia {ref})"
        else:
            # Espelha o que coletar() grava neste caso: sem mes, o orgao nao
            # pode carimbar um e o status precisa explicar o vazio.
            if orgao.get("competencia"):
                mudancas.append(f"removeu competencia {orgao['competencia']} sem lastro no resumo")
            orgao["competencia"] = None
            orgao["status"] = STATUS_INDETERMINADO

    antigo = orgao.get("resumo") or {}
    if antigo != novo:
        for campo in ("folha_bruta_total", "servidores_qtd", "competencia_referencia"):
            de, para = antigo.get(campo), novo.get(campo)
            if de != para:
                mudancas.append(f"{campo}: {de!r} -> {para!r}")
        orgao["resumo"] = novo

    return mudancas


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="mostra o que mudaria, sem gravar")
    args = ap.parse_args()

    tocou = False
    for alvo in ALVOS:
        if not alvo.exists():
            continue
        dados = json.loads(alvo.read_text(encoding="utf-8"))
        relatorio: dict[str, list[str]] = {}
        for nome, orgao in dados.items():
            if isinstance(orgao, dict) and "servidores" in orgao:
                mudancas = repara_orgao(nome, orgao)
                if mudancas:
                    relatorio[nome] = mudancas

        rel = alvo.relative_to(ROOT)
        if not relatorio:
            print(f"OK  {rel}: ja consistente com a regra atual.")
            continue

        tocou = True
        print(f"{'(dry-run) ' if args.dry_run else ''}{rel}:")
        for nome, mudancas in relatorio.items():
            print(f"  {nome}:")
            for m in mudancas:
                print(f"    - {m}")
        if not args.dry_run:
            alvo.write_text(
                json.dumps(dados, ensure_ascii=False, indent=2),
                encoding="utf-8",
                newline="\n",
            )

    if tocou and not args.dry_run:
        print("\nDado reparado. Rode `npm run data:bundle` para regenerar o manifesto.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
