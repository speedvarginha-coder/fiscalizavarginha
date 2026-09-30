/* Fiscaliza Varginha — modules/utils.js
 *
 * Utilitários puros extraídos do app.js (Fase 1 do refactor Codex):
 *   fmtBRL, fmtBRLnb, fmtMi, fmtNum — formatadores
 *   cleanText — limpeza de mojibake + caracteres corrompidos
 *   esc — escape HTML
 *
 * Disponíveis globalmente em window.FISCALIZA.utils. O app.js destrutura no topo
 * para manter retrocompatibilidade total.
 *
 * Carregado pelo data-loader.js ANTES de app.js.
 * NÃO depende de window.FISCALIZA_DATA, nem de DOM, nem de outros módulos.
 */
(function () {
  "use strict";
  window.FISCALIZA = window.FISCALIZA || {};

  // ============= FORMATTERS =============
  // O sinal vem antes do simbolo, como se escreve em portugues: -R$ 2.395.653,21.
  // Concatenar "R$ " com o numero ja formatado produzia "R$ -2.395.653,21".
  const fmtBRL = (n) => {
    const v = Number(n) || 0;
    const corpo = Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? "-R$ " : "R$ ") + corpo;
  };
  const fmtBRLnb = fmtBRL;
  const fmtMi  = (n) => {
    const v = Number(n) || 0;
    return (v < 0 ? "-R$ " : "R$ ") + (Math.abs(v) / 1_000_000).toFixed(1).replace(".", ",") + " mi";
  };
  const fmtNum = (n) => (n || 0).toLocaleString("pt-BR");
  const cleanText = (v) => {
    let text = (v ?? "").toString()
      // === Mojibake single-encoded (UTF-8 lido como Latin-1) — comum em dados Betha ===
      .replace(/Ã§/g, "ç")  // Ã§ → ç
      .replace(/Ã£/g, "ã")  // Ã£ → ã
      .replace(/Ã¡/g, "á")  // Ã¡ → á
      .replace(/Ã /g, "à")  // Ã  → à
      .replace(/Ã¢/g, "â")  // Ã¢ → â
      .replace(/Ã©/g, "é")  // Ã© → é
      .replace(/Ãª/g, "ê")  // Ãª → ê
      .replace(/Ã­/g, "í")  // Ã­ → í
      .replace(/Ã³/g, "ó")  // Ã³ → ó
      .replace(/Ã´/g, "ô")  // Ã´ → ô
      .replace(/Ãµ/g, "õ")  // Ãµ → õ
      .replace(/Ãº/g, "ú")  // Ãº → ú
      .replace(/Ã¼/g, "ü")  // Ã¼ → ü
      .replace(/Ã±/g, "ñ")  // Ã± → ñ
      .replace(/Ã‡/g, "Ç")  // Ã + ‡(U+2021) → Ç
      .replace(/Ãƒ/g, "Ã")  // Ã + ƒ(U+0192) → Ã
      .replace(/Ã‚/g, "Â")  // Ã + ‚(U+201A) → Â
      .replace(/Ã‰/g, "É")  // Ã + ‰(U+2030) → É
      .replace(/Ã“/g, "Ó")  // Ã + "(U+201C) → Ó
      .replace(/Ãš/g, "Ú")  // Ã + š(U+0161) → Ú
      .replace(/Ãˆ/g, "È")  // Ã + ˆ(U+02C6) → È
      .replace(/ç|ÃÂ§/g, "\u00e7")
      .replace(/ã|ÃÂ£/g, "\u00e3")
      .replace(/á|ÃÂ¡/g, "\u00e1")
      .replace(/é|Ã©/g, "\u00e9")
      .replace(/í|ÃÂ­/g, "\u00ed")
      .replace(/ó|ÃÂ³/g, "\u00f3")
      .replace(/ú|ÃÂº/g, "\u00fa")
      .replace(/â|ÃÂ¢/g, "\u00e2")
      .replace(/ê|ÃÂª/g, "\u00ea")
      .replace(/ô|ÃÂ´/g, "\u00f4")
      .replace(/Ç|Ã—¡/g, "\u00c7")
      // Separador visual: normaliza os espaços em volta para nao sobrar " - ".
      .replace(/\s*(?:Ã‚·|Â·|·)\s*/g, " · ")
      // Sobra de mojibake: o "Â" orfao aparece colado em espaco ou simbolo
      // (Â , Âº, Â°). Dentro de palavra ele e legitimo — sem o negative
      // lookahead isto apagava o acento de CÂMARA e virava "CMARA".
      .replace(/Ã‚(?![A-Za-zÀ-ÿ])|Â(?![A-Za-zÀ-ÿ])/g, "")
      .replace(/ï¿½\?\?/g, "");
    const pairs = [
      [/Aquisi\uFFFD+o/gi, "Aquisi\u00e7\u00e3o"],
      [/Contrata\uFFFD+o/gi, "Contrata\u00e7\u00e3o"],
      [/administra\uFFFD+o/gi, "administra\u00e7\u00e3o"],
      [/manuten\uFFFD+o/gi, "manuten\u00e7\u00e3o"],
      [/confec\uFFFD+o/gi, "confec\u00e7\u00e3o"],
      [/distribui\uFFFD+o/gi, "distribui\u00e7\u00e3o"],
      [/promo\uFFFD+o/gi, "promo\u00e7\u00e3o"],
      [/organiza\uFFFD+o/gi, "organiza\u00e7\u00e3o"],
      [/associa\uFFFD+o/gi, "associa\u00e7\u00e3o"],
      [/inscri\uFFFD+es/gi, "inscri\u00e7\u00f5es"],
      [/competi\uFFFD+es/gi, "competi\u00e7\u00f5es"],
      [/apresenta\uFFFD+es/gi, "apresenta\u00e7\u00f5es"],
      [/pre\uFFFDos/gi, "pre\u00e7os"],
      [/pe\uFFFDas/gi, "pe\u00e7as"],
      [/combust\uFFFDveis/gi, "combust\u00edveis"],
      [/\uFFFDleo/gi, "\u00f3leo"],
      [/el\uFFFDtricos/gi, "el\u00e9tricos"],
      [/eletr\uFFFDnicos/gi, "eletr\u00f4nicos"],
      [/autom\uFFFDtico/gi, "autom\u00e1tico"],
      [/pot\uFFFDncia/gi, "pot\u00eancia"],
      [/m\uFFFDxima/gi, "m\u00e1xima"],
      [/n\uFFFDmero/gi, "n\u00famero"],
      [/m\uFFFDveis/gi, "m\u00f3veis"],
      [/mobili\uFFFDrios/gi, "mobili\u00e1rios"],
      [/pedi\uFFFDtricas/gi, "pedi\u00e1tricas"],
      [/necess\uFFFDrio/gi, "necess\u00e1rio"],
      [/did\uFFFDtico/gi, "did\u00e1tico"],
      [/hist\uFFFDria/gi, "hist\u00f3ria"],
      [/f\uFFFDsica/gi, "f\u00edsica"],
      [/f\uFFFDrum/gi, "f\u00f3rum"],
      [/ecol\uFFFDgico/gi, "ecol\u00f3gico"],
      [/cal\uFFFDas/gi, "cal\u00e7as"],
      [/a\uFFFDreas/gi, "a\u00e9reas"],
      [/respons\uFFFDvel/gi, "respons\u00e1vel"],
      [/benefici\uFFFDrio/gi, "benefici\u00e1rio"],
      [/sa\uFFFDde/gi, "sa\u00fade"],
      [/Jo\uFFFDozinho/gi, "Jo\u00e3ozinho"],
      [/Rog\uFFFDrio/gi, "Rog\u00e9rio"],
      [/Z\uFFFD Morais/gi, "Z\u00e9 Morais"],
      [/V\uFFFDlei/gi, "V\u00f4lei"],
    ];
    pairs.forEach(([from, to]) => { text = text.replace(from, to); });
    return text.replace(/\uFFFD+/g, "").replace(/ï¿½/g, "");
  };
  const esc = (v) => cleanText(v).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));


  // For values embedded inside JS string literals in onclick attributes.
  // esc() uses &#39; which HTML decodes back to ' before JS runs — breaks string.
  // jsSafe uses \' which HTML passes through unchanged and JS treats as escaped quote.
  const jsSafe = (v) => String(cleanText(v) || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "")
    .replace(/\n/g, " ");

  const scrollToEl = (el) => {
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  const norm   = (s) => (s || "").toString().toLowerCase()
                                  .normalize("NFD").replace(/\p{Diacritic}/gu, "");

  // Radical de busca: alem de acento e caixa, tira as flexoes mais comuns do
  // portugues para que "escolas" ache "escola" e "professora" ache PROFESSOR.
  // A base publica grava cargo e objeto no masculino singular; sem isto o
  // cidadao que digita o plural recebe zero resultado.
  const radical = (palavra) => {
    let p = palavra;
    if (p.length <= 3) return p;
    p = p.replace(/(?:coes|oes)$/, "cao")   // licitacoes -> licitacao
         .replace(/aes$/, "ao")             // paes -> pao
         .replace(/eis$/, "el")             // papeis -> papel
         .replace(/ais$/, "al")             // hospitais -> hospital
         .replace(/ns$/, "m")               // bens -> bem
         .replace(/res$/, "r")              // mulheres -> mulher
         .replace(/s$/, "");                // escolas -> escola
    if (p.length > 4) p = p.replace(/[ao]$/, ""); // escola/escolo -> escol
    return p;
  };

  // Distancia de edicao menor ou igual a 1 (troca, sobra ou falta de UMA letra).
  // Serve so para salvar erro de digitacao; nao e busca aproximada geral.
  const ateUmErro = (a, b) => {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    const [curto, longo] = a.length <= b.length ? [a, b] : [b, a];
    let i = 0, j = 0, erros = 0;
    while (i < curto.length && j < longo.length) {
      if (curto[i] === longo[j]) { i++; j++; continue; }
      if (++erros > 1) return false;
      if (curto.length === longo.length) i++;
      j++;
    }
    return erros + (longo.length - j) + (curto.length - i) <= 1;
  };

  // Casamento de busca usado por todos os filtros de texto do painel.
  // A consulta ja chega normalizada (norm). Cada termo digitado precisa casar,
  // em qualquer ordem, por uma destas vias:
  //   1. inicio de palavra — cobre digitacao parcial ("limp" acha "limpeza")
  //   2. radical         — cobre plural e feminino
  //   3. um erro de digitacao — so para termos de 7 letras ou mais, e nunca
  //      para termo com digito, porque numero e identidade e nao palavra
  const casaBusca = (texto, consultaNormalizada) => {
    const q = (consultaNormalizada || "").trim();
    if (q.length < 2) return true;          // 1 caractere nao filtra nada
    const alvo = norm(texto);
    if (!alvo) return false;
    const termos = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (!termos.length) return true;
    // Frase ou codigo (tem separador): vale o trecho literal, que e o que
    // preserva "0/2020" e "oficina do nene". Palavra unica NAO usa trecho
    // literal, senao "licitacao" casa dentro de "solicitacao".
    if (termos.length > 1 && alvo.includes(q)) return true;
    // Numero de contrato ("0/2020") e busca exata. Sem esta saida, os termos
    // "0" e "2020" eram cobrados em separado e qualquer contrato de 2020
    // entrava no resultado.
    if (/^\d+\s*\/\s*\d+$/.test(q)) return false;
    const palavras = alvo.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const radicais = palavras.map(radical);
    return termos.every(termo => {
      // Ancorado no INICIO da palavra, nao em qualquer pedaco dela. Solto,
      // "licitacao" casava "solicitacao" e a pagina Como cobrar mostrava 21 dos
      // 22 modelos como se todos falassem de licitacao — eram 4.
      if (palavras.some(pal => pal.startsWith(termo))) return true;
      const rt = radical(termo);
      // O prefixo so vale numa direcao: a palavra do DADO pode continuar o que
      // foi digitado ("limp" acha "limpeza"). A direcao contraria, aceitar que
      // o que foi digitado continue uma palavra menor do dado, fazia "clx"
      // casar a palavra solta "c" e "medico" casar a lotacao "MEDIA/ALTA".
      if (radicais.some(r => r === rt || (rt.length >= 4 && r.startsWith(rt)))) return true;
      // Tolerancia a erro de digitacao so a partir de 7 letras. Em palavra
      // curta ela confunde palavras diferentes de verdade: com o piso em 5,
      // "medica" casava a lotacao "MEDIA/ALTA" e a busca por cargo de medico
      // devolvia 399 servidores em vez de 40.
      if (termo.length < 7) return false;
      // Numero e identidade, nao palavra: um digito diferente e outro registro,
      // nunca um erro de digitacao. Sem esta saida, buscar o plano de acao
      // "202627540001" no portal de emendas trazia tres registros diferentes
      // que so diferiam de um digito.
      if (/\d/.test(termo)) return false;
      return palavras.some(pal => ateUmErro(pal, termo));
    });
  };

  // Wrap matching substring with <mark> for search highlighting.
  // Falls back to plain escaped text when no query or no match.
  const highlight = (text, q) => {
    const t = cleanText(text || "");
    if (!q) return esc(t);
    const normT = norm(t);
    const idx = normT.indexOf(norm(q));
    if (idx === -1) return esc(t);
    return esc(t.slice(0, idx)) +
           `<mark class="hl">${esc(t.slice(idx, idx + q.length))}</mark>` +
           esc(t.slice(idx + q.length));
  };

  // Sigla oficial da secretaria a partir do nome (qualquer grafia/acentuação).
  // Casa por palavra-chave normalizada; retorna o nome limpo se não reconhecer.
  const SIGLAS_SECRETARIA = [
    [/habitacao/,                         "SEHAD"],
    [/economico/,                         "SEDEC"],
    [/saude/,                             "SEMUS"],
    [/educacao/,                          "SEDUC"],
    [/esporte/,                           "SEMEL"],
    [/agricultura|pecuaria/,              "SEAGRI"],
    [/meio ambiente/,                     "SEMEA"],
    [/turismo|comercio/,                  "SETEC"],
    [/planejamento/,                      "SEPLA"],
    [/obras/,                             "SOSUB"],
    [/fazenda/,                           "SEMFA"],
    [/controle interno/,                  "SECON"],
    [/tecnologia/,                        "SETINF"],
    [/administracao/,                     "SEMAD"],
    [/vice-?prefeito|gabiv/,              "GABIV"],
    [/gabinete do prefeito|\bgabip\b/,    "GABIP"],
    [/governo/,                           "SEGOV"],
  ];
  const siglaSecretaria = (nome) => {
    const limpo = cleanText(nome);
    const n = norm(limpo);
    if (!n) return limpo;
    for (const [re, sigla] of SIGLAS_SECRETARIA) if (re.test(n)) return sigla;
    return limpo;
  };

  const exportCSV = (rows, cols, filename) => {
    const header = cols.map(c => `"${c.label}"`).join(",");
    const body = rows.map(r =>
      cols.map(c => `"${String(r[c.key] ?? "").replace(/"/g, '""')}"`).join(",")
    );
    const blob = new Blob(["﻿" + [header, ...body].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const statusFonteAtual = (fonte, agora = Date.now()) => {
    if (fonte?.status !== "ok") return fonte;
    const data = fonte.source_updated_at ? new Date(fonte.source_updated_at).getTime() : NaN;
    const idade = (agora - data) / 86400000;
    if (!Number.isFinite(idade) || idade < 0) return { ...fonte, status: "unknown", age_days: null };
    return { ...fonte, age_days: idade, status: idade > Number(fonte.max_age_days) ? "stale" : "ok" };
  };

  window.FISCALIZA.utils = Object.freeze({
    fmtBRL, fmtBRLnb, fmtMi, fmtNum, cleanText, esc, jsSafe, scrollToEl, norm, highlight, siglaSecretaria, exportCSV,
    radical, casaBusca, statusFonteAtual,
  });
})();
