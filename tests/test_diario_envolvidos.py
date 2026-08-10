"""Extracao de razao social do trecho do Diario.

Em 07/2026 o relatorio de contratacoes exibiria "DO BRASIL LTDA" como
fornecedor: o trecho do PDF comecava depois de "COLOPLAST" e a regex casou a
partir do conectivo. Atribuir a compra a um nome pela metade e o mesmo tipo de
erro que a classificacao de sancoes produziu — melhor nao identificar do que
identificar errado.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "painel-cidadao"))

from coletor_diario import _extrai_envolvidos


def nomes(trecho):
    return [e["nome"] for e in _extrai_envolvidos(trecho) if e.get("papel") == "empresa"]


def test_nome_truncado_por_conectivo_e_descartado():
    assert nomes("resultado da compra DO BRASIL LTDA no valor de R$ 100,00") == []


def test_nome_completo_e_mantido():
    assert "COLOPLAST DO BRASIL LTDA" in nomes(
        "CONTRATADA: COLOPLAST DO BRASIL LTDA, CNPJ 12.345.678/0001-90")


def test_conectivo_no_meio_nao_atrapalha():
    assert "Coloplast do Brasil LTDA" in nomes(
        "compra de proteses da empresa Coloplast do Brasil LTDA.")


def test_nome_curto_com_iniciais_sobrevive():
    assert "A C Niemeyer LTDA" in nomes("contratou a A C Niemeyer LTDA para o servico")


if __name__ == "__main__":
    for f in [test_nome_truncado_por_conectivo_e_descartado, test_nome_completo_e_mantido,
              test_conectivo_no_meio_nao_atrapalha, test_nome_curto_com_iniciais_sobrevive]:
        f()
    print("OK: extracao de envolvidos")
