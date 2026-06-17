export type EntidadeId = "prefeitura" | "camara";

export interface AreaGasto {
  area: string;
  percentual: number;
  descricao: string;
  cor: string;
}

export interface CanalOficial {
  nome: string;
  descricao: string;
  url: string;
  tipo: "ouvidoria" | "esic" | "denuncia" | "consulta";
}

export interface LicitacaoRecente {
  numero: string;
  objeto: string;
  modalidade: string;
  data: string;
  url?: string;
}

export interface Vereador {
  nome: string;
  partido: string;
  cargoMesa?: "Presidente" | "Vice-Presidente" | "1º Secretário" | "2º Secretário" | "Secretária";
}

export interface LinkFolha {
  titulo: string;
  descricao: string;
  url: string;
}

export interface DiariaItem {
  servidor: string;
  funcao: string;
  destino: string;
  motivo: string;
  diasOuPeriodo: string;
  valor: string;
  data: string;
  ilustrativo?: boolean;
}

export interface TabelaDiaria {
  cargo: string;
  valor: string;
  observacao?: string;
}

export interface DiariasInfo {
  fonteLegal: string;
  urlConsulta: string;
  tabelaValores: TabelaDiaria[];
  acrescimoEspecial?: string;
  exemplos: DiariaItem[];
}

export interface Entidade {
  id: EntidadeId;
  nome: string;
  nomeCompleto: string;
  poder: "Executivo" | "Legislativo";
  papel: string;
  cor: string;
  corLight: string;
  orcamentoAnual: string;
  servidoresAprox: string;
  portalTransparencia: string;
  portalLicitacoes: string;
  portalContratos?: string;
  areasGasto: AreaGasto[];
  canais: CanalOficial[];
  oQueFaz: string[];
  oQueNaoFaz: string[];
  licitacoesRecentes?: LicitacaoRecente[];
  vereadores?: Vereador[];
  linksFolha?: LinkFolha[];
  chefe?: { nome: string; cargo: string };
  diarias?: DiariasInfo;
}

/**
 * URLs OFICIAIS validadas em maio/2026:
 * - Prefeitura: https://www.varginha.mg.gov.br
 * - Câmara: https://varginha.mg.leg.br e https://www.camaravarginha.mg.gov.br
 * - Ambas usam o sistema Betha Cloud para o Portal da Transparência
 *
 * Os percentuais de gasto são ESTIMATIVAS baseadas em médias de municípios
 * de porte similar a Varginha (~140 mil habitantes). Os valores reais estão
 * sempre disponíveis nos portais oficiais.
 */
export const ENTIDADES: Record<EntidadeId, Entidade> = {
  prefeitura: {
    id: "prefeitura",
    nome: "Prefeitura",
    nomeCompleto: "Prefeitura Municipal de Varginha",
    poder: "Executivo",
    papel:
      "Administra a cidade no dia a dia: executa obras, presta serviços de saúde, educação, limpeza e arrecada os tributos municipais.",
    cor: "var(--color-prefeitura)",
    corLight: "var(--color-prefeitura-light)",
    orcamentoAnual: "R$ 750 milhões (estimado 2026)",
    servidoresAprox: "~ 4.500 servidores",
    portalTransparencia:
      "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==",
    portalLicitacoes: "https://www.varginha.mg.gov.br/portal/editais/1",
    portalContratos: "https://www.varginha.mg.gov.br/portal/contratos",
    chefe: {
      nome: "Leonardo Ciacci",
      cargo: "Prefeito (2025-2028)",
    },
    linksFolha: [
      {
        titulo: "Folha de Pagamento",
        descricao: "Salários de todos os servidores, mês a mês.",
        url: "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==",
      },
      {
        titulo: "Cargos e Vencimentos",
        descricao: "Tabela oficial de salários por cargo da Prefeitura.",
        url: "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==",
      },
    ],
    diarias: {
      fonteLegal:
        "Lei nº 2.673/1995, Decreto nº 4.226/2007 e Decreto nº 5.030/2009",
      urlConsulta: "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==",
      tabelaValores: [
        {
          cargo: "Prefeito e Vice-Prefeito",
          valor: "R$ 180,00 / dia",
          observacao: "Maior valor — exige justificativa robusta",
        },
        {
          cargo: "Procurador-Geral, Secretários e Dirigentes máximos",
          valor: "R$ 140,00 / dia",
          observacao: "Alta administração",
        },
        {
          cargo: "Demais servidores municipais",
          valor: "R$ 100,00 / dia",
        },
      ],
      acrescimoEspecial:
        "+20% sobre o valor base quando o destino é Brasília (DF) ou outras capitais de Estado.",
      exemplos: [
        {
          servidor: "(consultar no portal)",
          funcao: "Secretário Municipal",
          destino: "Brasília — DF",
          motivo: "Reunião com Ministério da Saúde",
          diasOuPeriodo: "3 dias",
          valor: "R$ 504,00",
          data: "—",
          ilustrativo: true,
        },
        {
          servidor: "(consultar no portal)",
          funcao: "Servidor de carreira (Saúde)",
          destino: "Belo Horizonte — MG",
          motivo: "Capacitação SUS",
          diasOuPeriodo: "2 dias",
          valor: "R$ 200,00",
          data: "—",
          ilustrativo: true,
        },
        {
          servidor: "(consultar no portal)",
          funcao: "Motorista",
          destino: "São Paulo — SP",
          motivo: "Transporte de paciente",
          diasOuPeriodo: "1 dia",
          valor: "R$ 120,00",
          data: "—",
          ilustrativo: true,
        },
      ],
    },
    areasGasto: [
      {
        area: "Saúde",
        percentual: 26,
        descricao:
          "Postos, UPA, Santa Casa, programas e medicamentos. Mínimo constitucional: 15%.",
        cor: "#1c7ed6",
      },
      {
        area: "Educação",
        percentual: 27,
        descricao:
          "Escolas municipais, merenda, transporte escolar e Educação Infantil. Mínimo constitucional: 25%.",
        cor: "#37b24d",
      },
      {
        area: "Folha de Pessoal",
        percentual: 18,
        descricao:
          "Salários de servidores das demais áreas (limite da LRF: 54% da receita corrente líquida).",
        cor: "#f59f00",
      },
      {
        area: "Obras e Infraestrutura",
        percentual: 11,
        descricao:
          "Asfalto, drenagem, iluminação, manutenção de vias e prédios públicos.",
        cor: "#e8590c",
      },
      {
        area: "Assistência Social",
        percentual: 6,
        descricao:
          "CRAS, CREAS, programas para idosos, crianças e famílias em vulnerabilidade.",
        cor: "#ae3ec9",
      },
      {
        area: "Administração e demais",
        percentual: 12,
        descricao:
          "Gestão, cultura, esporte, meio ambiente, segurança e transporte público.",
        cor: "#868e96",
      },
    ],
    canais: [
      {
        nome: "Ouvidoria Municipal",
        descricao:
          "Reclamações, sugestões e elogios sobre serviços da Prefeitura.",
        url: "https://www.varginha.mg.gov.br/portal/ouvidoria",
        tipo: "ouvidoria",
      },
      {
        nome: "e-SIC (Lei de Acesso)",
        descricao:
          "Pedir acesso a qualquer informação pública. Resposta em até 20 dias.",
        url: "http://leideacesso.etransparencia.com.br/esic/wp_login.aspx?3170701,1",
        tipo: "esic",
      },
      {
        nome: "Portal da Transparência",
        descricao:
          "Despesas, receitas, contratos, salários e diárias em tempo real (sistema Betha).",
        url: "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==",
        tipo: "consulta",
      },
      {
        nome: "Ministério Público (MP-MG)",
        descricao:
          "Denunciar irregularidades graves: superfaturamento, fraude em licitações.",
        url: "https://www.mpmg.mp.br/",
        tipo: "denuncia",
      },
      {
        nome: "Tribunal de Contas (TCE-MG)",
        descricao:
          "Órgão que fiscaliza as contas do Município. Aceita denúncias do cidadão.",
        url: "https://www.tce.mg.gov.br/",
        tipo: "denuncia",
      },
    ],
    oQueFaz: [
      "Executa o orçamento e presta os serviços públicos municipais",
      "Realiza obras, manutenção e zeladoria urbana",
      "Administra escolas, postos de saúde e CRAS",
      "Cobra IPTU, ISS e outras taxas municipais",
      "Contrata fornecedores via licitação",
    ],
    oQueNaoFaz: [
      "Não cria leis (quem faz isso é a Câmara)",
      "Não fiscaliza a si mesma — quem fiscaliza é a Câmara, TCE e MP",
      "Não cuida de serviços estaduais (PM, escolas estaduais, IPSEMG)",
      "Não administra a Justiça nem o Cartório",
    ],
    licitacoesRecentes: [
      {
        numero: "Pregão Eletrônico 042/2026",
        objeto: "Aquisição de Veículo Automotor para a Guarda Municipal",
        modalidade: "Pregão Eletrônico",
        data: "2026-05-14",
      },
      {
        numero: "Pregão Eletrônico 044/2026",
        objeto: "Aquisição de Equipamento Gerador",
        modalidade: "Pregão Eletrônico",
        data: "2026-05-14",
      },
      {
        numero: "Pregão Eletrônico 032/2026",
        objeto:
          "Registro de Preços para o futuro e eventual fornecimento de carimbos",
        modalidade: "Pregão Eletrônico",
        data: "2026-05-14",
      },
      {
        numero: "Pregão Eletrônico 031/2026",
        objeto:
          "Registro de Preços para a futura e eventual prestação de serviços de recarga e testes hidrostáticos em extintores de incêndio",
        modalidade: "Pregão Eletrônico",
        data: "2026-05-14",
      },
      {
        numero: "Pregão Eletrônico 030/2026",
        objeto:
          "Registro de Preços para o futuro e eventual fornecimento de cobertura em policarbonato, instalada",
        modalidade: "Pregão Eletrônico",
        data: "2026-05-14",
      },
    ],
  },

  camara: {
    id: "camara",
    nome: "Câmara",
    nomeCompleto: "Câmara Municipal de Varginha",
    poder: "Legislativo",
    papel:
      "Faz as leis municipais, aprova o orçamento e FISCALIZA a Prefeitura. É composta pelos vereadores eleitos pelo povo.",
    cor: "var(--color-camara)",
    corLight: "var(--color-camara-light)",
    orcamentoAnual: "R$ 19 milhões (2026)",
    servidoresAprox: "~ 90 servidores + 15 vereadores",
    portalTransparencia: "https://varginha.mg.leg.br/transparencia",
    portalLicitacoes:
      "https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324786",
    portalContratos:
      "https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324812",
    chefe: {
      nome: "Alexandre Prado",
      cargo: "Presidente da Câmara (Mesa Diretora 2025-2026)",
    },
    vereadores: [
      { nome: "Alexandre Prado", partido: "AVANTE", cargoMesa: "Presidente" },
      { nome: "Pastor Faustinho", partido: "PSD", cargoMesa: "Vice-Presidente" },
      { nome: "Ana Rios Fontoura", partido: "UNIÃO", cargoMesa: "Secretária" },
      { nome: "Bruno Leandro", partido: "PSDB" },
      { nome: "Cássio Chiodi", partido: "SD" },
      { nome: "Dandan", partido: "PL" },
      { nome: "Davi Martins", partido: "PL" },
      { nome: "Dudu Ottoni", partido: "AVANTE" },
      { nome: "Joãozinho Enfermeiro", partido: "DC" },
      { nome: "Afonso Monticeli", partido: "MOBILIZA" },
      { nome: "Miguel da Saúde", partido: "PSD" },
      { nome: "Professora Mônica Cardoso", partido: "PCdoB" },
      { nome: "Thulyo Paiva", partido: "UNIÃO" },
      { nome: "Zé Morais", partido: "AVANTE" },
      { nome: "Zilda Silva", partido: "PP" },
    ],
    linksFolha: [
      {
        titulo: "Folha de Pagamento",
        descricao: "Salários de servidores e assessores parlamentares.",
        url: "https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/agrupador/324770",
      },
      {
        titulo: "Cargos e Vencimentos",
        descricao: "Tabela oficial de salários por cargo da Câmara.",
        url: "https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324753",
      },
    ],
    diarias: {
      fonteLegal:
        "Regulamento próprio da Câmara Municipal (resolução interna)",
      urlConsulta:
        "https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324755",
      tabelaValores: [
        {
          cargo: "Presidente da Câmara",
          valor: "Valor diferenciado",
          observacao: "Consulte a resolução interna vigente",
        },
        {
          cargo: "Vereador",
          valor: "Valor por resolução",
          observacao: "Item frequentemente alvo de fiscalização",
        },
        {
          cargo: "Servidor da Câmara",
          valor: "Valor por resolução",
        },
      ],
      acrescimoEspecial:
        "Acréscimos para capitais conforme regulamento. Viagens internacionais exigem autorização específica do plenário.",
      exemplos: [
        {
          servidor: "(consultar no portal)",
          funcao: "Vereador",
          destino: "Brasília — DF",
          motivo: "Audiência no Congresso Nacional",
          diasOuPeriodo: "2 dias",
          valor: "Conforme resolução",
          data: "—",
          ilustrativo: true,
        },
        {
          servidor: "(consultar no portal)",
          funcao: "Assessor Parlamentar",
          destino: "Belo Horizonte — MG",
          motivo: "Reunião na Assembleia Legislativa",
          diasOuPeriodo: "1 dia",
          valor: "Conforme resolução",
          data: "—",
          ilustrativo: true,
        },
        {
          servidor: "(consultar no portal)",
          funcao: "Servidor administrativo",
          destino: "São Paulo — SP",
          motivo: "Capacitação técnica",
          diasOuPeriodo: "3 dias",
          valor: "Conforme resolução",
          data: "—",
          ilustrativo: true,
        },
      ],
    },
    areasGasto: [
      {
        area: "Subsídio dos Vereadores",
        percentual: 28,
        descricao:
          "Remuneração mensal dos 15 vereadores (teto fixado em lei municipal).",
        cor: "#1c7ed6",
      },
      {
        area: "Folha de Servidores",
        percentual: 42,
        descricao:
          "Salários dos servidores concursados, comissionados e assessores parlamentares.",
        cor: "#37b24d",
      },
      {
        area: "Manutenção da Câmara",
        percentual: 14,
        descricao:
          "Energia, água, limpeza, segurança, materiais e manutenção predial.",
        cor: "#f59f00",
      },
      {
        area: "Tecnologia e Comunicação",
        percentual: 7,
        descricao:
          "TV Câmara, transmissão das sessões, sistemas internos e site.",
        cor: "#e8590c",
      },
      {
        area: "Diárias e Viagens",
        percentual: 4,
        descricao:
          "Diárias de vereadores e servidores em viagens oficiais. ALERTA: alvo frequente de fiscalização.",
        cor: "#c92a2a",
      },
      {
        area: "Demais despesas",
        percentual: 5,
        descricao:
          "Materiais de expediente, eventos, capacitação e diversos.",
        cor: "#868e96",
      },
    ],
    canais: [
      {
        nome: "Ouvidoria da Câmara",
        descricao:
          "Reclamações e sugestões sobre o funcionamento da Câmara e dos vereadores.",
        url: "https://www.varginha.mg.leg.br/institucional/ouvidoria",
        tipo: "ouvidoria",
      },
      {
        nome: "e-SIC (Lei de Acesso)",
        descricao:
          "Pedir acesso a documentos, votações, projetos e gastos da Câmara.",
        url: "https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/acesso-informacao",
        tipo: "esic",
      },
      {
        nome: "Portal da Transparência",
        descricao:
          "Salários, diárias, contratos, votações e atos dos vereadores.",
        url: "https://varginha.mg.leg.br/transparencia",
        tipo: "consulta",
      },
      {
        nome: "Vereadores e Sessões",
        descricao:
          "Veja quem são os vereadores, suas votações e a pauta das sessões plenárias.",
        url: "https://www.varginha.mg.leg.br/vereadores",
        tipo: "consulta",
      },
      {
        nome: "Ministério Público (MP-MG)",
        descricao:
          "Denunciar uso indevido de verba pública ou conduta de vereadores.",
        url: "https://www.mpmg.mp.br/",
        tipo: "denuncia",
      },
      {
        nome: "Tribunal de Contas (TCE-MG)",
        descricao:
          "Fiscaliza também as contas da Câmara. Aceita denúncia do cidadão.",
        url: "https://www.tce.mg.gov.br/",
        tipo: "denuncia",
      },
    ],
    oQueFaz: [
      "Cria, altera e revoga as leis municipais",
      "Aprova ou rejeita o orçamento anual proposto pela Prefeitura",
      "Fiscaliza os atos do Prefeito e a aplicação do dinheiro público",
      "Pode abrir CPI (Comissão Parlamentar de Inquérito)",
      "Julga as contas anuais da Prefeitura (após parecer do TCE)",
    ],
    oQueNaoFaz: [
      "Não executa obras nem presta serviços públicos",
      "Não contrata empresas para fazer obras na cidade",
      "Não administra escolas, postos de saúde ou secretarias",
      "Não cobra impostos — quem cobra é a Prefeitura",
    ],
    licitacoesRecentes: [
      {
        numero: "Consulte no Portal",
        objeto:
          "A Câmara publica suas próprias licitações no portal Betha. O volume é menor que o da Prefeitura, mas igualmente fiscalizável.",
        modalidade: "Diversas",
        data: "—",
      },
    ],
  },
};
