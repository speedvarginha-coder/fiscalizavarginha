import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Regressao sobre o artefato gerado. A logica em si e testada com casos
// sinteticos em classificar-sancoes.spec.js — este arquivo garante que o
// alerta efetivamente publicado nao volte a afirmar alcance sem base.

const CHUNK = path.resolve("painel-cidadao/data/chunks/auditoria_dados.json");
const STATUS_FONTES = path.resolve("painel-cidadao/data/chunks/status_fontes.json");
const itens = () => JSON.parse(fs.readFileSync(CHUNK, "utf8")).items || [];
const acha = (id) => itens().find((i) => i.id === id);

test.describe("Alertas de sancao no artefato publicado", () => {
  test("nenhum alerta deduz alcance do rotulo da sancao", () => {
    // A frase que causou o erro de 04/08/2026: afirmar alcance geral porque o
    // tipo se chama "inidoneidade", sem olhar a abrangencia do registro.
    for (const item of itens()) {
      if (!/sancao|fornecedor/i.test(item.id)) continue;
      const texto = `${item.title} ${item.detail}`;
      const afirmaGeral = /alcanca a administracao publica de todos os entes/i.test(texto);
      if (afirmaGeral) {
        expect(texto, `alerta ${item.id} afirma alcance geral sem citar abrangencia`)
          .toMatch(/abrangencia/i);
      }
    }
  });

  test("alerta nominal, quando existir, carrega o dossie minimo", () => {
    const alerta = acha("sancao-com-alcance-sobre-varginha");
    if (!alerta) test.skip(true, "nenhum registro nominavel na base atual");
    // Descreve a fonte, nao rotula a empresa.
    expect(alerta.detail).toMatch(/classificado pelo orgao informante/i);
    expect(alerta.detail).toMatch(/abrangencia/i);
    expect(alerta.detail).toMatch(/processo/i);
    expect(alerta.detail).toMatch(/verific/i);
    expect(alerta.detail).not.toMatch(/empresa inidonea|fornecedor irregular|contratacao ilegal/i);
  });

  test("incompatibilidade contratual nunca e afirmada como ilegalidade", () => {
    const alerta = acha("possivel-incompatibilidade-contratual");
    if (!alerta) test.skip(true, "nenhum caso na base atual");
    expect(alerta.detail).toMatch(/possivel incompatibilidade a esclarecer/i);
    expect(alerta.detail).not.toMatch(/contratacao ilegal(?!\s*")/i);
    expect(alerta.verification.limitacoes.join(" ")).toMatch(/nao prova/i);
  });

  test("sancoes de outros entes seguem sem afirmar impedimento local", () => {
    const alerta = acha("fornecedor-sancionado-outro-ente");
    if (!alerta) test.skip(true, "sem sancoes de outros entes na base atual");
    expect(alerta.detail).toMatch(/nao impedem, por si, contratar com Varginha/i);
    expect(alerta.severity).toBe("warning");
  });

  test("registro sem alcance determinado nao nomeia ninguem", () => {
    const alerta = acha("sancoes-sem-alcance-determinado");
    if (!alerta) test.skip(true, "nenhum registro sem alcance na base atual");
    expect(alerta.detail).toMatch(/fora de qualquer alerta nominal/i);
    // Sem razao social no texto: o alerta e agregado por construcao.
    expect(alerta.detail).not.toMatch(/\bLTDA\b|\bEIRELI\b|\bS\/A\b/);
  });

  test("a base de sancoes traz o campo de abrangencia", () => {
    const base = path.resolve("painel-cidadao/data/chunks/sancoes.json");
    const achados = JSON.parse(fs.readFileSync(base, "utf8")).achados || [];
    if (!achados.length) test.skip(true, "base de sancoes vazia");
    // Sem este campo o sistema inteiro cai em revisao humana — o que e seguro,
    // mas inutiliza o cruzamento. Falhar aqui sinaliza coleta incompleta.
    expect(achados[0]).toHaveProperty("abrangencia");
    expect(achados[0]).toHaveProperty("numero_processo");
    expect(achados[0]).toHaveProperty("link_registro");
  });

  test("fonte contratual parcial ou preservada suspende cruzamentos nominais", () => {
    const domains = JSON.parse(fs.readFileSync(STATUS_FONTES, "utf8")).domains || {};
    const statuses = [domains.prefeitura?.status, domains.camara_betha?.status];
    const fonteNaoIntegral = statuses.some((status) => ["partial", "preserved", "stale", "error"].includes(status));
    if (!fonteNaoIntegral) test.skip(true, "fontes contratuais integrais na base atual");

    const ids = new Set(itens().map((item) => item.id));
    expect(ids).toContain("auditoria-vinculos-suspensa-por-frescor");
    expect(ids).not.toContain("prefeitura-despesa-sem-contrato");
    expect(ids).not.toContain("camara-despesa-sem-contrato");
    expect(ids).not.toContain("possivel-incompatibilidade-contratual");
  });
});
