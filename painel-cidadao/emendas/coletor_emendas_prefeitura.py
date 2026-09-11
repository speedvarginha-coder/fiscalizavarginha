# -*- coding: utf-8 -*-
"""Relatorios de emendas publicados pela propria Prefeitura (Betha, consulta 295943).

Por que existe
--------------
As tres bases do painel vem de quem INDICA a emenda: ALMG e Portal de Emendas MG
(estaduais), CGU e Transferegov (federais), SAPL (municipais). Nenhuma delas diz
o que a Prefeitura registrou ter recebido.

Esta consulta e a visao contabil do municipio, e as duas nao batem. Em 04/09/2026,
o relatorio estadual de 2025 trazia sete indicacoes -- 10662, 134171, 134607,
175698, 175699, 175700 e 175707, somando R$ 3.452.788,00, todas para a Fundacao
Hospitalar -- que nao existem em nenhuma das bases de origem nem em nenhuma das
tres planilhas oficiais publicadas por MG. A divergencia so apareceu porque
alguem baixou os PDFs a mao e comparou.

Este coletor faz isso sozinho a cada ciclo. Ele NAO corrige nem completa base
nenhuma: registra o que cada lado afirma e onde os dois discordam. Preencher
lacuna com palpite e o oposto do que este painel se propoe.

Uso:
    python coletor_emendas_prefeitura.py                 # coleta e grava o chunk
    python coletor_emendas_prefeitura.py --pdf-dir DIR   # reaproveita PDFs baixados
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

AQUI = Path(__file__).resolve().parent
ROOT = AQUI.parents[1]
sys.path.insert(0, str(AQUI.parent))

CONSULTA_EMENDAS_PREFEITURA = 295943
SAIDA = ROOT / "painel-cidadao" / "data" / "chunks" / "emendas_prefeitura.json"
CACHE_PDF = ROOT / "private" / "cache" / "emendas-prefeitura"
PORTAL = "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/295943"

# O codigo da emenda muda de formato entre exercicios: "10662/2025" com barra em
# 2025 e "193883" sem barra em 2026. Aceitar so um formato zera a leitura do
# outro ano inteiro, em silencio.
# Formatos reais nos relatorios, um por esfera/exercicio:
#   "193883"          estadual 2026, numero puro
#   "10662/2025"      estadual 2025, numero com o ano colado
#   "S256-162/2026"   estadual 2026, codigo alfanumerico do plano de acao
#   "6.916/2025"      federal 2025, numero com ponto de milhar
#   "202627540001"    federal, codigo de 12 digitos
#   "01/2024"         municipal, numero/ano
# Aceitar so um formato zera a leitura do outro em silencio: era assim que
# 14 emendas ficavam invisiveis para o confronto.
RE_CODIGO = re.compile(r"^0*([A-Z]?[\d.]{1,14}(?:-\d+)?)(?:/(\d{4}))?$")
RE_VALOR = re.compile(r"^[\d.]+,\d{2}$")


def baixar_relatorios(destino: Path) -> list[dict]:
    """Baixa os PDFs anexados a consulta. Devolve os metadados de cada um."""
    import coletor_betha as betha

    destino.mkdir(parents=True, exist_ok=True)
    token = betha.get_token()
    registros = betha._api(
        "POST",
        f"/busca/{CONSULTA_EMENDAS_PREFEITURA}",
        token,
        body={"tamanhoPagina": 200, "pagina": 0},
    )
    saida = []
    for hit in registros.get("hits") or []:
        fonte = hit.get("sourceAsMap") or {}
        anexos = betha._api(
            "GET", f"/busca/{CONSULTA_EMENDAS_PREFEITURA}/anexos/{hit['id']}", token
        )
        for anexo in anexos:
            nome = f"{fonte.get('ano')}_{anexo['nome']}".replace(" ", "_")
            caminho = destino / nome
            req = urllib.request.Request(
                anexo["url"], headers={"User-Agent": "FiscalizaVarginha/1.0"}
            )
            with urllib.request.urlopen(req, timeout=180) as resposta:
                caminho.write_bytes(resposta.read())
            saida.append(
                {
                    "arquivo": caminho,
                    "ano": fonte.get("ano"),
                    "titulo": fonte.get("titulo"),
                    "publicadoEm": fonte.get("dataHoraPublicacao"),
                    "atualizadoEm": fonte.get("dataHoraUltimaAtualizacao"),
                }
            )
    return saida


def ler_emendas(pdf: Path) -> list[dict]:
    """Extrai codigo, valor e beneficiario de cada emenda do relatorio."""
    import fitz

    with fitz.open(pdf) as doc:
        bruto = "\n".join(pagina.get_text() for pagina in doc)
    linhas = [l.strip() for l in bruto.splitlines() if l.strip()]
    # Quantas emendas o PDF tem de fato. Sem isso, "0 divergencias" pode
    # significar "nada diverge" ou "nao li metade do arquivo", e o leitor nao
    # tem como saber qual dos dois.
    blocos = sum(1 for l in linhas if l.startswith("Informações Emenda"))

    emendas = []
    for i, linha in enumerate(linhas):
        if not linha.startswith("Nr Plano"):
            continue
        codigo = None
        pos = None
        for j in range(i - 1, max(-1, i - 9), -1):
            achado = RE_CODIGO.match(linhas[j])
            if achado:
                codigo, pos = achado.group(1), j
                break
        if codigo is None:
            continue
        valores = [
            float(v.replace(".", "").replace(",", "."))
            for v in linhas[pos:i]
            if RE_VALOR.match(v)
        ]
        beneficiario = ""
        for k in range(i, min(i + 12, len(linhas))):
            if linhas[k].startswith("Beneficiário:"):
                beneficiario = linhas[k].split(":", 1)[1].strip()
                break
        emendas.append(
            {
                "codigo": codigo,
                "valor": max(valores) if valores else 0.0,
                "beneficiario": beneficiario,
            }
        )
    return emendas, blocos


def chave(esfera: str, bruto: str, ano_relatorio=None) -> str | None:
    """Normaliza o identificador. Cada esfera numera de um jeito, e comparar
    formatos diferentes inventa divergencia onde nao ha: municipal usa
    numero/ano ("01/2024"), federal usa 12 digitos ("202627540001") e estadual
    usa o numero da indicacao, com ou sem o ano colado."""
    bruto = str(bruto or "").strip()
    if not bruto:
        return None
    if esfera == "Federais":
        achado = re.search(r"\b(20\d{10})\b", bruto)
        if achado:
            return achado.group(1)
        # O relatorio tambem publica "6.916/2025", que o painel guarda igual.
        achado = re.match(r"^([\d.]+)/(\d{4})$", bruto)
        if not achado:
            return None
        return achado.group(1).replace(".", "") + "/" + achado.group(2)
    if esfera == "Municipal":
        achado = re.match(r"^0*(\d{1,4})\s*/\s*(\d{4})$", bruto)
        if achado:
            return f"{int(achado.group(1))}/{achado.group(2)}"
        achado = re.match(r"^0*(\d{1,4})$", bruto)
        # Codigo sem ano: casa so pelo numero. O relatorio de 2026 lista emendas
        # numeradas em 2024 e 2025 executadas naquele exercicio, entao colar o
        # ano do relatorio acusaria como ausentes 45 emendas que o painel tem.
        # Na duvida, o painel nao acusa.
        return achado.group(1) if achado else None
    # Estadual: numero da indicacao, com ou sem o ano colado.
    achado = re.match(r"^0*(\d{2,7})(?:/\d{4})?$", bruto)
    if achado:
        return achado.group(1)
    # Alguns registros de 2026 usam codigo alfanumerico do plano de acao.
    achado = re.match(r"^([A-Z]\d+-\d+)(?:/\d{4})?$", bruto)
    return achado.group(1) if achado else None


def codigos_do_painel(nome: str, campo: str, esfera: str) -> set[str]:
    """Numeros ja conhecidos pela base de origem correspondente."""
    caminho = AQUI / "data" / f"{nome}.js"
    if not caminho.exists():
        return set()
    achado = re.search(
        r"=\s*(\[.*\]|\{.*\})\s*;?\s*$", caminho.read_text(encoding="utf-8"), re.S
    )
    if not achado:
        return set()
    dados = json.loads(achado.group(1))
    registros = dados if isinstance(dados, list) else (dados.get("emendas") or [])
    codigos = set()
    for registro in registros:
        k = chave(esfera, registro.get(campo), registro.get("ano"))
        if k:
            codigos.add(k)
            # Municipal tambem entra so pelo numero, para casar com relatorio
            # de exercicio que nao repete o ano da emenda.
            if esfera == "Municipal" and "/" in k:
                codigos.add(k.split("/")[0])
    return codigos


BASES = {
    "Estaduais": ("emendas_estaduais_normalizadas", "numeroIndicacao"),
    "Municipal": ("emendas_municipais_unificadas", "emenda"),
    "Federais": ("emendas_federais", "emenda"),
}


def conciliar(relatorios: list[dict]) -> dict:
    """Compara o que a Prefeitura registra com o que as bases de origem trazem."""
    conhecidos = {rot: codigos_do_painel(*args, rot) for rot, args in BASES.items()}
    por_relatorio = []
    for item in relatorios:
        titulo = str(item.get("titulo") or "")
        esfera = next((e for e in BASES if e.lower() in titulo.lower()), None)
        emendas, blocos = ler_emendas(item["arquivo"])
        for e in emendas:
            e["chave"] = chave(esfera, e["codigo"], item.get("ano")) if esfera else None
        # Sem chave legivel, nao da para afirmar ausencia: fica de fora da conta.
        ausentes = [
            e for e in emendas
            if esfera and e["chave"] and e["chave"] not in conhecidos[esfera]
        ]
        ilegiveis = [e for e in emendas if esfera and not e["chave"]]
        por_relatorio.append(
            {
                "esfera": esfera or titulo,
                "ano": item.get("ano"),
                "publicadoEm": item.get("publicadoEm"),
                "emendasNoRelatorio": blocos,
                "emendasLidas": len(emendas),
                "leituraCompleta": len(emendas) == blocos,
                "totalNoRelatorio": round(sum(e["valor"] for e in emendas), 2),
                "semCorrespondenciaNoPainel": ausentes,
                "valorSemCorrespondencia": round(sum(e["valor"] for e in ausentes), 2),
                "codigoIlegivel": len(ilegiveis),
            }
        )
    return {
        "schema_version": 1,
        "fonte": "Relatorios de emendas da Prefeitura de Varginha (Betha, consulta 295943)",
        "fontePagina": PORTAL,
        "geradoEm": datetime.now(timezone.utc).isoformat(),
        "criterio": (
            "Compara o codigo de cada emenda do relatorio da Prefeitura com as bases de "
            "origem do painel. Divergencia e registrada, nunca corrigida por inferencia."
        ),
        "limitacao": (
            "Ausencia aqui nao prova irregularidade: pode ser numeracao interna da "
            "Prefeitura, emenda ainda nao publicada pela origem ou instrumento que nao "
            "transita pelo registro municipal. Serve como ponto de partida para conferir "
            "na fonte primaria."
        ),
        "resumo": {
            "relatorios": len(por_relatorio),
            "emendasSemCorrespondencia": sum(
                len(r["semCorrespondenciaNoPainel"]) for r in por_relatorio
            ),
            "valorSemCorrespondencia": round(
                sum(r["valorSemCorrespondencia"] for r in por_relatorio), 2
            ),
            "relatoriosLidosPorInteiro": sum(
                1 for r in por_relatorio if r["leituraCompleta"]
            ),
            "emendasNaoLidas": sum(
                r["emendasNoRelatorio"] - r["emendasLidas"] for r in por_relatorio
            ),
        },
        "porRelatorio": por_relatorio,
    }


def brl(valor: float) -> str:
    return ("R$ " + f"{valor:,.2f}").replace(",", "X").replace(".", ",").replace("X", ".")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", help="usa PDFs ja baixados em vez de consultar o Betha")
    args = ap.parse_args()

    if args.pdf_dir:
        relatorios = []
        for pdf in sorted(Path(args.pdf_dir).glob("*.pdf")):
            ano = re.match(r"^(\d{4})_", pdf.name)
            relatorios.append(
                {
                    "arquivo": pdf,
                    "ano": int(ano.group(1)) if ano else None,
                    "titulo": pdf.stem.split("_", 1)[-1].replace("_", " "),
                    "publicadoEm": None,
                    "atualizadoEm": None,
                }
            )
    else:
        try:
            relatorios = baixar_relatorios(CACHE_PDF)
        except Exception as exc:  # noqa: BLE001
            # Fonte indisponivel (HTTP 500, timeout, etc.) nao e motivo para
            # reescrever a base: preserva o chunk anterior e devolve codigo 2,
            # que o ciclo financeiro trata como "preservado" sem desfazer as
            # outras fontes ja coletadas.
            print(f"AVISO: nao foi possivel baixar os relatorios da Prefeitura ({exc}); base anterior preservada.")
            return 2

    if not relatorios:
        print("Nenhum relatorio de emendas da Prefeitura encontrado; base anterior preservada.")
        return 2

    payload = conciliar(relatorios)
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    for item in payload["porRelatorio"]:
        print(
            f"  {str(item['esfera']):12} {item['ano']} | "
            f"{item['emendasLidas']:4}/{item['emendasNoRelatorio']:<4} lidas | "
            f"sem correspondencia: {len(item['semCorrespondenciaNoPainel']):3} "
            f"({brl(item['valorSemCorrespondencia'])})"
        )
    resumo = payload["resumo"]
    print(
        f"TOTAL sem correspondencia: {resumo['emendasSemCorrespondencia']} emenda(s), "
        f"{brl(resumo['valorSemCorrespondencia'])}"
    )
    print(f"Gravado em {SAIDA}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
