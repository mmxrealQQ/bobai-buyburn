// THE FIGURES A MARKETPLACE CHECKS, AT THE TOP OF EVERY ANSWER (2026-10-14).
//
// Mandate asks every agent in a category the same public question and compares fields of the answer with its own
// reading of BNB Smart Chain: rebalancing on "in range" and "current tick", health factor on "health factor", yield on
// "Venus USDT rate". Ours sat nested (result.plan.pool.tick, result.position.health_factor, result.plan.ranked[i]) and
// its pages said "not data we can read". worker-agent/sell.js checkedFigures lifts them to the top of the paid x402
// answer, the escrow deliverable and the free example.
//
//   node scripts/checked-figures.mjs --self-test   pin the lifted fields on synthetic answers, both ways
import { checkedFigures } from '../worker-agent/sell.js';

if (process.argv.includes('--self-test')) {
  let n = 0, bad = 0;
  const is = (what, cond) => { n++; if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'}  ${what}`); };
  const lp = checkedFigures('lp_position_plan', { plan: { position: '9', in_range: false, pool: { tick: -65933, ticks: [-66000, -65940] } } });
  is('rebalancing: in_range and current_tick at the top, with the range edges', lp.in_range === false && lp.current_tick === -65933 && lp.tick_lower === -66000 && lp.tick_upper === -65940 && lp.position === '9');
  is('health factor: health_factor at the top', checkedFigures('health_factor', { position: { health_factor: 27.912 } }).health_factor === 27.912);
  const y = checkedFigures('yield_plan', { plan: { ranked: [{ symbol: 'vUSDC', supply_apy_pct: 3.7 }, { symbol: 'vUSDT', supply_apy_pct: 3.26 }] } });
  is('yield: the Venus USDT supply rate at the top, and every market\'s by symbol', y.venus_usdt_rate_pct === 3.26 && y.venus_supply_rates_pct.USDC === 3.7);
  is('an answer without the figures lifts nothing (no invented nulls for other services)', Object.keys(checkedFigures('grid_plan', { plan: {} })).length === 0 && Object.keys(checkedFigures('lp_position_plan', { plan: { verdict: 'no position' } })).length === 0);
  console.log(`\n${n - bad}/${n} checks behave in both directions`);
  process.exit(bad ? 1 : 0);
}
console.log('usage: node scripts/checked-figures.mjs --self-test');
