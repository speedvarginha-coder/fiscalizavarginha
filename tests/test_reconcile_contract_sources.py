import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("reconcile", Path(__file__).resolve().parents[1] / "scripts/reconcile-contract-sources.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ContractIdentityTests(unittest.TestCase):
    def test_discrepancia_na_mesma_ficha_e_sinalizada_sem_alterar_valores(self):
        base={'numero':'166','ano':'2023','data_assinatura':'2023-11-30','valor':100,'fonte_url':'https://example.com/ficha'}
        oficial={**base,'valor':120}
        catalog={}
        self.assertEqual(module.reconcile_values([base],[oficial],catalog,'2026-10-28T01:00:00'),1)
        self.assertEqual(base['valor'],100)
        self.assertEqual(catalog[base['fonte_url']]['divergencia']['valor_fonte'],120)
        self.assertEqual(module.reconcile_values([base],[oficial,oficial],{},'2026-10-28'),0)
        self.assertEqual(module.reconcile_values([base],[{**oficial,'numero':'999'}],{},'2026-10-28'),0)
        self.assertEqual(module.reconcile_values([base],[oficial],{},None),0)
        self.assertEqual(module.reconcile_values([base],[{**base}],catalog,'2026-10-28'),1)
        self.assertNotIn('divergencia',catalog[base['fonte_url']])

    def test_only_unique_official_identity_is_recovered(self):
        contract = {"numero": "01", "ano": 2026, "cnpj": "12.345.678/****-**", "valor": 100}
        url = "https://transparencia.betha.cloud/#/portal/consulta/123/detalhe/1:2_3"
        history = [{**contract, "fonte_url": url}]
        self.assertEqual(module.reconcile([contract], history, "portal", "123"), 1)
        self.assertEqual(contract["valor"], 100)
        self.assertEqual(contract["fonte_url"], url)
        ambiguous = {k: v for k, v in contract.items() if k != "fonte_url"}
        self.assertEqual(module.reconcile([ambiguous], history + [{**history[0], "fonte_url": url + "4"}], "portal", "123"), 0)
        self.assertNotIn("fonte_url", ambiguous)
        self.assertEqual(module.reconcile([ambiguous], [{**history[0], "cnpj": "98.765.432/****-**"}], "portal", "123"), 0)

    def test_documented_identity_resolves_masked_cpf_and_different_year_without_guessing(self):
        url = 'https://transparencia.betha.cloud/#/portal/consulta/123/detalhe/9:2_3'
        base = {'numero':'7','ano':2024,'cnpj':'123.456.***-**','contratado':'Pessoa Teste','data_assinatura':'2025-01-07','valor':100}
        history = [{**base,'ano':2025,'fonte_url':url}]
        contract = dict(base)
        self.assertEqual(module.reconcile([contract],history,'portal','123'),1)
        self.assertEqual(contract['ano'],2024)
        for change in [{'valor':101},{'contratado':'Outra Pessoa'},{'data_assinatura':'2025-01-08'},{'numero':'0'}]:
            self.assertEqual(module.reconcile([{**base,**change}],history,'portal','123'),0)
        self.assertEqual(module.reconcile([dict(base)],history+[{**history[0],'fonte_url':url+'4'}],'portal','123'),0)
