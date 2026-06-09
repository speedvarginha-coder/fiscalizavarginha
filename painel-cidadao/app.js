/* Fiscaliza Varginha - Painel Cidadão (multi-página).
   Cada página HTML tem `<body data-page="...">` e contém apenas os
   elementos da sua seção. Este script renderiza somente os blocos cujos
   IDs existem no DOM, então o mesmo arquivo serve index.html,
   prefeitura.html, camara.html e cobrar.html sem duplicar lógica. */
(function () {
  "use strict";
  try {

  // ============================================================
  // SHIMS DEFENSIVOS — toleram módulo ausente (cache antigo, fetch falho, etc.)
  // App continua funcionando mesmo se algum module.js não carregou,
  // só sem o recurso específico. Evita TypeError fatal por window.ZELA.X.
  // ============================================================
  window.ZELA = window.ZELA || {};
  if (!window.ZELA.icon) window.ZELA.icon = function () { return ""; };
  if (!window.ZELA.simplificarTermo) window.ZELA.simplificarTermo = function (t) { return t; };
  if (!window.ZELA.termoCidadao) window.ZELA.termoCidadao = function (t) { return String(t || ""); };
  if (!window.ZELA.classificarItem) window.ZELA.classificarItem = function () { return null; };
  if (!window.ZELA.categorias) window.ZELA.categorias = [];
  if (!window.ZELA.watchlist) {
    window.ZELA.watchlist = {
      obter: function () { return { contratos: [], emendas: [] }; },
      has:    function () { return false; },
      toggle: function () { return false; },
      botao:  function () { return ""; },
    };
  }
  if (!window.ZELA.dossie) {
    window.ZELA.dossie = {
      criarModal:       function () { return null; },
      abrirComHtml:     function () { alert("Módulo de dossiê não carregou."); },
      templateEmenda:   function () { return ""; },
      templateDiaria:   function () { return ""; },
      templateContrato: function () { return ""; },
      gerarTxtContrato: function () { alert("Módulo de dossiê não carregou."); },
    };
  }
  if (!window.ZELA.dashboard) {
    window.ZELA.dashboard = {
      renderPlacarPrefeitura:     function () {},
      renderCategoriasPrefeitura: function () {},
      renderPlacarCamara:         function () {},
      renderCategoriasCamara:     function () {},
    };
  }
  if (!window.ZELA.relatorios) {
    window.ZELA.relatorios = {
      renderTimelineSinais:  function () {},
      detectarFragmentacao:  function () {},
      renderComparativoAnos: function () {},
      renderTodos:           function () {},
    };
  }
  if (!window.ZELA.diarias) {
    window.ZELA.diarias = {
      init:                    function () {},
      abrirFiscalizacaoDiaria: function () {},
    };
  }
  if (!window.ZELA.atualizacoes) {
    window.ZELA.atualizacoes = {
      init:          function () {},
      render:        function () {},
      copiarLAI:     function () {},
      copiarNumero:  function () {},
    };
  }
  // utils.js é crítico — sem ele, app.js não funciona (destructuring abaixo)
  if (!window.ZELA.utils) {
    console.error("[app.js] CRÍTICO: modules/utils.js não carregou. Mostrando erro ao usuário.");
    document.body.innerHTML =
      '<div style="padding:60px;text-align:center;font-family:sans-serif;">' +
      '<h2>Módulos não carregados</h2>' +
      '<p>O painel precisa ser servido via HTTP (não direto do file://).</p>' +
      '<p><strong>Solução:</strong> rode <code style="background:#eee;padding:2px 6px;border-radius:3px">python -m http.server 8000</code> ' +
      'na pasta do painel e abra <code>http://localhost:8000</code></p></div>';
    return;
  }

  if (!window.ZELA_DATA) {
    document.body.innerHTML =
      '<div style="padding:60px;text-align:center;font-family:sans-serif;">' +
      '<h2>Dados não carregados</h2>' +
      '<p>Execute <code>python coletor.py</code> antes de abrir o painel.</p></div>';
    return;
  }

  const D    = window.ZELA_DATA;
  const pf   = D.prefeitura || {};
  const PAGE = document.body.dataset.page || "hub";
  const $    = (id) => document.getElementById(id);

  // ============= UTILS (extraídos para modules/utils.js) =============
  // Aliases locais para retrocompatibilidade. Definições reais em window.ZELA.utils.
  const { fmtBRL, fmtBRLnb, fmtMi, fmtNum, cleanText, esc, jsSafe, scrollToEl, norm, highlight, exportCSV } = window.ZELA.utils;




  const confidenceInfo = (nivel) => {
    const n = norm(nivel);
    if (["forte", "alta", "encontrado"].includes(n)) {
      return { cls: "confidence--strong", label: "Cruzamento forte", text: "Mesmo CNPJ ou termos específicos suficientes para conferir direto na fonte." };
    }
    if (["pista", "media", "medio"].includes(n)) {
      return { cls: "confidence--clue", label: "Pista para conferir", text: "Indício por contexto ou palavra-chave. Não deve ser tratado como conclusão." };
    }
    if (["nao_cruzar", "não cruzar", "fraca", "baixa"].includes(n)) {
      return { cls: "confidence--avoid", label: "Não cruzar sozinho", text: "Tema genérico ou sem relação direta suficiente. Precisa de documento antes de qualquer leitura." };
    }
    return { cls: "confidence--neutral", label: "Sem conferência automática", text: "O painel não encontrou elementos suficientes para cruzamento automático." };
  };
  const confidenceBadge = (nivel) => {
    const c = confidenceInfo(nivel);
    return `<span class="confidence-badge ${c.cls}" title="${esc(c.text)}">${esc(c.label)}</span>`;
  };

  const cnpjRoot = (s) => ((s || "").match(/\d/g) || []).join("").slice(0, 8);
  const hasAny   = (text, terms) => terms.some(t => norm(text).includes(norm(t)));
  const pageTitle = () => (document.title || "Fiscaliza Varginha").replace(/\s+[·-]\s+.*/, "").trim();
  const baseHref = () => location.href.replace(/[#].*$/, "").replace(/[^/\\]+$/, "");
  const anoCamara = () => $("filtroAnoCamara")?.value || "2025";
  const camaraAno = () => {
    const ano = anoCamara();
    return (D.camara_anos && D.camara_anos[ano]) || {
      resumo: D.resumo || {},
      vereadores: D.vereadores || [],
      emendas: D.emendas || [],
      materias: [],
    };
  };
  const camResumo = () => camaraAno().resumo || D.resumo || {};
  const camVereadores = () => camaraAno().vereadores || D.vereadores || [];
  const camEmendas = () => camaraAno().emendas || D.emendas || [];
  const camMaterias = () => camaraAno().materias || [];

  // ============= "ATUALIZADO EM" + aviso de dados desatualizados =============
  const upd = D.atualizado_em || {};

  const diasDesdeColeta = () => {
    if (!upd.iso) return null;
    const dias = Math.floor((Date.now() - new Date(upd.iso).getTime()) / 86_400_000);
    return Number.isFinite(dias) ? dias : null;
  };
  const dataTrustSeal = (tipo, opts = {}) => {
    const perfis = {
      contrato: {
        fonte: "Betha/portal oficial",
        escopo: "contrato estruturado",
        risco: "não comprova entrega sozinho",
        acao: "conferir fiscal, nota e execução",
        tone: "ok",
      },
      fornecedor: {
        fonte: "despesas Betha",
        escopo: "ranking por pagamentos",
        risco: "contrato pode não estar vinculado",
        acao: "abrir dossiê e cobrar documentos",
        tone: "warn",
      },
      emenda: {
        fonte: "emendas + cruzamento por CNPJ",
        escopo: "execução parcial",
        risco: "pagamento ao CNPJ não prova objeto",
        acao: "pedir plano, empenho e notas",
        tone: "warn",
      },
      diaria: {
        fonte: "portal de diárias",
        escopo: "valor estruturado",
        risco: "não comprova resultado da viagem",
        acao: "conferir autorização e prestação de contas",
        tone: "ok",
      },
      remuneracao: {
        fonte: "lei oficial + folha",
        escopo: "folha nominal parcial",
        risco: "competência mensal pode faltar",
        acao: "conferir descontos e verbas",
        tone: "warn",
      },
      palavra: {
        fonte: "triagem por palavra-chave",
        escopo: "resultado classificado",
        risco: "termo parecido pode confundir",
        acao: "abrir a fonte antes de concluir",
        tone: "warn",
      },
    };
    const p = { ...(perfis[tipo] || perfis.palavra), ...opts };
    const dias = diasDesdeColeta();
    const frescor = dias == null
      ? "coleta sem data"
      : dias <= 7 ? `coleta recente (${dias}d)`
      : dias <= 21 ? `coleta em atenção (${dias}d)`
      : `coleta defasada (${dias}d)`;
    const tone = p.tone || (dias != null && dias > 21 ? "warn" : "ok");
    const chips = [
      ["Fonte", p.fonte],
      ["Atualização", frescor],
      ["Escopo", p.escopo],
      ["Cuidado", p.risco],
      ["Próximo passo", p.acao],
    ].filter(([, v]) => v);
    return `<div class="data-trust data-trust--${esc(tone)}">
      <strong>Selo de confiança do dado</strong>
      <div class="data-trust__chips">
        ${chips.map(([k, v]) => `<span><b>${esc(k)}:</b> ${esc(v)}</span>`).join("")}
      </div>
    </div>`;
  };
  window.ZELA.dataTrustSeal = dataTrustSeal;

  // Helper público para gerar carimbo "coletado há X dias"
  window.ZELA.carimboColeta = function () {
    if (!upd.iso) return "";
    const dias = Math.floor((Date.now() - new Date(upd.iso).getTime()) / 86_400_000);
    let texto, cls;
    if (dias <= 7)       { texto = dias === 0 ? "Coletado hoje" : `Há ${dias}d`;          cls = "fresh"; }
    else if (dias <= 21) { texto = `Há ${dias} dias`;                                    cls = "okay";  }
    else                 { texto = `Há ${dias}d · pode estar desatualizado`;             cls = "stale"; }
    return `<span class="carimbo-coleta carimbo-coleta--${cls}" title="Última coleta: ${esc(cleanText(upd.data_humana || ""))}">${window.ZELA.icon ? window.ZELA.icon("sinal", { size: 13 }) : ""} ${texto}</span>`;
  };
  // Carimbo de frescor no cabeçalho de toda página
  if ($("atualizado")) {
    if (upd.data_humana) {
      $("atualizado").innerHTML =
        "Dados atualizados em " + esc(cleanText(upd.data_humana)) + " " + window.ZELA.carimboColeta();
    } else {
      $("atualizado").textContent = "";
    }
  }
  if (upd.iso) {
    const diasDesde = Math.floor((Date.now() - new Date(upd.iso).getTime()) / 86_400_000);
    if (diasDesde >= 30) {
      const banner = document.createElement("div");
      banner.className = "stale-banner";
      banner.innerHTML = `<strong>Dados com ${diasDesde} dias.</strong> Execute o coletor para atualizar antes de fiscalizar.
        <button type="button" onclick="this.parentElement.remove()" aria-label="Fechar aviso">✕</button>`;
      const main = document.getElementById("conteudo") || document.querySelector("main");
      if (main) main.insertAdjacentElement("beforebegin", banner);
    }
  }

  // ============= HUB (index.html) - preview cards =============
  if ($("hubPrefFeatures")) {
    $("hubPrefFeatures").innerHTML = [
      `<li><strong>${fmtMi(pf.total_externo_atual || 0)}</strong> pago a fornecedores externos em ${pf.ano_atual || ""}</li>`,
      `<li><strong>${(pf.contratos || []).length}</strong> contratos vigentes</li>`,
      `<li><strong>${(pf.licit_andamento || []).length}</strong> licitações em andamento</li>`,
      `<li>Diário Oficial - últimas 24 edições</li>`,
    ].join("");
  }
  if ($("hubCamFeatures")) {
    const r = D.resumo || {};
    $("hubCamFeatures").innerHTML = [
      `<li><strong>${fmtNum(r.total_materias || 0)}</strong> matérias legislativas em 2025</li>`,
      `<li><strong>${fmtNum(r.emendas_qtd || 0)}</strong> emendas (${fmtMi(r.emendas_valor_total_brl || 0)})</li>`,
      `<li>Cruzamento promessa - pagamento por CNPJ</li>`,
      `<li>${fmtNum(r.vereadores_ativos || 0)} vereadores em atividade</li>`,
    ].join("");
  }
  if ($("hubReportFeatures")) {
    const cs = pf.stats_cruzamento || {};
    const contratosAltos = (pf.contratos || []).filter(c => (c.valor || 0) >= 1_000_000).length;
    const pncpResumo = (D.pncp || {}).resumo || {};
    $("hubReportFeatures").innerHTML = [
      `<li><strong>${fmtNum((cs.sem_pagamento || 0) + (cs.sem_cnpj || 0))}</strong> emendas para conferir</li>`,
      `<li><strong>${fmtNum(contratosAltos)}</strong> contratos acima de R$ 1 mi</li>`,
      `<li><strong>${fmtNum((pf.licit_andamento || []).length)}</strong> licitações abertas/em andamento</li>`,
      `<li><strong>${fmtNum((pncpResumo.compras_qtd || 0) + (pncpResumo.contratos_qtd || 0))}</strong> registros no PNCP</li>`,
    ].join("");
  }

  if ($("homeOpsStats")) {
    const contratos = pf.contratos || [];
    const licitacoes = pf.licit_andamento || [];
    const diariasPref = (D.diarias || {}).prefeitura || [];
    const resumoCam = D.resumo || {};
    const emendas = D.emendas || [];
    const emendasPendentes = emendas.filter(e => e.status === "sem_pagamento" || e.status === "sem_cnpj").length;
    const contratosMilhao = contratos.filter(c => Number(c.valor || 0) >= 1_000_000).length;
    const totalContratos = contratos.reduce((s, c) => s + Number(c.valor || 0), 0);
    const totalDiarias = diariasPref.reduce((s, d) => s + Number(d.valor_total || 0), 0);

    $("homeOpsStats").innerHTML = [
      { href: "prefeitura.html", value: fmtMi(pf.total_externo_atual || totalContratos), label: `pagos em ${pf.ano_atual || "ano atual"}`, title: "Prefeitura" },
      { href: "prefeitura.html?tab=contratos", value: fmtNum(contratos.length), label: `${fmtNum(contratosMilhao)} acima de R$ 1 mi`, title: "Contratos" },
      { href: "prefeitura.html?tab=diarias", value: fmtNum(diariasPref.length), label: `${fmtBRL(totalDiarias)} em diárias`, title: "Diárias" },
      { href: "camara.html", value: fmtNum(resumoCam.total_materias || 0), label: `${fmtNum(resumoCam.vereadores_ativos || 0)} vereadores monitorados`, title: "Camara" },
      { href: "camara.html", value: fmtNum(resumoCam.emendas_qtd || 0), label: `${fmtNum(emendasPendentes)} para conferir`, title: "Emendas" },
      { href: "prefeitura.html?tab=licitacoes", value: fmtNum(licitacoes.length), label: "acompanhar antes do gasto", title: "Licitacoes" },
    ].map(item => `
      <a href="${item.href}" class="home-stat">
        <span>${item.title}</span>
        <strong>${item.value}</strong>
        <small>${item.label}</small>
      </a>`).join("");

    $("homeOpsPriorities").innerHTML = [
      { href: "prefeitura.html?tab=contratos", n: "1", title: "Contratos de alto valor", text: `${fmtNum(contratosMilhao)} contratos acima de R$ 1 milhão para ler primeiro.` },
      { href: "prefeitura.html?tab=diarias", n: "2", title: "Diárias e viagens", text: `${fmtNum(diariasPref.length)} registros com pessoa, finalidade e valor.` },
      { href: "camara.html", n: "3", title: "Emendas parlamentares", text: `${fmtNum(resumoCam.emendas_qtd || 0)} emendas; confira CNPJ, objeto e pagamento.` },
    ].map(item => `
      <a href="${item.href}" class="priority-row">
        <span>${item.n}</span>
        <strong>${item.title}</strong>
        <small>${item.text}</small>
      </a>`).join("");

    if ($("homeOpsFreshness")) {
      const atualizado = (D.atualizado_em || {}).data_humana;
      $("homeOpsFreshness").textContent = atualizado
        ? `Base atualizada em ${cleanText(atualizado)}`
        : "Base local carregada no navegador";
    }
  }

  // ============= STATS (camara.html) =============
  if ($("stats") && D.resumo && PAGE !== "camara") {
    const r = D.resumo;
    const tipos = r.tipos || [];
    $("stats").innerHTML = [
      { cls: "stat--navy", v: fmtNum(r.total_materias),
        l: "Matérias legislativas", s: "Total protocolado em 2025" },
      { cls: "stat--teal", v: fmtNum((tipos.find(t => norm(t.tipo) === "indicacao") || {}).qtd || 0),
        l: "Indicações ao Executivo", s: "Demandas vindas dos bairros" },
      { cls: "stat--gold", v: fmtMi(r.emendas_valor_total_brl),
        l: "Emendas impositivas", s: r.emendas_qtd + " emendas em 2025" },
      { cls: "stat--teal", v: fmtNum((tipos.find(t => norm(t.tipo) === "mocao") || {}).qtd || 0),
        l: "Moções e homenagens", s: "Aplausos, pesar e reconhecimento" },
      { cls: "stat--navy", v: r.vereadores_ativos,
        l: "Vereadores em atividade", s: "Câmara Municipal" },
    ].map(s => `
      <div class="stat ${s.cls}">
        <div class="stat__value">${s.v}</div>
        <div class="stat__label">${s.l}</div>
        <div class="stat__sub">${s.s}</div>
      </div>`).join("");
  }
  if ($("destaque") && D.resumo) {
    const r = D.resumo;
    $("destaque").innerHTML =
      `As ${r.emendas_qtd} emendas impositivas movimentaram <strong>${fmtBRLnb(r.emendas_valor_total_brl)}</strong> ` +
      `- média de ${fmtBRLnb(r.emendas_valor_total_brl / r.emendas_qtd)} por emenda - ` +
      `direcionados a entidades sociais, saúde, educação e infraestrutura urbana de Varginha.`;
  }

  const renderStatsCamara = () => {
    if (!$("stats")) return;
    const r = camResumo();
    const ano = anoCamara();
    const tipos = r.tipos || [];
    $("stats").innerHTML = [
      { cls: "stat--navy", v: fmtNum(r.total_materias),
        l: "Matérias legislativas", s: `Total protocolado em ${ano}` },
      { cls: "stat--teal", v: fmtNum((tipos.find(t => norm(t.tipo) === "indicacao") || {}).qtd || 0),
        l: "Indicações ao Executivo", s: "Demandas vindas dos bairros" },
      { cls: "stat--gold", v: fmtMi(r.emendas_valor_total_brl || 0),
        l: "Emendas impositivas", s: `${fmtNum(r.emendas_qtd || 0)} emendas em ${ano}` },
      { cls: "stat--teal", v: fmtNum((tipos.find(t => norm(t.tipo) === "mocao") || {}).qtd || 0),
        l: "Moções e homenagens", s: "Aplausos, pesar e reconhecimento" },
      { cls: "stat--gold", v: fmtNum(r.impacto_zero_qtd || 0),
        l: "Impacto zero no ranking", s: "Moção, homenagem e nome de rua" },
      { cls: "stat--navy", v: r.vereadores_ativos,
        l: "Vereadores em atividade", s: "Câmara Municipal" },
    ].map(s => `
      <div class="stat ${s.cls}">
        <div class="stat__value">${s.v}</div>
        <div class="stat__label">${s.l}</div>
        <div class="stat__sub">${s.s}</div>
      </div>`).join("");
  };

  const renderDestaqueCamara = () => {
    if (!$("destaque")) return;
    const r = camResumo();
    const ano = anoCamara();
    const media = r.emendas_qtd ? (r.emendas_valor_total_brl || 0) / r.emendas_qtd : 0;
    if (r.emendas_qtd) {
      $("destaque").innerHTML =
        `Em ${ano}, as ${fmtNum(r.emendas_qtd)} emendas impositivas estruturadas movimentaram <strong>${fmtBRLnb(r.emendas_valor_total_brl || 0)}</strong> ` +
        `- média de ${fmtBRLnb(media)} por emenda. No ranking, moções, homenagens e nomes de rua ficam separados com peso zero.`;
    } else {
      $("destaque").innerHTML =
        `Em ${ano}, o painel encontrou <strong>${fmtNum(r.total_materias || 0)} matérias legislativas</strong>, mas ainda não encontrou uma base estruturada de emendas impositivas com entidade, CNPJ, valor e objeto. ` +
        `Isso não é falta de atuação: é falta de base completa para cruzar dinheiro público com execução. Use 2025 para analisar emendas e 2026 para acompanhar indicações, requerimentos e projetos.`;
    }
  };

  renderStatsCamara();
  renderDestaqueCamara();

  // Chips de ano no bloco "O ano em números" — controlam filtroAnoCamara
  document.querySelectorAll(".ano-chip[data-ano]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var ano = btn.dataset.ano;
      document.querySelectorAll(".ano-chip").forEach(function (b) {
        b.classList.toggle("ano-chip--active", b.dataset.ano === ano);
      });
      // Sincroniza o select de ano (que dispara o change event completo)
      var sel = $("filtroAnoCamara");
      if (sel && sel.value !== ano) {
        sel.value = ano;
        sel.dispatchEvent(new Event("change"));
      }
    });
  });

  function initGastosPalavraCamara() {
    const box = $("gastosPalavraChaveCamara");
    if (!box) return;

    const categoriasCamara = [
      { nome: "Cafe", termos: ["cafe", "cafe torrado", "cafe em po", "cafe da manha"] },
      { nome: "Alimentacao", termos: ["alimentacao", "refeicao", "marmitex", "marmita", "almoco", "jantar", "generos alimenticios"] },
      { nome: "Lanche", termos: ["lanche", "salgado", "salgados", "bolo", "biscoito", "suco", "refrigerante", "kit lanche"] },
      { nome: "Combustivel", termos: ["combustivel", "gasolina", "etanol", "diesel", "oleo diesel", "posto"] },
      { nome: "Diárias", termos: ["diaria", "diarias", "viagem", "deslocamento"] },
      { nome: "Cotas/verba indenizatória", termos: ["cota", "verba indenizatória", "ressarcimento", "indenizatoria"] },
      { nome: "Passagens e hospedagem", termos: ["passagem", "passagens", "hospedagem", "hotel", "aereo", "rodoviario"] },
      { nome: "Aluguel de veiculos", termos: ["locacao de veiculo", "aluguel de veiculo", "veiculo locado", "frota locada"] },
      { nome: "Aluguel de imoveis", termos: ["locacao de imovel", "aluguel de imovel", "locacao de predio", "sala comercial"] },
      { nome: "Publicidade e comunicacao", termos: ["publicidade", "propaganda", "comunicacao", "divulgacao", "midia", "imprensa"] },
      { nome: "Material de escritorio", termos: ["material de escritorio", "papelaria", "papel sulfite", "caneta", "toner", "cartucho"] },
      { nome: "Informatica e software", termos: ["software", "sistema", "licenca", "informatica", "computador", "notebook", "impressora"] },
      { nome: "Telefonia e internet", termos: ["telefonia", "telefone", "internet", "fibra", "dados moveis"] },
      { nome: "Servidores e folha", termos: ["servidor", "folha", "remuneracao", "vencimento", "cargo", "comissionado"] },
      { nome: "Terceirizados", termos: ["terceirizado", "terceirizacao", "prestacao de serviços", "apoio administrativo"] },
      { nome: "Consultoria", termos: ["consultoria", "assessoria", "apoio tecnico", "serviços tecnicos especializados"] },
      { nome: "Manutenção predial", termos: ["manutenção predial", "reforma", "pintura", "eletrica", "hidraulica"] },
      { nome: "Manutenção de veiculos", termos: ["manutenção de veiculo", "oficina", "pecas automotivas", "serviço mecanico", "oleo lubrificante"] },
      { nome: "Pneus", termos: ["pneu", "pneus", "recapagem", "camara de ar"] },
      { nome: "Moveis e equipamentos", termos: ["mobiliario", "moveis", "cadeira", "mesa", "armario", "equipamento permanente"] },
      { nome: "Eventos e solenidades", termos: ["evento", "solenidade", "sessao solene", "cerimonial", "homenagem", "honraria"] },
      { nome: "Moção/aplausos", termos: ["mocao", "aplauso", "aplausos", "louvor", "reconhecimento", "pesar"] },
      { nome: "Nome de rua", termos: ["denominacao de logradouro", "nome de rua", "logradouro", "via publica"] },
      { nome: "Titulos e homenagens", termos: ["titulo", "cidadao honorario", "honra ao merito", "diploma", "homenagem"] },
      { nome: "Requerimentos", termos: ["requerimento", "pedido de informação", "informações ao executivo"] },
      { nome: "Indicacoes", termos: ["indicacao", "pedido ao executivo", "providencia", "bairro"] },
      { nome: "Projetos de lei", termos: ["projeto de lei", "pl do legislativo", "lei ordinaria", "proposicao"] },
      { nome: "Saúde", termos: ["saude", "hospital", "ubs", "medicamento", "consulta", "exame", "paciente"] },
      { nome: "Educação", termos: ["educacao", "escola", "creche", "ensino", "aluno", "merenda"] },
      { nome: "Obras e infraestrutura", termos: ["obra", "infraestrutura", "asfalto", "pavimentacao", "buraco", "recapeamento", "ponte"] },
      { nome: "Transporte e mobilidade", termos: ["transporte", "mobilidade", "transito", "onibus", "ponto de onibus", "ciclovia"] },
      { nome: "Seguranca publica", termos: ["seguranca", "guarda municipal", "policia", "camera", "monitoramento"] },
      { nome: "Meio ambiente", termos: ["meio ambiente", "arvore", "poda", "lixo", "limpeza", "dengue", "zoonoses"] },
      { nome: "Esporte e lazer", termos: ["esporte", "lazer", "quadra", "campo", "atleta", "academia"] },
      { nome: "Assistencia social", termos: ["assistencia social", "vulnerabilidade", "idoso", "crianca", "deficiencia", "entidade"] },
      { nome: "Emendas/ONGs", termos: ["emenda", "ong", "entidade", "associacao", "termo de fomento", "subvencao"] },
    ];

    const despesasLinks = (D.camara_transparencia.links || []).map(l => ({
      origem: "Fonte oficial",
      responsavel: l.categoria || "Transparência",
      objeto: `${l.titulo || ""} ${l.categoria || ""}`,
      valor: 0,
      url: l.url || "",
    }));
    const baseCamara = [
      ...camMaterias().map(m => ({
        origem: m.tipo || "Materia legislativa",
        responsavel: m.autor || "Autor não informado",
        objeto: `${m.tipo || ""} ${m.numero || ""}/${m.ano || ""} ${m.ementa || ""}`,
        valor: 0,
        url: m.pdf || "",
      })),
      ...camEmendas().map(e => ({
        origem: "Emenda impositiva",
        responsavel: e.autor || "Autor não informado",
        objeto: `${e.beneficiario || ""} ${e.objeto || ""} ${e.cnpj || ""}`,
        valor: Number(e.valor_brl || 0),
        url: e.pdf || "",
      })),
      ...((D.diarias || {}).camara || []).map(d => ({
        origem: "Diária",
        responsavel: d.funcionario || "Servidor/Vereador não informado",
        objeto: `${d.cargo || ""} ${d.destino || ""} ${d.finalidade || ""} ${d.historico || ""}`,
        valor: Number(d.valor_total || 0),
        url: "",
      })),
      ...despesasLinks,
    ];

    const combina = (item, termos) => {
      const texto = norm(`${item.origem} ${item.responsável} ${item.objeto}`);
      return termos.some(t => texto.includes(norm(t)));
    };
    const agrupaResponsavel = (lista) => {
      const grupos = new Map();
      lista.forEach(item => {
        const key = norm(item.responsavel) || "não informado";
        const cur = grupos.get(key) || { nome: item.responsavel || "Não informado", valor: 0, qtd: 0 };
        cur.valor += item.valor || 0;
        cur.qtd += 1;
        grupos.set(key, cur);
      });
      return [...grupos.values()].sort((a, b) => (b.valor - a.valor) || (b.qtd - a.qtd));
    };

    const render = () => {
      const select = $("categoriaCamaraSelect");
      const busca = $("categoriaCamaraBusca");
      const categoria = categoriasCamara.find(c => c.nome === (select?.value || "Diárias")) || categoriasCamara[0];
      const extra = (busca?.value || "").split(",").map(t => t.trim()).filter(Boolean);
      const termos = extra.length ? extra : categoria.termos;
      const encontrados = baseCamara.filter(item => combina(item, termos)).sort((a, b) => (b.valor - a.valor));
      const total = encontrados.reduce((s, item) => s + (item.valor || 0), 0);
      const responsaveis = agrupaResponsavel(encontrados).slice(0, 5);
      const categoriasComQtd = categoriasCamara.map(cat => ({
        ...cat,
        qtd: baseCamara.filter(item => combina(item, cat.termos)).length,
      })).filter(cat => cat.qtd > 0);

      box.innerHTML = `
        <div class="keyword-audit__head">
          <div>
            <span class="reader-summary__label">Pergunte aos dados da Camara</span>
            <h3>Acoes e gastos por palavra-chave</h3>
            <p>Escolha um tema para procurar em materias legislativas, emendas, diárias e links oficiais da transparência da Camara. Valores aparecem quando a base tem valor estruturado.</p>
          </div>
        </div>
        <div class="keyword-audit__controls">
          <select id="categoriaCamaraSelect" aria-label="Escolher categoria da Camara">
            ${categoriasCamara.map(cat => `<option value="${esc(cat.nome)}"${cat.nome === categoria.nome ? " selected" : ""}>${esc(cat.nome)}</option>`).join("")}
          </select>
          <input id="categoriaCamaraBusca" type="search" value="${esc(busca?.value || "")}" placeholder="Ou digite: cafe, combustivel, diária...">
        </div>
        <div class="keyword-audit__chips">
          ${categoriasComQtd.slice(0, 18).map(cat => `<button type="button" data-camara-cat="${esc(cat.nome)}">${esc(cat.nome)} <span>${fmtNum(cat.qtd)}</span></button>`).join("")}
        </div>
        <div class="keyword-result">
          <article><strong>${fmtBRL(total)}</strong><span>valor estruturado localizado</span></article>
          <article><strong>${fmtNum(encontrados.length)}</strong><span>registros encontrados</span></article>
          <article><strong>${fmtNum(responsaveis.length)}</strong><span>autores/servidores/fontes</span></article>
        </div>
        <div class="keyword-audit__grid">
          <div>
            <h4>Quem aparece mais</h4>
            ${responsaveis.length ? responsaveis.map(r => `
              <div class="keyword-row">
                <span>${esc(r.nome)}</span>
                <strong>${r.valor ? fmtBRL(r.valor) : fmtNum(r.qtd)}</strong>
                <small>${fmtNum(r.qtd)} registro(s)</small>
              </div>`).join("") : `<p class="muted">Nenhum responsavel encontrado para estes termos.</p>`}
          </div>
          <div>
            <h4>Registros relacionados</h4>
            ${encontrados.slice(0, 5).map(item => `
              <div class="keyword-row">
                <span>${esc(item.origem)} - ${esc(item.responsavel)}</span>
                <strong>${item.valor ? fmtBRL(item.valor) : "sem valor"}</strong>
                <small>${esc(String(item.objeto || "").slice(0, 130))}${item.url ? ` · <a href="${esc(item.url)}" target="_blank" rel="noopener">abrir fonte</a>` : ""}</small>
              </div>`).join("") || `<p class="muted">Nenhum registro encontrado.</p>`}
          </div>
        </div>
        <p class="keyword-audit__note">Observação: na Câmara, a busca mistura dois mundos: gasto direto, como diária, e produção legislativa, como requerimento, indicação, moção e projeto. A leitura correta é separar dinheiro público de ação parlamentar.</p>
      `;

      const nextSelect = $("categoriaCamaraSelect");
      const nextBusca = $("categoriaCamaraBusca");
      if (nextSelect) nextSelect.addEventListener("change", render);
      if (nextBusca) {
        nextBusca.addEventListener("change", render);
        nextBusca.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") render();
        });
      }
      box.querySelectorAll("[data-camara-cat]").forEach(btn => {
        btn.addEventListener("click", () => {
          if ($("categoriaCamaraSelect")) $("categoriaCamaraSelect").value = btn.dataset.camaraCat || "";
          if ($("categoriaCamaraBusca")) $("categoriaCamaraBusca").value = "";
          render();
        });
      });
    };
    render();
  }

  initGastosPalavraCamara();

  // ============= VEREADORES (camara.html) =============
  let renderVereadores = null;
  if ($("vereadores")) {
    const vereadoresEl = $("vereadores");
    const filtroVer    = $("filtroVer");
    const ordenarVer   = $("ordenarVer");

    const bar = (label, val, max, kind, idx) => {
      const pct = max ? Math.round((val / max) * 100) : 0;
      return `<button class="ver-bar" type="button" data-kind="${kind}" data-idx="${idx}">
        <span class="ver-bar__label">${label}</span>
        <span class="ver-bar__track"><span class="ver-bar__fill" style="width:${pct}%"></span></span>
        <span class="ver-bar__val">${val}</span>
      </button>`;
    };

    function abrirVereador(idx) {
      const v = camVereadores()[idx];
      if (!v) return;
      const modal = $("modalVer");
      $("modalVerContent").innerHTML = `
        <p class="label">VEREADOR(A)</p>
        <h3>${esc(v.nome)}</h3>
        <p class="muted" style="margin-top:0">Produção legislativa em 2025</p>
        <p class="num">${v.total}</p>
        <p class="muted" style="margin-top:-6px">matérias protocoladas</p>
        <table>
          <tr><td>Indicações ao Executivo</td><td>${v.indicacoes}</td></tr>
          <tr><td>Requerimentos (fiscalização)</td><td>${v.requerimentos}</td></tr>
          <tr><td>Projetos de Lei</td><td>${v.projetos_lei}</td></tr>
          <tr><td>Emendas Impositivas</td><td>${v.emendas}</td></tr>
          <tr><td>Moções</td><td>${v.mocoes || 0}</td></tr>
          <tr><td>Outras matérias</td><td>${v.outros || 0}</td></tr>
        </table>
        <p style="margin-top:18px;font-size:0.9rem">
          <a href="https://sapl.varginha.mg.leg.br/" target="_blank" rel="noopener">
            Ver detalhes no SAPL - Câmara de Varginha
          </a>
        </p>`;
      if (typeof modal.showModal === "function") modal.showModal();
      else modal.setAttribute("open", "");
    }

    function abrirDetalheAcao(idx, kind) {
      const v = camVereadores()[idx];
      if (!v) return;
      const cfg = {
        indicacoes: {
          titulo: "Indicações ao Executivo",
          qtd: v.indicacoes || 0,
          peso: "x1 no Score Legislativo MVP",
          leitura: "Pedidos enviados ao Executivo, geralmente sobre bairros, serviços urbanos e demandas locais. Precisam de resposta da Prefeitura para medir impacto real.",
          dados: "Próxima coleta: número da indicação, data, ementa, bairro/tema, secretaria provável, status e resposta do Executivo.",
        },
        requerimentos: {
          titulo: "Requerimentos de fiscalização",
          qtd: v.requerimentos || 0,
          peso: "x3 no Score Legislativo MVP",
          leitura: "Instrumento mais forte para cobrar informações, documentos e providências. O valor real depende da resposta, prazo e completude.",
          dados: "Próxima coleta: número, destinatário, prazo legal, resposta recebida, tempo de resposta, anexos e análise de evasividade.",
        },
        projetos_lei: {
          titulo: "Projetos de lei",
          qtd: v.projetos_lei || 0,
          peso: "x5 no Score Legislativo MVP",
          leitura: "Produção normativa. Deve ser separada entre projeto estrutural, transparência, administrativo, simbólico, nomeação ou utilidade pública.",
          dados: "Próxima coleta: texto, tramitação, pareceres, votação, sanção, veto e classificação de impacto.",
        },
        emendas: {
          titulo: "Emendas impositivas",
          qtd: v.emendas || 0,
          peso: "x4 quando há pagamento localizado; x1 quando pendente",
          leitura: "Destinação de recurso público. Aqui já existe lista detalhada com beneficiário, CNPJ, valor, objeto e cruzamento com pagamento.",
          dados: "Use o painel filtrado para conferir beneficiário, contratos, pagamentos e dossiê de fiscalização.",
        },
        mocoes: {
          titulo: "Moções, aplausos e homenagens",
          qtd: v.mocoes || 0,
          peso: "peso zero no ranking de impacto",
          leitura: "Ações de reconhecimento, aplauso, pesar ou homenagem. Podem ser legítimas, mas têm baixo impacto fiscal direto.",
          dados: "Próxima coleta: tipo da moção, pessoa/entidade homenageada, justificativa e frequência por vereador.",
        },
      }[kind];
      if (!cfg) return;
      if (kind === "emendas") {
        if ($("filtroVereador")) $("filtroVereador").value = v.nome;
        if ($("filtroEm")) $("filtroEm").value = v.nome;
        if ($("filtroStatus")) $("filtroStatus").value = "";
        renderEmendas && renderEmendas(true);
        scrollToEl($("perfilVereador") || $("emendas"));
        return;
      }
      const tipoPorKind = {
        indicacoes: "indicacao",
        requerimentos: "requerimento",
        projetos_lei: "projeto de lei ordinaria do legislativo",
        mocoes: "mocao",
      };
      const itens = camMaterias()
        .filter(m => norm(m.autor).split(",").map(x => x.trim()).includes(norm(v.nome)) || norm(m.autor).includes(norm(v.nome)))
        .filter(m => norm(m.tipo) === tipoPorKind[kind])
        .slice(0, 40);
      const modal = $("modalVer");
      $("modalVerContent").innerHTML = `
        <p class="label">AÇÃO DO VEREADOR</p>
        <h3>${esc(cfg.titulo)}</h3>
        <p class="muted" style="margin-top:0">${esc(v.nome)}</p>
        <p class="num">${fmtNum(cfg.qtd)}</p>
        <p class="muted" style="margin-top:-6px">registros em ${anoCamara()}</p>
        <div class="detail-stack">
          <section><h4>O que esse número significa</h4><p>${esc(cfg.leitura)}</p></section>
          <section><h4>Peso atual no score</h4><p>${esc(cfg.peso)}</p></section>
          <section><h4>Para abrir item por item</h4><p>${esc(cfg.dados)}</p></section>
        </div>
        ${itens.length ? `<div class="detail-stack detail-stack--list">
          <section><h4>Itens relacionados em ${anoCamara()}</h4>
            ${itens.map(m => window.ZELA.materiaCard ? window.ZELA.materiaCard(m, esc) : `<article class="matter-mini">
              <strong>${esc(m.tipo)} nº ${esc(m.numero)}/${esc(m.ano)}</strong>
              <p>${esc(m.ementa || "Ementa não informada")}</p>
              ${m.impacto_zero ? `<span>Impacto zero: ${esc(m.motivo_impacto_zero || "classificação simbolica")}</span>` : ""}
              ${m.pdf ? `<a href="${esc(m.pdf)}" target="_blank" rel="noopener">Abrir documento oficial</a>` : ""}
            </article>`).join("")}
          </section>
        </div>` : ""}
        <p style="margin-top:18px;font-size:0.9rem">
          <a href="https://sapl.varginha.mg.leg.br/" target="_blank" rel="noopener">Conferir no SAPL oficial -></a>
        </p>`;
      if (typeof modal.showModal === "function") modal.showModal();
      else modal.setAttribute("open", "");
    }

    renderVereadores = function () {
      const q = norm(filtroVer.value.trim());
      const sortBy = ordenarVer.value;
      const vereadores = camVereadores();
      const ano = anoCamara();
      const lista = vereadores.filter(v => !q || norm(v.nome).includes(q));
      lista.sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));

      if (!lista.length) {
        vereadoresEl.innerHTML = '<div class="empty">Nenhum vereador com esse nome. Tente outro termo ou limpe a busca.</div>';
        return;
      }
      const max = Math.max(...vereadores.map(v => v.total));
      vereadoresEl.innerHTML = lista.map(v => `
        <div class="ver-card" data-idx="${vereadores.indexOf(v)}" tabindex="0">
          <h3 class="ver-card__name">${esc(v.nome)}</h3>
          <div class="ver-card__total">${v.total} matérias em ${ano}</div>
          <div class="ver-card__bars">
            ${bar("Indica&ccedil;&otilde;es", v.indicacoes,    max, "indicacoes", vereadores.indexOf(v))}
            ${bar("Requerim.",  v.requerimentos, max, "requerimentos", vereadores.indexOf(v))}
            ${bar("Proj. Lei",  v.projetos_lei,  max, "projetos_lei", vereadores.indexOf(v))}
            ${bar("Emendas",    v.emendas,       max, "emendas", vereadores.indexOf(v))}
            ${bar("Mocoes",     v.mocoes || 0,   max, "mocoes", vereadores.indexOf(v))}
          </div>
          <button class="ver-card__emendas" type="button" data-ver="${esc(v.nome)}">
            Ver tudo relacionado
          </button>
        </div>`).join("");

      const selecionarVereador = (nome) => {
        if ($("filtroVereador")) $("filtroVereador").value = nome || "";
        if ($("filtroEm")) $("filtroEm").value = nome || "";
        if ($("filtroStatus")) $("filtroStatus").value = "";
        renderEmendas && renderEmendas(true);
        scrollToEl($("perfilVereador") || $("emendas"));
      };

      vereadoresEl.querySelectorAll(".ver-card").forEach(card => {
        card.addEventListener("click", () => selecionarVereador(camVereadores()[+card.dataset.idx].nome || ""));
        card.addEventListener("keydown", e => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selecionarVereador(camVereadores()[+card.dataset.idx].nome || ""); }
        });
      });
      vereadoresEl.querySelectorAll(".ver-card__emendas").forEach(btn => {
        btn.addEventListener("click", e => {
          e.stopPropagation();
          selecionarVereador(btn.dataset.ver || "");
        });
      });
      vereadoresEl.querySelectorAll(".ver-bar").forEach(btn => {
        btn.addEventListener("click", e => {
          e.stopPropagation();
          abrirDetalheAcao(+btn.dataset.idx, btn.dataset.kind);
        });
      });
    };

    filtroVer.addEventListener("input", renderVereadores);
    ordenarVer.addEventListener("change", renderVereadores);
    renderVereadores();
  }

  // ============= RESUMO SEMANAL (camara.html) =============
  if ($("resumoSemanalBlock")) {
    var _rsEstado = { periodo: "semana", grau: "", vereador: "", ano: "", dataIni: "", dataFim: "" };

    function _rsDatasParaPeriodo(periodo) {
      var hoje = new Date();
      var ini, fim;
      if (periodo === "semana") {
        var dow = hoje.getDay(); // 0=dom
        var diasAtras = dow === 0 ? 6 : dow - 1; // segunda-feira
        ini = new Date(hoje); ini.setDate(hoje.getDate() - diasAtras);
        fim = hoje;
      } else if (periodo === "2semanas") {
        ini = new Date(hoje); ini.setDate(hoje.getDate() - 13);
        fim = hoje;
      } else if (periodo === "mes") {
        ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        fim = hoje;
      } else {
        // custom — usa _rsEstado
        ini = _rsEstado.dataIni ? new Date(_rsEstado.dataIni) : new Date(hoje.getFullYear(), 0, 1);
        fim = _rsEstado.dataFim ? new Date(_rsEstado.dataFim) : hoje;
      }
      // YYYY-MM-DD strings para comparação direta
      var toISO = function (d) { return d.toISOString().slice(0, 10); };
      return { ini: toISO(ini), fim: toISO(fim) };
    }

    // Usa TODAS as matérias de todos os anos — o filtro é por data real,
    // não pelo ano selecionado no dropdown de vereadores/emendas.
    function _rsTodosMaterias() {
      var anos = (D && D.camara_anos) || {};
      var todas = [];
      Object.keys(anos).forEach(function (a) {
        var mats = (anos[a] && anos[a].materias) || [];
        mats.forEach(function (m) { todas.push(m); });
      });
      return todas;
    }

    // Acha a data mais recente com matéria no dataset inteiro.
    function _rsUltimaDataDisponivel() {
      var ultima = "";
      _rsTodosMaterias().forEach(function (m) {
        if ((m.data || "") > ultima) ultima = m.data;
      });
      return ultima;
    }

    // Formata data ISO para dd/mm/aaaa
    function _rsFmtData(iso) {
      if (!iso) return "";
      var p = iso.split("-");
      return p[2] + "/" + p[1] + "/" + p[0];
    }

    function _rsRenderizar() {
      var feedEl = $("resumoSemanalFeed");
      var emptyEl = $("resumoSemanalEmpty");
      var contEl = $("resumoContador");
      if (!feedEl) return;

      var intervalo = _rsDatasParaPeriodo(_rsEstado.periodo);
      var _rsFiltrarBase = function (lista) {
        return lista.filter(function (m) {
          if (!m.data) return false;
          if (m.data < intervalo.ini || m.data > intervalo.fim) return false;
          if (_rsEstado.grau && m.grau !== _rsEstado.grau) return false;
          if (_rsEstado.vereador && !(m.autor || "").includes(_rsEstado.vereador)) return false;
          return true;
        });
      };

      var base = _rsEstado.ano
        ? (_rsTodosMaterias().filter(function (m) { return (m.ano || "") === _rsEstado.ano; }))
        : _rsTodosMaterias();
      var mats = _rsFiltrarBase(base);
      var avisoFallback = "";

      // Fallback: período solicitado sem dados → exibe última sessão disponível
      // (não esconde trabalho da Câmara por lacuna de coleta)
      if (mats.length === 0 && _rsEstado.periodo !== "custom") {
        var ultimaData = _rsUltimaDataDisponivel();
        if (ultimaData) {
          // Janela de 7 dias terminando na última data disponível
          var fimFb = ultimaData;
          var iniFbD = new Date(ultimaData);
          iniFbD.setDate(iniFbD.getDate() - 6);
          var iniFb = iniFbD.toISOString().slice(0, 10);
          // Aplica só o filtro de grau e vereador, não de data (período de fallback)
          mats = _rsTodosMaterias().filter(function (m) {
            if (!m.data || m.data < iniFb || m.data > fimFb) return false;
            if (_rsEstado.grau && m.grau !== _rsEstado.grau) return false;
            if (_rsEstado.vereador && !(m.autor || "").includes(_rsEstado.vereador)) return false;
            return true;
          });
          if (mats.length > 0) {
            avisoFallback = "Nenhuma sessão no período escolhido. Exibindo a última sessão disponível (" + _rsFmtData(ultimaData) + ").";
          }
        }
      }

      // Ordena: alto → medio → baixo, depois por data desc
      var ordemGrau = { alto: 0, medio: 1, baixo: 2 };
      mats.sort(function (a, b) {
        var gd = (ordemGrau[a.grau] || 2) - (ordemGrau[b.grau] || 2);
        if (gd !== 0) return gd;
        return (b.data || "") < (a.data || "") ? -1 : 1;
      });

      if (contEl) contEl.textContent = mats.length + " matéria" + (mats.length !== 1 ? "s" : "");
      emptyEl.hidden = mats.length > 0;
      feedEl.hidden = mats.length === 0;

      if (mats.length === 0) {
        feedEl.classList.remove("diario-list-whats");
        feedEl.innerHTML = "";
        return;
      }
      feedEl.classList.add("diario-list-whats");

      var html = "";
      // Aviso quando período escolhido não tem dados — fallback para última sessão
      if (avisoFallback) {
        html += '<div class="resumo-semanal__aviso">' + esc(avisoFallback) + '</div>';
      }
      var grauAtual = null;
      mats.forEach(function (m) {
        if (m.grau !== grauAtual) {
          grauAtual = m.grau;
          var tituloGrau = grauAtual === "alto" ? "ALTO impacto — Projetos de lei estruturantes"
                         : grauAtual === "medio" ? "MÉDIO impacto — Pedidos práticos e leis gerais"
                         : "Simbólicos / administrativos";
          html += '<h4 class="resumo-semanal__grau-titulo resumo-semanal__grau-titulo--' + grauAtual + '">' + tituloGrau + '</h4>';
        }
        if (window.ZELA.materiaCard) {
          html += window.ZELA.materiaCard(m, esc);
        } else {
          html += '<article class="mat-card"><span class="mat-ementa">' + esc(m.ementa || "") + '</span></article>';
        }
      });
      feedEl.innerHTML = html;
    }

    // Helper: ativa chip exclusivo num grupo
    function _rsSetChip(grupo, attrName, valor) {
      grupo.querySelectorAll(".rs-chip").forEach(function (b) {
        b.classList.toggle("rs-chip--active", (b.dataset[attrName] || "") === valor);
      });
    }

    // Chips ANO
    var anoChipsEl = $("resumoAnoChips");
    if (anoChipsEl) {
      anoChipsEl.querySelectorAll(".rs-chip").forEach(function (btn) {
        btn.addEventListener("click", function () {
          _rsEstado.ano = btn.dataset.rsano || "";
          _rsSetChip(anoChipsEl, "rsano", _rsEstado.ano);
          _rsRenderizar();
        });
      });
    }

    // Chips PERÍODO
    var periodoChipsEl = $("resumoPeriodoChips");
    if (periodoChipsEl) {
      periodoChipsEl.querySelectorAll(".rs-chip").forEach(function (btn) {
        btn.addEventListener("click", function () {
          _rsEstado.periodo = btn.dataset.periodo;
          _rsSetChip(periodoChipsEl, "periodo", _rsEstado.periodo);
          var customRange = $("resumoCustomRange");
          if (customRange) customRange.hidden = _rsEstado.periodo !== "custom";
          if (_rsEstado.periodo !== "custom") _rsRenderizar();
        });
      });
    }

    // Chips GRAU — toggle: clicar no ativo deseleciona
    var grauChipsEl = $("resumoGrauChips");
    if (grauChipsEl) {
      grauChipsEl.querySelectorAll(".rs-chip").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var novo = btn.dataset.grau;
          _rsEstado.grau = (_rsEstado.grau === novo) ? "" : novo; // toggle
          grauChipsEl.querySelectorAll(".rs-chip").forEach(function (b) {
            b.classList.toggle("rs-chip--active", b.dataset.grau === _rsEstado.grau);
          });
          _rsRenderizar();
        });
      });
    }

    // Custom date range
    var aplicarCustom = $("resumoAplicarCustom");
    if (aplicarCustom) {
      aplicarCustom.addEventListener("click", function () {
        _rsEstado.dataIni = ($("resumoDataInicio") || {}).value || "";
        _rsEstado.dataFim = ($("resumoDataFim") || {}).value || "";
        _rsRenderizar();
      });
    }

    // Vereador — popula de todos os anos
    var resumoFiltroVer = $("resumoFiltroVer");
    if (resumoFiltroVer) {
      var _rsNomesSet = {};
      Object.keys((D && D.camara_anos) || {}).forEach(function (a) {
        ((D.camara_anos[a] && D.camara_anos[a].vereadores) || []).forEach(function (v) {
          if (v.nome) _rsNomesSet[v.nome] = 1;
        });
      });
      resumoFiltroVer.innerHTML = '<option value="">Todos</option>' +
        Object.keys(_rsNomesSet).sort().map(function (n) {
          return '<option value="' + esc(n) + '">' + esc(n) + '</option>';
        }).join("");
      resumoFiltroVer.addEventListener("change", function () {
        _rsEstado.vereador = resumoFiltroVer.value;
        _rsRenderizar();
      });
    }

    _rsRenderizar();
  }

  // ============= EMENDAS (camara.html) com cruzamento =============
  let renderEmendas = null;
  let emendasShown  = 30;

  // Index das emendas cruzadas - sempre disponível (vem da Onda 2)
  const cruzMap = {};
  ((pf.emendas_cruzadas) || []).forEach(c => { cruzMap[c.numero + "/" + c.ano] = c; });

  if ($("emendas")) {
    const emendasEl   = $("emendas");
    const filtroEm    = $("filtroEm");
    const filtroAnoEmendas = $("filtroAnoEmendas");
    const filtroAnoPagamentosCnpj = $("filtroAnoPagamentosCnpj");
    const filtroVereador = $("filtroVereador");
    const filtroEntidade = $("filtroEntidade");
    const ordenarEm   = $("ordenarEm");
    const filtroStatus = $("filtroStatus");
    const contadorEl  = $("emendasContador");
    const maisEl      = $("emendasMais");
    const perfilEl    = $("perfilVereador");
    const entidadeResumoEl = $("entidadeResumo");
    let emendasView   = [];

    const atualizarFiltroVereadores = () => {
      if (!filtroVereador) return;
      const atual = filtroVereador.value;
      const vereadores = camVereadores();
      filtroVereador.innerHTML = '<option value="">Todos os vereadores</option>' +
        vereadores
          .map(v => `<option value="${esc(v.nome)}">${esc(v.nome)}</option>`)
          .join("");
      filtroVereador.value = vereadores.some(v => v.nome === atual) ? atual : "";
    };
    atualizarFiltroVereadores();

    const badge = (status) =>
        status === "encontrado" ? confidenceBadge("forte")
      : status === "execucao_direta" ? '<span class="em__status em__status--direct" style="background:#e0f2f1; color:#00695c; border:1px solid #b2dfdb; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:500;">Execução direta</span>'
      : status === "sem_pagamento" ? '<span class="em__status em__status--no">Sem pagamento detectado</span>'
      : status === "sem_cnpj" ? '<span class="em__status em__status--unknown">Sem CNPJ para cruzar</span>'
      : confidenceBadge("neutro");

    const vereadorSelecionado = () => {
      if (filtroVereador && filtroVereador.value) {
        return camVereadores().find(v => v.nome === filtroVereador.value) || null;
      }
      if (filtroVereador && filtroVereador.value && filtroEm.value !== filtroVereador.value) {
        filtroEm.value = filtroVereador.value;
      }
      const q = norm(filtroEm.value.trim());
      if (!q || q.length < 2) return null;
      const exact = camVereadores().find(v => norm(v.nome) === q);
      if (exact) return exact;
      const starts = camVereadores().filter(v => norm(v.nome).startsWith(q));
      if (starts.length === 1) return starts[0];
      const contains = camVereadores().filter(v => norm(v.nome).includes(q));
      return contains.length === 1 ? contains[0] : null;
    };

    const autoresInclui = (autor, nome) =>
      norm(autor).split(",").map(x => x.trim()).some(x => x === norm(nome));

    const temaEmenda = (e) => {
      const t = norm([e.beneficiario, e.objeto].filter(Boolean).join(" "));
      const temas = [
        ["Saúde", ["saude", "hospital", "ubs", "clinica", "terapia", "paciente", "idoso", "equipamento"]],
        ["Assistencia social", ["assistencia", "social", "vulnerabilidade", "acolhimento", "direitos", "convivencia"]],
        ["Educação", ["educacao", "escola", "creche", "aluno", "ensino", "pedagog"]],
        ["Esporte", ["esporte", "esportivo", "campo", "quadra", "atleta", "tatame"]],
        ["Cultura", ["cultura", "musica", "samba", "instrumento", "artesanato"]],
        ["Infraestrutura", ["obra", "reforma", "construcao", "mobiliario", "manutencao", "equipamentos"]],
        ["Protecao animal", ["animal", "animais", "veterin"]],
      ];
      const hit = temas.find(([, keys]) => keys.some(k => t.includes(k)));
      return hit ? hit[0] : "Outros";
    };

    const agrupar = (itens, chaveFn, valorFn = () => 1) => {
      const map = new Map();
      itens.forEach(item => {
        const key = chaveFn(item) || "Não informado";
        const cur = map.get(key) || { nome: key, qtd: 0, valor: 0, itens: [] };
        cur.qtd += 1;
        cur.valor += valorFn(item) || 0;
        cur.itens.push(item);
        map.set(key, cur);
      });
      return [...map.values()].sort((a, b) => (b.valor - a.valor) || (b.qtd - a.qtd));
    };

    const pct = (n, d) => d ? Math.round((n / d) * 100) : 0;
    const entidadeKey = (e) => cnpjRoot(e.cnpj) || norm(e.beneficiario || "sem beneficiario");
    const valorPagoCruzamento = (cruz, anoPagamento) => {
      if (!cruz) return 0;
      if (!anoPagamento) return cruz.valor_pago_total || 0;
      return (cruz.pagamentos || [])
        .filter(p => String(p.ano) === String(anoPagamento))
        .reduce((s, p) => s + (p.valor || 0), 0);
    };

    const emendasPorAnoSelecionado = () => {
      const ano = filtroAnoEmendas.value || "";
      return camEmendas().filter(e => !ano || String(e.ano) === ano);
    };

    const atualizarFiltroEntidades = () => {
      if (!filtroEntidade) return;
      const atual = filtroEntidade.value;
      const grupos = agrupar(emendasPorAnoSelecionado(), entidadeKey, e => e.valor_brl || 0);
      filtroEntidade.innerHTML = '<option value="">Todas as ONGs/entidades</option>' +
        grupos.map(g => {
          const e = g.itens[0] || {};
          const label = `${g.nome === entidadeKey(e) ? (e.beneficiario || "Beneficiário não identificado") : g.nome} · ${fmtNum(g.qtd)} emenda(s) · ${fmtBRL(g.valor)}`;
          return `<option value="${esc(g.nome)}">${esc(label)}</option>`;
        }).join("");
      filtroEntidade.value = grupos.some(g => g.nome === atual) ? atual : "";
    };

    const leituraAtuacao = (v, lista, pagos, semPagamento) => {
      const total = v.total || 1;
      const indPct = pct(v.indicacoes, total);
      const reqPct = pct(v.requerimentos, total);
      const plPct = pct(v.projetos_lei, total);
      const execPct = pct(pagos, lista.length);
      return [
        `${fmtNum(v.indicacoes)} indicacoes representam ${indPct}% da produção registrada; isso sugere uma atuação forte em demandas locais enviadas ao Executivo, mas o impacto real depende de resposta e execução pela Prefeitura.`,
        `${fmtNum(v.requerimentos)} requerimentos (${reqPct}% da produção) indicam o volume de fiscalização formal. Quanto maior esse bloco, mais material existe para cobrar respostas documentadas.`,
        `${fmtNum(v.projetos_lei)} projetos de lei (${plPct}%) mostram iniciativa normativa. A próxima etapa e conferir tramitação, aprovação e aplicacao pratica.`,
        `${fmtNum(v.mocoes || 0)} moções/homenagens e ${fmtNum(v.outros || 0)} outras matérias aparecem como produção de menor impacto fiscal direto. Podem ser legítimas, mas devem ficar separadas de ações que cobram, legislam ou movimentam dinheiro público.`,
        `Nas emendas, ${fmtNum(pagos)} de ${fmtNum(lista.length)} aparecem com pagamento localizado para o CNPJ (${execPct}%). ${semPagamento ? `${fmtNum(semPagamento)} ainda merecem pedido de comprovação de execução.` : "O foco passa a ser conferir notas, metas e entrega ao público."}`,
      ];
    };

    const contratosRelacionadosVereador = (lista) => {
      const roots = new Set(lista.map(e => cnpjRoot(e.cnpj)).filter(Boolean));
      return (pf.contratos || [])
        .filter(c => roots.has(cnpjRoot(c.cnpj)))
        .sort((a, b) => (b.valor || 0) - (a.valor || 0));
    };

    const emendasDoVereador = (v) =>
      camEmendas().filter(e => autoresInclui(e.autor, v.nome) || norm(e.autor).includes(norm(v.nome)));

    const scoreLegislativo = (v, lista) => {
      const pagas = lista.filter(e => (cruzMap[e.numero + "/" + e.ano] || {}).status === "encontrado").length;
      const pendentes = lista.length - pagas;
      return {
        bruto:
          (v.indicacoes || 0) * 1 +
          (v.requerimentos || 0) * 3 +
          Math.max(0, (v.projetos_lei || 0) - (v.nome_rua || 0)) * 5 +
          pagas * 4 +
          pendentes * 1,
        pagas,
        pendentes,
      };
    };

    const renderPerfilVereador = (v, lista) => {
      if (!perfilEl) return;
      if (!v) {
        perfilEl.hidden = true;
        perfilEl.innerHTML = "";
        return;
      }
      const total = lista.reduce((s, e) => s + (e.valor_brl || 0), 0);
      const pagos = lista.filter(e => (cruzMap[e.numero + "/" + e.ano] || {}).status === "encontrado").length;
      const semPagamento = lista.filter(e => (cruzMap[e.numero + "/" + e.ano] || {}).status === "sem_pagamento").length;
      const valorPagoLocalizado = lista.reduce((s, e) => s + ((cruzMap[e.numero + "/" + e.ano] || {}).valor_pago_total || 0), 0);
      const temas = agrupar(lista, temaEmenda, e => e.valor_brl || 0).slice(0, 6);
      const beneficiarios = agrupar(lista, e => e.beneficiario || "Beneficiario não identificado", e => e.valor_brl || 0).slice(0, 8);
      const contratosRel = contratosRelacionadosVereador(lista);
      const contratosValor = contratosRel.reduce((s, c) => s + (c.valor || 0), 0);
      const leituras = leituraAtuacao(v, lista, pagos, semPagamento);
      const rankingTotal = [...camVereadores()].sort((a, b) => (b.total || 0) - (a.total || 0)).findIndex(x => x.nome === v.nome) + 1;
      const score = scoreLegislativo(v, lista);
      const maxScore = Math.max(1, ...camVereadores().map(x => scoreLegislativo(x, emendasDoVereador(x)).bruto));
      const score100 = Math.round((score.bruto / maxScore) * 100);
      const ano = anoCamara();
      const pergunta = `Solicito relatorio consolidado das respostas, providencias adotadas, execução orçamentária e documentos comprobatórios relacionados Ã s indicacoes, requerimentos, projetos de lei e emendas de autoria da vereadora ${v.nome} em ${ano}, especialmente quanto aos beneficiarios, contratos, empenhos, liquidacoes, pagamentos e entregas realizadas Ã  população.`;
      perfilEl.hidden = false;
      perfilEl.innerHTML = `
        <div class="ver-profile__head">
          <div class="ver-profile__main">
            <span class="ver-profile__label">PAINEL COMPLETO DO(A) VEREADOR(A)</span>
            <h4>${esc(v.nome)}</h4>
            <p>${fmtNum(v.total)} matérias em ${ano} · ${fmtNum(v.indicacoes)} indicações · ${fmtNum(v.requerimentos)} requerimentos · ${fmtNum(v.projetos_lei)} projetos de lei · ${fmtNum(v.mocoes || 0)} moções/homenagens · ${fmtNum(v.impacto_zero || 0)} itens de impacto zero · posição ${rankingTotal || "-"} por volume de produção</p>
          </div>
          <button type="button" onclick="ZELA.limparVereador()">Limpar filtro</button>
        </div>
        <div class="ver-profile__stats">
          <div><strong>${fmtNum(lista.length)}</strong><span>emendas localizadas</span></div>
          <div><strong>${fmtBRL(total)}</strong><span>valor destinado</span></div>
          <div><strong>${fmtNum(pagos)}</strong><span>com pagamento ao CNPJ</span></div>
          <div><strong>${fmtNum(semPagamento)}</strong><span>sem pagamento localizado</span></div>
          <div><strong>${fmtBRL(valorPagoLocalizado)}</strong><span>pagamentos aos CNPJs beneficiarios</span></div>
          <div><strong>${fmtNum(contratosRel.length)}</strong><span>contratos ligados a CNPJs das emendas</span></div>
          <div><strong>${fmtNum(v.mocoes || 0)}</strong><span>mocoes, aplausos e homenagens</span></div>
          <div><strong>${fmtNum(v.outros || 0)}</strong><span>outras materias simples</span></div>
        </div>
        <p class="ver-profile__note">Os pagamentos aos CNPJs mostram quanto esses beneficiarios receberam da Prefeitura nos dados carregados; não significam, sozinhos, que todo o valor veio da emenda do vereador.</p>
        <div class="ver-profile__analysis">
          <section>
            <h5>Leitura da atuacao</h5>
            <ul>${leituras.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
          </section>
          <section>
            <h5>Classificação das ações</h5>
            <div class="impact-bars">
              ${[
                ["Demandas ao Executivo", v.indicacoes, "Pedidos de bairro/serviços; precisam de resposta da Prefeitura."],
                ["Fiscalizacao formal", v.requerimentos, "Pedidos de informacao e cobrancas documentadas."],
                ["Producao normativa", v.projetos_lei, "Projetos que podem alterar regras municipais."],
                ["Destinacao de recursos", lista.length, "Emendas com entidade, CNPJ, objeto e pagamento para conferir."],
                ["Homenagens e aplausos", v.mocoes || 0, "Mocoes honrosas, aplausos, pesar ou reconhecimento; impacto fiscal direto geralmente baixo."],
                ["Outras materias", v.outros || 0, "Mensagens, pronunciamentos, pareceres e atos que precisam ser lidos no SAPL para classificar melhor."],
              ].map(([nome, val, desc]) => `
                <div class="impact-row">
                  <div><strong>${esc(nome)}</strong><span>${esc(desc)}</span></div>
                  <b>${fmtNum(val)}</b>
                </div>`).join("")}
            </div>
          </section>
          <section>
            <h5>Score Legislativo MVP</h5>
            <div class="score-box">
              <strong>${fmtNum(score100)}/100</strong>
              <span>Nota comparativa dentro da Câmara, calculada com os dados já carregados.</span>
            </div>
            <p class="muted">Fórmula pública atual: indicação x1, requerimento x3, projeto de lei estrutural x5, emenda com pagamento localizado x4 e emenda pendente x1. Moção, homenagem a terceiro e nome de rua/logradouro entram com peso zero. Ainda não inclui presença, votações, respostas do Executivo ou qualidade da resposta.</p>
          </section>
          <section>
            <h5>Classificação por IA - próxima etapa</h5>
            <p class="muted">Quando os textos completos de projetos, requerimentos e respostas forem coletados, a IA deve classificar categoria, tipo, impacto estimado e relevância de 0 a 10. Exemplos: saúde, educação, mobilidade, transparência, infraestrutura, social, fiscalização, homenagem, nomeação ou utilidade pública.</p>
          </section>
          <section>
            <h5>Para onde vao as emendas</h5>
            ${temas.length ? `<div class="theme-list">${temas.map(t => `
              <div><strong>${esc(t.nome)}</strong><span>${fmtNum(t.qtd)} emenda(s) · ${fmtBRL(t.valor)}</span></div>`).join("")}</div>` : '<p class="muted">Nenhuma emenda localizada para este vereador.</p>'}
          </section>
          <section>
            <h5>Beneficiarios e pontos de checagem</h5>
            ${beneficiarios.length ? beneficiarios.map(b => {
              const roots = [...new Set(b.itens.map(e => cnpjRoot(e.cnpj)).filter(Boolean))];
              const contratos = (pf.contratos || []).filter(c => roots.includes(cnpjRoot(c.cnpj)));
              return `<div class="ver-check">
                <strong>${esc(b.nome)}</strong>
                <span>${fmtNum(b.qtd)} emenda(s) · ${fmtBRL(b.valor)} · ${fmtNum(contratos.length)} contrato(s) com mesmo CNPJ/raiz</span>
              </div>`;
            }).join("") : '<p class="muted">Nenhum beneficiario identificado.</p>'}
          </section>
          <section>
            <h5>Contratos relacionados aos CNPJs das emendas</h5>
            ${contratosRel.length ? contratosRel.slice(0, 6).map(c => `
              <div class="ver-check">
                <strong>${fmtBRL(c.valor || 0)} · ${esc(cleanText(c.contratado || "Contratado"))}</strong>
                <span>${esc(cleanText(c.modalidade || "modalidade não informada"))} · contrato ${esc(c.numero || "s/n")}/${esc(c.ano || "")}</span>
                <p>${esc(cleanText(c.objeto || "Objeto não informado"))}</p>
              </div>`).join("") : '<p class="muted">Nenhum contrato com o mesmo CNPJ/raiz das emendas foi localizado nos dados carregados.</p>'}
            ${contratosRel.length ? `<p class="muted small">Total relacionado: ${fmtBRL(contratosValor)}. Relação por CNPJ não prova irregularidade; serve para priorizar verificação.</p>` : ""}
          </section>
          <section>
            <h5>Homenagens x impacto real</h5>
            <p class="muted">Varginha registra esse tipo de ação legislativa com frequência. O painel separa moções, aplausos e homenagens porque elas podem reconhecer pessoas ou entidades, mas não equivalem automaticamente a fiscalização, execução de obra, melhoria de serviço público ou economia de recurso.</p>
            <div class="impact-row">
              <div><strong>Mocoes/homenagens</strong><span>Contagem direta por vereador nos dados carregados.</span></div>
              <b>${fmtNum(v.mocoes || 0)}</b>
            </div>
            <div class="impact-row">
              <div><strong>Outras materias</strong><span>Bloco auxiliar para mensagens, pronunciamentos, pareceres e atos que ainda exigem classificação detalhada.</span></div>
              <b>${fmtNum(v.outros || 0)}</b>
            </div>
          </section>
          <section>
            <h5>Pergunta pronta para fiscalizar impacto real</h5>
            <textarea readonly>${esc(pergunta)}</textarea>
          </section>
          <section>
            <h5>Indice de resposta do Executivo</h5>
            <p class="muted">Meta do Observatorio: cada requerimento deve ter prazo, secretaria responsável, status, resposta, tempo de resposta e avaliacao de completude. O indice sugerido combina 30% tempo, 30% completude, 30% resolucao e 10% transparência.</p>
          </section>
        </div>`;
    };

    const renderResumoEntidade = (lista) => {
      if (!entidadeResumoEl) return;
      const entidadeAtiva = filtroEntidade.value || "";
      const q = norm(filtroEm.value.trim());
      const deveMostrar = entidadeAtiva || (!vereadorSelecionado() && q.length >= 3 && lista.length > 1);
      if (!deveMostrar || !lista.length) {
        entidadeResumoEl.hidden = true;
        entidadeResumoEl.innerHTML = "";
        return;
      }
      const grupos = agrupar(lista, entidadeKey, e => e.valor_brl || 0);
      const grupo = entidadeAtiva
        ? grupos.find(g => g.nome === entidadeAtiva)
        : grupos[0];
      if (!grupo) {
        entidadeResumoEl.hidden = true;
        entidadeResumoEl.innerHTML = "";
        return;
      }
      const nome = grupo.itens[0].beneficiario || "Beneficiário não identificado";
      const cnpj = grupo.itens[0].cnpj || "";
      const autores = [...new Set(grupo.itens.flatMap(e => (e.autor || "").split(",").map(a => a.trim()).filter(Boolean)))];
      const anoPagamento = filtroAnoPagamentosCnpj.value || "";
      const pagamentos = grupo.itens.filter(e => valorPagoCruzamento(cruzMap[e.numero + "/" + e.ano] || {}, anoPagamento) > 0);
      const semPagamento = grupo.itens.filter(e => {
        const cruz = cruzMap[e.numero + "/" + e.ano] || {};
        return anoPagamento ? valorPagoCruzamento(cruz, anoPagamento) <= 0 : cruz.status === "sem_pagamento";
      });
      const pagoTotal = grupo.itens.reduce((s, e) => s + valorPagoCruzamento(cruzMap[e.numero + "/" + e.ano] || {}, anoPagamento), 0);
      entidadeResumoEl.hidden = false;
      entidadeResumoEl.innerHTML = `
        <div class="entity-profile__head">
          <div>
            <span class="entity-profile__label">EXTRATO DA ONG/ENTIDADE</span>
            <h4>${esc(nome)}</h4>
            <p>${esc(cnpj || "CNPJ não informado")} · ${fmtNum(autores.length)} vereador${autores.length === 1 ? "" : "es"} destinaram emenda</p>
          </div>
          <button type="button" onclick="ZELA.limparEntidade()">Limpar entidade</button>
        </div>
        <div class="entity-profile__stats">
          <div><strong>${fmtNum(grupo.qtd)}</strong><span>emendas recebidas</span></div>
          <div><strong>${fmtBRL(grupo.valor)}</strong><span>emendas destinadas por vereadores</span></div>
          <div><strong>${fmtNum(pagamentos.length)}</strong><span>com pagamento localizado${anoPagamento ? " em " + anoPagamento : ""}</span></div>
          <div><strong>${fmtNum(semPagamento.length)}</strong><span>${anoPagamento ? "sem pagamento no ano" : "sem pagamento localizado"}</span></div>
          <div><strong>${fmtBRL(pagoTotal)}</strong><span>total pago pela Prefeitura ao CNPJ${anoPagamento ? " em " + anoPagamento : ""}</span></div>
        </div>
        <p class="entity-profile__note"><strong>Como ler:</strong> o valor de emendas é somente o que vereadores destinaram para esta entidade. O total pago pela Prefeitura ao mesmo CNPJ ${anoPagamento ? `está filtrado em ${anoPagamento}` : "soma todos os anos carregados"} e pode incluir convênios, contratos, termos de fomento, repasses recorrentes e outras verbas que não são necessariamente emendas. Use essa diferença como pista para conferir empenhos, liquidações, notas fiscais, plano de trabalho e execução.</p>
        <div class="entity-profile__list">
          ${grupo.itens
            .sort((a, b) => (b.valor_brl || 0) - (a.valor_brl || 0))
            .map(e => {
              const c = cruzMap[e.numero + "/" + e.ano] || {};
              const valorPagoAno = valorPagoCruzamento(c, anoPagamento);
              const statusPagamento = valorPagoAno > 0
                ? `pagamento localizado${anoPagamento ? " em " + anoPagamento : ""}: ${fmtBRL(valorPagoAno)}`
                : anoPagamento ? `sem pagamento localizado em ${anoPagamento}` : c.status === "sem_pagamento" ? "sem pagamento localizado" : "sem conferência automática";
              return `<article>
                <strong>${fmtBRL(e.valor_brl || 0)} · Emenda nº ${esc(e.numero)}/${esc(e.ano)}</strong>
                <span>Autor(a): ${esc(e.autor || "não informado")} · ${esc(statusPagamento)}</span>
                <p>${esc(e.objeto || "Objeto não informado")}</p>
                ${e.pdf ? `<a href="${esc(e.pdf)}" target="_blank" rel="noopener">Abrir documento oficial</a>` : ""}
              </article>`;
            }).join("")}
        </div>`;
    };
    const cnpjDigits = (s) => ((s || "").match(/\d/g) || []).join("");
    const encontrarContratosCnpj = (cnpj) => {
      const root = cnpjRoot(cnpj);
      if (!root) return [];
      return (pf.contratos || [])
        .filter(c => cnpjRoot(c.cnpj) === root)
        .sort((a, b) => (b.valor || 0) - (a.valor || 0))
        .slice(0, 8);
    };
    const encontrarCnpjInfo = (cnpj) => {
      const dig = cnpjDigits(cnpj);
      return ((D.cnpjs || {}).empresas || []).find(e => cnpjDigits(e.cnpj) === dig);
    };
    // Dossiê de emenda (CNPJ cross-ref) — renderização delegada para modules/dossie.js
    const abrirFiscalizacao = (idx) => {
      const e = camEmendas()[idx];
      if (!e) return;
      const html = window.ZELA.dossie.templateEmenda({
        emenda: e,
        cruz: cruzMap[e.numero + "/" + e.ano] || {},
        contratos: encontrarContratosCnpj(e.cnpj),
        cnpjInfo: encontrarCnpjInfo(e.cnpj),
      });
      window.ZELA.dossie.abrirComHtml(html);
    };

    let categoriaAtivaEmendas = "";
    window.ZELA.filtrarEmendasPorCategoria = (cat) => {
      categoriaAtivaEmendas = cat || "";
      renderEmendas(true);
    };

    renderEmendas = function (reset) {
      if (reset) emendasShown = 30;
      const q = norm(filtroEm.value.trim());
      const sortBy = ordenarEm.value;
      const fStatus = filtroStatus ? filtroStatus.value : "";
      const vereadorAtivo = vereadorSelecionado();
      const verNorm = vereadorAtivo ? norm(vereadorAtivo.nome) : "";
      const entidadeAtiva = filtroEntidade ? filtroEntidade.value : "";

      const anoFiltro = filtroAnoEmendas.value || "";
      const emendasAno = emendasPorAnoSelecionado();
      emendasView = emendasAno.filter(e => {
        if (categoriaAtivaEmendas) {
          if (window.ZELA.classificarItem(e) !== categoriaAtivaEmendas) return false;
        }
        if (vereadorAtivo) {
          if (!autoresInclui(e.autor, vereadorAtivo.nome) && !norm(e.autor).includes(verNorm)) return false;
        }
        if (entidadeAtiva && entidadeKey(e) !== entidadeAtiva) return false;
        if (!vereadorAtivo && !entidadeAtiva && q && !(
            norm(e.beneficiario).includes(q) ||
            norm(e.autor).includes(q) ||
            norm(e.objeto).includes(q) ||
            (e.cnpj || "").replace(/[^\d]/g, "").includes(q.replace(/[^\d]/g, ""))
          )) return false;
        if (fStatus) {
          const st = (cruzMap[e.numero + "/" + e.ano] || {}).status;
          if (st !== fStatus) return false;
        }
        return true;
      });

      emendasView.sort((a, b) => {
        switch (sortBy) {
          case "valor_asc":  return a.valor_brl - b.valor_brl;
          case "valor_desc": return b.valor_brl - a.valor_brl;
          case "autor":      return a.autor.localeCompare(b.autor, "pt-BR");
          case "numero":     return (+b.numero) - (+a.numero);
          case "pago":       return (((cruzMap[b.numero + "/" + b.ano] || {}).valor_pago_total) || 0) -
                                    (((cruzMap[a.numero + "/" + a.ano] || {}).valor_pago_total) || 0);
          default:           return 0;
        }
      });

      const total = emendasView.reduce((s, e) => s + e.valor_brl, 0);
      contadorEl.textContent =
        `${emendasView.length} emenda${emendasView.length === 1 ? "" : "s"}${anoFiltro ? " em " + anoFiltro : ""} · ${fmtBRL(total)}`;

      renderPerfilVereador(vereadorAtivo, emendasView);
      renderResumoEntidade(emendasView);

      if (!emendasView.length) {
        const materiasAno = anoFiltro && D.camara_anos && D.camara_anos[anoFiltro]
          ? (D.camara_anos[anoFiltro].materias || [])
          : [];
        const emendasLegislativas = materiasAno.filter(m => norm(m.tipo) === "emenda").length;
        emendasEl.innerHTML = anoFiltro && emendasLegislativas
          ? `<div class="empty">
              <strong>Sem base completa de emendas impositivas em ${anoFiltro}.</strong><br>
              O SAPL tem ${fmtNum(emendasLegislativas)} emenda${emendasLegislativas === 1 ? "" : "s"} legislativa${emendasLegislativas === 1 ? "" : "s"} em ${anoFiltro}, mas elas são alterações de texto de projetos, não uma lista de destinação direta de dinheiro para ONG/entidade.
              <br>Para cruzar pagamento com execução, ainda faltam entidade, CNPJ, valor e objeto. Próxima checagem: LOA ${anoFiltro}, anexos orçamentários, formulário oficial de solicitação, decreto regulamentador e publicações da Prefeitura/Câmara.
              <br><button type="button" class="link-button" onclick="document.getElementById('filtroAnoEmendas').value='2025'; ZELA.filtrarEmendasAno('2025')">Ver emendas estruturadas de 2025</button>
            </div>`
          : `<div class="empty">
              Nenhuma emenda impositiva encontrada${anoFiltro ? " em " + anoFiltro : ""}.
            </div>`;
        maisEl.hidden = true;
        return;
      }

      const slice = emendasView.slice(0, emendasShown);
      emendasEl.innerHTML = slice.map(e => {
        const idx = emendasAno.indexOf(e);
        const c = cruzMap[e.numero + "/" + e.ano];
        let pagoBlock = "";
        if (c && c.status === "encontrado") {
          const ratio = e.valor_brl ? (c.valor_pago_total / e.valor_brl) : 0;
          const ratioTxt = ratio >= 1
            ? `${ratio.toFixed(1)}x a emenda (entidade recebe outras verbas também)`
            : `${Math.round(ratio * 100)}% da emenda`;
          pagoBlock = `
            <p class="em__pago">
              Prefeitura pagou ao CNPJ: <strong>${fmtBRL(c.valor_pago_total)}</strong>
              <span class="hint">· ${ratioTxt}</span>
            </p>`;
        } else if (c && c.status === "sem_pagamento") {
          pagoBlock = `<p class="em__pago"><span class="hint">Não localizamos pagamentos da Prefeitura ao CNPJ ${e.cnpj || ""} - pode ainda não ter sido executado.</span></p>`;
        }
        const idEmenda = `${e.numero || ""}/${e.ano || ""}`;
        return `
        <article class="em">
          <div class="em__valor">
            ${fmtBRL(e.valor_brl)}
            <div style="margin-top:8px;">${window.ZELA.watchlist.botao("emendas", idEmenda)}</div>
          </div>
          <div class="em__body">
            <p class="em__benef">
              ${e.beneficiario || "<em>(sem beneficiário identificado)</em>"}
              ${badge(c && c.status)}
            </p>
            <div class="em__meta">
              <span><strong>Autor(a):</strong> ${esc(e.autor)}</span>
              <span class="em__cnpj">${esc(e.cnpj)}</span>
              <span>Emenda nº ${e.numero}/${e.ano}</span>
            </div>
            ${e.objeto ? `<p class="em__obj">${esc(e.objeto)}</p>` : ""}
            ${pagoBlock}
            <p class="em__pdf">
              <button class="em__fiscalizar" type="button" data-idx="${idx}">Fiscalizar este valor</button>
              ${e.pdf ? `<a href="${esc(e.pdf)}" target="_blank" rel="noopener">Ver PDF oficial -></a>` : ""}
            </p>
          </div>
        </article>`;
      }).join("");

      emendasEl.querySelectorAll(".em__fiscalizar").forEach(btn => {
        btn.addEventListener("click", () => abrirFiscalizacao(+btn.dataset.idx));
      });

      maisEl.hidden = emendasView.length <= emendasShown;
    };

    filtroEm.addEventListener("input",   () => {
      if (filtroEntidade) filtroEntidade.value = "";
      if (filtroVereador) {
        const typed = norm(filtroEm.value.trim());
        const exact = camVereadores().find(v => norm(v.nome) === typed);
        filtroVereador.value = exact ? exact.nome : "";
      }
      renderEmendas(true);
    });
    if (filtroVereador) {
      filtroVereador.addEventListener("change", () => {
        filtroEm.value = filtroVereador.value || "";
        if (filtroEntidade) filtroEntidade.value = "";
        renderEmendas(true);
        if (filtroVereador.value) scrollToEl(perfilEl || emendasEl);
      });
    }
    if (filtroEntidade) {
      filtroEntidade.addEventListener("change", () => {
        if (filtroVereador) filtroVereador.value = "";
        filtroEm.value = "";
        if (filtroStatus) filtroStatus.value = "";
        renderEmendas(true);
        if (filtroEntidade.value) scrollToEl(entidadeResumoEl || emendasEl);
      });
    }
    if (filtroAnoEmendas) {
      filtroAnoEmendas.addEventListener("change", () => {
        if (filtroEntidade) filtroEntidade.value = "";
        atualizarFiltroEntidades();
        renderEmendas(true);
      });
    }
    if (filtroAnoPagamentosCnpj) {
      filtroAnoPagamentosCnpj.addEventListener("change", () => renderEmendas(true));
    }
    ordenarEm.addEventListener("change", () => renderEmendas(true));
    if (filtroStatus) filtroStatus.addEventListener("change", () => renderEmendas(true));
    if ($("filtroAnoCamara")) {
      $("filtroAnoCamara").addEventListener("change", () => {
        if ($("filtroVer")) $("filtroVer").value = "";
        if (filtroEm) filtroEm.value = "";
        if (filtroStatus) filtroStatus.value = "";
        if (filtroVereador) filtroVereador.value = "";
        if (filtroEntidade) filtroEntidade.value = "";
        if (filtroAnoEmendas) filtroAnoEmendas.value = anoCamara();
        if (filtroAnoPagamentosCnpj) filtroAnoPagamentosCnpj.value = "";
        renderStatsCamara();
        renderDestaqueCamara();
        atualizarFiltroVereadores();
        atualizarFiltroEntidades();
        renderVereadores && renderVereadores();
        if (PAGE === "relatorios" && typeof renderRelatorios === "function") renderRelatorios();
        if (PAGE === "pessoal") initPessoal();
        renderEmendas(true);
        // Mantém chips do bloco "O ano em números" em sincronia
        document.querySelectorAll(".ano-chip[data-ano]").forEach(function (b) {
          b.classList.toggle("ano-chip--active", b.dataset.ano === anoCamara());
        });
      });
    }
    atualizarFiltroEntidades();
    renderEmendas(true);

    // ============= GRÁFICO EMENDAS POR VEREADOR =============
    if ($("graficoEmendas")) {
      const emBlock = $("graficoEmendasBlock");
      const emGraf  = $("graficoEmendas");
      const todasEmendas = D.emendas || [];
      if (todasEmendas.length) {
        const porVer = new Map();
        todasEmendas.forEach(e => {
          const nome = cleanText(e.autor || e.vereador || "Desconhecido").trim();
          const cur = porVer.get(nome) || { nome, total: 0, qtd: 0 };
          cur.total += Number(e.valor_brl) || 0;
          cur.qtd += 1;
          porVer.set(nome, cur);
        });
        const ranking = [...porVer.values()].sort((a, b) => b.total - a.total).slice(0, 15);
        const maxVal  = ranking[0] ? ranking[0].total : 1;
        emGraf.innerHTML = ranking.map(v => {
          const pct = ((v.total / maxVal) * 100).toFixed(1);
          const nomeEnc = encodeURIComponent(v.nome);
          return `<div class="em-chart-row" style="cursor:pointer" title="${esc(v.nome)} — ${fmtBRL(v.total)} em ${v.qtd} emenda(s)"
            onclick="if(document.getElementById('filtroVer')){document.getElementById('filtroVer').value='${jsSafe(v.nome)}';document.getElementById('filtroVer').dispatchEvent(new Event('input'));}">
            <span class="em-chart-name">${esc(v.nome.split(" ").slice(0,2).join(" "))}</span>
            <div class="em-chart-bar-wrap">
              <div class="em-chart-bar-fill" style="width:${pct}%"></div>
            </div>
            <span class="em-chart-val">${fmtBRL(v.total)}</span>
          </div>`;
        }).join("");
        if (emBlock) emBlock.hidden = false;
      }
    }

    // ============= EMENDAS EM ATENÇÃO (camara.html) =============
    if ($("emendasAtencaoBlock")) {
      const todasEm = D.emendas || [];
      const atencao = todasEm.filter(e => {
        const st = (cruzMap[e.numero + "/" + e.ano] || {}).status;
        return st === "sem_pagamento" || st === "sem_cnpj";
      });
      if (atencao.length) {
        const totalRisco = atencao.reduce((s, e) => s + (Number(e.valor_brl) || 0), 0);
        const semPag = atencao.filter(e => (cruzMap[e.numero + "/" + e.ano] || {}).status === "sem_pagamento").length;
        const semCnpj = atencao.filter(e => (cruzMap[e.numero + "/" + e.ano] || {}).status === "sem_cnpj").length;
        $("emendasAtencaoBlock").hidden = false;
        $("emendasAtencaoBlock").innerHTML = `
          <div class="atencao-emendas">
            <div class="atencao-emendas__head">
              ${window.ZELA.icon ? window.ZELA.icon("alerta", { size: 16 }) : ""} Emendas comprometidas sem pagamento comprovado
            </div>
            <p style="margin:0 0 10px; font-size:.88rem; color:#5d4037;">
              Valor total destinado por vereadores que <strong>não tem pagamento localizado</strong> no Portal de Transparência da Prefeitura.
              Pode ser promessa não executada, pagamento ainda pendente ou problema de cruzamento de dados.
            </p>
            <div class="atencao-emendas__nums">
              <div class="atencao-emendas__num">
                <strong>${fmtBRL(totalRisco)}</strong>
                <span>valor total em atenção</span>
              </div>
              <div class="atencao-emendas__num">
                <strong>${semPag}</strong>
                <span>sem pagamento localizado</span>
              </div>
              <div class="atencao-emendas__num">
                <strong>${semCnpj}</strong>
                <span>sem CNPJ informado</span>
              </div>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button class="atencao-emendas__cta" onclick="document.getElementById('filtroStatus').value='sem_pagamento'; document.getElementById('filtroStatus').dispatchEvent(new Event('change')); window.scrollTo({top: document.getElementById('emendas').offsetTop - 100, behavior:'smooth'});">
                Ver lista filtrada
              </button>
              <a class="atencao-emendas__cta" href="cobrar.html#templates-emenda" style="background:#6d3800;">
                ${window.ZELA.icon ? window.ZELA.icon("anexo", { size: 16 }) : ""} Protocolar LAI sobre execução
              </a>
            </div>
          </div>`;
      }
    }

    // ============= % EXECUÇÃO POR VEREADOR (camara.html) =============
    if ($("execucaoVereador")) {
      const todasEm = D.emendas || [];
      if (todasEm.length) {
        const porVer = new Map();
        todasEm.forEach(e => {
          const nome = cleanText(e.autor || e.vereador || "Desconhecido").trim();
          const cur = porVer.get(nome) || { nome, destinado: 0, pago: 0, qtd: 0 };
          cur.destinado += Number(e.valor_brl) || 0;
          cur.pago += Number((cruzMap[e.numero + "/" + e.ano] || {}).valor_pago_total || 0);
          cur.qtd += 1;
          porVer.set(nome, cur);
        });
        const ranking = [...porVer.values()]
          .filter(v => v.destinado > 0)
          .map(v => ({ ...v, pct: v.destinado > 0 ? (v.pago / v.destinado) * 100 : 0 }))
          .sort((a, b) => b.destinado - a.destinado)
          .slice(0, 18);
        if (ranking.length) {
          $("execucaoVereadorBlock").hidden = false;
          $("execucaoVereador").innerHTML = ranking.map(v => {
            const pctClamp = Math.min(100, Math.round(v.pct));
            const cls = v.pct >= 70 ? "ok" : v.pct >= 30 ? "med" : "low";
            return `<div class="exec-card" title="${esc(v.nome)} — ${v.qtd} emenda(s)">
              <div class="exec-card__name">${esc(v.nome.split(" ").slice(0,3).join(" "))}</div>
              <div class="exec-card__pct exec-card__pct--${cls}">${pctClamp}%</div>
              <div class="exec-card__bar">
                <div class="exec-card__fill exec-card__fill--${cls}" style="width:${pctClamp}%"></div>
              </div>
              <div class="exec-card__nums">
                <span>Pago ${fmtBRL(v.pago)}</span>
                <span>de ${fmtBRL(v.destinado)}</span>
              </div>
            </div>`;
          }).join("");
        }
      }
    }
  }

  // ============= STATS DO CRUZAMENTO (camara.html) =============
  if ($("cruzamentoStats") && pf.stats_cruzamento) {
    const cs = pf.stats_cruzamento;
    const total = cs.com_pagamento + (cs.execucao_direta || 0) + cs.sem_pagamento + cs.sem_cnpj;
    const pct = (n) => total ? Math.round((n / total) * 100) + "%" : "—";
    $("cruzamentoStats").hidden = false;
    $("cruzamentoStats").innerHTML = `
      <div class="cruz-cell">
        <div class="cruz-cell__num" style="color:#1F6B3A">${cs.com_pagamento}</div>
        <div class="cruz-cell__pct">${pct(cs.com_pagamento)}</div>
        <div class="cruz-cell__lbl">CNPJ recebeu pagamento<br>${confidenceBadge("forte")}</div>
      </div>
      <div class="cruz-cell">
        <div class="cruz-cell__num" style="color:#004d40">${cs.execucao_direta || 0}</div>
        <div class="cruz-cell__pct">${pct(cs.execucao_direta || 0)}</div>
        <div class="cruz-cell__lbl">Execução direta (Prefeitura)<br><span class="confidence-badge confidence--check" style="background:#e0f2f1; color:#00695c; border:1px solid #b2dfdb">Órgão interno</span></div>
      </div>
      <div class="cruz-cell">
        <div class="cruz-cell__num" style="color:#8C3B1A">${cs.sem_pagamento}</div>
        <div class="cruz-cell__pct">${pct(cs.sem_pagamento)}</div>
        <div class="cruz-cell__lbl">Nenhum pagamento ao CNPJ<br><span class="confidence-badge confidence--clue">Pedir comprovante</span></div>
      </div>
      <div class="cruz-cell">
        <div class="cruz-cell__num" style="color:#666">${cs.sem_cnpj}</div>
        <div class="cruz-cell__pct">${pct(cs.sem_cnpj)}</div>
        <div class="cruz-cell__lbl">Sem CNPJ identificado<br>${confidenceBadge("nao_cruzar")}</div>
      </div>`;
  }

  // ============= RELATÓRIOS / SINAIS DE ATENÇÃO (relatorios.html) =============
  const renderRelatorios = () => {
    if (!$("sinaisAtencao")) return;
    const emendas = D.emendas || [];
    const contratos = pf.contratos || [];
    const licitacoes = pf.licit_andamento || [];
    const pncp = D.pncp || {};
    const cnpjs = D.cnpjs || {};
    const camaraTransp = D.camara_transparencia || {};
    const pessoal = D.pessoal || {};
    const fontesEmendas2026 = D.fontes_emendas_2026 || {};
    const cs = pf.stats_cruzamento || {};
    const sinais = [];
    
    // Novas métricas de auditoria para sinais de atenção
    const contratosDestaque = contratos.map(c => {
      const d1 = new Date(c.data_assinatura);
      const d2 = new Date(c.data_fim);
      const diff = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24)) || 1;
      return { ...c, custo_diario: (Number(c.valor) || 0) / diff };
    });
    const addSignal = (kind, level, title, body, meta, href) => {
      sinais.push({ kind, level, title, body, meta, href });
    };
    const agruparRelatorio = (itens, chaveFn, valorFn = () => 1) => {
      const map = new Map();
      itens.forEach(item => {
        const key = chaveFn(item) || "Não informado";
        const cur = map.get(key) || { nome: key, qtd: 0, valor: 0, itens: [] };
        cur.qtd += 1;
        cur.valor += valorFn(item) || 0;
        cur.itens.push(item);
        map.set(key, cur);
      });
      return [...map.values()].sort((a, b) => (b.valor - a.valor) || (b.qtd - a.qtd));
    };

    const renderResumoCidadao = () => {
      const el = $("relatorioCidadao");
      if (!el) return;
      const semPagamento = emendas.filter(e => (cruzMap[e.numero + "/" + e.ano] || {}).status === "sem_pagamento");
      const semCnpj = emendas.filter(e => (cruzMap[e.numero + "/" + e.ano] || {}).status === "sem_cnpj" || !e.cnpj);
      const contratosMilhao = contratos.filter(c => (c.valor || 0) >= 1_000_000);
      const maiorContrato = [...contratos].sort((a, b) => (b.valor || 0) - (a.valor || 0))[0];
      const fornecedores = agruparRelatorio(contratos, c => c.contratado || "Fornecedor não informado", c => Number(c.valor) || 0);
      const maiorFornecedor = fornecedores[0];
      const valorEmendas = emendas.reduce((s, e) => s + (Number(e.valor_brl) || 0), 0);
      const valorContratosMilhao = contratosMilhao.reduce((s, c) => s + (Number(c.valor) || 0), 0);
      const eventos = contratos.filter(c => /show|evento|artista|palco|sonorizacao|iluminacao|carnaval|rodeio|banho da doroteia/i.test(norm(c.objeto || "")));
      const educacao = contratos.filter(c => /fundeb|educacao|escola|escolar|creche|cemei|ensino|merenda|transporte escolar/i.test(norm(c.objeto || "")));
      const passos = [
        {
          titulo: "1. Comece pelas emendas sem pagamento localizado",
          texto: `${fmtNum(semPagamento.length)} emendas tem CNPJ, mas o painel ainda não localizou pagamento correspondente nos dados carregados.`,
          acao: "Pedir empenho, liquidação, pagamento e estágio de execução.",
          href: "camara.html",
        },
        {
          titulo: "2. Olhe contratos acima de R$ 1 milhão",
          texto: `${fmtNum(contratosMilhao.length)} contratos somam ${fmtBRL(valorContratosMilhao)} e merecem conferência de objeto, aditivos e notas fiscais.`,
          acao: "Abrir contrato integral, anexos e relatório do fiscal.",
          href: "prefeitura.html?tab=contratos",
        },
        {
          titulo: "3. Confira entidades que receberam muitas emendas",
          texto: `${fmtNum(emendas.length)} emendas somam ${fmtBRL(valorEmendas)}. A prioridade é entender quem recebeu, para qual finalidade e se houve entrega.`,
          acao: "Filtrar por entidade, CNPJ ou vereador no ranking abaixo.",
          href: "#ranking-entidades",
        },
        {
          titulo: "4. Separe educação e eventos",
          texto: `${fmtNum(educacao.length)} contratos ligados a educação e ${fmtNum(eventos.length)} ligados a eventos foram classificados para leitura específica.`,
          acao: "Não misturar assuntos: cada trilha pede documentos diferentes.",
          href: "#educacao-fundeb",
        },
      ];
      el.innerHTML = `
        <div class="citizen-report__intro">
          <span>Resumo para o cidadao</span>
          <h3>Onde vale começar a fiscalização</h3>
          <p>Esta leitura prioriza o que um morador consegue cobrar com clareza: dinheiro envolvido, documento que falta e pergunta objetiva para a Prefeitura ou Camara.</p>
        </div>
        <div class="citizen-report__numbers">
          <article><strong>${fmtNum(sinais.length)}</strong><span>sinais automaticos</span></article>
          <article><strong>${fmtNum(semPagamento.length)}</strong><span>emendas sem pagamento localizado</span></article>
          <article><strong>${fmtNum(contratosMilhao.length)}</strong><span>contratos acima de R$ 1 mi</span></article>
          <article><strong>${fmtNum(semCnpj.length)}</strong><span>emendas sem CNPJ claro</span></article>
        </div>
        <div class="citizen-report__spotlight">
          <article>
            <span>Maior contrato carregado</span>
            <strong>${esc(maiorContrato.contratado || "Não informado")}</strong>
            <p>${fmtBRL(maiorContrato.valor || 0)} - contrato ${esc(maiorContrato.numero || "s/n")}/${esc(maiorContrato.ano || "")}</p>
          </article>
          <article>
            <span>Fornecedor com maior soma</span>
            <strong>${esc(maiorFornecedor.nome || "Não informado")}</strong>
            <p>${fmtBRL(maiorFornecedor.valor || 0)} em ${fmtNum(maiorFornecedor.qtd || 0)} registro(s)</p>
          </article>
        </div>
        <div class="citizen-report__steps">
          ${passos.map(p => `
            <a href="${esc(p.href)}">
              <strong>${esc(p.titulo)}</strong>
              <span>${esc(p.texto)}</span>
              <em>${esc(p.acao)}</em>
            </a>`).join("")}
        </div>
        <div class="citizen-report__lai">
          <strong>Pergunta pronta para pedir informação</strong>
          <p>Solicito cópia dos contratos, anexos, termos de referência, empenhos, liquidações, notas fiscais, comprovantes de pagamento e relatórios de fiscalização dos itens destacados no Painel Fiscaliza Varginha, informando objeto, fornecedor, valor, secretaria responsável, local de execução e situação atual.</p>
        </div>`;
    };
    emendas
      .filter(e => (cruzMap[e.numero + "/" + e.ano] || {}).status === "sem_pagamento")
      .sort((a, b) => (b.valor_brl || 0) - (a.valor_brl || 0))
      .slice(0, 8)
      .forEach(e => addSignal(
        "Câmara + Prefeitura",
        "alto",
        `Emenda sem pagamento localizado: ${e.beneficiario || "beneficiário não identificado"}`,
        `A emenda ${e.numero}/${e.ano}, de ${e.autor || "autor não identificado"}, tem CNPJ informado, mas o cruzamento não encontrou pagamento da Prefeitura para esse CNPJ nos dados carregados.`,
        `${fmtBRL(e.valor_brl)} · CNPJ ${e.cnpj || "não informado"}`,
        e.pdf
      ));

    emendas
      .filter(e => (cruzMap[e.numero + "/" + e.ano] || {}).status === "sem_cnpj" || !e.cnpj)
      .sort((a, b) => (b.valor_brl || 0) - (a.valor_brl || 0))
      .slice(0, 4)
      .forEach(e => addSignal(
        "Câmara",
        "medio",
        `Emenda dificulta conferência por falta de CNPJ: ${e.beneficiario || "beneficiário não identificado"}`,
        `Sem CNPJ estruturado, o cidadão não consegue cruzar promessa e pagamento com segurança usando o Portal de Transparência.`,
        `${fmtBRL(e.valor_brl)} · Sem CNPJ`,
        e.pdf
      ));

    contratosDestaque
      .filter(c => c.custo_diario > 10000)
      .sort((a, b) => b.custo_diario - a.custo_diario)
      .slice(0, 5)
      .forEach(c => addSignal(
        "Contratos",
        "medio",
        `Custo diário elevado: ${esc(c.contratado)}`,
        `O contrato ${c.numero}/${c.ano} tem um custo estimado de ${fmtBRL(c.custo_diario)} por dia de vigência. Objeto: ${esc(cleanText(c.objeto))}`,
        `${fmtBRL(c.valor)} total · ${c.data_assinatura} a ${c.data_fim}`,
        null
      ));

    const porCnpj = {};
    emendas.forEach(e => {
      const cnpj = e.cnpj || "";
      if (!cnpj) return;
      porCnpj[cnpj] ||= { cnpj, valor: 0, qtd: 0, nomes: new Set() };
      porCnpj[cnpj].valor += e.valor_brl || 0;
      porCnpj[cnpj].qtd += 1;
      if (e.beneficiario) porCnpj[cnpj].nomes.add(e.beneficiario);
    });
    Object.values(porCnpj)
      .filter(x => x.qtd >= 3 || x.valor >= 300_000)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 6)
      .forEach(x => addSignal(
        "Câmara",
        "medio",
        `Concentração de emendas no mesmo CNPJ`,
        `O mesmo CNPJ aparece em ${x.qtd} emendas. Isso pode ser normal, especialmente em saúde e assistência social, mas merece transparência sobre execução e finalidade.`,
        `${fmtBRL(x.valor)} · CNPJ ${x.cnpj} · ${Array.from(x.nomes).slice(0, 2).join("; ")}`,
        "camara.html"
      ));

    contratos
      .filter(c => (c.valor || 0) >= 5_000_000)
      .sort((a, b) => (b.valor || 0) - (a.valor || 0))
      .slice(0, 8)
      .forEach(c => addSignal(
        "Prefeitura",
        /dispensa/i.test(c.modalidade || "") ? "alto" : "medio",
        `Contrato de alto valor: ${c.contratado || "contratado não informado"}`,
        `${c.modalidade || "Modalidade não informada"}. Confira objeto, vigência, aditivos e pagamentos relacionados.`,
        `${fmtBRL(c.valor)} · Contrato ${c.numero || "s/n"}/${c.ano || ""}`,
        "prefeitura.html"
      ));

    contratos
      .filter(c => /dispensa/i.test(c.modalidade || "") && (c.valor || 0) >= 500_000)
      .sort((a, b) => (b.valor || 0) - (a.valor || 0))
      .slice(0, 5)
      .forEach(c => addSignal(
        "Prefeitura",
        "alto",
        `Dispensa relevante: ${c.contratado || "contratado não informado"}`,
        `Dispensas podem ser legais, mas valores altos exigem justificativa clara, prazo, objeto e documentação pública.`,
        `${fmtBRL(c.valor)} · ${c.objeto || "Objeto não informado"}`,
        "prefeitura.html"
      ));

    licitacoes
      .filter(l => (l.valor || 0) >= 500_000)
      .sort((a, b) => (b.valor || 0) - (a.valor || 0))
      .slice(0, 10)
      .forEach(l => addSignal(
        "Prefeitura",
        (l.valor || 0) >= 1_000_000 ? "alto" : "medio",
        `Licitação em andamento: ${l.modalidade || "modalidade não informada"} ${l.numero || ""}`,
        `Processo ainda em andamento ou aguardando abertura. Este é o melhor momento para acompanhar edital, impugnações, participantes e resultado final.`,
        `${fmtBRL(l.valor)} · ${l.situacao || "situação não informada"}`,
        "prefeitura.html"
      ));

    (pncp.compras || [])
      .filter(x => (x.valor_estimado || 0) >= 1_000_000)
      .sort((a, b) => (b.valor_estimado || 0) - (a.valor_estimado || 0))
      .slice(0, 6)
      .forEach(x => {
        const cnpjClean = (x.cnpj || "").replace(/[^\d]/g, "");
        const pncpUrl = cnpjClean
          ? `https://pncp.gov.br/app/contratos?q=${cnpjClean}`
          : "https://pncp.gov.br/app/contratos?q=varginha+mg";
        addSignal(
          "PNCP",
          "medio",
          `Registro nacional: ${x.modalidade || "modalidade não informada"}`,
          `O PNCP registra contratação pública ligada a Varginha. Compare objeto, valor e situação com os dados do portal municipal.`,
          `${fmtBRL(x.valor_estimado)} · ${x.situacao || "situação não informada"}`,
          pncpUrl
        );
      });

    (cnpjs.empresas || [])
      .filter(e => e.situacao && !/ativa/i.test(e.situacao))
      .slice(0, 8)
      .forEach(e => addSignal(
        "CNPJ",
        "alto",
        `CNPJ de beneficiário com situação diferente de ativa`,
        `O apoio cadastral retornou situação "${e.situação}". Antes de concluir qualquer coisa, confirme no comprovante oficial da Receita Federal.`,
        `${e.cnpj} · ${e.razao_social || e.nomes_no_sapl?.[0] || "nome não informado"} · emendas: ${fmtBRL(e.valor_emendas || 0)}`,
        "https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp"
      ));

    // ---- CÂMARA: alertas cívicos baseados em camara_betha + pessoal ----
    const cb2 = D.camara_betha || {};
    const camPessoal = (D.pessoal || {}).camara || {};
    const camResumoP = camPessoal.resumo || {};
    const prefPessoal = (D.pessoal || {}).prefeitura || {};
    const prefResumoP = prefPessoal.resumo || {};

    // 1) Comissionados: 47% da Câmara vs 0.2% da Prefeitura
    const camComQtd  = camResumoP.comissionados_qtd  || 0;
    const camServQtd = camResumoP.servidores_qtd      || 1;
    const prefComQtd  = prefResumoP.comissionados_qtd  || 0;
    const prefServQtd = prefResumoP.servidores_qtd     || 1;
    if (camComQtd > 0) {
      const pctCam  = ((camComQtd  / camServQtd)  * 100).toFixed(1);
      const pctPref = ((prefComQtd / prefServQtd) * 100).toFixed(1);
      addSignal(
        "CÂMARA · Pessoal",
        pctCam >= 30 ? "critico" : "alto",
        `${camComQtd} comissionados em ${camServQtd} servidores da Câmara (${pctCam}%)`,
        `Proporção de cargos comissionados ou similares na Câmara Municipal é ${pctCam}% — contra ${pctPref}% na Prefeitura (${prefComQtd} em ${prefServQtd} servidores). Câmara Municipal legislativa deveria ter quadro enxuto; proporção alta merece explicação pública.`,
        `Folha comissionados Câmara: ${fmtBRL(camResumoP.folha_bruta_comissionados || 0)} · Folha total: ${fmtBRL(camResumoP.folha_bruta_total || 0)}`,
        "camara.html"
      );
    }

    // 2) Maior vencimento comissionado Câmara
    const maiorCom = camResumoP.maior_vencimento_comissionado || 0;
    if (maiorCom > 20000) {
      addSignal(
        "CÂMARA · Pessoal",
        "alto",
        `Maior vencimento comissionado da Câmara: ${fmtBRL(maiorCom)}/mês`,
        `O servidor comissionado mais bem remunerado da Câmara Municipal recebe ${fmtBRL(maiorCom)} por mês. O teto do funcionalismo federal é ~R$ 44.000. Cargo e função devem ser verificados na fonte oficial.`,
        "Fonte: Portal de Transparência da Câmara (Betha) · Pessoal",
        "https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324767"
      );
    }

    // 3) Top fornecedor externo real da Câmara (excluindo internos)
    const topCamExt = (cb2.top_fornecedores_atual || []).filter(f =>
      !/^C[AÂ]MARA MUNICIPAL|^FUNDO MUNICIPAL/i.test(f.nome || "")
    );
    if (topCamExt.length > 0) {
      const f1 = topCamExt[0];
      addSignal(
        "CÂMARA · Fornecedor",
        "medio",
        `${f1.nome}: ${fmtBRL(f1.valor_total)} maior fornecedor externo da Câmara em ${cb2.ano_atual || ""}`,
        `Em ${cb2.ano_atual || ""}, ${f1.nome} foi o principal fornecedor externo da Câmara de Varginha. Verifique os contratos firmados e se o objeto das despesas está claro e publicado.`,
        `Total pago pela Câmara a fornecedores externos em ${cb2.ano_atual || ""}: ${fmtBRL(cb2.total_externo_atual || 0)}`,
        "camara.html"
      );
    }

    // 4) Câmara: empenho único de alto valor (qtd=1, valor >= R$200K)
    (cb2.top_fornecedores_atual || [])
      .filter(f => f.qtd === 1 && (f.valor_total || 0) >= 200_000 &&
        !/^C[AÂ]MARA MUNICIPAL|^FUNDO MUNICIPAL/i.test(f.nome || ""))
      .forEach(f => addSignal(
        "CÂMARA · Fornecedor",
        "alto",
        `${f.nome}: ${fmtBRL(f.valor_total)} em empenho único`,
        `Este fornecedor recebeu ${fmtBRL(f.valor_total)} da Câmara em um único empenho em ${cb2.ano_atual || ""}. Empenhos únicos de valor alto sem processo licitatório visível merecem verificação do contrato e do objeto da despesa.`,
        `1 empenho · Câmara ${cb2.ano_atual || ""}`,
        "camara.html"
      ));

    // 5) Contratos emergenciais de alto valor (Prefeitura)
    contratos
      .filter(c => /emergencial/i.test(c.modalidade || "") && (c.valor || 0) >= 500_000)
      .sort((a, b) => (b.valor || 0) - (a.valor || 0))
      .slice(0, 5)
      .forEach(c => addSignal(
        "Prefeitura",
        "alto",
        `Contrato emergencial: ${c.contratado || "contratado não informado"}`,
        `Contratos emergenciais dispensam licitação e exigem urgência comprovada. Verifique a justificativa publicada no Diário Oficial, prazo, valor e execução real do serviço.`,
        `${fmtBRL(c.valor)} · ${c.objeto || "Objeto não informado"} · ${c.numero || "s/n"}/${c.ano || ""}`,
        "prefeitura.html"
      ));

    // 6) Contratos com data_fim vencida mas status EXECUCAO
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const vencidosAtivos = contratos.filter(c => {
      if (!/EXECUCAO/i.test(c.situacao || "")) return false;
      const fim = c.data_fim ? new Date(c.data_fim) : null;
      return fim && fim < hoje;
    }).sort((a, b) => (b.valor || 0) - (a.valor || 0));

    vencidosAtivos.slice(0, 6).forEach(c => {
      const diasVencido = Math.floor((hoje - new Date(c.data_fim)) / 86_400_000);
      addSignal(
        "Prefeitura · Contrato",
        (c.valor || 0) >= 1_000_000 ? "critico" : "alto",
        `Contrato vencido em execução: ${cleanText(c.contratado || "Empresa não informada")}`,
        `Contrato com ${cleanText(c.contratado || "empresa")} (${fmtBRL(c.valor || 0)}) tinha encerramento previsto para ${c.data_fim} mas ainda aparece como "em execução" há ${diasVencido} dia(s). Contratos vencidos sem aditivo publicado podem configurar irregularidade. Verifique se houve prorrogação no Diário Oficial.`,
        `${fmtBRL(c.valor || 0)} · Venceu ${c.data_fim} (${diasVencido}d atrás) · ${cleanText(c.objeto || "").slice(0, 80)}`,
        "prefeitura.html"
      );
    });

    // 7) Fracionamento: mesmo fornecedor com 3+ dispensas eletrônicas
    const dispensaMap = new Map();
    contratos
      .filter(c => /dispensa/i.test(c.modalidade || ""))
      .forEach(c => {
        const cnpj = (c.cnpj || "").replace(/[^\d]/g, "").slice(0, 8) || norm(c.contratado);
        const cur = dispensaMap.get(cnpj) || { nome: cleanText(c.contratado || "Fornecedor"), cnpj: c.cnpj || "", total: 0, qtd: 0, objetos: [] };
        cur.total += Number(c.valor || 0);
        cur.qtd   += 1;
        if (cur.objetos.length < 3) cur.objetos.push(cleanText(c.objeto || "").slice(0, 50));
        dispensaMap.set(cnpj, cur);
      });
    [...dispensaMap.values()]
      .filter(f => f.qtd >= 4)
      .sort((a, b) => b.qtd - a.qtd)
      .slice(0, 4)
      .forEach(f => addSignal(
        "Prefeitura · Dispensa",
        f.qtd >= 7 ? "alto" : "medio",
        `${f.nome}: ${f.qtd} dispensas eletrônicas (R$ ${fmtBRL(f.total)})`,
        `O fornecedor ${f.nome} recebeu ${f.qtd} contratos por dispensa eletrônica totalizando ${fmtBRL(f.total)}. Múltiplas dispensas ao mesmo fornecedor em objetos distintos podem indicar fracionamento de compras para evitar licitação. Objetos: ${f.objetos.join("; ")}.`,
        `${f.qtd} dispensas · ${fmtBRL(f.total)} total · CNPJ ${f.cnpj}`,
        "prefeitura.html"
      ));

    // 8) Shows e artistas por inexigibilidade
    const showContratos = contratos.filter(c =>
      /inexigib/i.test(c.modalidade || "") &&
      /show|artista|musical|dupla|banda|sertanejo|rodeio|reveillon|carnaval|festa|aniversario|festejos/i.test(c.objeto || "")
    ).sort((a, b) => (b.valor || 0) - (a.valor || 0));
    const totalShows = showContratos.reduce((s, c) => s + Number(c.valor || 0), 0);
    if (showContratos.length > 0) {
      addSignal(
        "Prefeitura · Eventos",
        totalShows >= 1_000_000 ? "alto" : "medio",
        `${showContratos.length} contrato(s) de shows/artistas por inexigibilidade: ${fmtBRL(totalShows)}`,
        `A Prefeitura contratou ${showContratos.length} show(s) ou apresentação(ões) artística(s) por inexigibilidade de licitação, totalizando ${fmtBRL(totalShows)}. Inexigibilidade exige exclusividade comprovada do artista. Verifique publicidade, justificativas e se os valores foram compatíveis com o mercado. Destaques: ${showContratos.slice(0, 3).map(c => cleanText(c.contratado || "")).join("; ")}.`,
        `${showContratos.length} shows · ${fmtBRL(totalShows)} total · Inexigibilidade de licitação`,
        "prefeitura.html"
      );
    }

    // ---- DIÁRIAS: acumulado por servidor (excluindo TFD/saude) ----
    const diariasCamAll  = (D.diarias || {}).camara     || [];
    const diariasPrefAll = (D.diarias || {}).prefeitura || [];
    const isTFD = (d) => /tratamento fora do domic|TFD/i.test(d.finalidade || "");

    // Câmara — acumular por pessoa
    const acumCam = new Map();
    diariasCamAll.forEach(d => {
      const k = (d.funcionario || "Desconhecido").trim();
      const cur = acumCam.get(k) || { nome: k, total: 0, qtd: 0 };
      cur.total += Number(d.valor_total || 0);
      cur.qtd   += 1;
      acumCam.set(k, cur);
    });
    [...acumCam.values()]
      .filter(p => p.total >= 15_000)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .forEach(p => addSignal(
        "CÂMARA · Diárias",
        p.total >= 25_000 ? "alto" : "medio",
        `${p.nome}: ${fmtBRL(p.total)} acumulado em diárias`,
        `Este servidor ou vereador acumulou ${fmtBRL(p.total)} em ${p.qtd} registro(s) de diárias na Câmara. Diárias de alto valor acumulado merecem conferência de destinos, finalidades e comprovantes no portal de transparência.`,
        `${p.qtd} diária(s) · Câmara Municipal`,
        "camara.html"
      ));

    // Prefeitura — acumular por pessoa, excluindo TFD (saude legítima)
    const acumPref = new Map();
    diariasPrefAll.filter(d => !isTFD(d)).forEach(d => {
      const k = (d.funcionario || "Desconhecido").trim();
      const cur = acumPref.get(k) || { nome: k, total: 0, qtd: 0, secretaria: d.secretaria || "" };
      cur.total += Number(d.valor_total || 0);
      cur.qtd   += 1;
      acumPref.set(k, cur);
    });
    [...acumPref.values()]
      .filter(p => p.total >= 30_000)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .forEach(p => addSignal(
        "Prefeitura · Diárias",
        p.total >= 70_000 ? "alto" : "medio",
        `${p.nome}: ${fmtBRL(p.total)} acumulado em diárias`,
        `Este servidor acumulou ${fmtBRL(p.total)} em diárias na Prefeitura (${p.qtd} registro(s)). Valores altos acumulados por servidor individual merecem conferência de finalidade, destinos, liquidações e comprovantes publicados. Total exclui despesas de Tratamento Fora do Domicílio (TFD/saúde).`,
        `${p.qtd} registro(s) · ${p.secretaria || "Prefeitura"} · Exclui TFD`,
        "prefeitura.html"
      ));

    // Cross-ref: comissionado com alto salario E alto acúmulo de diarias
    const camServidores = ((D.pessoal || {}).camara || {}).servidores || [];
    camServidores
      .filter(s => s.comissionado_ou_similar && (s.vencimentos || 0) > 20_000)
      .forEach(s => {
        const totalDiarias = acumCam.get((s.nome || "").trim())?.total || 0;
        if (totalDiarias > 5_000) {
          addSignal(
            "CÂMARA · Custo Real",
            "alto",
            `${s.nome}: ${fmtBRL(s.vencimentos)}/mês + ${fmtBRL(totalDiarias)} em diárias`,
            `${s.nome} é comissionado na Câmara com vencimento de ${fmtBRL(s.vencimentos)}/mês. Além do salário, acumulou ${fmtBRL(totalDiarias)} em diárias. O custo total para os cofres públicos supera o vencimento aparente. Cargo: ${s.cargo || "não informado"}.`,
            `Salário ${fmtBRL(s.vencimentos)}/mês · Diárias ${fmtBRL(totalDiarias)} acumulado`,
            "pessoal.html"
          );
        }
      });

    renderResumoCidadao();

    if ($("relatorioResumo")) {
      $("relatorioResumo").innerHTML = [
        { cls: "stat--gold", v: fmtNum(sinais.length), l: "Sinais listados", s: "Triagem automatica" },
        { cls: "stat--teal", v: fmtNum(cs.sem_pagamento || 0), l: "Emendas sem pagamento localizado", s: "Promessa x pagamento" },
        { cls: "stat--navy", v: fmtNum(contratos.filter(c => (c.valor || 0) >= 1_000_000).length), l: "Contratos acima de R$ 1 mi", s: "Prefeitura" },
        { cls: "stat--gold", v: fmtNum(((pncp.resumo || {}).compras_qtd || 0) + ((pncp.resumo || {}).contratos_qtd || 0)), l: "Registros PNCP", s: "Base nacional" },
      ].map(s => `
        <div class="stat ${s.cls}">
          <div class="stat__value">${s.v}</div>
          <div class="stat__label">${s.l}</div>
          <div class="stat__sub">${s.s}</div>
        </div>`).join("");
    }

    if ($("prioridadesFiscalizacao")) {
      const locacaoImovel = (c) => {
        const txt = norm([c.objeto, c.contratado, c.modalidade, c.tipo, c.entidade].filter(Boolean).join(" "));
        const loc = ["locacao", "locar", "aluguel", "alugar", "locado"].some(k => txt.includes(k));
        const imovel = ["imovel", "predio", "sala comercial", "salao", "casa", "terreno", "galpao", "barracao"].some(k => txt.includes(k));
        const excluir = ["veiculo", "som", "luz", "decoracao", "equipamento", "brinquedo", "comodato", "fralda", "palco", "tenda", "banheiro"].some(k => txt.includes(k));
        return loc && imovel && !excluir;
      };
      const entidadesQtd = new Set(emendas.map(e => cnpjRoot(e.cnpj) || norm(e.beneficiario)).filter(Boolean)).size;
      const emendasPendentes = emendas.filter(e => ["sem_pagamento", "sem_cnpj"].includes((cruzMap[e.numero + "/" + e.ano] || {}).status)).length;
      const contratosAltosQtd = contratos.filter(c => (c.valor || 0) >= 1_000_000).length;
      const alugueis = contratos.filter(locacaoImovel);
      const eventos = contratos.filter(c => /show|evento|artista|palco|sonorizacao|iluminacao|rodeio|carnaval|natal|reveillon/i.test(norm(c.objeto || "")));
      const educacao = contratos.filter(c => /fundeb|educacao|escola|escolar|creche|cemei|ensino|merenda|transporte escolar/i.test(norm(c.objeto || "")));
      const prioridades = [
        {
          kind: "ONGs e entidades",
          title: "Quem mais recebeu emendas",
          body: "Veja quantidade de emendas, valor total, vereadores autores e pagamento localizado por CNPJ.",
          meta: `${fmtNum(entidadesQtd)} entidades/beneficiarios mapeados`,
          href: "relatorios.html#ranking-entidades",
          level: "medio",
        },
        {
          kind: "Emendas",
          title: "Promessa sem pagamento localizado",
          body: "Priorize emendas com CNPJ ausente ou sem pagamento encontrado no cruzamento com a Prefeitura.",
          meta: `${fmtNum(emendasPendentes)} emendas para conferir`,
          href: "camara.html",
          level: emendasPendentes ? "alto" : "medio",
        },
        {
          kind: "Contratos",
          title: "Contratos acima de R$ 1 milhão",
          body: "Confira objeto, aditivos, vigência, notas fiscais, liquidacoes e entrega real do serviço.",
          meta: `${fmtNum(contratosAltosQtd)} contratos de alto valor`,
          href: "prefeitura.html",
          level: contratosAltosQtd ? "alto" : "medio",
        },
        {
          kind: "Alugueis",
          title: "Imóveis alugados pela Prefeitura",
          body: "Confira endereço, finalidade, prazo, custo mensal estimado e se o imóvel está sendo usado.",
          meta: `${fmtNum(alugueis.length)} imóveis classificados na base atual`,
          href: "prefeitura.html#alugueisBlock",
          level: "medio",
        },
        {
          kind: "Eventos",
          title: "Shows, eventos e estruturas",
          body: "Verifique cachês, estruturas, fornecedores recorrentes, objeto e prestação do serviço.",
          meta: `${fmtNum(eventos.length)} contratos/eventos identificados`,
          href: "prefeitura.html#eventosBlock",
          level: "medio",
        },
        {
          kind: "Educação",
          title: "FUNDEB, escolas e educação",
          body: "Peça fonte de recurso, escola beneficiada, empenho, liquidação e comprovação da entrega.",
          meta: `${fmtNum(educacao.length)} registros ligados a educação/escolas`,
          href: "relatorios.html#ranking-entidades",
          level: "medio",
        },
      ];
      $("prioridadesFiscalizacao").innerHTML = prioridades.map(p => `
        <article class="signal signal--${p.level}">
          <div class="signal__top">
            <span class="signal__kind">${esc(p.kind)}</span>
            <span class="signal__level">Comece aqui</span>
          </div>
          <h4>${esc(p.title)}</h4>
          <p>${esc(p.body)}</p>
          <div class="signal__meta">${esc(p.meta)}</div>
          <a href="${esc(p.href)}">Abrir trilha -></a>
        </article>`).join("");
    }

    if ($("fontesEmendas2026Resumo") || $("fontesEmendas2026Achados")) {
      const r = fontesEmendas2026.resumo || {};
      const achados2026 = fontesEmendas2026.achados || [];
      const fontes2026 = fontesEmendas2026.fontes_verificadas || [];
      const listaEstruturada = !!r.lista_estruturada_encontrada;
      const conclusao = r.conclusao || "Rode o coletor para verificar as fontes abertas sobre emendas impositivas 2026.";
      if ($("fontesEmendas2026Resumo")) {
        $("fontesEmendas2026Resumo").innerHTML = [
          { cls: listaEstruturada ? "stat--teal" : "stat--gold", v: listaEstruturada ? "Sim" : "Não", l: "Lista estruturada encontrada", s: "Entidade + CNPJ + valor + execução" },
          { cls: "stat--navy", v: fmtNum(r.fontes_ok || 0), l: "Fontes abertas consultadas", s: `${fmtNum(r.fontes_verificadas || fontes2026.length || 0)} mapeadas` },
          { cls: "stat--gold", v: fmtNum(r.achados_qtd || achados2026.length || 0), l: "Pistas documentais", s: "Leis, decretos, editais ou paginas" },
          { cls: "stat--teal", v: fmtNum(r.candidatos_com_valor_cnpj || 0), l: "Candidatos com CNPJ e valor", s: "Precisam de conferência manual" },
        ].map(s => `
          <div class="stat ${s.cls}">
            <div class="stat__value">${s.v}</div>
            <div class="stat__label">${s.l}</div>
            <div class="stat__sub">${s.s}</div>
          </div>`).join("");
      }
      if ($("fontesEmendas2026Achados")) {
        const perguntaEmendas2026 = "Solicito a relação completa das emendas impositivas municipais destinadas ao orçamento de 2026, contendo número da emenda, vereador autor, entidade/órgão beneficiário, CNPJ, valor, objeto, secretaria responsável, fonte de recurso, plano de trabalho, empenhos, liquidações, pagamentos e estágio atual de execução.";
        const cardsAchados = achados2026.slice(0, 10).map(a => `
          <article class="signal signal--${a.tipo === "lista estruturada possivel" ? "alto" : "medio"}">
            <div class="signal__top">
              <span class="signal__kind">${esc(a.origem || "Fonte publica")}</span>
              <span class="signal__level">${esc(a.tipo || "pista")}</span>
            </div>
            <h4>${esc(a.titulo || "Documento relacionado")}</h4>
            <p>${esc(a.trecho || a.sinal || "Fonte relacionada a emendas impositivas 2026.")}</p>
            <div class="signal__meta">${esc(a.sinal || "")}${a.tem_cnpj ? " · contem CNPJ" : ""}${a.tem_valor ? " · contem valor" : ""}</div>
            ${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">Abrir fonte oficial</a>` : ""}
          </article>`).join("");
        const fontesCards = fontes2026.map(f => `
          <article class="signal signal--${f.status === "ok" ? "medio" : "alto"}">
            <div class="signal__top">
              <span class="signal__kind">Fonte verificada</span>
              <span class="signal__level">${esc(f.status || "status")}</span>
            </div>
            <h4>${esc(f.nome || "Fonte publica")}</h4>
            <p>${esc(f.resultado || "Sem resultado informado.")}</p>
            ${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">Abrir fonte</a>` : ""}
          </article>`).join("");
        $("fontesEmendas2026Achados").innerHTML = `
          <article class="signal signal--${listaEstruturada ? "medio" : "alto"} signal--wide">
            <div class="signal__top">
              <span class="signal__kind">Conclusao da busca</span>
              <span class="signal__level">${listaEstruturada ? "Importar com conferência" : "Pedir por LAI"}</span>
            </div>
            <h4>${listaEstruturada ? "Há candidato de lista estruturada" : "Lista aberta consolidada ainda não localizada"}</h4>
            <p>${esc(conclusao)}</p>
            <div class="signal__meta">Pergunta pronta: ${esc(perguntaEmendas2026)}</div>
          </article>
          ${cardsAchados || fontesCards || '<div class="empty">Rode o coletor para consultar as fontes abertas de 2026.</div>'}`;
      }
    }

    const classificaEducacao = (item) => {
      const texto = norm([item.objeto, item.contratado, item.fornecedor, item.modalidade, item.entidade].filter(Boolean).join(" "));
      const hit = /(fundeb|educacao|escola|escolar|creche|cemei|ensino|aluno|professor|seduc|merenda|generos alimenticios|transporte escolar|kit escolar|uniforme|material didatico|biblioteca)/i.test(texto);
      if (!hit) return null;
      if (/(obra|reforma|ampliacao|construcao|quadra|cobertura|telhado|pintura|piso|manutencao predial|engenharia)/i.test(texto)) return "Obra/manutenção escolar";
      if (/(merenda|generos alimenticios|alimentacao|agricultura familiar)/i.test(texto)) return "Alimentacao escolar";
      if (/(transporte escolar|veiculo escolar|onibus|van|motorista)/i.test(texto)) return "Transporte escolar";
      if (/(kit escolar|material didatico|uniforme|livro|apostila|mobiliario|equipamento|informatica|computador)/i.test(texto)) return "Material/equipamento escolar";
      if (/(servente|professor|diretor|coordenador|psicolog|fono|profissional|mao de obra|servicos continuos)/i.test(texto)) return "Pessoal/serviço educacional";
      if (/fundeb/i.test(texto)) return "FUNDEB citado";
      return "Educação - outros";
    };

    if ($("fundebResumo") || $("fundebInvestimentos")) {
      const itensEducacao = [
        ...contratos.map(c => ({ ...c, origem: "Contrato Prefeitura", valor_analise: c.valor || 0 })),
        ...licitacoes.map(l => ({ ...l, contratado: l.fornecedor || l.contratado || "Processo em andamento", origem: "Licitacao Prefeitura", valor_analise: l.valor || 0 })),
        ...((pncp.compras || []).map(x => ({ ...x, contratado: x.fornecedor || x.nome_fornecedor || "PNCP", origem: "PNCP compras", valor_analise: x.valor_estimado || x.valor || 0 }))),
        ...((pncp.contratos || []).map(x => ({ ...x, contratado: x.fornecedor || x.nome_fornecedor || "PNCP", origem: "PNCP contratos", valor_analise: x.valor || 0 }))),
      ].map(item => ({ ...item, categoriaEducacao: classificaEducacao(item) }))
       .filter(item => item.categoriaEducacao);

      const totalEducacao = itensEducacao.reduce((s, item) => s + (item.valor_analise || 0), 0);
      const comFundeb = itensEducacao.filter(item => /fundeb/i.test([item.objeto, item.entidade].join(" ")));
      const escolasDireto = itensEducacao.filter(item => /escola|creche|cemei|educacao|ensino|aluno/i.test([item.objeto, item.entidade].join(" ")));
      const categoriasEducacao = agruparRelatorio(itensEducacao, item => item.categoriaEducacao, item => item.valor_analise || 0);

      if ($("fundebResumo")) {
        $("fundebResumo").innerHTML = [
          { cls: "stat--teal", v: fmtBRL(totalEducacao), l: "Valor ligado a educação", s: `${fmtNum(itensEducacao.length)} registros mapeados` },
          { cls: "stat--gold", v: fmtNum(comFundeb.length), l: "FUNDEB citado no texto", s: "Exige conferência na fonte contábil" },
          { cls: "stat--navy", v: fmtNum(escolasDireto.length), l: "Escola/creche/aluno citados", s: "Indício de aplicação direta" },
          { cls: "stat--gold", v: fmtNum(categoriasEducacao.length), l: "Categorias de gasto", s: "Obra, merenda, transporte, material etc." },
        ].map(s => `
          <div class="stat ${s.cls}">
            <div class="stat__value">${s.v}</div>
            <div class="stat__label">${s.l}</div>
            <div class="stat__sub">${s.s}</div>
          </div>`).join("");
      }

      if ($("fundebInvestimentos")) {
        const perguntaFundeb = "Solicito relatório detalhado da aplicação dos recursos do FUNDEB em Varginha, por escola/unidade, contrato, empenho, liquidação, pagamento, fonte de recurso, objeto, fornecedor, etapa de execução e documento comprobatório, separando remuneração, manutenção, obras, transporte, merenda, materiais e equipamentos.";
        const topEducacao = itensEducacao
          .sort((a, b) => (b.valor_analise || 0) - (a.valor_analise || 0))
          .slice(0, 12);
        $("fundebInvestimentos").innerHTML = `
          <article class="signal signal--medio signal--wide">
            <div class="signal__top">
              <span class="signal__kind">Pergunta pronta</span>
              <span class="signal__level">LAI / e-SIC</span>
            </div>
            <h4>Como cobrar para onde vai o dinheiro do FUNDEB</h4>
            <p>${esc(perguntaFundeb)}</p>
            <div class="signal__meta">Use esta pergunta para pedir a vinculação entre fonte FUNDEB, escola beneficiada, contrato e pagamento.</div>
          </article>
          ${categoriasEducacao.slice(0, 6).map(c => `
            <article class="signal signal--medio">
              <div class="signal__top">
                <span class="signal__kind">Categoria educação</span>
                <span class="signal__level">${fmtNum(c.qtd)} registro${c.qtd === 1 ? "" : "s"}</span>
              </div>
              <h4>${esc(c.nome)}</h4>
              <p>Grupo de contratos/licitações ligados Ã  educacao. Conferir se há escola/unidade, fonte de recurso e entrega comprovada.</p>
              <div class="signal__meta">${fmtBRL(c.valor)}</div>
            </article>`).join("")}
          ${topEducacao.map(item => `
            <article class="signal signal--${(item.valor_analise || 0) >= 1_000_000 ? "alto" : "medio"}">
              <div class="signal__top">
                <span class="signal__kind">${esc(item.categoriaEducacao)}</span>
                <span class="signal__level">${esc(item.origem || "Fonte pública")}</span>
              </div>
              <h4>${esc(item.contratado || item.fornecedor || "Contratado não informado")}</h4>
              <p>${esc(item.objeto || "Objeto não informado")}</p>
              <div class="signal__meta">${fmtBRL(item.valor_analise || 0)} · ${esc(item.modalidade || item.situacao || "modalidade/situação não informada")}</div>
            </article>`).join("")}`;
      }
    }

    if ($("rankingEntidadesEmendas")) {
      const entidades = {};
      const entidadeKeyRelatorio = (e) => cnpjRoot(e.cnpj) || norm(e.beneficiario || e.nome || "sem beneficiario");
      const valorPagoCruzamentoRelatorio = (cruz, anoPagamento) => {
        if (!cruz) return 0;
        if (!anoPagamento) return cruz.valor_pago_total || 0;
        return (cruz.pagamentos || [])
          .filter(p => String(p.ano) === String(anoPagamento))
          .reduce((s, p) => s + (p.valor || 0), 0);
      };
      emendas.forEach(e => {
        const key = entidadeKeyRelatorio(e);
        if (!key) return;
        entidades[key] ||= {
          nome: e.beneficiario || "Beneficiário não identificado",
          cnpj: e.cnpj || "",
          valor: 0,
          qtd: 0,
          autores: new Set(),
          objetos: [],
          pago: 0,
          pagamentoLocalizado: 0,
          semPagamento: 0,
        };
        entidades[key].valor += e.valor_brl || 0;
        entidades[key].qtd += 1;
        if (e.autor) e.autor.split(",").map(x => x.trim()).filter(Boolean).forEach(a => entidades[key].autores.add(a));
        if (e.objeto) entidades[key].objetos.push(e.objeto);
        const cruz = cruzMap[e.numero + "/" + e.ano] || {};
        if (cruz.status === "encontrado") {
          entidades[key].pago += 1;
          entidades[key].pagamentoLocalizado += cruz.valor_pago_total || 0;
        }
        if (cruz.status === "sem_pagamento") entidades[key].semPagamento += 1;
      });
      const todasEntidades = Object.values(entidades);
      const anoEntidade = $("anoEntidadeEmenda");
      const anoPagamentoEntidade = $("anoPagamentoEntidade");
      const filtroEntidade = $("filtroEntidadeEmenda");
      const ordenarEntidade = $("ordenarEntidadeEmenda");
      const limiteEntidade = $("limiteEntidadeEmenda");
      const contadorEntidade = $("entidadesEmendasContador");

      const renderRankingEntidades = () => {
        const q = norm(filtroEntidade.value || "");
        const ano = anoEntidade.value || "";
        const anoPagamento = anoPagamentoEntidade.value || "";
        const criterio = ordenarEntidade.value || "valor";
        const limite = Number(limiteEntidade.value || 20);
        let ranking = todasEntidades.map(e => {
          const itens = emendas.filter(em =>
            entidadeKeyRelatorio(em) === (cnpjRoot(e.cnpj) || norm(e.nome || "sem beneficiario")) &&
            (!ano || String(em.ano) === ano)
          );
          const autores = new Set();
          let valor = 0, pago = 0, pagamentoLocalizado = 0, semPagamento = 0;
          itens.forEach(em => {
            valor += em.valor_brl || 0;
            if (em.autor) em.autor.split(",").map(x => x.trim()).filter(Boolean).forEach(a => autores.add(a));
            const cruz = cruzMap[em.numero + "/" + em.ano] || {};
            const pagoAno = valorPagoCruzamentoRelatorio(cruz, anoPagamento);
            if (pagoAno > 0) { pago += 1; pagamentoLocalizado += pagoAno; }
            if (anoPagamento ? pagoAno <= 0 : cruz.status === "sem_pagamento") semPagamento += 1;
          });
          return { ...e, valor, qtd: itens.length, autores, pago, pagamentoLocalizado, semPagamento };
        }).filter(e => e.qtd > 0).filter(e => {
          const autores = Array.from(e.autores).join(" ");
          return !q || norm([e.nome, e.cnpj, autores].join(" ")).includes(q) ||
            (e.cnpj || "").replace(/\D/g, "").includes(q.replace(/\D/g, ""));
        });
        ranking.sort((a, b) => {
          switch (criterio) {
            case "qtd": return (b.qtd - a.qtd) || (b.valor - a.valor);
            case "pagamento": return (b.pagamentoLocalizado - a.pagamentoLocalizado) || (b.valor - a.valor);
            case "pendencia": return (b.semPagamento - a.semPagamento) || (b.valor - a.valor);
            case "vereadores": return (b.autores.size - a.autores.size) || (b.valor - a.valor);
            default: return (b.valor - a.valor) || (b.qtd - a.qtd);
          }
        });
        const totalValor = ranking.reduce((s, e) => s + e.valor, 0);
        if (contadorEntidade) {
          contadorEntidade.textContent = `${fmtNum(ranking.length)} entidade${ranking.length === 1 ? "" : "s"}${ano ? " em " + ano : ""} · ${fmtBRL(totalValor)}`;
        }
        ranking = ranking.slice(0, limite);
        $("rankingEntidadesEmendas").innerHTML = ranking.length ? ranking.map((e, idx) => {
          const autores = Array.from(e.autores);
          const nivel = e.valor >= 1_000_000 || e.qtd >= 12 || e.semPagamento >= 3 ? "alto" : "medio";
          return `
            <article class="signal signal--${nivel}">
              <div class="signal__top">
                <span class="signal__kind">#${idx + 1} entidade/beneficiário</span>
                <span class="signal__level">${fmtNum(e.qtd)} emenda${e.qtd === 1 ? "" : "s"} · ${fmtNum(autores.length)} vereador${autores.length === 1 ? "" : "es"}</span>
              </div>
              <h4>${esc(e.nome)}</h4>
              <p>Autores: ${esc(autores.slice(0, 8).join(", ") || "não informado")}${autores.length > 8 ? ` e mais ${autores.length - 8}` : ""}. Conferir objeto, plano de trabalho, execução, notas fiscais e entrega ao público.</p>
              <div class="signal__meta">${fmtBRL(e.valor)} em emendas destinadas por vereadores${ano ? " em " + ano : ""} · ${fmtNum(e.pago)} com pagamento localizado${anoPagamento ? " em " + anoPagamento : ""} · ${fmtNum(e.semPagamento)} ${anoPagamento ? "sem pagamento no ano" : "sem pagamento localizado"} · total pago pela Prefeitura ao mesmo CNPJ${anoPagamento ? " em " + anoPagamento : ""}: ${fmtBRL(e.pagamentoLocalizado)} · CNPJ ${esc(e.cnpj || "não informado")}</div>
              <a href="camara.html">Abrir emendas na Camara</a>
            </article>`;
        }).join("") : '<div class="empty">Nenhuma entidade encontrada para esse filtro.</div>';
      };
      filtroEntidade.addEventListener("input", renderRankingEntidades);
      anoEntidade.addEventListener("change", renderRankingEntidades);
      anoPagamentoEntidade.addEventListener("change", renderRankingEntidades);
      ordenarEntidade.addEventListener("change", renderRankingEntidades);
      limiteEntidade.addEventListener("change", renderRankingEntidades);
      renderRankingEntidades();
    }

    if ($("sinaisAtencao")) {
      const lvlVal = { critico: 3, alto: 2, medio: 1 };
      const kindGroups = {};
      sinais.forEach(s => {
        const k = s.kind || "Outros";
        if (!kindGroups[k]) kindGroups[k] = [];
        kindGroups[k].push(s);
      });
      const sortedKinds = Object.keys(kindGroups).sort((a, b) => {
        const maxA = Math.max(...kindGroups[a].map(s => lvlVal[s.level] || 0));
        const maxB = Math.max(...kindGroups[b].map(s => lvlVal[s.level] || 0));
        return maxB - maxA || kindGroups[b].length - kindGroups[a].length;
      });
      const signalCard = (s) => `
        <article class="signal signal--${s.level}">
          <div class="signal__top">
            <span class="signal__kind">${esc(s.kind)}</span>
            <span class="signal__level">${s.level === "critico" ? "CRITICO" : s.level === "alto" ? "Atenção alta" : "Atenção média"}</span>
          </div>
          <h4>${esc(s.title)}</h4>
          <p>${esc(s.body)}</p>
          <div class="signal__meta">${esc(s.meta)}</div>
          ${s.href ? `<a href="${esc(s.href)}" ${/^https:/.test(s.href) ? 'target="_blank" rel="noopener"' : ""}>Conferir fonte ou detalhes</a>` : ""}
        </article>`;
      $("sinaisAtencao").innerHTML = sinais.length ? sortedKinds.map(kind => {
        const items = kindGroups[kind];
        const maxLvl = Math.max(...items.map(s => lvlVal[s.level] || 0));
        const grpCls = maxLvl === 3 ? "critico" : maxLvl === 2 ? "alto" : "medio";
        return `<div class="signals-group">
          <h4 class="signals-group__title signals-group__title--${grpCls}">
            ${esc(kind)} <span class="signals-group__count">${items.length}</span>
          </h4>
          ${items.map(signalCard).join("")}
        </div>`;
      }).join("") : '<div class="empty">Nenhum sinal de atenção gerado com os dados atuais.</div>';
    }

    if ($("statsCamaraRel") && cb2.total_externo_atual != null) {
      $("statsCamaraRel").innerHTML = [
        { v: fmtMi(cb2.total_externo_atual),
          l: `Pago a externos em ${cb2.ano_atual}`, s: "Excluídas transferências internas", cls: "stat--teal" },
        { v: fmtMi(cb2.total_externo_anterior),
          l: `Pago em ${cb2.ano_anterior}`, s: "Comparativo", cls: "stat--navy" },
        { v: fmtNum(cb2.empenhos_qtd || 0),
          l: "Empenhos no portal", s: "Multi-ano", cls: "stat--gold" },
        { v: fmtNum((cb2.contratos || []).length),
          l: "Contratos mapeados", s: `${cb2.ano_atual}`, cls: "stat--navy" },
      ].map(s => `
        <div class="stat ${s.cls}">
          <div class="stat__value">${s.v}</div>
          <div class="stat__label">${s.l}</div>
          <div class="stat__sub">${s.s}</div>
        </div>`).join("");
    }

    if ($("fontesComplementares")) {
      const fonteCards = [
        {
          nome: "PNCP",
          valor: fmtNum(((pncp.resumo || {}).compras_qtd || 0) + ((pncp.resumo || {}).contratos_qtd || 0)),
          desc: pncp.erro ? `Falha na consulta: ${pncp.erro}` : "Contratações e contratos na base nacional.",
          url: "https://pncp.gov.br/",
        },
        {
          nome: "Transparência da Câmara",
          valor: fmtNum(((camaraTransp.resumo || {}).links_mapeados || 0)),
          desc: camaraTransp.erro ? `Falha na consulta: ${camaraTransp.erro}` : "Links oficiais para despesas, contratos, diárias, folha e LAI.",
          url: camaraTransp.url || "https://www.varginha.mg.leg.br/transparencia",
        },
        {
          nome: "CNPJ",
          valor: fmtNum(((cnpjs.resumo || {}).consultados || 0)),
          desc: cnpjs.erro ? `Falha na consulta: ${cnpjs.erro}` : "Apoio cadastral para beneficiários de emendas com CNPJ completo.",
          url: "https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp",
        },
      ];
      $("fontesComplementares").innerHTML = fonteCards.map(f => `
        <a class="source-card" href="${esc(f.url)}" target="_blank" rel="noopener">
          <span class="source-card__value">${esc(f.valor)}</span>
          <h4>${esc(f.nome)}</h4>
          <p>${esc(f.desc)}</p>
        </a>`).join("");
    }

    if ($("federalResumo") || $("federalLinks")) {
      const fed = D.federal || {};
      const fr = fed.resumo || {};
      const fl = fed.links_auditoria || [];
      if ($("federalResumo")) {
        $("federalResumo").innerHTML = [
          { cls: "stat--navy", v: "Ativo", l: "Monitoramento Federal", s: "Uniao para Varginha" },
          { cls: "stat--teal", v: fmtNum(fl.length), l: "Trilhas de Auditoria", s: "Filtros prontos" },
          { cls: "stat--gold", v: "IBGE", l: fr.codigo_ibge || "3170701", s: "ID do Município" },
          { cls: "stat--navy", v: "Pistas", l: fmtNum((fed.pistas_investigacao || []).length), s: "Pontos de atenção" },
        ].map(s => `
          <div class="stat ${s.cls}">
            <div class="stat__value">${s.v}</div>
            <div class="stat__label">${s.l}</div>
            <div class="stat__sub">${s.s}</div>
          </div>`).join("");
      }
      if ($("federalLinks")) {
        $("federalLinks").innerHTML = fl.map(link => `
          <a class="source-card" href="${esc(link.url)}" target="_blank" rel="noopener">
            <span class="source-card__value">Abrir</span>
            <h4>${esc(link.titulo)}</h4>
            <p>${esc(link.desc)}</p>
          </a>`).join("");
      }
    }

    if ($("trilhasCamara")) {
      const links = (camaraTransp.links || []).filter(l => l.categoria !== "Outros").slice(0, 18);
      $("trilhasCamara").innerHTML = links.length ? links.map(l => `
        <a href="${esc(l.url)}" target="_blank" rel="noopener">
          <span>${esc(l.categoria)}</span>
          ${esc(l.titulo)}
        </a>`).join("") : '<div class="empty">Rode o coletor para mapear os links da transparência da Câmara.</div>';
    }

    if ($("pessoalResumo")) {
      const cam = pessoal.camara || {};
      const pref = pessoal.prefeitura || {};
      const cardPessoal = (titulo, orgao) => {
        const r = orgao.resumo || {};
        return `
          <article class="personnel-card">
            <span class="personnel-card__label">${esc(titulo)}</span>
            <div class="personnel-card__num">${fmtNum(r.comissionados_qtd || 0)}</div>
            <p>comissionados ou similares</p>
            <dl>
              <div><dt>Servidores listados</dt><dd>${fmtNum(r.servidores_qtd || 0)}</dd></div>
              <div><dt>Folha bruta comissionados</dt><dd>${fmtBRL(r.folha_bruta_comissionados || 0)}</dd></div>
              <div><dt>Maior vencimento</dt><dd>${fmtBRL(r.maior_vencimento_comissionado || 0)}</dd></div>
            </dl>
            <a href="${esc(orgao.fonte || "#")}" target="_blank" rel="noopener">Abrir fonte oficial</a>
            ${orgao.status ? `<p class="personnel-card__status">${esc(orgao.status)}</p>` : ""}
          </article>`;
      };
      $("pessoalResumo").innerHTML = cardPessoal("Câmara", cam) + cardPessoal("Prefeitura", pref);
    }

    if ($("pessoalTop")) {
      const servidores = (((pessoal.camara || {}).servidores) || [])
        .filter(s => s.comissionado_ou_similar)
        .sort((a, b) => (b.vencimentos || 0) - (a.vencimentos || 0))
        .slice(0, 8);
      $("pessoalTop").innerHTML = servidores.length ? servidores.map(s => `
        <article class="signal signal--medio">
          <div class="signal__top">
            <span class="signal__kind">Câmara · comissionado</span>
            <span class="signal__level">Remuneração</span>
          </div>
          <h4>${esc(s.nome || "Servidor sem nome")}</h4>
          <p>Lotação informada: ${esc(s.lotacao || "não informada")}.</p>
          <div class="signal__meta">Vencimentos: ${fmtBRL(s.vencimentos || 0)} · Líquido: ${fmtBRL(s.liquido || 0)} · Matrícula ${esc(s.matricula)}</div>
        </article>`).join("") : '<div class="empty">Rode o coletor para carregar remuneração de comissionados.</div>';
    }

    if ($("fornecedoresRecorrentes")) {
      const grupos = {};
      const addFornecedor = (nome, cnpj, valor, origem, objeto) => {
        const key = cnpjRoot(cnpj) || norm(nome).replace(/[^a-z0-9]+/g, " ").trim();
        if (!key) return;
        grupos[key] ||= { nome: nome || "Fornecedor não informado", cnpj, valor: 0, qtd: 0, origens: new Set(), objetos: [] };
        grupos[key].valor += Number(valor || 0);
        grupos[key].qtd += 1;
        grupos[key].origens.add(origem);
        if (objeto) grupos[key].objetos.push(objeto);
      };
      contratos.forEach(c => addFornecedor(c.contratado, c.cnpj, c.valor, "Contratos Prefeitura", c.objeto));
      ((pncp.contratos) || []).forEach(c => addFornecedor(c.fornecedor, c.cnpj_fornecedor, c.valor, "PNCP", c.objeto));

      const recorrentes = Object.values(grupos)
        .filter(g => g.qtd >= 2 || g.valor >= 1_000_000)
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 12);

      $("fornecedoresRecorrentes").innerHTML = recorrentes.length ? recorrentes.map(g => `
        <article class="signal signal--${g.qtd >= 3 || g.valor >= 5_000_000 ? "alto" : "medio"}">
          <div class="signal__top">
            <span class="signal__kind">Fornecedor recorrente</span>
            <span class="signal__level">${g.qtd} registro${g.qtd === 1 ? "" : "s"}</span>
          </div>
          <h4>${esc(cleanText(g.nome))}</h4>
          <p>Mesmo fornecedor/CNPJ raiz aparece em mais de um registro ou soma valor relevante. Isso pode ser normal, mas merece olhar contrato por contrato.</p>
          <div class="signal__meta">${fmtBRL(g.valor)} · CNPJ/raiz ${esc(g.cnpj || "não informado")} · ${esc(Array.from(g.origens).join(", "))}</div>
        </article>`).join("") : '<div class="empty">Nenhum fornecedor recorrente identificado com os dados atuais.</div>';
    }

    if ($("qualidadeContratos")) {
      const termosGenericos = ["serviços diversos", "manutenção", "apoio", "assessoria", "consultoria", "fornecimento", "contratação de empresa"];
      const contratosFracos = contratos
        .map(c => {
          const obj = c.objeto || "";
          const n = norm(obj);
          let score = 100;
          const problemas = [];
          if (obj.length < 80) { score -= 30; problemas.push("objeto curto"); }
          if (!/\d/.test(obj)) { score -= 10; problemas.push("sem quantidade/prazo no texto"); }
          if (!/(bairro|escola|ubs|unidade|rua|secretaria|setor|local|munic|hospital|creche|cemei)/i.test(obj)) {
            score -= 20; problemas.push("não deixa claro onde será aplicado");
          }
          if (!/(fornecimento|aquisição|prestação|execução|obra|serviço|locação|registro de preços)/i.test(obj)) {
            score -= 15; problemas.push("não deixa claro como o dinheiro será gasto");
          }
          if (termosGenericos.some(t => n.includes(norm(t))) && obj.length < 160) {
            score -= 15; problemas.push("descrição genérica");
          }
          return { ...c, qualidade: Math.max(0, score), problemas };
        })
        .filter(c => (c.valor || 0) >= 500_000 && c.problemas.length)
        .sort((a, b) => a.qualidade - b.qualidade || (b.valor || 0) - (a.valor || 0))
        .slice(0, 12);

      $("qualidadeContratos").innerHTML = contratosFracos.length ? contratosFracos.map(c => `
        <article class="signal signal--${c.qualidade < 55 ? "alto" : "medio"}">
          <div class="signal__top">
            <span class="signal__kind">Qualidade do contrato</span>
            <span class="signal__level">Nota ${c.qualidade}/100</span>
          </div>
          <h4>${esc(c.contratado || "Contratado não informado")}</h4>
          <p>${esc(c.objeto || "Objeto não informado")}</p>
          <div class="signal__meta">${fmtBRL(c.valor || 0)} · Problemas: ${esc(c.problemas.join(", "))}</div>
          <a href="prefeitura.html">Ver contratos da Prefeitura</a>
        </article>`).join("") : '<div class="empty">Nenhum contrato de alto valor com descrição fraca foi identificado nos dados atuais.</div>';
    }

    if ($("dueDiligenceFornecedores")) {
      $("dueDiligenceFornecedores").innerHTML = [
        {
          nome: "CEIS/CNEP",
          valor: "Sanções",
          desc: "Verifica empresas inidôneas, suspensas ou punidas. É a primeira checagem oficial antes de falar em impedimento.",
          url: "https://portaldatransparencia.gov.br/sancoes/consulta",
        },
        {
          nome: "DataJud/CNJ",
          valor: "Processos",
          desc: "API pública do CNJ dá acesso a metadados processuais. Consulta por partes exige cuidado, porque homônimos e CNPJs relacionados podem confundir.",
          url: "https://www.cnj.jus.br/sistemas/datajud/api-publica/",
        },
        {
          nome: "Receita Federal",
          valor: "Sócios/CNPJ",
          desc: "Confere situação cadastral e quadro societário quando disponível em base pública. Serve para identificar quem deve ser pesquisado nas demais fontes.",
          url: "https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp",
        },
      ].map(f => `
        <a class="source-card" href="${esc(f.url)}" target="_blank" rel="noopener">
          <span class="source-card__value">${esc(f.valor)}</span>
          <h4>${esc(f.nome)}</h4>
          <p>${esc(f.desc)}</p>
        </a>`).join("");
    }

    if ($("fontesExpansao")) {
      const proximas = [
        { nome: "TSE - Doações", desc: "Cruzamento de sócios de fornecedores com doadores de campanha eleitoral.", status: "Planejado" },
        { nome: "CEIS/CNEP", desc: "Consulta automática de empresas suspensas ou impedidas de contratar.", status: "Planejado" },
        { nome: "Redes de Sócios", desc: "Mapeamento de parentesco e conexões entre donos de empresas e agentes públicos.", status: "Em Estudo" }
      ];
      $("fontesExpansao").innerHTML = proximas.map(f => `
        <div style="padding:10px; border-bottom:1px solid #eee;">
          <span style="font-size:0.7em; background:#eee; padding:2px 5px; border-radius:3px; float:right;">${f.status}</span>
          <strong style="display:block; font-size:0.9em;">${f.nome}</strong>
          <p style="margin:5px 0 0; font-size:0.8em; color:#666;">${f.desc}</p>
        </div>
      `).join("");
    }
  };
  renderRelatorios();

  // Blocos auto-contidos de Relatórios (extraídos para modules/relatorios.js)
  window.ZELA.relatorios.renderTodos();

  // ============= TIMELINE DE SINAIS — extraído para modules/relatorios.js =============

  // ============= PREFEITURA AO VIVO (prefeitura.html) =============
  if ($("prefeituraLive") && pf.top_fornecedores_atual && pf.top_fornecedores_atual.length) {
    $("prefeituraLive").hidden = false;
    $("statsPrefeitura").innerHTML = [
      { v: fmtMi(pf.total_externo_atual),
        l: `Pago a fornecedores externos em ${pf.ano_atual}`,
        s: `Excluídas transferências internas`, cls: "stat--teal" },
      { v: fmtMi(pf.total_externo_anterior),
        l: `Pago em ${pf.ano_anterior}`,
        s: `Para comparar`, cls: "stat--navy" },
      { v: fmtNum(pf.credores_qtd),
        l: "Credores no portal",
        s: "Multi-ano (todos os exercícios)", cls: "stat--gold" },
    ].map(s => `
      <div class="stat ${s.cls}">
        <div class="stat__value">${s.v}</div>
        <div class="stat__label">${s.l}</div>
        <div class="stat__sub">${s.s}</div>
      </div>`).join("");

    const top = pf.top_fornecedores_atual.slice(0, 20);
    const max = top[0].valor_total || 1;
    $("topFornecedores").innerHTML = top.map((f, i) => {
      const cnpjLimpo = (f.cnpj || "").replace(/[^\d]/g, "");
      const cnpjValido = cnpjLimpo.length >= 8 && !(f.cnpj || "").includes("*");
      const nomeBusca = encodeURIComponent(cleanText(f.nome || ""));
      return `
      <div class="forn-row">
        <span class="forn-row__rank">${i + 1}</span>
        <div>
          <div class="forn-row__nome">${esc(f.nome)}</div>
          <div class="forn-row__bar"><span class="forn-row__bar-fill" style="width:${(f.valor_total / max) * 100}%"></span></div>
          <div class="forn-row__actions">
            <a class="forn-row__btn forn-row__btn--betha" href="https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83034" target="_blank" rel="noopener" title="Despesas da Prefeitura no Portal Betha — onde estes pagamentos estão registrados">${window.ZELA.icon("lupa", { size: 14 })} Despesas Betha</a>
            <a class="forn-row__btn forn-row__btn--filtro" href="prefeitura.html?q=${nomeBusca}" title="Ver contratos vigentes desta empresa (pode não existir se for pagamento sem contrato)">${window.ZELA.icon("documentos", { size: 14 })} Ver contratos</a>
            ${cnpjValido ? `<a class="forn-row__btn forn-row__btn--cnpj" href="https://casadosdados.com.br/solucao/cnpj/${cnpjLimpo}" target="_blank" rel="noopener" title="Consultar CNPJ na Casa dos Dados (Receita Federal)">${window.ZELA.icon("predio", { size: 14 })} Consultar CNPJ</a>` : ""}
          </div>
        </div>
        <div class="forn-row__cnpj">${esc(f.cnpj)}</div>
        <div class="forn-row__valor">${fmtBRL(f.valor_total)}</div>
      </div>`;
    }).join("");
  }

  // ============= CÂMARA AO VIVO (camara.html) =============
  const cb = D.camara_betha || {};
  if ($("camaraLive") && cb.top_fornecedores_atual && cb.top_fornecedores_atual.length) {
    $("camaraLive").hidden = false;
    if ($("anoCamaraBetha")) $("anoCamaraBetha").textContent = cb.ano_atual || "";
    $("statsCamaraBetha").innerHTML = [
      { v: fmtMi(cb.total_externo_atual),
        l: `Pago a fornecedores externos em ${cb.ano_atual}`,
        s: "Excluídas transferências internas", cls: "stat--teal" },
      { v: fmtMi(cb.total_externo_anterior),
        l: `Pago em ${cb.ano_anterior}`,
        s: "Para comparar", cls: "stat--navy" },
      { v: fmtNum(cb.empenhos_qtd || cb.credores_qtd),
        l: "Empenhos no portal",
        s: "Multi-ano", cls: "stat--gold" },
    ].map(s => `
      <div class="stat ${s.cls}">
        <div class="stat__value">${s.v}</div>
        <div class="stat__label">${s.l}</div>
        <div class="stat__sub">${s.s}</div>
      </div>`).join("");

    const topCam = (cb.top_fornecedores_atual || []).slice(0, 20);
    const maxCam = (topCam[0] || {}).valor_total || 1;
    $("topFornecedoresCamara").innerHTML = topCam.map((f, i) => {
      const cnpjLimpo = (f.cnpj || "").replace(/[^\d]/g, "");
      const cnpjValido = cnpjLimpo.length >= 8 && !f.cnpj.includes("*");
      const nomeBusca = encodeURIComponent(cleanText(f.nome || ""));
      return `
      <div class="forn-row">
        <span class="forn-row__rank">${i + 1}</span>
        <div>
          <div class="forn-row__nome">${esc(f.nome)}</div>
          <div class="forn-row__bar"><span class="forn-row__bar-fill" style="width:${(f.valor_total / maxCam) * 100}%"></span></div>
          <div class="forn-row__actions">
            <a class="forn-row__btn forn-row__btn--betha" href="https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324767" target="_blank" rel="noopener" title="Despesas da Câmara no Portal Betha — onde estes pagamentos estão registrados">${window.ZELA.icon("lupa", { size: 14 })} Despesas Betha</a>
            <a class="forn-row__btn forn-row__btn--filtro" href="camara.html?q=${nomeBusca}" title="Ver contratos vigentes desta empresa na Câmara (pode não existir se for pagamento sem contrato)">${window.ZELA.icon("documentos", { size: 14 })} Ver contratos</a>
            ${cnpjValido ? `<a class="forn-row__btn forn-row__btn--cnpj" href="https://casadosdados.com.br/solucao/cnpj/${cnpjLimpo}" target="_blank" rel="noopener" title="Consultar CNPJ na Casa dos Dados (Receita Federal)">${window.ZELA.icon("predio", { size: 14 })} Consultar CNPJ</a>` : ""}
          </div>
        </div>
        <div class="forn-row__cnpj">${esc(f.cnpj)}</div>
        <div class="forn-row__valor">${fmtBRL(f.valor_total)}</div>
      </div>`;
    }).join("");
  }

  // ============= CONTRATOS CÂMARA (camara.html) =============
  let contratosCamaraShown = 20;
  let renderContratosCamara = null;
  if ($("contratosCamaraBlock") && (cb.contratos || []).length) {
    const contratosCam = cb.contratos || [];
    const filtroEl = $("filtroContratoCamara");
    const listaEl  = $("contratosCamara");
    const maisEl   = $("contratosCamaraMais");
    const contEl   = $("contratosContadorCamara");
    const BETHA_CONTRATOS_CAMARA = "https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324812";
    const PORTAL_CONTRATOS_CAMARA = "https://www.varginha.mg.leg.br/transparencia";
    const baseLegalCamara = [
      { lei: "CF/88, art. 37", uso: "publicidade, legalidade e eficiência nos atos públicos" },
      { lei: "Lei 14.133/2021, art. 92", uso: "cláusulas essenciais do contrato" },
      { lei: "Lei 12.527/2011, art. 8", uso: "transparência ativa de despesas e contratos" },
    ];

    renderContratosCamara = function (reset) {
      if (reset) contratosCamaraShown = 20;
      const q = norm(filtroEl ? filtroEl.value : "");
      const filtrados = contratosCam.filter(c =>
        !q || norm([c.numero, c.ano, c.objeto, c.contratado, c.cnpj, c.modalidade].filter(Boolean).join(" ")).includes(q)
      );
      if (contEl) contEl.textContent = `${filtrados.length} contratos`;
      listaEl.innerHTML = filtrados.slice(0, contratosCamaraShown).map(c => `
        <article class="contrato">
          <div class="contrato__valor">
            ${fmtBRL(c.valor)}
            <div style="margin-top:8px;">${window.ZELA.watchlist.botao("contratos", "CAM-" + (c.numero || "") + "/" + (c.ano || ""))}</div>
          </div>
          <div class="contrato__body">
            <p class="contrato__nome">${esc(c.contratado || "—")} <span class="muted">${esc(c.cnpj || "")}</span></p>
            <p class="contrato__obj">${esc(c.objeto || "—")}</p>
            <p class="muted small">${esc(c.modalidade || "")} · ${esc(c.data_assinatura || "")} → ${esc(c.data_fim || "")}${c.numero ? ` · Nº ${esc(c.numero)}` : ""}</p>
            <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
              ${c.numero ? `<button type="button" class="btn-copiar-num" onclick="(function(b){var t=b.closest('.contrato').querySelector('.muted.small');var m=t&&t.textContent.match(/N[°º]\s*([\w\/\-]+)/);var n=m?m[1]:'${jsSafe(String(c.numero || ""))}';navigator.clipboard&&navigator.clipboard.writeText(n).then(function(){var o=b.textContent;b.textContent='✓ Copiado';setTimeout(function(){b.textContent=o;},1400);}).catch(function(){});b.title=n;})(this)" title="Copiar número do contrato">📋 Copiar nº</button>` : ""}
              <button type="button" class="btn-dossie" onclick="ZELA.abrirContratoCamara(${contratosCam.indexOf(c)})">Ver detalhes e fonte</button>
              <a class="btn-link" href="${BETHA_CONTRATOS_CAMARA}" target="_blank" rel="noopener" title="Ver todos os contratos da Câmara no Portal Betha" style="text-decoration:none; padding: 4px 10px; background: #e8f4fd; border-radius: 4px; color: #1565c0; font-size: 0.8em; font-weight: 500; border: 1px solid #90caf9;">Portal Betha (Câmara)</a>
              <a class="btn-link" href="${PORTAL_CONTRATOS_CAMARA}" target="_blank" rel="noopener" title="Portal de Transparência oficial da Câmara Municipal" style="text-decoration:none; padding: 4px 10px; background: #eee; border-radius: 4px; color: #333; font-size: 0.8em; font-weight: 500; border: 1px solid #ccc;">Site da Câmara</a>
            </div>
          </div>
        </article>`).join("");
      if (maisEl) maisEl.hidden = filtrados.length <= contratosCamaraShown;
    };
    window.ZELA.abrirContratoCamara = (idx) => {
      const c = contratosCam[idx];
      if (!c) return;
      const html = window.ZELA.dossie.templateContrato({
        contrato: c,
        audit: { nivel: "ok", score: 100, achados: [] },
        baseLegal: baseLegalCamara,
        orgao: "Câmara",
      });
      window.ZELA.dossie.abrirComHtml(html);
    };
    if (filtroEl) filtroEl.addEventListener("input", () => renderContratosCamara(true));
    renderContratosCamara(true);
  }

  // ============= CONTRATOS (prefeitura.html) =============
  let renderContratos = null;
  let contratosShown  = 20;

  // Mapa CNPJ (8 dígitos) → emendas da Câmara — para cruzamento
  const emendasPorCnpjRaiz = new Map();
  (D.emendas || []).forEach(function (e) {
    const raiz = (e.cnpj || "").replace(/[^\d]/g, "").slice(0, 8);
    if (!raiz || raiz.length < 8) return;
    const lista = emendasPorCnpjRaiz.get(raiz) || [];
    lista.push(e);
    emendasPorCnpjRaiz.set(raiz, lista);
  });

  if ($("contratosBlock")) {
    const contratos          = pf.contratos || [];
    const filtroContrato     = $("filtroContrato");
    const filtroAnoContrato  = $("filtroAnoContrato");
    const filtroValorContrato = $("filtroValorContrato");
    const filtroSecretaria   = $("filtroSecretaria");
    const contratosEl        = $("contratos");
    const contratosMaisEl    = $("contratosMais");
    const contratosContador  = $("contratosContador");

    // Populando select de secretarias
    if (filtroSecretaria) {
      const secs = [...new Set(
        contratos.map(c => (c.entidade || "").trim()).filter(s => s.length > 2)
      )].sort();
      secs.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s; opt.textContent = s;
        filtroSecretaria.appendChild(opt);
      });
    }

    // Alertas de contratos próximos do vencimento
    (function () {
      const hoje = new Date(); hoje.setHours(0,0,0,0);
      const d30 = new Date(hoje); d30.setDate(d30.getDate() + 30);
      const d60 = new Date(hoje); d60.setDate(d60.getDate() + 60);
      const d90 = new Date(hoje); d90.setDate(d90.getDate() + 90);
      const vencendo = contratos
        .filter(c => {
          if (!c.data_fim) return false;
          const df = new Date(c.data_fim); df.setHours(0,0,0,0);
          return df >= hoje && df <= d90;
        })
        .map(c => {
          const df = new Date(c.data_fim); df.setHours(0,0,0,0);
          const dias = Math.round((df - hoje) / 86400000);
          return { ...c, diasRestantes: dias };
        })
        .sort((a, b) => a.diasRestantes - b.diasRestantes);
      const el = $("contratosVencendoBlock");
      if (!el || !vencendo.length) return;
      const itensHtml = vencendo.slice(0, 20).map(c => {
        const cls = c.diasRestantes <= 30 ? "red" : c.diasRestantes <= 60 ? "orange" : "yellow";
        const label = c.diasRestantes === 0 ? "Hoje" : `${c.diasRestantes}d`;
        return `<div class="vencendo-item">
          <span class="vencendo-badge vencendo-badge--${cls}">${label}</span>
          <div class="vencendo-item__info">
            <strong>${esc(cleanText(c.contratado || "—"))}</strong>
            <small>${esc(cleanText(c.objeto || ""))} · ${fmtBRL(c.valor)} · vence ${c.data_fim.split("-").reverse().join("/")}</small>
          </div>
        </div>`;
      }).join("");
      el.innerHTML = `
        <div class="vencendo-block">
          <div class="vencendo-block__head" onclick="this.nextElementSibling.hidden = !this.nextElementSibling.hidden">
            ⏰ ${vencendo.length} contrato${vencendo.length > 1 ? "s" : ""} vencem nos próximos 90 dias
            <span>clique para expandir ▾</span>
          </div>
          <div class="vencendo-block__body" hidden>${itensHtml}</div>
        </div>`;
    })();

    const checarTransparencia = (c) => {
      const problemas = [];
      const obj = (c.objeto || "").trim();
      if (!obj || obj.length < 25) problemas.push("Objeto muito curto ou vago");
      if (!c.valor || c.valor <= 0) problemas.push("Valor não informado ou zero");
      if (!c.data_assinatura) problemas.push("Sem data de assinatura");
      if (!c.data_fim) problemas.push("Sem data de término/vigência");
      
      const keywordsVagas = ["prestacao de serviços", "aquisição de materiais", "atender as necessidades", "diversas secretarias"];
      if (keywordsVagas.some(k => norm(obj).includes(k)) && obj.length < 60) {
        problemas.push("Descrição genérica (falta detalhamento)");
      }

      const score = Math.max(0, 100 - (problemas.length * 25));
      return { score, problemas };
    };

    const baseLegalContratos = [
      { lei: "CF/88, art. 37", uso: "legalidade, publicidade, moralidade, eficiencia e impessoalidade" },
      { lei: "Lei 14.133/2021, arts. 11, 18 e 23", uso: "planejamento, justificativa do preço e compatibilidade com mercado" },
      { lei: "Lei 14.133/2021, art. 92", uso: "cláusulas essenciais do contrato: objeto, preço, prazo, crédito orçamentário, direitos e sanções" },
      { lei: "Lei 14.133/2021, arts. 96 e 122", uso: "garantia contratual e subcontratacao quando previstas e justificadas" },
      { lei: "Lei 12.527/2011, art. 8", uso: "transparência ativa de despesas, licitacoes e contratos" },
      { lei: "Lei 4.320/1964, art. 35", uso: "despesa pertence ao exercicio em que foi legalmente empenhada" },
    ];

    const BETHA_CONTRATOS_PREFEITURA = "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043";
    const PORTAL_CONTRATOS_PREFEITURA = "https://transparencia.varginha.mg.gov.br/portal-transparencia/consultas/contratos";

    const contratoSearchText = (c) => [
      c.numero && c.ano ? `${c.numero}/${c.ano}` : (c.numero || ""),
      c.contratado || "",
      c.cnpj || "",
      c.objeto || "",
      c.modalidade || "",
      c.entidade || "",
      c.situacao || "",
    ].filter(Boolean).join(" ");

    const contratoPncpUrl = (c) => {
      const cnpj = (c.cnpj || "").replace(/[^\d]/g, "");
      const q = cnpj.length >= 8
        ? cnpj
        : [c.contratado, c.numero, c.ano, "Varginha"].filter(Boolean).join(" ");
      return "https://pncp.gov.br/app/contratos?q=" + encodeURIComponent(q);
    };

    const addAchado = (lista, nivel, titulo, detalhe, base, pedido) => {
      lista.push({ nivel, titulo, detalhe, base, pedido });
    };

    const classificarContrato = (c) => {
      const texto = norm([c.objeto, c.contratado, c.modalidade, c.tipo, c.situacao].filter(Boolean).join(" "));
      const evento = hasAny(texto, [
        "evento", "show", "carnaval", "banho da doroteia", "artista", "banda",
        "sonorizacao", "iluminacao", "palco", "banheiro quimico", "barraca",
        "praca de alimentacao", "gerador", "camarote",
      ]);
      const exploracaoPrivada = hasAny(texto, [
        "estacionamento", "camarote", "food truck", "barraca", "espaco publicitario",
        "publicidade", "ingresso", "exploracao comercial", "praca de alimentacao",
      ]);
      const barry002 = /barry eventos/i.test(c.contratado || "") &&
        String(c.numero || "") === "2" &&
        String(c.ano || "") === "2026";
      return { evento, exploracaoPrivada, barry002 };
    };

    const diagnosticarContrato = (c) => {
      const problemas = [];
      const achados = [];
      const obj = (c.objeto || "").trim();
      const cls = classificarContrato(c);

      if (!obj || obj.length < 25) {
        problemas.push("Objeto muito curto ou vago");
        addAchado(achados, "relevante", "Objeto insuficiente",
          "A descrição publica não permite entender com seguranca o que foi contratado.",
          "Lei 14.133/2021, arts. 18 e 92",
          "Solicitar Termo de Referencia, edital/anexos e proposta vencedora.");
      }
      if (!c.valor || c.valor <= 0) {
        problemas.push("Valor não informado ou zero");
        addAchado(achados, "relevante", "Valor ausente",
          "Sem valor público não há como medir economicidade nem comparar mercado.",
          "Lei 14.133/2021, arts. 23 e 92; LAI, art. 8",
          "Solicitar valor global, planilha de composição e empenho.");
      }
      if (!c.data_assinatura) {
        problemas.push("Sem data de assinatura");
        addAchado(achados, "atencao", "Assinatura sem data",
          "A data e essencial para conferir vigência, planejamento e execução.",
          "Lei 14.133/2021, art. 92",
          "Solicitar contrato integral assinado.");
      }
      if (!c.data_fim) {
        problemas.push("Sem data de termino/vigência");
        addAchado(achados, "atencao", "Vigência incompleta",
          "A vigência ajuda a conferir entrega, aditivos e custo por período.",
          "Lei 14.133/2021, art. 92",
          "Solicitar vigência, aditivos e ordem de serviço.");
      }

      const keywordsVagas = ["prestacao de serviços", "aquisição de materiais", "atender as necessidades", "diversas secretarias"];
      if (keywordsVagas.some(k => norm(obj).includes(k)) && obj.length < 90) {
        problemas.push("Descrição genérica: depende de anexos");
        addAchado(achados, "atencao", "Descrição genérica",
          "O objeto pode estar formalmente correto, mas a fiscalização depende dos quantitativos e especificações dos anexos.",
          "Lei 14.133/2021, arts. 18, 23 e 92",
          "Solicitar TR, ETP quando houver, pesquisa de precos e memoria de calculo.");
      }

      if (Number(c.valor) >= 1000000) {
        addAchado(achados, "atencao", "Alto valor absoluto",
          "Valor elevado não e irregularidade por si só, mas aumenta a prioridade de conferência documental.",
          "Lei 14.133/2021, arts. 11 e 23",
          "Conferir pesquisa de precos, justificativa de vantajosidade e execução.");
      }
      if (cls.evento) {
        addAchado(achados, "atencao", "Contrato de evento",
          "Eventos exigem leitura dos anexos para verificar palco, som, seguranca, banheiros, cronograma, equipe e criterios de aceite.",
          "Lei 14.133/2021, arts. 18, 23 e 92",
          "Solicitar TR/Anexo I, proposta vencedora, planilha de custos e relatorio do fiscal do contrato.");
      }
      if (cls.evento && cls.exploracaoPrivada) {
        addAchado(achados, "relevante", "Possivel receita privada vinculada ao evento",
          "Quando há barracas, camarotes, estacionamento, publicidade ou praça de alimentação, a análise deve verificar se a receita privada foi considerada no preço público.",
          "Lei 14.133/2021, arts. 11 e 23; CF/88, art. 37",
          "Solicitar estudo economico, regras de exploracao comercial, autorizacoes e prestacao de contas.");
      }
      if (cls.barry002) {
        addAchado(achados, "relevante", "Checklist especifico do Contrato 002/2026",
          "Pelo contexto do Banho da Doroteia, a triagem deve conferir anexos, proposta, empenho do exercício, subcontratação, eventual garantia e receitas privadas. O painel marca como ponto de verificação, não como condenação automática.",
          "Lei 14.133/2021, arts. 18, 23, 92, 96 e 122; Lei 4.320/1964, art. 35",
          "Solicitar contrato integral com anexos, nota de empenho, parecer juridico, publicacao, proposta e relatorio pos-evento.");
      }

      const peso = { grave: 40, relevante: 25, atencao: 12 };
      const score = Math.max(0, 100 - achados.reduce((s, a) => s + (peso[a.nivel] || 10), 0));
      const nivel = achados.some(a => a.nivel === "grave") ? "grave" :
        achados.some(a => a.nivel === "relevante") ? "relevante" :
        achados.some(a => a.nivel === "atencao") ? "atencao" : "ok";
      return { score, problemas, achados, nivel };
    };

    const achadosResumo = (audit, limite = 3) => audit.achados.length
      ? audit.achados.slice(0, limite).map(a => `${a.nivel.toUpperCase()}: ${a.titulo} (${a.base})`).join("\n")
      : "Sem alerta juridico automatico nos dados carregados.";

    const renderBaseLegalContratos = () => {
      const el = $("contratosLegalContext");
      if (!el) return;
      el.innerHTML = `
        <div>
          <strong>Base juridica da triagem</strong>
          <p>O painel não declara irregularidade sozinho. Ele cruza dados públicos e indica quais documentos devem ser conferidos antes de qualquer conclusão.</p>
        </div>
        <div class="legal-context__grid">
          ${baseLegalContratos.map(b => `
            <article>
              <span>${esc(b.lei)}</span>
              <p>${esc(b.uso)}</p>
            </article>`).join("")}
        </div>`;
    };

    renderBaseLegalContratos();

    // Delega geração e download do TXT para modules/dossie.js
    window.ZELA.gerarDossie = (idx) => {
      const c = pf.contratos[idx];
      if (!c) return;
      const audit = diagnosticarContrato(c);
      window.ZELA.dossie.gerarTxtContrato({
        contrato: c,
        audit,
        baseLegal: baseLegalContratos,
      });
    };

    window.ZELA.abrirContrato = (idx) => {
      const c = pf.contratos[idx];
      if (!c) return;
      const audit = diagnosticarContrato(c);
      const html = window.ZELA.dossie.templateContrato({
        contrato: { ...c, __idx: idx },
        audit,
        baseLegal: baseLegalContratos,
        orgao: "Prefeitura",
      });
      window.ZELA.dossie.abrirComHtml(html);
    };

    let categoriaAtivaContratos = "";
    window.ZELA.filtrarContratosPorCategoria = (cat) => {
      categoriaAtivaContratos = cat || "";
      renderContratos(true);
    };

    renderContratos = function (reset) {
      if (reset) contratosShown = 20;
      const q = norm(filtroContrato.value.trim());
      const anoFiltro = filtroAnoContrato.value || "";
      const valorMin = filtroValorContrato ? Number(filtroValorContrato.value || 0) : 0;
      const secFiltro = filtroSecretaria ? filtroSecretaria.value : "";
      const view = contratos.filter(c =>
        (!anoFiltro || String(c.ano || "") === anoFiltro) &&
        (!valorMin || (Number(c.valor) || 0) >= valorMin) &&
        (!secFiltro || (c.entidade || "").trim() === secFiltro) &&
        (!categoriaAtivaContratos || window.ZELA.classificarItem(c) === categoriaAtivaContratos) &&
        (!q ||
          norm(contratoSearchText(c)).includes(q) ||
          (q.replace(/[^\d]/g, "").length >= 3 && (c.cnpj || "").replace(/[^\d]/g, "").includes(q.replace(/[^\d]/g, "")))
        )
      );
      const total = view.reduce((s, c) => s + (Number(c.valor) || 0), 0);
      contratosContador.textContent =
        `${view.length} contrato${view.length === 1 ? "" : "s"} · ${fmtBRL(total)}`;

      // Ranking de Fornecedores Filtrados
      const gruposFornecedores = new Map();
      view.forEach(c => {
        const key = c.contratado || "Não identificado";
        const cur = gruposFornecedores.get(key) || { nome: key, qtd: 0, valor: 0 };
        cur.qtd += 1;
        cur.valor += Number(c.valor) || 0;
        gruposFornecedores.set(key, cur);
      });
      const rankingFornecedores = [...gruposFornecedores.values()]
        .sort((a, b) => (b.valor - a.valor) || (b.qtd - a.qtd))
        .slice(0, 5);
      const rankingHtml = rankingFornecedores.length ? `
        <div class="ranking-fornecedores" style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px; border: 1px solid #dee2e6;">
          <h5 style="margin-top:0; color:#2c3e50;">Top 5 fornecedores no filtro atual</h5>
          <div style="display:grid; gap:8px;">
            ${rankingFornecedores.map((f, i) => `
              <div style="display:flex; justify-content:space-between; font-size:0.9em;">
                <span>${i + 1}. ${esc(f.nome)}</span>
                <strong>${fmtBRL(f.valor)}</strong>
              </div>
            `).join("")}
          </div>
        </div>
      ` : "";
      
      const healthEl = $("transparenciaHealth");
      if (healthEl) {
        healthEl.innerHTML = (healthEl.innerHTML.includes("Top 5 fornecedores") ? healthEl.innerHTML.split("</div>")[1] : healthEl.innerHTML) + rankingHtml;
      }

      if (!view.length) {
        if ($("transparenciaHealth")) $("transparenciaHealth").style.display = "none";
        contratosEl.innerHTML = `<div class="empty">
          <strong>Nenhum contrato encontrado</strong>
          <p>Tente ampliar o período, remover o filtro de valor ou limpar a busca.</p>
          <button class="btn-limpar" onclick="
            document.getElementById('filtroContrato').value='';
            document.getElementById('filtroAnoContrato').value='';
            if(document.getElementById('filtroValorContrato')) document.getElementById('filtroValorContrato').value='';
            ZELA.filtrarContratos && ZELA.filtrarContratos();
          ">Limpar filtros</button>
        </div>`;
        contratosMaisEl.hidden = true;
        return;
      }

      const slice = view.slice(0, contratosShown);
      
      const allAudit = view.map(c => diagnosticarContrato(c));
      if ($("transparenciaHealth")) {
        const relevantes = allAudit.filter(a => a.nivel === "relevante").length;
        const atencoes = allAudit.filter(a => a.nivel === "atencao").length;
        const ok = allAudit.filter(a => a.nivel === "ok").length;
        $("transparenciaHealth").style.display = "block";
        $("transparenciaHealth").innerHTML = `
          <strong>Triagem jurídica e documental</strong>
          <p id="healthSummary">Dos ${view.length} contratos filtrados, <strong>${relevantes}</strong> pedem conferência relevante,
          <strong>${atencoes}</strong> pedem atenção documental e <strong>${ok}</strong> não tiveram alerta automático.
          Isto não é sentença de irregularidade: é uma priorização para fiscalizar com base em documentos.</p>
          <div class="health-metrics">
            <span><b>${relevantes}</b> relevantes</span>
            <span><b>${atencoes}</b> atenções</span>
            <span><b>${ok}</b> sem alerta automático</span>
          </div>
          ${rankingHtml}`;
      }
      contratosEl.innerHTML = slice.map((c, i) => {
        const audit = diagnosticarContrato(c);
        const sitClass = /encerrad|finaliz/i.test(c.situacao) ? " contrato__sit--encerrado" : "";
        const dataIniStr = c.data_assinatura || "";
        const dataFimStr = c.data_fim || "";
        const dataIni = dataIniStr.split("-").reverse().join("/");
        const dataFim = dataFimStr.split("-").reverse().join("/");
        
        let custoDiario = null;
        if (dataIniStr && dataFimStr) {
          const d1 = new Date(dataIniStr);
          const d2 = new Date(dataFimStr);
          const diff = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24)) || 1;
          custoDiario = (Number(c.valor) || 0) / diff;
        }
        
        // Cruzamento CNPJ: verifica se empresa tem emenda na Câmara
        const cnpjRaiz = (c.cnpj || "").replace(/[^\d]/g, "").slice(0, 8);
        const emCruzadas = cnpjRaiz.length >= 8 ? (emendasPorCnpjRaiz.get(cnpjRaiz) || []) : [];
        const cruzadoHtml = emCruzadas.length ? (() => {
          const vereadores = [...new Set(emCruzadas.map(e => e.vereador || e.autor || "").filter(Boolean))];
          const totalEm = emCruzadas.reduce((s, e) => s + (Number(e.valor) || 0), 0);
          return `<div class="cnpj-cruzado">
            <span class="cnpj-cruzado__icon">${window.ZELA.icon ? window.ZELA.icon("alerta", { size: 18 }) : ""}</span>
            <div class="cnpj-cruzado__txt">
              <strong>Empresa também recebeu emenda da Câmara</strong>
              <em>${emCruzadas.length} emenda${emCruzadas.length > 1 ? "s" : ""} · ${fmtBRL(totalEm)}${vereadores.length ? " · " + vereadores.slice(0,2).map(v => esc(v)).join(", ") + (vereadores.length > 2 ? "…" : "") : ""} — <a href="camara.html?q=${encodeURIComponent((c.cnpj||"").replace(/[^\d]/g,"").slice(0,8))}" style="color:inherit;font-weight:700;">Ver na Câmara →</a></em>
            </div>
          </div>`;
        })() : "";

        const idContrato = `${c.numero || ""}/${c.ano || ""}`;
        return `
        <article class="contrato">
          <div class="contrato__valor">
            ${fmtBRL(c.valor)}
            <div class="score-mini score-mini--${audit.nivel}" title="${audit.nivel === "ok" ? "Registro completo: objeto, valores e datas preenchidos." : "Faltam informações no registro (objeto vago, valor ou data ausente). Veja os motivos abaixo e confira a fonte oficial."} Índice documental: ${audit.score}/100">
              ${audit.nivel === "ok" ? "Registro completo" : "Confira"}: ${audit.score}%
            </div>
          </div>
          <div>
            <p class="contrato__nome" style="display:flex; align-items:flex-start; gap:8px;">
              <span style="flex:1;">${cleanText(c.contratado || "—")}
              ${c.situacao ? `<span class="contrato__sit${sitClass}">${esc(c.situacao)}</span>` : ""}</span>
              ${window.ZELA.watchlist.botao("contratos", idContrato)}
            </p>
            <p class="contrato__obj">${esc(cleanText(c.objeto))}</p>
            <div class="contrato__meta">
              <span>
                <strong>Contrato nº</strong> ${c.numero}/${c.ano}
                ${c.numero ? `<button class="btn-copiar-num" title="Copiar número para buscar no portal" onclick="(function(b){var t='${jsSafe(c.numero + '/' + c.ano)}';navigator.clipboard&&navigator.clipboard.writeText(t).then(function(){var o=b.textContent;b.textContent='Copiado!';setTimeout(function(){b.textContent=o},1500)}).catch(function(){});b.blur();})(this)">${window.ZELA.icon ? window.ZELA.icon("copiar", { size: 13 }) : ""} Copiar nº</button>` : ""}
              </span>
              <span><span class="glossario-termo" tabindex="0" data-explica="Como a Prefeitura comprou (pregão, dispensa, concorrência…).">Tipo de compra:</span> ${esc(cleanText(c.modalidade))}</span>
              ${dataIni ? `<span><span class="glossario-termo" tabindex="0" data-explica="Período em que o contrato está em vigor.">Período:</span> ${dataIni} ${dataFim ? "até " + dataFim : ""}</span>` : ""}
              ${custoDiario ? `<span style="color:#2c3e50; font-weight:bold;">Custo estimado: ${fmtBRL(custoDiario)}/dia</span>` : ""}
            </div>
            ${audit.achados.length ? `
              <div class="contrato-legal">
                ${audit.achados.slice(0, 3).map(a => `
                  <span class="legal-chip legal-chip--${a.nivel}" title="${esc(a.base)}">${esc(a.titulo)}</span>
                `).join("")}
              </div>
              <p class="contrato__legal-note">${esc(audit.achados[0].pedido)}</p>
            ` : ""}
            ${cruzadoHtml}
            <div style="margin-top:10px; display: flex; gap: 8px; flex-wrap: wrap; align-items:center;">
              <button class="btn-dossie" onclick="ZELA.abrirContrato(${contratos.indexOf(c)})">Ver detalhes e fonte</button>
              <button class="btn-dossie" onclick="ZELA.gerarDossie(${contratos.indexOf(c)})">Baixar relatório</button>
              <button class="btn-share" onclick="ZELA.compartilharZap('${jsSafe(c.contratado)}', '${jsSafe(c.objeto)}', '${fmtBRL(c.valor)}${custoDiario ? " (Custo: " + fmtBRL(custoDiario) + "/dia)" : ""}')">Compartilhar</button>
              <a class="btn-link" href="${BETHA_CONTRATOS_PREFEITURA}" target="_blank" rel="noopener" title="Cole o nº do contrato no campo de busca do Betha para localizar este contrato" style="text-decoration:none; padding: 6px 12px; background: #e8f4fd; border-radius: 4px; color: #1565c0; font-size: 0.85em; font-weight: 500; border: 1px solid #90caf9;">${window.ZELA.icon ? window.ZELA.icon("lupa", { size: 13 }) : ""} Betha</a>
              <a class="btn-link" href="${PORTAL_CONTRATOS_PREFEITURA}" target="_blank" rel="noopener" title="Portal oficial da Prefeitura (pode estar temporariamente indisponível)" style="text-decoration:none; padding: 6px 12px; background: #eee; border-radius: 4px; color: #555; font-size: 0.85em; font-weight: 500; border: 1px solid #ccc;">Portal oficial</a>
              <a class="btn-link" href="${contratoPncpUrl(c)}" target="_blank" rel="noopener" title="Buscar este fornecedor/contrato no PNCP" style="text-decoration:none; padding: 6px 12px; background: #fff8e1; border-radius: 4px; color: #6d4c00; font-size: 0.85em; font-weight: 500; border: 1px solid #ffd54f;">PNCP</a>
            </div>
          </div>
          ${c.cnpj && !c.cnpj.includes("*") ? `<a class="contrato__cnpj" href="https://casadosdados.com.br/solucao/cnpj/${c.cnpj.replace(/[^\d]/g,"")}" target="_blank" rel="noopener" title="Consultar empresa no CNPJ" style="text-decoration:none; color:inherit;">${esc(c.cnpj)} 🔗</a>` : `<div class="contrato__cnpj">${esc(c.cnpj)}</div>`}
        </article>`;
      }).join("");

      contratosMaisEl.hidden = view.length <= contratosShown;

      // URL state sync — permite compartilhar filtros aplicados
      (function () {
        const p = new URLSearchParams(window.location.search);
        const qVal = filtroContrato.value.trim();
        if (qVal) p.set("q", qVal); else p.delete("q");
        if (anoFiltro) p.set("ano", anoFiltro); else p.delete("ano");
        const vm = filtroValorContrato ? filtroValorContrato.value : "";
        if (vm) p.set("valor", vm); else p.delete("valor");
        const sv = filtroSecretaria ? filtroSecretaria.value : "";
        if (sv) p.set("sec", sv); else p.delete("sec");
        const str = p.toString();
        history.replaceState(null, "", str ? "?" + str + window.location.hash : window.location.pathname + window.location.hash);
      })();
    };

    if (contratos.length) {
      $("contratosBlock").hidden = false;

      // Comparativo ano atual × anterior
      const anoAt  = String(pf.ano_atual  || new Date().getFullYear());
      const anoAnt = String(pf.ano_anterior || Number(anoAt) - 1);
      const cAt  = contratos.filter(c => String(c.ano) === anoAt);
      const cAnt = contratos.filter(c => String(c.ano) === anoAnt);
      const vAt  = cAt.reduce((s, c)  => s + (Number(c.valor) || 0), 0);
      const vAnt = cAnt.reduce((s, c) => s + (Number(c.valor) || 0), 0);
      const diffPct = vAnt > 0 ? ((vAt - vAnt) / vAnt * 100).toFixed(1) : null;
      const diffSinal = diffPct !== null ? (Number(diffPct) >= 0 ? `+${diffPct}%` : `${diffPct}%`) : "";
      const diffCor   = diffPct !== null ? (Number(diffPct) > 10 ? "#c0392b" : Number(diffPct) < -5 ? "#27ae60" : "#7f8c8d") : "";

      const compEl = document.createElement("div");
      compEl.className = "contratos-comparativo";
      compEl.innerHTML = `
        <div class="comp-col">
          <span class="comp-ano">${anoAt}</span>
          <strong class="comp-valor">${fmtBRL(vAt)}</strong>
          <span class="comp-qtd">${cAt.length} contrato${cAt.length !== 1 ? "s" : ""}</span>
        </div>
        <div class="comp-seta" style="color:${diffCor}" title="Variação de valor total em relação a ${anoAnt}">
          ${diffSinal || "—"}
        </div>
        <div class="comp-col comp-col--ant">
          <span class="comp-ano">${anoAnt}</span>
          <strong class="comp-valor">${fmtBRL(vAnt)}</strong>
          <span class="comp-qtd">${cAnt.length} contrato${cAnt.length !== 1 ? "s" : ""}</span>
        </div>`;
      const filterbar = $("contratosBlock").querySelector(".filterbar");
      if (filterbar) filterbar.before(compEl);

      window.ZELA.filtrarContratos = () => renderContratos(true);
      filtroContrato.addEventListener("input", () => renderContratos(true));
      filtroAnoContrato.addEventListener("change", () => renderContratos(true));
      if (filtroValorContrato) filtroValorContrato.addEventListener("change", () => renderContratos(true));
      if (filtroSecretaria)   filtroSecretaria.addEventListener("change", () => renderContratos(true));
      renderContratos(true);

      // CSV export button
      const csvBtnC = document.createElement("button");
      csvBtnC.className = "btn-csv"; csvBtnC.textContent = "↓ CSV";
      csvBtnC.title = "Baixar contratos filtrados como CSV";
      csvBtnC.style.marginLeft = "8px";
      const contadorEl2 = $("contratosContador");
      if (contadorEl2) contadorEl2.after(csvBtnC);
      csvBtnC.addEventListener("click", () => {
        const q = norm(filtroContrato.value.trim());
        const ano = filtroAnoContrato.value || "";
        const vmin = filtroValorContrato ? Number(filtroValorContrato.value || 0) : 0;
        const view = contratos.filter(c =>
          (!ano || String(c.ano || "") === ano) &&
          (!vmin || (Number(c.valor) || 0) >= vmin) &&
          (!q || norm(c.contratado).includes(q) || norm(c.objeto).includes(q) || norm(c.modalidade).includes(q))
        );
        exportCSV(view.map(c => ({
          contrato: `${c.numero}/${c.ano}`,
          contratado: cleanText(c.contratado || ""),
          cnpj: c.cnpj || "",
          objeto: cleanText(c.objeto || ""),
          modalidade: cleanText(c.modalidade || ""),
          valor: c.valor || 0,
          data_assinatura: c.data_assinatura || "",
          data_fim: c.data_fim || "",
          situacao: c.situacao || "",
        })), [
          { key: "contrato",       label: "Contrato" },
          { key: "contratado",     label: "Contratado" },
          { key: "cnpj",           label: "CNPJ" },
          { key: "objeto",         label: "Objeto" },
          { key: "modalidade",     label: "Modalidade" },
          { key: "valor",          label: "Valor (R$)" },
          { key: "data_assinatura",label: "Data Assinatura" },
          { key: "data_fim",       label: "Data Fim" },
          { key: "situacao",       label: "Situação" },
        ], `contratos-varginha-${new Date().toISOString().slice(0,10)}.csv`);
      });
    }
  }

  // ============= LICITAÇÕES (prefeitura.html) =============
  if ($("licitacoesBlock")) {
    const licitacoes = pf.licit_andamento || [];
    const filtroLic     = $("filtroLicitacao");
    const filtroValLic  = $("filtroValorLicitacao");
    const licContador   = $("licitacoesContador");
    const licMaisBtn    = $("btnLicitacoesMais");
    const licMaisWrap   = $("licitacoesMais");
    let licShown = 12;

    const renderLicitacoes = function (reset) {
      if (reset) licShown = 12;
      const q    = norm(filtroLic ? filtroLic.value : "");
      const vmin = filtroValLic ? Number(filtroValLic.value || 0) : 0;
      const filtrados = licitacoes.filter(l =>
        (!vmin || (Number(l.valor) || 0) >= vmin) &&
        (!q    || norm((l.objeto || "") + (l.modalidade || "")).includes(q))
      );
      if (licContador) licContador.textContent = `${filtrados.length} licitações`;
      if (!filtrados.length) {
        $("licitacoes").innerHTML = `<div class="empty">
          <strong>Nenhuma licitação encontrada</strong>
          <p>Tente remover o filtro de valor ou limpar a busca.</p>
          <button class="btn-limpar" onclick="
            if(document.getElementById('filtroLicitacao')) document.getElementById('filtroLicitacao').value='';
            if(document.getElementById('filtroValorLicitacao')) document.getElementById('filtroValorLicitacao').value='';
            window.ZELA && window.ZELA.renderLicitacoes && window.ZELA.renderLicitacoes(true);
          ">Limpar filtros</button>
        </div>`;
        if (licMaisWrap) licMaisWrap.hidden = true;
        return;
      }
      $("licitacoes").innerHTML = filtrados.slice(0, licShown).map(l => {
        const data = (l.data || "").split("-").reverse().join("/");
        return `
          <article class="lic">
            <div class="lic__num">Licitação nº ${l.numero || "—"}${l.ano ? "/" + l.ano : ""}</div>
            <p class="lic__obj">${esc(l.objeto)}</p>
            <div class="lic__meta">
              ${l.modalidade ? `<span><strong>${esc(l.modalidade)}</strong></span>` : ""}
              ${l.situacao ? `<span>${esc(l.situacao)}</span>` : ""}
              ${l.valor ? `<span>${fmtBRL(l.valor)}</span>` : ""}
              ${data ? `<span>${data}</span>` : ""}
            </div>
            <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
              <a class="btn-link" href="https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/82967" target="_blank" rel="noopener" title="Ver licitações no Portal Betha" style="text-decoration:none; padding: 3px 9px; background: #e8f4fd; border-radius: 4px; color: #1565c0; font-size: 0.78em; font-weight: 500; border: 1px solid #90caf9;">${window.ZELA.icon("lupa", { size: 14 })} Betha</a>
              <a class="btn-link" href="https://pncp.gov.br/app/editais?q=varginha" target="_blank" rel="noopener" title="Buscar no Portal Nacional de Contratações Públicas" style="text-decoration:none; padding: 3px 9px; background: #f3e5f5; border-radius: 4px; color: #6a1b9a; font-size: 0.78em; font-weight: 500; border: 1px solid #ce93d8;">${window.ZELA.icon ? window.ZELA.icon("documentos", { size: 12 }) : ""} PNCP</a>
            </div>
          </article>`;
      }).join("");
      if (licMaisWrap) licMaisWrap.hidden = filtrados.length <= licShown;

      // URL state sync
      (function () {
        const p = new URLSearchParams(window.location.search);
        if (q) p.set("lic_q", filtroLic.value.trim()); else p.delete("lic_q");
        if (vmin) p.set("lic_v", String(vmin)); else p.delete("lic_v");
        const str = p.toString();
        history.replaceState(null, "", str ? "?" + str + window.location.hash : window.location.pathname + window.location.hash);
      })();
    };

    if (licitacoes.length) {
      $("licitacoesBlock").hidden = false;
      window.ZELA.renderLicitacoes = renderLicitacoes;
      if (filtroLic)    filtroLic.addEventListener("input",  () => renderLicitacoes(true));
      if (filtroValLic) filtroValLic.addEventListener("change", () => renderLicitacoes(true));
      if (licMaisBtn)   licMaisBtn.addEventListener("click", () => { licShown += 12; renderLicitacoes(false); });

      // restore URL params
      (function () {
        const p = new URLSearchParams(window.location.search);
        if (filtroLic    && p.get("lic_q")) filtroLic.value    = p.get("lic_q");
        if (filtroValLic && p.get("lic_v")) filtroValLic.value = p.get("lic_v");
      })();

      renderLicitacoes(true);

      // CSV export para licitações
      const licCsvBtn = document.createElement("button");
      licCsvBtn.className = "btn-csv";
      licCsvBtn.textContent = "↓ CSV";
      licCsvBtn.title = "Baixar licitações filtradas como CSV";
      licCsvBtn.style.marginLeft = "8px";
      if (licContador) licContador.after(licCsvBtn);
      licCsvBtn.addEventListener("click", () => {
        const q    = norm(filtroLic ? filtroLic.value : "");
        const vmin = filtroValLic ? Number(filtroValLic.value || 0) : 0;
        const view = licitacoes.filter(l =>
          (!vmin || (Number(l.valor) || 0) >= vmin) &&
          (!q    || norm((l.objeto || "") + (l.modalidade || "")).includes(q))
        );
        exportCSV(view.map(l => ({
          numero:      `${l.numero || ""}/${l.ano || ""}`,
          objeto:      cleanText(l.objeto || ""),
          modalidade:  cleanText(l.modalidade || ""),
          situacao:    l.situacao || "",
          valor:       l.valor || 0,
          data:        l.data || "",
        })), [
          { key: "numero",     label: "Número" },
          { key: "objeto",     label: "Objeto" },
          { key: "modalidade", label: "Modalidade" },
          { key: "situacao",   label: "Situação" },
          { key: "valor",      label: "Valor (R$)" },
          { key: "data",       label: "Data" },
        ], `licitacoes-varginha-${new Date().toISOString().slice(0,10)}.csv`);
      });
    }
  }

  // ============= MÓDULOS PORTAL TRANSPARÊNCIA (prefeitura.html) =============
  if ($("modulos")) {
    const BETHA = "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==";
    const MODULOS = [
      { icon: "DESP", nome: "Despesas Públicas",
        desc: "Empenhos, liquidações, pagamentos. Despesas por credor, programa, função.",
        url: BETHA + "/consultas/41030" },
      { icon: "CONT", nome: "Contratos",
        desc: "Contratos vigentes da Prefeitura: vigência, valor, fornecedor.", url: BETHA },
      { icon: "LIC", nome: "Licitações",
        desc: "Processos licitatórios: dispensas, pregões, concorrências.", url: BETHA },
      { icon: "SERV", nome: "Servidores",
        desc: "Quadro de pessoal: nome, cargo, lotação dos servidores municipais.", url: BETHA },
      { icon: "FOLHA", nome: "Folha de Pagamento",
        desc: "Salários e vencimentos da folha mensal por servidor.", url: BETHA },
      { icon: "DIAR", nome: "Diárias",
        desc: "Diárias e passagens pagas a servidores e ao Prefeito.", url: BETHA },
      { icon: "OBRA", nome: "Obras",
        desc: "Obras em andamento e concluídas com mapa, status e valores.",
        url: BETHA + "/mapa-obras/83046" },
      { icon: "COMP", nome: "Compras Diretas",
        desc: "Compras feitas sem licitação (dispensa/inexigibilidade).", url: BETHA },
      { icon: "FROTA", nome: "Frotas",
        desc: "Veículos da Prefeitura, lotação e gastos com manutenção.", url: BETHA },
      { icon: "REC", nome: "Receitas Públicas",
        desc: "De onde vem o dinheiro: tributos, transferências, convênios.", url: BETHA },
      { icon: "DA", nome: "Dívida Ativa",
        desc: "Créditos da Prefeitura ainda não recebidos.", url: BETHA },
      { icon: "EDU", nome: "Educação Transparente",
        desc: "Indicadores e gastos da rede municipal de ensino.", url: BETHA },
    ];
    $("modulos").innerHTML = MODULOS.map(m => `
      <a class="module" href="${m.url}" target="_blank" rel="noopener">
        <span class="module__icon">${m.icon}</span>
        <div class="module__name">${m.nome}</div>
        <p class="module__desc">${m.desc}</p>
        <span class="module__cta">Abrir Portal Transparência →</span>
      </a>`).join("");
  }

  // ============= SHOWS E EVENTOS (prefeitura.html) =============
  if ($("eventosBlock")) {
    const itens = [
      ...(pf.contratos || []).map(c => ({ ...c, tipo_origem: "Contrato", valor_analise: c.valor || 0 })),
      ...(pf.licit_andamento || []).map(l => ({ ...l, contratado: l.fornecedor || l.contratado || "Andamento", tipo_origem: "Licitação", valor_analise: l.valor || 0 })),
      ...(pf.compras_diretas || []).map(cd => ({ ...cd, contratado: cd.fornecedor, tipo_origem: "Compra Direta", valor_analise: cd.valor || 0 })),
    ];

    const eventosConhecidos = [
      { nome: "Aniversário da Cidade", keys: ["aniversario", "aniversario de varginha"] },
      { nome: "Carnaval / Banho da Doroteia", keys: ["carnaval", "doroteia", "momo", "folia"] },
      { nome: "Varginha e Show", keys: ["varginha e show"] },
      { nome: "Réveillon / Virada", keys: ["reveillon", "revelion", "virada", "ano novo"] },
      { nome: "Roça Cidade", keys: ["roca cidade"] },
      { nome: "Natal / Iluminação", keys: ["natal", "papai noel"] },
      { nome: "Festa do Peão / Rodeio", keys: ["rodeio", "peao", "exposicao"] },
    ];

    const eventoForte = [
      "show", "show artistico", "apresentacao artistica", "artista", "banda",
      "cache", "cachê", "rodeio", "carnaval", "folia", "banho da doroteia",
      "varginha e show", "roca cidade", "marcha para jesus", "reveillon",
      "revelion", "virada", "festa do peao", "festa do peão", "queima de fogos",
      "evento anual", "evento do dia", "dia da cidade", "dia do trabalhador",
      "corpus christi", "festival", "feira", "exposição agropecuaria"
    ];
    const estruturaEvento = [
      "palco", "sonorizacao", "sonorização", "iluminacao cenica", "iluminação cenica",
      "iluminacao artistica", "iluminação artistica", "banheiro quimico",
      "banheiros quimicos", "tenda", "tendas", "camarote", "gradil", "grades",
      "gerador", "geradores", "estrutura de evento", "estrutura para evento",
      "montagem de estrutura", "locacao de estrutura", "locação de estrutura"
    ];
    const contextoEvento = [
      "evento", "show", "festa", "carnaval", "rodeio", "festival", "feira",
      "solenidade", "comemoracao", "comemoração", "dia da cidade", "dia do trabalhador",
      "reveillon", "revelion", "virada", "doroteia", "corpus christi", "marcha para jesus"
    ];
    const excluiOperacional = [
      "epi", "epi's", "equipamento de protecao", "equipamento de proteção",
      "botas", "bota", "tenis", "tênis", "luva", "luvas", "uniforme", "uniformes",
      "coleta", "poda", "fiscalizacao ambiental", "fiscalização ambiental",
      "servidores da coleta", "setor de fiscalizacao", "varricao", "varrição",
      "limpeza urbana", "seguranca do trabalho", "segurança do trabalho",
      "material de consumo", "material permanente", "medicamento", "merenda"
    ];

    const extrairEvento = (texto) => {
      const t = norm(texto);
      const ev = eventosConhecidos.find(e => e.keys.some(k => t.includes(norm(k))));
      return ev ? ev.nome : "Evento/show identificado";
    };

    const classificarEvento = (item) => {
      const texto = norm([item.objeto, item.contratado, item.modalidade].filter(Boolean).join(" "));
      if (excluiOperacional.some(k => texto.includes(norm(k)))) return null;
      if (eventoForte.some(k => texto.includes(norm(k)))) {
        return { nome: extrairEvento(item.objeto), confianca: "forte" };
      }
      const temEstrutura = estruturaEvento.some(k => texto.includes(norm(k)));
      const temContexto = contextoEvento.some(k => texto.includes(norm(k)));
      if (temEstrutura && temContexto) {
        return { nome: extrairEvento(item.objeto), confianca: "pista" };
      }
      return null;
    };

    const filtrados = itens.map(item => {
      const cls = classificarEvento(item);
      if (!cls) return null;
      return {
      ...item,
      evento: cls.nome,
      confianca_evento: cls.confianca,
      };
    }).filter(Boolean);

    if (true) {
      if ($("eventosBlock")) $("eventosBlock").hidden = false;
      const selectAno = $("filtroAnoEvento");
      const selectEvento = $("filtroNomeEvento");
      const buscaEvento = $("filtroBuscaEvento");
      const listaEl = $("listaEventos");
      const contadorEl = $("eventosContador");
      const statsEl = $("statsEventos");

      const nomesEventos = [...new Set(filtrados.map(f => f.evento))].sort();
      selectEvento.innerHTML += nomesEventos.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");

      const renderEventos = () => {
        const anoFiltro = selectAno.value || "";
        const evFiltro = selectEvento.value;
        const q = norm(buscaEvento.value.trim());
        const view = filtrados.filter(f => 
          (!anoFiltro || String(f.ano || f.data.split("-")[0] || "") === anoFiltro) &&
          (!evFiltro || f.evento === evFiltro) &&
          (!q || norm([f.objeto, f.contratado, f.evento].join(" ")).includes(q))
        );

        const total = view.reduce((s, f) => s + f.valor_analise, 0);
        const totalGeral = filtrados.reduce((s, f) => s + f.valor_analise, 0);
        
        statsEl.innerHTML = [
          { v: fmtBRL(total), l: "Valor Filtrado", s: `${fmtNum(view.length)} itens`, cls: "stat--teal" },
          { v: fmtBRL(totalGeral), l: "Gasto Total Mapeado", s: "Eventos, shows e estrutura", cls: "stat--navy" },
          { v: fmtNum(nomesEventos.length), l: "Eventos Identificados", s: "Classificação automática cautelosa", cls: "stat--gold" },
          { v: fmtNum(view.filter(f => f.confianca_evento === "forte").length), l: "Cruzamento forte", s: "Termo específico de evento/show", cls: "stat--teal" },
        ].map(s => `
          <div class="stat ${s.cls}">
            <div class="stat__value">${s.v}</div>
            <div class="stat__label">${s.l}</div>
            <div class="stat__sub">${s.s}</div>
          </div>`).join("");

        contadorEl.textContent = `${fmtNum(view.length)} itens encontrados`;

        // Ranking de Fornecedores
        const fornecedoresMap = {};
        view.forEach(f => {
          const nome = f.contratado || "Não identificado";
          fornecedoresMap[nome] = (fornecedoresMap[nome] || 0) + f.valor_analise;
        });
        const ranking = Object.entries(fornecedoresMap)
          .map(([nome, valor]) => ({ nome, valor }))
          .sort((a, b) => b.valor - a.valor)
          .slice(0, 10);

        const maxRanking = ranking[0].valor || 1;
        $("listaRankingEventos").innerHTML = ranking.map((f, i) => `
          <div class="forn-row">
            <span class="forn-row__rank">${i + 1}</span>
            <div>
              <div class="forn-row__nome">${esc(f.nome)}</div>
              <div class="forn-row__bar"><span class="forn-row__bar-fill" style="width:${(f.valor / maxRanking) * 100}%"></span></div>
            </div>
            <div class="forn-row__valor">${fmtBRL(f.valor)}</div>
          </div>`).join("");

        listaEl.innerHTML = view.sort((a,b) => b.valor_analise - a.valor_analise).map(f => {
          const data = (f.data_assinatura || f.data || "").split("-").reverse().join("/");
          return `
          <article class="contrato">
            <div class="contrato__valor">${fmtBRL(f.valor_analise)}</div>
            <div>
              <p class="contrato__nome">
                ${esc(f.contratado)}
                <span class="contrato__sit" style="background:#eee; color:#666">${esc(f.evento)}</span>
                ${confidenceBadge(f.confianca_evento)}
              </p>
              <p class="contrato__obj">${esc(f.objeto)}</p>
              <p class="small muted">${esc(confidenceInfo(f.confianca_evento).text)}</p>
              <div class="contrato__meta">
                <span><strong>${esc(f.tipo_origem)}</strong></span>
                <span>${esc(f.modalidade || "")}</span>
                ${data ? `<span>Data: ${data}</span>` : ""}
              </div>
              <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
                <a class="btn-link" href="https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043" target="_blank" rel="noopener" title="Buscar este contrato no Portal Betha" style="text-decoration:none; padding: 3px 9px; background: #e8f4fd; border-radius: 4px; color: #1565c0; font-size: 0.78em; font-weight: 500; border: 1px solid #90caf9;">${window.ZELA.icon("lupa", { size: 14 })} Betha</a>
                <a class="btn-link" href="https://transparencia.varginha.mg.gov.br/portal-transparencia/consultas/contratos" target="_blank" rel="noopener" title="Portal oficial (pode estar temporariamente indisponível)" style="text-decoration:none; padding: 3px 9px; background: #eee; border-radius: 4px; color: #555; font-size: 0.78em; font-weight: 500; border: 1px solid #ccc;">Portal oficial</a>
              </div>
            </div>
            <div class="contrato__cnpj">${esc(f.cnpj || "")}</div>
          </article>`;
        }).join("");
      };

      selectAno.addEventListener("change", renderEventos);
      selectEvento.addEventListener("change", renderEventos);
      buscaEvento.addEventListener("input", renderEventos);
      renderEventos();
    }
  }

  // ============= DIÁRIO OFICIAL (prefeitura.html) =============
  if ($("diarioLista")) {
    const ultimas = (D.diario && D.diario.ultimas) || [];
    if (!ultimas.length) {
      $("diarioLista").innerHTML =
        '<div class="empty">Não foi possível carregar o Diário Oficial.<br>' +
        'Acesse <a href="https://www.varginha.mg.gov.br/portal/diario-oficial">' +
        'varginha.mg.gov.br/portal/diario-oficial</a></div>';
    } else {
      // Ajusta classe do container para usar o design de cards
      $("diarioLista").className = "diario-list-whats";

      // Coleta dados adicionais para cruzamento
      const diarias = (D.diarias || {}).prefeitura || [];
      const contratos = pf.contratos || [];
      const licitAndamento = pf.licit_andamento || [];
      const licitFinalizadas = pf.licit_finalizadas || [];

      $("diarioLista").innerHTML = ultimas.slice(0, 24).map(d => {
        const dateStr = (d.data || "").split(" ")[0]; // YYYY-MM-DD
        const formattedDate = dateStr ? dateStr.split("-").reverse().join("/") : "";
        const url = d.url_pdf || `https://www.varginha.mg.gov.br/portal/diario-oficial/ver/${d.ano}/${d.edicao}`;

        // 1. Cruzamento
        const matchingContratos = contratos.filter(c => c.data_assinatura && c.data_assinatura.split(" ")[0] === dateStr);
        const matchingLicitAndamento = licitAndamento.filter(l => l.data && l.data.split(" ")[0] === dateStr);
        const matchingLicitFinalizadas = licitFinalizadas.filter(l => l.data && l.data.split(" ")[0] === dateStr);
        const matchingDiarias = diarias.filter(di => di.data_inicial && di.data_inicial.split(" ")[0] === dateStr);

        // 2. Estatísticas de Valores
        const sumContracts = matchingContratos.reduce((sum, c) => sum + (Number(c.valor) || 0), 0);
        const sumLicit = matchingLicitAndamento.reduce((sum, l) => sum + (Number(l.valor) || 0), 0) +
                         matchingLicitFinalizadas.reduce((sum, l) => sum + (Number(l.valor) || 0), 0);
        const sumDiarias = matchingDiarias.reduce((sum, di) => sum + (Number(di.valor_total) || 0), 0);
        const sumTotal = sumContracts + sumLicit + sumDiarias;

        // 3. Atos mapeados
        const atos = [];
        if (matchingContratos.length > 0) atos.push(`Contratos (${matchingContratos.length})`);
        if (matchingLicitAndamento.length > 0 || matchingLicitFinalizadas.length > 0) {
          atos.push(`Licitações (${matchingLicitAndamento.length + matchingLicitFinalizadas.length})`);
        }
        if (matchingDiarias.length > 0) atos.push(`Diárias (${matchingDiarias.length})`);
        const atosMapeadosText = atos.length > 0 ? atos.join(", ") : "Atos Gerais / Portarias";

        // 4. Heurística de Relevância (Alta, Média, Baixa)
        let relevance = "baixa";
        if (sumTotal > 500000 || matchingContratos.some(c => (Number(c.valor) || 0) > 200000)) {
          relevance = "alta";
        } else if (sumTotal > 50000 || matchingContratos.length > 0 || matchingLicitAndamento.length > 0 || matchingLicitFinalizadas.length > 0) {
          relevance = "média";
        }

        // 5. Heurística de Tema
        let theme = "Geral";
        const allObjects = [
          ...matchingContratos.map(c => c.objeto || ""),
          ...matchingLicitAndamento.map(l => l.objeto || ""),
          ...matchingLicitFinalizadas.map(l => l.objeto || "")
        ].join(" ");

        if (hasAny(allObjects, ["asfalt", "cbuq", "paviment", "recape", "buraco", "brita", "drenagem", "obras"])) {
          theme = "Infraestrutura / Obras";
        } else if (hasAny(allObjects, ["medic", "saude", "hospital", "ambulatorial", "ubs", "semus"])) {
          theme = "Saúde";
        } else if (hasAny(allObjects, ["escol", "creche", "cemei", "ensino", "alimentacao escolar", "merenda"])) {
          theme = "Educação";
        } else if (hasAny(allObjects, ["festa", "show", "evento", "natal", "revelion", "carnaval", "cache"])) {
          theme = "Eventos / Cultura";
        } else if (hasAny(allObjects, ["veiculo", "locacao de veiculos", "frota", "transporte"])) {
          theme = "Transporte / Frota";
        } else if (hasAny(allObjects, ["combustivel", "gasolina", "diesel"])) {
          theme = "Combustível";
        } else if (matchingDiarias.length > 0 && sumTotal === sumDiarias) {
          theme = "Diárias de Viagem";
        } else if (atos.length > 0) {
          theme = atos[0].split(" ")[0];
        }

        // 6. Resumo Executivo Cidadão
        let resumo = "";
        if (atos.length === 0) {
          resumo = "Publicação de portarias ordinárias, decretos regulamentares ou atos gerais sem impacto financeiro direto mapeado no painel.";
        } else {
          const parts = [];
          if (matchingContratos.length > 0) {
            parts.push(`Assinatura de <strong>${matchingContratos.length} contrato(s)</strong> somando <strong>${fmtBRL(sumContracts)}</strong>`);
          }
          if (matchingLicitAndamento.length > 0 || matchingLicitFinalizadas.length > 0) {
            parts.push(`Abertura/conclusão de <strong>${matchingLicitAndamento.length + matchingLicitFinalizadas.length} processo(s) licitatório(s)</strong> no valor estimado de <strong>${fmtBRL(sumLicit)}</strong>`);
          }
          if (matchingDiarias.length > 0) {
            parts.push(`Concessão de <strong>${matchingDiarias.length} diária(s) de viagem</strong> a servidores no total de <strong>${fmtBRL(sumDiarias)}</strong>`);
          }
          resumo = parts.join(", ") + " sob a responsabilidade dos órgãos da administração pública de Varginha.";
        }

        // 7. Envolvidos Mapeados
        const envolvidosSet = new Set();
        matchingContratos.forEach(c => {
          if (c.contratado) envolvidosSet.add(c.contratado.trim().toUpperCase());
          if (c.entidade) envolvidosSet.add(c.entidade.trim());
        });
        matchingLicitAndamento.forEach(l => {
          if (l.entidade) envolvidosSet.add(l.entidade.trim());
        });
        matchingLicitFinalizadas.forEach(l => {
          if (l.entidade) envolvidosSet.add(l.entidade.trim());
        });
        matchingDiarias.forEach(di => {
          if (di.funcionario) envolvidosSet.add(`Servidor: ${di.funcionario.trim().toUpperCase()}`);
        });

        const envolvidosList = Array.from(envolvidosSet);
        const envolvidosHtml = envolvidosList.length > 0
          ? envolvidosList.map(env => `<li>🏢 ${esc(env)}</li>`).join("")
          : "<li>🏛️ Prefeitura Municipal de Varginha (atos internos)</li>";

        // 8. Valores Identificados
        const valoresHtml = `
          <li>• Total da Edição Mapeado: <strong>${fmtBRL(sumTotal)}</strong></li>
          ${sumContracts > 0 ? `<li>• Contratos: ${fmtBRL(sumContracts)}</li>` : ""}
          ${sumLicit > 0 ? `<li>• Processos Licitatórios: ${fmtBRL(sumLicit)}</li>` : ""}
          ${sumDiarias > 0 ? `<li>• Diárias de Viagem: ${fmtBRL(sumDiarias)}</li>` : ""}
        `;

        // 9. Pontos de Atenção (Heurísticas)
        const atencao = [];
        matchingContratos.forEach(c => {
          const val = Number(c.valor) || 0;
          if (val > 1000000) {
            atencao.push(`• Contrato milionário: Nº ${c.numero || "s/n"} com ${c.contratado} no valor de ${fmtBRL(val)}`);
          }
          const mod = norm(c.modalidade || "");
          if (mod.includes("dispensa") || mod.includes("inexig")) {
            atencao.push(`• Contratação Direta (sem licitação): Contrato Nº ${c.numero || "s/n"} (${c.modalidade}) para ${c.objeto}`);
          }
          if ((c.objeto || "").length < 25) {
            atencao.push(`• Descrição muito curta/vaga no Contrato Nº ${c.numero || "s/n"}: "${c.objeto}"`);
          }
        });

        matchingDiarias.forEach(di => {
          const val = Number(di.valor_total) || 0;
          const qtd = Number(di.quantidade) || 1;
          const unit = val / qtd;
          if (unit >= 1000) {
            atencao.push(`• Diária individual de alto valor: R$ ${fmtBRL(val)} para ${di.funcionario} (Destino/Finalidade: ${di.finalidade || di.historico || "não informada"})`);
          }
        });

        if (hasAny(allObjects, ["judicial", "mandado", "liminar"])) {
          atencao.push("• Aquisição de medicamentos/insumos por mandado judicial ou liminar (judicialização da saúde)");
        }

        const atencaoHtml = atencao.length > 0
          ? atencao.map(ate => `<li>⚠️ ${esc(ate)}</li>`).join("")
          : "<li>✅ Nenhum ponto de atenção crítico ou dispensa de alto valor mapeado automaticamente nesta edição.</li>";

        // Texto formatado para o WhatsApp
        const textZapMsg = `📢 *DIÁRIO OFICIAL | VARGINHA*
📌 *Edição Nº ${d.edicao}${d.extra ? " (EXTRA)" : ""}*
📅 *Data:* ${formattedDate}

🗂️ *Atos Mapeados:* ${atos.length > 0 ? atos.join(", ") : "Atos Gerais / Portarias"}
🏛️ *Órgão:* Prefeitura Municipal de Varginha
⚠️ *Relevância:* ${relevance.toUpperCase()}
🧠 *Tema:* ${theme}

📝 *Resumo Executivo:*
${atos.length === 0 ? "Publicação de portarias ordinárias, decretos regulamentares ou atos gerais sem impacto financeiro direto mapeado no painel." : resumo.replace(/<\/?strong>/g, "*")}

🏢 *Envolvidos:*
${envolvidosList.length > 0 ? envolvidosList.map(e => `• ${e}`).join("\n") : "• Prefeitura Municipal de Varginha (atos internos)"}

💰 *Valores identificados:*
• Total Mapeado: ${fmtBRL(sumTotal)}
${sumContracts > 0 ? `• Contratos: ${fmtBRL(sumContracts)}` : ""}${sumLicit > 0 ? `• Licitações: ${fmtBRL(sumLicit)}` : ""}${sumDiarias > 0 ? `• Diárias: ${fmtBRL(sumDiarias)}` : ""}

🚨 *Pontos de atenção:*
${atencao.length > 0 ? atencao.join("\n") : "• Nenhum ponto de atenção crítico ou dispensa de alto valor mapeado automaticamente."}

🔗 *Publicação original:*
${url}

---
🔎 _Enviado via Fiscaliza Varginha - Painel Cidadão_`;

        // Atribui função de clique para compartilhamento dinâmico
        const shareId = `share_diario_${d.edicao}`;
        window.ZELA[shareId] = function() {
          if (navigator.share) {
            navigator.share({ title: `Diário Oficial nº ${d.edicao}`, text: textZapMsg }).catch(() => {});
          } else {
            const urlZap = `https://api.whatsapp.com/send?text=${encodeURIComponent(textZapMsg)}`;
            window.open(urlZap, "_blank");
          }
        };

        return `
          <article class="diario-whats-card" id="diario-card-${d.edicao}">
            <div class="diario-whats-card__header">
              <div class="diario-whats-card__title-block">
                <h4 class="diario-whats-card__title">
                  📢 DIÁRIO OFICIAL | VARGINHA
                </h4>
                <div class="diario-whats-card__subtitle">
                  Edição Nº ${d.edicao} ${d.extra ? '<span class="diario__extra">EXTRA</span>' : ""}
                </div>
              </div>
              <span class="diario-relevancia-badge diario-relevancia-badge--${relevance}">
                Relevância: ${relevance}
              </span>
            </div>

            <div class="diario-whats-card__meta-grid">
              <div class="diario-whats-card__meta-item">
                <strong>📅 Data da Edição:</strong> ${formattedDate}
              </div>
              <div class="diario-whats-card__meta-item">
                <strong>🗂️ Atos Mapeados:</strong> ${atosMapeadosText}
              </div>
              <div class="diario-whats-card__meta-item">
                <strong>🏛️ Órgão Emissor:</strong> Prefeitura Municipal de Varginha
              </div>
              <div class="diario-whats-card__meta-item">
                <strong>🧠 Tema Heurístico:</strong> ${theme}
              </div>
            </div>

            <div class="diario-whats-card__section">
              <div class="diario-whats-card__section-title">📝 Resumo Executivo</div>
              <div class="diario-whats-card__resumo">${resumo}</div>
            </div>

            <div class="diario-whats-card__section">
              <div class="diario-whats-card__section-title">🏢 Envolvidos Mapeados</div>
              <ul class="diario-whats-card__list">
                ${envolvidosHtml}
              </ul>
            </div>

            <div class="diario-whats-card__section">
              <div class="diario-whats-card__section-title">💰 Valores Identificados</div>
              <ul class="diario-whats-card__list">
                ${valoresHtml}
              </ul>
            </div>

            <div class="diario-whats-card__section">
              <div class="diario-whats-card__section-title">🚨 Pontos de Atenção (Heurísticas Zela)</div>
              <ul class="diario-whats-card__list">
                ${atencaoHtml}
              </ul>
            </div>

            <div class="diario-whats-card__actions">
              <div class="diario-whats-card__buttons">
                <button type="button" class="diario-whats-card__btn-zap" onclick="window.ZELA.${shareId}()" aria-label="Compartilhar resumo da edição nº ${d.edicao} no WhatsApp">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle; margin-right:4px;"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.513 2.262 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.27-4.103c1.623.963 3.238 1.468 4.873 1.469 5.585-.001 10.13-4.549 10.133-10.139.002-2.709-1.051-5.253-2.962-7.168C16.46 2.14 13.918.99 11.996.99c-5.59 0-10.136 4.547-10.14 10.138-.001 1.762.477 3.486 1.385 5.011l-.946 3.454 3.543-.929zm13.111-7.795c-.32-.16-1.89-.933-2.185-1.041-.295-.108-.51-.16-.723.16-.214.32-.828 1.042-1.015 1.258-.187.215-.374.242-.693.083-.32-.16-1.349-.497-2.57-1.587-.949-.846-1.59-1.892-1.777-2.213-.187-.32-.02-.493.14-.653.143-.144.32-.373.48-.56.16-.188.213-.32.32-.533.107-.213.053-.4-.027-.56-.08-.16-.723-1.741-.99-2.382-.26-.628-.525-.544-.723-.554-.187-.01-.4-.012-.613-.012s-.56.08-.853.4c-.293.32-1.12 1.093-1.12 2.667 0 1.573 1.147 3.093 1.307 3.307.16.213 2.257 3.447 5.467 4.833.763.33 1.36.527 1.823.674.767.244 1.466.21 2.018.128.614-.092 1.89-.773 2.157-1.48.267-.707.267-1.314.187-1.44-.08-.127-.295-.213-.615-.373z"/></svg>
                  Copiar WhatsApp
                </button>
                <a class="diario-whats-card__btn-link" href="${url}" target="_blank" rel="noopener">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle; margin-right:4px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                  Ver PDF
                </a>
              </div>
              <div class="data-trust-seal-container" id="seal-container-${d.edicao}"></div>
            </div>
          </article>
        `;
      }).join("");

      // Injeta selos de confiança
      ultimas.slice(0, 24).forEach(d => {
        const sealContainer = $(`seal-container-${d.edicao}`);
        if (sealContainer && window.ZELA.dataTrustSeal) {
          sealContainer.innerHTML = window.ZELA.dataTrustSeal("diaria", {
            fonte: "Diário Oficial / Betha Transparência",
            escopo: "cruzamento automatizado",
            risco: "não dispensa a leitura da publicação completa no PDF oficial",
            acao: "auditar com base nas leis de responsabilidade fiscal",
            tone: "ok"
          });
        }
      });

      // Enriquece com tooltips do glossário
      if (window.ZELA.enriquecerGlossario) {
        window.ZELA.enriquecerGlossario($("diarioLista"));
      }
    }
  }

  // ============= BUSCA DO HUB =============
  // No hub: redireciona pra página apropriada com q=...
  function buscaHome(providedQ) {
    const inp = $("buscaHome");
    const q = (providedQ || (inp && inp.value) || "").trim();
    if (!q) return;
    const qN = norm(q);
    const cleanDigits = q.replace(/[^\d]/g, "");
    const camaraHit =
      (D.vereadores || []).some(v => norm(v.nome).includes(qN)) ||
      (D.emendas || []).some(e =>
        norm(e.beneficiario).includes(qN) ||
        norm(e.autor).includes(qN) ||
        norm(e.objeto).includes(qN) ||
        ((e.cnpj || "").replace(/[^\d]/g, "").includes(cleanDigits) && cleanDigits.length >= 4)
      );
    const url = camaraHit
      ? "camara.html?q=" + encodeURIComponent(q)
      : "prefeitura.html?q=" + encodeURIComponent(q);
    window.location.href = url;
  }

  // Aplica q=... vindo do hub: pré-preenche os filtros e rola.
  (function applyQueryQ() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (!q) return;
    if (PAGE === "camara") {
      // Aplica busca no campo de contratos da Câmara também
      if (renderContratosCamara && $("filtroContratoCamara")) {
        $("filtroContratoCamara").value = q;
        renderContratosCamara(true);
      }
      if (renderVereadores && $("filtroVer")) {
        $("filtroVer").value = q; renderVereadores();
      }
      if (renderEmendas && $("filtroEm")) {
        $("filtroEm").value = q; renderEmendas(true);
      }
      // Rola para o bloco de contratos primeiro (mais relevante p/ "Ver contratos")
      setTimeout(() => {
        const targetCam = $("contratosCamaraBlock") || $("contratosCamara") || $("emendas");
        if (targetCam) scrollToEl(targetCam);
      }, 100);
    } else if (PAGE === "prefeitura") {
      if (renderContratos && $("filtroContrato")) {
        $("filtroContrato").value = q;
        const ano = params.get("ano");
        const valor = params.get("valor");
        if (ano && $("filtroAnoContrato")) $("filtroAnoContrato").value = ano;
        if (valor && $("filtroValorContrato")) $("filtroValorContrato").value = valor;
        const sec = params.get("sec");
        if (sec && $("filtroSecretaria")) $("filtroSecretaria").value = sec;
        renderContratos(true);
        // Força mudança para aba "Contratos" — senão usuário não vê o filtro aplicado
        // (página abre na aba "Visão geral" por padrão)
        const tabContratos = document.querySelector('.pref-tab[data-pref-tab="contratos"]');
        if (tabContratos) {
          tabContratos.click();
          // Scroll só depois do clique processar
          setTimeout(() => scrollToEl($("contratosBlock")), 100);
        } else {
          scrollToEl($("contratosBlock"));
        }
      }
    }
  })();


  // ===========================================================================
  // PESSOAL E CARGOS
  // ===========================================================================
  function initPessoal() {
    const pesSlim = D.pessoal || {};
    // prefeitura.servidores é removido do bundle data.js para economizar ~2MB.
    // Carrega pessoal.json completo via fetch apenas quando a página pessoal é aberta.
    const hasPrefServs = (pesSlim.prefeitura?.servidores?.length || 0) > 0;
    if (!hasPrefServs && location.protocol !== "file:") {
      fetch("data/chunks/pessoal.json")
        .then(r => r.json())
        .then(fullPes => _runInitPessoal(fullPes))
        .catch(() => _runInitPessoal(pesSlim));
    } else {
      _runInitPessoal(pesSlim);
    }
  }

  function _runInitPessoal(pes) {
    const camaraServ = (pes.camara || {}).servidores || [];
    const prefServ   = (pes.prefeitura || {}).servidores || [];
    
    const todos = [
      ...camaraServ.map(s => ({ ...s, orgao: "Câmara" })),
      ...prefServ.map(s => ({ ...s, orgao: "Prefeitura" }))
    ];

    const buscaEl    = $("buscaServidor");
    const orgaoEl    = $("filtroOrgao");
    const tipoEl     = $("filtroTipo");
    const listaEl    = $("listaPessoal");
    const contadorEl = $("pessoalContador");
    if ($("pessoalFonteNota")) {
      const prefStatus = pes.prefeitura.status || "";
      const camStatus = pes.camara.status || "";
      $("pessoalFonteNota").innerHTML = `
        <strong>Nota sobre a fonte:</strong>
        ${esc(camStatus || "Camara coletada quando a fonte permitir.")}
        ${prefStatus ? `<br>${esc(prefStatus)}` : ""}
        <br>Use estes dados como trilha inicial de auditoria e confira o mes/competencia no portal oficial.`;
    }

    const PESSOAL_PAGE = 50;
    let _pessoalOffset = 0;
    let _pessoalView = [];
    let _pessoalQ = "";

    const _renderServCard = (s) => {
      const isCom = s.comissionado_ou_similar || /COMISSION/i.test(s.lotacao || "");
      return `<article class="contrato">
        <div class="contrato__valor">
          ${fmtBRL(s.vencimentos)}
          <div class="small muted">Bruto/Vencimento</div>
        </div>
        <div>
          <p class="contrato__nome">
            ${highlight(s.nome, _pessoalQ)}
            ${isCom ? '<span class="em__status em__status--no">Comissionado</span>' : '<span class="em__status em__status--ok">Servidor</span>'}
          </p>
          <p class="contrato__obj"><strong>Cargo/Lotação:</strong> ${highlight(s.lotacao, _pessoalQ)}</p>
          <div class="contrato__meta">
            <span><strong>Órgão:</strong> ${esc(cleanText(s.orgao))}</span>
            ${s.matricula ? `<span><strong>Matrícula:</strong> ${s.matricula}</span>` : ""}
          </div>
        </div>
      </article>`;
    };

    const _doRenderServidores = () => {
      const slice = _pessoalView.slice(0, _pessoalOffset + PESSOAL_PAGE);
      listaEl.innerHTML = slice.map(_renderServCard).join("");
      const maisId = "pessoalLoadMore";
      let maisEl = document.getElementById(maisId);
      const rest = _pessoalView.length - slice.length;
      if (rest > 0) {
        if (!maisEl) {
          maisEl = document.createElement("button");
          maisEl.id = maisId;
          maisEl.className = "btn-load-more";
          listaEl.after(maisEl);
        }
        maisEl.textContent = `Carregar mais ${Math.min(PESSOAL_PAGE, rest)} servidores (${rest} restantes)`;
        maisEl.onclick = () => { _pessoalOffset += PESSOAL_PAGE; _doRenderServidores(); };
      } else if (maisEl) {
        maisEl.remove();
      }
    };

    const render = () => {
      _pessoalOffset = 0;
      const q = norm(buscaEl.value.trim());
      const orgao = orgaoEl.value;
      const tipo = tipoEl.value;

      _pessoalQ = q;
      _pessoalView = todos.filter(s => {
        const matchesQ = !q || norm([s.nome, s.lotacao].join(" ")).includes(q);
        const matchesOrgao = !orgao || norm(s.orgao).includes(orgao);
        const isCom = s.comissionado_ou_similar || /COMISSION/i.test(s.lotacao || "");
        const matchesTipo = !tipo || (tipo === "comissionado" ? isCom : !isCom);
        return matchesQ && matchesOrgao && matchesTipo;
      });

      const com = _pessoalView.filter(s => s.comissionado_ou_similar || /COMISSION/i.test(s.lotacao || ""));
      const folhaCom = com.reduce((sum, s) => sum + (Number(s.vencimentos) || 0), 0);

      if ($("totServidores")) $("totServidores").textContent = todos.length;
      if ($("totComissionados")) $("totComissionados").textContent = com.length;
      if ($("pctComissionados")) $("pctComissionados").textContent = todos.length ? ((com.length / todos.length) * 100).toFixed(1) + "%" : "0%";
      if ($("custoFolha")) $("custoFolha").textContent = fmtBRL(folhaCom);

      contadorEl.textContent = `${_pessoalView.length} registro(s) encontrado(s)`;

      if (!_pessoalView.length) {
        listaEl.innerHTML = "";
        const maisEl = document.getElementById("pessoalLoadMore");
        if (maisEl) maisEl.remove();
        $("pessoalEmpty").style.display = "block";
        return;
      }
      $("pessoalEmpty").style.display = "none";
      _doRenderServidores();
    };

    // Comparativo comissionados Câmara × Prefeitura
    const blocoComp = $("bloco-comparativo-comissionados");
    const divComp   = $("comparativoComissionados");
    const camRes  = (pes.camara   || {}).resumo || {};
    const prefRes = (pes.prefeitura || {}).resumo || {};
    const camQtd  = camRes.comissionados_qtd  || 0;
    const camTot  = camRes.servidores_qtd     || 0;
    const prefQtd = prefRes.comissionados_qtd  || 0;
    const prefTot = prefRes.servidores_qtd     || 0;
    if (blocoComp && divComp && (camTot > 0 || prefTot > 0)) {
      blocoComp.hidden = false;
      const pctCam  = camTot  ? (camQtd  / camTot  * 100) : 0;
      const pctPref = prefTot ? (prefQtd / prefTot * 100) : 0;
      const barMax  = Math.max(pctCam, pctPref, 1);
      const mkBar = (label, com, tot, pct, folhaCom, cor) => `
        <div style="margin-bottom:20px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
            <strong>${esc(label)}</strong>
            <span style="font-size:1.4em;font-weight:700;color:${cor}">${pct.toFixed(1)}%</span>
          </div>
          <div style="background:#e8edf3;border-radius:4px;height:22px;overflow:hidden">
            <div style="width:${Math.min(pct/barMax*100,100).toFixed(1)}%;height:100%;background:${cor};border-radius:4px;transition:width .5s"></div>
          </div>
          <div class="small muted" style="margin-top:4px">
            ${fmtNum(com)} comissionados de ${fmtNum(tot)} servidores
            ${folhaCom ? ` · Folha comissionados: <strong>${fmtBRL(folhaCom)}</strong>/mês` : ""}
          </div>
        </div>`;
      divComp.innerHTML =
        mkBar("Câmara Municipal",  camQtd,  camTot,  pctCam,
              camRes.folha_bruta_comissionados  || 0, "#c0392b") +
        mkBar("Prefeitura",        prefQtd, prefTot, pctPref,
              prefRes.folha_bruta_comissionados || 0, "#2980b9") +
        (camTot > 0 && prefTot > 0 ? `
        <div class="report-note" style="margin-top:8px;border-left:4px solid #c0392b;padding-left:12px">
          A Câmara tem <strong>${pctCam.toFixed(1)}% de comissionados</strong> —
          ${pctPref > 0 ? `${(pctCam/pctPref).toFixed(0)}× mais que a Prefeitura (${pctPref.toFixed(1)}%).` : "contra proporção mínima na Prefeitura."}
          Uma Câmara Municipal com quadro legislativo enxuto deveria ter proporção próxima de zero.
        </div>` : "");
    }

    // Ranking top-10 comissionados por vencimento
    const rankingEl = $("rankingComissionados");
    if (rankingEl) {
      const todosComissionados = todos
        .filter(s => s.comissionado_ou_similar || /COMISSION/i.test(s.lotacao || ""))
        .sort((a, b) => (b.vencimentos || 0) - (a.vencimentos || 0))
        .slice(0, 10);
      if (todosComissionados.length) {
        rankingEl.innerHTML = todosComissionados.map((s, i) => `
          <article class="contrato" style="border-left:4px solid ${s.orgao === "Câmara" ? "#c0392b" : "#2980b9"}">
            <div class="contrato__valor">
              ${fmtBRL(s.vencimentos || 0)}
              <div class="small muted">${esc(s.orgao)}</div>
            </div>
            <div>
              <p class="contrato__nome">${i + 1}. ${esc(s.nome || "Sem nome")}</p>
              <p class="contrato__obj">${esc(s.cargo || s.lotacao || "Cargo não informado")}</p>
              <div class="contrato__meta">
                <span>Líquido: <strong>${fmtBRL(s.liquido || 0)}</strong></span>
                ${s.matricula ? `<span>Mat. ${s.matricula}</span>` : ""}
              </div>
            </div>
          </article>`).join("");
      }
    }

    buscaEl.addEventListener("input", render);
    orgaoEl.addEventListener("change", render);
    tipoEl.addEventListener("change", render);

    // Aplica parâmetros de URL: ?tipo=comissionado, ?orgao=camara, ?q=nome
    (function applyPessoalParams() {
      const p = new URLSearchParams(window.location.search);
      const tipo  = p.get("tipo");
      const orgao = p.get("orgao");
      const q     = p.get("q");
      if (tipo  && tipoEl)  tipoEl.value  = tipo;
      if (orgao && orgaoEl) orgaoEl.value = orgao;
      if (q     && buscaEl) buscaEl.value = q;
    })();

    render();

    // CSV export button for servidores
    if (todos.length && contadorEl) {
      const csvBtnP = document.createElement("button");
      csvBtnP.className = "btn-csv"; csvBtnP.textContent = "↓ CSV";
      csvBtnP.title = "Baixar servidores filtrados como CSV";
      csvBtnP.style.marginLeft = "8px";
      contadorEl.after(csvBtnP);
      csvBtnP.addEventListener("click", () => {
        exportCSV(_pessoalView.map(s => ({
          nome: cleanText(s.nome || ""),
          cargo: cleanText(s.lotacao || ""),
          orgao: cleanText(s.orgao || ""),
          vinculo: (s.comissionado_ou_similar || /COMISSION/i.test(s.lotacao || "")) ? "Comissionado" : "Concursado/Outro",
          matricula: s.matricula || "",
          vencimentos: s.vencimentos || 0,
        })), [
          { key: "nome",       label: "Nome" },
          { key: "cargo",      label: "Cargo/Lotação" },
          { key: "orgao",      label: "Órgão" },
          { key: "vinculo",    label: "Vínculo" },
          { key: "matricula",  label: "Matrícula" },
          { key: "vencimentos",label: "Vencimentos (R$)" },
        ], `servidores-varginha-${new Date().toISOString().slice(0,10)}.csv`);
      });
    }
  }

  // ============= ASFALTO E OBRAS VIARIAS (prefeitura.html) =============
  function renderAsfaltoPrefeitura() {
    const root = $("asfaltoPainel");
    if (!root) return;
    const termos = ["asfalto", "asfaltica", "asfaltico", "cbuq", "pavimentacao", "pavimenta", "recape", "tapa buraco", "tapa-buraco", "buraco", "drenagem", "meio fio", "sarjeta"];
    const textoItem = (i) => cleanText([i.origem, i.objeto, i.descricao, i.categoria, i.tipo_obra, i.contratado, i.fornecedor, i.endereco, i.bairro, i.situacao].filter(Boolean).join(" "));
    const ehAsfalto = (i) => {
      const txt = norm(textoItem(i));
      return termos.some(t => txt.includes(norm(t))) && !["pneu", "pneus", "pista de pouso"].some(t => txt.includes(norm(t)));
    };
    const tipo = (i) => {
      const txt = norm(textoItem(i));
      if (hasAny(txt, ["tapa buraco", "tapa-buraco", "buraco"])) return "Tapa-buraco";
      if (hasAny(txt, ["recape"])) return "Recapeamento";
      if (hasAny(txt, ["cbuq", "massa asfaltica", "concreto betuminoso"])) return "Massa asfaltica/CBUQ";
      if (hasAny(txt, ["drenagem", "meio fio", "sarjeta"])) return "Drenagem/meio-fio";
      return "Pavimentacao/obra viaria";
    };
    const locais = (i) => cleanText(i.endereco || [i.logradouro, i.bairro].filter(Boolean).join(", ")) || "Local não informado no objeto";
    const dataItem = (i) => dataCurtaBR(i.data_inicio || i.data_ordem_servico || i.data_ultima_medicao || i.data_assinatura || i.data || "");
    const bases = [
      ...(pf.obras_publicas || []).map(i => ({ ...i, origem: "Obra pública Betha", valor_asfalto: Number(i.valor || 0), obra_publica: true })),
      ...(pf.contratos || []).map((i, idx) => ({ ...i, origem: "Contrato", valor_asfalto: Number(i.valor || 0), contratoIdx: idx })),
      ...(pf.licit_andamento || []).map(i => ({ ...i, origem: "Licitação em andamento", valor_asfalto: Number(i.valor || 0) })),
      ...(pf.licit_finalizadas || []).map(i => ({ ...i, origem: "Licitação finalizada", valor_asfalto: Number(i.valor || 0) })),
      ...(pf.compras_diretas || []).map(i => ({ ...i, origem: "Compra direta", valor_asfalto: Number(i.valor || 0) })),
    ].filter(ehAsfalto).map(i => {
      const area = Number(i.area_m2 || 0);
      return {
        ...i,
        tipo_asfalto: tipo(i),
        local_asfalto: locais(i),
        custo_m2: area && i.valor_asfalto ? i.valor_asfalto / area : 0,
        pendencias: [
          ...(locais(i).startsWith("Local não") ? ["Rua/bairro"] : []),
          ...(!area ? ["Metragem/quantidade", "Custo unitário"] : []),
          ...(!(i.responsavel || i.medicao_responsavel) ? ["Fiscal responsável"] : []),
          ...(!i.data_ultima_medicao ? ["Medição"] : []),
        ],
      };
    }).sort((a, b) => Number(b.valor_asfalto || 0) - Number(a.valor_asfalto || 0));

    const total = bases.reduce((s, i) => s + Number(i.valor_asfalto || 0), 0);
    const oficiais = bases.filter(i => i.obra_publica).length;
    const fila = bases.filter(i => i.pendencias.length).slice(0, 4);
    window.ZELA._asfaltoLAI = {};

    root.innerHTML = `
      <div class="asfalto-dashboard">
        <article class="asfalto-hero">
          <span class="reader-summary__label">Recorte viário</span>
          <h4>${fmtBRL(total)}</h4>
          <p>${fmtNum(bases.length)} registro(s) localizados. Inclui ${fmtNum(oficiais)} obra(s) oficiais da consulta Betha 83026.</p>
        </article>
        <div class="asfalto-metrics">
          <article><strong>${fmtNum(bases.length)}</strong><span>registro(s)</span></article>
          <article><strong>${fmtNum(oficiais)}</strong><span>obra(s) oficiais Betha</span></article>
          <article><strong>${bases.some(i => i.custo_m2) ? fmtBRL(total / bases.reduce((s, i) => s + Number(i.area_m2 || 0), 0)) : "Sem m²"}</strong><span>custo médio por m²</span></article>
          <article><strong>${fmtNum(fila.length)}</strong><span>Faltam dados para auditar</span></article>
        </div>
      </div>
      ${fila.length ? `<section class="asfalto-pendencias"><div class="asfalto-pendencias__head"><span>Fila de cobrança</span><strong>Faltam dados para auditar ${fmtNum(fila.length)} item(ns)</strong></div>${fila.map((i, idx) => `<article><div><strong>${esc(i.contratado || i.fornecedor || i.categoria || "Item viário")}</strong><p>${esc(i.tipo_asfalto)} · ${fmtBRL(i.valor_asfalto || 0)} · Data: ${esc(dataItem(i))}</p><span class="asfalto-pending-chips">${i.pendencias.map(p => `<i>${esc(p)}</i>`).join("")}</span></div></article>`).join("")}</section>` : ""}
      <div class="report-note asfalto-note"><strong>Como ler este recorte</strong><p>Valor contratado não prova execução. Para saber onde foi feito e quanto custou por rua, peça medição por trecho, metragem, notas, fotos e fiscal responsável.</p></div>
      <div class="asfalto-lista">
        ${bases.slice(0, 40).map((i, idx) => {
          const id = `asfalto-${idx}`;
          window.ZELA._asfaltoLAI[id] = `Solicito documentos do ${i.origem} relacionado a asfalto/pavimentação: objeto, local por rua/bairro, metragem, medição, notas fiscais, fiscal responsável e fotos antes/depois. Item: ${i.numero || i.id_obra || "s/n"} - ${i.objeto || i.descricao || ""}`;
          const url = i.obra_publica ? "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83026" : "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043";
          return `<article class="asfalto-card">
            <div class="asfalto-card__valor">${fmtBRL(i.valor_asfalto || 0)}</div>
            <div class="asfalto-card__body">
              <div class="asfalto-card__head"><strong>${esc(i.contratado || i.fornecedor || i.categoria || "Obra viária")}</strong><span>${esc(i.tipo_asfalto)}</span></div>
              <div class="asfalto-card__grid">
                <span><b>Origem:</b> ${esc(i.origem)}</span>
                <span><b>Data:</b> ${esc(dataItem(i))}</span>
                ${i.situacao ? `<span><b>Situação:</b> ${esc(i.situacao)}${i.percentual_executado ? ` · ${fmtNum(i.percentual_executado)}% executado` : ""}</span>` : ""}
                ${i.data_ultima_medicao ? `<span><b>Última medição:</b> ${esc(dataCurtaBR(i.data_ultima_medicao))}${i.valor_medicao ? ` · ${fmtBRL(i.valor_medicao)}` : ""}</span>` : ""}
                ${i.responsavel || i.medicao_responsavel ? `<span><b>Responsável:</b> ${esc(i.responsavel || i.medicao_responsavel)}</span>` : ""}
                <span><b>Local:</b> ${esc(i.local_asfalto)}</span>
                <span><b>Metragem/quantidade:</b> ${i.area_m2 ? `${fmtNum(i.area_m2)} m²` : "Metragem/quantidade não publicada"}</span>
                <span><b>Custo unitário:</b> ${i.custo_m2 ? `${fmtBRL(i.custo_m2)}/m²` : "Não calculável"}</span>
              </div>
              <p>${esc(i.objeto || i.descricao || "Objeto não informado")}</p>
              <div class="asfalto-card__actions"><button type="button" class="btn-dossie" onclick="ZELA.copiarAsfaltoLAI('${id}', this)">Copiar pergunta LAI</button><a class="btn-link" href="${url}" target="_blank" rel="noopener">Abrir Betha</a></div>
            </div>
          </article>`;
        }).join("")}
      </div>`;
  }

  window.ZELA.copiarAsfaltoLAI = (id, btn) => {
    const texto = (window.ZELA._asfaltoLAI || {})[id] || "";
    if (!texto) return;
    const old = btn ? btn.textContent : "";
    navigator.clipboard.writeText(texto).then(() => {
      if (btn) {
        btn.textContent = "Pergunta copiada";
        setTimeout(() => { btn.textContent = old; }, 1600);
      }
    }).catch(() => {});
  };

  // ============= FROTA MUNICIPAL (prefeitura.html) =============
  function dataCurtaBR(raw) {
    const s = cleanText(raw || "");
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return s || "Data não informada";
  }

  function perguntaLAIFrota(item) {
    return [
      `Solicito, com base na Lei de Acesso à Informação, os documentos de controle do veículo ${item.placa || "sem placa"} (${item.descricao || item.tipo || "veículo municipal"}).`,
      [
        "Dados localizados no painel:",
        `- Centro de custo/secretaria: ${item.centro_custo || "não informado"}.`,
        `- Situação: ${item.situacao || "não informada"}.`,
        `- Tipo de aquisição: ${item.tipo_aquisicao || "não informado"}.`,
        `- Gasto vinculado localizado: ${fmtBRL(item.gastos_total || 0)} em ${fmtNum(item.gastos_qtd || 0)} lançamento(s).`,
        `- Combustível: ${fmtBRL(item.combustivel_total || 0)}${item.litros_combustivel ? ` (${fmtNum(item.litros_combustivel)} L)` : ""}.`,
        `- Manutenção/peças/serviços: ${fmtBRL(item.manutencao_total || 0)}.`,
      ].join("\n"),
      "Peço envio de: contrato ou termo de locação/cessão/aquisição, controle de quilometragem, diário de bordo, ordens de abastecimento, notas fiscais, empenhos/liquidações/pagamentos, manutenções realizadas, responsável pelo uso, secretaria de lotação e justificativa de permanência na frota.",
      "Caso o veículo seja locado, informar valor mensal, contrato vigente, vigência, quilometragem incluída e custos adicionais pagos fora do contrato.",
    ].join("\n\n");
  }

  function renderFrotaPrefeitura() {
    const block = $("frotaBlock");
    if (!block) return;
    const frota = pf.frota || [];
    const statsEl = $("frotaStats");
    const auditEl = $("frotaAudit");
    const listaEl = $("frotaLista");
    const countEl = $("frotaContador");
    if (!frota.length) {
      if (listaEl) listaEl.innerHTML = `<div class="empty"><strong>Frota não carregada</strong><p>Rode a coleta Betha para baixar a consulta 83061 - Veículos Municipais.</p></div>`;
      return;
    }

    const fillSelect = (id, values, label) => {
      const el = $(id);
      if (!el) return;
      const atual = el.value;
      el.innerHTML = `<option value="">${esc(label)}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
      if (values.includes(atual)) el.value = atual;
    };

    const centros = [...new Set(frota.map(v => cleanText(v.centro_custo)).filter(Boolean))].sort();
    const situacoes = [...new Set(frota.map(v => cleanText(v.situacao)).filter(Boolean))].sort();
    const aquisicoes = [...new Set(frota.map(v => cleanText(v.tipo_aquisicao)).filter(Boolean))].sort();
    fillSelect("filtroCentroFrota", centros, "Todos os centros de custo");
    fillSelect("filtroSituacaoFrota", situacoes, "Todas as situações");
    fillSelect("filtroAquisicaoFrota", aquisicoes, "Próprios, locados e cedidos");

    const state = {
      q: norm($("filtroFrota")?.value || ""),
      situacao: $("filtroSituacaoFrota")?.value || "",
      aquisicao: $("filtroAquisicaoFrota")?.value || "",
      centro: $("filtroCentroFrota")?.value || "",
      ordem: $("ordenarFrota")?.value || "gasto_desc",
    };

    let view = frota.filter(v => {
      if (state.situacao && v.situacao !== state.situacao) return false;
      if (state.aquisicao && v.tipo_aquisicao !== state.aquisicao) return false;
      if (state.centro && v.centro_custo !== state.centro) return false;
      if (!state.q) return true;
      const texto = norm([
        v.placa, v.tipo, v.descricao, v.centro_custo, v.situacao, v.tipo_aquisicao,
        ...(v.fornecedores_gastos || []).map(f => f.nome),
        ...(v.gastos_recentes || []).map(g => `${g.tipo} ${g.fornecedor} ${g.descricao}`),
      ].join(" "));
      return texto.includes(state.q);
    });

    const sorter = {
      gasto_desc: (a, b) => Number(b.gastos_total || 0) - Number(a.gastos_total || 0),
      combustivel_desc: (a, b) => Number(b.combustivel_total || 0) - Number(a.combustivel_total || 0),
      manutencao_desc: (a, b) => Number(b.manutencao_total || 0) - Number(a.manutencao_total || 0),
      modelo: (a, b) => cleanText(a.descricao).localeCompare(cleanText(b.descricao), "pt-BR"),
      centro: (a, b) => cleanText(a.centro_custo).localeCompare(cleanText(b.centro_custo), "pt-BR"),
    }[state.ordem] || ((a, b) => Number(b.gastos_total || 0) - Number(a.gastos_total || 0));
    view = view.slice().sort(sorter);

    const totalGastos = view.reduce((s, v) => s + Number(v.gastos_total || 0), 0);
    const totalAtipico = view.reduce((s, v) => s + Number(v.gastos_atipicos_total || 0), 0);
    const totalComb = view.reduce((s, v) => s + Number(v.combustivel_total || 0), 0);
    const totalManut = view.reduce((s, v) => s + Number(v.manutencao_total || 0), 0);
    const ativos = view.filter(v => norm(v.situacao) === "ativo").length;
    const locados = view.filter(v => norm(v.tipo_aquisicao) === "locado").length;
    const semCentro = view.filter(v => !cleanText(v.centro_custo)).length;
    const inativosComGasto = view.filter(v => norm(v.situacao) === "inativo" && Number(v.gastos_total || 0) > 0).length;
    const veiculosAtipicos = view.filter(v => Number(v.gastos_atipicos_total || 0) > 0).length;
    const gastoMedio = view.length ? totalGastos / view.length : 0;

    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat stat--navy"><div class="stat__value">${fmtNum(view.length)}</div><div class="stat__label">veículo(s) no filtro</div><p>${fmtNum(ativos)} ativo(s)</p></div>
        <div class="stat stat--green"><div class="stat__value">${fmtBRL(totalGastos)}</div><div class="stat__label">gastos vinculados auditáveis</div><p>${fmtBRL(gastoMedio)} por veículo${totalAtipico ? ` · ${fmtBRL(totalAtipico)} atípico separado` : ""}</p></div>
        <div class="stat stat--gold"><div class="stat__value">${fmtBRL(totalComb)}</div><div class="stat__label">combustível</div><p>${fmtNum(view.reduce((s, v) => s + Number(v.litros_combustivel || 0), 0))} L localizados</p></div>
        <div class="stat stat--red"><div class="stat__value">${fmtBRL(totalManut)}</div><div class="stat__label">manutenção/peças</div><p>${fmtNum(locados)} veículo(s) locado(s)</p></div>`;
    }

    if (auditEl) {
      const topCentros = centros.map(c => ({
        nome: c,
        qtd: view.filter(v => v.centro_custo === c).length,
        valor: view.filter(v => v.centro_custo === c).reduce((s, v) => s + Number(v.gastos_total || 0), 0),
      })).filter(c => c.qtd).sort((a, b) => b.valor - a.valor).slice(0, 6);
      auditEl.innerHTML = `
        <article class="${semCentro ? "is-warn" : ""}"><strong>${fmtNum(semCentro)}</strong><span>sem centro de custo</span></article>
        <article class="${inativosComGasto ? "is-warn" : ""}"><strong>${fmtNum(inativosComGasto)}</strong><span>inativos com gasto</span></article>
        <article class="${veiculosAtipicos ? "is-warn" : ""}"><strong>${fmtNum(veiculosAtipicos)}</strong><span>com valor atípico separado</span></article>
        <article><strong>${fmtNum(locados)}</strong><span>locados para conferir contrato</span></article>
        <article><strong>${fmtNum(topCentros.length)}</strong><span>centros de custo no filtro</span></article>
        <div class="frota-centros">
          ${topCentros.map(c => `<button type="button" data-frota-centro="${esc(c.nome)}"><strong>${esc(c.nome || "Sem centro")}</strong><span>${fmtNum(c.qtd)} · ${fmtBRL(c.valor)}</span></button>`).join("")}
        </div>`;
    }

    window.ZELA._frotaLAI = {};
    if (countEl) countEl.textContent = `${fmtNum(view.length)} veículo(s) · ${fmtBRL(totalGastos)}`;
    if (listaEl) {
      listaEl.innerHTML = view.slice(0, 80).map((v, idx) => {
        const id = `frota-${idx}`;
        window.ZELA._frotaLAI[id] = perguntaLAIFrota(v);
        const alertas = (v.alertas || []).slice(0, 4);
        const gastosRecentes = (v.gastos_recentes || []).slice(0, 3);
        const fornecedores = (v.fornecedores_gastos || []).slice(0, 3);
        return `<article class="frota-card">
          <div class="frota-card__placa">${esc(v.placa || "Sem placa")}</div>
          <div class="frota-card__body">
            <div class="frota-card__head">
              <strong>${esc(v.descricao || v.tipo || "Veículo municipal")}</strong>
              <span>${esc(v.tipo || "Tipo não informado")} · ${esc(v.situacao || "Situação não informada")} · ${esc(v.tipo_aquisicao || "Aquisição não informada")}</span>
            </div>
            <div class="frota-card__grid">
              <span><b>Centro de custo:</b> ${esc(v.centro_custo || "Não informado")}</span>
              <span><b>Ano:</b> ${esc(v.ano_fabricacao || "?")}/${esc(v.ano_modelo || "?")}</span>
              <span><b>Aquisição:</b> ${esc(dataCurtaBR(v.data_aquisicao))}</span>
              <span><b>Gasto total:</b> ${fmtBRL(v.gastos_total || 0)}</span>
              <span><b>Combustível:</b> ${fmtBRL(v.combustivel_total || 0)}${v.litros_combustivel ? ` · ${fmtNum(v.litros_combustivel)} L` : ""}</span>
              <span><b>Manutenção/peças:</b> ${fmtBRL(v.manutencao_total || 0)}</span>
              <span><b>Último gasto:</b> ${v.ultimo_gasto_data ? `${esc(dataCurtaBR(v.ultimo_gasto_data))} · ${esc(v.ultimo_gasto_tipo || "")} · ${fmtBRL(v.ultimo_gasto_valor || 0)}` : "Não localizado"}</span>
            </div>
            ${alertas.length ? `<div class="frota-alertas">${alertas.map(a => `<i>${esc(a)}</i>`).join("")}</div>` : ""}
            ${v.gastos_atipicos_total ? `<div class="frota-mini frota-mini--warn"><b>Valor atípico separado:</b> ${fmtBRL(v.gastos_atipicos_total)} em ${fmtNum(v.gastos_atipicos_qtd || 0)} lançamento(s). Conferir no Betha antes de qualquer conclusão.</div>` : ""}
            ${fornecedores.length ? `<div class="frota-mini"><b>Fornecedores:</b> ${fornecedores.map(f => `${esc(f.nome)} (${fmtBRL(f.valor)})`).join(" · ")}</div>` : ""}
            ${gastosRecentes.length ? `<div class="frota-mini"><b>Gastos recentes:</b> ${gastosRecentes.map(g => `${esc(dataCurtaBR(g.data))} ${esc(g.tipo || "")} ${fmtBRL(g.valor || 0)}`).join(" · ")}</div>` : ""}
            ${dataTrustSeal("contrato", {
              fonte: "Betha Frotas 83061",
              escopo: "veículo e gastos vinculados",
              risco: "gasto vinculado não mostra quilometragem nem finalidade sozinho",
              acao: "pedir diário de bordo, notas, empenhos e contrato de locação",
              tone: alertas.length ? "warn" : "ok",
            })}
            <div class="frota-card__actions">
              <button type="button" class="btn-dossie" onclick="ZELA.copiarFrotaLAI('${id}', this)">Copiar pergunta LAI</button>
              <a class="btn-link" href="${esc(v.fonte_url || "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83061")}" target="_blank" rel="noopener">Abrir Betha</a>
            </div>
          </div>
        </article>`;
      }).join("") || `<div class="empty"><strong>Nenhum veículo encontrado</strong><p>Tente limpar filtros ou buscar por placa/modelo.</p></div>`;
    }

    ["filtroFrota", "filtroSituacaoFrota", "filtroAquisicaoFrota", "filtroCentroFrota", "ordenarFrota"].forEach(id => {
      const el = $(id);
      if (!el || el.dataset.frotaReady) return;
      el.dataset.frotaReady = "1";
      el.addEventListener(id === "filtroFrota" ? "input" : "change", renderFrotaPrefeitura);
    });
    document.querySelectorAll("[data-frota-centro]").forEach(btn => {
      if (btn.dataset.ready) return;
      btn.dataset.ready = "1";
      btn.addEventListener("click", () => {
        const sel = $("filtroCentroFrota");
        if (sel) sel.value = btn.dataset.frotaCentro || "";
        renderFrotaPrefeitura();
      });
    });
  }

  window.ZELA.copiarFrotaLAI = (id, btn) => {
    const texto = (window.ZELA._frotaLAI || {})[id] || "";
    if (!texto) return;
    const old = btn ? btn.textContent : "";
    navigator.clipboard.writeText(texto).then(() => {
      if (btn) {
        btn.textContent = "Pergunta copiada";
        setTimeout(() => { btn.textContent = old; }, 1600);
      }
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = texto;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (_) {}
      document.body.removeChild(ta);
    });
  };

  // ============= API pública =============
  function linhasFolhaVereadores() {
    const servidores = ((((D.pessoal || {}).camara || {}).servidores) || []);
    const grupos = new Map();
    servidores.forEach((row) => {
      const alvo = norm([row.cargo, row.lotacao].filter(Boolean).join(" "));
      if (!alvo.includes("vereador")) return;
      const nome = cleanText(row.nome || "Nome nao informado").trim();
      if (!nome) return;
      const key = (row.matricula || nome) + "|" + nome;
      const g = grupos.get(key) || {
        nome,
        matricula: row.matricula || "",
        cargo: cleanText(row.cargo || "Vereador"),
        vinculo: cleanText(row.vinculo || ""),
        ano: Number(row.ano || 0),
        registros: [],
        bruto_total: 0,
        liquido_total: 0,
        descontos_total: 0,
        maior_bruto: 0,
        maior_liquido: 0,
      };
      g.registros.push(row);
      g.ano = Math.max(g.ano || 0, Number(row.ano || 0));
      g.bruto_total += Number(row.vencimentos || 0);
      g.liquido_total += Number(row.liquido || 0);
      g.descontos_total += Number(row.descontos || 0);
      g.maior_bruto = Math.max(g.maior_bruto, Number(row.vencimentos || 0));
      g.maior_liquido = Math.max(g.maior_liquido, Number(row.liquido || 0));
      grupos.set(key, g);
    });
    return Array.from(grupos.values()).sort((a, b) => cleanText(a.nome).localeCompare(cleanText(b.nome), "pt-BR"));
  }

  function renderRemuneracaoVereadores() {
    const el = $("remuneracaoVereadores");
    if (!el) return;
    const rem = D.remuneracao_vereadores || {};
    const lei = rem.lei || {};
    const links = Array.isArray(rem.links_conferencia) ? rem.links_conferencia : [];
    const folha = linhasFolhaVereadores();
    const folhaTotal = folha.reduce((sum, item) => sum + Number(item.bruto_total || 0), 0);
    const folhaLinhas = folha.slice(0, 18);
    const leiUrl = lei.url || (links[0] && links[0].url) || "#";

    window.ZELA._folhaVereadores = folha;

    el.innerHTML = `
      <div class="salary-transparency__head">
        <span>REMUNERACAO PARLAMENTAR</span>
        <strong>Subsidio e folha nominal dos vereadores</strong>
        <small>Mostra o valor fixado em lei e os registros nominais localizados no portal de transparencia da Camara. O valor liquido pode variar por descontos, faltas, renuncia formal ou rubricas da folha.</small>
      </div>
      ${dataTrustSeal("remuneracao", {
        fonte: "Lei 7.285/2024 + Betha Camara",
        escopo: folha.length ? "subsidio legal + folha nominal localizada" : "subsidio legal",
        risco: "folha pode ter varias competencias no recorte",
        acao: "conferir competencia, descontos e verbas",
        tone: folha.length ? "ok" : "warn",
      })}
      <div class="salary-transparency__grid">
        <article class="salary-card salary-card--main">
          <span>Subsidio bruto mensal</span>
          <strong>${fmtBRL(Number(rem.subsidio_bruto_mensal_brl || 0))}</strong>
          <small>${esc(cleanText(lei.numero || "Lei municipal"))}${lei.data ? " - " + esc(dataCurtaBR(lei.data)) : ""}</small>
        </article>
        <article class="salary-card">
          <span>Impacto mensal pela lei</span>
          <strong>${fmtBRL(Number(rem.impacto_mensal_estimado_brl || 0))}</strong>
          <small>${fmtNum(Number(rem.quantidade_lei || 0))} cargo(s) previstos na lei</small>
        </article>
        <article class="salary-card">
          <span>Folha nominal localizada</span>
          <strong>${fmtNum(folha.length)}</strong>
          <small>${fmtBRL(folhaTotal)} em registro(s) carregado(s)</small>
        </article>
      </div>

      <div class="salary-payroll${folha.length ? "" : " salary-payroll--empty"}">
        <div class="salary-payroll__head">
          <div>
            <span>Folha nominal localizada</span>
            <strong>Vereadores encontrados na folha da Camara</strong>
            <small>Use o botao "Detalhes" para ver o que foi encontrado e o que pedir via LAI quando faltar competencia, descontos ou verbas indenizatorias.</small>
          </div>
          <div class="salary-payroll__sum">
            <strong>${fmtBRL(folhaTotal)}</strong>
            <span>total bruto dos registros</span>
          </div>
        </div>
        ${folha.length ? `
          <div class="salary-payroll__table">
            <div class="salary-payroll__row salary-payroll__row--head">
              <span>Nome</span><span>Ano</span><span>Maior bruto</span><span>Maior liquido</span><span>Registros</span><span>Acao</span>
            </div>
            ${folhaLinhas.map((item, idx) => `
              <div class="salary-payroll__row">
                <span><strong>${esc(item.nome)}</strong><small>${esc(item.cargo || "Vereador")} ${item.matricula ? "- mat. " + esc(item.matricula) : ""}</small></span>
                <span>${esc(item.ano || "")}</span>
                <span>${fmtBRL(item.maior_bruto || 0)}</span>
                <span>${fmtBRL(item.maior_liquido || 0)}</span>
                <span>${fmtNum(item.registros.length)}</span>
                <span><button type="button" onclick="ZELA.abrirDetalheRemuneracao(${idx})">Detalhes</button></span>
              </div>`).join("")}
          </div>
          ${folha.length > folhaLinhas.length ? `<p class="salary-payroll__warn">Mostrando ${fmtNum(folhaLinhas.length)} de ${fmtNum(folha.length)} nomes. Abra o portal Betha para conferir a folha completa.</p>` : ""}
        ` : `<p>Folha nominal nao localizada nesta coleta. O painel mostra a lei e deixa os links oficiais para conferencia.</p>`}
      </div>

      <div class="salary-transparency__note">
        <div>
          <strong>Como ler este dado</strong>
          <p>O subsidio e o valor bruto definido por lei. A folha nominal mostra pagamentos efetivamente registrados, mas precisa ser lida por competencia e rubrica.</p>
        </div>
        <div class="salary-transparency__actions">
          <a href="${esc(leiUrl)}" target="_blank" rel="noopener">Ver lei</a>
          ${links.slice(1, 3).map((link) => `<a href="${esc(link.url)}" target="_blank" rel="noopener">${esc(cleanText(link.titulo || "Fonte oficial"))}</a>`).join("")}
          <button type="button" onclick="ZELA.entenderRemuneracao()">Entender</button>
        </div>
      </div>`;
  }

  window.ZELA.abrirDetalheRemuneracao = (idx) => {
    const item = (window.ZELA._folhaVereadores || [])[idx];
    if (!item) return;
    const rows = (item.registros || []).slice(0, 12);
    window.ZELA.dossie.abrirComHtml(`
      <p class="label">FOLHA NOMINAL</p>
      <h3>${esc(item.nome)}</h3>
      <p class="muted">Cargo: ${esc(item.cargo || "Vereador")} ${item.matricula ? "- matricula " + esc(item.matricula) : ""}</p>
      <div class="salary-modal-list">
        ${rows.map((r) => `<article>
          <strong>${fmtBRL(Number(r.vencimentos || 0))} bruto - ${fmtBRL(Number(r.liquido || 0))} liquido</strong>
          <span>${esc(cleanText(r.cargo || ""))} - ${esc(cleanText(r.vinculo || ""))}</span>
          <small>Ano ${esc(r.ano || "")}. Descontos informados: ${fmtBRL(Number(r.descontos || 0))}. Fonte: ${esc(cleanText(r.escopo || "Folha nominal da Camara"))}.</small>
        </article>`).join("")}
      </div>
      <h4>O que conferir na fonte oficial</h4>
      <ul class="dossier-checklist">
        <li>Competencia de cada registro da folha.</li>
        <li>Descontos, faltas, renuncia formal e rubricas indenizatorias.</li>
        <li>Se ha verbas de gabinete, diaria ou cota indenizatoria fora do subsidio.</li>
      </ul>`);
  };

  window.ZELA.entenderRemuneracao = () => {
    window.ZELA.dossie.abrirComHtml(`
      <p class="label">REMUNERACAO PARLAMENTAR</p>
      <h3>Como entender salario/subsidio de vereador</h3>
      <div class="citizen-explain">
        <div class="citizen-explain__grid">
          <article><b>Subsidio</b><span>Valor bruto mensal fixado em lei para o cargo politico.</span></article>
          <article><b>Folha nominal</b><span>Registro de pagamento por pessoa, com vencimentos, descontos e liquido.</span></article>
          <article><b>O que nao prova sozinho</b><span>Nao mostra automaticamente presenca, produtividade ou eventual verba indenizatoria.</span></article>
          <article><b>Fonte primaria</b><span>Lei municipal e Portal Betha da Camara.</span></article>
        </div>
      </div>
      <h4>O que pedir via LAI</h4>
      <p>Solicite a folha analitica por competencia, demonstrativo de descontos, registro de faltas, eventual renuncia de subsidio, diarias, cotas/verbas indenizatorias e ato legal que autorizou cada pagamento.</p>`);
  };

  const FILA_COBRANCA_STORE = "zela.filaCobranca.v2";

  function filaReadStore() {
    try { return JSON.parse(localStorage.getItem(FILA_COBRANCA_STORE) || "{}") || {}; }
    catch (_) { return {}; }
  }

  function filaWriteStore(store) {
    try { localStorage.setItem(FILA_COBRANCA_STORE, JSON.stringify(store || {})); }
    catch (_) {}
  }

  function filaId(parts) {
    return norm((parts || []).filter(Boolean).join("|"))
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "item";
  }

  function filaNivel(score) {
    const n = Number(score || 0);
    if (n >= 78) return "red";
    if (n >= 45) return "yellow";
    return "green";
  }

  function filaLabel(level) {
    return level === "red" ? "Vermelho" : level === "yellow" ? "Amarelo" : "Verde";
  }

  function filaStatusLabel(value) {
    return ({
      novo: "Novo",
      aguardando: "Aguardando resposta",
      respondido: "Respondido",
      encerrado: "Encerrado",
    })[value || "novo"] || "Novo";
  }

  function filaPerguntaPadrao(item) {
    return [
      "Solicito, com fundamento na Lei de Acesso a Informacao (Lei Federal 12.527/2011), documentos e esclarecimentos sobre o item abaixo.",
      `Assunto: ${item.titulo}.`,
      `Orgao: ${item.orgaoLabel}.`,
      item.valor ? `Valor relacionado no painel: ${fmtBRL(item.valor)}.` : "",
      item.data ? `Data relacionada: ${item.data}.` : "",
      item.resumo ? `Resumo: ${item.resumo}` : "",
      `Pendencias a esclarecer: ${(item.pendencias || []).join("; ")}.`,
      "Solicito copia dos documentos de origem, contrato/processo administrativo quando existir, empenhos, liquidacoes, pagamentos, notas fiscais, responsavel/fiscal, criterios de medicao e resposta em formato aberto quando possivel.",
    ].filter(Boolean).join("\n\n");
  }

  function gerarFilaCobrancaPublica() {
    const itens = [];
    const vistos = new Set();
    const add = (raw) => {
      const id = raw.id || filaId([raw.tipo, raw.orgao, raw.titulo, raw.valor, raw.data]);
      if (vistos.has(id)) return;
      vistos.add(id);
      const score = Math.max(0, Math.min(100, Math.round(Number(raw.score || 0))));
      const level = raw.level || filaNivel(score);
      itens.push({
        id,
        score,
        level,
        tipo: raw.tipo || "contrato",
        tipoLabel: raw.tipoLabel || "Contrato",
        orgao: raw.orgao || "prefeitura",
        orgaoLabel: raw.orgaoLabel || (raw.orgao === "camara" ? "Camara" : "Prefeitura"),
        titulo: cleanText(raw.titulo || "Item sem titulo"),
        valor: Number(raw.valor || 0),
        data: raw.data || "",
        resumo: cleanText(raw.resumo || ""),
        pendencias: (raw.pendencias || []).filter(Boolean).slice(0, 6),
        fonte: raw.fonte || "",
        url: raw.url || "",
        pergunta: raw.pergunta || "",
      });
    };

    const contratos = pf.contratos || [];
    contratos.forEach((c) => {
      const valor = Number(c.valor || 0);
      const obj = cleanText(c.objeto || "");
      const pend = [];
      if (obj.length < 80) pend.push("objeto pouco detalhado");
      if (valor >= 500000 && !/(rua|bairro|escola|ubs|unidade|secretaria|setor|local|creche|cemei|hospital)/i.test(obj)) {
        pend.push("local de aplicacao nao claro");
      }
      if (!c.cnpj || String(c.cnpj).includes("*")) pend.push("CNPJ mascarado ou incompleto");
      if (!c.data_assinatura) pend.push("data do contrato nao localizada");
      if (valor >= 1000000 || pend.length >= 2) {
        add({
          tipo: "contrato",
          tipoLabel: "Contrato",
          orgao: "prefeitura",
          titulo: c.contratado || `Contrato ${c.numero || ""}/${c.ano || ""}`,
          valor,
          data: dataCurtaBR(c.data_assinatura || ""),
          resumo: obj || `Contrato ${c.numero || ""}/${c.ano || ""}`,
          pendencias: pend.length ? pend : ["valor alto pede conferencia documental"],
          score: Math.min(96, 35 + Math.log10(Math.max(valor, 1)) * 7 + pend.length * 12),
          fonte: "Betha contratos Prefeitura",
          url: `prefeitura.html?tab=contratos&q=${encodeURIComponent(c.contratado || c.numero || "")}`,
          pergunta: [
            `Solicito copia integral do processo administrativo do contrato ${c.numero || "s/n"}/${c.ano || ""}, firmado com ${c.contratado || "contratado nao informado"}, no valor de ${fmtBRL(valor)}.`,
            `Objeto informado: ${obj || "nao informado"}.`,
            `Pontos a esclarecer: ${(pend.length ? pend : ["valor alto"]).join("; ")}.`,
            "Enviar termo de referencia, edital ou justificativa, pesquisa de precos, proposta vencedora, contrato, aditivos, empenhos, liquidacoes, notas fiscais, pagamentos e relatorio do fiscal do contrato.",
          ].join("\n\n"),
        });
      }
    });

    const asfaltoTerms = ["asfalto", "paviment", "recape", "tapa buraco", "tapa-buraco", "buraco", "massa asfalt", "cbuq", "base/brita", "bica corrida", "drenagem"];
    const obras = (pf.obras_publicas || []).filter((o) => hasAny([o.objeto, o.categoria, o.tipo_obra, o.endereco].join(" "), asfaltoTerms));
    obras.forEach((o) => {
      const valor = Number(o.valor_efetivo || o.valor_atualizado || o.valor_contrato || o.valor || 0);
      const pend = [];
      if (!Number(o.area_m2 || 0) && !Number(o.extensao || 0)) pend.push("sem metragem/quantidade auditavel");
      if (!(o.endereco || o.logradouro || o.bairro)) pend.push("sem rua/bairro identificado");
      if (!(o.responsavel || o.medicao_responsavel)) pend.push("sem fiscal/responsavel claro");
      if (!o.data_ultima_medicao) pend.push("sem ultima medicao publicada");
      if (pend.length || valor >= 500000) {
        add({
          tipo: "asfalto",
          tipoLabel: "Asfalto/obra",
          orgao: "prefeitura",
          titulo: o.contratado || o.fornecedor || o.categoria || "Obra viaria",
          valor,
          data: dataCurtaBR(o.data_inicio || o.data_ordem_servico || o.contrato_data_assinatura || ""),
          resumo: o.objeto || o.categoria || "Obra publica",
          pendencias: pend.length ? pend : ["valor alto em obra viaria"],
          score: Math.min(98, 45 + pend.length * 13 + (valor >= 1000000 ? 18 : 0)),
          fonte: "Betha obras publicas",
          url: "prefeitura.html?tab=asfalto&q=asfalto",
          pergunta: [
            `Solicito documentos da obra/servico viario ${o.numero || o.id_obra || "s/n"}, fornecedor ${o.contratado || o.fornecedor || "nao informado"}, valor ${fmtBRL(valor)}.`,
            `Objeto: ${o.objeto || o.categoria || "nao informado"}.`,
            `Pontos a esclarecer: ${(pend.length ? pend : ["metragem, local, fiscal e medicao"]).join("; ")}.`,
            "Enviar contrato, projeto basico/executivo, planilha orcamentaria, ruas/bairros atendidos, metragem por trecho, medicao, notas fiscais, fiscal responsavel e fotos antes/depois.",
          ].join("\n\n"),
        });
      }
    });

    (pf.frota || []).forEach((v) => {
      const valor = Number(v.gastos_total || 0);
      const atipico = Number(v.gastos_atipicos_total || 0);
      const pend = [];
      if (atipico > 0) pend.push("valor atipico separado para conferencia");
      if (!v.centro_custo) pend.push("sem centro de custo claro");
      if (norm(v.tipo_aquisicao).includes("locado") && valor >= 30000) pend.push("veiculo locado com gasto vinculado alto");
      if (valor >= 100000) pend.push("gasto acumulado alto");
      if (valor > 0) pend.push("pedir odometro/diario de bordo");
      if (atipico > 0 || valor >= 100000 || pend.length >= 3) {
        add({
          tipo: "frota",
          tipoLabel: "Frota",
          orgao: "prefeitura",
          titulo: `${v.placa || "Sem placa"} - ${v.descricao || v.tipo || "veiculo"}`,
          valor: valor + atipico,
          data: dataCurtaBR(v.ultimo_gasto_data || v.data_aquisicao || ""),
          resumo: `${v.centro_custo || "centro nao informado"} - ${v.tipo_aquisicao || "aquisicao nao informada"}`,
          pendencias: pend,
          score: Math.min(98, 42 + pend.length * 10 + (atipico > 0 ? 25 : 0) + (valor >= 100000 ? 12 : 0)),
          fonte: "Betha veiculos municipais",
          url: `prefeitura.html?tab=frota&q=${encodeURIComponent(v.placa || v.descricao || "")}`,
          pergunta: perguntaLAIFrota(v),
        });
      }
    });

    const cam = D.camara_betha || {};
    const contratosCamara = cam.contratos || [];
    (cam.top_fornecedores_atual || []).forEach((f) => {
      const nome = cleanText(f.nome || "");
      const n = norm(nome);
      const valor = Number(f.valor_total || 0);
      const temContrato = contratosCamara.some((c) => {
        const cn = norm(c.contratado || "");
        return cn && n && (cn.includes(n.slice(0, 18)) || n.includes(cn.slice(0, 18)));
      });
      if (!temContrato && valor >= 100000) {
        add({
          tipo: "fornecedor",
          tipoLabel: "Fornecedor",
          orgao: "camara",
          orgaoLabel: "Camara",
          titulo: nome || "Fornecedor da Camara",
          valor,
          data: cam.ano_atual ? `Ano ${cam.ano_atual}` : "",
          resumo: "Fornecedor com despesa relevante sem contrato vinculado automaticamente pelo nome.",
          pendencias: ["contrato nao vinculado automaticamente", "conferir empenho e origem da despesa", "CEIS/CNEP pendente"],
          score: Math.min(96, 50 + Math.log10(Math.max(valor, 1)) * 7),
          fonte: "Betha despesas Camara",
          url: `camara.html?q=${encodeURIComponent(nome)}`,
          pergunta: [
            `Solicito documentos das despesas da Camara com ${nome}, no total localizado de ${fmtBRL(valor)} no recorte do painel.`,
            "Informar contrato/processo de origem, empenhos, liquidacoes, notas fiscais, pagamentos, justificativa da contratacao e fiscal/responsavel.",
          ].join("\n\n"),
        });
      }
    });

    (D.emendas || []).forEach((e) => {
      const valor = Number(e.valor_brl || e.valor || 0);
      const pend = [];
      if (!e.cnpj) pend.push("beneficiario sem CNPJ estruturado");
      if (String(e.ano) === "2026") pend.push("emendas 2026 ainda sem lista consolidada");
      if (valor >= 150000) pend.push("valor alto pede plano de trabalho e execucao");
      if (pend.length && valor >= 20000) {
        add({
          tipo: "emenda",
          tipoLabel: "Emenda",
          orgao: "camara",
          orgaoLabel: "Camara",
          titulo: `${e.autor || "Vereador"} - ${e.beneficiario || "beneficiario nao informado"}`,
          valor,
          data: e.ano ? `Ano ${e.ano}` : "",
          resumo: e.objeto || "Emenda impositiva",
          pendencias: pend,
          score: Math.min(92, 38 + pend.length * 13 + (valor >= 100000 ? 18 : 0)),
          fonte: "SAPL/emendas",
          url: `camara.html?q=${encodeURIComponent(e.beneficiario || e.autor || "")}`,
          pergunta: [
            `Solicito documentos da emenda de ${e.autor || "autoria nao informada"} destinada a ${e.beneficiario || "beneficiario nao informado"}, no valor de ${fmtBRL(valor)}.`,
            `Objeto: ${e.objeto || "nao informado"}.`,
            "Enviar plano de trabalho, CNPJ, secretaria responsavel, empenhos, liquidacoes, pagamentos, notas fiscais, comprovantes de execucao, fotos/relatorio de entrega e situacao atual.",
          ].join("\n\n"),
        });
      }
    });

    const ultimasDiario = (((D.diario || {}).ultimas) || []).slice(0, 4);
    ultimasDiario.forEach((d) => {
      if (!d.descricao) {
        add({
          tipo: "diario",
          tipoLabel: "Diario Oficial",
          orgao: "prefeitura",
          titulo: `Diario Oficial - Edicao ${d.edicao || "s/n"}`,
          valor: 0,
          data: dataCurtaBR(d.data || ""),
          resumo: "Edicao publicada, mas sem texto interno estruturado no painel.",
          pendencias: ["abrir PDF oficial", "resumir compras/contratacoes", "verificar cargos e alteracoes de lei"],
          score: 48,
          fonte: "Diario Oficial do Municipio",
          url: d.url_pdf || "atualizacoes.html",
          pergunta: "Solicito disponibilizacao, em formato aberto e pesquisavel, do texto integral e anexos desta edicao do Diario Oficial, com identificacao de compras, contratacoes, nomeacoes, exoneracoes, leis, decretos e atos com impacto financeiro.",
        });
      }
    });

    const rem = D.remuneracao_vereadores || {};
    const folhaVereadores = linhasFolhaVereadores();
    if (rem.subsidio_bruto_mensal_brl || folhaVereadores.length) {
      const maior = folhaVereadores.reduce((m, x) => Math.max(m, Number(x.maior_bruto || 0)), 0);
      add({
        tipo: "pessoal",
        tipoLabel: "Pessoal",
        orgao: "camara",
        orgaoLabel: "Camara",
        titulo: "Subsidio e folha nominal dos vereadores",
        valor: maior || Number(rem.subsidio_bruto_mensal_brl || 0),
        data: rem.vigencia_inicio ? dataCurtaBR(rem.vigencia_inicio) : "",
        resumo: "Valor fixado em lei precisa ser lido junto da folha nominal, descontos, faltas, diarias e verbas indenizatorias.",
        pendencias: ["conferir competencia da folha", "conferir descontos/faltas", "conferir cotas e verbas indenizatorias"],
        score: 55,
        fonte: "Lei municipal + Betha Camara",
        url: "camara.html#vereadores",
        pergunta: "Solicito folha analitica dos vereadores por competencia, demonstrativo de descontos, registro de faltas, eventual renuncia de subsidio, diarias, cotas/verbas indenizatorias e ato legal que autorizou cada pagamento.",
      });
    }

    return itens.sort((a, b) => b.score - a.score || b.valor - a.valor || a.titulo.localeCompare(b.titulo, "pt-BR"));
  }

  function renderFilaCobrancaPublica() {
    const lista = $("filaCobrancaLista");
    if (!lista) return;
    const stats = $("filaCobrancaStats");
    const orgao = $("filaCobrancaOrgao")?.value || "";
    const risco = $("filaCobrancaRisco")?.value || "";
    const tipo = $("filaCobrancaTipo")?.value || "";
    const store = filaReadStore();
    const all = gerarFilaCobrancaPublica();
    const filtrados = all.filter((item) =>
      (!orgao || item.orgao === orgao) &&
      (!risco || item.level === risco) &&
      (!tipo || item.tipo === tipo)
    ).slice(0, 28);

    if (stats) {
      const count = (level) => all.filter((item) => item.level === level).length;
      stats.innerHTML = [
        ["vermelho", count("red")],
        ["amarelo", count("yellow")],
        ["verde", count("green")],
        ["pendencias", all.length],
      ].map(([label, value]) => `<span><strong>${fmtNum(value)}</strong><small>${esc(label)}</small></span>`).join("");
    }

    if (!filtrados.length) {
      lista.innerHTML = '<div class="empty"><p>Nenhum item encontrado para este filtro.</p></div>';
      return;
    }

    lista.innerHTML = filtrados.map((item) => {
      const saved = store[item.id] || {};
      const status = saved.status || "novo";
      const updated = saved.updated ? `Atualizado em ${dataCurtaBR(saved.updated)}` : "Ainda nao cobrado";
      const pergunta = item.pergunta || filaPerguntaPadrao(item);
      const fonte = item.fonte || "Fonte oficial";
      return `<article class="risk-queue-card risk-queue-card--${esc(item.level)}">
        <div class="risk-queue-card__score">
          <span class="risk-chip risk-chip--${esc(item.level)}">${esc(filaLabel(item.level))}</span>
          <strong>${fmtNum(item.score)}</strong>
          <small>${esc(item.tipoLabel)}</small>
          <span class="risk-queue-card__orgao">${esc(item.orgaoLabel)}</span>
        </div>
        <div class="risk-queue-card__body">
          <div class="risk-queue-card__head">
            <div>
              <h4>${esc(item.titulo)}</h4>
              <span class="risk-queue-card__orgao">${esc(fonte)}${item.data ? " - " + esc(item.data) : ""}</span>
            </div>
            <strong>${item.valor ? fmtBRL(item.valor) : "Sem valor"}</strong>
          </div>
          ${item.resumo ? `<p>${esc(item.resumo)}</p>` : ""}
          <div class="official-pending">
            <div>
              <strong>Pendencias oficiais</strong>
              <p>${esc((item.pendencias || []).join("; ") || "Conferir documentos de origem.")}</p>
            </div>
            <div class="official-pending__chips">
              <span>CEIS/CNEP: ${esc(((D.sancoes_fornecedores || {}).status || "pendente").replace(/_/g, " "))}</span>
              <span>PNCP / origem</span>
              <span>Fonte primaria</span>
            </div>
          </div>
          <div class="followup-status">
            <label>Status da cobranca
              <select data-fila-status="${esc(item.id)}">
                ${["novo", "aguardando", "respondido", "encerrado"].map((op) => `<option value="${op}" ${op === status ? "selected" : ""}>${esc(filaStatusLabel(op))}</option>`).join("")}
              </select>
            </label>
            <small data-fila-updated="${esc(item.id)}">${esc(updated)}</small>
          </div>
          <div class="risk-queue-card__actions">
            ${item.url ? `<a class="btn-link" href="${esc(item.url)}" target="${/^https?:/i.test(item.url) ? "_blank" : "_self"}" rel="noopener">Abrir fonte/painel</a>` : ""}
            <button type="button" class="copy-template" data-fila-copy="${esc(item.id)}">Copiar pergunta LAI</button>
          </div>
          <details class="risk-lai">
            <summary>Ver pergunta pronta</summary>
            <textarea readonly>${esc(pergunta)}</textarea>
          </details>
        </div>
      </article>`;
    }).join("");

    lista.querySelectorAll("[data-fila-status]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const id = sel.dataset.filaStatus;
        const next = filaReadStore();
        next[id] = { status: sel.value, updated: new Date().toISOString() };
        filaWriteStore(next);
        const target = Array.from(lista.querySelectorAll("[data-fila-updated]"))
          .find((el) => el.dataset.filaUpdated === id);
        if (target) target.textContent = `Atualizado em ${dataCurtaBR(next[id].updated)}`;
      });
    });
    lista.querySelectorAll("[data-fila-copy]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".risk-queue-card");
        const text = card?.querySelector(".risk-lai textarea")?.value || "";
        if (!text) return;
        const done = () => {
          const old = btn.textContent;
          btn.textContent = "Pergunta copiada";
          setTimeout(() => { btn.textContent = old; }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(done);
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); } catch (_) {}
          document.body.removeChild(ta);
          done();
        }
      });
    });
  }

  function baixarPdfSecao(target, titulo) {
    const source = typeof target === "string" ? document.querySelector(target) : target;
    if (!source) return;

    const clone = source.cloneNode(true);
    clone.classList.remove("is-collapsed");
    clone.querySelectorAll("script, .pdf-action, .block__toggle, .block__actions, .modal__close").forEach(el => el.remove());
    clone.querySelectorAll("[hidden]").forEach(el => { el.hidden = false; });
    clone.querySelectorAll(".is-collapsed").forEach(el => el.classList.remove("is-collapsed"));
    clone.querySelectorAll(".pref-panel:not(.is-active)").forEach(el => el.remove());
    clone.querySelectorAll("dialog").forEach(el => el.remove());

    const titleEl = source.querySelector(".block__title, .bigheader__title, h1, h2, h3");
    const cleanTitle = (titulo || titleEl.textContent || pageTitle() || "Relatorio").trim();
    const now = new Date().toLocaleString("pt-BR");
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map(el => el.outerHTML).join("\n");
    const printable = window.open("", "_blank", "width=1000,height=800");
    if (!printable) {
      window.print();
      return;
    }

    printable.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base href="${esc(baseHref())}">
  <title>${esc(cleanTitle)} - Fiscaliza Varginha</title>
  ${styles}
  <style>
    body { background:#fff !important; color:#152131; }
    .topbar, .footer, .breadcrumb, .nav, .skip-link, .civic-actions, .pref-tabs, .filterbar, .loadmore, .btn-share, .btn-dossie { display:none !important; }
    .container { max-width: none; padding: 0; }
    .section, main { padding: 0 !important; background:#fff !important; }
    .block, .bigheader, .card, .stat, .signal, .contrato, .em, .keyword-audit, .reader-summary { box-shadow:none !important; break-inside: avoid; }
    .pdf-cover { border-bottom: 3px solid #004B8D; margin-bottom: 22px; padding-bottom: 12px; }
    .pdf-cover h1 { margin: 0; color:#004B8D; font-size: 26px; }
    .pdf-cover p { margin: 4px 0 0; color:#607084; }
    @page { margin: 16mm; }
  </style>
</head>
<body>
  <main class="pdf-document">
    <header class="pdf-cover">
      <h1>${esc(cleanTitle)}</h1>
      <p>Fiscaliza Varginha - Painel Cidadao de Fiscalizacao</p>
      <p>Gerado em ${esc(now)}. Confira sempre a fonte oficial antes de concluir irregularidade.</p>
    </header>
    ${clone.outerHTML}
  </main>
  <script>
    window.addEventListener("load", () => setTimeout(() => window.print(), 250));
  <\/script>
</body>
</html>`);
    printable.document.close();
  }

  // Helper local — delega criação do <dialog> para modules/dossie.js
  function modalFiscalizacao() {
    return window.ZELA.dossie.criarModal();
  }

  // abrirFiscalizacaoDiaria delegado para modules/diarias.js
  function abrirFiscalizacaoDiaria(prefix, idx) {
    window.ZELA.diarias.abrirFiscalizacaoDiaria(prefix, idx);
  }

  window.ZELA = {
    buscaHome: buscaHome,
    smartAudit: (providedQ) => {
      const inp = $("buscaHome");
      const q = providedQ || (inp && inp.value || "").trim();
      if (!q) return;

      const qN = norm(q);

      // Regras de inteligência do Auditor
      if (hasAny(qN, ["fornecedor", "empresas", "recebe", "maiores"])) {
        window.location.href = "prefeitura.html?tab=visao#prefeituraLive";
        return;
      }
      if (hasAny(qN, ["diaria", "viagem", "hospedagem"])) {
        window.location.href = "prefeitura.html?tab=diarias";
        return;
      }
      if (hasAny(qN, ["frota", "veiculo", "veiculos", "placa", "combustivel", "gasolina", "diesel", "pneu", "manutencao de veiculo", "oficina"])) {
        window.location.href = "prefeitura.html?tab=frota";
        return;
      }
      if (hasAny(qN, ["emenda", "vereador", "destinou", "promessa"])) {
        if (hasAny(qN, ["pendente", "não paga", "não localizada", "atencao"])) {
           window.location.href = "relatorios.html";
        } else {
           window.location.href = "camara.html";
        }
        return;
      }
      if (hasAny(qN, ["asfalto", "obra", "reforma", "pavimentacao", "buraco"])) {
        window.location.href = "prefeitura.html?tab=asfalto&q=" + encodeURIComponent(q);
        return;
      }
      if (hasAny(qN, ["comissionado", "cargo comissionado", "cargos de confianca"])) {
        window.location.href = "pessoal.html?tipo=comissionado";
        return;
      }
      if (hasAny(qN, ["salario", "ganha", "folha", "pessoal", "cargo", "servidor", "funcionario"])) {
        window.location.href = "pessoal.html";
        return;
      }
      if (hasAny(qN, ["aluguel", "imovel", "predio", "locacao", "aluga"])) {
        window.location.href = "prefeitura.html?tab=alugueis";
        return;
      }
      if (hasAny(qN, ["show", "evento", "festa", "artista", "cantor", "musica", "cachê", "cache"])) {
        window.location.href = "prefeitura.html?tab=eventos";
        return;
      }
      if (hasAny(qN, ["licitacao", "pregao", "dispensa", "inexigibilidade", "edital"])) {
        window.location.href = "prefeitura.html?tab=licitacoes";
        return;
      }
      if (hasAny(qN, ["relatorio", "sinal", "irregularidade", "suspeita", "atencao", "risco", "cnpj inativo"])) {
        window.location.href = "relatorios.html";
        return;
      }
      if (hasAny(qN, ["camara", "vereador", "legislativo", "sessao", "lei", "projeto"])) {
        window.location.href = "camara.html";
        return;
      }

      // Fallback para busca normal
      buscaHome(q);
    },
    ...window.ZELA,
    maisEmendas:   () => { emendasShown   += 30; renderEmendas && renderEmendas(false); },
    maisContratos: () => { contratosShown += 20; renderContratos && renderContratos(false); },
    maisContratosCamara: () => { contratosCamaraShown += 20; renderContratosCamara && renderContratosCamara(false); },
    filtrarEmendasAno: (ano) => {
      if ($("filtroAnoEmendas")) $("filtroAnoEmendas").value = ano || "";
      renderEmendas && renderEmendas(true);
      scrollToEl($("emendas"));
    },
    limparVereador: () => {
      if ($("filtroVereador")) $("filtroVereador").value = "";
      if ($("filtroEm")) $("filtroEm").value = "";
      renderEmendas && renderEmendas(true);
    },
    limparEntidade: () => {
      if ($("filtroEntidade")) $("filtroEntidade").value = "";
      if ($("filtroEm")) $("filtroEm").value = "";
      renderEmendas && renderEmendas(true);
      scrollToEl($("emendas"));
    },
    compartilharZap: (quem, oque, quanto) => {
      // Monta link da própria página já filtrado por ?q= no fornecedor, para
      // que quem recebe caia direto neste registro.
      const base = window.location.origin + window.location.pathname;
      const linkPainel = quem ? `${base}?q=${encodeURIComponent(quem)}` : base;
      const msg = `*FISCALIZA VARGINHA - RELATÓRIO DE FISCALIZAÇÃO*\n\n` +
                  `*Entidade/Pessoa:* ${quem}\n` +
                  `*Objeto:* ${oque}\n` +
                  `*Valor:* ${quanto}\n\n` +
                  `Confira no painel cidadão:\n${linkPainel}`;
      // Mobile: usa folha de compartilhamento nativa (WhatsApp, Telegram, etc.)
      if (navigator.share) {
        navigator.share({ title: "Fiscaliza Varginha", text: msg }).catch(() => {});
        return;
      }
      const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank");
    },
    baixarPdfSecao,
    fiscalizarDiaria: abrirFiscalizacaoDiaria
  };


  // ===========================================================================
  // ALUGUÉIS E LOCAÇÕES (prefeitura.html)
  // ===========================================================================
  function renderAlugueis() {
    if (!$("alugueisBlock")) return;
    
    const contratosAluguel = pf.contratos || [];
    const keywords = ["locacao de imovel", "locacao de predio", "aluguel de imovel", "locacao de imovel urbano", "locacao de terreno"];
    
    const filtrados = contratosAluguel.filter(c => {
      const txt = norm(c.objeto || "");
      return keywords.some(k => txt.includes(norm(k)));
    });

    if (!filtrados.length) {
      $("alugueisBlock").hidden = true;
      return;
    }
    $("alugueisBlock").hidden = false;

    const buscaEl = $("filtroAluguel");
    const listaEl = $("listaAlugueis");
    const statsEl = $("statsAlugueis");
    const countEl = $("alugueisContador");

    const render = () => {
      const q = norm(buscaEl.value.trim());
      const view = filtrados.filter(c => !q || norm(c.objeto + c.contratado).includes(q));

      const total = view.reduce((s, c) => s + (c.valor || 0), 0);
      statsEl.innerHTML = `
        <div class="stat stat--navy">
          <div class="stat__value">${fmtBRL(total)}</div>
          <div class="stat__label">Total em Aluguéis</div>
          <div class="stat__sub">Valor total dos contratos ativos</div>
        </div>
        <div class="stat stat--gold">
          <div class="stat__value">${view.length}</div>
          <div class="stat__label">Imóveis Locados</div>
          <div class="stat__sub">Identificados via objeto</div>
        </div>
      `;

      countEl.textContent = `${view.length} imóvel(is) encontrado(s)`;

      listaEl.innerHTML = view.map(c => {
        const dataIni = (c.data_assinatura || "").split("-").reverse().join("/");
        const dataFim = (c.data_fim || "").split("-").reverse().join("/");
        return `
        <article class="contrato">
          <div class="contrato__valor">
            ${fmtBRL(c.valor)}
            <div class="small muted">Valor do Contrato</div>
          </div>
          <div>
            <p class="contrato__nome">
              ${esc(cleanText(c.contratado))}
              <span class="em__status em__status--ok">LOCAÇÃO</span>
            </p>
            <p class="contrato__obj"><strong>Objeto/Endereço:</strong> ${esc(cleanText(c.objeto))}</p>
            <div class="contrato__meta">
              <span><strong>Contrato nº</strong> ${c.numero}/${c.ano}</span>
              ${dataIni ? `<span><strong>Vigência:</strong> ${dataIni} ate ${dataFim}</span>` : ""}
            </div>
            <div style="margin-top:10px; display: flex; gap: 8px; flex-wrap: wrap;">
              <button class="btn-dossie" onclick="ZELA.gerarDossie(${contratosAluguel.indexOf(c)})">Ver relatorio</button>
              <button class="btn-share" onclick="ZELA.compartilharZap('${jsSafe(c.contratado)}', '${jsSafe(c.objeto)}', '${fmtBRL(c.valor)}')">Compartilhar</button>
              <a class="btn-link" href="https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043" target="_blank" rel="noopener" title="Buscar este contrato no Portal Betha" style="text-decoration:none; padding: 5px 10px; background: #e8f4fd; border-radius: 4px; color: #1565c0; font-size: 0.8em; font-weight: 500; border: 1px solid #90caf9;">${window.ZELA.icon("lupa", { size: 14 })} Betha</a>
              <a class="btn-link" href="https://transparencia.varginha.mg.gov.br/portal-transparencia/consultas/contratos" target="_blank" rel="noopener" title="Portal oficial (pode estar temporariamente indisponível)" style="text-decoration:none; padding: 5px 10px; background: #eee; border-radius: 4px; color: #555; font-size: 0.8em; font-weight: 500; border: 1px solid #ccc;">Portal oficial</a>
            </div>
          </div>
        </article>`;
      }).join("");
    };

    if (buscaEl) buscaEl.addEventListener("input", render);
    render();
  }

  // ============= INICIALIZAÇÃO DA PÁGINA =============
  function renderAlugueisV2() {
    if (!$("alugueisBlock")) return;

    const contratosAluguel = pf.contratos || [];
    const licitFinalizadas = pf.licit_finalizadas || [];
    const termosLocacao = ["locacao", "locar", "aluguel", "alugar", "locado", "locados"];
    const termosImovel = ["imovel", "predio", "sala comercial", "salao", "casa", "terreno", "galpao", "barracao", "edificacao"];
    const termosExcluir = [
      "veiculo", "automotor", "som", "luz", "iluminacao", "decoracao", "natalina",
      "equipamento", "brinquedo", "cilindro", "comodato", "fralda", "ambulatorial",
      "medicinal", "palco", "tenda", "banheiro", "maquina", "software"
    ];

    const isLocacaoImovel = (item) => {
      const txt = norm([item.objeto, item.contratado, item.fornecedor, item.modalidade, item.tipo, item.entidade].filter(Boolean).join(" "));
      return termosLocacao.some(k => txt.includes(k)) &&
        termosImovel.some(k => txt.includes(k)) &&
        !termosExcluir.some(k => txt.includes(k));
    };
    const diffDias = (ini, fim) => {
      if (!ini || !fim) return 0;
      const a = new Date(ini + "T00:00:00");
      const b = new Date(fim + "T00:00:00");
      if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
      return Math.max(1, Math.round((b - a) / 86400000) + 1);
    };
    const mesesContrato = (c) => {
      const dias = diffDias(c.data_assinatura, c.data_fim);
      return dias ? Math.max(1, Math.ceil(dias / 30.4375)) : 0;
    };
    const custoMensalEstimado = (c) => {
      const meses = mesesContrato(c);
      return meses ? (c.valor || 0) / meses : 0;
    };

    const filtrados = contratosAluguel.filter(isLocacaoImovel);
    const processosRelacionados = licitFinalizadas.filter(isLocacaoImovel).filter(l => {
      const assinatura = norm(`${l.objeto || ""}|${l.valor || 0}`);
      return !filtrados.some(c => norm(`${c.objeto || ""}|${c.valor || 0}`) === assinatura);
    });
    const descartados = contratosAluguel.filter(c => {
      const txt = norm([c.objeto, c.contratado, c.modalidade, c.tipo].filter(Boolean).join(" "));
      return termosLocacao.some(k => txt.includes(k)) && !isLocacaoImovel(c);
    }).length;

    if (!filtrados.length) {
      $("alugueisBlock").hidden = true;
      return;
    }
    $("alugueisBlock").hidden = false;

    const buscaEl = $("filtroAluguel");
    const listaEl = $("listaAlugueis");
    const statsEl = $("statsAlugueis");
    const countEl = $("alugueisContador");

    const render = () => {
      const q = norm(buscaEl.value.trim());
      const view = filtrados.filter(c => !q || norm(c.objeto + c.contratado).includes(q));
      const total = view.reduce((s, c) => s + (c.valor || 0), 0);
      const mesesSomados = view.reduce((s, c) => s + mesesContrato(c), 0);
      const custoMensal = view.reduce((s, c) => s + custoMensalEstimado(c), 0);

      statsEl.innerHTML = `
        <div class="stat stat--navy">
          <div class="stat__value">${fmtBRL(total)}</div>
          <div class="stat__label">Total contratual em alugueis</div>
          <div class="stat__sub">Soma dos contratos de imoveis filtrados</div>
        </div>
        <div class="stat stat--gold">
          <div class="stat__value">${view.length}</div>
          <div class="stat__label">Imoveis locados</div>
          <div class="stat__sub">Contratos classificados como imovel</div>
        </div>
        <div class="stat stat--teal">
          <div class="stat__value">${fmtBRL(custoMensal)}</div>
          <div class="stat__label">Custo mensal estimado</div>
          <div class="stat__sub">Soma dos custos mensais estimados</div>
        </div>
        <div class="stat stat--gold">
          <div class="stat__value">${fmtNum(mesesSomados)}</div>
          <div class="stat__label">Meses contratados somados</div>
          <div class="stat__sub">${processosRelacionados.length} processo relacionado sem contrato novo</div>
        </div>`;

      countEl.textContent = `${view.length} imovel(is) encontrado(s) · ${descartados} locacoes descartadas por serem veiculos/equipamentos/serviços`;

      listaEl.innerHTML = view.map(c => {
        const dataIni = (c.data_assinatura || "").split("-").reverse().join("/");
        const dataFim = (c.data_fim || "").split("-").reverse().join("/");
        const meses = mesesContrato(c);
        const mensal = custoMensalEstimado(c);
        return `
        <article class="contrato">
          <div class="contrato__valor">
            ${fmtBRL(c.valor)}
            <div class="small muted">Valor total do contrato</div>
            ${meses ? `<div class="score-mini" title="Calculo estimado: valor total dividido pela vigência">~ ${fmtBRL(mensal)}/mes</div>` : ""}
          </div>
          <div>
            <p class="contrato__nome">
              ${esc(cleanText(c.contratado))}
              <span class="em__status em__status--ok">LOCAÇÃO DE IMÓVEL</span>
            </p>
            <p class="contrato__obj"><strong>Objeto/endereco:</strong> ${esc(cleanText(c.objeto))}</p>
            <div class="contrato__meta">
              <span><strong>Contrato no</strong> ${c.numero}/${c.ano}</span>
              ${dataIni ? `<span><strong>Vigencia:</strong> ${dataIni} ate ${dataFim}</span>` : ""}
              ${meses ? `<span><strong>Duracao estimada:</strong> ${meses} mes${meses === 1 ? "" : "es"}</span>` : ""}
            </div>
            <div style="margin-top:10px; display: flex; gap: 8px; flex-wrap: wrap;">
              <button class="btn-dossie" onclick="ZELA.gerarDossie(${contratosAluguel.indexOf(c)})">Ver Dossie</button>
              <button class="btn-share" onclick="ZELA.compartilharZap('${jsSafe(c.contratado)}', '${jsSafe(c.objeto)}', '${fmtBRL(c.valor)} · estimado ${fmtBRL(mensal)}/mes por ${meses || ""} meses')">Zap</button>
              <a class="btn-link" href="https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043" target="_blank" rel="noopener" title="Buscar este contrato no Portal Betha" style="text-decoration:none; padding: 5px 10px; background: #e8f4fd; border-radius: 4px; color: #1565c0; font-size: 0.8em; font-weight: 500; border: 1px solid #90caf9;">${window.ZELA.icon("lupa", { size: 14 })} Betha</a>
              <a class="btn-link" href="https://transparencia.varginha.mg.gov.br/portal-transparencia/consultas/contratos" target="_blank" rel="noopener" title="Portal oficial (pode estar temporariamente indisponível)" style="text-decoration:none; padding: 5px 10px; background: #eee; border-radius: 4px; color: #555; font-size: 0.8em; font-weight: 500; border: 1px solid #ccc;">Portal oficial</a>
            </div>
          </div>
        </article>`;
      }).join("") + (processosRelacionados.length ? `
        <div class="report-note" style="margin-top:16px">
          <strong>Nota:</strong> também foi localizado ${processosRelacionados.length} processo de licitacao finalizada relacionado a locacao de imovel,
          mas sem novo contrato distinto na base carregada. Ele pode ser etapa anterior de um contrato já listado.
        </div>` : "");
    };

    if (buscaEl) buscaEl.addEventListener("input", render);
    render();
  }

  // initDiarias delegado para modules/diarias.js (264 linhas extraídas + bugs corrigidos)
  function initDiarias(prefix, dados) {
    window.ZELA.diarias.init(prefix, dados);
  }

  // ============= PLACAR DO DINHEIRO (prefeitura.html) =============
  // Placar e Categorias delegados para modules/dashboard.js
  function renderPlacarPrefeitura()     { window.ZELA.dashboard.renderPlacarPrefeitura(); }
  function renderCategoriasPrefeitura() { window.ZELA.dashboard.renderCategoriasPrefeitura(); }
  function renderPlacarCamara()         { window.ZELA.dashboard.renderPlacarCamara(); }
  function renderCategoriasCamara()     { window.ZELA.dashboard.renderCategoriasCamara(); }

  function renderPrefeituraOverview() {
    if (!$("prefeituraOverview")) return;
    const contratos = pf.contratos || [];
    const licitacoes = pf.licit_andamento || [];
    const diarias = (D.diarias || {}).prefeitura || [];
    const compras = pf.compras_diretas || [];
    const frota = pf.frota || [];

    if (!contratos.length && !licitacoes.length && !diarias.length && !pf.total_externo_atual) {
      const emptyState = `
        <article class="data-empty">
          <strong>Dados da Prefeitura não carregados</strong>
          <p>O arquivo data.js foi aberto, mas não trouxe contratos, licitacoes, diárias nem totalizadores da Prefeitura. Execute atualizar.bat e recarregue esta pagina com Ctrl + F5.</p>
        </article>`;
      $("prefeituraOverview").innerHTML = emptyState;
      if ($("prefeituraResumoTopo")) $("prefeituraResumoTopo").innerHTML = emptyState;
      if ($("prefeituraResumoBase")) $("prefeituraResumoBase").innerHTML = emptyState;
      return;
    }

    const aluguelTerms = ["locacao", "locar", "aluguel", "alugar", "locado", "locados"];
    const imovelTerms = ["imovel", "predio", "sala comercial", "salao", "casa", "terreno", "galpao", "barracao", "edificacao"];
    const aluguelExcludes = ["veiculo", "automotor", "som", "luz", "iluminacao", "decoracao", "natalina", "equipamento", "brinquedo", "cilindro", "comodato", "fralda", "ambulatorial", "medicinal", "palco", "tenda", "banheiro", "maquina", "software"];
    const isAluguelImovel = (c) => {
      const t = `${c.objeto || ""} ${c.contratado || ""}`;
      return hasAny(t, aluguelTerms) && hasAny(t, imovelTerms) && !hasAny(t, aluguelExcludes);
    };

    const eventoForteOverview = [
      "show", "show artistico", "apresentacao artistica", "artista", "banda",
      "cache", "rodeio", "carnaval", "banho da doroteia", "varginha e show",
      "roca cidade", "marcha para jesus", "reveillon", "revelion", "virada",
      "dia da cidade", "dia do trabalhador", "queima de fogos", "festival", "feira"
    ];
    const estruturaEventoOverview = ["palco", "sonorizacao", "banheiro quimico", "tenda", "camarote", "gerador", "estrutura de evento"];
    const contextoEventoOverview = ["evento", "show", "festa", "carnaval", "rodeio", "festival", "dia da cidade", "dia do trabalhador", "doroteia", "reveillon", "revelion"];
    const excluiOperacionalOverview = ["epi", "equipamento de protecao", "botas", "bota", "tenis", "tênis", "luva", "uniforme", "coleta", "poda", "fiscalizacao ambiental", "servidores da coleta", "limpeza urbana", "seguranca do trabalho"];
    const isEventoConfiavel = (item) => {
      const texto = norm(`${item.objeto || ""} ${item.contratado || ""} ${item.modalidade || ""}`);
      if (excluiOperacionalOverview.some(k => texto.includes(norm(k)))) return false;
      if (eventoForteOverview.some(k => texto.includes(norm(k)))) return true;
      return estruturaEventoOverview.some(k => texto.includes(norm(k))) && contextoEventoOverview.some(k => texto.includes(norm(k)));
    };
    const eventosBase = [
      ...contratos.map(c => ({ ...c, valor_analise: c.valor || 0 })),
      ...licitacoes.map(l => ({ ...l, valor_analise: l.valor || 0, contratado: l.fornecedor || l.contratado || "Andamento" })),
      ...compras.map(c => ({ ...c, valor_analise: c.valor || 0, contratado: c.fornecedor || c.contratado || "" })),
    ].filter(isEventoConfiavel);

    const alugueis = contratos.filter(isAluguelImovel);
    const totalContratos = contratos.reduce((s, c) => s + Number(c.valor || 0), 0);
    const totalDiarias = diarias.reduce((s, d) => s + Number(d.valor_total || 0), 0);
    const totalAlugueis = alugueis.reduce((s, c) => s + Number(c.valor || 0), 0);
    const totalEventos = eventosBase.reduce((s, e) => s + Number(e.valor_analise || 0), 0);
    const totalFrota = frota.reduce((s, v) => s + Number(v.gastos_total || 0), 0);
    const contratosMilhao = contratos.filter(c => Number(c.valor || 0) >= 1_000_000);
    const diariasAltas = diarias.filter(d => (Number(d.valor_total || 0) / (Number(d.quantidade || 1))) >= 1000);
    const fornecedoresUnicos = new Set(contratos.map(c => cnpjRoot(c.cnpj) || norm(c.contratado)).filter(Boolean)).size;
    const servidoresDiarias = new Set(diarias.map(d => norm(d.funcionario)).filter(Boolean)).size;
    const somaPagamentos = pf.total_externo_atual || 0;
    const resumoSimples = `
      <div>
        <div class="reader-summary__label">Painel da Prefeitura</div>
        <p>
          Dados oficiais transformados em trilhas de fiscalização: quem recebeu,
          quanto recebeu, por qual objeto e onde conferir a fonte.
        </p>
      </div>
      <div class="reader-summary__chips">
        <span><strong>${fmtMi(somaPagamentos)}</strong><small>pagos em ${pf.ano_atual || "ano atual"}</small></span>
        <span><strong>${fmtNum(contratos.length)}</strong><small>contratos</small></span>
        <span><strong>${fmtNum(licitacoes.length)}</strong><small>licitacoes abertas</small></span>
        <span><strong>${fmtNum(diarias.length)}</strong><small>diárias</small></span>
        <span><strong>${fmtNum(frota.length)}</strong><small>veículos na frota</small></span>
      </div>`;

    if ($("prefeituraResumoTopo")) {
      $("prefeituraResumoTopo").innerHTML = resumoSimples;
    }

    const setBadge = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value ? String(value) : "";
    };
    setBadge("badgeVisao", contratos.length + licitacoes.length + diarias.length);
    setBadge("badgeContratos", contratos.length);
    setBadge("badgeDiarias", diarias.length);
    setBadge("badgeAlugueis", alugueis.length);
    setBadge("badgeEventos", eventosBase.length);
    setBadge("badgeLicitacoes", licitacoes.length);
    setBadge("badgeFrota", frota.length);

    const pctVariacao = pf.total_externo_anterior ? (((pf.total_externo_atual / pf.total_externo_anterior) - 1) * 100).toFixed(1) : 0;
    const trendLabel = pctVariacao > 0 ? `+${pctVariacao}% em relacao a ${pf.ano_anterior}` : `${pctVariacao}% em relacao a ${pf.ano_anterior}`;

    $("prefeituraOverview").innerHTML = [
      { cls: "audit-metric--hero", v: fmtMi(pf.total_externo_atual), l: `Pagamentos em ${pf.ano_atual}`, s: trendLabel, tab: "fontes" },
      { cls: "", v: fmtNum(contratos.length), l: "Contratos", s: `${fmtBRL(totalContratos)} em registros carregados`, tab: "contratos" },
      { cls: "audit-metric--red", v: fmtNum(contratosMilhao.length), l: "Acima de R$ 1 mi", s: "Primeira fila para conferir objeto e prazo", tab: "contratos" },
      { cls: "audit-metric--gold", v: fmtNum(diarias.length), l: "Diárias", s: `${fmtBRL(totalDiarias)} em registros contabeis`, tab: "diarias" },
      { cls: "", v: fmtNum(frota.length), l: "Frota municipal", s: `${fmtBRL(totalFrota)} em gastos vinculados`, tab: "frota" },
      { cls: "", v: fmtNum(alugueis.length), l: "Imoveis alugados", s: `${fmtBRL(totalAlugueis)} classificados por palavra-chave`, tab: "alugueis" },
      { cls: "audit-metric--gold", v: fmtNum(eventosBase.length), l: "Eventos e shows", s: `${fmtBRL(totalEventos)} em itens localizados`, tab: "eventos" },
      { cls: "", v: fmtNum(licitacoes.length), l: "Licitacoes abertas", s: "Fiscalizar antes do pagamento", tab: "licitacoes" },
    ].map(m => `
      <button type="button" class="audit-metric ${m.cls}" data-pref-tab="${m.tab}">
        <span class="audit-metric__value">${m.v}</span>
        <span class="audit-metric__label">${m.l}</span>
        <span class="audit-metric__sub">${m.s}</span>
      </button>`).join("");

    if ($("prefeituraAtalhos")) {
      $("prefeituraAtalhos").innerHTML = [
        { tab: "contratos", value: fmtNum(contratosMilhao.length), title: "Contratos caros", text: "Compromissos acima de R$ 1 mi, objetos fracos e prazos." },
        { tab: "diarias", value: fmtNum(diariasAltas.length), title: "Diárias altas", text: "Registros com valor diario estimado acima de R$ 1.000." },
        { tab: "frota", value: fmtNum(frota.length), title: "Frota municipal", text: "Veiculos, lotacao e gastos de combustivel/manutencao." },
        { tab: "alugueis", value: fmtNum(alugueis.length), title: "Imoveis alugados", text: `${fmtBRL(totalAlugueis)} somados em contratos classificados.` },
        { tab: "eventos", value: fmtNum(eventosBase.length), title: "Eventos e shows", text: "Empresas, artistas e estruturas contratadas." },
      ].map(a => `
        <button type="button" data-pref-tab="${a.tab}">
          <small>${a.value}</small>
          <strong>${a.title}</strong>
          <span>${a.text}</span>
        </button>`).join("");
    }

    if ($("prefeituraResumoBase")) {
      $("prefeituraResumoBase").innerHTML = `
        <div class="reader-summary__label">O que estes numeros querem dizer</div>
        <p>
          A primeira leitura mostra que a base tem ${fmtNum(contratos.length)} contratos somando
          ${fmtBRL(totalContratos)}, ${fmtNum(licitacoes.length)} licitacoes para acompanhar antes
          do pagamento, ${fmtNum(diarias.length)} diárias pagas a ${fmtNum(servidoresDiarias)}
          pessoas/servidores identificados, ${fmtNum(frota.length)} veiculos municipais,
          ${fmtNum(alugueis.length)} contratos classificados
          como aluguel de imovel e ${fmtNum(eventosBase.length)} itens ligados a eventos ou shows.
        </p>
        <p>
          Para fiscalizar sem se perder, comece pelos blocos de maior valor: contratos acima de
          R$ 1 milhão, diárias com valor diario alto, alugueis recorrentes e eventos. Em cada caso,
          confira objeto, prazo, fornecedor, empenho, liquidacao, pagamento e se a entrega aconteceu.
        </p>
      `;
    }

    const categoriasGasto = [
      { nome: "Cafe", termos: ["cafe", "cafe torrado", "cafe em po", "cafe da manha"] },
      { nome: "Alimentacao", termos: ["alimentacao", "refeicao", "marmitex", "marmita", "almoco", "jantar", "buffet", "generos alimenticios"] },
      { nome: "Lanche", termos: ["lanche", "salgado", "salgados", "bolo", "biscoito", "suco", "refrigerante", "kit lanche"] },
      { nome: "Combustivel", termos: ["combustivel", "gasolina", "etanol", "diesel", "oleo diesel", "arla", "posto de combustivel"] },
      { nome: "Aluguel de veiculos", termos: ["locacao de veiculo", "locacao de veiculos", "aluguel de veiculo", "aluguel de veiculos", "veiculo locado", "frota locada"] },
      { nome: "Show/eventos festivos", termos: ["show", "evento festivo", "festa", "carnaval", "reveillon", "revelion", "aniversario da cidade", "artista", "cache"] },
      { nome: "Palco, som e iluminacao", termos: ["palco", "sonorizacao", "iluminacao", "estrutura de evento", "tenda", "gerador", "banheiro quimico"] },
      { nome: "Diárias", termos: ["diaria", "diarias", "viagem", "deslocamento"] },
      { nome: "Passagens e hospedagem", termos: ["passagem", "passagens", "hospedagem", "hotel", "diária hotel", "aereo", "rodoviario"] },
      { nome: "Publicidade e propaganda", termos: ["publicidade", "propaganda", "marketing", "campanha publicitaria", "divulgacao", "midia"] },
      { nome: "Material de escritorio", termos: ["material de escritorio", "papelaria", "caneta", "papel sulfite", "toner", "cartucho"] },
      { nome: "Informatica e software", termos: ["software", "sistema", "licenca", "informatica", "computador", "notebook", "impressora"] },
      { nome: "Consultoria", termos: ["consultoria", "assessoria", "apoio tecnico", "serviços tecnicos especializados"] },
      { nome: "Obras e reforma", termos: ["obra", "reforma", "construcao", "ampliacao", "engenharia", "empreitada"] },
      { nome: "Asfalto e pavimentacao", termos: ["asfalto", "pavimentacao", "recapeamento", "tapa buraco", "massa asfaltica", "CBUQ"] },
      { nome: "Saúde/medicamentos", termos: ["medicamento", "remedio", "farmacia", "insumo hospitalar", "material hospitalar", "saude"] },
      { nome: "Exames e consultas", termos: ["exame", "consulta", "laboratorial", "diagnostico", "ultrassom", "tomografia"] },
      { nome: "Merenda escolar", termos: ["merenda", "alimentacao escolar", "generos alimenticios", "escola", "creche"] },
      { nome: "Transporte escolar", termos: ["transporte escolar", "onibus escolar", "van escolar", "linha escolar"] },
      { nome: "Material escolar", termos: ["material escolar", "kit escolar", "uniforme escolar", "mochila", "caderno"] },
      { nome: "Limpeza urbana", termos: ["limpeza urbana", "varricao", "coleta de lixo", "residuo", "lixo", "capina", "rocada"] },
      { nome: "Seguranca e vigilancia", termos: ["vigilancia", "seguranca", "monitoramento", "alarme", "camera", "vigia"] },
      { nome: "Pneus", termos: ["pneu", "pneus", "camara de ar", "recapagem"] },
      { nome: "Manutenção de veiculos", termos: ["manutenção de veiculo", "oficina", "pecas automotivas", "serviço mecanico", "oleo lubrificante"] },
      { nome: "Locacao de maquinas", termos: ["locacao de maquina", "maquina pesada", "retroescavadeira", "motoniveladora", "escavadeira", "trator"] },
      { nome: "Energia eletrica", termos: ["energia elétrica", "cemig", "iluminacao publica", "conta de luz"] },
      { nome: "Água e esgoto", termos: ["agua", "esgoto", "copasa", "saneamento"] },
      { nome: "Telefonia e internet", termos: ["telefonia", "telefone", "internet", "link de internet", "fibra optica", "dados moveis"] },
      { nome: "Uniformes e EPI", termos: ["uniforme", "epi", "equipamento de protecao", "botina", "luva", "mascara"] },
      { nome: "Cestas basicas", termos: ["cesta basica", "cestas basicas", "beneficio eventual", "alimento para familias"] },
      { nome: "ONGs e entidades", termos: ["termo de fomento", "subvencao", "entidade", "organizacao social", "associacao", "osc"] },
      { nome: "Aluguel de imoveis", termos: ["locacao de imovel", "aluguel de imovel", "locacao de predio", "sala comercial", "terreno locado"] },
      { nome: "Serviços funerarios", termos: ["funerario", "sepultamento", "urna funeraria", "auxilio funeral"] },
      { nome: "Dengue e zoonoses", termos: ["dengue", "zoonoses", "inseticida", "fumace", "controle de vetores"] },
      { nome: "Ar condicionado", termos: ["ar condicionado", "climatizacao", "manutenção de ar", "aparelho de ar"] },
      { nome: "Moveis e equipamentos", termos: ["mobiliario", "moveis", "cadeira", "mesa", "armario", "equipamento permanente"] },
    ];

    const baseGastos = [
      ...contratos.map((c, idx) => ({
        origem: "Contrato",
        fornecedor: c.contratado || "Não informado",
        cnpj: c.cnpj || "",
        objeto: c.objeto || "",
        valor: Number(c.valor || 0),
        ano: c.ano || c.ano_publicacao || "",
        link: "contratos",
        contratoIdx: idx,
      })),
      ...licitacoes.map(l => ({
        origem: "Licitacao",
        fornecedor: l.fornecedor || l.contratado || "Em andamento",
        cnpj: l.cnpj || "",
        objeto: l.objeto || l.descricao || "",
        valor: Number(l.valor || 0),
        ano: l.ano || "",
        link: "licitacoes",
      })),
      ...compras.map(c => ({
        origem: "Compra direta",
        fornecedor: c.fornecedor || c.contratado || "Não informado",
        cnpj: c.cnpj || "",
        objeto: c.objeto || c.descricao || "",
        valor: Number(c.valor || 0),
        ano: c.ano || "",
        link: "contratos",
      })),
      ...diarias.map(d => ({
        origem: "Diária",
        fornecedor: d.funcionario || "Servidor não informado",
        cnpj: "",
        objeto: `${d.destino || ""} ${d.finalidade || ""} ${d.historico || ""}`,
        valor: Number(d.valor_total || 0),
        ano: d.ano || "",
        link: "diarias",
      })),
    ];

    const categoriaPorNome = (nome) => categoriasGasto.find(c => c.nome === nome) || categoriasGasto[0];
    const gastoCombina = (item, termos) => {
      const texto = norm(`${item.origem} ${item.fornecedor} ${item.cnpj} ${item.objeto}`);
      return termos.some(t => texto.includes(norm(t)));
    };
      const agrupaFornecedor = (lista) => {
        const grupos = new Map();
        lista.forEach(item => {
          const key = cnpjRoot(item.cnpj) || norm(item.fornecedor) || "não informado";
        const cur = grupos.get(key) || { nome: item.fornecedor || "Não informado", valor: 0, qtd: 0, contratoIdx: null };
          cur.valor += item.valor || 0;
          cur.qtd += 1;
          if (cur.contratoIdx == null && Number.isInteger(item.contratoIdx)) cur.contratoIdx = item.contratoIdx;
          grupos.set(key, cur);
        });
        return [...grupos.values()].sort((a, b) => (b.valor - a.valor) || (b.qtd - a.qtd));
      };

    const renderGastosPalavra = () => {
      const box = $("gastosPalavraChave");
      if (!box) return;
      const select = $("categoriaGastoSelect");
      const busca = $("categoriaGastoBusca");
      const categoria = categoriaPorNome(select?.value || "Combustivel");
      const extra = (busca?.value || "").split(",").map(t => t.trim()).filter(Boolean);
      const termos = extra.length ? extra : categoria.termos;
      const encontrados = baseGastos
        .filter(item => gastoCombina(item, termos))
        .sort((a, b) => (b.valor - a.valor));
      const total = encontrados.reduce((s, item) => s + (item.valor || 0), 0);
      const fornecedores = agrupaFornecedor(encontrados).slice(0, 5);
      const categoriasComQtd = categoriasGasto.map(cat => ({
        ...cat,
        qtd: baseGastos.filter(item => gastoCombina(item, cat.termos)).length,
      })).filter(cat => cat.qtd > 0);

      box.innerHTML = `
        <div class="keyword-audit__head">
          <div>
            <span class="reader-summary__label">Pergunte aos dados</span>
            <h3>Gastos por palavra-chave</h3>
            <p>Escolha um tema comum da maquina publica ou digite termos separados por virgula. O painel procura em contratos, licitacoes, compras diretas e diárias carregadas.</p>
          </div>
        </div>
        <div class="keyword-audit__controls">
          <select id="categoriaGastoSelect" aria-label="Escolher categoria de gasto">
            ${categoriasGasto.map(cat => `<option value="${esc(cat.nome)}"${cat.nome === categoria.nome ? " selected" : ""}>${esc(cat.nome)}</option>`).join("")}
          </select>
          <input id="categoriaGastoBusca" type="search" value="${esc(busca?.value || "")}" placeholder="Ou digite: combustivel, gasolina, diesel...">
        </div>
        <div class="keyword-audit__chips">
          ${categoriasComQtd.slice(0, 18).map(cat => `<button type="button" data-gasto-cat="${esc(cat.nome)}">${esc(cat.nome)} <span>${fmtNum(cat.qtd)}</span></button>`).join("")}
        </div>
        <div class="keyword-result">
          <article>
            <strong>${fmtBRL(total)}</strong>
            <span>total localizado</span>
          </article>
          <article>
            <strong>${fmtNum(encontrados.length)}</strong>
            <span>registros encontrados</span>
          </article>
          <article>
            <strong>${fmtNum(fornecedores.length)}</strong>
            <span>principais fornecedores</span>
          </article>
        </div>
        <div class="keyword-audit__grid">
          <div>
            <h4>Principais fornecedores</h4>
            ${fornecedores.length ? fornecedores.map(f => `
              <div class="keyword-row">
                <span>${esc(f.nome)}
                  ${Number.isInteger(f.contratoIdx) ? `<button type="button" class="keyword-row__action" onclick="ZELA.abrirContrato(${f.contratoIdx})">Ver contrato</button>` : ""}
                </span>
                <strong>${fmtBRL(f.valor)}</strong>
                <small>${fmtNum(f.qtd)} registro(s)</small>
              </div>`).join("") : `<p class="muted">Nenhum fornecedor encontrado para estes termos.</p>`}
          </div>
          <div>
            <h4>Maiores registros</h4>
            ${encontrados.slice(0, 5).map(item => {
              const isContrato = item.origem === "Contrato" && Number.isInteger(item.contratoIdx);
              const tag = isContrato ? "button" : "div";
              const attrs = isContrato
                ? ` type="button" class="keyword-row keyword-row--button" onclick="ZELA.abrirContrato(${item.contratoIdx})"`
                : ` class="keyword-row"`;
              return `
              <${tag}${attrs}>
                <span>${esc(item.origem)} - ${esc(item.fornecedor)}
                  ${isContrato ? `<em>Ver contrato</em>` : ""}
                </span>
                <strong>${fmtBRL(item.valor)}</strong>
                <small>${esc(String(item.objeto || "").slice(0, 120))}</small>
              </${tag}>`;
            }).join("") || `<p class="muted">Nenhum registro encontrado.</p>`}
          </div>
        </div>
        <p class="keyword-audit__note">Observação: busca por palavra-chave é uma triagem. O resultado pode incluir registros parecidos e deve ser conferido no documento oficial antes de qualquer conclusão.</p>
      `;

      const nextSelect = $("categoriaGastoSelect");
      const nextBusca = $("categoriaGastoBusca");
      if (nextSelect) nextSelect.addEventListener("change", renderGastosPalavra);
      if (nextBusca) {
        nextBusca.addEventListener("change", renderGastosPalavra);
        nextBusca.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") renderGastosPalavra();
        });
      }
      box.querySelectorAll("[data-gasto-cat]").forEach(btn => {
        btn.addEventListener("click", () => {
          if ($("categoriaGastoSelect")) $("categoriaGastoSelect").value = btn.dataset.gastoCat || "";
          if ($("categoriaGastoBusca")) $("categoriaGastoBusca").value = "";
          renderGastosPalavra();
        });
      });
    };
    renderGastosPalavra();

    const maiorContrato = contratos.slice().sort((a, b) => Number(b.valor || 0) - Number(a.valor || 0))[0];
    const maiorDiariaPessoa = Object.values(diarias.reduce((acc, d) => {
      const key = norm(d.funcionario) || "sem nome";
      acc[key] ||= { nome: d.funcionario || "Não informado", valor: 0, qtd: 0 };
      acc[key].valor += Number(d.valor_total || 0);
      acc[key].qtd += Number(d.quantidade || 0);
      return acc;
    }, {})).sort((a, b) => b.valor - a.valor)[0];
    const maiorEvento = eventosBase.slice().sort((a, b) => Number(b.valor_analise || 0) - Number(a.valor_analise || 0))[0];
    const maiorAluguel = alugueis.slice().sort((a, b) => Number(b.valor || 0) - Number(a.valor || 0))[0];

    const alertas = [
      maiorContrato && {
        valor: fmtBRL(maiorContrato.valor || 0),
        titulo: "Maior contrato carregado",
        desc: `${maiorContrato.contratado || "Contratado não informado"} - ${String(maiorContrato.objeto || "").slice(0, 140)}`,
        tab: "contratos",
      },
      maiorDiariaPessoa && {
        valor: fmtBRL(maiorDiariaPessoa.valor),
        titulo: "Maior acumulado de diárias por pessoa",
        desc: `${maiorDiariaPessoa.nome} - ${fmtNum(maiorDiariaPessoa.qtd)} diária(s) somadas no filtro anual carregado.`,
        tab: "diarias",
      },
      maiorAluguel && {
        valor: fmtBRL(maiorAluguel.valor || 0),
        titulo: "Maior contrato de aluguel",
        desc: `${maiorAluguel.contratado || "Contratado não informado"} - ${String(maiorAluguel.objeto || "").slice(0, 140)}`,
        tab: "alugueis",
      },
      maiorEvento && {
        valor: fmtBRL(maiorEvento.valor_analise || 0),
        titulo: "Maior item de evento/show",
        desc: `${maiorEvento.contratado || "Contratado não informado"} - ${String(maiorEvento.objeto || "").slice(0, 140)}`,
        tab: "eventos",
      },
      contratosMilhao.length && {
        valor: fmtNum(contratosMilhao.length),
        titulo: "Contratos de alto valor",
        desc: "Leia objeto, prazo, modalidade e fornecedor. Alto valor não e irregularidade, mas merece prioridade de conferência.",
        tab: "contratos",
      },
      diariasAltas.length && {
        valor: fmtNum(diariasAltas.length),
        titulo: "Diárias com valor diario alto",
        desc: "Existem diárias com valor superior a R$ 1.000 por dia. Confira destino e justificativa.",
        tab: "diarias",
      },
    ].filter(Boolean).slice(0, 5);

    if ($("prefeituraAtencao")) {
      $("prefeituraAtencao").innerHTML = `
        <h3 class="citizen-alerts__title">Atencao do cidadao: por onde comecar</h3>
        ${alertas.map(a => `
          <article class="citizen-alert-card">
            <strong>${a.valor}</strong>
            <div>
              <strong>${esc(a.titulo)}</strong>
              <p>${esc(a.desc)}</p>
            </div>
            <a href="#${esc(a.tab)}" data-pref-tab="${esc(a.tab)}">Ver agora</a>
          </article>`).join("")}`;
    }
  }

  function initGraficoMensal() {
    const el = $("graficoMensal");
    const block = $("graficoMensalBlock");
    if (!el || !block) return;

    const contratos = pf.contratos || [];
    const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

    // Agrupa valor por ano-mês
    const mapa = new Map();
    contratos.forEach(c => {
      const d = c.data_assinatura || "";
      const m = d.slice(0, 7); // "YYYY-MM"
      if (!m || m.length < 7) return;
      mapa.set(m, (mapa.get(m) || 0) + (Number(c.valor) || 0));
    });

    if (mapa.size < 2) return;

    const chaves = Array.from(mapa.keys()).sort();
    const valores = chaves.map(k => mapa.get(k));
    const maxVal  = Math.max(...valores) || 1;

    el.innerHTML = chaves.map((k, i) => {
      const [ano, mesIdx] = k.split("-");
      const label = `${MESES[Number(mesIdx) - 1]} ${ano}`;
      const pct   = ((valores[i] / maxVal) * 100).toFixed(1);
      const cor   = valores[i] >= maxVal * 0.8 ? "#c0392b"
                  : valores[i] >= maxVal * 0.5 ? "#e67e22"
                  : "#004b8d";
      return `
        <div class="chart-bar-col" title="${label}: ${fmtBRL(valores[i])}">
          <div class="chart-bar-wrap">
            <div class="chart-bar-fill" style="height:${pct}%; background:${cor}"></div>
          </div>
          <div class="chart-bar-label">${MESES[Number(mesIdx) - 1]}<br><small>${ano}</small></div>
        </div>`;
    }).join("");

    block.hidden = false;
  }

  function initSecretariasChart() {
    const el = $("secretariasBars");
    const block = $("secretariasBlock");
    if (!el || !block) return;
    const contratos = pf.contratos || [];
    if (!contratos.length) return;

    const mapa = new Map();
    contratos.forEach(c => {
      const sec = (c.entidade || "").trim();
      if (!sec || sec.length < 3) return;
      const cur = mapa.get(sec) || { nome: sec, valor: 0, qtd: 0 };
      cur.valor += Number(c.valor) || 0;
      cur.qtd += 1;
      mapa.set(sec, cur);
    });

    if (mapa.size < 2) return;

    const ranking = [...mapa.values()].sort((a, b) => b.valor - a.valor).slice(0, 12);
    const totalGeral = ranking.reduce((s, r) => s + r.valor, 0);
    const maxVal = ranking[0].valor || 1;

    el.innerHTML = ranking.map(r => {
      const pct = ((r.valor / maxVal) * 100).toFixed(1);
      const pctTotal = totalGeral ? ((r.valor / totalGeral) * 100).toFixed(1) : "0";
      return `<div class="sec-bar-row" title="${esc(r.nome)} — ${r.qtd} contrato(s)"
        onclick="if(document.getElementById('filtroSecretaria')){document.getElementById('filtroSecretaria').value='${jsSafe(r.nome)}';document.getElementById('filtroSecretaria').dispatchEvent(new Event('change'));document.querySelectorAll('[data-pref-tab=\\'contratos\\']').forEach(function(t){t.click();});}">
        <span class="sec-bar-name">${esc(r.nome)}</span>
        <div class="sec-bar-wrap">
          <div class="sec-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="sec-bar-val"><strong>${fmtBRL(r.valor)}</strong>${pctTotal}% · ${r.qtd}</div>
      </div>`;
    }).join("");

    block.hidden = false;
  }

  function initPrefeituraTabs() {
    const tabs = Array.from(document.querySelectorAll(".pref-tab[data-pref-tab]"));
    const triggers = Array.from(document.querySelectorAll("[data-pref-tab]"));
    const panels = Array.from(document.querySelectorAll("[data-pref-panel]"));
    if (!triggers.length || !panels.length) return;

    const hashMap = {
      contratosBlock: "contratos",
      contratos: "contratos",
      licitacoesBlock: "licitacoes",
      licitacoes: "licitacoes",
      eventosBlock: "eventos",
      listaEventos: "eventos",
      alugueisBlock: "alugueis",
      listaAlugueis: "alugueis",
      diariasPrefeituraBlock: "diarias",
      listaDiariasPrefeitura: "diarias",
      frotaBlock: "frota",
      frotaLista: "frota",
      asfaltoBlock: "asfalto",
      asfaltoPainel: "asfalto",
      diarioLista: "fontes",
      modulos: "fontes",
    };

    const activate = (key, updateHash = false) => {
      const chosen = panels.some(p => p.dataset.prefPanel === key) ? key : "visao";
      tabs.forEach(t => {
        const active = t.dataset.prefTab === chosen;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });
      panels.forEach(p => p.classList.toggle("is-active", p.dataset.prefPanel === chosen));
      if (updateHash) history.replaceState(null, "", `#${chosen}`);
      if (updateHash) {
        const target = document.querySelector(`[data-pref-panel="${chosen}"] .block`) ||
          document.querySelector(`[data-pref-panel="${chosen}"]`);
        setTimeout(() => scrollToEl(target), 30);
      }
    };

    triggers.forEach(tab => {
      tab.addEventListener("click", () => activate(tab.dataset.prefTab, true));
    });

    const hash = (location.hash || "").replace("#", "");
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab") || params.get("area");
    activate(hashMap[hash] || hash || tabParam || "visao");
  }

  function initCollapsibleBlocks() {
    const blocks = Array.from(document.querySelectorAll(".block"));
    if (!blocks.length) return;

    blocks.forEach((block, index) => {
      if (block.dataset.collapsibleReady === "1") return;
      const title = block.querySelector(":scope > .block__title");
      if (!title) return;

      block.dataset.collapsibleReady = "1";
      const titleText = (title.textContent || "Secao").trim();
      const storageKey = `zela:collapse:${PAGE}:${index}:${norm(titleText).slice(0, 48)}`;

      const head = document.createElement("div");
      head.className = "block__head";
      block.insertBefore(head, title);
      head.appendChild(title);

      const actions = document.createElement("div");
      actions.className = "block__actions";
      head.appendChild(actions);

      const pdf = document.createElement("button");
      pdf.type = "button";
      pdf.className = "pdf-action";
      pdf.innerHTML = `<span aria-hidden="true">PDF</span><span>Baixar</span>`;
      pdf.setAttribute("aria-label", `Baixar PDF da secao ${titleText}`);
      pdf.addEventListener("click", () => baixarPdfSecao(block, titleText));
      actions.appendChild(pdf);

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "block__toggle";
      toggle.setAttribute("aria-expanded", "true");
      toggle.innerHTML = `<span class="block__toggle-text">Fechar</span><span class="block__toggle-icon" aria-hidden="true">↑</span>`;
      toggle.setAttribute("aria-label", `Abrir ou fechar ${titleText}`);
      actions.appendChild(toggle);

      const content = document.createElement("div");
      content.className = "block__content";
      while (head.nextSibling) content.appendChild(head.nextSibling);
      block.appendChild(content);

      const setCollapsed = (collapsed, save = true) => {
        block.classList.toggle("is-collapsed", collapsed);
        content.hidden = collapsed;
        toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
        const text = toggle.querySelector(".block__toggle-text");
        const icon = toggle.querySelector(".block__toggle-icon");
        if (text) text.textContent = collapsed ? "Abrir" : "Fechar";
        if (icon) icon.textContent = collapsed ? "↓" : "↑";
        if (save) {
          try { localStorage.setItem(storageKey, collapsed ? "1" : "0"); } catch (_) {}
        }
      };

      toggle.addEventListener("click", () => setCollapsed(!block.classList.contains("is-collapsed")));

      let saved = null;
      try { saved = localStorage.getItem(storageKey); } catch (_) {}
      if (saved === "1") setCollapsed(true, false);

      const hash = (window.location.hash || "").replace("#", "");
      if (hash && (block.id === hash || content.querySelector(`#${CSS.escape(hash)}`))) {
        setCollapsed(false, false);
      }
    });
  }

  function initPagePdfButton() {
    const header = document.querySelector(".bigheader");
    if (!header || header.querySelector(".pdf-action")) return;

    const actions = header.querySelector(".civic-actions") || header;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pdf-action pdf-action--page";
    button.innerHTML = `<span aria-hidden="true">PDF</span><span>Baixar pagina</span>`;
    button.setAttribute("aria-label", "Baixar PDF da pagina atual");
    button.addEventListener("click", () => baixarPdfSecao(document.querySelector("#conteudo") || document.body, pageTitle()));
    actions.appendChild(button);
  }

  // ============= AUDITÔMETRO (index.html) =============
  function initScorecard() {
    if (!$("scorePrefeitura")) return;

    // Lógica Prefeitura
    const contratos = pf.contratos || [];
    const objVagos = contratos.filter(c => (c.objeto || "").length < 25).length;
    const scorePref = Math.max(0, 100 - (objVagos * 3));
    
    updateScore("Pref", scorePref, [
      `Objetos com descrição clara: ${Math.round(((contratos.length - objVagos) / (contratos.length || 1)) * 100)}%`,
      `Atualização: ${cleanText(D.atualizado_em?.data_humana || "Pendente")}`,
      `Dados Abertos: Integrado`
    ]);

    // Lógica Câmara
    const emendas = D.emendas || [];
    const semCnpj = emendas.filter(e => !e.cnpj).length;
    const scoreCam = Math.max(0, 100 - (semCnpj * 5));
    
    updateScore("Cam", scoreCam, [
      `Emendas com CNPJ: ${Math.round(((emendas.length - semCnpj) / (emendas.length || 1)) * 100)}%`,
      `Cruzamento Fiscal: Ativo`,
      `Fonte: SAPL Câmara`
    ]);
  }

  function updateScore(id, val, list) {
    const circle = $("circle" + id);
    const text = $("val" + id);
    const listEl = $("list" + id);
    if (!circle || !text || !listEl) return;

    circle.setAttribute("stroke-dasharray", `${val}, 100`);
    text.textContent = val;
    listEl.innerHTML = list.map(li => `<li>${li}</li>`).join("");
  }

  if (PAGE === "home") initScorecard();
  if (PAGE === "pessoal") initPessoal();
  if (PAGE === "prefeitura") renderPlacarPrefeitura();
  if (PAGE === "prefeitura") renderCategoriasPrefeitura();
  if (PAGE === "prefeitura") renderPrefeituraOverview();
  if (PAGE === "prefeitura") initGraficoMensal();
  if (PAGE === "prefeitura") initSecretariasChart();
  if (PAGE === "prefeitura") initPrefeituraTabs();
  if (PAGE === "prefeitura") renderAsfaltoPrefeitura();
  if (PAGE === "prefeitura") renderFrotaPrefeitura();
  if (PAGE === "camara") renderPlacarCamara();
  if (PAGE === "camara") renderRemuneracaoVereadores();
  if (PAGE === "camara" && window.ZELA.indiceRelevancia) window.ZELA.indiceRelevancia.render();
  if (PAGE === "camara") renderCategoriasCamara();
  if (PAGE === "cobrar") {
    renderFilaCobrancaPublica();
    ["filaCobrancaOrgao", "filaCobrancaTipo", "filaCobrancaRisco"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("change", renderFilaCobrancaPublica);
    });
  }
  if (PAGE === "atualizacoes" && window.ZELA.atualizacoes) window.ZELA.atualizacoes.init();
  if (PAGE === "prefeitura") renderAlugueisV2();
  if (PAGE === "prefeitura") initDiarias("Prefeitura", (D.diarias || {}).prefeitura || []);
  if (PAGE === "camara") initDiarias("Camara", (D.diarias || {}).camara || []);
  if (PAGE === "relatorios" && typeof renderRelatorios === "function") renderRelatorios();
  initCollapsibleBlocks();
  initPagePdfButton();

  // ============= TOAST "Dados atualizados" (Service Worker) =============
  (function () {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("message", function (e) {
      if (!e.data || e.data.type !== "DATA_UPDATED") return;
      const existing = document.getElementById("sw-toast");
      if (existing) return; // ja visível
      const toast = document.createElement("div");
      toast.id = "sw-toast";
      toast.setAttribute("role", "status");
      toast.innerHTML = `${window.ZELA.icon ? window.ZELA.icon("sinal", { size: 16 }) : ""} Dados atualizados <button onclick="window.location.reload()">Recarregar</button>`;
      document.body.appendChild(toast);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { toast.classList.add("show"); });
      });
      // Auto-dismiss após 12s
      setTimeout(function () {
        toast.classList.remove("show");
        setTimeout(function () { toast.remove(); }, 350);
      }, 12000);
    });
  })();

  // ============= ATALHO DE NAVEGAÇÃO: g + tecla =============
  (function () {
    const ROTAS = {
      "h": "index.html", "i": "index.html",
      "p": "prefeitura.html",
      "c": "camara.html",
      "r": "relatorios.html",
      "e": "pessoal.html",
      "m": "marcadores.html",
      "s": "sobre.html",
      "k": "cobrar.html",
    };
    let aguardandoG = false;
    let timer = null;
    document.addEventListener("keydown", function (e) {
      const tag = document.activeElement ? document.activeElement.tagName : "";
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
                         (document.activeElement && document.activeElement.isContentEditable);
      if (isEditable || e.ctrlKey || e.metaKey || e.altKey) return;

      if (aguardandoG) {
        const dest = ROTAS[e.key.toLowerCase()];
        if (dest) {
          e.preventDefault();
          window.location.href = dest;
        }
        aguardandoG = false;
        if (timer) clearTimeout(timer);
        return;
      }

      if (e.key === "g" || e.key === "G") {
        aguardandoG = true;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () { aguardandoG = false; }, 1500);
      }
    });
  })();

  // ============= ATALHO DE TECLADO: / = focar busca, Esc = limpar =============
  (function () {
    const BUSCA_IDS = [
      "filtroContrato", "filtroEm", "filtroVer", "buscaServidor",
      "filtroLicitacao", "filtroEvento", "filtroAluguel", "filtroDiaria",
      "filtroFrota",
    ];
    document.addEventListener("keydown", function (e) {
      const tag = document.activeElement ? document.activeElement.tagName : "";
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
                         document.activeElement.isContentEditable;

      if (e.key === "/" && !isEditable && !e.ctrlKey && !e.metaKey) {
        for (let i = 0; i < BUSCA_IDS.length; i++) {
          const el = document.getElementById(BUSCA_IDS[i]);
          if (el) {
            e.preventDefault();
            el.focus();
            el.select && el.select();
            break;
          }
        }
        return;
      }

      if (e.key === "Escape" && isEditable) {
        const el = document.activeElement;
        if (el.type === "search" || el.tagName === "INPUT") {
          el.value = "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.blur();
        }
      }
    });

    // Tooltip sutil no campo de busca
    BUSCA_IDS.forEach(function (id) {
      const el = document.getElementById(id);
      if (el && !el.title) el.title = "Atalho: pressione / para focar — Esc para limpar";
    });
  })();

  // ============= BOTÃO VOLTAR AO TOPO =============
  (function () {
    const btn = document.createElement("button");
    btn.id = "btn-topo";
    btn.setAttribute("aria-label", "Voltar ao topo");
    btn.title = "Voltar ao topo";
    btn.textContent = "↑";
    document.body.appendChild(btn);
    window.addEventListener("scroll", function () {
      btn.classList.toggle("visible", window.scrollY > 400);
    }, { passive: true });
    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  })();

  // Remover overlay de carregamento
  (function () {
    const ov = document.getElementById("loading-overlay");
    if (!ov) return;
    ov.classList.add("fadeout");
    setTimeout(function () { ov.remove(); }, 320);
  })();
  // ============= EFEITO SCROLL NO NAVBAR =============
  const _topbarEl = document.querySelector(".topbar");
  if (_topbarEl) {
    window.addEventListener("scroll", () => {
      _topbarEl.classList.toggle("topbar--scrolled", window.scrollY > 50);
    }, { passive: true });
  }

  // ============= HAMBURGER NAV (mobile) =============
  (function() {
    const toggle = document.querySelector(".nav__toggle");
    const nav    = document.getElementById("mainNav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", function() {
      const open = nav.classList.toggle("nav--open");
      toggle.setAttribute("aria-expanded", open);
      toggle.textContent = open ? "✕ Fechar" : "☰ Menu";
    });
    nav.querySelectorAll("a").forEach(function(a) {
      a.addEventListener("click", function() {
        nav.classList.remove("nav--open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "☰ Menu";
      });
    });
  })();

  } catch (err) {
    const _ov = document.getElementById("loading-overlay");
    if (_ov) _ov.remove();
    console.error(err);
    const stack = err.stack || "";
    const linha = stack.match(/:(\d+):\d+\)?$/m)?.[1] || stack.match(/(\d+):\d+/)?.[1];
    const resumo = stack.split("\n").slice(0, 3).join(" | ");
    alert("ERRO NO PAINEL CIDADÃO: " + err.message + (linha ? " [linha ~" + linha + "]" : "") + "\n\n" + resumo + "\n\nCopie e envie para o Claude!");
  }
})();
