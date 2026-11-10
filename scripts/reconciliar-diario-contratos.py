"""Sugere extratos do Diário somente com órgão, contrato e fornecedor identificados."""
import json, re, unicodedata
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CHUNKS=ROOT/'painel-cidadao/data/chunks'
PDF=re.compile(r'https://www\.varginha\.mg\.gov\.br/uploads/diario_[A-Za-z0-9]+\.pdf(?:#page=\d+)?')

def norm(s): return ' '.join(unicodedata.normalize('NFKD', str(s or '')).encode('ascii','ignore').decode().upper().split())

def candidatos(publicacoes, bases):
    index={}
    for orgao, rows in bases.items():
        for c in rows:
            n=str(c.get('numero') or '').lstrip('0'); ano=str(c.get('ano') or '')
            nome=norm(c.get('contratado')); url=str(c.get('fonte_url') or '')
            if n and ano.isdigit() and len(nome)>=10 and url.startswith('https://transparencia.betha.cloud/#/'):
                index.setdefault((orgao,n,ano,nome),set()).add(url)
    output=[]
    for p in publicacoes:
        if p.get('tipo') not in ('contrato','aditivo'): continue
        ent=p.get('envolvidos') if isinstance(p.get('envolvidos'),list) else []
        orgaos={norm(x.get('nome')) for x in ent if isinstance(x,dict) and x.get('papel')=='orgao'}
        orgao = 'prefeitura' if orgaos & {'PREFEITURA DE VARGINHA','MUNICIPIO DE VARGINHA'} else 'camara' if orgaos & {'CAMARA MUNICIPAL DE VARGINHA','CAMARA DE VARGINHA'} else None
        if not orgao or len(orgaos)!=1: continue
        texto=norm((p.get('titulo') or '')+' '+(p.get('resumo') or ''))
        refs={(n.lstrip('0'),a) for n,a in re.findall(r'\bCONTRATO\s*(?:(?:DE\s+LOCACAO\s+DE\s+IMOVEL|DE)\s*)?(?:N[O.]?\s*)?[:.\-]?\s*(\d{1,6})\s*/\s*(20\d{2})\b',texto)}
        if len(refs)!=1: continue
        n,ano=next(iter(refs))
        nomes={norm(x.get('nome')) for x in ent if isinstance(x,dict) and x.get('papel')=='empresa' and len(norm(x.get('nome')))>=10}
        urls=set().union(*(index.get((orgao,n,ano,nome),set()) for nome in nomes)) if nomes else set()
        pdf=(p.get('links') or {}).get('anexo_pdf','')
        if len(urls)!=1 or not PDF.fullmatch(pdf): continue
        page=p.get('pagina') or (p.get('valores') or {}).get('pagina')
        if isinstance(page,int) and page>0: pdf += '#page='+str(page)
        output.append((next(iter(urls)), {'fonte':'Diário Oficial','url':pdf,'titulo':str(p.get('titulo') or 'Extrato oficial'), 'tipo':'Extrato de '+p['tipo'], 'vinculo':'candidato_por_identidade','conferido_em':str(p.get('data') or '')}))
    return output

def main():
    load=lambda n:json.loads((CHUNKS/n).read_text(encoding='utf-8-sig'))
    cat=load('contratos_documentos.json')
    bases={}
    for orgao,arquivo in [('prefeitura','prefeitura.json'),('camara','camara_betha.json')]:
        hist=CHUNKS/f'contratos_historico_{orgao}.json'
        bases[orgao]=load(arquivo).get('contratos',[])+(load(hist.name).get('contratos',[]) if hist.exists() else [])
    encontrados=candidatos(load('publicacoes_diario.json').get('publicacoes',[]),bases)
    for url,doc in encontrados:
        entry=cat.setdefault(url,{'status':'nao_verificado','documentos':[]})
        docs=entry.setdefault('fontes_adicionais',[])
        if not any(d.get('url')==doc['url'] and d.get('titulo')==doc['titulo'] for d in docs): docs.append(doc)
    target=CHUNKS/'contratos_documentos.json'; tmp=target.with_suffix('.diario.tmp')
    tmp.write_text(json.dumps(cat,ensure_ascii=False,separators=(',',':')),encoding='utf8');tmp.replace(target)
    print(f'Diário: {len(encontrados)} extratos candidatos; associação exige conferência do documento.')
if __name__=='__main__':main()
