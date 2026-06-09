import type { EntidadeId } from "./entidades";
import dadosReaisRaw from "./categoriasGasto.real.json";

export interface DiariaRegistro {
  credor: string;
  cargo: string;
  destino: string;
  finalidade: string;
  periodo: string;
  valor: number;
  valorFormatado: string;
}

export interface ValorReal {
  valorTotalAno: number;
  valorFormatado: string;
  ano: number;
  periodo: string;
  qtdEmpenhos: number;
  fonteUrl: string;
  atualizadoEm: string;
  /** Só presente em diárias: registros individuais (nome, destino, motivo, valor). */
  registros?: DiariaRegistro[];
}

export interface LicitacaoReal {
  numero: string;
  modalidade: string;
  situacao: string;
  objeto: string;
  valorEstimado: number;
  valorHomologado: number;
  valorEstimadoFormatado: string;
  valorHomologadoFormatado: string;
  data: string;
}

export interface ContratoReal {
  numero: string;
  tipo: string;
  situacao: string;
  objeto: string;
  contratado: string;
  cnpjCpf: string;
  valorFinal: number;
  valorFinalFormatado: string;
  data: string;
}

export interface ListaReal<T> {
  totalHits: number;
  mostrando: number;
  fonteUrl: string;
  atualizadoEm: string;
  registros: T[];
}

export interface DadosReais {
  atualizadoEm: string | null;
  fontePadrao: string;
  observacao?: string;
  dados: {
    prefeitura: Record<string, ValorReal>;
    camara: Record<string, ValorReal>;
  };
  listas?: {
    camara?: {
      licitacoes?: ListaReal<LicitacaoReal>;
      contratos?: ListaReal<ContratoReal>;
    };
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

export interface FatiaReal {
  area: string;
  percentual: number;
  valorFormatado: string;
  descricao: string;
  cor: string;
}

/**
 * Rateio REAL por função orçamentária, calculado a partir dos dados raspados.
 * Só funciona para entidades com `total-geral` + funções (Prefeitura).
 *
 * As funções (saude/educacao/urbanismo) são fatias do total; o restante vira
 * "Outras funções". NÃO inclui categorias por elemento (combustível, lanches…)
 * pois elas já estão DENTRO das funções — somá-las seria contagem dupla.
 *
 * Retorna null quando não há dados suficientes (ex.: Câmara, sem dado por função).
 */
const FUNCOES_REAIS: { id: string; area: string; descricao: string; cor: string }[] = [
  {
    id: "saude",
    area: "Saúde",
    descricao:
      "Postos, UPA, Santa Casa, programas e medicamentos. Mínimo constitucional: 15%.",
    cor: "#1c7ed6",
  },
  {
    id: "educacao",
    area: "Educação",
    descricao:
      "Escolas municipais, merenda, transporte escolar e Educação Infantil. Mínimo constitucional: 25%.",
    cor: "#37b24d",
  },
  {
    id: "urbanismo",
    area: "Urbanismo",
    descricao:
      "Obras viárias, drenagem, iluminação, praças e manutenção urbana.",
    cor: "#e8590c",
  },
];

export function rateioFuncoesReais(entidadeId: EntidadeId): FatiaReal[] | null {
  const total = valorRealDe(entidadeId, "total-geral");
  if (!total || total.valorTotalAno <= 0) return null;

  const fatias: FatiaReal[] = [];
  let somaConhecida = 0;

  for (const f of FUNCOES_REAIS) {
    const v = valorRealDe(entidadeId, f.id);
    if (!v) continue;
    const pct = (v.valorTotalAno / total.valorTotalAno) * 100;
    somaConhecida += v.valorTotalAno;
    fatias.push({
      area: f.area,
      percentual: Math.round(pct),
      valorFormatado: v.valorFormatado,
      descricao: f.descricao,
      cor: f.cor,
    });
  }

  if (fatias.length === 0) return null;

  const restante = total.valorTotalAno - somaConhecida;
  if (restante > 0) {
    fatias.push({
      area: "Outras funções",
      percentual: Math.round((restante / total.valorTotalAno) * 100),
      valorFormatado: restante.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      }),
      descricao:
        "Administração, Assistência Social, Cultura, Esporte, Segurança, Legislativo e demais funções de governo.",
      cor: "#868e96",
    });
  }

  return fatias.sort((a, b) => b.percentual - a.percentual);
}

export function periodoReal(entidadeId: EntidadeId): string | null {
  return valorRealDe(entidadeId, "total-geral")?.periodo ?? null;
}

/**
 * Registros individuais de diárias (dado público — LAI), ordenados por valor.
 * Retorna [] quando não há registros coletados para a entidade.
 */
export function diariasRegistros(entidadeId: EntidadeId): DiariaRegistro[] {
  return valorRealDe(entidadeId, "diarias")?.registros ?? [];
}

/**
 * Lista real de licitações da entidade (só Câmara hoje). null se não coletada.
 */
export function licitacoesReais(
  entidadeId: EntidadeId,
): ListaReal<LicitacaoReal> | null {
  if (entidadeId !== "camara") return null;
  return dadosReais.listas?.camara?.licitacoes ?? null;
}

/**
 * Lista real de contratos da entidade (só Câmara hoje). null se não coletada.
 */
export function contratosReais(
  entidadeId: EntidadeId,
): ListaReal<ContratoReal> | null {
  if (entidadeId !== "camara") return null;
  return dadosReais.listas?.camara?.contratos ?? null;
}
