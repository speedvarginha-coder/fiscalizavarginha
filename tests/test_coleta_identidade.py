# -*- coding: utf-8 -*-
"""Registros sem identidade nao podem chegar ao painel.

Em out/2026 a exportacao CSV da Betha passou a trazer rotulos em portugues
("Credor", "Valor R$", "Placa do veiculo"). Os normalizadores liam as chaves
camelCase da busca textual, geravam linhas vazias e a coleta saia "ok":
129.619 diarias e 271.565 veiculos sem identidade foram publicados.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "painel-cidadao"))

import coletor  # noqa: E402
import coletor_betha  # noqa: E402

# Cabecalhos reais das exportacoes de 02/10/2026.
CSV_DIARIAS_CAMARA = (
    "ano;Nome da entidade;Credor;CNPJ/CPF credor;Cargo do credor;Matrícula credor;"
    "Número;Quantidade;Valor unitário R$;Valor R$;Data inicial;Data final;Período;"
    "Finalidade;Fundamento legal;Local de origem;Local de destino;Veículo;"
    "Tipo do veículo;Custo veículo R$;Placa do veículo;Histórico\n"
    "2026;CAMARA MUNICIPAL DE VARGINHA;VEREADOR EXEMPLO;011.383.***-**;VEREADOR;509;"
    "3;0.5;600;300;2026-02-11;2026-02-11;11-02-2026 a 11-02-2026;VISITA INSTITUCIONAL;"
    "LEI;VARGINHA;BELO HORIZONTE;;;0;;HISTORICO\n"
).encode("utf-8")

CSV_FROTA = (
    "Placa do veículo;Tipo de veículo;Descrição do veículo;Ano de fabricação;"
    "Ano do modelo;Data de aquisição;Tipo de aquisição;Valor de aquisição R$;"
    "Centro de custos do veículo;Situação atual;Renavam;Chassi\n"
    "RGC6J54;Automóvel;FIAT MOBI;2021;2021;2022-04-25;LOCADO;0;"
    "FUNDO MUNICIPAL DE SAUDE;INATIVO;01247688752;9BD341ACXMY707747\n"
).encode("utf-8")

CSV_DIARIAS_PREFEITURA_SEM_CREDOR = (
    "Nome da entidade;Ano de exercício;Data do empenho;Número do empenho;Valor pago R$\n"
    "PREFEITURA MUNICIPAL VARGINHA;2026;2026-01-30;1227;128.88\n"
).encode("utf-8")


class ExportacaoCsvTests(unittest.TestCase):
    def test_csv_de_diarias_da_camara_vira_diaria_identificada(self):
        rows = coletor_betha._parse_export(CSV_DIARIAS_CAMARA, 324755)["main"]
        diarias = coletor._normaliza_diarias_camara(rows)
        self.assertEqual(len(diarias), 1)
        d = diarias[0]
        self.assertEqual(d["funcionario"], "VEREADOR EXEMPLO")
        self.assertEqual(d["valor_total"], 300.0)
        self.assertEqual(d["data_inicial"], "2026-02-11")
        self.assertEqual(d["destino"], "BELO HORIZONTE")
        self.assertEqual(d["ano"], "2026")

    def test_csv_de_frota_vira_veiculo_com_placa(self):
        rows = coletor_betha._parse_export(CSV_FROTA, 83061)["main"]
        frota = coletor._normaliza_frota(rows, {}, {})
        self.assertEqual(len(frota), 1)
        self.assertEqual(frota[0]["placa"], "RGC6J54")
        self.assertEqual(frota[0]["descricao"], "FIAT MOBI")
        self.assertEqual(frota[0]["centro_custo"], "FUNDO MUNICIPAL DE SAUDE")

    def test_aliases_de_uma_consulta_nao_vazam_para_contratos(self):
        csv = "Número;Credor\n7;EMPRESA\n".encode("utf-8")
        rows = coletor_betha._parse_export(csv, coletor_betha.CONSULTA_CONTRATOS)["main"]
        self.assertNotIn("numeroDiaria", rows[0])

    def test_exportacao_sem_credor_cai_para_busca_textual(self):
        # O CSV de diarias da Prefeitura nao traz o beneficiario.
        textual = [{"credor": {"nomeCredor": "SERVIDOR"}, "valorPagoEmpenho": 10,
                    "anoExercicio": "2026"}]
        with patch.object(coletor_betha, "_dados_abertos_sem_token", return_value="csv"), \
                patch.object(coletor_betha, "_decode_export_payload",
                             return_value=(CSV_DIARIAS_PREFEITURA_SEM_CREDOR, "url", None)), \
                patch.object(coletor_betha, "get_token", return_value="token"), \
                patch.object(coletor_betha, "baixar_busca_textual", return_value=textual) as busca:
            res = coletor_betha.baixar_dados_abertos(
                "token", coletor_betha.CONSULTA_DIARIAS, ano=2026,
                text_fallback_is_complete=True,
            )
        busca.assert_called_once()
        self.assertEqual(res["main"], textual)
        self.assertEqual(res["coleta_modo"], "busca-textual-completa")


class NormalizadoresTests(unittest.TestCase):
    def test_linha_sem_beneficiario_nao_vira_diaria(self):
        self.assertEqual(coletor._normaliza_diarias_prefeitura([{"Credor": "X"}], {}), [])
        self.assertEqual(coletor._normaliza_diarias_camara([{"Credor": "X"}]), [])

    def test_coluna_desconhecida_nao_vira_veiculo(self):
        self.assertEqual(coletor._normaliza_frota([{"coluna_desconhecida": "valor"}], {}, {}), [])

    def test_pagamento_zero_explicito_nao_vira_valor_empenhado(self):
        rows = [{"credor": {"nomeCredor": "S"}, "valorPagoEmpenho": 0,
                 "valorEmpenho": 1000, "anoExercicio": "2026"}]
        self.assertEqual(coletor._normaliza_diarias_prefeitura(rows, {})[0]["valor_total"], 0.0)

    def test_pagamento_ausente_usa_empenho(self):
        rows = [{"credor": {"nomeCredor": "S"}, "valorEmpenho": 1000, "anoExercicio": "2026"}]
        self.assertEqual(coletor._normaliza_diarias_prefeitura(rows, {})[0]["valor_total"], 1000.0)

    def test_resposta_irreconhecivel_reprova_o_exercicio(self):
        with self.assertRaises(ValueError):
            coletor._exigir_identificaveis([{"a": 1}] * 10, [])
        coletor._exigir_identificaveis([{"a": 1}] * 10, [{}] * 10)
        coletor._exigir_identificaveis([], [])


class ReconciliacaoSemIdentidadeTests(unittest.TestCase):
    def test_linhas_sem_ano_ou_sem_beneficiario_nao_sao_preservadas(self):
        vazias = [{"ano": "", "funcionario": "", "valor_total": 0}] * 50
        sem_nome = [{"ano": "2026", "funcionario": "", "valor_total": 0}] * 5
        boas = [{"ano": "2025", "funcionario": "A", "valor_total": 10}]
        resultado, _ = coletor._reconciliar_diarias_por_exercicio(
            [], vazias + sem_nome + boas, {"2026": {"status": "failed"}}
        )
        self.assertEqual(resultado, boas)


class BasePreservadaValidaTests(unittest.TestCase):
    def test_frota_sem_placa_nao_e_base_valida(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            data_dir = root / "painel-cidadao" / "data"
            valida = root / "private" / "backups" / "coleta-20260905-100000" / "data" / "chunks"
            (data_dir / "chunks").mkdir(parents=True)
            valida.mkdir(parents=True)
            (data_dir / "chunks" / "prefeitura.json").write_text(
                json.dumps({"frota": [{"placa": ""}] * 3}), encoding="utf-8"
            )
            (valida / "prefeitura.json").write_text(
                json.dumps({"frota": [{"placa": "ABC1234"}]}), encoding="utf-8"
            )
            with patch.object(coletor, "DATA", data_dir):
                rows, origem = coletor._load_last_nonempty_list(
                    "prefeitura.json", "frota",
                    valido=lambda lista: any(v.get("placa") for v in lista),
                )
        self.assertEqual(rows, [{"placa": "ABC1234"}])
        self.assertIn("coleta-20260905-100000", origem)


class FundacaoFalhaDeDownloadTests(unittest.TestCase):
    def test_timeout_nos_contratos_preserva_a_base_anterior(self):
        anteriores = [{"numero": "12", "ano": "2026", "valor": 500.0, "situacao": "EXECUCAO"}]

        def busca(_token, consulta_id, **_kwargs):
            if consulta_id == coletor.CONSULTA_FUNDACAO_CONTRATOS:
                raise TimeoutError("The read operation timed out")
            return []

        with patch.object(coletor_betha, "get_token", return_value="token"), \
                patch.object(coletor_betha, "baixar_busca_textual", side_effect=busca), \
                patch.object(coletor, "_load_existing", return_value={
                    "contratos": anteriores, "contratos_vigentes": anteriores,
                    "contratos_futuros": [], "contratos_resumo": {"qtd_total": 1}}):
            result = coletor._processa_fundacao_cultural()

        self.assertEqual(result["contratos"], anteriores)
        self.assertEqual(result["contratos_vigentes"], anteriores)
        # Consulta que respondeu vazia de verdade continua vazia.
        self.assertEqual(result["dispensas"], [])


class PreservacaoRegressaoTests(unittest.TestCase):
    def fundacao(self, anterior, falhar):
        def busca(_token, consulta, **kwargs):
            if consulta in falhar:
                raise TimeoutError("simulado")
            return []
        with patch.object(coletor_betha, "get_token", return_value="token"), \
             patch.object(coletor_betha, "baixar_busca_textual", side_effect=busca), \
             patch.object(coletor, "_load_existing", return_value=anterior):
            return coletor._processa_fundacao_cultural()

    def test_fundacao_preserva_cada_conjunto_sem_rejuvenescer(self):
        grupos = {
            "despesas": coletor.CONSULTA_FUNDACAO_DESPESAS_CREDOR,
            "execucao": coletor.CONSULTA_FUNDACAO_EXEC_DETALHADA,
            "diarias": coletor.CONSULTA_FUNDACAO_DIARIAS_DET,
            "pessoal": coletor.CONSULTA_FUNDACAO_SERVIDORES_ATIVOS,
            "transferencias": coletor.CONSULTA_FUNDACAO_TRANSFERENCIAS,
        }
        for campo, consulta in grupos.items():
            with self.subTest(campo=campo):
                anterior = {campo: {"valor": 123}, "coleta_frescor": {"datasets": {
                    campo: {"last_complete_at": "2026-09-01T00:00:00Z"}}}}
                result = self.fundacao(anterior, {consulta})
                self.assertEqual(result[campo], anterior[campo])
                meta = result["coleta_frescor"]["datasets"][campo]
                self.assertEqual(meta["last_complete_at"], "2026-09-01T00:00:00Z")
                self.assertEqual(meta["status"], "preservado_por_falha")
                self.assertEqual(result["coleta_status"], "partial")
                self.assertEqual(result["contratos"], [])  # consulta bem-sucedida vazia

    def test_fundacao_falha_sem_base_nao_publica_zero(self):
        with self.assertRaisesRegex(ValueError, "gravação bloqueada"):
            self.fundacao({}, {coletor.CONSULTA_FUNDACAO_DIARIAS_DET})

    def test_fundacao_zero_confirmado_substitui_base(self):
        result = self.fundacao({"pessoal": {"servidores": [{"nome": "Anterior"}]}}, set())
        self.assertEqual(result["pessoal"]["servidores"], [])
        self.assertEqual(result["coleta_status"], "ok")

    def test_fundacao_nao_reclassifica_base_de_outro_exercicio(self):
        with self.assertRaisesRegex(ValueError, "mudança de exercício"):
            self.fundacao({"ano_atual": 2000}, {coletor.CONSULTA_FUNDACAO_DIARIAS_DET})

    def test_contratos_parciais_acima_do_piso_antigo(self):
        novos = [{"numero": str(i), "ano": "2026"} for i in range(300)]
        anteriores = novos + [{"numero": "perdido", "ano": "2025", "entidade": "Prefeitura"}]
        ok = [{"status": "ok"}] * 9
        self.assertTrue(coletor._contratos_incompletos(novos, anteriores, ok, 9, "2026-10-03"))
        self.assertTrue(coletor._contratos_incompletos(novos, novos, ok[:8], 9, "2026-10-03"))
        self.assertTrue(coletor._contratos_incompletos(novos, novos, ok[:8] + [{"status": "partial"}], 9, "2026-10-03"))
        self.assertFalse(coletor._contratos_incompletos(novos, novos, ok, 9, "2026-10-03"))

    def test_contratos_identidade_e_expiracao(self):
        base = {"numero": "1", "ano": "2022", "cnpj": "123", "entidade": "A", "data_fim": "2030-01-01"}
        outro = dict(base, entidade="B")
        self.assertTrue(coletor._contratos_incompletos([outro], [base], [{"status": "ok"}], 1, "2026-10-03"))
        vencido = dict(base, data_fim="2024-01-01", situacao="EXECUCAO")
        self.assertFalse(coletor._contratos_incompletos([], [vencido], [{"status": "ok"}], 1, "2026-10-03"))

    def test_camara_preserva_resposta_parcial_nao_vazia(self):
        anterior = [{"numero": "anterior", "ano": "2026", "valor": 123}]
        with patch.object(coletor_betha, "get_token", return_value="token"), \
             patch.object(coletor_betha, "todos_credores_generico", return_value=[]), \
             patch.object(coletor_betha, "baixar_dados_abertos", return_value={"main": [{"numero": "novo"}], "coleta_status": "partial"}), \
             patch.object(coletor_betha, "baixar_busca_textual", return_value=[]), \
             patch.object(coletor, "_load_last_nonempty_list", return_value=(anterior, "backup.json")), \
             patch.object(coletor, "_load_existing", return_value={"licitacoes": []}):
            result = coletor._processa_camara_betha()
        self.assertEqual(result["contratos"], anterior)
        self.assertEqual(result["contratos_status_coleta"], "preservada_por_resposta_betha_parcial")
        self.assertEqual(result["licitacoes_status_coleta"], "preservada_por_falha")

    def test_datas_invalidas_e_brasileiras(self):
        for data in [None, "-", "31/02/2026"]:
            self.assertTrue(coletor._contrato_vigente({"dataVigenciaFinal": data, "situacao": "EM EXECUÇÃO"}, "2026-10-03"))
        self.assertFalse(coletor._contrato_vigente({"dataVigenciaFinal": "01/01/2020", "situacao": "EXECUCAO"}, "2026-10-03"))
        r = coletor._normaliza_contratos([{"numero": "1", "dataAssinatura": "31/02/2026", "dataVigenciaFinal": "12/12/2037"}])[0]
        self.assertEqual(r["data_assinatura"], "")
        self.assertEqual(r["data_fim"], "2037-12-12")

    def test_paginacao_interrompida_ou_repetida_nao_passa(self):
        # Caminho de paginacao isolado: a requisicao unica e testada abaixo.
        with patch.object(coletor_betha, "_busca_textual_uma_requisicao", return_value=None):
            for respostas in [
                [{"totalHits": 3, "hits": [{"sourceAsMap": {"id": 1}}]}, {"totalHits": 3, "hits": []}],
                [{"totalHits": 2, "hits": [{"sourceAsMap": {"id": 1}}]}] * 2,
                [{"hits": []}],
            ]:
                with patch.object(coletor_betha, "_api", side_effect=respostas):
                    with self.assertRaises(coletor_betha.BethaExportError):
                        coletor_betha.baixar_busca_textual("token", 1, batch=1)
            with patch.object(coletor_betha, "_api", return_value={"totalHits": 0, "hits": []}):
                self.assertEqual(coletor_betha.baixar_busca_textual("token", 1), [])

    def test_requisicao_unica_so_vale_com_ids_e_conteudo_unicos(self):
        hits = [{"id": "a", "sourceAsMap": {"n": 1}}, {"id": "b", "sourceAsMap": {"n": 2}}]
        probe = {"totalHits": 2, "hits": hits[:1]}
        completo = {"totalHits": 2, "hits": hits}
        with patch.object(coletor_betha, "_api", side_effect=[probe, completo]) as api:
            self.assertEqual([r["n"] for r in coletor_betha.baixar_busca_textual("token", 1)], [1, 2])
            self.assertEqual(api.call_count, 2)
        # Requisicao unica incompleta cai para paginacao (aqui, sem mais respostas: erro explicito).
        parcial = {"totalHits": 2, "hits": hits[:1]}
        with patch.object(coletor_betha, "_api", side_effect=[probe, parcial, RuntimeError("fim")]):
            with self.assertRaises(RuntimeError):
                coletor_betha.baixar_busca_textual("token", 1)
        # Ids repetidos na requisicao unica nao passam.
        repetido = {"totalHits": 2, "hits": [hits[0], hits[0]]}
        with patch.object(coletor_betha, "_api", side_effect=[probe, repetido, RuntimeError("fim")]):
            with self.assertRaises(RuntimeError):
                coletor_betha.baixar_busca_textual("token", 1)


if __name__ == "__main__":
    unittest.main()
