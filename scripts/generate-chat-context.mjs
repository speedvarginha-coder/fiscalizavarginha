import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chunks = path.join(root, "painel-cidadao", "data", "chunks");

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(chunks, name), "utf8"));
}

function topFornecedores(lista, limite = 10) {
  return (Array.isArray(lista) ? lista : []).slice(0, limite).map((item) => ({
    nome: item.nome || item.credor || item.fornecedor || "Não informado",
    valor: Number(item.valor ?? item.valor_total ?? item.total ?? 0),
  }));
}

const prefeitura = readJson("prefeitura.json");
const camara = readJson("camara_betha.json");
const diarias = readJson("diarias.json");
const pessoal = readJson("pessoal.json");
const legislativo = readJson("resumo.json");
const subsidio = readJson("remuneracao_vereadores.json");
const atualizado = readJson("atualizado_em.json");

const obras = Array.isArray(prefeitura.obras_publicas) ? prefeitura.obras_publicas : [];
const contratos = Array.isArray(prefeitura.contratos) ? prefeitura.contratos : [];
const contratosCamara = Array.isArray(camara.contratos) ? camara.contratos : [];

const contexto = {
  schema_version: 1,
  gerado_em: new Date().toISOString(),
  atualizado_em: atualizado.iso || atualizado.atualizado_em || atualizado.gerado_em || null,
  regras_editoriais: [
    "Valores de períodos diferentes não devem ser somados nem comparados sem explicação.",
    "Ausência em cruzamento automático não prova ausência de pagamento ou irregularidade.",
    "Valor de contrato não é igual a valor pago.",
    "Valor total dividido pela vigência não representa gasto diário efetivo.",
    "A lista histórica de parlamentares pode conter titulares e suplentes; a Câmara possui 15 cadeiras.",
  ],
  prefeitura: {
    ano: prefeitura.ano_atual,
    total_pago_fornecedores_externos: Number(prefeitura.total_externo_atual || 0),
    credores_mapeados: Number(prefeitura.credores_qtd || 0),
    contratos_total: contratos.length,
    contratos_do_ano: contratos.filter((c) => String(c.ano) === String(prefeitura.ano_atual)).length,
    contratos_em_execucao: contratos.filter(
      (c) => String(c.situacao || "").toUpperCase() === "EXECUCAO",
    ).length,
    obras_publicas: obras.length,
    top_fornecedores: topFornecedores(prefeitura.top_fornecedores_atual),
  },
  camara: {
    ano: camara.ano_atual,
    cadeiras: 15,
    total_pago_fornecedores_externos: Number(camara.total_externo_atual || 0),
    contratos_total: contratosCamara.length,
    top_fornecedores: topFornecedores(camara.top_fornecedores_atual),
    // Vem do chunk para nao congelar o valor: a revisao geral anual muda o
    // subsidio todo ano, e o texto fixo ficou preso na lei de fixacao de 2024.
    subsidio_vereador: {
      bruto_mensal: subsidio.subsidio_bruto_mensal_brl ?? null,
      lei_vigente: subsidio.lei?.numero ?? null,
      lei_data: subsidio.lei?.data ?? null,
      vigencia_inicio: subsidio.vigencia_inicio ?? null,
      reajuste_percentual: subsidio.reajuste?.percentual ?? null,
      lei_fixacao_original: subsidio.lei_fixacao_original?.numero ?? null,
      impacto_anual_estimado: subsidio.impacto_anual_estimado_brl ?? null,
      ressalva: "Use sempre o subsidio da lei vigente. A lei de fixacao original traz o valor sem as revisoes anuais.",
    },
  },
  diarias: {
    prefeitura: diarias.resumo?.prefeitura || null,
    camara: diarias.resumo?.camara || null,
    anos_disponiveis: diarias.anos || [],
  },
  pessoal: {
    prefeitura: {
      competencia: pessoal.prefeitura?.competencia || null,
      resumo: pessoal.prefeitura?.resumo || null,
    },
    camara: {
      competencia: pessoal.camara?.competencia || null,
      resumo: pessoal.camara?.resumo || null,
    },
  },
  legislativo: {
    ano: legislativo.ano,
    materias: legislativo.total_materias,
    emendas: legislativo.emendas_qtd,
    valor_emendas: legislativo.emendas_valor_total_brl,
    vereadores_ativos_na_composicao: legislativo.vereadores_ativos,
    observacao: "A base histórica pode incluir titulares e suplentes; não apresentar esse total como número de cadeiras.",
  },
  loa_2026: {
    orcamento_total: 1_223_155_000,
    saude_funcao: 481_253_739.01,
    secretaria_saude: 356_796_073.36,
    fundacao_hospitalar: 124_695_455.65,
    educacao: 210_183_248.21,
    iprev: 168_000_000,
    camara: 19_800_000,
    fonte: "docs/loa-2026-lei-7510-2025.pdf",
  },
  fundeb_2026: {
    tipo: "previsao_oficial_de_receita",
    valor: 104_771_249.39,
    publicacao: "2ª publicação oficial do FNDE",
    norma: "Portaria MEC/MF nº 6, de 29 de abril de 2026",
    // Escrita já no tom falado: o modelo copia a forma da ressalva ao repeti-la.
    ressalva: "Atenção: isso é previsão, não o que já entrou no caixa nem o que foi gasto. Também não prova que o mínimo de 70% para profissionais da educação foi cumprido.",
    fonte: "https://www.gov.br/fnde/pt-br/acesso-a-informacao/acoes-e-programas/financiamento/fundeb/2026-1/publicacoes-2026/2-publicacao/1-receita-total-do-fundeb-por-ente-federado.pdf",
  },
  pntp_2025: {
    prefeitura: { indice: 81.8, essenciais: 81.82, nivel: "Elevado" },
    camara: { indice: 63.28, essenciais: 85.71, nivel: "Intermediário" },
    natureza: "autoavaliação",
    validada: false,
    revisada: false,
    certificavel: false,
    ressalva: "É autoavaliação do próprio órgão. O Tribunal de Contas não validou nem certificou esses números.",
    fonte: "https://radardatransparencia.atricon.org.br/",
  },
  prazos_lai: {
    resposta: "20 dias corridos",
    prorrogacao: "mais 10 dias mediante justificativa expressa",
    fonte: "Lei 12.527/2011, art. 11",
  },
};

const destino = path.join(chunks, "chat_context.json");
fs.writeFileSync(destino, `${JSON.stringify(contexto, null, 2)}\n`, "utf8");
console.log(`OK — contexto do chatbot gerado em ${path.relative(root, destino)}.`);
