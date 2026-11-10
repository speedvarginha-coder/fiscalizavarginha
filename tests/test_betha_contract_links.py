import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "painel-cidadao"))
import coletor
import coletor_betha


class ContractLinks(unittest.TestCase):
    def test_csv_recupera_ficha_unica_sem_alterar_valor(self):
        contrato = {"numero":"5","ano":"2026","contratado":"RONALDO MENDES","data_assinatura":"2026-03-09","objeto":"Serviços de áudio","valor":164025}
        ficha = dict(contrato, fonte_url="https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324812/detalhe/133849:9918:1159_9918", valor=10)
        with patch.object(coletor, "_load_existing", return_value={"contratos":[ficha]}):
            coletor._vincula_fichas_contratos([contrato], "camara")
        self.assertEqual(contrato["fonte_url"], ficha["fonte_url"])
        self.assertEqual(contrato["valor"], 164025)

    def test_csv_ambiguo_ou_de_outro_orgao_nao_inventa_ficha(self):
        contrato = {"numero":"5","ano":"2026","contratado":"RONALDO MENDES","data_assinatura":"2026-03-09","objeto":"Serviços de áudio"}
        prefixo="https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324812/detalhe/"
        fichas = [dict(contrato,fonte_url=prefixo+id_) for id_ in ("1","2")]
        with patch.object(coletor, "_load_existing", return_value={"contratos":fichas}):
            coletor._vincula_fichas_contratos([contrato], "camara")
            self.assertNotIn("fonte_url", contrato)
            coletor._vincula_fichas_contratos([contrato], "prefeitura")
            self.assertNotIn("fonte_url", contrato)
    def test_falha_no_historico_preserva_fichas_e_data_anterior(self):
        anterior = {"contratos_fontes": [{"numero": "11", "ano": "2024"}],
                    "contratos_fontes_verificado_em": "2026-10-06", "licitacoes": []}
        with patch.object(coletor_betha, "get_token", return_value="token"), \
             patch.object(coletor_betha, "todos_credores_generico", return_value=[]), \
             patch.object(coletor_betha, "baixar_dados_abertos", return_value={"main": []}), \
             patch.object(coletor_betha, "baixar_busca_textual", side_effect=TimeoutError), \
             patch.object(coletor, "_load_existing", return_value=anterior), \
             patch.object(coletor, "_load_last_nonempty_list", return_value=([{ "numero": "5" }], "backup")):
            resultado = coletor._processa_camara_betha()
        self.assertEqual(resultado["contratos_fontes"], anterior["contratos_fontes"])
        self.assertEqual(resultado["contratos_fontes_verificado_em"], "2026-10-06")
        self.assertEqual(resultado["contratos_fontes_status"], "preservado")

    def test_identificador_oficial_chega_ao_contrato(self):
        hit = {"id": "133849:9918:1159_9918", "sourceAsMap": {
            "numero": "5", "ano": "2026", "nomeContratado": "RONALDO MENDES"}}
        with patch.object(coletor_betha, "_api", return_value={"totalHits": 1, "hits": [hit]}):
            rows = coletor_betha.baixar_busca_textual(
                "token", 324812, portal_hash="-iAWLe1kr2VQcrW9k2AUBg==")
        contrato = coletor._normaliza_contratos(rows)[0]
        self.assertEqual(contrato["fonte_url"],
            "https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324812/detalhe/133849:9918:1159_9918")
        self.assertNotIn("fonte_url", hit["sourceAsMap"])

    def test_sem_id_nao_inventa_ficha(self):
        self.assertNotIn("fonte_url", coletor._normaliza_contratos([{"numero": "5"}])[0])

    def test_ficha_prefeitura_usa_portal_e_consulta_corretos(self):
        hit = {"id": "133849:9916:9736_9916", "sourceAsMap": {"numero": "1"}}
        with patch.object(coletor_betha, "_api", return_value={"totalHits": 1, "hits": [hit]}):
            rows = coletor_betha.baixar_busca_textual("token", 83043)
        self.assertEqual(coletor._normaliza_contratos(rows)[0]["fonte_url"],
            "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043/detalhe/133849:9916:9736_9916")

    def test_ids_diferentes_nao_escondem_registros_repetidos(self):
        hits = [{"id": id_, "sourceAsMap": {"numero": "5"}} for id_ in ["a", "b"]]
        with patch.object(coletor_betha, "_api", return_value={"totalHits": 2, "hits": hits}):
            with self.assertRaises(coletor_betha.BethaExportError):
                coletor_betha.baixar_busca_textual("token", 324812)
