// Pins the job board's rules (shared/job-board.js), both ways (2026-10-22).
//
// Every pin runs against the real buildBoard (must hold) and against a naive board that counts every job of every
// provider (must break) — a pin that a board without the rule also passes pins nothing.
//   node scripts/job-board-check.mjs          the pins
//   node scripts/job-board-check.mjs --live   and the worker's board at agent.brainonbnb.com/jobs/board
import { buildBoard } from '../shared/job-board.js';

const NOW = 1_800_000_000, DAY = 86400;
const OURS = new Set(['0xour', '0xourclient']);
const FARM = '0xfarm';
// [provider, client, status, budget, submitted_at, expired_at]
const R = {
  1: ['0xa', '0xa', 'C', 1, NOW - DAY, 0],               // self-hire
  2: ['0xour', '0xourclient', 'C', 1, NOW - DAY, 0],     // our wallet hiring our agent
  3: ['0xour', '0xstranger', 'C', 0.1, NOW - DAY, 0],    // a stranger paying ours
  4: ['0xb', '0xourclient', 'C', 0.1, NOW - DAY, 0],     // our wallet paying someone else: their work
  5: ['0xfarm', '0xc1', 'C', 0.01, NOW - DAY, 0],        // the farm
  6: ['0xfarm', '0xc2', 'C', 0.01, NOW - DAY, 0],
  7: ['0xfarm', '0xc3', 'C', 0.01, NOW - DAY, 0],
  8: ['0xb', '0xc4', 'S', 0.1, NOW - DAY, 0],            // delivered, not released
  9: ['0xb', '0xc5', 'C', 0, NOW - DAY, 0],              // completed for nothing
  10: ['0xb', '0xc6', 'C', 0.1, NOW - 40 * DAY, 0],      // paid, but 40 days ago
  11: ['0xe', '0xe1', 'C', 0.1, NOW - DAY, 0],           // e: 2 paid by 1 client, listed first
  12: ['0xe', '0xe1', 'C', 0.1, NOW - DAY, 0],
  13: ['0xd', '0xd1', 'C', 0.1, NOW - DAY, 0],           // d: 2 paid by 2 clients — d leads on clients
  14: ['0xd', '0xd2', 'C', 0.1, NOW - DAY, 0],
  15: ['0xf', '0xf1', 'O', 0.1, 0, NOW + DAY],           // never funded
};

function naive(records) {
  const per = {};
  for (const [p, c, s, b, t] of Object.values(records)) {
    const x = (per[p] ??= { provider: p, ours: OURS.has(p), delivered_30d: 0, paid_30d: 0, clients_30d: new Set(), paid_ever: 0 });
    x.delivered_30d++; x.paid_30d++; x.paid_ever++; x.clients_30d.add(c); void s; void b; void t;
  }
  const ranking = Object.values(per).map((x) => ({ ...x, clients_30d: x.clients_30d.size })).sort((a, b) => b.delivered_30d - a.delivered_30d);
  return { ranking, ours: ranking.filter((x) => x.ours), totals_30d: { delivered: Object.keys(records).length } };
}

const row = (b, p) => b.ranking.find((x) => x.provider === p);
const PINS = [
  ['an address hiring itself is not work', (b) => !row(b, '0xa')],
  ['our wallet hiring our agent is a test: ours counts only the stranger', (b) => row(b, '0xour')?.paid_30d === 1 && row(b, '0xour')?.clients_30d === 1],
  ['the farm is never in the ranking', (b) => !row(b, FARM)],
  ['delivered and not released is not paid', (b) => row(b, '0xb')?.delivered_30d === 2 && row(b, '0xb')?.paid_30d === 1],
  ['a job paid 40 days ago counts ever, not in 30 days', (b) => row(b, '0xb')?.paid_ever === 2],
  ['our wallet paying someone else is their work', (b) => row(b, '0xb')?.clients_30d === 2],
  ['a job never funded is nowhere', (b) => !row(b, '0xf')],
  ['paid ties are ranked by clients', (b) => b.ranking.findIndex((x) => x.provider === '0xd') < b.ranking.findIndex((x) => x.provider === '0xe') && b.ranking.findIndex((x) => x.provider === '0xd') >= 0],
  ['30-day totals: 7 delivered, 6 paid', (b) => b.totals_30d.delivered === 7 && b.totals_30d.paid === 6],
];

let bad = 0;
const real = buildBoard(R, { ours: OURS, farms: [FARM], now: NOW });
const fake = naive(R);
for (const [name, ok] of PINS) {
  const holds = !!ok(real), caught = !ok(fake);
  if (!holds || !caught) bad++;
  console.log(`${holds && caught ? 'PASS' : 'FAIL'}  ${name}${holds ? '' : ' — the board breaks it'}${caught ? '' : ' — a board without the rule passes too'}`);
}

if (process.argv.includes('--live')) {
  const b = await fetch('https://agent.brainonbnb.com/jobs/board').then((r) => r.json());
  const live = [
    ['the board was read in the last 26 hours', Date.now() - Date.parse(b.measured_at) < 26 * 3600e3],
    ['every new job was read', b.run && b.run.unread === 0],
    ['ranked by paid, then clients', (b.ranking || []).every((x, i, a) => !i || a[i - 1].paid_30d > x.paid_30d || (a[i - 1].paid_30d === x.paid_30d && a[i - 1].clients_30d >= x.clients_30d))],
    ['the farm is on its own line, not ranked', b.farm && !(b.ranking || []).some((x) => x.provider === b.farm.address)],
    ['paid never exceeds delivered', (b.ranking || []).every((x) => x.paid_30d <= x.delivered_30d)],
    ['our row is in the board', (b.ours || []).length > 0],
  ];
  for (const [name, ok] of live) { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  live: ${name}`); }
}
console.log(bad ? `${bad} FAIL` : 'all PASS');
process.exit(bad ? 1 : 0);
