#!/usr/bin/env python3
"""Coleta documentos anuais da CGU; só substitui o resultado após todas as leituras."""
import argparse
import hashlib
import importlib.util
import json
import os
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('analise_cgu', ROOT / 'scripts/analisar-documentos-emendas-cgu.py')
analysis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analysis)


def collect(years):
    data = []
    sources = []
    with tempfile.TemporaryDirectory() as directory:
        for year in years:
            url = analysis.BASE + str(year)
            path = Path(directory) / f'{year}.zip'
            request = urllib.request.Request(url, headers={'User-Agent': 'FiscalizaVarginha/2.0'})
            with urllib.request.urlopen(request, timeout=120) as response, path.open('wb') as out:
                while block := response.read(1024 * 1024):
                    out.write(block)
            entries = analysis.extrair(path)
            if not entries:
                raise ValueError(f'{year}: nenhum registro para Varginha; base anterior preservada')
            digest = hashlib.sha256()
            with path.open('rb') as file:
                while block := file.read(1024 * 1024):
                    digest.update(block)
            data.extend([{**item, 'anoArquivo': year} for item in entries])
            sources.append({'ano': year, 'url': url, 'sha256': digest.hexdigest(), 'registros': len(entries)})
    return {'coletadoEm': datetime.now(timezone.utc).isoformat(), 'fontes': sources, 'documentos': data}


def save_atomic(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as output:
            json.dump(payload, output, ensure_ascii=False, separators=(',', ':'))
            output.write('\n')
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    current = datetime.now().year
    parser.add_argument('--anos', nargs='+', type=int, default=[current - 2, current - 1, current])
    parser.add_argument('--saida', type=Path, default=ROOT / 'painel-cidadao/emendas/data/documentos_cgu.json')
    args = parser.parse_args()
    if len(set(args.anos)) != len(args.anos) or any(y < 2014 or y > datetime.now().year for y in args.anos):
        parser.error('anos inválidos ou repetidos')
    status_path = args.saida.with_name(args.saida.stem + '_status.json')
    try:
        payload = collect(args.anos)
        save_atomic(args.saida, payload)
    except Exception as exc:
        save_atomic(status_path, {'tentativaEm': datetime.now(timezone.utc).isoformat(), 'status': 'preservado', 'anos': args.anos})
        print(f'Falha na coleta de documentos: {exc}. Base anterior preservada.')
        return 2
    save_atomic(status_path, {'tentativaEm': datetime.now(timezone.utc).isoformat(), 'status': 'ok', 'anos': args.anos})
    print(f"{len(payload['documentos'])} documentos; anos: {args.anos}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
