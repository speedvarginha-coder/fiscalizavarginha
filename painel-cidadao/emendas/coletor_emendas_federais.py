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
import json, io, os, csv, sys, time, zipfile, tempfile, urllib.request, urllib.parse, unicodedata, shutil, re, argparse
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

def linhas_csv(z, name, required):
    """Usa nomes de colunas: inserções de colunas da CGU não podem mudar o significado."""
    with io.TextIOWrapper(z.open(name), encoding="latin-1") as text:
        reader = csv.DictReader(text, delimiter=";")
        if not set(required).issubset(reader.fieldnames or []):
            raise ValueError(f"Colunas obrigatórias ausentes em {name}")
        for row in reader:
            yield {key.strip(): str(value or "").strip() for key, value in row.items() if key}


def referencias_por_codigo(z):
    """Ano oficial, objetos e todos os destinos do código, sem escolher a última linha."""
    references = {}
    fields = ["Código da Emenda", "Ano da Emenda", "Nome Função", "Nome Subfunção", "Nome Ação", "Município", "UF", "Código Município IBGE"]
    for row in linhas_csv(z, "EmendasParlamentares.csv", fields):
        code = row["Código da Emenda"]
        if not re.fullmatch(r"20\d{10}", code):
            continue  # 'Sem informação' não identifica uma emenda única.
        year = row["Ano da Emenda"]
        if not re.fullmatch(r"20\d{2}", year):
            raise ValueError(f"Ano da Emenda inválido para {code}")
        item = references.setdefault(code, {"ano": year, "objetos": [], "destinos": []})
        if item["ano"] != year:
            raise ValueError(f"Anos conflitantes na fonte para {code}")
        obj = " · ".join(row[k] for k in ["Nome Função", "Nome Subfunção", "Nome Ação"] if row[k] and row[k] != "Sem informação")
        if obj and obj not in item["objetos"]:
            item["objetos"].append(obj)
        target = (row["Município"], row["UF"], row["Código Município IBGE"])
        if target not in item["destinos"]:
            item["destinos"].append(target)
    return references

VALID_NATURE_SUBSTRINGS = [
    "MUNICIPIO",
    "FUNDO PUBLICO DA ADMINISTRACAO DIRETA MUNICIPAL",
    "FUNDACAO PUBLICA DE DIREITO PUBLICO MUNICIPAL",
    "ASSOCIACAO PRIVADA",
    "FUNDACAO PRIVADA"
]

def registros_varginha(z, referencias):
    """Filtra favorecidos em Varginha-MG garantindo destinação local legítima (pública/social)."""
    fields = ["Código da Emenda", "Tipo de Emenda", "Ano/Mês", "Nome do Autor da Emenda", "Código do Favorecido", "Favorecido", "Natureza Jurídica", "UF Favorecido", "Município Favorecido", "Valor Recebido"]
    r = linhas_csv(z, "EmendasParlamentares_PorFavorecido.csv", fields)
    regs = []
    for row in r:
        mun_fav = remove_accents(row["Município Favorecido"].upper())
        uf_fav = remove_accents(row["UF Favorecido"].upper())
        if mun_fav != "VARGINHA" or uf_fav != "MG": continue
        
        cod = row["Código da Emenda"]
        if not cod: continue
        
        # Cross-reference destination from EmendasParlamentares.csv
        reference = referencias.get(cod, {})
        targets = reference.get("destinos") or [("", "", "")]
        
        # Rule 1: Target municipality is explicitly Varginha
        is_varginha_target = any(ibge == IBGE_VARGINHA or (remove_accents(mun.upper()) == "VARGINHA" and uf.upper() == "MG") for mun, uf, ibge in targets)
        
        # Rule 2: Multi-municipal, national, or unspecified target
        is_multi_or_national = any(not mun or any(x in remove_accents(mun.upper()) for x in ["MULTIPLO", "NACIONAL", "SEM INFORMACAO"]) for mun, _, _ in targets)
        
        # Rule 3: Legal nature must be a local public or social/non-profit organization (excluding vendors)
        nat_jur = row["Natureza Jurídica"]
        nat_jur_norm = remove_accents(nat_jur.upper())
        is_valid_nature = any(vn in nat_jur_norm for vn in VALID_NATURE_SUBSTRINGS)
        
        # Keep record ONLY if targeted at Varginha OR is multi/national and has valid public/social nature
        if not (is_varginha_target or (is_multi_or_national and is_valid_nature)):
            continue
            
        tipo_emenda = row["Tipo de Emenda"]
        periodo = row["Ano/Mês"]
        match_periodo = re.fullmatch(r"(20\d{2})(?:[-/]?(0[1-9]|1[0-2]))?", periodo)
        ano_recurso = match_periodo.group(1) if match_periodo else ""
        ano = reference.get("ano", "")
        autor = row["Nome do Autor da Emenda"]
        favorecido = row["Favorecido"]
        doc_fav = row["Código do Favorecido"]
        valor = money(row["Valor Recebido"])
        catmap = {
            "Emenda Individual - Transferências Especiais": "Transferência Especial (Pix)",
            "Emenda Individual - Transferências com Finalidade Definida": "Individual com Finalidade Definida",
            "Emenda de Bancada": "Bancada",
            "Emenda de Comissão": "Comissão",
            "Emenda de Relator": "Relator",
        }
        categoria = catmap.get(tipo_emenda, tipo_emenda)
        objeto = " / ".join(reference.get("objetos", [])) or "Objeto não individualizado nesta base; consulte a fonte oficial."
        individual = "Sim" if "Individual" in tipo_emenda else "Não"
        reg = {
            "tipo": "Federal",
            "categoria": categoria,
            "ano": ano, "anoEmenda": ano, "anoRecurso": ano_recurso,
            "periodoRecebimentoCGU": periodo,
            "fonteAnoEmenda": "EmendasParlamentares.csv — Ano da Emenda" if ano else "Não informado: código sem correspondência individual na tabela principal",
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
            "anosRelacionados": sorted({a for a in [ano, ano_recurso] if a}),
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
    "documentosVinculados", "evidenciasConsultadasEm",
    "fonteRelatorioGestaoUrl", "fonteRelatorioGestaoLegadoUrl",
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


def ano_referencia_betha(code):
    text = str(code or "").strip()
    match = re.search(r"/(20\d{2})$", text)
    if match:
        return match.group(1)
    return text[:4] if re.fullmatch(r"20\d{10}", text) else ""


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
                ano = ano_referencia_betha(e.get("emenda"))
                e.update({"ano": ano, "anoEmenda": ano, "anosRelacionados": [ano] if ano else []})
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
            ano = ano_referencia_betha(b.get("emenda"))
            benef = (b.get("beneficiario", "") or "").strip() or "Não informado (ver plano de trabalho)"
            obj = (b.get("objeto", "") or "").strip() or "Referência da Prefeitura (Betha) sem correspondência neste recorte da CGU; conferir plano de trabalho."
            somente.append({
                "tipo": "Federal", "categoria": "Individual com Finalidade Definida",
                "ano": ano, "anoEmenda": ano, "emenda": b.get("emenda", ""),
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
                "descricao": f"Referência da Prefeitura (Betha) sem correspondência neste recorte da CGU. Favorecido: {b.get('beneficiario','')}.",
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
        a.setdefault("codigos", set())
        a.setdefault("cgu", 0)
        if not r.get("somenteNoBetha"):
            a["cgu"] += 1
            if re.fullmatch(r"20\d{10}", r["emenda"]):
                a["codigos"].add(r["emenda"])
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
            "qtdEmendas": len(a["codigos"]), "qtdRepasses": a["cgu"],
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reprocessar-cache", action="store_true", help="Reprocessa o ZIP oficial preservado, mantendo a data de download original")
    args = parser.parse_args()
    try:
        if args.reprocessar_cache:
            _validar_zip(CACHE_ZIP)
            with open(CACHE_META, encoding="utf-8") as handle:
                coleta_fonte = json.load(handle)
            coleta_fonte["reprocessado"] = True
            zpath = CACHE_ZIP
        else:
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
    print("Lendo anos, objetos e destinos por nome de coluna...")
    referencias = referencias_por_codigo(z)
    print("Filtrando favorecidos em Varginha-MG com regras de destinação...")
    regs = registros_varginha(z, referencias)
    if not regs:
        raise ValueError("Recorte federal vazio; publicação anterior preservada")
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
            "coletadoEm": coleta_fonte.get("baixadoEm"),
            "codigoIbge": IBGE_VARGINHA,
            "totalFederal": round(total, 2), "totalFederalTexto": money_txt(total),
            "registros": len(regs),
            "registrosCGU": sum(not r.get("somenteNoBetha") for r in regs),
            "emendasUnicas": len({r["emenda"] for r in regs if not r.get("somenteNoBetha") and re.fullmatch(r"20\d{10}", r["emenda"])}),
            "registrosSemCodigoIndividual": sum(not r.get("somenteNoBetha") and not re.fullmatch(r"20\d{10}", r["emenda"]) for r in regs),
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
