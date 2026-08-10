# -*- coding: utf-8 -*-
import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "painel-cidadao" / "emendas" / "coletor_emendas_estaduais.py"
SPEC = importlib.util.spec_from_file_location("coletor_emendas_estaduais", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


HEADERS = [
    "Ano da Indicação", "Número da Indicação", "Indicador de Impositividade",
    "Tipo de Indicação", "Status da Indicação", "Autor", "Genêro", "Categoria",
    "Especificação", "Tipo de Aplicação", "Unidade Orçamentária Código",
    "Unidade Orçamentária Sigla", "Unidade Orçamentária Descrição", "Função Código",
    "Função Descrição", "Número da Ação", "Nome da Ação", "Grupo de Despesa Código",
    "Grupo de Despesa Descrição", "Código IBGE do Município", "Município",
    "Descrição do Tipo de Beneficiário", "Nome Beneficiário",
    "Número do CNPJ do Beneficiário", "Código Escola", "Minímo Saúde ou Educação",
    "Descrição da Indicação", "Valor Indicado", "Valor Utilizado",
    "Valor Empenhado no Ano", "Valor Liquidado no Ano", "Valor Liquidado Atualizado",
    "Valor Pago no Ano", "Valor Pago Atualizado", "Valor Executado",
    "Valor Inscrito em Restos a Pagar", "Saldo Restos a Pagar", "Classificação do IOT",
    "Justificativa de Reprovação", "Status", "Número do Instrumento",
    "Status do Instrumento", "Código SIAFI do Instrumento",
    "Data de Publicação do Instrumento", "Data de Validade do Instrumento",
    "Agência", "Agência Dígito", "Conta", "Conta Dígito",
]
INDEX = {MODULE.normalizar_chave(value): index for index, value in enumerate(HEADERS)}


def row(**overrides):
    values = [None] * len(HEADERS)
    base = {
        "Ano da Indicação": 2026,
        "Número da Indicação": 205897,
        "Indicador de Impositividade": "S",
        "Tipo de Indicação": "EXECUÇÃO DIRETA",
        "Status da Indicação": "APROVADO",
        "Autor": "CHIARA BIONDINI",
        "Código IBGE do Município": 3170701,
        "Município": "VARGINHA",
        "Nome Beneficiário": "9º BBM",
        "Número do CNPJ do Beneficiário": "03.389.126/0001-98",
        "Descrição da Indicação": "Aquisição de equipamentos",
        "Valor Indicado": 180000,
        "Valor Utilizado": 180000,
        "Valor Empenhado no Ano": 0,
        "Valor Liquidado no Ano": 0,
        "Valor Liquidado Atualizado": 0,
        "Valor Pago no Ano": 0,
        "Valor Pago Atualizado": 0,
        "Valor Executado": 0,
        "Status": "Aprovado",
    }
    base.update(overrides)
    for name, value in base.items():
        values[INDEX[MODULE.normalizar_chave(name)]] = value
    return tuple(values)


class StateAmendmentsCollectorTests(unittest.TestCase):
    def normalize(self, values):
        return MODULE.normalizar_linha(
            values,
            INDEX,
            "https://www.emendas.mg.gov.br/dados.xlsx",
            "a" * 64,
            "2026-07-29T12:00:00-03:00",
            "12-05",
            10,
        )

    def test_filters_exact_ibge(self):
        self.assertIsNone(self.normalize(row(**{"Código IBGE do Município": 3163102})))

    def test_used_value_is_not_promoted_to_payment(self):
        record = self.normalize(row())
        self.assertEqual(record["valorUtilizado"], 180000)
        self.assertEqual(record["valorPago"], 0)
        self.assertEqual(record["estagioAtual"], "utilizado")
        self.assertFalse(record["identificador_repasse_confirmado"])

    def test_official_paid_stage_remains_separate(self):
        record = self.normalize(row(**{
            "Valor Empenhado no Ano": 180000,
            "Valor Liquidado Atualizado": 180000,
            "Valor Pago Atualizado": 120000,
            "Status": "Pago Parcial",
        }))
        self.assertEqual(record["valorIndicado"], 180000)
        self.assertEqual(record["valorEmpenhado"], 180000)
        self.assertEqual(record["valorLiquidado"], 180000)
        self.assertEqual(record["valorPago"], 120000)
        self.assertEqual(record["estagioAtual"], "pago")

    def test_rejected_record_is_not_approved(self):
        record = self.normalize(row(**{
            "Status da Indicação": "REPROVADO PELO ÓRGÃO",
            "Status": "Reprovado",
            "Justificativa de Reprovação": "Documentação incompleta",
            "Valor Utilizado": 0,
        }))
        self.assertEqual(record["aprovado"], "Não")
        self.assertEqual(record["estagioAtual"], "reprovada")
        self.assertEqual(record["justificativaReprovacao"], "Documentação incompleta")


if __name__ == "__main__":
    unittest.main()
