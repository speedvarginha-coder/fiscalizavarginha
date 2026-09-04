/* Confronto entre o registro contabil da Prefeitura e as bases de origem.
 *
 * O chunk vem de emendas/coletor_emendas_prefeitura.py. A secao so aparece
 * quando ha divergencia: bloco vazio na tela nao informa nada e ainda sugere
 * que o assunto foi verificado e esta resolvido.
 *
 * Regra de tom, igual ao resto do painel: divergencia e pergunta, nao acusacao.
 * O texto nunca afirma desvio, some ou irregularidade. Diz o que cada lado
 * registra e manda conferir na fonte primaria.
 */
(function () {
  "use strict";

  const CHUNK = "../data/chunks/emendas_prefeitura.json";

  const brl = (v) =>
    Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const num = (v) => Number(v || 0).toLocaleString("pt-BR");
  const esc = (v) =>
    String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    })[c]);

  function render(dados) {
    const secao = document.getElementById("reconciliacao");
    if (!secao || !dados) return;

    const relatorios = dados.porRelatorio || [];
    const comDivergencia = relatorios.filter(
      (r) => (r.semCorrespondenciaNoPainel || []).length > 0,
    );
    const resumo = dados.resumo || {};

    // A cobertura da leitura vai para a tela mesmo quando nada diverge: "zero
    // divergencias" pode significar "nada diverge" ou "nao li metade do
    // arquivo", e o leitor precisa saber de qual dos dois se trata.
    const parciais = relatorios.filter((r) => r.leituraCompleta === false);
    const cobertura = document.getElementById("reconcCobertura");
    if (cobertura) {
      const naoLidas = Number(resumo.emendasNaoLidas || 0);
      cobertura.textContent = naoLidas
        ? `Cobertura da leitura: ${naoLidas} emenda(s) dos relatórios não puderam ser lidas automaticamente` +
          ` (${parciais.map((r) => `${r.esfera} ${r.ano}: ${r.emendasLidas} de ${r.emendasNoRelatorio}`).join("; ")}).` +
          ` Sobre elas este confronto não afirma nada.`
        : `Cobertura da leitura: todas as emendas dos ${relatorios.length} relatórios foram lidas.`;
    }

    if (!comDivergencia.length) {
      secao.hidden = true;
      return;
    }

    const alvo = document.getElementById("reconcLista");
    if (alvo) {
      alvo.innerHTML = comDivergencia
        .map((r) => {
          const itens = (r.semCorrespondenciaNoPainel || [])
            .slice()
            .sort((a, b) => Number(b.valor || 0) - Number(a.valor || 0));
          const linhas = itens
            .map(
              (e) => `<tr>
                <td>${esc(e.codigo)}</td>
                <td class="num">${brl(e.valor)}</td>
                <td>${esc(e.beneficiario || "não informado")}</td>
              </tr>`,
            )
            .join("");
          return `<article class="reconc-grupo">
            <h3>${esc(r.esfera)} · exercício ${esc(r.ano)}</h3>
            <p class="muted small">${num(itens.length)} emenda(s) no relatório da Prefeitura sem correspondência na base de origem, somando ${brl(r.valorSemCorrespondencia)}.</p>
            <div class="reconc-tabela-wrap">
              <table class="reconc-tabela">
                <thead><tr><th>Indicação</th><th class="num">Valor</th><th>Beneficiário</th></tr></thead>
                <tbody>${linhas}</tbody>
              </table>
            </div>
          </article>`;
        })
        .join("");
    }

    const valor = document.getElementById("reconcValor");
    if (valor) valor.textContent = brl(resumo.valorSemCorrespondencia);
    const qtd = document.getElementById("reconcQtd");
    if (qtd) {
      const n = Number(resumo.emendasSemCorrespondencia || 0);
      qtd.textContent = `${num(n)} emenda${n === 1 ? "" : "s"}`;
    }
    secao.hidden = false;
  }

  fetch(CHUNK, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then(render)
    .catch(() => {
      // Chunk ausente e situacao legitima: a Prefeitura pode nao ter publicado
      // os relatorios ainda. A secao fica fora em vez de mostrar erro.
    });
})();
