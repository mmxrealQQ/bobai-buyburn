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
ok('page: the reputation card says the day its 995 answered', /of the 995 that answered on \d{4}-\d{2}-\d{2} &mdash;/.test(page) && !/of 995 that answer &mdash;/.test(page));
ok('generator: the same, from reputation.measured_at', /that answered on \$\{esc\(String\(reputation\.measured_at/.test(gen) && /agents we asked about on \$\{esc\(String\(reputation\.measured_at/.test(gen));
const reg = (w.match(/'\/registry': \{[\s\S]*?\n {2}\} \},/) || [''])[0];
ok('worker: /registry asks /census and api-registry.json', /'\/census'/.test(reg) && /api-registry\.json/.test(reg));
ok('worker: writes #rg-live-total and #rg-tile-total only when live > floor', /'#rg-live-total': ids/.test(reg) && /'#rg-tile-total': ids/.test(reg) && /live > floor/.test(reg));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
