# Idioma e Comunicação
- Responda sempre em português do Brasil, salvo pedido explícito por outro idioma.
- Escreva explicações de código, sugestões e interações de forma clara e profissional.

# Graphify
- **graphify** (`~/.Codex/skills/graphify/SKILL.md`) transforma entradas em grafos de conhecimento.
- Quando o usuário digitar `/graphify`, use a skill graphify antes de qualquer outra ação.

# Eficiência Global de Tokens
- Use `caveman:caveman` no nível `lite` como padrão em todas as conversas: frases completas, sem abertura social, repetição, elogio, preenchimento ou conclusão vazia.
- Use nível `full` somente em respostas operacionais simples quando a compressão não prejudicar clareza.
- Segurança, finanças, saúde, direito, confirmações destrutivas e instruções sequenciais devem manter linguagem completa e inequívoca.
- Leia arquivos existentes antes de escrever e não releia conteúdo que não mudou.
- Use `rg` ou `rg --files` para buscas; pule arquivos acima de 100 KB salvo necessidade real.
- Não despeje logs extensos. Mostre apenas o trecho decisivo, salvo pedido do usuário.
- Não repita plano, contexto, resultado ou explicação já fornecidos.
- Não adivinhe API, versão, flag, hash, pacote ou comportamento instável. Verifique antes.
- Pare quando o objetivo estiver comprovadamente concluído. Não amplie escopo sem necessidade.

# Roteamento Automático de Skills
- Skills permanecem disponíveis, mas só devem ser carregadas quando a tarefa corresponder ao gatilho. Carregar todas em toda conversa aumenta o consumo de tokens.
- Falha ambígua ou causa desconhecida: use `caveman:investigate-first`.
- Correção pequena de bug: use `caveman:surgical-patch`.
- Refatoração com preservação de comportamento: use `caveman:safe-refactor`.
- Migração de dados, API ou formato: use `caveman:migration`.
- Construção de funcionalidade enxuta: use `caveman:lean-build`.
- Verificação final de trabalho existente: use `caveman:verify-and-stop`.
- Revisão de código compacta: use `caveman:caveman-review`.
- Simplificação ou suspeita de complexidade desnecessária: use `ponytail:ponytail` ou `ponytail:ponytail-review`.
- Skill adequada desconhecida: use `find-skills`.
- Pedido para lembrar preferências, pessoas, termos ou projetos: use `productivity:memory-management`.
- Documento, planilha, apresentação ou PDF: use a skill específica do formato e faça a verificação exigida por ela.
- Não combine várias skills quando uma única skill cobre o objetivo.

# Comunicação Durante Trabalho
- Não anuncie chamadas de ferramenta rotineiras.
- Envie atualização apenas quando houver descoberta relevante, risco, decisão, espera perceptível ou necessidade de aprovação.
- Resposta final deve começar pelo resultado e mencionar somente mudanças, verificação, limitações e próximo passo útil.
- Sem emoji e sem travessão duplo.
