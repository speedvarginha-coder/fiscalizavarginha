# Como atualizar os dados — Fiscaliza Varginha

Processo para coletar dados novos dos portais oficiais e gerar os chunks JSON que o painel usa.

Recomendação operacional: atualizar **todo dia**. Quando a Prefeitura, a Câmara ou outro sistema oficial publicar documentos fora desse horário, usar o modo **vigia** para checar em intervalos menores.

---

## Antes de começar

1. **Estar conectado à internet** (Betha precisa).
2. **Python 3.10+ instalado** (`py --version`).
3. **Tokens do Betha** em `private/tokens/` — coletor cria automaticamente na primeira execução.
4. **Estar na pasta `painel-cidadao/`** ao rodar os scripts.

---

## Processo padrão manual

### Passo 1 — Coletar dados frescos

```bash
cd painel-cidadao
py coletor.py
```

Isso roda todos os coletores em sequência:

```
[1/8] coletor_betha.py        → Prefeitura: contratos, despesas, licitações
[2/8] coletor_betha.py (cam)  → Câmara: contratos, despesas
[3/8] coletor_pessoal.py      → Folha de pagamento
[4/8] (diárias incluídas no betha)
[5/8] coletor_emendas_2026.py → Emendas impositivas
[6/8] coletor_pncp.py         → Licitações no PNCP
[7/8] coletor_cnpj.py         → Situação cadastral dos fornecedores
[8/8] coletor_federal.py      → Transferências da União
```

Cada coletor escreve em `painel-cidadao/data/*.json`. Logs vão para `private/logs/debug.log`.

**Tempo total:** ~5-15 minutos dependendo da conexão.

### Passo 2 — Verificar saúde da coleta

Olhar o final de `private/logs/debug.log`:

```
OK Prefeitura: 816 contratos coletados
OK Câmara: 142 contratos coletados
OK Pessoal: 2934 servidores coletados
OK Emendas: 357 emendas processadas
ERRO Federal: timeout em api.portaldatransparencia.gov.br
```

Se algum coletor falhar, o dado **anterior é preservado** — só não fica atualizado. O painel mostra "última coleta há X dias" no carimbo.

### Passo 3 — Conferir chunks JSON

```bash
dir data\chunks
```

O `coletor.py` já grava:
- `data.js` (fallback monolítico para uso via `file://`)
- `data/chunks/*.json` (16 arquivos públicos carregados sob demanda)
- `data/manifest.json`

Se algum chunk esperado não aparecer, conferir o log em `private/logs/debug.log`.

### Passo 4 — Testar localmente

```bash
cd ..   # voltar para raiz
npm run validate:data
npm test
```

Se `validate:data` e os 75+ testes passarem, os dados estão estruturalmente íntegros e o painel renderiza sem erro JS.

Para inspecionar visualmente:

```bash
cd painel-cidadao
py -m http.server 8000
```

Abrir `http://localhost:8000` no browser. Conferir:
- [ ] Placar do dinheiro mostra valores plausíveis
- [ ] Aba Contratos lista contratos novos
- [ ] Carimbo "Coletado há 0 dias" no card "Total contratado"

### Passo 5 — Commit

```bash
cd ..
git add painel-cidadao/data/
git commit -m "data: coleta diaria $(date +%Y-%m-%d)"
```

### Passo 6 — Publicar (se for o caso)

Ver `docs/como-publicar.md`.

---

## Atualizar só uma fonte específica

### Só contratos da Prefeitura

```bash
cd painel-cidadao
py coletor_betha.py --escopo prefeitura --consulta contratos
```

### Só folha de pagamento

```bash
py coletor_pessoal.py
```

### Só emendas

```bash
py coletor_emendas_2026.py
```

### Forçar renovação de token

```bash
py coletor_betha.py --force-token
```

Apaga `private/tokens/.betha-token.json` e força nova autenticação.

---

## Problemas comuns

### "ModuleNotFoundError: No module named 'requests'"

```bash
pip install requests beautifulsoup4 lxml
```

### "HTTP 401 Unauthorized" no Betha

Token expirou. Força renovação:

```bash
py coletor_betha.py --force-token
```

### "JSON decode error"

O Betha mudou a API. Investigar:
1. Abrir o portal no browser
2. DevTools → Network → filtrar por XHR
3. Comparar URLs/payloads com `coletor_betha.py`
4. Ajustar coletor

### Coleta demora muito (> 30 min)

API Betha tem rate limit. Esperar 1h e tentar novamente. Coletor tem retry exponencial mas pode esgotar.

### Painel mostra "dados podem estar desatualizados"

Carimbo vermelho aparece quando `atualizado_em` > 21 dias. Rodar coleta:

```bash
py coletor.py
# o coletor já atualiza data.js, data/chunks/ e data/manifest.json
```

---

## Estrutura interna do `data/`

Após uma coleta bem-sucedida:

```
painel-cidadao/data/
├── chunks/                       # SERVIDO AO BROWSER
│   ├── atualizado_em.json        # Timestamp
│   ├── prefeitura.json           # Contratos, licitações, eventos, aluguéis
│   ├── camara_anos.json          # Contratos + despesas Câmara por ano
│   ├── camara_transparencia.json # Snapshot do site da Câmara
│   ├── emendas.json              # Emendas impositivas
│   ├── diarias.json              # Diárias Prefeitura + Câmara
│   ├── pessoal.json              # Folha de pagamento
│   ├── vereadores.json           # Lista + produtividade legislativa
│   ├── cnpjs.json                # Situação cadastral fornecedores
│   ├── pncp.json                 # Licitações PNCP
│   ├── federal.json              # Transferências União
│   ├── resumo.json               # Indicadores agregados
│   ├── fontes_emendas_2026.json  # (em construção)
│   └── diario.json               # Diário Oficial
│
├── manifest.json                 # Lista de chunks com tamanhos
│
├── prefeitura_betha.json         # INTERMEDIÁRIO (raw do coletor)
├── camara_betha.json             # ...
├── pessoal.json                  # ...
└── ...
```

Os arquivos intermediários (raw) **não vão para o browser**. Só os `chunks/` são servidos.

---

## Automatização recomendada

### Opção A — Diário local (Windows Task Scheduler)

Na raiz do projeto:

```powershell
npm run data:schedule:daily
```

Isso instala/atualiza a tarefa **Fiscaliza Varginha - Atualizar dados** para rodar todos os dias às 06:30.

A rotina executa:

1. `painel-cidadao/coletor.py`
2. `npm run validate:data`
3. `npm test`
4. `npm run deploy:zip`
5. `npm run validate:deploy`

Logs ficam em `private/logs/coleta-YYYY-MM-DD.log`.

Para rodar agora, sem esperar o agendamento:

```powershell
npm run data:update
```

### Opção B — Modo vigia por intervalo

Se a prioridade for capturar documentos assim que os sistemas da Prefeitura/Câmara publicarem novidades, instale o modo vigia:

```powershell
npm run data:schedule:watch
```

Por padrão ele roda a cada 180 minutos. Para outro intervalo:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-data-task.ps1 -Mode Watch -IntervalMinutes 60
```

Observação: isso é uma aproximação por polling. Só seria "em tempo real" se os sistemas oficiais oferecessem webhook/feed confiável, o que normalmente não acontece nesses portais.

### Opção C — Cron local manual

Criar `.bat` que roda diariamente:

```batch
cd "D:\Ações Prefeitura Varginha\3_Fiscaliza Varginha"
npm run data:update
```

### Opção D — GitHub Actions ou servidor

`.github/workflows/coleta.yml`:

```yaml
on:
  schedule:
    - cron: '30 9 * * *'  # Todo dia 06:30 em America/Sao_Paulo, ajustar UTC conforme horario de verao/politica
jobs:
  coletar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
      - run: pip install -r requirements.txt
      - run: cd painel-cidadao && python coletor.py
      - run: npm run validate:data
      - run: git add painel-cidadao/data/ && git commit -m "data: coleta cron"
      - run: git push
```

**Atenção:** tokens do Betha precisam estar em GitHub Secrets, não no repo. Se a autenticação exigir navegador/sessão interativa, prefira um servidor próprio ou o Windows Task Scheduler local.

---

## Limpeza periódica

Logs e backups acumulam. Limpar mensalmente:

```bash
cd "3_Fiscaliza Varginha"
rm -f private/logs/debug.log
rm -f painel-cidadao/*.bak
rm -f painel-cidadao/data.js.bak
```

Não apagar `private/tokens/` — coletor vai pedir reautenticação manual.
