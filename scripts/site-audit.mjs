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

// Comparing a question in JSON against the same question in markup means
// getting past the ways the two are allowed to differ: the markup carries an
// entity for the ampersand and a caret glyph inside the summary, and neither is
// a difference a reader would see.
const norm = (t) => String(t)
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#x[0-9a-f]+;|&#\d+;/gi, '')
  .replace(/[‐-―−]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

// Rule-level comparison against the shared stylesheet.
//
// Deliberately blunt about what it will not claim: anything inside an @-block
// (@media, @keyframes, @supports) is skipped entirely. A `50%` step inside one
// animation is not the same rule as a `50%` step inside another, and comparing
// them by selector alone produced matches that meant nothing.
const cssRules = (css) => {
  const out = new Map();
  const s = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0, buf = '', sel = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') {
      if (depth === 0) sel = buf.trim().replace(/\s+/g, ' ');
      depth++; buf = ''; continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0 && sel && !sel.startsWith('@')) {
        out.set(sel, buf.replace(/\s+/g, '').replace(/;$/, ''));
      }
      // An @-block's contents are skipped by resetting rather than recursing.
      if (depth < 0) depth = 0;
      buf = ''; sel = null; continue;
    }
    buf += ch;
  }
  return out;
};

let SHARED = null;
const duplicatedRules = (inlineCss) => {
  if (SHARED === null) {
    try { SHARED = cssRules(fs.readFileSync(path.join(DASH, 'styles.css'), 'utf8')); }
    catch { SHARED = new Map(); }
  }
  const mine = cssRules(inlineCss);
  const dup = [];
  for (const [sel, body] of mine) {
    if (SHARED.has(sel) && SHARED.get(sel) === body) dup.push(sel);
  }
  return dup;
};

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

  // Duplication has to mean duplication. Both directions, because the repair
  // for one is a way of causing the other: a page that carries its own design
  // must not be reported, and a page that really does repeat the shared sheet
  // must be. The guard is a stylesheet link and not the string anywhere —
  // nft/index.html mentions styles.css in a comment and never loads it.
  {
    const shared = 'a{color:red}\n.b{margin:0}\n@media (max-width:1px){.b{margin:9px}}';
    const rules = cssRules(shared);
    if (rules.get('a') !== 'color:red') fails.push('the rule parser no longer reads a plain rule');
    if (rules.has('.b') && rules.get('.b') === 'margin:9px') fails.push('a rule inside @media is being read as a top-level rule');
    const linked = '<link rel="stylesheet" href="styles.css?v=1">';
    if (!/<link[^>]+href=["'][^"']*styles\.css/i.test(linked)) fails.push('a real stylesheet link is not recognised');
    if (/<link[^>]+href=["'][^"']*styles\.css/i.test('<!-- see dashboard/styles.css for why -->'))
      fails.push('a comment mentioning styles.css is being read as loading it');
  }

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

  // ---- structured data has to describe the page it is on ----
  //
  // A FAQPage block is a claim to a search engine about what a visitor can read
  // here. If the two drift, the markup is describing a page that does not
  // exist — which is the thing structured-data guidelines are about, and it
  // happens silently because nothing on the page looks wrong.
  for (const m of s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let parsed;
    try { parsed = JSON.parse(m[1]); }
    catch (e) { add(p, 'high', 'structured data does not parse', String(e.message).slice(0, 80)); continue; }
    const nodes = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
    for (const n of nodes) {
      if (n['@type'] !== 'FAQPage') continue;
      const claimed = (n.mainEntity || []).map((q) => norm(q.name));
      // Only the FAQ's own accordions. The page uses <details> elsewhere — the
      // code library, the finished campaign notes — and comparing against every
      // <summary> on the page reported seventeen "missing FAQ questions" that
      // were never FAQ questions. A check that cries wolf on a page that is
      // right teaches people to stop reading it.
      const shown = [...s.matchAll(/<details[^>]*class="[^"]*faq-item[^"]*"[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>/g)]
        .map((x) => norm(x[1].replace(/<[^>]*>/g, '')));
      const missing = claimed.filter((q) => !shown.includes(q));
      if (missing.length) {
        add(p, 'med', `${missing.length} FAQ question(s) in the structured data are not on the page`,
          missing.slice(0, 3).join(' | '));
      }
      const unclaimed = shown.filter((q) => q && !claimed.includes(q));
      if (claimed.length && unclaimed.length) {
        add(p, 'low', `${unclaimed.length} FAQ question(s) on the page are missing from the structured data`,
          unclaimed.slice(0, 3).join(' | '));
      }
    }
  }

  // ---- inline style that actually repeats the shared stylesheet ----
  //
  // This used to report the SIZE of a page's inline CSS and guess that it "may
  // duplicate styles.css". Measured: of the five pages it flagged, three
  // duplicate nothing at all — scanner.html has 115 inline rules and none of
  // them is a rule styles.css already carries. It was reporting a page for
  // having its own design, every run, in a severity band people learn to skim.
  //
  // Now it counts the rules that are genuinely repeated: same selector, same
  // declarations. A selector that appears in both with a DIFFERENT body is not
  // a duplicate — that is a page deliberately overriding the shared sheet, and
  // saying so would be the same false alarm wearing a better disguise.
  //
  // The guard has to be an actual stylesheet LINK, not the string appearing
  // anywhere. Testing the whole page for "styles.css" matched a comment in
  // nft/index.html that mentions the shared sheet by name — a page which does
  // not load it at all. Six of its rules looked like duplicates of a stylesheet
  // that is never on that page, and deleting them would have taken the styling
  // with them. A page that carries its own design is not duplicating anything.
  const inlineCss = [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const loadsShared = /<link[^>]+href=["'][^"']*styles\.css/i.test(s);
  if (inlineCss && loadsShared) {
    const dup = duplicatedRules(inlineCss);
    if (dup.length) {
      add(p, 'low', `${dup.length} inline rule${dup.length === 1 ? '' : 's'} styles.css already carries`,
        dup.slice(0, 6).join(' · ') + (dup.length > 6 ? ' …' : ''));
    }
  }
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
