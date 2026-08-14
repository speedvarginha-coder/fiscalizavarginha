# -*- coding: utf-8 -*-
"""Coletor do Plano de Contratacoes Anual (PCA) publicado no PNCP.

O PCA e a declaracao oficial do que cada entidade pretende comprar no ano, com
preco unitario e unidade de fornecimento — o unico lugar onde Varginha publica
"R$ 658,85 por tonelada de CBUQ" em vez de "R$ 9,8 milhoes de contrato".

Tres regras de honestidade valem aqui, e estao codificadas, nao so descritas:

1. Ausencia nao vira zero. Entidade sem PCA publicado sai com status proprio e
   a URL consultada, para o leitor conferir que a lacuna e da fonte.
2. Preco unitario sem unidade de fornecimento nao e comparavel. O item e
   mantido, mas marcado, e nao entra em nenhuma estatistica de preco.
3. A reconciliacao com o que foi efetivamente comprado fica no nivel de TOTAL,
   nunca item a item: o PNCP devolve `codigoItem` nulo para Varginha, entao
   casar "CBUQ planejado" com "CBUQ comprado" exigiria comparar texto livre.
   Errar esse casamento produziria "item planejado que sumiu" falso.
"""
from __future__ import annotations

import datetime as dt
import json
import socket
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://pncp.gov.br/api/pncp/v1"
PORTAL = "https://pncp.gov.br/app/pca"

# As quatro entidades de Varginha que publicam PCA proprio no PNCP.
ENTIDADES = {
    "prefeitura": ("18240119000105", "Município de Varginha"),
    "camara": ("04366790000184", "Câmara Municipal de Varginha"),
    "inprev": ("09215261000101", "INPREV — Instituto de Previdência dos Servidores"),
    "fundacao_cultural": ("18987735000116", "Fundação Cultural do Município de Varginha"),
}

# O PCA e publicado por unidade, cada uma num sequencial. Nao ha endpoint que
# liste os sequenciais existentes: a varredura e a unica rota. 204 = sequencial
# valido e vazio; 200 = tem itens. O intervalo cobre o observado com folga.
SEQUENCIAIS = range(1, 11)

RETRY_HTTP_CODES = {408, 425, 429, 500, 502, 503, 504}
REQUEST_ATTEMPTS = 4
REQUEST_PAUSE = 1.6
TAMANHO_PAGINA = 500


def _retry_after(headers, fallback: float) -> float:
    try:
        return max(0.0, min(float(headers.get("Retry-After", "")), 60.0))
    except (TypeError, ValueError, AttributeError):
        return fallback


def _get(url: str, timeout: int = 45):
    """GET publico. Devolve (payload, status). 204 vira (None, 204)."""
    last = None
    for tentativa in range(REQUEST_ATTEMPTS):
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "User-Agent": "FiscalizaVarginha/1.0 (controle-social)",
        })
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if r.status == 204:
                    return None, 204
                raw = r.read().decode("utf-8", errors="replace").strip()
                if not raw:
                    return None, 204
                return json.loads(raw), r.status
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 404:
                return None, 404
            if exc.code not in RETRY_HTTP_CODES or tentativa + 1 >= REQUEST_ATTEMPTS:
                raise
            espera = min(60.0, 15.0 * (tentativa + 1)) if exc.code == 429 else 2 ** tentativa
            time.sleep(_retry_after(exc.headers, espera))
        except (urllib.error.URLError, TimeoutError, socket.timeout, json.JSONDecodeError) as exc:
            last = exc
            if tentativa + 1 >= REQUEST_ATTEMPTS:
                raise
            time.sleep(2 ** tentativa)
    raise last or RuntimeError("falha desconhecida no PNCP")


def _num(v):
    """Converte para float sem transformar ausencia em zero."""
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _normaliza_item(row: dict) -> dict:
    qtd = _num(row.get("quantidade"))
    unit = _num(row.get("valorUnitario"))
    total = _num(row.get("valorTotal"))
    unidade = (row.get("unidadeFornecimento") or "").strip()

    # Preco unitario sem unidade de fornecimento nao e comparavel com nada:
    # "R$ 658,85" e barato por tonelada e caro por quilo. O item continua no
    # plano, mas fora de qualquer estatistica de preco.
    comparavel = bool(unidade) and qtd is not None and unit is not None and qtd > 0

    return {
        "numero_item": row.get("numeroItem"),
        "descricao": (row.get("descricao") or "").strip(),
        "classificacao_codigo": (row.get("classificacaoSuperiorCodigo") or "").strip() or None,
        "classificacao_nome": (row.get("classificacaoSuperiorNome") or "").strip() or None,
        # codigoItem e o codigo de catalogo (CATMAT/CATSER). Varginha publica
        # nulo: sem ele nao da para casar com o banco de precos federal.
        "codigo_catalogo": row.get("codigoItem") or None,
        "catalogo": (row.get("nomeCatalogo") or "").strip() or None,
        "unidade_fornecimento": unidade or None,
        "quantidade": qtd,
        "valor_unitario": unit,
        "valor_total": total,
        "valor_orcamento_exercicio": _num(row.get("valorOrcamentoExercicio")),
        "data_desejada": row.get("dataDesejada"),
        "unidade_requisitante": (row.get("unidadeRequisitante") or "").strip() or None,
        "unidade_responsavel": (row.get("nomeUnidade") or "").strip() or None,
        "sequencial_pca": row.get("sequencialPca"),
        "preco_comparavel": comparavel,
    }


def _coleta_itens(cnpj: str, ano: int) -> tuple[list[dict], list[str], list[int]]:
    """Varre os sequenciais do PCA. Devolve (itens, urls, sequenciais_com_dados)."""
    itens: list[dict] = []
    urls: list[str] = []
    com_dados: list[int] = []

    for seq in SEQUENCIAIS:
        pagina = 1
        achou_algo = False
        while True:
            qs = urllib.parse.urlencode({"pagina": pagina, "tamanhoPagina": TAMANHO_PAGINA})
            url = f"{API}/orgaos/{cnpj}/pca/{ano}/{seq}/itens?{qs}"
            payload, status = _get(url)
            urls.append(url)
            time.sleep(REQUEST_PAUSE)

            linhas = payload if isinstance(payload, list) else []
            if not linhas:
                break
            achou_algo = True
            itens.extend(_normaliza_item(x) for x in linhas)
            if len(linhas) < TAMANHO_PAGINA:
                break
            pagina += 1
        if achou_algo:
            com_dados.append(seq)

    return itens, urls, com_dados


def _resumo(itens: list[dict]) -> dict:
    """Estatisticas que so contam o que e defensavel."""
    comparaveis = [i for i in itens if i["preco_comparavel"]]
    total_declarado = sum(i["valor_total"] for i in itens if i["valor_total"] is not None)
    sem_valor = [i for i in itens if i["valor_total"] is None]

    por_classe: dict[str, dict] = {}
    for i in itens:
        chave = i["classificacao_nome"] or "Sem classificação informada"
        alvo = por_classe.setdefault(chave, {
            "classificacao": chave,
            "codigo": i["classificacao_codigo"],
            "itens": 0,
            "valor_total": 0.0,
        })
        alvo["itens"] += 1
        if i["valor_total"] is not None:
            alvo["valor_total"] += i["valor_total"]

    return {
        "itens_qtd": len(itens),
        "itens_com_preco_comparavel": len(comparaveis),
        # Nao publicar como "total do plano" um numero que ignora itens sem
        # valor: quem le precisa saber quantos ficaram de fora da soma.
        "valor_total_declarado": round(total_declarado, 2) if itens else None,
        "itens_sem_valor": len(sem_valor),
        "itens_sem_codigo_catalogo": sum(1 for i in itens if not i["codigo_catalogo"]),
        "classes": sorted(por_classe.values(), key=lambda c: -c["valor_total"])[:20],
    }


def _coleta_entidade(chave: str, cnpj: str, nome: str, ano: int) -> dict:
    base = {
        "entidade": chave,
        "orgao": nome,
        "cnpj": cnpj,
        "ano": ano,
        "fonte": f"{PORTAL}/{cnpj}/{ano}",
        "consultas": [],
    }
    url_cons = f"{API}/orgaos/{cnpj}/pca/{ano}/consolidado"
    try:
        consolidado, status = _get(url_cons)
        base["consultas"].append(url_cons)
        time.sleep(REQUEST_PAUSE)
    except Exception as exc:
        base["status"] = "erro_consulta"
        base["erro"] = f"{type(exc).__name__}: {exc}"
        base["observacao"] = (
            "A consulta ao PNCP falhou. Ausência de dados aqui é falha da coleta, "
            "não declaração de que a entidade deixou de publicar o plano."
        )
        return base

    if not consolidado:
        base["status"] = "nao_publicado"
        base["observacao"] = (
            f"O PNCP não retornou plano de {ano} para esta entidade na consulta acima. "
            "Pode ser plano ainda não publicado ou publicado sob outro CNPJ."
        )
        return base

    base["publicado_em"] = consolidado.get("dataPublicacaoPncp")
    base["atualizado_em"] = consolidado.get("dataAtualizacao")
    base["razao_social_pncp"] = consolidado.get("razaoSocial")
    base["valor_total_pncp"] = _num(consolidado.get("valorTotal"))
    base["itens_qtd_pncp"] = consolidado.get("quantidade")

    try:
        itens, urls, sequenciais = _coleta_itens(cnpj, ano)
    except Exception as exc:
        base["status"] = "consolidado_sem_itens"
        base["erro"] = f"{type(exc).__name__}: {exc}"
        base["observacao"] = (
            "O total do plano foi obtido, mas a lista de itens falhou. Os números de "
            "cabeçalho valem; nenhuma estatística por item é publicada nesta coleta."
        )
        return base

    base["consultas"].extend(urls)
    base["sequenciais_com_dados"] = sequenciais
    base["itens"] = itens
    base["resumo"] = _resumo(itens)

    # O cabecalho do PNCP diz quantos itens o plano tem. Se a varredura trouxe
    # menos, a base esta incompleta e isso precisa aparecer — nao adianta somar
    # 40% do plano e chamar de "planejado para 2026".
    esperado = base["itens_qtd_pncp"]
    obtido = len(itens)
    if isinstance(esperado, (int, float)) and esperado and obtido < esperado:
        base["status"] = "parcial"
        base["cobertura_itens"] = round(obtido / float(esperado), 4)
        base["observacao"] = (
            f"O PNCP declara {int(esperado)} itens no plano e a varredura recuperou {obtido}. "
            "Os totais por classe cobrem apenas os itens recuperados."
        )
    else:
        base["status"] = "ok"
        base["cobertura_itens"] = 1.0 if obtido else 0.0
    return base


def coletar(anos: list[int] | None = None) -> dict:
    hoje = dt.date.today()
    # O plano do ano seguinte costuma sair no segundo semestre: a Camara ja
    # publicou o de 2027. Buscar os dois permite noticiar antes da compra.
    anos = anos or [hoje.year, hoje.year + 1]

    planos = []
    erros = []
    for chave, (cnpj, nome) in ENTIDADES.items():
        for ano in anos:
            try:
                planos.append(_coleta_entidade(chave, cnpj, nome, ano))
            except Exception as exc:
                erros.append({"entidade": chave, "ano": ano, "erro": f"{type(exc).__name__}: {exc}"})

    publicados = [p for p in planos if p.get("status") in ("ok", "parcial")]

    return {
        "schema_version": 1,
        "fonte": "PNCP — Plano de Contratações Anual (Lei 14.133/2021, art. 12, VII)",
        "portal": PORTAL,
        "gerado_em": dt.datetime.now(dt.timezone.utc).isoformat(),
        "anos_consultados": anos,
        "planos": planos,
        "resumo": {
            "entidades_consultadas": len(ENTIDADES),
            "planos_publicados": len(publicados),
            "planos_nao_publicados": sum(1 for p in planos if p.get("status") == "nao_publicado"),
            "planos_com_erro": sum(1 for p in planos if p.get("status") == "erro_consulta"),
        },
        "erros": erros,
        "limitacoes": [
            "O PCA é declaração de intenção de compra, não compromisso de gasto: item "
            "planejado pode não ser comprado, e isso por si só não é irregularidade.",
            "O PNCP devolve código de catálogo (CATMAT/CATSER) nulo para os itens de "
            "Varginha. Sem ele, comparar preço item a item com outros municípios exigiria "
            "casar texto livre, o que produziria falsos pares — por isso não é feito aqui.",
            "Preço unitário só é comparável quando a unidade de fornecimento vem "
            "preenchida. Itens sem unidade ficam no plano, marcados, e fora das médias.",
        ],
    }


if __name__ == "__main__":
    print(json.dumps(coletar(), ensure_ascii=False, indent=2))
