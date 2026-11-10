"""Amostra PDFs do PNCP; identifica texto e nunca certifica integridade jurídica."""
import argparse, hashlib, json, re, shutil, subprocess, tempfile, time, unicodedata, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path
import fitz
ROOT=Path(__file__).resolve().parents[1]; CHUNKS=ROOT/'painel-cidadao/data/chunks'
VALID=re.compile(r'https://pncp\.gov\.br/pncp-api/v1/orgaos/(?:18240119000105|04366790000184)/contratos/\d{4}/\d+(?:/termos/\d+)?/arquivos/\d+')
def norm(s):return ' '.join(unicodedata.normalize('NFKD',str(s or '')).encode('ascii','ignore').decode().upper().split())
def avaliar(texto,contrato):
 text=norm(texto);numero=str(contrato.get('numero') or '').lstrip('0');ano=str(contrato.get('ano') or '');nome=norm(contrato.get('contratado'))
 ref=bool(numero and ano.isdigit() and re.search(r'(?<!\d)0*'+re.escape(numero)+r'\s*[/.-]\s*'+re.escape(ano)+r'(?!\d)',text))
 plain=lambda s:' '.join(re.sub(r'[^A-Z0-9]+',' ',s).split())
 nome_ok=len(plain(nome))>=10 and plain(nome) in plain(text)
 root=re.sub(r'\D','',str(contrato.get('cnpj') or ''))[:8]
 cnpjs=re.findall(r'(?<!\d)\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}(?!\d)',text)
 cnpj_ok=len(root)==8 and any(re.sub(r'\D','',n)[:8]==root for n in cnpjs)
 status='referencia_e_fornecedor_encontrados' if ref and nome_ok else 'referencia_e_cnpj_encontrados' if ref and cnpj_ok else 'revisao_necessaria'
 return {'texto_extraido':bool(text),'referencia_encontrada':ref,'fornecedor_encontrado':nome_ok,'cnpj_raiz_encontrada':cnpj_ok,'status':status}
def ler_ocr(pdf):
 executable=shutil.which('tesseract')
 if not executable:return '', 'indisponivel'
 folder=ROOT/'private/state';folder.mkdir(parents=True,exist_ok=True)
 try:
  with tempfile.TemporaryDirectory(prefix='ocr-pncp-',dir=folder) as tmp:
   textos=[]
   for numero in range(min(2,len(pdf))):
    image=Path(tmp)/f'pagina-{numero+1}.png';pdf[numero].get_pixmap(matrix=fitz.Matrix(1.7,1.7),alpha=False).save(str(image))
    result=subprocess.run([executable,str(image),'stdout','-l','eng'],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=45,check=False)
    if result.returncode:raise RuntimeError('Falha no OCR')
    textos.append(result.stdout[:500000])
   return ' '.join(textos),'concluido'
 except (OSError,subprocess.TimeoutExpired,RuntimeError):return '', 'inconclusivo'
def read(p,d):
 try:return json.loads(p.read_text(encoding='utf8'))
 except (OSError,ValueError):return d
def run(limit, apenas_pendentes=False, apenas_revisao=False, ocr=False):
 path=CHUNKS/'contratos_documentos.json';cat=read(path,{})
 index={}
 for agency,name in [('prefeitura','prefeitura'),('camara','camara_betha')]:
  rows=read(CHUNKS/(name+'.json'),{}).get('contratos',[])+read(CHUNKS/('contratos_historico_'+agency+'.json'),{}).get('contratos',[])
  for r in rows:
   if r.get('fonte_url'):index.setdefault(r['fonte_url'],[]).append(r)
 jobs=[]
 for ficha,entry in cat.items():
  candidates=index.get(ficha,[])
  identities={(str(c.get('numero')),str(c.get('ano')),norm(c.get('contratado'))) for c in candidates}
  if len(identities)!=1:continue
  for d in entry.get('fontes_adicionais',[]):
   if d.get('fonte')=='PNCP' and VALID.fullmatch(d.get('url','')) and (not apenas_pendentes or not (d.get('conferencia_conteudo') or {}).get('ultima_tentativa')) and (not apenas_revisao or (d.get('conferencia_conteudo') or {}).get('status')=='revisao_necessaria'):
    jobs.append((ficha,candidates[0],d))
 jobs.sort(key=lambda x:str((x[2].get('conferencia_conteudo') or {}).get('ultima_tentativa') or ''))
 ok=fail=0
 for ficha,contract,doc in jobs[:max(0,limit)]:
  now=datetime.now(timezone.utc).isoformat(timespec='seconds')
  try:
   req=urllib.request.Request(doc['url'],headers={'User-Agent':'FiscalizaVarginha/1.0 (controle-social)'})
   with urllib.request.urlopen(req,timeout=25) as r:
    final=urllib.parse.urlsplit(r.geturl())
    if final.scheme!='https' or final.hostname!='pncp.gov.br':raise ValueError('Origem não reconhecida')
    raw=r.read(8*1024*1024+1)
   if len(raw)>8*1024*1024 or not raw.startswith(b'%PDF-'):raise ValueError('Arquivo inacessível, não PDF ou acima de 8 MB')
   with fitz.open(stream=raw,filetype='pdf') as pdf:
    if len(pdf)>150:raise ValueError('Documento acima do limite de páginas')
    text=' '.join(page.get_text() for page in pdf)
    metodo='texto_pdf';ocr_status='nao_necessario'
    if ocr and not text.strip():
     text,ocr_status=ler_ocr(pdf);metodo='ocr_primeiras_duas_paginas'
   result=avaliar(text,contract);result.update({'metodo':metodo,'ocr_status':ocr_status,'ultima_tentativa':now,'ultima_concluida':now,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
   doc['conferencia_conteudo']=result;ok+=1
  except Exception as exc:
   prev=doc.get('conferencia_conteudo') or {}
   doc['conferencia_conteudo']={**prev,'ultima_tentativa':now,'ultima_tentativa_status':'inconclusiva','motivo':type(exc).__name__};fail+=1
  time.sleep(2.1)
 tmp=path.with_suffix('.conteudopncp.tmp');tmp.write_text(json.dumps(cat,ensure_ascii=False,separators=(',',':')),encoding='utf8');tmp.replace(path)
 print(f'PDFs PNCP: {ok} lidos, {fail} inconclusivos; resultado é triagem, não certificação.')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--limit',type=int,default=5);p.add_argument('--apenas-pendentes',action='store_true');p.add_argument('--apenas-revisao',action='store_true');p.add_argument('--ocr',action='store_true');args=p.parse_args();run(args.limit,args.apenas_pendentes,args.apenas_revisao,args.ocr)
