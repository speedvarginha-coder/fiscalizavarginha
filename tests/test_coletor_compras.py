"""Mapeamento de campos da consulta Betha 83045 (compras diretas).

Ate 04/08/2026 o normalizador lia dataAbertura, cnpjCpfFornecedor, valorTotal e
tipoCompra — nenhum desses campos existe na consulta. Todo registro era gravado
com data, CNPJ e valor vazios, e o painel exibia a base como se nao houvesse
compra direta. A linha abaixo e um registro real devolvido pela API.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "painel-cidadao"))

from coletor import _normaliza_compras, _t


LINHA_REAL = {
    "id": "9546",
    "protocolo": " ",  # a Betha devolve espaco, nao string vazia
    "ano": "2026",
    "nomeEntidade": "PREFEITURA MUNICIPAL VARGINHA",
    "dataCompra": "2026-01-01",
    "objeto": "Rateio dos recursos financeiros do CIESP",
    "nomeFornecedor": "CONSORCIO INTERMUNICIPAL DE ESPECIALIDADES",
    "cpfCnpjFornecedor": "07.356.999/****-**",
    "fundamentacaoLegal": "Lei 11107/05, Art.2, §1º, I",
    "tipo": "Contrato de Rateio (Consórcio Público)",
    "valor": "1234,56",
}


def test_campos_essenciais_preenchidos():
    (c,) = _normaliza_compras([LINHA_REAL])
    assert c["data"] == "2026-01-01"
    assert c["cnpj"] == "07.356.999/****-**"
    assert c["valor"] == 1234.56
    assert c["modalidade"] == "Contrato de Rateio (Consórcio Público)"
    assert c["fundamento"] == "Lei 11107/05, Art.2, §1º, I"


def test_protocolo_em_branco_cai_para_id():
    # " " e truthy em Python: sem o strip de _t, o numero sairia como espaco.
    (c,) = _normaliza_compras([LINHA_REAL])
    assert c["numero"] == "9546"
    assert _t(" ") == ""


if __name__ == "__main__":
    test_campos_essenciais_preenchidos()
    test_protocolo_em_branco_cai_para_id()
    print("OK: mapeamento de compras diretas")
