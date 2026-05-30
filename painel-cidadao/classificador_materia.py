"""
Fiscaliza Varginha — Classificador de matérias legislativas.

Atribui a cada matéria, de forma DETERMINÍSTICA e pública (regra documentada
no /sobre), dois rótulos para "traduzir" o trabalho do vereador ao cidadão:

  • tema   — área principal (Educação, Saúde, Trânsito/Mobilidade, etc.)
  • grau   — relevância (alto / medio / baixo)

A regra (aprovada para o painel):
  - BAIXO  : matéria simbólica (impacto_zero — moção, homenagem, nome de rua,
             data comemorativa). É legítima, mas separada do trabalho que
             legisla, cobra ou move recurso.
  - ALTO   : Projeto de Lei (ordinária/complementar) com tema ESTRUTURANTE
             (educação, saúde, trânsito, infraestrutura, segurança,
             meio ambiente, assistência, transparência).
  - MÉDIO  : Projeto de Lei sem tema estruturante, OU Indicação/Requerimento
             com pedido prático (obra, sinalização, serviço, etc.).
  - BAIXO  : demais casos (pedido genérico, expediente administrativo).

NÃO é juízo de mérito nem de legalidade — é uma triagem por TIPO + TEMA, para
o cidadão saber o que vale a pena conferir primeiro. Critério único para todos
os vereadores, sem exceção, justamente para não virar perseguição.
"""
from __future__ import annotations

import json
import pathlib
import re
import unicodedata

# Siglas que representam Projeto de Lei (poder de legislar).
# PDL (decreto legislativo) fica de fora: costuma ser título/honraria.
SIGLAS_LEI = {"PLOL", "PLOE", "PLC", "PL", "PLO"}
SIGLAS_PEDIDO = {"IND", "REQ"}

# Temas considerados estruturantes (sobem Projeto de Lei para ALTO).
ESTRUTURANTES = {
    "educacao", "saude", "transito", "infraestrutura",
    "seguranca", "meio_ambiente", "assistencia", "transparencia",
}

# Ordem importa: primeiro tema cujo termo aparecer na ementa vence.
TEMAS = [
    ("saude",          "Saúde",
     ["saude", "hospital", "posto de saude", "ups", "samu", "medic", "vacina",
      "sus", "farmac", "odonto", "enferm", "ambulanc", "upa"]),
    ("educacao",       "Educação",
     ["educa", "escola", "ensino", "creche", "aluno", "professor", "merenda",
      "universidade", "biblioteca", "alfabetiz", "estudante"]),
    ("transito",       "Trânsito/Mobilidade",
     ["transit", "mobilidade", "faixa de pedestre", "faixa elevada", "semaforo",
      "estacionamento", "ciclo", "transporte", "onibus", "sinaliza", "lombada",
      "pedestre", "redutor de velocidade"]),
    ("seguranca",      "Segurança",
     ["seguranca publica", "guarda municipal", "policia", "cameras",
      "monitoramento", "iluminacao publica", "violenc"]),
    ("meio_ambiente",  "Meio ambiente",
     ["ambient", "arboriz", "arvore", "residuo", "reciclag", "sustentab",
      "nascente", "poluic", "saneamento", "esgoto", "coleta seletiva"]),
    ("assistencia",    "Assistência social",
     ["assistencia social", "cras", "creas", "vulnerab", "idoso", "deficien",
      "inclus", "bolsa", "acolhimento", "crianca e adolescente"]),
    ("infraestrutura", "Infraestrutura",
     ["paviment", "asfalt", "recapea", "drenagem", "calcada", "ponte",
      "buraco", "praca", "ilumina", "obra", "reforma de", "manutencao de via",
      "rede de agua", "meio-fio", "meio fio"]),
    ("transparencia",  "Transparência/Fiscalização",
     ["transparenc", "fiscaliza", "dados abertos", "lei de acesso",
      "prestacao de contas", "licitac", "contrato administrativo", "controle social"]),
    ("tributario",     "Tributos/Finanças",
     ["tribut", "imposto", "iptu", "iss ", "taxa", "isenc", "refis", "orcament"]),
    ("cultura",        "Cultura/Esporte/Lazer",
     ["cultura", "esporte", "lazer", "festival", "turismo", "ginasio",
      "quadra", "evento esportivo"]),
]

# Termos práticos que elevam uma Indicação/Requerimento de BAIXO para MÉDIO.
PRATICOS = [
    "paviment", "asfalt", "recapea", "ilumina", "faixa", "sinaliza", "lombada",
    "drenagem", "calcada", "buraco", "reforma", "construc", "manutencao",
    "limpeza", "poda", "rede de agua", "esgoto", "ponto de onibus", "posto de saude",
    "escola", "creche", "praca", "quadra", "academia ao ar livre",
]


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", s)


def tema(ementa: str) -> tuple[str, str]:
    t = _norm(ementa)
    for chave, rotulo, termos in TEMAS:
        if any(termo in t for termo in termos):
            return chave, rotulo
    return "geral", "Geral"


def grau(materia: dict, tema_chave: str) -> str:
    if materia.get("impacto_zero"):
        return "baixo"
    sigla = (materia.get("sigla") or "").upper()
    if sigla in SIGLAS_LEI:
        return "alto" if tema_chave in ESTRUTURANTES else "medio"
    if sigla in SIGLAS_PEDIDO:
        t = _norm(materia.get("ementa", ""))
        if tema_chave in ESTRUTURANTES or any(p in t for p in PRATICOS):
            return "medio"
    return "baixo"


def classificar(materia: dict) -> dict:
    chave, rotulo = tema(materia.get("ementa", ""))
    return {"tema": chave, "tema_label": rotulo, "grau": grau(materia, chave)}


def enriquecer_arquivo(path: pathlib.Path) -> dict:
    """Adiciona tema/tema_label/grau a cada matéria do camara_anos.json. Idempotente."""
    dados = json.loads(path.read_text(encoding="utf-8"))
    contagem = {"alto": 0, "medio": 0, "baixo": 0}
    total = 0
    for ano, bloco in dados.items():
        for m in bloco.get("materias", []):
            c = classificar(m)
            m["tema"] = c["tema"]
            m["tema_label"] = c["tema_label"]
            m["grau"] = c["grau"]
            contagem_key = c["grau"]
            contagem[contagem_key] = contagem.get(contagem_key, 0) + 1
            total += 1
    path.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"arquivo": str(path), "materias": total, **contagem}


def enriquecer_data_js(path: pathlib.Path) -> dict:
    """Patch do bundle data.js (window.ZELA_DATA = {...};) usado no fallback file://."""
    txt = path.read_text(encoding="utf-8")
    ini = txt.index("{")
    fim = txt.rindex("}")
    cabecalho = txt[:ini]
    rodape = txt[fim + 1:]
    dados = json.loads(txt[ini:fim + 1])
    contagem = {"alto": 0, "medio": 0, "baixo": 0}
    total = 0
    for bloco in (dados.get("camara_anos") or {}).values():
        for m in bloco.get("materias", []):
            c = classificar(m)
            m["tema"] = c["tema"]
            m["tema_label"] = c["tema_label"]
            m["grau"] = c["grau"]
            contagem[c["grau"]] = contagem.get(c["grau"], 0) + 1
            total += 1
    novo = cabecalho + json.dumps(dados, ensure_ascii=False, indent=2) + rodape
    path.write_text(novo, encoding="utf-8")
    return {"arquivo": str(path), "materias": total, **contagem}


if __name__ == "__main__":
    root = pathlib.Path(__file__).resolve().parent
    alvos = [
        root / "data" / "chunks" / "camara_anos.json",
        root / "data" / "camara_anos.json",
    ]
    for p in alvos:
        if p.exists():
            print(enriquecer_arquivo(p))
        else:
            print(f"(ausente) {p}")
    data_js = root / "data.js"
    if data_js.exists():
        print(enriquecer_data_js(data_js))
