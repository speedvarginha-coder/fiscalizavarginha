import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / 'painel-cidadao/emendas/normalizar_emendas_federais.py'
spec = importlib.util.spec_from_file_location('normalizar_emendas_federais', SCRIPT)
normalizador = importlib.util.module_from_spec(spec)
spec.loader.exec_module(normalizador)


class GravacaoSegura(unittest.TestCase):
    def test_normaliza_sem_deixar_temporario(self):
        with tempfile.TemporaryDirectory() as pasta:
            arquivo = Path(pasta) / 'emendas_federais.js'
            arquivo.write_text('window.EMENDAS_FEDERAIS = {"emendas": [{}]};', encoding='utf-8')
            with patch.object(normalizador, 'ARQUIVO', arquivo):
                normalizador.main()
            payload = json.JSONDecoder().raw_decode(arquivo.read_text(encoding='utf-8').split('=', 1)[1].strip())[0]
            self.assertEqual(payload['emendas'][0]['granularidade'], 'emenda_favorecido_agregado')
            self.assertEqual(list(Path(pasta).glob('*.tmp')), [])

    def test_falha_na_troca_preserva_original(self):
        with tempfile.TemporaryDirectory() as pasta:
            arquivo = Path(pasta) / 'emendas_federais.js'
            original = 'window.EMENDAS_FEDERAIS = {"emendas": [{}]};'
            arquivo.write_text(original, encoding='utf-8')
            with patch.object(normalizador, 'ARQUIVO', arquivo), patch.object(normalizador.os, 'replace', side_effect=OSError('falha')):
                with self.assertRaises(OSError):
                    normalizador.main()
            self.assertEqual(arquivo.read_text(encoding='utf-8'), original)
            self.assertEqual(list(Path(pasta).glob('*.tmp')), [])


if __name__ == '__main__':
    unittest.main()
