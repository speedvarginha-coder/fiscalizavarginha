# Fiscaliza Varginha — Plano Completo de Melhorias & Checklist para Handoff (Codex)

> **Destinatário:** Codex / ChatGPT  
> **Origem:** Auditoria e Alinhamento Estratégico (Fiscaliza Varginha)  
> **Data:** Setembro/2026  
> **Objetivo:** Guia completo de implementação de todas as melhorias acordadas para o Fiscaliza Varginha, cobrindo linguagem cidadã, honestidade e blindagem jurídica, transparência ativa, novas abas (Boletim Semanal), auditoria visual e acessibilidade.

---

## 🎯 Diretrizes Inegociáveis do Projeto (Arquitetura & Filosofia)
1. **Stack Estática Vanilla:** HTML5, CSS Vanilla modular (design system próprio) e JavaScript ES6 puro em `painel-cidadao/`. Proibido adicionar React, Vue ou frameworks pesados no produto oficial publicado.
2. **Carregamento Progressivo (3 Fases):** Chunks JSON leves via `data-loader.js`. Toda nova funcionalidade deve respeitar o teto estrito de `npm run performance:budget`.
3. **Princípio Editorial:** Jamais acusar crime ou improbidade sem documento comprobatório. O painel aponta **"Sinais de Fiscalização"** para incentivar a checagem na fonte primária.
4. **Segurança de Segredos:** Chaves de API (Google Gemini), senhas e tokens **nunca** entram no frontend nem no Git. Em produção, usar o proxy ofuscado (`bate-papo.php`).
5. **Critério de Aceite Estrito:** Nenhuma alteração sobe sem passar em:
   `npm test`, `npm run test:pipeline`, `npm run test:contracts`, `npm run test:security`, `npm run test:numeros` e `npm run validate:deploy`.

---

## 📋 MAPA COMPLETO DE MELHORIAS

---

### PILAR 1: Nova Aba "Boletim Semanal" (Blog Cidadão)
*Transformar dados contábeis em narrativa semanal acessível, gerando audiência recorrente e compartilhamento.*

- [ ] **Interface Pública (`boletim.html` ou integração em `atualizacoes.html`):**
  - [ ] Layout editorial com cartões das edições anteriores e destaque para a edição da semana corrente.
  - [ ] **Estrutura Fixa de cada Edição:**
    1. ⚡ **Em 30 Segundos:** Os 3 acontecimentos mais relevantes da semana (resumo rápido).
    2. 💰 **O Dinheiro da Semana:** Top 3 maiores contratos assinados e licitações abertas.
    3. 🏛️ **No Plenário da Câmara:** Matérias protocoladas pelos vereadores e temas debatidos.
    4. 🚧 **Olho nas Obras:** Andamento das obras e ordens de serviço nos bairros.
    5. 🔍 **Sinal da Semana:** Um ponto documental para a sociedade acompanhar (dispensa, aditivo ou prazo).
    6. 📲 **Botão de Compartilhamento WhatsApp:** Mensagem pré-formatada pronta para disparar em grupos.
- [ ] **Automação do Pipeline de Geração:**
  - [ ] Integrar os scripts existentes: `scripts/generate-resumo.mjs` e `scripts/publicar-resumo.mjs`.
  - [ ] Criar chunk leve `data/chunks/boletins.json` com o histórico das edições para renderização instantânea.
  - [ ] Opção de geração automática via Google Gemini (com curadoria e aprovação em 1 clique).

---

### PILAR 2: Tradução Didática e Linguagem Cidadã
*Eliminar o jargão governamental para que qualquer pessoa compreenda os números em segundos.*

- [ ] **Tradução Visual do Ciclo Contábil (Barra de Progresso Cidadã):**
  - [ ] Substituir colunas técnicas (*Empenhado / Liquidado / Pago*) por etapas didáticas e coloridas:
    - 🟡 **Reservado (Empenho):** *"A Prefeitura separou o dinheiro no orçamento, mas o serviço ainda não foi feito."*
    - 🔵 **Entregue e Conferido (Liquidação):** *"O produto foi entregue ou a obra foi executada e atestada com nota fiscal."*
    - 🟢 **Dinheiro Pago:** *"O valor já saiu dos cofres municipais para a conta da empresa."*
- [ ] **Métricas em Escala Humana & Equivalências Cotidianas:**
  - [ ] Nos 4 cards do Placar do Dinheiro da Home, adicionar cálculo per capita:  
    *Ex.: "R$ 356 milhões na Saúde equivalem a R$ 6,80 por dia por morador de Varginha."* (base: ~138 mil hab.).
  - [ ] Equivalências tangíveis em recapeamento/asfalto: custo médio por km ou m² pavimentado.
- [ ] **Micro-Explicações ("O que significa na prática?"):**
  - [ ] Adicionar campo explicativo simples nos contratos de maior valor (ex.: *"Aquisição de insumos farmacológicos"* ➔ *"Compra de remédios básicos para distribuição nos postos de saúde"*).
- [ ] **Sugestões Visíveis na IA "Pergunte à Iris":**
  - [ ] Chips clicáveis no rodapé com dúvidas reais:  
    *“Quanto custa a coleta de lixo por mês?”*, *“Quais foram as emendas para o meu bairro?”*, *“Quem são os maiores fornecedores da prefeitura?”*.

---

### PILAR 3: Honestidade, Rigor Contextual e Blindagem Jurídica
*Garantir equilíbrio editorial, evitar acusações injustas e proteger legalmente a equipe do projeto.*

- [ ] **"Espaço do Contraditório" (Proteção Legal e Direito de Resposta):**
  - [ ] Inserir em modais de contratos e fornecedores o botão:  
    👉 *`É representante deste órgão ou fornecedor? Registre um esclarecimento oficial.`*
  - [ ] Permitir publicar notas de esclarecimento e termos aditivos oficiais enviados pela empresa logo abaixo do contrato.
  - [ ] **Impacto Jurídico:** Elimina na Justiça qualquer alegação de má-fé, sensacionalismo ou dano moral.
- [ ] **Contextualização Imediata em Casos Atípicos:**
  - [ ] *Licitações com Valor Simbólico (R$ 0,01 / R$ 5,00):* Explicar automaticamente que se trata de concessão ou parceria comercial com exploração de bilheteria/estandes, onde o valor econômico está nas contrapartidas e não em pagamento direto.
  - [ ] *Sanções Aplicadas por Outros Entes:* Explicar a Lei 14.133 — suspensões aplicadas por outros municípios não impedem contratar em Varginha.
- [ ] **Diferenciação de Falha de Fonte vs. Falha de Gestão:**
  - [ ] Quando faltar a modalidade em contratos da Betha, exibir: *"A Prefeitura não disponibilizou este campo no portal oficial de dados abertos."* (incentiva transparência sem acusar o gestor).
- [ ] **Transparência Responsável na Folha de Pessoal (`pessoal.html`):**
  - [ ] Separar didaticamente:
    1. 🩺 **Efetivos Concursados de Carreira:** Médicos plantonistas, professores e servidores estáveis com adicionais de tempo de serviço.
    2. 👔 **Cargos Comissionados de Confiança:** Indicações políticas e assessores.
    3. 📋 **Contratos Temporários e Estagiários.**
  - [ ] Evita perseguição a servidores concursados e foca a fiscalização no aumento de cargos políticos.
- [ ] **Reconhecimento Positivo:**
  - [ ] Indicador de *Obras Entregues no Prazo* e *Licitações com Desconto Real* (onde a concorrência gerou economia aos cofres públicos).

---

### PILAR 4: Transparência Ativa e Facilidade de Cobrança
*Empoderar o cidadão para checar na fonte e exigir respostas oficiais.*

- [ ] **Botão "Fonte Primária em 1 Clique":**
  - [ ] Em cada contrato, obra ou licitação: botão direto para o Portal Betha ou PNCP oficial, com o número do processo/edital pré-copiado para a área de transferência.
- [ ] **Minuta de Pedido LAI / e-SIC em 1 Clique (`cobrar.html`):**
  - [ ] Botão *"Solicitar Esclarecimento Oficial"*: gera minuta pronta nos termos da Lei de Acesso à Informação (Lei 12.527/2011), com empenho, valor, objeto e link do e-SIC da Prefeitura/Câmara.
- [ ] **Filtro Geográfico por Bairro ("O que acontece perto de mim?"):**
  - [ ] Seletor de bairros de Varginha (*Santana, Sion, Imaculada, Jardim Corcetti, Centro, etc.*).
  - [ ] Filtrar obras locais, reformas de UBS, manutenção de escolas e emendas parlamentares destinadas àquela localidade.
- [ ] **Termômetro da Transparência Municipal:**
  - [ ] Acompanhamento de pedidos LAI: quantos foram respondidos no prazo de 20 dias e quantos estão em atraso.
  - [ ] Registro público de melhorias feitas pela Prefeitura/Câmara nos portais oficiais.

---

### PILAR 5: Auditoria Visual, Cruzamentos Avançados e Dados Abertos
*Cruzar dados públicos para gerar inteligência fiscal sem pré-julgamentos.*

- [ ] **"Auditoria Visual Colaborativa" (Antes e Depois das Obras):**
  - [ ] Canal para envio de fotos geolocalizadas pelos próprios moradores (via formulário ou WhatsApp).
  - [ ] Galeria comparando o projeto licitado vs. a foto real da obra entregue nas ruas.
- [ ] **Detector Educativo de Fragmentação de Despesas (Lei 14.133):**
  - [ ] Quando um fornecedor acumular múltiplas compras com dispensa de licitação do mesmo gênero no ano:  
    *💡 "Este fornecedor recebeu 4 compras com dispensa que somam R$ 180 mil em 2026. A nova Lei de Licitações recomenda licitação ampla quando a demanda for contínua ao longo do ano."*
- [ ] **Cruzamento "Data de Abertura do CNPJ vs. Valor do Contrato":**
  - [ ] Apontamento objetivo da Receita Federal:  
    *📅 "Empresa constituída em 15/01/2026 (4 meses antes da assinatura deste contrato de R$ 850 mil)."*
- [ ] **Termômetro das Contas ("A Cidade está no Azul ou no Vermelho?"):**
  - [ ] Visão didática da saúde fiscal: Arrecadação própria (IPTU, ISS) + Repasses (FPM, ICMS, IPVA) vs. Despesas pagas no mês.
- [ ] **Dossiê em 1 Clique para Conselhos Municipais e Imprensa:**
  - [ ] Botão para gerar PDF consolidado mensal para reuniões do Conselho Municipal de Saúde, Conselho do FUNDEB e imprensa local.
- [ ] **Botão "Baixar Dados Abertos (CSV / Excel)":**
  - [ ] Exportação aberta em todas as tabelas para apoiar pesquisas de universidades locais (UNIFAL, Unis, CEFET, FADIVA).

---

### PILAR 6: Acessibilidade Inclusiva, Notificação e Educação
*Garantir que o painel chegue a todas as camadas da população de Varginha.*

- [ ] **Áudio Cidadão (Botão "Ouvir Resumo"):**
  - [ ] Síntese de voz nativa (`window.speechSynthesis`) para ler os resumos em 40 segundos, atendendo idosos, pessoas com deficiência visual ou baixa escolaridade.
- [ ] **Canal / Boletim Semanal no WhatsApp:**
  - [ ] Disparo automático do resumo de 3 tópicos aos sábados de manhã via `whatsapp-bridge` para grupos e lideranças comunitárias.
- [ ] **Quiz do Cidadão Consciente (Educação Cívica):**
  - [ ] Jogo rápido de 3 perguntas para jovens e escolas: *"Você sabe para onde vai o imposto que sua família paga?"* (compara a percepção com os números reais da LOA).

---

## 🛠️ Roteiro de Validação Técnica Obrigatória Pós-Implementação

Toda alteração deve ser testada localmente antes de qualquer commit ou release:

```powershell
# 1. Checagem estática, acentuação e SEO
npm run lint:syntax
npm run lint:accents
npm run lint:seo

# 2. Orçamento de performance (tamanho de arquivos e JSONs)
npm run performance:budget

# 3. Testes unitários, segurança XSS e contratos de dados
npm run test:pipeline
npm run test:contracts
npm run test:security
npm run test:numeros

# 4. Suíte completa de testes E2E do navegador (Playwright)
npm test

# 5. Empacotamento limpo e teste sobre o pacote de produção
npm run release
```
