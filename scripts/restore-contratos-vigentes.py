"""Reincorpora contratos plurianuais ainda vigentes perdidos no reparo do CSV Betha.

O reparo de 30/09 reconstruiu a lista só com os anos de licitacao 2025/2026 e
descartou contratos de 2018-2024 que seguem vigentes. A fonte da restauracao e
uma revisao anterior do proprio chunk no Git (padrao: HEAD). So entram registros
com data_fim futura e que nao existam hoje. Idempotente. Uso:
  python scripts/restore-contratos-vigentes.py [--rev HEAD] [--aplicar]
"""
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'painel-cidadao'))
from coletor import _contrato_vigente

CHUNK = ROOT / 'painel-cidadao/data/chunks/prefeitura.json'


def chave(r):
    return tuple(str(r.get(k) or '').strip() for k in ('numero', 'ano', 'cnpj', 'contratado', 'entidade')) + (str(r.get('objeto') or '') if str(r.get('numero') or '') in ('', '0', '-') else '',)


def vigente(r, hoje):
    return _contrato_vigente({'dataVigenciaFinal': r.get('data_fim'), 'situacao': r.get('situacao')}, hoje)


def candidatos(antigos, atuais, hoje):
    existentes = {chave(r) for r in atuais}
    faltam = []
    for r in antigos:
        k = chave(r)
        if k not in existentes and (r.get('numero') or r.get('objeto') or r.get('cnpj')) and vigente(r, hoje):
            faltam.append(r)
            existentes.add(k)
    return faltam


def main():
    rev = sys.argv[sys.argv.index('--rev') + 1] if '--rev' in sys.argv else 'HEAD'
    rev = subprocess.run(['git', 'rev-parse', '--verify', rev + '^{commit}'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    hoje = dt.date.today().isoformat()
    bruto = subprocess.run(['git', 'show', f'{rev}:painel-cidadao/data/chunks/prefeitura.json'],
                           cwd=ROOT, capture_output=True, check=True).stdout
    antigo = json.loads(bruto.decode('utf8'))
    atual = json.loads(CHUNK.read_text(encoding='utf8'))
    faltam = candidatos(antigo.get('contratos', []), atual.get('contratos', []), hoje)
    valor = sum(r.get('valor') or 0 for r in faltam)
    print(f'atual={len(atual["contratos"])} faltam_vigentes={len(faltam)} valor=R$ {valor:,.0f}')
    if '--aplicar' not in sys.argv:
        print('simulacao; use --aplicar para gravar')
        return
    sys.path.insert(0, str(ROOT / 'painel-cidadao'))
    import coletor as c
    atual['contratos'] = atual['contratos'] + faltam
    atual['contratos_historico_restaurado'] = {
        'restaurado_em': dt.datetime.now(dt.timezone.utc).isoformat(), 'origem': f'git {rev}',
        'quantidade': len(faltam), 'criterio': 'contratos de anos anteriores com data_fim futura'}
    c._save('prefeitura.json', atual)
    print('gravado:', len(atual['contratos']), 'contratos')


if __name__ == '__main__':
    main()
