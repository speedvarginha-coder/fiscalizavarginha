# Como publicar — Fiscaliza Varginha

Processo para subir o painel para um servidor web (Hostinger, Netlify, GitHub Pages, ou qualquer hospedagem estática).

---

## O que publicar (e o que NÃO publicar)

### ✅ Publicar — Pasta `painel-cidadao/` inteira

```
painel-cidadao/
├── *.html          ✓ Páginas
├── *.css           ✓ Estilos
├── *.js            ✓ Lógica
├── *.svg           ✓ Favicon
├── modules/        ✓ Módulos JS
├── data/chunks/    ✓ JSONs públicos
├── data.js         ✓ Fallback legado
└── .htaccess       ✓ Regras Apache
```

### ❌ NUNCA publicar

```
private/            ❌ Tokens, logs, segredos
.git/               ❌ Histórico do repo
node_modules/       ❌ Dependências de teste
tests/              ❌ Suite de testes (não precisa em prod)
docs/               ❌ Documentação interna
coletor*.py         ❌ Scripts de coleta (rodam só local/CI)
_*.py               ❌ Scripts temporários
*.bak               ❌ Backups
*.log               ❌ Logs
data/*.json         ❌ Intermediários (só os de `chunks/`)
```

---

## Pré-deploy — checklist

Antes de subir qualquer coisa, rodar:

```bash
# 1. Testes verdes
npm test
# → 32 passed (esperado)

# 2. Verificar que tokens NÃO estão na pasta
ls painel-cidadao/.betha* 2>/dev/null
# → vazio (correto)

# 3. Verificar tamanho total
du -sh painel-cidadao/
# → ~12 MB esperado

# 4. Verificar que data/ tem só o necessário
ls painel-cidadao/data/
# → manifest.json + chunks/ (sem intermediários grandes)

# 5. Última coleta recente
cat painel-cidadao/data/chunks/atualizado_em.json
# → não mais que 30 dias atrás
```

Ver também: `docs/checklist-publicacao.md`.

---

## Opção A — Hostinger (FTP)

### Primeira vez

1. **Criar conta na Hostinger** (ou usar existente).
2. **Comprar domínio** (sugestão: `zelavarginha.com.br` ou similar).
3. **Apontar DNS** para o servidor Hostinger.
4. **Acessar painel cPanel** → File Manager → `public_html/`.

### A cada publicação

1. **Comprimir a pasta limpa:**
   ```bash
   cd "3_Fiscaliza Varginha"
   # Cria zip só com arquivos públicos
   zip -r painel-deploy.zip painel-cidadao/ \
     -x "painel-cidadao/coletor*" \
     -x "painel-cidadao/_*" \
     -x "painel-cidadao/*.bak" \
     -x "painel-cidadao/*.log" \
     -x "painel-cidadao/.betha*" \
     -x "painel-cidadao/__pycache__/*" \
     -x "painel-cidadao/data/*.json" \
     -i "painel-cidadao/data/chunks/*" \
     -i "painel-cidadao/data/manifest.json"
   ```

2. **Upload via FTP** (FileZilla):
   - Host: `ftp.seudominio.com.br`
   - User: do cPanel
   - Pasta destino: `public_html/`

3. **Descompactar via File Manager** da Hostinger.

4. **Confirmar `.htaccess`** está no `public_html/`.

5. **Limpar cache do navegador** e testar.

### Configurar HTTPS (obrigatório para Service Worker)

No cPanel → SSL/TLS → ativar Let's Encrypt grátis. Sem HTTPS o SW não funciona.

---

## Opção B — Netlify (mais fácil)

1. **Criar conta grátis em [netlify.com](https://netlify.com)**.
2. **New site → Deploy manually** → arrastar a pasta `painel-cidadao/` direto.
3. **Configurar domínio custom** (ou usar `*.netlify.app` grátis).
4. **HTTPS automático** já vem.

### Auto-deploy via GitHub

Se o repo estiver no GitHub:

1. **Netlify → New site → Import from Git**.
2. **Selecionar o repo.**
3. **Build settings:**
   - Base directory: `painel-cidadao`
   - Publish directory: `painel-cidadao`
   - Build command: (vazio — site estático)
4. **Cada `git push` faz deploy automático.**

---

## Opção C — GitHub Pages

1. **Repo no GitHub.**
2. **Settings → Pages.**
3. **Source: Deploy from branch.**
4. **Branch: main, folder: `/painel-cidadao`** (precisa estar na raiz, mexer se necessário).
5. URL: `https://USUARIO.github.io/REPO/`

**Limitação:** GitHub Pages serve com cache agressivo — atualização pode demorar até 10 min para aparecer.

---

## Verificar deploy

Após publicar, testar:

### 1. Páginas carregam
- [ ] `https://seudominio/` (index)
- [ ] `https://seudominio/prefeitura.html`
- [ ] `https://seudominio/camara.html`
- [ ] `https://seudominio/relatorios.html`
- [ ] `https://seudominio/pessoal.html`
- [ ] `https://seudominio/marcadores.html`
- [ ] `https://seudominio/sobre.html`
- [ ] `https://seudominio/cobrar.html`

### 2. Console sem erros
F12 → Console → não deve ter erro vermelho (só warnings amarelos).

### 3. Service Worker registra
F12 → Application → Service Workers → deve mostrar "activated and is running".

### 4. Chunks carregam
F12 → Network → recarregar → deve ver `data/chunks/*.json` com status 200.

### 5. Mobile
Testar em celular ou modo responsivo do DevTools. Placar deve ficar 2×2 ou 1 coluna.

### 6. Compartilhar URL no WhatsApp
Cole `https://seudominio/relatorios.html` no WhatsApp — deve aparecer preview com título e descrição (OG tags).

---

## Atualização incremental

Se só os dados mudaram (coleta nova):

1. **Rodar coleta + split local** (ver `como-atualizar.md`).
2. **Upload só de `painel-cidadao/data/chunks/`** (resto não mudou).
3. **Bumpar `sw.js`** versão do cache para força refresh:
   ```js
   const CACHE = "zela-v9";  // ou próximo número
   ```
4. **Upload `sw.js` atualizado.**

Usuários verão o toast "📡 Dados atualizados — recarregar" automaticamente.

---

## Bloquear conteúdo sensível (`.htaccess`)

O arquivo `painel-cidadao/.htaccess` já bloqueia:

```apache
# Bloqueia arquivos sensíveis se vazarem
<FilesMatch "\.(json|log|py|pyc|bat|txt)$">
    Order deny,allow
    Deny from all
</FilesMatch>

# Mas permite os JSONs públicos
<FilesMatch "data/chunks/.*\.json$">
    Order allow,deny
    Allow from all
</FilesMatch>

# Permite data.js (legado)
<Files "data.js">
    Order allow,deny
    Allow from all
</Files>
```

**Conferir após publicar** se o `.htaccess` está ativo. Testar:

```bash
curl https://seudominio/coletor.py
# → deve retornar 403 Forbidden
```

---

## Rollback

Se algo quebrar em produção:

### Hostinger / FTP
Manter sempre uma cópia da versão anterior local. Re-upload da versão anterior.

### Netlify
Deploys → selecionar versão anterior → "Publish deploy".

### GitHub Pages
```bash
git revert HEAD
git push
```

---

## Domínio sugerido

Idealmente algo memorável e oficial-ish (sem parecer site oficial da prefeitura):

- `zela.varginha.org`
- `fiscaliza.varginha.org`
- `varginha.cidadania.org`
- `transparencia.varginha.com.br`

**Evitar:** nomes que possam ser confundidos com sites oficiais da prefeitura ou que sugiram afiliação partidária.
