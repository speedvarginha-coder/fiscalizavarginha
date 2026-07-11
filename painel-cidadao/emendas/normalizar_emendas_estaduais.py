# -*- coding: utf-8 -*-
"""Gera uma camada estadual conservadora sem alterar a extração original."""
import argparse
import json
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

BASE = Path(__file__).resolve().parent
ORIGEM = BASE / "data" / "emendas.js"
DESTINO = BASE / "data" / "emendas_estaduais_normalizadas.js"

NOMES = {
    "Greyce De Queiroz Elias": "GREYCE DE QUEIROZ ELIAS", "Bruno Engler": "BRUNO ENGLER",
    "Bruno De Castro Engler Florencio De Almeida": "BRUNO ENGLER", "Mario Henrique Caixa": "MÁRIO HENRIQUE CAIXA",
    "M�rio Henrique Da Silva": "MÁRIO HENRIQUE CAIXA", "Mauro Tramonte": "MAURO TRAMONTE",
    "Mauro Henrique Tramonte": "MAURO TRAMONTE", "Noraldino Junior": "NORALDINO JÚNIOR",
    "Noraldino Lucio Dias J�nior": "NORALDINO JÚNIOR", "Andr�ia De Jesus Silva": "ANDRÉIA DE JESUS",
    "DIMAS FABIANO TOLEDO JUNIOR": "DIMAS FABIANO", "Alencar Da Silveira Junior": "ALENCAR DA SILVEIRA JÚNIOR",
    "Washington Fernando Rodrigues": "DELEGADO WASHINGTON",
}
CARGOS_FEDERAIS = {"GREYCE DE QUEIROZ ELIAS", "DIMAS FABIANO"}


def carregar(path):
    texto = path.read_text(encoding="utf-8")
    return json.loads(texto[texto.index("{"):texto.rindex("}") + 1])


def url_oficial(valor):
    parsed = urlparse(str(valor or ""))
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def normalizar(registro):
    item = dict(registro)
    autor_original = str(item.get("autor") or "").strip()
    autor = NOMES.get(autor_original, autor_original.upper())
    referencias = item.get("fontes") or []
    tem_pdf = any(f.get("arquivo") or f.get("arquivoUrl") for f in referencias) or bool(item.get("arquivo"))
    oficial = item.get("fonteUrl") if url_oficial(item.get("fonteUrl")) else None
    classificacao = "confirmado" if oficial and tem_pdf else ("parcial" if oficial or tem_pdf else "sem_comprovacao")
    bruto = item.get("valor")
    declarado = float(bruto) if isinstance(bruto, (int, float)) and bruto > 0 else None
    recebido = declarado if classificacao != "sem_comprovacao" and item.get("dataRecurso") else None
    pendencias = []
    if not declarado: pendencias.append("valor_desconhecido")
    if not oficial: pendencias.append("sem_url_oficial")
    if not tem_pdf: pendencias.append("sem_pdf")
    elif not oficial: pendencias.append("pdf_sem_url_oficial")
    if not autor: pendencias.append("autor_nao_informado")
    if declarado and not recebido: pendencias.append("recebimento_nao_comprovado")
    item.update({
        "autorOriginal": autor_original or None, "autor": autor or "", "esferaDocumento": "Estadual",
        "cargoAutor": "Dep. Federal" if autor in CARGOS_FEDERAIS else ("Dep. Estadual" if autor else None),
        "classificacaoComprovacao": classificacao, "valorDeclarado": declarado, "valorRecebido": recebido,
        "valor": recebido, "valorTexto": item.get("valorTexto") if declarado else None,
        "evidencias": {"urlOficial": oficial, "pdfReferenciado": tem_pdf, "pdfOficialAcessivel": bool(oficial and tem_pdf)},
        "pendencias": pendencias,
    })
    return item


def gerar():
    fonte = carregar(ORIGEM)
    itens = [normalizar(e) for e in fonte["emendas"] if e.get("tipo") == "Estadual"]
    classes = Counter(e["classificacaoComprovacao"] for e in itens)
    pendencias = Counter(p for e in itens for p in e["pendencias"])
    return {"metadata": {
        "criterio": "Derivado conservador da base local; nenhuma confirmação foi buscada ou inferida sem fonte.",
        "fonteDerivada": "data/emendas.js", "totalRegistros": len(itens),
        "classificacoes": {k: classes.get(k, 0) for k in ("confirmado", "parcial", "sem_comprovacao")},
        "valoresDesconhecidos": sum(e["valorDeclarado"] is None for e in itens),
        "totalDeclaradoConhecido": sum(e["valorDeclarado"] or 0 for e in itens),
        "totalRecebidoComEvidencia": sum(e["valorRecebido"] or 0 for e in itens),
        "registrosExcluidosDoTotalRecebido": sum(e["classificacaoComprovacao"] == "sem_comprovacao" for e in itens),
        "pendencias": dict(sorted(pendencias.items())),
    }, "emendas": itens}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    payload = gerar()
    saida = "window.EMENDAS_ESTADUAIS_NORMALIZADAS = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"
    if args.check:
        if not DESTINO.exists() or DESTINO.read_text(encoding="utf-8") != saida:
            raise SystemExit("Derivado estadual ausente ou desatualizado")
    else:
        DESTINO.write_text(saida, encoding="utf-8")
    print(json.dumps(payload["metadata"], ensure_ascii=False, indent=2))


if __name__ == "__main__": main()
