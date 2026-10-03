// Lists interface strings passed to t() and data-driven labels that have no Bangla translation.
//   node scripts/i18n-check.mjs            → summary
//   node scripts/i18n-check.mjs --missing  → print every missing string
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
["components", "lib"].forEach(walk);

const strings = new Set();
// Inside marked data tables, skip ids, paths, URLs, colours, CSS classes and SSP codes.
const isText = s => /\p{L}/u.test(s) && !/^[a-z][a-z0-9-]*$/.test(s) && !/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(s) && !/^(\.\.?\/|\/|#|https?:|SSP\d)/.test(s) && !/lazy-loading|^[a-z-]+ [a-z-]+$/.test(s);
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) strings.add(m[1].replace(/\\"/g, '"'));
  // Data tables whose values are translated at render time (marked with an i18n comment).
  for (const block of src.matchAll(/\/\* i18n \*\/([\s\S]*?)\/\* \/i18n \*\//g)) for (const m of block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) if (m[1].length > 1 && isText(m[1])) strings.add(m[1]);
}
const dict = readFileSync("lib/i18n-bn.ts", "utf8");
const keys = new Set([...dict.matchAll(/^\s*"((?:[^"\\]|\\.)*)":/gm)].map(m => m[1].replace(/\\"/g, '"')));
const missing = [...strings].filter(s => !keys.has(s));
const unused = [...keys].filter(k => !strings.has(k));
console.log(`${strings.size} strings · ${keys.size} translated · ${missing.length} missing · ${unused.length} unused`);
if (process.argv.includes("--missing")) for (const s of missing) console.log(JSON.stringify(s));
if (process.argv.includes("--unused")) for (const s of unused) console.log("unused:", JSON.stringify(s));
process.exitCode = process.argv.includes("--strict") && missing.length ? 1 : 0;
