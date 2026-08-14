"""Folha: uma linha por servidor POR MES nao pode virar 'um mes de folha'.

A consulta da Camara devolve varias competencias no mesmo array. Somar tudo
publicava R$ 3,3 mi como custo mensal quando o mes custava R$ 0,6 mi, e contava
388 linhas como se fossem 388 servidores (sao ~65). Este teste trava a regra.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "painel-cidadao"))

from coletor_pessoal import _competencia_referencia, _resumo  # noqa: E402


def linha(nome, comp, venc, comissionado=False, matricula=""):
    return {
        "nome": nome,
        "matricula": matricula,
        "competencia": comp,
        "vencimentos": venc,
        "comissionado_ou_similar": comissionado,
    }


class TestCompetenciaReferencia(unittest.TestCase):
    def test_ignora_mes_recente_incompleto(self):
        """07/2026 com 1 linha nao pode virar referencia sobre 06/2026 com 10."""
        servidores = [linha(f"P{i}", "06/2026", 1000) for i in range(10)]
        servidores += [linha("P0", "07/2026", 900)]
        ref, parcial = _competencia_referencia(servidores)
        self.assertEqual(ref, "06/2026")
        self.assertEqual(parcial, ("07/2026", 1))

    def test_prefere_o_mes_mais_recente_entre_os_completos(self):
        """Com cobertura parecida, vale o mais recente, nao o mais cheio."""
        servidores = [linha(f"P{i}", "04/2026", 1000) for i in range(10)]
        servidores += [linha(f"P{i}", "06/2026", 1000) for i in range(9)]
        ref, parcial = _competencia_referencia(servidores)
        self.assertEqual(ref, "06/2026")
        self.assertIsNone(parcial)

    def test_ordena_por_ano_e_nao_so_pelo_mes(self):
        servidores = [linha(f"P{i}", "12/2025", 1000) for i in range(5)]
        servidores += [linha(f"P{i}", "01/2026", 1000) for i in range(5)]
        ref, _ = _competencia_referencia(servidores)
        self.assertEqual(ref, "01/2026")

    def test_sem_competencia_na_linha_devolve_none(self):
        """Prefeitura nao carimba competencia na linha: ela mora no orgao."""
        servidores = [linha("P1", None, 1000), linha("P2", None, 2000)]
        ref, parcial = _competencia_referencia(servidores)
        self.assertIsNone(ref)
        self.assertIsNone(parcial)


class TestResumo(unittest.TestCase):
    def test_soma_apenas_a_competencia_de_referencia(self):
        servidores = [linha(f"P{i}", "05/2026", 100) for i in range(10)]
        servidores += [linha(f"P{i}", "06/2026", 200) for i in range(10)]
        r = _resumo("Camara", servidores)
        self.assertEqual(r["competencia_referencia"], "06/2026")
        self.assertEqual(r["folha_bruta_total"], 2000)      # e nao 3000
        self.assertEqual(r["servidores_qtd"], 10)           # e nao 20
        self.assertEqual(r["linhas_todas_competencias"], 20)

    def test_multiplos_vinculos_contam_uma_pessoa_mas_somam_os_dois(self):
        """Prefeitura: a mesma pessoa pode ter 2 vinculos no mesmo mes."""
        servidores = [
            linha("MARIA", None, 1000, matricula="1"),
            linha("MARIA", None, 500, matricula="2"),
            linha("JOAO", None, 800, matricula="3"),
        ]
        r = _resumo("Prefeitura", servidores, competencia_unica="06/2026")
        self.assertEqual(r["vinculos_qtd"], 3)
        self.assertEqual(r["pessoas_qtd"], 2)   # Maria + Joao
        self.assertEqual(r["folha_bruta_total"], 2300)

    def test_pessoas_qtd_desconta_repeticao_de_mesma_matricula(self):
        servidores = [
            linha("MARIA", None, 1000, matricula="1"),
            linha("maria", None, 500, matricula="1"),
        ]
        r = _resumo("Prefeitura", servidores, competencia_unica="06/2026")
        self.assertEqual(r["vinculos_qtd"], 2)
        self.assertEqual(r["pessoas_qtd"], 1)

    def test_registra_a_competencia_parcial_descartada(self):
        servidores = [linha(f"P{i}", "06/2026", 100) for i in range(10)]
        servidores += [linha("P0", "07/2026", 100)]
        r = _resumo("Camara", servidores)
        self.assertEqual(r["competencia_parcial"], {"competencia": "07/2026", "linhas": 1})

    def test_comissionados_saem_da_mesma_competencia(self):
        servidores = [linha("A", "05/2026", 900, comissionado=True)]
        servidores += [linha(f"P{i}", "06/2026", 100) for i in range(3)]
        servidores += [linha("B", "06/2026", 700, comissionado=True)]
        r = _resumo("Camara", servidores)
        self.assertEqual(r["comissionados_qtd"], 1)
        self.assertEqual(r["folha_bruta_comissionados"], 700)


class TestCompetenciaIndeterminada(unittest.TestCase):
    """Sem competencia e sem garantia do chamador, nada de total mensal.

    Regressao real de 14/08/2026: a folha completa da Prefeitura falhou, o
    fallback Educacao/FUNDEB (consulta por ANO) devolveu 303.818 linhas de
    varios meses sem competencia, e o resumo somou tudo: R$ 914.884.645,14
    publicados como folha mensal, com 303.818 "servidores" (sao 3.731 pessoas).
    """

    def test_sem_competencia_e_sem_garantia_nao_publica_total(self):
        servidores = [linha(f"P{i}", None, 1000) for i in range(10)]
        r = _resumo("Prefeitura", servidores)
        self.assertTrue(r["competencia_indeterminada"])
        self.assertIsNone(r["competencia_referencia"])
        self.assertIsNone(r["folha_bruta_total"])
        self.assertIsNone(r["servidores_qtd"])
        self.assertIsNone(r["comissionados_qtd"])
        # a contagem bruta de linhas continua, e o unico numero defensavel aqui
        self.assertEqual(r["linhas_todas_competencias"], 10)

    def test_garantia_do_chamador_soma_e_carimba_o_mes(self):
        servidores = [linha(f"P{i}", None, 1000) for i in range(10)]
        r = _resumo("Prefeitura", servidores, competencia_unica="06/2026")
        self.assertEqual(r["competencia_referencia"], "06/2026")
        self.assertNotIn("competencia_indeterminada", r)
        self.assertEqual(r["folha_bruta_total"], 10000)
        self.assertEqual(r["servidores_qtd"], 10)

    def test_coleta_vazia_nao_vira_zero_servidores(self):
        r = _resumo("Camara", [])
        self.assertTrue(r["competencia_indeterminada"])
        self.assertIsNone(r["folha_bruta_total"])


if __name__ == "__main__":
    unittest.main()
