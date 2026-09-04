"""Confere se o ZIP contém exatamente os bytes do diretório validado."""
import hashlib
import sys
import zipfile
from pathlib import Path

archive, stage = Path(sys.argv[1]), Path(sys.argv[2])
with zipfile.ZipFile(archive) as zipped:
    entries = [info for info in zipped.infolist() if not info.is_dir()]
    names = [info.filename.replace("\\", "/") for info in entries]
    expected = {p.relative_to(stage).as_posix(): p for p in stage.rglob("*") if p.is_file()}
    if len(names) != len(set(names)) or set(names) != set(expected):
        raise SystemExit("ZIP diverge do pacote: " + str(sorted(set(names) ^ set(expected))))
    for info, name in zip(entries, names):
        if hashlib.sha256(zipped.read(info)).digest() != hashlib.sha256(expected[name].read_bytes()).digest():
            raise SystemExit("Bytes divergentes no ZIP: " + name)
print(f"ZIP conferido: {len(entries)} arquivos idênticos ao pacote.")
