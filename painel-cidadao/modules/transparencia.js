/* Cobertura pública, proveniência e ciclo das compras. */
(function () {
  "use strict";
  window.FISCALIZA = window.FISCALIZA || {};

  const u = window.FISCALIZA.utils;
  const esc = u ? u.esc : (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[c]);
  const fmtNum = u ? u.fmtNum : (value) => Number(value || 0).toLocaleString("pt-BR");

  const LINKS = Object.freeze({
    prefeitura: "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==",
    camara: "https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==",
    sapl: "https://sapl.varginha.mg.leg.br/",
    pncp: "https://pncp.gov.br/",
    diariasPrefeitura: "https://transparencia.varginha.mg.gov.br/portal-transparencia/consultas/diarias",
  });

  function statusFonte(domains, ids) {
    const ordem = { failed: 0, stale: 1, preserved: 2, partial: 3, manual: 4, unknown: 5, ok: 6 };
    const itens = ids.map((id) => domains[id]).filter(Boolean);
    if (!itens.length) return { status: "unknown", label: "Não medido", reason: "Sem indicador automático para esta fonte." };
    return itens.sort((a, b) => (ordem[a.status] ?? 5) - (ordem[b.status] ?? 5))[0];
  }

  function rotuloStatus(status) {
    return ({
      ok: "Atualizada", partial: "Parcial", preserved: "Base preservada", manual: "Verificação manual",
      stale: "Defasada", failed: "Falha", unknown: "Não medido",
    })[status] || "Não medido";
  }

  function dataStatus(status) {
    const cls = ["ok", "partial", "preserved", "manual", "stale", "failed"].includes(status) ? status : "unknown";
    return `<span class="coverage-status coverage-status--${cls}">${esc(rotuloStatus(status))}</span>`;
  }

  function modalidadeDireta(item) {
    return /dispensa|inexigibilidade/i.test(`${item?.modalidade || ""} ${item?.tipo || ""} ${item?.fundamento || ""}`);
  }

  function renderCobertura() {
    const tbody = document.getElementById("matrizCoberturaDados");
    if (!tbody) return;
    const D = window.FISCALIZA_DATA || {};
    const pf = D.prefeitura || {};
    const cb = D.camara_betha || {};
    const diarias = D.diarias || {};
    const contexto = D.chat_context || {};
    const resumoHome = D.home_resumo || {};
    const domains = (D.status_fontes || {}).domains || {};
    const contratosPref = pf.contratos || [];
    const contratosCam = cb.contratos || [];
    const licitacoesPref = [...(pf.licit_andamento || []), ...(pf.licit_finalizadas || [])];
    const diretasPref = [...licitacoesPref.filter(modalidadeDireta), ...(pf.compras_diretas || []).filter(modalidadeDireta)];
    const diariasPref = diarias.prefeitura || [];
    const diariasCam = diarias.camara || [];
    const incompletasPref = diariasPref.filter((d) => !d.destino || !(d.finalidade || d.historico)).length;
    const incompletasCam = diariasCam.filter((d) => !d.destino || !(d.finalidade || d.historico)).length;
    const semModalidadePref = contratosPref.filter((c) => !String(c.modalidade || "").trim()).length;
    const semModalidadeCam = contratosCam.filter((c) => !String(c.modalidade || "").trim()).length;
    const emendas = Array.isArray(D.emendas) ? D.emendas : [];
    const contratosPrefQtd = contratosPref.length || contexto.prefeitura?.contratos_total || resumoHome.contratos_total_qtd || 0;
    const contratosCamQtd = contratosCam.length || contexto.camara?.contratos_total || 0;
    const diariasPrefQtd = diariasPref.length || contexto.diarias?.prefeitura?.registros || 0;
    const diariasCamQtd = diariasCam.length || contexto.diarias?.camara?.registros || 0;
    const emendasQtd = emendas.length || contexto.legislativo?.emendas || 0;
    const licitacoesQtd = licitacoesPref.length || resumoHome.licitacoes_qtd || 0;
    const detalheModalidadePref = contratosPref.length ? `${fmtNum(semModalidadePref)} sem modalidade` : "limitação detalhada na auditoria";
    const detalheModalidadeCam = contratosCam.length ? `${fmtNum(semModalidadeCam)} sem modalidade` : "limitação detalhada na auditoria";
    const detalheDiariaPref = diariasPref.length ? `${fmtNum(incompletasPref)} sem destino ou finalidade` : "campos ausentes detalhados na auditoria";
    const detalheDiariaCam = diariasCam.length ? `${fmtNum(incompletasCam)} sem destino ou finalidade` : "campos ausentes detalhados na auditoria";

    const linhas = [
      {
        tema: "Licitações", pref: `${fmtNum(licitacoesQtd)} processos no resumo carregado`, cam: "Não consolidado no feed contratual",
        pStatus: statusFonte(domains, ["prefeitura", "pncp"]), cStatus: statusFonte(domains, ["camara_betha"]),
        limite: "Quantidade não representa necessariamente a totalidade publicada pelo órgão.", pLink: LINKS.prefeitura, cLink: LINKS.camara,
      },
      {
        tema: "Dispensas e inexigibilidades", pref: diretasPref.length ? `${fmtNum(diretasPref.length)} registros identificados pela modalidade` : "Classificação disponível nos painéis de compras", cam: "Modalidade não informada nos contratos coletados",
        pStatus: statusFonte(domains, ["prefeitura", "pncp"]), cStatus: statusFonte(domains, ["camara_betha"]),
        limite: "Só classifica compra direta quando a fonte informa dispensa ou inexigibilidade; ausência não é inferida.", pLink: LINKS.pncp, cLink: LINKS.camara,
      },
      {
        tema: "Contratos e aditivos", pref: `${fmtNum(contratosPrefQtd)} contratos; ${detalheModalidadePref}`, cam: `${fmtNum(contratosCamQtd)} contratos; ${detalheModalidadeCam}`,
        pStatus: statusFonte(domains, ["prefeitura"]), cStatus: statusFonte(domains, ["camara_betha"]),
        limite: "Contrato, licitação e aditivo ainda não possuem chave única comum em todos os registros.", pLink: LINKS.prefeitura, cLink: LINKS.camara,
      },
      {
        tema: "Empenhos e pagamentos", pref: `${fmtNum(pf.credores_qtd || contexto.prefeitura?.credores_mapeados || 0)} credores/registros agregados`, cam: `${fmtNum(cb.empenhos_qtd || 0)} empenhos no conjunto`,
        pStatus: statusFonte(domains, ["prefeitura"]), cStatus: statusFonte(domains, ["camara_betha"]),
        limite: "O vínculo automático com contrato não existe para todos os pagamentos; a ausência de vínculo não prova ausência de processo.", pLink: LINKS.prefeitura, cLink: LINKS.camara,
      },
      {
        tema: "Diárias", pref: `${fmtNum(diariasPrefQtd)} registros; ${detalheDiariaPref}`, cam: `${fmtNum(diariasCamQtd)} registros; ${detalheDiariaCam}`,
        pStatus: statusFonte(domains, ["prefeitura"]), cStatus: statusFonte(domains, ["camara_betha"]),
        limite: "Campos não publicados são exibidos como não informados; o painel não completa finalidade ou destino por suposição.", pLink: LINKS.diariasPrefeitura, cLink: LINKS.camara,
      },
      {
        tema: "Emendas", pref: "Execução cruzada quando CNPJ e pagamento permitem", cam: `${fmtNum(emendasQtd)} emendas legislativas no conjunto municipal`,
        pStatus: statusFonte(domains, ["prefeitura"]), cStatus: statusFonte(domains, ["camara_anos", "publicacoes_estruturadas"]),
        limite: "Sem CNPJ, empenho ou pagamento compatível, o resultado permanece como não localizado.", pLink: LINKS.prefeitura, cLink: LINKS.sapl,
      },
    ];

    tbody.innerHTML = linhas.map((linha) => `<tr>
      <th scope="row">${esc(linha.tema)}</th>
      <td>${dataStatus(linha.pStatus.status)}<p>${esc(linha.pref)}</p><a href="${esc(linha.pLink)}" target="_blank" rel="noopener">Fonte da Prefeitura</a></td>
      <td>${dataStatus(linha.cStatus.status)}<p>${esc(linha.cam)}</p><a href="${esc(linha.cLink)}" target="_blank" rel="noopener">Fonte da Câmara</a></td>
      <td>${esc(linha.limite)}</td>
    </tr>`).join("");
  }

  function renderCicloCompras() {
    const alvo = document.getElementById("cicloComprasDados");
    if (!alvo) return;
    const D = window.FISCALIZA_DATA || {};
    const pf = D.prefeitura || {};
    const cb = D.camara_betha || {};
    const pca = D.pca || {};
    const contexto = D.chat_context || {};
    const resumoHome = D.home_resumo || {};
    const etapas = [
      { nome: "Planejamento", pref: (pca.itens || []).length || null, cam: null, detalhe: "Plano de Contratações Anual; contagem não carregada nesta página leve" },
      { nome: "Seleção", pref: (pf.licit_andamento || []).length + (pf.licit_finalizadas || []).length || resumoHome.licitacoes_qtd || null, cam: null, detalhe: "licitação, dispensa ou inexigibilidade quando informada" },
      { nome: "Contrato", pref: (pf.contratos || []).length || contexto.prefeitura?.contratos_total || resumoHome.contratos_total_qtd || 0, cam: (cb.contratos || []).length || contexto.camara?.contratos_total || 0, detalhe: "instrumentos contratuais coletados" },
      { nome: "Execução financeira", pref: pf.credores_qtd || contexto.prefeitura?.credores_mapeados || 0, cam: cb.empenhos_qtd || 0, detalhe: "registros financeiros agregados; vínculo contratual pode faltar" },
      { nome: "Aditivos e entrega", pref: null, cam: null, detalhe: "sem chave única completa; conferir processo e fiscalização na fonte" },
    ];
    alvo.innerHTML = etapas.map((e, i) => `<article class="purchase-stage">
      <span class="purchase-stage__index">${i + 1}</span>
      <div><h3>${esc(e.nome)}</h3><p>${esc(e.detalhe)}</p>
      <dl><div><dt>Prefeitura</dt><dd>${e.pref == null ? "não consolidado" : fmtNum(e.pref)}</dd></div><div><dt>Câmara</dt><dd>${e.cam == null ? "não consolidado" : fmtNum(e.cam)}</dd></div></dl></div>
    </article>`).join("");
  }

  function renderProveniencia() {
    const alvo = document.getElementById("provenienciaAtualizacao");
    if (!alvo) return;
    const D = window.FISCALIZA_DATA || {};
    const atualizado = D.atualizado_em || {};
    const status = D.status_fontes || {};
    const data = atualizado.data_humana || atualizado.atualizado_em || status.gerado_em || "não informada";
    alvo.textContent = `Última referência carregada: ${data}. Cada situação de cobertura acima vem do status técnico das fontes; bases parciais ou preservadas não são tratadas como completas.`;
  }

  function renderTodos() {
    renderCobertura();
    renderCicloCompras();
    renderProveniencia();
  }

  window.FISCALIZA.transparencia = Object.freeze({ renderTodos, renderCobertura, renderCicloCompras });
  window.addEventListener("fiscaliza:ready", renderTodos, { once: true });
  if (window.FISCALIZA_DATA) queueMicrotask(renderTodos);
})();
