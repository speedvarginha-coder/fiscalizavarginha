import type { EntidadeId } from "./entidades";
import dadosReaisRaw from "./categoriasGasto.real.json";

export interface ValorReal {
  valorTotalAno: number;
  valorFormatado: string;
  ano: number;
  periodo: string;
  qtdEmpenhos: number;
  fonteUrl: string;
  atualizadoEm: string;
}

export interface DadosReais {
  atualizadoEm: string | null;
  fontePadrao: string;
  observacao?: string;
  dados: {
    prefeitura: Record<string, ValorReal>;
    camara: Record<string, ValorReal>;
  };
}

const dadosReais = dadosReaisRaw as unknown as DadosReais;

/**
 * Retorna o valor REAL de uma categoria, se disponível no arquivo
 * categoriasGasto.real.json. Caso contrário, undefined — a UI deve
 * cair na estimativa de categoriasGasto.ts.
 */
export function valorRealDe(
  entidadeId: EntidadeId,
  categoriaId: string,
): ValorReal | undefined {
  return dadosReais.dados[entidadeId]?.[categoriaId];
}

export function fonteGeral(): string {
  return dadosReais.fontePadrao;
}

export function ultimaAtualizacaoGeral(): string | null {
  return dadosReais.atualizadoEm;
}

/**
 * Quantas categorias de uma entidade já têm dado real.
 * Útil para mostrar "X de Y categorias com dados reais auditados".
 */
export function totalComDadoReal(entidadeId: EntidadeId): number {
  return Object.keys(dadosReais.dados[entidadeId] ?? {}).length;
}
