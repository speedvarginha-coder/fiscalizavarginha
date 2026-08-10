# Operação local do Fiscaliza Varginha

Este documento registra a Parte 1 da continuidade operacional: manter as
coletas, publicações, alertas e a ponte do WhatsApp funcionando no computador
Windows atual.

## Proteções automáticas

- O computador não suspende nem hiberna enquanto estiver ligado na tomada.
- As tarefas podem despertar o Windows, iniciar assim que possível depois de um
  horário perdido e continuar quando o computador entra em modo de bateria.
- Coleta diária, vigia rápida, watchdog e auditoria de desempenho possuem limite
  de execução e tentativas automáticas depois de falha.
- A falha exclusiva do envio ao WhatsApp não repete uma coleta completa. Ela
  continua visível no monitor operacional.
- A ponte do WhatsApp possui supervisor de processo e uma segunda vigia, a cada
  cinco minutos, que confirma a falha antes de reiniciar a tarefa.
- O watchdog verifica também a atualidade da ponte, do último sucesso, do
  desempenho, dos backups locais, da cópia externa e do site publicado.
- O canal de alerta por e-mail é independente do WhatsApp.
- O último backup completo é copiado diariamente para o Google Drive. A
  gravação usa arquivo parcial, troca final e conferência SHA-256.
- Um relatório operacional diário é salvo localmente e enviado por e-mail.

## Tarefas críticas

| Tarefa | Função |
| --- | --- |
| Fiscaliza Varginha - Atualizacao diaria | Coleta completa, validação e publicação |
| Fiscaliza Varginha - Vigia rapida | Verifica alterações ao longo do dia |
| Fiscaliza Varginha - Watchdog Independente | Detecta pipeline parado ou falhas persistentes |
| Fiscaliza Varginha - Desempenho do Site | Confere os indicadores de desempenho publicados |
| Fiscaliza Varginha - Ponte WhatsApp | Mantém a sessão local do WhatsApp ativa |
| Fiscaliza Varginha - Vigia WhatsApp | Testa e recupera a ponte a cada cinco minutos |
| Fiscaliza Varginha - Backup Externo | Copia e verifica o backup no Google Drive diariamente |
| Fiscaliza Varginha - Monitor Externo | Confere site, release e manifest a cada dez minutos |
| Fiscaliza Varginha - Relatorio Operacional | Consolida e envia o estado do projeto diariamente |

## Condições necessárias

1. Manter o computador ligado na tomada e com internet.
2. Manter a sessão do usuário Windows iniciada. As tarefas usam o modo
   interativo para acessar o ambiente, as credenciais e a sessão do WhatsApp.
3. Não apagar a pasta `private`, que contém credenciais, estados e backups e não
   é publicada no site.
4. Se aparecer QR Code no painel local do WhatsApp, reconectar o aparelho.
5. Manter o Google Drive conectado como unidade `L:`. Se a unidade sumir, o
   backup falha e o watchdog envia alerta operacional.

## Recuperação e retenção

- Backups locais: oito coletas válidas restauráveis.
- Quarentenas: quatro coletas rejeitadas para diagnóstico, sem expulsar os
  backups válidos da retenção.
- Backups externos: quatorze arquivos em
  `L:\Meu Drive\Fiscaliza Varginha\Backups Externos`.
- O teste de restauração sempre extrai e troca dados em uma pasta isolada; ele
  não altera os dados publicados.

## Limites desta etapa

- Se o computador ficar desligado, sem internet ou parado antes do login, o site
  continua online, mas não recebe dados novos até o Windows voltar e a sessão ser
  iniciada.
- A opção da BIOS/UEFI para ligar o computador automaticamente após retorno da
  energia deve ser habilitada manualmente quando disponível (normalmente
  `Restore on AC Power Loss`, `AC Power Recovery` ou equivalente).
- A Parte 2, em VPS, elimina a dependência do computador e do login local.
- O workflow `.github/workflows/uptime-monitor.yml` permite que o GitHub confira
  o site mesmo quando este computador estiver desligado. Ele passa a executar
  depois que o arquivo for publicado na branch principal do repositório.

## Verificação rápida

No PowerShell, dentro da pasta do projeto:

```powershell
node scripts/check-whatsapp-bridge.mjs
node scripts/check-pipeline-health.mjs --tarefa=watchdog-independente
npm run health:external
npm run test:restore
npm run test:backup
npm run test:pipeline
npm run test:data
```

Para reaplicar toda a configuração local de resiliência:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-resilience.ps1
```
