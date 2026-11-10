"""Recupera contratos e licitações após a correção do CSV Betha, com backup."""
import datetime as dt
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'painel-cidadao'))
import coletor as c
import coletor_betha as b

year = dt.date.today().year
backup = ROOT / 'private/backups' / ('reparo-betha-' + dt.datetime.now().strftime('%Y%m%d-%H%M%S'))
backup.mkdir(parents=True, exist_ok=True)
for name in ('prefeitura', 'camara_betha'):
    file = ROOT / 'painel-cidadao/data/chunks' / (name + '.json')
    shutil.copy2(file, backup / file.name)
    data = json.loads(file.read_text(encoding='utf8'))
    camera = name == 'camara_betha'
    portal = c.PORTAL_HASH_CAMARA if camera else b.PORTAL_HASH
    queries = {'contratos': c.CONSULTA_CAMARA_CONTRATOS if camera else b.CONSULTA_CONTRATOS}
    if not camera:
        queries.update(licit_andamento=b.CONSULTA_LICITACOES_ABERTAS, licit_finalizadas=b.CONSULTA_LICITACOES_FECHADAS)
    for field, query in queries.items():
        try:
            collected = []
            years = (year - 1, year) if field == 'contratos' else (year,)
            for period in years:
                response = b.baixar_dados_abertos(b.get_token(portal_hash=portal), query,
                                                 ano=period, portal_hash=portal, ano_field='anoLicitacao')
                if response.get('coleta_status', 'ok') != 'ok':
                    raise RuntimeError('Exportação parcial; base anterior preservada')
                normalize = c._normaliza_contratos if field == 'contratos' else c._normaliza_licitacoes
                collected.extend(normalize(response['main']))
            if not collected:
                raise RuntimeError('Nenhum registro identificado; base anterior preservada')
            previous = [r for r in data.get(field, []) if r.get('numero') or r.get('objeto') or r.get('cnpj')]
            # Repetições idênticas de exportações anuais não são novos contratos.
            unique = {json.dumps(r, sort_keys=True, ensure_ascii=False): r for r in previous + collected}
            data[field] = list(unique.values())
            if field == 'contratos':
                data['contratos_status_coleta'] = 'coleta_atual_parcial_historico'
            data.setdefault('reparo_csv_betha', {})[field] = {
                'checked_at': dt.datetime.now(dt.timezone.utc).isoformat(),
                'anos_consultados': list(years), 'registros_identificados': len(data[field]),
                'historico': 'Outros anos dependem da coleta completa; não inferir ausência.'}
            print(name, field, len(data[field]), 'registros identificados', flush=True)
        except Exception as error:
            print(name, field, 'preservado:', str(error)[:180], flush=True)
    c._save(name + '.json', data)
print('Backup:', backup.name)
