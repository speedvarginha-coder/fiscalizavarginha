import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "painel-cidadao"))

import coletor_betha  # noqa: E402
import coletor_resultados_licitacao as pncp_resultados  # noqa: E402


class FakeResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps({"data": []}).encode("utf-8")


class CrossingQualityTests(unittest.TestCase):
    def test_emenda_crossing_explains_method_confidence_and_limitations(self):
        emendas = [{
            "numero": 1,
            "ano": 2025,
            "cnpj": "12.345.678/0001-90",
            "beneficiario": "Entidade Exemplo",
        }]
        credores = [{
            "ano": 2025,
            "cnpjCpf": "12.345.678/0002-00",
            "nomeEntidade": "Prefeitura",
            "nomeCredor": "Entidade Exemplo",
            "valorPagamentoAno": 1000.0,
        }]

        item = coletor_betha.cruzar_emendas(emendas, credores)[0]
        self.assertEqual(item["status"], "encontrado")
        self.assertEqual(item["cruzamento"]["metodo"], "raiz_cnpj_e_periodo")
        self.assertEqual(item["cruzamento"]["confianca"], "media")
        self.assertTrue(item["cruzamento"]["evidencias"])
        self.assertTrue(item["cruzamento"]["limitacoes"])

    def test_missing_cnpj_never_becomes_negative_conclusion(self):
        item = coletor_betha.cruzar_emendas([{
            "numero": 2,
            "ano": 2025,
            "beneficiario": "Sem identificador",
        }], [])[0]
        self.assertEqual(item["status"], "sem_cnpj")
        self.assertEqual(item["cruzamento"]["estado"], "indisponivel")
        self.assertEqual(item["cruzamento"]["confianca"], "indisponivel")

    def test_pncp_retries_transient_failure(self):
        with patch.object(pncp_resultados.time, "sleep"), patch.object(
            pncp_resultados.urllib.request,
            "urlopen",
            side_effect=[TimeoutError("temporario"), FakeResponse()],
        ) as mocked:
            payload = pncp_resultados._get("https://example.invalid")
        self.assertEqual(payload, {"data": []})
        self.assertEqual(mocked.call_count, 2)


if __name__ == "__main__":
    unittest.main()
