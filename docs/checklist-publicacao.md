# Checklist de publicação — Fiscaliza Varginha

## Antes de publicar

- [ ] Código revisado e commitado; dados gerados identificados separadamente.
- [ ] Nenhuma coleta concorrente está regravando os dados da versão em validação.
- [ ] `npm run release` terminou com sucesso.
- [ ] Schemas, hashes e números publicados conferidos.
- [ ] Limitações das fontes parciais, preservadas ou manuais continuam visíveis.
- [ ] Orçamento de JSON inicial aprovado em `npm run performance:budget`.
- [ ] Fluxos de navegação, filtros, diárias, publicações e pessoal aprovados.

## Pacote

- [ ] Usar `dist/fiscaliza-varginha-painel.zip` gerado e aprovado.
- [ ] `npm run validate:deploy` aprovado, incluindo testes HTTP do pacote.
- [ ] ZIP contém os mesmos arquivos e bytes do diretório de preparação.
- [ ] Conformidade carrega `modules/transparencia.js` e preenche a matriz.
- [ ] Pessoal carrega `modules/pessoal.js` e a folha nominal.
- [ ] Fonte Inter e demais dependências estáticas estão presentes.
- [ ] Cache offline instala sem arquivos faltantes.
- [ ] `release.json` registra commit e hash do manifesto.
- [ ] Credenciais, logs, sessões e coletores estão fora do pacote.
- [ ] PDFs públicos estão incluídos; documentação interna está excluída.

## Após o upload

- [ ] Release e manifesto publicados correspondem ao pacote aprovado.
- [ ] HTTPS e `.htaccess` ativos.
- [ ] Páginas principais abrem sem erros de JavaScript ou arquivos 404.
- [ ] Chat e votação conferidos no ambiente PHP/Apache.
- [ ] Navegação móvel, teclado, contraste e conteúdo abaixo da dobra conferidos.
- [ ] Dados preservados não aparecem como coleta integralmente atualizada.
- [ ] Último pacote válido permanece disponível para rollback.

## Operação

Conferir `private/state/pipeline_last_result.json` para o último ciclo e `pipeline_last_success.json` para o último sucesso. O relatório operacional distingue ambos. WhatsApp só é cobrado como serviço ativo quando `envio_habilitado` estiver ligado.

Não tratar avisos de qualidade como prova de irregularidade. Solicitações a órgãos públicos e divulgação de conteúdo dependem de revisão das fontes e autorização para envio.
