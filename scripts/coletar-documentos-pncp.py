"""Consulta incremental de documentos e termos do PNCP, sem inferir vínculos comprovados."""
import argparse
import json
import re
import time
import unicodedata
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHUNKS = ROOT / 'painel-cidadao/data/chunks'
ORGAOS = {'18240119000105': 'prefeitura', '04366790000184': 'camara'}
BASE = 'https://pncp.gov.br/pncp-api/v1/orgaos/'

def normal(s):
    return ' '.join(unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().upper().split())

def chave(numero, ano, nome, cnpj, data):
    numero = str(numero or '').strip().lstrip('0')
    raiz = re.sub(r'\D', '', str(cnpj or ''))[:8]
    data = str(data or '')[:10]
    nome = normal(nome)
    if not numero or not str(ano).isdigit() or len(raiz) != 8 or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', data) or not nome:
        return None
    return numero, str(ano), nome, raiz, data

def associacoes(pncp, bases):
    locais = {}
    for orgao, rows in bases.items():
        for c in rows:
            key = chave(c.get('numero'), c.get('ano'), c.get('contratado'), c.get('cnpj'), c.get('data_assinatura'))
            url = c.get('fonte_url', '')
            prefix = 'https://transparencia.betha.cloud/#/' + ('y7mn01LGqd_HCvGtj6VPwA==/consulta/83043/' if orgao == 'prefeitura' else '-iAWLe1kr2VQcrW9k2AUBg==/consulta/324812/') + 'detalhe/'
            if key and url.startswith(prefix) and re.fullmatch(r'[\w:%-]+', url[len(prefix):]):
                locais.setdefault((orgao, key), set()).add(url)
    nacionais = {}
    for c in pncp:
        orgao = ORGAOS.get(str(c.get('cnpj_orgao') or ''))
        key = chave(c.get('numero'), c.get('ano'), c.get('fornecedor'), c.get('cnpj_fornecedor'), c.get('data_assinatura'))
        if orgao and key:
            nacionais.setdefault((orgao, key), []).append(c)
    result = []
    for key, registros in nacionais.items():
        urls = locais.get(key, set())
        if len(registros) == 1 and len(urls) == 1:
            result.append((registros[0], next(iter(urls))))
    return result

def raiz_pncp(contrato):
    controle = str(contrato.get('numero_controle_pncp') or '')
    match = re.fullmatch(r'(\d{14})-2-(\d{6})/(\d{4})', controle)
    if not match or match[1] not in ORGAOS or match[1] != str(contrato.get('cnpj_orgao')):
        raise ValueError('Identificador PNCP inválido')
    return f'{BASE}{match[1]}/contratos/{match[3]}/{int(match[2])}'

def consultar(url):
    time.sleep(2.1)  # PNCP: limite de consultas públicas por minuto
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept':'application/json','User-Agent':'FiscalizaVarginha/1.0'}), timeout=25) as r:
        if r.status == 204: return []
        raw = r.read(2_000_001)
        if len(raw) > 2_000_000: raise ValueError('Resposta excessiva')
        value = json.loads(raw.decode('utf-8'))
        if not isinstance(value, list): raise ValueError('Lista PNCP não reconhecida')
        return value

def documentos(contrato, consulta=consultar):
    raiz = raiz_pncp(contrato)
    lista = []
    def arquivos(path, tipo):
        for d in consulta(path + '/arquivos'):
            if not isinstance(d, dict) or not str(d.get('sequencialDocumento', '')).isdigit():
                raise ValueError('Arquivo PNCP sem identificador reconhecido')
            lista.append({'fonte':'PNCP', 'url':f"{path}/arquivos/{int(d['sequencialDocumento'])}",
                          'titulo':str(d.get('titulo') or 'Arquivo no PNCP'), 'tipo':tipo or str(d.get('tipoDocumentoNome') or 'Documento'),
                          'vinculo':'candidato_por_identidade'})
    arquivos(raiz, '')
    for termo in consulta(raiz + '/termos'):
        if not isinstance(termo, dict) or not str(termo.get('sequencialTermoContrato', '')).isdigit():
            raise ValueError('Termo PNCP sem identificador reconhecido')
        if termo.get('excluido') is True: continue
        arquivos(raiz + '/termos/' + str(int(termo['sequencialTermoContrato'])), 'Termo contratual')
    return lista

def atualizar(catalogo, url, docs, agora, erro=False):
    ficha = catalogo.setdefault(url, {'status':'nao_verificado', 'documentos':[]})
    ficha['pncp_ultima_tentativa'] = agora
    ficha['pncp_ultima_tentativa_status'] = 'inconclusiva' if erro else 'ok'
    if erro: return
    anteriores = {d.get('url'):d for d in ficha.get('fontes_adicionais', []) if isinstance(d, dict) and d.get('url')}
    for doc in docs:
        doc['conferido_em'] = agora
        anterior = anteriores.get(doc['url'], {})
        if anterior.get('vinculo') == 'confirmado_por_leitura':
            doc['vinculo'] = anterior['vinculo']
            if anterior.get('conferencia_manual_em'): doc['conferencia_manual_em'] = anterior['conferencia_manual_em']
        if anterior.get('conferencia_conteudo'): doc['conferencia_conteudo'] = anterior['conferencia_conteudo']
        anteriores[doc['url']] = doc
    ficha['fontes_adicionais'] = list(anteriores.values())

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=15)
    args = parser.parse_args()
    def load(name): return json.loads((CHUNKS / name).read_text(encoding='utf-8-sig'))
    catalogo = load('contratos_documentos.json')
    pncp = load('pncp.json').get('contratos', [])
    historico_pncp = CHUNKS / 'pncp_contratos_historicos.json'
    if historico_pncp.exists():
        for ano in load(historico_pncp.name).get('anos', {}).values():
            pncp += ano.get('contratos', [])
    bases = {}
    for orgao, nome in [('prefeitura','prefeitura'),('camara','camara_betha')]:
        historico = CHUNKS / f'contratos_historico_{orgao}.json'
        bases[orgao] = load(nome+'.json').get('contratos', [])
        if historico.exists(): bases[orgao] += load(historico.name).get('contratos', [])
    matches = associacoes(pncp, bases)
    # Um documento previamente confirmado na leitura também permite renovar a
    # consulta desse identificador; não eleva outros arquivos a confirmados.
    usados = {c.get('numero_controle_pncp') for c, _ in matches}
    for contrato in pncp:
        if contrato.get('numero_controle_pncp') in usados: continue
        try: raiz = raiz_pncp(contrato)
        except ValueError: continue
        fichas = {url for url, info in catalogo.items() for doc in info.get('fontes_adicionais', [])
                  if doc.get('fonte') == 'PNCP' and doc.get('vinculo') == 'confirmado_por_leitura'
                  and re.fullmatch(re.escape(raiz) + r'/arquivos/\d+', str(doc.get('url') or ''))}
        if len(fichas) == 1:
            matches.append((contrato, next(iter(fichas))))
    matches.sort(key=lambda item: catalogo.get(item[1], {}).get('pncp_ultima_tentativa', ''))
    ok = falhas = 0
    for contrato, url in matches[:max(0,args.limit)]:
        now = datetime.now().isoformat(timespec='seconds')
        try:
            docs = documentos(contrato)
            atualizar(catalogo, url, docs, now); ok += 1
        except Exception as exc:
            atualizar(catalogo, url, [], now, erro=True); falhas += 1
            print(f'PNCP: consulta inconclusiva ({type(exc).__name__}); resultado anterior preservado', flush=True)
    target = CHUNKS / 'contratos_documentos.json'
    tmp = target.with_suffix('.json.pncp.tmp')
    tmp.write_text(json.dumps(catalogo, ensure_ascii=False, separators=(',',':')), encoding='utf-8')
    tmp.replace(target)
    state = ROOT / 'private/state/documentos-pncp.json'
    state.parent.mkdir(parents=True, exist_ok=True)
    state_tmp = state.with_suffix('.tmp')
    state_tmp.write_text(json.dumps({'executado_em':datetime.now().isoformat(timespec='seconds'), 'candidatos':len(matches), 'consultas_concluidas':ok, 'inconclusivas':falhas, 'status':'parcial' if falhas else 'ok' if ok else 'sem_candidatos'}, ensure_ascii=False), encoding='utf-8')
    state_tmp.replace(state)
    print(f'PNCP: {len(matches)} vínculos candidatos, {ok} consultas concluídas, {falhas} inconclusivas.', flush=True)

if __name__ == '__main__': main()
