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
    bajo:  { label: "BAIXO", cls: "baixo", desc: "Simbólico ou administrativo" },
    baixo: { label: "BAIXO", cls: "baixo", desc: "Simbólico ou administrativo" }
  };

  // Por que o cidadão deve acompanhar — impacto prático por tema.
  var PORQUE = {
    saude:         ["Afeta o atendimento de saúde da população.", "Confira se há recurso previsto e prazo."],
    educacao:      ["Impacta escolas, creches ou estudantes.", "Veja se prevê estrutura e investimento."],
    transito:      ["Mexe com segurança no trânsito e mobilidade.", "Confira o tempo/local exato e o prazo de execução."],
    infraestrutura:["Obra ou serviço com efeito direto no bairro.", "Confira local, custo e prazo."],
    seguranca:     ["Afeta a segurança pública.", "Acompanhe viabilidade e execução."],
    meio_ambiente: ["Efeito ambiental e de saneamento.", "Confira o responsável e o prazo."],
    assistencia:   ["Atende grupos em situação de vulnerabilidade.", "Veja o público atendido e o recurso."],
    transparencia: ["Amplia o controle e o acesso à informação.", "Confira o que muda na prática."],
    tributario:    ["Mexe com tributos e finanças do município.", "Veja quem paga ou quem economiza."],
    cultura:       ["Cultura, esporte ou lazer.", "Confira público-alvo e custo."],
    geral:         ["Confira o objeto no documento oficial.", "Avalie se há impacto prático ou é simbólico."]
  };

  var TEMA_ICONS = {
    saude:          "saude",
    educacao:       "educacao",
    transito:       "transporte",
    infraestrutura: "obras",
    seguranca:      "seguranca",
    meio_ambiente:  "obras",
    assistencia:    "assistencia",
    transparencia:  "lupa",
    tributario:     "cifrao",
    cultura:        "cultura",
    geral:          "documentos"
  };

  function grauInfo(g) { return GRAUS[g] || GRAUS.baixo; }
  function porque(tema) { return PORQUE[tema] || PORQUE.geral; }
  function temaIcon(tema) { return TEMA_ICONS[tema] || TEMA_ICONS.geral; }

  function formatarDataISO(iso) {
    if (!iso) return "Data não informada";
    var p = iso.split("-");
    if (p.length === 3) {
      return p[2] + "/" + p[1] + "/" + p[0];
    }
    return iso;
  }

  function iconHelper(name, opts) {
    return (window.ZELA && window.ZELA.icon) ? window.ZELA.icon(name, opts) : "";
  }

  // esc: função de escape de HTML do app.
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
    var g = grauInfo(m.grau);
    var relevanciaClass = g.cls;
    var relevanciaText = g.label;

    var dataDisplay = formatarDataISO(m.data);
    var temaLabel = m.tema_label || "Geral";
    var temaKey = m.tema || "geral";
    var ementa = m.ementa || "Ementa não informada";

    var simbolico = m.grau === "baixo" && m.impacto_zero;
    var motivosHtml = "";
    var motivosArray = [];

    if (simbolico) {
      var motivoZero = m.motivo_impacto_zero || "moção, homenagem ou nome de rua";
      motivosArray.push("Classificada como matéria simbólica: " + motivoZero);
      motivosHtml = '<li>• Classificada como matéria simbólica: <strong>' + esc(motivoZero) + '</strong>.</li>';
    } else {
      motivosArray = porque(temaKey);
      motivosHtml = motivosArray.map(function (b) { return '<li>• ' + esc(b) + '</li>'; }).join("");
    }

    var docUrl = m.pdf || "https://sapl.varginha.mg.leg.br/";
    var tituloTexto = (m.tipo || "Matéria") + " nº " + (m.numero || "") + "/" + (m.ano || "");
    var autorTexto = m.autor || "Não informado";

    // Texto para compartilhamento no WhatsApp (sem emojis, profissional)
    var resumoZapTxt = "*PROJETO EM ANÁLISE | CÂMARA DE VARGINHA*\n\n" +
      "*Identificação:*\n" +
      "- *Matéria:* " + tituloTexto + "\n" +
      "- *Data:* " + dataDisplay + "\n" +
      "- *Autor:* " + autorTexto + "\n" +
      "- *Interesse público:* " + relevanciaText.toUpperCase() + "\n" +
      "- *Tema:* " + temaLabel + "\n\n" +
      "*O que está sendo proposto?*\n" +
      ementa + "\n\n" +
      "*Por que acompanhar?*\n" +
      motivosArray.map(function (b) { return "- " + b; }).join("\n") + "\n\n" +
      "*Consulta pública:* " + docUrl;
    var resumoWhats = encodeURIComponent(resumoZapTxt);

    return (
      '<article class="diario-whats-card materia-card" id="mat-' + esc(m.numero || "") + '-' + esc(m.ano || "") + '">' +
        '<div class="diario-whats-card__header">' +
          '<div class="diario-whats-card__title-block">' +
            '<h4 class="diario-whats-card__title" style="display:flex; align-items:center; gap:8px;">' +
              iconHelper("documentos", { size: 18 }) + ' CÂMARA DE VARGINHA · PROJETO EM ANÁLISE' +
            '</h4>' +
            '<div class="diario-whats-card__subtitle">' + esc(tituloTexto) + '</div>' +
            selo(m, esc) +
          '</div>' +
          '<span class="diario-relevancia-badge diario-relevancia-badge--' + relevanciaClass + '">' +
            esc(relevanciaText.toLowerCase()) +
          '</span>' +
        '</div>' +

        '<div class="diario-whats-card__meta-grid">' +
          '<div class="diario-whats-card__meta-item">' + iconHelper("documentos", { size: 14 }) + ' Matéria: <strong>' + esc(m.tipo || "Legislativo") + '</strong></div>' +
          '<div class="diario-whats-card__meta-item">' + iconHelper("calendario", { size: 14 }) + ' Data: <strong>' + esc(dataDisplay) + '</strong></div>' +
          '<div class="diario-whats-card__meta-item">' + iconHelper("pessoas", { size: 14 }) + ' Autor: <strong>' + esc(autorTexto) + '</strong></div>' +
          '<div class="diario-whats-card__meta-item">' + iconHelper("alerta", { size: 14 }) + ' Interesse público: <strong>' + esc(relevanciaText.toLowerCase()) + '</strong></div>' +
          '<div class="diario-whats-card__meta-item">' + iconHelper(temaIcon(temaKey), { size: 14 }) + ' Tema: <strong>' + esc(temaLabel) + '</strong></div>' +
        '</div>' +

        '<div class="diario-whats-card__section">' +
          '<div class="diario-whats-card__section-title">' + iconHelper("documentos", { size: 14 }) + ' O que está sendo proposto?</div>' +
          '<div class="diario-whats-card__resumo">' +
            esc(ementa) +
          '</div>' +
        '</div>' +

        '<div class="diario-whats-card__section">' +
          '<div class="diario-whats-card__section-title">' + iconHelper("alerta", { size: 14 }) + ' Por que acompanhar?</div>' +
          '<ul class="diario-whats-card__list">' +
            motivosHtml +
          '</ul>' +
        '</div>' +

        '<div class="diario-whats-card__section">' +
          '<div class="diario-whats-card__section-title">' + iconHelper("anexo", { size: 14 }) + ' Consulta pública</div>' +
          '<a href="' + esc(docUrl) + '" target="_blank" rel="noopener" style="font-size: 0.9rem; word-break: break-all;">' + esc(docUrl) + '</a>' +
        '</div>' +

        '<div class="diario-whats-card__actions">' +
          '<div class="diario-whats-card__buttons">' +
            '<a class="diario-whats-card__btn-zap" href="https://api.whatsapp.com/send?text=' + resumoWhats + '" target="_blank" rel="noopener">' +
              iconHelper("compartilhar", { size: 14 }) + ' Compartilhar resumo' +
            '</a>' +
            (m.pdf ? 
              '<a class="diario-whats-card__btn-link" href="' + esc(m.pdf) + '" target="_blank" rel="noopener">' +
                iconHelper("documentos", { size: 14 }) + ' Abrir PDF original' +
              '</a>' : ''
            ) +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  window.ZELA.materiaGrau = grauInfo;
  window.ZELA.materiaPorque = porque;
  window.ZELA.materiaSelo = selo;
  window.ZELA.materiaCard = card;
})();
