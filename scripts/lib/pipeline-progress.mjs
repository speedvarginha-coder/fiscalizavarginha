// Um ciclo que o Agendador mata no ExecutionTimeLimit nao lanca excecao, nao
// grava log e nao registra estado. O marcador pipeline_in_progress.json so
// sobrevive quando o processo e morto; se ele persistir alem do orcamento do
// ciclo, o ciclo anterior morreu sem concluir.
export function avaliarCicloInterrompido(progresso, agoraMs, limiteHoras = 5) {
  const inicio = progresso?.iniciado_em ? new Date(progresso.iniciado_em).getTime() : NaN;
  if (!Number.isFinite(inicio) || !Number.isFinite(agoraMs)) return null;
  const horas = (agoraMs - inicio) / 3_600_000;
  if (!(horas > limiteHoras)) return null;
  return {
    horas,
    fase: progresso.fase || "?",
    pid: progresso.pid || "?",
    tarefa: progresso.tarefa || "?",
  };
}
