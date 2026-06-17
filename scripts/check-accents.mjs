#!/usr/bin/env node
/**
 * Lint de acentuação — pega palavras PT comuns sem acento em TEXTO VISÍVEL.
 * Escopo: HTML do painel. Remove <script>/<style>, tags e atributos (href, id,
 * class, value...) ANTES de checar, então nomes de arquivo/seletores não geram
 * falso-positivo. Lista curada de palavras que nunca são corretas sem acento
 * em texto exibido ao cidadão.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "painel-cidadao");

// palavra-sem-acento -> forma correta (só palavras seguras, de exibição)
const WORDS = {
  "voce": "você", "orcamento": "orçamento", "informacao": "informação",
  "informacoes": "informações", "semaforo": "semáforo", "endereco": "endereço",
  "servico": "serviço", "servicos": "serviços", "relatorio": "relatório",
  "gestao": "gestão", "opiniao": "opinião", "remuneracao": "remuneração",
  "pendencia": "pendência", "pendencias": "pendências", "orgao": "órgão",
  "orgaos": "órgãos", "comprovacao": "comprovação", "conclusao": "conclusão",
  "producao": "produção", "atencao": "atenção", "diario": "diário",
  "publico": "público", "publicos": "públicos", "transparencia": "transparência",
};
const RE = new RegExp("\\b(" + Object.keys(WORDS).join("|") + ")\\b", "gi");

function textoVisivel(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")                       // remove tags (e atributos)
    .replace(/https?:\/\/\S+/gi, " ")               // URLs completas
    .replace(/\b[\w.-]+\.(?:br|com|gov|org|leg|net|mg)\b\S*/gi, " ") // domínios/paths visíveis
    .replace(/&[a-z]+;/gi, " ");                    // entidades
}

let total = 0;
const arquivos = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
for (const f of arquivos) {
  const html = readFileSync(join(ROOT, f), "utf8");
  // checa linha a linha para reportar nº da linha, mas só sobre o texto visível
  const linhas = html.split("\n");
  linhas.forEach((linha, i) => {
    const visivel = textoVisivel(linha);
    let m;
    RE.lastIndex = 0;
    while ((m = RE.exec(visivel)) !== null) {
      const palavra = m[1].toLowerCase();
      console.log(`  ${f}:${i + 1}  "${m[1]}" -> "${WORDS[palavra]}"`);
      total++;
    }
  });
}

if (total === 0) {
  console.log("OK — nenhuma palavra de exibição sem acento encontrada.");
  process.exit(0);
} else {
  console.log(`\n${total} ocorrência(s) de acento faltando em texto visível.`);
  process.exit(1);
}
