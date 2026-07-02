# -*- coding: utf-8 -*-
"""
Coletor de emendas federais de Varginha — Portal da Transparência (CGU).

Fonte primária: download-de-dados/emendas-parlamentares/UNICO (dados abertos, sem token).
    - EmendasParlamentares.csv .............. objeto (função/ação) por emenda
    - EmendasParlamentares_PorFavorecido.csv  quem recebeu, por emenda, em Varginha
Enriquecimento (opcional, precisa token em ../../private/tokens/.portal-transparencia.json):
    - API /emendas/documentos/{codigo} ...... datas de empenho/liquidação/pagamento das Pix

Uso:  python coletor_emendas_federais.py
Gera data/emendas_federais.js (itemizado: 1 registro por favorecido) + resumoTipos.
"""
import json, io, os, csv, time, zipfile, tempfile, urllib.request, urllib.parse, urllib.error

AQUI = os.path.dirname(os.path.abspath(__file__))
FED_JS = os.path.join(AQUI, "data", "emendas_federais.js")
TOK_PATH = os.path.join(AQUI, "..", "..", "private", "tokens", ".portal-transparencia.json")
ZIP_URL = "https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares/UNICO"
API = "https://api.portaldatransparencia.gov.br/api-de-dados/"
IBGE_VARGINHA = "3170701"

CONSULTA = "https://portaldatransparencia.gov.br/emendas/consulta?de=&ate=&nomeMunicipio=Varginha"

def money(s):
    try: return float(str(s).replace(".", "").replace(",", "."))
    except Exception: return 0.0

def money_txt(v):
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

def baixar_zip():
    dest = os.path.join(tempfile.gettempdir(), "emendas_cgu_varginha.zip")
    print("Baixando dataset CGU (UNICO)...")
    req = urllib.request.Request(ZIP_URL, headers={"User-Agent": "FiscalizaVarginha/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r, open(dest, "wb") as f:
        f.write(r.read())
    print(f"  {os.path.getsize(dest)//1024//1024} MB baixados")
    return dest

def objeto_por_codigo(z):
    """Mapa código -> texto do objeto (Função · Subfunção · Ação), do CSV principal."""
    txt = io.TextIOWrapper(z.open("EmendasParlamentares.csv"), encoding="latin-1")
    r = csv.reader(txt, delimiter=";"); next(r)
    mp = {}
    for row in r:
        if len(row) < 20: continue
        cod = row[0].strip()
        if cod in mp: continue
        partes = [row[13].strip(), row[15].strip(), row[19].strip()]  # Função, Subfunção, Ação
        mp[cod] = " · ".join(p for p in partes if p and p != "Sem informação")
    return mp

def registros_varginha(z, objetos):
    """1 registro por linha favorecido em Varginha-MG."""
    txt = io.TextIOWrapper(z.open("EmendasParlamentares_PorFavorecido.csv"), encoding="latin-1")
    r = csv.reader(txt, delimiter=";"); next(r)
    regs = []
    for row in r:
        if len(row) < 13: continue
        if row[11].strip().upper() != "VARGINHA" or row[10].strip().upper() != "MG": continue
        cod = row[0].strip()
        tipo_emenda = row[4].strip()
        ano = (row[5] or "")[:4]
        autor = row[2].strip()
        favorecido = row[7].strip()
        doc_fav = row[6].strip()
        valor = money(row[12])
        catmap = {
            "Emenda Individual - Transferências Especiais": "Transferência Especial (Pix)",
            "Emenda Individual - Transferências com Finalidade Definida": "Individual com Finalidade Definida",
            "Emenda de Bancada": "Bancada",
            "Emenda de Comissão": "Comissão",
            "Emenda de Relator": "Relator",
        }
        categoria = catmap.get(tipo_emenda, tipo_emenda)
        objeto = objetos.get(cod, "") or ("Transferência Especial (Pix) — recurso sem finalidade definida; o município decide a aplicação." if "Especiais" in tipo_emenda else "Emenda federal — ver objeto na fonte oficial.")
        individual = "Sim" if "Individual" in tipo_emenda else "Não"
        reg = {
            "tipo": "Federal",
            "categoria": categoria,
            "ano": ano, "anoEmenda": ano, "anoRecurso": ano,
            "emenda": cod, "emendaOriginal": cod,
            "autor": autor, "partido": "",
            "valor": valor, "valorTexto": money_txt(valor),
            "beneficiario": favorecido,
            "documentoBeneficiario": doc_fav,
            "orgao": favorecido,
            "localidade": "VARGINHA",
            "objeto": objeto,
            "dataRecurso": "",
            "aprovado": "Sim",
            "emendaIndividual": individual,
            "descricao": f"{tipo_emenda}. Autor: {autor}. Código {cod}. Favorecido: {favorecido}.",
            "textoBusca": " ".join(str(x).lower() for x in [
                "federal", categoria, cod, ano, autor, favorecido, objeto]),
            "anosRelacionados": [ano] if ano else [],
            "fonteUrl": CONSULTA,
            "id": f"fed_{cod}_{len(regs)}",
        }
        regs.append(reg)
    return regs

def token():
    try: return json.load(io.open(TOK_PATH, encoding="utf-8"))["chave-api-dados"]
    except Exception: return None

def enriquecer_pix(regs, tok):
    """Datas de empenho/liquidação/pagamento nas Pix (via API)."""
    if not tok:
        print("  (sem token — pulando enriquecimento de execução)"); return
    pix = [r for r in regs if "Pix" in r["categoria"]]
    print(f"Enriquecendo {len(pix)} Pix com empenho/pagamento (API)...")
    for e in pix:
        try:
            docs, pag = [], 1
            while True:
                u = API + f"emendas/documentos/{e['emenda']}?" + urllib.parse.urlencode({"pagina": pag})
                req = urllib.request.Request(u, headers={"chave-api-dados": tok, "Accept": "application/json"})
                lote = json.loads(urllib.request.urlopen(req, timeout=45).read())
                if not lote: break
                docs += lote
                if len(lote) < 15: break
                pag += 1; time.sleep(0.2)
        except Exception as ex:
            print(f"  {e['emenda']}: {ex}"); continue
        def primeira(fase):
            ds = sorted((d for d in docs if d.get("fase") == fase),
                        key=lambda d: int("".join(reversed(str(d.get("data","")).split("/")))) if d.get("data") else 0)
            return ds[0]["data"] if ds else ""
        emp, liq, pg = primeira("Empenho"), primeira("Liquidação"), primeira("Pagamento")
        e["qtdDocumentos"] = len(docs)
        e["execucao"] = " · ".join(x for x in [
            f"empenho {emp}" if emp else "", f"liquidação {liq}" if liq else "",
            f"pagamento {pg}" if pg else ""] if x)
        time.sleep(0.3)

def gerar_resumo_tipos(regs):
    from collections import defaultdict
    agg = defaultdict(lambda: {"total": 0.0, "ben": defaultdict(float), "n": 0})
    risco = {"Transferência Especial (Pix)": "alto", "Relator": "alto"}
    expl = {
        "Transferência Especial (Pix)": "Vai direto para a conta da Prefeitura, SEM destino definido — o município decide onde aplicar (art. 166-A). É a que mais exige acompanhamento.",
        "Individual com Finalidade Definida": "Deputado ou senador indica para um objeto específico. Execução obrigatória.",
        "Bancada": "Apresentada em conjunto pela bancada de MG para obras/projetos estruturantes. Execução obrigatória.",
        "Comissão": "Sugerida por comissão temática do Congresso para política pública. NÃO tem execução obrigatória.",
        "Relator": "Do relator-geral do orçamento (antigo 'orçamento secreto', RP9). Historicamente o menos transparente.",
    }
    for r in regs:
        a = agg[r["categoria"]]
        a["total"] += r["valor"]; a["n"] += 1
        a["ben"][r["beneficiario"]] += r["valor"]
    ordem = ["Transferência Especial (Pix)", "Individual com Finalidade Definida", "Bancada", "Comissão", "Relator"]
    out = []
    for cat in ordem:
        if cat not in agg: continue
        a = agg[cat]
        top = sorted(a["ben"].items(), key=lambda x: -x[1])[:5]
        out.append({
            "categoria": cat, "total": round(a["total"], 2), "totalTexto": money_txt(a["total"]),
            "itemizado": True, "qtd": a["n"], "risco": risco.get(cat, "medio"),
            "explicacao": expl.get(cat, ""),
            "topBeneficiarios": [{"nome": n, "valor": round(v, 2)} for n, v in top],
            "fonteUrl": CONSULTA,
        })
    return out

def main():
    zpath = baixar_zip()
    z = zipfile.ZipFile(zpath)
    print("Lendo objetos (função/ação)...")
    objetos = objeto_por_codigo(z)
    print("Filtrando favorecidos em Varginha-MG...")
    regs = registros_varginha(z, objetos)
    print(f"  {len(regs)} registros federais itemizados ({len(set(r['emenda'] for r in regs))} emendas únicas)")
    enriquecer_pix(regs, token())
    resumo = gerar_resumo_tipos(regs)
    total = sum(r["valor"] for r in regs)
    out = {
        "metadata": {
            "fonte": "Portal da Transparência (CGU) — dados abertos emendas-parlamentares (PorFavorecido)",
            "favorecido": "Favorecidos em Varginha-MG",
            "extraidoEm": time.strftime("%Y-%m-%d"),
            "codigoIbge": IBGE_VARGINHA,
            "totalFederal": round(total, 2), "totalFederalTexto": money_txt(total),
            "registros": len(regs), "emendasUnicas": len(set(r["emenda"] for r in regs)),
            "observacao": "Cada registro = um favorecido de uma emenda federal recebida em Varginha. Datas de execução (empenho/pagamento) nas Pix via API CGU.",
        },
        "resumoTipos": resumo,
        "emendas": regs,
    }
    io.open(FED_JS, "w", encoding="utf-8").write(
        "window.EMENDAS_FEDERAIS = " + json.dumps(out, ensure_ascii=False, indent=2) + ";\n")
    print(f"OK — {len(regs)} emendas federais | total R$ {money_txt(total)} | {FED_JS}")

if __name__ == "__main__":
    main()
