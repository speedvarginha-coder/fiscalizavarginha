"""Descoberta do xlsx da ALMG na pagina oficial.

A URL vinha fixa com o ID do acervo. Republicacao troca o ID, a URL antiga
responde 404 e a coleta cai em silencio preservando a base velha.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "painel-cidadao" / "emendas"))

import coletor_emendas_estaduais as col  # noqa: E402


class DescobertaAlmgTests(unittest.TestCase):
    def test_encontra_o_xlsx_do_acervo(self):
        html = '<a href="https://mediaserver.almg.gov.br/acervo/497/507/2497507.xlsx">Planilha</a>'
        self.assertEqual(
            col.descobrir_planilha_almg(html),
            "https://mediaserver.almg.gov.br/acervo/497/507/2497507.xlsx",
        )

    def test_acompanha_id_novo_do_acervo(self):
        """O ponto do exercicio: ID diferente do fixo no codigo."""
        html = '<a href="https://mediaserver.almg.gov.br/acervo/999/111/9991110.xlsx">Nova</a>'
        achado = col.descobrir_planilha_almg(html)
        self.assertEqual(achado, "https://mediaserver.almg.gov.br/acervo/999/111/9991110.xlsx")
        self.assertNotEqual(achado, col.ALMG_XLSX)

    def test_resolve_href_relativo(self):
        html = '<a href="//mediaserver.almg.gov.br/acervo/1/2/3.xlsx">rel</a>'
        self.assertEqual(
            col.descobrir_planilha_almg(html),
            "https://mediaserver.almg.gov.br/acervo/1/2/3.xlsx",
        )

    def test_ignora_xlsx_de_outro_dominio(self):
        html = '<a href="https://exemplo.invalido/planilha.xlsx">outra</a>'
        self.assertIsNone(col.descobrir_planilha_almg(html))

    def test_sem_xlsx_devolve_none_para_o_chamador_usar_a_url_conhecida(self):
        self.assertIsNone(col.descobrir_planilha_almg("<html><body>sem link</body></html>"))

    def test_ignora_csv_do_mesmo_acervo(self):
        """A pagina publica .csv e .xlsx; o coletor le planilha."""
        html = '<a href="https://mediaserver.almg.gov.br/acervo/497/469/2497469.csv">csv</a>'
        self.assertIsNone(col.descobrir_planilha_almg(html))


if __name__ == "__main__":
    unittest.main()
