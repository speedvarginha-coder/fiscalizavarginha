import pathlib

# Robust mapping of common double-encoded UTF-8 patterns
MAPPING = {
    'Ã¡': 'á', 'Ã ': 'à', 'Ã¢': 'â', 'Ã£': 'ã', 'Ã¤': 'ä',
    'Ã©': 'é', 'Ã¨': 'è', 'Ãª': 'ê', 'Ã«': 'ë',
    'Ã­': 'í', 'Ã¬': 'ì', 'Ã®': 'î', 'Ã¯': 'ï',
    'Ã³': 'ó', 'Ã²': 'ò', 'Ã´': 'ô', 'Ãµ': 'õ', 'Ã¶': 'ö',
    'Ãº': 'ú', 'Ã¹': 'ù', 'Ã»': 'û', 'Ã¼': 'ü',
    'Ã§': 'ç', 'Ã±': 'ñ',
    'Ã\x81': 'Á', 'Ã\x80': 'À', 'Ã\x82': 'Â', 'Ã\x83': 'Ã',
    'Ã\x89': 'É', 'Ã\x8a': 'Ê',
    'Ã\x8d': 'Í',
    'Ã\x93': 'Ó', 'Ã\x94': 'Ô', 'Ã\x95': 'Õ',
    'Ã\x9a': 'Ú',
    'Ã\x87': 'Ç',
    'Â©': '©', 'Â·': '·', 'Â°': '°', 'Â»': '»', 'Â«': '«',
    'â€\x94': '—', 'â€\x93': '–', 'â€\x9d': '”', 'â€\x9c': '“', 'â€™': '’',
    'â†\x92': '→', 'â†\x90': '←', 'â€¢': '•', 'â€¦': '…'
}

def fix_file(path):
    print(f"Fixing {path.name}...")
    try:
        raw = path.read_bytes()
        # Detect BOM
        if raw[:3] == b'\xef\xbb\xbf':
            raw = raw[3:]
        
        text = raw.decode('utf-8', errors='replace')
        
        # Apply mapping
        # Sort by key length descending to avoid partial matches
        for k in sorted(MAPPING.keys(), key=len, reverse=True):
            text = text.replace(k, MAPPING[k])
        
        path.write_bytes(text.encode('utf-8'))
        print(f"  {path.name} saved.")
    except Exception as e:
        print(f"  Error fixing {path.name}: {e}")

if __name__ == "__main__":
    files = list(pathlib.Path('.').glob('*.html')) + [pathlib.Path('app.js'), pathlib.Path('style.css')]
    for f in files:
        if f.exists():
            fix_file(f)
