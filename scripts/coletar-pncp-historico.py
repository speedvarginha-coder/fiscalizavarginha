"""Guarda contratos PNCP de anos anteriores sem apagar coleta válida em falhas."""
import argparse,json,sys
from datetime import datetime,timezone,timedelta
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'painel-cidadao'))
import coletor_pncp
OUT=ROOT/'painel-cidadao/data/chunks/pncp_contratos_historicos.json'
def run(ano=2025):
 try:data=json.loads(OUT.read_text(encoding='utf8'))
 except (OSError,ValueError):data={'anos':{}}
 prev=data.setdefault('anos',{}).get(str(ano),{})
 now=datetime.now(timezone.utc)
 try:last=datetime.fromisoformat(str(prev.get('ultima_tentativa_em') or '').replace('Z','+00:00'))
 except ValueError:last=None
 if last and last.tzinfo and now-last<timedelta(days=7):
  print(f'PNCP {ano}: tentativa recente; base preservada.');return
 rows,urls,ok,details=coletor_pncp._coleta_contratos(ano)
 rec={'ano':ano,'ultima_tentativa_em':now.isoformat(timespec='seconds'),'status':'ok' if ok else 'parcial','orgaos':details['orgaos'],'consultas':urls}
 if ok and (not prev.get('contratos') or not coletor_pncp._coverage_drop(rows,prev['contratos'])):
  rec['contratos']=rows;rec['ultima_coleta_bem_sucedida_em']=rec['ultima_tentativa_em']
 else:
  rec['contratos']=prev.get('contratos',[]);rec['ultima_coleta_bem_sucedida_em']=prev.get('ultima_coleta_bem_sucedida_em');rec['status']='preservado';rec['motivo']='Falha parcial ou queda anormal de cobertura.'
 data['anos'][str(ano)]=rec
 tmp=OUT.with_suffix('.tmp');tmp.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf8');tmp.replace(OUT)
 print(f"PNCP {ano}: {len(rec['contratos'])} registros; situação {rec['status']}.")
def rodizio():
 try:data=json.loads(OUT.read_text(encoding='utf8')).get('anos',{})
 except (OSError,ValueError):data={}
 ano=min((2021,2022,2023,2024,2025),key=lambda y:str(data.get(str(y),{}).get('ultima_tentativa_em') or ''))
 run(ano)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--ano',type=int,choices=range(2021,2026));p.add_argument('--rodizio',action='store_true');args=p.parse_args()
 if args.rodizio:rodizio()
 else:run(args.ano or 2025)
