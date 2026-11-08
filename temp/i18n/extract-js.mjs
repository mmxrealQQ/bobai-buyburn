// Arabic A-Z: the sentences a script shows, read straight from its source (the terminal speaks thousands of lines that a
// crawl never sees all of). Every string and template literal with real words is taken; a ${...} inside a template is
// stood in for by a figure ("7"), so core.js makes the same key the shown line will have when the expression is a number
// or an amount. Comments and regex literals are skipped. Prints the keys that ar.json does not have yet.
// Usage: node extract-js.mjs <file.js> [out.json]
import fs from 'node:fs';
const [file, outFile] = process.argv.slice(2);
const src = fs.readFileSync(file, 'utf8');
const core = await import('file:///' + 'D:/temp/claude/e7b6f1c290614a0a/ed077342-cc55-4911-abf2-f86f9ad95272/scratchpad/core.mjs');
const dict = JSON.parse(fs.readFileSync('D:/ai/fourmeme/dashboard/i18n/ar.json', 'utf8')).t;
const out = [];
let i = 0, prevSig = ''; // last significant char, to tell a regex from a division
const regexOk = () => !prevSig || /[(,=:[!&|?{};+\-*%<>~^]/.test(prevSig) || /\b(return|typeof|case|in|of)$/.test(src.slice(Math.max(0, i - 7), i).trimEnd());
function readString(q) { // i at the opening quote
  let s = ''; i++;
  while (i < src.length && src[i] !== q) { if (src[i] === '\\') { s += src[i + 1] === 'n' ? ' ' : src[i + 1]; i += 2; continue; } if (src[i] === '\n') break; s += src[i++]; }
  i++; return s;
}
function readTemplate() { // i at the backtick; returns the text with ${} stood in by 7
  let s = ''; i++;
  while (i < src.length && src[i] !== '`') {
    if (src[i] === '\\') { s += src[i + 1] === 'n' ? ' ' : src[i + 1]; i += 2; continue; }
    if (src[i] === '$' && src[i + 1] === '{') { i += 2; skipExpr(); s += '7'; continue; }
    s += src[i++];
  }
  i++; return s;
}
function skipExpr() { // inside ${ ... }: balanced, with its own strings and templates (collected too)
  let depth = 1;
  while (i < src.length && depth) {
    const c = src[i];
    if (c === '{') { depth++; i++; } else if (c === '}') { depth--; i++; }
    else if (c === "'" || c === '"') take(readString(c));
    else if (c === '`') take(readTemplate());
    else i++;
  }
}
function take(s) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length < 4 || !/[A-Za-z]{2,}[^A-Za-z]+[A-Za-z]{2,}/.test(t) && !/^[A-Z][a-z]{3,}$/.test(t)) return;
  if (/^[.#\[][\w-]|[{};]\s*$|^\w+:\/\/|^[\w-]+\s*\(|=>|^(?:[a-z-]+:[^ ]+;?)+$|\b(?:px|rgba?|var\(--|translate\(|cubic-bezier)\b|^[a-z][\w-]*( [a-z][\w-]*)*$/.test(t) && !/[A-Z]/.test(t[0])) return; // CSS, selectors, code, class lists
  const k = core.keyOf(t); if (!k) return;
  out.push(k.key);
}
while (i < src.length) {
  const c = src[i], n = src[i + 1];
  if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
  if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
  if (c === "'" || c === '"') { take(readString(c)); prevSig = c; continue; }
  if (c === '`') { take(readTemplate()); prevSig = '`'; continue; }
  if (c === '/' && regexOk()) { i++; let cls = false; while (i < src.length && src[i] !== '\n') { if (src[i] === '\\') { i += 2; continue; } if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; else if (src[i] === '/' && !cls) break; i++; } i++; while (/[a-z]/.test(src[i] || '')) i++; prevSig = ')'; continue; }
  if (!/\s/.test(c)) prevSig = /[\w$]/.test(c) ? (/[\w$]/.test(prevSig) || !prevSig ? prevSig + c : c).slice(-8) : c;
  i++;
}
const uniq = [...new Set(out)], missing = uniq.filter((k) => dict[k] == null);
console.log(`${file}: ${uniq.length} sentence keys, ${missing.length} not in the dictionary, ${missing.reduce((s, k) => s + k.split(/\s+/).length, 0)} words`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify(missing, null, 1));
