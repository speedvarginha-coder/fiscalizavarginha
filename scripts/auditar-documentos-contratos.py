"""Histórico oficial e conferência documental. Não publica tokens nem URLs assinadas."""
import argparse, concurrent.futures, hashlib, io, json, os, re, sys, time, unicodedata
from decimal import Decimal, InvalidOperation
from datetime import datetime, timedelta
from pathlib import Path
import urllib.request, urllib.parse
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"painel-cidadao"))
import coletor_betha as b
from coletor import _normaliza_contratos
CHUNKS=ROOT/"painel-cidadao/data/chunks"
PORTAIS={"prefeitura":("y7mn01LGqd_HCvGtj6VPwA==",83043),"camara":("-iAWLe1kr2VQcrW9k2AUBg==",324812)}
FICHA=re.compile(r"https://transparencia\.betha\.cloud/#/(?:y7mn01LGqd_HCvGtj6VPwA==/consulta/83043|-iAWLe1kr2VQcrW9k2AUBg==/consulta/324812)/detalhe/[\w:%-]+")
UUID=re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}",re.I)

def ler(path,default):
    try:return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError,ValueError):return default

def salvar(path,data):
    staged=path.with_suffix(path.suffix+".tmp")
    staged.write_text(json.dumps(data,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    staged.replace(path)

def token_publico():
    if os.environ.get("BETHA_ANONYMOUS_TOKEN"):return os.environ["BETHA_ANONYMOUS_TOKEN"]
    query=urllib.parse.urlencode({"client_id":"91a97459-f1d8-4b29-b5fa-2e51d1692623","response_type":"token","redirect_uri":"https://transparencia.betha.cloud/auth-callback.html","scope":"transparencia.public","silent":"true","access_mode":"anonymous","callback":"__jp0"})
    with urllib.request.urlopen("https://plataforma-oauth.betha.cloud/auth/oauth2/authorize?"+query,timeout=25) as response:text=response.read(100000).decode()
    match=re.fullmatch(r"\s*__jp0\((.*)\);?\s*",text,re.S)
    if not match:raise ValueError("Resposta OAuth pública não reconhecida")
    data=json.loads(match.group(1))
    if not isinstance(data.get("accessToken"),str):raise ValueError("Token público indisponível")
    return data["accessToken"]

def historico(token,orgao):
    portal,consulta=PORTAIS[orgao]
    rows=[];ids=set();total=None;offset=0
    while True:
        result=b._api("POST",f"/busca-textual/{consulta}",token,body={},params={"sortBy":"dataAssinatura","sortDirection":"DESC","offset":offset,"limit":500,"hiperlink":"false"},portal_hash=portal,timeout=25)
        if total is None:total=result.get("totalHits")
        if not isinstance(total,int) or result.get("totalHits")!=total:raise ValueError("Total mudou na paginação histórica")
        hits=result.get("hits") or []
        if not hits:break
        for hit in hits:
            ident=str(hit.get("id") or "")
            if not ident or ident in ids:raise ValueError("Identificador repetido na paginação histórica")
            ids.add(ident);row=dict(hit["sourceAsMap"])
            row["fonte_url"]=f"https://transparencia.betha.cloud/#/{portal}/consulta/{consulta}/detalhe/"+urllib.parse.quote(ident,safe=":_")
            rows.append(row)
        offset+=len(hits)
        if offset>=total:break
    if len(rows)!=total:raise ValueError("Histórico oficial parcial")
    contratos=_normaliza_contratos(rows)
    if not contratos or any(not FICHA.fullmatch(c.get("fonte_url","")) for c in contratos):raise ValueError("Histórico oficial incompleto")
    return {"consultado_em":datetime.now().isoformat(timespec="seconds"),"fonte":"Betha","orgao":orgao,"contratos":contratos}

def conferir_ficha(url,token):
    if not FICHA.fullmatch(url):raise ValueError("Ficha fora das consultas permitidas")
    parts=url.split("/#/")[1].split("/");portal,consulta,ident=parts[0],parts[2],parts[4]
    now=datetime.now().isoformat(timespec="seconds")
    detail=b._api("GET",f"/busca/{consulta}/detalhes/{ident}",token,portal_hash=portal,timeout=20)
    docs=detail.get("documentosRelacionados")
    alteracoes=detail.get("alteracoes")
    result={"consultado_em":now,"verificado_em":now[:10],"aditivos_qtd":len(alteracoes) if isinstance(alteracoes,list) else None,"documentos":[]}
    # A lista contém alterações de tipos variados, não necessariamente aditivos.
    # Campo ausente ou malformado permanece desconhecido; nunca vira zero.
    if isinstance(alteracoes,list) and all(isinstance(item,dict) for item in alteracoes):
        result["alteracoes_ficha"]=[{key:item[key] for key in ("tipo","numero","ano","data") if isinstance(item.get(key),(str,int))} for item in alteracoes]
    else:
        result["alteracoes_ficha"]=None
        result["aditivos_qtd"]=None
    if not isinstance(docs,list):result["status"]="nao_verificado"
    else:
        result["status"]="disponivel" if docs else "sem_documentos"
        result["documentos"]=[{"tipo":d.get("tipo","Documento"),"nome":d.get("descricao",""),"arquivo_id":d.get("arquivo","")} for d in docs if isinstance(d,dict)]
    # Processo/edital não são inferidos: exigem um vínculo publicado e conferido.
    result["trilha"]={"processo_fonte":"numeroProcessoCompra","processo":str(detail.get("numeroProcessoCompra") or ""),"ano_processo":str(detail.get("anoProcessoCompra") or ""),"edital":"nao_localizado_nesta_consulta"}
    empenhos=detail.get('empenhos')
    if isinstance(empenhos,list) and all(isinstance(item,dict) for item in empenhos):
        result['trilha']['empenhos']=[{k:item[k] for k in ('tipo','ano','numero','data','valor') if isinstance(item.get(k),(str,int,float)) and not isinstance(item.get(k),bool)} for item in empenhos]
    else:
        result['trilha']['empenhos']=None
    fiscal=detail.get('fiscal')
    result['trilha']['fiscal']=fiscal.strip() if isinstance(fiscal,str) and fiscal.strip() else None
    return result

def conferir_pdf(url,doc,contrato,token):
    ident=str(doc.get("arquivo_id",""))
    if not UUID.fullmatch(ident):return {"status":"nao_verificado","motivo":"Identificador de arquivo não reconhecido"}
    portal=url.split("/#/")[1].split("/")[0]
    request=urllib.request.Request(b.API_BASE+"/arquivo/"+ident,headers={"Authorization":"Bearer "+token,"app-context":b._app_context(portal)})
    with urllib.request.urlopen(request,timeout=20) as r:download=r.read(20000).decode().strip()
    parsed=urllib.parse.urlsplit(download)
    if parsed.scheme!="https" or parsed.hostname!="s3.sa-east-1.amazonaws.com" or not parsed.path.startswith("/transparencia.betha.cloud/contratos/") or ident not in parsed.path:raise ValueError("Download fora da origem oficial permitida")
    with urllib.request.urlopen(download,timeout=25) as r:raw=r.read(8*1024*1024+1)
    if len(raw)>8*1024*1024:return {"status":"nao_verificado","motivo":"Arquivo acima do limite de conferência de 8 MB"}
    if not raw.startswith(b"%PDF-"):return {"status":"nao_verificado","motivo":"Resposta não reconhecida como PDF"}
    result={"status":"pdf_acessivel","conferido_em":datetime.now().isoformat(timespec="seconds"),"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest(),"correspondencia":"nao_confirmada"}
    try:
        from pypdf import PdfReader
        reader=PdfReader(io.BytesIO(raw));text=" ".join(page.extract_text() or "" for page in reader.pages[:12])
        text=unicodedata.normalize("NFKD",text).encode("ascii","ignore").decode().upper()
        numero=str(contrato.get("numero","")).lstrip("0");ano=str(contrato.get("ano",""))
        nomes=re.findall(r"[A-Z]{4,}",unicodedata.normalize("NFKD",contrato.get("contratado","")).encode("ascii","ignore").decode().upper())
        ref=bool(numero and ano and re.search(r"(?<!\d)0*"+re.escape(numero)+r"\s*[/.-]\s*"+re.escape(ano)+r"(?!\d)",text))
        nome=any(n in text for n in nomes[:3] if n not in ("LTDA","SERVICOS","COMERCIO"))
        result["correspondencia"]="referencia_e_fornecedor_identificados" if ref and nome else "revisao_necessaria"
        result["texto_extraido"]=bool(text.strip())
    except Exception:result["correspondencia"]="texto_nao_conferido"
    return result

def preservar_execucao(anterior, nova):
    """Só reutiliza evidência de empenho se identidade e valor forem únicos e iguais."""
    old=(anterior.get('trilha') or {}).get('empenhos');new=(nova.get('trilha') or {}).get('empenhos')
    if isinstance(old,list) and new is None:
        nova['trilha']['empenhos']=old
        nova['trilha']['empenhos_ultima_tentativa_status']='inconclusiva'
        nova['trilha']['empenhos_ultima_confirmacao']=(anterior.get('trilha') or {}).get('empenhos_ultima_confirmacao') or anterior.get('consultado_em')
        return
    if not isinstance(old,list) or not isinstance(new,list):return
    def key(item):
        if not isinstance(item,dict) or any(item.get(k) in (None,'') for k in ('tipo','ano','numero','data','valor')):return None
        try:
            valor=Decimal(str(item['valor']))
            if not valor.is_finite():return None
        except (InvalidOperation,ValueError):return None
        return (str(item['tipo']),str(item['ano']),str(item['numero']),str(item['data']),valor)
    old_keys=[key(x) for x in old];new_keys=[key(x) for x in new]
    for item,k in zip(new,new_keys):
        if k and old_keys.count(k)==1 and new_keys.count(k)==1:
            before=old[old_keys.index(k)]
            if before.get('execucao'):item['execucao']=before['execucao']

def executar(args):
    token=token_publico();base=ler(CHUNKS/"contratos_documentos.json",{});contracts={}
    for orgao in PORTAIS:
        path=CHUNKS/f"contratos_historico_{orgao}.json"
        if args.historico and str(ler(path,{}).get("consultado_em",""))[:10] != datetime.now().date().isoformat():
            try:salvar(path,historico(token,orgao))
            except Exception as e:print("Histórico preservado:",orgao,type(e).__name__,flush=True)
        for c in ler(path,{}).get("contratos",[]):
            if FICHA.fullmatch(c.get("fonte_url","")):contracts[c["fonte_url"]]=c
    for filename,field in [("prefeitura","contratos"),("camara_betha","contratos"),("camara_betha","contratos_fontes")]:
        for c in ler(CHUNKS/(filename+".json"),{}).get(field,[]):
            if FICHA.fullmatch(c.get("fonte_url","")):contracts.setdefault(c["fonte_url"],c)
    cutoff=(datetime.now()-timedelta(days=args.days)).isoformat()
    def ultima_consulta(url):
        record=base.get(url,{})
        return max(str(record.get(k) or "") for k in ("consultado_em","verificado_em","ultima_tentativa"))
    pending=[u for u in contracts if ultima_consulta(u)<cutoff]
    pending.sort(key=lambda u:(ultima_consulta(u),0 if u in base else 1))
    pending=pending[:args.limit] if args.limit else pending
    print("Histórico:",len(contracts),"fichas; consultas nesta rodada:",len(pending),flush=True)
    def scan(url):
        try:return url,conferir_ficha(url,token),None
        except Exception as e:return url,None,type(e).__name__
    successes=0
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for i,(url,result,error) in enumerate(pool.map(scan,pending),1):
            old=base.get(url,{})
            if result:
                # Conserve a conferência anterior quando a nova consulta for inconclusiva.
                if result["status"]=="nao_verificado" and old.get("status") in ("disponivel","sem_documentos"):
                    old["ultima_tentativa"]=result["consultado_em"];old["ultima_tentativa_status"]="inconclusiva"
                else:
                    if old.get("divergencia"):result["divergencia"]=old["divergencia"]
                    if old.get("fontes_adicionais"):result["fontes_adicionais"]=old["fontes_adicionais"]
                    if old.get("correcao_valor"):result["correcao_valor"]=old["correcao_valor"]
                    if old.get("alerta_data"):result["alerta_data"]=old["alerta_data"]
                    preservar_execucao(old,result)
                    pdfs={d.get("arquivo_id"):d.get("conferencia_pdf") for d in old.get("documentos",[]) if d.get("conferencia_pdf")}
                    for d in result["documentos"]:
                        if d.get("arquivo_id") in pdfs:d["conferencia_pdf"]=pdfs[d["arquivo_id"]]
                    base[url]=result
                successes+=1
            else:
                old.setdefault("status","nao_verificado")
                old.update({"ultima_tentativa":datetime.now().isoformat(timespec="seconds"),"ultima_tentativa_status":"indisponivel"});base[url]=old
            if i%100==0:print("Fichas consultadas:",i,flush=True)
    jobs=[(u,d) for u in contracts for d in base.get(u,{}).get("documentos",[]) if str((d.get("conferencia_pdf") or {}).get("conferido_em", ""))<cutoff]
    jobs.sort(key=lambda job:str((job[1].get("conferencia_pdf") or {}).get("conferido_em", "")))
    jobs=jobs[:args.pdf_limit]
    def pdf(job):
        u,d=job
        try:
            d["conferencia_pdf"]=conferir_pdf(u,d,contracts[u],token)
            d["conferencia_pdf"].setdefault("conferido_em",datetime.now().isoformat(timespec="seconds"))
        except Exception as e:d["conferencia_pdf"]={"status":"indisponivel","conferido_em":datetime.now().isoformat(timespec="seconds"),"motivo":type(e).__name__}
        return d
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for i,d in enumerate(pool.map(pdf,jobs),1):
            if i%50==0:print("Arquivos conferidos:",i,flush=True)
    if successes or jobs:salvar(CHUNKS/"contratos_documentos.json",base)
    elif pending:print("Conferência indisponível; catálogo anterior preservado.",flush=True)
    print("Conferência encerrada. Fichas atualizadas:",successes,"arquivos:",len(jobs),flush=True)

if __name__=="__main__":
    parser=argparse.ArgumentParser();parser.add_argument("--historico",action="store_true");parser.add_argument("--limit",type=int,default=500);parser.add_argument("--pdf-limit",type=int,default=50);parser.add_argument("--days",type=int,default=7)
    args=parser.parse_args()
    if min(args.limit,args.pdf_limit,args.days)<0:parser.error("Limites e dias devem ser não negativos")
    try:executar(args)
    except Exception as e:print("Conferência indisponível; dados anteriores preservados:",type(e).__name__);sys.exit(0)
