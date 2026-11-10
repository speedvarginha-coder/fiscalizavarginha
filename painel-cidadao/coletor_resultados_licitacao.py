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
import hashlib
import math
import os
import re
import sys
import time
import urllib.error
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
# Todas as modalidades atualmente ativas no dominio oficial do PNCP. Isso
# evita omitir chamadas publicas, credenciamentos e modalidades internacionais.
MODALIDADES = tuple(range(1, 20))
JANELA_MESES = 8
ITENS_POR_PAGINA = 20
# Compatibilidade com importadores antigos: agora é tamanho da página, não limite.
MAX_ITENS_POR_COMPRA = ITENS_POR_PAGINA
CACHE_PATH = ROOT.parent / "private/state/pncp-resultados-progresso.json"
DEADLINE = None
CACHE_DIAS = 7
# O PNCP passa a responder com 429 quando a varredura sustentada se aproxima
# de 30 requisicoes por minuto. Mantemos uma margem pequena para que a coleta
# completa termine sem lacunas nem ciclos repetidos de backoff.
PAUSA = 2.2
TENTATIVAS = 4
BACKOFF_SEGUNDOS = 2.0
# Homologação simbólica: valor irrisório com estimativa relevante.
LIMIAR_SIMBOLICO = 10.0
LIMIAR_ESTIMADO = 50000.0


def _get(url: str, timeout: int = 30):
    ultimo_erro: Exception | None = None
    for tentativa in range(1, TENTATIVAS + 1):
        if DEADLINE is not None and time.monotonic() >= DEADLINE:
            raise TimeoutError("Janela desta execução encerrada; retomada na próxima coleta")
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "User-Agent": "FiscalizaVarginha/1.0 (controle-social)",
        })
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if r.status == 204:
                    return None
                return json.loads(r.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as exc:
            ultimo_erro = exc
            if tentativa < TENTATIVAS:
                try:
                    retry_after = float(exc.headers.get("Retry-After", ""))
                except (TypeError, ValueError, AttributeError):
                    retry_after = 0
                espera = min(60.0, retry_after or BACKOFF_SEGUNDOS * (2 ** (tentativa - 1)))
                print(f"    tentativa {tentativa}/{TENTATIVAS} falhou; nova tentativa em {espera:.0f}s")
                time.sleep(espera)
        except Exception as exc:
            ultimo_erro = exc
            if tentativa < TENTATIVAS:
                espera = BACKOFF_SEGUNDOS * (2 ** (tentativa - 1))
                print(f"    tentativa {tentativa}/{TENTATIVAS} falhou; nova tentativa em {espera:.0f}s")
                time.sleep(espera)
    raise ultimo_erro or RuntimeError("Falha desconhecida ao consultar PNCP")


def _listar_contratacoes(cnpj: str, data_ini: str, data_fim: str,
                         erros: list[str]) -> list[dict]:
    todas: list[dict] = []
    for modalidade in MODALIDADES:
        if DEADLINE is not None and time.monotonic() >= DEADLINE:
            erros.append(f"Listagem {cnpj} incompleta: janela de coleta encerrada")
            break
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


def _num(v):
    """Converte para float preservando ausencia. None nao pode virar 0.0."""
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _documento_publico(valor):
    texto = str(valor or "")
    digitos = re.sub(r"\D", "", texto)
    if len(digitos) == 11 and "*" not in texto:
        return f"***.{digitos[3:6]}.{digitos[6:9]}-**"
    return texto


def _proteger_documentos(payload):
    """Protege também resultados preservados de uma coleta anterior."""
    alterados = 0
    if isinstance(payload, dict):
        for chave, valor in payload.items():
            if chave == "cnpj_vencedor":
                publico = _documento_publico(valor)
                if publico != valor:
                    payload[chave] = publico
                    alterados += 1
            else:
                alterados += _proteger_documentos(valor)
    elif isinstance(payload, list):
        for valor in payload:
            alterados += _proteger_documentos(valor)
    return alterados


def _sinais_comparaveis(registros):
    """Compara preços unitários do mesmo item; não interpreta causa ou irregularidade."""
    sinais = []
    for compra in registros or []:
        for item in compra.get('resultados') or []:
            estimado = _num(item.get('valor_unitario_estimado'))
            homologado = _num(item.get('valor_unitario_homologado'))
            unidade = str(item.get('unidade_medida') or '').strip()
            if not unidade or estimado is None or homologado is None or not math.isfinite(estimado) or not math.isfinite(homologado) or estimado <= 0 or homologado <= 0:
                continue
            if homologado > LIMIAR_SIMBOLICO or homologado / estimado > 0.01:
                continue
            sinais.append({'orgao':compra.get('orgao'), 'numero_compra':compra.get('numero_compra'),
                'ano':compra.get('ano'), 'controle_pncp':compra.get('controle_pncp'),
                'objeto':compra.get('objeto'), 'item':item.get('item'), 'unidade_medida':unidade,
                'valor_unitario_estimado':estimado, 'valor_unitario_homologado':homologado,
                'metodo':'preco_unitario_mesmo_item', 'vencedor':item.get('vencedor'),
                'cnpj_vencedor':_documento_publico(item.get('cnpj_vencedor'))})
    return sinais


def sanitizar_local() -> int:
    if not OUT_PATH.exists():
        return 0
    payload = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    alterados = _proteger_documentos(payload)
    sinais = _sinais_comparaveis(payload.get('registros'))
    mudou = payload.get('homologacoes_simbolicas') != sinais
    if mudou:
        payload['homologacoes_simbolicas'] = sinais
        payload['metodo_alerta_homologacao'] = 'preco_unitario_mesmo_item'
    if alterados or mudou:
        _salvar_json(OUT_PATH, payload)
    print(f"Documentos pessoais protegidos: {alterados}; itens comparáveis: {len(sinais)}")
    return 0


def _resultados_da_compra(cnpj: str, ano: int, seq: int, progress=None, checkpoint=None) -> list[dict]:
    base = f"{API}/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}"
    out, vistos, pagina = [], set(), 1
    progress = progress if progress is not None else {}
    while True:
        itens = _get(f"{base}/itens?pagina={pagina}&tamanhoPagina={ITENS_POR_PAGINA}") or []
        if not isinstance(itens, list):
            raise ValueError("PNCP retornou uma página de itens inválida")
        for item in itens:
            n = item.get("numeroItem")
            if n is None or n in vistos:
                raise ValueError("PNCP repetiu item ou omitiu seu número; compra preservada")
            vistos.add(n)
            cached = progress.get(str(n))
            resultados = cached if cached is not None else (_get(f"{base}/itens/{n}/resultados") or [])
            if not isinstance(resultados, list):
                raise ValueError("PNCP retornou resultados inválidos")
            if cached is None:
                # Apenas a versão pública mascarada é persistida no progresso.
                resultados = [{**r, 'niFornecedor':_documento_publico(r.get('niFornecedor'))} for r in resultados]
                progress[str(n)] = resultados
                if checkpoint:
                    checkpoint()

            for r in resultados:
                # Ausencia e ausencia: `or 0` aqui transformaria item sem preco
                # publicado em item de graca, e ele entraria em qualquer media.
                qtd = _num(r.get("quantidadeHomologada"))
                if qtd is None:
                    qtd = _num(item.get("quantidade"))
                unitario = _num(r.get("valorUnitarioHomologado"))
                unidade = (item.get("unidadeMedida") or "").strip()
                out.append({
                    "item": n,
                    "descricao_item": (item.get("descricao") or "")[:160],
                    "vencedor": r.get("nomeRazaoSocialFornecedor") or "",
                    "cnpj_vencedor": _documento_publico(r.get("niFornecedor")),
                    "valor_homologado": r.get("valorTotalHomologado"),
                    "quantidade": qtd,
                    "unidade_medida": unidade or None,
                    "valor_unitario_homologado": unitario,
                    "valor_unitario_estimado": _num(item.get("valorUnitarioEstimado")),
                    # Preco unitario so compara com outro preco unitario da MESMA
                    # unidade: "caixa com 100" contra "unidade" produz denuncia falsa.
                    "preco_comparavel": bool(unidade) and unitario is not None and unitario > 0,
                    "data_resultado": (r.get("dataResultado") or "")[:10],
                })
            if cached is None:
                time.sleep(PAUSA)
        if len(itens) < ITENS_POR_PAGINA:
            break
        pagina += 1
    return out


def _salvar_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp{os.getpid()}")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)



def _prioridade_compra(c, cnpj, cache):
    # Não deixar registros antigos expirados bloquearem para sempre os inéditos.
    key = str(c.get('numeroControlePNCP') or f"{cnpj}/{c.get('anoCompra')}/{c.get('sequencialCompra')}")
    saved = cache.get(key)
    if not saved or 'resultados' not in saved:
        return 1
    try:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(saved['consultado_em'])
        fingerprint = hashlib.sha256(json.dumps(c, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        return 0 if timedelta(0) <= age < timedelta(days=CACHE_DIAS) and fingerprint == saved.get('fingerprint') else 2
    except (KeyError, ValueError, TypeError):
        return 2


def _compra_com_retomada(c, cnpj, cache):
    # A listagem é consultada de novo. Qualquer mudança invalida o resultado salvo.
    key = str(c.get("numeroControlePNCP") or f"{cnpj}/{c['anoCompra']}/{c['sequencialCompra']}")
    fingerprint = hashlib.sha256(json.dumps(c, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    saved = cache.get(key, {})
    try:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(saved['consultado_em'])
        valid = timedelta(0) <= age < timedelta(days=CACHE_DIAS)
    except (KeyError, ValueError, TypeError):
        valid = False
    if valid and saved.get('fingerprint') == fingerprint:
        if 'resultados' in saved:
            return saved['resultados'], saved['consultado_em']
        working = saved
    else:
        working = {'fingerprint':fingerprint, 'consultado_em':datetime.now(timezone.utc).isoformat(timespec='seconds'), 'itens':{}}
    def checkpoint():
        cache[key] = working
        _salvar_json(CACHE_PATH, cache)
    resultados = _resultados_da_compra(cnpj, c['anoCompra'], c['sequencialCompra'], working['itens'], checkpoint)
    consulted = working['consultado_em']
    cache[key] = {'fingerprint':fingerprint, 'consultado_em':consulted, 'resultados':resultados}
    _salvar_json(CACHE_PATH, cache)
    return resultados, consulted


def main() -> int:
    global DEADLINE
    DEADLINE = time.monotonic() + max(1, int(os.environ.get('FISCALIZA_PNCP_BUDGET_SECONDS', '1200')))
    try:
        cache = json.loads(CACHE_PATH.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        cache = {}
    hoje = datetime.now()
    data_fim = hoje.strftime("%Y%m%d")
    data_ini = (hoje - timedelta(days=JANELA_MESES * 30)).strftime("%Y%m%d")
    print(f"🏛️ PNCP: resultados de licitação {data_ini}–{data_fim}…")

    compras_out: list[dict] = []
    simbolicas: list[dict] = []
    reconfirmados = set()
    erros: list[str] = []
    anterior: dict = {}
    if OUT_PATH.exists():
        try:
            anterior = json.loads(OUT_PATH.read_text(encoding="utf-8"))
            _proteger_documentos(anterior)
        except Exception as exc:
            erros.append(f"base anterior ilegivel: {exc}")

    compras_para_consulta = []
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
        compras_para_consulta.extend((cnpj, nome_orgao, c, posicao) for posicao, c in enumerate(contratacoes))
    # Uma fila comum impede que a Prefeitura ocupe toda a janela e deixe a Câmara para trás.
    compras_para_consulta.sort(key=lambda item: (_prioridade_compra(item[2], item[0], cache), item[3]))
    for cnpj, nome_orgao, c, _ in compras_para_consulta:
        ano = c.get("anoCompra")
        seq = c.get("sequencialCompra")
        if not (ano and seq):
            continue
        try:
            resultados, consultado_em = _compra_com_retomada(c, cnpj, cache)
        except Exception as exc:
            erros.append(f"Compra {cnpj}/{ano}/{seq}: {exc}")
            continue
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
            "resultados_consultados_em": consultado_em,
        }
        compras_out.append(registro)
        reconfirmados.add(registro["controle_pncp"])
        time.sleep(PAUSA)

    # Guarda-chuva: a API do PNCP pode devolver poucas paginas em falhas
    # transitoria SEM levantar excecao (aconteceu em 20/07/2026: coleta que
    # normalmente leva 12-40min terminou em 29s com 0 compras, sobrescrevendo
    # silenciosamente 302 registros bons). Se a coleta atual voltou vazia e a
    # base anterior tinha volume saudavel, preserva a anterior.
    total_anterior = int(anterior.get("compras") or 0) if isinstance(anterior, dict) else 0
    coleta_suspeita = bool(erros) and total_anterior > 0 and not compras_out
    if coleta_suspeita:
        preservado = dict(anterior)
        preservado["homologacoes_simbolicas"] = _sinais_comparaveis(preservado.get("registros"))
        preservado["metodo_alerta_homologacao"] = "preco_unitario_mesmo_item"
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

    # Se a consulta está incompleta, conserva todos os registros anteriores,
    # inclusive fora da janela atual. O registro reconfirmado vence
    # pelo numeroControlePNCP e a saida fica explicitamente marcada como parcial.
    if erros and isinstance(anterior, dict):
        por_controle = {
            str(r.get("controle_pncp") or ""): r
            for r in anterior.get("registros") or []
            if r.get("controle_pncp")
        }
        for registro in compras_out:
            controle = str(registro.get("controle_pncp") or "")
            if controle:
                por_controle[controle] = registro
        compras_out = list(por_controle.values())

    simbolicas = _sinais_comparaveis(compras_out)
    com_resultado = [c for c in compras_out if c["resultados"]]
    payload = {
        "fonte": "PNCP - Portal Nacional de Contratacoes Publicas (resultados por item)",
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "ultima_coleta_completa_em": (anterior.get("ultima_coleta_completa_em") or (anterior.get("gerado_em") if anterior.get("status") == "ok" else None)) if erros else datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "metodo": ("Resultados por compra conferidos na data resultados_consultados_em, com reaproveitamento por até 7 dias se a listagem oficial não mudou. Consultas incompletas preservam registros anteriores, inclusive fora da janela atual, identificados por suas datas. Contratacoes publicadas pelos orgaos de Varginha no PNCP na "
                   f"janela de {JANELA_MESES} meses, com vencedor e valor homologado "
                   "por item. O alerta compara o preco unitario homologado com a "
                   "estimativa do mesmo item e unidade; solicita verificacao do "
                   "edital e das condicoes, sem presumir irregularidade."),
        "janela": {"inicio": data_ini, "fim": data_fim},
        "compras": len(compras_out),
        "compras_com_resultado": len(com_resultado),
        "homologacoes_simbolicas": simbolicas,
        "metodo_alerta_homologacao": "preco_unitario_mesmo_item",
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
        print(f"  ⚠️ {str(s.get('objeto') or '')[:60]}… → {s.get('vencedor') or 'não informado'}: "
              f"R$ {s['valor_unitario_homologado']:.2f} por {s['unidade_medida']} "
              f"(estimativa unitária R$ {s['valor_unitario_estimado']:,.2f})")
    return 0


if __name__ == "__main__":
    sys.exit(sanitizar_local() if "--sanitizar-local" in sys.argv[1:] else main())
