import importlib.util,json,tempfile,unittest,zipfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('backup_source',Path(__file__).resolve().parents[1]/'scripts/backup-source-code.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class SourceBackupTests(unittest.TestCase):
 def test_backup_preserva_codigo_local_e_exclui_segredos_e_dados(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp); names=['painel-cidadao/app.js','scripts/coletor.py','painel-cidadao/data/chunks/pessoal.json','private/config.json','dashboard/.env','scripts/.env.local']
   for n in names:
    f=root/n;f.parent.mkdir(parents=True,exist_ok=True);f.write_text(n,encoding='utf-8')
   target=root/'backup.zip';self.assertEqual(m.snapshot(root,target,names),2)
   with zipfile.ZipFile(target) as z:
    self.assertEqual(set(z.namelist()),{'painel-cidadao/app.js','scripts/coletor.py','backup-manifest.json'})
    manifest=json.loads(z.read('backup-manifest.json'));self.assertEqual(len(manifest['arquivos']),2)
 def test_recusa_escapar_da_raiz(self):
  self.assertFalse(m.allowed('../scripts/test.py'));self.assertFalse(m.allowed('private/secret.py'));self.assertFalse(m.allowed('painel-cidadao/data.js'))
