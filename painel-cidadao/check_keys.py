import json
import os

path = r'c:\Users\Desktop\Desktop\Ações Prefeitura Varginha\Zela Varginha\painel-cidadao\data.js'
with open(path, 'r', encoding='utf-8') as f:
    # Skip the "window.ZELA_DATA = " part
    f.read(len('window.ZELA_DATA = '))
    # Read some content
    content = f.read(1000000)
    # Find keys
    import re
    keys = re.findall(r'\"([a-z_]+)\":', content)
    print(list(set(keys)))
