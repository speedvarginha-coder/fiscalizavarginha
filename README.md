# Fiscaliza Varginha — Painel Cidadão

Painel independente de fiscalização da Prefeitura e Câmara Municipal de Varginha-MG.

Dados extraídos dos portais oficiais (Betha, SAPL, PNCP, TCE-MG), apresentados em linguagem cidadã com triagem automática de sinais de atenção.

**Não é prova de irregularidade** — é um ponto de partida para fiscalização com fontes primárias.

---

## Começando

### Para usar o painel (cidadão)

Abra `painel-cidadao/index.html` num servidor web. Para rodar local:

```bash
cd painel-cidadao
python -m http.server 8000
# abra http://localhost:8000
```

### Para desenvolver

```bash
# instalar dependências de teste
npm install
npx playwright install chromium

# rodar testes
npm test

# validar dados + testes + gerar pacote limpo de publicação
npm run release

# atualizar dados agora, com log, validação e pacote limpo
npm run data:update

# instalar atualização automática diária (Windows Task Scheduler)
npm run data:schedule:daily

# instalar modo vigia: checa fontes a cada 180 minutos e coleta se mudou
npm run data:schedule:watch

# atualizar dados (precisa de Python + tokens Betha)
cd painel-cidadao
py coletor.py
# o coletor atualiza data/chunks/ e data/manifest.json
```

---

## Estrutura do projeto

```
3_Fiscaliza Varginha/
├── painel-cidadao/   Pasta pública (vai para servidor)
├── private/          Tokens e logs (NUNCA publica)
├── tests/            142 testes automatizados
├── docs/             Documentação interna
└── .gitignore        Proteção contra commit de segredos
```

**Produto oficial:** a versão publicada é sempre o pacote `dist/fiscaliza-varginha-painel.zip`, gerado por `npm run deploy:zip` e aprovado por `npm run validate:deploy` (ambos executados por `npm run release`). O destino suportado é Hostinger/Apache.
O diretório `dashboard/`, quando existir, deve ser tratado como laboratório/migração futura e não entra no pacote oficial enquanto não houver plano de migração documentado.

---

## Documentação

| Doc | Para que serve |
|-----|----------------|
| [docs/arquitetura.md](docs/arquitetura.md) | Como o código funciona por dentro |
| [docs/fontes-de-dados.md](docs/fontes-de-dados.md) | De onde vem cada número |
| [docs/como-atualizar.md](docs/como-atualizar.md) | Rodar o coletor e gerar novos dados |
| [docs/automacao-de-dados.md](docs/automacao-de-dados.md) | Atualizacao automatica, vigia, logs e rollback |
| [docs/como-publicar.md](docs/como-publicar.md) | Deploy do pacote validado em Hostinger/Apache |
| [docs/checklist-publicacao.md](docs/checklist-publicacao.md) | Conferir antes de cada deploy |

---

## Recursos do painel

- **Páginas temáticas:** Início, Atualizações, Monitoramento, Prefeitura, Fundação Cultural, Câmara, Emendas, Relatórios, Pessoal, Marcadores, Sobre, Conformidade e Como cobrar
- **Placar do Dinheiro** com ícones SVG profissionais
- **Filtros por categoria** (Saúde, Educação, Obras, Transporte, Cultura, Assistência, Administração, Segurança)
- **Cruzamento CNPJ** entre fornecedores da Prefeitura e emendas da Câmara
- **Conferência de procedência** de contratos com clique direto em listas, Betha, portal oficial e PNCP
- **Detector de fragmentação** de contratos (Lei 14.133/2021)
- **Comparativo entre anos** por categoria
- **Linha do tempo** de sinais de atenção
- **Watchlist pessoal** (marcadores salvos no navegador)
- **Glossário cidadão** (jargão técnico → linguagem comum)
- **Dark mode** automático (segue `prefers-color-scheme`)
- **Mobile responsivo**
- **Atalhos de teclado** (`/` foca busca, `g+letra` navega)
- **Service Worker** com cache offline
- **Acessibilidade** WCAG AA básico
- **Atualização automatizável** diária ou em modo vigia por intervalo
- **Avisos de qualidade dos dados** nas páginas públicas quando uma fonte estiver defasada, parcial ou sem cruzamento automático confiável

---

## Stack técnica

- HTML/CSS/JS vanilla — sem framework, sem build step
- Service Worker para cache e atualização em background
- Service de dados: chunks JSON carregados sob demanda
- Python 3 para coletores (requests, beautifulsoup4)
- Playwright para testes E2E
- Scripts de validação/release em Node + PowerShell
- Agendamento local via Windows Task Scheduler

---

## Contato

E-mail: speed.varginha@gmail.com

Para reportar dado incorreto, sugerir feature, ou contribuir.

---

## Disclaimer

Ferramenta independente, sem fins lucrativos, sem vínculo partidário.

Os dados são extraídos de fontes oficiais com triagem automática baseada em critérios documentais (objeto claro, valor preenchido, datas presentes).

**Antes de divulgar qualquer dado, conferir a fonte primária** (Portal Betha, SAPL, ou ofício LAI/e-SIC).

---

## Licença

Código MIT. Dados são públicos por definição (Lei 12.527/2011 — LAI).

Heroicons (ícones SVG): MIT License, copyright Tailwind Labs.
