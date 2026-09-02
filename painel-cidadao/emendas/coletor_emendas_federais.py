# -*- coding: utf-8 -*-
"""
Coletor de emendas federais de Varginha — Portal da Transparência (CGU).

Fonte primária: download-de-dados/emendas-parlamentares/UNICO (dados abertos, sem token).
    - EmendasParlamentares.csv .............. objeto (função/ação) por emenda
    - EmendasParlamentares_PorFavorecido.csv  quem recebeu, por emenda, em Varginha
Enriquecimento:
    - API pública do Transferegov ........... plano, empenho, OB, conta e prestação de contas das Pix

Uso:  python coletor_emendas_federais.py
Gera data/emendas_federais.js (itemizado: 1 registro por favorecido) + resumoTipos.
"""
import json, io, os, csv, sys, time, zipfile, tempfile, urllib.request, urllib.parse, unicodedata, shutil
from numbers import Real

AQUI = os.path.dirname(os.path.abspath(__file__))
FED_JS = os.path.join(AQUI, "data", "emendas_federais.js")
ZIP_URL = "https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares/UNICO"
IBGE_VARGINHA = "3170701"
CNPJ_VARGINHA = "18240119000105"
ROOT = os.path.abspath(os.path.join(AQUI, "..", ".."))
CACHE_DIR = os.path.join(ROOT, "private", "cache", "emendas-federais")
CACHE_ZIP = os.path.join(CACHE_DIR, "emendas-parlamentares-latest.zip")
CACHE_META = os.path.join(CACHE_DIR, "metadados-latest.json")
ARQUIVOS_OBRIGATORIOS = {
    "EmendasParlamentares.csv",
    "EmendasParlamentares_PorFavorecido.csv",
}

PAINEL_DIR = os.path.abspath(os.path.join(AQUI, ".."))
if PAINEL_DIR not in sys.path:
    sys.path.insert(0, PAINEL_DIR)

from transferegov_especiais import coletar_transferencias_especiais  # noqa: E402

CONSULTA = "https://portaldatransparencia.gov.br/emendas/consulta?de=&ate=&nomeMunicipio=Varginha"

def money(s):
    if isinstance(s, Real) and not isinstance(s, bool): return float(s)
    text = str(s or "").strip().replace("R$", "").replace(" ", "")
    if "," in text: text = text.replace(".", "").replace(",", ".")
    try: return float(text)
    except Exception: return 0.0

def money_txt(v):
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

def remove_accents(input_str):
    nfkd_form = unicodedata.normalize('NFKD', input_str)
    return "".join([c for c in nfkd_form if not unicodedata.combining(c)])

def autoria_tipo(tipo):
    t = remove_accents(str(tipo or "").upper())
    for nome, valor in (("INDIVIDUAL", "individual"), ("BANCADA", "bancada"),
                        ("COMISSAO", "comissao"), ("RELATOR", "relator")):
        if nome in t: return valor
    return "desconhecida"

def modalidade(tipo):
    t = remove_accents(str(tipo or "").upper())
    if "TRANSFERENCIAS ESPECIAIS" in t or "PIX" in t: return "especial_pix"
    if "FINALIDADE DEFINIDA" in t: return "finalidade_definida"
    if "FUNDO A FUNDO" in t: return "fundo_a_fundo"
    if "CONTRATO DE REPASSE" in t: return "contrato_repasse"
    if "CONVENIO" in t: return "convenio"
    return "desconhecida"

def _validar_zip(path):
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        raise ValueError("arquivo ZIP ausente ou vazio")
    with zipfile.ZipFile(path) as arquivo:
        nomes = set(arquivo.namelist())
        faltantes = sorted(ARQUIVOS_OBRIGATORIOS - nomes)
        if faltantes:
            raise ValueError("arquivos obrigatorios ausentes: " + ", ".join(faltantes))


def _escrever_json_atomico(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=os.path.basename(path) + ".", suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def baixar_zip():
    """Baixa a fonte oficial; cache privado serve apenas como preservacao."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix="emendas-cgu-", suffix=".zip", dir=CACHE_DIR)
    os.close(fd)
    try:
        print("Baixando dataset CGU (UNICO)...")
        req = urllib.request.Request(ZIP_URL, headers={"User-Agent": "FiscalizaVarginha/2.0"})
        with urllib.request.urlopen(req, timeout=300) as response, open(temp_name, "wb") as handle:
            shutil.copyfileobj(response, handle, length=1024 * 1024)
        _validar_zip(temp_name)
        os.replace(temp_name, CACHE_ZIP)
        metadata = {
            "status": "ok",
            "fonte": ZIP_URL,
            "baixadoEm": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "bytes": os.path.getsize(CACHE_ZIP),
        }
        _escrever_json_atomico(CACHE_META, metadata)
        print(f"  {metadata['bytes']//1024//1024} MB baixados e validados")
        return CACHE_ZIP, metadata
    except Exception as exc:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
        if os.path.exists(CACHE_ZIP):
            try:
                _validar_zip(CACHE_ZIP)
                print(f"AVISO: fonte CGU indisponivel ({exc}); cache valido preservado.")
                return CACHE_ZIP, {
                    "status": "preservado",
                    "fonte": ZIP_URL,
                    "motivo": str(exc),
                    "cache": CACHE_ZIP,
                }
            except Exception:
                pass
        paths_possiveis = [
            r"L:\Meu Drive\Rotina Diaria\Recebimento de Arquivos\EmendasParlamentares (1).zip",
            r"L:\Meu Drive\Rotina Diaria\Recebimento de Arquivos\EmendasParlamentares.zip",
        ]
        for path in paths_possiveis:
            if os.path.exists(path):
                _validar_zip(path)
                print(f"AVISO: usando copia local preservada: {path}")
                return path, {
                    "status": "preservado",
                    "fonte": ZIP_URL,
                    "motivo": str(exc),
                    "cache": path,
                }
        raise

def objeto_por_codigo(z):
    """Mapa código -> texto do objeto (Função · Subfunção · Ação), do CSV principal."""
    txt = io.TextIOWrapper(z.open("EmendasParlamentares.csv"), encoding="latin-1")
    r = csv.reader(txt, delimiter=";"); next(r)
    mp = {}
    for row in r:
        if len(row) < 20: continue
        cod = row[0].strip()
        # Código de emenda não é documento de pagamento, mas é o identificador
        # mínimo para que a linha possa ser exibida como alocação federal.
        if not cod: continue
        if cod in mp: continue
        partes = [row[13].strip(), row[15].strip(), row[19].strip()]  # Função, Subfunção, Ação
        mp[cod] = " · ".join(p for p in partes if p and p != "Sem informação")
    return mp

def targets_por_codigo(z):
    """Mapa código -> (Target Município, Target UF) do CSV principal."""
    txt = io.TextIOWrapper(z.open("EmendasParlamentares.csv"), encoding="latin-1")
    r = csv.reader(txt, delimiter=";"); next(r)
    mp = {}
    for row in r:
        if len(row) < 11: continue
        cod = row[0].strip()
        target_mun = row[8].strip()
        target_uf = row[10].strip()
        mp[cod] = (target_mun, target_uf)
    return mp

VALID_NATURE_SUBSTRINGS = [
    "MUNICIPIO",
    "FUNDO PUBLICO DA ADMINISTRACAO DIRETA MUNICIPAL",
    "FUNDACAO PUBLICA DE DIREITO PUBLICO MUNICIPAL",
    "ASSOCIACAO PRIVADA",
    "FUNDACAO PRIVADA"
]

def registros_varginha(z, objetos, targets):
    """Filtra favorecidos em Varginha-MG garantindo destinação local legítima (pública/social)."""
    txt = io.TextIOWrapper(z.open("EmendasParlamentares_PorFavorecido.csv"), encoding="latin-1")
    r = csv.reader(txt, delimiter=";"); next(r)
    regs = []
    for row in r:
        if len(row) < 13: continue
        
        mun_fav = remove_accents(row[11].strip().upper())
        uf_fav = remove_accents(row[10].strip().upper())
        if mun_fav != "VARGINHA" or uf_fav != "MG": continue
        
        cod = row[0].strip()
        if not cod: continue
        
        # Cross-reference destination from EmendasParlamentares.csv
        target = targets.get(cod, ("", ""))
        t_mun, t_uf = target
        t_mun_norm = remove_accents(t_mun.upper())
        
        # Rule 1: Target municipality is explicitly Varginha
        is_varginha_target = "VARGINHA" in t_mun_norm and remove_accents(t_uf.upper()) == "MG"
        
        # Rule 2: Multi-municipal, national, or unspecified target
        is_multi_or_national = any(x in t_mun_norm for x in ["MULTIPLO", "NACIONAL", "SEM INFORMACAO"]) or t_mun_norm == ""
        
        # Rule 3: Legal nature must be a local public or social/non-profit organization (excluding vendors)
        nat_jur = row[8].strip()
        nat_jur_norm = remove_accents(nat_jur.upper())
        is_valid_nature = any(vn in nat_jur_norm for vn in VALID_NATURE_SUBSTRINGS)
        
        # Keep record ONLY if targeted at Varginha OR is multi/national and has valid public/social nature
        if not (is_varginha_target or (is_multi_or_national and is_valid_nature)):
            continue
            
        tipo_emenda = row[4].strip()
        ano = (row[5] or "")[:4]
        autor = row[2].strip()
        favorecido = row[7].strip()
        doc_fav = row[6].strip()
        valor = money(row[12])
        catmap = {
            "Emenda Individual - Transferências Especiais": "Transferência Especial (Pix)",
            "Emenda Individual - Transferências com Finalidade Definida": "Individual com Finalidade Definida",
            "Emenda de Bancada": "Bancada",
            "Emenda de Comissão": "Comissão",
            "Emenda de Relator": "Relator",
        }
        categoria = catmap.get(tipo_emenda, tipo_emenda)
        objeto = objetos.get(cod, "") or ("Transferência Especial (Pix) — recurso sem finalidade definida; o município decide a aplicação." if "Especiais" in tipo_emenda else "Emenda federal — ver objeto na fonte oficial.")
        individual = "Sim" if "Individual" in tipo_emenda else "Não"
        reg = {
            "tipo": "Federal",
            "categoria": categoria,
            "ano": ano, "anoEmenda": ano, "anoRecurso": ano,
            "emenda": cod, "emendaOriginal": cod,
            "autor": autor, "partido": "",
            "valor": valor, "valorTexto": money_txt(valor),
            "beneficiario": favorecido,
            "documentoBeneficiario": doc_fav,
            "orgao": favorecido,
            "localidade": "VARGINHA",
            "objeto": objeto,
            "dataRecurso": "",
            "aprovado": "Sim",
            "emendaIndividual": individual,
            "autoria_tipo": autoria_tipo(tipo_emenda),
            "transferencia_modalidade": modalidade(tipo_emenda),
            "destino_confirmado": True,
            "nivel_confianca": "alto" if is_varginha_target else "medio",
            "granularidade": "emenda_favorecido_agregado",
            "identificador_repasse_confirmado": False,
            "contabilizado_como_repasse_individual": False,
            "descricao": f"{tipo_emenda}. Autor: {autor}. Código {cod}. Favorecido: {favorecido}.",
            "textoBusca": " ".join(str(x).lower() for x in [
                "federal", categoria, cod, ano, autor, favorecido, objeto]),
            "anosRelacionados": [ano] if ano else [],
            "fonteUrl": CONSULTA + "&codigoEmenda=" + urllib.parse.quote(cod),
            "id": f"fed_{cod}_{len(regs)}",
        }
        regs.append(reg)
    return regs

TRANSFEREGOV_FIELDS = {
    "valorIndicado", "valorEmpenhado", "valorLiquidado", "valorPago",
    "valorRecebido", "valorExecutado", "dataEmpenho", "dataPagamento",
    "dataRecurso", "execucao", "statusFinanceiro", "planoAcaoId",
    "codigoPlanoAcao", "situacaoPlanoAcao", "planoTrabalhoId",
    "situacaoPlanoTrabalho", "inicioExecucaoPlano", "fimExecucaoPlano",
    "objetoTransferegov", "metaTransferegov", "finalidadeTransferegov",
    "executorTransferegov", "cnpjExecutorTransferegov",
    "banco", "conta", "saldoContaInformativo", "dataSaldoConta",
    "numeroEmpenhos", "numeroOrdensBancarias", "qtdDocumentos",
    "qtdOrdensBancarias", "relatorioGestaoLocalizado",
    "situacaoRelatorioGestao", "planosRelacionados", "impedimentosHistoricos",
    "fonteExecucao", "fonteEmpenhosUrl", "granularidade",
    "identificador_repasse_confirmado", "contabilizado_como_repasse_individual",
    "classificacaoComprovacao", "observacaoEvidencia",
    "codigoEmendaTransferegov", "anoEmendaTransferegov",
    "divergenciaValorTransferegov",
}


def _pix_municipio(registro):
    return (
        "Pix" in str(registro.get("categoria") or "")
        and "".join(c for c in str(registro.get("documentoBeneficiario") or "") if c.isdigit()) == CNPJ_VARGINHA
    )


def _remover_execucao_nao_vinculada(registro):
    """Apaga o enriquecimento antigo da CGU, que não validava o documento por plano."""
    for campo in TRANSFEREGOV_FIELDS | {"fonteUrl"}:
        if campo == "fonteUrl":
            continue
        registro.pop(campo, None)
    registro.update({
        "valorEmpenhado": None,
        "valorLiquidado": None,
        "valorPago": None,
        "valorRecebido": None,
        "valorExecutado": None,
        "identificador_repasse_confirmado": False,
        "contabilizado_como_repasse_individual": False,
        "classificacaoComprovacao": "Parcial",
        "statusFinanceiro": "Execução ainda não vinculada a um plano de ação específico",
        "observacaoEvidencia": "O agregado da CGU comprova a destinação, mas não um repasse individual.",
    })


def _enriquecimentos_anteriores():
    if not os.path.exists(FED_JS):
        return {}
    try:
        text = io.open(FED_JS, encoding="utf-8").read()
        atual = json.loads(text[text.index("{"):text.rindex("}") + 1])
    except Exception:
        return {}
    out = {}
    for item in atual.get("emendas", []):
        if item.get("fonteExecucao") and item.get("codigoEmendaTransferegov"):
            out[str(item["codigoEmendaTransferegov"])] = {
                campo: item.get(campo) for campo in TRANSFEREGOV_FIELDS if campo in item
            }
            out[str(item["codigoEmendaTransferegov"])]["fonteUrl"] = item.get("fonteUrl")
    return out


def enriquecer_pix_transferegov(regs):
    """Vincula Pix por CNPJ, plano, empenho, documento, OB e conta bancária."""
    pix = [registro for registro in regs if _pix_municipio(registro)]
    print(f"Enriquecendo {len(pix)} Pix municipais com a API do Transferegov...")
    anteriores = _enriquecimentos_anteriores()
    try:
        payload = coletar_transferencias_especiais()
        por_emenda = payload["por_emenda"]
        status = {
            "status": "ok",
            "motivo": "",
            **payload["metadata"],
        }
    except Exception as exc:
        print(f"  Transferegov indisponível/inconsistente: {exc}")
        por_emenda = anteriores
        status = {
            "status": "preservado" if anteriores else "partial",
            "motivo": str(exc),
            "emendasPreservadas": len(anteriores),
        }

    casados = 0
    for registro in pix:
        codigo = str(registro.get("emenda") or "")
        fonte_agregada = registro.get("fonteUrl")
        _remover_execucao_nao_vinculada(registro)
        enriquecimento = por_emenda.get(codigo)
        if not enriquecimento:
            continue
        registro["fonteAgregadoUrl"] = fonte_agregada
        registro.update(enriquecimento)
        ano_emenda_oficial = str(enriquecimento.get("anoEmendaTransferegov") or "")
        if ano_emenda_oficial:
            registro["anoEmenda"] = ano_emenda_oficial
            registro["anosRelacionados"] = sorted(set(
                [str(ano) for ano in (registro.get("anosRelacionados") or []) if ano]
                + [ano_emenda_oficial]
            ))
        objeto = str(enriquecimento.get("objetoTransferegov") or "").strip()
        if objeto:
            registro["objeto"] = objeto
        valor_agregado = money(registro.get("valor"))
        valor_plano = money(enriquecimento.get("valorIndicado"))
        if abs(valor_agregado - valor_plano) > 0.01:
            registro["divergenciaValorTransferegov"] = {
                "valorAgregadoCGU": valor_agregado,
                "valorPlanoAcao": valor_plano,
            }
            registro["classificacaoComprovacao"] = "Parcial"
        registro["textoBusca"] = " ".join(filter(None, [
            registro.get("textoBusca", ""),
            str(registro.get("objetoTransferegov") or "").lower(),
            str(registro.get("metaTransferegov") or "").lower(),
            str(registro.get("finalidadeTransferegov") or "").lower(),
        ]))
        casados += 1

    print(f"  {casados}/{len(pix)} Pix vinculadas a plano de ação específico")
    status["registrosPublicadosVinculados"] = casados
    status["registrosPixMunicipio"] = len(pix)
    return status

def _norm_cod(raw):
    """Normaliza código p/ casar Betha ('50410002/2025') com CGU ('202550410002')."""
    s = str(raw or "")
    parts = s.split("/")
    num = "".join(c for c in parts[0] if c.isdigit())
    ano = "".join(c for c in (parts[1] if len(parts) > 1 else "") if c.isdigit())[:4]
    cands = {num}
    if ano and num:
        cands.add(ano + num)
    if num:
        cands.add(num.lstrip("0"))
    return {c for c in cands if c}


def cruzar_betha(regs):
    """Cruza repasses CGU com execução municipal (Betha) por código de emenda.
    Fonte bruta: '../../Publicidade Emendas/data/emendas.js' (gitignored). Se ausente,
    PRESERVA o dadosBetha já existente no output (não regride na automação semanal)."""
    src = os.path.join(AQUI, "..", "..", "Publicidade Emendas", "data", "emendas.js")
    if not os.path.exists(src):
        try:
            t = io.open(FED_JS, encoding="utf-8").read()
            atual = json.loads(t[t.index("{"):t.rindex("}")+1])["emendas"]
        except Exception:
            print("  cruzamento Betha: fonte ausente e sem output anterior — pulando"); return regs
        db_por_cod, somente = {}, []
        for e in atual:
            if e.get("dadosBetha"):
                for c in _norm_cod(e.get("emenda")):
                    db_por_cod[c] = e["dadosBetha"]
            if e.get("somenteNoBetha"):
                somente.append(e)
        casados = 0
        for r in regs:
            for c in _norm_cod(r.get("emenda")):
                if c in db_por_cod:
                    r["dadosBetha"] = db_por_cod[c]; casados += 1; break
        regs.extend(somente)
        print(f"  cruzamento Betha (preservado do output): {casados} + {len(somente)} pendentes")
        return regs
    t = io.open(src, encoding="utf-8").read()
    d = json.loads(t[t.index("{"):t.rindex("}")+1])
    fonte = d.get("emendas", d)
    betha_fed = [e for e in fonte if e.get("tipo") == "Federal"]
    cgu_index = {}
    for r in regs:
        for c in _norm_cod(r.get("emenda")):
            cgu_index.setdefault(c, r)
    casados, somente = 0, []
    for b in betha_fed:
        db = {
            "valorBetha": b.get("valor", 0), "objeto": b.get("objeto", ""),
            "banco": b.get("banco", ""), "conta": b.get("conta", ""),
            "dataRecurso": b.get("dataRecurso", ""), "dataPlano": b.get("dataPlano", ""),
            "responsavel": b.get("responsavel", ""), "prazoExecucao": b.get("prazoExecucao", ""),
            "aprovado": b.get("aprovado", ""), "arquivoUrl": b.get("arquivoUrl", ""),
            "pagina": b.get("pagina", ""),
        }
        alvo = None
        for c in _norm_cod(b.get("emenda")):
            if c in cgu_index:
                alvo = cgu_index[c]; break
        if alvo is not None:
            alvo["dadosBetha"] = db; casados += 1
        else:
            ano = (b.get("emenda", "").split("/")[-1] or "")[:4]
            benef = (b.get("beneficiario", "") or "").strip() or "Não informado (ver plano de trabalho)"
            obj = (b.get("objeto", "") or "").strip() or "Emenda cadastrada na Prefeitura (Betha) sem repasse federal pago — conferir plano de trabalho."
            somente.append({
                "tipo": "Federal", "categoria": "Individual com Finalidade Definida",
                "ano": ano, "emenda": b.get("emenda", ""),
                "autor": b.get("autor", "") or "Não informado", "partido": "",
                "valor": 0.0, "valorTexto": "0,00",
                "beneficiario": benef,
                "documentoBeneficiario": b.get("documentoBeneficiario", ""),
                "orgao": benef, "localidade": "VARGINHA",
                "objeto": obj, "aprovado": b.get("aprovado", ""),
                "emendaIndividual": "Sim", "somenteNoBetha": True, "dadosBetha": db,
                "granularidade": "referencia_betha_sem_repasse",
                "identificador_repasse_confirmado": False,
                "contabilizado_como_repasse_individual": False,
                "classificacaoComprovacao": "Parcial",
                "descricao": f"Emenda cadastrada na Prefeitura (Betha) sem repasse federal pago na CGU. Favorecido: {b.get('beneficiario','')}.",
                "textoBusca": " ".join(str(x).lower() for x in ["federal betha pendente", b.get("emenda",""), b.get("beneficiario",""), b.get("objeto","")]),
                "anosRelacionados": [ano] if ano else [],
                "fonteUrl": CONSULTA,
                "id": "betha_" + (sorted(_norm_cod(b.get("emenda")))[0] if _norm_cod(b.get("emenda")) else str(len(somente))),
            })
    regs.extend(somente)
    print(f"  cruzamento Betha (fonte bruta): {casados} casados + {len(somente)} somenteNoBetha")
    return regs


def gerar_resumo_tipos(regs):
    from collections import defaultdict
    agg = defaultdict(lambda: {"total": 0.0, "ben": defaultdict(float), "n": 0})
    risco = {"Transferência Especial (Pix)": "alto", "Relator": "alto"}
    expl = {
        "Transferência Especial (Pix)": "Vai direto para a conta da Prefeitura, SEM destino definido — o município decide onde aplicar (art. 166-A). É a que mais exige acompanhamento.",
        "Individual com Finalidade Definida": "Deputado ou senador indica para um objeto específico. Execução obrigatória.",
        "Bancada": "Apresentada em conjunto pela bancada de MG para obras/projetos estruturantes. Execução obrigatória.",
        "Comissão": "Sugerida por comissão temática do Congresso para política pública. NÃO tem execução obrigatória.",
        "Relator": "Do relator-geral do orçamento (antigo 'orçamento secreto', RP9). Historicamente o menos transparente.",
    }
    for r in regs:
        a = agg[r["categoria"]]
        valor = r["valor"] if r["valor"] > 0 else 0.0
        a["total"] += valor; a["n"] += 1
        a["ben"][r["beneficiario"]] += valor
    ordem = ["Transferência Especial (Pix)", "Individual com Finalidade Definida", "Bancada", "Comissão", "Relator"]
    out = []
    for cat in ordem:
        if cat not in agg: continue
        a = agg[cat]
        top = sorted(a["ben"].items(), key=lambda x: -x[1])[:5]
        out.append({
            "categoria": cat, "total": round(a["total"], 2), "totalTexto": money_txt(a["total"]),
            "itemizado": True, "qtd": a["n"], "risco": risco.get(cat, "medio"),
            "explicacao": expl.get(cat, ""),
            "topBeneficiarios": [{"nome": n, "valor": round(v, 2)} for n, v in top],
            "fonteUrl": CONSULTA,
        })
    return out

def _escrever_saida_atomica(payload):
    os.makedirs(os.path.dirname(FED_JS), exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=os.path.basename(FED_JS) + ".", suffix=".tmp", dir=os.path.dirname(FED_JS))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write("window.EMENDAS_FEDERAIS = ")
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write(";\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, FED_JS)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def main():
    try:
        zpath, coleta_fonte = baixar_zip()
    except Exception as exc:
        if os.path.exists(FED_JS):
            print(f"AVISO: coleta federal falhou ({exc}); base anterior preservada.", file=sys.stderr)
            return 2
        raise
    if coleta_fonte.get("status") != "ok" and os.path.exists(FED_JS):
        print("AVISO: fonte federal sem nova copia valida; base publicada anterior preservada.")
        return 2
    z = zipfile.ZipFile(zpath)
    print("Lendo objetos (função/ação)...")
    objetos = objeto_por_codigo(z)
    print("Lendo destinos das emendas...")
    targets = targets_por_codigo(z)
    print("Filtrando favorecidos em Varginha-MG com regras de destinação...")
    regs = registros_varginha(z, objetos, targets)
    print(f"  {len(regs)} registros federais itemizados ({len(set(r['emenda'] for r in regs))} emendas únicas)")
    transferegov_status = enriquecer_pix_transferegov(regs)
    print("Cruzando com execução municipal (Betha)...")
    regs = cruzar_betha(regs)
    resumo = gerar_resumo_tipos(regs)
    # Valores não positivos podem representar estorno/anulação e nunca entram
    # no recebido. As linhas continuam visíveis para auditoria.
    total = sum(r["valor"] for r in regs if r["valor"] > 0)
    out = {
        "metadata": {
            "fonte": "Portal da Transparência (CGU) — dados abertos emendas-parlamentares (PorFavorecido)",
            "favorecido": "Favorecidos em Varginha-MG",
            "extraidoEm": time.strftime("%Y-%m-%d"),
            "codigoIbge": IBGE_VARGINHA,
            "totalFederal": round(total, 2), "totalFederalTexto": money_txt(total),
            "registros": len(regs), "emendasUnicas": len(set(r["emenda"] for r in regs)),
            "transferegov": transferegov_status,
            "coletaFonte": coleta_fonte,
            "observacao": "Cada registro nasce como agregado emenda/favorecido. Nas transferências especiais ao Município, recebimento só é confirmado quando plano, empenho, ordem bancária e crédito na conta vinculada coincidem na API do Transferegov. Totais agregados excluem valores não positivos (estornos/anulações).",
        },
        "resumoTipos": resumo,
        "emendas": regs,
    }
    _escrever_saida_atomica(out)
    print(f"OK — {len(regs)} emendas federais | total R$ {money_txt(total)} | {FED_JS}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
