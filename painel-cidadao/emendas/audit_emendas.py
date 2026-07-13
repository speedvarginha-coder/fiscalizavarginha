# -*- coding: utf-8 -*-
"""Porta bloqueante de qualidade para os dados publicados em /emendas/."""
from __future__ import annotations

import collections
import io
import json
import os
import re
import sys

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def load(nome: str) -> dict:
    texto = io.open(os.path.join(BASE, nome), encoding="utf-8").read()
    inicio = texto.find("{")
    if inicio < 0:
        raise ValueError(f"JSON não encontrado em {nome}")
    valor, _ = json.JSONDecoder().raw_decode(texto[inicio:])
    return valor


def chave_emenda(registro: dict) -> tuple[str, str]:
    texto = str(registro.get("emendaOriginal") or registro.get("emenda") or "")
    match = re.search(r"(\d{1,4})\s*/\s*(20\d{2})", texto)
    if match:
        return match.group(1).zfill(3), match.group(2)
    return texto.strip().upper(), str(registro.get("anoEmenda") or registro.get("ano") or "")


legada = load("emendas.js")
federal = load("emendas_federais.js")
estadual = load("emendas_estaduais_normalizadas.js")
municipal = load("emendas_municipais_unificadas.js")
problemas: list[str] = []
avisos: list[str] = []

federais = federal["emendas"]
resumo = federal["resumoTipos"]
estaduais = estadual["emendas"]
municipais = municipal["emendas"]

# 1. Total federal precisa bater com os grupos publicados.
soma_tipos = sum(float(item["total"]) for item in resumo)
if abs(soma_tipos - float(federal["metadata"]["totalFederal"])) > 0.01:
    problemas.append(f"totalFederal != soma dos tipos ({soma_tipos:.2f})")

por_categoria: dict[str, float] = collections.defaultdict(float)
for item in federais:
    por_categoria[item.get("categoria", "")] += float(item.get("valor") or 0)
for item in resumo:
    total_itemizado = por_categoria.get(item["categoria"], 0)
    if abs(total_itemizado - float(item["total"])) > 0.01:
        problemas.append(f"{item['categoria']}: itemizado ({total_itemizado:.2f}) != resumo ({item['total']:.2f})")

# 2. Agregados federais jamais podem se declarar um repasse individual.
for item in federais:
    ident = item.get("emenda", "?")
    for campo in ("autor", "ano", "emenda", "beneficiario", "objeto", "fonteUrl", "categoria"):
        if not item.get(campo):
            problemas.append(f"Federal {ident}: campo '{campo}' vazio")
    if "valor" not in item:
        problemas.append(f"Federal {ident}: valor agregado ausente")
    if item.get("granularidade") == "emenda_favorecido_agregado" and item.get("identificador_repasse_confirmado") is True:
        problemas.append(f"Federal {ident}: agregado não pode ser marcado como repasse individual confirmado")

# 3. A camada estadual não pode transformar evidência parcial em recebimento confirmado.
if len(estaduais) != 30:
    problemas.append(f"Estaduais normalizadas: {len(estaduais)} registros (esperado 30)")
if sum(item.get("valorDeclarado") is None for item in estaduais) != 7:
    problemas.append("Estaduais: esperado 7 valores desconhecidos")
for item in estaduais:
    ident = item.get("emenda") or item.get("id")
    if item.get("classificacaoComprovacao") not in ("confirmado", "parcial", "sem_comprovacao"):
        problemas.append(f"Estadual {ident}: classificação inválida")
    if item.get("classificacaoComprovacao") != "confirmado" and item.get("identificador_repasse_confirmado") is True:
        problemas.append(f"Estadual {ident}: repasse confirmado sem classificação confirmada")
    if item.get("valorDeclarado") is None and item.get("valor") is not None:
        problemas.append(f"Estadual {ident}: valor desconhecido apresentado como zero")
    if "esferaDocumento" not in item or "cargoAutor" not in item:
        problemas.append(f"Estadual {ident}: esfera/cargo não separados")

# 4. União municipal: histórico Betha até 2024 + SAPL de 2025 em diante.
meta_municipal = municipal.get("metadata", {})
origens = collections.Counter(item.get("origemMunicipal") for item in municipais)
if meta_municipal.get("totalRegistros") != len(municipais):
    problemas.append("Municipais: metadado totalRegistros diverge da lista publicada")
if meta_municipal.get("registrosHistoricosBetha") != origens.get("historico_betha", 0):
    problemas.append("Municipais: contagem histórica Betha diverge dos registros publicados")
if meta_municipal.get("registrosSapl") != origens.get("sapl_camara", 0):
    problemas.append("Municipais: contagem SAPL diverge dos registros publicados")
chaves_municipais = [chave_emenda(item) for item in municipais]
duplicadas = [chave for chave, quantidade in collections.Counter(chaves_municipais).items() if quantidade > 1]
if duplicadas:
    problemas.append(f"Municipais: duplicatas por número/ano: {duplicadas[:5]}")
for item in municipais:
    ident = item.get("emenda") or item.get("id")
    origem = item.get("origemMunicipal")
    ano = chave_emenda(item)[1]
    if origem not in ("historico_betha", "sapl_camara"):
        problemas.append(f"Municipal {ident}: origem não declarada")
    if origem == "historico_betha" and ano >= "2025":
        problemas.append(f"Municipal {ident}: histórico Betha fora do escopo até 2024")
    if origem == "sapl_camara" and ano < "2025":
        problemas.append(f"Municipal {ident}: SAPL fora do escopo a partir de 2025")
    if item.get("classificacaoComprovacao") != "Inferido":
        problemas.append(f"Municipal {ident}: indicação deve permanecer Inferido, não recebimento confirmado")
    if item.get("valorRecebido") not in (None, ""):
        problemas.append(f"Municipal {ident}: valorRecebido não comprovado foi publicado")

# 5. Só IDs presentes na composição efetivamente exibida entram na auditoria global.
legada_nao_municipal_ou_estadual = [
    item for item in legada["emendas"] if item.get("tipo") not in ("Municipal", "Estadual")
]
visiveis = legada_nao_municipal_ou_estadual + estaduais + municipais + federais
ids = [item.get("id") for item in visiveis if item.get("id")]
duplicados_id = [ident for ident, quantidade in collections.Counter(ids).items() if quantidade > 1]
if duplicados_id:
    problemas.append(f"IDs duplicados na composição publicada: {duplicados_id[:5]}")

mojibake = re.compile(r"ÃƒÂ§|ÃƒÂ£|ÃƒÂ©|ÃƒÂ³|ÃƒÂª|ÃƒÂ¡|ÃƒÂ­|Ã‚Âº|Ã‚Â·|Ã¯Â¿Â½|ï¿½")
for nome, dados in (("emendas.js", legada), ("emendas_federais.js", federal), ("emendas_municipais_unificadas.js", municipal)):
    if mojibake.search(json.dumps(dados, ensure_ascii=False)):
        problemas.append(f"{nome}: mojibake detectado")

avisos.append(f"municipais: {origens.get('historico_betha', 0)} Betha + {origens.get('sapl_camara', 0)} SAPL")
avisos.append(f"federais agregadas: {sum(item.get('granularidade') == 'emenda_favorecido_agregado' for item in federais)}")
avisos.append(f"estaduais parciais: {sum(item.get('classificacaoComprovacao') == 'parcial' for item in estaduais)}")

print(f"Base publicada: {len(municipais)} municipal + {len(estaduais)} estadual + {len(federais)} federal")
print("AVISOS: " + " | ".join(avisos))
if problemas:
    print("\nPROBLEMAS:")
    for problema in problemas:
        print("  X " + problema)
    sys.exit(1)
print("\nOK — base consistente e semanticamente conservadora.")
