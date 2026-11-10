import json
import re
from pathlib import Path

target_dir = Path("documentos/relatorios_emendas_betha_2026_09_01")
txt_files = sorted(target_dir.glob("*.txt"))

def parse_txt(p):
    content = p.read_text(encoding="utf-8", errors="ignore")
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    
    # Procurar totais
    totais = []
    for line in lines:
        if "Total Anual:" in line or "Total Geral:" in line or "Total:" in line:
            totais.append(line)
            
    # Protocolo, data, parametros
    protocolo = ""
    versao = ""
    for line in lines:
        if "Protocolo:" in line:
            m = re.search(r"Protocolo:\s*([a-f0-9\-]+)", line)
            if m: protocolo = m.group(1)
        if "Versão:" in line or "Verso:" in line:
            versao = line
            
    # Contar emendas
    emendas_encontradas = []
    for i, line in enumerate(lines):
        # Ex: "10662/2025" ou "01/2024" ou "063/2025" ou "202627540001"
        if re.search(r"\b(\d{1,6}/\d{4}|\d{12})\b", line) and ("Valor da Emenda" not in line) and ("Protocolo" not in line):
            emendas_encontradas.append(line)
            
    return {
        "arquivo": p.name,
        "linhas": len(lines),
        "totais": totais,
        "protocolo": protocolo,
        "versao": versao,
        "amostra_emendas": emendas_encontradas[:10],
        "total_emendas_identificadas": len(emendas_encontradas)
    }

print("=== ANÁLISE DOS 6 RELATÓRIOS DO PORTAL BETHA ===")
resultados = []
for tf in txt_files:
    info = parse_txt(tf)
    resultados.append(info)
    print(f"\nArquivo: {info['arquivo']}")
    print(f"Protocolo: {info['protocolo']}")
    print(f"Totais encontrados: {info['totais']}")
    print(f"Linhas com número de emenda: {info['total_emendas_identificadas']}")
    print(f"Amostra: {info['amostra_emendas'][:3]}")

with open(target_dir / "analise_preliminar.json", "w", encoding="utf-8") as f:
    json.dump(resultados, f, ensure_ascii=False, indent=2)
