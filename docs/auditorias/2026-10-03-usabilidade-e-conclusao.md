# Usabilidade e continuidade das melhorias — 03/10/2026

## Escopo e método

Inspeção do site publicado em https://fiscalizavarginha.com.br/, com navegador real, página inicial, Prefeitura/contratos e Como cobrar. Verificação responsiva em 390 × 844, leitura da árvore de acessibilidade e busca sem resultado. Comparação pontual com o código local. Avaliação heurística, sem sessões com cidadãos e sem certificação completa de acessibilidade.

O plugin Sites solicitado oferece recursos de criação/hospedagem; a inspeção do site existente foi feita diretamente no navegador, sem migrar hospedagem.

## Achados priorizados

| Prioridade | Evidência observada | Efeito para o cidadão | Tratamento |
|---|---|---|---|
| Alta | Monitor externo confirmou HTTP 503 nos serviços PHP em verificações anteriores desta continuidade. Home estática funciona. | Assistente e serviço de avaliações podem falhar apesar da página abrir. | Monitor passou a testar PHP e integridade dos dados. Causa da hospedagem ainda não confirmada; tentativa de acessar hPanel falhou por conexão do navegador. |
| Alta | Início mostrou temporariamente valores zero antes de carregar a Prefeitura. Código usava soma de contratos como alternativa para valor pago. | Ausência de carregamento ou de pagamento informado podia parecer zero ou pagamento real. | Corrigido localmente: espera explícita pela base; pagamento ausente aparece como “Não informado”; zero confirmado permanece zero. |
| Alta | “Contratos vigentes”, com filtro 2026, mostrava contrato de 2022 e registros rescindidos/encerrados. O filtro considera sobreposição de períodos. | Pode parecer que todos foram assinados em 2026 ou continuam vigentes hoje. | Título alterado para “Contratos da Prefeitura”. Explicação vinculada ao seletor distingue período, situação e valor contratual de pagamento anual. Regra de seleção não foi alterada. |
| Média | No celular, abas da Prefeitura começavam a aproximadamente 2.277 px do topo; muitos resumos e avisos aparecem antes. | Exige várias rolagens antes de consultar contratos, diárias ou frota. | Pendente: aproximar abas e filtros do título, colocando explicações longas em expansores acessíveis. |
| Média | Home mobile tinha aproximadamente 9.166 px de altura após fechar a apresentação, com atalhos e blocos sobrepostos de navegação. | Dificulta reconhecer o próximo passo e encontrar conteúdo secundário. | Mapa por tema e comparação anual agora reutilizam expansores existentes: fechados no celular e abertos no computador. |
| Média | Todos os “Ver contratos” dos temas levavam à mesma lista geral, sem filtro temático. | Expectativa de abrir somente saúde, educação etc. não era atendida. | Rótulo corrigido para “Ver todos os contratos”. Filtro por tema no endereço permanece uma evolução futura. |
| Média | Título “Está melhorando ou piorando?” comparava ano fechado com ano em curso. | Sugere avaliação de desempenho que a comparação isolada não sustenta. | Título neutralizado para “Comparação entre períodos”. Aviso de períodos diferentes mantido. |
| Média | Resumo da Prefeitura indicou zero veículos enquanto a frota era carregada sob demanda. | Pode confundir dado não carregado com ausência de veículos. | Pendente: exibir estado de carregamento/indisponibilidade também nesse indicador. |

## Pontos positivos observados

- Busca contratual sem resultado oferece orientação e botão para limpar filtros; consulta acompanha a URL.
- Em 390 px, não foi observado transbordamento horizontal na home e na página de contratos.
- Menu principal reúne Prefeitura, Câmara, Salários, Emendas e Como cobrar.
- Contratos oferecem fonte oficial e avisos sobre lacunas da base.
- Como cobrar separa reclamação de serviço de pedido de informação e oferece modelos e links de protocolo. Nenhum pedido foi enviado nesta avaliação.

## Outras correções locais nesta continuidade

- Corte de mensagens PHP preserva caracteres UTF-8; falha de serialização recebe resposta de erro.
- Gravação intermediária de CNPJs conserva fornecedores e a data anterior; enriquecimento falho não substitui a base confirmada.
- Restauração contratual considera entidade e fornecedor, elimina duplicatas e fixa a revisão de origem.
- Hook mede o blob preparado no índice Git, inclusive nomes com espaços, independentemente do tamanho da cópia de trabalho.

## Verificação e situação

- 225 testes Python passaram antes do teste adicional do hook; esse teste também passou isoladamente.
- Suíte crítica posterior aprovada: 226 Python, 50 contratos Node e teste do monitor externo.
- Dois testes novos de navegador passaram: expansores mobile/desktop e pagamento não informado.
- Sintaxe JavaScript, sintaxe PHP, acentos, segurança e orçamento de desempenho aprovados.
- Coleta real iniciada sem publicação nem mensagens. A primeira tentativa encontrou restrição de permissão; a segunda avançou com acesso autorizado ao navegador instalado.
- Suíte completa de navegador e coleta ainda estavam em execução no momento deste registro. Commit, pacote e publicação devem ser registrados somente após sua conclusão efetiva.

As mudanças deste relatório são locais até comprovação de publicação. Não se deve apresentar o erro PHP como resolvido nem a coleta como completa antes dos resultados finais.
