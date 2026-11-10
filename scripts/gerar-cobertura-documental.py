"""Publica apenas indicadores agregados sobre documentos e amostragem."""
import importlib.util, json, re
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; CHUNKS=ROOT/'painel-cidadao/data/chunks'
spec=importlib.util.spec_from_file_location('pncp_docs',ROOT/'scripts/coletar-documentos-pncp.py')
pncp_docs=importlib.util.module_from_spec(spec);spec.loader.exec_module(pncp_docs)
def read(path,default):
 try:return json.loads(path.read_text(encoding='utf-8-sig'))
 except (ValueError,OSError):return default
def gerar():
 catalog=read(CHUNKS/'contratos_documentos.json',{}); pncp=read(CHUNKS/'pncp.json',{})
 bases={}
 for orgao,nome in [('prefeitura','prefeitura'),('camara','camara_betha')]:
  bases[orgao]=read(CHUNKS/(nome+'.json'),{}).get('contratos',[])+read(CHUNKS/('contratos_historico_'+orgao+'.json'),{}).get('contratos',[])
 atual={c.get('fonte_url'):c for c in read(CHUNKS/'prefeitura.json',{}).get('contratos',[]) if c.get('fonte_url')}
 matches=pncp_docs.associacoes(pncp.get('contratos',[]),bases)
 successes=[r.get('pncp_ultima_tentativa') for r in catalog.values() if r.get('pncp_ultima_tentativa_status')=='ok' and r.get('pncp_ultima_tentativa')]
 attempts=[r.get('pncp_ultima_tentativa') for r in catalog.values() if r.get('pncp_ultima_tentativa')]
 state=read(ROOT/'private/state/documentos-pncp.json',{})
 historical=read(CHUNKS/'pncp_contratos_historicos.json',{}).get('anos',{})
 diario_state=read(ROOT/'private/state/diario-documentos.json',{})
 execucao_state=read(ROOT/'private/state/execucao-contratos.json',{})
 edicoes=diario_state.get('edicoes',{})
 pdfs=[d for row in catalog.values() for d in row.get('fontes_adicionais',[]) if d.get('fonte')=='PNCP']
 execucoes=[e.get('execucao') or {} for r in catalog.values() for e in ((r.get('trilha') or {}).get('empenhos') or []) if e.get('execucao')]
 sample=read(ROOT/'private/state/conferencia-amostral.json',{})
 results={}
 for name,item in sample.get('conjuntos',{}).items():
  if name not in ('salarios','diarias','contratos','emendas') or not isinstance(item,dict):continue
  rows=item.get('registros') if isinstance(item.get('registros'),list) else []
  results[name]={'status':item.get('status','inconclusivo'),'registros':len(rows),'divergencias':sum(1 for row in rows if 'divergente' in (row.get('campos') or {}).values()),'limite':str(item.get('limite') or '')}
  if name=='contratos':
   detalhes=[]
   for row in rows:
    dif=row.get('diferenca') or {}; url=str(dif.get('ficha') or '')
    if not url.startswith('https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043/detalhe/') or not isinstance(dif.get('valor_painel'),(int,float)) or not isinstance(dif.get('valor_fonte'),(int,float)):continue
    correcao=(catalog.get(url) or {}).get('correcao_valor') or {}
    corrigido=correcao.get('valor_fonte')==dif['valor_fonte'] and correcao.get('valor_anterior')==dif['valor_painel'] and (atual.get(url) or {}).get('valor')==dif['valor_fonte']
    detalhes.append({'ficha':url,'numero':str(dif.get('numero') or ''),'ano':str(dif.get('ano') or ''),'valor_painel_na_amostra':dif['valor_painel'],'valor_fonte_na_amostra':dif['valor_fonte'],'situacao':'corrigido_apos_amostra' if corrigido else 'pendente_de_conferencia','corrigido_em':correcao.get('conferido_em') if corrigido else None})
   results[name]['detalhes_divergencias']=detalhes
 correcoes=[]
 divergencias_data=[]
 for ficha,entry in catalog.items():
  alerta=entry.get('alerta_data') or {}
  if alerta and (atual.get(ficha) or {}).get('numero') and re.match(r'^https://transparencia\.betha\.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043/detalhe/[\w:%-]+$',ficha):
   c=atual[ficha];divergencias_data.append({'ficha':ficha,'numero':str(c.get('numero')),'ano':str(c.get('ano') or ''),'data_ficha':str(alerta.get('data_ficha') or ''),'data_pdf':str(alerta.get('data_pdf') or ''),'conferido_em':alerta.get('conferido_em'),'status':alerta.get('status','pendente_esclarecimento')})
  correcao=entry.get('correcao_valor') or {}; c=atual.get(ficha)
  if not c or not correcao or not isinstance(correcao.get('valor_fonte'),(int,float)) or not isinstance(correcao.get('valor_anterior'),(int,float)):continue
  correcoes.append({'ficha':ficha,'numero':str(c.get('numero') or ''),'ano':str(c.get('ano') or ''),'valor_anterior':correcao['valor_anterior'],'valor_fonte':correcao['valor_fonte'],'conferido_em':correcao.get('conferido_em'),'situacao':'mantido' if c.get('valor')==correcao['valor_fonte'] else 'valor_alterado_rever'})
 return {'gerado_em':datetime.now(timezone.utc).isoformat(timespec='seconds'),
  'pncp':{'ano':pncp.get('ano'),'registros':len(pncp.get('contratos',[])), 'correspondencias_candidatas':len(matches),
          'sem_correspondencia_automatica':max(0,len(pncp.get('contratos',[]))-len(matches)),
          'fichas_com_arquivos':sum(any(d.get('fonte')=='PNCP' for d in r.get('fontes_adicionais',[])) for r in catalog.values()),
          'pdfs_lidos':sum(bool((d.get('conferencia_conteudo') or {}).get('ultima_concluida')) for d in pdfs),
          'pdfs_revisao':sum((d.get('conferencia_conteudo') or {}).get('status')=='revisao_necessaria' and d.get('vinculo')!='confirmado_por_leitura' for d in pdfs),
          'anos_anteriores':[{ 'ano':str(k), 'registros':len(v.get('contratos',[])), 'status':v.get('status','desconhecido'), 'orgaos':{orgao:{'status':info.get('status','desconhecido'),'registros':info.get('registros')} for orgao,info in (v.get('orgaos') or {}).items() if orgao in ('prefeitura','camara') and isinstance(info,dict)}, 'ultima_tentativa':v.get('ultima_tentativa_em'), 'ultima_coleta_bem_sucedida':v.get('ultima_coleta_bem_sucedida_em')} for k,v in sorted(historical.items(), reverse=True) if isinstance(v,dict)],
          'ultima_tentativa':max(attempts,default=None),'ultima_consulta_concluida':max(successes,default=None),
          'ultima_rodada':{k:state.get(k) for k in ('executado_em','status','consultas_concluidas','inconclusivas') if k in state}},
  'diario':{'fichas_com_extratos':sum(any(d.get('fonte')=='Diário Oficial' for d in r.get('fontes_adicionais',[])) for r in catalog.values()), 'edicoes_concluidas':sum(x.get('status')=='ok' for x in edicoes.values()),'edicoes_inconclusivas':sum(x.get('status')=='inconclusiva' for x in edicoes.values()),'edicoes_acima_limite':sum(x.get('status')=='inconclusiva' and str(x.get('motivo','')).startswith('PDF acima do limite') for x in edicoes.values()),'limite_mb':64,'ultima_rodada':diario_state.get('ultima_rodada')},
  'trilha_betha':{'fichas_com_lista_empenhos':sum(isinstance((r.get('trilha') or {}).get('empenhos'),list) for r in catalog.values()), 'fichas_com_empenhos':sum(bool((r.get('trilha') or {}).get('empenhos')) for r in catalog.values()), 'empenhos_execucao_confirmada':sum(x.get('status')=='confirmado_na_fonte' for x in execucoes), 'ultima_tentativa_inconclusiva':sum(x.get('ultima_tentativa_status')=='inconclusiva' for x in execucoes), 'ultima_tentativa':max((str(x.get('ultima_tentativa')) for x in execucoes if x.get('ultima_tentativa')),default=None), 'ultima_concluida':max((str(x.get('consultado_em')) for x in execucoes if x.get('consultado_em')),default=None), 'ultima_rodada':{k:execucao_state.get(k) for k in ('executado_em','status','confirmados','inconclusivos') if k in execucao_state}},
  'amostras':{'executado_em':sample.get('executado_em'),'conjuntos':results},'historico_correcoes':correcoes,'divergencias_data':divergencias_data}
def main():
 out=CHUNKS/'cobertura_documental.json'; tmp=out.with_suffix('.tmp');tmp.write_text(json.dumps(gerar(),ensure_ascii=False,indent=2),encoding='utf8');tmp.replace(out)
 print('Cobertura documental agregada atualizada.')
if __name__=='__main__':main()
