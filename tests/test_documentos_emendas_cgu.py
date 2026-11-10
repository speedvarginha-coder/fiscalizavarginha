import csv
import importlib.util
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('documentos_cgu', Path(__file__).resolve().parents[1] / 'scripts/analisar-documentos-emendas-cgu.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
collector_spec = importlib.util.spec_from_file_location('coletor_cgu', Path(__file__).resolve().parents[1] / 'scripts/coletar-documentos-emendas-cgu.py')
collector = importlib.util.module_from_spec(collector_spec)
collector_spec.loader.exec_module(collector)


class DocumentosCGUTest(unittest.TestCase):
    def arquivo(self, fields, rows):
        tmp = tempfile.NamedTemporaryFile(suffix='.zip', delete=False)
        self.addCleanup(Path(tmp.name).unlink, missing_ok=True)
        tmp.close()
        text = io.StringIO(newline='')
        writer = csv.DictWriter(text, fieldnames=fields, delimiter=';')
        writer.writeheader()
        writer.writerows(rows)
        with zipfile.ZipFile(tmp.name, 'w') as z:
            z.writestr('dados.csv', text.getvalue().encode('latin-1'))
        return tmp.name

    def test_filtra_municipio_e_oculta_pessoa_fisica(self):
        row = dict(zip(module.FIELDS, ['202639760006', 'OB123', '08/05/2026', 'Pagamento',
                                      '0,00', '1500000,00', module.IBGE, 'NOME PARTICULAR',
                                      'Pessoa Física', 'VARGINHA', '12345678901']))
        other = dict(row, **{module.FIELDS[6]: '1234567'})
        result = module.extrair(self.arquivo(module.FIELDS, [row, other]))
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['cnpj'], '')
        self.assertNotIn('NOME PARTICULAR', str(result))

    def test_recusa_arquivo_sem_colunas(self):
        with self.assertRaises(ValueError):
            module.extrair(self.arquivo(['irrelevante'], [{'irrelevante': 'x'}]))

    def test_falha_na_coleta_preserva_arquivo_anterior(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'documentos.json'
            path.write_text('base anterior', encoding='utf-8')
            with patch.object(collector, 'collect', side_effect=OSError('fonte indisponível')):
                with patch('sys.argv', ['coletor', '--anos', '2026', '--saida', str(path)]):
                    self.assertEqual(collector.main(), 2)
            self.assertEqual(path.read_text(encoding='utf-8'), 'base anterior')


if __name__ == '__main__':
    unittest.main()
