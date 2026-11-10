"""Recalcula correspondências por exercício documental, nunca execução da emenda."""
import json
import argparse
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'painel-cidadao'))
import coletor_betha as betha


def mark_unverified(base):
    """Retira correspondências antigas sem exercício válido, sem inventar valores."""
    result = dict(base)
    rows = []
    for original in base.get('emendas_cruzadas', []):
        row = dict(original)
        info = row.get('cruzamento') or {}
        safe = (info.get('metodo') == 'raiz_cnpj_e_exercicio_documental'
                and re.fullmatch(r'20\d{2}', str(row.get('exercicioOrcamentario') or ''))
                and all(str(p.get('ano')) == str(row['exercicioOrcamentario']) for p in row.get('pagamentos', [])))
        if row.get('status') in ['encontrado', 'sem_pagamento'] and not safe:
            row.update(status='sem_periodo', pagamentos=[], valor_pago_total=None,
                       cruzamento={'estado':'indisponivel','metodo':'consulta_indisponivel',
                                   'confianca':'indisponivel','evidencias':[],
                                   'limitacoes':['Consulta completa indisponível. Correspondência legada não reconfirmada; não representa ausência de pagamento.']})
        rows.append(row)
    result['emendas_cruzadas'] = rows
    counts = Counter(r['status'] for r in rows)
    result['stats_cruzamento'] = {'com_pagamento':counts['encontrado'], 'sem_pagamento':counts['sem_pagamento'],
                                'sem_cnpj':counts['sem_cnpj'], 'execucao_direta':counts['execucao_direta'], 'sem_periodo':counts['sem_periodo']}
    result['emendas_cruzamento_meta'] = {**base.get('emendas_cruzamento_meta', {}),
                                       'ultima_tentativa':datetime.now(timezone.utc).isoformat(), 'status':'preservado_ou_indisponivel'}
    return result


def write_result(result):
    text = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    for target in [ROOT / 'painel-cidadao/data/chunks/prefeitura.json', ROOT / 'painel-cidadao/data/prefeitura.json']:
        if target.parent.exists():
            temp = target.with_suffix('.json.tmp')
            temp.write_text(text, encoding='utf-8'); temp.replace(target)


def reconcile(base, emendas, credores):
    if not credores:
        raise ValueError('Base de credores vazia; cruzamento anterior preservado')
    result = dict(base)
    cruzadas = betha.cruzar_emendas(emendas, credores)
    counts = Counter(r['status'] for r in cruzadas)
    result['emendas_cruzadas'] = cruzadas
    result['stats_cruzamento'] = {
        'com_pagamento': counts['encontrado'], 'sem_pagamento': counts['sem_pagamento'],
        'sem_cnpj': counts['sem_cnpj'], 'execucao_direta': counts['execucao_direta'],
        'sem_periodo': counts['sem_periodo'],
    }
    result['emendas_cruzamento_meta'] = {
        'consultado_em': datetime.now(timezone.utc).isoformat(),
        'metodo': 'raiz_cnpj_e_exercicio_documental',
        'registros_credores': len(credores),
        'limite': 'Pagamentos ao beneficiário no exercício, sem vínculo comprovado com a emenda. Não representam execução nem percentual pago da emenda.',
    }
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--invalidar-legado', action='store_true')
    args = parser.parse_args()
    chunks = ROOT / 'painel-cidadao/data/chunks'
    base = json.loads((chunks / 'prefeitura.json').read_text(encoding='utf-8-sig'))
    if args.invalidar_legado:
        write_result(mark_unverified(base))
        print('Correspondências legadas não reconfirmadas retiradas; fontes oficiais preservadas.')
        return 0
    emendas = json.loads((chunks / 'emendas.json').read_text(encoding='utf-8-sig'))
    try:
        token = betha.get_token()
        credores = betha.todos_credores(token)
        result = reconcile(base, emendas, credores)
    except Exception as exc:
        write_result(mark_unverified(base))
        print(f'AVISO: consulta completa indisponível; correspondências não reconfirmadas indisponíveis: {exc}')
        return 2
    write_result(result)
    print(f'Cruzamento atualizado: {len(emendas)} emendas; {len(credores)} registros de credores. Sem inferência de execução.')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
