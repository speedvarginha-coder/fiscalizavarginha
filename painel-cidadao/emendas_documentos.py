"""Enriquecimentos documentados do SAPL, sem substituir a evidência original.

A referência é datada e só se aplica à mesma matéria, URL e beneficiário.
Alterações na fonte deixam de receber o complemento e exigem nova conferência.
"""
import json
from pathlib import Path
import unicodedata

REFERENCIA = Path(__file__).resolve().parent / 'data/referencias/emendas-municipais-documentos.json'


def normalize(value):
    return ' '.join(''.join(c for c in unicodedata.normalize('NFD', str(value or ''))
                            if not unicodedata.combining(c)).lower().split())


def enriquecer_emendas(registros):
    if not REFERENCIA.exists():
        return registros
    evidence = json.loads(REFERENCIA.read_text(encoding='utf-8'))
    by_key = {f"{e['numero']}/{e['ano']}": e for e in evidence['emendas']}
    for item in registros:
        ref = by_key.get(f"{item.get('numero')}/{item.get('ano')}")
        if not ref or normalize(ref['beneficiario']) != normalize(item.get('beneficiario')):
            continue
        current_url = str(item.get('pdf') or '').replace('http://', 'https://', 1)
        if current_url != str(ref.get('pdf') or '').replace('http://', 'https://', 1):
            continue
        item['anoProposicao'] = str(item.get('ano') or '')
        item['exercicioOrcamentario'] = ref.get('exercicio')
        item['documentoStatus'] = ref['status']
        item['documentoConferidoEm'] = evidence['conferido_em']
        if ref.get('numero_documento'):
            item['numeroNoDocumento'] = ref['numero_documento']
        value_ref = ref.get('conferencia_valor')
        if value_ref and ref['status'] == 'conferido':
            current_value = item.get('valor_brl')
            if current_value in (value_ref['anterior_painel'], value_ref['cadastro_sapl'], value_ref['documento']):
                item['valor_brl'] = value_ref['documento']
                item['valorReferenciaDocumento'] = value_ref
        shares = ref.get('participacoes')
        if shares and ref['status'] == 'conferido' and abs(sum(p['valor'] for p in shares) - (item.get('valor_brl') or 0)) < 0.01:
            item['participacoesDocumento'] = shares
        fix = ref.get('correcao_cnpj')
        if fix:
            current = str(item.get('cnpj') or '').strip()
            if current == fix['original'] or (current == fix['corrigido'] and item.get('cnpjOriginal') == fix['original']):
                item['cnpjOriginal'] = fix['original']
                item['cnpj'] = fix['corrigido']
                item['cnpjCorrecao'] = {'fonte': fix['fonte'], 'conferidoEm': evidence['conferido_em'],
                                       'criterio': 'CNPJ da instituição conferido em fonte oficial; não comprova execução desta emenda.'}
    return registros
