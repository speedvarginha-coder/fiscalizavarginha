"""Guarda de preservacao da folha: coleta degradada nao derruba a base no ar.

Cobre os dois orgaos. A Camara caiu por um caminho proprio: quando o Betha
falha, o fallback HTML devolve ~45 linhas sem competencia e a folha nominal dos
vereadores sumia da pagina sem aviso.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "painel-cidadao"))

import coletor  # noqa: E402


def _linhas(qtd, competencia, inicio=0):
    return [
        {
            "nome": f"Servidor {i}",
            "matricula": str(1000 + i),
            "cargo": "VEREADOR",
            "lotacao": "VEREADOR - VEREADORES",
            "vencimentos": 15000.0,
            "descontos": 0.0,
            "liquido": 15000.0,
            "competencia": competencia,
        }
        for i in range(inicio, inicio + qtd)
    ]


def _preserva(payload, existente, orgao, rotulo, piso_base, piso_minimo):
    return coletor._preserva_folha_por_cobertura(
        payload, existente, orgao, rotulo, piso_base, piso_minimo
    )


class PreservacaoFolhaTests(unittest.TestCase):
    def test_camara_sem_competencia_nao_derruba_base_com_competencia(self):
        """O caso real: fallback HTML sem competencia contra 59 linhas de 07/2026."""
        antigos = _linhas(59, "07/2026")
        novos = [dict(linha, competencia=None) for linha in _linhas(45, None)]
        payload = {"camara": {"servidores": novos}, "observacao": ""}
        existente = {"camara": {"servidores": antigos}}

        aviso = _preserva(payload, existente, "camara", "Camara", 20, 10)

        self.assertIsNotNone(aviso)
        self.assertEqual(payload["camara"]["status_cobertura"], "preservada_por_cobertura")
        self.assertEqual(len(payload["camara"]["servidores"]), 59)
        self.assertEqual(payload["camara"]["competencia"], "07/2026")
        self.assertIn("preservada", payload["camara"]["status"].lower())

    def test_camara_com_competencia_boa_publica_a_coleta_nova(self):
        payload = {"camara": {"servidores": _linhas(58, "08/2026")}, "observacao": ""}
        existente = {"camara": {"servidores": _linhas(59, "07/2026")}}

        self.assertIsNone(_preserva(payload, existente, "camara", "Camara", 20, 10))
        self.assertEqual(payload["camara"]["servidores"][0]["competencia"], "08/2026")
        self.assertNotIn("status_cobertura", payload["camara"])

    def test_queda_de_cobertura_pela_metade_preserva(self):
        payload = {"camara": {"servidores": _linhas(9, "08/2026")}, "observacao": ""}
        existente = {"camara": {"servidores": _linhas(59, "07/2026")}}

        self.assertIsNotNone(_preserva(payload, existente, "camara", "Camara", 20, 10))
        self.assertEqual(len(payload["camara"]["servidores"]), 59)

    def test_prefeitura_mantem_o_piso_alto_proprio(self):
        """Base antiga abaixo do piso do orgao nao vira escudo permanente."""
        payload = {"prefeitura": {"servidores": []}, "observacao": ""}
        existente = {"prefeitura": {"servidores": _linhas(300, "07/2026")}}

        self.assertIsNone(_preserva(payload, existente, "prefeitura", "Prefeitura", 1000, 100))

    def test_base_anterior_sem_competencia_nunca_vence(self):
        """A base ruim de 303.818 linhas nao pode se defender de uma boa."""
        antigos = [dict(l, competencia=None) for l in _linhas(5000, None)]
        payload = {"prefeitura": {"servidores": _linhas(4074, "07/2026")}, "observacao": ""}
        existente = {"prefeitura": {"servidores": antigos}}

        self.assertIsNone(_preserva(payload, existente, "prefeitura", "Prefeitura", 1000, 100))
        self.assertEqual(len(payload["prefeitura"]["servidores"]), 4074)

    def test_sem_base_anterior_nao_preserva(self):
        payload = {"camara": {"servidores": _linhas(45, None)}, "observacao": ""}
        self.assertIsNone(_preserva(payload, {}, "camara", "Camara", 20, 10))


if __name__ == "__main__":
    unittest.main()
