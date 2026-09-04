import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'painel-cidadao'))
from emendas_documentos import enriquecer_emendas

spec = importlib.util.spec_from_file_location('emendas_cgu', ROOT / 'painel-cidadao/emendas/coletor_emendas_federais.py')
cgu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cgu)


class EmendasCorrecaoTests(unittest.TestCase):
    def test_total_with_duplicate_currency_symbol_does_not_capture_coauthor_share(self):
        import coletor
        parsed = coletor._parse_emenda('Entidade beneficiária: Banco de Alimentos\nValor: R$ $35.000,00 (sendo R$15.000,00 da vereadora Ana e R$20.000,00 de outros autores)')
        self.assertEqual(parsed['valor_brl'], 35000)

    def test_documented_contributions_match_total_and_keep_original_source(self):
        row = {'ano': '2025', 'numero': '225', 'beneficiario': 'Banco de Alimentos de Varginha', 'valor_brl': 15000,
               'pdf': 'http://sapl.varginha.mg.leg.br/media/sapl/public/materialegislativa/2025/5167/segmento_225_de_projetodelei57-2025_-_emendas.pdf'}
        result = enriquecer_emendas([row])[0]
        self.assertEqual(result['valor_brl'], 35000)
        self.assertEqual(sum(p['valor'] for p in result['participacoesDocumento']), 35000)
        self.assertEqual(result['valorReferenciaDocumento']['cadastro_sapl'], 35000)
        self.assertEqual(result['valorReferenciaDocumento']['anterior_painel'], 15000)

    def test_cgu_columns_by_name_years_and_exact_destination(self):
        # Colunas propositalmente fora da ordem e com campo adicional da CGU.
        main = ('Ano da Emenda;Campo novo;Código da Emenda;Nome Ação;Nome Função;Nome Subfunção;Município;UF;Código Município IBGE\n'
                '2023;x;202314110006;Saúde básica;Saúde;Atenção;Varginha;MG;3170701\n'
                '2023;x;202399990001;Outra cidade;Saúde;Atenção;São José da Varginha;MG;3163102\n')
        beneficiary = ('Código da Emenda;Tipo de Emenda;Ano/Mês;Nome do Autor da Emenda;Código do Favorecido;Favorecido;Natureza Jurídica;UF Favorecido;Município Favorecido;Valor Recebido\n'
                       '202314110006;Emenda de Bancada;202410;Parlamentar;18240119000105;MUNICIPIO DE VARGINHA;MUNICIPIO;MG;VARGINHA;1062,01\n'
                       '202399990001;Emenda de Bancada;202410;Parlamentar;18240119000105;MUNICIPIO DE VARGINHA;MUNICIPIO;MG;VARGINHA;99,00\n'
                       'Sem informação;Emenda de Bancada;201901;Sem informação;18240119000105;MUNICIPIO DE VARGINHA;MUNICIPIO;MG;VARGINHA;11,00\n')
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as z:
            z.writestr('EmendasParlamentares.csv', main.encode('latin-1'))
            z.writestr('EmendasParlamentares_PorFavorecido.csv', beneficiary.encode('latin-1'))
        with zipfile.ZipFile(stream) as z:
            rows = cgu.registros_varginha(z, cgu.referencias_por_codigo(z))
        self.assertEqual(len(rows), 2)
        self.assertEqual((rows[0]['anoEmenda'], rows[0]['anoRecurso'], rows[0]['periodoRecebimentoCGU']), ('2023', '2024', '202410'))
        self.assertEqual(rows[0]['valor'], 1062.01)
        self.assertIn('Saúde básica', rows[0]['objeto'])
        self.assertEqual(rows[1]['anoEmenda'], '')
        self.assertEqual(rows[1]['anoRecurso'], '2019')

    def test_betha_number_does_not_become_year(self):
        self.assertEqual(cgu.ano_referencia_betha('27540001'), '')
        self.assertEqual(cgu.ano_referencia_betha('50410002/2025'), '2025')
        self.assertEqual(cgu.ano_referencia_betha('202650410001'), '2026')

    def test_municipal_source_changes_do_not_receive_old_correction(self):
        row = {'ano': '2025', 'numero': '4', 'beneficiario': 'POLICIA CIVIL DE MINAS GERAIS',
               'cnpj': '18.15.532/0001-70', 'pdf': 'http://sapl.varginha.mg.leg.br/media/sapl/public/materialegislativa/2025/4945/segmento_005_de_projetodelei57-2025_-_emendas.pdf'}
        output = enriquecer_emendas([copy.deepcopy(row)])[0]
        self.assertEqual(output['exercicioOrcamentario'], '2026')
        self.assertEqual(output['cnpj'], '18.715.532/0001-70')
        self.assertEqual(output['cnpjOriginal'], row['cnpj'])
        self.assertEqual(enriquecer_emendas([copy.deepcopy(output)])[0], output)
        changed = {**row, 'pdf': 'https://sapl.varginha.mg.leg.br/novo-documento.pdf'}
        self.assertEqual(enriquecer_emendas([changed])[0], changed)

    def test_document_mismatch_does_not_confirm_budget(self):
        rows = json.loads((ROOT / 'painel-cidadao/data/chunks/emendas.json').read_text(encoding='utf-8'))
        for number in ['317', '323']:
            row = next(r for r in rows if r['numero'] == number)
            self.assertEqual(row['documentoStatus'], 'numero_divergente')
            self.assertIsNone(row['exercicioOrcamentario'])
        no_pdf = next(r for r in rows if r['numero'] == '130')
        self.assertIsNone(no_pdf['exercicioOrcamentario'])


if __name__ == '__main__':
    unittest.main()
