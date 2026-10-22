// Pins the $BOBAI holder count (worker-agent/holders.js), both ways (2026-10-22).
// Each pin holds on the real summarize/applyTransfers and must break on a naive count that takes every address with
// a balance. --live also reads agent.brainonbnb.com/holders.
//   node scripts/holders-check.mjs [--live]
import { summarize, applyTransfers, PASS_LINE } from '../worker-agent/holders.js';

const E = 10n ** 18n, w = (n) => String(BigInt(n) * E);
const OUR = '0x73809f69916fcf7ddc5bb1315fbdf96a569a5963', PAIR = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6', DEAD = '0x000000000000000000000000000000000000dead';
const state = { block: 1, code: { [PAIR]: 1 }, bal: { [PAIR]: w(1e8), [DEAD]: w(1e8), [OUR]: w(5e6), '0xa': w(2e6), '0xb': w(999999), '0xc': w(50), '0xd': '0' } };
const naive = (s) => { const p = Object.values(s.bal).filter((x) => BigInt(x) > 0n); return { holders: p.length, holders_1m: p.filter((x) => BigInt(x) >= PASS_LINE).length }; };
let bad = 0;
const pin = (name, ok, okNaive) => { const pass = ok && !okNaive; if (!pass) bad++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — breaks on the real count'}${okNaive ? ' — a naive count passes too' : ''}`); };
const real = summarize(state), nv = naive(state);
pin('people only: the pool, the burn address and empty ones are not holders; our wallet is one (4 people)', real.holders === 4, nv.holders === 4);
pin('1M+ counts people at or over 1,000,000 (ours and 0xa; 0xb is one short)', real.holders_1m === 2, nv.holders_1m === 2);
pin('bands add up to the holders', real.bands.reduce((s, b) => s + b.holders, 0) === real.holders, false);
// a crossing: 0xb buys 2 from the pair -> crosses; 0xa buys more -> no crossing (already over); a contract crossing -> none
const bal = { ...state.bal };
const crossed = applyTransfers(bal, [
  { from: PAIR, to: '0xb', value: 2n * E, block: 2, tx: '0x1' },
  { from: PAIR, to: '0xa', value: 5n * E, block: 2, tx: '0x2' },
  { from: '0xc', to: '0xnewcontract', value: 2n * PASS_LINE, block: 3, tx: '0x3' },
  { from: PAIR, to: '0x15ba17075ef5e0736292b030e3715d9100fe3d38', value: 2n * PASS_LINE, block: 3, tx: '0x4' },
], (a) => a === PAIR || a === '0xnewcontract');
pin('a person crossing 1M is recorded once, with its tx; one already over, a contract and our own wallet are not', crossed.length === 1 && crossed[0].address === '0xb' && crossed[0].tx === '0x1', crossed.length === 4);
pin('balances move both ways', BigInt(bal['0xb']) === 1000001n * E && BigInt(bal[PAIR]) === BigInt(w(1e8)) - 7n * E - 2n * PASS_LINE, false);
if (process.argv.includes('--live')) {
  const j = await fetch('https://agent.brainonbnb.com/holders?address=0x1afa57').then((r) => r.json()).catch(() => ({}));
  const h = await fetch('https://agent.brainonbnb.com/holders').then((r) => r.json());
  const live = [
    ['read in the last 30 minutes', Date.now() - Date.parse(h.read_at) < 30 * 60e3],
    ['holders and 1M+ are counts, 1M+ <= holders', h.holders > 0 && h.holders_1m > 0 && h.holders_1m <= h.holders],
    ['bands add up', h.bands.reduce((s, b) => s + b.holders, 0) === h.holders],
    ['the top list is sorted and starts at rank 1', h.top[0].rank === 1 && h.top.every((x, i, a) => !i || a[i - 1].bobai >= x.bobai)],
    ['no contract in the top list', !h.top.some((x) => [PAIR, DEAD].includes(x.address))],
    ['a bad address is refused', !!j.error],
  ];
  for (const [n, ok] of live) { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  live: ${n}`); }
}
console.log(bad ? `${bad} FAIL` : 'all PASS');
process.exit(bad ? 1 : 0);
