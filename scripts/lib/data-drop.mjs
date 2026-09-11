// Guarda contra encolhimento silencioso: uma coleta parcial nao pode substituir
// uma base publicada por uma versao muito menor. A regra e conservadora de
// proposito — so acusa queda acima de 80% em bases com pelo menos 10 registros,
// para nao transformar variacao normal em bloqueio de publicacao.
const LIMITE_RATIO = 0.2;
const MINIMO_REGISTROS = 10;

export function avaliarQuedaAnormal(current, previous) {
  if (!Number.isFinite(previous) || previous < MINIMO_REGISTROS || !Number.isFinite(current)) return null;
  const ratio = current / previous;
  if (ratio > LIMITE_RATIO) return null;
  return {
    ratio,
    percentual: (1 - ratio) * 100,
    zero: current === 0,
  };
}
