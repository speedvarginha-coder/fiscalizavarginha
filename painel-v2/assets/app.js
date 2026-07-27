/* Dinheiro de Varginha — painel v2
 *
 * Camada de apresentação nova. NÃO coleta dado e NÃO escreve nada:
 * lê os mesmos chunks JSON que o painel-cidadao já gera.
 * Trocar DATA_BASE é a única coisa necessária para publicar em outro lugar.
 */
(function () {
  "use strict";

  var DATA_BASE = "../painel-cidadao/data/chunks";

  var PORTAL_PREF   = "https://varginha.mg.gov.br/transparencia";
  var PORTAL_CAMARA = "https://www.camaravarginha.mg.gov.br";

  // ================= estado =================

  var dados = {};
  var carregando = {};

  function chunk(nome) {
    if (dados[nome] !== undefined) return Promise.resolve(dados[nome]);
    if (carregando[nome]) return carregando[nome];

    carregando[nome] = fetch(DATA_BASE + "/" + nome + ".json")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " em " + nome);
        return r.json();
      })
      .then(function (json) { dados[nome] = json; return json; })
      .catch(function (e) { dados[nome] = null; throw e; })
      .finally(function () { delete carregando[nome]; });

    return carregando[nome];
  }

  // ================= formatação =================

  var brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  var brlCurto = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  var inteiro = new Intl.NumberFormat("pt-BR");

  function moeda(v) {
    if (v === null || v === undefined || isNaN(v)) return "sem valor informado";
    return brl.format(v);
  }

  function num(v) { return inteiro.format(v || 0); }

  function dataBr(iso) {
    if (!iso) return "";
    var p = String(iso).slice(0, 10).split("-");
    if (p.length !== 3) return iso;
    return p[2] + "/" + p[1] + "/" + p[0];
  }

  /* Quebra o valor da manchete em "R$" + número, para o número receber
     o peso tipográfico sozinho. */
  function manchete(v) {
    return '<span class="numerao__moeda">R$</span>' + brlCurto.format(Math.round(v || 0));
  }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* A fonte grava vínculo com sufixo interno do sistema ("Agente Político |1").
     Isso é ruído de banco, não informação para o cidadão. */
  function vinculoLimpo(v) {
    return String(v || "").replace(/\s*\|\s*\d+\s*$/, "").trim() || "não informado";
  }

  function titulo(s) {
    s = String(s || "").toLowerCase().trim();
    return s.replace(/(^|\s|\/|-)([a-zà-ú])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }

  function normal(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  // ================= helpers de tela =================

  var view = document.getElementById("view");

  function pinta(html) {
    view.innerHTML = html;
    view.classList.remove("anima");
    void view.offsetWidth;
    view.classList.add("anima");
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  function carregandoTela(msg) {
    return '<div class="carregando"><span class="carregando__barra"></span>' + esc(msg) + "</div>";
  }

  function erroTela(msg) {
    return '<div class="secao"><div class="erro"><strong>Não deu para carregar este dado.</strong><br>' +
      esc(msg) + '<br><br>Se você abriu o arquivo com clique duplo, o navegador bloqueia a leitura dos dados. ' +
      'Rode um servidor local a partir da pasta do projeto e abra pelo endereço http.</div></div>';
  }

  function vazio(msg) {
    return '<div class="vazio">' + esc(msg) + "</div>";
  }

  function fonte(texto, url) {
    return '<p class="fonte">Fonte: ' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(texto) + "</a>" : esc(texto)) + "</p>";
  }

  function bloco(tit, fonteHtml, corpo) {
    return '<section class="bloco">' +
      '<div class="bloco__cab"><h2 class="bloco__tit">' + tit + "</h2>" + (fonteHtml || "") + "</div>" +
      corpo + "</section>";
  }

  // ================= regras de negócio =================

  /* A folha vem em LINHAS, não em pessoas: a mesma pessoa aparece uma vez por
     competência (na Câmara, 388 linhas para 71 pessoas). Somar tudo dá o custo
     de sete meses, não de um mês, e contar linhas infla o número de servidores.
     Aqui a folha é reduzida a uma linha por pessoa, na competência mais recente
     em que ela aparece, e cada valor carrega a competência da própria linha. */
  function ordemComp(c) {
    var m = /^(\d{2})\/(\d{4})$/.exec(String(c || ""));
    return m ? m[2] + m[1] : "";
  }

  /* Mesma regra do coletor (coletor_pessoal._competencia_referencia): filtrar a
     competência PRIMEIRO, depois contar. Filtrar depois de deduplicar descartava
     quem já tinha lançamento no mês parcial e subestimava a folha. */
  function folhaPorPessoa(org) {
    var linhas = (org && org.servidores) || [];

    var contagem = {};
    linhas.forEach(function (s) {
      if (s.competencia) contagem[s.competencia] = (contagem[s.competencia] || 0) + 1;
    });

    var comps = Object.keys(contagem);
    var referencia = null, parcial = null;

    if (comps.length) {
      var maior = Math.max.apply(null, comps.map(function (c) { return contagem[c]; }));
      var completas = comps.filter(function (c) { return contagem[c] >= 0.8 * maior; });
      referencia = completas.sort(function (a, b) { return ordemComp(a).localeCompare(ordemComp(b)); }).pop();
      var recente = comps.slice().sort(function (a, b) { return ordemComp(a).localeCompare(ordemComp(b)); }).pop();
      if (recente !== referencia) parcial = { competencia: recente, pessoas: contagem[recente] };
    }

    // Sem competência na linha (Prefeitura) a folha já é de um mês só, e cada
    // linha é um vínculo: somar as linhas é o correto.
    var naReferencia = referencia
      ? linhas.filter(function (s) { return s.competencia === referencia; })
      : linhas.slice();

    var chaves = {};
    naReferencia.forEach(function (s) { chaves[(s.matricula || "") + "|" + normal(s.nome)] = 1; });

    return {
      pessoas: naReferencia,
      naReferencia: naReferencia,
      referencia: referencia || org.competencia || "não informada",
      parcial: parcial,
      totalPessoas: Object.keys(chaves).length,
      totalLinhas: linhas.length,
      folhaBruta: naReferencia.reduce(function (s, p) { return s + (p.vencimentos || 0); }, 0),
      comissionados: naReferencia.filter(function (p) { return p.comissionado_ou_similar; }).length
    };
  }

  /* Um vereador não é qualquer pessoa lotada na Câmara: assessor também está lá.
     Regra: lotação fala em vereador E o bruto chega perto do subsídio legal. */
  function ehVereador(servidor, subsidioLegal) {
    var lot = normal(servidor.lotacao) + " " + normal(servidor.cargo);
    if (lot.indexOf("vereador") === -1) return false;
    if (!subsidioLegal) return true;
    return (servidor.vencimentos || 0) >= subsidioLegal * 0.7;
  }

  /* Obra atrasada: prometeram entregar, a data passou e não há conclusão efetiva. */
  function atrasada(obra) {
    if (obra.data_efetiva_conclusao) return false;
    if (!obra.data_prevista_conclusao) return false;
    if (String(obra.situacao || "").toLowerCase().indexOf("conclu") === 0) return false;
    return obra.data_prevista_conclusao < new Date().toISOString().slice(0, 10);
  }

  /* A fonte tem datas digitadas errado (vimos "2102" no lugar de "2025").
     Uma data impossível não pode mandar o registro para o topo da lista,
     e também não pode ser escondida: vira aviso na própria ficha. */
  function dataPlausivel(iso) {
    if (!iso) return false;
    var ano = parseInt(String(iso).slice(0, 4), 10);
    if (isNaN(ano)) return false;
    return ano >= 2000 && ano <= new Date().getFullYear() + 1;
  }

  function diasDeAtraso(obra) {
    var prev = new Date(obra.data_prevista_conclusao + "T00:00:00");
    return Math.floor((Date.now() - prev.getTime()) / 86400000);
  }

  // ================= tarja de atualização =================

  function tarja() {
    Promise.all([chunk("atualizado_em").catch(function () { return null; }),
                 chunk("auditoria_dados").catch(function () { return null; })])
      .then(function (r) {
        var at = r[0], aud = r[1];
        var el = document.getElementById("tarja");
        var pe = document.getElementById("rodapeAtualizacao");

        if (at && at.data_humana && pe) {
          pe.textContent = "Dados coletados automaticamente das fontes oficiais. Última atualização: " + at.data_humana + ".";
        }
        if (aud && aud.summary && el) {
          var avisos = (aud.issues || []).filter(function (i) {
            return String(i.level || i.nivel || "").toLowerCase() !== "info";
          });
          if (avisos.length) {
            el.hidden = false;
            el.innerHTML = '<div class="wrap"><strong>Atenção</strong><span>' +
              esc(avisos.length === 1 ? avisos[0].message || avisos[0].mensagem || "Uma fonte está com pendência de qualidade."
                                      : avisos.length + " fontes estão com pendência de qualidade nesta coleta. Confira na fonte primária antes de divulgar.") +
              "</span></div>";
          }
        }
      });
  }

  // ================= tela: início =================

  function telaInicio() {
    pinta(carregandoTela("Carregando os números de Varginha"));

    Promise.all([chunk("prefeitura"), chunk("camara_betha"), chunk("atualizado_em")])
      .then(function (r) {
        var pref = r[0], cam = r[1], at = r[2];
        var ano = pref.ano_atual;
        var total = (pref.total_externo_atual || 0) + (cam.total_externo_atual || 0);

        var html = "";

        html += '<section class="capa">' +
          '<p class="capa__olho">Varginha, ' + ano + "</p>" +
          '<p class="numerao">' + manchete(total) + "</p>" +
          '<p class="capa__frase">é o que a Prefeitura e a Câmara já pagaram a empresas e fornecedores neste ano.</p>' +
          '<p class="capa__nota">Valor de empenhos pagos a terceiros. Não inclui a folha de salários, que aparece na seção ' +
          '<a href="#/salarios">Quanto ganha cada um</a>.' +
          (at && at.data_humana ? " Atualizado em " + esc(at.data_humana) + "." : "") + "</p>" +

          '<div class="capa__par">' +
            mini("Prefeitura, " + ano, moeda(pref.total_externo_atual),
                 num(pref.credores_qtd) + " credores listados na base deste ano") +
            mini("Câmara, " + ano, moeda(cam.total_externo_atual),
                 num(cam.empenhos_qtd || 0) + " empenhos registrados") +
            mini("No ano passado (" + pref.ano_anterior + ")", moeda(pref.total_externo_anterior),
                 "só da Prefeitura, ano fechado") +
          "</div></section>";

        html += '<section class="secao">' +
          '<h2 class="secao__titulo">O que você quer saber?</h2>' +
          '<p class="secao__linha">Cinco perguntas respondem quase tudo que uma pessoa procura aqui. ' +
          "Clique na sua.</p>" +
          '<div class="perguntas">' +
            pergunta("01", "Quanto ganha o pessoal da Prefeitura e da Câmara?",
                     "Salário de cada servidor, por nome, com o mês de referência e o tipo de vínculo.", "#/salarios") +
            pergunta("02", "Para onde vai o dinheiro?",
                     "As empresas que mais receberam, os contratos abertos e as licitações em andamento.", "#/dinheiro") +
            pergunta("03", "Que obras estão paradas ou atrasadas?",
                     "As obras da cidade, com data prometida e situação real.", "#/obras") +
            pergunta("04", "Quem viajou com dinheiro público?",
                     "Diárias pagas, para quem, para onde e por quê.", "#/viagens") +
            pergunta("05", "Como eu cobro uma resposta?",
                     "O caminho para pedir informação e obrigar o poder público a responder.", "#/cobrar") +
          "</div></section>";

        pinta(html);
      })
      .catch(function (e) { pinta(erroTela(e.message)); });
  }

  function mini(rot, val, pe) {
    return '<div><p class="mini__rot">' + esc(rot) + '</p><p class="mini__val">' + val +
      '</p><p class="mini__pe">' + esc(pe) + "</p></div>";
  }

  function pergunta(n, q, d, href) {
    return '<a class="pergunta" href="' + href + '">' +
      '<span class="pergunta__num">' + n + "</span>" +
      '<h3 class="pergunta__q">' + esc(q) + "</h3>" +
      '<p class="pergunta__d">' + esc(d) + "</p>" +
      '<span class="pergunta__seta">Ver &rarr;</span></a>';
  }

  // ================= tela: salários =================

  var salState = { orgao: "camara", termo: "", limite: 40 };

  function telaSalarios() {
    pinta(carregandoTela("Carregando a folha de pagamento. É um arquivo grande."));

    Promise.all([chunk("pessoal"), chunk("remuneracao_vereadores").catch(function () { return null; })])
      .then(function (r) { renderSalarios(r[0], r[1]); })
      .catch(function (e) { pinta(erroTela(e.message)); });
  }

  function renderSalarios(pessoal, remV) {
    var org = pessoal[salState.orgao] || {};
    var folha = folhaPorPessoa(org);
    var lista = folha.pessoas;
    var comp = folha.referencia;
    var subsidio = remV && remV.subsidio_bruto_mensal_brl;

    var html = "";

    html += '<section class="secao" style="border-top:0">' +
      '<h1 class="secao__titulo">Quanto ganha cada um</h1>' +
      '<p class="secao__linha">Busque pelo nome. O valor mostrado é o <b>bruto</b>, antes dos descontos. ' +
      "Todo salário aqui vem com o mês de referência e o tipo de vínculo, porque sem isso o número engana.</p>";

    html += '<div class="explica">' +
      "<p><strong>Bruto não é o que cai na conta.</strong> Do bruto saem INSS, imposto de renda e outros descontos. " +
      "O líquido também aparece em cada ficha.</p>" +
      "<p><strong>Efetivo, comissionado e contrato são coisas diferentes.</strong> Efetivo passou em concurso. " +
      "Comissionado foi nomeado e pode ser exonerado a qualquer momento. Contrato é temporário.</p>" +
      "</div>";

    html += '<div class="controles">' +
      '<button class="pilula" data-org="camara" aria-pressed="' + (salState.orgao === "camara") + '">Câmara</button>' +
      '<button class="pilula" data-org="prefeitura" aria-pressed="' + (salState.orgao === "prefeitura") + '">Prefeitura</button>' +
      '<input type="search" id="buscaSal" placeholder="Digite um nome ou um cargo" value="' + esc(salState.termo) + '">' +
      "</div>";

    // vereadores em destaque, quando o órgão é a Câmara
    if (salState.orgao === "camara" && subsidio) {
      var vers = folha.naReferencia.filter(function (s) { return ehVereador(s, subsidio); })
                      .sort(function (a, b) { return (b.vencimentos || 0) - (a.vencimentos || 0); });

      var corpoV = vers.length
        ? vers.map(function (s) { return fichaServidor(s, org.escopo, subsidio); }).join("")
        : vazio("Nenhum vereador identificado na folha desta competência.");

      html += bloco("Os vereadores",
        fonte(((remV.lei && remV.lei.numero) || "Lei de fixação do subsídio") + " e folha nominal da Câmara",
              remV.lei && remV.lei.url),
        '<div class="explica"><p>O subsídio de vereador é fixado em lei: <strong>' + moeda(subsidio) +
        "</strong> por mês. Não é salário negociado, é valor definido por lei.</p>" +
        "<p><strong>Por que o bruto abaixo costuma ser maior que o subsídio?</strong> " +
        "A folha de um mês pode somar ao subsídio outras verbas devidas no período, como décimo terceiro, " +
        "férias e diferenças retroativas. Bruto maior não significa, por si só, pagamento irregular. " +
        "Significa que vale perguntar à Câmara qual verba compôs a diferença.</p></div>" + corpoV);
    }

    // resumo do órgão
    html += bloco("A folha inteira",
      fonte(org.fonte || "Portal da transparência, folha nominal",
            salState.orgao === "camara" ? PORTAL_CAMARA : PORTAL_PREF),
      '<div class="capa__par" style="margin-top:0;border-top:0;padding-top:0">' +
        mini("Pessoas na folha", num(folha.naReferencia.length), "na competência " + esc(comp)) +
        mini("Custo desta competência", moeda(folha.folhaBruta), "soma dos brutos de " + esc(comp)) +
        mini("Comissionados", num(folha.comissionados), "cargo de livre nomeação") +
      "</div>" +
      '<div class="explica"><p>A fonte publica uma linha por pessoa <strong>por mês</strong>. ' +
      "São " + num(folha.totalLinhas) + " lançamentos no total, dos quais " + num(folha.naReferencia.length) +
      " são da competência <strong>" + esc(comp) + "</strong>, cobrindo " + num(folha.totalPessoas) +
      " pessoas. Somar tudo daria o custo de vários meses, não de um.</p>" +
      (folha.parcial
        ? "<p>A competência <strong>" + esc(folha.parcial.competencia) + "</strong> já tem lançamento, mas só para " +
          num(folha.parcial.pessoas) + " pessoas. Folha incompleta não serve de referência, então o painel " +
          "continua em " + esc(comp) + " até a fonte publicar o mês inteiro.</p>"
        : "") +
      "</div>");

    // lista filtrada
    var termo = normal(salState.termo);
    var filtrada = termo
      ? lista.filter(function (s) { return normal(s.nome).indexOf(termo) > -1 || normal(s.cargo).indexOf(termo) > -1; })
      : lista.slice().sort(function (a, b) { return (b.vencimentos || 0) - (a.vencimentos || 0); });

    var mostra = filtrada.slice(0, salState.limite);

    var corpo = mostra.length
      ? mostra.map(function (s) { return fichaServidor(s, org.escopo); }).join("") +
        (filtrada.length > mostra.length
          ? '<button class="mais" id="maisSal">Mostrar mais (' + num(filtrada.length - mostra.length) + " restantes)</button>"
          : "")
      : vazio('Ninguém encontrado com "' + esc(salState.termo) + '". Tente só o primeiro nome.');

    html += bloco(termo ? "Resultado da busca" : "Maiores salários do mês",
      '<p class="fonte">' + num(filtrada.length) + " pessoas" + (termo ? " encontradas" : "") + "</p>",
      corpo);

    html += "</section>";
    pinta(html);

    // eventos
    view.querySelectorAll(".pilula[data-org]").forEach(function (b) {
      b.addEventListener("click", function () {
        salState.orgao = b.dataset.org;
        salState.limite = 40;
        renderSalarios(pessoal, remV);
      });
    });

    var inp = document.getElementById("buscaSal");
    if (inp) {
      var t;
      inp.addEventListener("input", function () {
        clearTimeout(t);
        t = setTimeout(function () {
          salState.termo = inp.value;
          salState.limite = 40;
          renderSalarios(pessoal, remV);
          var novo = document.getElementById("buscaSal");
          if (novo) { novo.focus(); novo.setSelectionRange(novo.value.length, novo.value.length); }
        }, 260);
      });
    }

    var btn = document.getElementById("maisSal");
    if (btn) btn.addEventListener("click", function () { salState.limite += 60; renderSalarios(pessoal, remV); });
  }

  /* A competência vem da própria linha, nunca do órgão: rotular um valor de
     junho como se fosse de julho é o erro mais fácil de cometer aqui. */
  function fichaServidor(s, escopo, subsidioLegal) {
    var competencia = s.competencia || "não informada";
    var vinculo = vinculoLimpo(s.vinculo);
    var selo = s.comissionado_ou_similar
      ? ' <span class="selo selo--aviso">comissionado</span>'
      : "";

    /* Quando há subsídio legal de referência, mostrar a diferença é mais honesto
       do que só exibir o bruto: o cidadão vê o quanto passou e por quanto. */
    var comparacao = "";
    if (subsidioLegal && (s.vencimentos || 0) > subsidioLegal) {
      var dif = s.vencimentos - subsidioLegal;
      comparacao = '<p class="ficha__meta">Acima do subsídio fixado em lei em <b>' + moeda(dif) +
        "</b> nesta competência. Verba que compõe a diferença: não informada na fonte.</p>";
    }

    return '<article class="ficha">' +
      '<div class="ficha__topo">' +
        '<p class="ficha__nome">' + esc(titulo(s.nome)) + selo + "</p>" +
        '<span class="ficha__valor">' + moeda(s.vencimentos) + "</span>" +
      "</div>" +
      '<p class="ficha__meta">' + esc(titulo(s.cargo)) + "</p>" +
      '<p class="ficha__meta">Bruto de <b>' + esc(competencia) + "</b>. " +
        "Líquido: <b>" + moeda(s.liquido) + "</b>. " +
        "Vínculo: <b>" + esc(vinculo) + "</b>." +
        (escopo ? " " + esc(escopo) + "." : "") +
      "</p>" + comparacao + "</article>";
  }

  // ================= tela: para onde vai o dinheiro =================

  var dinState = { orgao: "prefeitura", limite: 20 };

  function telaDinheiro() {
    pinta(carregandoTela("Carregando fornecedores, contratos e licitações"));

    Promise.all([chunk("prefeitura"), chunk("camara_betha")])
      .then(function (r) { renderDinheiro(r[0], r[1]); })
      .catch(function (e) { pinta(erroTela(e.message)); });
  }

  function renderDinheiro(pref, cam) {
    var org = dinState.orgao === "prefeitura" ? pref : cam;
    var nomeOrg = dinState.orgao === "prefeitura" ? "Prefeitura" : "Câmara";
    var forn = org.top_fornecedores_atual || [];

    var html = '<section class="secao" style="border-top:0">' +
      '<h1 class="secao__titulo">Para onde vai o dinheiro</h1>' +
      '<p class="secao__linha">Quem recebeu, quanto, e o que está contratado agora. ' +
      "Aparecer aqui não significa irregularidade: significa que houve pagamento público.</p>" +

      '<div class="controles">' +
        '<button class="pilula" data-din="prefeitura" aria-pressed="' + (dinState.orgao === "prefeitura") + '">Prefeitura</button>' +
        '<button class="pilula" data-din="camara" aria-pressed="' + (dinState.orgao === "camara") + '">Câmara</button>' +
      "</div>";

    // fornecedores
    var maior = forn.length ? (forn[0].valor_total || 0) : 0;
    var listaF = forn.slice(0, dinState.limite).map(function (f, i) {
      var pct = maior ? Math.round((f.valor_total / maior) * 100) : 0;
      return '<article class="ficha">' +
        '<div class="ficha__topo">' +
          '<p class="ficha__nome">' + (i + 1) + ". " + esc(titulo(f.nome)) + "</p>" +
          '<span class="ficha__valor">' + moeda(f.valor_total) + "</span>" +
        "</div>" +
        /* A fonte agrega por credor e não expõe a contagem real de pagamentos.
           Melhor não afirmar quantidade do que afirmar errado. */
        '<p class="ficha__meta">Total consolidado em ' + esc(org.ano_atual) +
          (f.cnpj ? " · CNPJ " + esc(f.cnpj) : "") + "</p>" +
        '<div style="height:4px;background:var(--regra-fina);margin-top:.6rem">' +
          '<div style="height:100%;width:' + pct + '%;background:var(--vermelho)"></div></div>' +
        "</article>";
    }).join("");

    html += bloco("Quem mais recebeu da " + nomeOrg + " em " + org.ano_atual,
      fonte("Portal Betha, empenhos pagos", dinState.orgao === "prefeitura" ? PORTAL_PREF : PORTAL_CAMARA),
      listaF || vazio("Sem fornecedores registrados nesta base."));

    // licitações em andamento
    var licit = (org.licit_andamento || org.licitacoes || []).slice(0, 12);
    var listaL = licit.map(function (l) {
      return '<article class="ficha">' +
        '<div class="ficha__topo">' +
          '<p class="ficha__nome">' + esc(l.modalidade || "Licitação") + " nº " + esc(l.numero) + "</p>" +
          '<span class="ficha__valor">' + moeda(l.valor) + "</span>" +
        "</div>" +
        '<p class="ficha__meta">' + esc(l.objeto) + "</p>" +
        '<p class="ficha__meta">Publicada em <b>' + esc(dataBr(l.data)) + "</b>. Situação: <b>" +
          esc(String(l.situacao || "").toLowerCase()) + "</b>.</p>" +
        "</article>";
    }).join("");

    html += bloco("Compras em andamento",
      '<p class="fonte">O que a ' + nomeOrg + " está comprando agora</p>",
      listaL || vazio("Nenhuma licitação em andamento nesta base."));

    // contratos vigentes de maior valor
    var contratos = (org.contratos || [])
      .filter(function (c) { return String(c.situacao).toUpperCase() === "EXECUCAO"; })
      .sort(function (a, b) { return (b.valor || 0) - (a.valor || 0); })
      .slice(0, 12);

    var listaC = contratos.map(function (c) {
      return '<article class="ficha">' +
        '<div class="ficha__topo">' +
          '<p class="ficha__nome">' + esc(titulo(c.contratado)) + "</p>" +
          '<span class="ficha__valor">' + moeda(c.valor) + "</span>" +
        "</div>" +
        '<p class="ficha__meta">' + esc(c.objeto) + "</p>" +
        '<p class="ficha__meta">Contrato ' + esc(c.numero) + "/" + esc(c.ano) +
          ". Assinado em <b>" + esc(dataBr(c.data_assinatura)) + "</b>" +
          (c.data_fim ? ", vence em <b>" + esc(dataBr(c.data_fim)) + "</b>" : "") + ". " +
          (c.cnpj ? "CNPJ " + esc(c.cnpj) + "." : "") + "</p>" +
        "</article>";
    }).join("");

    html += bloco("Maiores contratos em execução",
      '<p class="fonte">' + num((org.contratos || []).filter(function (c) {
        return String(c.situacao).toUpperCase() === "EXECUCAO"; }).length) + " contratos vigentes no total</p>",
      listaC || vazio("Nenhum contrato em execução nesta base."));

    html += "</section>";
    pinta(html);

    view.querySelectorAll(".pilula[data-din]").forEach(function (b) {
      b.addEventListener("click", function () {
        dinState.orgao = b.dataset.din;
        renderDinheiro(pref, cam);
      });
    });
  }

  // ================= tela: obras =================

  var obraState = { filtro: "atencao" };

  function telaObras() {
    pinta(carregandoTela("Carregando as obras da cidade"));
    chunk("prefeitura").then(renderObras).catch(function (e) { pinta(erroTela(e.message)); });
  }

  function renderObras(pref) {
    var todas = pref.obras_publicas || [];

    var paradas  = todas.filter(function (o) { return /paralis|cancel/i.test(o.situacao || ""); });
    var atrasadas = todas.filter(atrasada);
    var andamento = todas.filter(function (o) { return /andamento/i.test(o.situacao || "") && !atrasada(o); });
    var concluidas = todas.filter(function (o) { return /conclu/i.test(o.situacao || ""); });

    var atencao = paradas.concat(atrasadas.filter(function (o) { return paradas.indexOf(o) === -1; }));

    var mapa = { atencao: atencao, andamento: andamento, concluidas: concluidas, todas: todas };
    var lista = mapa[obraState.filtro] || atencao;

    var html = '<section class="secao" style="border-top:0">' +
      '<h1 class="secao__titulo">Obras</h1>' +
      '<p class="secao__linha">Toda obra tem uma data prometida. Quando essa data passa e a obra não foi entregue, ' +
      "ela aparece como atrasada aqui, mesmo que a Prefeitura ainda a classifique como em andamento.</p>";

    html += '<div class="capa__par" style="margin-top:0;border-top:0;padding-top:0;margin-bottom:1.6rem">' +
      mini("Precisam de atenção", num(atencao.length), "paradas, canceladas ou fora do prazo") +
      mini("Em andamento no prazo", num(andamento.length), "data prometida ainda não venceu") +
      mini("Concluídas", num(concluidas.length), "obra entregue") +
      "</div>";

    html += '<div class="controles">' +
      pil("atencao", "Precisam de atenção") + pil("andamento", "Em andamento") +
      pil("concluidas", "Concluídas") + pil("todas", "Todas") +
      "</div>";

    var corpo = lista.length ? lista.slice()
      .sort(function (a, b) { return (b.data_prevista_conclusao || "").localeCompare(a.data_prevista_conclusao || ""); })
      .map(fichaObra).join("") : vazio("Nenhuma obra nesta situação.");

    html += bloco(num(lista.length) + " obras",
      fonte("Portal Betha, módulo de obras públicas", PORTAL_PREF), corpo);

    html += "</section>";
    pinta(html);

    view.querySelectorAll(".pilula[data-obra]").forEach(function (b) {
      b.addEventListener("click", function () { obraState.filtro = b.dataset.obra; renderObras(pref); });
    });
  }

  function pil(v, rot) {
    return '<button class="pilula" data-obra="' + v + '" aria-pressed="' + (obraState.filtro === v) + '">' + rot + "</button>";
  }

  function fichaObra(o) {
    var atr = atrasada(o);
    var selo = atr
      ? '<span class="selo selo--alerta">atrasada ' + num(diasDeAtraso(o)) + " dias</span>"
      : /paralis/i.test(o.situacao) ? '<span class="selo selo--alerta">paralisada</span>'
      : /cancel/i.test(o.situacao)  ? '<span class="selo selo--neutro">cancelada</span>'
      : /conclu/i.test(o.situacao)  ? '<span class="selo selo--ok">concluída</span>'
      : '<span class="selo selo--aviso">em andamento</span>';

    return '<article class="ficha' + (atr || /paralis/i.test(o.situacao) ? " ficha--destaque" : "") + '">' +
      '<div class="ficha__topo">' +
        '<p class="ficha__nome">' + esc(o.objeto || o.categoria || "Obra sem descrição") + " " + selo + "</p>" +
      "</div>" +
      '<p class="ficha__meta">' + esc(o.tipo_obra || "") +
        (o.fornecedor ? " · Executada por <b>" + esc(titulo(o.fornecedor)) + "</b>" : "") + "</p>" +
      '<p class="ficha__meta">' +
        (o.data_inicio ? "Começou em <b>" + esc(dataBr(o.data_inicio)) + "</b>. " : "") +
        (o.data_prevista_conclusao ? "Prometida para <b>" + esc(dataBr(o.data_prevista_conclusao)) + "</b>. " : "") +
        (o.data_efetiva_conclusao ? "Entregue em <b>" + esc(dataBr(o.data_efetiva_conclusao)) + "</b>. " : "") +
        (o.data_ultima_medicao ? "Última medição em <b>" + esc(dataBr(o.data_ultima_medicao)) + "</b>." : "") +
      "</p></article>";
  }

  // ================= tela: viagens =================

  var viaState = { orgao: "camara", limite: 30 };

  function telaViagens() {
    pinta(carregandoTela("Carregando as diárias. É o arquivo mais pesado do painel."));
    chunk("diarias").then(renderViagens).catch(function (e) { pinta(erroTela(e.message)); });
  }

  function renderViagens(d) {
    var lista = (d[viaState.orgao] || []).slice()
      .sort(function (a, b) {
        var ka = dataPlausivel(a.data_inicial) ? a.data_inicial : "";
        var kb = dataPlausivel(b.data_inicial) ? b.data_inicial : "";
        return kb.localeCompare(ka);
      });
    var res = (d.resumo && d.resumo[viaState.orgao]) || {};
    var nomeOrg = viaState.orgao === "camara" ? "Câmara" : "Prefeitura";

    var html = '<section class="secao" style="border-top:0">' +
      '<h1 class="secao__titulo">Viagens pagas com dinheiro público</h1>' +
      '<p class="secao__linha">Diária é o valor pago para servidor ou vereador cobrir gastos fora da cidade. ' +
      "É legal, e é público. O que dá para conferir é se o destino e o motivo fazem sentido.</p>";

    html += '<div class="controles">' +
      '<button class="pilula" data-via="camara" aria-pressed="' + (viaState.orgao === "camara") + '">Câmara</button>' +
      '<button class="pilula" data-via="prefeitura" aria-pressed="' + (viaState.orgao === "prefeitura") + '">Prefeitura</button>' +
      "</div>";

    html += '<div class="capa__par" style="margin-top:0;border-top:0;padding-top:0;margin-bottom:1.6rem">' +
      mini("Total pago pela " + nomeOrg, moeda(res.valor_total), "em " + (d.anos || []).join(" e ")) +
      mini("Viagens registradas", num(res.registros), "cada uma com destino e motivo") +
      mini("Pessoas diferentes", num(res.servidores), "receberam ao menos uma diária") +
      "</div>";

    var mostra = lista.slice(0, viaState.limite);
    var corpo = mostra.map(function (v) {
      var dataRuim = !dataPlausivel(v.data_inicial) || !dataPlausivel(v.data_final);
      return '<article class="ficha' + (dataRuim ? " ficha--destaque" : "") + '">' +
        '<div class="ficha__topo">' +
          '<p class="ficha__nome">' + esc(titulo(v.funcionario)) +
            (dataRuim ? ' <span class="selo selo--alerta">data errada na fonte</span>' : "") + "</p>" +
          '<span class="ficha__valor">' + moeda(v.valor_total) + "</span>" +
        "</div>" +
        '<p class="ficha__meta">' + esc(titulo(v.cargo || "")) + "</p>" +
        '<p class="ficha__meta">Destino: <b>' + esc(v.destino || "não informado") + "</b>. " +
          "De <b>" + esc(dataBr(v.data_inicial)) + "</b> a <b>" + esc(dataBr(v.data_final)) + "</b>. " +
          num(v.quantidade) + " diária(s) de " + moeda(v.valor_unitario) + ".</p>" +
        (dataRuim ? '<p class="ficha__meta">O portal oficial publicou esta viagem com data impossível. ' +
                    "O valor está correto, a data não. Vale pedir correção por e-SIC.</p>" : "") +
        (v.finalidade || v.origem ? '<p class="ficha__meta">Motivo: ' + esc(v.finalidade || v.origem) + "</p>" : "") +
        "</article>";
    }).join("");

    if (lista.length > mostra.length) {
      corpo += '<button class="mais" id="maisVia">Mostrar mais (' + num(lista.length - mostra.length) + " restantes)</button>";
    }

    html += bloco("Viagens mais recentes",
      fonte("Portal da transparência, módulo de diárias",
            viaState.orgao === "camara" ? PORTAL_CAMARA : PORTAL_PREF),
      corpo || vazio("Nenhuma diária registrada."));

    html += "</section>";
    pinta(html);

    view.querySelectorAll(".pilula[data-via]").forEach(function (b) {
      b.addEventListener("click", function () {
        viaState.orgao = b.dataset.via; viaState.limite = 30; renderViagens(d);
      });
    });
    var m = document.getElementById("maisVia");
    if (m) m.addEventListener("click", function () { viaState.limite += 60; renderViagens(d); });
  }

  // ================= tela: como cobrar =================

  function telaCobrar() {
    var html = '<section class="secao" style="border-top:0">' +
      '<h1 class="secao__titulo">Como cobrar uma resposta</h1>' +
      '<p class="secao__linha">Você não precisa dizer quem é, nem explicar por que quer saber. ' +
      "A lei obriga o poder público a responder. Isso vale para qualquer pessoa, de qualquer idade.</p>";

    html += '<div class="explica">' +
      "<p><strong>A Lei 12.527/2011, a Lei de Acesso à Informação, diz o seguinte:</strong> qualquer pessoa pode pedir " +
      "informação a qualquer órgão público, sem justificar o motivo. O órgão tem <strong>20 dias</strong> para responder, " +
      "prorrogáveis por mais 10 se explicarem por quê. Se negarem, você pode recorrer. O pedido é gratuito.</p></div>";

    html += bloco("O caminho, em quatro passos", "",
      '<ol class="passos">' +
        passo("Escreva o que você quer, do jeito mais específico possível",
              'Em vez de "quero saber sobre a saúde", peça "a lista de medicamentos em falta na farmácia municipal em julho de 2026". ' +
              "Pedido genérico recebe resposta genérica.") +
        passo("Mande pelo e-SIC do órgão certo",
              "Dinheiro da Prefeitura, obras, saúde, educação e limpeza: e-SIC da Prefeitura. " +
              "Gasto da Câmara, salário de vereador e sessão: e-SIC da Câmara.") +
        passo("Guarde o número de protocolo e conte os dias",
              "O prazo começa no dia seguinte ao pedido. Anote a data. Sem protocolo você não consegue recorrer.") +
        passo("Não respondeu ou respondeu pela metade? Recorra",
              "O recurso vai para a autoridade superior do mesmo órgão. Depois disso, cabe reclamação ao Ministério Público " +
              "de Minas Gerais e ao Tribunal de Contas do Estado.") +
      "</ol>");

    html += bloco("Onde clicar",
      '<p class="fonte">Links oficiais</p>',
      '<article class="ficha"><div class="ficha__topo">' +
        '<p class="ficha__nome">Prefeitura de Varginha</p></div>' +
        '<p class="ficha__meta">Portal da transparência e pedido de informação: ' +
        '<a href="' + PORTAL_PREF + '" target="_blank" rel="noopener">' + PORTAL_PREF + "</a></p></article>" +
      '<article class="ficha"><div class="ficha__topo">' +
        '<p class="ficha__nome">Câmara Municipal de Varginha</p></div>' +
        '<p class="ficha__meta">Portal e pedido de informação: ' +
        '<a href="' + PORTAL_CAMARA + '" target="_blank" rel="noopener">' + PORTAL_CAMARA + "</a></p></article>" +
      '<article class="ficha"><div class="ficha__topo">' +
        '<p class="ficha__nome">Ministério Público de Minas Gerais</p></div>' +
        '<p class="ficha__meta">Para denunciar quando o pedido é ignorado: ' +
        '<a href="https://www.mpmg.mp.br/" target="_blank" rel="noopener">mpmg.mp.br</a></p></article>');

    html += '<div class="explica"><p><strong>Antes de mandar, confira aqui.</strong> ' +
      "Muita coisa que as pessoas pedem por e-SIC já está publicada. " +
      'Dê uma olhada em <a href="#/dinheiro">Para onde vai o dinheiro</a> e ' +
      '<a href="#/salarios">Quanto ganha cada um</a>. Se o dado estiver lá, você economiza 20 dias.</p></div>';

    html += "</section>";
    pinta(html);
  }

  function passo(t, d) {
    return "<li><h3>" + esc(t) + "</h3><p>" + d + "</p></li>";
  }

  // ================= busca global =================

  function telaBusca(termo) {
    pinta(carregandoTela('Procurando "' + termo + '" em tudo'));

    Promise.all([
      chunk("prefeitura"),
      chunk("camara_betha"),
      chunk("pessoal").catch(function () { return null; })
    ]).then(function (r) {
      var pref = r[0], cam = r[1], pessoal = r[2];
      var t = normal(termo);
      var achados = [];

      function varrer(lista, tipo, campos, montar) {
        (lista || []).forEach(function (item) {
          var alvo = campos.map(function (c) { return item[c]; }).join(" ");
          if (normal(alvo).indexOf(t) > -1) achados.push({ tipo: tipo, html: montar(item) });
        });
      }

      varrer(pref.top_fornecedores_atual, "Fornecedor da Prefeitura", ["nome", "cnpj"], function (f) {
        return linha(titulo(f.nome), moeda(f.valor_total), "Total consolidado em " + pref.ano_atual);
      });
      varrer(cam.top_fornecedores_atual, "Fornecedor da Câmara", ["nome"], function (f) {
        return linha(titulo(f.nome), moeda(f.valor_total), "Total consolidado em " + cam.ano_atual);
      });
      varrer(pref.contratos, "Contrato da Prefeitura", ["contratado", "objeto", "cnpj"], function (c) {
        return linha(titulo(c.contratado), moeda(c.valor), c.objeto);
      });
      varrer(pref.obras_publicas, "Obra", ["objeto", "categoria", "fornecedor"], function (o) {
        return linha(o.objeto || o.categoria, String(o.situacao || ""),
                     (o.fornecedor ? titulo(o.fornecedor) + ". " : "") +
                     (o.data_prevista_conclusao ? "Prometida para " + dataBr(o.data_prevista_conclusao) : ""));
      });

      if (pessoal) {
        ["camara", "prefeitura"].forEach(function (o) {
          var org = pessoal[o] || {};
          varrer(folhaPorPessoa(org).pessoas,
                 "Servidor da " + (o === "camara" ? "Câmara" : "Prefeitura"),
                 ["nome", "cargo"], function (s) {
            return linha(titulo(s.nome), moeda(s.vencimentos),
                         titulo(s.cargo) + ". Bruto de " + (s.competencia || "competência não informada") +
                         ". Vínculo: " + vinculoLimpo(s.vinculo));
          });
        });
      }

      var html = '<section class="secao" style="border-top:0">' +
        '<h1 class="secao__titulo">Resultados para &ldquo;' + esc(termo) + "&rdquo;</h1>" +
        '<p class="secao__linha">' + num(achados.length) + " ocorrências em fornecedores, contratos, obras e folha de pagamento.</p>";

      if (!achados.length) {
        html += vazio("Nada encontrado. Tente um pedaço menor do nome, ou só o sobrenome.");
      } else {
        var porTipo = {};
        achados.slice(0, 300).forEach(function (a) {
          (porTipo[a.tipo] = porTipo[a.tipo] || []).push(a.html);
        });
        Object.keys(porTipo).forEach(function (tipo) {
          html += bloco(tipo, '<p class="fonte">' + num(porTipo[tipo].length) + " encontrados</p>",
                        porTipo[tipo].slice(0, 40).join(""));
        });
      }

      html += "</section>";
      pinta(html);
    }).catch(function (e) { pinta(erroTela(e.message)); });
  }

  function linha(nome, valor, meta) {
    return '<article class="ficha">' +
      '<div class="ficha__topo"><p class="ficha__nome">' + esc(nome) + "</p>" +
      '<span class="ficha__valor">' + esc(valor) + "</span></div>" +
      (meta ? '<p class="ficha__meta">' + esc(meta) + "</p>" : "") + "</article>";
  }

  // ================= roteador =================

  var ROTAS = {
    "/": telaInicio,
    "/salarios": telaSalarios,
    "/dinheiro": telaDinheiro,
    "/obras": telaObras,
    "/viagens": telaViagens,
    "/cobrar": telaCobrar
  };

  function rotear() {
    var h = location.hash.replace(/^#/, "") || "/";

    if (h.indexOf("/busca/") === 0) {
      marcarMenu(null);
      telaBusca(decodeURIComponent(h.slice(7)));
      return;
    }

    var fn = ROTAS[h] || telaInicio;
    marcarMenu(ROTAS[h] ? h : "/");
    fn();
  }

  function marcarMenu(rota) {
    document.querySelectorAll(".menu a").forEach(function (a) {
      if (rota && a.dataset.rota === rota) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  function buscar() {
    var v = document.getElementById("q").value.trim();
    if (v.length < 2) return;
    location.hash = "#/busca/" + encodeURIComponent(v);
  }

  document.getElementById("btnBusca").addEventListener("click", buscar);
  document.getElementById("q").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); buscar(); }
  });

  window.addEventListener("hashchange", rotear);

  tarja();
  rotear();
})();
