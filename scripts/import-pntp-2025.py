"""Recorta Varginha da base oficial PNTP 2025, preservando as notas publicadas.

Uso: python scripts/import-pntp-2025.py DIRETORIO_EXTRAIDO [--respostas-json CACHE]
O cache opcional contém as linhas de respostas previamente extraídas dos XLSX.
Sem cache, a leitura integral da planilha de MG pode levar alguns minutos.
"""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

import openpyxl


def rows(path):
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        values = book.active.iter_rows(values_only=True)
        headers = next(values)
        for row in values:
            yield dict(zip(headers, row))
    finally:
        book.close()


def key(value):
    return str(value).removesuffix('.0')


def answer(value):
    if value is True or value == 'True':
        return True
    if value is False or value == 'False':
        return False
    raise ValueError(f'Resposta sem interpretação definida: {value!r}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('diretorio', type=Path)
    parser.add_argument('--respostas-json', type=Path)
    args = parser.parse_args()
    summary_path = args.diretorio / 'avaliacoes_pntp_2025.xlsx'
    answers_path = args.diretorio / 'respostas/respostas_pntp_2025_MG.xlsx'
    source = {
        'url': 'https://radardatransparencia.atricon.org.br/dados/dados_pntp_2025.zip',
        'pagina': 'https://radardatransparencia.atricon.org.br/downloads.html',
        'publicada_em': '2026-02-10',
        'consultada_em': '2026-09-03',
        'arquivos': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                     for p in [summary_path, answers_path]},
    }
    entities = {}
    for row in rows(summary_path):
        if key(row['ibge']) != '3170701':
            continue
        entity_key = {'Executivo': 'prefeitura', 'Legislativo': 'camara'}[row['Poder']]
        entities[entity_key] = {
            'nome': row['Unidade Gestora'], 'ibge': '3170701',
            'id_avaliacao': key(row['id_avaliacao']),
            'id_entidade': key(row['Código Entidade']),
            'enviada_em': row['Data Envio'].date().isoformat(),
            'indice': round(row['Índice de Transparência'] * 100, 2),
            'essenciais': round(row['% das Essenciais'] * 100, 2),
            'nivel': row['Nível de Transparência'],
            'autoavaliacao': row['Autoavaliação'] == 'Sim',
            'validada': row['Avaliação Validada?'] == 'Sim',
            'revisada': row['Avaliação Revisada?'] == 'Sim',
            'certificavel': row['Avaliação Certificável?'] == 'Sim',
            'criterios': {}, 'registros_originais': 0,
        }
    assert set(entities) == {'prefeitura', 'camara'}, 'Órgãos de Varginha não encontrados'
    by_id = {e['id_avaliacao']: e for e in entities.values()}
    records = (json.loads(args.respostas_json.read_text(encoding='utf-8'))
               if args.respostas_json else rows(answers_path))
    for row in records:
        entity = by_id.get(key(row['id_avaliacao']))
        if entity is None:
            continue
        assert key(row['ibge']) == entity['ibge']
        assert key(row['entidade_id']) == entity['id_entidade']
        # Nesta edição os dois órgãos têm somente respostas de autoavaliação.
        assert row['resposta_validacao'] in (None, 'nan')
        assert row['resposta_revisao'] in (None, 'nan')
        entity['registros_originais'] += 1
        criterion = entity['criterios'].setdefault(key(row['id_criterio']), {
            'id': key(row['id_criterio']), 'dimensao': row['dimensao_texto'],
            'texto': row['criterio_texto'], 'exigibilidade': row['exigibilidade'],
            'itens': [],
        })
        url = str(row['link_avaliacao'] or '').strip()
        existing = next((i for i in criterion['itens'] if i['nome'] == row['item_avaliacao']), None)
        item = existing or {'nome': row['item_avaliacao'], 'atendido': answer(row['resposta_avaliacao']), 'evidencias': []}
        assert item['atendido'] == answer(row['resposta_avaliacao']), 'Respostas conflitantes'
        if urlsplit(url).scheme in ('http', 'https') and urlsplit(url).netloc:
            if url not in item['evidencias']:
                item['evidencias'].append(url)
        if not existing:
            criterion['itens'].append(item)
    for entity in entities.values():
        entity['criterios'] = list(entity['criterios'].values())
        items = [i for c in entity['criterios'] for i in c['itens']]
        entity['itens_atendidos'] = sum(i['atendido'] for i in items)
        entity['itens_pendentes'] = sum(not i['atendido'] for i in items)
        assert items, 'Respostas ausentes'
    output = Path(__file__).resolve().parents[1] / 'painel-cidadao/data/referencias/pntp-2025.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'schema_version': 1, 'ciclo': 2025, 'fonte': source,
                                 'orgaos': entities}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'PNTP 2025: {output.stat().st_size} bytes; ' + '; '.join(
        f"{k}: {e['indice']}%, {e['itens_atendidos']} atendidos, {e['itens_pendentes']} pendentes"
        for k, e in entities.items()))


if __name__ == '__main__':
    main()
