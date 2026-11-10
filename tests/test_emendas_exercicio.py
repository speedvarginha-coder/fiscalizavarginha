import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'painel-cidadao'))
import coletor_betha as betha


class ExercicioTests(unittest.TestCase):
    def setUp(self):
        self.emenda = {'numero':'5','ano':'2025','exercicioOrcamentario':'2026','cnpj':'25.863.390/0001-54','beneficiario':'Entidade','valor_brl':160000}
        self.credores = [{'ano':a,'cnpjCpf':'25.863.390/****-**','nomeCredor':'Entidade','valorPagamentoAno':v} for a,v in [(2025,780),(2026,680),(2027,900)]]

    def test_exclui_ano_da_proposicao_e_anos_posteriores(self):
        row = betha.cruzar_emendas([self.emenda],self.credores)[0]
        self.assertEqual(row['valor_pago_total'],680)
        self.assertEqual([p['ano'] for p in row['pagamentos']],[2026])
        self.assertFalse(row['cruzamento']['vinculo_emenda_confirmado'])

    def test_sem_exercicio_nao_usa_ano_da_emenda_e_nao_vira_zero(self):
        for ano in [None,'','2026/2027','não confirmado']:
            row = betha.cruzar_emendas([{**self.emenda,'exercicioOrcamentario':ano}],self.credores)[0]
            self.assertEqual(row['status'],'sem_periodo');self.assertIsNone(row['valor_pago_total'])

    def test_orcamento_nao_coberto_nao_e_ausencia_de_pagamento(self):
        row = betha.cruzar_emendas([{**self.emenda,'exercicioOrcamentario':'2028'}],self.credores)[0]
        self.assertEqual(row['status'],'sem_periodo')

    def test_sem_match_no_exercicio_coberto_e_apenas_nao_localizado(self):
        row = betha.cruzar_emendas([{**self.emenda,'cnpj':'11.111.111/0001-11'}],self.credores)[0]
        self.assertEqual(row['status'],'sem_pagamento')

    def test_reconciliacao_nao_altera_contratos_e_totalizadores(self):
        spec = importlib.util.spec_from_file_location('repair',ROOT/'scripts/reconcile-emenda-payments.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        base={'contratos':[{'valor':100}],'total_externo_atual':500}
        result=module.reconcile(base,[self.emenda,{**self.emenda,'numero':'6','exercicioOrcamentario':None}],self.credores)
        self.assertEqual(result['contratos'],base['contratos']);self.assertEqual(result['total_externo_atual'],500)
        self.assertEqual(result['stats_cruzamento']['sem_periodo'],1)

    def test_consulta_indisponivel_retira_legado_incorreto_sem_zerar(self):
        spec=importlib.util.spec_from_file_location('repair',ROOT/'scripts/reconcile-emenda-payments.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        row={**self.emenda,'status':'encontrado','valor_pago_total':1460,'pagamentos':[{'ano':2025,'valor':780},{'ano':2026,'valor':680}], 'cruzamento':{'metodo':'raiz_cnpj_e_periodo'}}
        result=module.mark_unverified({'emendas_cruzadas':[row],'contratos':[{'valor':100}]})
        self.assertIsNone(result['emendas_cruzadas'][0]['valor_pago_total'])
        self.assertEqual(result['stats_cruzamento']['sem_periodo'],1)
        self.assertEqual(result['contratos'],[{'valor':100}])

    def test_falha_preserva_correspondencia_documental_anterior_sem_rejuvenescer(self):
        spec=importlib.util.spec_from_file_location('repair',ROOT/'scripts/reconcile-emenda-payments.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        row=betha.cruzar_emendas([self.emenda],self.credores)[0]
        result=module.mark_unverified({'emendas_cruzadas':[row],'emendas_cruzamento_meta':{'consultado_em':'2026-10-01T12:00:00Z'}})
        self.assertEqual(result['emendas_cruzadas'][0]['valor_pago_total'],680)
        self.assertEqual(result['emendas_cruzamento_meta']['consultado_em'],'2026-10-01T12:00:00Z')


if __name__=='__main__': unittest.main()
