#!/usr/bin/env node
// The Giggle pot table on the homepage: does the "Pot" column say what the pot
// held after each send?
//
// The table shows the newest send first. Until 2026-09-19 the running sum was
// added down the table as it is shown — so the newest send carried only its own
// amount as "Pot" and the OLDEST carried the whole pot (the operator saw it:
// 0.00945 beside the newest send, 0.0197 beside the first). The headline total
// was right all along, which is why no check that compared totals noticed.
//
// This lifts ggdata out of dashboard/app.js as it stands, runs it against a
// stand-in for the page, and reads the rows it paints. Offline, no browser.
//   node scripts/giggle-pot-check.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'dashboard', 'app.js'), 'utf8');
const start = src.indexOf('function ggdata(b){');
const end = src.indexOf('\nfunction ', start + 10);
const fnText = src.slice(start, end);

let n = 0, bad = 0;
const ok = (what, cond, detail = '') => { n++; if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'}  ${what}${detail ? ` — ${detail}` : ''}`); };

function run(text, log) {
  const els = {}; let painted = null;
  const document = { getElementById: (id) => (els[id] ||= { textContent: '' }) };
  const paintRows = (id, rows) => { painted = { id, rows }; };
  const f = new Function('document', 'paintRows', 'ggUsd', `let GG_BNB=0;${text};ggdata(arguments[3]);return GG_BNB;`);
  const total = f(document, paintRows, () => {}, log);
  const cells = (painted ? painted.rows : []).map((r) => [...r.matchAll(/<td>(.*?)<\/td>/g)].map((m) => m[1]));
  return { total, count: els['gg-count']?.textContent, head: els['gg-bnb']?.textContent, rows: cells.map((c) => ({ time: c[0], bnb: parseFloat(c[1]), pot: parseFloat(c[2]) })), body: painted?.id };
}

// The two sends that were on the page the day the fault was seen, a run without a send between them, and a third.
const log = [
  { time: '2026-09-16T21:50:59.009Z', totalBnb: '0.0867' },
  { time: '2026-09-18T10:40:51.370Z', giggleBnb: '0.010240368674555655', giggleTx: '0x057aff4b5935c2672f12196815670f72f1f02c9a56a378e6cc8f8e9a37cd52c1' },
  { time: '2026-09-18T23:10:19.132Z', giggleBnb: '0.009451120826106744', giggleTx: '0xb479a5956aa2ab2b49825b68b8fb4c71bc404129150119f1dcf9e11455564ae2' },
  { time: '2026-09-20T08:00:00.000Z', giggleBnb: '0.02', giggleTx: '0x' + 'ab'.repeat(32) },
];
const r = run(fnText, log);
ok('ggdata is found in app.js and paints the pot table', fnText.length > 300 && r.body === 'gg-tx-body' && r.rows.length === 3);
ok('three sends are counted, runs without a send are not', String(r.count) === '3');
ok('the newest send stands first', r.rows[0]?.time.startsWith('2026-09-20') && r.rows[2]?.time.startsWith('2026-09-18 10:40'));
ok('beside the newest send stands the whole pot — the figure the headline shows', Math.abs(r.rows[0].pot - 0.0397) < 1e-9 && r.head === '0.0397 BNB', `${r.rows[0]?.pot} / ${r.head}`);
ok('beside the first send stands that send alone', Math.abs(r.rows[2].pot - 0.0102) < 1e-9 && Math.abs(r.rows[2].bnb - 0.01024) < 1e-9, `${r.rows[2]?.pot}`);
ok('the second send (2026-09-18 23:10) reads 0.00945 BNB and a pot of 0.0197 — what the operator expected to see', Math.abs(r.rows[1].bnb - 0.00945) < 1e-9 && Math.abs(r.rows[1].pot - 0.0197) < 1e-9, `${r.rows[1]?.bnb} / ${r.rows[1]?.pot}`);
ok('down the table the pot never grows: every row holds what the pot held after that send', r.rows.every((row, i) => i === 0 || row.pot <= r.rows[i - 1].pot));
// A log that arrives out of order is still added in the order of time.
const shuffled = run(fnText, [log[3], log[1], log[2]]);
ok('a log out of order gives the same table', JSON.stringify(shuffled.rows) === JSON.stringify(r.rows));
// The detector is not blind: the function as it was until 2026-09-19 must fail the same questions.
const old = fnText.replace(/const chrono=\[\.\.\.entries\]\.sort\([^;]*\);for\(const x of chrono\)/, 'for(const x of[...entries].reverse())').replace("rows.reverse();if(rows.length)", 'if(rows.length)');
const o = run(old, log);
ok('the function as it was is caught: the newest send carried its own amount, the first the whole pot', old !== fnText && o.rows.length === 3 && Math.abs(o.rows[0].pot - 0.02) < 1e-9 && Math.abs(o.rows[2].pot - 0.0397) < 1e-9 && !o.rows.every((row, i) => i === 0 || row.pot <= o.rows[i - 1].pot));

console.log(`\n${n - bad}/${n} checks pass`);
process.exit(bad ? 1 : 0);
