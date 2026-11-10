(function (root) {
  "use strict";

  // O agregado da CGU pode ter vários meses. A correspondência não identifica
  // o mês nem transforma o documento da União em despesa municipal.
  function documentosParaRegistro(record, data) {
    if (record?.tipo !== "Federal" || !/^\d{12}$/.test(String(record.emenda || ""))) return [];
    const cnpj = String(record.documentoBeneficiario || "").replace(/\D/g, "");
    if (!/^\d{14}$/.test(cnpj)) return [];
    return (Array.isArray(data?.documentos) ? data.documentos : []).filter(doc =>
      doc.emenda === record.emenda && /^\d{14}$/.test(String(doc.cnpj || "")) && doc.cnpj === cnpj
    );
  }

  function renderizar(record, data, escapeHtml, status) {
    if (record?.tipo !== "Federal") return "";
    if (!data || !Array.isArray(data.documentos) || !Array.isArray(data.fontes)) {
      return '<p>Documentos federais da CGU indisponíveis nesta consulta.</p>';
    }
    const years = data.fontes.map(f => f.ano).filter(y => Number.isInteger(y) && y >= 2014 && y <= 2100);
    const checked = data.coletadoEm ? new Date(data.coletadoEm) : null;
    const collected = !checked || Number.isNaN(checked.getTime()) ? 'não informada' : checked.toLocaleDateString('pt-BR');
    const attempt = status?.tentativaEm ? new Date(status.tentativaEm) : null;
    const attemptDate = attempt && !Number.isNaN(attempt.getTime()) ? attempt.toLocaleString('pt-BR') : 'não informada';
    const attemptText = status?.status === 'preservado' ? 'falhou; base anterior preservada' : status?.status === 'ok' ? 'concluída' : 'situação não informada';
    const docs = documentosParaRegistro(record, data);
    const list = docs.map(doc => {
      const value = doc.fase === 'Pagamento' ? doc.pago : doc.fase === 'Empenho' ? doc.empenhado : '';
      const numeric = /^-?\d+(?:,\d{1,2})?$/.test(String(value)) ? Number(String(value).replace(',', '.')) : null;
      const money = numeric === null ? '' : ` · ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numeric)}`;
      return `<li>${escapeHtml(doc.fase || 'Fase não informada')} · ${escapeHtml(doc.documento)} · ${escapeHtml(doc.data || 'data não informada')}${money} <small>(arquivo ${escapeHtml(String(doc.anoArquivo))})</small></li>`;
    }).join('');
    const sources = years.map(y => `<a href="https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares-documentos/${y}" target="_blank" rel="noopener noreferrer">Arquivo oficial ${y}</a>`).join(' · ');
    const result = docs.length ? `<ul>${list}</ul>` : '<p>Nenhum documento foi vinculado neste recorte. Isso não prova que não exista despesa.</p>';
    return `<section class="document-trail" aria-label="Documentos federais da CGU"><h3>Documentos federais da CGU</h3><p>Última coleta bem-sucedida: ${escapeHtml(collected)}; última tentativa: ${escapeHtml(attemptDate)} (${escapeHtml(attemptText)}). Arquivos de ${escapeHtml(years.join(', ') || 'período não informado')}. O vínculo usa código da emenda e CNPJ do favorecido. Os documentos abrangem o período consultado e não necessariamente o mês deste registro.</p>${result}<p>São etapas da despesa da União; não comprovam crédito em conta, gasto municipal, pagamento ao fornecedor final ou entrega. O recorte por localidade pode excluir recursos regionalizados. Empenho, liquidação e pagamento não devem ser somados entre si.</p><p>${sources}</p></section>`;
  }

  const api = { documentosParaRegistro, renderizar };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.DocumentosEmendasCGU = api;
})(typeof window === "undefined" ? null : window);
