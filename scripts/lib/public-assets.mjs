import fs from "node:fs";
import path from "node:path";

// Referências estáticas do carregador, cache offline, HTML e CSS precisam
// existir no pacote. Assim uma nova dependência não depende só da lista manual.
export function missingPublicAssets(root) {
  const missing = new Set();
  function check(from, reference) {
    if (!reference || /^(?:[a-z]+:|\/\/|#)/i.test(reference) || /[${}<>]/.test(reference)) return;
    const relative = reference.split(/[?#]/)[0];
    if (!/\.(?:js|css|woff2?|svg|png|jpe?g|webp|ico)$/i.test(relative)) return;
    const target = relative.startsWith("/")
      ? path.resolve(root, "." + relative)
      : path.resolve(path.dirname(from), relative);
    if (!target.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(target)) {
      missing.add(`${path.relative(root, from)}: ${reference}`);
    }
  }
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["data", "docs", "fonts", "assets"].includes(entry.name)) walk(file);
        continue;
      }
      if (!/\.(?:html|css)$/.test(entry.name) && !["data-loader.js", "sw.js"].includes(entry.name)) continue;
      const text = fs.readFileSync(file, "utf8");
      const patterns = entry.name.endsWith(".html")
        ? [/(?:src|href)\s*=\s*["']([^"']+)["']/gi]
        : entry.name.endsWith(".css")
          ? [/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi]
          : [/["']((?:\.\/)?(?:modules\/|fonts\/)[^"']+)["']/g];
      for (const pattern of patterns) for (const match of text.matchAll(pattern)) check(file, match[1]);
    }
  }
  walk(root);
  return [...missing].sort();
}
