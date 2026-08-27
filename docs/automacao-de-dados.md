# Automacao de dados

Este projeto pode atualizar os dados sozinho no Windows, com uma regra de seguranca:
se a coleta ou a validacao falhar, os dados publicados voltam para o backup anterior.

## Comandos principais

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

---

## Quando a propria automacao para

Toda a rotina acima roda no Agendador de Tarefas do Windows, na maquina do
mantenedor. O alerta de falha (`check-pipeline-health.mjs`) sai por SMTP
configurado na **mesma maquina**. Se ela desliga, trava ou perde a tarefa
agendada, a coleta para e o alerta para junto.

Foi o que aconteceu entre 11/08 e 27/08/2026: dezesseis dias sem coleta, com o
site respondendo normalmente e servindo dado velho. O monitor externo nao pegou
porque ele confere se o site esta no ar e se o manifesto bate com o release —
um site congelado passa nos dois.

### Vigia da coleta (nuvem, independente da maquina local)

O workflow `.github/workflows/vigia-coleta.yml` roda a cada 6 horas no GitHub,
sem segredo nenhum, e compara a idade do carimbo de coleta com um limite
(padrao: 36 horas). Quando passa do limite, ele **abre uma issue** com a
etiqueta `coleta-parada` — canal que sobrevive a queda do computador local,
porque o GitHub notifica por e-mail e push. Quando a coleta volta, a issue e
fechada sozinha.

Rodar a mesma checagem na mao:

```bash
npm run data:frescor
```

Sai com codigo 1 quando o dado esta defasado. Site inacessivel nao reprova
sozinho — isso e assunto do `uptime-monitor.yml`, que agora tambem registra a
idade do dado servido em cada execucao.

### Roteiro quando a issue abrir

1. A tarefa ainda existe e esta habilitada?
   `Get-ScheduledTask -TaskName "Fiscaliza Varginha*" | Select TaskName,State`
2. O ultimo arquivo em `private/logs/` diz onde o pipeline parou.
3. Coleta manual: `npm run data:update`.
4. Se a fonte estiver fora do ar e a recoleta nao for possivel agora:

   ```bash
   npm run data:reparar:folha   # reaplica a regra atual ao dado ja publicado
   npm run data:bundle          # regenera o manifesto
   ```

   Isso nao inventa dado novo: apenas impede que totais sem competencia
   carimbada continuem publicados como custo mensal. O passo 3 continua sendo
   a correcao de verdade.
