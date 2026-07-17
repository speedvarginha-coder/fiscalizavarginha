# -*- coding: utf-8 -*-
"""Coletor TSE — doações de campanha 2024 dos eleitos de Varginha.

Fonte: API pública DivulgaCandContas (dados oficiais de prestação de
contas). Baixa os doadores declarados dos 15 vereadores eleitos e do
prefeito eleito em 2024 e cruza com a base local de fornecedores,
contratados e sócios (QSA).

Doar para campanha é LEGAL e público. O cruzamento é informativo: doador
que depois recebe recurso público do município merece transparência,
nunca acusação automática. O match por CPF/CNPJ é exato; o match por
nome de sócio é indício (homônimos possíveis) e vem sinalizado.

Saída: data/chunks/tse_doacoes.json
"""
from __future__ import annotations

import json
import re
import sys
import time
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
CHUNKS = ROOT / "data" / "chunks"
OUT_PATH = CHUNKS / "tse_doacoes.json"

API = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1"
ID_ELEICAO = "2045202024"   # Eleições municipais 2024 - 1º turno
ANO = 2024
COD_VARGINHA = "54135"
CARGO_PREFEITO = 11
CARGO_VEREADOR = 13
PAUSA = 0.6


def _get(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").upper())
    s = s.encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip()


def _digitos(s: str) -> str:
    return "".join(c for c in (s or "") if c.isdigit())


def _cnpj_raiz(s: str) -> str:
    d = _digitos(s)
    return d[:8] if len(d) == 14 else ""


def _ler_json(path: Path) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def listar_eleitos(cargo: int) -> list[dict]:
    d = _get(f"{API}/candidatura/listar/{ANO}/{COD_VARGINHA}/{ID_ELEICAO}/{cargo}/candidatos")
    out = []
    for c in d.get("candidatos", []):
        tot = str(c.get("descricaoTotalizacao", "")).upper()
        if tot.startswith("ELEITO"):
            out.append(c)
    return out


def doadores_do_candidato(c: dict) -> tuple[list[dict], dict]:
    numero = c.get("numero")
    partido = str(numero)[:2]
    cargo = c.get("cargo", {}).get("codigo") or (CARGO_VEREADOR if len(str(numero)) == 5 else CARGO_PREFEITO)
    url = (f"{API}/prestador/consulta/{ID_ELEICAO}/{ANO}/{COD_VARGINHA}/"
           f"{cargo}/{partido}/{numero}/{c.get('id')}")
    p = _get(url)
    consolidado = p.get("dadosConsolidados") or {}
    doadores = []
    for d in p.get("rankingDoadores") or []:
        doadores.append({
            "cpf_cnpj": _digitos(d.get("cpfCnpj")),
            "nome": d.get("nome") or "",
            "valor": float(d.get("valor") or 0),
            "doacoes_qtd": int(str(d.get("qntd") or 0) or 0),
            "financiamento_coletivo": bool(d.get("stFinanciamentoColetivo")),
        })
    return doadores, {
        "total_recebido": consolidado.get("totalRecebido"),
        "qtd_doacoes": consolidado.get("qtdRecebido"),
    }


def montar_base_local() -> tuple[dict, dict]:
    """Índices locais: raiz de CNPJ -> fornecedor; nome de sócio -> empresas."""
    pref = _ler_json(CHUNKS / "prefeitura.json")
    cam = _ler_json(CHUNKS / "camara_betha.json")
    cnpjs = _ler_json(CHUNKS / "cnpjs.json")

    raiz_para_forn: dict[str, str] = {}
    for lista, campo_nome in (
        (pref.get("top_fornecedores_atual") or [], "nome"),
        (cam.get("top_fornecedores_atual") or [], "nome"),
        (pref.get("contratos") or [], "contratado"),
        (cam.get("contratos") or [], "contratado"),
    ):
        for item in lista:
            raiz = _cnpj_raiz(item.get("cnpj") or "")
            if raiz and raiz not in raiz_para_forn:
                raiz_para_forn[raiz] = item.get(campo_nome) or ""

    socio_para_empresas: dict[str, list[str]] = {}
    for e in cnpjs.get("empresas") or []:
        for s in e.get("socios") or []:
            key = _norm(s)
            if len(key.split()) >= 2:
                socio_para_empresas.setdefault(key, []).append(
                    e.get("razao_social") or e.get("nome_fantasia") or "")
    return raiz_para_forn, socio_para_empresas


def cruzar(doador: dict, raiz_para_forn: dict, socio_para_empresas: dict) -> list[dict]:
    matches = []
    raiz = _cnpj_raiz(doador["cpf_cnpj"]) if len(doador["cpf_cnpj"]) == 14 else ""
    if raiz and raiz in raiz_para_forn:
        matches.append({
            "tipo": "doador_e_fornecedor",
            "confianca": "exata_por_cnpj",
            "detalhe": f"CNPJ do doador coincide com fornecedor/contratado: {raiz_para_forn[raiz]}",
        })
    nome_n = _norm(doador["nome"])
    if nome_n in socio_para_empresas:
        matches.append({
            "tipo": "doador_e_socio_de_empresa",
            "confianca": "nome_identico_homonimo_possivel",
            "detalhe": ("Nome do doador coincide com sócio de: "
                        + "; ".join(socio_para_empresas[nome_n][:3])
                        + ". Sem CPF no QSA — conferir manualmente."),
        })
    return matches


def main() -> int:
    print("🗳️ TSE: doações de campanha 2024 dos eleitos de Varginha…")
    try:
        eleitos = listar_eleitos(CARGO_VEREADOR) + listar_eleitos(CARGO_PREFEITO)
    except Exception as e:
        print(f"✗ Falha ao listar eleitos no TSE: {e} — chunk anterior preservado.")
        return 0
    print(f"  {len(eleitos)} eleitos localizados.")

    raiz_para_forn, socio_para_empresas = montar_base_local()
    resultado = []
    erros = []
    total_cruzamentos = 0

    for c in eleitos:
        time.sleep(PAUSA)
        try:
            doadores, consolidado = doadores_do_candidato(c)
        except Exception as e:
            erros.append(f"{c.get('nomeUrna')}: {e}")
            continue
        cruzados = []
        for d in doadores:
            m = cruzar(d, raiz_para_forn, socio_para_empresas)
            if m:
                total_cruzamentos += len(m)
            cruzados.append({**d, "cpf_cnpj": (d["cpf_cnpj"][:5] + "***" if d["cpf_cnpj"] else ""),
                             "cruzamentos": m})
        resultado.append({
            "nome_urna": c.get("nomeUrna"),
            "nome_completo": c.get("nomeCompleto"),
            "partido": (c.get("partido") or {}).get("sigla"),
            "cargo": "Prefeito" if len(str(c.get("numero"))) == 2 else "Vereador",
            "situacao": c.get("descricaoTotalizacao"),
            "total_recebido": consolidado.get("total_recebido"),
            "qtd_doacoes": consolidado.get("qtd_doacoes"),
            "doadores": cruzados,
        })
        print(f"  ✓ {c.get('nomeUrna')}: {len(cruzados)} doador(es) no ranking")

    payload = {
        "fonte": "TSE - DivulgaCandContas (prestacao de contas eleicoes 2024)",
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "metodo": ("Doadores declarados (ranking oficial) dos eleitos de Varginha "
                   "em 2024, cruzados com fornecedores/contratados (match exato "
                   "por raiz de CNPJ) e socios do QSA (match por nome identico — "
                   "homonimos possiveis). Doacao de campanha e legal e publica; "
                   "o cruzamento e informativo e nao presume irregularidade."),
        "eleitos": len(eleitos),
        "cruzamentos_encontrados": total_cruzamentos,
        "candidatos": resultado,
        "erros": erros,
    }
    OUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ {len(resultado)} eleitos, {total_cruzamentos} cruzamento(s) → tse_doacoes.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
