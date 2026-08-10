#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destino = path.join(root, "private", "state", "site_performance.json");
const url = process.argv.find((arg) => arg.startsWith("--url="))?.slice(6)
  || "https://fiscalizavarginha.com.br/";
const estrito = process.argv.includes("--strict");
// O primeiro acesso inclui DNS/TLS e a latência compartilhada da hospedagem.
// O orçamento principal permanece no conteúdo utilizável (DOM/LCP), enquanto
// 3s de resposta ainda detectam degradação real sem alarmar por uma amostra fria.
const limites = { resposta_ms: 3_000, dom_interativo_ms: 4_000, lcp_ms: 4_500, cls: 0.15 };
const errosHttp = [];
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    ...devices["Pixel 5"],
    locale: "pt-BR",
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__fiscalizaVitals = { lcp: 0, cls: 0, layout_shifts: [] };
    try {
      new PerformanceObserver((list) => {
        const entradas = list.getEntries();
        const ultima = entradas[entradas.length - 1];
        if (ultima) window.__fiscalizaVitals.lcp = ultima.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entrada of list.getEntries()) {
          if (!entrada.hadRecentInput) {
            window.__fiscalizaVitals.cls += entrada.value;
            window.__fiscalizaVitals.layout_shifts.push({
              valor: Number(entrada.value.toFixed(4)),
              instante_ms: Math.round(entrada.startTime),
              fontes: Array.from(entrada.sources || []).slice(0, 5).map((fonte) => {
                const no = fonte.node;
                if (!no) return "elemento removido";
                const id = no.id ? `#${no.id}` : "";
                const classes = typeof no.className === "string"
                  ? no.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((nome) => `.${nome}`).join("")
                  : "";
                return `${String(no.tagName || "elemento").toLowerCase()}${id}${classes}`;
              }),
            });
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errosHttp.push({ status: response.status(), url: response.url() });
  });
  const inicio = Date.now();
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForSelector("body", { state: "visible" });
  await page.waitForTimeout(3_000);
  const metricas = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      resposta_ms: Math.round(nav?.responseStart || 0),
      dom_interativo_ms: Math.round(nav?.domInteractive || 0),
      lcp_ms: Math.round(window.__fiscalizaVitals?.lcp || 0),
      cls: Number((window.__fiscalizaVitals?.cls || 0).toFixed(4)),
      layout_shifts: (window.__fiscalizaVitals?.layout_shifts || [])
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 10),
      dados_prontos: Boolean(window.FISCALIZA_DATA?.home_resumo?.total_externo_atual),
    };
  });
  const falhas = [];
  if (!response?.ok()) falhas.push(`HTTP principal ${response?.status() || "sem resposta"}`);
  for (const [metrica, limite] of Object.entries(limites)) {
    if (metricas[metrica] > limite) falhas.push(`${metrica} ${metricas[metrica]} > ${limite}`);
  }
  if (!metricas.dados_prontos) falhas.push("resumo inicial de dados não ficou pronto");
  if (errosHttp.length) falhas.push(`${errosHttp.length} recurso(s) HTTP com erro`);
  const relatorio = {
    schema: 1,
    medido_em: new Date().toISOString(),
    url,
    perfil: "Pixel 5, navegador limpo",
    duracao_observada_ms: Date.now() - inicio,
    metricas,
    limites,
    erros_http: errosHttp.slice(0, 20),
    status: falhas.length ? "alerta" : "ok",
    falhas,
    privacidade: "Medição sintética; nenhum visitante, cookie, IP ou identificador é coletado.",
  };
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const temporario = `${destino}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(relatorio, null, 2) + "\n");
  fs.renameSync(temporario, destino);
  console.log(JSON.stringify(relatorio, null, 2));
  if (estrito && falhas.length) process.exitCode = 1;
} finally {
  await browser.close();
}
