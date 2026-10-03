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

        def anterior(_name, field, **_kwargs):
            return (anteriores, "backup.json") if field == "contratos" else ([], None)

        with patch.object(coletor_betha, "get_token", return_value="token"), \
                patch.object(coletor_betha, "baixar_busca_textual", side_effect=busca), \
                patch.object(coletor, "_load_last_nonempty_list", side_effect=anterior):
            result = coletor._processa_fundacao_cultural()

        self.assertEqual(result["contratos"], anteriores)
        self.assertEqual(result["contratos_vigentes"], anteriores)
        # Consulta que respondeu vazia de verdade continua vazia.
        self.assertEqual(result["dispensas"], [])


if __name__ == "__main__":
    unittest.main()
