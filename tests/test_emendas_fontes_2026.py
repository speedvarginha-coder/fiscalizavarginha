"""Regressões: relatório estadual de 2026 e ano da proposta municipal."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "painel-cidadao" / "emendas"))
sys.path.insert(0, str(ROOT / "painel-cidadao"))
import coletor_emendas_estaduais as estadual  # noqa: E402
import coletor_emendas_2026 as municipal  # noqa: E402


class RelatorioEstadual2026Tests(unittest.TestCase):
    def test_descobre_relatorio_especifico_na_pagina_oficial(self):
        page = '<a href="/wp-content/dados-emendas/2026/Planilha%20Impositivas%202026.xlsx">Baixar relatório</a>'
        self.assertEqual(
            estadual.descobrir_relatorio_2026(page),
            "https://www.emendas.mg.gov.br/wp-content/dados-emendas/2026/Planilha%20Impositivas%202026.xlsx",
        )

    def test_pagamento_do_relatorio_substitui_zero_sem_virar_recebimento(self):
        book = Workbook()
        sheet = book.active
        sheet.append(["Nº INDICAÇÃO", "MUNICÍPIO", "VALOR INDICADO", "VALOR UTILIZADO",
                      "VALOR EMPENHADO", "VALOR LIQUIDADO", "VALOR PAGO", "DATA PAGAMENTO"])
        sheet.append([203544, "VARGINHA", 180000, 180000, 180000, 180000, 180000, None])
        sheet.append([999999, "OUTRA CIDADE", 100, 100, 100, 100, 100, None])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "report.xlsx"
            book.save(path)
            rows, name, _ = estadual.ler_relatorio_2026(path)
        self.assertEqual(list(rows), ["estadual-sigcon-2026-203544"])
        record = {
            "id": "estadual-sigcon-2026-203544", "statusIndicacao": "APROVADO",
            "valorIndicado": 180000, "valorPago": 0, "valorExecutado": 0,
            "valorRecebido": None, "evidencias": {
                "urlOficial": "https://oficial.exemplo/geral.xlsx", "arquivoSha256": "anterior",
            }, "fontes": [],
        }
        stats = estadual.incorporar_relatorio_2026(
            [record], rows, "https://oficial.exemplo/2026.xlsx", "novo", name, "2026-09-23",
        )
        self.assertEqual(stats, {"indicacoesAtualizadas": 1, "indicacoesComPagamento": 1})
        self.assertEqual(record["valorPago"], 180000)
        self.assertEqual(record["estagioAtual"], "pago")
        self.assertIsNone(record["valorRecebido"])
        self.assertEqual(record["evidencias"]["indicacaoConsolidada"]["arquivoSha256"], "anterior")
        self.assertEqual(record["evidencias"]["arquivoSha256"], "novo")


class EmendasMunicipais2026Tests(unittest.TestCase):
    def test_busca_ano_da_proposta_e_filtra_projeto_orcamentario(self):
        source = next(item for item in municipal.FONTES if item["tipo"] == "json_sapl")
        self.assertIn("ano=2025", source["url"])
        payload = {"results": [
            {"numero": 3, "ano": 2025, "ementa": "CNPJ 18.240.119/0001-05; R$ 298.000,00",
             "texto_original": "https://sapl.varginha.mg.leg.br/projetodelei57-2025.pdf"},
            {"numero": 4, "ano": 2025, "ementa": "outra proposta",
             "texto_original": "https://sapl.varginha.mg.leg.br/outro-projeto.pdf"},
        ], "pagination": {"links": {"next": None}}}
        with patch.object(municipal, "_fetch", return_value=(json.dumps(payload), "application/json")):
            found = municipal._scan_sapl_api(source["nome"], source["url"])
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["ano"], "2025")
        self.assertTrue(found[0]["tem_cnpj"] and found[0]["tem_valor"])
        self.assertIn("orçamento de 2026", found[0]["sinal"])


if __name__ == "__main__":
    unittest.main()
