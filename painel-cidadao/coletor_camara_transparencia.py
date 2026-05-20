"""
Coletor da Transparência da Câmara de Varginha.

Nesta primeira versão, mapeia as seções e links oficiais da página de
transparência. Isso já melhora o relatório porque o cidadão passa a ter uma
trilha clara para conferir despesas, contratos, diárias, folha e cotas.
"""
from __future__ import annotations

from html.parser import HTMLParser
from urllib.parse import urljoin
import json
import re
import urllib.request

BASE = "https://www.varginha.mg.leg.br"
URL = BASE + "/transparencia"


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links: list[dict] = []
        self._href = ""
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            self._href = dict(attrs).get("href", "")
            self._text = []

    def handle_data(self, data):
        if self._href:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href:
            text = re.sub(r"\s+", " ", " ".join(self._text)).strip()
            if text:
                self.links.append({"titulo": text, "url": urljoin(BASE, self._href)})
            self._href = ""
            self._text = []


def _get_text(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "ZelaVarginha/1.0 (controle-social)"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def _categoria(titulo: str, url: str) -> str:
    s = (titulo + " " + url).lower()
    regras = [
        ("despesas", "Despesas"),
        ("receitas", "Receitas"),
        ("contrat", "Contratos"),
        ("licita", "Licitações"),
        ("dispensa", "Dispensas/Inexigibilidades"),
        ("inexig", "Dispensas/Inexigibilidades"),
        ("diária", "Diárias"),
        ("diarias", "Diárias"),
        ("servidor", "Servidores e folha"),
        ("folha", "Servidores e folha"),
        ("remunera", "Servidores e folha"),
        ("cota", "Cotas / verba indenizatória"),
        ("indenizat", "Cotas / verba indenizatória"),
        ("ordem cronológica", "Ordem cronológica de pagamentos"),
        ("conven", "Convênios e transferências"),
        ("lai", "Lei de Acesso à Informação"),
        ("sic", "Lei de Acesso à Informação"),
    ]
    for needle, cat in regras:
        if needle in s:
            return cat
    return "Outros"


def coletar() -> dict:
    try:
        html = _get_text(URL)
    except Exception as e:
        return {
            "fonte": "Portal de Transparência da Câmara de Varginha",
            "url": URL,
            "erro": str(e),
            "links": [],
            "categorias": {},
        }

    parser = LinkParser()
    parser.feed(html)

    seen = set()
    links = []
    for link in parser.links:
        key = (link["titulo"], link["url"])
        if key in seen:
            continue
        seen.add(key)
        cat = _categoria(link["titulo"], link["url"])
        if cat == "Outros" and not any(x in link["url"] for x in ("transparencia", "licit", "contrat", "desp", "diaria")):
            continue
        links.append({**link, "categoria": cat})

    categorias: dict[str, int] = {}
    for link in links:
        categorias[link["categoria"]] = categorias.get(link["categoria"], 0) + 1

    return {
        "fonte": "Portal de Transparência da Câmara de Varginha",
        "url": URL,
        "links": links,
        "categorias": categorias,
        "resumo": {
            "links_mapeados": len(links),
            "categorias_qtd": len(categorias),
        },
    }


if __name__ == "__main__":
    print(json.dumps(coletar(), ensure_ascii=False, indent=2))
