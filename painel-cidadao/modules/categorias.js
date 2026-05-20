/* Zela Varginha — modules/categorias.js
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
  const CATEGORIAS = [
    { id: "saúde",         icone: "🏥", label: "Saúde",        kw: ["saúde", "hospital", "ubs", "ambulancia", "medic", "enfermag", "vacin", "samu", "farmacia", "consulta", "exame", "psf", "psicologo", "fisioterap", "odontolog", "dentista", "tfd"] },
    { id: "educação",      icone: "📚", label: "Educação",     kw: ["escola", "creche", "cmei", "cemei", "ensino", "educação", "educacional", "professor", "merenda", "transporte escolar", "fundeb", "aluno", "didat", "uniforme escolar", "biblioteca"] },
    { id: "obras",         icone: "🏗️", label: "Obras",        kw: ["obra", "pavimentacao", "asfalto", "calcada", "reform", "construcao", "drenagem", "iluminacao publica", "ponte", "viad", "praca", "predial", "infraestrutura", "saneamento", "esgoto", "água pluvial"] },
    { id: "transporte",    icone: "🚌", label: "Transporte",   kw: ["transporte", "onibus", "frota", "veiculo", "combustivel", "diesel", "gasolina", "pneu", "manutenção de veiculo", "passageiro", "linha urbana"] },
    { id: "cultura",       icone: "🎭", label: "Cultura/Eventos", kw: ["evento", "show", "festival", "carnaval", "artista", "cultura", "banda", "musica", "espetaculo", "teatro", "cinema", "exposicao", "banheiro quimico", "palco", "som", "sonorizacao", "iluminacao", "barraca"] },
    { id: "assistencia",   icone: "🤝", label: "Assistência Social", kw: ["assistencia social", "cras", "creas", "bolsa", "idoso", "vulnerab", "cesta basica", "abrigo", "acolhimento", "crianca em risco"] },
    { id: "administracao", icone: "🏛️", label: "Administração", kw: ["administracao", "papelaria", "material de expediente", "informatica", "software", "consultoria", "assessoria", "publicidade", "propaganda", "telefonia", "internet"] },
    { id: "seguranca",     icone: "🛡️", label: "Segurança",     kw: ["seguranca", "guarda municipal", "vigilancia", "monitoramento", "camera", "alarme", "policial", "patrulha"] },
  ];

  window.ZELA.categorias = CATEGORIAS;
  window.ZELA.classificarItem = function (item) {
    const txt = norm([item.objeto, item.contratado, item.beneficiario, item.modalidade, item.tipo, item.entidade].filter(Boolean).join(" "));
    for (let i = 0; i < CATEGORIAS.length; i++) {
      const cat = CATEGORIAS[i];
      if (cat.kw.some(k => txt.includes(k))) return cat.id;
    }
    return null;
  };

})();
