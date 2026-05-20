import type { CategoriaGasto } from "@/data/categoriasGasto";

/**
 * Normaliza string para busca: lowercase, remove acentos e pontuação.
 * "Combustível" → "combustivel"
 * "Café com leite" → "cafe com leite"
 */
export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ResultadoBusca {
  categoria: CategoriaGasto;
  score: number;
  termoMatch: string;
}

/**
 * Busca categorias por termo digitado pelo cidadão.
 * Score: exato (100) > prefix (60) > contém (30).
 * Retorna ordenado do melhor pro pior, no máximo 6 resultados.
 */
export function buscarCategorias(
  termo: string,
  categorias: CategoriaGasto[],
): ResultadoBusca[] {
  const q = normalizar(termo);
  if (q.length < 2) return [];

  const resultados: ResultadoBusca[] = [];

  for (const cat of categorias) {
    let melhorScore = 0;
    let termoMatch = "";

    const candidatos = [cat.rotulo, ...cat.termos];

    for (const c of candidatos) {
      const n = normalizar(c);
      let score = 0;

      if (n === q) score = 100;
      else if (n.startsWith(q)) score = 60;
      else if (n.includes(q)) score = 30;
      else if (q.includes(n) && n.length >= 3) score = 20;

      if (score > melhorScore) {
        melhorScore = score;
        termoMatch = c;
      }
    }

    if (melhorScore > 0) {
      resultados.push({ categoria: cat, score: melhorScore, termoMatch });
    }
  }

  return resultados.sort((a, b) => b.score - a.score).slice(0, 6);
}

/**
 * Sugestões populares — chips clicáveis pra dar ideia do que pesquisar.
 */
export const SUGESTOES_POPULARES = [
  "Combustível",
  "Lanches e café",
  "Asfalto",
  "Medicamentos",
  "Merenda escolar",
  "Limpeza",
  "Publicidade",
  "Veículos",
];
