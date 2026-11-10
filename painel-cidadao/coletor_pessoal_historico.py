"""Arquivo mensal da folha, separado da competência atual e carregado sob demanda."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
from pathlib import Path

import coletor_betha as betha
import coletor_pessoal as pessoal

CHUNKS = Path(__file__).resolve().parent / "data/chunks"
ORGAOS = {
    "prefeitura": ("Prefeitura", betha.PORTAL_HASH, pessoal.PREFEITURA_FOLHA_COMPLETA_ID, pessoal.PREFEITURA_FOLHA_COMPLETA_URL, 500),
    "camara": ("Câmara", pessoal.CAMARA_PORTAL_HASH, pessoal.CAMARA_REMUNERACOES_ID, pessoal.CAMARA_BETHA_URL, 20),
}


def ler(path):
    return json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else {}


def gravar(path, data):
    temporario = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporario.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temporario, path)


def chave_mes(competencia):
    if not re.fullmatch(r"(0[1-9]|1[0-2])/20\d{2}", str(competencia or "")):
        raise ValueError("Competência deve ser MM/AAAA")
    return f"pessoal_folha_{competencia[3:]}_{competencia[:2]}"


def normalizar_mes(rows, orgao, competencia):
    rotulo, _, _, fonte, piso = ORGAOS[orgao]
    if len(rows) < piso:
        raise ValueError(f"Cobertura insuficiente para arquivar: {len(rows)} registros")
    for row in rows:
        carimbo = row.get("competencia")
        if carimbo and str(carimbo) != competencia:
            raise ValueError("Fonte retornou competência diferente da solicitada")
    servidores = pessoal._normaliza_betha(rows, rotulo, f"Folha nominal ({competencia})")
    for servidor, row in zip(servidores, rows):
        servidor["id_registro"] = str(row.get("id_registro") or "")
        servidor["competencia"] = competencia
        servidor["ano"] = int(competencia[3:])
        if orgao == "prefeitura":
            servidor["orgao"] = row.get("orgao", "")
    return {"competencia": competencia, "status": "ok", "fonte": fonte,
            "coletado_em": dt.datetime.now(dt.timezone.utc).isoformat(),
            "metodo": "Consulta Betha filtrada na origem por competência, resposta única com total e identificadores oficiais conferidos",
            "servidores": servidores,
            "resumo": pessoal._resumo(rotulo, servidores, competencia_unica=competencia)}


def baixar_mes(token, portal, consulta, competencia):
    # Vínculos distintos podem ter conteúdo público idêntico. Conferir o ID
    # oficial permite preservá-los sem aceitar páginas repetidas ou truncadas.
    params = {"sortBy": "nomeServidor", "sortDirection": "ASC", "offset": 0, "hiperlink": "false"}
    body = {"competencia": [competencia]}
    probe = betha._api("POST", f"/busca-textual/{consulta}", token, body=body, params={**params, "limit": 1}, portal_hash=portal)
    total = probe.get("totalHits")
    if not isinstance(total, int) or total < 0:
        raise ValueError("Total de registros ausente na fonte")
    if total == 0:
        return []
    resposta = betha._api("POST", f"/busca-textual/{consulta}", token, body=body, params={**params, "limit": total}, portal_hash=portal)
    hits = resposta.get("hits") or []
    ids = [str(hit.get("id") or "") for hit in hits]
    if resposta.get("totalHits") != total or len(hits) != total or "" in ids or len(set(ids)) != total:
        raise ValueError("Resposta incompleta ou com identificadores repetidos")
    return [{**hit["sourceAsMap"], "id_registro": identifier} for hit, identifier in zip(hits, ids)]


def coletar(ano, somente_atual=False):
    atual = ler(CHUNKS / "pessoal.json")
    CHUNKS.mkdir(parents=True, exist_ok=True)
    referencias = [atual.get(orgao, {}).get("competencia") or atual.get(orgao, {}).get("resumo", {}).get("competencia_referencia") for orgao in ORGAOS]
    if somente_atual:
        anos = [int(c[3:]) for c in referencias if re.fullmatch(r"(0[1-9]|1[0-2])/20\d{2}", str(c or ""))]
        if anos:
            ano = max(anos)
    meses = [int(c[:2]) for c in referencias if c and c[3:] == str(ano)]
    if not meses:
        raise ValueError("Folha atual sem competência para delimitar o histórico")
    tokens = {}
    for mes in range(1, max(meses) + 1):
        competencia = f"{mes:02d}/{ano}"
        path = CHUNKS / f"{chave_mes(competencia)}.json"
        payload = ler(path) or {"schema_version": 1, "competencia": competencia}
        for orgao, (rotulo, portal, consulta, _, piso) in ORGAOS.items():
            fonte_atual = atual.get(orgao, {})
            ref = fonte_atual.get("competencia") or fonte_atual.get("resumo", {}).get("competencia_referencia")
            if ref == competencia and len(fonte_atual.get("servidores", [])) >= piso:
                payload[orgao] = fonte_atual
            elif payload.get(orgao, {}).get("servidores") or somente_atual:
                continue
            else:
                print(f"Consultando {rotulo}: {competencia}", flush=True)
                try:
                    if orgao not in tokens:
                        tokens[orgao] = betha.get_token(portal_hash=portal)
                    rows = baixar_mes(tokens[orgao], portal, consulta, competencia)
                    payload[orgao] = normalizar_mes(rows, orgao, competencia)
                    print(f"  Arquivado: {len(rows)} registros", flush=True)
                except Exception as exc:
                    payload[orgao] = {"competencia": competencia, "status": "unavailable", "servidores": [], "motivo": str(exc)[:180]}
                    print(f"  Não disponível: {type(exc).__name__}", flush=True)
        if any(payload.get(orgao, {}).get("servidores") for orgao in ORGAOS):
            gravar(path, payload)
    entradas = []
    for path in sorted(CHUNKS.glob("pessoal_folha_20??_??.json")):
        payload = ler(path)
        competencia = payload.get("competencia")
        if chave_mes(competencia) != path.stem:
            raise ValueError("Arquivo mensal diverge da competência")
        orgaos = {orgao: {"registros": len(payload.get(orgao, {}).get("servidores", [])),
                          "fonte": payload.get(orgao, {}).get("fonte") or ORGAOS[orgao][3]}
                  for orgao in ORGAOS}
        entradas.append({"competencia": competencia, "chunk": path.stem, "orgaos": orgaos})
    gravar(CHUNKS / "pessoal_historico.json", {"schema_version": 1, "gerado_em": dt.datetime.now(dt.timezone.utc).isoformat(), "competencias": entradas})
    print(f"Histórico disponível: {len(entradas)} competências", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ano", type=int, default=dt.date.today().year)
    parser.add_argument("--somente-arquivar-atual", action="store_true")
    args = parser.parse_args()
    coletar(args.ano, args.somente_arquivar_atual)
