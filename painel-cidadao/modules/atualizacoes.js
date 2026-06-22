/* Fiscaliza Varginha — modules/atualizacoes.js
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
    despesa:        { icone: "cifrao",     label: "Pagamentos",     cor: "orange" },
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
  const DIARIO_PORTAL_URL = "https://www.varginha.mg.gov.br/portal/diario-oficial/1/0/0/fios/0/";
  const DIARIO_EDICAO_OFFSET = 1593;

  // Estado dos filtros
  let abaAtual = "atos";
  let filtros = {
    orgao: "",
    tipo: "",
    relevancia: "",
    ano: "",
    mes: "",
    busca: "",
  };

  function hojeISO() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function dataISO(valor) {
    return String(valor || "").slice(0, 10);
  }

  function formatarDataHora(valor) {
    if (!valor) return "Data não informada";
    const normalizada = String(valor).replace(" ", "T");
    const d = new Date(normalizada);
    if (Number.isNaN(d.getTime())) return cleanText(valor);
    return d.toLocaleDateString("pt-BR") + " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function idPublicacaoDiario(edicao) {
    const n = Number(String(edicao || "").replace(/[^\d]/g, ""));
    if (!Number.isFinite(n) || n <= DIARIO_EDICAO_OFFSET) return "";
    return String(n - DIARIO_EDICAO_OFFSET);
  }

  function urlPdfDiario(item, edicao) {
    const id = cleanText(item.publicacao_id || item.id_publicacao || idPublicacaoDiario(edicao));
    if (item.url_pdf_direta) return cleanText(item.url_pdf_direta);
    if (id) return `https://www.varginha.mg.gov.br/portal/diario-oficial/ver/${id}/`;
    if (item.url_pdf && !/\/ver\/\d{4}\//.test(String(item.url_pdf))) return cleanText(item.url_pdf);
    return DIARIO_PORTAL_URL;
  }

  function valorAto(ato) {
    return (ato.valores || []).reduce((s, v) => s + Number(v.valor || 0), 0);
  }

  function ehCompraOuContratacao(ato) {
    const txt = norm([ato.tipo, ato.categoria, ato.titulo, ato.resumo].filter(Boolean).join(" "));
    return ["contrato", "compra_direta", "dispensa", "licitacao"].includes(ato.tipo) ||
      /(contrato|compra|aquisi|fornecimento|servico|serviço|dispensa|licitacao|licitação|pregao|pregão|contrat)/.test(txt);
  }

  function ehCargoComissionado(ato) {
    const txt = norm([ato.tipo, ato.categoria, ato.titulo, ato.resumo].filter(Boolean).join(" "));
    return /(comissionado|cargo em comissao|cargo em comissão|nomeacao|nomeação|exoneracao|exoneração|servidor|folha|pessoal)/.test(txt);
  }

  function ehLeiOuAlteracao(ato) {
    const txt = norm([ato.tipo, ato.categoria, ato.titulo, ato.resumo].filter(Boolean).join(" "));
    return /(lei|projeto de lei|alteracao de lei|alteração de lei|decreto|portaria|resolucao|resolução|norma|legislativo)/.test(txt);
  }

  function resumoDiarioCidadao(edicao, atosCache) {
    const itens = [];
    const descricao = cleanText(edicao.descricao || "");
    if (descricao) {
      descricao
        .split(/[\n;•]+/)
        .map(p => cleanText(p))
        .filter(Boolean)
        .slice(0, 5)
        .forEach(p => itens.push(p));
    }

    const atosDia = (atosCache || carregarAtos()).filter(a => dataISO(a.data) === edicao.data);
    if (atosDia.length) {
      const compras = atosDia.filter(ehCompraOuContratacao);
      const cargos = atosDia.filter(ehCargoComissionado);
      const leis = atosDia.filter(ehLeiOuAlteracao);
      const outros = atosDia.filter(a => !compras.includes(a) && !cargos.includes(a) && !leis.includes(a));
      const porTipo = atosDia.reduce((acc, ato) => {
        const key = cleanText((TIPOS[ato.tipo] && TIPOS[ato.tipo].label) || ato.tipo || "Ato");
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const tipos = Object.entries(porTipo).map(([tipo, qtd]) => `${fmtNum(qtd)} ${tipo.toLowerCase()}`).join(", ");
      itens.push(`No painel, há ${fmtNum(atosDia.length)} ato(s) da mesma data para conferir junto da edição: ${tipos}.`);
      if (compras.length) {
        const totalCompras = compras.reduce((s, ato) => s + valorAto(ato), 0);
        const maiorCompra = compras.slice().sort((a, b) => valorAto(b) - valorAto(a))[0];
        itens.push(`Compras/contratações: ${fmtNum(compras.length)} ato(s) localizado(s), somando ${fmtBRL(totalCompras)}${maiorCompra ? `; maior item: ${cleanText(maiorCompra.titulo || "")}` : ""}.`);
      }
      if (cargos.length) {
        itens.push(`Cargos, servidores ou folha: ${fmtNum(cargos.length)} ato(s) para conferir nomeação, exoneração, vínculo ou remuneração.`);
      }
      if (leis.length) {
        itens.push(`Leis, decretos ou alterações normativas: ${fmtNum(leis.length)} ato(s) para ler no PDF antes de interpretar impacto.`);
      }
      if (outros.length && !compras.length && !cargos.length && !leis.length) {
        itens.push(`Outros atos administrativos relacionados no painel: ${fmtNum(outros.length)} registro(s).`);
      }
      const maior = atosDia
        .map(a => ({ ato: a, valor: valorAto(a) }))
        .sort((a, b) => b.valor - a.valor)[0];
      if (maior && maior.valor > 0) {
        itens.push(`Maior valor relacionado no painel nessa data: ${fmtBRL(maior.valor)} em ${cleanText(maior.ato.titulo || "ato administrativo")}.`);
      }
    }

    if (!itens.length) {
      itens.push("O dado aberto informa a edição, data e tipo, mas ainda não entrega o texto interno em formato estruturado.");
      itens.push("Clique em “Abrir PDF da edição” para ler o inteiro teor oficial sem precisar procurar no portal da Prefeitura.");
      itens.push("Para divulgar ou cobrar algum ponto, use o PDF oficial como fonte primária.");
    }

    return itens.slice(0, 6);
  }

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

    // ============================================================
    // Top fornecedores sem contrato formal — gerar ato sintético
    // ============================================================
    // Empresas que aparecem em Top Fornecedores (= recebem pagamentos)
    // mas NÃO têm contrato vigente no portal. Útil para o cidadão saber
    // que existe relação financeira, mesmo sem contrato formal.
    function fornecedorParaAto(f, orgao, contratosExistentes) {
      const nome = cleanText(f.nome || "");
      if (!nome) return null;
      // Já existe contrato para essa empresa? Se sim, não gera duplicata.
      // Match por CNPJ (raiz de 8 dígitos — visível mesmo com máscara LGPD)
      // tem prioridade; nome é só fallback. Evita acusar de "sem contrato"
      // empresa cujo nome está grafado diferente nas duas bases.
      const nomeNorm = norm(nome);
      const cnpjRoot = (s) => (s || "").replace(/[^\d]/g, "").slice(0, 8);
      const fRoot = cnpjRoot(f.cnpj);
      const jaTem = contratosExistentes.some(a =>
        (a.envolvidos || []).some(e => {
          const eRoot = cnpjRoot(e.cnpj);
          if (fRoot.length === 8 && fRoot === eRoot) return true; // mesmo CNPJ
          const en = norm(e.nome || "");
          return en.length > 0 && (en.includes(nomeNorm) || nomeNorm.includes(en));
        })
      );
      if (jaTem) return null;

      const valor = Number(f.valor_total) || 0;
      const ano = orgao === "Câmara"
        ? ((window.ZELA_DATA.camara_betha || {}).ano_atual)
        : ((window.ZELA_DATA.prefeitura || {}).ano_atual);
      const dataRef = ano ? `${ano}-12-31` : "";
      const idAto = `${orgao.toUpperCase()}-FORN-${(nomeNorm.replace(/[^a-z0-9]/g, "")).slice(0, 24)}`;

      return {
        id: idAto,
        data: dataRef,
        // Rótulo de exibição: este ato agrega o TOTAL do ano, não tem data
        // de evento. Mostrar "Acumulado no ano" evita o cidadão ler 31/12
        // como se fosse a data de um pagamento específico.
        data_rotulo: `Acumulado em ${ano || "ano atual"}`,
        orgao,
        tipo: "despesa",
        categoria: "Administração",
        relevancia: valor >= 500000 ? "alta" : valor >= 100000 ? "media" : "baixa",
        titulo: `Pagamentos a ${nome} (sem contrato formal)`,
        resumo: `Empresa recebeu ${fmtBRL(valor)} em pagamentos da ${orgao} de Varginha em ${ano || "ano atual"}, mas não há contrato vigente registrado no portal. Pode ser compra direta, dispensa, ou pagamento via emenda.`,
        envolvidos: [{ nome, cnpj: f.cnpj || "", papel: "fornecedora" }],
        valores: [{ rotulo: "Total pago no ano", valor }],
        pontos_atencao: [
          "Empresa recebe da " + orgao + " mas não consta na tabela de contratos vigentes.",
          "Pedir LAI: detalhamento dos pagamentos, número dos empenhos e motivo da ausência de contrato formal.",
        ],
        publicacao_url: urlBetha(orgao, "despesa"),
        links_contexto: [
          { tipo: "betha", label: "Tabela de despesas", url: urlBetha(orgao, "despesa"),
            tooltip: `Abre a tabela de despesas da ${orgao} no Betha. Cole o nome "${nome}" na busca.` },
          ...((f.cnpj || "").replace(/[^\d]/g, "").length >= 8 && !(f.cnpj || "").includes("*") ? [{
            tipo: "cnpj", label: "Consultar CNPJ",
            url: `https://casadosdados.com.br/solucao/cnpj/${(f.cnpj || "").replace(/[^\d]/g, "")}`,
            tooltip: "Situação cadastral na Receita Federal.",
          }] : []),
          { tipo: "google", label: "Buscar no Google",
            url: `https://www.google.com/search?q=${encodeURIComponent('"' + nome + '" ' + orgao + ' Varginha pagamento site:gov.br')}`,
            tooltip: "Pesquisa Google restrita a .gov.br." },
        ],
        copia_numero: "",
        _fonte: "top_fornecedores",
      };
    }

    const fornPref = (pf.top_fornecedores_atual || [])
      .map(f => fornecedorParaAto(f, "Prefeitura", contratosPref))
      .filter(Boolean);
    const fornCam = (cb.top_fornecedores_atual || [])
      .map(f => fornecedorParaAto(f, "Câmara", contratosCam))
      .filter(Boolean);

    return [...mocks, ...contratosPref, ...contratosCam, ...fornPref, ...fornCam];
  }

  // ============================================================
  // Dashboard topo
  // ============================================================
  function renderStats(atos) {
    const el = $("atualizacoesStats");
    if (!el) return;

    const hoje = hojeISO();
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

  function carregarDiario() {
    const D = window.ZELA_DATA || {};
    const diario = D.diario || {};
    return (diario.ultimas || []).map((item, idx) => {
      const edicao = cleanText(item.edicao || item.numero || "");
      const data = dataISO(item.data);
      const ano = String(item.ano || data.slice(0, 4) || "");
      const url = urlPdfDiario(item, edicao);
      return {
        id: `diario-${ano}-${edicao || idx}`,
        data,
        sortKey: cleanText(item.data || data),
        ano,
        edicao,
        extra: Boolean(item.extra),
        descricao: cleanText(item.descricao || item.resumo || ""),
        publicacaoId: cleanText(item.publicacao_id || item.id_publicacao || idPublicacaoDiario(edicao)),
        url,
        urlPortal: DIARIO_PORTAL_URL,
        titulo: `Diário Oficial - Edição ${edicao || "sem número"}`,
        resumo: `${item.extra ? "Edição extra" : "Edição ordinária"} publicada em ${formatarDataHora(item.data)}.`,
      };
    });
  }

  function renderStatsDiario(edicoes) {
    const el = $("atualizacoesStats");
    if (!el) return;

    const diario = (window.ZELA_DATA || {}).diario || {};
    const hoje = hojeISO();
    const edicoesHoje = edicoes.filter(e => e.data === hoje).length;
    const extras = edicoes.filter(e => e.extra).length;
    const ultima = edicoes[0];

    el.innerHTML = `
      <div class="placar-card placar-card--count">
        <span class="placar-card__icon">${icon("documentos", { size: 24 })}</span>
        <span class="placar-card__valor">${ultima ? esc(ultima.edicao || "-") : "-"}</span>
        <span class="placar-card__label">Última edição</span>
        <span class="placar-card__sub">${ultima ? esc(formatarDataHora(ultima.sortKey)) : "Aguardando coleta"}</span>
      </div>
      <div class="placar-card placar-card--money">
        <span class="placar-card__icon">${icon("relogio", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtNum(edicoesHoje)}</span>
        <span class="placar-card__label">Edições hoje</span>
        <span class="placar-card__sub">${edicoesHoje ? "Nova publicação oficial" : "Sem nova edição hoje"}</span>
      </div>
      <div class="placar-card placar-card--warn">
        <span class="placar-card__icon">${icon("alerta", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtNum(extras)}</span>
        <span class="placar-card__label">Edições extras</span>
        <span class="placar-card__sub">Publicações fora da rotina comum</span>
      </div>
      <div class="placar-card placar-card--top">
        <span class="placar-card__icon">${icon("trofeu", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtNum(diario.total || edicoes.length)}</span>
        <span class="placar-card__label">Total coletado</span>
        <span class="placar-card__sub">${fmtNum(edicoes.length)} no resumo recente</span>
      </div>
    `;
  }

  function isoDateLocal(d) {
    const dt = new Date(d);
    dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
    return dt.toISOString().slice(0, 10);
  }

  function dataAtoValida(ato) {
    const iso = dataISO(ato && ato.data);
    if (!iso || ato.data_rotulo) return "";
    const d = new Date(iso + "T00:00:00");
    if (Number.isNaN(d.getTime())) return "";
    if (iso > hojeISO()) return "";
    return iso;
  }

  function dataCurta(iso) {
    return iso ? iso.split("-").reverse().join("/") : "data não informada";
  }

  function textoAtoBusca(ato) {
    return norm([
      ato.titulo,
      ato.resumo,
      ato.categoria,
      ato.tipo,
      ato.orgao,
      ...(ato.envolvidos || []).map(e => e.nome || ""),
      ...(ato.pontos_atencao || []),
    ].filter(Boolean).join(" "));
  }

  function ehAtoAsfalto(ato) {
    const txt = textoAtoBusca(ato);
    return /(asfalto|asfaltica|asfaltico|cbuq|tapa buraco|tapa-buraco|recape|pavimentacao|pavimenta|buraco)/.test(txt);
  }

  function rotuloMudanca(ato) {
    const labels = {
      contrato: "Novo contrato",
      aditivo: "Aditivo",
      dispensa: "Dispensa",
      compra_direta: "Compra direta",
      licitacao: "Licitação",
      diaria: "Diária",
      convenio: "Convênio",
      despesa: "Despesa sem contrato localizado",
    };
    return labels[ato.tipo] || "Ato novo";
  }

  function pontuarMudanca(ato) {
    const valor = valorAto(ato);
    let score = 0;
    if (ato.relevancia === "alta") score += 5;
    else if (ato.relevancia === "media") score += 2;
    if (valor >= 1000000) score += 5;
    else if (valor >= 100000) score += 2;
    if ((ato.pontos_atencao || []).length) score += 3;
    if (ehAtoAsfalto(ato)) score += 3;
    if (ato.tipo === "dispensa") score += 2;
    return score;
  }

  function dataColetaCurta(valor) {
    if (!valor) return "data não informada";
    const d = new Date(String(valor).replace(" ", "T"));
    if (Number.isNaN(d.getTime())) return cleanText(valor);
    return d.toLocaleDateString("pt-BR") + " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function labelMudancaColeta(tipo) {
    const labels = {
      novo_contrato: "Novo contrato",
      valor_alterado: "Valor alterado",
      novo_fornecedor_relevante: "Novo fornecedor relevante",
      nova_edicao_diario: "Nova edição do Diário",
      pendencia_nova: "Pendência nova",
      pendencia_resolvida: "Pendência resolvida",
      asfalto_novo: "Asfalto/obra viária",
    };
    return labels[tipo] || "Mudança";
  }

  function classeMudancaColeta(item) {
    if (item.tipo === "pendencia_nova" || item.prioridade === "alta") return "change-digest__badge--red";
    if (item.tipo === "asfalto_novo" || item.tipo === "nova_edicao_diario") return "change-digest__badge--gold";
    return "";
  }

  function renderMudancasComparacao(diff) {
    const r = diff.resumo || {};
    const atual = diff.atual || {};
    const anterior = diff.anterior || null;
    const itens = Array.isArray(diff.itens) ? diff.itens.slice(0, 6) : [];
    const comparacao = anterior
      ? `Comparado com a coleta de ${esc(dataColetaCurta(anterior.coleta_iso || anterior.data_humana))}.`
      : "Histórico de snapshots iniciado agora; a próxima coleta já mostrará comparação completa com este retrato.";

    return `
      <div class="change-digest__head">
        <span>COMPARAÇÃO REAL DE COLETAS</span>
        <h3>O que mudou desde a última atualização</h3>
        <p>
          ${comparacao}
          Coleta atual: ${esc(dataColetaCurta(atual.coleta_iso || atual.data_humana))}.
        </p>
      </div>
      <div class="change-digest__metrics" aria-label="Resumo comparativo das coletas">
        <article>
          <strong>${fmtNum(r.total_mudancas || 0)}</strong>
          <span>mudanças detectadas</span>
        </article>
        <article>
          <strong>${fmtBRL(r.valor_novo_brl || 0)}</strong>
          <span>novos contratos</span>
        </article>
        <article>
          <strong>${fmtNum((r.pendencias_novas || 0) + (r.pendencias_resolvidas || 0))}</strong>
          <span>pendências mudaram</span>
        </article>
        <article>
          <strong>${fmtNum(r.asfalto_novos || 0)}</strong>
          <span>asfalto/obras novas</span>
        </article>
      </div>
      <div class="change-digest__body">
        <section class="change-digest__main">
          <h4>Principais mudanças detectadas</h4>
          <ol class="change-digest__list">
            ${itens.length ? itens.map(item => {
              const target = item.alvo_id ? `#${esc(item.alvo_id)}` : "";
              return `<li class="change-digest__item">
                <div>
                  <span class="change-digest__badge ${classeMudancaColeta(item)}">${esc(labelMudancaColeta(item.tipo))}</span>
                  ${item.prioridade ? `<span class="change-digest__badge">${esc(item.prioridade)}</span>` : ""}
                </div>
                <strong>${esc(cleanText(item.titulo || "Mudança detectada"))}</strong>
                <small>${[item.orgao, item.data ? dataCurta(item.data) : "", item.valor_brl ? fmtBRL(item.valor_brl) : ""].filter(Boolean).map(esc).join(" · ")}</small>
                ${item.detalhe ? `<p>${esc(cleanText(item.detalhe))}</p>` : ""}
                ${target ? `<a href="${target}">Ver no feed</a>` : (item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">Abrir fonte</a>` : "")}
              </li>`;
            }).join("") : `<li class="change-digest__item">
              <strong>Nenhuma mudança estrutural apareceu entre as coletas comparadas.</strong>
              <small>O histórico segue ativo para detectar alterações futuras.</small>
            </li>`}
          </ol>
        </section>
        <aside class="change-digest__side">
          <h4>Resumo da comparação</h4>
          <ul>
            <li><b>Contratos novos:</b> ${fmtNum(r.novos_contratos || 0)}.</li>
            <li><b>Valores alterados:</b> ${fmtNum(r.contratos_valor_alterado || 0)} contrato(s).</li>
            <li><b>Fornecedores novos:</b> ${fmtNum(r.novos_fornecedores_relevantes || 0)} acima do corte de relevância.</li>
            <li><b>Diário Oficial:</b> ${fmtNum(r.novas_edicoes_diario || 0)} nova(s) edição(ões).</li>
            <li><b>Pendências:</b> ${fmtNum(r.pendencias_novas || 0)} nova(s), ${fmtNum(r.pendencias_resolvidas || 0)} resolvida(s).</li>
          </ul>
        </aside>
      </div>`;
  }

  function recorteAtosRecentes(atos) {
    const datas = atos.map(dataAtoValida).filter(Boolean).sort();
    const fim = datas[datas.length - 1] || hojeISO();
    const inicioDate = new Date(fim + "T00:00:00");
    inicioDate.setDate(inicioDate.getDate() - 7);
    const inicio = isoDateLocal(inicioDate);
    const recentes = atos.filter(a => {
      const d = dataAtoValida(a);
      return d && d >= inicio && d <= fim;
    });
    return { inicio, fim, recentes };
  }

  function renderMudancasAtos(atos) {
    const el = $("mudancasRecentes");
    if (!el) return;

    const diff = (window.ZELA_DATA || {}).mudancas_coleta;
    if (diff && diff.resumo && (diff.modo === "comparacao" || diff.modo === "baseline")) {
      el.innerHTML = renderMudancasComparacao(diff);
      return;
    }

    const { inicio, fim, recentes } = recorteAtosRecentes(atos);
    const edicoesPeriodo = carregarDiario().filter(e => e.data >= inicio && e.data <= fim);
    const valorRecente = recentes.reduce((s, ato) => s + valorAto(ato), 0);
    const contratos = recentes.filter(a => ["contrato", "dispensa", "compra_direta", "licitacao", "aditivo"].includes(a.tipo));
    const asfalto = recentes.filter(ehAtoAsfalto);
    const alta = recentes.filter(a => a.relevancia === "alta" || pontuarMudanca(a) >= 7);
    const pendencias = atos
      .filter(a => (a.pontos_atencao || []).length || a._fonte === "top_fornecedores")
      .sort((a, b) => pontuarMudanca(b) - pontuarMudanca(a))
      .slice(0, 3);
    const destaques = recentes
      .slice()
      .sort((a, b) => {
        const score = pontuarMudanca(b) - pontuarMudanca(a);
        if (score) return score;
        return (b.data || "").localeCompare(a.data || "");
      })
      .slice(0, 5);
    const coleta = cleanText((window.ZELA_DATA || {}).atualizado_em?.data_humana || "");

    if (!recentes.length) {
      el.innerHTML = `
        <div class="change-digest__head">
          <span>LEITURA RÁPIDA</span>
          <h3>O que mudou desde a última atualização</h3>
          <p>Não há ato com data recente suficiente para montar um recorte automático. Use os filtros abaixo para conferir o histórico disponível.</p>
        </div>`;
      return;
    }

    el.innerHTML = `
      <div class="change-digest__head">
        <span>LEITURA RÁPIDA</span>
        <h3>O que mudou desde a última atualização</h3>
        <p>
          Recorte automático de ${esc(dataCurta(inicio))} a ${esc(dataCurta(fim))}
          ${coleta ? `, com coleta em ${esc(coleta)}` : ""}. Quando não há snapshot anterior, o painel usa a data oficial do ato para indicar o que entrou no período.
        </p>
      </div>
      <div class="change-digest__metrics" aria-label="Resumo numérico das mudanças">
        <article>
          <strong>${fmtNum(recentes.length)}</strong>
          <span>atos no recorte</span>
        </article>
        <article>
          <strong>${fmtBRL(valorRecente)}</strong>
          <span>valor localizado</span>
        </article>
        <article>
          <strong>${fmtNum(alta.length)}</strong>
          <span>prioridades</span>
        </article>
        <article>
          <strong>${fmtNum(edicoesPeriodo.length)}</strong>
          <span>edições do Diário</span>
        </article>
      </div>
      <div class="change-digest__body">
        <section class="change-digest__main">
          <h4>Prioridade cidadã</h4>
          <ol class="change-digest__list">
            ${destaques.map(ato => {
              const id = esc(ato.id || `${ato.data}-${ato.titulo}`);
              const valor = valorAto(ato);
              return `<li class="change-digest__item">
                <div>
                  <span class="change-digest__badge">${esc(rotuloMudanca(ato))}</span>
                  ${ehAtoAsfalto(ato) ? `<span class="change-digest__badge change-digest__badge--gold">Asfalto/obra viária</span>` : ""}
                  ${(ato.pontos_atencao || []).length ? `<span class="change-digest__badge change-digest__badge--red">Pendência</span>` : ""}
                </div>
                <strong>${esc(cleanText(ato.titulo || "Ato administrativo"))}</strong>
                <small>${esc(dataCurta(dataAtoValida(ato)))} · ${esc(ato.orgao || "")}${valor ? ` · ${fmtBRL(valor)}` : ""}</small>
                <a href="#${id}">Ver no feed</a>
              </li>`;
            }).join("")}
          </ol>
        </section>
        <aside class="change-digest__side">
          <h4>O que merece atenção</h4>
          <ul>
            <li><b>Contratos/compras:</b> ${fmtNum(contratos.length)} ato(s) no período.</li>
            <li><b>Asfalto e buracos:</b> ${fmtNum(asfalto.length)} item(ns) para conferir local, medição e fiscal.</li>
            <li><b>Diário Oficial:</b> ${fmtNum(edicoesPeriodo.length)} edição(ões) para ler na fonte oficial.</li>
            <li><b>Pendências antigas:</b> ${fmtNum(pendencias.length)} item(ns) continuam na fila de cobrança.</li>
          </ul>
        </aside>
      </div>`;
  }

  function renderMudancasDiario(edicoes) {
    const el = $("mudancasRecentes");
    if (!el) return;

    if (!edicoes.length) {
      el.innerHTML = `
        <div class="change-digest__head">
          <span>LEITURA RÁPIDA</span>
          <h3>O que mudou no Diário Oficial</h3>
          <p>Nenhuma edição do Diário Oficial foi encontrada no pacote de dados atual.</p>
        </div>`;
      return;
    }

    const ordenadas = edicoes.slice().sort((a, b) => (b.sortKey || "").localeCompare(a.sortKey || ""));
    const ultimas = ordenadas.slice(0, 4);
    const atos = carregarAtos();
    const dataUltima = ultimas[0]?.data || "";
    const atosUltima = atos.filter(a => dataISO(a.data) === dataUltima);
    const compras = atosUltima.filter(ehCompraOuContratacao);
    const cargos = atosUltima.filter(ehCargoComissionado);
    const leis = atosUltima.filter(ehLeiOuAlteracao);
    const extras = edicoes.filter(e => e.extra).length;

    el.innerHTML = `
      <div class="change-digest__head">
        <span>LEITURA RÁPIDA</span>
        <h3>O que mudou no Diário Oficial</h3>
        <p>Últimas edições coletadas da fonte oficial. Cada linha abre direto o PDF ou leitor oficial, sem o cidadão precisar procurar no portal.</p>
      </div>
      <div class="change-digest__metrics" aria-label="Resumo do Diário Oficial">
        <article>
          <strong>${esc(ultimas[0]?.edicao || "-")}</strong>
          <span>última edição</span>
        </article>
        <article>
          <strong>${fmtNum(edicoes.length)}</strong>
          <span>edições no painel</span>
        </article>
        <article>
          <strong>${fmtNum(extras)}</strong>
          <span>edições extras</span>
        </article>
        <article>
          <strong>${fmtNum(atosUltima.length)}</strong>
          <span>atos relacionados</span>
        </article>
      </div>
      <div class="change-digest__body">
        <section class="change-digest__main">
          <h4>Últimas edições para ler</h4>
          <ol class="change-digest__list">
            ${ultimas.map(edicao => {
              const resumo = resumoDiarioCidadao(edicao, atos).slice(0, 2).join(" ");
              return `<li class="change-digest__item">
                <div>
                  <span class="change-digest__badge">${edicao.extra ? "Edição extra" : "Edição ordinária"}</span>
                  <span class="change-digest__badge change-digest__badge--gold">${esc(edicao.ano || "")}</span>
                </div>
                <strong>${esc(edicao.titulo)}</strong>
                <small>${esc(formatarDataHora(edicao.sortKey || edicao.data))}</small>
                <p>${esc(cleanText(resumo))}</p>
                <a href="${esc(edicao.url)}" target="_blank" rel="noopener">Abrir PDF da edição</a>
              </li>`;
            }).join("")}
          </ol>
        </section>
        <aside class="change-digest__side">
          <h4>Na edição mais recente</h4>
          <ul>
            <li><b>Compras/contratações:</b> ${fmtNum(compras.length)} item(ns) relacionado(s).</li>
            <li><b>Cargos, servidores ou folha:</b> ${fmtNum(cargos.length)} item(ns) para conferir.</li>
            <li><b>Leis, decretos ou alterações:</b> ${fmtNum(leis.length)} item(ns) para ler no PDF.</li>
            <li><b>Fonte:</b> sempre abrir o PDF oficial antes de divulgar ou cobrar.</li>
          </ul>
        </aside>
      </div>`;
  }

  function renderDiarioCard(edicao, atosCache) {
    const dataDisplay = formatarDataHora(edicao.sortKey || edicao.data);
    const tipo = edicao.extra ? "Edição Extra" : "Edição Ordinária";

    // Buscar atos do dia correspondente à edição
    const atos = atosCache || carregarAtos();
    const atosDia = atos.filter(a => dataISO(a.data) === edicao.data);
    
    // Somar valores de compras/contratações do dia
    const compras = atosDia.filter(ehCompraOuContratacao);
    const cargosDia = atosDia.filter(ehCargoComissionado);
    const leisDia = atosDia.filter(ehLeiOuAlteracao);
    const totalCompras = compras.reduce((s, a) => s + valorAto(a), 0);
    const totalDisplay = totalCompras > 0 ? fmtBRL(totalCompras) : "R$ 0,00";
    
    // Obter lista de empresas envolvidas
    const envolvidos = [];
    atosDia.forEach(ato => {
      (ato.envolvidos || []).forEach(e => {
        if (e.nome && !envolvidos.includes(e.nome)) {
          envolvidos.push(e.nome);
        }
      });
    });
    const envolvidosHtml = envolvidos.length
      ? envolvidos.map(env => `<li>• ${esc(cleanText(env))}</li>`).join("")
      : "<li>• <em>Nenhum fornecedor/empresa mapeado diretamente nesta data</em></li>";

    // Determinar relevância
    let relevanciaClass = "baixa";
    let relevanciaText = "baixa";
    if (atosDia.some(a => a.relevancia === "alta") || totalCompras >= 200000) {
      relevanciaClass = "alta";
      relevanciaText = "alta";
    } else if (atosDia.some(a => a.relevancia === "media") || totalCompras > 0 || edicao.extra) {
      relevanciaClass = "media";
      relevanciaText = "média";
    }

    // Determinar tema principal
    let temaText = "diário oficial";
    if (atosDia.some(a => a.tipo === "contrato")) temaText = "contrato";
    else if (atosDia.some(a => a.tipo === "dispensa")) temaText = "dispensa";
    else if (atosDia.some(a => a.tipo === "licitacao")) temaText = "licitação";
    else if (atosDia.some(ehCargoComissionado)) temaText = "pessoal";
    else if (atosDia.some(ehLeiOuAlteracao)) temaText = "legislação";

    // Resumo descritivo da edição
    let resumoDesc = "";
    if (edicao.descricao) {
      resumoDesc = edicao.descricao;
    } else {
      resumoDesc = `Foi publicada a edição ${edicao.edicao} (${edicao.extra ? "extra" : "ordinária"}) do Diário Oficial do Município de Varginha. `;
      if (atosDia.length > 0) {
        const comprasCount = compras.length;
        const pessoalCount = atosDia.filter(ehCargoComissionado).length;
        resumoDesc += `No painel, localizamos ${atosDia.length} ato(s) nesta data, sendo ${comprasCount} de compras/contratações e ${pessoalCount} relacionado(s) a servidores/cargos.`;
      } else {
        resumoDesc += `O sistema não identificou contratos ou contratações diretas vinculadas a esta data específica no Portal da Transparência de Varginha.`;
      }
    }

    // Pontos de atenção
    const pontosAtencao = [];
    atosDia.forEach(ato => {
      (ato.pontos_atencao || []).forEach(p => {
        if (!pontosAtencao.includes(p)) {
          pontosAtencao.push(p);
        }
      });
    });
    if (edicao.extra) {
      pontosAtencao.push("Edição extra publicada fora do calendário rotineiro. Recomenda-se analisar a urgência das publicações.");
    }
    if (pontosAtencao.length === 0) {
      pontosAtencao.push("Nenhum alerta crítico pré-identificado no cruzamento automático de dados para esta edição.");
    }
    const pontosAtencaoHtml = pontosAtencao.map(p => `<li>• ${esc(cleanText(p))}</li>`).join("");

    // Construção da mensagem para compartilhamento no WhatsApp
    const resumoZapTxt = `*DIÁRIO OFICIAL | VARGINHA*\n` +
      `*Edição ${edicao.edicao} (${edicao.extra ? 'Extra' : 'Ordinária'})*\n` +
      `*Data:* ${dataDisplay}\n` +
      `*Categoria:* Diário Oficial\n` +
      `*Relevância:* ${relevanciaText.toUpperCase()}\n` +
      `*Tema:* ${temaText}\n\n` +
      `*Resumo:*\n${resumoDesc}\n\n` +
      `*Valores identificados:*\n- Total: ${totalDisplay}\n\n` +
      `*Pontos de atenção:*\n${pontosAtencao.map(p => `- ${p}`).join("\n")}\n\n` +
      `*Link PDF oficial:* ${edicao.url}`;
    const resumoWhats = encodeURIComponent(resumoZapTxt);

    return `<article class="diario-whats-card diario-oficial-card" id="${esc(edicao.id)}">
      <div class="diario-whats-card__header">
        <div class="diario-whats-card__title-block">
          <h4 class="diario-whats-card__title" style="display:flex; align-items:center; gap:8px;">
            ${icon("documentos", { size: 18 })} DIÁRIO OFICIAL · VARGINHA
          </h4>
          <div class="diario-whats-card__subtitle">${esc(edicao.titulo)}</div>
        </div>
        <span class="diario-relevancia-badge diario-relevancia-badge--${relevanciaClass}">
          ${relevanciaText}
        </span>
      </div>

      <div class="diario-whats-card__meta-grid">
        <div class="diario-whats-card__meta-item">${icon("documentos", { size: 14 })} Categoria: <strong>Diário Oficial</strong></div>
        <div class="diario-whats-card__meta-item">${icon("calendario", { size: 14 })} Data: <strong>${esc(dataDisplay)}</strong></div>
        <div class="diario-whats-card__meta-item">${icon("predio", { size: 14 })} Órgão: <strong>Prefeitura de Varginha</strong></div>
        <div class="diario-whats-card__meta-item">${icon("alerta", { size: 14 })} Relevância: <strong>${relevanciaText}</strong></div>
        <div class="diario-whats-card__meta-item">${icon("lupa", { size: 14 })} Tema: <strong>${temaText}</strong></div>
      </div>

      <div class="diario-whats-card__section">
        <div class="diario-whats-card__section-title">${icon("documentos", { size: 14 })} Resumo cidadão desta edição</div>
        <div class="diario-whats-card__resumo">
          ${esc(resumoDesc)}
        </div>
      </div>

      <div class="diario-whats-card__section">
        <div class="diario-whats-card__section-title">${icon("pessoas", { size: 14 })} Envolvidos</div>
        <ul class="diario-whats-card__list">
          ${envolvidosHtml}
        </ul>
      </div>

      <div class="diario-whats-card__section">
        <div class="diario-whats-card__section-title">${icon("cifrao", { size: 14 })} O que tem nesta edição (cruzamento com o painel)</div>
        <ul class="diario-whats-card__list">
          <li>• Compras/contratações: <strong>${fmtNum(compras.length)}</strong> ato(s) · ${totalDisplay}</li>
          <li>• Cargos e servidores: <strong>${fmtNum(cargosDia.length)}</strong> ato(s)</li>
          <li>• Leis, decretos e alterações: <strong>${fmtNum(leisDia.length)}</strong> ato(s)</li>
          <li>• O conteúdo interno do PDF ainda não é dado aberto estruturado — confira na fonte oficial.</li>
        </ul>
      </div>

      <div class="diario-whats-card__section">
        <div class="diario-whats-card__section-title">${icon("alerta", { size: 14 })} Pontos de atenção</div>
        <ul class="diario-whats-card__list">
          ${pontosAtencaoHtml}
        </ul>
      </div>

      <div class="diario-whats-card__section">
        <div class="diario-whats-card__section-title">${icon("anexo", { size: 14 })} Publicação</div>
        <a href="${esc(edicao.url)}" target="_blank" rel="noopener" style="font-size: 0.9rem; word-break: break-all;">${esc(edicao.url)}</a>
      </div>

      <div class="diario-whats-card__section">
        <div class="diario-whats-card__section-title">${icon("predio", { size: 14 })} Portal de Origem</div>
        <a href="${esc(edicao.urlPortal || DIARIO_PORTAL_URL)}" target="_blank" rel="noopener" style="font-size: 0.9rem; word-break: break-all;">${esc(edicao.urlPortal || DIARIO_PORTAL_URL)}</a>
      </div>

      <div class="diario-whats-card__actions">
        <div class="diario-whats-card__buttons">
          <a class="diario-whats-card__btn-zap" href="https://api.whatsapp.com/send?text=${resumoWhats}" target="_blank" rel="noopener">
            ${icon("compartilhar", { size: 14 })} Compartilhar resumo
          </a>
          <a class="diario-whats-card__btn-link" href="${esc(edicao.url)}" target="_blank" rel="noopener">
            ${icon("documentos", { size: 14 })} Abrir PDF da edição
          </a>
        </div>
      </div>
    </article>`;
  }

  function renderDiario() {
    const edicoes = carregarDiario();
    const q = norm(filtros.busca);
    const view = edicoes.filter(e => {
      if (filtros.ano && !(e.data || "").startsWith(filtros.ano)) return false;
      if (filtros.mes && (e.data || "").slice(5, 7) !== filtros.mes) return false;
      if (q) {
        const hay = norm([e.titulo, e.resumo, e.edicao, e.ano, e.extra ? "extra" : "ordinaria"].filter(Boolean).join(" "));
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    renderStatsDiario(edicoes);
    renderMudancasDiario(edicoes);

    const contador = $("atualizacoesContador");
    if (contador) contador.textContent = `${fmtNum(view.length)} edição${view.length !== 1 ? "ões" : ""}`;

    const feedEl = $("atualizacoesFeed");
    if (feedEl) {
      feedEl.classList.add("diario-list-whats");
    }
    const emptyEl = $("atualizacoesEmpty");
    if (!view.length) {
      if (feedEl) feedEl.innerHTML = "";
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.querySelector("strong").textContent = "Nenhuma edição encontrada";
        emptyEl.querySelector("p").textContent = "Tente remover algum filtro ou limpar a busca.";
      }
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    const sorted = [...view].sort((a, b) => (b.sortKey || "").localeCompare(a.sortKey || "")).slice(0, 120);
    const atosCache = carregarAtos();
    if (feedEl) feedEl.innerHTML = sorted.map(e => renderDiarioCard(e, atosCache)).join("");
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
    // Atos agregados (ex.: "sem contrato formal") trazem data_rotulo —
    // exibição amigável que não confunde o cidadão com uma data de evento.
    const dataDisplay = ato.data_rotulo || dataBr;

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
      `${ato.titulo}\n${dataDisplay} — ${ato.orgao}\n${ato.resumo}\n\nVer mais: ${window.location.href}#${idAto}`
    );
    const linkWa = `https://api.whatsapp.com/send?text=${msgWa}`;

    return `<article class="tline-item tline-item--${t.cor}" id="${esc(idAto)}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div class="tline-data">${esc(dataDisplay)} · ${ato.orgao}</div>
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

      <textarea class="dossier-lai-pergunta" data-id="${esc(idAto)}" readonly hidden aria-label="Pergunta pronta para pedido via Lei de Acesso à Informação (LAI)">${esc(perguntaLAI(ato))}</textarea>
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
  function atualizarTabs() {
    document.querySelectorAll("#atualizacoesTabs .update-tab").forEach(btn => {
      const ativo = btn.dataset.tab === abaAtual;
      btn.classList.toggle("is-active", ativo);
      btn.setAttribute("aria-selected", ativo ? "true" : "false");
    });
  }

  function atualizarContagemFiltros() {
    const badge = $("filtroContagem");
    const btn = $("btnFiltroToggle");
    if (!badge) return;
    const ativos = [filtros.orgao, filtros.tipo, filtros.relevancia, filtros.ano].filter(Boolean).length;
    if (ativos > 0) {
      badge.textContent = ativos;
      badge.hidden = false;
      // se há filtro ativo, garante painel aberto
      const panel = $("filtrosPanel");
      if (panel && panel.hidden) {
        panel.hidden = false;
        if (btn) btn.setAttribute("aria-expanded", "true");
      }
    } else {
      badge.hidden = true;
    }
  }

  function render() {
    atualizarTabs();

    const isDiario = abaAtual === "diario";

    // Barra de busca + botão filtrar: visível só na aba atos
    const filtrosBarraEl = $("filtrosBarra");
    if (filtrosBarraEl) filtrosBarraEl.hidden = isDiario;

    // Ao trocar para diário: colapsa painel de filtros
    if (isDiario) {
      const panel = $("filtrosPanel");
      if (panel) panel.hidden = true;
      const btn = $("btnFiltroToggle");
      if (btn) btn.setAttribute("aria-expanded", "false");
    }

    atualizarContagemFiltros();

    const emptyState = $("atualizacoesEmpty");
    if (emptyState) {
      emptyState.querySelector("strong").textContent = "Nenhuma atualização encontrada";
      emptyState.querySelector("p").textContent = "Tente remover algum filtro ou limpar a busca.";
    }

    if (abaAtual === "diario") {
      renderDiario();
      return;
    }

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
    renderMudancasAtos(todos);

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

    if (feedEl) {
      feedEl.classList.remove("diario-list-whats");
      feedEl.innerHTML = sorted.map(renderCard).join("");
    }

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
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab") || params.get("aba") || "";
    if (["atos", "diario"].includes(tabParam)) abaAtual = tabParam;

    const tabsEl = $("atualizacoesTabs");
    if (tabsEl) {
      tabsEl.addEventListener("click", e => {
        const tab = e.target.closest(".update-tab");
        if (!tab) return;
        abaAtual = tab.dataset.tab || "atos";
        filtros.orgao = "";
        filtros.tipo = "";
        filtros.relevancia = "";
        render();
      });
    }

    // Toggle painel de filtros
    const btnToggle = $("btnFiltroToggle");
    if (btnToggle) {
      btnToggle.addEventListener("click", () => {
        const panel = $("filtrosPanel");
        const aberto = btnToggle.getAttribute("aria-expanded") === "true";
        btnToggle.setAttribute("aria-expanded", String(!aberto));
        if (panel) panel.hidden = aberto;
      });
      // Desktop (≥760px): abre por padrão
      if (window.innerWidth >= 760) {
        btnToggle.setAttribute("aria-expanded", "true");
        const panel = $("filtrosPanel");
        if (panel) panel.hidden = false;
      }
    }

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
