import json
import re
from pathlib import Path

# Carregar dados locais
def load_js_object(filepath, var_name):
    content = filepath.read_text(encoding="utf-8")
    m = re.search(r"window\." + var_name + r"\s*=\s*(\{.*?\});\s*$", content, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    # Tentar extrair metadata
    m_meta = re.search(r'"metadata"\s*:\s*(\{.*?\})\s*,\s*"emendas"', content, re.DOTALL)
    if m_meta:
        return {"metadata": json.loads(m_meta.group(1))}
    return None

mun_js = Path("painel-cidadao/emendas/data/emendas_municipais_unificadas.js")
est_js = Path("painel-cidadao/emendas/data/emendas_estaduais_normalizadas.js")
fed_js = Path("painel-cidadao/emendas/data/emendas_federais.js")

meta_mun = load_js_object(mun_js, "EMENDAS_MUNICIPAIS_UNIFICADAS")
meta_est = load_js_object(est_js, "EMENDAS_ESTADUAIS_NORMALIZADAS")
meta_fed = load_js_object(fed_js, "EMENDAS_FEDERAIS")

print("=== CONFERÊNCIA DOS VALORES DA BASE LOCAL ===")
if meta_mun and "metadata" in meta_mun:
    print("MUNICIPAIS (Base Local):")
    print("  Metadata:", json.dumps(meta_mun["metadata"], ensure_ascii=False, indent=4))

if meta_est and "metadata" in meta_est:
    print("\nESTADUAIS (Base Local):")
    print("  Metadata:", json.dumps(meta_est["metadata"], ensure_ascii=False, indent=4))

if meta_fed and "metadata" in meta_fed:
    print("\nFEDERAIS (Base Local):")
    print("  Metadata:", json.dumps(meta_fed["metadata"], ensure_ascii=False, indent=4))
