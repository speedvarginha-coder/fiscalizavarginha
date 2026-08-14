# -*- coding: utf-8 -*-
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAINEL = ROOT / "painel-cidadao"
if str(PAINEL) not in sys.path:
    sys.path.insert(0, str(PAINEL))

from transferegov_especiais import (  # noqa: E402
    CNPJ_VARGINHA,
    FonteInconsistenteError,
    TransferegovClient,
    coletar_transferencias_especiais,
    selecionar_plano_canonico,
)
from coletor_federal import _resumo  # noqa: E402


class ClienteEstritoTests(unittest.TestCase):
    def test_rejeita_filtro_desconhecido_antes_de_consultar(self):
        client = TransferegovClient(fetch_json=lambda _url: self.fail("não deveria consultar"))
        with self.assertRaisesRegex(FonteInconsistenteError, "filtro.*desconhecido"):
            client.get("planos_acao_especiais", {"id_plano": 92535})

    def test_rejeita_registro_de_outro_relacionamento(self):
        def fetch(_url):
            return {
                "data": [{"id_plano_acao": 999}],
                "total_pages": 1,
                "total_items": 1,
            }

        client = TransferegovClient(fetch_json=fetch)
        with self.assertRaisesRegex(FonteInconsistenteError, "ignorou o filtro"):
            client.get(
                "empenhos_especiais",
                {"id_plano_acao": 92535},
                esperado={"id_plano_acao": 92535},
            )

    def test_rejeita_consulta_nacional_disfarçada_por_paginacao(self):
        def fetch(_url):
            return {"data": [], "total_pages": 36054, "total_items": 721080}

        client = TransferegovClient(fetch_json=fetch)
        with self.assertRaisesRegex(FonteInconsistenteError, "filtro possivelmente ignorado"):
            client.get(
                "gestao_financeira_lancamentos_especiais",
                {"id_agencia_conta": "32-106785"},
            )


class PlanoCanonicoTests(unittest.TestCase):
    def test_plano_ativo_reprocessado_vence_plano_impedido_sem_duplicar_valor(self):
        impedido = {
            "id_plano_acao": 77116,
            "situacao_plano_acao": "IMPEDIDO",
            "data_aceite_plano_acao": None,
        }
        ciente = {
            "id_plano_acao": 86374,
            "situacao_plano_acao": "CIENTE",
            "data_aceite_plano_acao": "2025-12-04",
        }
        self.assertEqual(selecionar_plano_canonico([impedido, ciente]), ciente)


class FakeClient:
    def __init__(self):
        self.calls = []

    def get(self, endpoint, filtros, **_kwargs):
        self.calls.append((endpoint, dict(filtros)))
        if endpoint == "beneficiarios_especiais":
            return [{
                "id_beneficiario": 3277,
                "cnpj_beneficiario": CNPJ_VARGINHA,
                "nome_beneficiario": "MUNICIPIO DE VARGINHA",
            }]
        if endpoint == "planos_acao_especiais":
            base = {
                "id_beneficiario": 3277,
                "numero_emenda_parlamentar_plano_acao": 202527540001,
                "valor_custeio_plano_acao": 247500.0,
                "valor_investimento_plano_acao": 0.0,
                "nome_objeto": "Custeio MAC",
                "nome_banco_plano_acao": "Caixa",
                "id_agencia_conta": "163-123",
            }
            return [
                {**base, "id_plano_acao": 77116, "codigo_plano_acao": "antigo", "situacao_plano_acao": "IMPEDIDO", "motivo_impedimento_plano_acao": "prazo"},
                {**base, "id_plano_acao": 86374, "codigo_plano_acao": "novo", "situacao_plano_acao": "CIENTE", "data_aceite_plano_acao": "2025-12-04"},
            ]
        plano = filtros.get("id_plano_acao")
        if plano is not None:
            self._assert_canonical(plano)
        if endpoint == "planos_trabalho_especiais":
            return [{
                "id_plano_trabalho": 1,
                "id_plano_acao": 86374,
                "situacao_plano_trabalho": "Aprovado",
                "dt_hora_situacao_plano_trabalho": "2025-12-04T10:00:00",
            }]
        if endpoint == "empenhos_especiais":
            return [{
                "id_empenho": 10,
                "id_plano_acao": 86374,
                "numero_empenho": "2025NE1",
                "descricao_tipo_documento_empenho": "Empenho Original",
                "valor_empenho": 247500.0,
                "data_emissao_empenho": "2025-12-05",
            }]
        if endpoint == "documentos_habeis_especiais":
            return [{"id_dh": 20, "id_empenho": 10, "valor_dh": 247500.0}]
        if endpoint == "ordens_pagamentos_ordens_bancarias_especiais":
            return [{
                "id_op_ob": 30,
                "id_dh": 20,
                "situacao_op": 5,
                "numero_ordem_bancaria": "2025OB1",
                "data_emissao_ob": "2025-12-06",
            }]
        if endpoint == "executores_especiais":
            return [{
                "id_executor": 40,
                "id_plano_acao": 86374,
                "cnpj_executor": "11234223000130",
                "nome_executor": "FUNDO MUNICIPAL DE SAUDE",
                "objeto_executor": "Custeio da saúde",
                "id_agencia_conta": "163-123",
            }]
        if endpoint == "meta_especiais":
            return [{"id_executor": 40, "desc_meta": "Manter atendimentos MAC"}]
        if endpoint == "finalidade_especiais":
            return [{
                "id_executor": 40,
                "area_politica_publica_tipo_pt": "Saúde",
                "area_politica_publica_pt": "Assistência Hospitalar",
            }]
        if endpoint == "gestao_financeira_lancamentos_especiais":
            return [{
                "id_agencia_conta": "163-123",
                "cnpj_ente_solicitante_gestao_financeira": "11234223000130",
                "tipo_operacao_gestao_financeira": "C",
                "descricao_gestao_financeira": "Ordem Bancária",
                "valor_gestao_financeira": 247500.0,
                "data_lancamento_gestao_financeira": "2025-12-07",
            }]
        if endpoint == "saldo_conta_gestao_financeira_especiais":
            return [{
                "id_agencia_conta": "163-123",
                "saldo_final_gestao_financeira": 247500.0,
                "data_saldo_conta": "2025-12-07",
            }]
        if endpoint in ("relatorios_gestao_especiais", "relatorios_gestao_novos_especiais"):
            return []
        raise AssertionError(f"endpoint sem fixture: {endpoint}")

    def _assert_canonical(self, plano):
        if int(plano) != 86374:
            raise AssertionError("o plano impedido não deve alimentar os estágios financeiros")


class ColetaSemanticaTests(unittest.TestCase):
    def test_separa_recebimento_de_execucao_e_preserva_impedimento_no_historico(self):
        payload = coletar_transferencias_especiais(FakeClient())
        self.assertEqual(payload["metadata"]["planosAcao"], 2)
        self.assertEqual(payload["metadata"]["emendasUnicas"], 1)
        self.assertEqual(payload["metadata"]["totalIndicadoSemDuplicidade"], 247500.0)

        item = payload["por_emenda"]["202527540001"]
        self.assertEqual(item["planoAcaoId"], 86374)
        self.assertEqual(item["valorEmpenhado"], 247500.0)
        self.assertEqual(item["valorPago"], 247500.0)
        self.assertEqual(item["valorRecebido"], 247500.0)
        self.assertIsNone(item["valorExecutado"])
        self.assertTrue(item["identificador_repasse_confirmado"])
        self.assertEqual(item["executorTransferegov"], "FUNDO MUNICIPAL DE SAUDE")
        self.assertEqual(len(item["planosRelacionados"]), 2)
        self.assertEqual(item["impedimentosHistoricos"][0]["planoAcaoId"], 77116)
        self.assertIn("execução/prestação de contas ainda não localizada", item["execucao"])

    def test_total_desconhecido_nao_vira_zero(self):
        resumo = _resumo([], [], [], [{
            "valorIndicado": 100.0,
            "valorEmpenhado": 100.0,
            "valorPago": 100.0,
            "valorRecebido": 100.0,
            "valorExecutado": None,
        }])
        especiais = resumo["transferenciasEspeciais"]
        self.assertEqual(especiais["totalRecebidoConfirmado"], 100.0)
        self.assertIsNone(especiais["totalExecutadoComRelatorio"])


if __name__ == "__main__":
    unittest.main()
