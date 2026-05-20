/* Zela Varginha — modules/glossario.js
 *
 * Glossário cidadão — traduz jargão técnico em linguagem comum.
 *
 * Disponível em window.ZELA.glossario.
 * Carregado pelo data-loader.js (depois de utils.js, antes de app.js).
 *
 * Dependências externas:
 *   - window.ZELA.utils.* (esc, jsSafe, norm — conforme uso interno)
 */
(function () {
  "use strict";
  window.ZELA = window.ZELA || {};
  // Aliases das utilidades. utils.js DEVE ser carregado antes.
  const u = window.ZELA.utils;
  if (!u) {
    console.error("[glossario] window.ZELA.utils ausente. Carregue modules/utils.js primeiro.");
    return;
  }
  const esc = u.esc, jsSafe = u.jsSafe, norm = u.norm;

  // ============= GLOSSÁRIO CIDADÃO =============
  // Traduz jargão técnico do portal de transparência em linguagem comum.
  const GLOSSARIO = {
    "favorecido":        { simples: "Quem recebeu",        explica: "A pessoa ou empresa que recebeu o dinheiro público." },
    "beneficiario":      { simples: "Quem recebeu",        explica: "A entidade ou pessoa beneficiada pela emenda." },
    "credor":            { simples: "Quem recebeu",        explica: "Pessoa ou empresa a quem a Prefeitura deve ou já pagou." },
    "valor liquidado":   { simples: "Valor Pago",          explica: "Dinheiro que já foi efetivamente conferido e pago pela Prefeitura." },
    "valor empenhado":   { simples: "Valor Reservado",     explica: "Dinheiro que foi separado no orçamento, mas ainda não foi pago." },
    "empenho":           { simples: "Reserva de dinheiro", explica: "Compromisso formal de que a Prefeitura vai gastar aquele valor." },
    "liquidacao":        { simples: "Conferência da entrega", explica: "Etapa em que a Prefeitura confirma que o serviço foi prestado ou o produto entregue." },
    "modalidade":        { simples: "Tipo de compra",      explica: "Como a Prefeitura comprou (pregão, dispensa, concorrência, etc.)." },
    "vigência":          { simples: "Período",             explica: "Prazo em que o contrato está em vigor." },
    "dotacao":           { simples: "Verba prevista",      explica: "Valor reservado no orçamento para uma determinada despesa." },
    "orgao":             { simples: "Secretaria",          explica: "Setor da Prefeitura responsável pela despesa." },
    "unidade gestora":   { simples: "Setor responsável",   explica: "Departamento que administra os recursos." },
    "contratado":        { simples: "Empresa contratada",  explica: "Empresa que assinou contrato com a Prefeitura." },
    "objeto":            { simples: "O que foi contratado", explica: "Descrição do bem, serviço ou obra contratada." },
    "data_assinatura":   { simples: "Início do contrato",  explica: "Dia em que o contrato foi assinado." },
    "data_fim":          { simples: "Fim do contrato",     explica: "Dia em que o contrato termina." },
    "emenda impositiva": { simples: "Emenda impositiva",   explica: "Verba que cada vereador pode destinar a entidades, obras ou serviços — execução obrigatória pela Prefeitura." },
    "cnpj":              { simples: "CNPJ",                explica: "Número de identificação da empresa na Receita Federal." },
    "situação":          { simples: "Situação",            explica: "Status atual do contrato: ativo, encerrado, suspenso." },
  };
  // Expor publicamente para uso por outras partes do código
  window.ZELA = window.ZELA || {};
  window.ZELA.glossario = GLOSSARIO;
  window.ZELA.simplificarTermo = function (termo) {
    if (!termo) return termo;
    const key = String(termo).toLowerCase().trim();
    return (GLOSSARIO[key] && GLOSSARIO[key].simples) || termo;
  };
  // Envolve um termo num span com tooltip explicativo (uso opcional em templates)
  window.ZELA.termoCidadao = function (termo, opts) {
    opts = opts || {};
    const key = String(termo).toLowerCase().trim();
    const dic = GLOSSARIO[key];
    if (!dic) return esc(termo);
    const txt = opts.usarTecnico ? termo : dic.simples;
    return `<span class="glossario-termo" tabindex="0" data-explica="${esc(dic.explica)}">${esc(txt)}</span>`;
  };


})();
