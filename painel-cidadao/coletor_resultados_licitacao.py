# -*- coding: utf-8 -*-
"""Coletor de resultados de licitação — PNCP.

O portal Betha publica a licitação e o valor estimado, mas NÃO diz quem
venceu nem por quanto foi homologado. O PNCP tem esse dado: este coletor
percorre as contratações da Prefeitura e da Câmara e captura, por item,
o fornecedor vencedor e o valor homologado.

Motivação: a Feira da Paz 2026 (pregão 150) foi homologada por R$ 0,01
para a CLX/IPASS — mesmo padrão de 2025 (EPICO, R$ 0,01). Homologação
simbólica é legal no modelo de exploração comercial, mas o cidadão
precisa VER o vencedor e o valor real para cobrar as contrapartidas.

Saída: data/chunks/licitacoes_resultados.json
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
CHUNKS = ROOT / "data" / "chunks"
OUT_PATH = CHUNKS / "licitacoes_resultados.json"

API = "https://pncp.gov.br/api"
ORGAOS = {
    "18240119000105": "Prefeitura Municipal de Varginha",
    "04366790000184": "Câmara Municipal de Varginha",
}
# Modalidades relevantes (códigos PNCP): 6 pregão eletrônico, 7 pregão
# presencial, 4 concorrência eletrônica, 5 concorrência presencial,
# 8 dispensa, 9 inexigibilidade.
MODALIDADES = (6, 7, 4, 5, 8, 9)
JANELA_MESES = 8
MAX_ITENS_POR_COMPRA = 20
PAUSA = 0.25
TENTATIVAS = 3
BACKOFF_SEGUNDOS = 2.0
# Homologação simbólica: valor irrisório com estimativa relevante.
LIMIAR_SIMBOLICO = 10.0
LIMIAR_ESTIMADO = 50000.0


def _get(url: str, timeout: int = 30):
    ultimo_erro: Exception | None = None
    for tentativa in range(1, TENTATIVAS + 1):
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "User-Agent": "FiscalizaVarginha/1.0 (controle-social)",
        })
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if r.status == 204:
                    return None
                return json.loads(r.read().decode("utf-8", errors="replace"))
        except Exception as exc:
            ultimo_erro = exc
            if tentativa < TENTATIVAS:
                espera = BACKOFF_SEGUNDOS * tentativa
                print(f"    tentativa {tentativa}/{TENTATIVAS} falhou; nova tentativa em {espera:.0f}s")
                time.sleep(espera)
    raise ultimo_erro or RuntimeError("Falha desconhecida ao consultar PNCP")


def _listar_contratacoes(cnpj: str, data_ini: str, data_fim: str,
                         erros: list[str]) -> list[dict]:
    todas: list[dict] = []
    for modalidade in MODALIDADES:
        pagina = 1
        while True:
            # Atencao: o parametro correto e "cnpj" — "cnpjOrgao" e IGNORADO
            # pela API e devolve contratacoes do Brasil inteiro (verificado
            # em 17/07/2026: 5400 registros, zero de Varginha).
            params = urllib.parse.urlencode({
                "dataInicial": data_ini, "dataFinal": data_fim,
                "cnpj": cnpj, "codigoModalidadeContratacao": modalidade,
                "pagina": pagina, "tamanhoPagina": 50,
            })
            try:
                payload = _get(f"{API}/consulta/v1/contratacoes/publicacao?{params}")
            except Exception as e:
                msg = f"contratacoes {cnpj} mod {modalidade} pg {pagina}: {e}"
                erros.append(msg)
                print(f"  ! {msg}")
                break
            regs = (payload or {}).get("data") or []
            todas.extend(regs)
            total = (payload or {}).get("totalPaginas") or 1
            if pagina >= total or not regs:
                break
            pagina += 1
            time.sleep(PAUSA)
        time.sleep(PAUSA)
    return todas


def _resultados_da_compra(cnpj: str, ano: int, seq: int) -> list[dict]:
    base = f"{API}/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}"
    try:
        itens = _get(f"{base}/itens?pagina=1&tamanhoPagina={MAX_ITENS_POR_COMPRA}") or []
    except Exception:
        return []
    out = []
    for item in itens:
        n = item.get("numeroItem")
        try:
            resultados = _get(f"{base}/itens/{n}/resultados") or []
        except Exception:
            continue
        for r in resultados:
            out.append({
                "item": n,
                "descricao_item": (item.get("descricao") or "")[:160],
                "vencedor": r.get("nomeRazaoSocialFornecedor") or "",
                "cnpj_vencedor": r.get("niFornecedor") or "",
                "valor_homologado": r.get("valorTotalHomologado"),
                "data_resultado": (r.get("dataResultado") or "")[:10],
            })
        time.sleep(PAUSA)
    return out


def main() -> int:
    hoje = datetime.now()
    data_fim = hoje.strftime("%Y%m%d")
    data_ini = (hoje - timedelta(days=JANELA_MESES * 30)).strftime("%Y%m%d")
    print(f"🏛️ PNCP: resultados de licitação {data_ini}–{data_fim}…")

    compras_out: list[dict] = []
    simbolicas: list[dict] = []
    erros: list[str] = []
    anterior: dict = {}
    if OUT_PATH.exists():
        try:
            anterior = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except Exception as exc:
            erros.append(f"base anterior ilegivel: {exc}")

    for cnpj, nome_orgao in ORGAOS.items():
        contratacoes = _listar_contratacoes(cnpj, data_ini, data_fim, erros)
        # Cinto e suspensorio: se a API voltar a ignorar o filtro de orgao,
        # registros de outros entes NAO podem entrar na base publicada.
        antes = len(contratacoes)
        contratacoes = [
            c for c in contratacoes
            if str(c.get("numeroControlePNCP") or "").startswith(cnpj)
        ]
        if antes != len(contratacoes):
            erros.append(f"{nome_orgao}: {antes - len(contratacoes)} registros de outros orgaos descartados (filtro da API falhou)")
        print(f"  {nome_orgao}: {len(contratacoes)} contratações no período")
        for c in contratacoes:
            ano = c.get("anoCompra")
            seq = c.get("sequencialCompra")
            if not (ano and seq):
                continue
            resultados = _resultados_da_compra(cnpj, ano, seq)
            registro = {
                "orgao": nome_orgao,
                "numero_compra": c.get("numeroCompra"),
                "ano": ano,
                "controle_pncp": c.get("numeroControlePNCP"),
                "modalidade": c.get("modalidadeNome"),
                "objeto": (c.get("objetoCompra") or "")[:220],
                "valor_estimado": c.get("valorTotalEstimado"),
                "valor_homologado_total": c.get("valorTotalHomologado"),
                "situacao": c.get("situacaoCompraNome"),
                "data_publicacao": (c.get("dataPublicacaoPncp") or "")[:10],
                "resultados": resultados,
            }
            compras_out.append(registro)
            estimado = float(c.get("valorTotalEstimado") or 0)
            for r in resultados:
                homolog = float(r.get("valor_homologado") or 0)
                if 0 < homolog <= LIMIAR_SIMBOLICO and estimado >= LIMIAR_ESTIMADO:
                    simbolicas.append({
                        "orgao": nome_orgao,
                        "numero_compra": c.get("numeroCompra"),
                        "ano": ano,
                        "objeto": (c.get("objetoCompra") or "")[:160],
                        "vencedor": r["vencedor"],
                        "cnpj_vencedor": r["cnpj_vencedor"],
                        "valor_homologado": homolog,
                        "valor_estimado": estimado,
                        "controle_pncp": c.get("numeroControlePNCP"),
                    })
            time.sleep(PAUSA)

    # Guarda-chuva: a API do PNCP pode devolver poucas paginas em falhas
    # transitoria SEM levantar excecao (aconteceu em 20/07/2026: coleta que
    # normalmente leva 12-40min terminou em 29s com 0 compras, sobrescrevendo
    # silenciosamente 302 registros bons). Se a coleta atual voltou vazia e a
    # base anterior tinha volume saudavel, preserva a anterior.
    total_anterior = int(anterior.get("compras") or 0) if isinstance(anterior, dict) else 0
    coleta_suspeita = bool(erros) and total_anterior >= 50 and len(compras_out) < max(50, total_anterior * 0.5)
    if coleta_suspeita:
        preservado = dict(anterior)
        preservado["status"] = "preserved"
        preservado["ultima_tentativa_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        preservado["motivo_preservacao"] = (
            f"PNCP retornou apenas {len(compras_out)} de {total_anterior} compras anteriores "
            "apos repeticoes; a ultima base valida foi mantida para evitar perda de dados."
        )
        preservado["erros_ultima_tentativa"] = erros[:20]
        _tmp = OUT_PATH.with_name(f".{OUT_PATH.name}.tmp{os.getpid()}")
        _tmp.write_text(json.dumps(preservado, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(_tmp, OUT_PATH)
        print(f"⚠️ Coleta parcial ({len(compras_out)}/{total_anterior}); base anterior preservada.")
        return 0

    # Se algumas modalidades falharam, conserva os registros ainda dentro da
    # janela que nao reapareceram na tentativa atual. O registro atual vence
    # pelo numeroControlePNCP e a saida fica explicitamente marcada como parcial.
    if erros and isinstance(anterior, dict):
        limite_iso = datetime.strptime(data_ini, "%Y%m%d").strftime("%Y-%m-%d")
        por_controle = {
            str(r.get("controle_pncp") or ""): r
            for r in anterior.get("registros") or []
            if str(r.get("data_publicacao") or "") >= limite_iso and r.get("controle_pncp")
        }
        for registro in compras_out:
            controle = str(registro.get("controle_pncp") or "")
            if controle:
                por_controle[controle] = registro
        compras_out = list(por_controle.values())

    com_resultado = [c for c in compras_out if c["resultados"]]
    payload = {
        "fonte": "PNCP - Portal Nacional de Contratacoes Publicas (resultados por item)",
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "metodo": ("Contratacoes publicadas pelos orgaos de Varginha no PNCP na "
                   f"janela de {JANELA_MESES} meses, com vencedor e valor homologado "
                   "por item. Homologacao simbolica (<= R$ 10 com estimativa >= R$ 50 mil) "
                   "e o modelo legal de exploracao comercial: o alerta pede as "
                   "contrapartidas do edital, nao presume irregularidade."),
        "janela": {"inicio": data_ini, "fim": data_fim},
        "compras": len(compras_out),
        "compras_com_resultado": len(com_resultado),
        "homologacoes_simbolicas": simbolicas,
        "registros": compras_out,
        "erros": erros[:20],
        "status": "partial" if erros else "ok",
        "qualidade_coleta": {
            "tentativas_por_requisicao": TENTATIVAS,
            "falhas": len(erros),
            "base_anterior_preservada": bool(erros and total_anterior),
        },
    }
    _tmp = OUT_PATH.with_name(f".{OUT_PATH.name}.tmp{os.getpid()}")
    _tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(_tmp, OUT_PATH)
    print(f"✓ {len(compras_out)} compras, {len(com_resultado)} com resultado, "
          f"{len(simbolicas)} homologação(ões) simbólica(s) → licitacoes_resultados.json")
    for s in simbolicas[:5]:
        print(f"  ⚠️ {s['objeto'][:60]}… → {s['vencedor']} por R$ {s['valor_homologado']:.2f} "
              f"(estimado R$ {s['valor_estimado']:,.2f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
