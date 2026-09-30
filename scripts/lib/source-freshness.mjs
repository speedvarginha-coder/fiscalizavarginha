// Datas de registros de negócio não comprovam quando uma base foi coletada.
// A data integral é a mais antiga entre os conjuntos comprovados. Uma
// partição sem histórico impede atribuir idade conhecida à base inteira.
export function lastCompleteTimestamp(value) {
  const datasets = value?.coleta_frescor?.datasets;
  if (!datasets || !Object.keys(datasets).length) return undefined;
  const dates = Object.values(datasets).map(item => item?.last_complete_at ? new Date(item.last_complete_at) : undefined);
  if (dates.some(date => !date || Number.isNaN(date.getTime()))) return undefined;
  return new Date(Math.min(...dates.map(date => date.getTime())));
}

// Percorre somente recipientes de metadados presentes nos coletores.
export function internalTimestamp(value) {
  const keys = new Set(["iso", "atualizado_em", "ultima_atualizacao", "data_atualizacao", "coleta_iso", "coletado_em", "data_coleta", "gerado_em"]);
  const containers = new Set(["meta", "metadata", "metadados", "status_fontes", "dados_abertos_status", "prefeitura", "camara"]);
  const dates = [];
  const seen = new Set();
  function visit(current) {
    if (!current || typeof current !== "object" || Array.isArray(current) || seen.has(current)) return;
    seen.add(current);
    for (const [key, item] of Object.entries(current)) {
      if (keys.has(key) && typeof item === "string") {
        const date = new Date(item.replace(" ", "T"));
        if (!Number.isNaN(date.getTime())) dates.push(date);
      } else if (containers.has(key) || /^20\d{2}$/.test(key)) visit(item);
    }
  }
  visit(value);
  return dates.sort((a, b) => b - a)[0];
}
export function collectionAgeHours(source, now = new Date()) {
  const timestamp = source?.source_updated_at;
  const date = timestamp ? new Date(timestamp) : undefined;
  const age = date ? (now - date) / 3_600_000 : NaN;
  return Number.isFinite(age) && age >= 0 ? age : Infinity;
}
