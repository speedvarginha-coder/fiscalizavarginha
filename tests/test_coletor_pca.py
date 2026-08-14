# -*- coding: utf-8 -*-
"""PCA: ausencia nao pode virar zero, e preco sem unidade nao e comparavel.

O plano anual e a declaracao oficial de quanto o orgao pretende gastar. Publicar
um numero parcial como se fosse o plano inteiro repetiria o erro da folha de
pessoal de 14/08/2026, so que com R$ 270 milhoes.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "painel-cidadao"))

from coletor_pca import _normaliza_item, _resumo  # noqa: E402


def item(**kw):
    base = {
        "numeroItem": 1,
        "descricao": "CONCRETO BETUMINOSO USINADO A QUENTE - CBUQ",
        "classificacaoSuperiorCodigo": "5610",
        "classificacaoSuperiorNome": "MATERIAIS DE ORIGEM MINERAL",
        "codigoItem": None,
        "unidadeFornecimento": "Tonelada",
        "quantidade": 15000.0,
        "valorUnitario": 658.85,
        "valorTotal": 9882750.0,
    }
    base.update(kw)
    return base


class TestComparabilidadeDePreco(unittest.TestCase):
    def test_preco_com_unidade_e_comparavel(self):
        r = _normaliza_item(item())
        self.assertTrue(r["preco_comparavel"])
        self.assertEqual(r["unidade_fornecimento"], "Tonelada")
        self.assertEqual(r["valor_unitario"], 658.85)

    def test_sem_unidade_de_fornecimento_nao_e_comparavel(self):
        """R$ 658,85 e barato por tonelada e caro por quilo."""
        r = _normaliza_item(item(unidadeFornecimento=""))
        self.assertFalse(r["preco_comparavel"])
        self.assertIsNone(r["unidade_fornecimento"])
        # o item continua no plano: some-lo seria esconder gasto declarado
        self.assertEqual(r["valor_total"], 9882750.0)

    def test_quantidade_zero_nao_produz_preco_comparavel(self):
        r = _normaliza_item(item(quantidade=0))
        self.assertFalse(r["preco_comparavel"])

    def test_valor_ausente_nao_vira_zero(self):
        r = _normaliza_item(item(valorTotal=None, valorUnitario=None))
        self.assertIsNone(r["valor_total"])
        self.assertIsNone(r["valor_unitario"])
        self.assertFalse(r["preco_comparavel"])

    def test_codigo_de_catalogo_ausente_fica_nulo_e_nao_inventado(self):
        r = _normaliza_item(item(codigoItem=None))
        self.assertIsNone(r["codigo_catalogo"])


class TestResumo(unittest.TestCase):
    def test_total_declara_quantos_itens_ficaram_de_fora(self):
        itens = [_normaliza_item(item(numeroItem=1))]
        itens.append(_normaliza_item(item(numeroItem=2, valorTotal=None, valorUnitario=None)))
        r = _resumo(itens)
        self.assertEqual(r["itens_qtd"], 2)
        self.assertEqual(r["itens_sem_valor"], 1)
        # a soma cobre so o item com valor, e o resumo diz isso ao lado
        self.assertEqual(r["valor_total_declarado"], 9882750.0)

    def test_conta_itens_comparaveis_separado_do_total(self):
        itens = [
            _normaliza_item(item(numeroItem=1)),
            _normaliza_item(item(numeroItem=2, unidadeFornecimento="")),
        ]
        r = _resumo(itens)
        self.assertEqual(r["itens_qtd"], 2)
        self.assertEqual(r["itens_com_preco_comparavel"], 1)

    def test_plano_vazio_nao_publica_total_zero(self):
        """Coleta vazia e ausencia de dado, nao plano de R$ 0,00."""
        r = _resumo([])
        self.assertEqual(r["itens_qtd"], 0)
        self.assertIsNone(r["valor_total_declarado"])

    def test_agrupa_por_classificacao_sem_perder_item_sem_classe(self):
        itens = [
            _normaliza_item(item(numeroItem=1)),
            _normaliza_item(item(numeroItem=2, classificacaoSuperiorNome="")),
        ]
        r = _resumo(itens)
        nomes = {c["classificacao"] for c in r["classes"]}
        self.assertIn("Sem classificação informada", nomes)
        self.assertEqual(sum(c["itens"] for c in r["classes"]), 2)


if __name__ == "__main__":
    unittest.main()
