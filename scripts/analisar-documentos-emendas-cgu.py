#!/usr/bin/env python3
"""Extrai documentos federais aplicados em Varginha para conferência local.

Não altera o painel nem trata pagamento federal como entrega municipal.
"""
import argparse
import csv
import hashlib
import io
import json
import re
import urllib.request
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

IBGE = "3170701"
BASE = "https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares-documentos/"
FIELDS = ["Código da Emenda", "Código Documento", "Data Documento", "Fase da despesa",
          "Valor Empenhado", "Valor Pago", "Código IBGE do município de aplicação do recurso",
          "Favorecido", "Tipo Favorecido", "Município Favorecido", "Código favorecido"]


def extrair(path):
    with zipfile.ZipFile(path) as arquivo:
        entries = [i for i in arquivo.infolist() if i.filename.lower().endswith('.csv')]
        if len(entries) != 1:
            raise ValueError("O arquivo deve conter exatamente um CSV")
        with io.TextIOWrapper(arquivo.open(entries[0]), encoding="latin-1", newline="") as f:
            reader = csv.DictReader(f, delimiter=";")
            if not set(FIELDS).issubset(reader.fieldnames or []):
                raise ValueError("A fonte não contém todas as colunas obrigatórias")
            rows = []
            for row in reader:
                if row[FIELDS[6]].strip() != IBGE:
                    continue
                code = row[FIELDS[0]].strip()
                document = row[FIELDS[1]].strip()
                if not re.fullmatch(r'\d{12}', code) or not document:
                    raise ValueError("Código de emenda ou documento inválido")
                # Dados de pessoa física não são necessários à análise pública.
                legal_entity = row[FIELDS[8]].strip().lower() == 'pessoa jurídica'
                recipient = row[FIELDS[7]].strip() if legal_entity else 'Pessoa física ou outro favorecido'
                rows.append({"emenda": code, "documento": document,
                             "data": row[FIELDS[2]].strip(), "fase": row[FIELDS[3]].strip(),
                             "empenhado": row[FIELDS[4]].strip(), "pago": row[FIELDS[5]].strip(),
                             "favorecido": recipient, "cnpj": row[FIELDS[10]].strip() if legal_entity else "",
                             "municipioFavorecido": row[FIELDS[9]].strip()})
            return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ano", type=int)
    parser.add_argument("--arquivo", type=Path, help="ZIP oficial já baixado")
    parser.add_argument("--saida", type=Path, required=True)
    args = parser.parse_args()
    if not 2014 <= args.ano <= datetime.now().year:
        parser.error("ano fora do período disponível")
    source = BASE + str(args.ano)
    if args.arquivo:
        path = args.arquivo
    else:
        path = args.saida.with_suffix('.zip')
        path.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(source, headers={"User-Agent": "FiscalizaVarginha/2.0"})
        with urllib.request.urlopen(req, timeout=120) as response, path.open('wb') as out:
            while block := response.read(1024 * 1024):
                out.write(block)
    rows = extrair(path)
    digest = hashlib.sha256()
    with path.open('rb') as f:
        while block := f.read(1024 * 1024):
            digest.update(block)
    result = {"fonte": source, "anoArquivo": args.ano, "consultadoEm": datetime.now(timezone.utc).isoformat(),
              "sha256": digest.hexdigest(), "criterio": "Código IBGE de aplicação igual a 3170701",
              "limite": "Despesa federal; não comprova pagamento ao fornecedor final nem entrega municipal.",
              "quantidade": len(rows), "codigosEmenda": len({r['emenda'] for r in rows}),
              "fases": dict(Counter(r['fase'] for r in rows)), "documentos": rows}
    args.saida.parent.mkdir(parents=True, exist_ok=True)
    args.saida.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"{len(rows)} documentos; {result['codigosEmenda']} códigos de emenda; arquivo: {args.saida}")


if __name__ == '__main__':
    main()
