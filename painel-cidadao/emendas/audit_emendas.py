# -*- coding: utf-8 -*-
"""
Porta de qualidade das emendas — rode ANTES de cada deploy do portal /emendas/.
    python audit_emendas.py
Verifica consistência dos totais, itemização das Pix, ausência de mojibake,
duplicatas e federal residual. Sai com código 1 se houver PROBLEMA (para CI).
"""
import json, io, re, collections, os, sys

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

def load(nome):
    t = io.open(os.path.join(BASE, nome), encoding="utf-8").read()
    return json.loads(t[t.index("{"):t.rindex("}")+1])

d = load("emendas.js")
f = load("emendas_federais.js")
emendas, pix, resumo = d["emendas"], f["emendas"], f["resumoTipos"]
problemas, avisos = [], []

# 1. soma dos tipos == totalFederal
soma_tipos = sum(t["total"] for t in resumo)
if abs(soma_tipos - f["metadata"]["totalFederal"]) > 0.01:
    problemas.append(f"totalFederal != soma dos tipos ({soma_tipos:.2f})")

# 2. cada tipo do resumo == soma dos registros itemizados daquela categoria
por_cat = collections.defaultdict(float)
for e in pix:  # pix = f["emendas"] = TODAS as federais itemizadas
    por_cat[e.get("categoria")] += e.get("valor", 0)
for t in resumo:
    itemizado = por_cat.get(t["categoria"], 0)
    if abs(itemizado - t["total"]) > 0.01:
        problemas.append(f"{t['categoria']}: itemizado ({itemizado:.2f}) != resumo ({t['total']:.2f})")

# 3. campos obrigatórios em todas as federais.
# Registros somenteNoBetha (pendentes de repasse) legitimamente têm valor 0.
for e in pix:
    obrig = ("autor","ano","emenda","beneficiario","objeto","fonteUrl","categoria")
    for c in obrig:
        if not e.get(c):
            problemas.append(f"Federal {e.get('emenda','?')}: campo '{c}' vazio")
    if "valor" not in e:
        problemas.append(f"Federal {e.get('emenda','?')}: campo 'valor' ausente")

# 4. maiores beneficiários não somam mais que o total
for t in resumo:
    stb = sum(b["valor"] for b in t.get("topBeneficiarios", []))
    if stb > t["total"] + 0.01:
        problemas.append(f"{t['categoria']}: maiores benef. ({stb:.2f}) > total ({t['total']:.2f})")

# 5. mojibake real (double-encoding)
MOJ = re.compile(r"Ã§|Ã£|Ã©|Ã³|Ãª|Ã¡|Ã­|Âº|Â·|ï¿½|�")
for nome, obj in (("emendas.js", d), ("emendas_federais.js", f)):
    if MOJ.search(json.dumps(obj, ensure_ascii=False)):
        problemas.append(f"{nome}: mojibake detectado")

# 6. IDs duplicados
ids = [e.get("id") for e in emendas + pix if e.get("id")]
dup = [k for k, v in collections.Counter(ids).items() if v > 1]
if dup:
    problemas.append(f"IDs duplicados: {dup[:5]}")

# 7. nenhum Federal residual em emendas.js
resid = sum(1 for e in emendas if e.get("tipo") == "Federal")
if resid:
    problemas.append(f"{resid} 'Federal' residual em emendas.js (esperado 0)")

# avisos de qualidade (não bloqueiam, mas informam)
avisos.append(f"valor zerado: {sum(1 for e in emendas if not e.get('valor'))}")
avisos.append(f"sem autor: {sum(1 for e in emendas if not (e.get('autor') or '').strip())}")
avisos.append(f"sem beneficiário: {sum(1 for e in emendas if not (e.get('beneficiario') or '').strip())}")

print(f"Base: {len(emendas)} mun/est + {len(pix)} pix | Federal total R$ {soma_tipos:,.2f}")
print("AVISOS: " + " | ".join(avisos))
if problemas:
    print("\nPROBLEMAS:")
    for p in problemas:
        print("  X " + p)
    sys.exit(1)
print("\nOK — base consistente, pronta para deploy.")
