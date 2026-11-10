import importlib.util
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'scripts' / 'conferir-amostras-fontes.py'
spec = importlib.util.spec_from_file_location('conferir_amostras_fontes', path)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class ConferenciaAmostralTests(unittest.TestCase):
    def test_compara_sem_expor_pessoa_ou_alterar_dados(self):
        source=[{'nome':'Pessoa Exemplo','valor':12.5,'data':'2026-01-01'}]
        panel=[{'nome':'Pessoa Exemplo','valor':13.0,'data':None}]
        result=audit.compare(source,panel,lambda r:audit.norm(r['nome']),['nome','valor','data'])
        self.assertEqual(result[0]['campos'],{'nome':'igual','valor':'divergente','data':'não comparável'})
        self.assertNotIn('Pessoa',str(result))
        self.assertEqual(panel[0]['valor'],13.0)

    def test_homonimos_e_duplicatas_sao_inconclusivos(self):
        row={'nome':'Pessoa Exemplo','valor':10}
        key=lambda r:r['nome']
        self.assertEqual(audit.compare([row,row],[row],key,['valor']),[])
        self.assertEqual(audit.compare([row],[row,row],key,['valor']),[])

if __name__ == '__main__': unittest.main()
