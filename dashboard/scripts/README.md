# Scripts — Fiscaliza Varginha

## `scrape-betha.mjs`

Coleta dados reais do **Portal da Transparência Betha** da Prefeitura e da
Câmara Municipal de Varginha, e grava em `src/data/categoriasGasto.real.json`.

A interface mostra com selo verde "✓ Dado real auditado" e a fonte (URL)
todas as categorias que tiverem entrada nesse JSON. Categorias sem dado real
caem na estimativa marcada como "≈ Estimativa".

### Como rodar

A partir da pasta raiz do projeto (`3_Fiscaliza Varginha/`):

```bash
# Todas as categorias, Prefeitura + Câmara
node dashboard/scripts/scrape-betha.mjs

# Só uma categoria (ex: combustível)
node dashboard/scripts/scrape-betha.mjs combustivel

# Modo dry-run (não grava, só mostra o resultado)
node dashboard/scripts/scrape-betha.mjs --dry
```

### Pré-requisitos

- Node.js 18+
- `playwright` instalado (já está no `package.json` da raiz)
- Primeira execução com browser visível (`headless: false` por padrão)

### Primeira execução — calibragem

O portal Betha é uma SPA pesada. Os seletores CSS no script (`SELECTOR_BUSCA`,
`SELECTOR_TOTAL`, `SELECTOR_LINHAS`) são **placeholders** que você precisa
conferir na primeira rodada.

**Passo a passo:**

1. Abra manualmente no navegador a URL de consulta de despesas:
   - Prefeitura: `https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==`
   - Câmara: `https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==`

2. Encontre a tela de **Despesas / Empenhos**.

3. Abra o DevTools (F12) e inspecione:
   - O **campo de busca** (input onde você digita o filtro)
   - O **valor total** exibido após filtrar
   - As **linhas da tabela** de resultado

4. Copie os seletores CSS reais e atualize as constantes no topo de
   `consultarTermo()`:

   ```js
   const SELECTOR_BUSCA  = 'SELETOR_REAL_AQUI';
   const SELECTOR_TOTAL  = 'SELETOR_REAL_AQUI';
   const SELECTOR_LINHAS = 'SELETOR_REAL_AQUI';
   ```

5. Rode `node dashboard/scripts/scrape-betha.mjs combustivel --dry` para testar
   uma categoria sem gravar.

6. Se funcionar, rode sem `--dry` para gravar o resultado real.

### Por que o portal Betha não tem API pública?

A maioria dos municípios brasileiros usa o sistema Betha (ou Implanta, e-Cidades,
TecnoSim) que renderizam a transparência via SPA, **sem API pública documentada**.
Isso obriga a scraping para automatizar a coleta. A Lei 12.527/2011 garante o
direito de acesso aos dados, então isso é totalmente legítimo — mas exige um
script que respeite o portal (rate limit, User-Agent honesto).

### Agendamento (opcional)

Para rodar automaticamente toda madrugada via Task Scheduler no Windows:

```powershell
schtasks /Create /SC DAILY /TN "Fiscaliza Varginha — Scrape Betha" `
  /TR "node 'C:\caminho\para\3_Fiscaliza Varginha\dashboard\scripts\scrape-betha.mjs'" `
  /ST 03:00
```

No Linux/macOS, use cron:
```cron
0 3 * * * cd /caminho/para/3_Fiscaliza\ Varginha && node dashboard/scripts/scrape-betha.mjs
```

### Política de integridade

- **NUNCA** invente valores. Se o seletor falha, o script deve REGISTRAR
  o erro e PULAR — nunca gravar um número aproximado como se fosse real.
- Cada entrada em `categoriasGasto.real.json` precisa ter `fonteUrl` válido
  apontando para a consulta que produziu aquele número.
- O selo verde "✓ Dado real" só aparece se o JSON tiver a entrada — o
  default é "≈ Estimativa" com aviso amarelo.

Sem isso, a plataforma vira um vetor de acusação injusta. Dado errado é pior
que dado faltando.
