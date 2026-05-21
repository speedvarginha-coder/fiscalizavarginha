# Como atualizar os dados — Zela Varginha

Processo manual para coletar dados novos do portal Betha e gerar os chunks JSON que o painel usa.

---

## Antes de começar

1. **Estar conectado à internet** (Betha precisa).
2. **Python 3.10+ instalado** (`py --version`).
3. **Tokens do Betha** em `private/tokens/` — coletor cria automaticamente na primeira execução.
4. **Estar na pasta `painel-cidadao/`** ao rodar os scripts.

---

## Processo padrão (semanal)

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

### Passo 3 — Gerar chunks JSON

```bash
py _split_data.py
```

Isso:
- Lê `data.js` (bundle monolítico gerado pelo `coletor.py`)
- Divide em `data/chunks/*.json` (14 arquivos)
- Atualiza `data/manifest.json`

**Tempo:** ~5 segundos.

### Passo 4 — Testar localmente

```bash
cd ..   # voltar para raiz
npm test
```

Se os 32 testes passarem, o painel renderiza os novos dados sem erro JS.

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
git commit -m "data: coleta semanal $(date +%Y-%m-%d)"
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
py _split_data.py
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

## Automatizar (futuro)

Quando for hora:

### Opção A — Cron local (Windows Task Scheduler)

Criar `.bat` que roda semanalmente:

```batch
cd "C:\Users\Desktop\Desktop\Ações Prefeitura Varginha\3_Fiscaliza Varginha\painel-cidadao"
py coletor.py >> ..\private\logs\cron.log 2>&1
py _split_data.py >> ..\private\logs\cron.log 2>&1
git -C .. add painel-cidadao/data/
git -C .. commit -m "data: coleta automatica"
```

### Opção B — GitHub Actions (se repo for público)

`.github/workflows/coleta.yml`:

```yaml
on:
  schedule:
    - cron: '0 6 * * 1'  # Segunda 6h
jobs:
  coletar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
      - run: pip install -r requirements.txt
      - run: cd painel-cidadao && python coletor.py && python _split_data.py
      - run: git add painel-cidadao/data/ && git commit -m "data: coleta cron"
      - run: git push
```

**Atenção:** tokens do Betha precisam estar em GitHub Secrets, não no repo.

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
