"""Recupera fichas oficiais somente quando a identidade do contrato é inequívoca."""
import json
import re
import unicodedata
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHUNKS = ROOT / "painel-cidadao/data/chunks"
PORTALS = {"prefeitura": ("prefeitura", "y7mn01LGqd_HCvGtj6VPwA==", "83043"),
           "camara": ("camara_betha", "-iAWLe1kr2VQcrW9k2AUBg==", "324812")}


def identity(contract):
    cnpj = re.sub(r"\D", "", str(contract.get("cnpj") or ""))[:8]
    number = str(contract.get("numero") or "").lstrip("0")
    year = str(contract.get("ano") or "")
    return (number, year, cnpj) if number and year and len(cnpj) == 8 else None



def documented_identity(contract):
    # CSV e busca textual podem usar ano da licitação versus ano do contrato.
    # CPF mascarado nunca é usado sozinho: exigir número, assinatura, nome e valor.
    number = str(contract.get('numero') or '').lstrip('0')
    date = str(contract.get('data_assinatura') or '')
    name = ' '.join(unicodedata.normalize('NFKD', str(contract.get('contratado') or '')).encode('ascii','ignore').decode().upper().split())
    document = re.sub(r'[^0-9*]', '', str(contract.get('cnpj') or ''))
    try:
        value = Decimal(str(contract.get('valor')))
    except InvalidOperation:
        return None
    if not number or not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', date) or not name or len(re.sub(r'\D','',document)) < 6 or not value.is_finite() or value <= 0:
        return None
    return number, date, name, document, value


def reconcile(contracts, history, portal, query):
    valid = re.compile(r"https://transparencia\.betha\.cloud/\#/" + re.escape(portal)
                       + r"/consulta/" + query + r"/detalhe/[\w:%-]+")
    index = {}
    documented = {}
    for item in history:
        key = identity(item)
        url = item.get("fonte_url", "")
        if key and valid.fullmatch(url):
            index.setdefault(key, set()).add(url)
        detailed_key = documented_identity(item)
        if detailed_key and valid.fullmatch(url):
            documented.setdefault(detailed_key, set()).add(url)
    recovered = 0
    for item in contracts:
        if item.get("fonte_url"):
            continue
        urls = index.get(identity(item), set())
        if not urls:
            urls = documented.get(documented_identity(item), set())
        if len(urls) == 1:
            item["fonte_url"] = next(iter(urls))
            recovered += 1
    return recovered


def reconcile_values(contracts, history, catalog, consulted_at):
    """Sinaliza valores divergentes na mesma ficha, sem substituir a base preservada."""
    if not re.match(r'^20\d{2}-\d{2}-\d{2}', str(consulted_at or '')):
        return 0
    index = {}
    for item in history:
        if item.get('fonte_url'):
            index.setdefault(item['fonte_url'], []).append(item)
    panel_counts = {}
    for item in contracts:
        if item.get('fonte_url'):
            panel_counts[item['fonte_url']] = panel_counts.get(item['fonte_url'], 0) + 1
    changed = 0
    for item in contracts:
        url = item.get('fonte_url')
        if not url or panel_counts.get(url) != 1 or len(index.get(url, [])) != 1:
            continue
        official = index[url][0]
        if not item.get('numero') or not item.get('data_assinatura') or str(item.get('numero')) != str(official.get('numero') or '') or item.get('data_assinatura') != official.get('data_assinatura'):
            continue
        try:
            panel_value, source_value = Decimal(str(item['valor'])), Decimal(str(official['valor']))
        except (KeyError, InvalidOperation, TypeError):
            continue
        if not panel_value.is_finite() or not source_value.is_finite(): continue
        existing = catalog.get(url, {}).get('divergencia')
        if abs(panel_value-source_value) < Decimal('0.01'):
            if existing and existing.get('metodo') == 'ficha_historico_oficial':
                del catalog[url]['divergencia']; changed += 1
            continue
        if existing and existing.get('metodo') != 'ficha_historico_oficial': continue
        entry = catalog.setdefault(url, {'status':'nao_verificado', 'documentos':[]})
        entry['divergencia'] = {'metodo':'ficha_historico_oficial','conferido_em':str(consulted_at),
            'numero_painel':item.get('numero'), 'numero_fonte':official.get('numero'),
            'valor_painel':float(panel_value),'valor_fonte':float(source_value)}
        changed += 1
    return changed


def main():
    catalog_path = CHUNKS / 'contratos_documentos.json'
    catalog = json.loads(catalog_path.read_text(encoding='utf-8-sig')) if catalog_path.exists() else {}
    divergences = 0
    for agency, (name, portal, query) in PORTALS.items():
        history_path = CHUNKS / f"contratos_historico_{agency}.json"
        current_path = CHUNKS / f"{name}.json"
        if not history_path.exists() or not current_path.exists():
            continue
        data = json.loads(current_path.read_text(encoding="utf-8-sig"))
        history = json.loads(history_path.read_text(encoding="utf-8-sig"))
        count = reconcile(data.get("contratos", []), history.get("contratos", []), portal, query)
        divergences += reconcile_values(data.get('contratos', []), history.get('contratos', []), catalog, history.get('consultado_em'))
        if count:
            text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
            for path in [current_path, ROOT / f"painel-cidadao/data/{name}.json"]:
                if path.exists():
                    staged = path.with_suffix(".json.tmp")
                    staged.write_text(text, encoding="utf-8")
                    staged.replace(path)
        print(f"{agency}: {count} fichas oficiais recuperadas; valores preservados.")
    if divergences:
        staged = catalog_path.with_suffix('.json.tmp')
        staged.write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        staged.replace(catalog_path)
    print(f'Conferência de valores: {divergences} sinalização(ões) atualizada(s); valores preservados.')


if __name__ == "__main__":
    main()
