/* Fiscaliza Varginha — modules/glossario.js
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
    "empenho":           { simples: "Reserva de dinheiro", explica: "Compromisso formal de que a Prefeitura vai gastar aquele valor.", aliases: ["empenhado", "empenhos"] },
    "liquidacao":        { simples: "Conferência da entrega", explica: "Etapa em que a Prefeitura confirma que o serviço foi prestado ou o produto entregue.", aliases: ["liquidação", "liquidado", "liquidações"] },
    "pagamento":         { simples: "Pagamento",           explica: "Saída efetiva do dinheiro público depois das etapas de empenho e liquidação.", aliases: ["pago", "pagamentos"] },
    "modalidade":        { simples: "Tipo de compra",      explica: "Como a Prefeitura comprou: pregão, dispensa, concorrência, inexigibilidade etc." },
    "dispensa de licitação": { simples: "Dispensa de licitação", explica: "Compra sem disputa ampla. Pode ser legal, mas exige justificativa, preço compatível e documento público.", aliases: ["dispensa", "dispensa de licitacao"] },
    "inexigibilidade":   { simples: "Inexigibilidade",     explica: "Contratação sem competição quando não há concorrência viável, como fornecedor exclusivo ou artista. Precisa de justificativa formal." },
    "pregão":            { simples: "Pregão",              explica: "Licitação usada para bens e serviços comuns, geralmente com disputa de preço.", aliases: ["pregao"] },
    "concorrência":      { simples: "Concorrência",        explica: "Modalidade de licitação usada para contratações mais complexas ou de maior porte.", aliases: ["concorrencia"] },
    "homologação":       { simples: "Homologação",         explica: "Ato que confirma o resultado da licitação e autoriza a contratação.", aliases: ["homologacao", "homologado"] },
    "aditivo":           { simples: "Aditivo",             explica: "Alteração no contrato, como prazo, valor ou objeto. Deve ter justificativa e publicação.", aliases: ["aditivos", "termo aditivo"] },
    "termo de referência": { simples: "Termo de referência", explica: "Documento que explica o que será comprado, por quê, quais requisitos e como o preço foi estimado.", aliases: ["termo de referencia"] },
    "nota fiscal":       { simples: "Nota fiscal",         explica: "Documento emitido pelo fornecedor para comprovar cobrança por produto ou serviço entregue.", aliases: ["notas fiscais"] },
    "fiscal do contrato": { simples: "Fiscal do contrato", explica: "Servidor responsável por acompanhar se o contrato foi cumprido e se a entrega aconteceu." },
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
    "diária":            { simples: "Diária",              explica: "Valor para custear viagem oficial. Não é salário extra; precisa de finalidade pública e prestação de contas.", aliases: ["diarias", "diárias"] },
    "verba indenizatória": { simples: "Verba indenizatória", explica: "Ressarcimento de despesa ligada ao mandato ou serviço público. Deve ter regra, comprovante e publicidade.", aliases: ["verba indenizatoria"] },
    "subsidio":          { simples: "Subsídio",            explica: "Remuneração bruta fixada em lei para agentes políticos, como vereadores.", aliases: ["subsídio"] },
  };
  const glossarioLookup = new Map();
  Object.keys(GLOSSARIO).forEach(function (key) {
    const item = GLOSSARIO[key];
    [key].concat(item.aliases || []).forEach(function (alias) {
      glossarioLookup.set(norm(alias), item);
    });
  });
  const buscarTermo = function (termo) {
    return glossarioLookup.get(norm(termo));
  };
  // Expor publicamente para uso por outras partes do código
  window.ZELA = window.ZELA || {};
  window.ZELA.glossario = GLOSSARIO;
  window.ZELA.simplificarTermo = function (termo) {
    if (!termo) return termo;
    const dic = buscarTermo(termo);
    return (dic && dic.simples) || termo;
  };
  // Envolve um termo num span com tooltip explicativo (uso opcional em templates)
  window.ZELA.termoCidadao = function (termo, opts) {
    opts = opts || {};
    const dic = buscarTermo(termo);
    if (!dic) return esc(termo);
    const txt = opts.usarTecnico ? termo : dic.simples;
    return `<span class="glossario-termo" tabindex="0" data-explica="${esc(dic.explica)}" aria-label="${esc(txt + ": " + dic.explica)}">${esc(txt)}</span>`;
  };

  const termosContextuais = [];
  Object.keys(GLOSSARIO).forEach(function (key) {
    const item = GLOSSARIO[key];
    [key].concat(item.aliases || []).forEach(function (termo) {
      if (String(termo).length >= 5) termosContextuais.push({ termo: termo, item: item });
    });
  });
  termosContextuais.sort(function (a, b) { return b.termo.length - a.termo.length; });

  const escapeRegExp = function (s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };
  const termosRegex = termosContextuais.map(function (t) {
    return {
      termo: t.termo,
      item: t.item,
      re: new RegExp("(^|[^\\p{L}\\p{N}_])(" + escapeRegExp(t.termo) + ")(?=$|[^\\p{L}\\p{N}_])", "iu"),
    };
  });
  const deveIgnorar = function (node) {
    const el = node.parentElement;
    return !el || !!el.closest("script,style,textarea,input,select,option,a,button,.glossario-termo,.no-glossario");
  };
  const criarSpan = function (texto, item) {
    const span = document.createElement("span");
    span.className = "glossario-termo";
    span.tabIndex = 0;
    span.dataset.explica = item.explica;
    span.setAttribute("aria-label", texto + ": " + item.explica);
    span.textContent = texto;
    return span;
  };
  const enriquecerTexto = function (node) {
    if (deveIgnorar(node)) return;
    let texto = node.nodeValue || "";
    if (texto.trim().length < 5) return;
    const frag = document.createDocumentFragment();
    let alterou = false;
    let guard = 0;
    while (texto && guard < 4) {
      guard += 1;
      let melhor = null;
      termosRegex.forEach(function (cfg) {
        const m = texto.match(cfg.re);
        if (!m) return;
        const inicio = m.index + (m[1] || "").length;
        if (!melhor || inicio < melhor.inicio || (inicio === melhor.inicio && m[2].length > melhor.hit.length)) {
          melhor = { cfg: cfg, match: m, inicio: inicio, hit: m[2] };
        }
      });
      if (!melhor) break;
      const prefixo = melhor.match[1] || "";
      if (melhor.inicio > 0) frag.appendChild(document.createTextNode(texto.slice(0, melhor.inicio)));
      frag.appendChild(criarSpan(melhor.hit, melhor.cfg.item));
      texto = texto.slice(melhor.inicio + melhor.hit.length);
      alterou = true;
      if (prefixo && !frag.lastChild) frag.appendChild(document.createTextNode(prefixo));
    }
    if (!alterou) return;
    if (texto) frag.appendChild(document.createTextNode(texto));
    node.parentNode.replaceChild(frag, node);
  };
  let enriquecendo = false;
  window.ZELA.enriquecerGlossario = function (root) {
    const alvo = root && root.nodeType ? root : document.body;
    if (!alvo || enriquecendo) return;
    enriquecendo = true;
    try {
      const walker = document.createTreeWalker(alvo, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          if (deveIgnorar(node)) return NodeFilter.FILTER_REJECT;
          return /\S/.test(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(enriquecerTexto);
    } finally {
      enriquecendo = false;
    }
  };
  let agendado = false;
  const agendar = function () {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(function () {
      agendado = false;
      window.ZELA.enriquecerGlossario(document.getElementById("conteudo") || document.body);
    });
  };
  window.addEventListener("zela:ready", agendar);
  document.addEventListener("DOMContentLoaded", agendar);
  const observer = new MutationObserver(function (mutations) {
    if (enriquecendo) return;
    if (mutations.some(function (m) { return m.addedNodes && m.addedNodes.length; })) agendar();
  });
  document.addEventListener("DOMContentLoaded", function () {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  });

})();
