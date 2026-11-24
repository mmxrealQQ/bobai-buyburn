#!/usr/bin/env node
// shared/tax-owed.js — the buyback bot's owed shares (Liste B point 1, 2026-11-24): nothing owed splits exactly as before;
// what is owed is paid first, to its own leg; an ended leg's owed goes to BOBAI liquidity (else the BOBAI burn); not
// enough to cover it waits; a leg is owed again only when its BNB demonstrably stayed. Offline, pure.
import { planSplit, stillOwed, readOwed, writeOwed } from '../shared/tax-owed.js';

let pass = 0, fail = 0;
const say = (ok, t, got) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}${ok || got === undefined ? '' : `  (got ${JSON.stringify(got, (k, v) => (typeof v === 'bigint' ? String(v) : v))})`}`); };
const E = (x) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;   // BNB -> wei (6 decimals)
const OLD = (available, b) => { const c = (available * BigInt(b.creator)) / 300n, bb = (available * BigInt(b.bobBurn || 0)) / 300n, bl = (available * BigInt(b.bobLiq || 0)) / 300n, al = (available * BigInt(b.bobaiLiq || 0)) / 300n, w = (available * BigInt(b.wc26 || 0)) / 300n, l = (available * BigInt(b.lpAgent || 0)) / 300n, g = (available * BigInt(b.giggle || 0)) / 300n; return { creator: c, bobBurn: bb, bobLiq: bl, bobaiLiq: al, wc26: w, lpAgent: l, giggle: g, bobaiBurn: available - c - bb - bl - al - w - l - g }; };

const NOW = { creator: 100, bobBurn: 0, bobaiBurn: 100, bobLiq: 0, bobaiLiq: 100, wc26: 0, lpAgent: 0, giggle: 0 };       // from Dec 1
const NOV = { creator: 90, bobBurn: 0, bobaiBurn: 90, bobLiq: 0, bobaiLiq: 90, wc26: 0, lpAgent: 30, giggle: 0 };       // a phase with a fourth share
const a = E(0.012345);
for (const [name, b] of [['Dec 1 split', NOW], ['a four-way phase', NOV]]) {
  const p = planSplit(a, b, {}), o = OLD(a, b);
  say(!p.wait && Object.keys(o).every((k) => p.amount[k] === o[k]), `nothing owed: ${name} is split exactly as before, to the wei`, { got: p.amount, want: o });
}
const p1 = planSplit(a, NOW, { bobaiBurn: String(E(0.004)) });
say(p1.base === a - E(0.004) && p1.amount.bobaiBurn === OLD(a - E(0.004), NOW).bobaiBurn + E(0.004) && p1.amount.creator === OLD(a - E(0.004), NOW).creator, 'owed to the BOBAI burn: paid to it first, the creator gets a share of the rest only', p1.amount);
const p2 = planSplit(a, NOW, { bobBurn: String(E(0.002)), bobLiq: String(E(0.001)), giggle: String(E(0.0005)) });
say(p2.amount.bobaiLiq === OLD(a - E(0.0035), NOW).bobaiLiq + E(0.0035) && (p2.amount.bobBurn || 0n) === 0n, 'owed to ended shares (BOB burn, BOB liquidity, Giggle) goes to BOBAI liquidity', p2.amount);
const p3 = planSplit(a, { ...NOW, bobaiLiq: 0, bobaiBurn: 200 }, { bobBurn: String(E(0.002)) });
say(p3.amount.bobaiBurn === OLD(a - E(0.002), { ...NOW, bobaiLiq: 0, bobaiBurn: 200 }).bobaiBurn + E(0.002), 'with no BOBAI liquidity share, an ended share\'s owed goes to the BOBAI burn', p3.amount);
const p4 = planSplit(a, NOW, { bobaiLiq: String(a) });
say(p4.wait === true && p4.amount === null, 'what is owed is not covered: the run waits and pays nothing', p4);
const p5 = planSplit(a, NOW, { bobaiLiq: String(E(0.001)), creator: String(E(0.005)), x: '7', bobaiBurn: 'nope' });
say(p5.owedTotal === E(0.001), 'the creator is never owed, unknown keys and bad values are nothing', p5.owed);
const sum = Object.values(planSplit(a, NOW, { bobaiLiq: String(E(0.003)) }).amount).reduce((x, y) => x + y, 0n);
say(sum === a, 'every wei of the available BNB is in the plan, none twice', String(sum));

// stillOwed: only a failed leg whose BNB stayed
say(stillOwed(E(0.004), false, E(0.02), E(0.02) - E(0.00002)) === E(0.004), 'a failed leg whose BNB stayed (only gas went): owed');
say(stillOwed(E(0.004), false, E(0.02), E(0.016)) === 0n, 'a failed leg whose BNB left (the swap went, the burn did not): not owed — never paid twice');
say(stillOwed(E(0.004), true, E(0.02), E(0.02)) === 0n, 'a leg that did its work: not owed');
say(stillOwed(E(0.0002), false, E(0.02), E(0.02)) === E(0.0002), 'a liquidity slice too small to add (skipped, nothing spent): owed until it is big enough');
say(stillOwed(0n, false, 1n, 1n) === 0n, 'a zero leg is never owed');
const kept = writeOwed({ bobaiLiq: E(0.001), bobaiBurn: 0n });
say(JSON.stringify(kept) === JSON.stringify({ bobaiLiq: String(E(0.001)) }) && readOwed(kept).bobaiLiq === E(0.001), 'kept as strings, read back as BigInt, zero shares dropped');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
