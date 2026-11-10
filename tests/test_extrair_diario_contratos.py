import importlib.util, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('extract_diary',Path(__file__).resolve().parents[1]/'scripts/extrair-diario-contratos.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ExtractDiary(unittest.TestCase):
 def setUp(self):
  self.url='https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043/detalhe/133849:9916:1_9916'
  self.bases={'prefeitura':[{'numero':'11','ano':2024,'contratado':'AGROPECUARIA JURITI LTDA','fonte_url':self.url}]}
  self.pdf='https://www.varginha.mg.gov.br/uploads/diario_123abc.pdf'
 def test_complete_extract_produces_candidate_with_page(self):
  t='ADITIVO Nº : 450/2026\n1º Termo Aditivo ao Contrato de Locação de Imóvel nº 011/2024\nPartes: Município de Varginha e Agropecuária Juriti Ltda'
  rows=m.extrair_paginas([t],self.bases,self.pdf,'2026-10-29')
  self.assertEqual(len(rows),1);self.assertEqual(rows[0][1]['vinculo'],'candidato_por_identidade');self.assertTrue(rows[0][1]['url'].endswith('#page=1'))
 def test_supplier_in_another_article_does_not_match(self):
  t='ADITIVO Nº : 450/2026\nContrato nº 011/2024\nPartes: Município de Varginha e Outra Empresa\nADITIVO Nº : 451/2026\nContrato nº 012/2024\nPartes: Município de Varginha e Agropecuária Juriti Ltda'
  self.assertEqual(m.extrair_paginas([t],self.bases,self.pdf,'now'),[])
 def test_other_organ_is_not_a_match(self):
  t='ADITIVO Nº : 450/2026\nContrato nº 011/2024\nPartes: Consórcio CISSUL e Agropecuária Juriti Ltda'
  self.assertEqual(m.extrair_paginas([t],self.bases,self.pdf,'now'),[])
if __name__=='__main__':unittest.main()
