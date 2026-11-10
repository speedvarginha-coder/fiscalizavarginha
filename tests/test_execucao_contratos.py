import importlib.util,unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('execucao',Path(__file__).resolve().parents[1]/'scripts/conferir-execucao-contratos.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Execucao(unittest.TestCase):
 def setUp(self):
  self.f=m.PREFIX+'83043/detalhe/133849:9916:7444_9916'
  self.c={'numero':'166','contratado':'TRANSPORTO TRANSPORTES COLETIVOS PORTO FERREIRA LTDA','cnpj':'57.437.279/****-**'}
  self.e={'numero':'183','ano':2024,'data':'2024-01-02','valor':8499986.72}
  self.h={'id':'133849:9916:15233002'}
  self.d={'numeroEmpenho':183,'anoExercicio':2024,'dataEmpenho':'2024-01-02','valorEmpenho':8499986.72,'valorLiquidadoEmpenho':0,'valorPagoEmpenho':0,'contrato':{'numero':'166'},'credor':{'nomeCredor':self.c['contratado'],'cnpjCpfCredor':'57.437.279/****-**'}}
 def test_identity_requires_all_keys(self):
  self.assertIn('82995/detalhe/133849:9916:15233002',m.identificar(self.f,self.c,self.e,self.h,self.d))
  for changed in ({'numeroEmpenho':184},{'valorEmpenho':1},{'contrato':{'numero':'99'}},{'credor':{'nomeCredor':'OUTRO FORNECEDOR','cnpjCpfCredor':'57.437.279/****-**'}}):
   self.assertIsNone(m.identificar(self.f,self.c,self.e,self.h,{**self.d,**changed}))
  self.assertIsNone(m.identificar(self.f,self.c,self.e,{'id':'133849:9917:15233002'},self.d))
  self.assertIsNone(m.identificar(self.f,{**self.c,'numero':''},self.e,self.h,{**self.d,'contrato':{}}))
  self.assertIsNone(m.identificar(self.f,{**self.c,'cnpj':'123.456.789-**'},self.e,self.h,{**self.d,'credor':{'nomeCredor':self.c['contratado'],'cnpjCpfCredor':'123.456.789-**'}}))
 def test_zero_is_kept_and_bank_accounts_are_not_published(self):
  d={**self.d,'pagamentos':[{'dataPagamento':'2024-02-01','valorPagamento':0,'contaCorrente':'123'}],'liquidacoes':[],'documentosFiscais':[]}
  r=m.resumo(d,'fonte','agora');self.assertEqual(r['valor_pago'],0);self.assertNotIn('contaCorrente',r['pagamentos'][0]);self.assertEqual(r['liquidacoes'],[])
 def test_diagnostico_expoe_campo_divergente_sem_dados_pessoais(self):
  motivo=m.explicar_divergencia(self.c,self.e,{**self.d,'dataEmpenho':'2024-01-03','valorEmpenho':1})
  self.assertIn('data do empenho',motivo);self.assertIn('valor do empenho',motivo)
  self.assertNotIn('57.437',motivo)
  self.assertIn('número do contrato',m.explicar_divergencia({**self.c,'numero':'0'},self.e,self.d))
 def test_abbreviated_company_name_needs_matching_ordered_tokens(self):
  self.assertTrue(m.nomes_compativeis('MB COMERCIO DE MATER. E EQUIP. ELETROEL. LTDA','MB COMERCIO DE MATERIAIS E EQUIPAMENTOS ELETROELETRONICOS EIRELI'))
  self.assertFalse(m.nomes_compativeis('MB COMERCIO DE MATER. E EQUIP. ELETROEL. LTDA','MB COMERCIO DE MOVEIS E EQUIPAMENTOS ELETROELETRONICOS EIRELI'))
if __name__=='__main__':unittest.main()
