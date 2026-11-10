import unittest,importlib.util,json,io
from pathlib import Path
from unittest.mock import patch,MagicMock
spec=importlib.util.spec_from_file_location('docaudit',Path(__file__).resolve().parents[1]/'scripts/auditar-documentos-contratos.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
URL='https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043/detalhe/133849:9916:7625_9916'
ID='c3b388ea-4787-4909-a7d0-7a7159666cb3'
class ContractDocuments(unittest.TestCase):
 def test_history_preserves_distinct_official_ids_with_identical_content(self):
  response={'totalHits':2,'hits':[{'id':ident,'sourceAsMap':{'numeroContrato':1,'ano':2026,'nomeContratado':'FORNECEDOR'}} for ident in ['133849:9916:1_9916','133849:9916:2_9916']]}
  with patch.object(a.b,'_api',return_value=response):
   records=a.historico('anon','prefeitura')['contratos'];self.assertEqual(len(records),2);self.assertNotEqual(records[0]['fonte_url'],records[1]['fonte_url'])
 def test_history_rejects_repeated_official_identifier(self):
  hit={'id':'133849:9916:1_9916','sourceAsMap':{}}
  with patch.object(a.b,'_api',return_value={'totalHits':2,'hits':[hit,hit]}),self.assertRaises(ValueError):a.historico('anon','prefeitura')
 def test_empty_list_and_omission_are_different(self):
  with patch.object(a.b,'_api',return_value={'documentosRelacionados':[]}):self.assertEqual(a.conferir_ficha(URL,'anon')['status'],'sem_documentos')
  with patch.object(a.b,'_api',return_value={}):self.assertEqual(a.conferir_ficha(URL,'anon')['status'],'nao_verificado')
 def test_missing_alterations_do_not_mean_no_addenda(self):
  for detail in ({},{'alteracoes':None},{'alteracoes':'inválido'},{'alteracoes':[None]}):
   with self.subTest(detail=detail),patch.object(a.b,'_api',return_value=detail):
    data=a.conferir_ficha(URL,'anon');self.assertIsNone(data['alteracoes_ficha']);self.assertIsNone(data['aditivos_qtd'])
 def test_official_alterations_keep_only_public_identification(self):
  detail={'documentosRelacionados':[],'alteracoes':[{'tipo':'Aditivo de prazo','numero':'1','ano':2025,'data':'2025-01-02','descricao':'outros dados'}]}
  with patch.object(a.b,'_api',return_value=detail):
   data=a.conferir_ficha(URL,'anon');self.assertEqual(data['alteracoes_ficha'],[{'tipo':'Aditivo de prazo','numero':'1','ano':2025,'data':'2025-01-02'}])
  with patch.object(a.b,'_api',return_value={'alteracoes':[]}):self.assertEqual(a.conferir_ficha(URL,'anon')['alteracoes_ficha'],[])
 def test_process_number_uses_verified_schema(self):
  with patch.object(a.b,'_api',return_value={'numeroProcessoCompra':12,'anoProcessoCompra':2026,'numeroLicitacao':1}):
   data=a.conferir_ficha(URL,'anon');self.assertEqual(data['trilha']['processo'],'12');self.assertEqual(data['trilha']['ano_processo'],'2026')
 def test_commitments_are_direct_source_not_payments(self):
  raw={'empenhos':[{'tipo':'Empenhar','ano':2024,'numero':'183','data':'2024-01-02','valor':100,'credor':'SEGREDO'}], 'fiscal':'Fiscal Oficial'}
  with patch.object(a.b,'_api',return_value=raw):
   t=a.conferir_ficha(URL,'anon')['trilha'];self.assertEqual(t['empenhos'][0]['numero'],'183');self.assertNotIn('credor',t['empenhos'][0]);self.assertEqual(t['fiscal'],'Fiscal Oficial')
  with patch.object(a.b,'_api',return_value={}):self.assertIsNone(a.conferir_ficha(URL,'anon')['trilha']['empenhos'])
  with patch.object(a.b,'_api',return_value={'empenhos':[]}):self.assertEqual(a.conferir_ficha(URL,'anon')['trilha']['empenhos'],[])
 def test_execution_preserved_only_for_same_unique_commitment(self):
  e={'tipo':'Empenhar','ano':2024,'numero':'183','data':'2024-01-02','valor':100}
  old={'trilha':{'empenhos':[{**e,'execucao':{'status':'confirmado_na_fonte'}}]}}
  fresh={'trilha':{'empenhos':[dict(e)]}};a.preservar_execucao(old,fresh);self.assertEqual(fresh['trilha']['empenhos'][0]['execucao']['status'],'confirmado_na_fonte')
  equivalent={'trilha':{'empenhos':[{**e,'valor':100.0}]}};a.preservar_execucao(old,equivalent);self.assertIn('execucao',equivalent['trilha']['empenhos'][0])
  changed={'trilha':{'empenhos':[{**e,'valor':101}]}};a.preservar_execucao(old,changed);self.assertNotIn('execucao',changed['trilha']['empenhos'][0])
  dupe={'trilha':{'empenhos':[dict(e),dict(e)]}};a.preservar_execucao(old,dupe);self.assertNotIn('execucao',dupe['trilha']['empenhos'][0])
  inconclusive={'trilha':{'empenhos':None}};a.preservar_execucao(old,inconclusive);self.assertEqual(inconclusive['trilha']['empenhos_ultima_tentativa_status'],'inconclusiva');self.assertEqual(inconclusive['trilha']['empenhos'][0]['execucao']['status'],'confirmado_na_fonte')
 def test_nonofficial_ficha_rejected(self):
  with self.assertRaises(ValueError):a.conferir_ficha('https://example.com/detalhe/123','anon')
 def test_signed_download_must_use_official_bucket(self):
  response=MagicMock();response.__enter__.return_value=response;response.read.return_value=('https://example.com/'+ID).encode()
  with patch.object(a.urllib.request,'urlopen',return_value=response),self.assertRaises(ValueError):a.conferir_pdf(URL,{'arquivo_id':ID},{},'anon')
 def test_invalid_document_identifier_not_fetched(self):
  with patch.object(a.urllib.request,'urlopen') as request:
   self.assertEqual(a.conferir_pdf(URL,{'arquivo_id':'../../secrets'},{},'anon')['status'],'nao_verificado');request.assert_not_called()
 def test_pdf_is_accessible_without_certifying_correspondence(self):
  signed='https://s3.sa-east-1.amazonaws.com/transparencia.betha.cloud/contratos/133849/9916/'+ID+'?signature=temporary'
  resolve=MagicMock();resolve.__enter__.return_value=resolve;resolve.read.return_value=signed.encode()
  pdf=MagicMock();pdf.__enter__.return_value=pdf;pdf.read.return_value=b'%PDF-1.7 sample'
  page=MagicMock();page.extract_text.return_value='Contrato 121/2022 VIACAO REAL'
  reader=MagicMock();reader.pages=[page]
  with patch.object(a.urllib.request,'urlopen',side_effect=[resolve,pdf]),patch('pypdf.PdfReader',return_value=reader):
   result=a.conferir_pdf(URL,{'arquivo_id':ID},{'numero':121,'ano':2022,'contratado':'VIACAO REAL'},'anon')
   self.assertEqual(result['status'],'pdf_acessivel');self.assertEqual(result['correspondencia'],'referencia_e_fornecedor_identificados');self.assertNotIn('signature',json.dumps(result))
 def test_anonymous_auth_response_parsed_without_executing_js(self):
  response=MagicMock();response.__enter__.return_value=response;response.read.return_value=b'__jp0({"accessToken":"public-anonymous","expiresIn":3000});'
  with patch.dict(a.os.environ,{'BETHA_ANONYMOUS_TOKEN':''}),patch.object(a.urllib.request,'urlopen',return_value=response):self.assertEqual(a.token_publico(),'public-anonymous')
