/* Zela Varginha — modules/atualizacoes.js
 *
 * Feed cronológico de atos administrativos (contratos, aditivos, dispensas,
 * compras diretas, licitações) da Prefeitura e Câmara.
 *
 * Fontes:
 *   1. data/chunks/atualizacoes.json — atos publicados no Diário Oficial
 *      (em construção; hoje contém alguns exemplos de aditivos/dispensas)
 *   2. data/chunks/prefeitura.json + camara_anos.json — contratos coletados
 *      do Portal Betha, convertidos automaticamente em atos do feed
 *
 * Disponível em window.ZELA.atualizacoes.
 * Dependências: utils, icons, watchlist, categorias.
 */
(function () {
  "use strict";
  window.ZELA = window.ZELA || {};

  const u = window.ZELA.utils;
  if (!u) {
    console.error("[atualizacoes] window.ZELA.utils ausente.");
    return;
  }
  const { esc, cleanText, fmtBRL, fmtNum, norm } = u;

  function $(id) { return document.getElementById(id); }
  function icon(nome, opts) {
    return (window.ZELA.icon || function () { return ""; })(nome, opts);
  }

  // Mapa tipo → ícone + label visual
  const TIPOS = {
    contrato:       { icone: "documentos", label: "Contrato",       cor: "navy"   },
    aditivo:        { icone: "relogio",    label: "Aditivo",        cor: "orange" },
    dispensa:       { icone: "alerta",     label: "Dispensa",       cor: "red"    },
    compra_direta:  { icone: "cifrao",     label: "Compra direta",  cor: "teal"   },
    licitacao:      { icone: "lupa",       label: "Licitação",      cor: "gold"   },
    diaria:         { icone: "transporte", label: "Diária",         cor: "navy"   },
    convenio:       { icone: "predio",     label: "Convênio",       cor: "teal"   },
  };

  // Hashes dos portais Betha de Varginha (mesma fonte que o coletor usa)
  const BETHA_HASH = {
    prefeitura: "y7mn01LGqd_HCvGtj6VPwA==",
    camara:     "-iAWLe1kr2VQcrW9k2AUBg==",
  };

  // IDs de consulta do Betha por tipo — descobertos via coletor.py / coletor_betha.py
  // Aplicam-se tanto à Prefeitura quanto à Câmara (cada órgão tem seus próprios IDs).
  const BETHA_CONSULTA_PREFEITURA = {
    contrato:       83043,
    aditivo:        83043,  // aditivos ficam na consulta de contratos
    dispensa:       83062,
    compra_direta:  83045,
    licitacao:      82967,  // em andamento
    diaria:         83059,
    despesa:        83034,
    convenio:       83043,  // fallback contratos
  };
  const BETHA_CONSULTA_CAMARA = {
    contrato:       324812,
    aditivo:        324812,
    dispensa:       324812,  // Câmara não tem endpoint separado de dispensa
    compra_direta:  324812,
    licitacao:      324786,
    diaria:         324755,
    despesa:        324767,
    convenio:       324812,
  };

  // Constrói URL deep-link para a tabela exata no Betha de Varginha
  function urlBetha(orgao, tipo) {
    const isCamara = orgao === "Câmara";
    const hash = isCamara ? BETHA_HASH.camara : BETHA_HASH.prefeitura;
    const mapa = isCamara ? BETHA_CONSULTA_CAMARA : BETHA_CONSULTA_PREFEITURA;
    const id = mapa[tipo] || mapa.contrato;
    return `https://transparencia.betha.cloud/#/${hash}/consulta/${id}`;
  }

  const MESES_BR = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

  // Estado dos filtros
  let filtros = {
    orgao: "",
    tipo: "",
    relevancia: "",
    ano: "",
    mes: "",
    busca: "",
  };

  // ============================================================
  // Conversão de contratos reais → atos do feed
  // ============================================================
  function contratoParaAto(c, orgao) {
    const valor = Number(c.valor) || 0;
    const obj = (c.objeto || "").trim();
    const data = c.data_assinatura || "";
    if (!data) return null;

    // Relevância automática por valor
    let relevancia;
    if (valor >= 500000) relevancia = "alta";
    else if (valor >= 100000) relevancia = "media";
    else relevancia = "baixa";

    // Categoria automática
    const cat = (window.ZELA.classificarItem || (() => null))(c);
    const categorias = (window.ZELA.categorias || []);
    const catObj = categorias.find(x => x.id === cat);
    const categoria = catObj ? catObj.label : "Administração";

    // Tipo: dispense se modalidade contiver "dispensa", senão "contrato"
    const mod = (c.modalidade || "").toLowerCase();
    let tipo = "contrato";
    if (/dispens/i.test(mod)) tipo = "dispensa";
    else if (/compra.?direta/i.test(mod)) tipo = "compra_direta";
    else if (/preg[aã]o|concorr[eê]ncia|leil[aã]o/i.test(mod)) tipo = "licitacao";

    // Pontos de atenção automáticos
    const pontos = [];
    if (obj.length < 25) pontos.push("Objeto muito curto (" + obj.length + " caracteres): pedir Termo de Referência por LAI.");
    if (valor >= 1000000 && (!c.cnpj || c.cnpj.includes("*"))) pontos.push("Contrato de alto valor com CNPJ mascarado por LGPD — pedir cópia integral.");
    if (tipo === "dispensa" && valor > 17600) pontos.push("Dispensa de licitação acima de R$ 17.600 (limite Lei 14.133/2021) pede justificativa formal.");
    if (!c.data_fim) pontos.push("Sem data de fim/vigência registrada.");

    // Links contextuais — múltiplos caminhos pro cidadão chegar na publicação
    const cnpjLimpo = (c.cnpj || "").replace(/[^\d]/g, "");
    const cnpjValido = cnpjLimpo.length >= 8 && !(c.cnpj || "").includes("*");
    const empresa = cleanText(c.contratado || "");
    const numAno = `${c.numero || "s/n"}/${c.ano || ""}`;
    const orgaoQuery = orgao === "Prefeitura" ? "Prefeitura Varginha" : "Câmara Varginha";

    const links = [];

    // 1) Portal Betha — URL deep-link para a TABELA exata onde a info foi coletada
    links.push({
      tipo: "betha",
      label: "Tabela do Betha",
      url: urlBetha(orgao, tipo),
      tooltip: `Abre direto a tabela do Portal Betha de Varginha. Use a busca interna para localizar ${numAno} ou "${empresa}".`,
    });

    // 2) Diário Oficial de Varginha (busca manual)
    links.push({
      tipo: "diario",
      label: "Diário Oficial",
      url: "https://www.varginha.mg.gov.br/diario-oficial-eletronico/",
      tooltip: `Busque a edição que publicou o contrato ${numAno}.`,
    });

    // 3) Portal de Transparência oficial da Prefeitura
    if (orgao === "Prefeitura") {
      links.push({
        tipo: "prefeitura",
        label: "Portal oficial",
        url: "https://transparencia.varginha.mg.gov.br/portal-transparencia/consultas/contratos",
        tooltip: "Portal oficial da Prefeitura (pode estar temporariamente indisponível).",
      });
    } else {
      links.push({
        tipo: "camara",
        label: "Site da Câmara",
        url: "https://www.varginha.mg.leg.br/transparencia",
        tooltip: "Site oficial da Câmara Municipal de Varginha.",
      });
    }

    // 4) Casa dos Dados (CNPJ) — só se CNPJ não estiver mascarado
    if (cnpjValido) {
      links.push({
        tipo: "cnpj",
        label: "Consultar CNPJ",
        url: `https://casadosdados.com.br/solucao/cnpj/${cnpjLimpo}`,
        tooltip: "Consultar empresa na Receita Federal (situação cadastral, sócios, abertura).",
      });
    }

    // 5) Google search inteligente
    const gQuery = `"${numAno}" OR "${empresa}" ${orgaoQuery} contrato site:gov.br`;
    links.push({
      tipo: "google",
      label: "Buscar no Google",
      url: `https://www.google.com/search?q=${encodeURIComponent(gQuery)}`,
      tooltip: "Pesquisa Google restrita a sites .gov.br.",
    });

    return {
      id: `${orgao.toUpperCase()}-${c.ano || ""}-${c.numero || "?"}`,
      data,
      orgao,
      tipo,
      categoria,
      relevancia,
      titulo: `Contrato ${numAno} — ${empresa || "—"}`,
      resumo: cleanText(obj || "Objeto não informado"),
      envolvidos: c.contratado ? [{
        nome: empresa,
        cnpj: c.cnpj || "",
        papel: "contratada",
      }] : [],
      valores: [
        { rotulo: "Valor total", valor },
        ...(c.modalidade ? [{ rotulo: "Modalidade", valor: 0, _raw: cleanText(c.modalidade) }] : []),
      ].filter(v => !v._raw || v._raw.length > 0),
      pontos_atencao: pontos,
      publicacao_url: urlBetha(orgao, tipo), // deep-link direto para a tabela de Varginha
      links_contexto: links,
      copia_numero: numAno,
      _fonte: "betha",
    };
  }

  // ============================================================
  // Carrega todos os atos: mocks do diário + contratos reais
  // ============================================================
  function carregarAtos() {
    const D = window.ZELA_DATA || {};
    const mockData = D.atualizacoes || {};
    const mocks = (mockData.atos || []).map(a => ({ ...a, _fonte: "diario" }));

    const pf = D.prefeitura || {};
    const contratosPref = (pf.contratos || [])
      .map(c => contratoParaAto(c, "Prefeitura"))
      .filter(Boolean);

    // Câmara: contratos vêm do chunk camara_betha (coletado pelo coletor_betha.py)
    const cb = D.camara_betha || {};
    const contratosCam = (cb.contratos || [])
      .map(c => contratoParaAto(c, "Câmara"))
      .filter(Boolean);

    return [...mocks, ...contratosPref, ...contratosCam];
  }

  // ============================================================
  // Dashboard topo
  // ============================================================
  function renderStats(atos) {
    const el = $("atualizacoesStats");
    if (!el) return;

    const hoje = new Date().toISOString().slice(0, 10);
    const seteDias = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const atosHoje = atos.filter(a => a.data === hoje).length;
    const atosSemana = atos.filter(a => a.data >= seteDias).length;
    const altos = atos.filter(a => a.relevancia === "alta").length;
    const valorSemana = atos
      .filter(a => a.data >= seteDias)
      .reduce((s, a) => {
        const v = (a.valores || []).find(v => /valor.*total|estimad|original/i.test(v.rotulo || ""));
        return s + (v ? Number(v.valor || 0) : 0);
      }, 0);

    el.innerHTML = `
      <div class="placar-card placar-card--count">
        <span class="placar-card__icon">${icon("relogio", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtNum(atosHoje)}</span>
        <span class="placar-card__label">Atos publicados hoje</span>
        <span class="placar-card__sub">${atosHoje === 0 ? "Aguardando publicação" : "Conferir abaixo"}</span>
      </div>
      <div class="placar-card placar-card--money">
        <span class="placar-card__icon">${icon("cifrao", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtBRL(valorSemana)}</span>
        <span class="placar-card__label">Valor movimentado (7 dias)</span>
        <span class="placar-card__sub"><strong>${fmtNum(atosSemana)}</strong> ato${atosSemana !== 1 ? "s" : ""} na semana</span>
      </div>
      <div class="placar-card placar-card--warn">
        <span class="placar-card__icon">${icon("alerta", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtNum(altos)}</span>
        <span class="placar-card__label">Alta relevância</span>
        <span class="placar-card__sub">Pedem fiscalização prioritária</span>
      </div>
      <div class="placar-card placar-card--top">
        <span class="placar-card__icon">${icon("trofeu", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtNum(atos.length)}</span>
        <span class="placar-card__label">Total no painel</span>
        <span class="placar-card__sub">Todos os atos disponíveis</span>
      </div>
    `;
  }

  // ============================================================
  // Filtros dinâmicos de ano e mês
  // ============================================================
  function renderFiltrosTempo(atos) {
    const elAno = $("atualizacoesFiltrosAno");
    const elMes = $("atualizacoesFiltrosMes");
    if (!elAno) return;

    // Anos disponíveis
    const anos = [...new Set(atos.map(a => (a.data || "").slice(0, 4)).filter(Boolean))]
      .sort((a, b) => Number(b) - Number(a));

    if (anos.length) {
      elAno.innerHTML =
        `<span class="cat-chips__label">${icon("calendario", { size: 14 })} Ano:</span>` +
        anos.map(ano =>
          `<button type="button" class="cat-chip${filtros.ano === ano ? " is-active" : ""}" data-filtro="ano" data-valor="${ano}">${ano}</button>`
        ).join("") +
        (filtros.ano ? `<button type="button" class="cat-chip cat-chip--clear" data-filtro="ano" data-valor="">Limpar ano</button>` : "");
    }

    // Mês — só se ano selecionado
    if (!elMes) return;
    if (!filtros.ano) {
      elMes.innerHTML = "";
      elMes.style.display = "none";
      return;
    }

    const mesesNoAno = [...new Set(
      atos
        .filter(a => (a.data || "").startsWith(filtros.ano))
        .map(a => (a.data || "").slice(5, 7))
        .filter(Boolean)
    )].sort();

    elMes.style.display = "flex";
    elMes.innerHTML =
      `<span class="cat-chips__label">Mês:</span>` +
      mesesNoAno.map(mm => {
        const idx = parseInt(mm, 10) - 1;
        const label = MESES_BR[idx] || mm;
        return `<button type="button" class="cat-chip${filtros.mes === mm ? " is-active" : ""}" data-filtro="mes" data-valor="${mm}">${label}</button>`;
      }).join("") +
      (filtros.mes ? `<button type="button" class="cat-chip cat-chip--clear" data-filtro="mes" data-valor="">Limpar mês</button>` : "");
  }

  // ============================================================
  // Cruzamento com dados existentes
  // ============================================================
  function cruzar(envolvido) {
    if (!envolvido || !envolvido.cnpj) return null;
    const raiz = envolvido.cnpj.replace(/[^\d]/g, "").slice(0, 8);
    if (raiz.length < 8) return null;
    const D = window.ZELA_DATA || {};
    const pf = D.prefeitura || {};
    const contratos = (pf.contratos || []).filter(c =>
      (c.cnpj || "").replace(/[^\d]/g, "").slice(0, 8) === raiz
    );
    const emendas = (D.emendas || []).filter(e =>
      (e.cnpj || "").replace(/[^\d]/g, "").slice(0, 8) === raiz
    );
    if (!contratos.length && !emendas.length) return null;
    return { contratos: contratos.length, emendas: emendas.length };
  }

  // ============================================================
  // Pergunta LAI por tipo
  // ============================================================
  function perguntaLAI(ato) {
    const e0 = (ato.envolvidos || [])[0];
    const empresa = e0 ? (e0.nome || "") : "(empresa)";
    const valorTotal = (ato.valores || []).find(v => /total|estimad|original/i.test(v.rotulo || ""));
    const valor = valorTotal ? fmtBRL(valorTotal.valor) : "(valor)";

    const por_tipo = {
      contrato:      `Solicito cópia integral do contrato ${empresa}, incluindo Termo de Referência, justificativa, pesquisa de preços, ato de homologação, empenho, liquidações, notas fiscais, comprovantes de pagamento e relatório do fiscal do contrato.`,
      aditivo:       `Solicito cópia integral do aditivo ao contrato firmado com ${empresa}, justificativa técnica para a alteração, parecer jurídico autorizativo, planilha comparativa antes/depois e nova ordem de execução.`,
      dispensa:      `Solicito cópia integral do processo de dispensa de licitação para ${empresa} no valor de ${valor}, incluindo justificativa, pesquisa de preços de pelo menos 3 fornecedores, parecer jurídico autorizativo e ato de ratificação.`,
      compra_direta: `Solicito cópia integral do processo de compra direta com ${empresa} no valor de ${valor}, incluindo justificativa da necessidade, pesquisa de preços, nota fiscal e comprovante de entrega.`,
      licitacao:     `Solicito edital integral, anexos, ata de abertura, resultado final, ato de homologação e contrato resultante da licitação ${ato.titulo}, valor estimado de ${valor}.`,
      diaria:        `Solicito cópia integral do processo administrativo da diária paga, justificativa da viagem, autorização superior, comprovantes de participação, certificados e prestação de contas.`,
      convenio:      `Solicito cópia integral do convênio firmado com ${empresa}, plano de trabalho, prestação de contas parcial e final, relatório de execução e comprovantes de aplicação dos recursos.`,
    };
    return por_tipo[ato.tipo] || por_tipo.contrato;
  }

  // ============================================================
  // Card de ato — sem emojis, usando SVGs profissionais
  // ============================================================
  function renderCard(ato) {
    const t = TIPOS[ato.tipo] || TIPOS.contrato;
    const dataBr = (ato.data || "").split("-").reverse().join("/");

    const envolvidosHtml = (ato.envolvidos || []).map(e => {
      const cruz = cruzar(e);
      const cruzBadge = cruz
        ? `<span class="tline-tag tline-tag--blue" style="margin-left:6px;" title="Esta empresa já aparece em outros atos do painel">Histórico: ${cruz.contratos} contrato${cruz.contratos !== 1 ? "s" : ""}${cruz.emendas > 0 ? " · " + cruz.emendas + " emenda" + (cruz.emendas !== 1 ? "s" : "") : ""}</span>`
        : "";
      return `<li>
        <strong>${esc(cleanText(e.nome || ""))}</strong>
        ${e.cnpj ? `<span class="muted small" style="font-family:var(--font-mono); margin-left:6px;">${esc(e.cnpj)}</span>` : ""}
        ${e.papel ? `<span class="muted small">· ${esc(e.papel)}</span>` : ""}
        ${cruzBadge}
      </li>`;
    }).join("");

    const valoresHtml = (ato.valores || []).map(v => {
      let display;
      if (v._raw) display = esc(v._raw);
      else if (typeof v.valor === "number" && v.rotulo && /quantidad|qtd/i.test(v.rotulo)) display = fmtNum(v.valor);
      else display = fmtBRL(v.valor || 0);
      return `<li><span class="muted small">${esc(v.rotulo || "")}:</span> <strong>${display}</strong></li>`;
    }).join("");

    const atencaoHtml = (ato.pontos_atencao || []).map(p =>
      `<li>${esc(cleanText(p))}</li>`
    ).join("");

    const idAto = ato.id || `${ato.data}-${ato.titulo}`;
    const btnWatch = (window.ZELA.watchlist || {}).botao
      ? window.ZELA.watchlist.botao("atualizacoes", idAto)
      : "";

    // Compartilhar WhatsApp
    const msgWa = encodeURIComponent(
      `${ato.titulo}\nData: ${dataBr} — ${ato.orgao}\n${ato.resumo}\n\nVer mais: ${window.location.href}#${idAto}`
    );
    const linkWa = `https://api.whatsapp.com/send?text=${msgWa}`;

    return `<article class="tline-item tline-item--${t.cor}" id="${esc(idAto)}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div class="tline-data">${dataBr} · ${ato.orgao}</div>
        ${btnWatch}
      </div>
      <h4 class="tline-titulo">${esc(cleanText(ato.titulo))}</h4>
      <p class="tline-desc">
        <span class="tline-tag tline-tag--${t.cor}">${icon(t.icone, { size: 12 })} ${t.label}</span>
        ${ato.relevancia ? `<span class="tline-tag tline-tag--${relevanciaCor(ato.relevancia)}">${relevanciaLabel(ato.relevancia)}</span>` : ""}
        ${ato.categoria ? `<span class="tline-tag tline-tag--gold">${esc(ato.categoria)}</span>` : ""}
      </p>
      <p style="margin:8px 0; line-height:1.5;">${esc(cleanText(ato.resumo || ""))}</p>

      ${envolvidosHtml ? `
        <details style="margin:10px 0;">
          <summary style="cursor:pointer; font-weight:600; font-size:.88rem; display:flex; align-items:center; gap:6px;">${icon("pessoas", { size: 14 })} Envolvidos</summary>
          <ul style="margin:8px 0 0 18px; font-size:.88rem;">${envolvidosHtml}</ul>
        </details>
      ` : ""}

      ${valoresHtml ? `
        <details style="margin:10px 0;" open>
          <summary style="cursor:pointer; font-weight:600; font-size:.88rem; display:flex; align-items:center; gap:6px;">${icon("cifrao", { size: 14 })} Valores identificados</summary>
          <ul style="margin:8px 0 0 18px; font-size:.88rem;">${valoresHtml}</ul>
        </details>
      ` : ""}

      ${atencaoHtml ? `
        <details style="margin:10px 0;" open>
          <summary style="cursor:pointer; font-weight:600; font-size:.88rem; color:var(--red); display:flex; align-items:center; gap:6px;">${icon("alerta", { size: 14 })} Pontos de atenção</summary>
          <ul style="margin:8px 0 0 18px; font-size:.88rem; color:var(--ink);">${atencaoHtml}</ul>
        </details>
      ` : ""}

      <!-- Botão copiar nº do contrato — fica em destaque -->
      ${ato.copia_numero ? `
        <div style="margin-top:14px; padding:10px 12px; background:var(--cream); border-radius:6px; border:1px dashed var(--line); display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span style="font-size:.82rem; color:var(--muted);">Pesquisar a publicação? Copie o número:</span>
          <code style="background:#fff; padding:3px 10px; border-radius:4px; font-weight:700; color:var(--navy); border:1px solid var(--line);">${esc(ato.copia_numero)}</code>
          <button type="button" onclick="window.ZELA.atualizacoes.copiarNumero('${esc(ato.copia_numero).replace(/'/g, "\\'")}', this)" style="padding:4px 10px; background:var(--navy); color:#fff; border:none; border-radius:4px; font-size:.78rem; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">${icon("copiar", { size: 12 })} Copiar</button>
        </div>
      ` : ""}

      <!-- Links contextuais — múltiplos caminhos -->
      <div style="margin-top:10px;">
        <span class="muted small" style="display:block; margin-bottom:6px;">Onde verificar este ato:</span>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          ${(ato.links_contexto || []).map(l => `
            <a class="btn-link" href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.tooltip || "")}"
               style="padding:5px 10px; background:${linkBg(l.tipo)}; color:${linkColor(l.tipo)}; border-radius:4px; font-size:.78em; font-weight:600; text-decoration:none; border:1px solid ${linkBorder(l.tipo)}; display:inline-flex; align-items:center; gap:5px;">
              ${icon(linkIcon(l.tipo), { size: 13 })} ${esc(l.label)}
            </a>`).join("") ||
            (ato.publicacao_url ? `<a class="btn-link" href="${esc(ato.publicacao_url)}" target="_blank" rel="noopener" style="padding:5px 10px; background:#e8f4fd; color:#1565c0; border-radius:4px; font-size:.78em; font-weight:600; text-decoration:none; border:1px solid #90caf9;">${icon("lupa", { size: 13 })} Ver publicação</a>` : "")}
          ${ato.anexo_pdf ? `<a class="btn-link" href="${esc(ato.anexo_pdf)}" target="_blank" rel="noopener" style="padding:5px 10px; background:#fff3e0; color:#6d4c00; border-radius:4px; font-size:.78em; font-weight:600; text-decoration:none; border:1px solid #ffd54f; display:inline-flex; align-items:center; gap:5px;">${icon("anexo", { size: 13 })} PDF do ato</a>` : ""}
        </div>
      </div>

      <!-- Ações principais -->
      <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
        <a class="btn-link" href="${linkWa}" target="_blank" rel="noopener" style="padding:6px 12px; background:#0b5f3a; color:white; border-radius:4px; font-size:.82em; font-weight:600; text-decoration:none; display:inline-flex; align-items:center; gap:6px;">${icon("compartilhar", { size: 14 })} Compartilhar</a>
        <button type="button" class="btn-link" onclick="window.ZELA.atualizacoes.copiarLAI('${idAto.replace(/'/g, "\\'")}', this)" style="padding:6px 12px; background:#fff8e1; color:#6d4c00; border-radius:4px; font-size:.82em; font-weight:600; border:1px solid #ffd54f; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">${icon("copiar", { size: 14 })} Copiar pergunta LAI</button>
      </div>

      <textarea class="dossier-lai-pergunta" data-id="${esc(idAto)}" readonly hidden>${esc(perguntaLAI(ato))}</textarea>
    </article>`;
  }

  // Paletas dos botões de link contextual
  function linkBg(tipo) {
    return {
      betha:      "#e8f4fd",
      diario:     "#f3e5f5",
      prefeitura: "#eee",
      camara:     "#eee",
      cnpj:       "#fff3e0",
      google:     "#f1f8e9",
    }[tipo] || "#eee";
  }
  function linkColor(tipo) {
    return {
      betha:      "#1565c0",
      diario:     "#6a1b9a",
      prefeitura: "#333",
      camara:     "#333",
      cnpj:       "#6d4c00",
      google:     "#33691e",
    }[tipo] || "#333";
  }
  function linkBorder(tipo) {
    return {
      betha:      "#90caf9",
      diario:     "#ce93d8",
      prefeitura: "#ccc",
      camara:     "#ccc",
      cnpj:       "#ffd54f",
      google:     "#aed581",
    }[tipo] || "#ccc";
  }
  function linkIcon(tipo) {
    return {
      betha:      "lupa",
      diario:     "documentos",
      prefeitura: "predio",
      camara:     "predio",
      cnpj:       "predio",
      google:     "lupa",
    }[tipo] || "lupa";
  }

  function relevanciaCor(r) {
    if (r === "alta") return "red";
    if (r === "media") return "orange";
    return "gold";
  }
  function relevanciaLabel(r) {
    if (r === "alta") return "Alta relevância";
    if (r === "media") return "Relevância média";
    return "Relevância baixa";
  }

  // ============================================================
  // Render principal
  // ============================================================
  function render() {
    const todos = carregarAtos();

    // Aplica filtros
    const q = norm(filtros.busca);
    const view = todos.filter(a => {
      if (filtros.orgao && a.orgao !== filtros.orgao) return false;
      if (filtros.tipo && a.tipo !== filtros.tipo) return false;
      if (filtros.relevancia && a.relevancia !== filtros.relevancia) return false;
      if (filtros.ano && !(a.data || "").startsWith(filtros.ano)) return false;
      if (filtros.mes && (a.data || "").slice(5, 7) !== filtros.mes) return false;
      if (q) {
        const hay = norm(
          [a.titulo, a.resumo, a.categoria, a.tipo, a.orgao,
           ...(a.envolvidos || []).map(e => (e.nome || "") + " " + (e.cnpj || "")),
           ...(a.pontos_atencao || [])
          ].filter(Boolean).join(" ")
        );
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    // Stats sempre baseado em TODOS (visão global)
    renderStats(todos);

    // Filtros de tempo (anos/meses) baseados em todos
    renderFiltrosTempo(todos);

    // Contador
    const contador = $("atualizacoesContador");
    if (contador) contador.textContent = `${fmtNum(view.length)} ato${view.length !== 1 ? "s" : ""}`;

    // Empty state
    const feedEl = $("atualizacoesFeed");
    const emptyEl = $("atualizacoesEmpty");
    if (!view.length) {
      if (feedEl) feedEl.innerHTML = "";
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    // Ordena por data decrescente, limita a 200 para não explodir DOM
    const sorted = [...view].sort((a, b) => (b.data || "").localeCompare(a.data || "")).slice(0, 200);

    if (feedEl) feedEl.innerHTML = sorted.map(renderCard).join("");

    // Atualiza visual dos chips de tipo/orgão/relevância
    document.querySelectorAll("#atualizacoesFiltros .cat-chip").forEach(chip => {
      const filtro = chip.dataset.filtro;
      const valor = chip.dataset.valor;
      if (!filtro) {
        chip.classList.remove("is-active");
        return;
      }
      chip.classList.toggle("is-active", filtros[filtro] === valor && valor !== "");
    });
  }

  // ============================================================
  // Helpers de cópia
  // ============================================================
  function feedback(btn, txt) {
    if (!btn) return;
    const old = btn.innerHTML;
    btn.innerHTML = "✓ " + txt;
    setTimeout(() => { btn.innerHTML = old; }, 1600);
  }

  function copiarLAI(id, btn) {
    const ta = document.querySelector(`textarea.dossier-lai-pergunta[data-id="${id}"]`);
    if (!ta) return;
    navigator.clipboard.writeText(ta.value).then(() => {
      feedback(btn, "Copiado");
    }).catch(() => {
      ta.hidden = false;
      ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      ta.hidden = true;
      feedback(btn, "Copiado");
    });
  }

  function copiarNumero(num, btn) {
    if (!num) return;
    navigator.clipboard.writeText(num).then(() => {
      feedback(btn, "Copiado");
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = num;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
      feedback(btn, "Copiado");
    });
  }

  // ============================================================
  // Init
  // ============================================================
  function init() {
    if (document.body.dataset.page !== "atualizacoes") return;

    // Delegação de clique nos chips (orgão, tipo, relevância)
    const filtrosEl = $("atualizacoesFiltros");
    if (filtrosEl) {
      filtrosEl.addEventListener("click", e => {
        const chip = e.target.closest(".cat-chip");
        if (!chip) return;
        const filtro = chip.dataset.filtro;
        const valor = chip.dataset.valor;
        if (!filtro && !valor) {
          filtros = { orgao: "", tipo: "", relevancia: "", ano: filtros.ano, mes: filtros.mes, busca: filtros.busca };
        } else {
          filtros[filtro] = filtros[filtro] === valor ? "" : valor;
        }
        render();
      });
    }

    // Delegação de clique nos chips de ano
    const filtrosAnoEl = $("atualizacoesFiltrosAno");
    if (filtrosAnoEl) {
      filtrosAnoEl.addEventListener("click", e => {
        const chip = e.target.closest(".cat-chip");
        if (!chip) return;
        const novoAno = chip.dataset.valor || "";
        if (filtros.ano === novoAno && novoAno !== "") {
          filtros.ano = "";
          filtros.mes = "";
        } else {
          filtros.ano = novoAno;
          filtros.mes = ""; // reseta mês ao trocar ano
        }
        render();
      });
    }

    // Delegação de clique nos chips de mês
    const filtrosMesEl = $("atualizacoesFiltrosMes");
    if (filtrosMesEl) {
      filtrosMesEl.addEventListener("click", e => {
        const chip = e.target.closest(".cat-chip");
        if (!chip) return;
        const novoMes = chip.dataset.valor || "";
        filtros.mes = filtros.mes === novoMes ? "" : novoMes;
        render();
      });
    }

    // Busca textual
    const buscaEl = $("filtroAtualizacoes");
    if (buscaEl) {
      buscaEl.addEventListener("input", () => {
        filtros.busca = buscaEl.value || "";
        render();
      });
    }

    render();
  }

  window.ZELA.atualizacoes = Object.freeze({
    init,
    render,
    copiarLAI,
    copiarNumero,
  });
})();
