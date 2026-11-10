"""Conferência limitada nas fontes oficiais. Nunca altera registros do painel."""
from __future__ import annotations
import hashlib, json, re, sys, unicodedata, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHUNKS = ROOT / 'painel-cidadao' / 'data' / 'chunks'
sys.path.insert(0, str(ROOT / 'painel-cidadao'))
import coletor_betha as betha
import coletor_pessoal as pessoal
import coletor

def load(name):
    return json.loads((CHUNKS / (name + '.json')).read_text(encoding='utf-8-sig'))

def norm(value):
    return ' '.join(unicodedata.normalize('NFKD', str(value or '')).encode('ascii', 'ignore').decode().upper().split())

def fingerprint(value):
    return hashlib.sha256(str(value).encode('utf-8')).hexdigest()[:12]

def sample(query, token, body=None):
    result = betha._api('POST', f'/busca-textual/{query}', token, body=body or {},
        params={'sortBy':'id','sortDirection':'ASC','offset':0,'limit':50,'hiperlink':'false'}, timeout=25)
    if not isinstance(result.get('hits'), list): raise ValueError('Resposta sem registros verificáveis')
    return [betha._linha_busca_textual(h, query, betha.PORTAL_HASH) for h in result['hits'] if isinstance(h.get('sourceAsMap'), dict)]

def compare(source, panel, key, fields, limit=5):
    index = {}
    source_counts = {}
    for row in source:
        k = key(row)
        if k: source_counts[k] = source_counts.get(k, 0) + 1
    for row in panel:
        k = key(row)
        if k: index.setdefault(k, []).append(row)
    results=[]
    for row in source:
        k=key(row)
        if not k or source_counts.get(k) != 1 or len(index.get(k,[])) != 1: continue
        other=index[k][0]; checks={}
        for field in fields:
            left,right=row.get(field),other.get(field)
            if left is None or right is None or left == '' or right == '': checks[field]='não comparável'
            elif isinstance(left,(int,float)) and isinstance(right,(int,float)): checks[field]='igual' if abs(left-right)<0.01 else 'divergente'
            else: checks[field]='igual' if norm(left)==norm(right) else 'divergente'
        results.append({'referencia':fingerprint(k),'campos':checks})
        if len(results)>=limit: break
    return results

def payroll(token):
    data=load('pessoal')['prefeitura']; comp=data.get('competencia')
    if not re.fullmatch(r'\d{2}/20\d{2}',str(comp or '')): raise ValueError('Competência indisponível')
    rows=sample(pessoal.PREFEITURA_FOLHA_COMPLETA_ID,token,{'competencia':[comp]})
    source=pessoal._normaliza_betha(rows,'Prefeitura','Consulta oficial amostral')
    for row, raw in zip(source, rows):
        if all(raw.get(k) in (None, '') for k in ('valorRemuneracaoBruta','valorRemuneracaoContratual')): row['vencimentos']=None
        if raw.get('valorRemuneracaoLiquida') in (None, ''): row['liquido']=None
    # Sem matrícula na base: só comparar nomes únicos na competência selecionada.
    records=compare(source,data.get('servidores',[]),lambda x:norm(x.get('nome')),['nome','vencimentos','liquido'])
    return {'competencia':comp,'fonte':pessoal.PREFEITURA_FOLHA_COMPLETA_URL,'registros':records,
            'limite':'Nome único na amostra e na base; competência aplicada na consulta. Homônimos fora da amostra e vínculo não foram descartados.'}

def daily(token):
    rows=sample(betha.CONSULTA_DIARIAS,token)
    source=[]
    for raw in rows:
        normalized=coletor._normaliza_diarias_prefeitura([raw],{})
        if normalized:
            if all(raw.get(k) in (None, '') for k in ('valorPagoEmpenho','valorEmpenho','valorEmpenhado')): normalized[0]['valor_total']=None
            source.extend(normalized)
    records=compare(source,load('diarias').get('prefeitura',[]),
        lambda x:(str(x.get('ano') or ''),str(x.get('numero') or ''),norm(x.get('funcionario'))) if x.get('numero') and x.get('funcionario') else None,
        ['funcionario','numero','data_inicial','valor_total'])
    return {'fonte':'https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83059','registros':records,
            'limite':'A consulta contábil não comprova viagem ou pagamento; só compara pares únicos.'}

def contracts(token):
    candidates=load('prefeitura').get('contratos',[])
    pattern=re.compile(r'https://transparencia\.betha\.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043/detalhe/([\w:%-]+)$')
    counts={}
    for item in candidates:
        url=item.get('fonte_url',''); counts[url]=counts.get(url,0)+1
    records=[]; errors=0
    for item in candidates:
        url=item.get('fonte_url',''); match=pattern.fullmatch(url)
        if not match or counts[url]!=1: continue
        try:
            raw=betha._api('GET',f'/busca/83043/detalhes/{match.group(1)}',token,timeout=25)
            source=coletor._normaliza_contratos([dict(raw,fonte_url=url)])
            if not source: continue
            for key,raw_key in [('numero','numero'),('ano','ano'),('data_assinatura','dataAssinatura'),('contratado','nomeContratado'),('valor','valorFinal')]:
                if raw.get(raw_key) in (None,''): source[0][key]=None
            matched = compare(source,[item],lambda x:x.get('fonte_url'),['numero','ano','data_assinatura','contratado','valor'],limit=1)
            if matched and matched[0]['campos'].get('valor') == 'divergente':
                matched[0]['diferenca'] = {'ficha':url,'numero':str(item.get('numero') or ''), 'ano':str(item.get('ano') or ''),
                    'valor_painel':item.get('valor'),'valor_fonte':source[0].get('valor')}
            records += matched
        except Exception: errors+=1
        if len(records)+errors>=5: break
    return {'fonte':'https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043','registros':records,
            'limite':f'Até cinco fichas individuais; {errors} consulta(s) indisponíveis. Divergências podem refletir retificação ou data de coleta diferente.'}

def amendments():
    import fitz
    rows=[x for x in load('emendas') if x.get('pdf') and x.get('documentoStatus')=='conferido' and x.get('numero') and x.get('valor_brl') is not None]
    for e in rows[:3]:
        u=urllib.parse.urlsplit(e['pdf'])
        if u.hostname != 'sapl.varginha.mg.leg.br' or not u.path.startswith('/media/sapl/public/'): continue
        url=urllib.parse.urlunsplit(('https',u.netloc,u.path,'',''))
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'FiscalizaVarginha/1.0'}),timeout=25) as response: raw=response.read(8*1024*1024+1)
            if len(raw)>8*1024*1024 or not raw.startswith(b'%PDF-'): continue
            doc=fitz.open(stream=raw,filetype='pdf'); text=' '.join(p.get_text() for p in doc); doc.close()
            normalized=norm(text); beneficiary=norm(e.get('beneficiario'))
            if len(beneficiary)<10 or beneficiary not in normalized: continue
            value=f"{float(e['valor_brl']):,.2f}".replace(',','_').replace('.',',').replace('_','.')
            if value not in text: continue
            return {'fonte':url,'registros':[{'referencia':fingerprint(str(e.get('numero'))+'/'+str(e.get('ano'))),
              'campos':{'beneficiario':'igual','valor':'igual','numero':'não comparável','data':'não comparável'}}],
              'limite':'Nome e valor aparecem no texto do PDF; sua associação à mesma emenda, numeração, data e execução exigem conferência humana.'}
        except Exception: continue
    return {'fonte':'https://sapl.varginha.mg.leg.br/','registros':[],'limite':'PDF inacessível ou identidade e valor não puderam ser conferidos; não se presume divergência.'}

def run():
    report={'executado_em':datetime.now(timezone.utc).isoformat(),'metodo':'amostra limitada por fonte; sem correção automática', 'conjuntos':{}}
    try: token=betha.get_token()
    except Exception: token=None
    for name,fn in [('salarios',payroll),('diarias',daily),('contratos',contracts),('emendas',lambda _token:amendments())]:
        try:
            if not token and name!='emendas': raise RuntimeError('Fonte indisponível')
            result=fn(token)
            fields=[v for row in result.get('registros',[]) for v in row.get('campos',{}).values()]
            result['status'] = ('divergente' if 'divergente' in fields else 'parcial' if 'não comparável' in fields
                                else 'conferido' if result.get('registros') else 'inconclusivo')
        except Exception as exc: result={'status':'indisponivel','registros':[],'limite':f'Não foi possível consultar ou identificar amostra: {type(exc).__name__}.'}
        report['conjuntos'][name]=result
    target=ROOT/'private/state/conferencia-amostral.json'; target.parent.mkdir(parents=True,exist_ok=True)
    tmp=target.with_suffix('.tmp');tmp.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');tmp.replace(target)
    archive=ROOT/'private/logs/conferencia-amostral.ndjson'; archive.parent.mkdir(parents=True,exist_ok=True)
    with archive.open('a',encoding='utf-8') as out: out.write(json.dumps(report,ensure_ascii=False,separators=(',',':'))+'\n')
    print('Amostras:', ', '.join(f'{k}={v["status"]} ({len(v["registros"])})' for k,v in report['conjuntos'].items()))
    return report

if __name__=='__main__': run()
