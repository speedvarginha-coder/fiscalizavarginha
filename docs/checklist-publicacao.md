# Checklist de Publicação — Fiscaliza Varginha

Lista única para conferir antes de cada deploy. Copie e cole no commit/PR.

---

## Antes de publicar

### Código

- [ ] `npm test` — 32/32 verdes
- [ ] `node -c painel-cidadao/app.js` — sintaxe OK
- [ ] Sem erros no console em todas as 8 páginas (testar local)
- [ ] Hard refresh em cada página (Ctrl+Shift+R)

### Segurança

- [ ] `ls painel-cidadao/.betha*` → vazio
- [ ] `ls painel-cidadao/*.log` → vazio
- [ ] `ls painel-cidadao/__pycache__` → não existe
- [ ] `cat .gitignore | grep -E "(token|log|pycache)"` → linhas presentes
- [ ] `git status --ignored` → confirma que `private/` está ignored

### Dados

- [ ] `data/chunks/atualizado_em.json` tem timestamp < 30 dias
- [ ] `data/manifest.json` lista todos os 14 chunks
- [ ] Tamanho total `du -sh painel-cidadao/` < 20MB
- [ ] Spot-check: abrir 1 chunk grande e ver se JSON é válido (`py -m json.tool data/chunks/prefeitura.json | head`)

### Performance

- [ ] Lighthouse mobile score > 80 (DevTools → Lighthouse)
- [ ] Chunks > 100KB têm gzip ativo no servidor (Hostinger: configurar em .htaccess se preciso)

### UX

- [ ] Placar do dinheiro mostra valores plausíveis
- [ ] Filtros de categoria respondem ao clique
- [ ] Aba Diárias lista dados
- [ ] Marcadores funciona (adicionar/remover)
- [ ] Mobile responsivo (testar em 360px de largura)
- [ ] Dark mode funciona (DevTools → emular `prefers-color-scheme: dark`)

### Acessibilidade

- [ ] Tab navega pelos links sem pular
- [ ] `/` foca campo de busca
- [ ] Contraste OK em ambos os modos (WCAG AA)
- [ ] Imagens têm alt (favicon: aria-hidden ok)

### Conteúdo

- [ ] Disclaimer "Não é prova de irregularidade" presente em `relatorios.html` e `sobre.html`
- [ ] Página Sobre lista todas as fontes
- [ ] E-mail de contato funciona (`mailto:speed.varginha@gmail.com`)
- [ ] Sem nomes próprios em strings de teste/placeholder

---

## Durante a publicação

### Build/Upload

- [ ] Zip ou pasta de deploy contém só arquivos de `painel-cidadao/`
- [ ] Excluiu: `coletor*.py`, `_*.py`, `*.bak`, `*.log`, `__pycache__/`, `.betha*`
- [ ] Excluiu: `tests/`, `docs/`, `node_modules/`, `playwright.config.js`
- [ ] Incluiu: `data/chunks/*.json`, `data/manifest.json`
- [ ] Incluiu: `modules/*.js`
- [ ] Incluiu: `.htaccess`

### Servidor

- [ ] HTTPS ativo (Let's Encrypt grátis na Hostinger)
- [ ] `.htaccess` no `public_html/` ou pasta raiz do site
- [ ] Permissões: arquivos 644, pastas 755

---

## Pós-publicação

### Verificação imediata (5 min após upload)

- [ ] `https://seudominio/` abre
- [ ] `https://seudominio/prefeitura.html` mostra placar com 4 cards
- [ ] `https://seudominio/camara.html` mostra placar com 4 cards
- [ ] `https://seudominio/relatorios.html` mostra timeline + comparativo
- [ ] DevTools → Application → Service Workers → "activated"
- [ ] DevTools → Network → reload → chunks com 200 status

### Verificação de segurança

- [ ] `curl https://seudominio/coletor.py` → 403 Forbidden
- [ ] `curl https://seudominio/private/tokens/.betha-token.json` → 403 ou 404
- [ ] `curl https://seudominio/debug.log` → 403 ou 404
- [ ] `view-source:https://seudominio/` não revela tokens em comentários

### Verificação de compatibilidade

- [ ] Chrome desktop ✓
- [ ] Firefox desktop ✓
- [ ] Edge ✓
- [ ] Safari iOS (se possível)
- [ ] Chrome Android (se possível)
- [ ] Modo offline (desligar wifi → recarregar deve servir do cache do SW)

### Compartilhamento

- [ ] Colar URL no WhatsApp → preview com OG image/título
- [ ] Colar URL no Twitter/X → preview funciona
- [ ] Colar URL no LinkedIn → preview funciona

### SEO mínimo

- [ ] `https://seudominio/sitemap.xml` (criar se não tiver)
- [ ] `https://seudominio/robots.txt` (criar permitindo tudo)
- [ ] Submeter ao Google Search Console

---

## Comunicar a publicação

- [ ] Mensagem para grupo de WhatsApp/Telegram conhecidos
- [ ] Post em redes sociais com URL + screenshot do placar
- [ ] E-mail para 3-5 jornalistas locais
- [ ] E-mail para 3-5 vereadores oposicionistas
- [ ] Mensagem para associações de bairro

**Modelo de mensagem:**

> Lançamos o **Fiscaliza Varginha** — painel cidadão de fiscalização independente
> da Prefeitura e da Câmara Municipal.
>
> Tudo aberto, sem login, dados extraídos dos portais oficiais.
>
> 🔗 https://seudominio
>
> Sugestões e correções: speed.varginha@gmail.com

---

## Manutenção contínua (semanal)

- [ ] Rodar `coletor.py` + `_split_data.py`
- [ ] Confirmar `npm test` ainda verde
- [ ] Upload incremental de `data/chunks/`
- [ ] Bumpar `sw.js` CACHE versão
- [ ] Tweet/post avisando que dados foram atualizados

---

## Quando algo der errado

| Sintoma | Causa provável | Solução |
|---------|----------------|---------|
| Página em branco | JS quebrou | F12 Console → ver erro → rollback |
| Dados sem aparecer | Chunks não carregaram | F12 Network → ver 404 → re-upload |
| "Não é prova" não aparece | HTML truncou no upload | Re-upload completo |
| SW serve versão antiga | Cache não invalidou | Bumpar `CACHE = "zela-vN"` e re-upload sw.js |
| HTTPS warning | Cert expirou | Renovar Let's Encrypt no cPanel |
| Tudo lento | Chunks sem gzip | Habilitar no servidor |
