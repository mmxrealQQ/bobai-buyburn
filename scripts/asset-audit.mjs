// Loads every page from the live site and checks that everything it references
// actually exists.
//
// The static audit reads files and catches what is structurally wrong. This
// catches what is wrong at runtime: an image that 404s, a stylesheet that was
// renamed, a script the page asks for and never gets. Those are invisible in
// the source — the tag is right there — and obvious to any visitor.
//
// Checks the live site rather than the working copy on purpose. What matters is
// what is served, and the two differ every time something is built but not
// deployed.
//
// Usage: node scripts/asset-audit.mjs
import fs from 'node:fs';
import path from 'node:path';

const SITE = 'https://brainonbnb.com';
const ROOT = path.resolve(import.meta.dirname, '..');
const DASH = path.join(ROOT, 'dashboard');

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'code') walk(p, out); }
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
};

const pages = walk(DASH)
  .map((p) => '/' + path.relative(DASH, p).replace(/\\/g, '/'))
  .map((p) => p.replace(/index\.html$/, '').replace(/\.html$/, ''))
  .filter((p) => !p.includes('debug-ua') && !p.includes('for-designer'));

const findings = [];
const seen = new Map(); // one HEAD per unique asset, however many pages use it

const check = async (url) => {
  if (seen.has(url)) return seen.get(url);
  const p = (async () => {
    try {
      const r = await fetch(url, { method: 'GET', headers: { range: 'bytes=0-256' }, signal: AbortSignal.timeout(15000) });
      const body = await r.text();
      // The site answers unrouted paths with 200 and the dashboard HTML, so an
      // asset request that comes back as a document is a missing asset wearing
      // a 200. This is the check the status code cannot make.
      const isHtml = /^\s*<!doctype html/i.test(body);
      const wantsHtml = /\.html?$|\/$/.test(new URL(url).pathname) || !/\.[a-z0-9]{2,5}$/i.test(new URL(url).pathname);
      return { ok: r.ok && (wantsHtml || !isHtml), status: r.status, fellBackToHtml: isHtml && !wantsHtml };
    } catch (e) { return { ok: false, status: 0, error: String(e.message || e).slice(0, 40) }; }
  })();
  seen.set(url, p);
  return p;
};

console.log(`\nAsset audit — ${pages.length} live pages\n`);

for (const page of pages) {
  const url = SITE + page;
  let html;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    html = await r.text();
    if (!r.ok) { findings.push([page, 'page itself', `HTTP ${r.status}`]); continue; }
  } catch (e) { findings.push([page, 'page itself', String(e.message).slice(0, 40)]); continue; }

  const refs = new Set();
  // src= and href= on things that must resolve. Anchors to other pages are the
  // static audit's job; this is about assets the browser fetches automatically.
  for (const m of html.matchAll(/<(?:img|script|source)[^>]+src="([^"]+)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"[^>]*>/g)) {
    const tag = m[0];
    if (/rel="(stylesheet|icon|shortcut icon|apple-touch-icon|preload)"/.test(tag)) refs.add(m[1]);
  }
  for (const m of html.matchAll(/(?:og:image|twitter:image)"\s+content="([^"]+)"/g)) refs.add(m[1]);

  for (const ref of refs) {
    if (/^(data:|blob:|https?:\/\/(?!brainonbnb\.com))/i.test(ref)) continue; // third-party is not ours to fix
    // Placeholders written by scripts at runtime are not references.
    if (ref.includes('${') || ref.includes('{{')) continue;
    // A page served at "/nft/" IS the directory; dirname would hand back "/"
    // and every relative reference on it would be looked for at the site root.
    // That produced sixteen confident reports about files that were all there.
    const base = page.endsWith('/') ? page : path.posix.dirname(page) + '/';
    const abs = ref.startsWith('http') ? ref
      : ref.startsWith('/') ? SITE + ref
      : SITE + path.posix.join(base, ref);
    const res = await check(abs);
    if (!res.ok) {
      findings.push([page, ref, res.fellBackToHtml ? 'served the dashboard HTML instead' : (res.error || `HTTP ${res.status}`)]);
    }
  }
  process.stdout.write('.');
}

console.log('\n');
if (!findings.length) {
  console.log(`No missing assets across ${pages.length} pages (${seen.size} unique references checked).\n`);
} else {
  const byPage = {};
  findings.forEach(([p, r, w]) => { (byPage[p] ||= []).push([r, w]); });
  for (const [p, list] of Object.entries(byPage)) {
    console.log(p);
    list.forEach(([r, w]) => console.log(`   ${r}  —  ${w}`));
  }
  console.log(`\n${findings.length} broken references across ${Object.keys(byPage).length} pages\n`);
  process.exit(1);
}
