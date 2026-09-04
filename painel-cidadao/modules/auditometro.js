/* Referência histórica PNTP independente da coleta corrente do painel. */
(function () {
  "use strict";
  const panel = document.getElementById("pntpPanel");
  if (!panel) return;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
  const number = n => n.toLocaleString("pt-BR");
  const percent = (n, total) => (100 * n / total).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
  const normalized = value => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  let reference;
  let loading;
  let selected = "prefeitura";
  let opener;

  function evidenceLink(url, index) {
    try {
      const parsed = new URL(url);
      if (!["https:", "http:"].includes(parsed.protocol)) return "";
      return `<a href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer">Evidência ${index + 1}: ${esc(parsed.hostname)} ↗</a>`;
    } catch (_) { return ""; }
  }

  function renderCriteria() {
    if (!reference) return;
    const entity = reference.orgaos[selected];
    const filter = $("pntpFilter").value;
    const search = normalized($("pntpSearch").value.trim());
    let count = 0;
    const shown = entity.criterios.flatMap(criterion => {
      if (search && !normalized(criterion.texto + " " + criterion.dimensao + " " + criterion.exigibilidade).includes(search)) return [];
      const items = criterion.itens.filter(item => filter === "todos" || item.atendido === (filter === "atendidos"));
      if (!items.length) return [];
      count += items.length;
      const pending = criterion.itens.filter(item => !item.atendido).length;
      const label = pending === 0 ? "Atendido" : pending === criterion.itens.length ? "Pendente" : "Parcialmente atendido";
      return [`<details class="pntp-criterion"><summary><span>${esc(criterion.texto)}</span><small>${esc(criterion.dimensao)} · ${esc(criterion.exigibilidade)} · ${label}</small></summary><ul>${items.map(item => `<li><strong class="${item.atendido ? "pntp-answer--yes" : "pntp-answer--no"}">${item.atendido ? "Atendido" : "Pendente"}</strong> · ${esc(item.nome)}<div class="pntp-evidence">${item.evidencias.map(evidenceLink).join("") || "Sem link de evidência informado para este item."}</div></li>`).join("")}</ul></details>`];
    });
    $("pntpCriteria").innerHTML = shown.join("");
    $("pntpResultsStatus").textContent = count
      ? `${number(count)} itens de verificação em ${number(shown.length)} critérios. Na autoavaliação completa: ${entity.itens_atendidos} itens atendidos e ${entity.itens_pendentes} pendentes.`
      : "Nenhum item encontrado com estes filtros. Tente outro termo ou selecione todas as respostas.";
  }

  async function loadCriteria() {
    if (reference) { renderCriteria(); return; }
    $("pntpRetry").hidden = true;
    $("pntpResultsStatus").textContent = "Carregando respostas da base oficial de 2025…";
    $("pntpCriteria").setAttribute("aria-busy", "true");
    // Compartilha uma única requisição ao trocar de órgão durante o carregamento.
    if (!loading) loading = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch("data/referencias/pntp-2025.json", { signal: controller.signal });
        if (!response.ok) throw new Error("Referência indisponível");
        const data = await response.json();
        if (data.ciclo !== 2025 || !["prefeitura", "camara"].every(key => data.orgaos?.[key]?.ibge === "3170701" && Array.isArray(data.orgaos[key].criterios))) throw new Error("Referência incompatível");
        reference = data;
      } finally { clearTimeout(timeout); }
    })();
    try {
      await loading;
      renderCriteria();
    } catch (_) {
      $("pntpResultsStatus").textContent = "Não foi possível carregar os critérios. Tente novamente ou consulte os dados abertos oficiais pelo link acima. As notas publicadas continuam disponíveis.";
      $("pntpRetry").hidden = false;
    } finally {
      loading = null;
      $("pntpCriteria").removeAttribute("aria-busy");
    }
  }

  const buttons = [...panel.querySelectorAll("[data-pntp-orgao]")];
  buttons.forEach(button => {
    button.disabled = false;
    button.addEventListener("click", () => {
      opener = button;
      selected = button.dataset.pntpOrgao;
      buttons.forEach(other => other.setAttribute("aria-expanded", String(other === button)));
      $("pntpFilter").value = button.dataset.pntpFiltro;
      $("pntpSearch").value = "";
      $("pntpDetailsTitle").textContent = `${selected === "prefeitura" ? "Prefeitura" : "Câmara Municipal"} · critérios de 2025`;
      $("pntpDetails").hidden = false;
      $("pntpDetailsTitle").focus({ preventScroll: true });
      $("pntpDetails").scrollIntoView({ block: "start" });
      loadCriteria();
    });
  });
  $("pntpFilter").addEventListener("change", renderCriteria);
  $("pntpSearch").addEventListener("input", renderCriteria);
  $("pntpRetry").addEventListener("click", loadCriteria);
  $("pntpClose").addEventListener("click", () => {
    $("pntpDetails").hidden = true;
    buttons.forEach(button => button.setAttribute("aria-expanded", "false"));
    opener?.focus();
  });

  function cnpjState(value) {
    const text = String(value ?? "").trim();
    if (!text) return "ausente";
    if (/[*•]/.test(text)) return "mascarado";
    if (/[a-z]/i.test(text)) return "naoVerificado";
    if (/[^\d./\s-]/.test(text)) return "invalido";
    const digits = text.replace(/\D/g, "");
    if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return "invalido";
    for (let length = 12; length <= 13; length++) {
      let sum = 0;
      for (let i = 0; i < length; i++) sum += Number(digits[i]) * ((length - 1 - i) % 8 + 2);
      const rest = sum % 11;
      if (Number(digits[length]) !== (rest < 2 ? 0 : 11 - rest)) return "invalido";
    }
    return "valido";
  }

  function sourceDate(source) {
    if (!source?.source_updated_at) return "Data da última base completa: não informada.";
    const date = new Date(source.source_updated_at);
    return Number.isNaN(date.getTime()) ? "Data da fonte: não informada." : `Data informada nos metadados da fonte: ${date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`;
  }

  function renderLocal() {
    const data = window.FISCALIZA_DATA || {};
    const contracts = data.prefeitura?.contratos;
    if (Array.isArray(contracts)) {
      if (!contracts.length) $("pntpLocalPref").textContent = "Sem contratos disponíveis para esta verificação. Nenhuma porcentagem calculada.";
      else {
        const filled = contracts.filter(c => String(c.objeto || "").trim().length >= 25).length;
        const source = data.status_fontes?.domains?.prefeitura;
        $("pntpLocalPref").innerHTML = `<strong class="pntp-local__value">${percent(filled, contracts.length)}</strong><p>${number(filled)} de ${number(contracts.length)} contratos têm descrição com ao menos 25 caracteres. Isso mede preenchimento, não clareza do texto.</p><p class="pntp-local__meta">${esc(source?.reason || "Cobertura e atualização integral não verificadas.")} ${esc(sourceDate(source))}</p>`;
      }
    } else if (data.prefeitura === null) $("pntpLocalPref").textContent = "Dados dos contratos indisponíveis nesta consulta. Recarregue a página para tentar novamente.";
    const amendments = data.emendas;
    if (Array.isArray(amendments)) {
      if (!amendments.length) $("pntpLocalCam").textContent = "Sem emendas disponíveis para esta verificação. Nenhuma porcentagem calculada.";
      else {
        const counts = { valido: 0, invalido: 0, ausente: 0, mascarado: 0, naoVerificado: 0 };
        amendments.forEach(e => counts[cnpjState(e.cnpj)]++);
        const years = [...new Set(amendments.map(e => String(e.ano || "")).filter(y => /^\d{4}$/.test(y)))].sort();
        const corrected = amendments.filter(e => e.cnpjCorrecao).length;
        $("pntpLocalCam").innerHTML = `<strong class="pntp-local__value">${percent(counts.valido, amendments.length)}</strong><p>${number(counts.valido)} de ${number(amendments.length)} emendas têm CNPJ numérico com formato e dígitos verificadores válidos.</p><p>${counts.invalido} inconsistentes · ${counts.ausente} ausentes · ${counts.mascarado} mascarados · ${counts.naoVerificado} em formato não verificado.</p>${corrected ? `<p>${corrected} CNPJs corrigidos com fonte oficial e valor original preservado. <a href="emendas/">Conferir nas emendas</a>.</p>` : ""}<p class="pntp-local__meta">Anos registrados no SAPL: ${esc(years.join(", ") || "não informados")}. O ano da matéria não comprova o exercício de execução. A validação não consulta a situação cadastral na Receita Federal. Data de atualização específica desta base de emendas: não informada.</p>`;
      }
    } else if (amendments === null) $("pntpLocalCam").textContent = "Dados das emendas indisponíveis nesta consulta. Recarregue a página para tentar novamente.";
  }
  window.addEventListener("fiscaliza:app-ready", renderLocal);
  window.addEventListener("fiscaliza:chunk", event => {
    if (["prefeitura", "emendas", "status_fontes"].includes(event.detail?.key)) renderLocal();
  });
  window.addEventListener("fiscaliza:chunk:error", event => {
    const target = { prefeitura: "pntpLocalPref", emendas: "pntpLocalCam" }[event.detail?.key];
    if (target) $(target).textContent = "Falha ao carregar os dados. Recarregue a página para tentar novamente. A referência PNTP permanece disponível.";
  });
  renderLocal();
})();
