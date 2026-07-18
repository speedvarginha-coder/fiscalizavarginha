/* Fiscaliza Varginha — modules/diarias.js
 *
 * Painel de diárias para Prefeitura e Câmara.
 * Renderiza: filtros, stats, ranking anual/mensal por pessoa, lista detalhada.
 * Exporta: CSV das diárias filtradas. Abre dossiê de fiscalização ao clicar.
 *
 * Disponível em window.ZELA.diarias.
 * Dependências:
 *   - window.ZELA.utils (norm, esc, cleanText, fmtBRL, fmtNum, jsSafe, exportCSV)
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
  const { norm, esc, cleanText, fmtBRL, fmtNum, jsSafe, exportCSV, siglaSecretaria } = u;

  const MESES = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];

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

  function anoRegistro(d) {
    const ano = String(d.ano || "").trim();
    if (/^\d{4}$/.test(ano)) return ano;
    const m = String(d.data_inicial || "").match(/^(\d{4})-/);
    return m ? m[1] : "";
  }

  function mesNumero(d) {
    const m = String(d.data_inicial || "").match(/^\d{4}-(\d{2})/);
    if (!m) return "";
    const n = Number(m[1]);
    return n >= 1 && n <= 12 ? m[1] : "";
  }

  function mesAnoKey(d) {
    const ano = anoRegistro(d);
    const mes = mesNumero(d);
    return ano && mes ? `${ano}-${mes}` : "";
  }

  function mesRotulo(key) {
    const m = String(key || "").match(/^(\d{4})-(\d{2})$/);
    if (!m) return "Mês não informado";
    const nome = MESES[Number(m[2]) - 1] || "mês";
    return `${nome} de ${m[1]}`;
  }

  function dataBR(s) {
    return (s || "").split("-").reverse().join("/");
  }

  // ============================================================
  // INIT — chamado uma vez por página (Prefeitura ou Câmara)
  // ============================================================
  function init(prefix, dados) {
    const block = $(`diarias${prefix}Block`);
    if (!block) return;

    const lista = Array.isArray(dados) ? dados : [];
    const anoEl = $(`filtroAnoDiarias${prefix}`);
    const mesEl = $(`filtroMesDiarias${prefix}`);
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
    // Um servidor aparece com várias linhas (uma por mês). Para exibir o
    // SALÁRIO usa-se o mês mensal mais recente — nunca o mês de rescisão,
    // que traz verbas indenizatórias e faria um desligado parecer
    // supersalário (caso real: Diretor Geral com R$ 41 mil na saída).
    // Se a última linha da pessoa for rescisão, marca como desligada.
    const mapaFolha = (servidores) => {
      const porNome = new Map();
      (servidores || []).forEach(s => {
        const k = norm(s.nome);
        if (!porNome.has(k)) porNome.set(k, []);
        porNome.get(k).push(s);
      });
      const chaveMes = (s) => {
        const m = String(s.competencia || "").match(/^(\d{2})\/(\d{4})$/);
        return m ? m[2] + m[1] : "";
      };
      const ehRescisao = (s) => (s.tipos_folha || []).some(t => /rescis/i.test(String(t)));
      const escolhido = new Map();
      porNome.forEach((linhas, k) => {
        const ordenadas = linhas.slice().sort((a, b) => chaveMes(a).localeCompare(chaveMes(b)));
        const ultima = ordenadas[ordenadas.length - 1];
        const mensais = ordenadas.filter(s => !ehRescisao(s));
        const base = mensais.length ? mensais[mensais.length - 1] : ultima;
        escolhido.set(k, { ...base, __desligado: ehRescisao(ultima), __compSalario: base.competencia || "" });
      });
      return escolhido;
    };
    let pessoalPorNome = mapaFolha((orgPessoal || {}).servidores);
    const isPrefeitura = prefix === "Prefeitura";
    // Competência da folha usada no rótulo do salário (ex.: "06/2026").
    let compFolha = (orgPessoal || {}).competencia || "";
    if (!compFolha) {
      const m = String((orgPessoal || {}).status || "").match(/compet[eê]ncia\s*(\d{2}\/\d{4})/i);
      if (m) compFolha = m[1];
    }
    // O bundle slim não carrega os ~4 mil servidores da Prefeitura (peso).
    // Para exibir o salário ao lado das diárias, busca o pessoal.json completo
    // em segundo plano e re-renderiza quando chegar.
    if (isPrefeitura && pessoalPorNome.size === 0 && location.protocol !== "file:") {
      fetch("data/chunks/pessoal.json")
        .then(r => r.json())
        .then(full => {
          const org = (full || {}).prefeitura || {};
          if ((org.servidores || []).length) {
            pessoalPorNome = mapaFolha(org.servidores);
            if (org.competencia) compFolha = org.competencia;
            render();
          }
        })
        .catch(() => {});
    }

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

    const vinculoDiaria = (d) => {
      const servidor = pessoalPorNome.get(norm(d.funcionario));
      if (!servidor) {
        return { texto: "Vínculo não localizado", classe: "unknown", encontrado: false, comissionado: false };
      }
      const texto = servidor.comissionado_ou_similar
        ? "Comissionado"
        : cleanText(servidor.vinculo || "Servidor localizado");
      return {
        texto,
        classe: servidor.comissionado_ou_similar ? "commissioned" : "located",
        encontrado: true,
        comissionado: Boolean(servidor.comissionado_ou_similar),
        vencimentos: Number(servidor.vencimentos || 0),
        desligado: Boolean(servidor.__desligado),
        compSalario: servidor.__compSalario || "",
      };
    };

    const preencherAnos = () => {
      if (!anoEl) return;
      const atual = anoEl.value || "";
      const anos = Array.from(new Set(lista.map(anoRegistro).filter(Boolean))).sort((a, b) => b.localeCompare(a));
      if (!anos.length) return;
      anoEl.innerHTML = '<option value="">Todos os anos</option>' +
        anos.map(ano => `<option value="${esc(ano)}">Ano ${esc(ano)}</option>`).join("");
      anoEl.value = anos.includes(atual) ? atual : anos[0];
    };

    const preencherMeses = () => {
      if (!mesEl) return;
      const atual = mesEl.value || "";
      const ano = anoEl ? (anoEl.value || "") : "";
      const meses = Array.from(new Set(lista
        .filter(d => !ano || anoRegistro(d) === ano)
        .map(mesNumero)
        .filter(Boolean)
      )).sort();
      mesEl.innerHTML = '<option value="">Todos os meses</option>' +
        meses.map(mes => `<option value="${esc(mes)}">${esc(MESES[Number(mes) - 1])}</option>`).join("");
      mesEl.value = meses.includes(atual) ? atual : "";
    };

    const secretarias = Array.from(new Set(lista.map(dimSecretaria).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    if (secEl && secretarias.length) {
      const first = secEl.querySelector("option").outerHTML || '<option value="">Todos</option>';
      secEl.innerHTML = first + secretarias.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    }
    preencherAnos();
    preencherMeses();

    const filtrosAtuais = () => ({
      ano: anoEl ? (anoEl.value || "") : "",
      mes: mesEl ? (mesEl.value || "") : "",
      sec: secEl ? (secEl.value || "") : "",
      q: norm(buscaEl ? (buscaEl.value || "") : ""),
      faixa: valorEl ? (valorEl.value || "") : "",
      ordem: ordemEl ? (ordemEl.value || "valor_desc") : "valor_desc",
    });

    const passaFiltros = (d, f, usarMes) => (
      (!f.ano || anoRegistro(d) === f.ano) &&
      (!usarMes || !f.mes || mesNumero(d) === f.mes) &&
      (!f.sec || dimSecretaria(d) === f.sec) &&
      (!f.faixa ||
        (f.faixa === "1000" && Number(d.valor_total || 0) >= 1000) ||
        (f.faixa === "500-999" && Number(d.valor_total || 0) >= 500 && Number(d.valor_total || 0) < 1000) ||
        (f.faixa === "0-499" && Number(d.valor_total || 0) < 500)
      ) &&
      (!f.q ||
        norm(d.funcionario).includes(f.q) ||
        norm(d.destino).includes(f.q) ||
        norm(d.origem).includes(f.q) ||
        norm(d.finalidade).includes(f.q) ||
        norm(d.historico).includes(f.q) ||
        norm(d.secretaria).includes(f.q) ||
        norm(d.cargo).includes(f.q)
      )
    );

    const sorters = {
      valor_desc: (a, b) => (b.valor_total || 0) - (a.valor_total || 0),
      qtd_desc: (a, b) => (b.quantidade || 0) - (a.quantidade || 0) || (b.valor_total || 0) - (a.valor_total || 0),
      valor_unit_desc: (a, b) => (b.valor_unitario || 0) - (a.valor_unitario || 0),
      data_desc: (a, b) => String(b.data_inicial || "").localeCompare(String(a.data_inicial || "")),
      secretaria: (a, b) => dimSecretaria(a).localeCompare(dimSecretaria(b), "pt-BR"),
    };

    const novoGrupo = (d, periodoKey) => {
      const funcao = funcaoDiaria(d);
      const vinculo = vinculoDiaria(d);
      return {
        nome: d.funcionario || "Não informado",
        funcao: funcao.texto,
        funcaoDetalhe: funcao.detalhe,
        vinculo: vinculo.texto,
        vinculoClasse: vinculo.classe,
        comissionado: vinculo.comissionado,
        // Salário bruto do mês de referência da folha (cruzado por nome).
        // Exibido SEPARADO das diárias: diária é indenização, não remuneração.
        salario: Number(vinculo.vencimentos || 0),
        salarioComp: vinculo.compSalario || "",
        desligado: Boolean(vinculo.desligado),
        secretaria: dimSecretaria(d),
        periodoKey: periodoKey || "",
        periodoRotulo: periodoKey ? mesRotulo(periodoKey) : "",
        valor: 0,
        qtd: 0,
        registros: 0,
      };
    };

    const somaGrupo = (g, d) => {
      const funcao = funcaoDiaria(d);
      if (!g.funcao || g.funcao === "Função não informada na fonte") {
        g.funcao = funcao.texto;
        g.funcaoDetalhe = funcao.detalhe;
      }
      g.valor += Number(d.valor_total || 0);
      g.qtd += Number(d.quantidade || 0);
      g.registros += 1;
    };

    const rankingPorPessoa = (arr) => {
      const grupos = {};
      arr.forEach(d => {
        const key = norm(d.funcionario) || "sem nome";
        grupos[key] ||= novoGrupo(d, "");
        somaGrupo(grupos[key], d);
      });
      return Object.values(grupos).sort((a, b) => b.valor - a.valor);
    };

    const rankingPorPessoaMes = (arr) => {
      const grupos = {};
      arr.forEach(d => {
        const periodo = mesAnoKey(d);
        if (!periodo) return;
        const key = `${periodo}|${norm(d.funcionario) || "sem nome"}`;
        grupos[key] ||= novoGrupo(d, periodo);
        somaGrupo(grupos[key], d);
      });
      return Object.values(grupos).sort((a, b) => b.valor - a.valor);
    };

    const renderRankingRows = (ranking, modo) => {
      if (!ranking.length) {
        return '<div class="empty empty--small">Sem registros suficientes para este ranking.</div>';
      }
      return ranking.slice(0, 15).map((g, i) => {
        const divisor = isPrefeitura ? g.registros : g.qtd;
        const media = g.valor / (divisor || 1);
        const unidade = isPrefeitura ? "registro" : "diária";
        const volume = isPrefeitura
          ? `${fmtNum(g.registros)} registro(s)`
          : `${fmtNum(g.qtd)} diária(s)`;
        const periodo = modo === "mensal"
          ? `<strong>${esc(g.periodoRotulo || "Mês não informado")}</strong>`
          : `<strong>${volume}</strong>`;
        const detalhe = modo === "mensal"
          ? `${volume} · média ${fmtBRL(media)}`
          : `média ${fmtBRL(media)}/${unidade}`;
        return `
          <div class="diaria-rank-row diaria-rank-row--compact">
            <span class="diaria-rank-row__pos">${i + 1}</span>
            <span class="diaria-rank-row__person">
              <strong>${esc(cleanText(g.nome))}</strong>
              <small>${esc(cleanText(g.funcao))}</small>
              <span class="diaria-person-tags">
                <em class="diaria-person-tag diaria-person-tag--${esc(g.vinculoClasse)}">${esc(cleanText(g.vinculo))}</em>
              </span>
            </span>
            <span class="diaria-rank-row__function" title="${esc(cleanText(g.secretaria))}">
              ${esc(siglaSecretaria(g.secretaria))}
              <small>${esc(cleanText(g.funcaoDetalhe))}</small>
            </span>
            <span class="diaria-rank-row__period">
              ${periodo}
              <small>${esc(detalhe)}</small>
            </span>
            <span class="diaria-rank-row__valores">
              <span class="dr-val dr-val--diarias" title="Dinheiro pago pelas viagens a serviço (hospedagem, alimentação). É reembolso/ajuda de custo — NÃO é aumento de salário.">
                <small>✈️ recebeu de diárias</small>
                <b>${fmtBRL(g.valor)}</b>
              </span>
              ${g.salario > 0
                ? `<span class="dr-val dr-val--salario" title="Salário bruto de um mês comum de trabalho (${esc(g.salarioComp || compFolha || "última folha")}), sem 13º, férias ou rescisão. É outro dinheiro: um não entra no outro.">
                     <small>💼 salário por mês</small>
                     <b>${fmtBRL(g.salario)}</b>
                   </span>`
                : `<span class="dr-val dr-val--salario dr-val--vazio"><small>💼 salário</small><b>não localizado</b></span>`}
              ${g.desligado ? `<small class="dr-val__nota" title="A última folha desta pessoa neste órgão foi de rescisão: ela se desligou. As diárias listadas são do período em que trabalhava aqui.">⚠️ já saiu do órgão</small>` : ""}
            </span>
          </div>`;
      }).join("");
    };

    const render = () => {
      const f = filtrosAtuais();
      const baseAnual = lista.filter(d => passaFiltros(d, f, false));
      let view = lista.filter(d => passaFiltros(d, f, true));
      view = view.slice().sort(sorters[f.ordem] || sorters.valor_desc);

      const total = view.reduce((s, d) => s + Number(d.valor_total || 0), 0);
      const qtd = view.reduce((s, d) => s + Number(d.quantidade || 0), 0);
      const pessoas = new Set(view.map(d => norm(d.funcionario)).filter(Boolean)).size;
      const media = qtd ? total / qtd : 0;
      const rankingAnual = rankingPorPessoa(baseAnual);
      const rankingMensal = rankingPorPessoaMes(f.mes ? view : baseAnual);
      const topAnual = rankingAnual[0];
      const topMensal = rankingMensal[0];
      const periodoLabel = f.mes && f.ano ? `${MESES[Number(f.mes) - 1]} de ${f.ano}` : (f.ano ? `ano ${f.ano}` : "todos os anos");

      if (contadorEl) contadorEl.textContent = `${fmtNum(view.length)} registro(s) · ${fmtBRL(total)}`;
      if (statsEl) {
        statsEl.innerHTML = [
          { cls: "stat--navy", v: fmtBRL(total), l: isPrefeitura ? "Total em despesas de diárias" : "Total pago em diárias", s: `Soma do recorte: ${periodoLabel}` },
          { cls: "stat--gold", v: fmtNum(isPrefeitura ? view.length : qtd), l: isPrefeitura ? "Registros/empenhos" : "Quantidade de diárias", s: isPrefeitura ? "Consulta contábil da Prefeitura" : "Total informado na fonte" },
          { cls: "stat--teal", v: fmtBRL(isPrefeitura ? (total / (view.length || 1)) : media), l: isPrefeitura ? "Valor médio por registro" : "Valor médio por diária", s: isPrefeitura ? "Total dividido por registros" : "Total dividido pela quantidade" },
          { cls: "stat--navy", v: fmtNum(pessoas), l: "Pessoas no recorte", s: "Funcionários, comissionados ou vereadores distintos" },
          { cls: "stat--teal", v: topAnual ? fmtBRL(topAnual.valor) : fmtBRL(0), l: "Maior acumulado anual", s: topAnual ? cleanText(topAnual.nome) : "Sem registros no ano" },
          { cls: "stat--gold", v: topMensal ? fmtBRL(topMensal.valor) : fmtBRL(0), l: f.mes ? "Maior valor no mês" : "Maior valor mensal", s: topMensal ? `${cleanText(topMensal.nome)} · ${topMensal.periodoRotulo}` : "Sem registros mensais" },
        ].map(s => `
          <div class="stat ${s.cls}">
            <div class="stat__value">${s.v}</div>
            <div class="stat__label">${esc(s.l)}</div>
            <div class="stat__sub">${esc(s.s)}</div>
          </div>`).join("");
      }

      if (listaEl) {
        const parent = listaEl.parentElement;
        if (parent && !parent.querySelector(".diarias-note")) {
          const note = document.createElement("div");
          note.className = "report-note diarias-note";
          note.innerHTML = `
            <strong>Como ler este ranking (bem simples):</strong> cada pessoa tem DOIS valores, que são dinheiros diferentes.<br>
            <span style="display:inline-block;margin-top:4px">✈️ <strong>Diárias</strong> = o que ela recebeu pelas viagens a serviço no período (paga hotel, comida). É ajuda de custo — <strong>não é aumento de salário</strong>.</span><br>
            <span>💼 <strong>Salário por mês</strong> = o que ela ganha num mês comum de trabalho, sem 13º, férias ou rescisão.</span><br>
            <span class="small muted">Um valor não entra no outro. Diária alta não significa erro — significa muitas viagens: o certo é conferir destino, motivo e comprovantes na fonte oficial.</span>`;
          parent.insertBefore(note, rankingEl || listaEl);
        }
      }

      if (rankingEl) {
        rankingEl.innerHTML = `
          <div class="diarias-ranking__summary">
            <article>
              <span>Acumulado anual</span>
              <strong>${topAnual ? fmtBRL(topAnual.valor) : fmtBRL(0)}</strong>
              <small>${topAnual ? esc(cleanText(topAnual.nome)) : "Sem registros no recorte anual"}</small>
            </article>
            <article>
              <span>${f.mes ? "Recorte mensal" : "Maior mês individual"}</span>
              <strong>${topMensal ? fmtBRL(topMensal.valor) : fmtBRL(0)}</strong>
              <small>${topMensal ? `${esc(cleanText(topMensal.nome))} · ${esc(topMensal.periodoRotulo)}` : "Sem mês identificado"}</small>
            </article>
          </div>
          <div class="diarias-ranking__grid">
            <section class="diarias-ranking__panel">
              <div class="diarias-ranking__panel-head">
                <h4>Ranking acumulado anual</h4>
                <p>Total por pessoa no ano selecionado. Se houver busca, secretaria ou faixa de valor, o ranking respeita esses filtros.</p>
              </div>
              ${renderRankingRows(rankingAnual, "anual")}
            </section>
            <section class="diarias-ranking__panel">
              <div class="diarias-ranking__panel-head">
                <h4>${f.mes ? "Ranking do mês selecionado" : "Ranking mensal"}</h4>
                <p>${f.mes ? "Compara apenas o mês escolhido no filtro." : "Mostra os maiores totais de uma mesma pessoa dentro de um mês."}</p>
              </div>
              ${renderRankingRows(rankingMensal, "mensal")}
            </section>
          </div>`;
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

      const fonteOficialDiaria = ((D.diarias || {}).fontes || {})[prefix.toLowerCase()] || "https://transparencia.varginha.mg.gov.br/portal-transparencia/consultas/diarias";
      listaEl.innerHTML = view.slice(0, 80).map(d => {
        const funcao = funcaoDiaria(d);
        const vinculo = vinculoDiaria(d);
        const seloConfianca = window.ZELA.dataTrustSeal
          ? window.ZELA.dataTrustSeal("diaria", {
              fonte: isPrefeitura ? "despesas/diarias da Prefeitura" : "diarias da Camara",
              escopo: isPrefeitura ? "registro contabil classificado" : "diaria individual estruturada",
              risco: isPrefeitura ? "pode nao ser uma viagem individual" : "nao comprova resultado publico da viagem",
              acao: "conferir autorizacao, finalidade e prestacao de contas",
            })
          : "";
        return `
        <article class="diaria-card">
          <div class="diaria-card__value">
            <strong>${fmtBRL(d.valor_total || 0)}</strong>
            ${Number(d.valor_total) >= 1000 ? `<div class="percapita-mini" style="font-size: 0.72em; color: var(--muted); margin-top: 4px;" title="Este valor de diárias dividido por cada morador de Varginha">≈ ${fmtBRL(Number(d.valor_total) / 135159)} por morador</div>` : ""}
            <span>${isPrefeitura ? "1 registro/empenho" : `${fmtNum(d.quantidade || 0)} diária(s)`} · ${fmtBRL(d.valor_unitario || 0)} ${isPrefeitura ? "no registro" : "cada"}</span>
          </div>
          <div class="diaria-card__body">
            <h4>${esc(cleanText(d.funcionario || "Funcionário não informado"))}</h4>
            <div class="diaria-card__role">
              <strong>Função/cargo:</strong> ${esc(cleanText(funcao.texto))}
              <small>${esc(cleanText(funcao.detalhe))}</small>
              <em class="diaria-person-tag diaria-person-tag--${esc(vinculo.classe)}">${esc(cleanText(vinculo.texto))}</em>
            </div>
            <p>${esc(cleanText(d.finalidade || d.historico || "Finalidade não informada"))}</p>
            <div class="diaria-card__meta">
              <span title="${esc(cleanText(dimSecretaria(d)))}">${esc(siglaSecretaria(dimSecretaria(d)))}</span>
              ${d.destino ? `<span>Destino: ${esc(cleanText(d.destino))}</span>` : ""}
              ${d.numero ? `<span>Nº ${esc(d.numero)}</span>` : ""}
              ${d.data_inicial ? `<span>${dataBR(d.data_inicial)}${d.data_final && d.data_final !== d.data_inicial ? " a " + dataBR(d.data_final) : ""}</span>` : ""}
            </div>
            ${seloConfianca}
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

    if (anoEl) {
      anoEl.addEventListener("change", () => {
        preencherMeses();
        render();
      });
    }
    [mesEl, secEl, buscaEl, valorEl, ordemEl].forEach(el => {
      if (!el) return;
      el.addEventListener(el.tagName === "INPUT" ? "input" : "change", render);
    });
    render();

    // CSV export button para diárias
    if (lista.length && contadorEl) {
      const csvBtnD = document.createElement("button");
      csvBtnD.className = "btn-csv";
      csvBtnD.textContent = "↓ CSV";
      csvBtnD.title = `Baixar diárias de ${prefix} como CSV`;
      csvBtnD.style.marginLeft = "8px";
      contadorEl.after(csvBtnD);
      csvBtnD.addEventListener("click", () => {
        const f = filtrosAtuais();
        const view = lista.filter(d => passaFiltros(d, f, true));
        exportCSV(view.map(d => ({
          funcionario: cleanText(d.funcionario || ""),
          cargo: cleanText(d.cargo || ""),
          vinculo: cleanText(vinculoDiaria(d).texto || ""),
          secretaria: cleanText(dimSecretaria(d)),
          destino: cleanText(d.destino || ""),
          finalidade: cleanText(d.finalidade || d.historico || ""),
          data_inicial: d.data_inicial || "",
          data_final: d.data_final || "",
          mes: mesAnoKey(d),
          quantidade: d.quantidade || "",
          valor_unitario: d.valor_unitario || 0,
          valor_total: d.valor_total || 0,
          ano: anoRegistro(d),
        })), [
          { key: "funcionario",    label: "Funcionário" },
          { key: "cargo",          label: "Cargo" },
          { key: "vinculo",        label: "Vínculo" },
          { key: "secretaria",     label: "Secretaria" },
          { key: "destino",        label: "Destino" },
          { key: "finalidade",     label: "Finalidade" },
          { key: "data_inicial",   label: "Data Início" },
          { key: "data_final",     label: "Data Fim" },
          { key: "mes",            label: "Mês/Ano" },
          { key: "quantidade",     label: "Qtd Diárias" },
          { key: "valor_unitario", label: "Valor Unit. (R$)" },
          { key: "valor_total",    label: "Valor Total (R$)" },
          { key: "ano",            label: "Ano" },
        ], `diarias-${prefix.toLowerCase()}-varginha-${new Date().toISOString().slice(0,10)}.csv`);
      });
    }
  }

  window.ZELA.diarias = Object.freeze({
    init,
    abrirFiscalizacaoDiaria,
  });
})();
