import sys
import tempfile
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

    def test_diario_classifies_financial_nature_near_each_value(self):
        values = coletor_diario._extrai_valores(
            "Vencimento (R$): 5.710,22.\n"
            "Gratificação mensal no valor de R$ 3.711,64.\n"
            "Saldo Remanescente da Ata: R$ 24.526.528,79."
        )
        itens = {(item["valor"], item["natureza"]) for item in values["itens"]}
        self.assertIn((5710.22, "vencimento-base"), itens)
        self.assertIn((3711.64, "gratificação mensal"), itens)
        self.assertIn((24526528.79, "saldo remanescente da ata"), itens)
        self.assertIsNone(values["total"])

    def test_whatsapp_lists_multiple_values_without_inventing_total(self):
        pub = {
            "valores": {
                "total": None,
                "encontrados": [5710.22, 3711.64],
                "itens": [
                    {"valor": 5710.22, "natureza": "vencimento-base", "pagina": 2},
                    {"valor": 3711.64, "natureza": "gratificação mensal", "pagina": 2},
                ],
            },
            "resumo": "Vencimento de R$ 5.710,22 e gratificação de R$ 3.711,64.",
        }
        bloco = whatsapp.bloco_valor_publicacao(pub, "prefeitura")
        self.assertIn("Vencimento-base: R$ 5.710,22", bloco)
        self.assertIn("Gratificação mensal: R$ 3.711,64", bloco)
        self.assertIn("não calculado automaticamente", bloco)
        self.assertNotIn("R$ 9.421,86", bloco)
        self.assertIsNone(whatsapp.resolver_valor_publicacao(pub, "prefeitura"))

    def test_pre_send_audit_blocks_company_on_personnel_act(self):
        resultado = whatsapp.auditar_publicacao_pre_envio({
            "id": "DIARIO-TESTE",
            "tipo": "pessoal",
            "titulo": "PORTARIA Nº 1/2026",
            "orgao": "Prefeitura de Varginha",
            "envolvidos": [{"nome": "EMPRESA TESTE LTDA", "papel": "empresa"}],
            "valores": {"total": None, "encontrados": []},
            "qualidade": {"segmentacao_ok": True},
        })
        self.assertFalse(resultado["ok"])
        self.assertIn("ato de pessoal associado a empresa", resultado["erros"][0])

    def test_pre_send_audit_blocks_value_absent_from_official_literals(self):
        resultado = whatsapp.auditar_publicacao_pre_envio({
            "id": "DIARIO-TESTE",
            "tipo": "contrato",
            "titulo": "EXTRATO DE CONTRATO",
            "orgao": "Prefeitura de Varginha",
            "envolvidos": [],
            "valores": {"total": 9999.0, "encontrados": [1000.0]},
            "qualidade": {"segmentacao_ok": True},
        })
        self.assertFalse(resultado["ok"])
        self.assertIn("não aparece", resultado["erros"][0])

    def test_pre_send_audit_blocks_value_when_no_official_literal_exists(self):
        resultado = whatsapp.auditar_publicacao_pre_envio({
            "id": "DIARIO-TESTE",
            "tipo": "contrato",
            "titulo": "EXTRATO DE CONTRATO",
            "orgao": "Prefeitura de Varginha",
            "envolvidos": [],
            "valores": {"total": 9999.0, "encontrados": []},
            "qualidade": {"segmentacao_ok": True},
        })
        self.assertFalse(resultado["ok"])
        self.assertIn("não aparece", resultado["erros"][0])

    def test_pre_send_audit_blocks_institutional_contradiction(self):
        resultado = whatsapp.auditar_publicacao_pre_envio({
            "id": "DIARIO-TESTE",
            "tipo": "aditivo",
            "titulo": "TERMO ADITIVO",
            "orgao": "CISSUL/SAMU",
            "resumo": "A Prefeitura de Varginha prorrogou o contrato.",
            "envolvidos": [],
            "valores": {"total": None, "encontrados": []},
            "qualidade": {"segmentacao_ok": True},
        })
        self.assertFalse(resultado["ok"])
        self.assertIn("órgão divergente", resultado["erros"][0])

    def test_large_queue_requires_explicit_one_run_approval(self):
        config = {
            "exigir_aprovacao_fila_grande": True,
            "limite_fila_sem_aprovacao": 15,
        }
        self.assertFalse(whatsapp.fila_exige_aprovacao(15, config, False))
        self.assertTrue(whatsapp.fila_exige_aprovacao(16, config, False))
        self.assertFalse(whatsapp.fila_exige_aprovacao(40, config, True))

    def test_publication_cursor_excludes_cutoff_day_and_keeps_later_items(self):
        cursor = {"chave_ordem": ["2026-07-22", 99, "\uffff", "\uffff"]}
        self.assertFalse(
            whatsapp.depois_do_cursor(("2026-07-22", 0, "ATO", "id-22"), cursor)
        )
        self.assertTrue(
            whatsapp.depois_do_cursor(("2026-07-23", 0, "ATO", "id-23"), cursor)
        )

    def test_publication_cursor_is_written_atomically(self):
        with tempfile.TemporaryDirectory() as pasta:
            destino = Path(pasta) / "cursor.json"
            with patch.object(whatsapp, "PUBLICATION_CURSOR_PATH", destino):
                whatsapp.definir_cursor_por_data("2026-07-22")
                cursor = whatsapp.carregar_cursor_publicacao()
            self.assertEqual(cursor["ultimo_id"], "fim-do-dia-2026-07-22")
            self.assertEqual(cursor["origem"], "marco_manual_confirmado")
            self.assertEqual(cursor["chave_ordem"][0], "2026-07-22")
            self.assertFalse(destino.with_suffix(".tmp").exists())

    def test_public_message_hides_artificial_intelligence_references(self):
        mensagem = (
            "Fonte: texto oficial do Diário, selecionado pela IA.\n"
            "Análise feita pela IA e inteligência artificial."
        )
        limpa = whatsapp.sanitizar_mencoes_tecnologia(mensagem)
        self.assertNotRegex(limpa.lower(), r"\bia\b|intelig[êe]ncia artificial")
        self.assertIn("texto oficial do Diário", limpa)
        self.assertIn("dados oficiais", limpa)

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

    def test_diario_separates_unnumbered_aditivo_header_from_previous_portaria(self):
        texto = (
            "PORTARIA Nº 133/2026, 22 DE JULHO DE 2026.\n"
            "Designa empregada para substituição temporária.\n"
            "EXTRATO DE PUBLICAÇÃO - 4º TERMO ADITIVO AO CONTRATO Nº 029/2023 - PROCESSO Nº 079/2023\n"
            "Contratado: TUPÃ COMUNICAÇÃO E MARKETING LTDA\n"
            "Valor aditivado: R$ 135.000,00\n"
        )
        atos = coletor_diario._segmentar(texto)
        self.assertEqual([ato[0] for ato in atos], ["pessoal", "aditivo"])
        self.assertNotIn("R$ 135.000,00", atos[0][3])
        self.assertIn("R$ 135.000,00", atos[1][3])

    def test_diario_preserves_consecutive_generic_aditivos_as_distinct_acts(self):
        texto = (
            "PORTARIA Nº 292, DE 23 DE JULHO DE 2026.\n"
            "Prorroga prazo de sindicância.\n"
            "EXTRATO DE TERMO ADITIVO DE CONTRATO\n"
            "Aditivo n°: 09/2026 – Datado de 17/07/2026.\n"
            "Objeto: Repactuação contratual.\n"
            "Valor: R$ 7.605,81.\n"
            "EXTRATO DE TERMO ADITIVO DE CONTRATO\n"
            "Aditivo n°: 10/2026 – Datado de 17/07/2026.\n"
            "Objeto: Prorrogação do prazo contratual.\n"
        )
        atos = coletor_diario._segmentar(texto)
        self.assertEqual([ato[0] for ato in atos], ["pessoal", "aditivo", "aditivo"])
        self.assertIn("09/2026", atos[1][2])
        self.assertIn("10/2026", atos[2][2])
        self.assertNotIn("R$ 7.605,81", atos[0][3])
        self.assertNotIn("10/2026", atos[1][3])

    def test_diario_separates_other_strong_unnumbered_extract_headers(self):
        texto = (
            "PORTARIA Nº 23.276, DE 20 DE JULHO DE 2026.\n"
            "Designa servidor municipal.\n"
            "EXTRATO DE CONTRATO\n"
            "Contrato: 074/2026. Datado de 18/06/2026.\n"
            "Valor: R$ 325.000,00.\n"
            "EXTRATO DE TERMO DE FOMENTO\n"
            "Termo de Fomento: 099/2026. Datado de 21/07/2026.\n"
            "Valor: R$ 102.000,00.\n"
            "EXTRATO DE PUBLICAÇÃO - TERMO DE RESCISÃO AO CONTRATO Nº 189/2026\n"
            "Valor rescindido: R$ 2.060,00.\n"
        )
        atos = coletor_diario._segmentar(texto)
        self.assertEqual(len(atos), 4)
        self.assertEqual([ato[0] for ato in atos], ["pessoal", "contrato", "outro", "contrato"])
        self.assertNotIn("R$ 325.000,00", atos[0][3])
        self.assertIn("074/2026", atos[1][2])
        self.assertIn("099/2026", atos[2][2])
        self.assertIn("R$ 2.060,00", atos[3][3])

    def test_diario_does_not_classify_authority_and_next_agency_as_company(self):
        texto = (
            "JUCILENE APARECIDA DA SILVA\n"
            "Corregedora da Guarda Civil Municipal\n"
            "INSTITUTO DE PREVIDÊNCIA DOS SERVIDORES PÚBLICOS"
        )
        self.assertEqual(coletor_diario._extrai_envolvidos(texto), [])

    def test_diario_separates_dash_style_procurement_notices_from_portaria(self):
        texto = (
            "PORTARIA Nº 23.276, DE 20 DE JULHO DE 2026.\n"
            "Nomeia servidores em caráter efetivo.\n"
            "AVISO - PREGÃO ELETRÔNICO Nº 082 / 2026 - PROCESSO Nº 191 / 2026\n"
            "Contratação de serviços técnicos.\n"
            "AVISO SUSPENSÃO - “SINE DIE” - PREGÃO ELETRÔNICO Nº 071 / 2026 - PROCESSO Nº 162 / 2026\n"
            "Suspende a sessão pública.\n"
        )
        atos = coletor_diario._segmentar(texto)
        self.assertEqual([ato[0] for ato in atos], ["pessoal", "licitacao", "licitacao"])
        self.assertNotIn("PREGÃO", atos[0][3])
        self.assertIn("082", atos[1][2])
        self.assertIn("071", atos[2][2])

    def test_diario_separates_homologations_and_non_financial_notices(self):
        texto = (
            "DISPENSA DE LICITAÇÃO Nº 053/2026.\n"
            "Valor: R$ 3.999,00.\n"
            "“HOMOLOGAÇÃO” - PROCESSO Nº 094/2026 - PREGÃO ELETRÔNICO Nº 048/2026\n"
            "Aquisição de tomógrafo por R$ 2.396.576,00.\n"
            "“HOMOLOGAÇÃO E ADJUDICAÇÃO” - PROCESSO Nº 099/2026 - PREGÃO ELETRÔNICO Nº 052/2026\n"
            "Serviços de telefonia por R$ 53.053,44.\n"
            "EDITAL DE INTIMAÇÃO\n"
            "Intima empresa em processo sancionatório.\n"
            "AVISO REDESIGNAÇÃO - PROCESSO Nº 081/2026 – PREGÃO ELETRÔNICO Nº 040/2026\n"
            "Redesigna a sessão pública.\n"
        )
        atos = coletor_diario._segmentar(texto)
        self.assertEqual(
            [ato[0] for ato in atos],
            ["dispensa", "licitacao", "licitacao", "outro", "licitacao"],
        )
        self.assertNotIn("2.396.576,00", atos[0][3])
        self.assertNotIn("53.053,44", atos[1][3])
        self.assertNotIn("REDESIGNAÇÃO", atos[2][3])

    def test_diario_separates_convocation_and_miscellaneous_sections(self):
        texto = (
            "EXTRATO DE TERMO DE FOMENTO\n"
            "Termo de Fomento: 099/2026. Valor: R$ 102.000,00.\n"
            "EDITAL DE CONVOCAÇÃO Nº. 035/2026\n"
            "Convoca candidato aprovado.\n"
            "NOTIFICAÇÃO DE PENDÊNCIA DE PRESTAÇÃO DE CONTAS\n"
            "Notifica agente cultural.\n"
            "ATA Nº 13 – REUNIÃO ORDINÁRIA DO CONSELHO MUNICIPAL\n"
            "Relato da reunião.\n"
            "EXTRATO DO PRIMEIRO TERMO ADITIVO À ATA DE REGISTRO DE PREÇOS Nº 10/2026\n"
            "Reequilíbrio econômico-financeiro.\n"
        )
        atos = coletor_diario._segmentar(texto)
        self.assertEqual([ato[0] for ato in atos], ["outro", "pessoal", "outro", "outro", "aditivo"])
        self.assertNotIn("EDITAL", atos[0][3])
        self.assertNotIn("NOTIFICAÇÃO", atos[1][3])
        self.assertNotIn("EXTRATO", atos[3][3])

    def test_diario_separates_plural_aditivos_section_from_contract(self):
        texto = (
            "EXTRATO DE CONTRATO\n"
            "Contrato: 074/2026. Valor: R$ 325.000,00.\n"
            "EXTRATOS DE TERMOS ADITIVOS\n"
            "Aditivo nº: 314/2026. Reajusta o valor contratual.\n"
            "Aditivo nº: 315/2026. Prorroga o prazo.\n"
        )
        atos = coletor_diario._segmentar(texto)
        self.assertEqual([ato[0] for ato in atos], ["contrato", "aditivo"])
        self.assertNotIn("314/2026", atos[0][3])
        self.assertIn("315/2026", atos[1][3])

    def test_diario_extracts_salary_when_currency_label_has_closing_parenthesis(self):
        valores = coletor_diario._extrai_valores(
            "Vencimento (R$): 7.786,96. Gratificação mensal de R$ 528,03."
        )
        self.assertIsNone(valores["total"])
        self.assertEqual(valores["encontrados"], [7786.96, 528.03])

    def test_diario_identifies_additional_public_bodies(self):
        self.assertEqual(
            coletor_diario._orgao_ato("Fundação Cultural do Município de Varginha"),
            "Fundação Cultural do Município de Varginha",
        )
        self.assertEqual(
            coletor_diario._orgao_ato("Instituto de Previdência dos Servidores Públicos - INPREV"),
            "INPREV",
        )
        self.assertEqual(
            coletor_diario._orgao_ato("Consórcio Intermunicipal Multifinalitário do Baixo Sapucaí"),
            "CIMBASP",
        )
        self.assertEqual(
            coletor_diario._orgao_ato(
                "DECRETO MUNICIPAL\nRegras do Poder Executivo.\n" + ("texto " * 100)
                + "CONSÓRCIO INTERMUNICIPAL DE SAÚDE - CISSUL"
            ),
            "Prefeitura de Varginha",
        )
        self.assertEqual(
            coletor_diario._orgao_ato(
                "Contrato do CISSUL. CNPJ: 13.985.869/0001-84.\n"
                "FUNDAÇÃO HOSPITALAR DO MUNICÍPIO DE VARGINHA"
            ),
            "CISSUL/SAMU",
        )

    def test_diario_aligns_ai_institution_with_strong_official_body(self):
        ia = {
            "resumo": "A Prefeitura de Varginha prorrogou o contrato.",
            "pontos_atencao": [
                "A despesa foi atribuída à Fundação Hospitalar do Município de Varginha/MG."
            ],
        }
        alinhado = coletor_diario._alinhar_orgao_texto_ia(ia, "CISSUL/SAMU")
        self.assertEqual(alinhado["resumo"], "A CISSUL/SAMU prorrogou o contrato.")
        self.assertIn("CISSUL/SAMU", alinhado["pontos_atencao"][0])
        self.assertNotIn("Fundação Hospitalar", alinhado["pontos_atencao"][0])

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
