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

    def test_documento_pessoal_do_vencedor_e_mascarado(self):
        r = self._coleta(resultado={"niFornecedor": "12345678901"})
        self.assertEqual(r["cnpj_vencedor"], "***.456.789-**")
        self.assertEqual(r["valor_homologado"], 62970.0)

    def test_documento_formatado_e_mascara_existente(self):
        self.assertEqual(col._documento_publico("123.456.789-01"), "***.456.789-**")
        self.assertEqual(col._documento_publico("***.456.789-**"), "***.456.789-**")
        self.assertEqual(col._documento_publico("60.239.413/0001-55"), "60.239.413/0001-55")

    def test_base_preservada_e_alertas_tambem_protegem_documento(self):
        payload = {"registros": [{"resultados": [{"cnpj_vencedor": "12345678901", "valor": 10}]}],
                   "homologacoes_simbolicas": [{"cnpj_vencedor": "12345678901"}]}
        self.assertEqual(col._proteger_documentos(payload), 2)
        self.assertEqual(payload["registros"][0]["resultados"][0]["valor"], 10)
        self.assertEqual(col._proteger_documentos(payload), 0)


class NumTests(unittest.TestCase):
    def test_none_e_vazio_nao_viram_zero(self):
        self.assertIsNone(col._num(None))
        self.assertIsNone(col._num(""))
        self.assertIsNone(col._num("abc"))

    def test_zero_legitimo_continua_zero(self):
        self.assertEqual(col._num(0), 0.0)
        self.assertEqual(col._num("0,00".replace(",", ".")), 0.0)


class ComparacaoHomologacaoTests(unittest.TestCase):
    def test_coleta_com_sinal_unitario_conclui_e_publica_metodo_correto(self):
        import contextlib, io, json, tempfile
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'licitacoes.json'
            compra={'numeroControlePNCP':'18240119000105-1-000001/2026','anoCompra':2026,'sequencialCompra':1,'objetoCompra':'Objeto de teste'}
            resultado={'item':1,'vencedor':'Fornecedor teste','valor_unitario_homologado':5,'valor_unitario_estimado':5000,'unidade_medida':'unidade'}
            with patch.object(col,'OUT_PATH',path), patch.object(col,'CACHE_PATH',Path(temp)/'cache.json'), \
                 patch.object(col,'ORGAOS',{'18240119000105':'Prefeitura'}), \
                 patch.object(col,'_listar_contratacoes',return_value=[compra]), \
                 patch.object(col,'_compra_com_retomada',return_value=([resultado],'2026-10-30')), \
                 contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(col.main(),0)
            base=json.loads(path.read_text(encoding='utf8'))
            self.assertEqual(len(base['homologacoes_simbolicas']),1)
            self.assertIn('preco unitario',base['metodo'])
            self.assertIn('estimativa unitária',output.getvalue())

    def test_compara_mesmo_item_e_unidade_sem_usar_estimativa_global(self):
        compra = {'controle_pncp':'compra-1','valor_estimado':7000000,'resultados':[
          {'item':1,'valor_homologado':5,'valor_unitario_homologado':5,'valor_unitario_estimado':5000,'unidade_medida':'unidade'},
          {'item':2,'valor_homologado':5,'valor_unitario_homologado':5,'valor_unitario_estimado':None,'unidade_medida':'unidade'},
          {'item':3,'valor_homologado':5,'valor_unitario_homologado':5,'valor_unitario_estimado':5000,'unidade_medida':None},
          {'item':4,'valor_homologado':5,'valor_unitario_homologado':5,'valor_unitario_estimado':10,'unidade_medida':'unidade'}]}
        sinais=col._sinais_comparaveis([compra])
        self.assertEqual([s['item'] for s in sinais],[1])
        self.assertEqual(sinais[0]['metodo'],'preco_unitario_mesmo_item')
        self.assertEqual(sinais[0]['valor_unitario_estimado'],5000)

    def test_recalcula_alerta_legado_sem_reduzir_registros(self):
        import tempfile, json
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'licitacoes.json'
            base={'registros':[{'controle_pncp':'x','valor_estimado':7000000,'resultados':[{'valor_homologado':5}]}], 'homologacoes_simbolicas':[{'valor_homologado':5,'valor_estimado':7000000}]}
            path.write_text(json.dumps(base),encoding='utf-8')
            with patch.object(col,'OUT_PATH',path):col.sanitizar_local()
            result=json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(result['homologacoes_simbolicas'],[])
            self.assertEqual(result['registros'],base['registros'])


if __name__ == "__main__":
    unittest.main()
