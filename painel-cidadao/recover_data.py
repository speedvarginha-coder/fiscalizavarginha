import json
import pathlib
import datetime as dt
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = pathlib.Path(".")
DATA_DIR = ROOT / "data"

def load_json(name):
    # Tenta carregar da raiz de data/ primeiro
    path = DATA_DIR / name
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    
    # Se nao existir em data/, tenta em data/chunks/
    chunk_path = DATA_DIR / "chunks" / name
    if chunk_path.exists():
        return json.loads(chunk_path.read_text(encoding="utf-8"))
        
    print(f"Warning: {name} not found in data/ or data/chunks/")
    return {}

def rebuild():
    print("Rebuilding data.js and data/chunks/ from data/*.json files...")
    
    # Load all individual datasets from data/
    resumo = load_json("resumo.json")
    vereadores = load_json("vereadores.json")
    emendas = load_json("emendas.json")
    camara_anos = load_json("camara_anos.json")
    diario = load_json("diario.json")
    prefeitura = load_json("prefeitura.json")
    pncp = load_json("pncp.json")
    camara_transparencia = load_json("camara_transparencia.json")
    camara_betha = load_json("camara_betha.json")
    cnpjs = load_json("cnpjs.json")
    pessoal = load_json("pessoal.json")
    diarias = load_json("diarias.json")
    fontes_emendas_2026 = load_json("fontes_emendas_2026.json")
    federal = load_json("federal.json")
    atualizado_em = load_json("atualizado_em.json")
    auditoria_dados = load_json("auditoria_dados.json")
    remuneracao_vereadores = load_json("remuneracao_vereadores.json")
    publicacoes_diario = load_json("publicacoes_diario.json")
    publicacoes_estruturadas = load_json("publicacoes_estruturadas.json")
    convenios = load_json("convenios.json")
    educacao = load_json("educacao.json")
    licitacoes = load_json("licitacoes.json")
    obras_educacao = load_json("obras_educacao.json")
    receitas = load_json("receitas.json")
    sancoes_fornecedores = load_json("sancoes_fornecedores.json")
    indice_relevancia = load_json("indice_relevancia.json")
    # mudancas_coleta é gerado pelo pipeline JS (generate-data-snapshots.mjs);
    # não existe em data/ — ler de data/chunks/ para preservar caso já exista.
    _mudancas_chunk = DATA_DIR / "chunks" / "mudancas_coleta.json"
    mudancas_coleta = (
        json.loads(_mudancas_chunk.read_text(encoding="utf-8"))
        if _mudancas_chunk.exists()
        else {}
    )


    # 1. Save chunks to data/chunks/
    chunks_dir = DATA_DIR / "chunks"
    chunks_dir.mkdir(exist_ok=True)
    
    chunk_mapping = {
        "resumo.json": resumo,
        "vereadores.json": vereadores,
        "emendas.json": emendas,
        "camara_anos.json": camara_anos,
        "diario.json": diario,
        "prefeitura.json": prefeitura,
        "pncp.json": pncp,
        "camara_transparencia.json": camara_transparencia,
        "camara_betha.json": camara_betha,
        "cnpjs.json": cnpjs,
        "pessoal.json": pessoal,
        "diarias.json": diarias,
        "fontes_emendas_2026.json": fontes_emendas_2026,
        "federal.json": federal,
        "atualizado_em.json": atualizado_em,
        "auditoria_dados.json": auditoria_dados,
        "remuneracao_vereadores.json": remuneracao_vereadores,
        "publicacoes_diario.json": publicacoes_diario,
        "publicacoes_estruturadas.json": publicacoes_estruturadas,
        "convenios.json": convenios,
        "educacao.json": educacao,
        "licitacoes.json": licitacoes,
        "obras_educacao.json": obras_educacao,
        "receitas.json": receitas,
        "sancoes_fornecedores.json": sancoes_fornecedores,
        "mudancas_coleta.json": mudancas_coleta,
        "indice_relevancia.json": indice_relevancia,
    }
    
    for filename, payload in chunk_mapping.items():
        chunk_out = chunks_dir / filename
        chunk_out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    
    print("  ✓ All data chunks written to data/chunks/")

    # 2. Rebuild/Write manifest.json
    manifest = {
        "gerado_em": dt.datetime.now().isoformat(timespec="seconds"),
        "chunks": {}
    }
    for chunk_file in chunks_dir.glob("*.json"):
        manifest["chunks"][chunk_file.stem] = {
            "arquivo": f"data/chunks/{chunk_file.name}",
            "bytes": chunk_file.stat().st_size
        }
    manifest_out = DATA_DIR / "manifest.json"
    manifest_out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  ✓ manifest.json updated ({manifest_out.stat().st_size} bytes)")

    # 3. Create pessoal_slim for fallback data.js
    pessoal_slim = {}
    if isinstance(pessoal, dict):
        for org, val in pessoal.items():
            if not isinstance(val, dict):
                continue
            pessoal_slim[org] = {
                "resumo":  val.get("resumo", {}),
                "status":  val.get("status", ""),
                "fonte":   val.get("fonte", ""),
                "servidores": val.get("servidores", []) if org == "camara" else [],
            }

    # 4. Save lightweight data.js
    out = ROOT / "data.js"
    js_payload = {
        "resumo": resumo,
        "vereadores": vereadores,
        "emendas": emendas,
        "camara_anos": camara_anos,
        "diario": diario,
        "prefeitura": prefeitura,
        "camara_betha": camara_betha,
        "pncp": pncp,
        "camara_transparencia": camara_transparencia,
        "cnpjs": cnpjs,
        "pessoal": pessoal_slim,
        "diarias": diarias,
        "fontes_emendas_2026": fontes_emendas_2026,
        "federal": federal,
        "atualizado_em": atualizado_em,
        "auditoria_dados": auditoria_dados,
        "remuneracao_vereadores": remuneracao_vereadores,
        "publicacoes_diario": publicacoes_diario,
        "publicacoes_estruturadas": publicacoes_estruturadas,
        "convenios": convenios,
        "educacao": educacao,
        "licitacoes": licitacoes,
        "obras_educacao": obras_educacao,
        "receitas": receitas,
        "sancoes_fornecedores": sancoes_fornecedores,
        "mudancas_coleta": mudancas_coleta,
        "indice_relevancia": indice_relevancia,
    }
    content = "/* Gerado por recover_data.py — não editar à mão. */\n"
    content += "window.ZELA_DATA = " + json.dumps(js_payload, ensure_ascii=False, indent=2) + ";\n"
    out.write_text(content, encoding="utf-8")
    print(f"  ✓ data.js recreated ({out.stat().st_size // 1024} KB)")

if __name__ == "__main__":
    rebuild()
