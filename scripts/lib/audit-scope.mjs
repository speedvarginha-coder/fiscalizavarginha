// A rotina financeira preserva os feeds editoriais e não altera a coleta principal.
const outsideFinancialScope = new Set([
  "base-muito-antiga", "publicacoes-camara-defasadas", "publicacoes-diario-defasadas",
]);

export function blocksAuditScope(issue, scope = "all") {
  if (!["all", "financial"].includes(scope)) throw new Error("Escopo de auditoria inválido");
  return issue.severity === "error" && issue.blocksPipeline !== false
    && !(scope === "financial" && outsideFinancialScope.has(issue.id));
}
