import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const month = value => {
  const s = String(value || '');
  const m = /^(20\d{2})-(0[1-9]|1[0-2])-(\d{2})(?:$|T)/.exec(s);
  if (!m) return null;
  const date = new Date(`${s.slice(0,10)}T12:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0,10) === s.slice(0,10) ? s.slice(0,7) : null;
};
const money = n => Math.round(n * 100) / 100;

export function aggregate(rows, dateKey, valueKey) {
  const groups = new Map();
  let excluded = 0;
  for (const row of rows || []) {
    const period = month(row[dateKey]);
    const value = row[valueKey];
    if (!period || typeof value !== 'number' || !Number.isFinite(value)) { excluded++; continue; }
    const group = groups.get(period) || {periodo: period, registros: 0, valor: 0};
    group.registros++; group.valor += value; groups.set(period, group);
  }
  return {pontos: [...groups.values()].sort((a,b) => a.periodo.localeCompare(b.periodo)).map(p => ({...p, valor: money(p.valor)})), excluidos: excluded};
}

export function buildCitizenData(data) {
  const sources = Object.entries(data.status_fontes?.domains || {}).map(([id, source]) => {
    const base = data[id] || {};
    const dates = [];
    if (['prefeitura','camara_betha','fundacao_cultural'].includes(id)) {
      dates.push(...(base.contratos || []).map(c => month(c.data_assinatura)).filter(Boolean));
    } else if (id === 'diarias') {
      dates.push(...['prefeitura','camara'].flatMap(k => (base[k] || []).map(c => month(c.data_inicial)).filter(Boolean)));
    } else if (id === 'licitacoes_resultados') {
      dates.push(...(base.registros || []).map(r => month(r.data_publicacao)).filter(Boolean));
    } else if (id.startsWith('publicidade_')) {
      dates.push(...(base.investimentos || []).map(r => r.periodo).filter(p => /^20\d{2}-(0[1-9]|1[0-2])$/.test(p)));
    } else if (id === 'pessoal') {
      dates.push(...(data.pessoal_historico?.competencias || []).map(m => {
        const match = /^(0[1-9]|1[0-2])\/(20\d{2})$/.exec(m.competencia || '');
        return match ? `${match[2]}-${match[1]}` : null;
      }).filter(Boolean));
    }
    dates.sort();
    const details = Object.entries(base.coleta_frescor?.datasets || {}).map(([name,d]) => ({
      conjunto: name, situacao: d.status, tentativa: d.checked_at || null, ultima_completa: d.last_complete_at || null,
    }));
    if (id === 'diarias') {
      const detail = base.coleta_status?.prefeitura_detalhe;
      if (detail) details.push({conjunto:'Detalhamento de destino e finalidade da Prefeitura',situacao:detail.status || 'não informado',tentativa:base.meta?.prefeitura?.ultima_tentativa || null,ultima_completa:null});
    }
    if (id === 'fontes_emendas_2026') {
      const reconciliation = data.emendas_prefeitura;
      const attempt = data.financial_status;
      if (reconciliation || attempt?.fontes?.reconciliacao) details.push({
        conjunto: 'Relatórios da Prefeitura para conciliação de emendas',
        situacao: attempt?.fontes?.reconciliacao === 'preservado' ? 'tentativa inconclusiva; base anterior preservada' : attempt?.fontes?.reconciliacao === 'ok' ? 'consulta executada; conferir leitura dos relatórios' : 'última tentativa não informada',
        tentativa: attempt?.executado_em || null,
        ultima_completa: reconciliation?.resumo?.relatorios > 0 && reconciliation?.resumo?.relatoriosLidosPorInteiro === reconciliation?.resumo?.relatorios ? reconciliation.geradoEm : null,
      });
    }
    if (id === 'licitacoes_resultados') details.push({conjunto:'Resultados por item',situacao:base.status || 'não informada',tentativa:base.ultima_tentativa_em || base.gerado_em || null,ultima_completa:base.ultima_coleta_completa_em || (base.status === 'ok' ? base.gerado_em : null)});
    const category = id === 'licitacoes_resultados' ? 'Compras (publicação)' : id === 'pessoal' ? 'Folhas' : id === 'diarias' ? 'Diárias (data inicial)' : 'Contratos (assinatura)';
    let period = dates.length ? `${category}: ${dates[0]} a ${dates.at(-1)}. Demais conjuntos sem período detalhado comprovado; o intervalo não garante cobertura integral.` : 'Período não informado de forma verificável nesta base.';
    if (id === 'fontes_emendas_2026') {
      const years = [...new Set((data.emendas || []).map(e=>String(e.exercicioOrcamentario || '')).filter(y=>/^20\d{2}$/.test(y)))].sort();
      if (years.length) period = `Emendas municipais com exercício explícito: ${years.join(', ')}. Outras esferas sem cobertura mensal comprovada.`;
    }
    const gaps = [];
    if (Array.isArray(base.contratos)) {
      const missingLinks = base.contratos.filter(c => !c.fonte_url).length;
      if (missingLinks) gaps.push(`${missingLinks} de ${base.contratos.length} contratos sem ficha individual identificada.`);
      const divergentes = base.contratos.filter(c => c.fonte_url && data.contratos_documentos?.[c.fonte_url]?.divergencia).length;
      if (divergentes) gaps.push(`${divergentes} contratos têm diferença registrada entre o valor do painel e a ficha oficial; os totais usam os valores do painel. Abra cada ficha e confira os aditivos antes de concluir.`);
      if (id === 'fundacao_cultural') {
        const missingMode = base.contratos.filter(c => !c.modalidade).length;
        if (missingMode) gaps.push(`${missingMode} contratos sem modalidade informada; não é possível deduzir contratação direta.`);
      }
    }
    if (id === 'licitacoes_resultados' && Array.isArray(base.registros)) {
      const unknown = base.registros.filter(r=>!r.resultados_consultados_em).length;
      if (unknown) gaps.push(`${unknown} de ${base.registros.length} compras sem data individual de consulta dos resultados; parte pode estar preservada de uma base anterior.`);
    }
    if (id === 'diarias') {
      for (const [agency, label] of [['prefeitura','Prefeitura'],['camara','Câmara']]) {
        const rows = base[agency] || [];
        const destino = rows.filter(r => !String(r.destino || '').trim()).length;
        const finalidade = rows.filter(r => !String(r.finalidade || '').trim()).length;
        if (destino || finalidade) gaps.push(`${label}: ${destino} de ${rows.length} registros sem destino e ${finalidade} sem finalidade. Na Prefeitura podem representar empenhos, não viagens individuais.`);
      }
    }
    if (id === 'fontes_emendas_2026' && data.emendas_prefeitura?.resumo) {
      const r = data.emendas_prefeitura.resumo;
      gaps.push(`Relatórios municipais: ${r.relatoriosLidosPorInteiro ?? 'quantidade não informada'} de ${r.relatorios ?? 'total não informado'} lidos integralmente; ${r.emendasNaoLidas ?? 'quantidade não informada'} emendas não lidas. Base de ${data.emendas_prefeitura.geradoEm || 'data não informada'}; não é prova de execução ou de ausência de recursos.`);
    }
    const financial = id === 'diarias' && data.financial_status?.executado_em ? {
      concluido_em: data.financial_status.executado_em,
      ciclo: data.financial_status.status,
      situacao: data.financial_status.fontes?.diarias || 'não informada',
    } : null;
    const amostraKey = {pessoal:'salarios',diarias:'diarias',prefeitura:'contratos',fontes_emendas_2026:'emendas'}[id];
    const audit = data.amostras?.conjuntos?.[amostraKey];
    const amostra = audit && data.amostras?.executado_em ? {
      executado_em:data.amostras.executado_em, status:audit.status,
      registros:Array.isArray(audit.registros) ? audit.registros.length : 0,
      divergencias:Array.isArray(audit.registros) ? audit.registros.filter(r => Object.values(r.campos || {}).includes('divergente')).length : 0,
      limite:audit.limite || 'Conferência parcial; consulte a fonte oficial.',
    } : null;
    return {id, ...source, periodo: period, detalhes: details, lacunas: gaps, tentativa_financeira: financial, amostra};
  });
  const series = [];
  for (const [orgao,label] of [['prefeitura','Prefeitura'],['camara','Câmara']]) {
    const id = orgao === 'camara' ? 'camara_betha' : 'prefeitura';
    const base = data[id] || {};
    const portal = `https://transparencia.betha.cloud/#/${orgao === 'camara' ? '-iAWLe1kr2VQcrW9k2AUBg==' : 'y7mn01LGqd_HCvGtj6VPwA=='}/consulta/`;
    const daily = aggregate(data.diarias?.[orgao], 'data_inicial', 'valor_total');
    const contracts = aggregate(base.contratos, 'data_assinatura', 'valor');
    for (const [tipo, title, agg, source] of [
      ['diarias', 'Diárias por mês de início do registro', daily, 'diarias'],
      ['contratos', 'Contratos por mês de assinatura', contracts, id],
    ]) {
      series.push({id:`${orgao}_${tipo}`, orgao:label, titulo:title, frequencia:'mensal', fonte:source, ...agg,
        url_fonte: portal + (tipo === 'contratos' ? (orgao === 'camara' ? '324812' : '83043') : (orgao === 'camara' ? '324755' : '83059')),
        limite: tipo === 'contratos' ? 'Valor contratual registrado na base atual, agrupado pela assinatura. Pode incluir alterações posteriores. Não representa pagamento mensal nem estoque histórico de contratos.' : 'Valores dos registros disponíveis por data inicial. Na Prefeitura podem ser empenhos classificados como diárias, não viagens individuais. Não representa necessariamente o mês do pagamento.',
        cobertura: tipo === 'diarias' ? data.diarias?.coleta_status?.[orgao] || {} : base.coleta_frescor?.datasets?.contratos || {}});
    }
    const pontos = [['ano_anterior','total_externo_anterior'],['ano_atual','total_externo_atual']]
      .filter(([year,total]) => base[year] && typeof base[total] === 'number' && Number.isFinite(base[total]))
      .map(([year,total]) => ({periodo:String(base[year]),valor:base[total],registros:null}));
    series.push({id:`${orgao}_despesas`,orgao:label,titulo:'Despesas externas consolidadas por ano',frequencia:'anual',fonte:id,pontos,excluidos:0,
      url_fonte: portal + (orgao === 'camara' ? '324767' : '83034'),
      limite:'A fonte coletada fornece totais anuais por credor. Detalhamento mensal indisponível. O ano corrente pode estar incompleto; não comparar com um ano encerrado como se fossem períodos equivalentes.'});
  }
  const emendas = new Map(); let excluded = 0;
  for (const e of data.emendas || []) {
    const year = String(e.exercicioOrcamentario || '');
    if (!/^20\d{2}$/.test(year) || typeof e.valor_brl !== 'number' || !Number.isFinite(e.valor_brl)) { excluded++; continue; }
    const p = emendas.get(year) || {periodo:year,valor:0,registros:0};
    p.valor += e.valor_brl; p.registros++; emendas.set(year,p);
  }
  series.push({id:'emendas',orgao:'Emendas municipais',titulo:'Emendas por exercício orçamentário',frequencia:'anual',fonte:'fontes_emendas_2026',
    url_fonte:'https://sapl.varginha.mg.leg.br/',
    pontos:[...emendas.values()].sort((a,b)=>a.periodo.localeCompare(b.periodo)).map(p=>({...p,valor:money(p.valor)})),excluidos:excluded,
    limite:'Valores propostos/destinados por exercício, não pagamentos. Datas de execução mensal não disponíveis. Ano da proposição não foi usado como exercício orçamentário.'});
  return {schema_version:1,gerado_em:new Date().toISOString(),fontes:sources,series};
}

export function generateCitizenData(chunks = path.join(root,'painel-cidadao/data/chunks')) {
  const data = {};
  for (const name of ['status_fontes','prefeitura','camara_betha','fundacao_cultural','diarias','emendas','emendas_prefeitura','contratos_documentos','pessoal_historico','licitacoes_resultados','publicidade_prefeitura','publicidade_camara']) {
    if (['emendas_prefeitura','contratos_documentos','pessoal_historico','licitacoes_resultados','publicidade_prefeitura','publicidade_camara'].includes(name) && !fs.existsSync(path.join(chunks,`${name}.json`))) continue;
    data[name] = JSON.parse(fs.readFileSync(path.join(chunks,`${name}.json`),'utf8'));
  }
  try {
    const financial = JSON.parse(fs.readFileSync(path.join(root,'private/state/financial-update.json'),'utf8').replace(/^\uFEFF/,''));
    data.financial_status = {executado_em:financial.executado_em,status:financial.status,fontes:{diarias:financial.fontes?.diarias,reconciliacao:financial.fontes?.reconciliacao}};
  } catch { /* Sem estado verificável, não inventar tentativa. */ }
  try { data.amostras = JSON.parse(fs.readFileSync(path.join(root,'private/state/conferencia-amostral.json'),'utf8').replace(/^\uFEFF/,'')); }
  catch { /* A ausência não significa que a amostra passou. */ }
  const output = buildCitizenData(data);
  const target = path.join(chunks,'fiscalizacao_cidada.json');
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp,JSON.stringify(output,null,2)+'\n'); fs.renameSync(tmp,target);
  return output;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = generateCitizenData(); console.log(`Cobertura: ${result.fontes.length} fontes; histórico: ${result.series.length} séries.`);
}
