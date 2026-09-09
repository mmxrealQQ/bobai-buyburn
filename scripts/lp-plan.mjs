#!/usr/bin/env node
// WHERE THIS PROJECT WOULD PUT ITS OWN LIQUIDITY, decided by its own tools.
//
// Everything else in this repo measures pools for other people. This asks the
// same question about our own money and answers it with the same two published
// instruments and no others: pancakeswap_fee_tiers picks the pool,
// pancakeswap_range_plan picks the width. There is no override here and no
// hand-picked favourite. If the answer looks unusable, that is a finding about
// the tools, and the tools are what get fixed.
//
// READ-ONLY. It holds no key, signs nothing and moves nothing. The decision
// itself lives in scripts/lib/lp-decision.mjs, which lp-open.mjs also uses, so
// that the plan a person reads and the position that gets minted cannot be two
// different plans.
//
// Usage:
//   node scripts/lp-plan.mjs [--usd 50]
import { decide } from './lib/lp-decision.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : dflt;
};
const USD = Number(arg('--usd', 50)) || 50;

const fmt = (n, d = 6) => (n == null ? '—' : Number(n).toFixed(d));
const usd = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));

console.log(`Where $${USD} of liquidity would go, decided by our own two tools\n`);

const out = await decide({ usd: USD });

for (const c of out.candidates) {
  if (c.skipped) { console.log(`${c.sym.padEnd(6)} — ${c.skipped}\n`); continue; }
  console.log(`${c.sym}/${c.plan.pair.quote.symbol} — ${c.why}`);
  console.log(`  tier by working capital : ${c.tiers.best_paying_tier_by_working_capital || '(withheld — not every tier was readable)'}`
    + (c.pickedIsV2 ? '  ← a V2 tier, which has no range; the deepest V3 is used below so this pair is still compared' : ''));
  console.log(`  using                   : ${c.row.tier}  pool ${c.plan.pool}`);
  console.log(`  standing at the price   : ${usd(c.row.working_capital_usd)} of ${usd(c.row.capital_usd)} held (${fmt(c.row.working_share_pct, 2)}%)`);
  console.log(`  window                  : ${c.plan.measured_window.swaps} swaps over ${c.plan.measured_window.minutes} min, pool paid ${usd(c.plan.measured_window.fees_the_pool_paid_usd)}`);
  console.log(`  narrowest that held     : ${c.held || 'none — the price was outside every width at some point'}`);
  if (c.heldRow) {
    console.log(`  it would have collected : $${fmt(c.heldRow.fees_usd_in_window)} on $${USD}, net $${fmt(c.heldRow.net_after_rebalancing_usd_in_window)} after putting it back`);
    if (c.full && c.full.fees_usd_in_window > 0)
      console.log(`  against full range      : ${Math.round(c.heldRow.fees_usd_in_window / c.full.fees_usd_in_window)}×`);
  }
  console.log('');
}

const w = out.winner;
if (!w) {
  console.log('No candidate had a range that held for the whole measured window and still came out ahead of what');
  console.log('putting it back would cost. That is an answer, not a gap: in this window there was nowhere here to');
  console.log('put money without watching it. Nothing to execute.');
  out.tools.cleanup();
  process.exit(0);
}

console.log('─'.repeat(74));
console.log(`THE PLAN — $${USD} into ${w.symbol}/${out.candidates.find((c) => c.sym === w.symbol).plan.pair.quote.symbol} ${w.tier}`);
console.log('─'.repeat(74));
console.log(`  pool          ${w.pool}`);
console.log(`  fee tier      ${w.tier}  (chosen by working capital, not by what is parked)`);
console.log(`  range         ±${w.width_pct}%  ${w.price_range.low} … ${w.price_range.high} ${w.price_range.unit}`);
console.log(`  ticks         ${w.tickLower} … ${w.tickUpper}   (spacing ${w.spacing}, current ${w.tickNow}, rounded inward)`);
console.log(`  it needs      ${fmt(w.amount0, 8)} of token0 and ${fmt(w.amount1, 8)} of token1`);
console.log(`                the split is fixed by where the price sits in the range — half and half would be wrong`);
console.log(`  measured      $${fmt(w.measured.fees_usd_in_window)} collected over ${w.window.minutes} min, in range the whole time`);
console.log(`  one crossing  $${fmt(w.rebalanceUsd, 2)} of gas to put it back`);
console.log(`  best net      ${w.bestNet} once the nursing is paid for${w.bestNet === `±${w.width_pct}%` ? ' — the same width' : ' — a DIFFERENT width from the one that held'}`);
console.log('');
console.log('  What this plan does NOT claim:');
console.log('   · Nothing is annualised. The window is one sample of about an hour.');
console.log('   · Impermanent loss is not in the figure, and it is worst exactly where the fees are best.');
console.log('   · The price stayed inside this range for one window. That is what happened, not what will.');
console.log(`   · Opening costs gas: wrap, swap, two approvals and a mint, roughly $${fmt(0.0012 * w.bnbUsd, 2)} at 1 gwei — ${(0.0012 * w.bnbUsd / USD * 100).toFixed(1)}% of the position.`);
console.log('');
console.log(w.runnerUp
  ? `  Runner-up: ${w.runnerUp.sym} ${w.runnerUp.row.tier} at net $${fmt(w.runnerUp.heldRow.net_after_rebalancing_usd_in_window)} — kept so the winner is a comparison rather than an assertion.`
  : '  Runner-up: none. One candidate had a range that held, so this is a choice of one — worth saying out loud.');
console.log('');
console.log('  Nothing has moved. To open it: node scripts/lp-open.mjs   (prints again, still moves nothing)');

out.tools.cleanup();
