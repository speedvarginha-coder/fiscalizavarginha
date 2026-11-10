import importlib.util,unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('pdf_pncp',Path(__file__).resolve().parents[1]/'scripts/conferir-documentos-pncp.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class ConferirDocumento(unittest.TestCase):
 def setUp(self):self.c={'numero':'5','ano':2026,'contratado':'EMPRESA EXEMPLO LTDA'}
 def test_detects_both_without_certifying_contract(self):
  r=m.avaliar('Contrato 005/2026 firmado com Empresa Exemplo Ltda',self.c)
  self.assertEqual(r['status'],'referencia_e_fornecedor_encontrados')
 def test_missing_number_or_name_requires_revision(self):
  self.assertEqual(m.avaliar('Contrato 5/2026 de outra empresa',self.c)['status'],'revisao_necessaria')
  self.assertEqual(m.avaliar('Contrato 15/2026 Empresa Exemplo Ltda',self.c)['status'],'revisao_necessaria')
 def test_cnpj_root_is_a_separate_signal_not_manual_confirmation(self):
  c={**self.c,'cnpj':'12.345.678/****-**'}
  r=m.avaliar('Contrato 5/2026 firmado por empresa CNPJ 12.345.678/0001-90',c)
  self.assertEqual(r['status'],'referencia_e_cnpj_encontrados');self.assertFalse(r['fornecedor_encontrado'])
 def test_punctuation_does_not_hide_exact_company_name(self):
  c={**self.c,'contratado':'EMPRESA EXEMPLO S.A.'}
  self.assertEqual(m.avaliar('Contrato 5/2026 EMPRESA EXEMPLO S/A',c)['status'],'referencia_e_fornecedor_encontrados')
if __name__=='__main__':unittest.main()
