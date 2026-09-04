// Projeção usada por páginas que não exibem a frota. Não resume contratos,
// valores, fornecedores ou cruzamentos: todos os outros campos são preservados.
export function prefeituraPainel(prefeitura) {
  const { frota, ...painel } = prefeitura;
  return painel;
}
