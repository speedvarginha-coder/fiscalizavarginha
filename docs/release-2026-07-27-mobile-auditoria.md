# Release 27/07/2026 — desempenho móvel e segurança operacional

## Escopo publicado

- Painel atual em `painel-cidadao/`; `painel-v2/` permanece fora do pacote e fora de produção.
- Resumo inicial da home em `data/chunks/home_resumo.json`, derivado de
  `prefeitura.json` e vinculado à base completa por SHA-256.
- Números principais disponíveis antes do carregamento da base completa de contratos.
- Módulos JavaScript carregados por página; chat carregado em tempo ocioso.
- Remoção de requisições para chunks inexistentes.
- Orçamento estático de desempenho obrigatório no processo de release.
- Medição sintética diária em perfil móvel, sem coleta de dados de visitantes.

## Integridade e auditoria

- O resumo não substitui a base oficial: a base completa continua publicada e
  usada nas telas detalhadas.
- `data/manifest.json` registra tamanho e SHA-256 de cada chunk.
- `home_resumo.fonte_sha256` deve coincidir com o SHA-256 de `prefeitura.json`;
  divergência reprova o release.
- Schema, auditoria de dados, snapshots, testes de valores e pacote público
  continuam obrigatórios.

## WhatsApp

- Marco de publicação definido no fim de `22/07/2026`.
- O cursor avança somente após confirmação de envio de cada mensagem.
- A primeira falha interrompe o lote e preserva todos os itens seguintes.
- Referências públicas a inteligência artificial permanecem sanitizadas.
- O envio automático permanece pausado com `-SkipWhatsApp` até uma validação
  controlada da sessão e da fila.

## Recuperação

Ponto de restauração anterior:

- Arquivo: `dist/backups/fiscaliza-producao-antes-melhorias-20260727-155252.zip`
- SHA-256: `6A73FB7F1B05060E08A26DD0788265DEE82ADBD5A14D17FD149572A9ACEEF290`

Em caso de regressão, seguir `docs/rollback-manual.md` e publicar o pacote
validado, nunca arquivos avulsos.

Pacote exato publicado após as melhorias:

- Arquivo: `dist/backups/fiscaliza-producao-melhorias-20260727-161955.zip`
- SHA-256: `ADED417B9327E4313C35A6FD8C838E12B68E6964FFF3C04B849722E04E81B617`
- Manifest local/remoto: `41b48b0096fc9b88fb8fdbeaaffd110e986cdbf4cae3c967b88a550762ddae2c`
