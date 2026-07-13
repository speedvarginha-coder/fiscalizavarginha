# Rollback manual de uma publicação

Use este procedimento somente quando a validação ou o health check indicar falha após uma publicação.

1. Pare novas execuções da tarefa de atualização para evitar concorrência.
2. Localize o último pacote validado em `dist/painel-cidadao/` e confirme que `release.json` e `data/manifest.json` têm o mesmo hash.
3. Localize o último backup íntegro em `private/backups/coleta-*`. Não use diretórios `rejeitada-*` como origem sem revisão.
4. Restaure localmente apenas `painel-cidadao/data/`, `painel-cidadao/data.js` e `painel-cidadao/emendas/data/` a partir do backup escolhido.
5. Rode `npm run data:schema`, `python painel-cidadao/emendas/audit_emendas.py`, `npm run validate:data` e os testes aplicáveis.
6. Gere um novo pacote com `npm run deploy:zip` e valide-o com `npm run validate:deploy`.
7. Publique o pacote validado usando o procedimento FTPS configurado. O health check deve confirmar que o `release.json` e o `manifest.json` remotos são idênticos aos locais.
8. Registre no log a causa, o horário, o pacote restaurado e o resultado do health check.

Não faça rollback por exclusão manual de arquivos no servidor. O marcador `release.json` deve ser publicado por último para não expor uma versão parcialmente enviada.
