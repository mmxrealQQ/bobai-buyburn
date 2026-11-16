// OTHER AGENTS' LOGOS, KEPT HERE SMALL (2026-11-16, Liste A of the 15.11. review): /registry drew 29 logos straight
// from their owners' hosts — 1.8 MB for 34-px squares (six of them 190-290 KB), two answering 401 and two 404. This
// fetches each logo the registry can show once, writes it as a 76 x 76 WebP (2x the largest place it is drawn) to
// dashboard/logos/x/<fnv>.webp, and lists in dashboard/logos/x/index.json which are here and which were broken. The
// site worker and the page's own script use a copy where there is one and the owner's URL where there is none, so a
// logo that arrives after a run still shows; a broken one is not asked for at all.
//
//   node scripts/logo-cache.mjs              fetch what is missing (and retry the broken), then write index.json
//   node scripts/logo-cache.mjs --self-test  the name function and the index, offline
//
// The name is FNV-1a 32-bit of the exact URL, as 8 hex digits — the page computes the same in a line of JS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'dashboard', 'logos', 'x'), INDEX = path.join(DIR, 'index.json');
const SIZE = 76, MAX_BYTES = 8 * 1024 * 1024;

export function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const usable = (u) => typeof u === 'string' && /^https:\/\//.test(u) && u.length < 300 && !/[ "'<>]/.test(u) && !/^https:\/\/(www\.)?brainonbnb\.com\//.test(u);

if (process.argv.includes('--self-test')) {
  const fails = [];
  // pinned values: the page's copy of fnv must give the same names
  if (fnv('') !== '811c9dc5') fails.push('fnv("")');
  if (fnv('https://www.bothire.io/icon.png') !== fnv('https://www.bothire.io/icon.png') || fnv('a') === fnv('b')) fails.push('fnv stable/distinct');
  if (fnv('a') !== 'e40c292c') fails.push('fnv("a") = ' + fnv('a'));
  if (!usable('https://x.y/a.png') || usable('http://x.y/a.png') || usable('https://brainonbnb.com/logo.png') || usable('https://x.y/a b.png')) fails.push('usable()');
  // the worker's browser copy names a logo the same way, and the page and its generator draw their late logos through it
  const w = fs.readFileSync(path.join(ROOT, 'dashboard', '_worker.js'), 'utf8');
  const js = (w.match(/const LOGO_JS = "([^"]+)";/) || [])[1];
  if (!js) fails.push('LOGO_JS missing in the worker');
  else {
    const window = {}; new Function('window', 'rgL', js.replace(/^window\.rgL=/, 'window.rgL=') + '; return window;')(window);
    const u = 'https://ui-avatars.com/api/?name=SG&background=1a1a2e&size=256';
    window.RG_LOGOS = [fnv(u)];
    if (window.rgL(u) !== `/logos/x/${fnv(u)}.webp`) fails.push('the page names a logo otherwise than this script: ' + window.rgL(u));
    if (window.rgL('https://other.example/a.png') !== 'https://other.example/a.png') fails.push('a logo not kept must stay the owner URL');
  }
  if (!/fnv32\(String\(e\.getAttribute\('src'\)/.test(w) || !/window\.RG_LOGOS=/.test(w)) fails.push('the worker does not rewrite /registry logos');
  for (const f of ['dashboard/registry.html', 'scripts/erc8004-publish.mjs']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (!s.includes("esc(window.rgL?rgL(u):u)") || !s.includes("esc(window.rgL?rgL(a.logo):a.logo)")) fails.push(f + ' draws its late logos without rgL');
  }
  if (fs.existsSync(INDEX)) {
    const ix = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
    const missing = (ix.ok || []).filter((h) => !fs.existsSync(path.join(DIR, h + '.webp')));
    if (missing.length) fails.push(`${missing.length} logos listed as kept but not on disk (${missing.slice(0, 3).join(', ')})`);
    if ((ix.ok || []).some((h) => (ix.broken || []).includes(h))) fails.push('a logo both kept and broken');
  }
  console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'logo names pinned, the index matches the files');
  process.exit(fails.length ? 1 : 0);
}

const sharp = (await import('sharp')).default;
fs.mkdirSync(DIR, { recursive: true });
const ix = fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, 'utf8')) : { ok: [], broken: [] };
const ok = new Set(ix.ok), broken = new Set();

// every logo the registry page can draw: the agents that answer (static rows and the search), the listings, the screener
const want = new Set();
const agents = JSON.parse(fs.readFileSync(path.join(ROOT, 'dashboard', 'api-agents.json'), 'utf8'));
for (const a of Array.isArray(agents) ? agents : agents.agents || []) if (usable(a.image)) want.add(a.image);
for (const m of fs.readFileSync(path.join(ROOT, 'dashboard', 'registry.html'), 'utf8').matchAll(/<img[^>]+src="(https:[^"]+)"/g)) { const u = m[1].replace(/&amp;/g, '&'); if (usable(u)) want.add(u); }
const get = (u) => fetch(u, { headers: { 'user-agent': 'brainonbnb-logo-cache' }, signal: AbortSignal.timeout(15000) }).then((r) => r.json()).catch(() => null);
const li = await get('https://agent.brainonbnb.com/listings');
for (const l of li?.listings || []) if (usable(l.image)) want.add(l.image);
const sc = await get('https://agent.brainonbnb.com/screener');
if (sc?.fields) { const i = sc.fields.indexOf('logo'); for (const r of sc.rows || []) if (usable(r[i])) want.add(r[i]); }

let made = 0, kept = 0, bad = 0, bytesIn = 0, bytesOut = 0;
const todo = [...want];
async function one(u) {
  const h = fnv(u), file = path.join(DIR, h + '.webp');
  if (ok.has(h) && fs.existsSync(file)) { kept++; return; }
  try {
    const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (brainonbnb logo cache)' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\//.test(type)) throw new Error(`${r.status} ${type}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('too large');
    const out = await sharp(buf, { limitInputPixels: 40e6, animated: false }).resize(SIZE, SIZE, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
    fs.writeFileSync(file, out);
    ok.add(h); made++; bytesIn += buf.length; bytesOut += out.length;
  } catch (e) {
    ok.delete(h); broken.add(h); bad++;
    if (fs.existsSync(file)) fs.rmSync(file);
    console.log(`  broken ${h} ${String(e.message || e).slice(0, 60)} ${u.slice(0, 90)}`);
  }
}
for (let i = 0; i < todo.length; i += 8) await Promise.all(todo.slice(i, i + 8).map(one));
// only what is wanted now stays listed; files of logos no longer wanted are left (a rerun is cheap, a deletion is not)
const wantH = new Set(todo.map(fnv));
fs.writeFileSync(INDEX, JSON.stringify({ at: new Date().toISOString(), size: SIZE, ok: [...ok].filter((h) => wantH.has(h)).sort(), broken: [...broken].sort() }) + '\n');
console.log(`logos: ${want.size} wanted · ${made} new (${(bytesIn / 1024).toFixed(0)} KB -> ${(bytesOut / 1024).toFixed(0)} KB) · ${kept} kept · ${bad} broken`);
