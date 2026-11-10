import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('pncp_history',Path(__file__).resolve().parents[1]/'scripts/coletar-pncp-historico.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class PncpHistorico(unittest.TestCase):
 def test_partial_failure_preserves_previous_records(self):
  with tempfile.TemporaryDirectory() as temp:
   path=Path(temp)/'historico.json';path.write_text(json.dumps({'anos':{'2025':{'contratos':[{'numero_controle_pncp':'abc'}],'ultima_coleta_bem_sucedida_em':'2026-01-01T00:00:00+00:00'}}}),encoding='utf8')
   with patch.object(m,'OUT',path),patch.object(m.coletor_pncp,'_coleta_contratos',return_value=([],[],False,{'orgaos':{}})):
    m.run(2025)
   result=json.loads(path.read_text(encoding='utf8'))['anos']['2025']
   self.assertEqual(result['status'],'preservado');self.assertEqual(result['contratos'][0]['numero_controle_pncp'],'abc')
 def test_does_not_replace_recent_success(self):
  with tempfile.TemporaryDirectory() as temp:
   path=Path(temp)/'historico.json';path.write_text(json.dumps({'anos':{'2025':{'ultima_tentativa_em':m.datetime.now(m.timezone.utc).isoformat(),'contratos':[{'id':1}]}}}),encoding='utf8')
   with patch.object(m,'OUT',path),patch.object(m.coletor_pncp,'_coleta_contratos') as collect:
    m.run(2025);collect.assert_not_called()
if __name__=='__main__':unittest.main()
