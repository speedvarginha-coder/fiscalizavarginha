"""Coletor de publicações estruturadas — Fase 2: Diário Oficial (PDF).

Baixa o PDF de cada edição do Diário Oficial de Varginha, extrai o texto,
separa ATO POR ATO (regex de cabeçalho) e estrutura cada um no schema único —
dados duros (CNPJ, valores) por regex; resumo cidadão e pontos de atenção pela
IA (enriquecedor_ia). Mesmo schema da Câmara → alimenta painel + WhatsApp.

Uso:
    python coletor_diario.py --edicoes 3          # mescla 3 edições mais recentes
    python coletor_diario.py --edicoes 0 --full   # refaz todas as edições

Saída: data/chunks/publicacoes_diario.json
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import threading
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from pypdf import PdfReader

import enriquecedor_ia

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
DIARIO_JSON = ROOT / "data" / "chunks" / "diario.json"
SAIDA = ROOT / "data" / "chunks" / "publicacoes_diario.json"
CACHE_PDF = ROOT / "data" / "cache_diario"   # texto extraído por edição
BASE = "https://www.varginha.mg.gov.br"
UA = {"User-Agent": "Mozilla/5.0 (ZelaVarginha)"}

# Tipos de ato aceitos (todos os 4 grupos escolhidos pelo usuário).
TIPOS_ACEITOS = {"contrato", "aditivo", "licitacao", "dispensa", "inexigibilidade",
                 "pessoal", "norma"}

TIPOS_PAT = (
    r"EXTRATO\s+DE\s+PUBLICA[ÇC][ÃA]O\s+DE\s+RESULTADO\s*-\s*(?:DISPENSA|INEXIGIBILIDADE)|"
    r"CLASSIFICA[ÇC][ÃA]O\s+EDITAL\s+DE\s+SELE[ÇC][ÃA]O\s+SIMPLIFICADA\s*-|"
    r"LEI\s+COMPLEMENTAR|LEI|DECRETO\s+LEGISLATIVO|DECRETO|PORTARIA|"
    r"RESOLU[ÇC][ÃA]O|EXTRATO\s+D[EO]\s+[\wÇÃÕÂÊÉÚÓÁÍ\s]{3,40}?|"
    r"EDITAL(?:\s+D[EO]\s+[\wÇÃÕÂÊÉÚÓÁÍ]+)?|AVISO\s+D[EO]\s+[\wÇÃÕÂÊÉÚÓÁÍ\s]{3,30}?|"
    r"T[EÊ]RMO\s+ADITIVO|DISPENSA\s+D[EO]\s+LICITA[ÇC][ÃA]O|INEXIGIBILIDADE|"
    r"HOMOLOGA[ÇC][ÃA]O|RATIFICA[ÇC][ÃA]O|ATA\s+DE\s+REGISTRO"
)
CABECALHO = re.compile(r"^\s*(" + TIPOS_PAT + r")\s+N?[º°]?\s*[\d./-]{2,}",
                       re.MULTILINE | re.IGNORECASE)

CNPJ_RE = re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b")
MONEY_RE = re.compile(r"R\$\s*([\d.]+,\d{2})")
NUM_ATO_RE = re.compile(r"N?[º°]?\s*([\d.]+/?\d*)")
# Razão social: nome seguido de sufixo societário/entidade. Bem mais preciso
# que "EMPRESA: ..." (que pegava frases inteiras do texto).
RAZAO_RE = re.compile(
    r"\b([A-ZÀ-Ú][A-Za-zÀ-ú0-9&.,'\-/ ]{3,70}?\s"
    r"(?:LTDA|EIRELI|EPP|S/A|S\.A\.?|\bME\b|MEI|ASSOCIA[ÇC][ÃA]O|"
    r"INSTITUTO|FUNDA[ÇC][ÃA]O|COOPERATIVA|SOCIEDADE)"
    r"\b\.?(?:\s*[-–]\s*(?:EPP|ME))?)"
)
ORGAOS_CNPJ = {
    "18240119000105": "Prefeitura de Varginha",
    "13985869000184": "CISSUL/SAMU",
    "19110162000100": "Fundação Hospitalar do Município de Varginha",
}


def _get(url: str, timeout: int = 45) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


def _baixar_texto(publicacao_id: int) -> tuple[str, str, str]:
    """Retorna (texto, url_pdf, url_leitor). Usa cache de texto por edição."""
    leitor = f"{BASE}/portal/diario-oficial/ver/{publicacao_id}/"
    cache = CACHE_PDF / f"{publicacao_id}.txt"
    cache_paginas = CACHE_PDF / f"{publicacao_id}.pages.json"
    cache_url = CACHE_PDF / f"{publicacao_id}.url.txt"
    url_pdf = cache_url.read_text(encoding="utf-8").strip() if cache_url.exists() else ""
    if not url_pdf:
        html = _get(leitor).decode("utf-8", "replace")
        m = re.search(r'href="(/portal/download/diario-oficial/[^"]+)"', html)
        if not m:
            return "", "", leitor
        ref = _get(BASE + m.group(1)).decode("utf-8", "replace")
        m2 = re.search(r"url=([^'\"]+\.pdf)", ref)
        if not m2:
            return "", "", leitor
        url_pdf = BASE + m2.group(1)
    if cache_paginas.exists():
        paginas = json.loads(cache_paginas.read_text(encoding="utf-8"))
        return "\n\f\n".join(paginas), url_pdf, leitor
    reader = PdfReader(io.BytesIO(_get(url_pdf)))
    paginas = [(p.extract_text() or "") for p in reader.pages]
    texto = "\n\f\n".join(paginas)
    CACHE_PDF.mkdir(parents=True, exist_ok=True)
    cache.write_text(texto, encoding="utf-8")
    cache_paginas.write_text(json.dumps(paginas, ensure_ascii=False), encoding="utf-8")
    cache_url.write_text(url_pdf, encoding="utf-8")
    return texto, url_pdf, leitor


def _classifica(titulo: str) -> tuple[str, str]:
    """Retorna (tipo_norm, rótulo legível)."""
    t = titulo.upper()
    if "ADITIVO" in t:
        return "aditivo", "Termo aditivo"
    if t.startswith("EXTRATO") and "CONTRATO" in t:
        return "contrato", "Extrato de contrato"
    if "DISPENSA" in t:
        return "dispensa", "Dispensa de licitação"
    if "INEXIG" in t:
        return "inexigibilidade", "Inexigibilidade"
    if "EDITAL" in t or "PREG" in t or "CONCORR" in t or "HOMOLOGA" in t or "ATA DE REGISTRO" in t:
        return "licitacao", "Licitação"
    if "PORTARIA" in t:
        return "pessoal", "Portaria"
    if t.startswith("LEI"):
        return "norma", "Lei"
    if t.startswith("DECRETO"):
        return "norma", "Decreto"
    if "RESOLU" in t:
        return "norma", "Resolução"
    return "outro", "Ato"


def _segmentar(texto: str) -> list[tuple[str, str, str, str, int]]:
    """[(tipo_norm, rótulo, título, trecho, página_inicial)] dos atos."""
    candidatos = list(CABECALHO.finditer(texto))
    matches = []
    titulos_vistos = set()
    for m in candidatos:
        linha = re.sub(r"\s+", " ", texto[m.start(1):texto.find("\n", m.start(1))]).strip()
        tipo, _ = _classifica(linha)
        cabecalho = m.group(1).strip()
        letras = re.sub(r"[^A-Za-zÀ-ÖØ-öø-ÿ]", "", cabecalho)
        exige_caixa_alta = (
            tipo in {"norma", "pessoal"}
            or re.match(r"(?i)^(edital|aviso|homologa|ratifica|ata)", cabecalho)
        )
        # Referencias no corpo geralmente aparecem como "Lei nº..." ou
        # "Decreto nº...". Atos reais e seus cabeçalhos são publicados em
        # caixa alta. Sumários com pontilhado e anexos repetidos também não
        # devem virar uma nova publicação.
        if exige_caixa_alta and letras != letras.upper():
            continue
        if re.search(r"\.{8,}", linha) or (tipo == "norma" and "ANEXO" in linha.upper()):
            continue
        chave = "".join(
            c for c in unicodedata.normalize("NFKD", linha).casefold()
            if c.isalnum()
        )
        if chave in titulos_vistos:
            continue
        titulos_vistos.add(chave)
        matches.append(m)
    out = []
    for i, m in enumerate(matches):
        ini = m.start()
        fim = matches[i + 1].start() if i + 1 < len(matches) else len(texto)
        trecho = texto[ini:fim].strip()
        titulo = re.sub(r"\s+", " ", trecho.split("\n")[0])[:120]
        tipo, rotulo = _classifica(titulo)
        # O ^\s* do CABECALHO pode consumir a quebra de pagina; o grupo 1
        # comeca exatamente no titulo e preserva a pagina correta.
        pagina_inicial = texto[:m.start(1)].count("\f") + 1
        out.append((tipo, rotulo, titulo, trecho, pagina_inicial))
    return out


def _valor_brl(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


def _parse_ia_valor(val_str: str) -> float | None:
    if not val_str:
        return None
    val_clean = val_str.lower().strip()

    # Se tem palavra de milhão/bilhão
    multiplicador = 1.0
    if "milh" in val_clean: # milhão, milhões, milhoes
        multiplicador = 1000000.0
    elif "bilh" in val_clean: # bilhão, bilhões, bilhoes
        multiplicador = 1000000000.0
    elif "mil" in val_clean and "milh" not in val_clean:
        multiplicador = 1000.0

    # Remove R$, espaços e caracteres não numéricos. Mantém apenas dígitos, ponto e vírgula.
    val_clean = re.sub(r"[^\d.,]", "", val_clean)
    val_clean = val_clean.strip(".,")
    if not val_clean:
        return None

    # Se tiver vírgula e ponto, ex: 2.404.755,50
    if "," in val_clean and "." in val_clean:
        if val_clean.rfind(",") > val_clean.rfind("."):
            val_clean = val_clean.replace(".", "").replace(",", ".")
        else:
            val_clean = val_clean.replace(",", "")
    elif "," in val_clean:
        # Só tem vírgula, ex: 2,4 ou 2404755,50
        partes = val_clean.split(",")
        if len(partes) == 2 and len(partes[1]) <= 2:
            val_clean = val_clean.replace(",", ".")
        else:
            val_clean = val_clean.replace(",", "")
    elif "." in val_clean:
        # Só tem ponto, ex: 2.404.755 ou 1500.50
        partes = val_clean.split(".")
        if len(partes) == 2 and len(partes[1]) <= 2:
            pass
        else:
            val_clean = val_clean.replace(".", "")

    try:
        val_float = float(val_clean)
        return round(val_float * multiplicador, 2)
    except ValueError:
        return None


_PERIODICIDADES = (
    (re.compile(r"(?i)\bmensalmente\b|\bpor m[êe]s\b|\bmensais?\b"), "por mês"),
    (re.compile(r"(?i)\banualmente\b|\bvalor anual\b|\bao ano\b|\bpor ano\b|\banuais?\b"), "por ano"),
    (re.compile(r"(?i)\bdiariamente\b|\bpor dia\b"), "por dia"),
)


def _periodicidade_do_valor(trecho: str, valor_bruto: str | None) -> str:
    """Diz se o valor e recorrente (mensal/anual), olhando o texto em volta dele.

    Sem isso a mensagem publica mostra so "R$ 111,95", que o cidadao le como
    pagamento unico — quando na verdade e a taxa MENSAL de uso de uma banca no
    Mercado do Produtor. Idem para leis, onde R$ 190.944,32 e o impacto ANUAL.
    Procura primeiro numa janela ao redor do valor (mais preciso); se nao achar,
    cai para o trecho inteiro, que ja e o texto de um unico ato.
    """
    janela = trecho
    if valor_bruto:
        pos = trecho.find(valor_bruto)
        if pos >= 0:
            janela = trecho[max(0, pos - 250): pos + 250]
    for regex, rotulo in _PERIODICIDADES:
        if regex.search(janela):
            return rotulo
    if janela is not trecho:
        for regex, rotulo in _PERIODICIDADES:
            if regex.search(trecho):
                return rotulo
    return ""


_EXERCICIO_RE = re.compile(
    r"(?i)(?:impacto|despesa|estimativa|previs[ãa]o)[^\n:]{0,60}?(20\d{2})\s*[:\-]\s*"
    r"(?:R\$|R\s*\$)\s*([\d.]+,\d{2})"
)


_TIPO_DESPESA_RE = re.compile(r"(?i)DESPESA\s+DO\s+TIPO\s*:?\s*([A-ZÁÂÃÉÊÍÓÔÕÚÇ]+)")
_SEM_REFLEXO_RE = re.compile(r"(?i)(?:impacto|despesa)[^\n:]{0,60}?(20\d{2})\s*[:\-]\s*sem\s+reflexo")


def _perfil_da_despesa(trecho: str) -> dict:
    """Diz se a despesa ACABA ou se REPETE todo ano — muda o sentido do numero.

    A LRF (art. 16) obriga declarar o impacto do exercicio de vigencia e dos
    dois seguintes. Isso e formalidade legal, NAO o prazo do contrato. Somar os
    anos declarados e chamar de "total comprometido" so faz sentido quando a
    despesa termina (tipo EXTRAORDINARIA, com um exercicio final "sem reflexo").
    Numa despesa CONTINUADA o valor se repete indefinidamente: apresentar a soma
    de 2 anos como total SUBDIMENSIONA o compromisso — o erro oposto ao que
    queriamos corrigir. Entao aqui so classificamos; quem rotula e o bot.
    """
    tipo = ""
    m = _TIPO_DESPESA_RE.search(trecho)
    if m:
        bruto = m.group(1).upper()
        if bruto.startswith("CONTINUAD"):
            tipo = "continuada"
        elif bruto.startswith("EXTRAORDINARI") or bruto.startswith("EXTRAORDINÁRI"):
            tipo = "extraordinaria"
    anos_sem_reflexo = sorted({m.group(1) for m in _SEM_REFLEXO_RE.finditer(trecho)})
    return {"tipo": tipo, "encerra_em": anos_sem_reflexo}


def _valores_por_exercicio(trecho: str) -> list[dict]:
    """Captura o impacto ano a ano quando o ato compromete varios exercicios.

    Leis com impacto orcamentario declaram "IMPACTO NO ORCAMENTO/2026: R$ X" e
    "IMPACTO NO ORCAMENTO/2027: R$ Y". Publicar so o primeiro ano subdimensiona
    o compromisso: a LEI 7.595 saiu no grupo como R$ 250.000,00 quando o total
    comprometido era R$ 689.812,00 (250 mil em 2026 + 439,8 mil em 2027).
    Transparencia exige mostrar o quadro inteiro, nao a fatia mais simpatica.
    """
    achados: dict[str, float] = {}
    for m in _EXERCICIO_RE.finditer(trecho):
        valor = _valor_brl(m.group(2))
        if valor is not None:
            achados[m.group(1)] = valor
    return [{"ano": ano, "valor": achados[ano]} for ano in sorted(achados)]


def _extrai_valores(trecho: str) -> dict:
    # Remove linhas de tabelas de projeção de faturamento para evitar falsos positivos gigantes
    # Ex: "2026 R$ 13.000.000,00" ou "2026: R$ 13.000.000,00" ou "2026 - R$ 13.000.000,00"
    trecho_limpo = re.sub(r"(?im)^\s*(?:20\d{2})\b.*?(?:R\$|R\s*\$)\s*[\d.,]+.*$", "", trecho)
    brutos = MONEY_RE.findall(trecho_limpo)
    vals = sorted({_valor_brl(v) for v in brutos}, reverse=True)
    unico = vals[0] if len(vals) == 1 else None
    # Periodicidade so faz sentido quando ha um valor definido para descrever.
    bruto_do_unico = brutos[0] if (unico is not None and brutos) else None
    return {
        "total": unico,
        "encontrados": vals[:6],
        "natureza": "valor citado no ato",
        "fonte_total": "texto oficial do Diário" if len(vals) == 1 else "",
        "confianca": "media" if len(vals) == 1 else "indisponivel",
        "periodicidade": _periodicidade_do_valor(trecho, bruto_do_unico) if unico is not None else "",
        "por_exercicio": _valores_por_exercicio(trecho),
        "perfil_despesa": _perfil_da_despesa(trecho),
    }


def _extrai_envolvidos(trecho: str) -> list[dict]:
    # PDFs podem quebrar a razao social no meio da linha. Normalizar os
    # espacos preserva o nome completo e as distancias relativas ao CNPJ.
    trecho = re.sub(r"\s+", " ", trecho)
    nomes = []
    for m in RAZAO_RE.finditer(trecho):
        nome = re.sub(r"\s+", " ", m.group(1)).strip(" .,:-")
        nome_baixo = nome.lower()
        parece_rodape = nome_baixo.startswith("varginha/mg") or "diario oficial" in nome_baixo
        if 6 <= len(nome) <= 80 and not parece_rodape and all(nome != item[0] for item in nomes):
            nomes.append((nome, m.start()))
    cnpjs = []
    for m in CNPJ_RE.finditer(trecho):
        cnpj = m.group(0)
        limpo = re.sub(r"\D", "", cnpj)
        if len(limpo) == 14 and all(limpo != item[1] for item in cnpjs):
            cnpjs.append((cnpj, limpo, m.start()))

    usados = set()
    env = []
    for nome, posicao_nome in nomes[:4]:
        proximos = [
            (abs(posicao_cnpj - posicao_nome), indice, cnpj)
            for indice, (cnpj, limpo, posicao_cnpj) in enumerate(cnpjs)
            if indice not in usados and limpo not in ORGAOS_CNPJ and abs(posicao_cnpj - posicao_nome) <= 320
        ]
        item = {"nome": nome, "papel": "empresa"}
        if proximos:
            _, indice, cnpj = min(proximos)
            item["cnpj"] = cnpj
            usados.add(indice)
        env.append(item)

    for indice, (cnpj, limpo, _) in enumerate(cnpjs):
        if indice in usados:
            continue
        if limpo in ORGAOS_CNPJ:
            env.append({"nome": ORGAOS_CNPJ[limpo], "cnpj": cnpj, "papel": "orgao"})
        else:
            env.append({"nome": "", "cnpj": cnpj, "papel": "cnpj"})
    return env[:6]


def _orgao_ato(trecho: str) -> str:
    texto = trecho.lower()
    if "cissul" in texto or "consórcio intermunicipal de saúde" in texto:
        return "CISSUL/SAMU"
    if "fundação hospitalar do município" in texto or "fhomuv" in texto:
        return "Fundação Hospitalar do Município de Varginha"
    return "Prefeitura de Varginha"


def _numero(titulo: str) -> str:
    m = NUM_ATO_RE.search(titulo)
    return m.group(1) if m else ""


def _monta_ato(tipo, rotulo, titulo, trecho, edicao, url_pdf, leitor, pagina_inicial=1) -> dict:
    ano = edicao.get("ano")
    data = (edicao.get("data") or "")[:10]
    numero = _numero(titulo)
    envolvidos = _extrai_envolvidos(trecho)
    orgao = _orgao_ato(trecho)

    ia = enriquecedor_ia.enriquecer({
        "fonte": "diario",
        "tipo": rotulo,
        "titulo": titulo,
        "texto": trecho,
        "autor": "Prefeitura de Varginha",
        "data": data,
    })

    # Extrai valores com regex
    valores = _extrai_valores(trecho)
    # A IA pode escolher qual dos valores literais e o principal, mas nao pode
    # introduzir um numero que nao tenha sido encontrado no texto oficial.
    valor_ia_str = ia.get("valor_principal")
    val_ia = _parse_ia_valor(valor_ia_str)
    if val_ia is not None and val_ia in valores["encontrados"]:
        valores["total"] = val_ia
        valores["fonte_total"] = "texto oficial do Diário, selecionado pela IA"
        valores["confianca"] = "alta"
    valores["valor_principal_ia"] = valor_ia_str or ""
    pagina_valor = None
    if valores.get("total") is not None:
        alvo = f"{float(valores['total']):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        posicao = trecho.find(alvo)
        if posicao >= 0:
            pagina_valor = int(pagina_inicial) + trecho[:posicao].count("\f")
    valores["pagina"] = pagina_valor
    valores["link_verificacao"] = f"{url_pdf}#page={pagina_valor}" if url_pdf and pagina_valor else url_pdf

    slug = re.sub(r"[^a-z0-9]", "", titulo.lower())[:16]
    return {
        "id": f"DIARIO-{ano}-{edicao.get('edicao')}-{tipo}-{slug}",
        "fonte": "diario",
        "tipo": tipo,
        "tipo_label": rotulo,
        "orgao": orgao,
        "titulo": titulo,
        "numero": numero,
        "data": data,
        "categoria": "Diário Oficial",
        "relevancia": ia["interesse_publico"],
        "tema": ia["tema"],
        "resumo": ia["resumo"] or titulo,
        "pontos_atencao": ia["pontos_atencao"],
        "envolvidos": envolvidos,
        "valores": valores,
        "edicao": edicao.get("edicao"),
        "links": {
            "publicacao": leitor,
            "anexo_pdf": url_pdf,
        },
        "localizacao": {
            "pagina_inicial": int(pagina_inicial),
            "link_direto": f"{url_pdf}#page={int(pagina_inicial)}" if url_pdf else "",
        },
        "origem_ia": ia.get("_origem_ia", ""),
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def coletar_diario(limite_edicoes: int = 3) -> list[dict]:
    dados = json.loads(DIARIO_JSON.read_text(encoding="utf-8"))
    edicoes = dados.get("ultimas", [])
    edicoes.sort(key=lambda e: (e.get("data") or ""), reverse=True)
    if limite_edicoes > 0:
        edicoes = edicoes[:limite_edicoes]
    print(f"→ Diário: {len(edicoes)} edição(ões) "
          f"(IA: {'ON' if enriquecedor_ia.tem_ia() else 'OFF (fallback)'})", flush=True)

    # Fase 1: baixa o texto de cada edição (cacheado) e junta todos os atos aceitos.
    tarefas: list[tuple] = []
    for e in edicoes:
        pid = e.get("publicacao_id")
        if not pid:
            continue
        try:
            texto, url_pdf, leitor = _baixar_texto(pid)
        except Exception as ex:
            print(f"  ! edição {e.get('edicao')}: download falhou ({ex})", flush=True)
            continue
        if not texto:
            print(f"  ! edição {e.get('edicao')}: sem texto", flush=True)
            continue
        atos = _segmentar(texto)
        aceitos = [a for a in atos if a[0] in TIPOS_ACEITOS]
        print(f"  edição {e.get('edicao')}: {len(atos)} ato(s), {len(aceitos)} aceito(s)", flush=True)
        for tipo, rotulo, titulo, trecho, pagina_inicial in aceitos:
            tarefas.append((tipo, rotulo, titulo, trecho, e, url_pdf, leitor, pagina_inicial))

    # Fase 2: enriquece os atos (IA) — em paralelo quando GEMINI_WORKERS>1.
    total = len(tarefas)
    feito = [0]
    trava = threading.Lock()

    def _proc(t):
        pub = _monta_ato(*t)
        with trava:
            feito[0] += 1
            if feito[0] % 25 == 0 or feito[0] == total:
                print(f"    {feito[0]}/{total} atos…", flush=True)
        return pub

    workers = max(1, int(os.getenv("GEMINI_WORKERS", "1")))
    if workers > 1 and tarefas:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            pubs = list(ex.map(_proc, tarefas))
    else:
        pubs = [_proc(t) for t in tarefas]
    print(f"  ✓ {len(pubs)} publicação(ões) do Diário", flush=True)
    return pubs


def _resolver_ids_colidentes(publicacoes: list[dict]) -> list[dict]:
    """Remove duplicatas exatas e preserva atos distintos com IDs unicos.

    O slug historico e curto e pode coincidir em editais numerados diferentes.
    Mantemos o primeiro ID por compatibilidade com o historico do WhatsApp e
    acrescentamos numero/pagina/hash somente aos atos seguintes.
    """
    usados = set()
    assinaturas = set()
    saida = []
    for pub in publicacoes:
        pid = str(pub.get("id") or "")
        pagina = str((pub.get("localizacao") or {}).get("pagina_inicial") or "")
        titulo = re.sub(r"\s+", " ", str(pub.get("titulo") or "")).strip().casefold()
        assinatura = (str(pub.get("edicao") or ""), titulo, pagina)
        if assinatura in assinaturas:
            continue
        assinaturas.add(assinatura)
        if pid in usados:
            sufixo = re.sub(r"[^0-9a-z]", "", str(pub.get("numero") or "").casefold())
            sufixo = sufixo or (f"p{pagina}" if pagina else hashlib.sha1(titulo.encode("utf-8")).hexdigest()[:8])
            candidato = f"{pid}-{sufixo}"
            indice = 2
            while candidato in usados:
                candidato = f"{pid}-{sufixo}-{indice}"
                indice += 1
            pub = dict(pub)
            pub["id"] = candidato
            pid = candidato
        usados.add(pid)
        saida.append(pub)
    return saida


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--edicoes", type=int, default=3, help="0 = todas")
    ap.add_argument("--full", action="store_true", help="substitui a base em vez de mesclar")
    args = ap.parse_args()
    novas = coletar_diario(args.edicoes)
    pubs = novas

    # No uso diário, troca apenas as edições que foram processadas com sucesso
    # e preserva todo o histórico anterior. Isso também protege uma edição cuja
    # página/PDF esteja temporariamente indisponível.
    if not args.full and SAIDA.exists():
        try:
            anterior = json.loads(SAIDA.read_text(encoding="utf-8"))
            existentes = anterior.get("publicacoes", [])
            edicoes_atualizadas = {str(pub.get("edicao")) for pub in novas if pub.get("edicao") is not None}
            preservadas = [
                pub for pub in existentes
                if str(pub.get("edicao")) not in edicoes_atualizadas
            ]
            pubs = preservadas + novas
            print(
                f"  incremental: {len(preservadas)} anterior(es) preservada(s), "
                f"{len(novas)} registro(s) atualizado(s)",
                flush=True,
            )
        except Exception as exc:
            print(f"  ! base anterior não pôde ser mesclada: {exc}", flush=True)

    antes_ids = len(pubs)
    pubs = _resolver_ids_colidentes(pubs)
    if len(pubs) != antes_ids:
        print(f"  deduplicacao: {antes_ids - len(pubs)} repeticao(oes) exata(s) removida(s)", flush=True)
    pubs.sort(key=lambda pub: (pub.get("data") or "", str(pub.get("edicao") or ""), pub.get("id") or ""), reverse=True)
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fonte": "diario",
        "total": len(pubs),
        "publicacoes": pubs,
    }
    temporario = SAIDA.with_suffix(".json.tmp")
    temporario.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(temporario, SAIDA)
    print(f"✓ Salvo: {SAIDA}  ({len(pubs)} publicações)")


if __name__ == "__main__":
    main()
