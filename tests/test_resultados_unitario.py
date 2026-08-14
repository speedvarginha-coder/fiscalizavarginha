# -*- coding: utf-8 -*-
"""Preco unitario dos itens de licitacao: ausencia nao vira zero, e unidade manda.

Ate 14/08/2026 o coletor buscava o item e o resultado no PNCP — que trazem
quantidade, unidade de medida e valor unitario homologado — e guardava so o
valor TOTAL do item. Sem preco unitario, "R$ 62.970,00" nao diz se o ventilador
saiu caro; "R$ 1.049,50 a unidade" diz.
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "painel-cidadao"))

import coletor_resultados_licitacao as col  # noqa: E402


def fake_api(itens, resultados):
    """Simula o par de chamadas do PNCP: lista de itens e resultados do item."""
    def _get(url, timeout=30):
        if "/resultados" in url:
            return resultados
        return itens
    return _get


ITEM = {
    "numeroItem": 1,
    "descricao": "VENTILADOR DE PAREDE 60CM",
    "quantidade": 60.0,
    "unidadeMedida": "Unidade",
    "valorUnitarioEstimado": 1100.0,
}
RESULTADO = {
    "nomeRazaoSocialFornecedor": "OAS&B",
    "niFornecedor": "60239413000155",
    "valorTotalHomologado": 62970.0,
    "quantidadeHomologada": 60.0,
    "valorUnitarioHomologado": 1049.5,
    "dataResultado": "2025-12-15T00:00:00",
}


class PrecoUnitarioTests(unittest.TestCase):
    def _coleta(self, item=None, resultado=None):
        item = {**ITEM, **(item or {})}
        resultado = {**RESULTADO, **(resultado or {})}
        with patch.object(col, "_get", fake_api([item], [resultado])), \
                patch.object(col.time, "sleep"):
            return col._resultados_da_compra("18240119000105", 2025, 482)[0]

    def test_guarda_preco_unitario_quantidade_e_unidade(self):
        r = self._coleta()
        self.assertEqual(r["valor_unitario_homologado"], 1049.5)
        self.assertEqual(r["quantidade"], 60.0)
        self.assertEqual(r["unidade_medida"], "Unidade")
        self.assertEqual(r["valor_unitario_estimado"], 1100.0)
        self.assertTrue(r["preco_comparavel"])

    def test_sem_unidade_de_medida_nao_e_comparavel(self):
        """'Caixa com 100' contra 'unidade' produziria denuncia falsa."""
        r = self._coleta(item={"unidadeMedida": ""})
        self.assertFalse(r["preco_comparavel"])
        self.assertIsNone(r["unidade_medida"])
        # o preco continua guardado: o que muda e so o direito de comparar
        self.assertEqual(r["valor_unitario_homologado"], 1049.5)

    def test_preco_unitario_ausente_fica_nulo_e_nao_zero(self):
        r = self._coleta(resultado={"valorUnitarioHomologado": None})
        self.assertIsNone(r["valor_unitario_homologado"])
        self.assertFalse(r["preco_comparavel"])

    def test_quantidade_cai_para_a_do_item_quando_resultado_nao_informa(self):
        r = self._coleta(resultado={"quantidadeHomologada": None})
        self.assertEqual(r["quantidade"], 60.0)

    def test_quantidade_ausente_nos_dois_lados_fica_nula(self):
        r = self._coleta(item={"quantidade": None}, resultado={"quantidadeHomologada": None})
        self.assertIsNone(r["quantidade"])

    def test_preco_zero_nao_conta_como_comparavel(self):
        """Homologacao simbolica (R$ 0,01 e afins) tem sinal proprio; aqui ela
        nao pode entrar como preco de mercado e puxar media para baixo."""
        r = self._coleta(resultado={"valorUnitarioHomologado": 0.0})
        self.assertFalse(r["preco_comparavel"])

    def test_valor_total_do_item_continua_publicado(self):
        r = self._coleta()
        self.assertEqual(r["valor_homologado"], 62970.0)
        self.assertEqual(r["cnpj_vencedor"], "60239413000155")


class NumTests(unittest.TestCase):
    def test_none_e_vazio_nao_viram_zero(self):
        self.assertIsNone(col._num(None))
        self.assertIsNone(col._num(""))
        self.assertIsNone(col._num("abc"))

    def test_zero_legitimo_continua_zero(self):
        self.assertEqual(col._num(0), 0.0)
        self.assertEqual(col._num("0,00".replace(",", ".")), 0.0)


if __name__ == "__main__":
    unittest.main()
