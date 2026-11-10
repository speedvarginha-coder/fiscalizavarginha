"""Vincula empenhos à execução apenas quando a Betha comprova a identidade."""
import argparse, importlib.util, json, re, sys, time, unicodedata
from datetime import datetime,timezone
from decimal import Decimal,InvalidOperation
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];CHUNKS=ROOT/'painel-cidadao/data/chunks';sys.path.insert(0,str(ROOT/'painel-cidadao'))
spec=importlib.util.spec_from_file_location('audit_betha',ROOT/'scripts/auditar-documentos-contratos.py');audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
PREFIX='https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/'
STATE=ROOT/'private/state/execucao-contratos.json'
def salvar_estado(status,confirmados,inconclusivos):
 STATE.parent.mkdir(parents=True,exist_ok=True)
 temp=STATE.with_suffix('.tmp');temp.write_text(json.dumps({'executado_em':datetime.now(timezone.utc).isoformat(timespec='seconds'),'status':status,'confirmados':confirmados,'inconclusivos':inconclusivos},ensure_ascii=False),encoding='utf8');temp.replace(STATE)
def norm(v):return ' '.join(unicodedata.normalize('NFKD',str(v or '')).encode('ascii','ignore').decode().upper().split())
def digits(v):return re.sub(r'\D','',str(v or ''))
def nomes_compativeis(a,b):
 def tokens(value):
  items=re.findall(r'[A-Z0-9]+',norm(value))
  while items and items[-1] in {'LTDA','EIRELI','ME','EPP','SA'}:items.pop()
  return items
 left,right=tokens(a),tokens(b)
 if len(left)<3 or len(left)!=len(right):return False
 return all(x==y or (len(min(x,y,key=len))>=4 and (x.startswith(y) or y.startswith(x))) for x,y in zip(left,right))
def money(v):
 try:
  d=Decimal(str(v));return d if d.is_finite() else None
 except (ValueError,InvalidOperation,TypeError):return None
def identificar(ficha, contrato, empenho, hit, detalhe):
 match=re.fullmatch(re.escape(PREFIX)+r'83043/detalhe/(\d+):(\d+):[\w%-]+',ficha)
 ident=str(hit.get('id') or '')
 if not match or not re.fullmatch(re.escape(match[1]+':'+match[2]+':')+r'[\w%-]+',ident):return None
 data=str(empenho.get('data') or '')[:10];ano=str(empenho.get('ano') or ''); numero=str(empenho.get('numero') or '').lstrip('0')
 if not re.fullmatch(r'20\d{2}-\d{2}-\d{2}',data) or data[:4]!=ano or not numero.isdigit():return None
 if str(detalhe.get('numeroEmpenho') or '').lstrip('0')!=numero or str(detalhe.get('anoExercicio') or '')!=ano or str(detalhe.get('dataEmpenho') or '')[:10]!=data:return None
 credor=detalhe.get('credor') if isinstance(detalhe.get('credor'),dict) else {}
 nome=norm(contrato.get('contratado')); root=digits(contrato.get('cnpj'))[:8]; actual=digits(credor.get('cnpjCpfCredor'))[:8]
 if ('/' not in str(contrato.get('cnpj') or '') and len(digits(contrato.get('cnpj')))!=14) or ('/' not in str(credor.get('cnpjCpfCredor') or '') and len(digits(credor.get('cnpjCpfCredor')))!=14):return None
 if len(nome)<10 or not nomes_compativeis(nome,credor.get('nomeCredor')) or len(root)!=8 or root!=actual:return None
 contrato_numero=str(contrato.get('numero') or '').lstrip('0')
 if not contrato_numero or str((detalhe.get('contrato') or {}).get('numero') or '').lstrip('0')!=contrato_numero:return None
 a=money(empenho.get('valor'));b=money(detalhe.get('valorEmpenho'))
 if a is None or b is None or abs(a-b)>Decimal('0.01'):return None
 return PREFIX+'82995/detalhe/'+ident
def explicar_divergencia(contrato, empenho, detalhe):
 """Expõe apenas critérios divergentes, sem publicar identificadores pessoais."""
 motivos=[]
 data=str(empenho.get('data') or '')[:10]; ano=str(empenho.get('ano') or '')
 if not re.fullmatch(r'20\d{2}-\d{2}-\d{2}',data) or data[:4]!=ano or str(detalhe.get('dataEmpenho') or '')[:10]!=data:motivos.append('data do empenho')
 numero=str(contrato.get('numero') or '').lstrip('0')
 if not numero or str((detalhe.get('contrato') or {}).get('numero') or '').lstrip('0')!=numero:motivos.append('número do contrato ausente ou diferente')
 a=money(empenho.get('valor'));b=money(detalhe.get('valorEmpenho'))
 if a is None or b is None or abs(a-b)>Decimal('0.01'):motivos.append('valor do empenho')
 credor=detalhe.get('credor') if isinstance(detalhe.get('credor'),dict) else {}
 if not nomes_compativeis(contrato.get('contratado'),credor.get('nomeCredor')):motivos.append('identificação do fornecedor')
 return ', '.join(motivos) if motivos else 'identidade não confirmada pelos critérios completos'
def resumo(detalhe,fonte,agora):
 def num(v):
  n=money(v);return float(n) if n is not None else None
 def lista(field,keys):
  value=detalhe.get(field)
  if not isinstance(value,list) or not all(isinstance(x,dict) for x in value):return None
  output=[]
  for item in value:
   row={}
   for key in keys:
    v=item.get(key)
    if key in ('valor','valorPagamento','valorDocumento'):
     n=num(v)
     if n is not None:row[key]=n
    elif isinstance(v,(str,int)) and not isinstance(v,bool):row[key]=v
   output.append(row)
  return output
 return {'fonte_url':fonte,'consultado_em':agora,'valor_empenho':num(detalhe.get('valorEmpenho')),'valor_liquidado':num(detalhe.get('valorLiquidadoEmpenho')),'valor_pago':num(detalhe.get('valorPagoEmpenho')),
         'liquidacoes':lista('liquidacoes',('data','valor')),'pagamentos':lista('pagamentos',('dataPagamento','valorPagamento','parcelaEmpenho')),
         'documentos_fiscais':lista('documentosFiscais',('tipo','numero','dataEmissao','valorDocumento'))}
def run(limit,ficha_filtro=None):
 read=lambda p,d:json.loads(p.read_text(encoding='utf8')) if p.exists() else d
 path=CHUNKS/'contratos_documentos.json';catalog=read(path,{})
 index={}
 for name in ('prefeitura.json','contratos_historico_prefeitura.json'):
  for c in read(CHUNKS/name,{}).get('contratos',[]):
   if c.get('fonte_url'):index.setdefault(c['fonte_url'],[]).append(c)
 jobs=[]
 for ficha,entry in catalog.items():
  if ficha_filtro and ficha!=ficha_filtro:continue
  rows=index.get(ficha,[]); identities={(str(c.get('numero')),str(c.get('ano')),norm(c.get('contratado')),digits(c.get('cnpj'))[:8]) for c in rows}
  if len(identities)!=1:continue
  for e in (entry.get('trilha') or {}).get('empenhos') or []:
   if norm(e.get('tipo'))=='EMPENHAR' and str(e.get('numero') or '').isdigit() and str(e.get('ano') or '').isdigit():jobs.append((ficha,rows[0],e))
 jobs.sort(key=lambda x:str((x[2].get('execucao') or {}).get('ultima_tentativa') or ''))
 if not jobs or limit<=0:
  salvar_estado('sem_elegiveis',0,0);print('Execução de empenhos: nenhuma ficha elegível nesta rodada.');return
 try:token=audit.token_publico()
 except Exception as exc:
  salvar_estado('indisponivel',0,0);print(f'Execução de empenhos indisponível ({type(exc).__name__}); evidências anteriores preservadas.');return
 ok=failed=0
 for ficha,c,e in jobs[:max(0,limit)]:
  now=datetime.now(timezone.utc).isoformat(timespec='seconds')
  fonte_consultada=None
  try:
   result=audit.b._api('POST','/busca-textual/82995',token,body={'anoExercicio':[int(e['ano'])],'numeroEmpenho':[str(e['numero'])]},params={'sortBy':'dataEmpenho','sortDirection':'ASC','offset':0,'limit':2,'hiperlink':'false'},timeout=25)
   hits=result.get('hits')
   if result.get('totalHits')!=1 or not isinstance(hits,list) or len(hits)!=1:raise ValueError('Busca sem identificação única')
   ident=str(hits[0].get('id') or '')
   if not re.fullmatch(r'\d+:\d+:[\w%-]+',ident):raise ValueError('Identificador não reconhecido')
   detalhe=audit.b._api('GET','/busca/82995/detalhes/'+ident,token,timeout=25)
   prefixo=ficha.rsplit('/',1)[-1].split(':')[:2]
   if ident.split(':')[:2]==prefixo:fonte_consultada=PREFIX+'82995/detalhe/'+ident
   fonte=identificar(ficha,c,e,hits[0],detalhe)
   if not fonte:raise ValueError('Não confirmado: '+explicar_divergencia(c,e,detalhe))
   record=resumo(detalhe,fonte,now);record.update({'status':'confirmado_na_fonte','ultima_tentativa':now})
   e['execucao']=record;ok+=1
  except Exception as exc:
   e['execucao']={**(e.get('execucao') or {}),'ultima_tentativa':now,'ultima_tentativa_status':'inconclusiva','motivo':str(exc) if isinstance(exc,ValueError) else type(exc).__name__};failed+=1
   if fonte_consultada:e['execucao']['fonte_consultada']=fonte_consultada
  time.sleep(.5)
 tmp=path.with_suffix('.execucao.tmp');tmp.write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':')),encoding='utf8');tmp.replace(path)
 salvar_estado('parcial' if failed else 'ok',ok,failed)
 print(f'Execução de empenhos: {ok} vínculos confirmados; {failed} consultas inconclusivas; nenhuma entrega foi presumida.')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--limit',type=int,default=10);p.add_argument('--ficha');args=p.parse_args()
 if args.ficha and not audit.FICHA.fullmatch(args.ficha):p.error('Ficha oficial não reconhecida')
 run(args.limit,args.ficha)
