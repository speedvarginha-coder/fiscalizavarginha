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
    const stamp = document.createElement('p');
    stamp.className = 'muted';
    const last = Date.parse(dados.geradoEm);
    stamp.textContent = Number.isFinite(last)
      ? `Conciliação registrada em ${new Date(last).toLocaleDateString('pt-BR')}. ${(Date.now()-last)>30*86400000 ? 'Base sem conciliação recente confirmada. Os resultados abaixo são históricos.' : 'Confira a cobertura dos documentos lidos abaixo.'}`
      : 'Data da conciliação não informada; atualidade não confirmada.';
    secao.prepend(stamp);

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
        : relatorios.length ? `Cobertura da leitura: todas as emendas dos ${relatorios.length} relatórios foram lidas.` : 'Nenhum relatório disponível para confirmar a cobertura.';
    }

    if (!comDivergencia.length) {
      secao.hidden = false;
      const alvo = document.getElementById('reconcLista');
      if (alvo) alvo.textContent = 'Nenhuma divergência localizada nos documentos lidos. Isso não confirma completude ou execução das emendas.';
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
            <div class="reconc-tabela-wrap" tabindex="0" role="region" aria-label="Reconciliação de emendas; tabela com rolagem horizontal">
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
    .then((r) => { if (!r.ok) throw new Error('Conciliação indisponível'); return r.json(); })
    .then(render)
    .catch(() => {
      const secao = document.getElementById('reconciliacao');
      if (secao) {
        secao.hidden = false;
        const aviso = document.createElement('p');
        aviso.setAttribute('role', 'status');
        aviso.textContent = 'Não foi possível carregar a conciliação com a Prefeitura. Não interpretar como ausência de divergências ou como execução confirmada.';
        secao.prepend(aviso);
      }
    });
})();
