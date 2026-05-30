/* Fiscaliza Varginha — tradução cidadã de matérias legislativas.
 *
 * Recebe uma matéria já classificada pelo coletor (campos tema, tema_label,
 * grau) e devolve os pedaços de UI que "traduzem" o juridiquês:
 *   - selo de grau (ALTO / MÉDIO / BAIXO)
 *   - chip de tema (Saúde, Educação, Trânsito…)
 *   - bullets de "Por que acompanhar" (impacto prático por tema)
 *
 * Sem dado novo: só apresentação. A regra de classificação está no coletor
 * (classificador_materia.py) e documentada no /sobre.
 */
(function () {
  "use strict";
  window.ZELA = window.ZELA || {};

  var GRAUS = {
    alto:  { label: "ALTO",  cls: "alto",  desc: "Projeto de lei com tema estruturante" },
    medio: { label: "MÉDIO", cls: "medio", desc: "Pedido prático ou lei de tema geral" },
    baixo: { label: "BAIXO", cls: "baixo", desc: "Simbólico ou administrativo" }
  };

  // Por que o cidadão deve acompanhar — impacto prático por tema.
  var PORQUE = {
    saude:         ["Afeta o atendimento de saúde da população.", "Confira se há recurso previsto e prazo."],
    educacao:      ["Impacta escolas, creches ou estudantes.", "Veja se prevê estrutura e investimento."],
    transito:      ["Mexe com segurança no trânsito e mobilidade.", "Confira o local exato e o prazo de execução."],
    infraestrutura:["Obra ou serviço com efeito direto no bairro.", "Confira local, custo e prazo."],
    seguranca:     ["Afeta a segurança pública.", "Acompanhe viabilidade e execução."],
    meio_ambiente: ["Efeito ambiental e de saneamento.", "Confira o responsável e o prazo."],
    assistencia:   ["Atende grupos em situação de vulnerabilidade.", "Veja o público atendido e o recurso."],
    transparencia: ["Amplia o controle e o acesso à informação.", "Confira o que muda na prática."],
    tributario:    ["Mexe com tributos e finanças do município.", "Veja quem paga ou quem economiza."],
    cultura:       ["Cultura, esporte ou lazer.", "Confira público-alvo e custo."],
    geral:         ["Confira o objeto no documento oficial.", "Avalie se há impacto prático ou é simbólico."]
  };

  function grauInfo(g) { return GRAUS[g] || GRAUS.baixo; }
  function porque(tema) { return PORQUE[tema] || PORQUE.geral; }

  // esc: função de escape de HTML do app (passada como argumento p/ evitar dependência de ordem).
  function selo(m, esc) {
    var g = grauInfo(m.grau);
    var chips =
      '<span class="mat-selo mat-selo--' + g.cls + '" title="' + esc(g.desc) + '">' + g.label + "</span>";
    if (m.tema_label) {
      chips += '<span class="mat-tema">' + esc(m.tema_label) + "</span>";
    }
    return '<div class="mat-selos">' + chips + "</div>";
  }

  // Card cidadão completo de uma matéria (usado no perfil e no resumo semanal).
  function card(m, esc) {
    var simbolico = m.grau === "baixo" && m.impacto_zero;
    var motivos = simbolico
      ? '<p class="mat-simbolico">Classificada como simbólica: ' +
        esc(m.motivo_impacto_zero || "moção, homenagem ou nome de rua") + ".</p>"
      : '<div class="mat-porque"><strong>Por que acompanhar</strong><ul>' +
        porque(m.tema).map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") +
        "</ul></div>";
    var doc = m.pdf
      ? '<a class="mat-doc" href="' + esc(m.pdf) + '" target="_blank" rel="noopener">' +
        (window.ZELA.icon ? window.ZELA.icon("documentos", { size: 13 }) : "") +
        " Ver documento oficial</a>"
      : "";
    return (
      '<article class="mat-card">' +
      selo(m, esc) +
      "<strong>" + esc(m.tipo || "") + " nº " + esc(m.numero || "") + "/" + esc(m.ano || "") + "</strong>" +
      '<p class="mat-ementa">' + esc(m.ementa || "Ementa não informada") + "</p>" +
      motivos +
      doc +
      "</article>"
    );
  }

  window.ZELA.materiaGrau = grauInfo;
  window.ZELA.materiaPorque = porque;
  window.ZELA.materiaSelo = selo;
  window.ZELA.materiaCard = card;
})();
