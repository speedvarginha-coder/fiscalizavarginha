/* Fiscaliza Varginha — modules/dossie.js
 *
 * Modal/dialog de fiscalização cidadã + geração de relatório TXT.
 * Templates de:
 *   - Emenda impositiva (cruzamento CNPJ Câmara × Prefeitura)
 *   - Diária de viagem (Prefeitura ou Câmara)
 *   - Contrato (conferência de procedência na fonte oficial)
 *   - Relatório TXT de contrato (download)
 *
 * Disponível em window.FISCALIZA.dossie.
 * Dependências: window.FISCALIZA.utils (esc, fmtBRL, fmtNum).
 *
 * Carregado pelo data-loader.js (depois de utils.js, antes de app.js).
 */
(function () {
  "use strict";
  window.FISCALIZA = window.FISCALIZA || {};

  const u = window.FISCALIZA.utils;
  if (!u) {
    console.error("[dossie] window.FISCALIZA.utils ausente. Carregue modules/utils.js primeiro.");
    return;
  }
  const esc = u.esc, fmtBRL = u.fmtBRL, fmtNum = u.fmtNum, norm = u.norm;

  let documentosConsulta, documentosBase;
  function carregarDocumentos() {
    documentosConsulta = documentosConsulta || fetch("data/chunks/contratos_documentos.json", {cache:"no-cache"})
      .then(r => { if (!r.ok) throw new Error("Consulta indisponível"); return r.json(); })
      .then(base => { if (!base || typeof base !== "object" || Array.isArray(base)) throw new Error("Catálogo inválido"); documentosBase = base; return base; })
      .catch(() => null);
    return documentosConsulta;
  }
  function temDocumentos(c) {
    const info = documentosBase && documentosBase[c.fonte_url];
    return !!(info && info.status === "disponivel" && Array.isArray(info.documentos) && info.documentos.length);
  }
  function classificarDocumento(d) {
    const nome = String(d?.nome || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const tipo = String(d?.tipo || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (/aditiv|apostil|(?:^|[\s_.-])ad\s*[-_]?\d/i.test(nome + " " + tipo)) return "aditivo";
    // O tipo genérico “termo de contratação” também pode ser um aditivo.
    if (/(?:^|[\s_.-])(?:contrato|ct\s*[-_]?\d)/i.test(nome) || /^contrato(?:\s+original)?$/.test(tipo)) return "contrato";
    return "outro";
  }
  function linkArquivo(ficha, documento) {
    const match = String(ficha || "").match(/^https:\/\/transparencia\.betha\.cloud\/#\/(y7mn01LGqd_HCvGtj6VPwA==\/consulta\/83043|-iAWLe1kr2VQcrW9k2AUBg==\/consulta\/324812)\/detalhe\/([\w:%-]+)$/);
    const id = String(documento?.arquivo_id || "");
    if (!match || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return "";
    const params = new URLSearchParams({orgao: match[1].startsWith("y7mn") ? "prefeitura" : "camara", ficha: match[2], arquivo: id});
    return `documento-contrato.php?${params.toString()}`;
  }
  function resumoEmpenho(e) {
    const valor=v=>v === undefined || v === null ? 'não informado' : fmtBRL(v);
    const x=e.execucao || {};
    const url=/^https:\/\/transparencia\.betha\.cloud\/#\/y7mn01LGqd_HCvGtj6VPwA==\/consulta\/82995\/detalhe\/\d+:\d+:[\w%-]+$/.test(x.fonte_url || '') ? x.fonte_url : '';
    const itens=(list, data, quantia)=>Array.isArray(list) ? list.length ? list.map(r=>`${esc(r[data] || 'data não informada')}: ${valor(r[quantia])}`).join('; ') : 'lista vazia na fonte consultada' : 'informação não confirmada';
    const detalhe=x.status==='confirmado_na_fonte' && url ? `<br><strong>Liquidação informada:</strong> ${valor(x.valor_liquidado)} · <strong>Pagamento informado:</strong> ${valor(x.valor_pago)} · <a href="${esc(url)}" target="_blank" rel="noopener">abrir empenho oficial ↗</a><br>Liquidações: ${itens(x.liquidacoes,'data','valor')}.<br>Pagamentos: ${itens(x.pagamentos,'dataPagamento','valorPagamento')}.<br>Documentos fiscais: ${Array.isArray(x.documentos_fiscais) ? (x.documentos_fiscais.length ? x.documentos_fiscais.map(d=>`${esc(d.tipo || 'Documento')} nº ${esc(d.numero || 'não informado')}, ${esc(d.dataEmissao || 'data não informada')}, ${valor(d.valorDocumento)}`).join('; ') : 'lista vazia na fonte consultada') : 'informação não confirmada'}. São registros na ficha contábil; os comprovantes integrais e a entrega precisam de conferência.` : ' · Liquidação e pagamento não vinculados nesta consulta.';
    const motivo=typeof x.motivo==='string' && x.motivo.startsWith('Não confirmado: ') ? ` ${esc(x.motivo)}.` : '';
    const consultada=/^https:\/\/transparencia\.betha\.cloud\/#\/y7mn01LGqd_HCvGtj6VPwA==\/consulta\/82995\/detalhe\/\d+:\d+:[\w%-]+$/.test(x.fonte_consultada || '') ? x.fonte_consultada : '';
    return `<li>${esc(e.tipo || 'Registro')} · nº ${esc(e.numero || 'não informado')}/${esc(e.ano || 'ano não informado')} · ${esc(e.data || 'data não informada')} · ${valor(e.valor)}${detalhe}${x.ultima_tentativa_status==='inconclusiva' ? ' Última tentativa inconclusiva; eventual informação anterior foi preservada.' + motivo + (consultada ? ` <a href="${esc(consultada)}" target="_blank" rel="noopener">Conferir resultado consultado (vínculo não confirmado) ↗</a>` : '') : ''}</li>`;
  }
  function resumoDocumentos(info) {
    const disponivel = info.status === "disponivel" && Array.isArray(info.documentos);
    const consultado = disponivel || info.status === "sem_documentos";
    const docs = disponivel ? info.documentos : [];
    const grupos = [
      ["Contrato original", docs.filter(d => classificarDocumento(d) === "contrato")],
      ["Aditivos ou apostilamentos", docs.filter(d => classificarDocumento(d) === "aditivo")],
      ["Outros arquivos não classificados", docs.filter(d => classificarDocumento(d) === "outro")]
    ];
    const linhas = grupos.map(([titulo, encontrados]) => {
      const descricao = encontrados.length
        ? `${encontrados.length} arquivo(s) possivelmente relacionado(s): ${encontrados.map(d => esc(d.nome || d.tipo || "sem nome")).join(", ")}.`
        : consultado ? "Não identificado no catálogo consultado." : "Disponibilidade não confirmada.";
      return `<li><strong>${titulo}:</strong> ${descricao}</li>`;
    }).join("");
    const alteracoes = Array.isArray(info.alteracoes_ficha)
      ? `<p><strong>Alterações na ficha:</strong> ${info.alteracoes_ficha.length} registro(s) informado(s) pela Betha.${info.alteracoes_ficha.length ? " " + info.alteracoes_ficha.map(a => esc([a.tipo, a.numero ? `nº ${a.numero}` : "", a.ano || "", a.data || ""].filter(Boolean).join(" · ") || "sem identificação")).join("; ") + "." : ""} Alterações podem ter naturezas diferentes; a lista de arquivos não comprova que todos os documentos foram localizados.</p>`
      : '<p><strong>Alterações na ficha:</strong> informação ainda não confirmada.</p>';
    return `<div class="contrato-documentos-resumo"><p><strong>Separação dos arquivos</strong></p><ul>${linhas}</ul>${alteracoes}<p>Classificação por nome ou tipo é uma pista. Confira o conteúdo e o vínculo com o contrato na fonte oficial.</p></div>`;
  }
  function templateDocumentos(c, orgao) {
    const url = /^https:\/\/transparencia\.betha\.cloud\/#\/(?:-iAWLe1kr2VQcrW9k2AUBg==\/consulta\/324812|y7mn01LGqd_HCvGtj6VPwA==\/consulta\/83043)\/detalhe\/[\w:%-]+$/.test(c.fonte_url || "") ? c.fonte_url : "";
    const numero = u.numeroContrato(c);
    const pedido = `À ${orgao} de Varginha. Solicito cópia integral do contrato ${numero}, firmado com ${c.contratado || "fornecedor não informado"}${c.cnpj ? " (CNPJ/CPF informado na fonte: " + c.cnpj + ")" : ""}, assinatura ${c.data_assinatura || "não informada"}, objeto: ${c.objeto || "não informado"}. Solicito contrato assinado, anexos e todos os aditivos, edital ou ato de contratação direta, termo de referência, processo administrativo, empenhos, liquidações, notas fiscais, comprovantes de pagamento e relatórios de execução, com indicação de onde estão publicados. Caso não haja documentos publicados, solicito o fornecimento das cópias e esclarecimento sobre a disponibilidade pública.${url ? " Ficha consultada: " + url : ""}`;
    return `<div class="contrato-documentos muted small" data-documentos-ficha="${esc(url)}" data-documentos-orgao="${esc(orgao)}">
      <p class="contrato-documentos-selo" data-documentos-selo>Disponibilidade não confirmada</p>
      <details class="contrato-documentos-acesso"><summary><strong>Contrato e aditivos</strong></summary>
        ${url ? `<p><a class="btn-link" href="${esc(url)}" target="_blank" rel="noopener">Abrir ficha e documentos na Betha ↗</a></p>` : `<p>Ficha individual não localizada. <a href="${esc(bethaContratoUrl(orgao))}" target="_blank" rel="noopener">Pesquisar contratos na Betha</a>.</p>`}
        <div data-documentos-status><p>Documentos ainda não verificados. Isso não confirma ausência. Consulte a ficha oficial ou solicite cópia do contrato e dos aditivos ao órgão responsável.</p></div>
      </details>
      <details class="contrato-documentos-pedido"><summary>Solicitar cópia</summary><p>Copie o pedido e use o canal de acesso à informação indicado em <a href="cobrar.html">Como cobrar</a>. O painel não envia a solicitação.</p><textarea readonly aria-label="Pedido de cópia do contrato">${esc(pedido)}</textarea><button type="button" class="btn-dossie" data-copiar-pedido>Copiar pedido</button><span role="status" data-pedido-status></span></details>
    </div>`;
  }
  function atualizarDocumentos() {
    const nodes = document.querySelectorAll('[data-documentos-ficha]:not([data-documentos-pronto])');
    if (!nodes.length) return;
    nodes.forEach(n => n.dataset.documentosPronto = "true");
    carregarDocumentos().then(base => { if (!base) return; nodes.forEach(n => {
      const info = base[n.dataset.documentosFicha];
      const status = n.querySelector("[data-documentos-status]");
      if (!info) return;
      if (info.divergencia) {
        const d = info.divergencia;
        const nota = document.createElement("p");
        nota.className = "report-note";
        nota.innerHTML = `<strong>Diferença identificada entre painel e ficha oficial.</strong> Na conferência de ${esc(d.conferido_em || "data não informada")}: número no painel ${esc(d.numero_painel)}, na fonte ${esc(d.numero_fonte)}; valor no painel ${fmtBRL(d.valor_painel)}, na fonte ${fmtBRL(d.valor_fonte)}. Confira o contrato e os aditivos antes de comparar os valores. Os valores do painel não foram alterados nesta conferência.`;
        n.prepend(nota);
      }
      if (info.correcao_valor) {
        const d=info.correcao_valor;
        const nota=document.createElement("p");
        nota.className="report-note";
        nota.innerHTML=`<strong>Histórico de correção.</strong> Em ${esc(d.conferido_em || "data não informada")}, a ficha oficial informou ${fmtBRL(d.valor_fonte)}; o painel exibia ${fmtBRL(d.valor_anterior)} e foi corrigido. O valor contratual não é pagamento. Alterações posteriores exigem nova conferência.`;
        n.prepend(nota);
      }
      if (info.alerta_data) {
        const d=info.alerta_data;const nota=document.createElement('p');nota.className='report-note';
        nota.innerHTML=`<strong>Data de assinatura divergente entre fontes.</strong> Na conferência de ${esc(d.conferido_em || 'data não informada')}, a ficha informava ${esc(d.data_ficha || 'não informada')}; o contrato em PDF informa ${esc(d.data_pdf || 'não informada')}. Confira os documentos e solicite esclarecimento antes de usar essa data.`;
        n.prepend(nota);
      }

      if (info.trilha) {
        const trilha = document.createElement("div");
        trilha.className = "muted small";
        trilha.innerHTML = `<p><strong>Processo de contratação:</strong> ${info.trilha.processo_fonte === "numeroProcessoCompra" && info.trilha.processo ? esc(info.trilha.processo + (info.trilha.ano_processo ? "/" + info.trilha.ano_processo : "")) + " informado na ficha. O número não comprova acesso ao processo integral." : "Vínculo ainda não identificado nesta conferência."}</p><p><strong>Edital, termo de referência e execução:</strong> arquivos ainda não vinculados pelo painel. Consulte a ficha e use “Solicitar cópia” para pedir o conjunto completo.</p>`;
        const emp=info.trilha.empenhos;
        if(info.trilha.empenhos_ultima_tentativa_status==='inconclusiva')trilha.insertAdjacentHTML('beforeend',`<p>A consulta mais recente não confirmou a lista de empenhos; foi preservada a lista anterior de ${esc(info.trilha.empenhos_ultima_confirmacao || 'data não informada')}.</p>`);
        if(Array.isArray(emp)){
          trilha.insertAdjacentHTML('beforeend',emp.length ? `<details><summary><strong>${emp.length} registro(s) de empenho informado(s) na ficha</strong></summary><ul>${emp.map(resumoEmpenho).join('')}</ul><p>A lista pode conter empenhos e anulações. Não é comprovante de liquidação, pagamento ou entrega.</p></details>` : '<p><strong>Empenhos:</strong> a ficha retornou lista vazia na consulta; isso não prova inexistência em outras fontes.</p>');
        } else {trilha.insertAdjacentHTML('beforeend','<p><strong>Empenhos:</strong> informação não confirmada na consulta.</p>');}
        trilha.insertAdjacentHTML('beforeend',`<p><strong>Fiscal informado na ficha:</strong> ${info.trilha.fiscal ? esc(info.trilha.fiscal) : 'não identificado nesta consulta'}. A indicação não comprova fiscalização ou entrega.</p>`);
        trilha.insertAdjacentHTML('beforeend','<p><strong>Comprovação de execução:</strong> confira os registros contábeis vinculados acima, quando disponíveis. Os comprovantes integrais e a entrega ainda precisam de confirmação; peça notas fiscais, ordens de pagamento, relatórios do fiscal e termo de recebimento em “Solicitar cópia”.</p>');
        n.querySelector(".contrato-documentos-acesso").append(trilha);
      }
      const data = /^\d{4}-\d{2}-\d{2}$/.test(info.verificado_em || "") ? info.verificado_em.split("-").reverse().join("/") : "data não informada";
      const selo = n.querySelector("[data-documentos-selo]");
      if (info.ultima_tentativa_status) {
        const nota = document.createElement("p");
        nota.textContent = "A última tentativa não confirmou a disponibilidade atual; o resultado anterior e sua data foram preservados.";
        status.before(nota);
      }

      if (info.status === "disponivel" && Array.isArray(info.documentos) && info.documentos.length) {
        selo.textContent = `${info.documentos.length} arquivo(s) identificado(s) · conferido em ${data}`;
        status.innerHTML = `<p><strong>${info.documentos.length} documento(s) localizado(s) na fonte · conferência ${esc(data)}</strong></p><ul>${info.documentos.map(d => { const link=linkArquivo(n.dataset.documentosFicha,d); return `<li><strong>${esc(d.tipo || "Documento")}</strong>: ${esc(d.nome || "nome não informado")}${link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener">${d.conferencia_pdf?.status === "pdf_acessivel" ? "Abrir PDF na fonte" : "Abrir arquivo na fonte"} ↗</a>` : ""}<small class="documento-conferencia">${d.conferencia_pdf?.status === "pdf_acessivel" ? "PDF acessível na conferência. " + (d.conferencia_pdf.correspondencia === "referencia_e_fornecedor_identificados" ? "Número/ano e um termo do nome do fornecedor encontrados; confirme o vínculo na leitura integral." : "Correspondência com este contrato exige revisão do conteúdo.") : d.conferencia_pdf ? "Não foi possível conferir o PDF; consulte o arquivo na fonte." : "Arquivo listado na fonte; conteúdo do PDF ainda não conferido."}</small></li>`; }).join("")}</ul><p>Os links consultam a Betha no momento da abertura. Se a fonte estiver indisponível, abra a ficha e procure <strong>Documentos relacionados</strong>. A conferência automática não substitui a leitura integral dos documentos.</p>`;
      } else if (info.status === "sem_documentos") {
        selo.textContent = `Documento não localizado na ficha · conferido em ${data}`;
        status.innerHTML = `<p><strong>Documento não localizado na ficha oficial em ${esc(data)}.</strong> Isso não significa que o contrato não exista. Solicite cópia integral do contrato e dos eventuais aditivos à ${esc(n.dataset.documentosOrgao)}. Use a pergunta pronta em “Resumo e como cobrar”.</p>`;
      } else {
        status.innerHTML = `<p><strong>Disponibilidade dos documentos não confirmada.</strong> A consulta não retornou uma lista verificável. Isso não confirma ausência. Consulte “Documentos relacionados” na ficha oficial ou solicite cópia do contrato e dos aditivos à ${esc(n.dataset.documentosOrgao)}.</p>`;
      }
      status.insertAdjacentHTML("beforeend", resumoDocumentos(info));
      const fontes = (Array.isArray(info.fontes_adicionais) ? info.fontes_adicionais : []).filter(d =>
        d.fonte === "PNCP" && /^https:\/\/pncp\.gov\.br\/pncp-api\/v1\/orgaos\/\d{14}\/contratos\/\d{4}\/\d+(?:\/termos\/\d+)?\/arquivos\/\d+$/.test(d.url || "")
      );
      if (fontes.length) {
        status.insertAdjacentHTML("beforeend", `<div><p><strong>Arquivos em outra fonte oficial</strong></p><ul>${fontes.map(d => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.titulo || "Abrir arquivo no PNCP")} ↗</a> · ${esc(d.tipo || "Documento")} · consulta ${esc(d.conferido_em || "data não informada")}. ${d.vinculo === "confirmado_por_leitura" ? "Vínculo conferido no documento." : "Possível correspondência: confira o conteúdo antes de considerar o vínculo confirmado."}${d.conferencia_conteudo?.ultima_tentativa_status === "inconclusiva" ? " Última tentativa de leitura inconclusiva." : d.conferencia_conteudo?.status === "referencia_e_fornecedor_encontrados" ? " Texto automático identificou referência e fornecedor; confira o documento." : d.conferencia_conteudo?.status === "referencia_e_cnpj_encontrados" ? " Texto automático identificou referência e raiz do CNPJ; confira a identidade e o documento." : d.conferencia_conteudo ? " Texto automático exige revisão." : " Conteúdo ainda não conferido automaticamente."}${d.conferencia_conteudo?.metodo === "ocr_primeiras_duas_paginas" ? " OCR limitado às duas primeiras páginas." : ""}</li>`).join("")}</ul><p>Arquivos listados não comprovam a existência ou ausência de outros aditivos.</p></div>`);
      }
      const extratos = (Array.isArray(info.fontes_adicionais) ? info.fontes_adicionais : []).filter(d =>
        d.fonte === "Diário Oficial" && /^https:\/\/www\.varginha\.mg\.gov\.br\/uploads\/diario_[a-zA-Z0-9]+\.pdf(?:#page=\d+)?$/.test(d.url || "")
      );
      if (extratos.length) {
        status.insertAdjacentHTML("beforeend", `<div><p><strong>Referências no Diário Oficial</strong></p><ul>${extratos.map(d => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.titulo || "Abrir extrato oficial")} ↗</a> · ${d.vinculo === "confirmado_por_leitura" ? "Conferido" : "Possível correspondência; confira o extrato e o fornecedor"} · ${esc(d.conferido_em || "data não informada")}. Extrato: não substitui o termo integral.</li>`).join("")}</ul></div>`);
      }
      if (info.pncp_ultima_tentativa_status === "inconclusiva") {
        status.insertAdjacentHTML("beforeend", `<p>Última consulta ao PNCP inconclusiva em ${esc(info.pncp_ultima_tentativa || "data não informada")}; resultados anteriores foram preservados.</p>`);
      } else if (info.pncp_ultima_tentativa_status === "ok") {
        status.insertAdjacentHTML("beforeend", `<p>Última consulta ao PNCP: ${esc(info.pncp_ultima_tentativa || "data não informada")}. Arquivos anteriores são preservados com a data em que foram localizados; confira sua disponibilidade atual na fonte.</p>`);
      }
    }); });
  }
  document.addEventListener("click", async event => {
    const button = event.target.closest("[data-copiar-pedido]");
    if (!button) return;
    const section = button.closest(".contrato-documentos-pedido");
    const campo = section.querySelector("textarea");
    const feedback = section.querySelector("[data-pedido-status]");
    try {
      await navigator.clipboard.writeText(campo.value);
      feedback.textContent = "Pedido copiado. Cole no canal oficial e guarde o protocolo.";
    } catch (_) {
      campo.focus(); campo.select();
      feedback.textContent = "Selecione e copie o texto do pedido manualmente.";
    }
  });
  new MutationObserver(atualizarDocumentos).observe(document.documentElement, {childList:true, subtree:true});

  const CHECK_STORE = "fiscaliza.dossie.checklist.v1";
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
    const trilhas = [...content.querySelectorAll('[data-citizen-trail]')];
    if (trilhas.length) carregarDocumentos().then(() => {
      trilhas.forEach(el => {
        if (!el.isConnected) return;
        const cfg = JSON.parse(el.dataset.citizenTrail);
        if (window.FISCALIZA.cidadao) el.outerHTML = window.FISCALIZA.cidadao.trail(cfg.c, cfg.orgao, documentosBase && documentosBase[cfg.c.fonte_url]);
      });
    });
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
      c.numero && String(c.numero) !== "0" && c.ano ? `Contrato ${c.numero}/${c.ano}` : "",
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
    const numero = u.numeroContrato(c);
    const cnpj = c.cnpj || "não informado";
    const dataIni = c.data_assinatura ? String(c.data_assinatura).split("-").reverse().join("/") : "não informada";
    const dataFim = c.data_fim ? String(c.data_fim).split("-").reverse().join("/") : "não informada";
    const betha = bethaContratoUrl(orgao);
    const ficha = /^https:\/\/transparencia\.betha\.cloud\/#\/[\w=+-]+\/consulta\/\d+\/detalhe\/[\w:%-]+$/.test(c.fonte_url || "") ? c.fonte_url : "";
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
          ${templateDocumentos(c, orgao)}
          <p class="dossier-text">Copie um dos termos abaixo e pesquise na tabela oficial. Se o número não aparecer, pesquise pelo CNPJ ou nome da empresa.</p>
          <div class="source-search">
            <code>${esc(busca || numero)}</code>
            <button type="button" class="btn-dossie" onclick="navigator.clipboard && navigator.clipboard.writeText(this.previousElementSibling.textContent)">Copiar busca</button>
          </div>
          <div class="source-actions">
            ${ficha ? `<a class="btn-link" href="${esc(ficha)}" target="_blank" rel="noopener">Abrir ficha deste contrato na Betha ↗</a>` : ""}
            <a class="btn-link" href="${esc(betha)}" target="_blank" rel="noopener">Abrir tabela Betha</a>
            <a class="btn-link" href="${esc(portal)}" target="_blank" rel="noopener">Abrir portal oficial</a>
            <a class="btn-link" href="${esc(pncp)}" target="_blank" rel="noopener">Buscar no PNCP</a>
          </div>
          <p class="muted small">${ficha ? "Na ficha oficial, confira as seções Alterações do contrato e Documentos relacionados. Arquivos de contratos e aditivos só podem ser acessados quando publicados pela fonte. " : ""}O painel facilita a busca, mas a confirmação final deve ser feita na fonte primária.</p>
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
      ${window.FISCALIZA.cidadao?.trail(c, orgao, documentosBase && documentosBase[c.fonte_url]) || ""}
      <section class="dossier-lai">
        <h4>5. Pedido pronto para LAI/e-SIC</h4>
        <textarea readonly>${esc(pergunta)}</textarea>
        <div class="diaria-actions">
          <button type="button" class="btn-dossie" onclick="navigator.clipboard && navigator.clipboard.writeText(this.closest('.dossier-lai').querySelector('textarea').value)">Copiar pergunta</button>
          ${canDownloadTxt ? `<button type="button" class="btn-dossie" onclick="FISCALIZA.gerarDossie && FISCALIZA.gerarDossie(${Number(c.__idx)})">Baixar relatório TXT</button>` : ""}
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
      (e.valor_brl == null || e.valor_brl === "" ? "não informado" : fmtBRL(e.valor_brl)) +
      ", incluindo justificativa do objeto, local de aplicação e etapa " +
      "atual de execução.";

    const consultado = window.FISCALIZA_DATA?.prefeitura?.emendas_cruzamento_meta?.consultado_em;
    const dataConsulta = consultado && Number.isFinite(Date.parse(consultado)) ? new Date(consultado).toLocaleString('pt-BR') : 'data não informada';
    let pagamentoBlock;
    if (c.status === "encontrado") {
      pagamentoBlock = `
        <p class="dossier-info">Pagamentos ao beneficiário no exercício ${esc(c.exercicioOrcamentario || c.cruzamento?.exercicioOrcamentario || "não informado")}.</p>
        <p>Consulta de credores: ${esc(dataConsulta)}. Outras seções podem usar coletas de datas diferentes.</p>
        <p>Total ao CNPJ/raiz: <strong>${fmtBRL(c.valor_pago_total || 0)}</strong>.</p>
        <p>O vínculo destes pagamentos com esta emenda não foi comprovado. O valor pode incluir outras verbas e não permite calcular percentual de execução.</p>`;
    } else if (c.status === "execucao_direta") {
      pagamentoBlock =
        '<p class="dossier-info" style="color:#004d40; background:#e0f2f1; padding:8px 12px; border-radius:4px; margin-bottom:8px; font-size:0.85rem;">' +
        '<strong>Execução Direta (Prefeitura):</strong> Destinada a um órgão, secretaria, escola ou UPA municipal (CNPJ da Prefeitura). ' +
        'Os pagamentos de execução ocorrem internamente ou via contratos de compras/serviços da respectiva secretaria.</p>';
    } else if (c.status === "sem_periodo") {
      pagamentoBlock = '<p class="dossier-warn">Exercício ou consulta indisponível. Pagamento não verificado; não significa valor zero. Confira o documento orçamentário e a disponibilidade da fonte.</p>';
    } else if (c.status === "sem_pagamento") {
      pagamentoBlock =
        `<p class="dossier-warn">Não localizamos pagamento da Prefeitura para este CNPJ no exercício ${esc(c.exercicioOrcamentario || "não informado")} na base consultada. Isso não comprova ausência de execução da emenda.</p><p>Consulta de credores: ${esc(dataConsulta)}.</p>`;
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
      <section class="citizen-trail" aria-label="Etapas da emenda">
        <h4>Da indicação à entrega: o que falta conferir?</h4>
        <ol>
          <li><strong>Indicação:</strong> verifique a proposta e o exercício no documento oficial.</li>
          <li><strong>Empenho e liquidação:</strong> documentos vinculados a esta emenda não foram confirmados automaticamente. Solicite o processo e os números correspondentes.</li>
          <li><strong>Pagamento:</strong> a busca por beneficiário está descrita abaixo; uma correspondência ao CNPJ não comprova vínculo com esta emenda.</li>
          <li><strong>Entrega e prestação de contas:</strong> solicite plano de trabalho, notas fiscais, comprovação da entrega e prestação de contas vinculados à emenda.</li>
        </ol>
        <p>A ausência de um documento nesta consulta não prova que ele não exista ou que houve irregularidade.</p>
      </section>
      <div class="dossier-grid">
        <section>
          <h4>1. Emenda indicada</h4>
          <table>
            <tr><td>Vereador(a)</td><td>${esc(e.autor)}</td></tr>
            <tr><td>Emenda</td><td>${esc(e.numero)}/${esc(e.ano)}</td></tr>
            <tr><td>Valor</td><td>${e.valor_brl == null || e.valor_brl === "" ? "não informado" : fmtBRL(e.valor_brl)}</td></tr>
            <tr><td>CNPJ</td><td>${esc(e.cnpj || "não informado")}</td></tr>
          </table>
          ${e.objeto ? `<p class="dossier-text">${esc(e.objeto)}</p>` : ""}
          ${e.pdf ? `<p><a href="${esc(e.pdf)}" target="_blank" rel="noopener">Abrir PDF oficial da emenda →</a></p>` : ""}
        </section>
        <section>
          <h4>2. Busca de pagamentos ao beneficiário</h4>
          ${pagamentoBlock}
        </section>
        <section>
          <h4>3. Contratos do mesmo CNPJ/raiz</h4>
          <p>O mesmo CNPJ não comprova que o contrato esteja vinculado a esta emenda.</p>
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
        ${window.FISCALIZA.cidadao?.trackingLink(`Emenda ${e.numero}/${e.ano} · ${e.beneficiario || ""}`, "Prefeitura", pergunta, e.pdf) || ""}
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
    const valorInformado = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? fmtBRL(Number(value)) : "não informado";

    const pergunta = isPrefeitura
      ? `Solicito cópia integral do processo administrativo, empenho, liquidação, comprovante de pagamento, ordem de pagamento, justificativa, autorização e documentos que expliquem a despesa classificada como diária em nome de ${d.funcionario || "servidor/credor não informado"}, no valor de ${valorInformado(d.valor_total)}, vinculada a ${setor}, período ${periodo}, incluindo finalidade, destino quando houver, quantidade de diárias se aplicável e relatório de resultado/necessidade pública.`
      : `Solicito cópia integral da solicitação, autorização, ato de concessão, roteiro/destino, motivo da viagem, comprovantes, relatório de viagem, certificado/participação quando houver e prestação de contas da diária paga a ${d.funcionario || "servidor/vereador não informado"}, cargo ${setor}, no valor de ${valorInformado(d.valor_total)}, quantidade ${d.quantidade == null ? "não informada" : fmtNum(d.quantidade)}, período ${periodo}, informando qual benefício concreto a atividade trouxe para Varginha.`;

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
          <h4>1. ${isPrefeitura ? "O que consta no registro" : "O que foi pago"}</h4>
          <table>
            <tr><td>Nome</td><td>${esc(d.funcionario || "não informado")}</td></tr>
            <tr><td>${isPrefeitura ? "Secretaria/unidade" : "Cargo/setor"}</td><td>${esc(setor)}</td></tr>
            <tr><td>Valor total</td><td>${valorInformado(d.valor_total)}</td></tr>
            <tr><td>${isPrefeitura ? "Registros" : "Quantidade"}</td><td>${fmtNum(d.quantidade || 0)} ${qtdLabel}(s)</td></tr>
            <tr><td>Valor unitário</td><td>${valorInformado(d.valor_unitario)}</td></tr>
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
        ${window.FISCALIZA.cidadao?.trackingLink(`Diária · ${d.funcionario || "registro"}`, isPrefeitura ? "Prefeitura" : "Câmara", pergunta, fonte || "") || ""}
        <div class="diaria-actions">
          <button type="button" class="btn-dossie" onclick="navigator.clipboard && navigator.clipboard.writeText(this.closest('.dossier-lai').querySelector('textarea').value)">Copiar pergunta</button>
          ${fonte ? `<a class="btn-link" href="${esc(fonte)}" target="_blank" rel="noopener">Abrir fonte oficial</a>` : ""}
          <button type="button" class="btn-dossie" onclick="FISCALIZA.baixarPdfSecao('#modalFiscalizaContent', 'Fiscalizacao de diária')">Baixar PDF</button>
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

  function iniciarHistoricos() {
    document.querySelectorAll("[data-contratos-historico]").forEach(details => {
      const orgao = details.dataset.contratosHistorico;
      if (!["prefeitura", "camara"].includes(orgao)) return;
      let carregado = false;
      details.addEventListener("toggle", async () => {
        if (!details.open || carregado) return;
        carregado = true;
        const area = details.querySelector("[data-historico-conteudo]");
        area.innerHTML = '<p role="status">Carregando histórico oficial…</p>';
        try {
          const response = await fetch(`data/chunks/contratos_historico_${orgao}.json`, {cache:"no-cache"});
          if (!response.ok) throw new Error("Histórico indisponível");
          const base = await response.json();
          if (!Array.isArray(base.contratos)) throw new Error("Catálogo inválido");
          const contratos = base.contratos;
          area.innerHTML = `<p>${contratos.length} fichas oficiais · consulta ${esc(base.consultado_em || "data não informada")}. Não são pagamentos nem contratos necessariamente vigentes.</p><label>Buscar no histórico<input type="search" data-historico-busca placeholder="Fornecedor, número, CNPJ ou objeto"></label><label>Ano de assinatura<select data-historico-ano><option value="">Todos os anos</option>${[...new Set(contratos.map(c => String(c.data_assinatura || "").slice(0,4)).filter(a => /^\d{4}$/.test(a)))].sort().reverse().map(a => `<option value="${a}">${a}</option>`).join("")}</select></label><p role="status" data-historico-contador></p><div data-historico-lista></div><button type="button" class="btn-dossie" data-historico-mais>Mostrar mais fichas</button>`;
          const busca = area.querySelector("[data-historico-busca]"), ano = area.querySelector("[data-historico-ano]"), lista = area.querySelector("[data-historico-lista]"), mais = area.querySelector("[data-historico-mais]");
          let shown = 20;
          const render = reset => {
            if (reset) shown = 20;
            const q = norm(busca.value.trim());
            const digits = busca.value.replace(/\D/g, "");
            const rows = contratos.filter(c => (!ano.value || String(c.data_assinatura).startsWith(ano.value)) && (!q || norm([`${c.numero}/${c.ano}`, c.cnpj, c.contratado, c.objeto].join(" ")).includes(q) || (digits.length >= 8 && String(c.cnpj || "").replace(/\D/g, "").includes(digits))));
            area.querySelector("[data-historico-contador]").textContent = `${rows.length} ficha(s) encontrada(s)`;
            lista.innerHTML = rows.slice(0,shown).map(c => `<article class="report-note"><strong>Contrato ${esc(u.numeroContrato(c))} · ${esc(c.contratado || "Fornecedor não informado")}</strong><p>${esc(c.objeto || "Objeto não informado")} · situação ${esc(c.situacao || "não informada")} · assinatura ${esc(c.data_assinatura || "não informada")}</p>${templateDocumentos(c, orgao === "camara" ? "Câmara" : "Prefeitura")}</article>`).join("") || '<p>Nenhuma ficha localizada neste recorte. Isso não comprova inexistência do contrato. Amplie a busca ou solicite o instrumento de contratação ao órgão.</p>';
            mais.hidden = rows.length <= shown;
          };
          busca.addEventListener("input", () => render(true)); ano.addEventListener("change", () => render(true)); mais.addEventListener("click", () => {shown += 20; render(false);});
          render(true);
        } catch (_) {
          area.innerHTML = '<p role="status">Histórico indisponível. Isso não confirma ausência de contratos. A lista principal e a consulta no portal oficial continuam disponíveis.</p>';
          carregado = false;
        }
      });
    });
  }

  // ============================================================
  // API PÚBLICA
  // ============================================================
  window.FISCALIZA.dossie = Object.freeze({
    criarModal,
    abrirComHtml,
    templateEmenda,
    templateDiaria,
    templateContrato,
    templateDocumentos,
    classificarDocumento,
    carregarDocumentos,
    temDocumentos,
    gerarTxtContrato,
  });
  iniciarHistoricos();
})();
