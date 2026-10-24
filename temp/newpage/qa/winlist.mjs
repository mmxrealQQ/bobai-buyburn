// every page of the site that some page links to, against the list of pages a window opens (embed.js)
import fs from 'node:fs';
import path from 'node:path';
const src = fs.readFileSync('D:/ai/fourmeme/temp/newpage/embed.js', 'utf8');
const inner = src.slice(src.indexOf('const PAGES = /^') + 'const PAGES = /^'.length);
const list = new Set(inner.slice(inner.indexOf('(') + 1, inner.indexOf(')')).split('|'));
const root = 'D:/ai/fourmeme/dashboard';
const files = fs.readdirSync(root).filter((f) => f.endsWith('.html')).map((f) => path.join(root, f));
const seen = new Map();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/href="\/([a-z0-9_-]*)[^"]*"/gi)) {
    const seg = m[1].toLowerCase();
    if (!seen.has(seg)) seen.set(seg, new Set());
    seen.get(seg).add(path.basename(f));
  }
}
const skip = new Set(['', 'code', 'fonts', 'og', 'join', 'mcp', 'api', 'logs']);
const missing = [...seen].filter(([k]) => !list.has(k) && !skip.has(k));
console.log('window list:', [...list].join(' '));
console.log('linked pages a window does not open:', missing.map(([k, v]) => k + ' <- ' + [...v].slice(0, 4).join(',')).join(' | ') || 'none');
