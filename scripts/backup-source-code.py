"""Cópia verificável do código, incluindo alterações locais; nunca inclui dados privados."""
import argparse, hashlib, json, os, shutil, subprocess, sys, tempfile, zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_ROOTS = {'painel-cidadao', 'scripts', 'tests', 'dashboard'}
ROOT_FILES = {'package.json', 'package-lock.json', 'playwright.config.js', 'playwright.deploy.config.js', '.gitignore', 'README.md', 'AGENTS.md'}
FORBIDDEN_DIRS = {'data', 'node_modules', '__pycache__', '.git', '.env', 'dist', 'tmp', 'private', 'auth_info', 'relatorios'}
FORBIDDEN_NAMES = {'data.js', 'operacao.json'}

def allowed(relative):
    p = Path(relative)
    if p.is_absolute() or '..' in p.parts or not p.parts: return False
    if len(p.parts) == 1: return p.name in ROOT_FILES
    if p.parts[0] not in ALLOWED_ROOTS or any(part.lower() in FORBIDDEN_DIRS for part in p.parts): return False
    if p.name in FORBIDDEN_NAMES or p.name.lower().startswith('.env'): return False
    return p.suffix.lower() in {'.js','.mjs','.cjs','.py','.ps1','.php','.html','.css','.json','.md','.svg','.png','.webp','.ico','.woff','.woff2','.htaccess'} or p.name == '.htaccess'

def snapshot(root, target, files):
    root=Path(root).resolve(); target=Path(target)
    manifest=[]
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for name in sorted(set(files)):
            if not allowed(name): continue
            p=(root / name).resolve()
            if not p.is_relative_to(root) or not p.is_file(): continue
            data=p.read_bytes(); archive.writestr(Path(name).as_posix(),data)
            manifest.append({'arquivo':Path(name).as_posix(),'sha256':hashlib.sha256(data).hexdigest()})
        if not manifest: raise ValueError('Nenhum arquivo de código encontrado')
        archive.writestr('backup-manifest.json',json.dumps({'schema':1,'criado_em':datetime.now(timezone.utc).isoformat(),'arquivos':manifest},ensure_ascii=False,indent=2))
    with zipfile.ZipFile(target) as archive:
        if archive.testzip(): raise ValueError('Arquivo de código não passou na verificação ZIP')
        for item in manifest:
            if hashlib.sha256(archive.read(item['arquivo'])).hexdigest()!=item['sha256']: raise ValueError('Hash de arquivo divergiu')
    return len(manifest)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--destino',required=True);args=parser.parse_args()
    dest=Path(args.destino).resolve()
    if not dest.is_dir(): raise ValueError('Destino de backup não está disponível')
    files=subprocess.check_output(['git','-C',str(ROOT),'ls-files','-z','--cached','--others','--exclude-standard'],stderr=subprocess.DEVNULL).decode('utf-8').split('\0')
    (ROOT/'private/backup-export').mkdir(parents=True,exist_ok=True)
    (ROOT/'private/state').mkdir(parents=True,exist_ok=True)
    stamp=datetime.now().strftime('%Y%m%d-%H%M%S');name=f'fiscaliza-codigo-{stamp}.zip'
    with tempfile.TemporaryDirectory(prefix='codigo-',dir=ROOT/'private/backup-export') as temp:
        local=Path(temp)/name; count=snapshot(ROOT,local,files)
        digest=hashlib.sha256(local.read_bytes()).hexdigest(); partial=dest/(name+'.part'); final=dest/name
        shutil.copy2(local,partial)
        if hashlib.sha256(partial.read_bytes()).hexdigest()!=digest: raise ValueError('Hash da cópia externa divergiu')
        os.replace(partial,final)
    state={'schema':1,'checked_at':datetime.now(timezone.utc).isoformat(),'status':'ok','file':name,'destino':str(dest),'sha256':digest,'arquivos':count}
    statePath=ROOT/'private/state/source_backup.json';tmp=statePath.with_suffix('.tmp');tmp.write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');os.replace(tmp,statePath)
    print(f'Backup de código confirmado: {count} arquivos; SHA-256 verificado.')
if __name__=='__main__':
    try: main()
    except Exception as exc: print(f'Falha no backup de código: {exc}',file=sys.stderr);sys.exit(1)
