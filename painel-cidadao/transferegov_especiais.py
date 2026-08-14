# -*- coding: utf-8 -*-
"""Coleta estrita de transferências especiais destinadas a Varginha.

A API do Transferegov aceita alguns parâmetros desconhecidos sem devolver erro.
Por isso, este cliente valida tanto os parâmetros enviados quanto as chaves de
relacionamento recebidas. Um registro nacional nunca pode entrar no recorte local
apenas porque a API ignorou um filtro.
"""
from __future__ import annotations

import datetime as dt
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
import unicodedata
from collections import defaultdict
from numbers import Real
from typing import Callable

BASE_URL = "https://api-publica.transferegov.gestao.gov.br/especiais"
CNPJ_VARGINHA = "18240119000105"
NOME_FONTE = "Transferegov.br — API de Transferências Especiais"

RETRYABLE_HTTP = {429, 500, 502, 503, 504}

# Somente os filtros usados pelo coletor. A lista fechada evita que um erro de
# digitação transforme uma consulta local em download silencioso da base nacional.
FILTROS_PERMITIDOS = {
    "beneficiarios_especiais": {"cnpj_beneficiario"},
    "planos_acao_especiais": {"id_beneficiario"},
    "planos_acao_historico_especiais": {"id_plano_acao"},
    "planos_trabalho_especiais": {"id_plano_acao"},
    "empenhos_especiais": {"id_plano_acao"},
    "documentos_habeis_especiais": {"id_empenho"},
    "ordens_pagamentos_ordens_bancarias_especiais": {"id_dh"},
    "executores_especiais": {"id_plano_acao"},
    "meta_especiais": {"id_executor"},
    "finalidade_especiais": {"id_executor"},
    "relatorios_gestao_especiais": {"id_plano_acao"},
    "relatorios_gestao_novos_especiais": {"id_plano_acao"},
    "gestao_financeira_lancamentos_especiais": {"id_agencia_conta"},
    "saldo_conta_gestao_financeira_especiais": {"id_agencia_conta"},
}


class FonteInconsistenteError(RuntimeError):
    """A fonte respondeu, mas não comprovou o recorte solicitado."""


def _norm(value) -> str:
    return "".join(
        char
        for char in unicodedata.normalize("NFKD", str(value or "")).upper()
        if not unicodedata.combining(char)
    ).strip()


def _digits(value) -> str:
    return "".join(char for char in str(value or "") if char.isdigit())


def _money(value) -> float:
    if isinstance(value, Real) and not isinstance(value, bool):
        return float(value)
    text = str(value or "").strip().replace("R$", "").replace(" ", "")
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return 0.0


def _date_key(value) -> tuple[int, int, int, str]:
    text = str(value or "")
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.year, parsed.month, parsed.day, text
    except ValueError:
        return 0, 0, 0, text


def _date_br(value) -> str:
    text = str(value or "")
    if not text:
        return ""
    try:
        return dt.date.fromisoformat(text[:10]).strftime("%d/%m/%Y")
    except ValueError:
        return text


class TransferegovClient:
    def __init__(
        self,
        base_url: str = BASE_URL,
        timeout: int = 45,
        attempts: int = 4,
        fetch_json: Callable[[str], dict] | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.attempts = attempts
        self.fetch_json = fetch_json

    def _request(self, url: str) -> dict:
        if self.fetch_json is not None:
            return self.fetch_json(url)
        last_error: Exception | None = None
        for attempt in range(self.attempts):
            try:
                request = urllib.request.Request(
                    url,
                    headers={
                        "Accept": "application/json",
                        "User-Agent": "FiscalizaVarginha/3.0",
                    },
                )
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return json.loads(response.read())
            except urllib.error.HTTPError as exc:
                last_error = exc
                if exc.code not in RETRYABLE_HTTP or attempt == self.attempts - 1:
                    raise
            except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
                last_error = exc
                if attempt == self.attempts - 1:
                    raise
            time.sleep(min(12.0, 1.2 * (2 ** attempt)) + random.uniform(0, 0.25))
        raise last_error or RuntimeError("falha no Transferegov sem detalhe")

    def get(
        self,
        endpoint: str,
        filtros: dict,
        *,
        esperado: dict | None = None,
        page_size: int = 200,
        max_pages: int = 100,
    ) -> list[dict]:
        endpoint = endpoint.strip("/")
        if endpoint not in FILTROS_PERMITIDOS:
            raise FonteInconsistenteError(f"endpoint não autorizado: {endpoint}")
        desconhecidos = set(filtros) - FILTROS_PERMITIDOS[endpoint]
        if desconhecidos:
            raise FonteInconsistenteError(
                f"{endpoint}: filtro(s) desconhecido(s): {sorted(desconhecidos)}"
            )

        resultado: list[dict] = []
        pagina = 1
        total_pages = 1
        while pagina <= total_pages:
            if pagina > max_pages:
                raise FonteInconsistenteError(
                    f"{endpoint}: paginação excedeu o limite seguro de {max_pages}"
                )
            params = {**filtros, "pagina": pagina, "tamanho_da_pagina": page_size}
            url = f"{self.base_url}/{endpoint}?{urllib.parse.urlencode(params)}"
            payload = self._request(url)
            if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
                raise FonteInconsistenteError(f"{endpoint}: resposta fora do esquema esperado")

            rows = payload["data"]
            try:
                total_pages = max(1, int(payload.get("total_pages") or 1))
            except (TypeError, ValueError) as exc:
                raise FonteInconsistenteError(f"{endpoint}: total_pages inválido") from exc
            if total_pages > max_pages:
                raise FonteInconsistenteError(
                    f"{endpoint}: consulta retornaria {total_pages} páginas; filtro possivelmente ignorado"
                )
            if pagina < total_pages and not rows:
                raise FonteInconsistenteError(f"{endpoint}: paginação incompleta")

            for row in rows:
                if not isinstance(row, dict):
                    raise FonteInconsistenteError(f"{endpoint}: registro não é objeto")
                for campo, valor in (esperado or {}).items():
                    atual = row.get(campo)
                    if campo.startswith("cnpj_"):
                        confere = _digits(atual) == _digits(valor)
                    else:
                        confere = str(atual) == str(valor)
                    if not confere:
                        raise FonteInconsistenteError(
                            f"{endpoint}: fonte ignorou o filtro {campo}={valor}; recebeu {atual}"
                        )
                resultado.append(row)
            pagina += 1

        total_items = payload.get("total_items")
        if total_items is not None and int(total_items) != len(resultado):
            raise FonteInconsistenteError(
                f"{endpoint}: total anunciado {total_items}, coletado {len(resultado)}"
            )
        return resultado


STATUS_PRIORITY = {
    "CIENTE": 50,
    "APROVADO": 45,
    "AGUARDANDO_CONCLUSAO_PLANO_TRABALHO": 30,
    "AGUARDANDO_CIENCIA": 20,
    "IMPEDIDO": 5,
    "CANCELADO": 0,
}


def selecionar_plano_canonico(planos: list[dict]) -> dict:
    if not planos:
        raise FonteInconsistenteError("emenda especial sem plano de ação")

    def chave(plano: dict):
        status = _norm(plano.get("situacao_plano_acao"))
        return (
            STATUS_PRIORITY.get(status, 10),
            _date_key(plano.get("data_aceite_plano_acao")),
            int(plano.get("id_plano_acao") or 0),
        )

    return max(planos, key=chave)


def _valor_empenhos(empenhos: list[dict]) -> float | None:
    if not empenhos:
        return None
    total = 0.0
    for item in empenhos:
        tipo = _norm(item.get("descricao_tipo_documento_empenho"))
        valor = abs(_money(item.get("valor_empenho")))
        total += -valor if "ANUL" in tipo or "CANCEL" in tipo else valor
    return round(max(total, 0.0), 2)


def _ultimo_relatorio(relatorios: list[dict]) -> dict | None:
    if not relatorios:
        return None
    return max(
        relatorios,
        key=lambda item: _date_key(
            item.get("data_e_hora_relatorio_gestao_novo")
            or item.get("data_relatorio_gestao_novo")
            or item.get("data_relatorio_gestao")
        ),
    )


def _url(endpoint: str, **params) -> str:
    return f"{BASE_URL}/{endpoint}?{urllib.parse.urlencode(params)}"


def _coletar_plano(client: TransferegovClient, plano: dict, relacionados: list[dict]) -> dict:
    plano_id = int(plano["id_plano_acao"])
    codigo = str(plano.get("numero_emenda_parlamentar_plano_acao") or "")
    valor_plano = round(
        _money(plano.get("valor_custeio_plano_acao"))
        + _money(plano.get("valor_investimento_plano_acao")),
        2,
    )
    ano_emenda = str(plano.get("ano_emenda_parlamentar_plano_acao") or "")

    trabalhos = client.get(
        "planos_trabalho_especiais",
        {"id_plano_acao": plano_id},
        esperado={"id_plano_acao": plano_id},
    )
    empenhos = client.get(
        "empenhos_especiais",
        {"id_plano_acao": plano_id},
        esperado={"id_plano_acao": plano_id},
    )
    executores = client.get(
        "executores_especiais",
        {"id_plano_acao": plano_id},
        esperado={"id_plano_acao": plano_id},
    )
    relatorios = client.get(
        "relatorios_gestao_especiais",
        {"id_plano_acao": plano_id},
        esperado={"id_plano_acao": plano_id},
    ) + client.get(
        "relatorios_gestao_novos_especiais",
        {"id_plano_acao": plano_id},
        esperado={"id_plano_acao": plano_id},
    )

    documentos: list[dict] = []
    ordens: list[dict] = []
    documentos_com_ordem: dict[int, dict] = {}
    for empenho in empenhos:
        empenho_id = int(empenho["id_empenho"])
        docs = client.get(
            "documentos_habeis_especiais",
            {"id_empenho": empenho_id},
            esperado={"id_empenho": empenho_id},
        )
        documentos.extend(docs)
        for documento in docs:
            dh_id = int(documento["id_dh"])
            obs = client.get(
                "ordens_pagamentos_ordens_bancarias_especiais",
                {"id_dh": dh_id},
                esperado={"id_dh": dh_id},
            )
            ordens.extend(obs)
            if any(
                int(ob.get("situacao_op") or 0) == 5
                or "ENVIADA" in _norm(ob.get("descricao_situacao_op"))
                for ob in obs
            ):
                documentos_com_ordem[dh_id] = documento

    # O beneficiário do plano é o Município, mas a execução pode ser
    # delegada a um fundo municipal (ex.: Fundo Municipal de Saúde). Como os
    # executores já foram vinculados pelo id_plano_acao validado, cada conta é
    # conferida contra o CNPJ do respectivo executor, não apenas o da Prefeitura.
    exec_varginha = executores

    metas: list[dict] = []
    finalidades: list[dict] = []
    lancamentos: list[dict] = []
    saldos: list[dict] = []
    for executor in exec_varginha:
        executor_id = int(executor["id_executor"])
        cnpj_executor = _digits(executor.get("cnpj_executor"))
        if len(cnpj_executor) != 14:
            raise FonteInconsistenteError(
                f"plano {plano_id}: executor {executor_id} sem CNPJ válido"
            )
        metas.extend(client.get(
            "meta_especiais",
            {"id_executor": executor_id},
            esperado={"id_executor": executor_id},
        ))
        finalidades.extend(client.get(
            "finalidade_especiais",
            {"id_executor": executor_id},
            esperado={"id_executor": executor_id},
        ))
        agencia_executor = str(executor.get("numero_agencia_executor") or "").strip()
        conta_executor = str(executor.get("numero_conta_executor") or "").strip()
        conta = str(
            executor.get("id_agencia_conta")
            or (f"{agencia_executor}-{conta_executor}" if agencia_executor and conta_executor else "")
            or plano.get("id_agencia_conta")
            or ""
        ).strip("-")
        if not conta:
            continue
        movimentos = client.get(
            "gestao_financeira_lancamentos_especiais",
            {"id_agencia_conta": conta},
            esperado={"id_agencia_conta": conta},
        )
        for movimento in movimentos:
            if _digits(movimento.get("cnpj_ente_solicitante_gestao_financeira")) != cnpj_executor:
                raise FonteInconsistenteError(
                    f"conta {conta}: lançamento pertence a CNPJ diferente do executor {cnpj_executor}"
                )
        lancamentos.extend(movimentos)
        saldos.extend(client.get(
            "saldo_conta_gestao_financeira_especiais",
            {"id_agencia_conta": conta},
            esperado={"id_agencia_conta": conta},
        ))

    creditos_ob = [
        item for item in lancamentos
        if _norm(item.get("tipo_operacao_gestao_financeira")) == "C"
        # Parte do histórico antigo chega como "Ordem Bancria" na própria
        # API. O prefixo preserva a semântica sem aceitar outros créditos.
        and _norm(item.get("descricao_gestao_financeira")).startswith("ORDEM BANC")
    ]
    valor_recebido = (
        round(sum(_money(item.get("valor_gestao_financeira")) for item in creditos_ob), 2)
        if creditos_ob else None
    )
    valor_pago = (
        round(sum(_money(item.get("valor_dh")) for item in documentos_com_ordem.values()), 2)
        if documentos_com_ordem else None
    )
    valor_empenhado = _valor_empenhos(empenhos)

    relatorio = _ultimo_relatorio(relatorios)
    valor_executado = None
    if relatorio is not None:
        valor_executado = _money(
            relatorio.get("valor_executado_relatorio_gestao_novo")
            if "valor_executado_relatorio_gestao_novo" in relatorio
            else relatorio.get("valor_executado_relatorio_gestao")
        )

    datas_empenho = sorted(
        [item.get("data_emissao_empenho") for item in empenhos if item.get("data_emissao_empenho")],
        key=_date_key,
    )
    datas_ob = sorted(
        [item.get("data_emissao_ob") for item in ordens if item.get("data_emissao_ob")],
        key=_date_key,
    )
    datas_credito = sorted(
        [item.get("data_lancamento_gestao_financeira") for item in creditos_ob if item.get("data_lancamento_gestao_financeira")],
        key=_date_key,
    )
    trabalho = max(
        trabalhos,
        key=lambda item: _date_key(item.get("dt_hora_situacao_plano_trabalho")),
        default=None,
    )
    executor = exec_varginha[0] if exec_varginha else {}
    saldo_atual = max(
        saldos,
        key=lambda item: _date_key(item.get("data_saldo_conta")),
        default=None,
    )

    objeto_detalhado = str(executor.get("objeto_executor") or "").strip()
    objeto_plano = str(
        plano.get("detalhamento_objeto") or plano.get("nome_objeto") or ""
    ).strip()
    meta_texto = "; ".join(
        str(item.get("desc_meta") or "").strip() for item in metas if item.get("desc_meta")
    )
    finalidade = "; ".join(
        " / ".join(filter(None, [
            str(item.get("area_politica_publica_tipo_pt") or "").strip(),
            str(item.get("area_politica_publica_pt") or "").strip(),
        ]))
        for item in finalidades
    )

    trilha = [f"plano de ação {_norm(plano.get('situacao_plano_acao')) or 'sem situação'}"]
    if trabalho:
        trilha.append(f"plano de trabalho {trabalho.get('situacao_plano_trabalho') or 'registrado'}")
    if datas_empenho:
        trilha.append(f"empenho federal {_date_br(datas_empenho[0])}")
    if datas_ob:
        trilha.append(f"ordem bancária {_date_br(datas_ob[0])}")
    if datas_credito:
        trilha.append(f"crédito na conta vinculada {_date_br(datas_credito[0])}")
    if relatorio is None:
        trilha.append("execução/prestação de contas ainda não localizada na API")

    impedimentos = [
        {
            "planoAcaoId": item.get("id_plano_acao"),
            "situacao": item.get("situacao_plano_acao"),
            "motivo": item.get("motivo_impedimento_plano_acao"),
        }
        for item in relacionados
        if "IMPED" in _norm(item.get("situacao_plano_acao"))
    ]

    return {
        "valorIndicado": valor_plano,
        "valorEmpenhado": valor_empenhado,
        "valorLiquidado": None,
        "valorPago": valor_pago,
        "valorRecebido": valor_recebido,
        "valorExecutado": valor_executado,
        "dataEmpenho": datas_empenho[0] if datas_empenho else "",
        "dataPagamento": datas_ob[0] if datas_ob else "",
        "dataRecurso": datas_credito[0] if datas_credito else "",
        "execucao": " · ".join(trilha),
        "statusFinanceiro": "Transferência federal confirmada na conta vinculada" if creditos_ob else "Transferência ainda não confirmada na conta vinculada",
        "planoAcaoId": plano_id,
        "codigoPlanoAcao": plano.get("codigo_plano_acao"),
        "situacaoPlanoAcao": plano.get("situacao_plano_acao"),
        "planoTrabalhoId": trabalho.get("id_plano_trabalho") if trabalho else None,
        "situacaoPlanoTrabalho": trabalho.get("situacao_plano_trabalho") if trabalho else "",
        "inicioExecucaoPlano": trabalho.get("data_inicio_execucao_plano_trabalho") if trabalho else "",
        "fimExecucaoPlano": trabalho.get("data_fim_execucao_plano_trabalho") if trabalho else "",
        "objetoTransferegov": objeto_detalhado or objeto_plano,
        "metaTransferegov": meta_texto,
        "finalidadeTransferegov": finalidade,
        "banco": executor.get("nome_banco_executor") or plano.get("nome_banco_plano_acao") or "",
        "conta": executor.get("id_agencia_conta") or plano.get("id_agencia_conta") or "",
        "executorTransferegov": executor.get("nome_executor") or "",
        "cnpjExecutorTransferegov": _digits(executor.get("cnpj_executor")),
        "saldoContaInformativo": _money(saldo_atual.get("saldo_final_gestao_financeira")) if saldo_atual else None,
        "dataSaldoConta": saldo_atual.get("data_saldo_conta") if saldo_atual else "",
        "numeroEmpenhos": [item.get("numero_empenho") for item in empenhos if item.get("numero_empenho")],
        "numeroOrdensBancarias": [item.get("numero_ordem_bancaria") for item in ordens if item.get("numero_ordem_bancaria")],
        "qtdDocumentos": len(documentos),
        "qtdOrdensBancarias": len(ordens),
        "relatorioGestaoLocalizado": relatorio is not None,
        "situacaoRelatorioGestao": (
            relatorio.get("situacao_relatorio_gestao_novo")
            or relatorio.get("situacao_relatorio_gestao")
        ) if relatorio else "Não localizado na API",
        "planosRelacionados": [
            {
                "planoAcaoId": item.get("id_plano_acao"),
                "codigoPlanoAcao": item.get("codigo_plano_acao"),
                "situacao": item.get("situacao_plano_acao"),
                "valor": round(
                    _money(item.get("valor_custeio_plano_acao"))
                    + _money(item.get("valor_investimento_plano_acao")), 2
                ),
                "motivoImpedimento": item.get("motivo_impedimento_plano_acao"),
            }
            for item in sorted(relacionados, key=lambda value: int(value.get("id_plano_acao") or 0))
        ],
        "impedimentosHistoricos": impedimentos,
        "fonteExecucao": NOME_FONTE,
        "fonteUrl": _url("planos_acao_especiais", id_plano_acao=plano_id),
        "fonteEmpenhosUrl": _url("empenhos_especiais", id_plano_acao=plano_id),
        "granularidade": "emenda_plano_acao_transferegov",
        "identificador_repasse_confirmado": bool(creditos_ob),
        "contabilizado_como_repasse_individual": bool(creditos_ob),
        "classificacaoComprovacao": "Confirmado" if creditos_ob else "Parcial",
        "observacaoEvidencia": (
            "Crédito confirmado por plano de ação, conta vinculada e lançamento bancário do Transferegov. "
            "Isso comprova o recebimento federal, não a execução final do objeto."
            if creditos_ob else
            "Plano localizado, mas sem crédito bancário confirmado na conta vinculada."
        ),
        "codigoEmendaTransferegov": codigo,
        "anoEmendaTransferegov": ano_emenda,
    }


def coletar_transferencias_especiais(
    client: TransferegovClient | None = None,
) -> dict:
    client = client or TransferegovClient()
    beneficiarios = client.get(
        "beneficiarios_especiais",
        {"cnpj_beneficiario": CNPJ_VARGINHA},
        esperado={"cnpj_beneficiario": CNPJ_VARGINHA},
    )
    if len(beneficiarios) != 1:
        raise FonteInconsistenteError(
            f"CNPJ de Varginha deveria identificar 1 beneficiário; retornou {len(beneficiarios)}"
        )
    beneficiario = beneficiarios[0]
    beneficiario_id = int(beneficiario["id_beneficiario"])
    planos = client.get(
        "planos_acao_especiais",
        {"id_beneficiario": beneficiario_id},
        esperado={"id_beneficiario": beneficiario_id},
    )
    if not planos:
        raise FonteInconsistenteError("nenhum plano especial localizado para Varginha")

    grupos: dict[str, list[dict]] = defaultdict(list)
    for plano in planos:
        codigo = str(plano.get("numero_emenda_parlamentar_plano_acao") or "").strip()
        if not codigo:
            raise FonteInconsistenteError("plano de ação sem código de emenda")
        grupos[codigo].append(plano)

    por_emenda = {}
    for codigo, relacionados in sorted(grupos.items()):
        canonico = selecionar_plano_canonico(relacionados)
        por_emenda[codigo] = _coletar_plano(client, canonico, relacionados)

    total_unico = round(sum(item["valorIndicado"] for item in por_emenda.values()), 2)
    total_recebido = round(sum(item.get("valorRecebido") or 0 for item in por_emenda.values()), 2)
    return {
        "metadata": {
            "fonte": NOME_FONTE,
            "url": BASE_URL,
            "coletadoEm": dt.datetime.now(dt.timezone.utc).isoformat(),
            "cnpjBeneficiario": CNPJ_VARGINHA,
            "idBeneficiario": beneficiario_id,
            "planosAcao": len(planos),
            "emendasUnicas": len(por_emenda),
            "totalIndicadoSemDuplicidade": total_unico,
            "totalRecebidoConfirmado": total_recebido,
            "criterioDeduplicacao": "código da emenda + beneficiário; plano ativo/mais recente é canônico e os demais ficam no histórico",
        },
        "por_emenda": por_emenda,
        "emendas": [
            {"emenda": codigo, **dados} for codigo, dados in por_emenda.items()
        ],
    }


__all__ = [
    "BASE_URL",
    "CNPJ_VARGINHA",
    "FonteInconsistenteError",
    "TransferegovClient",
    "coletar_transferencias_especiais",
    "selecionar_plano_canonico",
]
