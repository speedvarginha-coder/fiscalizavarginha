import json
import pathlib
import datetime as dt

ROOT = pathlib.Path(".")
DATA_DIR = ROOT / "data"

def load_json(name):
    path = DATA_DIR / name
    if not path.exists():
        print(f"Warning: {name} not found in data/")
        return {}
    return json.loads(path.read_text(encoding="utf-8"))

def rebuild():
    print("Rebuilding data.js from data/*.json files...")
    
    payload = {
        "resumo": load_json("resumo.json"),
        "vereadores": load_json("vereadores.json"),
        "emendas": load_json("emendas.json"),
        "camara_anos": load_json("camara_anos.json"),
        "diario": load_json("diario.json"),
        "prefeitura": load_json("prefeitura.json"),
        "pncp": load_json("pncp.json"),
        "camara_transparencia": load_json("camara_transparencia.json"),
        "cnpjs": load_json("cnpjs.json"),
        "pessoal": load_json("pessoal.json"),
        "diarias": load_json("diarias.json"),
        "fontes_emendas_2026": load_json("fontes_emendas_2026.json"),
        "federal": load_json("federal.json"),
        "atualizado_em": load_json("atualizado_em.json"),
    }
    
    out = ROOT / "data.js"
    content = "/* Gerado por recover_data.py — não editar à mão. */\n"
    content += "window.ZELA_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"
    
    out.write_text(content, encoding="utf-8")
    print(f"Success! data.js recreated ({out.stat().st_size // 1024} KB)")

if __name__ == "__main__":
    rebuild()
