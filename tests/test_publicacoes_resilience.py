import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "painel-cidadao"))

import coletor_publicacoes  # noqa: E402


class PublicacoesSaplFallbackTests(unittest.TestCase):
    def test_consolidado_sapl_vira_materia_com_proveniencia(self):
        payload = {
            "2026": {
                "materias": [{
                    "id": "7001",
                    "ano": "2026",
                    "numero": "19",
                    "tipo": "Projeto de Lei Ordinária do Legislativo",
                    "sigla": "PLOL",
                    "autor": "Vereador Exemplo",
                    "pdf": "https://sapl.varginha.mg.leg.br/media/exemplo.pdf",
                    "ementa": "Dispõe sobre transparência.",
                    "data": "2026-08-26",
                    "desfecho": "tramitando",
                }]
            }
        }
        with tempfile.TemporaryDirectory() as tmp:
            arquivo = Path(tmp) / "camara_anos.json"
            arquivo.write_text(json.dumps(payload), encoding="utf-8")
            with patch.object(coletor_publicacoes, "CAMARA_ANOS", arquivo):
                materias = coletor_publicacoes._materias_do_consolidado(2026)

        self.assertEqual(len(materias), 1)
        self.assertEqual(materias[0]["numero"], "19")
        self.assertEqual(materias[0]["autor_nome_fallback"], "Vereador Exemplo")
        self.assertTrue(materias[0]["em_tramitacao"])
        self.assertIn("SAPL consolidado", materias[0]["coleta_origem"])


if __name__ == "__main__":
    unittest.main()
