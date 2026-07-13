#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const painelDir = path.join(root, "painel-cidadao");
const chunksDir = path.join(painelDir, "data", "chunks");
const manifestPath = path.join(painelDir, "data", "manifest.json");
const camaraPath = path.join(chunksDir, "camara_anos.json");
const outPath = path.join(chunksDir, "indice_relevancia.json");

const PESOS = {
  legislar: 30,
  fiscalizar: 30,
  representar: 15,
  presenca: 25,
};

const SUBPESOS = {
  projeto_autoria_propria: 3,
  alteracao_relevante: 2,
  proposicao_simbolica: 0,
  emenda_relevante: 1.5,
  relatoria_processante: 3,
  requerimento_info: 1.5,
  audiencia_contas: 1,
  oficio_fiscalizacao: 1,
  indicacao_atendida: 1,
  audiencia_publica_diligencia: 1.5,
  comenda_titulo: 0,
  presenca_sessoes: 0.4,
  presenca_comissoes: 0.6,
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pct(value) {
  return Math.round(value * 10) / 10;
}

function scoreRelativo(value, max) {
  return max > 0 ? (value / max) * 100 : 0;
}

function posicoes(lista, chave, ordem = "desc") {
  return [...lista]
    .sort((a, b) => {
      const av = Number(chave(a)) || 0;
      const bv = Number(chave(b)) || 0;
      return ordem === "asc" ? av - bv : bv - av;
    })
    .map((item, index) => ({ nome: item.nome, posicao: index + 1, valor: pct(Number(chave(item)) || 0) }));
}

function motivo(item) {
  const ev = item.evidencias || {};
  const dim = item.dimensoes || {};
  const partes = [];

  if (dim.fiscalizar >= 70) {
    partes.push("puxou a nota por requerimentos de fiscalizacao acima da media da Casa");
  } else if (ev.requerimento_info > 0) {
    partes.push("tem requerimentos de fiscalizacao, mas abaixo dos maiores volumes do ano");
  }

  if (dim.legislar >= 70) {
    partes.push("tambem aparece forte em producao legislativa de merito e emendas");
  } else if ((ev.projeto_autoria_propria || 0) + (ev.emenda_relevante || 0) > 0) {
    partes.push("teve producao legislativa, mas com menor peso relativo no ano");
  }

  if ((ev.leis_aprovadas || 0) > 0) {
    partes.push(`teve ${ev.leis_aprovadas} materia(s) que viraram lei — efetividade comprovada na fonte oficial`);
  }

  if (ev.indicacao_protocolada_sem_confirmacao > 0) {
    partes.push("indicacoes entram com teto progressivo (volume alto pesa menos) para nao inflar a nota");
  }

  if (ev.proposicao_simbolica > 0) {
    partes.push("atos simbolicos ficam visiveis para transparencia e permanecem com peso zero");
  }

  if (!partes.length) {
    partes.push("nota baixa porque nao ha evidencias automaticas suficientes nas dimensoes pontuadas");
  }

  return partes.slice(0, 3);
}

function calcularAno(ano, bloco) {
  const vereadores = Array.isArray(bloco.vereadores) ? bloco.vereadores : [];
  const base = vereadores.map((v) => {
    const projetos = num(v.projetos_lei);
    const emendas = num(v.emendas);
    const requerimentos = num(v.requerimentos);
    const indicacoes = num(v.indicacoes);
    const impactoZero = num(v.impacto_zero);
    const mocoes = num(v.mocoes);
    const pdl = num(v.pdl);
    const nomeRua = num(v.nome_rua);
    const homenagens = num(v.homenagens_terceiros);

    const leis = num(v.leis_aprovadas);
    const simbolicos = impactoZero;
    const total = num(v.total);
    // Presença em plenário (% das sessões deliberativas elegíveis, por janela de mandato).
    // Dado oficial SAPL. null = sem dado (não exerceu mandato / não coletado) → fica pendente.
    const presencaPct = (v.presenca_pct === null || v.presenca_pct === undefined)
      ? null : num(v.presenca_pct);
    // Indicação com teto progressivo (evita "metralhadora de papel"):
    // 1-10 = 1pt, 11-20 = 0,5pt, >20 = 0,25pt; teto 15 pontos.
    const indicacaoPontos = Math.min(15,
      Math.min(indicacoes, 10) * 1 +
      Math.min(Math.max(indicacoes - 10, 0), 10) * 0.5 +
      Math.max(indicacoes - 20, 0) * 0.25);
    // Substantivo = trabalho que legisla/fiscaliza/destina; cerimonial = simbólico.
    const substantivo = projetos + emendas + requerimentos + indicacoes;
    const cerimonial = simbolicos;
    return {
      nome: String(v.nome || ""),
      total,
      leis_aprovadas: leis,
      dimensoes_brutas: {
        legislar: projetos * SUBPESOS.projeto_autoria_propria + emendas * SUBPESOS.emenda_relevante,
        fiscalizar: requerimentos * SUBPESOS.requerimento_info,
        representar: indicacaoPontos,
        efetividade: leis,
        presenca: presencaPct,
      },
      presenca_pct: presencaPct,
      presenca_presentes: (v.presenca_presentes == null ? null : num(v.presenca_presentes)),
      presenca_elegiveis: (v.presenca_elegiveis == null ? null : num(v.presenca_elegiveis)),
      presenca_janela: String(v.presenca_janela || ""),
      evidencias: {
        projeto_autoria_propria: projetos,
        alteracao_relevante: 0,
        proposicao_simbolica: impactoZero,
        emenda_relevante: emendas,
        leis_aprovadas: leis,
        relatoria_processante: 0,
        requerimento_info: requerimentos,
        audiencia_contas: 0,
        oficio_fiscalizacao: 0,
        indicacao_protocolada_sem_confirmacao: indicacoes,
        indicacao_atendida: 0,
        audiencia_publica_diligencia: 0,
        comenda_titulo: mocoes + pdl + homenagens + nomeRua,
      },
      composicao: {
        substantivo: substantivo,
        cerimonial: cerimonial,
        cerimonial_pct: total > 0 ? pct((cerimonial / total) * 100) : 0,
        substantivo_pct: total > 0 ? pct((substantivo / total) * 100) : 0,
      },
      perfil: {
        simbolico_pct: total > 0 ? pct((simbolicos / total) * 100) : 0,
      },
    };
  }).filter((v) => v.nome);

  const maxLeg = Math.max(0, ...base.map((v) => v.dimensoes_brutas.legislar));
  const maxFisc = Math.max(0, ...base.map((v) => v.dimensoes_brutas.fiscalizar));
  const maxRep = Math.max(0, ...base.map((v) => v.dimensoes_brutas.representar));
  const maxEfet = Math.max(0, ...base.map((v) => v.dimensoes_brutas.efetividade));

  const ranking = base.map((v) => {
    // Presença é ABSOLUTA (% de comparecimento), não relativa à Casa.
    const presenca = (v.presenca_pct === null) ? null : pct(v.presenca_pct);
    const dimensoes = {
      legislar: pct(scoreRelativo(v.dimensoes_brutas.legislar, maxLeg)),
      fiscalizar: pct(scoreRelativo(v.dimensoes_brutas.fiscalizar, maxFisc)),
      representar: pct(scoreRelativo(v.dimensoes_brutas.representar, maxRep)),
      presenca: presenca,
    };
    // ATIVIDADE: média ponderada das dimensões com dado. Cobertura é POR VEREADOR:
    // quem tem presença usa os 4 pesos (100%); sem presença, usa 3 (75%).
    let soma = dimensoes.legislar * PESOS.legislar +
               dimensoes.fiscalizar * PESOS.fiscalizar +
               dimensoes.representar * PESOS.representar;
    let pesoV = PESOS.legislar + PESOS.fiscalizar + PESOS.representar;
    if (presenca !== null) {
      soma += presenca * PESOS.presenca;
      pesoV += PESOS.presenca;
    }
    const indice = pesoV > 0 ? soma / pesoV : 0;
    // EFETIVIDADE: o que virou resultado (matérias que viraram lei). Dado SAPL.
    const efetividade = pct(scoreRelativo(v.dimensoes_brutas.efetividade, maxEfet));

    const item = {
      nome: v.nome,
      indice: pct(indice),
      efetividade: efetividade,
      leis_aprovadas: v.leis_aprovadas,
      cobertura_pct: pct(pesoV),
      confianca_dados_pct: pct(pesoV),
      presenca_pct: presenca,
      presenca_presentes: v.presenca_presentes,
      presenca_elegiveis: v.presenca_elegiveis,
      presenca_janela: v.presenca_janela,
      dimensoes,
      dimensoes_brutas: v.dimensoes_brutas,
      evidencias: v.evidencias,
      composicao: v.composicao,
      perfil: v.perfil,
      pendencias: (presenca === null
        ? ["relatoria_processante", "audiencia_contas", "oficio_fiscalizacao", "audiencia_publica_diligencia", "presenca_plenario", "presenca_comissoes"]
        : ["relatoria_processante", "audiencia_contas", "oficio_fiscalizacao", "audiencia_publica_diligencia", "presenca_comissoes"]),
    };
    item.explicacao = motivo(item);
    return item;
  }).sort((a, b) => b.indice - a.indice || a.nome.localeCompare(b.nome, "pt-BR"));

  ranking.forEach((v, index) => {
    v.posicao = index + 1;
  });

  // Cobertura do ano = média da cobertura individual (varia se algum vereador
  // não tem presença). Com presença de toda a Casa, chega a 100%.
  const coberturaAno = ranking.length
    ? pct(ranking.reduce((s, v) => s + (v.cobertura_pct || 0), 0) / ranking.length)
    : pct(PESOS.legislar + PESOS.fiscalizar + PESOS.representar);
  const comPresenca = ranking.filter((v) => v.presenca_pct !== null).length;

  return {
    ano: Number(ano),
    status: "parcial_auditavel",
    cobertura_pct: coberturaAno,
    confianca_dados_pct: coberturaAno,
    vereadores_monitorados: ranking.length,
    vereadores_com_presenca: comPresenca,
    rankings_perfil: {
      geral: posicoes(ranking, (v) => v.indice),
      legislador: posicoes(ranking, (v) => v.dimensoes.legislar),
      fiscalizador: posicoes(ranking, (v) => v.dimensoes.fiscalizar),
      simbolico: posicoes(ranking, (v) => (v.perfil || {}).simbolico_pct),
      representar: posicoes(ranking, (v) => v.dimensoes.representar),
      presenca: posicoes(ranking, (v) => (v.presenca_pct == null ? -1 : v.presenca_pct)),
      efetividade: posicoes(ranking, (v) => v.leis_aprovadas || 0),
    },
    ranking,
  };
}

function atualizarManifest() {
  const manifest = fs.existsSync(manifestPath)
    ? readJson(manifestPath)
    : { gerado_em: new Date().toISOString(), chunks: {} };

  manifest.chunks = manifest.chunks || {};
  const names = fs.readdirSync(chunksDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.basename(name, ".json"))
    .sort();

  for (const name of names) {
    const file = path.join(chunksDir, `${name}.json`);
    const content = fs.readFileSync(file);
    manifest.chunks[name] = {
      arquivo: `data/chunks/${name}.json`,
      bytes: content.length,
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
    };
  }

  writeJson(manifestPath, manifest);
}

const camara = readJson(camaraPath);
const anos = {};
for (const [ano, bloco] of Object.entries(camara)) {
  anos[ano] = calcularAno(ano, bloco || {});
}

const indice = {
  gerado_em: new Date().toISOString(),
  fonte: {
    principal: "camara_anos.json",
    origem: "SAPL Camara Municipal de Varginha",
    observacao: "O indice e recalculado a partir das materias legislativas ja coletadas. Campos sem fonte automatica permanecem como pendencia auditavel.",
  },
  metodologia: {
    versao: "Experimental v2",
    revisao: "anual",
    transparencia: "O Score Legislativo nao mede popularidade, ideologia ou amizade politica. Mede atividade parlamentar documentada, priorizando leis estruturais, fiscalizacao formal, emendas efetivamente pagas e acoes com resultado comprovado. Atos simbolicos sao exibidos por transparencia, mas nao pontuam.",
    duas_notas: {
      atividade: "O que o vereador produziu e como compareceu: legislar (projetos/emendas), fiscalizar (requerimentos), representar (indicacoes, com teto progressivo) e presenca em plenario.",
      efetividade: "O que virou resultado: materias que viraram lei (desfecho oficial do SAPL). Volume nao e merito.",
    },
    pesos: PESOS,
    subpesos: SUBPESOS,
    presenca: "Presenca = % de comparecimento as sessoes deliberativas (Ordinaria + Extraordinaria), com denominador por JANELA DE MANDATO: titular que saiu ou suplente que entrou no meio do ano so e medido nas sessoes em que tinha assento. Fonte oficial: SAPL (registro de presenca). Presenca em comissoes ainda nao e coletada.",
    regra: "Atividades simbolicas (mocao, homenagem, nome de rua) ficam registradas para transparencia, mas pesam zero. Indicacoes entram com teto progressivo para nao inflar a nota por volume. A Efetividade usa o desfecho real das materias (virou lei). A presenca usa o denominador por janela de mandato. Campos sem fonte automatica permanecem como pendencia auditavel.",
    campos_automaticos: ["projeto_autoria_propria", "emenda_relevante", "requerimento_info", "indicacao_com_teto", "leis_aprovadas", "proposicao_simbolica", "presenca_plenario"],
    campos_pendentes: ["relatoria_processante", "audiencia_contas", "oficio_fiscalizacao", "audiencia_publica_diligencia", "presenca_comissoes"],
  },
  anos,
};

writeJson(outPath, indice);
atualizarManifest();

console.log(`Indice de relevancia gerado: ${path.relative(root, outPath)}`);
