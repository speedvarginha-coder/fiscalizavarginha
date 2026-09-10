import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "painel-cidadao"))

import coletor_pncp  # noqa: E402


def compra(cnpj: str, controle: str) -> dict:
    return {
        "numeroControlePNCP": controle,
        "orgaoEntidade": {"cnpj": cnpj, "razaoSocial": "Orgao teste"},
        "anoCompra": 2026,
    }


def contrato(cnpj: str, controle: str) -> dict:
    return {
        "numeroControlePNCP": controle,
        "orgaoEntidade": {"cnpj": cnpj, "razaoSocial": "Orgao teste"},
        "anoContrato": 2026,
    }


class PncpQueryContractTests(unittest.TestCase):
    def test_procurements_use_required_modality_and_cnpj_parameter(self):
        calls = []

        def fake_query(path, params):
            calls.append((path, dict(params)))
            return [compra(params["cnpj"], f'{params["cnpj"]}-1-000001/2026')], ["url"]

        with patch.object(coletor_pncp, "_modalidades_ativas", return_value=([6], [])), \
                patch.object(coletor_pncp, "_query", side_effect=fake_query), \
                patch.object(coletor_pncp.time, "sleep"):
            rows, _meta, ok, details = coletor_pncp._coleta_compras(2026)

        self.assertTrue(ok)
        self.assertEqual(len(rows), 2)
        self.assertEqual(len(calls), 2)
        for path, params in calls:
            self.assertEqual(path, "/consulta/v1/contratacoes/publicacao")
            self.assertEqual(params["codigoModalidadeContratacao"], 6)
            self.assertIn("cnpj", params)
            self.assertNotIn("cnpjOrgao", params)
            self.assertNotIn("codigoMunicipioIbge", params)
        self.assertEqual(details["orgaos"]["prefeitura"]["status"], "ok")

    def test_contracts_are_queried_only_by_the_two_official_cnpjs(self):
        seen = []

        def fake_query(path, params):
            seen.append(dict(params))
            return [contrato(params["cnpjOrgao"], f'{params["cnpjOrgao"]}-2-000001/2026')], ["url"]

        with patch.object(coletor_pncp, "_query", side_effect=fake_query), \
                patch.object(coletor_pncp.time, "sleep"):
            rows, _meta, ok, _details = coletor_pncp._coleta_contratos(2026)

        self.assertTrue(ok)
        self.assertEqual(len(rows), 2)
        self.assertEqual(
            {item["cnpjOrgao"] for item in seen},
            {coletor_pncp.PREFEITURA_CNPJ, coletor_pncp.CAMARA_CNPJ},
        )
        self.assertTrue(all("codigoMunicipioIbge" not in item for item in seen))


class PncpNumerosDaCompraTests(unittest.TestCase):
    """Tres numeros diferentes descrevem o mesmo pregao.

    Conferido na API publica do PNCP em 10/09/2026, registro 241/2026 de
    Varginha (decoracao natalina, R$ 3.528.268,00):
        numeroCompra "104"      -> numero do edital, o que a Prefeitura divulga
        processo     "238/2026" -> numero do processo, o que a Betha devolve
        sequencialCompra 241    -> ordem interna do PNCP
    O painel guardava so o sequencial, entao quem procurava pelo edital
    104/2026 nao encontrava a licitacao.
    """

    def test_guarda_edital_processo_e_sequencial_separados(self):
        bruto = {
            "numeroControlePNCP": "18240119000105-1-000241/2026",
            "orgaoEntidade": {"cnpj": "18240119000105", "razaoSocial": "MUNICIPIO DE VARGINHA"},
            "anoCompra": 2026,
            "sequencialCompra": 241,
            "numeroCompra": "104",
            "processo": "238/2026",
            "objetoCompra": "Contratação de empresa especializada para a prestação de serviços de decoração natalina",
            "valorTotalEstimado": 3528268,
            "valorTotalHomologado": None,
            "linkSistemaOrigem": "https://www.portaldecompraspublicas.com.br/processos/MG/x",
            "dataEncerramentoProposta": "2026-09-08T08:30:00",
            "existeResultado": False,
        }
        r = coletor_pncp._normaliza_compra(bruto)
        self.assertEqual(r["numero_edital"], "104")
        self.assertEqual(r["processo"], "238/2026")
        self.assertEqual(r["sequencial"], 241)
        self.assertEqual(r["data_encerramento_proposta"], "2026-09-08T08:30:00")
        self.assertFalse(r["existe_resultado"])

    def test_campo_ausente_vira_string_vazia_e_nunca_o_texto_None(self):
        r = coletor_pncp._normaliza_compra({"numeroControlePNCP": "x", "anoCompra": 2026})
        for campo in ("numero_edital", "processo", "link_origem", "data_encerramento_proposta"):
            self.assertEqual(r[campo], "", f"{campo} deveria ser vazio")


class PncpPreservationTests(unittest.TestCase):
    def test_partial_merge_updates_current_rows_without_losing_previous(self):
        previous = [
            {"numero_controle_pncp": "A", "valor": 10},
            {"numero_controle_pncp": "B", "valor": 20},
        ]
        current = [
            {"numero_controle_pncp": "A", "valor": 15},
            {"numero_controle_pncp": "C", "valor": 30},
        ]

        merged = coletor_pncp._merge_partial(current, previous)
        by_id = {item["numero_controle_pncp"]: item for item in merged}

        self.assertEqual(set(by_id), {"A", "B", "C"})
        self.assertEqual(by_id["A"]["valor"], 15)

    def test_large_coverage_drop_is_detected(self):
        previous = [{"numero_controle_pncp": str(index)} for index in range(100)]
        current = previous[:50]

        self.assertTrue(coletor_pncp._coverage_drop(current, previous))
        self.assertFalse(coletor_pncp._coverage_drop(previous[:90], previous))


if __name__ == "__main__":
    unittest.main()
