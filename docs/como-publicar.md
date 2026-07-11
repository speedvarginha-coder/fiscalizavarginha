# Como publicar — Fiscaliza Varginha

Processo suportado para publicar o pacote validado em Hostinger com Apache.

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
# 1. Release local verde
npm run release
# → valida dados, roda 41 testes, gera zip e valida pacote

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

## Hostinger / Apache (FTP)

### Primeira vez

1. **Criar conta na Hostinger** (ou usar existente).
2. **Comprar domínio** (sugestão: `zelavarginha.com.br` ou similar).
3. **Apontar DNS** para o servidor Hostinger.
4. **Acessar painel cPanel** → File Manager → `public_html/`.

### A cada publicação

1. **Gerar e validar o pacote:**
   ```powershell
   npm run release
   ```

   O pacote aprovado fica em `dist/fiscaliza-varginha-painel.zip` e contém apenas arquivos públicos. Não publique uma cópia manual de `painel-cidadao/`: use somente esse ZIP após o `release` concluir sem erros.

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

## Verificar deploy

Após publicar, testar:

### 1. Páginas carregam
- [ ] `https://seudominio/` (index)
- [ ] `https://seudominio/prefeitura.html`
- [ ] `https://seudominio/camara.html`
- [ ] `https://seudominio/relatorios.html`
- [ ] `https://seudominio/pessoal.html`
- [ ] `https://seudominio/marcadores.html`
- [ ] `https://seudominio/atualizacoes.html`
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

1. **Rodar coleta local**: `npm run data:update` (ver `como-atualizar.md`).
2. **Conferir logs em `private/logs/`**.
3. **Upload só de `painel-cidadao/data/chunks/`** (resto não mudou).
4. **Bumpar `sw.js`** versão do cache para força refresh:
   ```js
   const CACHE = "zela-v9";  // ou próximo número
   ```
5. **Upload `sw.js` atualizado.**

Usuários verão o toast "📡 Dados atualizados — recarregar" automaticamente.

---

## Bloquear conteúdo sensível (`.htaccess`)

O arquivo `painel-cidadao/.htaccess` já bloqueia:

```apache
Options -Indexes
RewriteEngine On

# Bloqueia scripts e arquivos locais
<FilesMatch "\.(log|py|pyc|bat|txt)$">
  <IfModule mod_authz_core.c>
    Require all denied
  </IfModule>
  <IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
  </IfModule>
</FilesMatch>

# Bloqueia JSONs intermediários em /data/, mas libera:
# - /data/manifest.json
# - /data/chunks/*.json
RewriteRule ^data/(?!manifest\.json$|chunks/[^/]+\.json$) - [F,L]
```

**Conferir após publicar** se o `.htaccess` está ativo. Testar:

```bash
curl https://seudominio/coletor.py
# → deve retornar 403 Forbidden
```

---

## Rollback

Se algo quebrar em produção:

Mantenha o último ZIP validado. Para reverter, remova os arquivos da versão com problema no `public_html/`, envie o ZIP anterior e descompacte-o novamente.

---

## Domínio sugerido

Idealmente algo memorável e oficial-ish (sem parecer site oficial da prefeitura):

- `zela.varginha.org`
- `fiscaliza.varginha.org`
- `varginha.cidadania.org`
- `transparencia.varginha.com.br`

**Evitar:** nomes que possam ser confundidos com sites oficiais da prefeitura ou que sugiram afiliação partidária.
