"""Reconciliacao entre o registro da Prefeitura e as bases de origem.

O risco desta checagem nao e deixar de achar divergencia: e INVENTAR divergencia
por comparar formatos diferentes. Cada esfera numera de um jeito, e uma chave mal
normalizada acusa dezenas de emendas legitimas como ausentes -- com nome de
entidade beneficiaria na tela.

Ja aconteceu duas vezes durante o desenvolvimento: casar so pelos digitos
iniciais acusou 27 emendas, e colar o ano do relatorio no codigo municipal
acusou as 45 de 2026. As duas eram falso positivo.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "painel-cidadao" / "emendas"))

import coletor_emendas_prefeitura as col  # noqa: E402


class ChaveTests(unittest.TestCase):
    def test_federal_usa_o_codigo_de_doze_digitos(self):
        self.assertEqual(col.chave("Federais", "202627540001"), "202627540001")

    def test_federal_encontra_o_codigo_dentro_de_texto(self):
        self.assertEqual(col.chave("Federais", "emenda 202627540001 - PSD"), "202627540001")

    def test_federal_ignora_numero_curto(self):
        """Numero de duas casas nao e codigo federal; casar com ele inventa par."""
        self.assertIsNone(col.chave("Federais", "63"))

    def test_municipal_com_ano_preserva_o_ano_da_emenda(self):
        self.assertEqual(col.chave("Municipal", "01/2024"), "1/2024")
        self.assertEqual(col.chave("Municipal", "037/2024"), "37/2024")

    def test_municipal_sem_ano_nao_recebe_o_ano_do_relatorio(self):
        """O relatorio de 2026 lista emendas numeradas em 2024 e 2025.

        Colar o ano do relatorio marcaria as 45 como ausentes do painel.
        """
        self.assertEqual(col.chave("Municipal", "63", ano_relatorio=2026), "63")

    def test_estadual_aceita_os_dois_formatos_do_mesmo_dado(self):
        """2025 publica '10662/2025'; 2026 publica '193883'."""
        self.assertEqual(col.chave("Estaduais", "10662/2025"), "10662")
        self.assertEqual(col.chave("Estaduais", "193883"), "193883")

    def test_federal_aceita_numero_com_ponto_de_milhar(self):
        """O relatorio publica "6.916/2025"; o painel guarda o mesmo formato."""
        self.assertEqual(col.chave("Federais", "6.916/2025"), "6916/2025")

    def test_estadual_aceita_codigo_alfanumerico_do_plano(self):
        """Parte dos registros de 2026 usa "S256-162/2026" em vez do numero."""
        self.assertEqual(col.chave("Estaduais", "S256-162/2026"), "S256-162")
        self.assertEqual(col.chave("Estaduais", "R2936-70/2026"), "R2936-70")

    def test_regex_de_codigo_cobre_os_seis_formatos_reais(self):
        """Formato nao previsto some do confronto em silencio, sem erro."""
        for bruto in ("193883", "10662/2025", "S256-162/2026",
                      "6.916/2025", "202627540001", "01/2024"):
            self.assertIsNotNone(col.RE_CODIGO.match(bruto), bruto)

    def test_vazio_devolve_none_em_vez_de_chave_falsa(self):
        for esfera in ("Federais", "Municipal", "Estaduais"):
            self.assertIsNone(col.chave(esfera, ""))
            self.assertIsNone(col.chave(esfera, None))


class ConciliacaoTests(unittest.TestCase):
    def test_emenda_conhecida_nao_e_acusada(self):
        painel = {"Estaduais": {"193883"}, "Municipal": set(), "Federais": set()}
        chave = col.chave("Estaduais", "193883")
        self.assertIn(chave, painel["Estaduais"])

    def test_codigo_ilegivel_fica_fora_da_acusacao(self):
        """Sem chave nao da para afirmar ausencia — nem presenca."""
        self.assertIsNone(col.chave("Municipal", "sem numero"))


class ExitCodeTests(unittest.TestCase):
    """O ciclo financeiro trata o codigo 2 como 'preservado'.

    Se esta reconciliacao devolvesse 1 num momento de indisponibilidade, o
    orquestrador desfaria TUDO — inclusive as emendas federais, estaduais e as
    diarias ja coletadas com sucesso — por causa de uma fonte instavel.
    """

    def test_sem_relatorio_preserva_e_devolve_2(self):
        import tempfile

        with tempfile.TemporaryDirectory() as pasta:
            argv = sys.argv
            sys.argv = ["coletor_emendas_prefeitura.py", "--pdf-dir", pasta]
            try:
                self.assertEqual(col.main(), 2)
            finally:
                sys.argv = argv

    def test_fonte_indisponivel_preserva_e_devolve_2(self):
        from unittest import mock

        argv = sys.argv
        sys.argv = ["coletor_emendas_prefeitura.py"]
        try:
            with mock.patch.object(col, "baixar_relatorios", side_effect=RuntimeError("HTTP Error 500")):
                self.assertEqual(col.main(), 2)
        finally:
            sys.argv = argv


if __name__ == "__main__":
    unittest.main()
