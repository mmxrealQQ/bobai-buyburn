#!/usr/bin/env node
// THE LAB KEEPS UP WITH THE LIVE SITE (2026-10-28). temp/newpage/lab is the test copy (bobai-lab.pages.dev) and the
// source temp/newpage/build.mjs generates the Brain page from. It had fallen 15-60 lines behind on 58 of its 190
// files (app.js v126 against the live v129, styles.css v67 against v74): a Brain page rebuilt from it would have
// quietly undone days of live changes. This copies every file both folders hold from dashboard/ into the lab.
// What the lab keeps of its own: its server code (_worker.js, a read-only proxy to brainonbnb.com), _headers (its
// site-wide X-Robots-Tag: noindex) and _redirects, and the robots meta line an HTML page of the lab carries.
//   node scripts/lab-sync.mjs            copy, and say what changed
//   node scripts/lab-sync.mjs --check    only say which files differ; exit 1 if any does
//   node scripts/lab-sync.mjs --self-test
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const LIVE = path.join(ROOT, 'dashboard'), LAB = path.join(ROOT, 'temp', 'newpage', 'lab');
const OWN = new Set(['_worker.js', '_headers', '_redirects']);
const TEXT = /\.(html|js|css|txt|json|md)$/;
const ROBOTS = /<meta name="robots"[^>]*>\s*/i;

// the lab's version of a live file: the live text, with the lab's own robots line where the lab page had one
export function labVersion(live, lab, file) {
  if (!file.endsWith('.html') || live === lab) return live;
  const mine = (lab.match(ROBOTS) || [])[0];
  if (!mine || !/noindex/i.test(mine) || /noindex/i.test((live.match(ROBOTS) || [''])[0])) return live;
  const stripped = live.replace(ROBOTS, '');
  const at = stripped.search(/<meta charset/i);
  return at < 0 ? live : stripped.slice(0, at) + mine + stripped.slice(at);
}

const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walk(p, base) : TEXT.test(d.name) ? [path.relative(base, p).split(path.sep).join('/')] : [];
});

export function plan(read = (p) => fs.readFileSync(p, 'utf8'), files = walk(LAB), exists = (p) => fs.existsSync(p)) {
  const out = [];
  for (const f of files) {
    if (OWN.has(f) || !exists(path.join(LIVE, f))) continue;
    const lab = read(path.join(LAB, f)), want = labVersion(read(path.join(LIVE, f)), lab, f);
    if (want !== lab) out.push({ file: f, want });
  }
  return out;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  const fails = [];
  const page = '<head>\n<meta name="robots" content="noindex">  <meta charset="UTF-8">\n<link href="app.js?v=1"></head>';
  const live = '<head>\n  <meta charset="UTF-8">\n<link href="app.js?v=2"></head>';
  const v = labVersion(live, page, 'index.html');
  if (!/noindex/.test(v) || !/v=2/.test(v)) fails.push('a live page did not keep the lab\'s noindex line, or kept the old version');
  if (labVersion(live, live, 'index.html') !== live) fails.push('a page without a robots line of its own was changed');
  const indexed = '<head><meta charset="UTF-8"><meta name="robots" content="index,follow"></head>';
  if (labVersion(indexed, indexed, 'p.html') !== indexed) fails.push('an identical page with an index robots line was rewritten');
  if (labVersion('x', 'y', 'app.js') !== 'x') fails.push('a script was not taken as it is live');
  const mem = { [path.join(LAB, 'a.js')]: 'old', [path.join(LIVE, 'a.js')]: 'new', [path.join(LAB, '_worker.js')]: 'lab', [path.join(LIVE, '_worker.js')]: 'live',
    [path.join(LAB, 'b.css')]: 'same', [path.join(LIVE, 'b.css')]: 'same' };
  const p = plan((x) => mem[x], ['a.js', '_worker.js', 'b.css', 'lab-only.js'], (x) => x in mem);
  if (p.length !== 1 || p[0].file !== 'a.js') fails.push(`a drifted file was not found, or the lab's own were not left alone: ${JSON.stringify(p.map((x) => x.file))}`);
  if (fails.length) { console.error('self-test FAILED\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('self-test passed: drift is found, the lab keeps its server files and its noindex line');
  process.exit(0);
}

const todo = plan();
if (args.includes('--check')) {
  if (todo.length) { console.log(`the lab differs from the live site in ${todo.length} file(s):\n  ${todo.map((x) => x.file).join('\n  ')}\nnode scripts/lab-sync.mjs brings it level`); process.exit(1); }
  console.log('the lab holds what the live site holds (its server files and noindex lines apart)');
  process.exit(0);
}
for (const { file, want } of todo) fs.writeFileSync(path.join(LAB, file), want);
console.log(todo.length ? `copied ${todo.length} file(s) into the lab:\n  ${todo.map((x) => x.file).join('\n  ')}` : 'the lab was level already');
