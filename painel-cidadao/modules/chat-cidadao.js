/* Fiscaliza Varginha — modules/chat-cidadao.js
 * Widget de chat com IA (Gemini via Netlify Function) + fallback por palavras-chave.
 * A chave da API nunca chega ao navegador.
 */
(function () {
  "use strict";

  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function brl(v) {
    return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function num(v) { return Number(v).toLocaleString("pt-BR"); }
  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---- HTML do widget ----
  const wrap = document.createElement("div");
  wrap.id = "chatCidadao";
  wrap.className = "chat-cidadao";
  wrap.innerHTML =
    '<button id="chatToggle" class="chat-cidadao__toggle" aria-label="Abrir assistente Fiscaliza">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
      '<span>Perguntar</span>' +
    '</button>' +
    '<div id="chatPanel" class="chat-cidadao__panel" hidden>' +
      '<div class="chat-cidadao__header">' +
        '<div class="chat-cidadao__header-info">' +
          '<strong>Assistente Fiscaliza</strong>' +
          '<small id="chatSubtitle">Dados públicos de Varginha</small>' +
        '</div>' +
        '<button id="chatClose" class="chat-cidadao__close" aria-label="Fechar">&#x2715;</button>' +
      '</div>' +
      '<div id="chatMsgs" class="chat-cidadao__msgs" role="log" aria-live="polite"></div>' +
      '<div class="chat-cidadao__footer">' +
        '<input type="text" id="chatInput" class="chat-cidadao__input" placeholder="Pergunte sobre Varginha…" autocomplete="off" aria-label="Sua pergunta">' +
        '<button id="chatSend" class="chat-cidadao__send" aria-label="Enviar">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(wrap);

  const toggle  = document.getElementById("chatToggle");
  const panel   = document.getElementById("chatPanel");
  const closeBtn= document.getElementById("chatClose");
  const msgs    = document.getElementById("chatMsgs");
  const input   = document.getElementById("chatInput");
  const sendBtn = document.getElementById("chatSend");

  let aberto = false;

  function abrirChat() {
    aberto = true;
    panel.hidden = false;
    toggle.classList.add("is-active");
    toggle.setAttribute("aria-expanded", "true");
    if (msgs.children.length === 0) boasVindas();
    setTimeout(() => input.focus(), 50);
  }

  function fecharChat() {
    aberto = false;
    panel.hidden = true;
    toggle.classList.remove("is-active");
    toggle.setAttribute("aria-expanded", "false");
  }

  toggle.addEventListener("click", () => aberto ? fecharChat() : abrirChat());
  closeBtn.addEventListener("click", fecharChat);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && aberto) fecharChat(); });

  // ---- Mensagens ----
  function addMsg(html, tipo) {
    const el = document.createElement("div");
    el.className = "chat-msg chat-msg--" + tipo;
    el.innerHTML = html;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  function addChips(chips) {
    const el = document.createElement("div");
    el.className = "chat-chips";
    el.innerHTML = chips.map((c) =>
      '<button class="chat-chip" data-q="' + esc(c.q) + '">' + esc(c.label) + '</button>'
    ).join("");
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    el.querySelectorAll(".chat-chip").forEach((b) => {
      b.addEventListener("click", () => {
        el.remove();
        addMsg(esc(b.textContent), "user");
        responder(b.dataset.q);
      });
    });
  }

  const EM_NETLIFY = location.hostname.includes("netlify.app");
  const FUNC_URL = EM_NETLIFY ? "/.netlify/functions/chat" : "chat.php";
  const USA_IA = EM_NETLIFY || location.hostname.includes("fiscaliza");
  const subtitle = document.getElementById("chatSubtitle");
  if (subtitle) subtitle.textContent = USA_IA ? "🤖 Gemini · dados de Varginha" : "📋 Respostas automáticas";

  // Histórico da conversa (multi-turn). Cada item: {papel:"user"|"model", texto}
  const historico = [];

  // Chama a IA em streaming (SSE). onDelta(textoAcumulado) é chamado a cada trecho.
  async function chamarIAStream(pergunta, onDelta) {
    const res = await fetch(FUNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pergunta, historico }),
    });

    // Navegador sem streaming de fetch — degrada para leitura completa
    if (!res.body || !res.body.getReader) {
      const txt = await res.text();
      let full = "";
      txt.split("\n\n").forEach((bloco) => {
        const linha = bloco.split("\n").find((l) => l.startsWith("data:"));
        if (!linha) return;
        try {
          const p = JSON.parse(linha.slice(5).trim());
          if (p.erro) throw new Error(p.rate ? "rate_limit" : "api_error");
          if (p.delta) full += p.delta;
        } catch (e) { if (e.message === "rate_limit") throw e; }
      });
      if (!full) throw new Error("vazio");
      if (onDelta) onDelta(full);
      return full;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const bloco = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const linha = bloco.split("\n").find((l) => l.startsWith("data:"));
        if (!linha) continue;
        let p;
        try { p = JSON.parse(linha.slice(5).trim()); } catch (e) { continue; }
        if (p.erro)  throw new Error(p.rate ? "rate_limit" : "api_error");
        if (p.delta) { full += p.delta; if (onDelta) onDelta(full); }
      }
    }
    if (!full) throw new Error("vazio");
    return full;
  }

  // Separa o texto visível das linhas de sugestão "::"
  function separarSugestoes(full) {
    const linhas    = String(full || "").split("\n");
    const sugestoes = linhas
      .filter((l) => l.trim().startsWith("::"))
      .map((l) => l.trim().slice(2).trim())
      .filter(Boolean);
    const visivel = linhas.filter((l) => !l.trim().startsWith("::")).join("\n").trim();
    return { visivel, sugestoes };
  }

  function renderMarkdown(txt) {
    // Extract links before HTML escaping to preserve URLs
    const links = [];
    txt = txt.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) => {
      const ph = `__LINK_${links.length}__`;
      links.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
      return ph;
    });

    txt = txt
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
      .replace(/\n{2,}/g, "<br><br>")
      .replace(/\n/g, "<br>");

    links.forEach((a, i) => { txt = txt.replace(`__LINK_${i}__`, a); });
    return txt;
  }

  function responder(texto) {
    const loader = addMsg('<span class="chat-typing"><i></i><i></i><i></i></span>', "bot");

    if (USA_IA) {
      let botEl = null;
      const onDelta = (full) => {
        if (!botEl) { loader.remove(); botEl = addMsg("", "bot"); }
        botEl.innerHTML = renderMarkdown(separarSugestoes(full).visivel);
        msgs.scrollTop = msgs.scrollHeight;
      };
      chamarIAStream(texto, onDelta)
        .then((full) => {
          if (!botEl) { loader.remove(); botEl = addMsg("", "bot"); }
          const { visivel, sugestoes } = separarSugestoes(full);
          botEl.innerHTML = renderMarkdown(visivel);
          historico.push({ papel: "user",  texto: texto });
          historico.push({ papel: "model", texto: visivel });
          if (historico.length > 12) historico.splice(0, historico.length - 12);
          if (sugestoes.length) addChips(sugestoes.slice(0, 3).map((s) => ({ label: s, q: s })));
          msgs.scrollTop = msgs.scrollHeight;
        })
        .catch((err) => {
          if (botEl) botEl.remove();
          loader.remove();
          if (err.message === "rate_limit") {
            addMsg("Muitas perguntas seguidas — aguarde alguns minutos e tente novamente.", "bot");
            return;
          }
          // Fallback para palavras-chave se a IA falhar
          const r = gerarResposta(texto);
          addMsg(r.msg + '<br><small style="opacity:.55;font-size:.7rem">⚠️ IA indisponível — resposta automática</small>', "bot");
          if (r.chips && r.chips.length) addChips(r.chips);
        });
    } else {
      // Local: fallback por palavras-chave
      setTimeout(() => {
        loader.remove();
        const r = gerarResposta(texto);
        addMsg(r.msg, "bot");
        if (r.chips && r.chips.length) addChips(r.chips);
      }, 500 + Math.random() * 350);
    }
  }

  function boasVindas() {
    const iaAtiva = USA_IA;
    addMsg(
      'Olá! Sou o assistente do <strong>Fiscaliza Varginha</strong>.<br>' +
      'Pergunte sobre contratos, gastos, vereadores ou obras — respondo com os dados públicos de Varginha.<br>' +
      '<small style="opacity:.65;font-size:.72rem">' + (iaAtiva ? '🤖 Powered by Gemini · dados coletados hoje' : '📋 Modo local — respostas automáticas') + '</small>',
      "bot"
    );
    addChips([
      { label: "💰 Total gasto em 2026",    q: "total gasto 2026"   },
      { label: "🛣️ Asfalto e obras",         q: "asfalto obras"      },
      { label: "🏛️ Câmara e vereadores",     q: "camara vereadores"  },
      { label: "📋 Como cobrar resposta",    q: "como cobrar lai"    },
    ]);
  }

  // ---- Gerador de respostas ----
  function gerarResposta(q) {
    const t = norm(q);
    const D  = window.ZELA_DATA || {};
    const pf = D.prefeitura   || {};
    const cb = D.camara_betha || {};
    const em = D.emendas      || {};
    const di = D.diarias      || {};
    const pe = D.pessoal      || {};

    // Total / orçamento
    if (/total|orcamento|quanto|gastou|despesa|dinheiro/.test(t)) {
      const totalPf = pf.total_externo_atual;
      const totalCb = cb.total_externo_atual;
      const ano = pf.ano_atual || 2026;
      if (totalPf) return {
        msg:
          'Em <strong>' + ano + '</strong>, a Prefeitura pagou <strong>' + brl(totalPf) + '</strong> a fornecedores externos.<br>' +
          'A Câmara Municipal gastou <strong>' + brl(totalCb || 0) + '</strong> no mesmo período.<br>' +
          '<small style="opacity:.65;font-size:.72rem">Fonte: Portal da Transparência (Betha). Dados de credores com pagamento registrado.</small><br><br>' +
          '<a href="prefeitura.html">Ver detalhes da Prefeitura &rarr;</a>',
        chips: [
          { label: "Maiores fornecedores", q: "maiores fornecedores" },
          { label: "Saúde",                q: "saude"                },
          { label: "Asfalto e obras",       q: "asfalto"              },
        ],
      };
    }

    // Asfalto / obras
    if (/asfalto|buraco|obra|paviment|recape|tapa.?buraco|calcada/.test(t)) {
      const obras = pf.obras || [];
      const totalObras = obras.reduce((s, o) => s + (Number(o.valor) || 0), 0);
      return {
        msg:
          'A Prefeitura tem <strong>' + num(obras.length) + ' obras</strong> registradas, somando <strong>' + brl(totalObras) + '</strong>.<br>' +
          'Inclui pavimentação, tapa-buraco, drenagem e construções — cada uma com empresa, metragem e custo oficial.<br><br>' +
          '<a href="prefeitura.html?tab=asfalto">Ver obras e asfalto &rarr;</a>',
        chips: [
          { label: "Pedir contrato de obra via LAI", q: "cobrar contrato obra" },
          { label: "Total gasto em 2026",             q: "total gasto 2026"    },
        ],
      };
    }

    // Saúde
    if (/saude|hospital|medic|upa|sus|farmac|remedio|clinica/.test(t)) {
      const cs = (pf.contratos || []).filter((c) => /sa[uú]de|medic|hospital|upa|farmac|sus/i.test(c.objeto || ""));
      const tv = cs.reduce((s, c) => s + (Number(c.valor) || 0), 0);
      return {
        msg:
          'Encontrei <strong>' + num(cs.length) + ' contratos</strong> ligados à saúde, somando aprox. <strong>' + brl(tv) + '</strong>.<br>' +
          '<small style="opacity:.65;font-size:.72rem">Classificação automática por palavra-chave — é pista, não prova. Confira a fonte oficial.</small><br><br>' +
          '<a href="prefeitura.html?tab=contratos&q=saude">Ver contratos de saúde &rarr;</a>',
        chips: [
          { label: "Medicamentos",    q: "medicamentos"  },
          { label: "Como cobrar LAI", q: "como cobrar"   },
        ],
      };
    }

    // Educação
    if (/educac|escola|creche|merenda|aliment|professor|ensino/.test(t)) {
      const cs = (pf.contratos || []).filter((c) => /educa|escola|creche|merenda|aliment|professor/i.test(c.objeto || ""));
      const tv = cs.reduce((s, c) => s + (Number(c.valor) || 0), 0);
      return {
        msg:
          'Encontrei <strong>' + num(cs.length) + ' contratos</strong> ligados à educação, somando aprox. <strong>' + brl(tv) + '</strong>.<br>' +
          '<small style="opacity:.65;font-size:.72rem">Classificação automática por palavra-chave.</small><br><br>' +
          '<a href="prefeitura.html?tab=contratos&q=educacao">Ver contratos de educação &rarr;</a>',
        chips: [
          { label: "Merenda escolar", q: "merenda escola"  },
          { label: "Como cobrar LAI", q: "como cobrar"     },
        ],
      };
    }

    // Pessoal / salários / comissionados
    if (/salario|servidor|funcional|comission|remuner|folha|cargo|contrat|quadro/.test(t)) {
      const comiss = (pe.prefeitura || []).filter((p) => /comission|DAS|cargo em comissao/i.test(p.cargo || p.vinculo || ""));
      return {
        msg:
          'O painel mostra remuneração por secretaria — incluindo <strong>cargos comissionados</strong> (nomeados sem concurso).<br>' +
          (comiss.length ? 'A Prefeitura tem <strong>' + num(comiss.length) + ' comissionados</strong> mapeados.<br>' : '') +
          'Nenhum CPF é exposto — só nome, cargo, secretaria e salário bruto.<br><br>' +
          '<a href="pessoal.html">Ver Pessoal e Cargos &rarr;</a>',
        chips: [
          { label: "Cargos comissionados",    q: "comissionados"          },
          { label: "Pedir via LAI",            q: "cobrar salario servidor" },
        ],
      };
    }

    // Câmara / vereadores / emendas
    if (/camara|vereador|emenda|mandato|legislativo|sessao|plenario|sapl/.test(t)) {
      const lista = Array.isArray(em) ? em : (em.lista || []);
      const totalEm = lista.reduce((s, e) => s + (Number(e.valor_brl) || Number(e.valor) || 0), 0);
      const qtdEm   = lista.length;
      return {
        msg:
          'A Câmara Municipal tem <strong>17 vereadores</strong>.<br>' +
          (qtdEm ? 'Em 2026 foram registradas <strong>' + num(qtdEm) + ' emendas impositivas</strong>, somando aprox. <strong>' + brl(totalEm) + '</strong>.<br>' : '') +
          'O painel mostra presença em plenário, produção legislativa e CNPJ dos beneficiários das emendas.<br><br>' +
          '<a href="camara.html">Ver dados da Câmara &rarr;</a>',
        chips: [
          { label: "Para quem foram as emendas",  q: "emendas beneficiarios"  },
          { label: "Despesas da Câmara",           q: "despesas camara"        },
        ],
      };
    }

    // Fornecedores / contratos / empresas (recebeu só se não for diária)
    if (/fornecedor|empresa|contrato|cnpj/.test(t) || (/recebeu|receberam/.test(t) && !/diaria|viagem/.test(t))) {
      const top = (pf.top_fornecedores_atual || []).slice(0, 5);
      const linhas = top.map((f) =>
        '<li><strong>' + esc(f.nome || f.credor) + '</strong> — ' + brl(f.valor_total || f.valor) + '</li>'
      ).join("");
      return {
        msg:
          'Maiores fornecedores da Prefeitura em 2026:<br>' +
          '<ul style="margin:8px 0 8px 16px;padding:0;font-size:.85rem">' + (linhas || "<li>Dados não disponíveis</li>") + '</ul>' +
          '<a href="prefeitura.html?tab=contratos">Ver todos os contratos &rarr;</a>',
        chips: [
          { label: "CNPJ com irregularidade",  q: "cnpj irregular"       },
          { label: "Pedir notas fiscais",       q: "cobrar nota fiscal"   },
        ],
      };
    }

    // Diárias
    if (/diaria|viagem|hospedagem|deslocamento|passagem/.test(t)) {
      const anoAtual = String(pf.ano_atual || 2026);
      const dpf = (di.prefeitura || []).filter((d) => String(d.ano) === anoAtual);
      const totalD = dpf.reduce((s, d) => s + (Number(d.valor_total) || Number(d.valor) || 0), 0);
      return {
        msg:
          'Em 2026 a Prefeitura pagou <strong>' + num(dpf.length) + ' diárias</strong>' +
          (totalD ? ', somando <strong>' + brl(totalD) + '</strong>' : '') + '.<br>' +
          'Cada registro mostra beneficiário, destino, finalidade e valor diário.<br><br>' +
          '<a href="prefeitura.html?tab=diarias">Ver diárias da Prefeitura &rarr;</a>',
        chips: [
          { label: "Diárias da Câmara",           q: "diarias camara"     },
          { label: "Pedir relatório de viagens",   q: "cobrar diarias"     },
        ],
      };
    }

    // LAI / como cobrar
    if (/cobrar|lai|acesso|pedido|informac|esic|resposta|ouvidoria|solicitar|requerir/.test(t)) {
      return {
        msg:
          'A <strong>Lei de Acesso à Informação (LAI)</strong> garante resposta em até <strong>20 dias úteis</strong>.<br>' +
          'O painel tem <strong>21 modelos prontos</strong> de pedido — obras, contratos, salários, diárias, emendas e mais.<br>' +
          'É grátis, leva 2 minutos e não precisa de advogado.<br><br>' +
          '<a href="cobrar.html">Ver Como Cobrar &rarr;</a>',
        chips: [
          { label: "Pedido sobre asfalto",   q: "cobrar asfalto"    },
          { label: "Pedido sobre contratos", q: "cobrar contratos"  },
          { label: "Canais oficiais",        q: "canais oficiais"   },
        ],
      };
    }

    // Canais oficiais
    if (/canal|telefone|email|onde|contato|ouvidoria|portal|site/.test(t)) {
      return {
        msg:
          'Canais oficiais de Varginha:<br>' +
          '<ul style="margin:8px 0 8px 16px;padding:0;font-size:.85rem">' +
            '<li>e-SIC: Portal da Transparência da Prefeitura</li>' +
            '<li>Ouvidoria: site oficial da Prefeitura Municipal</li>' +
            '<li>SAPL (Câmara): legislativo.varginha.mg.gov.br</li>' +
          '</ul>' +
          '<a href="cobrar.html">Ver guia completo &rarr;</a>',
      };
    }

    // Sinais / irregularidade
    if (/sinal|irregular|problema|denuncia|suspeito|risco|atencao|alerta/.test(t)) {
      return {
        msg:
          'O painel gera <strong>sinais automáticos</strong> quando encontra situações que merecem atenção — CNPJ com situação irregular, sócio em mais de uma empresa beneficiária, objeto de contrato vago.<br>' +
          '<strong>Sinais são pistas, não provas.</strong> Sempre confira na fonte oficial antes de qualquer conclusão.<br><br>' +
          '<a href="relatorios.html">Ver relatório de sinais &rarr;</a>',
        chips: [
          { label: "CNPJ irregular",    q: "cnpj irregular"   },
          { label: "Redes de sócios",   q: "redes socios"     },
        ],
      };
    }

    // CNPJ
    if (/cnpj|cadastral|receita federal|situacao empresa/.test(t)) {
      return {
        msg:
          'O painel cruza fornecedores da Prefeitura com a Receita Federal e verifica a <strong>situação cadastral do CNPJ</strong>.<br>' +
          'Empresa com CNPJ suspenso, inapto ou baixado que recebe dinheiro público é um sinal de atenção — não necessariamente crime, mas merece conferência.<br><br>' +
          '<a href="relatorios.html">Ver sinais de CNPJ &rarr;</a>',
      };
    }

    // Redes de sócios
    if (/socio|socios|rede|qsa|quadro societario/.test(t)) {
      return {
        msg:
          'O painel identifica quando o <strong>mesmo sócio aparece em duas ou mais empresas</strong> que receberam dinheiro público — emendas de vereadores, contratos da Prefeitura ou fornecedores da Câmara.<br>' +
          'Isso não é ilegal, mas é uma situação que o cidadão tem direito de conhecer e questionar.<br><br>' +
          '<a href="relatorios.html">Ver rede de sócios &rarr;</a>',
      };
    }

    // Fallback
    return {
      msg:
        'Não encontrei resposta pronta para <em>"' + esc(q) + '"</em>.<br><br>' +
        'Tente palavras como: <strong>asfalto, saúde, educação, vereador, fornecedor, salário, diária, contratos, LAI</strong>.<br><br>' +
        'Ou acesse diretamente: <a href="prefeitura.html">Prefeitura</a> · <a href="camara.html">Câmara</a> · <a href="cobrar.html">Como cobrar</a>',
      chips: [
        { label: "💰 Total gasto 2026", q: "total gasto 2026"  },
        { label: "❓ Como cobrar",       q: "como cobrar lai"   },
        { label: "⚠️ Ver sinais",        q: "sinais irregularidade" },
      ],
    };
  }

  // ---- Envio ----
  function enviar() {
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    addMsg(esc(q), "user");
    responder(q);
  }

  sendBtn.addEventListener("click", enviar);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") enviar(); });

})();
