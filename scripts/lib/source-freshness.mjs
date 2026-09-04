// Datas de registros de negócio não comprovam quando uma base foi coletada.
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
