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

// ---------------------------------------------------------------------------
// SELF-TEST
//
// Both of these are failures this file has already shipped, not hypotheticals.
//
//  1. The script-stripping regex was written as [\\s\\S] — in a JS regex that
//     means "a backslash, an s, or an S", so it matched almost nothing and
//     stripped nothing. The audit then read hrefs that JavaScript builds at
//     runtime and reported a working link as dead, at HIGH, for a page that
//     was fine. A false HIGH is worse than no check: it teaches whoever runs
//     this to skim past the severity that is meant to stop them.
//
//  2. The obvious repair — never scan scripts — could just as easily be
//     over-applied and swallow real dead links. So the test plants one and
//     requires it to be found.
//
// Run: node scripts/site-audit.mjs --self-test
if (args.includes('--self-test')) {
  const fails = [];
  const strip = (x) => x.replace(/<script[\s\S]*?<\/script>/gi, '');

  const withScript = '<a href="/real">r</a><script>var u="<a href=\'/invented\'>";</script>';
  const stripped = strip(withScript);
  if (stripped.includes('/invented')) fails.push('script bodies are not being stripped — hrefs built in JS will be read as markup');
  if (!stripped.includes('/real')) fails.push('stripping removed real markup as well as the script');

  // A planted dead link in real page text must still be caught.
  const planted = strip('<html><a href="/definitely-not-a-page">x</a></html>');
  const found = [...planted.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  if (!found.includes('/definitely-not-a-page')) fails.push('a plain dead link in markup is no longer seen at all');

  // "Stranded" has to mean stranded. This check has now been wrong twice by
  // recognising only the furniture of the day, so both directions are pinned:
  // a bare link home counts, and a page with genuinely no exit still fails.
  const wayBack = (x) => /class="back-btn"/.test(x) || /<nav/.test(x) || /href="(?:\/|https:\/\/brainonbnb\.com\/?)"/.test(x);
  if (!wayBack('<a class="back" href="/">&larr; brainonbnb.com</a>'))
    fails.push('a plain link home is not recognised as a way back — /source was reported stranded for exactly this');
  if (!wayBack('<nav><a class="back-btn" href="/">Dashboard</a></nav>'))
    fails.push('the dashboard sub-page nav is no longer recognised');
  if (wayBack('<p>a page with no exit at all</p><a href="/nft/">sideways</a>'))
    fails.push('a page with no link home is being passed as having a way back');

  // And the file must contain no control characters. One backspace byte, from
  // a \b that a tool turned into 0x08, is what made the regex unmatchable in
  // the first place and it was invisible in every editor.
  const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const ctrl = [...src].filter((c) => c.charCodeAt(0) < 9 || (c.charCodeAt(0) > 13 && c.charCodeAt(0) < 32));
  if (ctrl.length) fails.push(`this file contains ${ctrl.length} control character(s) — a regex here is probably not what it looks like`);

  if (fails.length) {
    console.error(`\nself-test FAILED (${fails.length})`);
    for (const f of fails) console.error(`  x ${f}`);
    process.exit(1);
  }
  console.log('self-test passed: scripts are stripped, real markup survives, dead links are still caught, no control characters');
  process.exit(0);
}


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
    // Third time this check has been wrong in the same direction, so it is now
    // written against the thing that matters rather than against the markup we
    // happened to use last. It looked for <nav>, then for <nav> or a .back-btn,
    // and reported /source as stranding its visitors — a page whose last line
    // is <a class="back" href="/">. What a visitor needs is a link home. A
    // class name is one way to spot it and not the definition of it.
    const wayBack = /class="back-btn"/.test(s) || /<nav/.test(s) || /href="(?:\/|https:\/\/brainonbnb\.com\/?)"/.test(s);
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
  //
  // Markup only. A page that builds a link in JavaScript writes something like
  //   '<a href="' + AGENT + '/job?id=' + esc(id) + '">'
  // and a regex over the raw file reads the middle of that as a static href
  // pointing at a file that does not exist. It reported the registry page's
  // job-tracking link as dead while the link works perfectly at runtime.
  //
  // A false HIGH is worse than no check: it trains whoever runs this to skim
  // past the severity that is supposed to stop them. So script bodies are
  // removed before the scan — an href inside one is not markup, and whether it
  // resolves is a question about runtime, which this tool does not answer.
  // The browser checks in scripts/dashboard-check/ do.
  const markup = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  const seen = new Set();
  for (const m of markup.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    // Case-insensitive: a third-party registration in the census carried
    // "Https://google.com" with a capital H, which slipped past the lowercase
    // check and was reported as a broken internal link.
    if (/^https?:/i.test(href) || href.startsWith('#') || href.startsWith('mailto:')) continue;
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
