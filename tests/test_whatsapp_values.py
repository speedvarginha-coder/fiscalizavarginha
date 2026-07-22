import sys
import unittest
from pathlib import Path
from unittest.mock import patch


PAINEL = Path(__file__).resolve().parents[1] / "painel-cidadao"
sys.path.insert(0, str(PAINEL))

import alertar_whatsapp as whatsapp
import coletor_diario
import coletor_publicacoes


class WhatsappValueQualityTests(unittest.TestCase):
    def setUp(self):
        self.base_original = whatsapp._base_financeira_cache

    def tearDown(self):
        whatsapp._base_financeira_cache = self.base_original

    def test_extracts_explicit_brl_without_thousand_separator(self):
        self.assertEqual(whatsapp.valores_do_texto("Valor de R$ 60000,00."), ["60000,00"])

    def test_structured_value_keeps_provenance_and_confidence(self):
        pub = {
            "valores": {
                "total": 19775.0,
                "natureza": "valor do aditivo",
                "fonte_total": "texto oficial do Diario",
                "confianca": "alta",
            }
        }
        value = whatsapp.resolver_valor_publicacao(pub, "prefeitura")
        self.assertEqual(value["valor"], 19775.0)
        self.assertEqual(value["fonte"], "texto oficial do Diario")
        self.assertEqual(value["confianca"], "alta")

    def test_crossing_requires_identifier_and_object_evidence(self):
        whatsapp._base_financeira_cache = [{
            "valor": 52000.0,
            "natureza": "valor homologado",
            "fonte": "PNCP - resultado da contratacao",
            "escopo": "prefeitura",
            "numero": "57",
            "ano": "2026",
            "modalidade": "dispensa",
            "objeto": "Manutencao preventiva e corretiva de veiculos pesados e maquinas",
            "cnpj": "12345678000199",
        }]
        pub = {
            "titulo": "Dispensa de licitacao n 57/2026",
            "resumo": "Contratacao para manutencao preventiva e corretiva de veiculos pesados e maquinas.",
            "envolvidos": [],
        }
        value = whatsapp.cruzar_valor_publicacao(pub, "prefeitura")
        self.assertIsNotNone(value)
        self.assertEqual(value["valor"], 52000.0)
        self.assertEqual(value["confianca"], "alta")

    def test_crossing_rejects_same_number_with_different_object(self):
        whatsapp._base_financeira_cache = [{
            "valor": 52000.0,
            "natureza": "valor homologado",
            "fonte": "PNCP",
            "escopo": "prefeitura",
            "numero": "57",
            "ano": "2026",
            "modalidade": "dispensa",
            "objeto": "Manutencao preventiva de veiculos pesados e maquinas",
            "cnpj": "",
        }]
        pub = {
            "titulo": "Dispensa de licitacao n 57/2026",
            "resumo": "Locacao de instrumentos hospitalares para procedimentos de urologia.",
            "envolvidos": [],
        }
        self.assertIsNone(whatsapp.cruzar_valor_publicacao(pub, "prefeitura"))

    def test_camara_message_explains_missing_value_without_calling_it_zero(self):
        whatsapp._base_financeira_cache = []
        pub = {
            "id": "CAMARA-2026-PLOE-1",
            "titulo": "Projeto de Lei 1/2026",
            "data": "2026-07-20",
            "interesse_publico": "alto",
            "resumo": "Abre credito adicional para a saude.",
            "o_que_propoe": "Altera o orcamento municipal.",
            "links": {},
        }
        config = {"filtrar_relevantes_apenas": True, "data_minima_envio": "2026-07-01"}
        messages = whatsapp.processar_camara([pub], config, set())
        self.assertEqual(len(messages), 1)
        self.assertIn("VALOR E PROVENIÊNCIA", messages[0][1])
        self.assertIn("não significa custo zero", messages[0][1])

    def test_camara_collector_never_accepts_ai_value_absent_from_official_summary(self):
        values = coletor_publicacoes._valores_publicacao(
            "A materia autoriza a abertura de credito.",
            {"valor_principal": "500.000,00"},
        )
        self.assertIsNone(values["total"])
        self.assertEqual(values["encontrados"], [])

    def test_camara_collector_selects_labeled_total_from_official_document(self):
        pagina_1 = "Apresentacao e justificativa do projeto."
        pagina_2 = "Subvencao no valor de R$ 7.492.138,42, paga em parcelas de R$ 1.000.000,00."
        values = coletor_publicacoes._valores_publicacao(
            "Concede subvencao social.",
            {"valor_principal": ""},
            pagina_1 + " " + pagina_2,
            "documento original no SAPL",
            [pagina_1, pagina_2],
            "https://sapl.example/projeto.pdf",
        )
        self.assertEqual(values["total"], 7492138.42)
        self.assertEqual(values["fonte_total"], "documento original no SAPL")
        self.assertEqual(values["confianca"], "media")
        self.assertEqual(values["pagina"], 2)
        self.assertEqual(values["link_verificacao"], "https://sapl.example/projeto.pdf#page=2")

        block = whatsapp.bloco_valor_publicacao({"valores": values}, "camara")
        self.assertIn("página 2", block)
        self.assertIn("#page=2", block)

        pub = {
            "id": "CAMARA-2026-PLOE-43",
            "titulo": "Projeto de Lei 43/2026",
            "data": "2026-07-20",
            "interesse_publico": "alto",
            "resumo": "Concede subvenção social.",
            "o_que_propoe": "Autoriza repasse de recursos.",
            "valores": values,
            "links": {
                "consulta": "https://sapl.example/materia/43",
                "inteiro_teor": "https://sapl.example/projeto.pdf",
            },
        }
        message = whatsapp.processar_camara(
            [pub],
            {"filtrar_relevantes_apenas": True, "data_minima_envio": "2026-07-01"},
            set(),
        )[0][1]
        self.assertIn(
            "Documento original (página 2): https://sapl.example/projeto.pdf#page=2",
            message,
        )

    def test_diario_with_multiple_values_does_not_guess_the_largest_as_principal(self):
        values = coletor_diario._extrai_valores("Valor A R$ 10.000,00 e valor B R$ 20.000,00")
        self.assertIsNone(values["total"])
        self.assertEqual(values["confianca"], "indisponivel")

    def test_diario_separates_portaria_resultado_dispensa_and_classificacao(self):
        texto = (
            "PORTARIA Nº 130/2026\nTexto da portaria.\n"
            "EXTRATO DE PUBLICAÇÃO DE RESULTADO - DISPENSA Nº 012/2026\n"
            "Coffee break no valor de R$ 30.000,00.\n\f\n"
            "CLASSIFICAÇÃO EDITAL DE SELEÇÃO SIMPLIFICADA - Nº 022/2026\n"
            "Lista de candidatos."
        )
        atos = coletor_diario._segmentar(texto)
        self.assertEqual(len(atos), 3)
        self.assertEqual([ato[4] for ato in atos], [1, 1, 2])
        self.assertNotIn("R$ 30.000,00", atos[0][3])
        self.assertIn("R$ 30.000,00", atos[1][3])

    def test_diario_ignores_internal_legal_references_and_repeated_annex_header(self):
        texto = (
            "LEI Nº 7.591 DE 30 DE JUNHO DE 2026.\nTexto principal.\n"
            "Lei nº 4.572/2006, citada no corpo.\n"
            "Decreto nº 8.812/2018, tambem citado.\n\f\n"
            "LEI Nº 7.591 DE 30 DE JUNHO DE 2026. - ANEXO I E II\nTabelas.\n"
            "PORTARIA Nº 23.229, DE 10 DE JULHO DE 2026.\nNovo ato."
        )
        atos = coletor_diario._segmentar(texto)
        self.assertEqual([ato[0] for ato in atos], ["norma", "pessoal"])
        self.assertIn("Lei nº 4.572/2006", atos[0][3])

    def test_diario_distinguishes_public_body_cnpj_from_supplier(self):
        texto = (
            "O CISSUL, CNPJ 13.985.869/0001-84, contratou OROM COMERCIO E SERVICOS "
            "DE ALIMENTACAO LTDA, CNPJ 26.111.000/0001-52, por R$ 30.000,00."
        )
        envolvidos = coletor_diario._extrai_envolvidos(texto)
        orgaos = [item for item in envolvidos if item.get("papel") == "orgao"]
        empresas = [item for item in envolvidos if item.get("papel") == "empresa"]
        self.assertEqual(orgaos[0]["nome"], "CISSUL/SAMU")
        self.assertEqual(orgaos[0]["cnpj"], "13.985.869/0001-84")
        self.assertEqual(empresas[0]["nome"], "OROM COMERCIO E SERVICOS DE ALIMENTACAO LTDA")
        self.assertEqual(empresas[0]["cnpj"], "26.111.000/0001-52")
        self.assertEqual(coletor_diario._orgao_ato(texto), "CISSUL/SAMU")

    def test_diario_keeps_distinct_numbered_acts_when_short_slugs_collide(self):
        pubs = [
            {"id": "DIARIO-X-editaldeconvocao", "edicao": "1", "titulo": "EDITAL 028", "numero": "028/2026"},
            {"id": "DIARIO-X-editaldeconvocao", "edicao": "1", "titulo": "EDITAL 029", "numero": "029/2026"},
            {"id": "DIARIO-X-editaldeconvocao", "edicao": "1", "titulo": "EDITAL 029", "numero": "029/2026"},
        ]
        resolvidas = coletor_diario._resolver_ids_colidentes(pubs)
        self.assertEqual(len(resolvidas), 2)
        self.assertEqual(resolvidas[0]["id"], "DIARIO-X-editaldeconvocao")
        self.assertEqual(resolvidas[1]["id"], "DIARIO-X-editaldeconvocao-0292026")

    def test_incremental_camara_reuses_unchanged_fallback_without_calling_ai(self):
        materia = {
            "tipo": 17,
            "numero": 99,
            "ano": 2026,
            "ementa": "AUTORIZA MEDIDA ADMINISTRATIVA SEM VALOR MONETARIO.",
            "data_apresentacao": "2026-07-20",
            "id": 999,
            "autores": [],
            "texto_original": "",
        }
        rotulo = coletor_publicacoes.TIPO_INFO[17][1]
        titulo = f"{rotulo} nº 99/2026"
        existente = {
            "id": "CAMARA-2026-PLOE-99",
            "tipo_label": rotulo,
            "titulo": titulo,
            "ementa": materia["ementa"],
            "autor": "Poder Executivo",
            "data": "2026-07-20",
            "fonte_hash": coletor_publicacoes._fonte_hash(
                rotulo, titulo, materia["ementa"], "Poder Executivo", "2026-07-20"
            ),
            "origem_ia": "fallback",
            "interesse_publico": "medio",
            "resumo": "Resumo existente.",
            "o_que_propoe": "",
            "por_que_acompanhar": [],
            "pontos_atencao": [],
            "gerado_em": "2026-07-20T00:00:00+00:00",
        }
        with patch.object(
            coletor_publicacoes.enriquecedor_ia,
            "enriquecer",
            side_effect=AssertionError("IA nao deveria ser chamada"),
        ):
            resultado = coletor_publicacoes._monta_publicacao(materia, {}, existente)
        self.assertEqual(resultado["resumo"], "Resumo existente.")
        self.assertEqual(resultado["gerado_em"], existente["gerado_em"])


if __name__ == "__main__":
    unittest.main()
