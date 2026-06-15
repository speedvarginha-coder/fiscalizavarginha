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
    geral: { label: "Atividade", desc: "o que produziu (volume)" },
    efetividade: { label: "Efetividade", desc: "o que virou lei" },
    legislador: { label: "Legislador", desc: "projetos e emendas" },
    fiscalizador: { label: "Fiscalizador", desc: "requerimentos" },
    representar: { label: "Representar", desc: "indicacoes (com teto)" },
    presenca: { label: "Presença", desc: "comparecimento às sessões" },
    simbolico: { label: "Cerimonial", desc: "moção/homenagem (peso 0)" },
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
    if (perfil === "representar") return (item.dimensoes || {}).representar;
    if (perfil === "presenca") return (item.dimensoes || {}).presenca;
    if (perfil === "simbolico") return (item.perfil || {}).simbolico_pct;
    if (perfil === "efetividade") return num(item.leis_aprovadas);
    return item.indice;
  }

  function ordenarRanking(ranking, perfil) {
    return ordenarPorValor(ranking, function (item) { return valorPerfil(item, perfil); });
  }

  function metodologiaPesos() {
    const m = (D.indice_relevancia || {}).metodologia || {};
    return m.pesos || { legislar: 30, fiscalizar: 30, representar: 15, presenca: 25 };
  }

  // Decimais com ponto p/ casar com o resto do indice (barras usam toFixed(1)).
  function fmt1(v) { return (Number(v) || 0).toFixed(1); }
  function fmt0(v) { return Math.round(Number(v) || 0).toLocaleString("pt-BR"); }

  // Garante o dialog #modalFiscaliza (reusa o do camara.html ou cria um).
  function obterModal() {
    let modal = document.getElementById("modalFiscaliza");
    if (modal) return modal;
    modal = document.createElement("dialog");
    modal.id = "modalFiscaliza";
    modal.className = "modal modal--wide";
    modal.innerHTML =
      '<button class="modal__close" type="button" aria-label="Fechar">&times;</button>' +
      '<div id="modalFiscalizaContent"></div>';
    modal.querySelector(".modal__close").addEventListener("click", function () { modal.close(); });
    document.body.appendChild(modal);
    return modal;
  }

  // Monta a explicacao personalizada da nota de UM vereador (os pesos e a conta).
  function explicacaoNotaHtml(item) {
    const nome = cleanText(item.nome);
    const dim = item.dimensoes || {};
    const comp = item.composicao || {};
    const ev = item.evidencias || {};
    const pesos = metodologiaPesos();
    const transp = ((D.indice_relevancia || {}).metodologia || {}).transparencia || "";

    const presPct = (item.presenca_pct === null || item.presenca_pct === undefined) ? null : item.presenca_pct;
    const presSub = presPct == null
      ? "em comissoes ainda nao coletada"
      : fmt0(item.presenca_presentes) + "/" + fmt0(item.presenca_elegiveis) + " sessoes deliberativas" +
        (item.presenca_janela ? " · " + esc(item.presenca_janela) : "");
    const linhas = [
      { k: "Legislar", sub: "projetos de lei e emendas", v: dim.legislar, p: pesos.legislar, rel: true },
      { k: "Fiscalizar", sub: "requerimentos de fiscalizacao", v: dim.fiscalizar, p: pesos.fiscalizar, rel: true },
      { k: "Representar", sub: "indicacoes (com teto progressivo)", v: dim.representar, p: pesos.representar, rel: true },
      { k: "Presenca", sub: presSub, v: presPct, p: pesos.presenca, rel: false },
    ];
    let soma = 0;
    let pesoSoma = 0;
    linhas.forEach(function (l) {
      if (l.v != null) {
        l.contrib = (Number(l.v) || 0) * l.p;
        soma += l.contrib;
        pesoSoma += l.p;
      }
    });
    const nota = pesoSoma > 0 ? soma / pesoSoma : 0;

    const linhasHtml = linhas.map(function (l) {
      if (l.v == null) {
        return `<tr class="is-pending"><td>${esc(l.k)}<small>${esc(l.sub)}</small></td><td>—</td><td>×${l.p}</td><td>pendente</td></tr>`;
      }
      return `<tr>
        <td>${esc(l.k)}<small>${esc(l.sub)}</small></td>
        <td>${fmt1(l.v)}</td>
        <td>×${l.p}</td>
        <td>${fmt0(l.contrib)}</td>
      </tr>`;
    }).join("");

    const leis = num(item.leis_aprovadas);

    return `<div class="nota-modal">
      <span class="method-card__tag">SCORE LEGISLATIVO · EXPERIMENTAL v2</span>
      <h3 class="nota-modal__nome">${esc(nome)}</h3>
      <p class="nota-modal__lead">Esta e a conta exata da nota de <strong>Atividade</strong>, do jeito que o
      painel calcula para todos os vereadores — sem ajuste manual.</p>

      <div class="nota-modal__big">
        <div><strong>${fmt1(item.indice)}</strong><span>Atividade</span></div>
        <div><strong>${fmt0(leis)}</strong><span>viraram lei (Efetividade)</span></div>
        <div><strong>${fmt0(item.confianca_dados_pct || item.cobertura_pct || pesoSoma)}%</strong><span>cobertura dos dados</span></div>
      </div>

      <h4 class="nota-modal__h">1. Como cada dimensao foi medida</h4>
      <p class="nota-modal__p">Nas tres primeiras, <strong>quem mais produziu na Camara recebe 100</strong> e os
      demais ficam proporcionais (comparacao com os colegas no mesmo ano). A <strong>Presenca</strong> e
      absoluta: e o proprio percentual de comparecimento as sessoes deliberativas.</p>

      <table class="nota-modal__tbl">
        <thead><tr><th>Dimensao</th><th>Nota (0–100)</th><th>Peso</th><th>Contribuicao</th></tr></thead>
        <tbody>
          ${linhasHtml}
        </tbody>
        <tfoot>
          <tr><td colspan="3">Soma das contribuicoes</td><td>${fmt0(soma)}</td></tr>
          <tr><td colspan="3">÷ soma dos pesos com dado (cobertura ${fmt0(pesoSoma)} de 100)</td><td>÷ ${fmt0(pesoSoma)}</td></tr>
          <tr class="is-total"><td colspan="3"><strong>= Nota de Atividade</strong></td><td><strong>${fmt1(nota)}</strong></td></tr>
        </tfoot>
      </table>
      <p class="nota-modal__note">${presPct == null
        ? "Presenca ainda sem dado para este parlamentar — a nota usa " + fmt0(pesoSoma) + "% dos pesos. E honestidade, nao erro de calculo."
        : "Presenca = comparecimento as sessoes deliberativas (Ordinaria + Extraordinaria), com denominador pela <strong>janela de mandato</strong>: quem assumiu ou saiu no meio do ano so e medido nas sessoes em que tinha assento. Fonte: registro oficial do SAPL."}</p>

      <h4 class="nota-modal__h">2. O que NAO contou (e por que)</h4>
      <ul class="nota-modal__list">
        <li><strong>${fmt0(comp.cerimonial || 0)} atos cerimoniais</strong> (mocao, homenagem, titulo, nome de rua)
        aparecem por transparencia, mas <strong>pesam zero</strong> — nao sobem nem descem a nota.</li>
        <li><strong>${fmt0(ev.indicacao_protocolada_sem_confirmacao || 0)} indicacoes</strong> entram com teto progressivo:
        as 10 primeiras valem 1 ponto; da 11a a 20a, meio ponto; acima disso, 1/4. Volume nao "fura a fila".</li>
      </ul>

      <h4 class="nota-modal__h">3. Efetividade e uma nota separada</h4>
      <p class="nota-modal__p">A Atividade mede o que o vereador <em>produziu</em>. A Efetividade mede o que
      <strong>virou lei</strong> (desfecho oficial do SAPL). ${esc(nome)} teve <strong>${fmt0(leis)}</strong>
      materia(s) que viraram lei. Produzir muito nao e o mesmo que aprovar.</p>

      ${transp ? `<p class="nota-modal__transp">${esc(transp)}</p>` : ""}
    </div>`;
  }

  function abrirModalScore(nome) {
    const ano = anoAtual();
    const anoData = getAnoData(ano);
    const ranking = (anoData && Array.isArray(anoData.ranking)) ? anoData.ranking : [];
    const item = ranking.find(function (v) { return cleanText(v.nome) === cleanText(nome); });
    if (!item) return;
    const modal = obterModal();
    const content = modal.querySelector("#modalFiscalizaContent");
    if (content) content.innerHTML = explicacaoNotaHtml(item);
    if (typeof modal.showModal === "function") modal.showModal();
    else modal.setAttribute("open", "");
  }

  function renderCard(item) {
    const nome = cleanText(item.nome);
    const ev = item.evidencias || {};
    const dim = item.dimensoes || {};
    const perfil = item.perfil || {};
    const exp = Array.isArray(item.explicacao) ? item.explicacao : [];
    const comp = item.composicao || {};
    let scoreLabel = "atividade", scoreValue = Number(item.indice || 0).toFixed(1);
    if (perfilAtual === "efetividade") { scoreLabel = "viraram lei"; scoreValue = fmtNum(item.leis_aprovadas || 0); }
    else if (perfilAtual === "simbolico") { scoreLabel = "cerimonial"; scoreValue = Number(perfil.simbolico_pct || 0).toFixed(0) + "%"; }
    else if (perfilAtual === "presenca") { scoreLabel = "presença"; scoreValue = (item.presenca_pct == null ? "—" : Number(item.presenca_pct).toFixed(0) + "%"); }
    return `<article class="indice-card">
      <div class="indice-card__rank">#${fmtNum(item.posicao)}</div>
      <div class="indice-card__main">
        <h4>${esc(nome)}</h4>
        <p class="indice-card__compo"><strong>${fmtNum(comp.substantivo || 0)}</strong> atos substantivos · <strong>${fmtNum(comp.cerimonial || 0)}</strong> cerimoniais (${Number(comp.cerimonial_pct || 0).toFixed(0)}% moção/homenagem, peso 0) · <strong>${fmtNum(item.leis_aprovadas || 0)}</strong> viraram lei</p>
        <p>${fmtNum(ev.projeto_autoria_propria || 0)} projetos de lei - ${fmtNum(ev.requerimento_info || 0)} requerimentos - ${fmtNum(ev.indicacao_protocolada_sem_confirmacao || 0)} indicações (teto progressivo) - ${fmtNum(ev.proposicao_simbolica || 0)} simbólicos sem peso</p>
        <div class="indice-card__dims">
          ${barra("Legislar", dim.legislar, "indice-dim--leg")}
          ${barra("Fiscalizar", dim.fiscalizar, "indice-dim--fisc")}
          ${barra("Representar", dim.representar, "indice-dim--rep")}
          ${barra("Presenca", dim.presenca, "indice-dim--pres")}
        </div>
        ${exp.length ? `<ul class="indice-why">${exp.map(function (x) { return `<li>${esc(x)}</li>`; }).join("")}</ul>` : ""}
      </div>
      <div class="indice-card__score">
        <button type="button" class="indice-score-open" data-score="${esc(nome)}" title="Entender como esta nota foi calculada">
          <strong>${scoreValue}</strong>
          <span>${scoreLabel}</span>
          <em>${Number(item.confianca_dados_pct || item.cobertura_pct || 0).toFixed(0)}% confianca</em>
          <small class="indice-score-open__hint">entender a nota ›</small>
        </button>
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
    const topList = rankingPerfil.slice(0, 5);
    const restante = Math.max(0, rankingPerfil.length - topList.length);
    const simbolicos = ranking.reduce(function (sum, item) {
      return sum + Number((item.evidencias || {}).proposicao_simbolica || 0);
    }, 0);
    const pendentes = ((D.indice_relevancia || {}).metodologia || {}).campos_pendentes ||
      ["alteracao_relevante", "relatoria_processante", "audiencia_contas", "oficio_fiscalizacao", "indicacao_atendida", "audiencia_publica_diligencia", "presenca_sessoes", "presenca_comissoes"];
    const metodo = (D.indice_relevancia || {}).metodologia || {};
    const pesos = metodo.pesos || { legislar: 30, fiscalizar: 30, representar: 15, presenca: 25 };
    const coberturaPct = Number((top && top.cobertura_pct) || anoData.cobertura_pct || 0);
    const explicador = `
      <details class="indice-method">
        <summary>Como esta nota e calculada <span aria-hidden="true">+</span></summary>
        <div class="indice-method__body">
          <p>A nota nao e um placar de popularidade. E uma media ponderada de
          <strong>quanto cada vereador produziu</strong>, comparada com o restante da Casa
          no mesmo ano (quem mais produziu numa dimensao recebe 100; os demais, proporcional).</p>

          <p class="indice-method__step"><strong>1. Quatro dimensoes, pesos fixos:</strong></p>
          <table class="indice-method__tbl">
            <tr><td>Legislar <small>(projetos, emendas)</small></td><td>${pesos.legislar}%</td></tr>
            <tr><td>Fiscalizar <small>(requerimentos)</small></td><td>${pesos.fiscalizar}%</td></tr>
            <tr><td>Representar <small>(indicacoes, com teto)</small></td><td>${pesos.representar}%</td></tr>
            <tr><td>Presenca <small>(sessoes deliberativas)</small></td><td>${pesos.presenca}%</td></tr>
          </table>
          <p class="indice-method__note">As tres primeiras sao relativas a Casa (o maior recebe 100).
          A <strong>Presenca</strong> e absoluta — o proprio % de comparecimento as sessoes deliberativas,
          com denominador pela <strong>janela de mandato</strong> (quem entrou ou saiu no meio do ano so e
          medido nas sessoes em que tinha assento). Cobertura atual: <strong>${coberturaPct.toFixed(0)}%</strong>.</p>

          <p class="indice-method__step"><strong>2. Indicacao tem teto progressivo:</strong>
          as 10 primeiras valem 1 ponto cada; da 11a a 20a, meio ponto; acima disso, 1/4 de ponto
          (teto 15). Quem dispara 80 indicacoes nao "fura a fila" de quem fez 3 projetos de lei.</p>

          <p class="indice-method__step"><strong>3. Ato simbolico pesa zero:</strong>
          mocao, homenagem, titulo e nome de rua aparecem no card por transparencia,
          mas <strong>nao somam nenhum ponto</strong>.</p>

          <p class="indice-method__step"><strong>4. Efetividade e uma nota separada:</strong>
          conta quantas materias do vereador <strong>viraram lei</strong> (desfecho oficial do SAPL).
          Volume de propostas nao e merito — virar lei e.</p>

          ${top ? `<p class="indice-method__example"><strong>Exemplo (${esc(top.nome)}, maior nota ${Number(top.indice || 0).toFixed(1)}):</strong>
          Legislar ${Number((top.dimensoes || {}).legislar || 0).toFixed(0)} · Fiscalizar ${Number((top.dimensoes || {}).fiscalizar || 0).toFixed(0)} · Representar ${Number((top.dimensoes || {}).representar || 0).toFixed(0)}${(top.dimensoes || {}).presenca == null ? "" : " · Presenca " + Number((top.dimensoes || {}).presenca).toFixed(0)}
          → media ponderada = <strong>${Number(top.indice || 0).toFixed(1)}</strong> de Atividade,
          com <strong>${fmtNum(top.leis_aprovadas || 0)}</strong> materia(s) que viraram lei (Efetividade).</p>` : ""}

          <p class="indice-method__transp">${esc(metodo.transparencia || "")}</p>
        </div>
      </details>`;

    el.innerHTML = `
      <div class="indice-head">
        <div>
          <span class="method-card__tag">SCORE LEGISLATIVO · EXPERIMENTAL v2 · METODOLOGIA PÚBLICA</span>
          <h3 class="block__title">Produção &amp; Efetividade Legislativa</h3>
          <p class="block__lead">
            Duas notas, não uma: <strong>Atividade</strong> (o que o vereador produziu) e
            <strong>Efetividade</strong> (o que virou lei). Não mede popularidade, ideologia ou
            amizade política — só atividade documentada na fonte oficial. Atos simbólicos
            (moção, homenagem, nome de rua) aparecem por transparência, mas <strong>pesam zero</strong>.
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

      ${explicador}

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
          ? "ordena por matérias que viraram lei (desfecho oficial do SAPL). Produzir muito não é o mesmo que aprovar — aqui só conta o que virou resultado."
          : esc(perfilInfo.desc) + ". Escolha uma lente para ver o perfil do mandato; o painel mostra a composição, você tira a conclusão."}
      </div>

      <div class="indice-list">${topList.map(renderCard).join("")}</div>

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
    el.querySelectorAll("button[data-score]").forEach(function (btn) {
      btn.addEventListener("click", function (event) {
        event.stopPropagation();
        abrirModalScore(btn.dataset.score || "");
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
