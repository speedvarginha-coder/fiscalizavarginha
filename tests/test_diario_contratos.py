import importlib.util, unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('diario_contratos',Path(__file__).resolve().parents[1]/'scripts/reconciliar-diario-contratos.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

class DiarioContratos(unittest.TestCase):
 def setUp(self):
  self.contrato={'numero':'11','ano':2024,'contratado':'AGROPECUARIA JURITI LTDA','fonte_url':'https://transparencia.betha.cloud/#/ficha'}
  self.doc={'tipo':'aditivo','titulo':'Aditivo 450/2026','resumo':'Termo aditivo ao contrato nº 011/2024', 'data':'2026-10-28','links':{'anexo_pdf':'https://www.varginha.mg.gov.br/uploads/diario_123abc.pdf'},'envolvidos':[{'papel':'orgao','nome':'Prefeitura de Varginha'},{'papel':'empresa','nome':'AGROPECUARIA JURITI LTDA'}]}
 def test_requires_identity_and_marks_candidate(self):
  r=m.candidatos([self.doc],{'prefeitura':[self.contrato]});self.assertEqual(len(r),1);self.assertEqual(r[0][1]['vinculo'],'candidato_por_identidade')
 def test_rejects_missing_or_different_organ_and_supplier(self):
  for envolvidos in [[],[{'papel':'orgao','nome':'CISSUL/SAMU'},{'papel':'empresa','nome':'AGROPECUARIA JURITI LTDA'}],[{'papel':'orgao','nome':'Prefeitura de Varginha'},{'papel':'empresa','nome':'OUTRA EMPRESA LTDA'}]]:
   self.assertEqual(m.candidatos([{**self.doc,'envolvidos':envolvidos}],{'prefeitura':[self.contrato]}),[])
 def test_rejects_ambiguous_identity(self):
  outro={**self.contrato,'fonte_url':'https://transparencia.betha.cloud/#/outra'}
  self.assertEqual(m.candidatos([self.doc],{'prefeitura':[self.contrato,outro]}),[])
if __name__=='__main__': unittest.main()
