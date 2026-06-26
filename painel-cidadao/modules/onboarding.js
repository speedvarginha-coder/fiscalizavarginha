/* Fiscaliza Varginha — modules/onboarding.js
 *
 * Banner de boas-vindas exibido na PRIMEIRA visita. Explica em uma frase o
 * que o painel é e como usar. Dismissível: ao fechar grava flag em
 * localStorage e não aparece de novo.
 *
 * Autossuficiente: injeta-se no topo de <main id="conteudo"> sem depender de
 * markup nas páginas. Carregado pelo data-loader (lista MODULOS).
 */
(function () {
  "use strict";
  var KEY = "fiscaliza.onboarding.v1";

  function jaViu() {
    try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; }
  }
  function marcarVisto() {
    try { localStorage.setItem(KEY, "1"); } catch (e) { /* modo privado */ }
  }

  function montar() {
    if (jaViu()) return;
    var main = document.getElementById("conteudo");
    if (!main || document.getElementById("onboarding-banner")) return;

    var banner = document.createElement("aside");
    banner.id = "onboarding-banner";
    banner.className = "onboarding";
    banner.setAttribute("role", "note");
    banner.innerHTML =
      '<div class="onboarding__body">' +
        '<strong class="onboarding__title">Bem-vindo ao Fiscaliza Varginha</strong>' +
        '<p class="onboarding__text">Este painel mostra <strong>contratos e gastos reais</strong> ' +
        'da Prefeitura e da Câmara de Varginha-MG, em linguagem simples. ' +
        'Clique em qualquer valor para conferir a <strong>fonte oficial</strong>. ' +
        'Não é prova de irregularidade — é um ponto de partida.</p>' +
      '</div>' +
      '<button type="button" class="onboarding__close" aria-label="Entendi, fechar aviso">Entendi</button>';

    main.insertBefore(banner, main.firstChild);

    var fechado = false;
    function fechar() {
      if (fechado) return;
      fechado = true;
      marcarVisto();
      banner.classList.add("is-leaving");
      setTimeout(function () { banner.remove(); }, 250);
      window.removeEventListener("scroll", aoRolar);
    }
    // Some ao rolar: quem já está usando o painel não precisa mais do aviso.
    function aoRolar() {
      if ((window.scrollY || document.documentElement.scrollTop || 0) > 160) fechar();
    }

    banner.querySelector(".onboarding__close").addEventListener("click", fechar);
    window.addEventListener("scroll", aoRolar, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", montar);
  } else {
    montar();
  }
})();
