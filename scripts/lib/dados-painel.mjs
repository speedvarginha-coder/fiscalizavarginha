// Projeção usada por páginas que não exibem a frota. Não resume contratos,
// valores, fornecedores ou cruzamentos: todos os outros campos são preservados.
export function prefeituraPainel(prefeitura) {
  const { frota, ...painel } = prefeitura;
  return painel;
}

// A frota é ~63% da base da Prefeitura. Separada num chunk próprio, a página
// da Prefeitura renderiza o resto primeiro e busca os veículos em segundo
// plano — sem perder nenhum campo.
export function prefeituraFrota(prefeitura) {
  return {
    schema_version: 1,
    fonte: "data/chunks/prefeitura.json",
    frota: Array.isArray(prefeitura?.frota) ? prefeitura.frota : [],
  };
}
