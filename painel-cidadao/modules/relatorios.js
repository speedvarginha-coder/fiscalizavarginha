/* Fiscaliza Varginha — modules/relatorios.js
 *
 * Blocos auto-contidos da página de Relatórios:
 *   - Timeline de sinais (eventos cronológicos)
 *   - Triagem de concentração de dispensas por valor
 *   - Comparativo entre anos por categoria
 *
 * Cada função lê window.FISCALIZA_DATA diretamente. Só renderiza se o
 * elemento alvo existe no DOM (ignora outras páginas).
 *
 * Disponível em window.FISCALIZA.relatorios.
 * Dependências:
 *   - window.FISCALIZA.utils (fmtBRL, fmtNum, esc, cleanText)
 *   - window.FISCALIZA.icon
 *   - window.FISCALIZA.classificarItem + window.FISCALIZA.categorias
 *
 * Carregado pelo data-loader.js (depois dos módulos base, antes de app.js).
 */
(function () {
  "use strict";
  window.FISCALIZA = window.FISCALIZA || {};

  const u = window.FISCALIZA.utils;
  if (!u) {
    console.error("[relatorios] window.FISCALIZA.utils ausente. Carregue modules/utils.js primeiro.");
    return;
  }
  const { fmtBRL, fmtNum, esc, cleanText } = u;

  function $(id) { return document.getElementById(id); }
  function icon(nome, opts) {
    return (window.FISCALIZA.icon || function () { return ""; })(nome, opts);
  }

  // ============================================================
  // Timeline de sinais de atenção
  // ============================================================
  function renderTimelineSinais() {
    const el = $("timelineSinais");
    const block = $("timelineSinaisBlock");
    if (!el || !block) return;

    const D = window.FISCALIZA_DATA || {};
    const pf = D.prefeitura || {};
    const eventos = [];
    const contratos = pf.contratos || [];
    const emendasAll = D.emendas || [];

    // 1) Contratos de alto valor com objeto vago/curto
    contratos.forEach(c => {
      const obj = (c.objeto || "").trim();
      const valor = Number(c.valor) || 0;
      if (valor >= 500000 && obj.length < 40 && c.data_assinatura) {
        eventos.push({
          data: c.data_assinatura,
          tipo: "red",
          tag: "Descrição curta",
          titulo: `${fmtBRL(valor)} — ${cleanText(c.contratado || "—")}`,
          desc: `O resumo do objeto tem ${obj.length} caracteres: "${esc(obj || "sem descrição")}". Isso não mede a qualidade do processo; abra o contrato e peça o Termo de Referência se o documento não estiver acessível.`,
          link: "prefeitura.html?q=" + encodeURIComponent(c.contratado || ""),
        });
      }
    });

    // 2) NAO existe mais sinal por contrato para CNPJ mascarado.
    //
    // O detector antigo acusava todo contrato acima de R$ 1 mi cujo CNPJ viesse
    // com asterisco. So que a fonte mascara o CNPJ em 100% dos contratos: em
    // 04/09/2026 eram 1.334 de 1.334. Um rotulo que vale para todos nao
    // distingue ninguem, e ele ocupava 24 das 25 vagas da linha do tempo,
    // nomeando empresas por uma condicao universal. Em 29 dos casos acusados o
    // proprio painel ja tinha identificado a empresa por reconstrucao de raiz.
    //
    // Cada afirmacao isolada era verdadeira e o conjunto era falso. Limitacao
    // de fonte vira nota unica (abaixo), nao suspeita com nome na tela.

    // 3) Emendas sem pagamento de alto valor
    const cruzMap = {};
    ((pf.emendas_cruzadas) || []).forEach(c => { cruzMap[c.numero + "/" + c.ano] = c; });
    emendasAll.forEach(e => {
      const cruz = cruzMap[e.numero + "/" + e.ano] || {};
      const valor = Number(e.valor_brl) || 0;
      if (valor >= 50000 && cruz.status === "sem_pagamento") {
        const dataRef = e.data || e.data_publicacao || (e.ano ? `${e.ano}-12-31` : null);
        if (!dataRef) return;
        eventos.push({
          data: dataRef,
          tipo: "gold",
          tag: "Pagamento não localizado",
          titulo: `${fmtBRL(valor)} destinados a ${esc(cleanText(e.beneficiario || "—"))}`,
          desc: `Emenda de ${esc(e.autor || "vereador não identificado")} (Câmara) sem pagamento vinculado automaticamente na base da Prefeitura. Isso não comprova ausência de execução.`,
          link: "camara.html?q=" + encodeURIComponent(e.beneficiario || ""),
        });
      }
    });

    // Ordena por data decrescente
    eventos.sort((a, b) => (b.data || "").localeCompare(a.data || ""));
    const top = eventos.slice(0, 25);
    if (!top.length) return;

    // Limitacao de fonte declarada uma vez, com o tamanho real do problema.
    const mascarados = contratos.filter(c => String(c.cnpj || "").includes("*")).length;
    const reconstruidos = ((D.cnpjs || {}).empresas || []).length;
    let nota = block.querySelector(".tline-fonte-nota");
    if (mascarados && !nota) {
      nota = document.createElement("p");
      nota.className = "report-note tline-fonte-nota";
      el.parentNode.insertBefore(nota, el);
    }
    if (nota) {
      nota.innerHTML = mascarados === contratos.length
        ? `<strong>Sobre o CNPJ dos contratados:</strong> o portal de origem publica o CNPJ mascarado em <strong>todos</strong> os ${fmtNum(contratos.length)} contratos, mostrando apenas a raiz. O painel reconstrói ${fmtNum(reconstruidos)} deles cruzando raiz e razão social, o que é inferência e não vale como documento. Isso não distingue um contrato do outro: é limitação da fonte, não sinal sobre nenhuma empresa. Para obter o CNPJ completo, peça a íntegra do contrato por LAI.`
        : `<strong>Sobre o CNPJ dos contratados:</strong> ${fmtNum(mascarados)} de ${fmtNum(contratos.length)} contratos vêm com o CNPJ mascarado na fonte.`;
    }

    el.innerHTML = top.map(ev => {
      const dt = ev.data.split("-");
      const dataBr = dt.length === 3 ? `${dt[2]}/${dt[1]}/${dt[0]}` : ev.data;
      return `<div class="tline-item tline-item--${ev.tipo}">
        <div class="tline-data">${dataBr}</div>
        <h4 class="tline-titulo">${ev.titulo}</h4>
        <p class="tline-desc">
          <span class="tline-tag tline-tag--${ev.tipo}">${ev.tag}</span>
          ${ev.desc}
        </p>
        ${ev.link ? `<a href="${ev.link}" class="btn-link" style="font-size:.82rem;">Ver detalhes →</a>` : ""}
      </div>`;
    }).join("");

    block.hidden = false;
  }

  // ============================================================
  // Triagem conservadora de concentração de dispensas por valor.
  // Valores vigentes em 2026: Decreto federal 12.807/2025, art. 75, I e II.
  // ============================================================
  function detectarFragmentacao() {
    const lista = $("fragmentacaoLista");
    const block = $("fragmentacaoBlock");
    if (!lista || !block) return;

    const pf = (window.FISCALIZA_DATA || {}).prefeitura || {};
    const LIMITES_DISPENSA_2026 = Object.freeze({
      comprasServicos: 65492.11,
      obrasEngenharia: 130984.20,
    });
    const tipoLimite = (c) => /obra|engenharia|manuten[cç][aã]o de ve[ií]culo/i.test(c.objeto || "")
      ? "obrasEngenharia"
      : "comprasServicos";
    const dispensasEmContratos = (pf.contratos || []).filter(c =>
      /dispensa/i.test(`${c.modalidade || ""} ${c.tipo || ""}`)
    );
    const dispensasEmComprasDiretas = (pf.compras_diretas || [])
      .filter(c => /dispensa/i.test(`${c.modalidade || ""} ${c.fundamento || ""}`))
      .map(c => ({
        ...c,
        contratado: c.contratado || c.fornecedor,
        data_assinatura: c.data_assinatura || c.data,
      }));
    const contratosFrag = [...dispensasEmContratos, ...dispensasEmComprasDiretas].filter(c =>
      c.data_assinatura && c.contratado &&
      String(c.data_assinatura).startsWith("2026-") &&
      (Number(c.valor) || 0) > 0 &&
      (Number(c.valor) || 0) < LIMITES_DISPENSA_2026[tipoLimite(c)]
    ).map(c => ({ ...c, tipoLimite: tipoLimite(c) }));

    // Agrupa por contratado + ano-mês
    const grupos = new Map();
    contratosFrag.forEach(c => {
      const ym = (c.data_assinatura || "").slice(0, 7); // YYYY-MM
      const k = `${(c.contratado || "").trim()}|${ym}|${c.tipoLimite}`;
      const cur = grupos.get(k) || { contratado: c.contratado, mes: ym, tipoLimite: c.tipoLimite, itens: [] };
      cur.itens.push(c);
      grupos.set(k, cur);
    });

    // Seleciona grupos para conferência. Mesmo fornecedor e mês não bastam para
    // afirmar fracionamento: ainda é necessário confirmar unidade gestora e
    // objetos de mesma natureza, conforme o art. 75, § 1º.
    const gruposConferencia = [...grupos.values()]
      .filter(g => g.itens.length >= 3)
      .map(g => ({ ...g, total: g.itens.reduce((s, c) => s + (Number(c.valor) || 0), 0) }))
      .filter(g => g.total >= LIMITES_DISPENSA_2026[g.tipoLimite])
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);

    if (!gruposConferencia.length) return;

    lista.innerHTML = gruposConferencia.map(g => {
      const ym = g.mes.split("-");
      const mesBr = ym.length === 2 ? `${ym[1]}/${ym[0]}` : g.mes;
      const limite = LIMITES_DISPENSA_2026[g.tipoLimite];
      const natureza = g.tipoLimite === "obrasEngenharia" ? "obras/engenharia" : "compras/serviços";
      const itensHtml = g.itens
        .sort((a, b) => (Number(b.valor) || 0) - (Number(a.valor) || 0))
        .map(c => `<li>
          <span>Contrato ${esc(c.numero || "s/n")}/${esc(c.ano || "")} — ${esc(cleanText((c.objeto || "").slice(0, 80)))}${(c.objeto || "").length > 80 ? "…" : ""}</span>
          <span>${fmtBRL(c.valor)}</span>
        </li>`).join("");
      return `<div class="frag-grupo">
        <div class="frag-grupo__head">
          <h4>${esc(cleanText(g.contratado))} <small>· ${mesBr} · ${g.itens.length} contratos</small></h4>
          <div class="frag-grupo__total">Soma: ${fmtBRL(g.total)}</div>
        </div>
        <ul class="frag-lista" style="list-style:none; padding:0; margin:0;">${itensHtml}</ul>
        <div class="frag-explica">
          <strong>Por que conferir:</strong> ${g.itens.length} dispensas do mesmo fornecedor
          no mesmo mês, classificadas automaticamente como ${natureza}, somam ${fmtBRL(g.total)}.
          O limite de referência de 2026 para esta categoria é ${fmtBRL(limite)} (Decreto 12.807/2025).
          Este agrupamento não prova fracionamento: o painel não confirma unidade gestora nem objetos de mesma natureza.
          Pedir por LAI: fundamentos das dispensas, termos de referência, unidade gestora e plano anual de contratações.
        </div>
      </div>`;
    }).join("");

    block.hidden = false;
  }

  // ============================================================
  // Inicia todos os blocos auto-contidos da página de Relatórios
  // ============================================================
  // O comparativo de gastos entre anos foi removido em 08/09/2026. A lista de
  // contratos vem de busca textual com cobertura declarada como parcial
  // (contratos_status_coleta = "coleta_atual_parcial_via_busca_textual") e
  // encontrava 1 contrato em 2018, 1 em 2019 e 55 em 2024 contra 159 em 2023.
  // As variacoes exibidas mediam o alcance da coleta por ano, nao decisao de
  // gasto, e o texto do bloco pedia explicacao ao poder publico por elas.
  // Comparar exercicios exige execucao orcamentaria (empenhado, liquidado e
  // pago), que e outra fonte.
  function renderPublicidade() {
    const target = $("publicidadeDados"), orgao = $("publicidadeOrgao"), periodo = $("publicidadePeriodo");
    if (!target || !orgao || !periodo) return;
    const data = (window.FISCALIZA_DATA || {})[`publicidade_${orgao.value}`];
    if (!orgao.dataset.bound) {
      orgao.addEventListener("change", renderPublicidade);
      periodo.addEventListener("change", renderPublicidade);
      orgao.dataset.bound = "true";
    }
    if (!data) {
      periodo.innerHTML = "";
      target.innerHTML = '<p>Dados desta fonte ainda não estão disponíveis. Consulte os portais da <a href="https://new.publicidadetransparente.com.br/view/municipio-de-varginha/" target="_blank" rel="noopener">Prefeitura</a> e da <a href="https://new.publicidadetransparente.com.br/view/camara-municipal-de-varginha-mg/" target="_blank" rel="noopener">Câmara</a>.</p>';
      return;
    }
    const meses = data.investimentos || [], selected = periodo.value;
    periodo.innerHTML = meses.map(item => `<option value="${esc(item.periodo)}">${esc(item.periodo.split("-").reverse().join("/"))}</option>`).join("");
    if (meses.some(item => item.periodo === selected)) periodo.value = selected;
    const item = meses.find(record => record.periodo === periodo.value);
    const source = orgao.value === "camara" ? "camara-municipal-de-varginha-mg" : "municipio-de-varginha";
    const base = `https://new.publicidadetransparente.com.br/view/${source}/`;
    const date = value => value ? new Date(value).toLocaleString("pt-BR") : "não informada";
    const money = cents => fmtBRL(cents / 100);
    let html = '';
    if (data.status !== "ok") html += '<p class="publicidade-aviso">Coleta parcial ou indisponível. Registros anteriores podem estar mantidos; confira a data de consulta de cada conjunto.</p>';
    if (item) {
      const nomesMeses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
      const ano = Number(item.periodo.slice(0, 4));
      const agora = new Date();
      const limite = ano === agora.getFullYear() ? agora.getMonth() + 1 : ano < agora.getFullYear() ? 12 : 0;
      const registros = meses.filter(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m.periodo) && Number(m.periodo.slice(0, 4)) === ano && Number(m.periodo.slice(5)) <= limite && Number.isSafeInteger(m.total_centavos));
      const mapa = new Map(registros.map(m => [Number(m.periodo.slice(5)), m]));
      const acumulado = [...mapa.values()].reduce((total, mes) => total + mes.total_centavos, 0);
      const ausentes = Array.from({ length: limite }, (_, i) => i + 1).filter(mes => !mapa.has(mes));
      const mesSelecionado = nomesMeses[Number(item.periodo.slice(5)) - 1];
      const cobertura = limite ? `jan a ${nomesMeses[limite - 1]} · ${mapa.size} de ${limite} meses com dados` : 'Ano ainda não iniciado';
      const maior = Math.max(0, ...item.meios.map(meio => meio.valor_centavos));
      const linhas = [...item.meios].sort((a, b) => b.valor_centavos - a.valor_centavos).map(meio => {
        const largura = maior > 0 ? Math.max(0, Math.min(100, (meio.valor_centavos / maior) * 100)) : 0;
        return `<tr><th scope="row"><span class="publicidade-meio">${esc(meio.meio)}</span><span class="publicidade-barra" aria-hidden="true"><span style="width:${largura.toFixed(2)}%"></span></span></th><td>${money(meio.valor_centavos)}</td></tr>`;
      }).join("");
      html += `<div class="publicidade-resumo"><article class="publicidade-cartao publicidade-cartao--mes"><span class="publicidade-cartao__rotulo">No mês · ${esc(mesSelecionado)}/${ano}</span><strong>${money(item.total_centavos)}</strong><span>Investimento declarado</span></article><article class="publicidade-cartao publicidade-cartao--ano" data-publicidade-acumulado><span class="publicidade-cartao__rotulo">Acumulado do ano · ${ano}</span><strong>${mapa.size ? money(acumulado) : 'Não disponível'}</strong><span>${esc(cobertura)}</span></article></div>`;
      const notaCobertura = !limite ? 'Ainda não há meses deste ano a acumular.' : ausentes.length
        ? `Sem dados confirmados para ${ausentes.map(mes => nomesMeses[mes - 1]).join(', ')}; esses meses não foram tratados como zero.`
        : ano === agora.getFullYear() ? 'O acumulado inclui o mês atual quando informado, que pode estar incompleto.' : 'O acumulado soma os meses do ano com dados confirmados.';
      html += `<div class="publicidade-cobertura"><div class="publicidade-cobertura__cabecalho"><strong>Meses incluídos em ${ano}</strong><span>${esc(cobertura)}</span></div><div class="publicidade-meses" aria-hidden="true">${nomesMeses.map((nome, i) => `<span class="${i + 1 > limite ? 'publicidade-mes--futuro' : mapa.has(i + 1) ? 'publicidade-mes--disponivel' : 'publicidade-mes--ausente'}">${nome}</span>`).join("")}</div><p>${esc(notaCobertura)}</p></div>`;
      html += `<div class="publicidade-detalhe"><div class="publicidade-detalhe__cabecalho"><div><h4>Distribuição por meio</h4><p>Valores declarados em ${esc(mesSelecionado)}/${ano}</p></div><span>Consulta: ${esc(date(item.consultado_em))}</span></div><div class="table-wrap"><table class="publicidade-tabela"><caption class="publicidade-sr-only">Investimentos declarados por meio · ${esc(periodo.value)}</caption><thead><tr><th scope="col">Meio</th><th scope="col">Valor declarado</th></tr></thead><tbody>${linhas}</tbody><tfoot><tr><th scope="row">Total do mês</th><td>${money(item.total_centavos)}</td></tr></tfoot></table></div></div>`;
    } else html += '<p>Nenhum período com valores conferidos está disponível. Isso não significa ausência de investimento.</p>';
    html += `<p class="publicidade-fonte"><a href="${base}investimentos/" target="_blank" rel="noopener">Conferir investimentos na fonte</a> · Selecione o mesmo mês no portal.</p>`;
    html += '<div class="publicidade-cadastros"><h4>Mais informações na fonte</h4>';
    for (const [key, label] of [["veiculos", "Veículos de comunicação"], ["fornecedores", "Fornecedores de serviços complementares"], ["sessao-publica", "Sessões públicas"]]) {
      const cadastro = data.cadastros?.[key];
      if (!cadastro) {
        html += `<p>${label}: consulta indisponível; ausência de registros não confirmada. <a href="${base}${key}/" target="_blank" rel="noopener">Consultar na fonte</a>.</p>`;
        continue;
      }
      const registros = cadastro?.registros || [];
      html += `<details><summary>${label} <span>${registros.length} registros</span></summary><p><a href="${base}${key}/" target="_blank" rel="noopener">Abrir cadastro na fonte</a> · Consulta: ${esc(date(cadastro?.consultado_em))}. Cadastro não comprova contratação.</p><ul>${registros.map(row => `<li>${key === "sessao-publica" ? `${esc(row.data_hora)} · ${esc(row.objeto)} · ${esc(row.situacao)}` : `${esc(row.nome)}${row.razao_social ? ` · ${esc(row.razao_social)}` : ""}${row.cnpj ? ` · ${esc(row.cnpj)}` : ""} · ${esc(row.categoria)} · ${esc(row.situacao)}`}</li>`).join("")}</ul></details>`;
    }
    html += '</div>';
    target.innerHTML = html;
  }
  window.addEventListener("fiscaliza:chunk", event => {
    if (event.detail?.key?.startsWith("publicidade_")) renderPublicidade();
  });
  window.addEventListener("fiscaliza:chunk:error", event => {
    if (event.detail?.key?.startsWith("publicidade_")) renderPublicidade();
  });

  function renderTodos() {
    renderPublicidade();
    renderTimelineSinais();
    detectarFragmentacao();
  }

  window.FISCALIZA.relatorios = Object.freeze({
    renderTimelineSinais,
    detectarFragmentacao,
    renderTodos,
  });
})();
