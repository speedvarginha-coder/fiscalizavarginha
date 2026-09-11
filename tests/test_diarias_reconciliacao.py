# -*- coding: utf-8 -*-
"""Reconciliacao de diarias por (orgao, exercicio).

A regra anterior era tudo-ou-nada: so preservava quando a lista inteira do orgao
voltava vazia e a base tinha >= 50 registros. Se um ano falhava e o outro
respondia, a lista parcial SUBSTITUIA a base publicada e o ano bom era apagado.
Estes testes fixam a regra por exercicio.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "painel-cidadao"))

import coletor  # noqa: E402


def registros(ano, n, prefixo="r"):
    return [{"ano": str(ano), "funcionario": f"{prefixo}{i}", "valor_total": 10.0} for i in range(n)]


class ReconciliacaoDiariasTests(unittest.TestCase):
    def test_falha_de_um_ano_preserva_o_ano_bom_anterior(self):
        # 2025 falhou; 2026 respondeu. Os 50 de 2025 nao podem sumir.
        novos = registros("2026", 50, "novo26")
        antigos = registros("2025", 100, "antigo25") + registros("2026", 40, "antigo26")
        status = {"2025": {"status": "failed"}, "2026": {"status": "ok"}}
        resultado, preservados = coletor._reconciliar_diarias_por_exercicio(novos, antigos, status)
        anos = sorted({r["ano"] for r in resultado})
        self.assertEqual(anos, ["2025", "2026"])
        self.assertEqual(len([r for r in resultado if r["ano"] == "2025"]), 100)
        self.assertEqual(len([r for r in resultado if r["ano"] == "2026"]), 50)
        self.assertIn("2025", preservados)
        self.assertNotIn("2026", preservados)

    def test_falha_total_preserva_tudo(self):
        antigos = registros("2025", 60) + registros("2026", 60)
        status = {"2025": {"status": "failed"}, "2026": {"status": "failed"}}
        resultado, preservados = coletor._reconciliar_diarias_por_exercicio([], antigos, status)
        self.assertEqual(len(resultado), 120)
        self.assertEqual(sorted(preservados), ["2025", "2026"])

    def test_ano_ok_com_registros_substitui_o_anterior(self):
        novos = registros("2026", 3, "novo")
        antigos = registros("2026", 3, "antigo")
        status = {"2026": {"status": "ok"}}
        resultado, preservados = coletor._reconciliar_diarias_por_exercicio(novos, antigos, status)
        self.assertEqual(resultado, novos)
        self.assertEqual(preservados, [])

    def test_ano_ok_mas_vazio_preserva_o_anterior(self):
        antigos = registros("2026", 30)
        status = {"2026": {"status": "ok"}}
        resultado, preservados = coletor._reconciliar_diarias_por_exercicio([], antigos, status)
        self.assertEqual(len(resultado), 30)
        self.assertEqual(preservados, ["2026"])

    def test_base_pequena_tambem_e_preservada(self):
        # Regressao do limite antigo: 7 registros (< 50) nao podem ser descartados.
        antigos = registros("2026", 7)
        status = {"2026": {"status": "failed"}}
        resultado, _ = coletor._reconciliar_diarias_por_exercicio([], antigos, status)
        self.assertEqual(len(resultado), 7)

    def test_ano_novo_sem_anterior_entra(self):
        novos = registros("2026", 5)
        resultado, preservados = coletor._reconciliar_diarias_por_exercicio(novos, [], {"2026": {"status": "ok"}})
        self.assertEqual(resultado, novos)
        self.assertEqual(preservados, [])

    def test_historico_fora_da_janela_coletada_e_preservado(self):
        # Quando o ano vira, 2025 sai da janela de coleta (2026/2027), mas nao
        # deve ser apagado da base publicada.
        antigos = registros("2025", 12)
        novos = registros("2027", 4)
        status = {"2027": {"status": "ok"}}
        resultado, _ = coletor._reconciliar_diarias_por_exercicio(novos, antigos, status)
        self.assertEqual(sorted({r["ano"] for r in resultado}), ["2025", "2027"])

    def test_listas_ausentes_nao_quebram(self):
        resultado, preservados = coletor._reconciliar_diarias_por_exercicio(None, None, None)
        self.assertEqual(resultado, [])
        self.assertEqual(preservados, [])


class CodigoSaidaTests(unittest.TestCase):
    def test_todos_ok_devolve_0(self):
        meta = {"prefeitura": {"ok": True}, "camara": {"ok": True}}
        self.assertEqual(coletor._codigo_saida_diarias({"prefeitura": [1], "camara": [1]}, meta), 0)

    def test_um_orcamento_parcial_devolve_2(self):
        meta = {"prefeitura": {"ok": True}, "camara": {"ok": False}}
        self.assertEqual(coletor._codigo_saida_diarias({"prefeitura": [1], "camara": [1]}, meta), 2)

    def test_preservado_sem_coleta_nova_devolve_2(self):
        meta = {"prefeitura": {"ok": False}, "camara": {"ok": False}}
        self.assertEqual(coletor._codigo_saida_diarias({"prefeitura": [1], "camara": []}, meta), 2)

    def test_nada_coletado_nem_preservado_devolve_3(self):
        meta = {"prefeitura": {"ok": False}, "camara": {"ok": False}}
        self.assertEqual(coletor._codigo_saida_diarias({"prefeitura": [], "camara": []}, meta), 3)


if __name__ == "__main__":
    unittest.main()
