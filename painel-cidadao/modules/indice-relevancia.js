/* Fiscaliza Varginha - Indice de Relevancia Parlamentar */
(function () {
  "use strict";

  window.ZELA = window.ZELA || {};

  const D = window.ZELA_DATA || {};
  const utils = window.ZELA.utils || {};
  const esc = utils.esc || function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  };
  const cleanText = utils.cleanText || function (s) { return String(s == null ? "" : s); };
  const fmtNum = utils.fmtNum || function (n) { return Number(n || 0).toLocaleString("pt-BR"); };

  let perfilAtual = "geral";
  const PERFIS = {
    geral: { label: "Geral", desc: "nota parcial auditavel" },
    legislador: { label: "Legislador", desc: "projetos e emendas" },
    fiscalizador: { label: "Fiscalizador", desc: "requerimentos" },
    simbolico: { label: "Mais simbolico", desc: "perfil sem pontuar" },
    efetividade: { label: "Efetividade", desc: "pendente de comprovacao" },
  };

  function $(id) {
    return document.getElementById(id);
  }

  function norm(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function anoAtual() {
    const sel = $("filtroAnoCamara");
    return (sel && sel.value) || "2025";
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function pct(value) {
    return Math.round(value * 10) / 10;
  }

  function scoreRelativo(value, max) {
    return max > 0 ? (value / max) * 100 : 0;
  }

  function ordenarPorValor(lista, fn) {
    return lista.slice().sort(function (a, b) {
      return (Number(fn(b)) || 0) - (Number(fn(a)) || 0) ||
        cleanText(a.nome).localeCompare(cleanText(b.nome), "pt-BR");
    });
  }

  function explicar(item, dimensoes) {
    const ev = item.evidencias || {};
    const partes = [];
    if (dimensoes.fiscalizar >= 70) partes.push("puxou a nota por requerimentos de fiscalizacao acima da media da Casa");
    else if (ev.requerimento_info > 0) partes.push("tem requerimentos de fiscalizacao, mas abaixo dos maiores volumes do ano");
    if (dimensoes.legislar >= 70) partes.push("tambem aparece forte em producao legislativa de merito e emendas");
    else if ((ev.projeto_autoria_propria || 0) + (ev.emenda_relevante || 0) > 0) partes.push("teve producao legislativa, mas com menor peso relativo no ano");
    if (ev.indicacao_protocolada_sem_confirmacao > 0) partes.push("indicacoes protocoladas aparecem como evidencia, mas ainda nao pontuam sem comprovacao de atendimento");
    if (ev.proposicao_simbolica > 0) partes.push("atos simbolicos ficam visiveis para transparencia e permanecem com peso zero");
    if (!partes.length) partes.push("nota baixa porque nao ha evidencias automaticas suficientes nas dimensoes pontuadas");
    return partes.slice(0, 3);
  }

  function montarRankingsPerfil(ranking) {
    function pos(fn) {
      return ordenarPorValor(ranking, fn).map(function (item, index) {
        return { nome: item.nome, posicao: index + 1, valor: pct(Number(fn(item)) || 0) };
      });
    }
    return {
      geral: pos(function (v) { return v.indice; }),
      legislador: pos(function (v) { return (v.dimensoes || {}).legislar; }),
      fiscalizador: pos(function (v) { return (v.dimensoes || {}).fiscalizar; }),
      simbolico: pos(function (v) { return (v.perfil || {}).simbolico_pct; }),
      efetividade: [],
    };
  }

  function calcularFallback(ano) {
    const bloco = (D.camara_anos || {})[String(ano)] || {};
    const vereadores = Array.isArray(bloco.vereadores) ? bloco.vereadores : [];
    const base = vereadores.map(function (v) {
      const total = num(v.total);
      const projetos = num(v.projetos_lei);
      const emendas = num(v.emendas);
      const requerimentos = num(v.requerimentos);
      const indicacoes = num(v.indicacoes);
      const simbolicos = num(v.impacto_zero);
      return {
        nome: String(v.nome || ""),
        total: total,
        dimensoes_brutas: {
          legislar: projetos * 3 + emendas * 1.5,
          fiscalizar: requerimentos * 1.5,
          representar: null,
          presenca: null,
        },
        evidencias: {
          projeto_autoria_propria: projetos,
          alteracao_relevante: 0,
          proposicao_simbolica: simbolicos,
          emenda_relevante: emendas,
          relatoria_processante: 0,
          requerimento_info: requerimentos,
          audiencia_contas: 0,
          oficio_fiscalizacao: 0,
          indicacao_protocolada_sem_confirmacao: indicacoes,
          indicacao_atendida: 0,
          audiencia_publica_diligencia: 0,
          comenda_titulo: num(v.mocoes) + num(v.pdl) + num(v.nome_rua) + num(v.homenagens_terceiros),
        },
        perfil: {
          simbolico_pct: total > 0 ? pct((simbolicos / total) * 100) : 0,
        },
      };
    }).filter(function (v) { return v.nome; });

    const maxLeg = Math.max.apply(null, [0].concat(base.map(function (v) { return v.dimensoes_brutas.legislar; })));
    const maxFisc = Math.max.apply(null, [0].concat(base.map(function (v) { return v.dimensoes_brutas.fiscalizar; })));
    const pesoDisponivel = 60;
    const ranking = base.map(function (v) {
      const dimensoes = {
        legislar: pct(scoreRelativo(v.dimensoes_brutas.legislar, maxLeg)),
        fiscalizar: pct(scoreRelativo(v.dimensoes_brutas.fiscalizar, maxFisc)),
        representar: null,
        presenca: null,
      };
      const indice = (dimensoes.legislar * 30 + dimensoes.fiscalizar * 30) / pesoDisponivel;
      const item = {
        nome: v.nome,
        indice: pct(indice),
        cobertura_pct: pesoDisponivel,
        confianca_dados_pct: pesoDisponivel,
        dimensoes: dimensoes,
        dimensoes_brutas: v.dimensoes_brutas,
        evidencias: v.evidencias,
        perfil: v.perfil,
        pendencias: ["alteracao_relevante", "relatoria_processante", "audiencia_contas", "oficio_fiscalizacao", "indicacao_atendida", "audiencia_publica_diligencia", "presenca_sessoes", "presenca_comissoes"],
      };
      item.explicacao = explicar(item, dimensoes);
      return item;
    }).sort(function (a, b) {
      return b.indice - a.indice || a.nome.localeCompare(b.nome, "pt-BR");
    });

    ranking.forEach(function (v, index) { v.posicao = index + 1; });
    return {
      ano: Number(ano),
      status: "fallback_datajs",
      cobertura_pct: pesoDisponivel,
      confianca_dados_pct: pesoDisponivel,
      vereadores_monitorados: ranking.length,
      rankings_perfil: montarRankingsPerfil(ranking),
      ranking: ranking,
    };
  }

  function getAnoData(ano) {
    const indice = D.indice_relevancia || {};
    return (indice.anos && indice.anos[String(ano)]) || calcularFallback(ano);
  }

  function barra(label, valor, cls) {
    if (valor == null) {
      return `<div class="indice-dim indice-dim--pending">
        <span>${esc(label)}</span><strong>Pendente</strong>
        <i><b style="width:0%"></b></i>
      </div>`;
    }
    const width = Math.max(0, Math.min(100, Number(valor) || 0));
    return `<div class="indice-dim ${cls || ""}">
      <span>${esc(label)}</span><strong>${width.toFixed(1)}</strong>
      <i><b style="width:${width}%"></b></i>
    </div>`;
  }

  function selecionarVereador(nome) {
    const filtroVer = $("filtroVer");
    const filtroEm = $("filtroEm");
    const filtroVereador = $("filtroVereador");
    if (filtroVer) {
      filtroVer.value = nome;
      filtroVer.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (filtroVereador) filtroVereador.value = nome;
    if (filtroEm) {
      filtroEm.value = nome;
      filtroEm.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function valorPerfil(item, perfil) {
    if (perfil === "legislador") return (item.dimensoes || {}).legislar;
    if (perfil === "fiscalizador") return (item.dimensoes || {}).fiscalizar;
    if (perfil === "simbolico") return (item.perfil || {}).simbolico_pct;
    if (perfil === "efetividade") return null;
    return item.indice;
  }

  function ordenarRanking(ranking, perfil) {
    if (perfil === "efetividade") return ranking.slice();
    return ordenarPorValor(ranking, function (item) { return valorPerfil(item, perfil); });
  }

  function renderCard(item) {
    const nome = cleanText(item.nome);
    const ev = item.evidencias || {};
    const dim = item.dimensoes || {};
    const perfil = item.perfil || {};
    const exp = Array.isArray(item.explicacao) ? item.explicacao : [];
    const scoreLabel = perfilAtual === "simbolico" ? "simbolico" : "indice";
    const scoreValue = perfilAtual === "simbolico"
      ? Number(perfil.simbolico_pct || 0).toFixed(1) + "%"
      : Number(item.indice || 0).toFixed(1);
    return `<article class="indice-card">
      <div class="indice-card__rank">#${fmtNum(item.posicao)}</div>
      <div class="indice-card__main">
        <h4>${esc(nome)}</h4>
        <p>${fmtNum(ev.projeto_autoria_propria || 0)} projetos de lei - ${fmtNum(ev.requerimento_info || 0)} requerimentos - ${fmtNum(ev.indicacao_protocolada_sem_confirmacao || 0)} indicacoes aguardando resposta - ${fmtNum(ev.proposicao_simbolica || 0)} simbolicos sem peso</p>
        <div class="indice-card__dims">
          ${barra("Legislar", dim.legislar, "indice-dim--leg")}
          ${barra("Fiscalizar", dim.fiscalizar, "indice-dim--fisc")}
          ${barra("Representar", dim.representar, "indice-dim--rep")}
          ${barra("Presenca", dim.presenca, "indice-dim--pres")}
        </div>
        ${exp.length ? `<ul class="indice-why">${exp.map(function (x) { return `<li>${esc(x)}</li>`; }).join("")}</ul>` : ""}
      </div>
      <div class="indice-card__score">
        <strong>${scoreValue}</strong>
        <span>${scoreLabel}</span>
        <em>${Number(item.confianca_dados_pct || item.cobertura_pct || 0).toFixed(0)}% confianca</em>
        <button type="button" data-ver="${esc(nome)}">Ver no painel</button>
      </div>
    </article>`;
  }

  function renderResumo(el, anoData, ranking) {
    const perfilInfo = PERFIS[perfilAtual] || PERFIS.geral;
    const rankingPerfil = ordenarRanking(ranking, perfilAtual).map(function (item, index) {
      return Object.assign({}, item, { posicao: index + 1 });
    });
    const top = rankingPerfil[0];
    const topList = perfilAtual === "efetividade" ? [] : rankingPerfil.slice(0, 5);
    const restante = Math.max(0, rankingPerfil.length - topList.length);
    const simbolicos = ranking.reduce(function (sum, item) {
      return sum + Number((item.evidencias || {}).proposicao_simbolica || 0);
    }, 0);
    const pendentes = ((D.indice_relevancia || {}).metodologia || {}).campos_pendentes ||
      ["alteracao_relevante", "relatoria_processante", "audiencia_contas", "oficio_fiscalizacao", "indicacao_atendida", "audiencia_publica_diligencia", "presenca_sessoes", "presenca_comissoes"];

    el.innerHTML = `
      <div class="indice-head">
        <div>
          <span class="method-card__tag">NOVO NO FISCALIZA - INDICE AUDITAVEL</span>
          <h3 class="block__title">Indice de Relevancia Parlamentar</h3>
          <p class="block__lead">
            Mede o mandato por funcao publica: legislar, fiscalizar, gerar resultado, participar
            de comissoes e prestar contas. O ranking atual e parcial porque so pontua o que ja tem fonte automatica confiavel.
          </p>
        </div>
        <div class="indice-head__seal">
          <strong>${top ? Number(top.indice || 0).toFixed(1) : "0.0"}</strong>
          <span>maior nota em ${esc(anoData.ano || anoAtual())}</span>
        </div>
      </div>

      <div class="indice-stats">
        <div><strong>${fmtNum(anoData.vereadores_monitorados || ranking.length)}</strong><span>vereadores monitorados</span></div>
        <div><strong>${Number(anoData.confianca_dados_pct || anoData.cobertura_pct || 0).toFixed(0)}%</strong><span>confianca/cobertura dos dados</span></div>
        <div><strong>${fmtNum(simbolicos)}</strong><span>atos simbolicos sem pontuar</span></div>
      </div>

      <div class="indice-alert">
        Fonte principal: SAPL, via <code>camara_anos.json</code>. Campos ainda pendentes de coleta confiavel:
        ${pendentes.map(function (p) { return `<span>${esc(p.replace(/_/g, " "))}</span>`; }).join("")}
      </div>

      <div class="indice-perfis" role="tablist" aria-label="Rankings por perfil">
        ${Object.keys(PERFIS).map(function (key) {
          const p = PERFIS[key];
          return `<button type="button" class="${key === perfilAtual ? "is-active" : ""}" data-indice-perfil="${key}">
            <strong>${esc(p.label)}</strong><span>${esc(p.desc)}</span>
          </button>`;
        }).join("")}
      </div>

      <div class="indice-profile-note">
        <strong>${esc(perfilInfo.label)}:</strong>
        ${perfilAtual === "efetividade"
          ? "resultado/efetividade ainda depende de comprovacao externa: indicacao atendida, emenda executada, resposta completa ou problema resolvido."
          : esc(perfilInfo.desc) + ". Use este recorte para entender o perfil do mandato, sem substituir o ranking geral."}
      </div>

      ${topList.length
        ? `<div class="indice-list">${topList.map(renderCard).join("")}</div>`
        : `<div class="empty">Ranking de efetividade ainda nao publicado: faltam evidencias oficiais de atendimento, execucao ou resultado.</div>`}

      ${restante && topList.length ? `<details class="indice-full">
        <summary>Ver ranking completo (${fmtNum(rankingPerfil.length)} vereadores)</summary>
        <div class="indice-list indice-list--full">
          ${rankingPerfil.slice(5).map(renderCard).join("")}
        </div>
      </details>` : ""}`;
  }

  function render() {
    const el = $("indiceRelevancia");
    if (!el) return;

    const ano = anoAtual();
    const anoData = getAnoData(ano);
    if (!anoData || !Array.isArray(anoData.ranking) || !anoData.ranking.length) {
      el.innerHTML = `<div class="empty">Indice de relevancia ainda nao gerado para ${esc(ano)}. Rode a atualizacao de dados para publicar o ranking auditavel.</div>`;
      return;
    }

    const q = norm(($("filtroVer") && $("filtroVer").value) || "");
    const ranking = anoData.ranking.filter(function (item) {
      return !q || norm(cleanText(item.nome)).includes(q);
    });
    renderResumo(el, anoData, ranking);

    el.querySelectorAll("button[data-ver]").forEach(function (btn) {
      btn.addEventListener("click", function (event) {
        event.stopPropagation();
        selecionarVereador(btn.dataset.ver || "");
      });
    });
    el.querySelectorAll("button[data-indice-perfil]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        perfilAtual = btn.dataset.indicePerfil || "geral";
        render();
      });
    });
  }

  window.ZELA.indiceRelevancia = { render };

  window.addEventListener("zela:ready", render);
  document.addEventListener("change", function (event) {
    if (event.target && event.target.id === "filtroAnoCamara") render();
  });
  document.addEventListener("input", function (event) {
    if (event.target && event.target.id === "filtroVer") render();
  });
})();
