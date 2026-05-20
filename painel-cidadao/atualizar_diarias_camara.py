"""
Atualiza apenas as diarias da Camara no diarias.json e reconstroi data.js.
Mais rapido que o atualizar.bat completo (~2 min vs ~20 min).
"""
import json, sys, datetime as dt
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import coletor_betha as cb

ROOT = Path(__file__).parent
DATA = ROOT / "data"

PORTAL_CAMARA = "-iAWLe1kr2VQcrW9k2AUBg=="
CONSULTA_DIARIAS_CAMARA = 324755

def _f(v):
    try: return float(str(v or "0").replace(",", ".").strip())
    except: return 0.0

def normaliza_camara(rows):
    out = []
    for r in rows:
        valor = _f(r.get("valorTotal"))
        qtd = _f(r.get("quantidade")) or 1
        out.append({
            "poder": "Camara",
            "ano": str(r.get("ano") or ""),
            "entidade": r.get("nomeEntidade", ""),
            "secretaria": "Camara Municipal",
            "unidade": "Camara Municipal",
            "funcionario": r.get("credor", ""),
            "cpf": r.get("cnpjCpfCredor", ""),
            "cargo": r.get("cargoCredor", ""),
            "numero": r.get("numeroDiaria", ""),
            "data_inicial": r.get("dataInicial", ""),
            "data_final": r.get("dataFinal", ""),
            "quantidade": qtd,
            "valor_unitario": _f(r.get("valorUnitario")) or (valor / qtd if qtd else valor),
            "valor_total": valor,
            "destino": r.get("localDestino", ""),
            "origem": r.get("localOrigem", ""),
            "finalidade": r.get("finalidade", "").strip(),
            "historico": r.get("historico", "").strip(),
            "fonte": "Betha Camara - Diarias de Viagem",
        })
    out.sort(key=lambda x: -x["valor_total"])
    return out

# 1. Token fresco
print("Capturando token da Camara (Playwright)...")
tok = cb.get_token(force=True, portal_hash=PORTAL_CAMARA)
print(f"  Token ok: {tok[:20]}...")

# 2. Coleta 2025 + 2026
ano_atual = dt.datetime.now().year
camara = []
for ano in [ano_atual - 1, ano_atual]:
    try:
        res = cb.baixar_dados_abertos(
            tok, CONSULTA_DIARIAS_CAMARA,
            ano=str(ano), portal_hash=PORTAL_CAMARA, ano_field="ano"
        )
        rows = normaliza_camara(res.get("main", []))
        camara.extend(rows)
        print(f"  Camara diarias {ano}: {len(rows)} registros")
    except Exception as e:
        print(f"  Erro {ano}: {e}")

print(f"  Total Camara: {len(camara)} diarias")

if not camara:
    print("AVISO: nenhum dado coletado. Abortando.")
    sys.exit(1)

# 3. Atualiza diarias.json
diarias_path = DATA / "diarias.json"
diarias = json.loads(diarias_path.read_text(encoding="utf-8")) if diarias_path.exists() else {}
diarias["camara"] = camara
diarias["resumo"]["camara"] = {
    "registros": len(camara),
    "valor_total": round(sum(d["valor_total"] for d in camara), 2),
    "quantidade_total": round(sum(d["quantidade"] for d in camara), 2),
    "servidores": len({d["funcionario"] for d in camara if d["funcionario"]}),
}
diarias_path.write_text(json.dumps(diarias, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"  diarias.json atualizado ({diarias_path.stat().st_size // 1024} KB)")

# 4. Reconstroi data.js via coletor.py --so-sapl (carrega JSONs existentes + grava data.js)
print("Reconstruindo data.js...")
try:
    import subprocess
    result = subprocess.run(
        [sys.executable, str(ROOT / "coletor.py"), "--so-sapl"],
        capture_output=True, text=True, cwd=str(ROOT)
    )
    if result.returncode == 0:
        print("  data.js ok")
    else:
        print(f"  Aviso coletor.py --so-sapl:\n{result.stderr[-400:]}")
except Exception as e:
    print(f"  Erro ao reconstruir data.js: {e}")
    print("  Execute atualizar.bat --so-sapl manualmente se necessario.")

print("\nPronto! Recarregue o painel com Ctrl+F5.")
