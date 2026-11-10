"""Publicidade Transparente: consultas públicas HTML, sem credenciais.

Primeira coleta: todos os períodos oferecidos. Depois: três meses recentes,
períodos novos e um mês histórico por rodada. Nenhum valor é somado à Betha.
"""
from __future__ import annotations

import argparse
import datetime as dt
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import time
import urllib.parse
import urllib.request

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
BASE = "https://new.publicidadetransparente.com.br"
ORGAOS = {
    "prefeitura": ("Prefeitura de Varginha", "municipio-de-varginha"),
    "camara": ("Câmara Municipal de Varginha", "camara-municipal-de-varginha-mg"),
}
MESES = "jan fev mar abr mai jun jul ago set out nov dez".split()


def texto(value):
    # Razões sociais de MEI podem conter CPF; preservar CNPJ, mascarar CPF.
    return re.sub(r"(?<!\d)(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})(?!\d)",
                  "[CPF protegido]", " ".join(str(value).split()))


def soup(html):
    return BeautifulSoup(html, "html.parser")


def buscar(url, periodo=None):
    data = urllib.parse.urlencode({"periodo": periodo}).encode() if periodo else None
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "FiscalizaVarginha/1.0 (controle-social)"})
    with urllib.request.urlopen(req, timeout=20) as response:
        if urllib.parse.urlparse(response.url).hostname != urllib.parse.urlparse(BASE).hostname:
            raise ValueError("Redirecionamento inesperado da fonte")
        return response.read().decode("utf-8")


def periodos_disponiveis(html):
    select = soup(html).select_one('select[name="periodo"]')
    if select is None:
        raise ValueError("Seletor de períodos ausente; estrutura não reconhecida")
    result = set()
    for option in select.select("option[value]"):
        value = option.get("value", "")
        if re.fullmatch(r"(0[1-9]|1[0-2])/20\d{2}", value):
            mes, ano = value.split("/")
            result.add(f"{ano}-{mes}")
    if not result:
        raise ValueError("Nenhum período verificável no portal")
    return sorted(result, reverse=True)


def centavos(value):
    match = re.fullmatch(r"R\$\s*(-?\d[\d.]*,\d{2})", value.strip())
    if not match:
        raise ValueError("Valor monetário não reconhecido")
    return int(Decimal(match[1].replace(".", "").replace(",", ".")) * 100)


def investimento(html, periodo):
    doc = soup(html)
    titulo = doc.select_one(".titulo_investimento_anomes")
    ano, mes = periodo.split("-")
    esperado = f"{MESES[int(mes)-1]}/{ano}"
    if titulo is None or titulo.get_text(strip=True).lower() != esperado:
        raise ValueError("Resposta não confirma o período solicitado")
    # O HTML do portal omite </li>; selecionar spans evita linhas aninhadas.
    labels = doc.select("ul.lista span.meio")
    values = doc.select("ul.lista span.valor")
    if len(labels) != len(values):
        raise ValueError("Colunas de investimentos inconsistentes")
    itens, total = [], None
    for label, value in zip(labels, values):
        nome, valor = label.get_text(strip=True), value.get_text(strip=True)
        if nome == "Meio" and valor == "Valor":
            continue
        cents = centavos(valor)
        if nome.upper() == "TOTAL GERAL":
            if total is not None:
                raise ValueError("Total duplicado")
            total = cents
        else:
            itens.append({"meio": texto(nome), "valor_centavos": cents})
    if total is None or sum(item["valor_centavos"] for item in itens) != total:
        raise ValueError("Soma dos meios não confere com o total declarado")
    return {"periodo": periodo, "meios": itens, "total_centavos": total}


def catalogo(html, tipo):
    doc = soup(html)
    expected = {"veiculos": "Relação de Veículos", "fornecedores": "Fornecedores de Serviços Complementares", "sessao-publica": "Sessão Pública"}[tipo]
    titulo = doc.select_one(".titulo_principal")
    container = doc.select_one(".veic_forn")
    if titulo is None or titulo.get_text(strip=True) != expected or container is None:
        raise ValueError("Estrutura de cadastro não reconhecida")
    rows = []
    for item in doc.select(".veic_forn .item"):
        table = item.find_parent(class_="journal-table")
        category = table.select_one(".meio_titulo") if table else None
        categoria = texto(category.get_text(" ", strip=True)) if category else "Não informada"
        if tipo == "sessao-publica":
            objeto, data = item.select_one(".sessao_objeto"), item.select_one(".sessao_prazo")
            if objeto is None or data is None:
                raise ValueError("Sessão sem objeto ou data")
            row = {"objeto": texto(objeto.get_text(" ", strip=True)), "data_hora": texto(data.get_text(" ", strip=True)), "situacao": categoria}
        else:
            cells = [texto(c.get_text(" ", strip=True)) for c in item.select(".cell")]
            if not cells:
                raise ValueError("Cadastro sem células")
            inactive = bool(item.select_one(".riscoinativo") or (table and "adjinativo" in table.get("class", [])))
            raw_doc = re.search(r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}", item.get_text(" "))
            row = {"categoria": categoria, "nome": cells[0], "razao_social": cells[1] if len(cells) >= 3 else None,
                   "cnpj": raw_doc.group() if raw_doc else None, "situacao": "inativo" if inactive else "ativo"}
            link = item.select_one("a[href]") or item.find_parent("a", href=True)
            if link and raw_doc:
                url = urllib.parse.urljoin(BASE, link["href"])
                parsed = urllib.parse.urlparse(url)
                if parsed.scheme == "https" and parsed.hostname in {"new.publicidadetransparente.com.br", "www.publicidadetransparente.com.br", "publicidadetransparente.com.br"}:
                    row["url_documento"] = url
        rows.append(row)
    # Uma página vazia não é prova de ausência; manter a evidência anterior.
    if not rows:
        raise ValueError("Cadastro vazio sem declaração verificável de ausência")
    return rows


def coletar(orgao, anterior=None, fetch=buscar, pausa=0.15):
    anterior = anterior or {}
    label, slug = ORGAOS[orgao]
    url = f"{BASE}/view/{slug}/"
    agora = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    meses = {x["periodo"]: dict(x) for x in anterior.get("investimentos", [])}
    cadastros = dict(anterior.get("cadastros", {}))
    erros, datasets = [], {}
    available = anterior.get("periodos_disponiveis", [])

    def failure(key, exc, previous=None):
        erros.append({"consulta": key, "erro": texto(str(exc))[:240]})
        datasets[key] = {"status": "preserved" if previous else "failed", "checked_at": agora, "last_complete_at": (previous or {}).get("consultado_em")}

    try:
        available = periodos_disponiveis(fetch(url + "investimentos/"))
        history = sorted((p for p in available[3:] if p in meses), key=lambda p: meses[p].get("consultado_em", ""))
        requested = list(dict.fromkeys(available[:3] + [p for p in available if p not in meses] + history[:1]))
        for periodo in requested:
            try:
                ano, mes = periodo.split("-")
                html = fetch(url + "investimentos/", f"{mes}/{ano}")
                record = investimento(html, periodo)
                meses[periodo] = {**record, "consultado_em": agora, "url_fonte": url + "investimentos/",
                                  "parametros_consulta": {"periodo": f"{mes}/{ano}"}, "sha256_html": hashlib.sha256(html.encode()).hexdigest()}
                datasets[periodo] = {"status": "ok", "checked_at": agora, "last_complete_at": agora}
            except Exception as exc:
                failure(periodo, exc, meses.get(periodo))
            time.sleep(pausa)
    except Exception as exc:
        failure("periodos", exc)
    for tipo in ("veiculos", "fornecedores", "sessao-publica"):
        try:
            html = fetch(url + tipo + "/")
            cadastros[tipo] = {"registros": catalogo(html, tipo), "consultado_em": agora, "url_fonte": url + tipo + "/",
                               "sha256_html": hashlib.sha256(html.encode()).hexdigest()}
            datasets[tipo] = {"status": "ok", "checked_at": agora, "last_complete_at": agora}
        except Exception as exc:
            failure(tipo, exc, cadastros.get(tipo))
    status = "partial" if erros else "ok"
    if erros and not meses and not cadastros:
        status = "failed"
    return {"schema_version": 1, "orgao": orgao, "label": label, "fonte": "Publicidade Transparente", "url": url,
            "gerado_em": agora, "status": status, "erros": erros,
            "coleta_frescor": {"checked_at": agora, "datasets": datasets},
            "periodos_disponiveis": available, "investimentos": [meses[p] for p in sorted(meses, reverse=True)], "cadastros": cadastros,
            "limites": "Investimentos declarados pelo portal, sem comprovação de pagamento ou entrega. Não somar à Betha ou ao PNCP. Cadastro não comprova contratação. Mês corrente pode estar incompleto.",
            "metodo": "Primeira carga de todos os períodos disponíveis; a cada ciclo, três períodos recentes, novos períodos e um histórico em rodízio. Data de consulta registrada por período."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data" / "chunks")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for orgao in ORGAOS:
        file = args.output_dir / f"publicidade_{orgao}.json"
        previous = json.loads(file.read_text(encoding="utf-8")) if file.exists() else {}
        result = coletar(orgao, previous)
        temp = file.with_suffix(".json.tmp")
        temp.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp.replace(file)
        print(f"Publicidade/{orgao}: {result['status']}; {len(result['investimentos'])} períodos; {len(result['erros'])} consultas inconclusivas", flush=True)


if __name__ == "__main__":
    main()
