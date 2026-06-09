#!/usr/bin/env node
import fs from "node:fs";
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

  if (ev.indicacao_protocolada_sem_confirmacao > 0) {
    partes.push("indicacoes protocoladas aparecem como evidencia, mas ainda nao pontuam sem comprovacao de atendimento");
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

    const simbolicos = impactoZero;
    const total = num(v.total);
    return {
      nome: String(v.nome || ""),
      total,
      dimensoes_brutas: {
        legislar: projetos * SUBPESOS.projeto_autoria_propria + emendas * SUBPESOS.emenda_relevante,
        fiscalizar: requerimentos * SUBPESOS.requerimento_info,
        representar: null,
        presenca: null,
      },
      evidencias: {
        projeto_autoria_propria: projetos,
        alteracao_relevante: 0,
        proposicao_simbolica: impactoZero,
        emenda_relevante: emendas,
        relatoria_processante: 0,
        requerimento_info: requerimentos,
        audiencia_contas: 0,
        oficio_fiscalizacao: 0,
        indicacao_protocolada_sem_confirmacao: indicacoes,
        indicacao_atendida: 0,
        audiencia_publica_diligencia: 0,
        comenda_titulo: mocoes + pdl + homenagens + nomeRua,
      },
      perfil: {
        simbolico_pct: total > 0 ? pct((simbolicos / total) * 100) : 0,
      },
    };
  }).filter((v) => v.nome);

  const maxLeg = Math.max(0, ...base.map((v) => v.dimensoes_brutas.legislar));
  const maxFisc = Math.max(0, ...base.map((v) => v.dimensoes_brutas.fiscalizar));
  const pesoDisponivel = PESOS.legislar + PESOS.fiscalizar;

  const ranking = base.map((v) => {
    const dimensoes = {
      legislar: pct(scoreRelativo(v.dimensoes_brutas.legislar, maxLeg)),
      fiscalizar: pct(scoreRelativo(v.dimensoes_brutas.fiscalizar, maxFisc)),
      representar: null,
      presenca: null,
    };
    const indice =
      (dimensoes.legislar * PESOS.legislar +
       dimensoes.fiscalizar * PESOS.fiscalizar +
       dimensoes.representar * PESOS.representar) / pesoDisponivel;

    const item = {
      nome: v.nome,
      indice: pct(indice),
      cobertura_pct: pct(pesoDisponivel),
      confianca_dados_pct: pct(pesoDisponivel),
      dimensoes,
      dimensoes_brutas: v.dimensoes_brutas,
      evidencias: v.evidencias,
      perfil: v.perfil,
      pendencias: ["alteracao_relevante", "relatoria_processante", "audiencia_contas", "oficio_fiscalizacao", "indicacao_atendida", "audiencia_publica_diligencia", "presenca_sessoes", "presenca_comissoes"],
    };
    item.explicacao = motivo(item);
    return item;
  }).sort((a, b) => b.indice - a.indice || a.nome.localeCompare(b.nome, "pt-BR"));

  ranking.forEach((v, index) => {
    v.posicao = index + 1;
  });

  return {
    ano: Number(ano),
    status: "parcial_auditavel",
    cobertura_pct: pct(pesoDisponivel),
    confianca_dados_pct: pct(pesoDisponivel),
    vereadores_monitorados: ranking.length,
    rankings_perfil: {
      geral: posicoes(ranking, (v) => v.indice),
      legislador: posicoes(ranking, (v) => v.dimensoes.legislar),
      fiscalizador: posicoes(ranking, (v) => v.dimensoes.fiscalizar),
      simbolico: posicoes(ranking, (v) => (v.perfil || {}).simbolico_pct),
      efetividade: [],
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
    manifest.chunks[name] = {
      arquivo: `data/chunks/${name}.json`,
      bytes: fs.statSync(file).size,
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
    pesos: PESOS,
    subpesos: SUBPESOS,
    regra: "Atividades simbolicas ficam registradas para transparencia, mas nao pontuam. Indicacoes so pontuam quando houver atendimento ou resposta efetiva comprovada; enquanto isso, aparecem apenas como evidencia. Como parte dos campos depende de atas ou fonte estruturada ainda nao automatizada, a nota informa a cobertura automatica disponivel.",
    campos_automaticos: ["projeto_autoria_propria", "emenda_relevante", "requerimento_info", "proposicao_simbolica"],
    campos_pendentes: ["alteracao_relevante", "relatoria_processante", "audiencia_contas", "oficio_fiscalizacao", "indicacao_atendida", "audiencia_publica_diligencia", "presenca_sessoes", "presenca_comissoes"],
  },
  anos,
};

writeJson(outPath, indice);
atualizarManifest();

console.log(`Indice de relevancia gerado: ${path.relative(root, outPath)}`);
