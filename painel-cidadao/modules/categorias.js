/* Fiscaliza Varginha — modules/categorias.js
 *
 * Categorias cidadãs — classifica itens (contratos/emendas) por área.
 *
 * Disponível em window.ZELA.categorias.
 * Carregado pelo data-loader.js (depois de utils.js, antes de app.js).
 *
 * Dependências externas:
 *   - window.ZELA.utils.* (esc, jsSafe, norm — conforme uso interno)
 */
(function () {
  "use strict";
  window.ZELA = window.ZELA || {};
  // Aliases das utilidades. utils.js DEVE ser carregado antes.
  const u = window.ZELA.utils;
  if (!u) {
    console.error("[categorias] window.ZELA.utils ausente. Carregue modules/utils.js primeiro.");
    return;
  }
  const esc = u.esc, jsSafe = u.jsSafe, norm = u.norm;

  // ============= CATEGORIAS CIDADÃS =============
  // Mapa de categorias amigáveis com keywords para classificar contratos/emendas
  // Cultura/Eventos e Locação são checados ANTES de Obras: um contrato de
  // evento ou de aluguel não vira "obra" só porque o objeto cita a
  // "Secretaria de Obras". Obras = construção/infraestrutura de verdade.
  const CATEGORIAS = [
    { id: "saúde",         iconKey: "saude",         label: "Saúde",        kw: ["saúde", "hospital", "ubs", "ambulancia", "medic", "enfermag", "vacin", "samu", "farmacia", "consulta", "exame", "psf", "psicologo", "fisioterap", "odontolog", "dentista", "tfd"] },
    { id: "educação",      iconKey: "educacao",      label: "Educação",     kw: ["escola", "creche", "cmei", "cemei", "ensino", "educação", "educacional", "professor", "merenda", "transporte escolar", "fundeb", "aluno", "didat", "uniforme escolar", "biblioteca"] },
    { id: "cultura",       iconKey: "cultura",       label: "Cultura/Eventos", kw: ["evento", "show", "festival", "carnaval", "artista", "cultura", "banda", "musica", "espetaculo", "teatro", "cinema", "exposicao", "banheiro quimico", "palco", "sonorizacao", "decoracao natalina", "decoracoes natalinas", "barraca", "festa", "festividade"] },
    { id: "administracao", iconKey: "administracao", label: "Administração", kw: ["locacao de imovel", "locação de imóvel", "locacao de imoveis", "aluguel de imovel", "imovel para atendimento", "administracao", "papelaria", "material de expediente", "informatica", "software", "consultoria", "assessoria", "publicidade", "propaganda", "telefonia", "internet"] },
    { id: "obras",         iconKey: "obras",         label: "Obras",        kw: ["pavimenta", "asfalt", "recapea", "calcada", "calcamento", "calçament", "meio-fio", "terraplan", "drenagem", "galeria pluvial", "agua pluvial", "água pluvial", "saneament", "esgoto", "construcao de", "construção de", "reforma de", "reforma da", "reforma do", "reforma predial", "edificac", "edificaç", "ponte", "viaduto", "engenharia", "drywall", "iluminacao publica", "iluminação pública"] },
    { id: "transporte",    iconKey: "transporte",    label: "Transporte",   kw: ["transporte", "onibus", "frota", "veiculo", "combustivel", "diesel", "gasolina", "pneu", "manutenção de veiculo", "passageiro", "linha urbana"] },
    { id: "assistencia",   iconKey: "assistencia",   label: "Assistência Social", kw: ["assistencia social", "cras", "creas", "bolsa", "idoso", "vulnerab", "cesta basica", "abrigo", "acolhimento", "crianca em risco"] },
    { id: "seguranca",     iconKey: "seguranca",     label: "Segurança",     kw: ["seguranca", "guarda municipal", "vigilancia", "monitoramento", "camera", "alarme", "policial", "patrulha"] },
  ];

  window.ZELA.categorias = CATEGORIAS;
  // Classifica pelo OBJETO (o que está sendo comprado) — não pela secretaria
  // gestora (entidade) nem pela modalidade. Inclui beneficiário/tipo, que ajudam
  // sobretudo nas emendas. Isso evita que tudo de uma "Secretaria de Obras"
  // seja rotulado como Obras.
  // Palavras de outro domínio que CONTÊM uma keyword por substring e gerariam
  // falso-positivo. Ex.: "agricultura" contém "cultura"; "banda larga" contém
  // "banda". Neutralizadas antes do match. (Agricultura não tem categoria
  // cidadã própria, então vira token neutro.)
  const ARMADILHAS = /agricultura|agropecuaria|agricola|banda larga/g;

  window.ZELA.classificarItem = function (item) {
    let txt = norm([item.objeto, item.beneficiario, item.tipo].filter(Boolean).join(" "));
    txt = txt.replace(ARMADILHAS, " agro ");
    for (let i = 0; i < CATEGORIAS.length; i++) {
      const cat = CATEGORIAS[i];
      if (cat.kw.some(k => txt.includes(k))) return cat.id;
    }
    return null;
  };

})();
