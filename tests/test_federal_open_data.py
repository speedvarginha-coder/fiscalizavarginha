# -*- coding: utf-8 -*-
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = pathlib.Path(__file__).resolve().parents[1]
PAINEL = ROOT / "painel-cidadao"
if str(PAINEL) not in sys.path:
    sys.path.insert(0, str(PAINEL))
MODULE_PATH = PAINEL / "coletor_federal.py"
SPEC = importlib.util.spec_from_file_location("coletor_federal_open_data", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class FederalOpenDataTests(unittest.TestCase):
    def test_reads_confirmed_varginha_records_without_unsupported_api_filter(self):
        payload = {
            "metadata": {"codigoIbge": "3170701"},
            "emendas": [{
                "emenda": "202650410001",
                "ano": "2026",
                "categoria": "Comissão",
                "autor": "COM. DA SAUDE",
                "beneficiario": "FUNDAÇÃO LOCAL",
                "valor": 500000,
                "destino_confirmado": True,
                "granularidade": "emenda_favorecido_agregado",
            }],
        }
        with tempfile.TemporaryDirectory() as temp:
            fake_root = pathlib.Path(temp)
            data_dir = fake_root / "emendas" / "data"
            data_dir.mkdir(parents=True)
            (data_dir / "emendas_federais.js").write_text(
                "window.EMENDAS_FEDERAIS = " + json.dumps(payload) + ";\n",
                encoding="utf-8",
            )
            with patch.object(MODULE, "ROOT", fake_root):
                rows, ok, error = MODULE._coletar_emendas_api("unused")

        self.assertTrue(ok, error)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["valorAgregado"], 500000)
        self.assertIsNone(rows[0]["valorPago"])

        summary = MODULE._resumo(rows, [], [], [])
        self.assertEqual(summary["emendas"]["qtd"], 1)
        self.assertEqual(summary["emendas"]["totalAgregadoFavorecidos"], 500000)
        self.assertIsNone(summary["emendas"]["totalPago"])


if __name__ == "__main__":
    unittest.main()
