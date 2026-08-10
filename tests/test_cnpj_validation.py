import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "painel-cidadao"))

import coletor_cnpj  # noqa: E402


class CnpjValidationTests(unittest.TestCase):
    def test_accepts_valid_check_digits(self):
        self.assertTrue(coletor_cnpj._cnpj_valido("18.240.119/0001-05"))

    def test_rejects_invalid_check_digits_from_source(self):
        self.assertFalse(coletor_cnpj._cnpj_valido("17.220.303/0001-96"))

    def test_collector_does_not_query_invalid_cnpj(self):
        payload = coletor_cnpj.coletar([{
            "cnpj": "17.220.303/0001-96",
            "beneficiario": "Entidade com cadastro a conferir",
            "valor_brl": 50000,
        }])
        self.assertEqual(payload["resumo"]["falhas"], 0)
        self.assertEqual(payload["resumo"]["invalidos_na_fonte"], 1)
        self.assertEqual(payload["empresas"], [])
        self.assertEqual(payload["invalidos"][0]["cnpj"], "17220303000196")


if __name__ == "__main__":
    unittest.main()
