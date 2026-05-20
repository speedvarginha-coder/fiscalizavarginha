"""Diagnóstico rápido das diárias da Câmara — roda direto no terminal."""
import sys, json
sys.path.insert(0, ".")
import coletor_betha as cb

PORTAL_CAMARA = "-iAWLe1kr2VQcrW9k2AUBg=="
CONSULTA_DIARIAS_CAMARA = 324755

print("→ Capturando token da Câmara (força novo)…")
tok = cb.get_token(force=True, portal_hash=PORTAL_CAMARA)
print(f"  Token: {tok[:20]}…")

for ano_field, ano_val in [
    ("ano",           "2026"),
    ("ano",           "2025"),
    ("anoExercicio",  "2026"),
    ("anoExercicio",  "2025"),
    (None,            None),          # sem filtro
]:
    label = f"campo={ano_field!r} ano={ano_val!r}"
    try:
        res = cb.baixar_dados_abertos(
            tok, CONSULTA_DIARIAS_CAMARA,
            ano=ano_val,
            portal_hash=PORTAL_CAMARA,
            ano_field=ano_field,
        )
        qtd = len(res.get("main", []))
        files = res.get("files_in_zip", "?")
        fname = res.get("main_filename", "?")
        print(f"  [{label}] → {qtd} linhas | ZIP: {files} arq | CSV: {fname}")
        if qtd > 0:
            print(f"    Colunas: {list(res['main'][0].keys())[:10]}")
            print(f"    Linha 1: {dict(list(res['main'][0].items())[:6])}")
            break
    except Exception as e:
        print(f"  [{label}] ERRO: {e}")
