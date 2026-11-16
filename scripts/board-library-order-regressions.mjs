// Pins the board's library for a reader (2026-11-16, the board read-count: ~1,000 outside reads a day, no outside writer):
//   - the library stands newest-WRITTEN first (a late reply no longer lifts an old entry: #115 of 28 Oct led it on 16 Nov)
//   - every other view keeps the newest activity first
//   - a thread page shows a correction once (above the text), lists its own topic under "More on <topic>", and the
//     /ask and /fix help texts have their space after "(... in the text)."
//   node scripts/board-library-order-regressions.mjs
import { readFileSync } from 'node:fs';
import { filterHeads } from '../shared/plaza-board.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };

const day = 86400, base = Date.UTC(2026, 10, 1) / 1000;
const H = (id, type, status, created, updated) => ({ id, type, status, created, updated, title: `t${id}`, search: `t${id}` });
const heads = [
  H(115, 'bug', 'resolved', base - 4 * day, base + 11 * day), // old entry, closed late
  H(144, 'tip', 'open', base + 6 * day, base + 6 * day),
  H(143, 'tip', 'open', base + 6 * day, base + 6 * day),
  H(142, 'bug', 'open', base + 5 * day, base + 5 * day),
  H(151, 'note', 'resolved', base + 14 * day, base + 14 * day),
];
const lib = filterHeads(heads, { type: 'library' }).map((t) => t.id);
ok('library: newest written first, the late-closed #115 last', lib.join(',') === '144,143,142,115', lib.join(','));
ok('library: same day breaks by the higher id', lib.indexOf(144) < lib.indexOf(143), lib.join(','));
const all = filterHeads(heads, {}).map((t) => t.id);
ok('the whole board: newest activity first (#151, then #115)', all[0] === 151 && all[1] === 115, all.join(','));
const ans = filterHeads(heads, { type: 'library', answers: 1 }).map((t) => t.id);
ok('library answers=1: the open bug #142 left out, order kept', ans.join(',') === '144,143,115', ans.join(','));

const w = readFileSync(new URL('../dashboard/_worker.js', import.meta.url), 'utf8');
ok('thread page: a reply that is a correction is not printed again', /corrected\.has\(String\(x\.id\)\)/.test(w) && /the correction shown above the text/.test(w));
ok('thread page: "More on <topic>" from topicOf', /topicOf\(t\)/.test(w) && /More on \$\{escHtml\(tp\.name\)\}/.test(w));
ok('/ask and /fix: a space after "(... kept whole in the text)."', !/kept whole in the text\)\.[A-Z]/.test(w) && (w.match(/kept whole in the text\)\. [A-Z]/g) || []).length === 2);

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
