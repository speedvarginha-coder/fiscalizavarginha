/* Fiscaliza Varginha — modules/dossie.js
 *
 * Modal/dialog de fiscalização cidadã + geração de relatório TXT.
 * Templates de:
 *   - Emenda impositiva (cruzamento CNPJ Câmara × Prefeitura)
 *   - Diária de viagem (Prefeitura ou Câmara)
 *   - Contrato (conferência de procedência na fonte oficial)
 *   - Relatório TXT de contrato (download)
 *
 * Disponível em window.ZELA.dossie.
 * Dependências: window.ZELA.utils (esc, fmtBRL, fmtNum).
 *
 * Carregado pelo data-loader.js (depois de utils.js, antes de app.js).
 */
(function () {
  "use strict";
  window.ZELA = window.ZELA || {};

  const u = window.ZELA.utils;
  if (!u) {
    console.error("[dossie] window.ZELA.utils ausente. Carregue modules/utils.js primeiro.");
    return;
  }
  const esc = u.esc, fmtBRL = u.fmtBRL, fmtNum = u.fmtNum, norm = u.norm;

  const CHECK_STORE = "zela.dossie.checklist.v1";
  function readChecklistStore() {
    try { return JSON.parse(localStorage.getItem(CHECK_STORE) || "{}") || {}; }
    catch (_) { return {}; }
  }
  function writeChecklistStore(store) {
    try { localStorage.setItem(CHECK_STORE, JSON.stringify(store || {})); }
    catch (_) {}
  }
  function stableId(parts) {
    return norm((parts || []).filter(Boolean).join("|")).replace(/[^a-z0-9]+/g, "-").slice(0, 90) || "item";
  }
  function entenderHtml(cfg) {
    return `<section class="citizen-explain">
      <div class="citizen-explain__head">
        <span>Entender este dado</span>
        <strong>${esc(cfg.titulo || "Dado publico")}</strong>
      </div>
      <div class="citizen-explain__grid">
        <article><b>O que significa</b><span>${esc(cfg.significa || "")}</span></article>
        <article><b>O que nao significa</b><span>${esc(cfg.naoSignifica || "")}</span></article>
        <article><b>Documento que confirma</b><span>${esc(cfg.confirma || "")}</span></article>
        <article><b>Fonte usada</b><span>${esc(cfg.fonte || "")}</span></article>
      </div>
    </section>`;
  }
  function checklistHtml(id, itens) {
    return `<section class="citizen-checklist" data-dossie-checklist="${esc(id)}">
      <div class="citizen-checklist__head">
        <span>Checklist cidadão</span>
        <strong>Marque o que você já conferiu</strong>
      </div>
      <div class="citizen-checklist__items">
        ${(itens || []).map((item, idx) => `
          <label>
            <input type="checkbox" data-check-idx="${idx}">
            <span>${esc(item)}</span>
          </label>`).join("")}
      </div>
      <small>Salvo apenas neste navegador. Serve para organizar sua fiscalizacao, nao altera os dados oficiais.</small>
    </section>`;
  }
  function initChecklist(content) {
    const store = readChecklistStore();
    content.querySelectorAll("[data-dossie-checklist]").forEach(section => {
      const id = section.dataset.dossieChecklist;
      const state = store[id] || {};
      section.querySelectorAll("[data-check-idx]").forEach(input => {
        input.checked = !!state[input.dataset.checkIdx];
        input.addEventListener("change", () => {
          const next = readChecklistStore();
          next[id] = next[id] || {};
          next[id][input.dataset.checkIdx] = input.checked;
          writeChecklistStore(next);
        });
      });
    });
  }

  // ============================================================
  // MODAL — cria <dialog> reusável uma única vez
  // ============================================================
  function criarModal() {
    let modal = document.getElementById("modalFiscaliza");
    if (modal) return modal;

    modal = document.createElement("dialog");
    modal.id = "modalFiscaliza";
    modal.className = "modal modal--wide";
    modal.innerHTML =
      '<button class="modal__close" type="button" aria-label="Fechar">&times;</button>' +
      '<div id="modalFiscalizaContent"></div>';
    modal.querySelector(".modal__close").addEventListener("click", () => modal.close());
    document.body.appendChild(modal);
    return modal;
  }

  function abrirComHtml(html) {
    const modal = criarModal();
    const content = modal.querySelector("#modalFiscalizaContent");
    content.innerHTML = html;
    initChecklist(content);
    if (typeof modal.showModal === "function") modal.showModal();
    else modal.setAttribute("open", "");
  }

  // ============================================================
  // HELPERS — Fonte oficial / busca de contrato
  // ============================================================
  function digits(s) {
    return String(s || "").replace(/[^\d]/g, "");
  }

  function bethaContratoUrl(orgao) {
    return orgao === "Câmara"
      ? "https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324812"
      : "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043";
  }

  function portalContratoUrl(orgao) {
    return orgao === "Câmara"
      ? "https://www.varginha.mg.leg.br/transparencia"
      : "https://transparencia.varginha.mg.gov.br/portal-transparencia/consultas/contratos";
  }

  function pncpUrl(c) {
    const cnpj = digits(c.cnpj);
    const q = cnpj.length >= 8
      ? cnpj
      : [c.contratado, c.numero, c.ano, "Varginha"].filter(Boolean).join(" ");
    return "https://pncp.gov.br/app/contratos?q=" + encodeURIComponent(q);
  }

  function contratoBuscaTexto(c) {
    return [
      c.numero && c.ano ? `Contrato ${c.numero}/${c.ano}` : "",
      c.contratado || "",
      c.cnpj || "",
    ].filter(Boolean).join(" | ");
  }

  // ============================================================
  // TEMPLATE — Contrato (procedência e conferência)
  // ============================================================
  // params: { contrato, audit, baseLegal, orgao }
  function templateContrato(params) {
    const c = params.contrato || {};
    const audit = params.audit || { nivel: "ok", score: 100, achados: [] };
    const baseLegal = params.baseLegal || [];
    const orgao = params.orgao || "Prefeitura";
    const busca = contratoBuscaTexto(c);
    const numero = c.numero && c.ano ? `${c.numero}/${c.ano}` : (c.numero || "não informado");
    const cnpj = c.cnpj || "não informado";
    const dataIni = c.data_assinatura ? String(c.data_assinatura).split("-").reverse().join("/") : "não informada";
    const dataFim = c.data_fim ? String(c.data_fim).split("-").reverse().join("/") : "não informada";
    const betha = bethaContratoUrl(orgao);
    const portal = portalContratoUrl(orgao);
    const pncp = pncpUrl(c);
    const canDownloadTxt = orgao === "Prefeitura" && Number.isInteger(Number(c.__idx));
    const checklistId = stableId(["contrato", orgao, numero, c.cnpj, c.contratado]);

    const pergunta =
      `Solicito cópia integral do processo administrativo referente ao contrato ${numero}, ` +
      `firmado com ${c.contratado || "contratado não informado"}${c.cnpj ? " (" + c.cnpj + ")" : ""}, ` +
      `no valor de ${fmtBRL(c.valor || 0)}, incluindo contrato assinado, anexos, termo de referência, ` +
      `edital ou ato de contratação direta, proposta vencedora, pesquisa de preços, parecer jurídico, ` +
      `empenhos, liquidações, notas fiscais, comprovantes de pagamento, aditivos e relatório do fiscal do contrato.`;

    const achadosHtml = audit.achados && audit.achados.length
      ? audit.achados.map(a => `
        <div class="dossier-item">
          <strong>${esc(a.titulo)}</strong>
          <span>${esc(a.base || "")}</span>
          <p>${esc(a.detalhe || a.pedido || "")}</p>
        </div>`).join("")
      : '<p class="dossier-ok">Nenhum alerta automático nos dados carregados.</p>';

    const baseLegalHtml = baseLegal.length
      ? `<ul class="dossier-checklist">${baseLegal.slice(0, 5).map(b => `<li><strong>${esc(b.lei)}</strong>: ${esc(b.uso)}</li>`).join("")}</ul>`
      : '<p class="muted">Base legal não carregada.</p>';

    return `
      <p class="label">CONFERÊNCIA DE PROCEDÊNCIA</p>
      <h3>Contrato ${esc(numero)} — ${esc(c.contratado || "Contratado não informado")}</h3>
      ${entenderHtml({
        titulo: "Contrato público",
        significa: "Mostra uma obrigação contratada pelo poder público, com fornecedor, objeto, valor e vigência.",
        naoSignifica: "Não prova sozinho que o serviço foi entregue, que tudo foi pago ou que o preço está correto.",
        confirma: "Contrato integral, termo de referência, empenho, liquidação, nota fiscal e relatório do fiscal.",
        fonte: `Portal/Betha de ${orgao} e, quando existir, PNCP.`,
      })}
      ${checklistHtml(checklistId, [
        "Li o objeto e entendi o que foi contratado",
        "Abri a fonte oficial/Betha e conferi o número",
        "Conferi vigência, valor e modalidade",
        "Procurei empenho, liquidação e nota fiscal",
        "Procurei fiscal do contrato e comprovação da entrega",
        "Copiei ou enviei a pergunta pronta via LAI/e-SIC",
      ])}
      <div class="dossier-grid">
        <section>
          <h4>1. Dados carregados no painel</h4>
          <table>
            <tr><td>Órgão</td><td>${esc(orgao)}</td></tr>
            <tr><td>Contrato</td><td>${esc(numero)}</td></tr>
            <tr><td>Contratado</td><td>${esc(c.contratado || "não informado")}</td></tr>
            <tr><td>CNPJ</td><td>${esc(cnpj)}</td></tr>
            <tr><td>Valor</td><td>${fmtBRL(c.valor || 0)}</td></tr>
            <tr><td>Modalidade</td><td>${esc(c.modalidade || "não informada")}</td></tr>
            <tr><td>Vigência</td><td>${esc(dataIni)} até ${esc(dataFim)}</td></tr>
            ${c.entidade ? `<tr><td>Secretaria/órgão</td><td>${esc(c.entidade)}</td></tr>` : ""}
          </table>
          <p class="dossier-text">${esc(c.objeto || "Objeto não informado")}</p>
        </section>
        <section>
          <h4>2. Como conferir na fonte</h4>
          <p class="dossier-text">Copie um dos termos abaixo e pesquise na tabela oficial. Se o número não aparecer, pesquise pelo CNPJ ou nome da empresa.</p>
          <div class="source-search">
            <code>${esc(busca || numero)}</code>
            <button type="button" class="btn-dossie" onclick="navigator.clipboard && navigator.clipboard.writeText(this.previousElementSibling.textContent)">Copiar busca</button>
          </div>
          <div class="source-actions">
            <a class="btn-link" href="${esc(betha)}" target="_blank" rel="noopener">Abrir tabela Betha</a>
            <a class="btn-link" href="${esc(portal)}" target="_blank" rel="noopener">Abrir portal oficial</a>
            <a class="btn-link" href="${esc(pncp)}" target="_blank" rel="noopener">Buscar no PNCP</a>
          </div>
          <p class="muted small">O painel facilita a busca, mas a confirmação final deve ser feita na fonte primária.</p>
        </section>
        <section>
          <h4>3. Triagem automática</h4>
          <p><strong>Índice documental:</strong> ${esc(audit.nivel || "ok")} · ${fmtNum(audit.score || 0)}/100</p>
          ${achadosHtml}
        </section>
        <section>
          <h4>4. Base legal para pedir documentos</h4>
          ${baseLegalHtml}
        </section>
      </div>
      <section class="dossier-lai">
        <h4>5. Pedido pronto para LAI/e-SIC</h4>
        <textarea readonly>${esc(pergunta)}</textarea>
        <div class="diaria-actions">
          <button type="button" class="btn-dossie" onclick="navigator.clipboard && navigator.clipboard.writeText(this.closest('.dossier-lai').querySelector('textarea').value)">Copiar pergunta</button>
          ${canDownloadTxt ? `<button type="button" class="btn-dossie" onclick="ZELA.gerarDossie && ZELA.gerarDossie(${Number(c.__idx)})">Baixar relatório TXT</button>` : ""}
        </div>
      </section>
      <p class="muted">Procedência significa conferir se o registro do painel bate com a fonte oficial. Não é conclusão automática sobre legalidade.</p>`;
  }

  // ============================================================
  // TEMPLATE — Dossiê de Emenda (cruzamento CNPJ)
  // ============================================================
  // params: { emenda, cruz, contratos, cnpjInfo }
  function templateEmenda(params) {
    const e = params.emenda;
    const c = params.cruz || {};
    const contratos = params.contratos || [];
    const cnpjInfo = params.cnpjInfo;
    const checklistId = stableId(["emenda", e.numero, e.ano, e.autor, e.cnpj, e.beneficiario]);

    const pergunta =
      "Solicito cópia integral do processo administrativo, empenhos, " +
      "notas fiscais, liquidações, comprovantes de pagamento e relatório " +
      "de execução referentes à emenda nº " + (e.numero || "?") + "/" +
      (e.ano || "?") + ", de autoria de " +
      (e.autor || "vereador(a)") + ", destinada ao CNPJ " +
      (e.cnpj || "não informado") + ", no valor de " +
      fmtBRL(e.valor_brl || 0) +
      ", incluindo justificativa do objeto, local de aplicação e etapa " +
      "atual de execução.";

    let pagamentoBlock;
    if (c.status === "encontrado") {
      const ratio = e.valor_brl ? Math.round(((c.valor_pago_total || 0) / e.valor_brl) * 100) : 0;
      pagamentoBlock = `
        <p class="dossier-ok">Pagamento encontrado para o CNPJ.</p>
        <table>
          <tr><td>Total pago localizado</td><td>${fmtBRL(c.valor_pago_total || 0)}</td></tr>
          <tr><td>Relação com a emenda</td><td>${ratio}%</td></tr>
        </table>`;
    } else if (c.status === "execucao_direta") {
      pagamentoBlock =
        '<p class="dossier-info" style="color:#004d40; background:#e0f2f1; padding:8px 12px; border-radius:4px; margin-bottom:8px; font-size:0.85rem;">' +
        '<strong>Execução Direta (Prefeitura):</strong> Destinada a um órgão, secretaria, escola ou UPA municipal (CNPJ da Prefeitura). ' +
        'Os pagamentos de execução ocorrem internamente ou via contratos de compras/serviços da respectiva secretaria.</p>';
    } else if (c.status === "sem_pagamento") {
      pagamentoBlock =
        '<p class="dossier-warn">Não localizamos pagamento da Prefeitura para este CNPJ nos dados carregados.</p>';
    } else {
      pagamentoBlock =
        '<p class="dossier-warn">Sem CNPJ suficiente para cruzamento automático.</p>';
    }

    const contratosBlock = contratos.length
      ? contratos.map(ct => `
        <div class="dossier-item">
          <strong>${fmtBRL(ct.valor || 0)} · ${esc(ct.contratado || "Contratado")}</strong>
          <span>${esc(ct.modalidade || "modalidade não informada")} · contrato ${esc(ct.numero || "s/n")}/${esc(ct.ano || "")}</span>
          <p>${esc(ct.objeto || "Objeto não informado")}</p>
        </div>`).join("")
      : '<p class="muted">Nenhum contrato do mesmo CNPJ/raiz foi localizado nos dados carregados.</p>';

    const cadastralBlock = cnpjInfo
      ? `<table>
          <tr><td>Razão social</td><td>${esc(cnpjInfo.razao_social || "")}</td></tr>
          <tr><td>Situação</td><td>${esc(cnpjInfo.situacao || "não informada")}</td></tr>
          <tr><td>Abertura</td><td>${esc(cnpjInfo.abertura || "não informada")}</td></tr>
          <tr><td>Município/UF</td><td>${esc([cnpjInfo.municipio, cnpjInfo.uf].filter(Boolean).join("/") || "não informado")}</td></tr>
        </table>`
      : '<p class="muted">CNPJ ainda não consultado na base cadastral auxiliar.</p>';

    return `
      <p class="label">DOSSIÊ DE FISCALIZAÇÃO</p>
      <h3>${esc(e.beneficiario || "Beneficiário não identificado")}</h3>
      ${entenderHtml({
        titulo: "Emenda impositiva",
        significa: "Mostra uma indicação de recurso feita por vereador para uma entidade, órgão ou finalidade.",
        naoSignifica: "Não prova sozinho que o dinheiro foi pago, que a obra/serviço foi executado ou que houve irregularidade.",
        confirma: "Empenho, liquidação, pagamento, plano de trabalho, nota fiscal, relatório de execução e prestação de contas.",
        fonte: "Documentos da Câmara, Prefeitura, pagamentos municipais e bases auxiliares de CNPJ.",
      })}
      ${checklistHtml(checklistId, [
        "Entendi quem indicou a emenda e quem recebeu",
        "Conferi se existe CNPJ ou órgão responsável",
        "Procurei empenho, liquidação e pagamento",
        "Conferi se o objeto combina com a finalidade pública",
        "Procurei relatório, foto, nota fiscal ou prestação de contas",
        "Copiei a pergunta pronta para pedir documentos oficiais",
      ])}
      <div class="dossier-grid">
        <section>
          <h4>1. Emenda indicada</h4>
          <table>
            <tr><td>Vereador(a)</td><td>${esc(e.autor)}</td></tr>
            <tr><td>Emenda</td><td>${esc(e.numero)}/${esc(e.ano)}</td></tr>
            <tr><td>Valor</td><td>${fmtBRL(e.valor_brl || 0)}</td></tr>
            <tr><td>CNPJ</td><td>${esc(e.cnpj || "não informado")}</td></tr>
          </table>
          ${e.objeto ? `<p class="dossier-text">${esc(e.objeto)}</p>` : ""}
          ${e.pdf ? `<p><a href="${esc(e.pdf)}" target="_blank" rel="noopener">Abrir PDF oficial da emenda →</a></p>` : ""}
        </section>
        <section>
          <h4>2. Pagamento localizado</h4>
          ${pagamentoBlock}
        </section>
        <section>
          <h4>3. Contratos do mesmo CNPJ/raiz</h4>
          ${contratosBlock}
        </section>
        <section>
          <h4>4. Situação cadastral</h4>
          ${cadastralBlock}
        </section>
      </div>
      <section class="dossier-lai">
        <h4>5. Pergunta pronta para LAI/e-SIC</h4>
        <textarea readonly>${esc(pergunta)}</textarea>
        <div class="diaria-actions">
          <button type="button" class="btn-dossie" onclick="navigator.clipboard && navigator.clipboard.writeText(this.closest('.dossier-lai').querySelector('textarea').value)">Copiar pergunta</button>
        </div>
      </section>
      <p class="muted">Este dossiê é uma triagem. Não é acusação: confira as fontes oficiais antes de qualquer denúncia.</p>`;
  }

  // ============================================================
  // TEMPLATE — Dossiê de Diária (Prefeitura ou Câmara)
  // ============================================================
  // params: { diaria, prefix ('Prefeitura'|'Camara'), fonte (url) }
  function templateDiaria(params) {
    const d = params.diaria;
    const prefix = params.prefix;
    const fonte = params.fonte;

    const isPrefeitura = prefix === "Prefeitura";
    const qtdLabel = isPrefeitura ? "registro/empenho" : "diaria";
    const periodo = d.data_inicial
      ? `${d.data_inicial.split("-").reverse().join("/")}${d.data_final && d.data_final !== d.data_inicial ? " a " + d.data_final.split("-").reverse().join("/") : ""}`
      : "não informado";
    const setor = isPrefeitura
      ? (d.secretaria || d.unidade || "não informado")
      : (d.cargo || d.secretaria || "não informado");
    const checklistId = stableId(["diaria", prefix, d.funcionario, d.numero, periodo, d.valor_total]);

    const pergunta = isPrefeitura
      ? `Solicito cópia integral do processo administrativo, empenho, liquidação, comprovante de pagamento, ordem de pagamento, justificativa, autorização e documentos que expliquem a despesa classificada como diária em nome de ${d.funcionario || "servidor/credor não informado"}, no valor de ${fmtBRL(d.valor_total || 0)}, vinculada a ${setor}, período ${periodo}, incluindo finalidade, destino quando houver, quantidade de diárias se aplicável e relatório de resultado/necessidade pública.`
      : `Solicito cópia integral da solicitação, autorização, ato de concessão, roteiro/destino, motivo da viagem, comprovantes, relatório de viagem, certificado/participação quando houver e prestação de contas da diária paga a ${d.funcionario || "servidor/vereador não informado"}, cargo ${setor}, no valor de ${fmtBRL(d.valor_total || 0)}, quantidade ${fmtNum(d.quantidade || 0)}, período ${periodo}, informando qual benefício concreto a atividade trouxe para Varginha.`;

    return `
      <p class="label">ROTEIRO DE FISCALIZAÇÃO</p>
      <h3>${isPrefeitura ? "Despesa/empenho de diária — Prefeitura" : "Diária de viagem — Câmara"}</h3>
      ${entenderHtml({
        titulo: isPrefeitura ? "Despesa classificada como diária" : "Diária de viagem",
        significa: isPrefeitura
          ? "Mostra despesa contábil ligada a diárias, adiantamento ou indenização de deslocamento."
          : "Mostra verba para custear viagem oficial de servidor ou vereador em atividade pública.",
        naoSignifica: "Não é salário e não prova, sozinho, que a viagem ocorreu corretamente ou que trouxe resultado para a cidade.",
        confirma: "Autorização, destino, motivo, comprovantes, relatório de viagem, certificado e prestação de contas.",
        fonte: fonte ? `Fonte oficial de ${prefix}.` : `Base carregada de ${prefix}, com fonte oficial a conferir quando disponível.`,
      })}
      ${checklistHtml(checklistId, [
        "Conferi nome, cargo/setor e valor",
        "Procurei destino, motivo e período da viagem",
        "Verifiquei se existe autorização formal",
        "Procurei comprovantes e relatório de resultado",
        "Comparei se o gasto tem utilidade pública clara",
        "Copiei a pergunta pronta para cobrar a documentação",
      ])}
      <div class="dossier-grid">
        <section>
          <h4>1. O que foi pago</h4>
          <table>
            <tr><td>Nome</td><td>${esc(d.funcionario || "não informado")}</td></tr>
            <tr><td>${isPrefeitura ? "Secretaria/unidade" : "Cargo/setor"}</td><td>${esc(setor)}</td></tr>
            <tr><td>Valor total</td><td>${fmtBRL(d.valor_total || 0)}</td></tr>
            <tr><td>${isPrefeitura ? "Registros" : "Quantidade"}</td><td>${fmtNum(d.quantidade || 0)} ${qtdLabel}(s)</td></tr>
            <tr><td>Valor unitário</td><td>${fmtBRL(d.valor_unitario || 0)}</td></tr>
            <tr><td>Período</td><td>${esc(periodo)}</td></tr>
            ${d.destino ? `<tr><td>Destino</td><td>${esc(d.destino)}</td></tr>` : ""}
            ${d.numero ? `<tr><td>Número</td><td>${esc(d.numero)}</td></tr>` : ""}
          </table>
        </section>
        <section>
          <h4>2. Como interpretar</h4>
          <p class="dossier-text">
            ${isPrefeitura
              ? "Na Prefeitura, a base carregada parece ser contábil: mostra despesas/empenhos classificados como diárias. Isso não garante, sozinho, que cada linha seja uma viagem individual."
              : "Na Câmara, diária é verba indenizatória para viagem oficial. Ela não é salário, mas precisa ter necessidade pública, autorização, destino, finalidade e prestação de contas."}
          </p>
          <ul class="dossier-checklist">
            <li>Existe autorização formal</li>
            <li>O destino e a finalidade estão claros</li>
            <li>O valor bate com a norma de diárias</li>
            <li>Houve relatório ou comprovação do resultado</li>
            <li>O gasto trouxe utilidade concreta para Varginha</li>
          </ul>
        </section>
      </div>
      <section class="dossier-lai">
        <h4>3. Pedido pronto para LAI/e-SIC</h4>
        <textarea readonly>${esc(pergunta)}</textarea>
        <div class="diaria-actions">
          <button type="button" class="btn-dossie" onclick="navigator.clipboard && navigator.clipboard.writeText(this.closest('.dossier-lai').querySelector('textarea').value)">Copiar pergunta</button>
          ${fonte ? `<a class="btn-link" href="${esc(fonte)}" target="_blank" rel="noopener">Abrir fonte oficial</a>` : ""}
          <button type="button" class="btn-dossie" onclick="ZELA.baixarPdfSecao('#modalFiscalizaContent', 'Fiscalizacao de diária')">Baixar PDF</button>
        </div>
      </section>`;
  }

  // ============================================================
  // EXPORT — Relatório TXT de contrato (download)
  // ============================================================
  // params: { contrato, audit, baseLegal }
  function gerarTxtContrato(params) {
    const c = params.contrato;
    const audit = params.audit || { nivel: "ok", score: 100, achados: [] };
    const baseLegal = params.baseLegal || [];
    const data = new Date().toLocaleDateString("pt-BR");
    const achadosTxt = audit.achados.length
      ? audit.achados.map(a => `- [${a.nivel.toUpperCase()}] ${a.titulo}\n  Base: ${a.base}\n  Por que importa: ${a.detalhe}\n  Pedido recomendado: ${a.pedido}`).join("\n")
      : "- Nenhum alerta jurídico automático nos dados carregados.";
    const baseLegalTxt = baseLegal.map(b => `- ${b.lei}: ${b.uso}`).join("\n");

    const doc = `
============================================================
       FISCALIZA VARGINHA — RELATÓRIO DE AUDITORIA CIDADÃ
       Gerado em: ${data}
============================================================

1. IDENTIFICAÇÃO DO CONTRATO
------------------------------------------------------------
CONTRATADO: ${c.contratado || "NÃO INFORMADO"}
CNPJ: ${c.cnpj || "NÃO INFORMADO"}
NÚMERO: ${c.numero}/${c.ano}
VALOR TOTAL: ${fmtBRL(c.valor)}
OBJETO: ${c.objeto || "OBJETO NÃO DESCRITO"}
VIGÊNCIA: ${c.data_assinatura} até ${c.data_fim}

2. LEITURA DE TRANSPARÊNCIA
------------------------------------------------------------
NÍVEL: ${audit.nivel.toUpperCase()}
ÍNDICE DE COMPLETUDE DOCUMENTAL: ${audit.score}/100
PONTOS DE ATENÇÃO:
${achadosTxt}

BASE LEGAL USADA:
${baseLegalTxt}

3. COMO CONFERIR
------------------------------------------------------------
- Abra a fonte oficial do contrato no Portal de Transparência.
- Confira contrato integral, anexos, Termo de Referência, proposta, empenho, liquidação, nota fiscal e relatório do fiscal.
- Compare a entrega descrita com o serviço/material efetivamente recebido.
- Em eventos, verifique se receitas privadas foram consideradas no preço público.
- Se algo não fizer sentido, use a página "Como cobrar" deste painel.
`;

    const blob = new Blob([doc], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dossie-varginha-${c.numero}-${c.ano}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ============================================================
  // API PÚBLICA
  // ============================================================
  window.ZELA.dossie = Object.freeze({
    criarModal,
    abrirComHtml,
    templateEmenda,
    templateDiaria,
    templateContrato,
    gerarTxtContrato,
  });
})();
