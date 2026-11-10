import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from contextlib import ExitStack
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'painel-cidadao'))
import coletor
import coletor_betha as betha
import coletor_resultados_licitacao as pncp

class CrossingMetadataTests(unittest.TestCase):
    def test_financeiro_seguido_de_coleta_e_vigia_renova_consulta(self):
        spec = importlib.util.spec_from_file_location('repair', ROOT/'scripts/reconcile-emenda-payments.py')
        repair = importlib.util.module_from_spec(spec); spec.loader.exec_module(repair)
        emenda = {'numero':'1','ano':'2025','exercicioOrcamentario':'2026','cnpj':'12.345.678/0001-00','beneficiario':'Entidade'}
        credores = [{'ano':2026,'cnpjCpf':'12.345.678/****-**','nomeCredor':'Entidade','valorPagamentoAno':10}]
        previous = repair.reconcile({},[emenda],credores)
        previous['emendas_cruzamento_meta']['consultado_em'] = '2026-01-01T00:00:00Z'
        for fast in (False, True):
            with self.subTest(fast=fast), ExitStack() as stack:
                for obj, name, value in [(betha,'get_token','token'),(betha,'todos_credores',credores),
                    (coletor,'_baixar_dados_abertos_safe',[]),(coletor,'_baixar_dados_abertos_full_safe',([],{},{})),
                    (coletor,'_load_last_nonempty_list',([{'numero':'1','valor':10}], 'backup')),
                    (coletor,'_load_existing',previous)]:
                    stack.enter_context(patch.object(obj,name,return_value=value))
                result = coletor._processa_prefeitura([emenda],vigia_rapida=fast)
                self.assertGreater(result['emendas_cruzamento_meta']['consultado_em'], '2026-01-01')
                self.assertEqual(result['emendas_cruzamento_meta']['registros_credores'],1)
                self.assertEqual(result['emendas_cruzadas'][0]['valor_pago_total'],10)

    def test_falha_nao_produz_nova_base_nem_data(self):
        with patch.object(betha,'get_token',return_value='token'), patch.object(betha,'todos_credores',side_effect=RuntimeError('indisponível')):
            self.assertEqual(coletor._processa_prefeitura([]), {})

class PncpResumeTests(unittest.TestCase):
    def test_pagina_seguinte_e_todos_os_itens(self):
        def api(url):
            if '/resultados' in url: return [{'nomeRazaoSocialFornecedor':'Teste'}]
            if 'pagina=1&' in url: return [{'numeroItem':i} for i in range(1,21)]
            return [{'numeroItem':21}]
        with patch.object(pncp,'_get',side_effect=api), patch.object(pncp.time,'sleep'):
            self.assertEqual(len(pncp._resultados_da_compra('123',2026,1)),21)

    def test_falha_nao_vira_lista_vazia(self):
        with patch.object(pncp,'_get',side_effect=RuntimeError('503')):
            with self.assertRaises(RuntimeError): pncp._resultados_da_compra('123',2026,1)

    def test_retomada_persistida_e_mudanca_oficial_invalida_cache(self):
        compra = {'numeroControlePNCP':'123-1-1/2026','anoCompra':2026,'sequencialCompra':1}
        with tempfile.TemporaryDirectory() as temp, patch.object(pncp,'CACHE_PATH',Path(temp)/'progress.json'), patch.object(pncp,'_resultados_da_compra',return_value=[{'item':1}]) as collect:
            cache = {}
            first = pncp._compra_com_retomada(compra,'123',cache)
            persisted = json.loads(pncp.CACHE_PATH.read_text(encoding='utf-8'))
            self.assertEqual(pncp._compra_com_retomada(compra,'123',persisted),first)
            self.assertEqual(collect.call_count,1)
            pncp._compra_com_retomada({**compra,'valorTotalHomologado':2},'123',persisted)
            self.assertEqual(collect.call_count,2)
            persisted[compra['numeroControlePNCP']]['consultado_em']='2020-01-01T00:00:00+00:00'
            pncp._compra_com_retomada(compra,'123',persisted)
            self.assertEqual(collect.call_count,3)

    def test_falha_nao_grava_progresso_incompleto(self):
        compra={'anoCompra':2026,'sequencialCompra':1}
        cache={}
        with patch.object(pncp,'_resultados_da_compra',side_effect=RuntimeError('503')):
            with self.assertRaises(RuntimeError): pncp._compra_com_retomada(compra,'123',cache)
        self.assertEqual(cache,{})

    def test_interrupcao_retoma_itens_sem_refazer_consultas_concluidas(self):
        compra={'numeroControlePNCP':'123-1/2026','anoCompra':2026,'sequencialCompra':1}
        with tempfile.TemporaryDirectory() as temp, patch.object(pncp,'CACHE_PATH',Path(temp)/'cache.json'), patch.object(pncp.time,'sleep'):
            def first(url):
                if '/itens?' in url: return [{'numeroItem':1},{'numeroItem':2}]
                if '/1/resultados' in url: return [{'nomeRazaoSocialFornecedor':'Teste','niFornecedor':'12345678901'}]
                raise TimeoutError('fim da janela')
            with patch.object(pncp,'_get',side_effect=first):
                with self.assertRaises(TimeoutError): pncp._compra_com_retomada(compra,'123',{})
            cache=json.loads(pncp.CACHE_PATH.read_text(encoding='utf-8'))
            self.assertNotIn('12345678901',pncp.CACHE_PATH.read_text(encoding='utf-8'))
            def second(url):
                if '/itens?' in url: return [{'numeroItem':1},{'numeroItem':2}]
                if '/1/resultados' in url: self.fail('Item já conferido foi consultado de novo')
                return [{'nomeRazaoSocialFornecedor':'Teste2'}]
            with patch.object(pncp,'_get',side_effect=second):
                result,_=pncp._compra_com_retomada(compra,'123',cache)
                self.assertEqual(len(result),2)

    def test_ciclo_parcial_mescla_progresso_sem_apagar_compras_anteriores(self):
        old={'controle_pncp':'123-old','data_publicacao':'2020-01-01','resultados':[{'item':1}]}
        compra={'numeroControlePNCP':'123-new','anoCompra':2026,'sequencialCompra':1}
        def listing(*args):
            args[-1].append('Uma modalidade indisponível')
            return [compra]
        with tempfile.TemporaryDirectory() as temp, patch.object(pncp,'OUT_PATH',Path(temp)/'out.json'), patch.object(pncp,'CACHE_PATH',Path(temp)/'cache.json'), patch.object(pncp,'ORGAOS',{'123':'Teste'}), patch.object(pncp,'_listar_contratacoes',side_effect=listing), patch.object(pncp,'_compra_com_retomada',return_value=([], '2026-10-26T12:00:00Z')), patch.object(pncp.time,'sleep'):
            pncp.OUT_PATH.write_text(json.dumps({'compras':1,'registros':[old],'gerado_em':'2020-01-01T12:00:00Z','status':'ok'}),encoding='utf-8')
            try:
                self.assertEqual(pncp.main(),0)
            finally:
                pncp.DEADLINE=None
            result=json.loads(pncp.OUT_PATH.read_text(encoding='utf-8'))
            self.assertEqual(result['status'],'partial')
            self.assertEqual(result['compras'],2)
            self.assertEqual(result['registros'][0],old)
            self.assertEqual(result['ultima_coleta_completa_em'],'2020-01-01T12:00:00Z')

    def test_prioriza_inedita_antes_de_revalidar_cache_vencido(self):
        old={'numeroControlePNCP':'123-old','anoCompra':2026,'sequencialCompra':1}
        new={'numeroControlePNCP':'123-new','anoCompra':2026,'sequencialCompra':2}
        cache={'123-old':{'fingerprint':'old','consultado_em':'2020-01-01T00:00:00Z','resultados':[]}}
        self.assertLess(pncp._prioridade_compra(new,'123',cache),pncp._prioridade_compra(old,'123',cache))

    def test_prioriza_ineditos_de_prefeitura_e_camara_sem_monopolio(self):
        compras={'123':[{'numeroControlePNCP':f'123-p{i}','anoCompra':2026,'sequencialCompra':i} for i in (1,2)],'456':[{'numeroControlePNCP':'456-c1','anoCompra':2026,'sequencialCompra':1}]}
        seen=[]
        def listing(cnpj,*_): return compras[cnpj]
        def collect(c,cnpj,_cache): seen.append(cnpj);return [],'2026-10-27T00:00:00Z'
        with tempfile.TemporaryDirectory() as temp, patch.object(pncp,'OUT_PATH',Path(temp)/'out.json'), patch.object(pncp,'CACHE_PATH',Path(temp)/'cache.json'), patch.object(pncp,'ORGAOS',{'123':'Prefeitura','456':'Câmara'}), patch.object(pncp,'_listar_contratacoes',side_effect=listing), patch.object(pncp,'_compra_com_retomada',side_effect=collect), patch.object(pncp.time,'sleep'):
            try: pncp.main()
            finally: pncp.DEADLINE=None
        self.assertEqual(seen[:2],['123','456'])

class AgendamentoTests(unittest.TestCase):
    def test_sobreposicao_diaria_aguarda_e_vigia_pula_sem_erro(self):
        import subprocess
        source=(ROOT/'scripts/update-data.ps1').read_text(encoding='utf-8')
        start=source.index('function Get-LockWaitAction {');end=source.index('\nfunction ',start+10)
        script=source[start:end]+"\n"+"\n".join([
          "Get-LockWaitAction -Message 'Outra coleta em andamento (dono vivo)' -IsWatch $false -Expired $false",
          "Get-LockWaitAction -Message 'Outra coleta parece estar em andamento' -IsWatch $true -Expired $false",
          "Get-LockWaitAction -Message 'Outra coleta em andamento' -IsWatch $false -Expired $true",
          "Get-LockWaitAction -Message 'Acesso negado' -IsWatch $false -Expired $false"])
        result=subprocess.run(['powershell','-NoProfile','-Command',script],capture_output=True,text=True,check=True)
        self.assertEqual(result.stdout.split(),['aguardar','pular','expirou','erro'])
