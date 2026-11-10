import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "painel-cidadao"))
import coletor_pessoal_historico as col


class HistoricoTests(unittest.TestCase):
    def test_preserva_vinculos_com_conteudo_igual_e_ids_distintos(self):
        row = {"nomeServidor": "Pessoa Exemplo", "valorRemuneracaoBruta": "1.200,50"}
        resposta = {"totalHits": 2, "hits": [{"id": "a", "sourceAsMap": row}, {"id": "b", "sourceAsMap": row}]}
        with patch.object(col.betha, "_api", return_value=resposta):
            rows = col.baixar_mes("token", "portal", 1, "08/2026")
        self.assertEqual([r["id_registro"] for r in rows], ["a", "b"])

    def test_rejeita_ids_repetidos_e_resposta_truncada(self):
        for ids in (["a", "a"], ["a"]):
            resposta = {"totalHits": 2, "hits": [{"id": i, "sourceAsMap": {}} for i in ids]}
            with patch.object(col.betha, "_api", return_value=resposta), self.assertRaises(ValueError):
                col.baixar_mes("token", "portal", 1, "08/2026")

    def test_mes_incorreto_nao_e_arquivado(self):
        rows = [{"competencia": "07/2026"}] * 20
        with self.assertRaisesRegex(ValueError, "diferente"):
            col.normalizar_mes(rows, "camara", "08/2026")

    def test_normalizacao_preserva_mes_identidade_e_centavos(self):
        rows = [{"id_registro": str(i), "nomeServidor": "Pessoa", "valorRemuneracaoBruta": "1.200,50"} for i in range(20)]
        resultado = col.normalizar_mes(rows, "camara", "08/2026")
        self.assertEqual(resultado["resumo"]["folha_bruta_total"], 24010)
        self.assertEqual(resultado["servidores"][0]["competencia"], "08/2026")
        self.assertEqual(resultado["servidores"][0]["id_registro"], "0")

    def test_arquivo_atual_preserva_meses_anteriores_sem_rede(self):
        with tempfile.TemporaryDirectory() as pasta, patch.object(col, "CHUNKS", Path(pasta)), patch.object(col.betha, "get_token") as token:
            antigos = {"schema_version": 1, "competencia": "01/2026", "camara": {"servidores": [{"competencia": "01/2026"}]}}
            col.gravar(col.CHUNKS / "pessoal_folha_2026_01.json", antigos)
            atual = {"camara": {"competencia": "02/2026", "servidores": [{"competencia": "02/2026"}] * 20}}
            col.gravar(col.CHUNKS / "pessoal.json", atual)
            col.coletar(2027, somente_atual=True)
            indice = col.ler(col.CHUNKS / "pessoal_historico.json")
            self.assertEqual([e["competencia"] for e in indice["competencias"]], ["01/2026", "02/2026"])
            self.assertEqual(col.ler(col.CHUNKS / "pessoal_folha_2026_01.json"), antigos)
            token.assert_not_called()


if __name__ == "__main__":
    unittest.main()
