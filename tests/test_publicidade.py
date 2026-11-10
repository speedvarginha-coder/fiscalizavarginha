import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("publicidade", Path(__file__).parents[1] / "painel-cidadao/coletor_publicidade.py")
c = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(c)

MONTH = '''<div class="titulo_investimento_anomes">Out/2026</div><ul class="lista">
<li><span class="meio">Meio</span><span class="valor">Valor</span>
<li><span class="meio">Rádio</span><span class="valor">R$ 1.234,56</span>
<li><span class="meio">Internet</span><span class="valor">R$ 100,01</span>
<li><span class="meio">TOTAL GERAL</span><span class="valor">R$ 1.334,57</span></ul>'''


class PublicidadeTests(unittest.TestCase):
    def test_malformed_list_exact_cents_and_total_exclusion(self):
        result = c.investimento(MONTH, "2026-10")
        self.assertEqual(result["total_centavos"], 133457)
        self.assertEqual(len(result["meios"]), 2)

    def test_wrong_month_and_bad_sum_rejected(self):
        for html, month in [(MONTH, "2026-09"), (MONTH.replace("1.334,57", "1.334,58"), "2026-10"), ("<html>Erro</html>", "2026-10")]:
            with self.subTest(month=month, html=html), self.assertRaises(ValueError):
                c.investimento(html, month)

    def test_explicit_zero_is_valid_but_empty_is_not(self):
        html = '<div class="titulo_investimento_anomes">Out/2026</div><ul class="lista"><span class="meio">TOTAL GERAL</span><span class="valor">R$ 0,00</span></ul>'
        self.assertEqual(c.investimento(html, "2026-10")["total_centavos"], 0)
        with self.assertRaises(ValueError):
            c.periodos_disponiveis("<html>manutenção</html>")

    def test_failures_preserve_values_and_original_timestamp(self):
        old = {"investimentos": [{"periodo": "2026-10", "consultado_em": "2026-11-01T00:00:00Z", "total_centavos": 500}],
               "cadastros": {"veiculos": {"consultado_em": "2026-11-01T00:00:00Z", "registros": [{"nome": "Rádio"}]}}}
        def failure(*args):
            raise TimeoutError("timeout")
        result = c.coletar("prefeitura", old, failure, pausa=0)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["investimentos"], old["investimentos"])
        self.assertEqual(result["cadastros"], old["cadastros"])
        self.assertIsNone(result["coleta_frescor"]["datasets"]["periodos"]["last_complete_at"])
        self.assertEqual(c.coletar("camara", fetch=failure, pausa=0)["status"], "failed")

    def test_inactive_and_cpf_redaction(self):
        html = '''<div class="titulo_principal">Fornecedores de Serviços Complementares</div><div class="veic_forn">
        <div class="journal-table adjinativo"><a href="/documento_view.php?doc=12.345.678/0001-90"><div class="item row">
        <div class="cell riscoinativo">Pessoa 12345678901 - 12.345.678/0001-90</div></div></a></div></div>'''
        record = c.catalogo(html, "fornecedores")[0]
        self.assertEqual(record["situacao"], "inativo")
        self.assertNotIn("12345678901", record["nome"])
        self.assertEqual(record["cnpj"], "12.345.678/0001-90")
        self.assertTrue(record["url_documento"].startswith(c.BASE))

    def test_incremental_rechecks_recent_new_and_oldest_history(self):
        periods = ["2026-10", "2026-09", "2026-08", "2026-07", "2026-06"]
        old = {"investimentos": [{"periodo": p, "consultado_em": "2026-10-01T00:00:00Z", "total_centavos": 1}
                                for p in periods[1:]]}
        requested = []
        def fetch(url, periodo=None):
            if periodo:
                requested.append(periodo)
                month, year = periodo.split("/")
                return MONTH.replace("Out/2026", f"{c.MESES[int(month)-1].title()}/{year}")
            if url.endswith("investimentos/"):
                return '<select name="periodo">' + ''.join(f'<option value="{p[5:]}/{p[:4]}">' for p in periods) + '</select>'
            raise TimeoutError("cadastro offline")
        result = c.coletar("prefeitura", old, fetch, pausa=0)
        self.assertEqual(requested, ["10/2026", "09/2026", "08/2026", "07/2026"])
        untouched = next(m for m in result["investimentos"] if m["periodo"] == "2026-06")
        self.assertEqual(untouched["consultado_em"], "2026-10-01T00:00:00Z")


if __name__ == "__main__":
    unittest.main()
