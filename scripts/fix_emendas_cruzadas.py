import json
import pathlib

def fix():
    paths = [
        pathlib.Path("painel-cidadao/data/prefeitura.json"),
        pathlib.Path("painel-cidadao/data/chunks/prefeitura.json")
    ]
    
    for file_path in paths:
        if not file_path.exists():
            print(f"Arquivo {file_path} nao encontrado!")
            continue

        print(f"Carregando {file_path}...")
        data = json.loads(file_path.read_text(encoding="utf-8"))

        emendas = data.get("emendas_cruzadas", [])
        print(f"Total de emendas: {len(emendas)}")

        modificadas = 0
        for e in emendas:
            beneficiario = (e.get("beneficiario") or "").lower()
            cnpj = (e.get("cnpj") or "").replace(".", "").replace("/", "").replace("-", "")
            raiz = cnpj[:8] if len(cnpj) >= 8 else ""

            eh_publico = (
                raiz in ("18240119", "06204990") or
                "guarda civil" in beneficiario or
                "camara municipal" in beneficiario or
                "prefeitura" in beneficiario or
                "secretaria municipal" in beneficiario or
                "fundo municipal" in beneficiario
            )

            if eh_publico and e.get("status") == "sem_pagamento":
                print(f"Reclassificando: {e.get('beneficiario')} (R$ {e.get('valor_brl') or e.get('valor')}) -> execucao_direta")
                e["status"] = "execucao_direta"
                e["pagamentos"] = []
                e["valor_pago_total"] = 0.0
                modificadas += 1

        if modificadas > 0:
            # Recalcular estatísticas
            com_pag = sum(1 for e in emendas if e.get("status") == "encontrado")
            sem_pag = sum(1 for e in emendas if e.get("status") == "sem_pagamento")
            sem_cnpj = sum(1 for e in emendas if e.get("status") == "sem_cnpj")
            exec_dir = sum(1 for e in emendas if e.get("status") == "execucao_direta")

            data["stats_cruzamento"] = {
                "com_pagamento": com_pag,
                "sem_pagamento": sem_pag,
                "sem_cnpj": sem_cnpj,
                "execucao_direta": exec_dir
            }

            print(f"Novas estatisticas de cruzamento para {file_path.name}:")
            print(f"  Com pagamento: {com_pag}")
            print(f"  Sem pagamento: {sem_pag}")
            print(f"  Sem CNPJ: {sem_cnpj}")
            print(f"  Execucao direta: {exec_dir}")

            file_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"Arquivo {file_path} salvo com sucesso!\n")
        else:
            print(f"Nenhuma emenda precisou ser reclassificada em {file_path.name}.\n")

if __name__ == "__main__":
    fix()
