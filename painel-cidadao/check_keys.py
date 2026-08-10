import re
from pathlib import Path

DATA_JS = Path(__file__).resolve().parent / "data.js"
PREFIX = "window.FISCALIZA_DATA = "

with DATA_JS.open("r", encoding="utf-8") as f:
    # Ignora o prefixo da variável global e inspeciona as chaves do conteúdo.
    f.read(len(PREFIX))
    # Read some content
    content = f.read(1000000)
    # Find keys
    keys = re.findall(r'\"([a-z_]+)\":', content)
    print(list(set(keys)))
