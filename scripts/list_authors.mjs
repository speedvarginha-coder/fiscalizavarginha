import { readFileSync } from 'fs';
const c = readFileSync('painel-cidadao/emendas/data/emendas_federais.js', 'utf8');
const m = c.matchAll(/"autor":\s*"([^"]+)"/g);
const s = new Set();
for (const x of m) s.add(x[1]);
[...s].sort().forEach(a => console.log(a));
