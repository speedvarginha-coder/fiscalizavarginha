/* Zela Varginha — modules/utils.js
 *
 * Utilitários puros extraídos do app.js (Fase 1 do refactor Codex):
 *   fmtBRL, fmtBRLnb, fmtMi, fmtNum — formatadores
 *   cleanText — limpeza de mojibake + caracteres corrompidos
 *   esc — escape HTML
 *
 * Disponíveis globalmente em window.ZELA.utils. O app.js destrutura no topo
 * para manter retrocompatibilidade total.
 *
 * Carregado pelo data-loader.js ANTES de app.js.
 * NÃO depende de window.ZELA_DATA, nem de DOM, nem de outros módulos.
 */
(function () {
  "use strict";
  window.ZELA = window.ZELA || {};

  // ============= FORMATTERS =============
  const fmtBRL = (n) =>
    "R$ " + (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtBRLnb = fmtBRL;
  const fmtMi  = (n) => "R$ " + (n / 1_000_000).toFixed(1).replace(".", ",") + " mi";
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
      .replace(/Ã‚·|·/g, " - ")
      .replace(/Ã‚|Â/g, "")
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

  window.ZELA.utils = Object.freeze({
    fmtBRL, fmtBRLnb, fmtMi, fmtNum, cleanText, esc, jsSafe, scrollToEl, norm, highlight, exportCSV,
  });
})();
