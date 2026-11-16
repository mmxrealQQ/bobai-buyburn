// Pins Liste B "DeFi-Record 218,227 vs Kette 220,273.5" (2026-11-16): the gap is the 2,046.485 $BOBAI bought on 14.10. by
// hand (scripts/sweep-dormant.mjs, the Set and Earn $U, tx 0xa07e6597…) — every one of the 46 runs' buys since 9.9.
// matches the chain to the unit (temp/bobai-gap.mjs). What the agent HOLDS is now the chain's figure; the fee share's
// own count stays beside it, and a difference is named.
//   node scripts/lp-held-bobai-regressions.mjs      (offline)
import { readFileSync } from 'node:fs';
import { heldBobai, HAND_BOBAI, lpPortfolio } from '../worker-agent/lp-portfolio.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };

let h = heldBobai(218227.062, 220273.547);
ok('with the chain read: holds = the wallet\'s balance', h.units === 220273.547 && h.source === 'chain', JSON.stringify(h));
ok('the fee share\'s own count stays beside it', h.from_fees === 218227.062);
ok('the 2,046.485 are named: bought by hand on 14.10. from the Set and Earn $U', h.other && Math.abs(h.other.units - 2046.485) < 0.01 && /2026-10-14 by hand/.test(h.other.why), JSON.stringify(h.other));
h = heldBobai(218227.062, null);
ok('no node answered: the record\'s figure, as before, and it says so', h.units === 218227.062 && h.source === 'record' && h.other === null);
h = heldBobai(100, 100.2);
ok('a rounding difference is no difference', h.other === null);
h = heldBobai(100, 50);
ok('a wallet holding less than the record bought (a transfer out) is named, not hidden', h.other && h.other.units === -50 && /not bought by a run/.test(h.other.why));
ok('the hand buy is the one found on chain', HAND_BOBAI.units === 2046.485 && /0xa07e6597/.test(HAND_BOBAI.why));

// through the whole model
const rec = { last: { at: '2026-11-16T04:23:00Z', steps: {} }, history: [] };
const series = { points: [{ at: '2026-11-16T04:23:00Z', value_bnb: 2.5, wallet_bnb: 0 }], summary: { bobai_held_units: 218227.062, fees_into_bobai_bnb: 0.06, since: '2026-09-04T00:00:00Z', profit: { bnb: 0.01, bnb_usd: 900, from_price_bnb: 0, from_fees_bnb: 0.13, gas_bnb: 0.005 }, value_bnb: { start: 2.4, now: 2.5, change_pct: 1 } } };
let m = null; try { m = lpPortfolio(rec, series, { bobaiUsd: 0.00026, bnbUsdNow: 900, bobaiHeldChain: 220273.547 }); } catch (e) { m = { error: String(e.message) }; }
ok('the portfolio says what the wallet holds, in units and dollars', m?.holdings?.bobai_units === 220274 && m.holdings.bobai_source === 'chain' && m.holdings.bobai_from_fees_units === 218227 && Math.abs(m.holdings.bobai_usd - 220273.547 * 0.00026) < 0.01, JSON.stringify(m?.holdings || m).slice(0, 200));
ok('the P&L still counts what the fees bought (218,227), not the hand buy', m?.pnl?.bobai_units === 218227);

const src = readFileSync(new URL('../worker-agent/index.js', import.meta.url), 'utf8');
ok('the portfolio reads the wallet\'s balanceOf beside the other six reads', /callQuick\(BOBAI, '0x70a08231' \+ OWN_LP_WALLET/.test(src) && /bobaiHeldChain \}\);/.test(src));
const site = readFileSync(new URL('../dashboard/_worker.js', import.meta.url), 'utf8');
ok('/defi\'s series line prices the fee share\'s own count (units and dollars of the same thing)', /sm\.bobai_held_units \* pf\.holdings\.bobai_usd_price/.test(site));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
