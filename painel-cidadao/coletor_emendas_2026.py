"""
Investigacao de fontes abertas para emendas impositivas municipais de 2026.

O objetivo deste coletor nao e "adivinhar" emendas: ele verifica fontes
publicas provaveis e separa o que e lista estruturada do que e apenas pista
documental para pedido via LAI/e-SIC.
"""
from __future__ import annotations

import datetime as dt
import html
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

USER_AGENT = "ZelaVarginha/1.0 (fiscalizacao cidada; contato: painel local)"

FONTES = [
    {
        "nome": "Prefeitura - leis e decretos por assunto: emenda impositiva",
        "url": "https://www.varginha.mg.gov.br/portal/leis_decretos/1/0/0/217/0/0/0/0/0/0/0/0/0/0/0/0/0/0/E/data-decrescente/avancada",
        "tipo": "html",
    },
    {
        "nome": "Prefeitura - dados abertos legislacao 2026",
        "url": "https://www.varginha.mg.gov.br/portal/dados-abertos/legislacao/2026",
        "tipo": "json",
    },
    {
        "nome": "Prefeitura - dados abertos legislacao 2025",
        "url": "https://www.varginha.mg.gov.br/portal/dados-abertos/legislacao/2025",
        "tipo": "json",
    },
    {
        "nome": "Camara - emendas impositivas (pagina raiz)",
        "url": "https://www.varginha.mg.leg.br/atividade-legislativa/emendas/emendas-impositivas",
        "tipo": "html",
    },
    {
        "nome": "Camara - emendas impositivas 2026 (URL anterior)",
        "url": "https://www.varginha.mg.leg.br/atividade-legislativa/emendas/emendas-impositivas/2026",
        "tipo": "html",
        "opcional": True,  # pode ser 404 — tratado como aviso, nao erro
    },
    {
        "nome": "Camara - emendas impositivas 2025 (referencia)",
        "url": "https://www.varginha.mg.leg.br/atividade-legislativa/emendas/emendas-impositivas/2025",
        "tipo": "html",
        "opcional": True,
    },
    {
        "nome": "Prefeitura - editais",
        "url": "https://www.varginha.mg.gov.br/portal/editais",
        "tipo": "html",
    },
    {
        "nome": "Prefeitura - diario oficial",
        "url": "https://www.varginha.mg.gov.br/portal/diario-oficial",
        "tipo": "html",
    },
    {
        "nome": "SAPL - materias legislativas 2026 (API)",
        "url": "https://sapl.varginha.mg.leg.br/api/materia/materialegislativa/?ano=2026&tipo=17&page_size=100",
        "tipo": "json_sapl",  # tratamento especial
    },
]

KEYWORDS = [
    "emenda impositiva",
    "emendas impositivas",
    "lei 7510",
    "lei 7.510",
    "lei n 7510",
    "lei no 7510",
    "lei numero 7510",
    "loa 2026",
    "orcamento 2026",
    "orçamento 2026",
    "decreto 12457",
    "decreto 12.457",
    "decreto 12543",
    "decreto 12.543",
    "plano de trabalho",
    "termo de fomento",
]

CNPJ_RE = re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b")
MONEY_RE = re.compile(r"R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}|\b\d{1,3}(?:\.\d{3})+,\d{2}\b")


def _norm(texto: str) -> str:
    return re.sub(r"\s+", " ", (texto or "").strip().lower())


def _fix_mojibake(texto: str) -> str:
    if not texto or ("Ã" not in texto and "Â" not in texto):
        return texto
    try:
        corrigido = texto.encode("latin1").decode("utf-8")
    except UnicodeError:
        return texto
    ruim_original = texto.count("Ã") + texto.count("Â")
    ruim_corrigido = corrigido.count("Ã") + corrigido.count("Â")
    return corrigido if ruim_corrigido < ruim_original else texto


def _strip_html(texto: str) -> str:
    texto = re.sub(r"(?is)<script.*?</script>|<style.*?</style>", " ", texto or "")
    texto = re.sub(r"(?is)<[^>]+>", " ", texto)
    return _fix_mojibake(html.unescape(re.sub(r"\s+", " ", texto)).strip())


def _fetch(url: str, timeout: int = 30) -> tuple[str, str]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        content_type = resp.headers.get("content-type", "")
        charset = resp.headers.get_content_charset() or "utf-8"
        try:
            texto = raw.decode(charset, errors="replace")
        except LookupError:
            texto = raw.decode("utf-8", errors="replace")
        if "Ã" in texto or "Â" in texto:
            utf8 = raw.decode("utf-8", errors="replace")
            if utf8.count("Ã") + utf8.count("Â") < texto.count("Ã") + texto.count("Â"):
                texto = utf8
        return _fix_mojibake(texto), content_type


def _flatten_json(payload) -> list[dict]:
    out: list[dict] = []

    def walk(obj):
        if isinstance(obj, dict):
            if any(not isinstance(v, (dict, list)) for v in obj.values()):
                out.append(obj)
            for v in obj.values():
                if isinstance(v, (dict, list)):
                    walk(v)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(payload)
    return out


def _snip(texto: str, termo: str) -> str:
    low = texto.lower()
    pos = low.find(termo.lower())
    if pos < 0:
        pos = 0
    ini = max(0, pos - 170)
    fim = min(len(texto), pos + 270)
    trecho = texto[ini:fim].strip()
    return re.sub(r"\s+", " ", trecho)


def _classificar(texto: str) -> tuple[str, str]:
    n = _norm(texto)
    tem_cnpj = bool(CNPJ_RE.search(texto))
    tem_valor = bool(MONEY_RE.search(texto))
    if "emenda impositiva" in n and tem_cnpj and tem_valor:
        return "lista estruturada possivel", "Contem expressao de emenda impositiva, CNPJ e valor. Deve ser conferida manualmente."
    if "solicitacao" in n and "emenda impositiva" in n:
        return "canal de solicitacao", "Indica procedimento oficial para solicitar ou formalizar emenda, mas nao lista beneficiarios."
    if "lei 7510" in n or "lei 7.510" in n or "loa 2026" in n or "orcamento 2026" in n or "orçamento 2026" in n:
        return "loa/orcamento", "Pista ligada ao orcamento de 2026. Pode conter anexos ou referencia normativa."
    if "decreto 12.457" in n or "decreto 12457" in n or "decreto 12.543" in n or "decreto 12543" in n:
        return "decreto/regulamentacao", "Pista normativa relacionada a execucao orcamentaria ou regras de emenda."
    if "termo de fomento" in n or "plano de trabalho" in n:
        return "execucao/parceria", "Pode indicar documento de execucao, parceria ou repasse a entidade."
    return "pista documental", "Documento menciona termo relevante, mas ainda nao e lista completa de emendas."


def _extract_links(base_url: str, html_text: str) -> list[dict]:
    links = []
    for href, label in re.findall(r'(?is)<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html_text):
        texto = _strip_html(label)
        url = urllib.parse.urljoin(base_url, href)
        combinado = _norm(f"{texto} {url}")
        if any(k in combinado for k in KEYWORDS):
            links.append({"titulo": texto or url, "url": url, "texto": texto})
    return links


def _scan_text(origem: str, url: str, texto: str) -> list[dict]:
    achados = []
    texto_limpo = _strip_html(texto)
    texto_norm = _norm(texto_limpo)
    termos = [k for k in KEYWORDS if k in texto_norm]
    if not termos:
        return achados
    titulo = origem
    categoria, sinal = _classificar(texto_limpo)
    achados.append({
        "origem": origem,
        "titulo": titulo,
        "tipo": categoria,
        "url": url,
        "termo": termos[0],
        "trecho": _snip(texto_limpo, termos[0]),
        "sinal": sinal,
        "tem_cnpj": bool(CNPJ_RE.search(texto_limpo)),
        "tem_valor": bool(MONEY_RE.search(texto_limpo)),
    })
    return achados


def _scan_json(origem: str, url: str, texto: str) -> list[dict]:
    payload = json.loads(texto)
    registros = _flatten_json(payload)
    achados = []
    for item in registros:
        combinado = _fix_mojibake(" ".join(str(v) for v in item.values() if v is not None))
        n = _norm(combinado)
        termos = [k for k in KEYWORDS if k in n]
        if not termos:
            continue
        titulo = _fix_mojibake(str(
            item.get("titulo")
            or item.get("ementa")
            or item.get("descricao")
            or item.get("nome")
            or item.get("assunto")
            or origem
        ))
        link = (
            item.get("url")
            or item.get("link")
            or item.get("arquivo")
            or item.get("url_pdf")
            or item.get("texto_integral")
            or url
        )
        if isinstance(link, str):
            link = urllib.parse.urljoin(url, link)
        else:
            link = url
        categoria, sinal = _classificar(combinado)
        achados.append({
            "origem": origem,
            "titulo": str(titulo),
            "tipo": categoria,
            "url": link,
            "termo": termos[0],
            "trecho": _snip(combinado, termos[0]),
            "sinal": sinal,
            "tem_cnpj": bool(CNPJ_RE.search(combinado)),
            "tem_valor": bool(MONEY_RE.search(combinado)),
        })
    return achados


def _dedupe(achados: list[dict]) -> list[dict]:
    vistos = set()
    out = []
    for item in achados:
        key = (item.get("url", ""), item.get("titulo", ""), item.get("tipo", ""))
        if key in vistos:
            continue
        vistos.add(key)
        out.append(item)
    return out


def _scan_sapl_api(origem: str, url: str) -> list[dict]:
    """Consulta a API SAPL para listar matérias do tipo Emenda Impositiva (tipo=17)
    do ano 2026. Retorna achados com tipo='emenda_sapl'."""
    achados = []
    nxt: str | None = url
    while nxt:
        try:
            texto, _ = _fetch(nxt, timeout=20)
            payload = json.loads(texto)
        except Exception as e:
            achados.append({
                "origem": origem,
                "titulo": f"Erro ao consultar API SAPL: {e}",
                "tipo": "erro_sapl",
                "url": nxt,
                "termo": "api",
                "trecho": str(e),
                "sinal": "Falha na consulta — verificar disponibilidade do SAPL.",
                "tem_cnpj": False,
                "tem_valor": False,
            })
            break
        for item in payload.get("results", []):
            ementa = _fix_mojibake(item.get("ementa") or "")
            numero = str(item.get("numero") or "")
            ano = str(item.get("ano") or "2026")
            autor_list = item.get("autores", []) or []
            autor = ", ".join(
                a.get("nome") or a.get("parlamentar_nome") or ""
                for a in autor_list if isinstance(a, dict)
            ) if autor_list else ""
            pdf = item.get("texto_original") or ""
            achados.append({
                "origem": origem,
                "titulo": f"Emenda Impositiva {numero}/{ano} — {autor or 'autor nao identificado'}",
                "tipo": "emenda_sapl",
                "url": pdf or url,
                "termo": "emenda impositiva",
                "trecho": ementa[:300] if ementa else "Ementa nao disponivel",
                "sinal": "Emenda impositiva registrada no SAPL 2026 com numero e autor. CNPJ e valor dependem de consulta LAI.",
                "tem_cnpj": bool(CNPJ_RE.search(ementa)),
                "tem_valor": bool(MONEY_RE.search(ementa)),
                "numero": numero,
                "ano": ano,
                "autor": autor,
                "ementa": ementa,
            })
        # paginar
        pag = payload.get("pagination", {})
        nxt = pag.get("links", {}).get("next") if isinstance(pag, dict) else None
    return achados


def coletar() -> dict:
    fontes_verificadas = []
    achados: list[dict] = []


    for fonte in FONTES:
        nome = fonte["nome"]
        url = fonte["url"]
        tipo = fonte.get("tipo", "html")
        opcional = fonte.get("opcional", False)
        try:
            if tipo == "json_sapl":
                local_achados = _scan_sapl_api(nome, url)
                achados.extend(local_achados)
                fontes_verificadas.append({
                    "nome": nome,
                    "url": url,
                    "status": "ok",
                    "resultado": f"{len(local_achados)} achado(s) relevante(s)",
                })
                continue

            texto, content_type = _fetch(url)
            local_achados = []
            if "json" in content_type or tipo == "json" or texto.lstrip().startswith(("{" , "[")):
                try:
                    local_achados = _scan_json(nome, url, texto)
                except Exception:
                    local_achados = _scan_text(nome, url, texto)
            else:
                local_achados = _scan_text(nome, url, texto)
                for link in _extract_links(url, texto):
                    categoria, sinal = _classificar(link["texto"])
                    local_achados.append({
                        "origem": nome,
                        "titulo": link["titulo"],
                        "tipo": categoria,
                        "url": link["url"],
                        "termo": "link relacionado",
                        "trecho": link["texto"],
                        "sinal": sinal,
                        "tem_cnpj": bool(CNPJ_RE.search(link["texto"])),
                        "tem_valor": bool(MONEY_RE.search(link["texto"])),
                    })
            achados.extend(local_achados)
            fontes_verificadas.append({
                "nome": nome,
                "url": url,
                "status": "ok",
                "resultado": f"{len(local_achados)} achado(s) relevante(s)",
            })
        except Exception as exc:
            status = "aviso" if opcional else "erro"
            fontes_verificadas.append({
                "nome": nome,
                "url": url,
                "status": status,
                "resultado": str(exc),
            })

    achados = _dedupe(achados)
    estruturados = [
        a for a in achados
        if a.get("tipo") == "lista estruturada possivel" and a.get("tem_cnpj") and a.get("tem_valor")
    ]
    sapl_emendas = [a for a in achados if a.get("tipo") == "emenda_sapl"]
    lista_encontrada = bool(estruturados or sapl_emendas)

    conclusao = (
        "Foi localizada ao menos uma pista com emenda impositiva, CNPJ e valor. Conferir o documento antes de importar como dado oficial."
        if estruturados else
        f"SAPL lista {len(sapl_emendas)} emenda(s) impositiva(s) de 2026 com numero e autor — sem CNPJ/valor confirmado nas fontes abertas."
        if sapl_emendas else
        "Nao foi localizada, nas fontes abertas verificadas, uma lista consolidada de emendas impositivas 2026 com numero, vereador, entidade, CNPJ, valor e estagio de execucao."
    )

    return {
        "fonte": "Investigacao de fontes abertas sobre emendas impositivas 2026",
        "atualizado_em": dt.datetime.now().isoformat(timespec="seconds"),
        "resumo": {
            "fontes_verificadas": len(fontes_verificadas),
            "fontes_ok": sum(1 for f in fontes_verificadas if f["status"] == "ok"),
            "achados_qtd": len(achados),
            "lista_estruturada_encontrada": lista_encontrada,
            "emendas_sapl_2026": len(sapl_emendas),
            "candidatos_com_valor_cnpj": len(estruturados),
            "conclusao": conclusao,
        },
        "achados": achados,
        "fontes_verificadas": fontes_verificadas,
        "proximos_passos": [
            "Pedir por LAI a relacao completa das emendas impositivas municipais destinadas ao orcamento de 2026.",
            "Solicitar anexos da LOA 2026 com numero da emenda, vereador, beneficiario, CNPJ, valor, objeto e secretaria responsavel.",
            "Solicitar plano de trabalho, empenhos, liquidacoes, pagamentos e estagio atual de execucao por emenda.",
            "Cruzar os CNPJs informados com Portal da Transparencia, Diario Oficial, PNCP e termos de fomento/parceria.",
        ],
    }


def _gerar_lai_txt(sapl_emendas: list[dict]) -> str:
    """Gera rascunho de pedido LAI para emendas impositivas 2026."""
    hoje = dt.date.today().strftime("%d/%m/%Y")
    emendas_listadas = ""
    if sapl_emendas:
        linhas = []
        for e in sapl_emendas:
            linhas.append(f"  - Emenda {e.get('numero','?')}/2026 — Autor: {e.get('autor','nao identificado')}")
            if e.get("ementa"):
                linhas.append(f"    Ementa: {e['ementa'][:200]}..." if len(e.get('ementa','')) > 200 else f"    Ementa: {e.get('ementa','')}")
        emendas_listadas = "\n\nEmendas impositivas localizadas no SAPL (sem CNPJ/valor confirmado):\n" + "\n".join(linhas)
    return f"""PEDIDO DE ACESSO A INFORMACAO (LAI)
Data: {hoje}
Orgao destinatario: Camara Municipal de Varginha-MG / Prefeitura Municipal de Varginha-MG
Canal: e-SIC ou protocolo presencial

REFERENCIA: Emendas Impositivas Municipais — Exercicio 2026

Cidadao solicita, com base na Lei Federal n. 12.527/2011 (Lei de Acesso a Informacao),
art. 10, relacao completa e atualizada das emendas impositivas destinadas ao Orcamento
Municipal de 2026, contendo obrigatoriamente, para cada emenda:

  1. Numero e data de apresentacao da emenda
  2. Nome do vereador autor
  3. Razao social e CNPJ da entidade beneficiaria
  4. Valor total destinado
  5. Valor empenhado, liquidado e pago ate a data da resposta
  6. Objeto / finalidade da emenda
  7. Secretaria municipal responsavel pela execucao
  8. Numero do empenho vinculado (quando houver)
  9. Link para o plano de trabalho ou termo de fomento/parceria

Formato solicitado: planilha (XLSX ou CSV) ou PDF com dados estruturados.

Prazo legal: 20 dias uteis (prorrogavel por mais 10, com justificativa).
{emendas_listadas}

Fundamento legal: art. 7., II, VI e VII, Lei 12.527/2011; art. 6., Decreto 7.724/2012.
"""


def salvar(payload: dict | None = None) -> dict:
    payload = payload or coletar()
    out = DATA / "fontes_emendas_2026.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # Gera rascunho de pedido LAI sempre que nao ha candidatos com CNPJ+valor confirmados
    # (emendas SAPL listam numero/autor mas nao tem CNPJ/valor — LAI continua necessario)
    if not payload.get("resumo", {}).get("candidatos_com_valor_cnpj"):
        sapl_emendas = [a for a in payload.get("achados", []) if a.get("tipo") == "emenda_sapl"]
        lai_txt = _gerar_lai_txt(sapl_emendas)
        lai_out = DATA / "lai_emendas_2026.txt"
        lai_out.write_text(lai_txt, encoding="utf-8")
        print(f"  ! Rascunho LAI gerado: {lai_out} ({lai_out.stat().st_size} bytes)")

    return payload


if __name__ == "__main__":
    resultado = salvar()
    print(json.dumps(resultado["resumo"], ensure_ascii=False, indent=2))
