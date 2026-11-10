"""Busca referências em extratos integrais, preservando ambiguidades e fontes."""
import argparse, importlib.util, json, re, tempfile, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path
import fitz

ROOT=Path(__file__).resolve().parents[1];CHUNKS=ROOT/'painel-cidadao/data/chunks'
STATE=ROOT/'private/state/diario-documentos.json'
MAX_BYTES=64*1024*1024
MAX_PAGES=500
MAX_TEXT=8*1024*1024
spec=importlib.util.spec_from_file_location('diario',ROOT/'scripts/reconciliar-diario-contratos.py')
diario=importlib.util.module_from_spec(spec);spec.loader.exec_module(diario)
def ler(path,default):
 try:return json.loads(path.read_text(encoding='utf8'))
 except (OSError,ValueError):return default
def blocos(texto):
 # Cada registro começa em um cabeçalho explícito. Não cruzar uma referência
 # e um fornecedor de artigos diferentes na mesma página.
 return [s for s in re.split(r'(?im)(?=^\s*(?:EXTRATO\s+DE\s+(?:CONTRATO|TERMO|ADITIVO)|ADITIVO\s*N[º°O.]|CONTRATO\s*[:]))',texto) if len(s.strip())>30]
def extrair_paginas(pages,bases,pdf,agora):
 index={}
 for orgao,rows in bases.items():
  for c in rows:
   number=str(c.get('numero') or '').lstrip('0'); year=str(c.get('ano') or ''); nome=diario.norm(c.get('contratado')); ficha=c.get('fonte_url','')
   if number and year.isdigit() and len(nome)>=10 and ficha.startswith('https://transparencia.betha.cloud/#/'):
    index.setdefault((orgao,number,year,nome),set()).add(ficha)
 found=[]
 for pagina,texto in enumerate(pages,1):
  for bloco in blocos(texto):
   text=diario.norm(bloco)
   if 'MUNICIPIO DE VARGINHA' not in text and 'PREFEITURA MUNICIPAL DE VARGINHA' not in text:continue
   refs={(n.lstrip('0'),a) for n,a in re.findall(r'\bCONTRATO\s*(?:(?:DE\s+LOCACAO\s+DE\s+IMOVEL|DE)\s*)?(?:N[O.]?\s*)?[:.\-]?\s*(\d{1,6})\s*/\s*(20\d{2})\b',text)}
   if len(refs)!=1:continue
   number,year=next(iter(refs)); candidatos=set()
   for (orgao,n,a,nome),urls in index.items():
    if orgao=='prefeitura' and n==number and a==year and nome in text:candidatos.update(urls)
   if len(candidatos)!=1:continue
   kind='Extrato de aditivo' if 'ADITIVO' in text else 'Extrato de contrato'
   doc={'fonte':'Diário Oficial','url':pdf+'#page='+str(pagina),'titulo':f'{kind} · contrato {number}/{year}', 'tipo':kind,'vinculo':'candidato_por_identidade','conferido_em':agora}
   found.append((next(iter(candidatos)),doc))
 return found
def run(limit):
 data=ler(CHUNKS/'publicacoes_diario.json',{});cat=ler(CHUNKS/'contratos_documentos.json',{})
 state=ler(STATE,{'edicoes':{}});state.setdefault('edicoes',{})
 urls={p.get('links',{}).get('anexo_pdf') for p in data.get('publicacoes',[]) if p.get('tipo') in ('contrato','aditivo')}
 urls=[u for u in urls if isinstance(u,str) and diario.PDF.fullmatch(u) and '#page=' not in u]
 def prioridade(u):
  item=state['edicoes'].get(u,{})
  return (0 if not item else 1 if item.get('status')=='inconclusiva' else 2, item.get('ultima_tentativa',''))
 urls.sort(key=prioridade)
 bases={}
 for orgao,name in [('prefeitura','prefeitura'),('camara','camara_betha')]:
  bases[orgao]=ler(CHUNKS/(name+'.json'),{}).get('contratos',[])+ler(CHUNKS/('contratos_historico_'+orgao+'.json'),{}).get('contratos',[])
 ok=failed=found=0
 for url in urls[:max(0,limit)]:
  now=datetime.now(timezone.utc).isoformat(timespec='seconds')
  try:
   request=urllib.request.Request(url,headers={'User-Agent':'FiscalizaVarginha/1.0 (controle-social)'})
   STATE.parent.mkdir(parents=True,exist_ok=True)
   with tempfile.TemporaryDirectory(prefix='diario-',dir=STATE.parent) as pasta:
    arquivo=Path(pasta)/'edicao.pdf'
    with urllib.request.urlopen(request,timeout=60) as r, arquivo.open('wb') as out:
     final=urllib.parse.urlsplit(r.geturl())
     if final.scheme!='https' or final.hostname!='www.varginha.mg.gov.br' or not final.path.startswith('/uploads/'):raise ValueError('Origem redirecionada')
     size=0;first=True
     while True:
      block=r.read(256*1024)
      if not block:break
      if first and not block.startswith(b'%PDF-'):raise ValueError('PDF não reconhecido')
      first=False;size+=len(block)
      if size>MAX_BYTES:raise ValueError('PDF acima do limite de 64 MB')
      out.write(block)
     if first:raise ValueError('Resposta vazia')
    with fitz.open(str(arquivo)) as pdf:
     if len(pdf)>MAX_PAGES:raise ValueError('PDF com número excessivo de páginas')
     pages=[];total=0
     for page in pdf:
      text=page.get_text();total+=len(text)
      if total>MAX_TEXT:raise ValueError('Texto acima do limite de extração')
      pages.append(text)
   if not any(text.strip() for text in pages):raise ValueError('PDF sem texto extraível')
   rows=extrair_paginas(pages,bases,url,now)
   for ficha,doc in rows:
    item=cat.setdefault(ficha,{'status':'nao_verificado','documentos':[]});docs=item.setdefault('fontes_adicionais',[])
    if not any(d.get('fonte')=='Diário Oficial' and d.get('url')==doc['url'] for d in docs):docs.append(doc);found+=1
   state['edicoes'][url]={'ultima_tentativa':now,'ultima_concluida':now,'status':'ok','candidatos':len(rows)};ok+=1
  except Exception as exc:
   prev=state['edicoes'].get(url,{})
   safe_reason=str(exc) if isinstance(exc,ValueError) else type(exc).__name__
   state['edicoes'][url]={**prev,'ultima_tentativa':now,'status':'inconclusiva','motivo':safe_reason};failed+=1
  time.sleep(.5)
 target=CHUNKS/'contratos_documentos.json';tmp=target.with_suffix('.pdfdiario.tmp');tmp.write_text(json.dumps(cat,ensure_ascii=False,separators=(',',':')),encoding='utf8');tmp.replace(target)
 state['ultima_rodada']={'executado_em':datetime.now(timezone.utc).isoformat(timespec='seconds'),'edicoes_concluidas':ok,'inconclusivas':failed,'novos_candidatos':found}
 STATE.parent.mkdir(parents=True,exist_ok=True);tmp=STATE.with_suffix('.tmp');tmp.write_text(json.dumps(state,ensure_ascii=False),encoding='utf8');tmp.replace(STATE)
 print(f'Diário integral: {ok} edições lidas; {failed} inconclusivas; {found} novos vínculos candidatos.')
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--limit',type=int,default=5);run(parser.parse_args().limit)
