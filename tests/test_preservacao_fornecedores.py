import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'painel-cidadao'))
import coletor
spec = importlib.util.spec_from_file_location('restauracao', ROOT / 'scripts/restore-contratos-vigentes.py')
restauracao = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restauracao)

class PreservacaoTests(unittest.TestCase):
    def test_gravacao_intermediaria_preserva_fornecedor_e_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            anterior = {'fornecedores': [{'cnpj': '123', 'razao_social': 'Empresa'}], 'fornecedores_coletado_em': '2026-09-01'}
            with patch.object(coletor, 'DATA', Path(tmp)), patch.object(coletor, '_load_existing', return_value=anterior):
                coletor._save('cnpjs.json', {'empresas': []})
            novo = json.loads((Path(tmp) / 'cnpjs.json').read_text(encoding='utf8'))
            self.assertEqual(novo['fornecedores'], anterior['fornecedores'])
            self.assertEqual(novo['fornecedores_coletado_em'], '2026-09-01')
            self.assertIn('preservado', novo['fornecedores_status'])

    def test_restauracao_distingue_entidade_fornecedor_e_deduplica(self):
        a = {'numero': '1', 'ano': '2022', 'cnpj': '123', 'entidade': 'A', 'data_fim': '2030-12-31'}
        b = dict(a, entidade='B')
        c = dict(a, cnpj='456')
        self.assertEqual(restauracao.candidatos([a, b, b, c], [a], '2026-10-03'), [b, c])
