import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('docpncp', Path(__file__).resolve().parents[1] / 'scripts/coletar-documentos-pncp.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class DocumentosPncp(unittest.TestCase):
    def test_unique_identity_and_ambiguity(self):
        pncp = {'numero':'5', 'ano':2026, 'fornecedor':'Empresa X', 'cnpj_fornecedor':'12345678000100', 'data_assinatura':'2026-03-09', 'cnpj_orgao':'04366790000184'}
        local = {'numero':'005', 'ano':2026, 'contratado':'Empresa X', 'cnpj':'12345678****', 'data_assinatura':'2026-03-09', 'fonte_url':'https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324812/detalhe/133849:9918:1_9918'}
        self.assertEqual(len(m.associacoes([pncp], {'camara':[local]})), 1)
        self.assertEqual(len(m.associacoes([pncp], {'camara':[local, local]})), 1)
        self.assertEqual(m.associacoes([pncp], {'camara':[local, {**local, 'fonte_url':local['fonte_url']+'2'}]}), [])
        self.assertEqual(m.associacoes([pncp, pncp], {'camara':[local]}), [])
        self.assertEqual(m.associacoes([{**pncp,'fornecedor':'Outro'}], {'camara':[local]}), [])

    def test_files_and_term_files_are_distinct(self):
        contrato = {'numero_controle_pncp':'04366790000184-2-000004/2026', 'cnpj_orgao':'04366790000184'}
        def fake(url):
            if url.endswith('/termos'): return [{'sequencialTermoContrato': 2}]
            return [{'sequencialDocumento':1, 'titulo':'Documento'}]
        docs = m.documentos(contrato, fake)
        self.assertEqual(len(docs), 2)
        self.assertIn('/termos/2/arquivos/1', docs[1]['url'])
        self.assertTrue(all(d['vinculo'] == 'candidato_por_identidade' for d in docs))

    def test_failure_preserves_previous_evidence(self):
        catalog = {'ficha':{'fontes_adicionais':[{'url':'https://antigo', 'vinculo':'confirmado_por_leitura'}]}}
        m.atualizar(catalog, 'ficha', [], '2026-10-29', erro=True)
        self.assertEqual(catalog['ficha']['fontes_adicionais'][0]['url'], 'https://antigo')
        self.assertEqual(catalog['ficha']['pncp_ultima_tentativa_status'], 'inconclusiva')

    def test_success_keeps_content_and_manual_reviews(self):
        previous={'url':'https://pncp.gov.br/file','vinculo':'confirmado_por_leitura','conferencia_manual_em':'2026-10-29','conferencia_conteudo':{'status':'revisao_necessaria'}}
        catalog={'ficha':{'fontes_adicionais':[previous]}}
        m.atualizar(catalog,'ficha',[{'url':previous['url'],'vinculo':'candidato_por_identidade'}],'2026-10-30')
        new=catalog['ficha']['fontes_adicionais'][0]
        self.assertEqual(new['vinculo'],'confirmado_por_leitura')
        self.assertEqual(new['conferencia_manual_em'],'2026-10-29')
        self.assertEqual(new['conferencia_conteudo']['status'],'revisao_necessaria')

    def test_unrecognized_organization_is_rejected(self):
        with self.assertRaises(ValueError):
            m.raiz_pncp({'numero_controle_pncp':'99999999999999-2-000004/2026', 'cnpj_orgao':'99999999999999'})

if __name__ == '__main__': unittest.main()
