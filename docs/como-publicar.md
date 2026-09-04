# Como publicar — Fiscaliza Varginha

O destino suportado é Hostinger/Apache. Publique o ZIP gerado e validado, mantendo juntos código, dados, manifesto e `release.json`.

## Release oficial

Com o código revisado e commitado, execute:

```powershell
npm run release
```

O comando verifica segurança, contratos de dados, schemas, números, desempenho e interface; depois gera `dist/fiscaliza-varginha-painel.zip` e valida os arquivos, os bytes do ZIP e o funcionamento do pacote por HTTP.

O pacote inclui páginas, estilos, JavaScript, módulos, `fonts/`, `assets/`, PDFs públicos em `docs/`, chunks, snapshots, manifesto e regras Apache. Credenciais, logs, coletores, sessões e documentação interna não são publicados. Não copie a pasta de desenvolvimento inteira para o servidor.

## Candidato para revisão local

É possível testar alterações ainda não commitadas sem substituir o pacote oficial:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-deploy.ps1 -OutputDir dist/revisao -AllowDirty
$env:FISCALIZA_DEPLOY_DIR = "dist/revisao"
npm run validate:deploy
Remove-Item Env:FISCALIZA_DEPLOY_DIR
```

`-AllowDirty` registra as alterações no `release.json`; não envia arquivos ao servidor. Antes de uma publicação rastreável pelo commit, registre o código e gere novamente o pacote oficial.

## Upload

1. Guarde a versão validada anterior para rollback.
2. Envie o conteúdo do ZIP aprovado à raiz pública do site pela rotina de publicação existente ou pelo gerenciador de arquivos da hospedagem.
3. Preserve credenciais e dados privados do servidor. O agregado de votos do Avalie é mantido pelo PHP e fica fora do pacote.
4. Confirme HTTPS, regras de `.htaccess`, versão do `release.json` e hash do manifesto publicado.
5. Confira Início, Conformidade, Pessoal, Câmara e Atualizações. Não deve haver 404 em módulos/fontes nem tabela presa no carregamento.

Mesmo em uma atualização apenas de dados, o manifesto deve corresponder aos arquivos enviados. O ciclo automático refaz o pacote e publica `release.json` por último. Evite enviar somente alguns chunks avulsos.

## Validação e limites

- `npm run validate:data`: valida e gera os derivados dos dados; modifica arquivos gerados.
- `npm run deploy:zip`: gera o pacote, sem realizar upload.
- `npm run validate:deploy`: confere conteúdo e executa testes contra o pacote.
- `npm run test:deploy`: repete somente os testes HTTP do pacote existente.

O servidor dos testes é Python e não executa PHP nem regras Apache. Chat, votação e configuração efetiva da hospedagem precisam ser conferidos no ambiente apropriado. Testes locais não comprovam que a nova versão já está no ar.

## Rollback

Use o procedimento de [rollback-manual.md](rollback-manual.md) e o último pacote validado. Mantenha código, dados, manifesto e release da mesma versão; preserve os arquivos privados e votos existentes no servidor.
