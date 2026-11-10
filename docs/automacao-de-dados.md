# Automacao de dados

Este projeto pode atualizar os dados sozinho no Windows, com uma regra de seguranca:
se a coleta ou a validacao falhar, os dados publicados voltam para o backup anterior.

## Comandos principais

Publicidade Transparente da Prefeitura e da Câmara integra `update-data.ps1` em todos os modos de coleta. A primeira carga traz todo o histórico mensal oferecido; depois consulta os três meses mais recentes, novos períodos e um mês histórico por rodada. Cadastros são consultados em cada ciclo. A vigia considera essas fontes vencidas após 24 horas. Falhas preservam os registros anteriores e ficam visíveis no monitor.

Para diagnosticar somente essas fontes, fora de um ciclo ativo:

```powershell
python painel-cidadao/coletor_publicidade.py
```

Esse comando coleta, mas não publica. Validação, bundle, testes e publicação seguem o fluxo normal do projeto.

Rodar coleta completa agora:

```powershell
npm run data:update
```

Rodar modo vigia agora, coletando somente quando houver mudanca detectada ou base defasada:

```powershell
npm run data:update:watch
```

Verificar fontes sem alterar dados:

```powershell
npm run data:probe
```

Instalar coleta diaria no Agendador de Tarefas do Windows:

```powershell
npm run data:schedule:daily
```

Nome da tarefa criada: `Fiscaliza Varginha - Atualizacao diaria`.

Instalar modo vigia no Agendador de Tarefas do Windows, checando a cada 180 minutos:

```powershell
npm run data:schedule:watch
```

Nome da tarefa criada: `Fiscaliza Varginha - Vigia de dados`.

Instalar o ciclo financeiro independente, diariamente às 05:15:

```powershell
npm run data:schedule:financial
```

Nome da tarefa criada: `Fiscaliza Varginha - Emendas e diarias`.
Esse ciclo atualiza somente emendas federais, emendas estaduais e diárias. Ele
não depende do SAPL, não envia WhatsApp e preserva a última base íntegra quando
CGU, Transferegov, Portal de Emendas MG ou Betha estiverem indisponíveis.

Executar o ciclo financeiro manualmente:

```powershell
npm run data:update:financial
```

## Rotina recomendada

Para manter o painel com qualidade de dados, use as duas rotinas juntas:

1. **Coleta diaria, 06:30:** garante uma atualizacao completa mesmo quando nenhuma fonte informa mudanca em tempo real.
2. **Modo vigia, a cada 180 minutos:** consulta sinais de mudanca na Prefeitura, Camara, Diario Oficial e bases auxiliares. Quando houver mudanca detectada, ou quando uma base passar da janela de frescor, o coletor roda novamente.

Antes de publicar ou divulgar um recorte, rode:

```powershell
npm run release
```

Se a auditoria detectar fonte defasada, emenda parcial, 404 em fonte oficial ou cruzamento incompleto, o site deve continuar publicando o aviso para o cidadao. O dado pode ser util para fiscalizacao, mas nao deve parecer definitivo.

## O que o modo vigia observa

- SAPL Camara: compara a assinatura da primeira pagina da API do ano atual.
- Diario Oficial: compara a assinatura das edicoes mais recentes do ano atual.
- Prefeitura/Betha: forca coleta quando o chunk local passa de 24 horas.
- Camara/Betha: forca coleta quando o chunk local passa de 12 horas.
- Diarias: forca coleta quando o chunk local passa de 24 horas.
- PNCP e Federal: forca coleta quando passam de 7 dias.

Nem toda fonte publica aviso em tempo real. Por isso, o sistema usa duas estrategias:
detectar mudanca quando a fonte permite e, quando nao permite, atualizar por janela de frescor.

## Fluxo seguro de publicacao

1. Cria backup de `painel-cidadao/data` e `painel-cidadao/data.js`.
2. Roda `coletor.py`.
3. Recalcula `indice_relevancia.json`.
4. Gera `auditoria_dados.json`.
5. Sincroniza o `data.js` offline.
6. Valida a estrutura dos dados.
7. Opcionalmente roda testes e pacote de deploy.
8. Se algo falhar, restaura o backup anterior.

## Logs e estado

- Logs: `private/logs/coleta-AAAA-MM-DD.log`
- Backups: `private/backups/`
- Assinaturas das fontes: `private/state/source-fingerprints.json`

Os backups mantem as ultimas 8 coletas bem-sucedidas ou tentadas.

## Sincronizacao segura com o GitHub

Quando a tarefa roda com `-GitSync`, o pipeline so cria o commit de dados e faz
`push` se estiver no branch `master` e não houver commits locais anteriores ainda
não enviados a `origin/master`. Isso evita que uma coleta automática publique,
sem revisão, mudanças de código acumuladas na máquina.

Se houver commits pendentes, a coleta e o deploy continuam normalmente, mas o
log registra `GitSync pulado`. Revise e envie os commits manualmente. O parâmetro
`-AllowPushWithPendingCommits` existe apenas para uma liberação deliberada após
essa revisão.
