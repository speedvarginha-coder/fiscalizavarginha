#!/usr/bin/env node
// @ts-check
/**
 * Scraper do Portal da Transparência Betha — Prefeitura de Varginha.
 *
 * SELECTORS COMPROVADOS (validados em 15/05/2026):
 *   • Consulta "Execução Detalhada de Despesas" da Prefeitura: ID 82995
 *     URL: https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/82995
 *   • Botão "Filtros":                   button.filtro-button
 *   • Sidebar de filtros:                .bth-filter__body
 *   • Botão "Filtrar (ENTER)":           button.btn-primary (texto contém "Filtrar")
 *   • Cards de soma agregada (KPIs):     .bth-powernumber
 *       label:                            .bth-powernumber__desc
 *       valor:                            .bth-powernumber__value
 *
 * VALORES DE REFERÊNCIA CAPTURADOS EM 15/05/2026:
 *   • Prefeitura — Total pago em 2026:   R$ 256.435.852,49 (4.696 empenhos)
 *   • Prefeitura — Total empenhado 2026: R$ 472.289.974,89
 *
 * COMO RODAR:
 *   node dashboard/scripts/scrape-betha.mjs                # total geral 2026
 *   node dashboard/scripts/scrape-betha.mjs --funcao Saude # filtra por função
 *   node dashboard/scripts/scrape-betha.mjs --dry          # não grava
 */

import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_OUT = resolve(__dirname, "../src/data/categoriasGasto.real.json");

const PREFEITURA_HASH = "y7mn01LGqd_HCvGtj6VPwA==";
const CAMARA_HASH = "-iAWLe1kr2VQcrW9k2AUBg==";
const CONSULTA_DESPESAS_ID = 82995;
const CONSULTA_CAMARA_ID = 324767;
const ANO_ATUAL = new Date().getFullYear();
const API_BASE = "https://api.transparencia.betha.cloud/transparencia/api";

// app-context = base64(JSON.stringify({portal: HASH})) — obrigatório em toda requisição
const APP_CONTEXT_PREFEITURA = Buffer.from(JSON.stringify({ portal: PREFEITURA_HASH })).toString("base64");
const APP_CONTEXT_CAMARA = Buffer.from(JSON.stringify({ portal: CAMARA_HASH })).toString("base64");

/**
 * Mapeamento: categoria do site → nome do filtro a aplicar.
 * "funcao" = filtra pela "Descrição da função" (categoria macro)
 * "elemento" = filtra pelo "Elemento" (item específico do orçamento)
 *
 * Quando ambos estão vazios, captura o TOTAL GERAL do ano.
 */
// IDs confirmados via API /filtro/{campo}/mais em 15/05/2026
const MAPEAMENTO_PREFEITURA = {
  "total-geral": { funcao: null, elementos: [] },
  saude:         { funcao: "Saúde",    elementos: [] },
  educacao:      { funcao: "Educação", elementos: [] },
  urbanismo:     { funcao: "Urbanismo",elementos: [] },
  combustivel:   { funcao: null, elementos: ["Combustíveis Automotivos","COMBUSTIVEIS AUTOMOTIVOS","COMBUSTIVEIS E LUBRIFICANTES P/OUTRAS FINALIDADES"] },
  medicamentos:  { funcao: null, elementos: ["Medicamentos","MEDICAMENTOS"] },
  lanches:       { funcao: null, elementos: ["Gêneros de Alimentação","GENEROS DE ALIMENTACAO","Fornecimento de Alimentação","FORNECIMENTO DE ALIMENTACAO"] },
  asfalto:       { funcao: null, elementos: ["Obras e Instalações de Domínio Público","OBRAS E INSTALACOES DE DOMINIO PUBLICO","Obras e Instalações","OBRAS E INSTALACOES"] },
};

// Câmara — consulta ID 324767 (Execução Detalhada de Despesas)
// Câmara tem estrutura menor: Legislativa é a única função; filtra por elemento.
const MAPEAMENTO_CAMARA = {
  "total-geral": { funcao: null, elementos: [] },
  combustivel:   { funcao: null, elementos: ["Combustíveis Automotivos","COMBUSTIVEIS AUTOMOTIVOS","COMBUSTIVEIS E LUBRIFICANTES P/OUTRAS FINALIDADES"] },
  lanches:       { funcao: null, elementos: ["Gêneros de Alimentação","GENEROS DE ALIMENTACAO","Fornecimento de Alimentação","FORNECIMENTO DE ALIMENTACAO"] },
  veiculos:      { funcao: null, elementos: ["Locação de Veículos","LOCACAO DE VEICULOS","Locação de Outros Meios de Transporte","LOCACAO DE OUTROS MEIOS DE TRANSPORTE"] },
  publicidade:   { funcao: null, elementos: ["Serviços de Publicidade","SERVICOS DE PUBLICIDADE","Publicidade e Propaganda","PUBLICIDADE E PROPAGANDA"] },
  software:      { funcao: null, elementos: ["Locação de Softwares","LOCACAO DE SOFTWARES","Serviços de Tecnologia da Informação","SERVICOS DE TECNOLOGIA DA INFORMACAO"] },
};

// Consulta dedicada de Diárias da Câmara (ID 324755)
// Usa campo "ano" (não "anoExercicio") e campo "valorTotal" (sem totalizadores configurados).
const CONSULTA_DIARIAS_CAMARA_ID = 324755;

// Listas da Câmara (registros individuais via busca-textual com body {})
const CONSULTA_LICITACOES_CAMARA_ID = 324786;
const CONSULTA_CONTRATOS_CAMARA_ID = 324812;
// Limite de registros persistidos por lista (evita inchar o bundle). Ordenados por valor desc.
const LIMITE_REGISTROS_LISTA = 200;

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry");
const idxF = args.indexOf("--funcao");
const filtroFuncao = idxF >= 0 ? args[idxF + 1] : null;
const idxE = args.indexOf("--elemento");
const filtroElemento = idxE >= 0 ? args[idxE + 1] : null; // aceita valor único CLI

function parseBRL(s) {
  const m = (s || "").replace(/[^\d,]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(m);
  return Number.isFinite(n) ? n : NaN;
}

function log(...x) { console.log("[scrape-betha]", ...x); }
function warn(...x) { console.warn("[scrape-betha] ⚠️", ...x); }

async function carregarJsonExistente() {
  try {
    return JSON.parse(await readFile(JSON_OUT, "utf-8"));
  } catch {
    return {
      atualizadoEm: null,
      fontePadrao: "Portal da Transparência — Betha Sistemas",
      dados: { prefeitura: {}, camara: {} },
    };
  }
}

async function salvarJson(obj) {
  await mkdir(dirname(JSON_OUT), { recursive: true });
  await writeFile(JSON_OUT, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

/**
 * Abre o painel de Filtros e aguarda os grupos de filtro carregarem.
 * O .bth-filter__body existe no DOM desde o início (vazio), por isso
 * verificamos se há checkboxes DENTRO dele, não só se o elemento existe.
 */
async function abrirFiltros(page) {
  const hasContent = await page.evaluate(() => {
    const body = document.querySelector('.bth-filter__body');
    return !!(body && body.querySelector('input[type="checkbox"]'));
  });
  if (hasContent) return;
  // Clica no botão de filtros
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button.filtro-button'))
      .find(b => b.offsetParent !== null);
    btn?.click();
  });
  // Aguarda pelo menos 1 checkbox dentro da sidebar (conteúdo real)
  await page.waitForSelector('.bth-filter__body input[type="checkbox"]', { timeout: 15000 });
  await page.waitForTimeout(500);
}

/**
 * Marca um checkbox dentro do grupo identificado por headerText.
 * Usa contains() para tolerar labels com sufixo de contagem "(42)".
 */
async function marcarCheckbox(page, headerText, optionText) {
  return await page.evaluate(({ headerText, optionText }) => {
    const body = document.querySelector('.bth-filter__body');
    if (!body) return { ok: false, reason: 'sidebar fechada' };

    // Encontrar o wrapper do grupo pelo texto do cabeçalho
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
    let n;
    let wrapper = null;
    while ((n = walker.nextNode())) {
      if (n.textContent?.trim() === headerText) {
        let p = n.parentElement;
        for (let i = 0; i < 10; i++) {
          p = p?.parentElement;
          if (!p) break;
          if (p.querySelectorAll('input[type="text"]').length === 1) { wrapper = p; break; }
        }
        if (wrapper) break;
      }
    }
    if (!wrapper) return { ok: false, reason: `header "${headerText}" não encontrado` };

    // Encontrar o checkbox cujo label CONTÉM o texto (tolera sufixos de contagem)
    const cb = Array.from(wrapper.querySelectorAll('input[type="checkbox"]'))
      .find(inp => {
        const label = inp.closest('label, li, div')?.textContent?.trim() ?? '';
        return label === optionText || label.startsWith(optionText + ' ') || label.startsWith(optionText + '\n');
      });
    if (!cb) {
      const available = Array.from(wrapper.querySelectorAll('input[type="checkbox"]'))
        .map(i => i.closest('label,li,div')?.textContent?.trim()).slice(0, 10);
      return { ok: false, reason: `opção "${optionText}" não visível`, available };
    }

    // Só clica se ainda não estiver marcado
    if (!cb.checked) cb.click();
    return { ok: true, checked: cb.checked };
  }, { headerText, optionText });
}

/**
 * Aplica os filtros marcados (botão "Filtrar (ENTER)" em .bth-filter__footer).
 */
async function aplicarFiltros(page) {
  await page.evaluate(() => {
    // O botão está no footer do painel, fora do .bth-filter__body
    const btn = Array.from(document.querySelectorAll('.bth-filter__footer button, button.btn-primary'))
      .find(b => b.textContent?.trim().startsWith('Filtrar'));
    btn?.click();
  });
  await page.waitForTimeout(5000);
}

/**
 * Lê os KPIs agregados (.bth-powernumber) e retorna o "Valor pago R$ (Soma)".
 */
async function lerTotais(page) {
  return await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.bth-powernumber')).map(c => ({
      label: c.querySelector('.bth-powernumber__desc')?.textContent?.trim(),
      value: c.querySelector('.bth-powernumber__value')?.textContent?.trim(),
    }));
    return cards;
  });
}

/**
 * Usa Playwright keyboard interaction para buscar no campo de um grupo de filtros.
 * Mais confiável que manipulação JS pura para Vue components.
 */
async function buscarEMarcarCheckbox(page, headerText, optionText) {
  // Encontrar o índice do input de busca dentro da sidebar para este grupo
  const inputIndex = await page.evaluate((headerText) => {
    const body = document.querySelector('.bth-filter__body');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
    let n, wrapper = null;
    while ((n = walker.nextNode())) {
      if (n.textContent?.trim() === headerText) {
        let p = n.parentElement;
        for (let i = 0; i < 10; i++) {
          p = p?.parentElement;
          if (!p) break;
          if (p.querySelectorAll('input[type="text"]').length === 1) { wrapper = p; break; }
        }
        if (wrapper) break;
      }
    }
    if (!wrapper) return -1;
    const allInputs = Array.from(body.querySelectorAll('input[type="text"]'));
    const inp = wrapper.querySelector('input[type="text"]');
    return allInputs.indexOf(inp);
  }, headerText);

  if (inputIndex < 0) return { ok: false, reason: `Grupo "${headerText}" não encontrado para busca` };

  // Dispara focus + input events diretamente no input (Vue reactivity)
  await page.evaluate(({ idx, optionText }) => {
    const inputs = Array.from(document.querySelectorAll('.bth-filter__body input[type="text"]'));
    const inp = inputs[idx];
    if (!inp) return;
    inp.scrollIntoView({ block: 'center' });
    inp.focus();
    // Vue 2 usa 'input' event via v-model
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    nativeSet.call(inp, optionText);
    ['input', 'keyup', 'change'].forEach(evt =>
      inp.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }))
    );
  }, { idx: inputIndex, optionText });
  await page.waitForTimeout(2500);

  return await marcarCheckbox(page, headerText, optionText);
}

async function scrapeCategoria(page, baseUrl, mapping) {
  // Navega via about:blank para garantir reset total da SPA entre categorias
  await page.goto('about:blank');
  log(`abrindo ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.bth-powernumber', { timeout: 30000 });
  await page.waitForTimeout(1500);

  await abrirFiltros(page);
  log(`  sidebar aberta com checkboxes`);

  // Ano atual sempre
  const anoRes = await marcarCheckbox(page, 'Ano de exercício', String(ANO_ATUAL));
  log(`  ano ${ANO_ATUAL}: ${JSON.stringify(anoRes)}`);
  if (!anoRes.ok) warn(`Ano: ${anoRes.reason}`);

  if (mapping.funcao) {
    let r = await marcarCheckbox(page, 'Descrição da função', mapping.funcao);
    if (!r.ok) {
      log(`  funcao top-5 falhou, buscando "${mapping.funcao}" no campo de busca...`);
      r = await buscarEMarcarCheckbox(page, 'Descrição da função', mapping.funcao);
    }
    log(`  funcao "${mapping.funcao}": ${JSON.stringify(r)}`);
    if (!r.ok) {
      warn(`Função "${mapping.funcao}" não encontrada: ${r.reason}`);
      return null;
    }
  }
  if (mapping.elemento) {
    let r = await marcarCheckbox(page, 'Elemento', mapping.elemento);
    if (!r.ok) {
      log(`  elemento top-5 falhou, buscando "${mapping.elemento}" no campo de busca...`);
      r = await buscarEMarcarCheckbox(page, 'Elemento', mapping.elemento);
    }
    log(`  elemento "${mapping.elemento}": ${JSON.stringify(r)}`);
    if (!r.ok) {
      warn(`Elemento "${mapping.elemento}" não encontrado: ${r.reason}`);
      return null;
    }
  }

  await aplicarFiltros(page);
  // Aguarda o totalizador atualizar (KPI mostra "..." durante carregamento)
  await page.waitForFunction(
    () => !document.querySelector('.bth-powernumber__value')?.textContent?.includes('...'),
    { timeout: 10000 }
  ).catch(() => {});
  await page.waitForTimeout(1000);
  const cards = await lerTotais(page);
  const pago = cards.find(c => c.label === 'Valor pago R$ (Soma)');
  const reg = cards.find(c => c.label === 'Registros encontrados');
  if (!pago) {
    warn('Card "Valor pago" não encontrado.');
    return null;
  }
  const valor = parseBRL(pago.value);
  if (!Number.isFinite(valor)) {
    warn(`Valor não parseável: "${pago.value}"`);
    return null;
  }
  return {
    valorTotalAno: valor,
    valorFormatado: pago.value,
    ano: ANO_ATUAL,
    periodo: `Jan–${new Date().toLocaleString('pt-BR', { month: 'short' })} ${ANO_ATUAL} (parcial)`,
    qtdEmpenhos: parseInt(reg?.value ?? '0', 10) || 0,
    fonteUrl: page.url(),
    atualizadoEm: new Date().toISOString().slice(0, 10),
  };
}

/**
 * Obtém o Bearer token carregando o portal da transparência uma única vez.
 */
async function obterToken(consultaId) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let token = null;
  page.on('request', req => {
    const url = req.url();
    if (url.includes('api.transparencia.betha.cloud') && !token) {
      const h = req.headers();
      if (h['authorization']) token = h['authorization'];
    }
  });
  const url = `https://transparencia.betha.cloud/#/${PREFEITURA_HASH}/consulta/${consultaId}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.bth-powernumber', { timeout: 30000 });
  await page.waitForTimeout(2000);
  await browser.close();
  return token;
}

/**
 * Chama a API de totalizadores diretamente (muito mais rápido e confiável que UI).
 * filtros: { anoExercicio?: string[], descricaoFuncao?: string[], descricaoElemento?: string[] }
 */
async function chamarTotalizadores(consultaId, filtros, token, appContext) {
  const resp = await fetch(`${API_BASE}/busca-textual/${consultaId}/totalizadores`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Authorization': token,
      'app-context': appContext,
    },
    body: JSON.stringify(filtros),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  return await resp.json();
}

function parseTotalizadores(data, consultaId, portalHash) {
  if (!Array.isArray(data)) return null;
  // Campo confirmado pela API: "valorPagoEmpenho"
  const pago = data.find(t =>
    t.campo === 'valorPagoEmpenho' ||
    t.campo === 'valorPago' ||
    (t.titulo || '').toLowerCase().includes('pago')
  );
  if (!pago) {
    warn(`Campos disponíveis: ${data.map(t => t.campo).join(', ')}`);
    return null;
  }
  const valorRaw = typeof pago.valor === 'number' ? pago.valor : parseBRL(String(pago.valor));
  const valor = Math.round(valorRaw * 100) / 100;
  if (!Number.isFinite(valor)) return null;
  return {
    valorTotalAno: valor,
    valorFormatado: valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    ano: ANO_ATUAL,
    periodo: `Jan–${new Date().toLocaleString('pt-BR', { month: 'short' })} ${ANO_ATUAL} (parcial)`,
    qtdEmpenhos: 0, // preenchido depois pela chamada de contagem
    fonteUrl: `https://transparencia.betha.cloud/#/${portalHash}/consulta/${consultaId}`,
    atualizadoEm: new Date().toISOString().slice(0, 10),
  };
}

async function chamarContagem(consultaId, filtros, token, appContext) {
  const resp = await fetch(
    `${API_BASE}/busca-textual/${consultaId}?sortBy=null&sortDirection=null&offset=0&limit=1&hiperlink=false`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Authorization': token,
        'app-context': appContext,
      },
      body: JSON.stringify(filtros),
    }
  );
  if (!resp.ok) return 0;
  const json = await resp.json();
  // A API retorna { totalHits: N, hits: [...] }
  return json.totalHits ?? json.total ?? json.count ?? json.totalElements ?? 0;
}

/**
 * Consulta 324755 — Diárias Câmara — não tem totalizadores configurados.
 * Busca até 2000 registros do ano e soma valorTotal client-side.
 */
async function scrapeDiariasCamara(token) {
  const filtros = { ano: [String(ANO_ATUAL)] };
  const resp = await fetch(
    `${API_BASE}/busca-textual/${CONSULTA_DIARIAS_CAMARA_ID}?sortBy=null&sortDirection=null&offset=0&limit=2000&hiperlink=false`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Authorization': token,
        'app-context': APP_CONTEXT_CAMARA,
      },
      body: JSON.stringify(filtros),
    }
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  const hits = json.hits ?? [];
  const total = Math.round(hits.reduce((acc, h) => acc + (h.sourceAsMap?.valorTotal ?? 0), 0) * 100) / 100;

  // Persiste cada diária individual (dado público — LAI). Ordena por valor desc.
  const registros = hits
    .map(h => {
      const s = h.sourceAsMap ?? {};
      const valor = Math.round((s.valorTotal ?? 0) * 100) / 100;
      return {
        credor: (s.credor ?? '').trim(),
        cargo: (s.cargoCredor ?? '').trim(),
        destino: (s.localDestino ?? '').trim(),
        finalidade: (s.finalidade ?? '').trim(),
        periodo: (s.periodoDiarias ?? '').trim(),
        valor,
        valorFormatado: valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      };
    })
    .sort((a, b) => b.valor - a.valor);

  return {
    valorTotalAno: total,
    valorFormatado: total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    ano: ANO_ATUAL,
    periodo: `Jan–${new Date().toLocaleString('pt-BR', { month: 'short' })} ${ANO_ATUAL} (parcial)`,
    qtdEmpenhos: json.totalHits ?? hits.length,
    fonteUrl: `https://transparencia.betha.cloud/#/${CAMARA_HASH}/consulta/${CONSULTA_DIARIAS_CAMARA_ID}`,
    atualizadoEm: new Date().toISOString().slice(0, 10),
    registros,
  };
}

function trim(s, n = 400) {
  s = (s ?? '').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

/**
 * Busca uma lista de registros individuais (licitações, contratos) da Câmara
 * via busca-textual com body vazio. `mapper(sourceAsMap)` traduz cada registro
 * para o formato persistido; `valorDe(r)` extrai o número usado na ordenação.
 */
async function scrapeListaCamara(token, consultaId, mapper, valorDe) {
  const resp = await fetch(
    `${API_BASE}/busca-textual/${consultaId}?sortBy=null&sortDirection=null&offset=0&limit=2000&hiperlink=false`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Authorization': token,
        'app-context': APP_CONTEXT_CAMARA,
      },
      body: JSON.stringify({}),
    }
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  const hits = json.hits ?? [];
  const registros = hits
    .map(h => mapper(h.sourceAsMap ?? {}))
    .sort((a, b) => valorDe(b) - valorDe(a))
    .slice(0, LIMITE_REGISTROS_LISTA);
  return {
    totalHits: json.totalHits ?? hits.length,
    mostrando: registros.length,
    fonteUrl: `https://transparencia.betha.cloud/#/${CAMARA_HASH}/consulta/${consultaId}`,
    atualizadoEm: new Date().toISOString().slice(0, 10),
    registros,
  };
}

function brl(n) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function main() {
  log(`Início — ${new Date().toISOString()}`);
  log(`Modo: ${isDryRun ? 'DRY-RUN' : 'produção'}`);

  const dados = await carregarJsonExistente();

  log('Obtendo token de autenticação...');
  const token = await obterToken(CONSULTA_DESPESAS_ID);
  if (!token) throw new Error('Não foi possível capturar o token Betha');
  log(`Token obtido: ${token.slice(0, 20)}...`);

  // Permite rodar 1 categoria por execução para depuração
  if (filtroFuncao || filtroElemento) {
    const categorias = [['custom', { funcao: filtroFuncao, elementos: filtroElemento ? [filtroElemento] : [] }]];
    for (const [catId, mapping] of categorias) {
      log(`\n[custom] funcao=${mapping.funcao ?? '—'} elemento=${mapping.elementos?.[0] ?? '—'}`);
      try {
        const filtros = { anoExercicio: [String(ANO_ATUAL)] };
        if (mapping.funcao) filtros.descricaoFuncao = [mapping.funcao];
        if (mapping.elementos?.length) filtros.descricaoElemento = mapping.elementos;
        const data = await chamarTotalizadores(CONSULTA_DESPESAS_ID, filtros, token, APP_CONTEXT_PREFEITURA);
        const r = parseTotalizadores(data, CONSULTA_DESPESAS_ID, PREFEITURA_HASH);
        if (r) {
          r.qtdEmpenhos = await chamarContagem(CONSULTA_DESPESAS_ID, filtros, token, APP_CONTEXT_PREFEITURA);
          log(`  ✓ ${r.valorFormatado} (${r.qtdEmpenhos} registros)`);
        }
      } catch (err) {
        warn(`Falhou: ${err.message}`);
      }
    }
    return;
  }

  // --- PREFEITURA ---
  log('\n=== PREFEITURA ===');
  for (const [catId, mapping] of Object.entries(MAPEAMENTO_PREFEITURA)) {
    const elLabel = mapping.elementos?.length ? mapping.elementos[0] : '—';
    log(`\n[prefeitura/${catId}] funcao=${mapping.funcao ?? '—'} elemento=${elLabel}`);
    try {
      const filtros = { anoExercicio: [String(ANO_ATUAL)] };
      if (mapping.funcao) filtros.descricaoFuncao = [mapping.funcao];
      if (mapping.elementos?.length) filtros.descricaoElemento = mapping.elementos;

      const data = await chamarTotalizadores(CONSULTA_DESPESAS_ID, filtros, token, APP_CONTEXT_PREFEITURA);
      const r = parseTotalizadores(data, CONSULTA_DESPESAS_ID, PREFEITURA_HASH);
      if (r) {
        r.qtdEmpenhos = await chamarContagem(CONSULTA_DESPESAS_ID, filtros, token, APP_CONTEXT_PREFEITURA);
        log(`  ✓ ${r.valorFormatado} (${r.qtdEmpenhos} registros)`);
        dados.dados.prefeitura[catId] = r;
      } else {
        warn(`Não foi possível parsear totalizadores para prefeitura/${catId}`);
      }
    } catch (err) {
      warn(`Falhou prefeitura/${catId}: ${err.message}`);
    }
  }

  // --- CÂMARA ---
  log('\n=== CÂMARA ===');
  for (const [catId, mapping] of Object.entries(MAPEAMENTO_CAMARA)) {
    const elLabel = mapping.elementos?.length ? mapping.elementos[0] : '—';
    log(`\n[camara/${catId}] funcao=${mapping.funcao ?? '—'} elemento=${elLabel}`);
    try {
      const filtros = { anoExercicio: [String(ANO_ATUAL)] };
      if (mapping.funcao) filtros.descricaoFuncao = [mapping.funcao];
      if (mapping.elementos?.length) filtros.descricaoElemento = mapping.elementos;

      const data = await chamarTotalizadores(CONSULTA_CAMARA_ID, filtros, token, APP_CONTEXT_CAMARA);
      const r = parseTotalizadores(data, CONSULTA_CAMARA_ID, CAMARA_HASH);
      if (r) {
        r.qtdEmpenhos = await chamarContagem(CONSULTA_CAMARA_ID, filtros, token, APP_CONTEXT_CAMARA);
        log(`  ✓ ${r.valorFormatado} (${r.qtdEmpenhos} registros)`);
        dados.dados.camara[catId] = r;
      } else {
        warn(`Não foi possível parsear totalizadores para camara/${catId}`);
      }
    } catch (err) {
      warn(`Falhou camara/${catId}: ${err.message}`);
    }
  }

  // Diárias Câmara — consulta dedicada 324755
  log('\n[camara/diarias] consulta dedicada 324755');
  try {
    const r = await scrapeDiariasCamara(token);
    log(`  ✓ ${r.valorFormatado} (${r.qtdEmpenhos} registros)`);
    dados.dados.camara.diarias = r;
  } catch (err) {
    warn(`Falhou camara/diarias: ${err.message}`);
  }

  // --- LISTAS DA CÂMARA: licitações e contratos (registros individuais) ---
  dados.listas ??= { camara: {} };
  dados.listas.camara ??= {};

  log('\n[camara/licitacoes] consulta 324786');
  try {
    const lic = await scrapeListaCamara(
      token,
      CONSULTA_LICITACOES_CAMARA_ID,
      (s) => ({
        numero: `${s.modalidade ?? 'Licitação'} ${s.numeroLicitacao ?? ''}/${s.anoLicitacao ?? ''}`.trim(),
        modalidade: (s.modalidade ?? '').trim(),
        situacao: (s.situacao ?? '').trim(),
        objeto: trim(s.objeto),
        valorEstimado: Number(s.valorEstimado) || 0,
        valorHomologado: Number(s.valorHomologado) || 0,
        valorEstimadoFormatado: brl(Number(s.valorEstimado) || 0),
        valorHomologadoFormatado: brl(Number(s.valorHomologado) || 0),
        data: (s.dataAberturaEnvelopes ?? '').slice(0, 10),
      }),
      (r) => r.valorHomologado || r.valorEstimado,
    );
    log(`  ✓ ${lic.totalHits} licitações (persistidas ${lic.mostrando})`);
    dados.listas.camara.licitacoes = lic;
  } catch (err) {
    warn(`Falhou camara/licitacoes: ${err.message}`);
  }

  log('\n[camara/contratos] consulta 324812');
  try {
    const con = await scrapeListaCamara(
      token,
      CONSULTA_CONTRATOS_CAMARA_ID,
      (s) => ({
        numero: (s.numeroProcessoCompra ? `Processo ${s.numeroProcessoCompra}` : (s.numero ?? '')).trim(),
        tipo: (s.tipo ?? '').trim(),
        situacao: (s.situacao ?? '').trim(),
        objeto: trim(s.objeto),
        contratado: (s.nomeContratado ?? '').trim(),
        cnpjCpf: (s.cnpjCpfContratado ?? '').trim(),
        valorFinal: Number(s.valorFinal) || 0,
        valorFinalFormatado: brl(Number(s.valorFinal) || 0),
        data: (s.dataAssinatura ?? '').slice(0, 10),
      }),
      (r) => r.valorFinal,
    );
    log(`  ✓ ${con.totalHits} contratos (persistidos ${con.mostrando})`);
    dados.listas.camara.contratos = con;
  } catch (err) {
    warn(`Falhou camara/contratos: ${err.message}`);
  }

  dados.atualizadoEm = new Date().toISOString();

  if (isDryRun) {
    log('\n[DRY-RUN] Resultado:');
    console.log(JSON.stringify(dados, null, 2));
  } else {
    await salvarJson(dados);
    log(`\n✓ Gravado em ${JSON_OUT}`);
  }
  log('Fim.');
}

main().catch(e => { console.error(e); process.exit(1); });
