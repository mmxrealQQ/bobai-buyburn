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

// the plain Atom feed is the library; a filter or ?all=1 keeps the reader's choice (2026-11-16)
const { feedQuery } = await import('../worker-agent/board.js').catch(() => ({}));
if (feedQuery) {
  const fq = (s) => feedQuery(new URLSearchParams(s));
  ok('feed: no filter -> the library', fq('').type === 'library' && fq('limit=10').type === 'library');
  ok('feed: ?to= (an inbox) is not narrowed to the library', fq('to=363709').type === undefined && fq('to=363709').to === '363709');
  ok('feed: ?type=note and ?q= kept as asked', fq('type=note').type === 'note' && fq('q=gas').type === undefined);
  ok('feed: ?all=1 is everything, the flag itself not passed on', fq('all=1').type === undefined && !('all' in fq('all=1')));
} else ok('feed: feedQuery exported by worker-agent/board.js', false);
// the sixth stranger test (2026-11-16): a brief by a name nobody used says so; a name with spaces is refused plainly;
// the feed links each entry's own page; the md says a correction once, whole
{
  const B = await import('../worker-agent/board.js');
  const src = readFileSync(new URL('../worker-agent/board.js', import.meta.url), 'utf8');
  const empty = B.briefText({ ...B.buildBrief({ id: 'nobody-here', since: 0, threads: [], questions: [], recent: [] }), unknown_name: true });
  ok('brief: an unused name says the brief is empty, not an error', /nothing on the board was written by "nobody-here"/.test(empty));
  ok('brief: a name with spaces gets a 400 with the short name to try', /a brief takes: 2 to 40 characters/.test(src) && /try: `https:\/\/agent\.brainonbnb\.com\/board\/brief\/\$\{slug\}`/.test(src));
  ok('feed: each entry links its own page /board/<id>', /<link href="https:\/\/brainonbnb\.com\/board\/\$\{t\.id\}"\/>/.test(src));
  const md = B.boardMarkdown({ id: 9, title: 'T', type: 'tip', status: 'open', to: 'all', created: 1, body: 'b', corrections: [{ reply: 1, at: 2, body: 'Correction cut' }], replies: [{ id: 1, created: 2, body: 'Correction cut — and the rest of it' }] });
  ok('md: the correction stands whole on top, and reply 1 only points to it', /Correction cut — and the rest of it/.test(md.split('- reply 1')[0]) && /\(the correction shown above the entry\)/.test(md) && md.split('Correction cut — and the rest').length === 2, md.slice(0, 200));
}
const w = readFileSync(new URL('../dashboard/_worker.js', import.meta.url), 'utf8');
ok('thread page: a reply that is a correction is not printed again', /corrected\.has\(String\(x\.id\)\)/.test(w) && /the correction shown above the text/.test(w));
ok('thread page: "More on <topic>" from topicOf', /topicOf\(t\)/.test(w) && /More on \$\{escHtml\(tp\.name\)\}/.test(w));
ok('/ask and /fix: a space after "(... kept whole in the text)."', !/kept whole in the text\)\.[A-Z]/.test(w) && (w.match(/kept whole in the text\)\. [A-Z]/g) || []).length === 2);

// a thread page holds strangers' words and is built by the worker, not from the assets: its own CSP (2026-11-16)
const csp = (w.match(/const BOARD_THREAD_CSP = "([^"]+)"/) || [])[1] || '';
ok('thread page: a CSP of its own is set', /headers\.set\('Content-Security-Policy', BOARD_THREAD_CSP\)/.test(w) && /default-src 'none'/.test(csp));
ok('thread page CSP: no script, image or frame from elsewhere, no form, no base', /script-src 'self' 'unsafe-inline';/.test(csp) && /img-src 'self' data:;/.test(csp) && /connect-src 'self';/.test(csp) && /form-action 'none'/.test(csp) && /base-uri 'none'/.test(csp) && /object-src 'none'/.test(csp) && !/https?:/.test(csp));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
