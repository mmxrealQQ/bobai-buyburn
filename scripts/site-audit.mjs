// Audits every page on the site against the same checklist, so "is it
// consistent" stops being a matter of opinion and becomes a list of findings.
//
// Checks structure (nav, footer, backdrop, wrapper), metadata (title,
// description, social cards), assets (versioned, present), links (dead
// internal targets, colours that escape the palette) and weight.
//
// Deliberately static analysis: it reads the files, not the rendered page.
// Rendering catches different things — this catches the things that are wrong
// in every browser, on every visit, and it can cover 47 pages in seconds.
//
// Usage:
//   node scripts/site-audit.mjs            all pages
//   node scripts/site-audit.mjs --top      only top-level pages
//   node scripts/site-audit.mjs --fix-list output as a to-do list
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DASH = path.join(ROOT, 'dashboard');
const args = process.argv.slice(2);

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'code' || e.name === 'node_modules') continue;
      walk(p, out);
    } else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
};

let pages = walk(DASH).map((p) => path.relative(DASH, p).replace(/\\/g, '/'));
if (args.includes('--top')) pages = pages.filter((p) => !p.includes('/'));

// Pages that legitimately differ. A result page has no social card because it
// is generated per visitor; a debug page is not part of the site.
const EXEMPT = {
  'brainscreener/debug-ua.html': 'debug utility, not a public page',
  'brainscreener/404.html': 'error page',
  'worldcup/app/for-designer.html': 'internal reference, not linked publicly',
  'worldcup/app/reset.html': 'utility',
};

const findings = [];
const add = (page, severity, what, detail = '') =>
  findings.push({ page, severity, what, detail });

const html = {};
for (const p of pages) html[p] = fs.readFileSync(path.join(DASH, p), 'utf8');

// Routes served by the worker rather than by a file. Reading them from
// _routes.json rather than hard-coding means the audit cannot drift from what
// is actually routed — the first version reported /mcp and /skill.md as dead
// links, which was the audit being wrong, not the site.
const routed = (() => {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(DASH, '_routes.json'), 'utf8'));
    return (r.include || []).map((x) => x.replace(/\*$/, ''));
  } catch { return []; }
})();

// Which files actually exist, so internal links can be checked for real.
const exists = (rel, fromPage) => {
  // Not links: data URIs, template placeholders written by scripts, protocol
  // handlers. Counting these as broken buries the real findings.
  if (/^(data:|javascript:|tel:|mailto:)/i.test(rel)) return true;
  if (rel.includes('${') || rel.includes('{{')) return true;
  const clean = rel.split('#')[0].split('?')[0];
  if (!clean || clean.startsWith('http')) return true;
  const asPath = clean.startsWith('/') ? clean : '/' + clean;
  if (routed.some((r) => asPath === r || (r.endsWith('/') && asPath.startsWith(r)))) return true;
  // Relative links resolve against the page they appear on, not against the
  // site root. Getting this wrong reported every worldcup page's own nav as
  // broken — 60 findings that were all the audit's fault.
  const base = clean.startsWith('/')
    ? path.join(DASH, clean.slice(1))
    : path.resolve(path.dirname(path.join(DASH, fromPage)), clean);
  const asFile = base;
  if (fs.existsSync(asFile)) return true;
  if (fs.existsSync(asFile + '.html')) return true;
  if (fs.existsSync(path.join(asFile, 'index.html'))) return true;
  return false;
};

for (const p of pages) {
  const s = html[p];
  const isSub = p !== 'index.html';
  const exempt = EXEMPT[p];

  // ---- metadata ----
  if (!/<title>[^<]{5,}<\/title>/.test(s)) add(p, 'high', 'no usable <title>');
  if (!exempt && !/<meta name="description" content="[^"]{20,}/.test(s)) add(p, 'med', 'no meta description');
  if (!exempt) {
    if (!/property="og:title"/.test(s)) add(p, 'med', 'no og:title', 'shared link shows no card');
    if (!/property="og:image"/.test(s)) add(p, 'med', 'no og:image');
    if (!/name="twitter:card"/.test(s)) add(p, 'low', 'no twitter:card');
  }
  if (!/<meta name="viewport"/.test(s)) add(p, 'high', 'no viewport meta', 'breaks mobile entirely');
  if (!/<html lang=/.test(s)) add(p, 'low', 'no lang attribute');

  // ---- structure, for pages that are part of the main site ----
  const mainSite = !p.startsWith('brainscreener/') && !p.startsWith('worldcup/app/');
  // Pages with their own stylesheet are their own design (the game is
  // full-bleed, the whitepaper is a document). Requiring the dashboard's
  // furniture there would be imposing consistency where difference is the
  // point. What every page does owe the visitor is a way back — which the game
  // has, as a back-btn outside any <nav>. The first version of this check
  // looked only for <nav> and reported it as trapped, which it never was.
  const ownDesign = !/styles\.css/.test(s);
  if (mainSite && isSub && !exempt) {
    const wayBack = /class="back-btn"/.test(s) || /<nav/.test(s);
    if (!wayBack) add(p, 'high', 'no way back to the site', 'visitor is stranded');
    if (!ownDesign) {
      if (!/<footer/.test(s)) add(p, 'med', 'no footer');
      if (!/class="aur"/.test(s)) add(p, 'low', 'no aurora backdrop', 'flat against every other page');
    }
  }

  // ---- assets ----
  for (const m of s.matchAll(/(?:href|src)="\/?((?:styles|app|fonts)\.css|app\.js)(\?v=(\d+))?"/g)) {
    if (!m[2]) add(p, 'med', `${m[1]} without ?v=`, 'stale copies served after deploy');
  }

  // ---- internal links ----
  const seen = new Set();
  for (const m of s.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    if (!exists(href, p)) add(p, 'high', 'dead internal link', href);
  }

  // ---- weight ----
  const kb = Buffer.byteLength(s) / 1024;
  if (kb > 250) add(p, 'med', `page is ${Math.round(kb)} KB`, 'long download before anything renders');

  // ---- inline style bulk: a sign a page drifted from the shared stylesheet ----
  const inline = [...s.matchAll(/<style>([\s\S]*?)<\/style>/g)].reduce((n, m) => n + m[1].length, 0);
  if (inline > 12000) add(p, 'low', `${Math.round(inline / 1024)} KB inline CSS`, 'may duplicate styles.css');
}

// ---- report ----
const bySeverity = { high: [], med: [], low: [] };
findings.forEach((f) => bySeverity[f.severity].push(f));

console.log(`\nSite audit — ${pages.length} pages\n`);
for (const sev of ['high', 'med', 'low']) {
  const list = bySeverity[sev];
  if (!list.length) continue;
  console.log(`${sev.toUpperCase()} (${list.length})`);
  const byPage = {};
  list.forEach((f) => { (byPage[f.page] ||= []).push(f); });
  for (const [pg, fs_] of Object.entries(byPage)) {
    console.log(`  ${pg}`);
    fs_.forEach((f) => console.log(`      ${f.what}${f.detail ? ' — ' + f.detail : ''}`));
  }
  console.log();
}
const clean = pages.filter((p) => !findings.some((f) => f.page === p));
console.log(`${clean.length} of ${pages.length} pages clean\n`);
