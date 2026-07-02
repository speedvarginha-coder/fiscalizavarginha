# -*- coding: utf-8 -*-
"""
Coletor de emendas federais (Portal da Transparência / CGU) — Fase 2.
Enriquece as 8 Pix itemizadas com empenho/liquidação/pagamento (datas + documentos),
via /api-de-dados/emendas/documentos/{codigo}. Token fica em
    ../../private/tokens/.portal-transparencia.json  (fora do git)

Uso:  python coletor_emendas_federais.py
Regenera data/emendas_federais.js preservando resumoTipos (os 4 tipos agregados,
que a API não itemiza por município).
"""
import json, io, os, time, urllib.request, urllib.parse, urllib.error

AQUI = os.path.dirname(os.path.abspath(__file__))
TOK_PATH = os.path.join(AQUI, "..", "..", "private", "tokens", ".portal-transparencia.json")
FED_JS = os.path.join(AQUI, "data", "emendas_federais.js")
BASE = "https://api.portaldatransparencia.gov.br/api-de-dados/"

def token():
    return json.load(io.open(TOK_PATH, encoding="utf-8"))["chave-api-dados"]

def api(path, params, tok, tentativas=3):
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, headers={"chave-api-dados": tok, "Accept": "application/json"})
    for i in range(tentativas):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:      # rate limit — espera e tenta de novo
                time.sleep(2 + i * 2); continue
            raise
    return []

def documentos_da_emenda(codigo, tok):
    """Todas as fases (paginado) de uma emenda."""
    todos, pag = [], 1
    while True:
        lote = api(f"emendas/documentos/{codigo}", {"pagina": pag}, tok)
        if not lote:
            break
        todos.extend(lote)
        if len(lote) < 15:         # página cheia = 15; menos que isso = última
            break
        pag += 1
        time.sleep(0.2)
    return todos

def primeira_data(docs, fase):
    ds = sorted((d for d in docs if d.get("fase") == fase),
                key=lambda d: _num(d.get("data")))
    return ds[0]["data"] if ds else ""

def _num(dt):
    try:
        d, m, a = str(dt).split("/"); return int(a + m + d)
    except Exception:
        return 0

def carregar_fed():
    t = io.open(FED_JS, encoding="utf-8").read()
    return json.loads(t[t.index("{"):t.rindex("}")+1])

def main():
    tok = token()
    fed = carregar_fed()
    pix = fed["emendas"]
    print(f"Enriquecendo {len(pix)} emendas Pix via API CGU...")
    for e in pix:
        codigo = e.get("emenda")
        try:
            docs = documentos_da_emenda(codigo, tok)
        except urllib.error.HTTPError as ex:
            print(f"  {codigo}: ERRO {ex.code} — mantendo dados anteriores")
            continue
        emp = primeira_data(docs, "Empenho")
        liq = primeira_data(docs, "Liquidação")
        pag = primeira_data(docs, "Pagamento")
        e["dataEmpenho"] = emp
        e["dataLiquidacao"] = liq
        e["dataPagamento"] = pag
        e["qtdDocumentos"] = len(docs)
        e["documentos"] = [
            {"fase": d.get("fase"), "data": d.get("data"), "codigo": d.get("codigoDocumentoResumido")}
            for d in docs[:30]
        ]
        # objeto ganha rastro de execução, se houver
        rastro = " · ".join(x for x in [
            f"empenho {emp}" if emp else "",
            f"liquidação {liq}" if liq else "",
            f"pagamento {pag}" if pag else "",
        ] if x)
        if rastro:
            e["execucao"] = rastro
        print(f"  {codigo} ({e.get('autor')}): {len(docs)} docs | {rastro or 'sem documentos'}")
        time.sleep(0.3)

    fed["metadata"]["execucaoVia"] = "API CGU /emendas/documentos/{codigo}"
    fed["metadata"]["execucaoAtualizadaEm"] = time.strftime("%Y-%m-%d")
    js = "window.EMENDAS_FEDERAIS = " + json.dumps(fed, ensure_ascii=False, indent=2) + ";\n"
    io.open(FED_JS, "w", encoding="utf-8").write(js)
    print("OK — data/emendas_federais.js atualizado com empenho/liquidação/pagamento.")

if __name__ == "__main__":
    main()
