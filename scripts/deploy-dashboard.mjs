#!/usr/bin/env node
// The dashboard, deployed WITHOUT its HTML comments.
//
// The pages carry their own history in comments — why a block is where it is,
// what broke on which day. That belongs in the repository and in the source
// mirror, and it went to every visitor too: 20 comments are 11.5% of every
// delivery of the homepage, 11.8% of /scanner (brotli, measured 2026-09-19).
// This builds a copy of dashboard/ in .dashboard-build/ beside it — every .html
// with its comments taken out, every other file the same file (a hard link
// where the file system gives one, a copy where not: about 13 s for 108 MB) —
// checks the copy, and deploys THAT. dashboard/ itself is never written to.
//
//   node scripts/deploy-dashboard.mjs              build, check, deploy
//   node scripts/deploy-dashboard.mjs --dry        build and check, deploy nothing
//   node scripts/deploy-dashboard.mjs --self-test  pin the stripping, both ways
//
// What is left alone: anything inside <script>, <style>, <pre>, <textarea>
// (a "<!--" there is code or text, not a comment), and conditional comments.
// What stops the deploy: a page that lost a tag, a script or a style byte, a
// page that shrank by more than a fifth (an unterminated comment would take the
// rest of the page with it — such a comment is left in, and this is the second
// guard), or a comment still standing in a built page.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
// BESIDE dashboard/, not under temp/: _worker.js imports '../shared/...', and a
// copy two levels down could not resolve it — the first real run stopped in
// wrangler's own build, before anything was uploaded (2026-09-19). The folder is
// in .gitignore; the source mirror and the secret audit list files with git
// ls-files, so it reaches neither.
const SRC = path.join(ROOT, 'dashboard'), OUT = path.join(ROOT, '.dashboard-build');
const RAW = ['script', 'style', 'pre', 'textarea'];

export function stripComments(html) {
  let out = '', i = 0;
  const lower = html.toLowerCase();
  while (i < html.length) {
    const c = html.indexOf('<!--', i);
    if (c < 0) { out += html.slice(i); break; }
    // The nearest raw-text element that opens before this "<!--": copied whole.
    let raw = null;
    for (const t of RAW) {
      let p = lower.indexOf('<' + t, i);
      while (p >= 0 && p < c && !/[\s>/]/.test(lower[p + t.length + 1] || '>')) p = lower.indexOf('<' + t, p + 1);   // <pre is not <preview
      if (p >= 0 && p < c && (!raw || p < raw.p)) raw = { t, p };
    }
    if (raw) {
      const close = lower.indexOf('</' + raw.t, raw.p);
      const end = close < 0 ? html.length : lower.indexOf('>', close) + 1 || html.length;
      out += html.slice(i, end); i = end; continue;
    }
    const e = html.indexOf('-->', c + 4);
    if (e < 0) { out += html.slice(i); break; }   // unterminated: leave the rest as it is
    out += html.slice(i, c);
    const body = html.slice(c, e + 3);
    i = e + 3;
    if (/^<!--\s*\[if\b|^<!--\s*<!\[/i.test(body)) { out += body; continue; }   // conditional comments are instructions
    // A comment alone on its line takes the line with it — here, where it stood,
    // and nowhere else: no blank line inside a <pre> or a script is ever touched.
    const lead = out.match(/(^|\n)[ \t]*$/), trail = html.slice(i).match(/^[ \t]*\r?\n/);
    if (lead && trail) { out = out.slice(0, out.length - (lead[0].length - lead[1].length)); i += trail[0].length; }
  }
  return out;
}

// What a page is made of besides its comments: every tag in order, and every
// byte inside the raw-text elements.
// Read a second way, on purpose: the stripper walks the text by index, this is
// one regular expression scanning left to right, where whichever starts first
// wins — a comment that mentions "<style>" in its prose swallows the mention
// (dashboard/nft/index.html has one; the first version of this check took it
// for an element and stopped the deploy), a script that contains "<!--" swallows
// that. Two readings that agree are worth more than one reading checked
// against itself.
const SCAN = /<(script|style|pre|textarea)\b[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi;
function skeleton(html) {
  const raws = [], comments = [];
  const bare = html.replace(SCAN, (m, tag) => { if (tag) { raws.push(m); return `<${tag}></${tag}>`; } comments.push(m); return /^<!--\s*\[if\b|^<!--\s*<!\[/i.test(m) ? m : ''; });
  return { raws, comments: comments.filter((m) => !/^<!--\s*\[if\b|^<!--\s*<!\[/i.test(m)), bare };
}
const tagsOf = (bare) => (bare.match(/<\/?[a-zA-Z][^>]*>/g) || []).join('');

export function checkPage(name, before, after) {
  const problems = [];
  const a = skeleton(before), b = skeleton(after);
  if (a.raws.length !== b.raws.length || a.raws.some((r, k) => r !== b.raws[k])) problems.push(`${name}: a <script>, <style>, <pre> or <textarea> is not byte for byte what it was`);
  if (tagsOf(a.bare) !== tagsOf(b.bare)) problems.push(`${name}: the tags of the page are not the same tags in the same order`);
  if (b.comments.length) problems.push(`${name}: ${b.comments.length} comment(s) still stand in the built page`);
  if (after.length < before.length * 0.8) problems.push(`${name}: the page shrank by ${((1 - after.length / before.length) * 100).toFixed(0)}% — more than comments weigh`);
  const text = (bare) => bare.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  if (text(a.bare) !== text(b.bare)) problems.push(`${name}: the text a reader sees changed`);
  // EVERY INLINE SCRIPT PARSES (2026-10-12: an apostrophe in a title, "Brain On BNB's", ended a single-quoted string and
  // took /screener down for three minutes): a classic inline script that does not compile stops the deploy
  for (const m of after.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] || '';
    if (/\ssrc=/i.test(attrs) || (/\stype=/i.test(attrs) && !/\stype=["']?(text\/javascript|application\/javascript)["']?/i.test(attrs))) continue;
    try { new Function(m[2]); } catch (e) { problems.push(`${name}: an inline script does not parse (${e.message})`); }
  }
  return problems;
}

// A NAMESPACE IS A NAME, NOT AN ADDRESS (2026-10-25, the A-Z pass): an SVG whose xmlns reads "https://www.w3.org/2000/svg"
// is no SVG at all — the link system's arrow mask in styles.css carried it from 5.9. to 25.10., so every text link on
// every page ended in an empty gap instead of its arrow. The W3C names stay http:// forever; any https:// one stops the deploy.
export function wrongNamespace(name, text) {
  const m = text.match(/xmlns(:\w+)?=(\\?["']|%22|%27)https(:|%3A)(\/\/|%2F%2F)www\.w3\.org/i);
  return m ? [`${name}: an XML namespace written as https:// (${m[0]}) — it must read http://www.w3.org/…, or the SVG does not draw`] : [];
}

// EVERY BUY LINK NAMES ITS CHAIN (2026-10-25): PancakeSwap opens the chain the visitor used last, so a $BOBAI link
// without chain=bsc showed "token not found" to anyone coming from Ethereum or Base — 25 of 26 links lacked it.
export function buyLinkWithoutChain(name, text) {
  const bad = (text.match(/pancakeswap\.finance\/swap\?[^"'`\s<>]*outputCurrency=0x245c386dcfed896f5c346107596141e5edcbffff[^"'`\s<>]*/gi) || []).filter((u) => !/[?&](amp;)?chain=bsc\b/i.test(u));
  return bad.length ? [`${name}: ${bad.length} $BOBAI buy link(s) without chain=bsc (${bad[0].slice(0, 90)})`] : [];
}

// WHICH PAGE A BUY CAME FROM (2026-11-02, the demand measurement: 30 days of trades, and nothing could say whether a page
// of ours led to one). Every $BOBAI buy link on a page goes through /buy?from=<page>, which counts the source and
// redirects to the same PancakeSwap URL. Done here so that hand-written and generated pages cannot drift. The worker
// keeps the same names in BUY_SOURCES; a name it does not know is counted as 'other'.
const BUY_URL = 'https://pancakeswap.finance/swap?outputCurrency=0x245c386dcfed896f5c346107596141e5edcbffff';
export function buySource(rel) {
  const p = String(rel).replace(/\\/g, '/').replace(/\.html$/i, '').toLowerCase();
  if (p === 'index') return 'classic';
  if (p === 'brain/index') return 'home';
  return p.replace(/\/index$/, '').replace(/[^a-z0-9]+/g, '-').slice(0, 24);
}
export function rewriteBuyLinks(html, rel) {
  const to = `href="/buy?from=${buySource(rel)}"`;
  return html.split(`href="${BUY_URL}&chain=bsc"`).join(to).split(`href="${BUY_URL}&amp;chain=bsc"`).join(to).split('href="/buy"').join(to);
}

// ONE BAR FOR THE WHOLE ECOSYSTEM (2026-11-03, operator: "so einfach wie pokter, marque, mandate"). Every sub-page
// opened with "← Home | its own name | Buy", so from /scanner there was no way to /registry or /board but through the
// terminal. All three neighbours carry the same product bar on every page. Here, at build time, the "back + name" pair
// becomes logo + the six apps of card 04 (the open one lit) + the page's name; on a phone the six fold into "Apps".
// The buttons on the right stay exactly as each page wrote them. The bar's own styles live in eco.css, linked here into
// every page that gets the bar: the pages on styles.css, and the ones in OWN_CSS_BAR that carry their own stylesheet
// but are an app of the bar (nft/ since 3.11.). Other pages with their own look (worldcup, game, the screener tests)
// keep their header.
// /connect (7.11., operator: "into the Apps menu"): keep our MCP servers in Claude, Cursor or VS Code
// Brain Pop (7.11., operator: "more players"): the game could only be reached from the terminal on the front page; during
// its season (to 30 Nov, the last daily) every page's bar opens it (its own page /pop since 7.11., one tap from the game). A build after 30 Nov leaves it out by itself.
export const POP_LAST_DAY = '2026-11-30';
export const ECO_APPS = [['/scanner', 'Scanner'], ['/registry', 'Plaza'], ['/board', 'Board'], ['/services', 'Services'], ['/defi', 'DeFi Agent'], ['/nft/', 'NFT'], ['/connect', 'Connect'],
  ...(new Date().toISOString().slice(0, 10) <= POP_LAST_DAY ? [['/pop', 'Brain Pop']] : [])];
const OWN_CSS_BAR = ['nft/index.html'];
const PAIR = /<a class="back-btn"[^>]*>[\s\S]*?<\/a>(\s*)<a class="brand-link" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/;
export function ecoNav(html, rel = '', ecoV = '1') {
  const r = String(rel).replace(/\\/g, '/');
  if (!/href="\/?styles\.css/.test(html) && !OWN_CSS_BAR.includes(r)) return html;   // a comment that names the file is not the file
  const m = html.match(PAIR);
  if (!m) return html;
  const [, , href, name] = m;
  const here = ECO_APPS.find(([h]) => h === href);
  // Every link carries a class: the site-wide rule for bare links (a:not([class])) would underline them in gold.
  const links = () => ECO_APPS.map(([h, t]) => `<a ${h === href ? 'class="eco-a on" aria-current="page"' : 'class="eco-a"'} href="${h}">${t}</a>`).join('');
  const bar = `<div class="eco-l"><a class="eco-logo" href="/" title="Back to the Brain Terminal"><img src="/logo-sm.webp" width="26" height="26" alt=""><span>BOBAI</span></a>`
    + `<span class="eco-here${here ? ' is-app' : ''}">${name.trim()}</span>`
    + `<div class="eco-links" aria-label="BOBAI apps">${links()}</div>`
    + `<details class="eco-m"><summary>Apps</summary><div class="eco-menu"><a class="eco-a" href="/">Brain Terminal</a>${links()}</div></details></div>`;
  // The gold "Brain Plaza" button five pages carried was the only way to the Plaza from there; the bar has it now.
  const out = html.replace(PAIR, bar).replace(/\s*<a class="nb" href="\/registry">Brain Plaza<\/a>/, '');
  return out.replace(/<\/head>/i, `<link rel="stylesheet" href="/eco.css?v=${ecoV}">\n</head>`);
}

if (process.argv.includes('--self-test') && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let n = 0, bad = 0;
  const is = (what, cond) => { n++; if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'}  ${what}`); };
  {
    const u = 'https://pancakeswap.finance/swap?outputCurrency=0x245c386dcfed896f5c346107596141e5edcbffff';
    const page = `<a href="${u}&chain=bsc">a</a><a href="${u}&amp;chain=bsc">b</a><a href="/buy">c</a><a href="https://pancakeswap.finance/swap?outputCurrency=0xabc&chain=bsc">other token</a><p>${u}&chain=bsc</p>`;
    const out = rewriteBuyLinks(page, 'token.html');
    is('every $BOBAI buy link goes through /buy with its page; another token and plain text stay', out.split('href="/buy?from=token"').length === 4 && out.includes('outputCurrency=0xabc') && out.includes(`<p>${u}&chain=bsc</p>`));
    is('the front pages and folders get their names', buySource('index.html') === 'classic' && buySource('brain\\index.html') === 'home' && buySource('brain/index.html') === 'home' && buySource('nft/index.html') === 'nft' && buySource('faq.html') === 'faq');
  }
  {
    const head = '<link rel="stylesheet" href="styles.css?v=1">';
    const nav = (href, name) => `${head}<nav><div class="nav">\n    <a class="back-btn" href="/" title="x"><span>&larr;</span> Home</a>\n    <a class="brand-link" href="${href}">${name}</a>\n    <a class="nb" href="/buy">Buy $BOBAI</a>\n  </div></nav>`;
    const s = ecoNav(nav('/scanner', 'BOBAI Pool Scanner')), t = ecoNav(nav('/token', 'The Token'));
    is('the app bar replaces back + name: all six apps, the open one lit once, the Buy button untouched', !/back-btn|brand-link/.test(s) && ECO_APPS.every(([h]) => s.includes(`href="${h}"`)) && s.split('aria-current="page"').length === 3 && s.includes('<a class="nb" href="/buy">Buy $BOBAI</a>') && s.includes('eco-here is-app">BOBAI Pool Scanner<'));
    const p = ecoNav(nav('/services', 'Services').replace('<a class="nb" href="/buy">', '<a class="nb" href="/registry">Brain Plaza</a>\n    <a class="nb" href="/buy">'));
    is('the doubled Brain Plaza button goes, Buy stays, and no bar link is a bare <a> the gold underline rule would catch', !p.includes('>Brain Plaza</a>') && p.includes('>Buy $BOBAI</a>') && !/<a href=/.test(p.slice(p.indexOf('eco-l'), p.indexOf('</details>'))));
    const own = (rel) => ecoNav('<head><style>nav{}</style></head>' + nav('/nft/', 'BOBAI Buy Drops').replace(head, ''), rel, 'abc');
    is('nft/ keeps its own stylesheet and still gets the bar, with eco.css linked once in its head; worldcup/ with its own look does not', own('nft\\index.html').includes('eco-links') && own('nft/index.html').split('href="/eco.css?v=abc"').length === 2 && own('nft/index.html').indexOf('eco.css') < own('nft/index.html').indexOf('</head>') && !own('worldcup/index.html').includes('eco-links') && !own('worldcup/index.html').includes('eco.css'));
    is('a page outside the six keeps its name visible and lights nothing', t.includes('class="eco-here">The Token<') && !t.includes('aria-current'));
    is('a page without styles.css, or without the pair, comes back as it was', ecoNav(nav('/x', 'X').replace(head, '')) === nav('/x', 'X').replace(head, '') && ecoNav(head + '<nav><a href="/">x</a></nav>') === head + '<nav><a href="/">x</a></nav>');
  }
  is('a comment goes, the markup around it stays',stripComments('<p>a</p><!-- why -->\n<p>b</p>') === '<p>a</p>\n<p>b</p>');
  is('a comment that spans lines goes whole', stripComments('<div>\n<!-- one\n two -->\n<b>x</b></div>') === '<div>\n<b>x</b></div>');
  is('"<!--" inside a script is code and stays, with the real comment after it gone', stripComments('<script>var s="<!-- not a comment -->";if(a<!--b){}</script><!-- c --><i>z</i>') === '<script>var s="<!-- not a comment -->";if(a<!--b){}</script><i>z</i>');
  is('the same inside <style>, <pre> and <textarea>', ['style', 'pre', 'textarea'].every((t) => stripComments(`<${t}>x <!-- kept --> y</${t}><!-- gone -->`) === `<${t}>x <!-- kept --> y</${t}>`));
  is('<preview> is not <pre>: a comment inside it goes', stripComments('<preview><!-- gone -->x</preview>') === '<preview>x</preview>');
  is('a conditional comment is an instruction and stays', stripComments('<!--[if lt IE 9]><script src="x.js"></script><![endif]--><!-- gone -->') === '<!--[if lt IE 9]><script src="x.js"></script><![endif]-->');
  is('an unterminated comment is left in, with everything after it', stripComments('<p>a</p><!-- never closed <p>b</p>') === '<p>a</p><!-- never closed <p>b</p>');
  is('a page without comments comes back as it was', stripComments('<!doctype html><html><body><p>x</p></body></html>') === '<!doctype html><html><body><p>x</p></body></html>');
  is('an SVG mask written with xmlns=\'https://www.w3.org/2000/svg\' (the 25.10. arrows) stops the deploy', wrongNamespace('styles.css', `a::after{mask:url("data:image/svg+xml,%3Csvg xmlns='https://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E")}`).length === 1);
  is('the same percent-encoded, and an xlink namespace, stop it too', wrongNamespace('a.css', 'url("data:image/svg+xml,%3Csvg xmlns=%22https%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E")').length === 1 && wrongNamespace('b.svg', '<svg xmlns:xlink="https://www.w3.org/1999/xlink">').length === 1);
  is('the right namespace, and an ordinary https link to w3.org, pass', wrongNamespace('c.css', `xmlns='http://www.w3.org/2000/svg'`).length === 0 && wrongNamespace('d.html', '<a href="https://www.w3.org/TR/SVG/">spec</a>').length === 0);
  is('a $BOBAI buy link without chain=bsc stops the deploy; with it (also as &amp;chain=bsc) it passes', buyLinkWithoutChain('a.html', '<a href="https://pancakeswap.finance/swap?outputCurrency=0x245c386dcfed896f5c346107596141e5edcbffff">').length === 1 && buyLinkWithoutChain('b.html', '<a href="https://pancakeswap.finance/swap?outputCurrency=0x245c386dcfed896f5c346107596141e5edcbffff&chain=bsc">').length === 0 && buyLinkWithoutChain('c.js', '"https://pancakeswap.finance/swap?outputCurrency=0x245c386dcfed896f5c346107596141e5edcbffff&amp;chain=bsc"').length === 0);
  // The check that stands before the deploy, both ways.
  const page = '<html><head><style>a{}</style></head><body><!-- note --><p>Hello</p><script>var x=1;</script></body></html>';
  is('a correctly built page passes the check', checkPage('p', page, stripComments(page)).length === 0);
  const prose = '<head><!-- Fonts as a <link>, NOT inside the inline <style>: an\n import there blocks --><style>a{}</style></head><body><p>' + 'word '.repeat(80) + '</p></body>';
  is('a comment that only MENTIONS <style> is a comment: stripped, and the check agrees (dashboard/nft/index.html)', stripComments(prose) === '<head><style>a{}</style></head><body><p>' + 'word '.repeat(80) + '</p></body>' && checkPage('p', prose, stripComments(prose)).length === 0);
  is('a lost tag is caught', checkPage('p', page, stripComments(page).replace('<p>Hello</p>', 'Hello')).some((p) => /tags/.test(p)));
  is('a changed script byte is caught', checkPage('p', page, stripComments(page).replace('var x=1', 'var x=2')).some((p) => /byte for byte/.test(p)));
  is('a changed word is caught', checkPage('p', page, stripComments(page).replace('Hello', 'Hallo')).some((p) => /reader sees/.test(p)));
  is('a comment left standing is caught', checkPage('p', page, page).some((p) => /still stand/.test(p)));
  is('a page that lost a third of itself is caught', checkPage('p', page + '<p>' + 'x'.repeat(400) + '</p>', stripComments(page)).some((p) => /shrank/.test(p)));
  console.log(`\n${n - bad}/${n} checks behave in both directions`);
  process.exit(bad ? 1 : 0);
}

// ── build ────────────────────────────────────────────────────────────────────
// ONLY WHEN RUN, never when imported. The first version had no such line, and
// importing it to try a function built the copy and went on towards the deploy
// (2026-09-19; nothing went out, the process ended first). A script that can
// publish the site must not do it because another file wanted its exports.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && !process.argv.includes('--self-test')) main().catch((e) => { console.error(e); process.exit(1); });

async function main() {
  // eco.css is linked with a hash of its content, so a changed bar reaches every device without a version to bump
  const ECO_V = crypto.createHash('sha256').update(fs.readFileSync(path.join(SRC, 'eco.css'))).digest('hex').slice(0, 10);
  const dry = process.argv.includes('--dry');
  fs.rmSync(OUT, { recursive: true, force: true });
  let pages = 0, linked = 0, copied = 0, before = 0, after = 0;
  const problems = [];
  const walk = (dir) => {
    const rel = path.relative(SRC, dir);
    fs.mkdirSync(path.join(OUT, rel), { recursive: true });
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const from = path.join(dir, e.name), to = path.join(OUT, rel, e.name);
      if (e.isDirectory()) { walk(from); continue; }
      if (e.name.toLowerCase().endsWith('.html')) {
        const html = fs.readFileSync(from, 'utf8'), built = stripComments(html);
        problems.push(...checkPage(path.join(rel, e.name), html, built), ...wrongNamespace(path.join(rel, e.name), html), ...buyLinkWithoutChain(path.join(rel, e.name), html));
        fs.writeFileSync(to, rewriteBuyLinks(ecoNav(built, path.join(rel, e.name), ECO_V), path.join(rel, e.name)));
        pages++; before += zlib.brotliCompressSync(Buffer.from(html)).length; after += zlib.brotliCompressSync(Buffer.from(built)).length;
        continue;
      }
      if (/\.(css|js|mjs|svg|txt)$/i.test(e.name)) { const t = fs.readFileSync(from, 'utf8'); problems.push(...wrongNamespace(path.join(rel, e.name), t), ...buyLinkWithoutChain(path.join(rel, e.name), t)); }
      try { fs.linkSync(from, to); linked++; } catch { fs.copyFileSync(from, to); copied++; }
    }
  };
  walk(SRC);
  const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);
  if (count(SRC) !== count(OUT)) problems.push(`the build holds ${count(OUT)} files, dashboard/ ${count(SRC)}`);
  for (const must of ['_worker.js', '_routes.json', '_headers', '_redirects', 'index.html']) if (!fs.existsSync(path.join(OUT, must))) problems.push(`${must} is missing from the build`);
  // THE CODE LIVES (2026-10-12, card 07 "More"): when this build went out, and the commit and date of the public source
  // mirror it carries (dashboard/source.git) — written into the build only, after the count above, never into dashboard/
  {
    const m = spawnSync('git', ['--git-dir=' + path.join(SRC, 'source.git'), 'log', '-1', '--format=%h %cI'], { encoding: 'utf8' });
    const [commit, date] = (m.stdout || '').trim().split(' ');
    fs.writeFileSync(path.join(OUT, 'build.json'), JSON.stringify({ site_deployed_at: new Date().toISOString(), source_mirror: commit ? { commit, date, clone: 'git clone https://brainonbnb.com/source.git' } : null }) + '\n');
  }

  // THE FALLBACK LOGS ARE FRESH (2026-11-04): the page and the tools read the bot's logs live (/logs/*, logs.brainonbnb.com)
  // and fall back to the copy in dashboard/ — and that copy stopped on 2026-07-27, when the bots moved off GitHub. A day
  // the log domain did not answer would have shown July's burns as today's. The live logs are written into the build
  // (only there; the build's files are hard links into dashboard/, so the link is taken out first). A log that does not
  // answer, does not parse or is shorter than the copy leaves the copy as it was.
  for (const n of ['burns.json', 'bobai-liq-log.json']) {
    const live = await fetch('https://logs.brainonbnb.com/logs/' + n, { headers: { 'user-agent': 'brainonbnb-deploy' }, signal: AbortSignal.timeout(20000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const old = (() => { try { return JSON.parse(fs.readFileSync(path.join(SRC, n), 'utf8')); } catch { return []; } })();
    if (Array.isArray(live) && live.length >= old.length) {
      fs.rmSync(path.join(OUT, n), { force: true });
      fs.writeFileSync(path.join(OUT, n), JSON.stringify(live));
      console.log(`  ${n}: the live log (${live.length} entries, last ${String(live.at(-1)?.time || '').slice(0, 10)}) instead of the copy (${old.length})`);
    } else console.log(`  ${n}: the live log did not answer as it should — the copy in dashboard/ goes out (${old.length} entries)`);
  }
  console.log(`built .dashboard-build: ${pages} pages without their comments (brotli ${before} -> ${after} B, −${((1 - after / before) * 100).toFixed(1)}%), ${linked} files linked${copied ? `, ${copied} copied` : ''}`);
  if (problems.length) {
    for (const p of problems) console.log(`  x ${p}`);
    console.log(`\n${problems.length} problem(s) — nothing was deployed.`);
    process.exit(1);
  }
  if (dry) { console.log('dry run — nothing was deployed.'); process.exit(0); }

  const r = spawnSync('npx', ['wrangler', 'pages', 'deploy', OUT, '--project-name=bobai-dashboard', '--branch=main', '--commit-dirty=true'], { cwd: ROOT, stdio: 'inherit', shell: true });
  process.exit(r.status == null ? 1 : r.status);
}
