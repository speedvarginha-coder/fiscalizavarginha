/* Fiscaliza Varginha — modules/home-cidadao.js
 *
 * Cinco blocos cidadãos da home (containers e CSS já existiam; este módulo
 * é o renderer que faltava):
 *   1. Legenda de leitura dos dados  (#dataReadingLegend)
 *   2. Guia "Não sei por onde começar" (#homeStartGuide + #homeStartGuideDetail)
 *   3. Auditor inteligente — sugestões ao digitar (#homeSmartSuggest + #buscaHome)
 *   4. Mapa cidadão do dinheiro (#homeMoneyMap)
 *   5. Tendência cidadã (#homeTrendWatch)
 *
 * Lê window.ZELA_DATA diretamente (4 e 5). 1–3 são estáticos e funcionam
 * mesmo sem dados. Segue o padrão de modules/dashboard.js.
 * Dependências: window.ZELA.utils, window.ZELA.categorias/classificarItem,
 * window.ZELA.dossie.abrirComHtml (modal).
 */
(function () {
  "use strict";
  window.ZELA = window.ZELA || {};
  const u = window.ZELA.utils;
  if (!u) return;
  const { fmtBRL, fmtNum, esc, cleanText } = u;
  function $(id) { return document.getElementById(id); }
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function abrirModal(html) {
    if (window.ZELA.dossie && window.ZELA.dossie.abrirComHtml) {
      window.ZELA.dossie.abrirComHtml(html);
    }
  }

  // ============================================================
  // 1. LEGENDA DE LEITURA DOS DADOS
  // ============================================================
  function renderLegenda() {
    const el = $("dataReadingLegend");
    if (!el) return;
    el.hidden = false;
    el.innerHTML =
      '<button class="data-legend__toggle" type="button" aria-expanded="false" aria-controls="dataReadingLegendPanel">' +
        'Como ler os dados deste painel <span aria-hidden="true">▾</span>' +
      '</button>' +
      '<div class="data-legend__panel" id="dataReadingLegendPanel" hidden>' +
        '<button class="data-legend__close" type="button" aria-label="Fechar legenda">×</button>' +
        '<strong>Cada informação do painel tem um grau de certeza.</strong>' +
        '<p>O painel nunca acusa: ele organiza dados públicos. Esta legenda diz o quanto cada número aguenta antes de precisar de conferência.</p>' +
        '<dl class="data-legend__list">' +
          '<div class="data-legend__item data-legend__item--official"><dt>Fato oficial</dt><dd>Número copiado direto da fonte pública (Portal da Transparência, SAPL, Diário Oficial), com link para conferir.</dd></div>' +
          '<div class="data-legend__item data-legend__item--cross"><dt>Cruzamento</dt><dd>Duas fontes oficiais combinadas — por exemplo, emenda × pagamento pelo CNPJ. Forte, mas confira na fonte.</dd></div>' +
          '<div class="data-legend__item data-legend__item--inferred"><dt>Inferência</dt><dd>Leitura automática a partir de um padrão (ex.: objeto de contrato vago). É pista, não é prova.</dd></div>' +
          '<div class="data-legend__item data-legend__item--pending"><dt>Pendência</dt><dd>Informação que falta na fonte oficial. Cabe pedido pela Lei de Acesso à Informação — o painel entrega a pergunta pronta.</dd></div>' +
          '<div class="data-legend__item data-legend__item--attention"><dt>Atenção</dt><dd>Sinal automático que merece conferência humana antes de qualquer conclusão ou divulgação.</dd></div>' +
        '</dl>' +
      '</div>';
    const btn = el.querySelector(".data-legend__toggle");
    const panel = el.querySelector(".data-legend__panel");
    const fechar = el.querySelector(".data-legend__close");
    function abrir() { btn.setAttribute("aria-expanded", "true"); panel.hidden = false; }
    function recolher() { btn.setAttribute("aria-expanded", "false"); panel.hidden = true; btn.focus(); }
    btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-expanded") === "true") recolher(); else abrir();
    });
    fechar.addEventListener("click", recolher);
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") recolher(); });
  }

  // ============================================================
  // 2. GUIA "NÃO SEI POR ONDE COMEÇAR"
  // ============================================================
  const GUIA = {
    obras: {
      titulo: "Quero saber de obras e buracos",
      voce: "as obras oficiais da Prefeitura com valor, empresa, metragem e custo por m² — incluindo asfalto e tapa-buraco.",
      rotulo: "Abrir obras e asfalto",
      href: "prefeitura.html?tab=asfalto",
    },
    dinheiro: {
      titulo: "Quem recebeu dinheiro da Prefeitura?",
      voce: "os maiores fornecedores e os contratos de alto valor, com objeto, vigência e link para a fonte.",
      rotulo: "Abrir contratos",
      href: "prefeitura.html?tab=contratos",
    },
    diario: {
      titulo: "Quero ver o que saiu no Diário Oficial",
      voce: "as edições mais recentes resumidas em linguagem simples, com link para o PDF oficial.",
      rotulo: "Abrir Diário Oficial",
      href: "atualizacoes.html?tab=diario",
    },
    salarios: {
      titulo: "Quanto ganham os servidores?",
      voce: "a folha de pagamento por secretaria, os cargos comissionados e a remuneração — sem expor CPF.",
      rotulo: "Abrir Pessoal e Cargos",
      href: "pessoal.html",
    },
    camara: {
      titulo: "O que os vereadores estão fazendo?",
      voce: "a produção de cada vereador, as emendas destinadas e para qual CNPJ foi o dinheiro.",
      rotulo: "Abrir Câmara",
      href: "camara.html",
    },
    cobrar: {
      titulo: "Quero cobrar uma resposta oficial",
      voce: "modelos prontos de pedido pela Lei de Acesso à Informação e os canais oficiais — leva 2 minutos.",
      rotulo: "Abrir Como cobrar",
      href: "cobrar.html",
    },
  };

  function renderStartGuide() {
    const guia = $("homeStartGuide");
    const detail = $("homeStartGuideDetail");
    if (!guia || !detail) return;
    function mostrar(key) {
      const g = GUIA[key];
      if (!g) return;
      guia.querySelectorAll("[data-start-key]").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.startKey === key);
      });
      detail.innerHTML =
        '<div>' +
          '<strong>' + esc(g.titulo) + '</strong>' +
          '<p><b>Você vai ver:</b> ' + esc(g.voce) + '</p>' +
        '</div>' +
        '<a href="' + esc(g.href) + '">' + esc(g.rotulo) + ' →</a>';
    }
    guia.querySelectorAll("[data-start-key]").forEach((b) => {
      b.addEventListener("click", () => mostrar(b.dataset.startKey));
    });
    mostrar("obras");
  }

  // ============================================================
  // 3. AUDITOR INTELIGENTE — sugestões enquanto digita
  // ============================================================
  const TOPICOS = [
    { id: "asfalto", rotulo: "Asfalto e buracos", dica: "Ver gastos com pavimentação",
      termos: ["asfalto", "buraco", "pavimentacao", "obra", "recape", "tapa buraco", "rua"],
      href: "prefeitura.html?tab=asfalto&q=asfalto", abre: "a aba Asfalto da Prefeitura, com as obras oficiais, metragem e custo por m²",
      pergunta: "Solicito a relação de obras de pavimentação e tapa-buraco em execução, com contrato, empresa, metragem, custo por m², fiscal responsável e medições." },
    { id: "diarias", rotulo: "Diárias e viagens", dica: "Ver quem viajou com dinheiro público",
      termos: ["diaria", "viagem", "hospedagem", "deslocamento"],
      href: "prefeitura.html?tab=diarias&q=diarias", abre: "a aba Diárias da Prefeitura, com pessoa, destino, valor e finalidade",
      pergunta: "Solicito a relação de diárias pagas no período, com beneficiário, cargo, destino, finalidade, valor unitário e relatório de atividades." },
    { id: "comissionados", rotulo: "Cargos comissionados", dica: "Ver cargos sem concurso e salários",
      termos: ["comissionado", "cargo", "salario", "folha", "servidor", "nomeacao"],
      href: "pessoal.html?tipo=comissionado", abre: "a página Pessoal filtrada nos cargos comissionados, com remuneração por secretaria",
      pergunta: "Solicito a relação de cargos comissionados ativos, com nome do cargo, lotação, remuneração e ato de nomeação." },
    { id: "eventos", rotulo: "Shows e eventos", dica: "Ver contratos de festas e estruturas",
      termos: ["show", "evento", "festa", "artista", "palco", "cache"],
      href: "prefeitura.html?tab=eventos&q=eventos", abre: "a aba Eventos da Prefeitura, com contratos de shows, estruturas e valores",
      pergunta: "Solicito os contratos de eventos e shows, com artista ou estrutura contratada, valor, justificativa de preço e contrapartidas de receita privada." },
    { id: "alugueis", rotulo: "Aluguéis de imóveis", dica: "Ver quanto a Prefeitura paga de aluguel",
      termos: ["aluguel", "imovel", "locacao", "predio"],
      href: "prefeitura.html?tab=alugueis&q=alugueis", abre: "a aba Aluguéis, com imóvel, finalidade, valor mensal e proprietário",
      pergunta: "Solicito os contratos de locação de imóveis vigentes, com endereço, finalidade pública, valor mensal, laudo de avaliação e justificativa para locação." },
    { id: "emendas", rotulo: "Emendas dos vereadores", dica: "Ver para onde foram as emendas",
      termos: ["emenda", "vereador", "destinou", "entidade"],
      href: "camara.html#emendas", abre: "o bloco de emendas da Câmara, com beneficiário, CNPJ, valor e status de pagamento",
      pergunta: "Solicito a documentação da emenda impositiva, com plano de trabalho, empenho, pagamento, notas fiscais e comprovação de execução." },
    { id: "merenda", rotulo: "Merenda escolar", dica: "Ver compras de alimentação escolar",
      termos: ["merenda", "alimentacao", "escola", "creche"],
      href: "prefeitura.html?q=merenda", abre: "a busca da Prefeitura filtrada em merenda e alimentação escolar",
      pergunta: "Solicito os contratos de fornecimento de alimentação escolar, com fornecedor, itens, quantidades, preços unitários e cronograma de entrega." },
    { id: "combustivel", rotulo: "Combustíveis", dica: "Ver gastos com gasolina e diesel",
      termos: ["combustivel", "gasolina", "diesel", "abastecimento", "posto", "frota"],
      href: "prefeitura.html?q=combustivel", abre: "a busca de contratos da Prefeitura filtrada em combustíveis e abastecimento",
      pergunta: "Solicito a relação detalhada de despesas com combustíveis da frota municipal, informando o posto contratado, valores faturados, volume em litros e controle de quilometragem por veículo." },
    { id: "obras", rotulo: "Obras públicas", dica: "Construções, reformas e asfalto",
      termos: ["obra", "reforma", "construcao", "calcamento", "drenagem", "ponte"],
      href: "prefeitura.html?tab=asfalto", abre: "a aba de Obras/Asfalto da Prefeitura, com as obras municipais e medições oficiais",
      pergunta: "Solicito a relação de todas as obras de engenharia civil, reformas e edificações contratadas em andamento, detalhando o valor total, empresa contratada, cronograma físico-financeiro e medição acumulada." },
  ];

  function renderSmartSuggest() {
    const box = $("homeSmartSuggest");
    const input = $("buscaHome");
    if (!box || !input) return;

    function listar(q) {
      const matches = TOPICOS.filter((t) =>
        t.termos.some((termo) => termo.startsWith(q) || termo.includes(q) || q.includes(termo))
      ).slice(0, 4);
      if (!matches.length) { box.innerHTML = ""; return; }
      box.innerHTML =
        '<div class="smart-suggest__head"><strong>Auditor inteligente</strong><span>caminhos prontos para o que você procura</span></div>' +
        '<div class="smart-suggest__list">' +
          matches.map((t) =>
            '<button type="button" data-smart-pick="' + t.id + '"><span>' + esc(t.rotulo) + '</span><small>' + esc(t.dica) + '</small></button>'
          ).join("") +
        '</div>';
      box.querySelectorAll("[data-smart-pick]").forEach((b) => {
        b.addEventListener("click", () => guiar(b.dataset.smartPick));
      });
    }

    function guiar(id) {
      const t = TOPICOS.find((x) => x.id === id);
      if (!t) return;
      box.innerHTML =
        '<div class="smart-suggest__head"><strong>Resultado guiado</strong><span>' + esc(t.rotulo) + '</span></div>' +
        '<div class="smart-suggest__list">' +
          '<p><b>Você vai abrir:</b> ' + esc(t.abre) + '.</p>' +
          '<p><b>Pergunta pronta</b> (copie e envie pelo e-SIC): ' + esc(t.pergunta) + '</p>' +
          '<button type="button" data-smart-q="' + t.id + '"><span>' + esc(t.rotulo) + ' →</span><small>abrir já filtrado</small></button>' +
        '</div>';
      box.querySelector("[data-smart-q]").addEventListener("click", () => {
        window.location.href = t.href;
      });
    }

    input.addEventListener("input", () => {
      const q = norm(input.value).trim();
      if (q.length < 2) { box.innerHTML = ""; return; }
      listar(q);
    });
  }

  // ============================================================
  // 4. MAPA CIDADÃO DO DINHEIRO
  // ============================================================
  function renderMoneyMap() {
    const el = $("homeMoneyMap");
    if (!el) return;
    const pf = (window.ZELA_DATA || {}).prefeitura || {};
    const contratos = pf.contratos || [];
    const classificar = window.ZELA.classificarItem || function () { return null; };
    const cats = window.ZELA.categorias || [];
    if (!contratos.length || !cats.length) return;

    const ag = {};
    contratos.forEach((c) => {
      const cat = classificar(c);
      if (!cat) return;
      ag[cat] = ag[cat] || { valor: 0, qtd: 0 };
      ag[cat].valor += Number(c.valor) || 0;
      ag[cat].qtd += 1;
    });
    const topo = cats
      .filter((c) => ag[c.id] && ag[c.id].valor > 0)
      .map((c) => ({ id: c.id, label: c.label, valor: ag[c.id].valor, qtd: ag[c.id].qtd }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8);
    if (!topo.length) return;
    const max = topo[0].valor;

    el.innerHTML =
      '<div class="home-money-map__head">' +
        '<span>MAPA CIDADÃO</span>' +
        '<strong>Para onde foi o dinheiro</strong>' +
        '<small>Contratos da Prefeitura somados por tema (classificação automática — é pista, não prova). Clique para a explicação cidadã.</small>' +
      '</div>' +
      '<div class="home-money-map__grid">' +
        topo.map((t) =>
          '<article class="money-topic">' +
            '<div class="money-topic__top"><span>' + esc(t.label) + '</span><strong>' + fmtBRL(t.valor) + '</strong></div>' +
            '<div class="money-topic__bar"><i style="width:' + Math.max(4, Math.round((t.valor / max) * 100)) + '%"></i></div>' +
            '<p>' + fmtNum(t.qtd) + ' contrato' + (t.qtd === 1 ? "" : "s") + ' classificado' + (t.qtd === 1 ? "" : "s") + ' automaticamente.</p>' +
            '<div class="money-topic__actions">' +
              '<button type="button" data-money-cat="' + t.id + '">Explicação cidadã</button>' +
              '<a href="prefeitura.html?tab=contratos">Ver contratos</a>' +
            '</div>' +
          '</article>'
        ).join("") +
      '</div>';

    el.querySelectorAll("[data-money-cat]").forEach((b) => {
      b.addEventListener("click", () => {
        const t = topo.find((x) => x.id === b.dataset.moneyCat);
        if (!t) return;
        abrirModal(
          '<div class="cat-modal">' +
            '<p style="margin:0;font-size:.72rem;font-weight:800;letter-spacing:.06em;color:var(--gold-dk);">EXPLICAÇÃO CIDADÃ</p>' +
            '<h3 style="margin:4px 0 10px;">' + esc(t.label) + '</h3>' +
            '<p>O painel encontrou <strong>' + fmtNum(t.qtd) + ' contrato' + (t.qtd === 1 ? "" : "s") + '</strong> ligados a este tema, somando <strong>' + fmtBRL(t.valor) + '</strong>.</p>' +
            '<p class="muted small">Classificação automática por palavra-chave (inferência). Antes de divulgar qualquer conclusão, abra o contrato e confira a fonte oficial.</p>' +
            '<h4 style="margin:14px 0 6px;">O que perguntar</h4>' +
            '<p>Peça pelo e-SIC: contrato integral, anexos, notas fiscais, comprovantes de pagamento e relatório do fiscal dos itens deste tema.</p>' +
            '<p style="margin-top:12px;"><a class="btn-small" href="prefeitura.html?tab=contratos">Abrir contratos da Prefeitura</a> ' +
            '<a class="btn-small" href="cobrar.html">Como cobrar</a></p>' +
          '</div>'
        );
      });
    });
  }

  // ============================================================
  // 5. TENDÊNCIA CIDADÃ
  // ============================================================
  function renderTrendWatch() {
    const el = $("homeTrendWatch");
    if (!el) return;
    const D = window.ZELA_DATA || {};
    const pf = D.prefeitura || {};
    const cb = D.camara_betha || {};
    if (!pf.ano_atual) return;
    const anoAtu = String(pf.ano_atual);
    const anoAnt = String(pf.ano_anterior || pf.ano_atual - 1);

    const contratos = pf.contratos || [];
    const qtdAtu = contratos.filter((c) => String(c.ano) === anoAtu).length;
    const qtdAnt = contratos.filter((c) => String(c.ano) === anoAnt).length;

    const series = [
      { id: "pagamentos", titulo: "Pagamentos da Prefeitura", ant: Number(pf.total_externo_anterior) || 0, atu: Number(pf.total_externo_atual) || 0, fmt: fmtBRL,
        fonte: "Despesas por credor — Portal da Transparência (Betha)." },
      { id: "camara", titulo: "Despesas da Câmara", ant: Number(cb.total_externo_anterior) || 0, atu: Number(cb.total_externo_atual) || 0, fmt: fmtBRL,
        fonte: "Despesas por credor da Câmara — Portal da Transparência (Betha)." },
      { id: "contratos", titulo: "Contratos firmados", ant: qtdAnt, atu: qtdAtu, fmt: fmtNum,
        fonte: "Contratos públicos — Portal da Transparência (Betha)." },
    ].filter((s) => s.ant > 0 || s.atu > 0);
    if (!series.length) return;

    function delta(s) {
      if (!s.ant) return null;
      return Math.round(((s.atu - s.ant) / s.ant) * 100);
    }

    el.innerHTML =
      '<div class="home-trend-watch__head">' +
        '<span>TENDÊNCIA CIDADÃ</span>' +
        '<strong>Está melhorando ou piorando?</strong>' +
        '<small>Comparação entre ' + esc(anoAnt) + ' (fechado) e ' + esc(anoAtu) + ' (em curso). Ano incompleto compara menor — leia com cautela.</small>' +
      '</div>' +
      '<div class="home-trend-watch__grid">' +
        series.map((s) => {
          const d = delta(s);
          const cls = d === null ? "neutral" : d > 3 ? "up" : d < -3 ? "down" : "stable";
          const rot = d === null ? "novo" : (d > 0 ? "+" : "") + d + "%";
          return (
            '<article class="trend-card trend-card--' + cls + '">' +
              '<div class="trend-card__top"><span>' + esc(s.titulo) + '</span><strong>' + rot + '</strong></div>' +
              '<div class="trend-card__values">' +
                '<div><small>' + esc(anoAnt) + '</small><b>' + s.fmt(s.ant) + '</b></div>' +
                '<div><small>' + esc(anoAtu) + '</small><b>' + s.fmt(s.atu) + '</b><i>ano em curso</i></div>' +
              '</div>' +
              '<div class="money-topic__actions"><button type="button" data-trend="' + s.id + '">Entender este número</button></div>' +
            '</article>'
          );
        }).join("") +
      '</div>';

    el.querySelectorAll("[data-trend]").forEach((b) => {
      b.addEventListener("click", () => {
        const s = series.find((x) => x.id === b.dataset.trend);
        if (!s) return;
        const d = delta(s);
        abrirModal(
          '<div class="cat-modal">' +
            '<p style="margin:0;font-size:.72rem;font-weight:800;letter-spacing:.06em;color:var(--gold-dk);">TENDÊNCIA CIDADÃ</p>' +
            '<h3 style="margin:4px 0 10px;">' + esc(s.titulo) + '</h3>' +
            '<p><strong>' + esc(anoAnt) + ':</strong> ' + s.fmt(s.ant) + ' · <strong>' + esc(anoAtu) + ':</strong> ' + s.fmt(s.atu) +
              (d !== null ? ' (<strong>' + (d > 0 ? "+" : "") + d + '%</strong>)' : '') + '</p>' +
            '<h4 style="margin:14px 0 6px;">Confiança do dado</h4>' +
            '<p>Os totais de cada ano são <strong>fato oficial</strong> (' + esc(s.fonte) + '). A comparação é <strong>inferência</strong>: ' +
              esc(anoAtu) + ' ainda está em curso, então a queda ou alta pode mudar até o fechamento do ano.</p>' +
            '<h4 style="margin:14px 0 6px;">O que perguntar</h4>' +
            '<p>Se a variação parecer estranha, peça pelo e-SIC o detalhamento da despesa por mês e por credor no período.</p>' +
          '</div>'
        );
      });
    });
  }

  // ============================================================
  renderLegenda();
  renderStartGuide();
  renderSmartSuggest();
  renderMoneyMap();
  renderTrendWatch();

  // Listen to deferred chunks loading (like "prefeitura" on home page)
  window.addEventListener("zela:chunk", function (e) {
    const key = (e.detail || {}).key;
    if (key === "prefeitura") {
      renderMoneyMap();
      renderTrendWatch();
    }
  });
})();
