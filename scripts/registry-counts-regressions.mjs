// Pins /registry's numbers to agree with each other and with /services (2026-11-16, Liste A of the 15.11. review):
//   - the growth line counts against the scan it shows (highest_id - registered_ids), not the daily row's own baseline
//     (it read "+8,763 · 419,005 on 2026-11-15 -> 418,966" for a day) — in the page AND in its generator
//   - the reputation card says when its 995 answered (the page's other figure is 1,007, from a later scan)
//   - without a browser the headline count is the live high-water mark when higher, as /services does
//   node scripts/registry-counts-regressions.mjs
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (name, cond) => { console.log((cond ? '  ok    ' : '  FAIL  ') + name); if (!cond) fails++; };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const page = read('dashboard/registry.html'), gen = read('scripts/erc8004-publish.mjs'), w = read('dashboard/_worker.js');

const SINCE = /var since = last && base \? Number\(last\.highest_id\|\|0\) - Number\(base\.registered_ids\|\|0\) : 0;/;
for (const [n, s] of [['page', page], ['generator', gen]]) {
  ok(`${n}: growth = highest_id - registered_ids of the scan shown`, SINCE.test(s) && !/var since = last && last\.new_since_baseline/.test(s));
}
// any count (995 on 25 Oct, 1,007 on 19 Nov when the scan became a weekly step), always with its day
ok('page: the reputation card says the day its agents answered', /of the [\d,]+ that answered on \d{4}-\d{2}-\d{2} &mdash;/.test(page) && !/of [\d,]+ that answer &mdash;/.test(page));
ok('generator: the same, from reputation.measured_at', /that answered on \$\{esc\(String\(reputation\.measured_at/.test(gen) && /agents we asked about on \$\{esc\(String\(reputation\.measured_at/.test(gen));
const reg = (w.match(/'\/registry': \{[\s\S]*?\n {2}\} \},/) || [''])[0];
ok('worker: /registry asks /census and api-registry.json', /'\/census'/.test(reg) && /api-registry\.json/.test(reg));
ok('worker: writes #rg-live-total and #rg-tile-total only when live > floor', /'#rg-live-total': ids/.test(reg) && /'#rg-tile-total': ids/.test(reg) && /live > floor/.test(reg));

// the record sources are edge-cached and a slow one finishes in the background (TTFB /services ~1 s, /buys 3.3 s > 2.5 s)
// (2026-11-28) the cache moved into edgeRecord, which also keeps a day-old spare for a slow source; the behaviour itself
// is tested with a fake cache in edge-record-regressions.mjs, this pins that the pages still go through it
const ask = (w.match(/const ask = async \(u\) => \(await edgeRecord\(u, ctx, \d+\)\)\.json;/) || [''])[0];
const er = (w.match(/async function edgeRecord\(u, ctx, waitMs = \d+\) \{[\s\S]*?\n\}\n/) || [''])[0];
ok('worker: record sources kept 120 s in caches.default (+ a day as a spare), slow ones finish in waitUntil', !!ask && /caches\.default/.test(er) && /keep\(120\)/.test(er) && /keep\(86400\)/.test(er) && /ctx\.waitUntil\(f\)/.test(er) && /Promise\.race/.test(er));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
