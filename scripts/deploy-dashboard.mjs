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
  return problems;
}

if (process.argv.includes('--self-test') && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let n = 0, bad = 0;
  const is = (what, cond) => { n++; if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'}  ${what}`); };
  is('a comment goes, the markup around it stays', stripComments('<p>a</p><!-- why -->\n<p>b</p>') === '<p>a</p>\n<p>b</p>');
  is('a comment that spans lines goes whole', stripComments('<div>\n<!-- one\n two -->\n<b>x</b></div>') === '<div>\n<b>x</b></div>');
  is('"<!--" inside a script is code and stays, with the real comment after it gone', stripComments('<script>var s="<!-- not a comment -->";if(a<!--b){}</script><!-- c --><i>z</i>') === '<script>var s="<!-- not a comment -->";if(a<!--b){}</script><i>z</i>');
  is('the same inside <style>, <pre> and <textarea>', ['style', 'pre', 'textarea'].every((t) => stripComments(`<${t}>x <!-- kept --> y</${t}><!-- gone -->`) === `<${t}>x <!-- kept --> y</${t}>`));
  is('<preview> is not <pre>: a comment inside it goes', stripComments('<preview><!-- gone -->x</preview>') === '<preview>x</preview>');
  is('a conditional comment is an instruction and stays', stripComments('<!--[if lt IE 9]><script src="x.js"></script><![endif]--><!-- gone -->') === '<!--[if lt IE 9]><script src="x.js"></script><![endif]-->');
  is('an unterminated comment is left in, with everything after it', stripComments('<p>a</p><!-- never closed <p>b</p>') === '<p>a</p><!-- never closed <p>b</p>');
  is('a page without comments comes back as it was', stripComments('<!doctype html><html><body><p>x</p></body></html>') === '<!doctype html><html><body><p>x</p></body></html>');
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
if (isMain && !process.argv.includes('--self-test')) main();

function main() {
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
        problems.push(...checkPage(path.join(rel, e.name), html, built));
        fs.writeFileSync(to, built);
        pages++; before += zlib.brotliCompressSync(Buffer.from(html)).length; after += zlib.brotliCompressSync(Buffer.from(built)).length;
        continue;
      }
      try { fs.linkSync(from, to); linked++; } catch { fs.copyFileSync(from, to); copied++; }
    }
  };
  walk(SRC);
  const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);
  if (count(SRC) !== count(OUT)) problems.push(`the build holds ${count(OUT)} files, dashboard/ ${count(SRC)}`);
  for (const must of ['_worker.js', '_routes.json', '_headers', '_redirects', 'index.html']) if (!fs.existsSync(path.join(OUT, must))) problems.push(`${must} is missing from the build`);

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
