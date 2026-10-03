"""Bloqueia arquivos staged acima de 20 MiB, sem depender do working tree."""
import subprocess
import sys

limit = 20 * 1024 * 1024
entries = subprocess.check_output(['git', 'diff', '--cached', '--name-only', '-z', '--diff-filter=AM']).split(b'\0')
bad = False
for entry in filter(None, entries):
    name = entry.decode('utf-8', errors='surrogateescape')
    size = int(subprocess.check_output(['git', 'cat-file', '-s', ':' + name]))
    if size > limit:
        print(f'BLOQUEADO: {name} tem {size} bytes no index (limite {limit}).')
        bad = True
sys.exit(1 if bad else 0)
