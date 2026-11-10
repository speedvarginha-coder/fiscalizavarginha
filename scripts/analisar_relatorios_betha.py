import os
import sys
import re
from pathlib import Path
from pypdf import PdfReader

target_dir = Path("documentos/relatorios_emendas_betha_2026_09_01")
pdf_files = sorted(target_dir.glob("*.pdf"))

print(f"Encontrados {len(pdf_files)} PDFs para análise:\n")

for pdf_path in pdf_files:
    reader = PdfReader(str(pdf_path))
    num_pages = len(reader.pages)
    print("=" * 60)
    print(f"ARQUIVO: {pdf_path.name}")
    print(f"Páginas: {num_pages} | Tamanho: {pdf_path.stat().st_size:,} bytes")
    
    # Extrair texto da primeira página e da última página
    first_page_text = reader.pages[0].extract_text() or ""
    last_page_text = reader.pages[-1].extract_text() or ""
    
    print("\n--- INÍCIO (PÁGINA 1) ---")
    print("\n".join(first_page_text.splitlines()[:20]))
    
    if num_pages > 1:
        print("\n--- FINAL (ÚLTIMA PÁGINA) ---")
        print("\n".join(last_page_text.splitlines()[-20:]))
    
    # Procurar totais (Total Geral, Total, R$, etc)
    full_text = ""
    for p in reader.pages:
        t = p.extract_text()
        if t:
            full_text += t + "\n"
            
    # Salvar texto completo extraído em .txt para auditoria fácil
    txt_path = pdf_path.with_suffix(".txt")
    txt_path.write_text(full_text, encoding="utf-8")
    print(f"\nTexto completo salvo em: {txt_path.name}")

print("\nExtração inicial concluída!")
