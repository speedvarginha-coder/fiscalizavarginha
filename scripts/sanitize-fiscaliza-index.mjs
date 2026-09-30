#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const target = path.resolve(process.argv[2] || "painel-cidadao");

function removeTopLevelProperty(source, property) {
  const marker = `"${property}":`;
  const propertyStart = source.indexOf(marker);
  if (propertyStart < 0) return source;

  let cursor = propertyStart + marker.length;
  while (/\s/.test(source[cursor])) cursor += 1;
  const opener = source[cursor];
  const closer = opener === "{" ? "}" : opener === "[" ? "]" : null;
  if (!closer) throw new Error(`Formato inesperado para ${property}`);

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        let end = cursor + 1;
        while (source[end] === " " || source[end] === "\r" || source[end] === "\n") end += 1;
        let removeStart = propertyStart;
        if (source[end] === ",") {
          end += 1;
        } else {
          while (removeStart > 0 && /\s/.test(source[removeStart - 1])) removeStart -= 1;
          if (source[removeStart - 1] === ",") removeStart -= 1;
        }
        return source.slice(0, removeStart) + source.slice(end);
      }
    }
  }
  throw new Error(`Fim de ${property} não encontrado`);
}

const dataJs = path.join(target, "data.js");
if (fs.existsSync(dataJs)) {
  const source = fs.readFileSync(dataJs, "utf8");
  const clean = removeTopLevelProperty(source, "indice_relevancia");
  if (clean !== source) fs.writeFileSync(dataJs, clean, "utf8");
}

const manifestPath = path.join(target, "data", "manifest.json");
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.chunks) delete manifest.chunks.indice_relevancia;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

for (const relative of ["data/chunks/indice_relevancia.json", "modules/indice-relevancia.js"]) {
  const file = path.join(target, relative);
  if (fs.existsSync(file)) fs.rmSync(file);
}

console.log(`Fiscaliza sem índice legislativo: ${target}`);
