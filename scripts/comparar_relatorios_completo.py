import json
import re
from pathlib import Path

target_dir = Path("documentos/relatorios_emendas_betha_2026_09_01")

def extrair_dados_pdf_txt(filepath):
    text = filepath.read_text(encoding="utf-8", errors="ignore")
    
    # Extrair cabeçalho
    ano_m = re.search(r"Ano:\s*(\d{4})", text)
    ano = ano_m.group(1) if ano_m else "N/A"
    
    tipo_m = re.search(r"Tipo:\s*([^\n;]+)", text) or re.search(r"Emendas\s+(Municipal|Estadual|Federal)", text)
    tipo = tipo_m.group(1).strip() if tipo_m else "N/A"
    
    total_m = re.search(r"Total Anual:\s*([\d\.,]+)\s+([\d\.,]+)\s+([\d\.,]+)", text)
    total_emenda = total_m.group(1) if total_m else "N/A"
    contrapartida = total_m.group(2) if total_m else "N/A"
    total_fomento = total_m.group(3) if total_m else "N/A"
    
    # Extrair registros individuais
    # Cada registro tem: Beneficiário, Objeto, Valor, Ato, etc.
    blocos = re.split(r"(?:Emenda\s+Deputado/Vereador|Ato:)", text)
    
    # Procurar valores individuais
    valores_encontrados = re.findall(r"Total Fomento.*?\n.*?([\d\.,]+)", text)
    
    # Contar ocorrências de "Beneficiário:"
    beneficiarios = re.findall(r"Benefici[aá]rio:\s*([^\n\r]+)", text, re.IGNORECASE)
    objetos = re.findall(r"Objeto:\s*([^\n\r]+)", text, re.IGNORECASE)
    responsaveis = re.findall(r"Respons[aá]vel:\s*([^\n\r]+)", text, re.IGNORECASE)
    
    return {
        "arquivo": filepath.name,
        "ano": ano,
        "tipo": tipo,
        "total_emenda": total_emenda,
        "contrapartida": contrapartida,
        "total_fomento": total_fomento,
        "qtd_beneficiarios_listados": len(beneficiarios),
        "qtd_objetos_listados": len(objetos),
        "amostra_beneficiarios": beneficiarios[:5],
        "amostra_objetos": objetos[:5],
        "primeiros_beneficiarios": beneficiarios[:10]
    }

relatorios = []
for f in sorted(target_dir.glob("*.txt")):
    r = extrair_dados_pdf_txt(f)
    relatorios.append(r)
    print(f"==================================================")
    print(f"RELATÓRIO: {r['arquivo']}")
    print(f"Esfera: {r['tipo']} | Ano de Execução: {r['ano']}")
    print(f"Total da Emenda: R$ {r['total_emenda']} | Contrapartida: R$ {r['contrapartida']} | Total Fomento: R$ {r['total_fomento']}")
    print(f"Beneficiários listados: {r['qtd_beneficiarios_listados']} | Objetos: {r['qtd_objetos_listados']}")
    if r['amostra_beneficiarios']:
        print("Amostra Beneficiários:", r['amostra_beneficiarios'][:3])

# Salvar resumo completo em JSON
with open(target_dir / "resumo_comparativo_betha.json", "w", encoding="utf-8") as f:
    json.dump(relatorios, f, ensure_ascii=False, indent=2)
