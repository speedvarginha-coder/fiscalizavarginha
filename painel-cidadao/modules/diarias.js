/* Fiscaliza Varginha — modules/diarias.js
 *
 * Painel de diárias para Prefeitura e Câmara.
 * Renderiza: filtros, stats, ranking por pessoa, lista detalhada.
 * Exporta: CSV das diárias filtradas. Abre dossiê de fiscalização ao clicar.
 *
 * Disponível em window.ZELA.diarias.
 * Dependências:
 *   - window.ZELA.utils (norm, esc, cleanText, fmtBRL, fmtNum, jsSafe, exportCSV, highlight)
 *   - window.ZELA.dossie  (abrirFiscalizacao de diária — via window.ZELA.diarias.abrir)
 *
 * Carregado pelo data-loader.js (depois dos módulos base, antes de app.js).
 */
(function () {
  "use strict";
  window.ZELA = window.ZELA || {};

  const u = window.ZELA.utils;
  if (!u) {
    console.error("[diarias] window.ZELA.utils ausente. Carregue modules/utils.js primeiro.");
    return;
  }
  const { norm, esc, cleanText, fmtBRL, fmtNum, jsSafe, exportCSV } = u;

  function $(id) { return document.getElementById(id); }

  // Abre dossiê de fiscalização de diária — delega para modules/dossie.js
  function abrirFiscalizacaoDiaria(prefix, idx) {
    const lista = (window.ZELA_DIARIAS || {})[prefix] || [];
    const d = lista[idx];
    if (!d) return;
    const D = window.ZELA_DATA || {};
    const isPrefeitura = prefix === "Prefeitura";
    const fonte = isPrefeitura
      ? ((D.diarias || {}).fontes || {}).prefeitura
      : ((D.diarias || {}).fontes || {}).camara;
    const dossie = window.ZELA.dossie;
    if (!dossie || !dossie.templateDiaria) return;
    const html = dossie.templateDiaria({ diaria: d, prefix, fonte });
    dossie.abrirComHtml(html);
  }

  // ============================================================
  // INIT — chamado uma vez por página (Prefeitura ou Câmara)
  // ============================================================
  function init(prefix, dados) {
    const block = $(`diarias${prefix}Block`);
    if (!block) return;

    const lista = Array.isArray(dados) ? dados : [];
    const anoEl = $(`filtroAnoDiarias${prefix}`);
    const secEl = $(`filtroSecretariaDiarias${prefix}`);
    const buscaEl = $(`filtroFuncionarioDiarias${prefix}`);
    const valorEl = $(`filtroValorDiarias${prefix}`);
    const ordemEl = $(`ordenarDiarias${prefix}`);
    const statsEl = $(`statsDiarias${prefix}`);
    const rankingEl = $(`rankingDiarias${prefix}`);
    const listaEl = $(`listaDiarias${prefix}`);
    const contadorEl = $(`contadorDiarias${prefix}`);
    window.ZELA_DIARIAS = window.ZELA_DIARIAS || {};
    window.ZELA_DIARIAS[prefix] = lista;

    const D = window.ZELA_DATA || {};
    const orgPessoal = prefix === "Camara" ? (D.pessoal || {}).camara : (D.pessoal || {}).prefeitura;
    const pessoalPorNome = new Map(((orgPessoal || {}).servidores || []).map(s => [norm(s.nome), s]));
    const dimSecretaria = (d) => prefix === "Camara"
      ? (d.secretaria || d.unidade || "Câmara Municipal")
      : (d.secretaria || d.unidade || "Não informado");
    const funcaoDiaria = (d) => {
      const cargoFonte = String(d.cargo || "").trim();
      if (cargoFonte) {
        return { texto: cargoFonte, detalhe: "cargo informado na diária", encontrado: true };
      }
      const servidor = pessoalPorNome.get(norm(d.funcionario));
      if (servidor) {
        return {
          texto: servidor.cargo || servidor.vinculo || "Cargo localizado na folha",
          detalhe: servidor.lotacao || servidor.vinculo || "cruzado com folha de pessoal",
          encontrado: true,
        };
      }
      return {
        texto: "Função não informada na fonte",
        detalhe: "não localizada na folha carregada",
        encontrado: false,
      };
    };
    const dataBR = (s) => (s || "").split("-").reverse().join("/");

    const secretarias = Array.from(new Set(lista.map(dimSecretaria).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    if (secEl && secretarias.length) {
      const first = secEl.querySelector("option").outerHTML || '<option value="">Todos</option>';
      secEl.innerHTML = first + secretarias.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    }

    const render = () => {
      const ano = anoEl ? (anoEl.value || "") : "";
      const sec = secEl ? (secEl.value || "") : "";
      const q = norm(buscaEl ? (buscaEl.value || "") : "");
      const faixa = valorEl ? (valorEl.value || "") : "";
      const ordem = ordemEl ? (ordemEl.value || "valor_desc") : "valor_desc";

      let view = lista.filter(d =>
        (!ano || String(d.ano || "") === ano) &&
        (!sec || dimSecretaria(d) === sec) &&
        (!faixa ||
          (faixa === "1000" && Number(d.valor_total || 0) >= 1000) ||
          (faixa === "500-999" && Number(d.valor_total || 0) >= 500 && Number(d.valor_total || 0) < 1000) ||
          (faixa === "0-499" && Number(d.valor_total || 0) < 500)
        ) &&
        (!q ||
          norm(d.funcionario).includes(q) ||
          norm(d.destino).includes(q) ||
          norm(d.finalidade).includes(q) ||
          norm(d.secretaria).includes(q) ||
          norm(d.cargo).includes(q)
        )
      );

      const sorters = {
        valor_desc: (a, b) => (b.valor_total || 0) - (a.valor_total || 0),
        qtd_desc: (a, b) => (b.quantidade || 0) - (a.quantidade || 0) || (b.valor_total || 0) - (a.valor_total || 0),
        valor_unit_desc: (a, b) => (b.valor_unitario || 0) - (a.valor_unitario || 0),
        data_desc: (a, b) => String(b.data_inicial || "").localeCompare(String(a.data_inicial || "")),
        secretaria: (a, b) => dimSecretaria(a).localeCompare(dimSecretaria(b), "pt-BR"),
      };
      view = view.slice().sort(sorters[ordem] || sorters.valor_desc);

      const total = view.reduce((s, d) => s + Number(d.valor_total || 0), 0);
      const qtd = view.reduce((s, d) => s + Number(d.quantidade || 0), 0);
      const pessoas = new Set(view.map(d => norm(d.funcionario)).filter(Boolean)).size;
      const media = qtd ? total / qtd : 0;

      if (contadorEl) contadorEl.textContent = `${fmtNum(view.length)} registro(s) · ${fmtBRL(total)}`;
      if (statsEl) {
        const isPrefeitura = prefix === "Prefeitura";
        statsEl.innerHTML = [
          { cls: "stat--navy", v: fmtBRL(total), l: isPrefeitura ? "Total em despesas de diárias" : "Total pago em diárias", s: "Soma dos registros filtrados" },
          { cls: "stat--gold", v: fmtNum(isPrefeitura ? view.length : qtd), l: isPrefeitura ? "Registros/empenhos" : "Quantidade de diárias", s: isPrefeitura ? "Consulta contábil da Prefeitura" : "Total informado na fonte" },
          { cls: "stat--teal", v: fmtBRL(isPrefeitura ? (total / (view.length || 1)) : media), l: isPrefeitura ? "Valor médio por registro" : "Valor médio por diária", s: isPrefeitura ? "Total dividido por registros" : "Total dividido pela quantidade" },
          { cls: "stat--navy", v: fmtNum(pessoas), l: "Funcionários/vereadores", s: "Pessoas distintas no filtro" },
        ].map(s => `
          <div class="stat ${s.cls}">
            <div class="stat__value">${s.v}</div>
            <div class="stat__label">${s.l}</div>
            <div class="stat__sub">${s.s}</div>
          </div>`).join("");
      }

      if (listaEl) {
        const parent = listaEl.parentElement;
        if (parent && !parent.querySelector(".diarias-note")) {
          const note = document.createElement("div");
          note.className = "report-note diarias-note";
          note.innerHTML = prefix === "Prefeitura"
            ? `<strong>Diária não é salário extra:</strong> aqui a Prefeitura aparece como despesa/empenho classificado como diária. Pode ser legal, mas precisa ter processo, justificativa, liquidação e comprovante. A fonte não garante que cada linha seja uma viagem individual.`
            : `<strong>Diária não é salário:</strong> na Câmara, a diária deve indenizar viagem oficial. Para ser bem fiscalizada, precisa indicar destino, finalidade, autorização, período, prestação de contas e resultado público para Varginha.`;
          parent.insertBefore(note, rankingEl || listaEl);
        }
      }

      const grupos = {};
      view.forEach(d => {
        const key = norm(d.funcionario) || "sem nome";
        const funcao = funcaoDiaria(d);
        grupos[key] ||= { nome: d.funcionario || "Não informado", funcao: funcao.texto, funcaoDetalhe: funcao.detalhe, secretaria: dimSecretaria(d), valor: 0, qtd: 0, registros: 0 };
        if (!grupos[key].funcao || grupos[key].funcao === "Função não informada na fonte") {
          grupos[key].funcao = funcao.texto;
          grupos[key].funcaoDetalhe = funcao.detalhe;
        }
        grupos[key].valor += Number(d.valor_total || 0);
        grupos[key].qtd += Number(d.quantidade || 0);
        grupos[key].registros += 1;
      });
      const ranking = Object.values(grupos).sort((a, b) => b.valor - a.valor).slice(0, 20);
      const unidadeRanking = prefix === "Prefeitura" ? "registro" : "dia";
      if (rankingEl) {
        rankingEl.innerHTML = ranking.length ? `
          <h4 class="subblock__title">Ranking por pessoa</h4>
          ${ranking.map((g, i) => `
            <div class="diaria-rank-row">
              <span class="diaria-rank-row__pos">${i + 1}</span>
              <span class="diaria-rank-row__person">
                <strong>${esc(cleanText(g.nome))}</strong>
                <small>Função: ${esc(cleanText(g.funcao))}</small>
              </span>
              <span>${esc(cleanText(g.secretaria))}</span>
              <span class="diaria-rank-row__function">${esc(cleanText(g.funcaoDetalhe))}</span>
              <span>${fmtNum(prefix === "Prefeitura" ? g.registros : g.qtd)} ${prefix === "Prefeitura" ? "registro(s)" : "diária(s)"} · <strong>${fmtBRL(g.valor / ((prefix === "Prefeitura" ? g.registros : g.qtd) || 1))}</strong>/${unidadeRanking}</span>
              <b>${fmtBRL(g.valor)}</b>
            </div>`).join("")}` : "";
      }

      if (!listaEl) return;
      if (!view.length) {
        const fonte = prefix === "Camara"
          ? ((D.diarias || {}).fontes || {}).camara
          : ((D.diarias || {}).fontes || {}).prefeitura;
        listaEl.innerHTML = `
          <div class="empty">
            Nenhuma diária encontrada com os filtros atuais.
            ${fonte ? `<br><a href="${esc(fonte)}" target="_blank" rel="noopener">Abrir fonte oficial</a>` : ""}
          </div>`;
        return;
      }

      const isPrefeituraCard = prefix === "Prefeitura";
      const fonteOficialDiaria = ((D.diarias || {}).fontes || {})[prefix.toLowerCase()] || "https://transparencia.varginha.mg.gov.br/portal-transparencia/consultas/diarias";
      listaEl.innerHTML = view.slice(0, 80).map(d => {
        const funcao = funcaoDiaria(d);
        return `
        <article class="diaria-card">
          <div class="diaria-card__value">
            <strong>${fmtBRL(d.valor_total || 0)}</strong>
            <span>${isPrefeituraCard ? "1 registro/empenho" : `${fmtNum(d.quantidade || 0)} diária(s)`} · ${fmtBRL(d.valor_unitario || 0)} ${isPrefeituraCard ? "no registro" : "cada"}</span>
          </div>
          <div class="diaria-card__body">
            <h4>${esc(cleanText(d.funcionario || "Funcionário não informado"))}</h4>
            <div class="diaria-card__role">
              <strong>Função/cargo:</strong> ${esc(cleanText(funcao.texto))}
              <small>${esc(cleanText(funcao.detalhe))}</small>
            </div>
            <p>${esc(cleanText(d.finalidade || d.historico || "Finalidade não informada"))}</p>
            <div class="diaria-card__meta">
              <span>${esc(cleanText(dimSecretaria(d)))}</span>
              ${d.destino ? `<span>Destino: ${esc(cleanText(d.destino))}</span>` : ""}
              ${d.numero ? `<span>Nº ${esc(d.numero)}</span>` : ""}
              ${d.data_inicial ? `<span>${dataBR(d.data_inicial)}${d.data_final && d.data_final !== d.data_inicial ? " a " + dataBR(d.data_final) : ""}</span>` : ""}
            </div>
            <div style="margin-top:10px; display: flex; gap: 8px; flex-wrap: wrap;">
              <button class="btn-share" onclick="ZELA.compartilharZap('${jsSafe(d.funcionario)}', '${jsSafe(d.finalidade || d.historico)}', '${fmtBRL(d.valor_total)} (${fmtNum(d.quantidade)} dias)')" style="padding: 4px 8px; background: #0b5f3a; color: white; border: none; border-radius: 4px; font-size: 0.75em; cursor: pointer;">Compartilhar</button>
              <a class="btn-link" href="https://transparencia.varginha.mg.gov.br/portal-transparencia/consultas/diarias" target="_blank" title="Portal oficial da Prefeitura (pode estar temporariamente indisponível)" style="text-decoration:none; padding: 4px 8px; background: #eee; border-radius: 4px; color: #333; font-size: 0.75em; font-weight: 500; border: 1px solid #ccc; display: inline-block;">Fonte oficial</a>
              <a class="btn-link" href="https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/diarias" target="_blank" title="Portal Betha — alternativa quando o portal oficial estiver fora do ar" style="text-decoration:none; padding: 4px 8px; background: #e8f4fd; border-radius: 4px; color: #1565c0; font-size: 0.75em; font-weight: 500; border: 1px solid #90caf9; display: inline-block;">Portal Betha</a>
            </div>
          </div>
        </article>`;
      }).join("");
      listaEl.querySelectorAll(".diaria-card").forEach((card, i) => {
        const actions = card.querySelector(".diaria-card__body > div:last-child");
        const item = view[i];
        if (!actions || !item) return;
        const btn = document.createElement("button");
        btn.className = "btn-dossie";
        btn.type = "button";
        btn.textContent = "Fiscalizar esta diária";
        btn.addEventListener("click", () => abrirFiscalizacaoDiaria(prefix, lista.indexOf(item)));
        actions.insertBefore(btn, actions.firstChild);
        const official = actions.querySelector(".btn-link");
        if (official) {
          official.href = fonteOficialDiaria;
          official.textContent = "Oficial";
        }
      });
    };

    [anoEl, secEl, buscaEl, valorEl, ordemEl].forEach(el => {
      if (!el) return;
      el.addEventListener(el.tagName === "INPUT" ? "input" : "change", render);
    });
    render();

    // CSV export button para diárias
    if (lista.length && contadorEl) {
      const csvBtnD = document.createElement("button");
      csvBtnD.className = "btn-csv"; csvBtnD.textContent = "↓ CSV";
      csvBtnD.title = `Baixar diárias de ${prefix} como CSV`;
      csvBtnD.style.marginLeft = "8px";
      contadorEl.after(csvBtnD);
      csvBtnD.addEventListener("click", () => {
        const q = norm((buscaEl || {}).value || "");
        const ano = (anoEl || {}).value || "";
        const sec = (secEl || {}).value || "";
        const faixa = (valorEl || {}).value || "";
        const view = lista.filter(d =>
          (!ano || String(d.ano || "") === ano) &&
          (!sec || norm(dimSecretaria(d)) === norm(sec)) &&
          (!faixa ||
            (faixa === "5000+" && Number(d.valor_total || 0) >= 5000) ||
            (faixa === "1000-4999" && Number(d.valor_total || 0) >= 1000 && Number(d.valor_total || 0) < 5000) ||
            (faixa === "500-999" && Number(d.valor_total || 0) >= 500 && Number(d.valor_total || 0) < 1000) ||
            (faixa === "0-499" && Number(d.valor_total || 0) < 500)
          ) &&
          (!q || norm(d.funcionario).includes(q) || norm(d.destino).includes(q) || norm(d.finalidade).includes(q))
        );
        exportCSV(view.map(d => ({
          funcionario: cleanText(d.funcionario || ""),
          cargo: cleanText(d.cargo || ""),
          secretaria: cleanText(dimSecretaria(d)),
          destino: cleanText(d.destino || ""),
          finalidade: cleanText(d.finalidade || d.historico || ""),
          data_inicial: d.data_inicial || "",
          data_final: d.data_final || "",
          quantidade: d.quantidade || "",
          valor_unitario: d.valor_unitario || 0,
          valor_total: d.valor_total || 0,
          ano: d.ano || "",
        })), [
          { key: "funcionario",   label: "Funcionário" },
          { key: "cargo",         label: "Cargo" },
          { key: "secretaria",    label: "Secretaria" },
          { key: "destino",       label: "Destino" },
          { key: "finalidade",    label: "Finalidade" },
          { key: "data_inicial",  label: "Data Início" },
          { key: "data_final",    label: "Data Fim" },
          { key: "quantidade",    label: "Qtd Diárias" },
          { key: "valor_unitario",label: "Valor Unit. (R$)" },
          { key: "valor_total",   label: "Valor Total (R$)" },
          { key: "ano",           label: "Ano" },
        ], `diarias-${prefix.toLowerCase()}-varginha-${new Date().toISOString().slice(0,10)}.csv`);
      });
    }
  }

  window.ZELA.diarias = Object.freeze({
    init,
    abrirFiscalizacaoDiaria,
  });
})();
