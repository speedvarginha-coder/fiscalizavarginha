/* Folha de pessoal: filtros, consolidação mensal e exportação. */
(function () {
  "use strict";
  window.FISCALIZA = window.FISCALIZA || {};
  const D = window.FISCALIZA_DATA || {};
  const $ = (id) => document.getElementById(id);
  const { fmtBRL, fmtNum, cleanText, esc, norm, highlight, exportCSV, casaBusca } = window.FISCALIZA.utils;

  function initPessoal() {
    const pesSlim = D.pessoal || {};
    // A folha nominal só é solicitada pela página de Pessoal.
    const hasPrefServs = (pesSlim.prefeitura?.servidores?.length || 0) > 0;
    if (!hasPrefServs && location.protocol !== "file:") {
      fetch("data/chunks/pessoal.json")
        .then(r => { if (!r.ok) throw new Error("Folha indisponível"); return r.json(); })
        .then(fullPes => _runInitPessoal(fullPes))
        .catch(() => {
          const lista = $("listaPessoal");
          if (!lista) return;
          lista.innerHTML = '<p role="status">Não foi possível carregar a folha. Tente novamente para consultar os registros.</p><button type="button" class="btn">Tentar novamente</button>';
          lista.querySelector("button").addEventListener("click", initPessoal, { once: true });
        });
    } else {
      _runInitPessoal(pesSlim);
    }
  }

  function _runInitPessoal(pes) {
    const camaraServ = (pes.camara || {}).servidores || [];
    const prefServ   = (pes.prefeitura || {}).servidores || [];
    
    // Competência (mês) da folha: prefere o campo dedicado e cai no texto do
    // status como fallback. A folha pode ser de um mês fechado anterior, então
    // é importante deixar claro a qual mês os valores se referem.
    // O coletor grava a competencia em resumo.competencia_referencia; a chave
    // na raiz do orgao so aparece em alguns caminhos de coleta. Ler so a raiz
    // deixava #rankingPeriodoInfo vazio e o ranking sem mes carimbado.
    const resPref = (pes.prefeitura && pes.prefeitura.resumo) || {};
    const resCam = (pes.camara && pes.camara.resumo) || {};
    let compPref = (pes.prefeitura && pes.prefeitura.competencia) || resPref.competencia_referencia || "";
    let compCam = (pes.camara && pes.camara.competencia) || resCam.competencia_referencia || "";
    const prefStatusText = (pes.prefeitura && pes.prefeitura.status) || "";
    const camStatusText = (pes.camara && pes.camara.status) || "";
    if (!compPref) { const m = prefStatusText.match(/compet[eê]ncia\s*(\d{2}\/\d{4})/i); if (m) compPref = m[1]; }
    if (!compCam) { const m = camStatusText.match(/compet[eê]ncia\s*(\d{2}\/\d{4})/i); if (m) compCam = m[1]; }

    const competenciaValida = (c) => /^(0[1-9]|1[0-2])\/\d{4}$/.test(String(c || ""));
    const competenciaLinha = (s, orgao) => competenciaValida(s.competencia)
      ? s.competencia : (orgao === "Câmara" ? compCam : compPref);
    const processarEConsolidar = (servidores, orgao, mes = "") => {
      const grupos = {};
      servidores.forEach(s => {
        const chave = s.matricula ? `${s.matricula}` : (s.id_registro || `${s.nome}-${s.cargo}`);
        if (!grupos[chave]) {
          grupos[chave] = [];
        }
        grupos[chave].push(s);
      });

      const consolidados = [];
      // Ordena o histórico pela competência real (MM/AAAA → AAAAMM) quando o
      // registro traz o mês; sem ela, mantém a ordem original como fallback.
      // Antes o "mais recente" era o último da lista — dependia da ordem em
      // que a API devolvia as linhas.
      const chaveComp = (s) => {
        const m = String(competenciaLinha(s, orgao) || "").match(/^(\d{2})\/(\d{4})$/);
        return m ? m[2] + m[1] : "";
      };
      Object.keys(grupos).forEach(chave => {
        const limite = mes ? mes.slice(3) + mes.slice(0, 2) : "";
        const historico = grupos[chave].filter(s => !mes || (chaveComp(s) && chaveComp(s) <= limite))
          .sort((a, b) => chaveComp(a).localeCompare(chaveComp(b)));
        if (!historico.length || (mes && competenciaLinha(historico[historico.length - 1], orgao) !== mes)) return;
        const maisRecente = { ...historico[historico.length - 1], orgao };
        maisRecente.competencia = competenciaLinha(maisRecente, orgao);
        
        const vencimentosValidos = historico
          .map(h => Number(h.vencimentos) || 0)
          .filter(v => v > 0);
        
        if (vencimentosValidos.length > 1) {
          const vencNormal = Math.min(...vencimentosValidos);
          const vencAtual = Number(maisRecente.vencimentos) || 0;
          if (vencAtual > vencNormal * 1.25) {
            maisRecente.isAtipico = true;
            maisRecente.vencimentoNormal = vencNormal;
          }
        }
        // Tipos de folha reais do Betha (Mensal, Férias, 13º…): quando o mês
        // exibido tem verba além da mensal, o alerta vira fato confirmado em
        // vez de estimativa por heurística de valor.
        const tiposReais = (maisRecente.tipos_folha || [])
          .filter(t => !/^mensal/i.test(String(t)));
        if (tiposReais.length) {
          maisRecente.isAtipico = true;
          maisRecente.tiposFolhaExtra = tiposReais.join(", ");
          if (!maisRecente.vencimentoNormal && vencimentosValidos.length > 1) {
            maisRecente.vencimentoNormal = Math.min(...vencimentosValidos);
          }
        }
        consolidados.push(maisRecente);
      });
      return consolidados;
    };

    const camaraConsolidado = processarEConsolidar(camaraServ, "Câmara");
    const prefeituraConsolidado = processarEConsolidar(prefServ, "Prefeitura");

    // Mudança de órgão: o MESMO nome completo nas duas folhas ganha aviso —
    // evita leitura errada de "recebe dos dois". Nome idêntico ainda pode ser
    // homônimo, então o aviso pede conferência em vez de afirmar vínculo.
    const nomeKey = (s) => String(s.nome || "").normalize("NFD")
      .replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
    const nomesCamara = new Set(camaraConsolidado.map(nomeKey));
    const nomesPref = new Set(prefeituraConsolidado.map(nomeKey));
    camaraConsolidado.forEach(s => {
      if (nomesPref.has(nomeKey(s))) s.outroOrgao = "Prefeitura";
    });
    prefeituraConsolidado.forEach(s => {
      if (nomesCamara.has(nomeKey(s))) s.outroOrgao = "Câmara";
    });

    const todos = [
      ...camaraConsolidado,
      ...prefeituraConsolidado
    ];

    const buscaEl    = $("buscaServidor");
    const orgaoEl    = $("filtroOrgao");
    const tipoEl     = $("filtroTipo");
    const mesEl      = $("filtroMesPessoal");
    const listaEl    = $("listaPessoal");
    const contadorEl = $("pessoalContador");

    // Banner deixando explícito a qual mês (competência) a folha se refere.
    const _mesesPt = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
      "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    const fmtComp = (c) => {
      const m = /^(\d{2})\/(\d{4})$/.exec(c || "");
      return m ? `${_mesesPt[+m[1] - 1] || m[1]}/${m[2]}` : (c || "");
    };
    const historicoPorMes = new Map();
    const folhasPorMes = new Map();
    const pedidosFolha = new Map();
    const compararEl = $("compararMesPessoal");
    const mesesDisponiveis = () => [...new Set([
      ...prefServ.map(s => competenciaLinha(s, "Prefeitura")),
      ...camaraServ.map(s => competenciaLinha(s, "Câmara")),
      ...historicoPorMes.keys(),
    ].filter(competenciaValida))].sort((a, b) => (b.slice(3) + b.slice(0, 2)).localeCompare(a.slice(3) + a.slice(0, 2)));
    const obterFolha = async (mes) => {
      if (folhasPorMes.has(mes)) return folhasPorMes.get(mes);
      if (!historicoPorMes.has(mes)) return pes;
      if (!pedidosFolha.has(mes)) {
        const chave = historicoPorMes.get(mes);
        const pedido = (async () => {
          const folha = location.protocol === "file:" ? D[chave] : await fetch(`data/chunks/${chave}.json`).then(r => {
            if (!r.ok) throw new Error("Folha histórica indisponível");
            return r.json();
          });
          if (!folha || folha.competencia !== mes || !["prefeitura", "camara"].some(org => Array.isArray(folha[org]?.servidores))) throw new Error("Competência inválida");
          for (const org of ["prefeitura", "camara"]) {
            if ((folha[org]?.servidores || []).some(s => s.competencia !== mes)) throw new Error("Registro fora do mês");
          }
          folhasPorMes.set(mes, folha);
          return folha;
        })().finally(() => pedidosFolha.delete(mes));
        pedidosFolha.set(mes, pedido);
      }
      return pedidosFolha.get(mes);
    };
    const registrosDaFolha = (folha, mes) => [
      ...processarEConsolidar(folha.camara?.servidores || [], "Câmara", mes),
      ...processarEConsolidar(folha.prefeitura?.servidores || [], "Prefeitura", mes),
    ];
    const metadadosFonte = (s) => {
      const mes = competenciaLinha(s, s.orgao);
      const folha = folhasPorMes.get(mes) || pes;
      const dados = folha[s.orgao === "Câmara" ? "camara" : "prefeitura"] || {};
      const fonte = /^https:\/\//.test(dados.fonte || "") ? dados.fonte : "";
      return { fonte, coletado: dados.coletado_em || folha.coletado_em || (mes === compPref || mes === compCam ? pes.coletado_em : "") || "Não informada",
        situacao: dados.status_cobertura || dados.status || "Não informada" };
    };
    let filtroMesAlterado = false;
    const atualizarMeses = () => {
      if (!mesEl) return;
      const selecionado = mesEl.value;
      const meses = mesesDisponiveis();
      mesEl.replaceChildren(new Option("Último registro de cada vínculo", ""),
        ...meses.map(mes => new Option(fmtComp(mes), mes)));
      mesEl.value = meses.includes(selecionado) ? selecionado : "";
      if (compararEl) {
        const anterior = compararEl.value;
        compararEl.replaceChildren(new Option("Não comparar", ""), ...meses.map(mes => new Option(fmtComp(mes), mes)));
        compararEl.value = meses.includes(anterior) ? anterior : "";
      }
    };
    atualizarMeses();
    let refEl;
    if (listaEl) {
      refEl = document.getElementById("pessoalCompetencia");
      if (!refEl) {
        refEl = document.createElement("p");
        refEl.id = "pessoalCompetencia";
        refEl.style.cssText = "margin:0 0 14px;padding:9px 13px;background:#eef4fb;border-left:3px solid #1565c0;border-radius:4px;font-size:0.92em;color:#23405c;line-height:1.45;";
        listaEl.before(refEl);
      }
    }

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
    let csvBtnP = null;
    let renderVersion = 0;

    const _renderServCard = (s, indice) => {
      const isCom = s.comissionado_ou_similar || /COMISSION/i.test(s.lotacao || "");
      const comp = competenciaLinha(s, s.orgao);
      const tagOutroOrgao = s.outroOrgao
        ? `<div class="tag-periodo-alerta" style="display:inline-block;margin-top:6px;font-size:0.82em;padding:3px 8px;border-radius:4px;background:#e8f0fe;color:#1a4d8f;border:1px solid #b6d0f5" title="O mesmo nome completo consta na folha dos dois órgãos no ano — em geral indica mudança de órgão (exoneração + nova nomeação). Nome idêntico ainda pode ser homônimo: confira a matrícula na fonte oficial antes de concluir.">↔ Consta também na folha da ${esc(s.outroOrgao)} (mudança de órgão ou homônimo)</div>`
        : "";
      const tagAtipico = s.isAtipico
        ? `<div class="tag-periodo-alerta tag-periodo-alerta--warning" style="display:inline-block;margin-top:6px;font-size:0.85em;padding:4px 8px;border-radius:4px;background:#fff3cd;color:#856404;border:1px solid #ffeeba" title="Este valor bruto inclui benefícios adicionais como 13º salário, férias ou gratificação natalina. O salário base normal estimado é de ${fmtBRL(s.vencimentoNormal)}.">⚠️ ${s.tiposFolhaExtra ? (/rescis/i.test(s.tiposFolhaExtra) ? `${esc(s.tiposFolhaExtra)} — desligamento do órgão; valor inclui verbas indenizatórias, não é salário` : `Inclui ${esc(s.tiposFolhaExtra)} (fonte Betha)`) : "Contém 13º/Férias"}${s.vencimentoNormal ? ` — base mensal: ${fmtBRL(s.vencimentoNormal)}` : ""}</div>`
        : "";
      return `<article class="contrato">
        <div class="contrato__valor" style="min-width: 140px;">
          <span class="vencimento-titulo">Salário Bruto (Sem Descontos)</span>
          <strong class="vencimento-valor">${fmtBRL(s.vencimentos)}</strong>
          <div class="small muted">Mensal (${comp || 'ref. mês'})</div>
        </div>
        <div>
          <p class="contrato__nome">
            ${highlight(s.nome, _pessoalQ)}
            ${isCom ? '<span class="em__status em__status--no">Comissionado</span>' : '<span class="em__status em__status--ok">Servidor</span>'}
            <span class="tag-orgao-${s.orgao === "Câmara" ? "camara" : "prefeitura"}">${esc(s.orgao)}</span>
          </p>
          <p class="contrato__obj"><strong>Cargo/Lotação:</strong> ${highlight(s.lotacao, _pessoalQ)}</p>
          <div class="contrato__meta">
            <span><strong>Salário Líquido (Dinheiro na Conta):</strong> <strong>${fmtBRL(s.liquido || 0)}</strong></span>
            ${s.matricula ? `<span><strong>Matrícula:</strong> ${s.matricula}</span>` : ""}
          </div>
          ${tagAtipico}${tagOutroOrgao}
          <button type="button" class="btn-link" data-pessoal-historico="${indice}" aria-label="Ver histórico de ${esc(s.nome || "servidor")}">Ver histórico</button>
        </div>
      </article>`;
    };

    const _doRenderServidores = () => {
      const slice = _pessoalView.slice(0, _pessoalOffset + PESSOAL_PAGE);
      listaEl.innerHTML = slice.map(_renderServCard).join("");
      listaEl.querySelectorAll("[data-pessoal-historico]").forEach(button => button.addEventListener("click", () => abrirHistoricoServidor(_pessoalView[Number(button.dataset.pessoalHistorico)])));
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

    const render = async () => {
      const version = ++renderVersion;
      _pessoalOffset = 0;
      const q = norm(buscaEl.value.trim());
      const orgao = orgaoEl.value;
      const tipo = tipoEl.value;
      const mes = mesEl?.value || "";
      if (mes && historicoPorMes.has(mes) && (mes !== compPref || mes !== compCam) && !folhasPorMes.has(mes)) {
        _pessoalView = [];
        if (csvBtnP) csvBtnP.disabled = true;
        $("pessoalLoadMore")?.remove();
        $("pessoalEmpty").style.display = "none";
        contadorEl.textContent = "Carregando mês selecionado…";
        listaEl.innerHTML = '<p role="status">Carregando a folha do mês selecionado…</p>';
        statusPaineis(`Carregando ${fmtComp(mes)}…`);
        if (refEl) refEl.textContent = `Consultando ${fmtComp(mes)}…`;
        try {
          await obterFolha(mes);
        } catch (_) {
          if (mesEl.value !== mes || version !== renderVersion) return;
          contadorEl.textContent = "Mês não carregado";
          statusPaineis("Não foi possível carregar o mês selecionado.");
          listaEl.innerHTML = '<p role="status">Não foi possível carregar esta folha. Nenhum valor de outro mês foi substituído.</p><button type="button" class="btn">Tentar novamente</button>';
          listaEl.querySelector("button").addEventListener("click", render, { once: true });
          return;
        }
        if (mesEl.value !== mes || version !== renderVersion) return;
      }
      if (csvBtnP) csvBtnP.disabled = false;
      const folhaMes = folhasPorMes.get(mes);
      const registrosDoMes = mes ? [
        ...processarEConsolidar(folhaMes ? folhaMes.camara?.servidores || [] : camaraServ, "Câmara", mes),
        ...processarEConsolidar(folhaMes ? folhaMes.prefeitura?.servidores || [] : prefServ, "Prefeitura", mes),
      ] : todos;
      renderPaineis(registrosDoMes, mes || compPref, mes || compCam);
      if (mes && refEl) {
        const cobertura = ["Prefeitura", "Câmara"].map(orgaoNome =>
          `${orgaoNome}: ${registrosDoMes.some(s => s.orgao === orgaoNome) ? "com registros" : "sem registros coletados neste mês"}`);
        refEl.innerHTML = `<strong>Mês selecionado: ${esc(fmtComp(mes))}</strong> — ${cobertura.join(" · ")}. Confira os valores no portal oficial.`;
      } else if (refEl) {
        const partes = [];
        if (compPref) partes.push(`Prefeitura: <strong>${esc(fmtComp(compPref))}</strong>`);
        if (compCam) partes.push(`Câmara: <strong>${esc(fmtComp(compCam))}</strong>`);
        refEl.innerHTML = partes.length
          ? `<strong>Folha de referência</strong> — ${partes.join(" · ")}. Exibido o último registro disponível de cada vínculo; confira o mês de cada valor no portal oficial.`
          : "Confira a competência (mês) da folha no portal oficial — os valores podem se referir a um mês fechado anterior.";
      }

      _pessoalQ = q;
      _pessoalView = registrosDoMes.filter(s => {
        if (mes) {
          if (s.orgao === "Câmara" && nomesPref.has(nomeKey(s))) s.outroOrgao = "Prefeitura";
          if (s.orgao === "Prefeitura" && nomesCamara.has(nomeKey(s))) s.outroOrgao = "Câmara";
        }
        return passaFiltro(s, { q, orgao, tipo });
      });

      const com = _pessoalView.filter(s => s.comissionado_ou_similar || /COMISSION/i.test(s.lotacao || ""));
      const folhaCom = com.reduce((sum, s) => sum + (Number(s.vencimentos) || 0), 0);

      // Os cartoes contam a VISAO FILTRADA. Sem dizer isso na tela, uma busca
      // que nao acha nada faz o painel anunciar "Cargos Comissionados 0" e
      // "R$ 0,00" com cara de numero oficial do municipio.
      const filtrando = Boolean(q || orgao || tipo || mes);
      const sufixo = filtrando ? " no filtro atual" : "";

      if ($("totServidores")) $("totServidores").textContent = filtrando ? _pessoalView.length : todos.length;
      if ($("totComissionados")) $("totComissionados").textContent = com.length;
      if ($("pctComissionados")) {
        const base = filtrando ? _pessoalView.length : todos.length;
        $("pctComissionados").textContent =
          (base ? ((com.length / base) * 100).toFixed(1) + "%" : "0%") + " do total" + sufixo;
      }
      if ($("custoFolha")) $("custoFolha").textContent = fmtBRL(folhaCom);
      if ($("custoFolhaSub")) $("custoFolhaSub").textContent = "Apenas comissionados" + sufixo;

      contadorEl.textContent = `${_pessoalView.length} registro(s) encontrado(s)`;
      compararPeriodos(registrosDoMes, mes, { q, orgao, tipo });

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

    function passaFiltro(s, { q, orgao, tipo }) {
      const isCom = s.comissionado_ou_similar || /COMISSION/i.test(s.lotacao || "");
      return (!q || casaBusca([s.nome, s.lotacao].join(" "), q)) &&
        (!orgao || norm(s.orgao).includes(orgao)) && (!tipo || (tipo === "comissionado" ? isCom : !isCom));
    }

    function tabelaPessoal(titulo, colunas, linhas) {
      return `<div role="region" tabindex="0" aria-label="${esc(titulo)}" style="overflow:auto"><table class="pessoal-tabela"><caption>${esc(titulo)}</caption><thead><tr>${colunas.map(c => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${linhas.join("")}</tbody></table></div>`;
    }

    function variacao(atual, anterior) {
      const diferenca = Math.round((atual - anterior) * 100) / 100;
      const percentual = anterior <= 0 ? "percentual não calculável com base zero ou negativa" :
        `${diferenca > 0 ? "+" : ""}${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(diferenca / anterior * 100)}%`;
      return `${diferenca > 0 ? "+" : ""}${fmtBRL(diferenca)} (${percentual})`;
    }

    async function compararPeriodos(registros, mes, filtros) {
      const alvo = $("pessoalComparacao");
      if (!alvo || !compararEl) return;
      const anterior = compararEl.value;
      if (!anterior) { alvo.textContent = "Escolha um mês de comparação para consultar a diferença dos valores."; return; }
      const atual = mes || (compPref === compCam ? compPref : "");
      if (!atual) { alvo.textContent = "Escolha um único mês da folha para comparar."; return; }
      if (anterior === atual) { alvo.textContent = "Escolha meses diferentes para comparar."; return; }
      const version = renderVersion;
      alvo.textContent = `Carregando ${fmtComp(anterior)} para comparação…`;
      try {
        const folha = await obterFolha(anterior);
        if (version !== renderVersion || compararEl.value !== anterior) return;
        const antes = registrosDaFolha(folha, anterior).filter(s => passaFiltro(s, filtros));
        const agora = registros.filter(s => passaFiltro(s, filtros));
        const linhas = ["Prefeitura", "Câmara"].filter(o => !filtros.orgao || norm(o).includes(filtros.orgao)).map(orgao => {
          const a = agora.filter(s => s.orgao === orgao), b = antes.filter(s => s.orgao === orgao);
          if (!a.length || !b.length) return `<tr><th scope="row">${esc(orgao)}</th><td colspan="5">Sem registros no recorte de ${esc(!a.length ? atual : anterior)}; comparação indisponível.</td></tr>`;
          const soma = (rows, campo) => Math.round(rows.reduce((s, r) => s + (Number(r[campo]) || 0), 0) * 100) / 100;
          const brutoA = soma(a, "vencimentos"), brutoB = soma(b, "vencimentos");
          return `<tr><th scope="row">${esc(orgao)}</th><td>${b.length} → ${a.length}</td><td>${fmtBRL(brutoB)}</td><td>${fmtBRL(brutoA)}</td><td>${variacao(brutoA, brutoB)}</td><td>${variacao(soma(a, "liquido"), soma(b, "liquido"))}</td></tr>`;
        });
        alvo.innerHTML = tabelaPessoal(`${fmtComp(atual)} em comparação com ${fmtComp(anterior)} — filtros da lista`, ["Órgão", "Registros antes → agora", `Bruto ${anterior}`, `Bruto ${atual}`, "Diferença bruta", "Diferença líquida"], linhas);
      } catch (_) {
        if (version === renderVersion) {
          alvo.innerHTML = '<p>Não foi possível carregar o mês de comparação. A lista atual foi mantida.</p><button type="button" class="btn">Tentar comparação novamente</button>';
          alvo.querySelector("button").addEventListener("click", () => compararPeriodos(registros, mes, filtros), { once: true });
        }
      }
    }

    let historyVersion = 0;
    async function abrirHistoricoServidor(servidor) {
      if (!servidor || !window.FISCALIZA.dossie?.abrirComHtml) return;
      const version = ++historyVersion;
      window.FISCALIZA.dossie.abrirComHtml(`<section data-pessoal-historia="${version}"><h2>Histórico de ${esc(servidor.nome)}</h2><p>${esc(servidor.orgao)}. Correspondências por nome podem incluir homônimos ou outros vínculos; confira cargo e matrícula na fonte.</p><p role="status">Carregando competências disponíveis…</p><div class="pessoal-historia-tabela"></div></section>`);
      const dialog = $("modalFiscaliza");
      dialog.setAttribute("aria-label", `Histórico de ${servidor.nome}`);
      dialog.addEventListener("close", () => dialog.removeAttribute("aria-label"), { once: true });
      const ativo = () => $("modalFiscaliza")?.open && $("modalFiscalizaContent")?.querySelector(`[data-pessoal-historia="${version}"]`);
      const linhas = [];
      let falhas = 0;
      const meses = mesesDisponiveis().reverse();
      for (const [indice, mes] of meses.entries()) {
        if (!ativo()) return;
        try {
          const folha = await obterFolha(mes);
          if (!ativo()) return;
          const dados = folha[servidor.orgao === "Câmara" ? "camara" : "prefeitura"] || {};
          const nomes = (dados.servidores || []).filter(s => nomeKey(s) === nomeKey(servidor) && competenciaLinha(s, servidor.orgao) === mes);
          const confirmados = servidor.matricula ? nomes.filter(s => s.matricula && String(s.matricula) === String(servidor.matricula)) : [];
          const candidatos = confirmados.length ? confirmados : (servidor.matricula ? nomes.filter(s => !s.matricula) : nomes);
          if (!candidatos.length) linhas.push(`<tr><th scope="row">${esc(mes)}</th><td colspan="6">Sem registro localizado para essa identificação; não equivale a pagamento zero.</td></tr>`);
          for (const s of candidatos) {
            const meta = metadadosFonte({ ...s, orgao: servidor.orgao });
            linhas.push(`<tr><th scope="row">${esc(mes)}</th><td>${fmtBRL(s.vencimentos || 0)}</td><td>${fmtBRL(s.liquido || 0)}</td><td>${esc(s.cargo || s.lotacao || "Não informado")}<br>${esc(s.vinculo || "Vínculo não informado")}</td><td>${esc(s.matricula || "Não informada")}</td><td>${confirmados.length ? "Matrícula correspondente no mesmo órgão" : "Por nome; vínculo não confirmado"}${candidatos.length > 1 ? " · múltiplos registros" : ""}</td><td>${meta.fonte ? `<a href="${esc(meta.fonte)}" target="_blank" rel="noopener">Conferir fonte oficial</a>` : "Fonte não informada"}<br>Coleta registrada: ${esc(meta.coletado)}</td></tr>`);
          }
        } catch (_) {
          if (!ativo()) return;
          falhas += 1;
          linhas.push(`<tr><th scope="row">${esc(mes)}</th><td colspan="6">Falha no carregamento; nenhum valor foi inferido.</td></tr>`);
        }
        ativo().querySelector('[role="status"]').textContent = `Consultadas ${indice + 1} de ${meses.length} competências; aguarde a conclusão.`;
      }
      if (!ativo()) return;
      ativo().querySelector('[role="status"]').textContent = `${falhas ? `Consulta concluída com ${falhas} competência(s) indisponível(is).` : "Consulta concluída."} Registros do mesmo nome permanecem separados; não some possíveis homônimos.`;
      ativo().querySelector(".pessoal-historia-tabela").innerHTML = tabelaPessoal(`Histórico disponível — ${servidor.orgao}`, ["Mês", "Bruto", "Líquido", "Cargo e vínculo", "Matrícula", "Correspondência", "Fonte e coleta"], linhas);
    }

    function statusPaineis(texto) {
      for (const id of ["comparativoComissionados", "primeiroEscalao", "rankingComissionados", "pessoalComparacao"]) {
        if ($(id)) $(id).innerHTML = `<p role="status">${esc(texto)}</p>`;
      }
      for (const id of ["totServidores", "totComissionados", "custoFolha", "pctComissionados"]) if ($(id)) $(id).textContent = "—";
      if ($("rankingPeriodoInfo")) $("rankingPeriodoInfo").textContent = texto;
    }

    function renderPaineis(todos, compPref, compCam) {
    // Comparativo comissionados Câmara × Prefeitura
    const blocoComp = $("bloco-comparativo-comissionados");
    const divComp   = $("comparativoComissionados");
    const resumoPeriodo = (orgao) => {
      const registros = todos.filter(s => s.orgao === orgao);
      const com = registros.filter(s => s.comissionado_ou_similar || /COMISSION/i.test(s.lotacao || ""));
      return { servidores_qtd: registros.length, comissionados_qtd: com.length,
        folha_bruta_comissionados: com.reduce((s, r) => s + (Number(r.vencimentos) || 0), 0) };
    };
    const camRes  = resumoPeriodo("Câmara");
    const prefRes = resumoPeriodo("Prefeitura");
    const camQtd  = camRes.comissionados_qtd  || 0;
    const camTot  = camRes.servidores_qtd     || 0;
    const prefQtd = prefRes.comissionados_qtd  || 0;
    const prefTot = prefRes.servidores_qtd     || 0;
    if (blocoComp) blocoComp.hidden = false;
    if (divComp && !(camTot || prefTot)) divComp.textContent = "Sem registros para o mês selecionado.";
    if ($("comparativoPeriodoInfo")) $("comparativoPeriodoInfo").textContent = `Fonte: Betha. Prefeitura: ${compPref || "mês não informado"} · Câmara: ${compCam || "mês não informado"}. Confira o vínculo na fonte oficial.`;
    if (blocoComp && divComp && (camTot > 0 || prefTot > 0)) {
      blocoComp.hidden = false;
      const pctCam  = camTot  ? (camQtd  / camTot  * 100) : 0;
      const pctPref = prefTot ? (prefQtd / prefTot * 100) : 0;
      const barMax  = Math.max(pctCam, pctPref, 1);
      const mkBar = (label, com, tot, pct, folhaCom, cor, comp) => `
        <div style="margin-bottom:20px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
            <strong>${esc(label)}</strong>
            <span style="font-size:1.4em;font-weight:700;color:${cor}">${pct.toFixed(1)}%</span>
          </div>
          <div style="background:#e8edf3;border-radius:4px;height:22px;overflow:hidden">
            <div style="width:${Math.min(pct/barMax*100,100).toFixed(1)}%;height:100%;background:${cor};border-radius:4px;transition:width .5s"></div>
          </div>
          <div class="small muted" style="margin-top:4px">
            ${fmtNum(com)} comissionados de ${fmtNum(tot)} registros da folha
            ${folhaCom ? ` · Folha comissionados: <strong>${fmtBRL(folhaCom)}</strong> na competência ${esc(comp || "não informada")}` : ""}
          </div>
        </div>`;
      // A folha vem com uma linha por servidor POR MÊS: o resumo já soma só a
      // competência de referência. Rotular "/mês" sem dizer qual mês foi o que
      // publicou R$ 1,1 mi como custo mensal quando o mês custava R$ 218 mil.
      const camComp  = compCam;
      const prefComp = compPref;
      divComp.innerHTML =
        mkBar("Câmara Municipal",  camQtd,  camTot,  pctCam,
              camRes.folha_bruta_comissionados  || 0, "#c0392b", camComp) +
        mkBar("Prefeitura",        prefQtd, prefTot, pctPref,
              prefRes.folha_bruta_comissionados || 0, "#2980b9", prefComp) +
        (camTot > 0 && prefTot > 0 ? `
        <div class="report-note" style="margin-top:8px;border-left:4px solid #c0392b;padding-left:12px">
          A Câmara tem <strong>${pctCam.toFixed(1)}% de comissionados</strong> —
          a Prefeitura tem <strong>${pctPref.toFixed(1)}%</strong> no período indicado. As proporções descrevem os registros coletados e não demonstram irregularidade.
        </div>` : "");
    }

    // Ranking top-10 comissionados por vencimento
    const rankingEl = $("rankingComissionados");
    if (rankingEl) {
      // Retrato do quadro ATUAL: quem teve rescisão na última folha se
      // desligou do órgão e sai do top (a rescisão de R$ 41 mil de um
      // ex-diretor não é "maior vencimento" de comissionado — é verba de
      // saída). Os desligados continuam pesquisáveis na lista, com a tag
      // explicando a rescisão.
      const desligou = (s) => /rescis/i.test(String(s.tiposFolhaExtra || ""));
      // Ordena pelo SALÁRIO MENSAL comparável: quem recebeu 13º/férias no mês
      // tem o bruto inflado e furava fila na frente de salários maiores de
      // verdade (assessor com base de R$ 6,4 mil aparecia em 2º com R$ 15 mil
      // de bruto por causa do adiantamento de 13º). O card continua mostrando
      // o bruto do mês com a tag explicando a verba extra.
      const salarioComparavel = (s) => (s.isAtipico && s.vencimentoNormal)
        ? Number(s.vencimentoNormal) : Number(s.vencimentos || 0);
      // Primeiro escalão: prefeito, vice e secretários ficam fora da contagem de
      // comissionados (vínculo próprio na Betha), e "quanto ganha o prefeito?"
      // ficava sem resposta na página. O cargo traz o código e a sigla da pasta.
      const escalaoEl = $("primeiroEscalao");
      if (escalaoEl) {
        const ehEscalao = (s) => s.orgao === "Prefeitura" &&
          /-\s*(VICE-)?PREFEITO\s*$|-\s*SECRETARIO\s+S[A-Z]+\s*$/i.test(String(s.cargo || ""));
        const escalao = todos.filter(s => ehEscalao(s) && !desligou(s))
          .sort((a, b) => salarioComparavel(b) - salarioComparavel(a));
        const linhaEscalao = (s) => {
          const cargo = String(s.cargo || "").replace(/^\d+\s*-\s*/, "");
          const comp = s.competencia || compPref || "mês não informado";
          const extra = s.isAtipico && s.tiposFolhaExtra
            ? `<small class="escalao-item__nota">Inclui ${esc(s.tiposFolhaExtra)} neste mês${s.vencimentoNormal ? ` — base mensal ${fmtBRL(s.vencimentoNormal)}` : ""}</small>`
            : "";
          return `
          <div class="escalao-item">
            <span class="escalao-item__quem"><strong>${esc(s.nome || "Sem nome")}</strong><small>${esc(cargo)} · vínculo: ${esc(s.vinculo || "não informado")}</small>${extra}</span>
            <span class="escalao-item__valor"><strong>${fmtBRL(s.vencimentos || 0)}</strong><small>bruto · líquido ${fmtBRL(s.liquido || 0)} · ${esc(comp)}</small></span>
          </div>`;
        };
        const VISIVEIS = 5;
        escalaoEl.innerHTML = !escalao.length
          ? '<div class="empty">Prefeito e secretários não localizados na folha carregada.</div>'
          : escalao.slice(0, VISIVEIS).map(linhaEscalao).join("") + (escalao.length > VISIVEIS
            ? `<details class="diarias-ranking__mais"><summary>Ver todos os ${escalao.length}</summary><div class="escalao-lista">${escalao.slice(VISIVEIS).map(linhaEscalao).join("")}</div></details>`
            : "");
      }

      const todosComissionados = todos
        .filter(s => (s.comissionado_ou_similar || /COMISSION/i.test(s.lotacao || "")) && !desligou(s))
        .sort((a, b) => salarioComparavel(b) - salarioComparavel(a))
        .slice(0, 10);
      if (todosComissionados.length) {
        rankingEl.innerHTML = todosComissionados.map((s, i) => {
          // Mês da PRÓPRIA linha quando existir: o rótulo global mentia
          // quando o valor exibido era de um mês anterior ao de referência.
          const comp = s.competencia || (s.orgao === "Câmara" ? compCam : compPref);
          const tagOutroOrgao = s.outroOrgao
        ? `<div class="tag-periodo-alerta" style="display:inline-block;margin-top:6px;font-size:0.82em;padding:3px 8px;border-radius:4px;background:#e8f0fe;color:#1a4d8f;border:1px solid #b6d0f5" title="O mesmo nome completo consta na folha dos dois órgãos no ano — em geral indica mudança de órgão (exoneração + nova nomeação). Nome idêntico ainda pode ser homônimo: confira a matrícula na fonte oficial antes de concluir.">↔ Consta também na folha da ${esc(s.outroOrgao)} (mudança de órgão ou homônimo)</div>`
        : "";
      const tagAtipico = s.isAtipico
            ? `<div class="tag-periodo-alerta tag-periodo-alerta--warning" style="display:inline-block;margin-top:6px;font-size:0.85em;padding:4px 8px;border-radius:4px;background:#fff3cd;color:#856404;border:1px solid #ffeeba" title="Este valor bruto inclui benefícios adicionais como 13º salário, férias ou gratificação natalina. O salário base normal estimado é de ${fmtBRL(s.vencimentoNormal)}.">⚠️ ${s.tiposFolhaExtra ? (/rescis/i.test(s.tiposFolhaExtra) ? `${esc(s.tiposFolhaExtra)} — desligamento do órgão; valor inclui verbas indenizatórias, não é salário` : `Inclui ${esc(s.tiposFolhaExtra)} (fonte Betha)`) : "Contém 13º/Férias"}${s.vencimentoNormal ? ` — base mensal: ${fmtBRL(s.vencimentoNormal)}` : ""}</div>`
            : "";
          return `
          <article class="contrato">
            <div class="contrato__valor" style="min-width: 140px;">
              <span class="vencimento-titulo">Salário Bruto (Sem Descontos)</span>
              <strong class="vencimento-valor">${fmtBRL(s.vencimentos || 0)}</strong>
              <div class="small muted">Mensal (${comp || 'ref. mês'})</div>
            </div>
            <div>
              <p class="contrato__nome">
                ${i + 1}. ${esc(s.nome || "Sem nome")}
                <span class="tag-orgao-${s.orgao === "Câmara" ? "camara" : "prefeitura"}">${esc(s.orgao)}</span>
              </p>
              <p class="contrato__obj"><strong>Cargo:</strong> ${esc(s.cargo || s.lotacao || "Cargo não informado")}</p>
              <div class="contrato__meta">
                <span><strong>Salário Líquido (Dinheiro na Conta):</strong> <strong>${fmtBRL(s.liquido || 0)}</strong></span>
                ${s.matricula ? `<span>Matrícula ${s.matricula}</span>` : ""}
              </div>
              ${tagAtipico}${tagOutroOrgao}
            </div>
          </article>`;
        }).join("");

      } else {
        rankingEl.innerHTML = '<p>Sem comissionados localizados no mês selecionado.</p>';
      }
        const infoEl = $("rankingPeriodoInfo");
        if (infoEl) {
          const partes = [];
          if (compPref) partes.push(`Prefeitura: ref. ${compPref}`);
          if (compCam) partes.push(`Câmara: ref. ${compCam}`);
          // Este span nunca pode ficar vazio: um ranking de salários sem mês
          // carimbado é um número solto. Quando a fonte não publica a
          // competência, dizer isso é a informação — não o silêncio.
          infoEl.textContent = partes.length
            ? `(Valores mensais de referência — ${partes.join(" | ")})`
            : "(Competência não informada pela fonte nesta coleta — Prefeitura e Câmara sem mês de referência; confira no portal oficial)";
          infoEl.style.display = "inline-block";
        }
    }
    }

    buscaEl.addEventListener("input", render);
    orgaoEl.addEventListener("change", render);
    tipoEl.addEventListener("change", render);
    compararEl?.addEventListener("change", render);
    mesEl?.addEventListener("change", () => { filtroMesAlterado = true; render(); });

    // Aplica parâmetros de URL: ?tipo=comissionado, ?orgao=camara, ?q=nome, ?mes=09/2026
    (function applyPessoalParams() {
      const p = new URLSearchParams(window.location.search);
      const tipo  = p.get("tipo");
      const orgao = p.get("orgao");
      const q     = p.get("q");
      const mes   = p.get("mes");
      if (tipo  && tipoEl)  tipoEl.value  = tipo;
      if (orgao && orgaoEl) orgaoEl.value = orgao;
      if (q     && buscaEl) buscaEl.value = q;
      if (mesEl && [...mesEl.options].some(option => option.value === mes)) mesEl.value = mes;
    })();

    render();

    // Apenas o índice pequeno é carregado inicialmente; cada folha mensal
    // nominal só é solicitada depois de escolher sua competência.
    (async () => {
      try {
        const indice = location.protocol === "file:" ? D.pessoal_historico : await fetch("data/chunks/pessoal_historico.json").then(r => {
          if (!r.ok) throw new Error("Histórico indisponível");
          return r.json();
        });
        for (const entrada of indice?.competencias || []) {
          const mes = entrada.competencia;
          if (!competenciaValida(mes)) continue;
          const chave = `pessoal_folha_${mes.slice(3)}_${mes.slice(0, 2)}`;
          if (entrada.chunk === chave && Object.values(entrada.orgaos || {}).some(o => o.registros > 0)) historicoPorMes.set(mes, chave);
        }
        atualizarMeses();
        const solicitado = new URLSearchParams(location.search).get("mes");
        if (!filtroMesAlterado && historicoPorMes.has(solicitado)) { mesEl.value = solicitado; render(); }
      } catch (_) {
        const nota = $("pessoalMesNota");
        if (nota) nota.textContent = "Histórico indisponível no momento. O filtro mantém os meses da folha já carregada; tente atualizar a página.";
      }
    })();

    // Quem chega da busca da home com um termo quer o resultado, não os painéis
    // do topo: rola até a lista filtrada.
    if (buscaEl && new URLSearchParams(window.location.search).get("q")) {
      setTimeout(() => buscaEl.scrollIntoView({ block: "start", behavior: "auto" }), 300);
    }

    // CSV export button for servidores
    if (todos.length && contadorEl) {
      csvBtnP = document.createElement("button");
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
          competencia: competenciaLinha(s, s.orgao) || "Não informada",
          fonte: metadadosFonte(s).fonte || "Não informada",
          coletado_em: metadadosFonte(s).coletado,
          situacao_base: metadadosFonte(s).situacao,
          vencimentos: s.vencimentos || 0,
          liquido: s.liquido || 0,
        })), [
          { key: "nome",       label: "Nome" },
          { key: "cargo",      label: "Cargo/Lotação" },
          { key: "orgao",      label: "Órgão" },
          { key: "vinculo",    label: "Vínculo" },
          { key: "matricula",  label: "Matrícula" },
          { key: "competencia",label: "Competência" },
          { key: "fonte", label: "Fonte oficial" },
          { key: "coletado_em", label: "Data da coleta registrada" },
          { key: "situacao_base", label: "Situação da base" },
          { key: "vencimentos",label: "Vencimentos (R$)" },
          { key: "liquido", label: "Líquido (R$)" },
        ], `servidores-varginha-${new Date().toISOString().slice(0,10)}.csv`);
      });
    }
  }

  window.FISCALIZA.pessoal = { init: initPessoal };
})();
