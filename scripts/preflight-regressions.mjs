#!/usr/bin/env node
// Pins what bsc_token_preflight (dashboard/preflight.js) makes of a pool scan
// and a route answer: which facts stop a trade, which are a caution, and that
// a missing figure is never turned into a good one. Offline — shape() takes the
// two answers as plain objects; the measurements behind them have their own
// checks (route-check, sell-sim-check, band-depth-check).
//
//   node scripts/preflight-regressions.mjs      (self-tests.mjs runs it as it is)
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
registerHooks({
  load(url, ctx, next) { return /\/(dashboard|shared)\/[^/]+\.js$/.test(url) ? next(url, { ...ctx, format: 'module' }) : next(url, ctx); },
});
const { shape, costAtSize } = await import(pathToFileURL(path.resolve(import.meta.dirname, '../dashboard/preflight.js')).href);

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };
const codes = (a) => a.map((x) => x.code).join();

const ladder = [100, 500, 1000, 5000].map((sizeUsd, i) => ({ sizeUsd, buyCostPct: 0.3 + i, sellCostPct: 0.4 + i }));
const scan = (over = {}) => ({
  address: '0x' + 'a'.repeat(40), name: 'T', symbol: 'T', quotable: true, block: 1, measuredAt: 'now',
  pool: { address: '0x' + 'b'.repeat(40), venue: 'PancakeSwap V2', liquidityUsd: 5000000, shareOfLiquidity: 0.9, partialMarket: false },
  tradeCost: ladder, onePercentDepth: { buyUsd: 50000, sellUsd: 51000 },
  sellability: { ok: true, sellable: true, buyable: true },
  tax: { buyPct: 0, sellPct: 0, measured: true, source: 'measured from executed trades on-chain' },
  lp: { burnedPct: 99.9 }, contract: { openSource: true, properties: { is_open_source: true, is_mintable: false } },
  ...over,
});
const route = (over = {}) => ({
  best_route: 'V2 0.25%', best_route_pool: '0x' + 'b'.repeat(40), best_route_is_the_deepest_pool: true,
  you_pay: { amount: 1, symbol: 'BNB' }, you_would_receive: 100, slippage_bps_needed: 56,
  round_trip: { you_keep_pct: 99.4, you_keep_pct_pools_only: 99.4 },
  transfer_tax: { buy_pct: 0, sell_pct: 0, source: 'measured from executed trades on-chain' },
  refuse_to_trade: [], round_trip_caveat: null, ...over,
});

let o = shape(scan(), route(), 250);
ok('a healthy pair: nothing stops, nothing to weigh, and the figures are the route’s', o.stop.length === 0 && o.caution.length === 0 && o.entry.slippage_bps_needed === 56 && o.exit.round_trip_cost_pct === 0.6, JSON.stringify([o.stop, o.caution, o.exit]));
ok('it never says safe and carries no score', !/\bsafe\b/i.test(JSON.stringify({ ...o, cannot_see: [] })) && !('score' in o));

o = shape(scan({ sellability: { ok: true, sellable: false, buyable: true, sell_error: 'TRANSFER_FROM_FAILED' } }), route(), 250);
ok('a sell that does not go through STOPS, with the router’s reason', codes(o.stop) === 'not_sellable' && /TRANSFER_FROM_FAILED/.test(o.stop[0].why) && o.exit.sellable === false, codes(o.stop));

o = shape(scan({ sellability: { ok: false, reason: 'rpc refused the override' } }), route(), 250);
ok('a simulation that did not run is "not checked": a caution, sellable null — never true', codes(o.caution).includes('sell_not_simulated') && o.exit.sellable === null && o.stop.length === 0, JSON.stringify(o.exit));

o = shape(scan(), route({ refuse_to_trade: ['An immediate round trip returns 31.0% of what went in.'] }), 250);
ok('the route’s own refusal is passed on as a stop', codes(o.stop) === 'round_trip');

o = shape(scan({ tax: { buyPct: null, sellPct: null, measured: false } }), route({ transfer_tax: { buy_pct: null, sell_pct: null, source: 'not measurable' } }), 250);
ok('an unknown tax is a caution and stays null — never 0', codes(o.caution).includes('tax_unknown') && o.tax.buy_pct === null && o.tax.sell_pct === null);

o = shape(scan({ contract: { properties: { slippage_modifiable: true } } }), route({ transfer_tax: { buy_pct: 12, sell_pct: 3, source: 'm' } }), 250);
ok('a 12% buy tax is named with its line; 3% is not; a changeable tax is said', codes(o.caution).includes('high_buy_tax') && !codes(o.caution).includes('high_sell_tax') && codes(o.caution).includes('tax_can_change'), codes(o.caution));

o = shape(scan({ onePercentDepth: { buyUsd: 147, sellUsd: 153 } }), route(), 500);
ok('a size above the 1% depth is said, against the thinner side', /\$147\b/.test(o.caution.find((c) => c.code === 'size_moves_price')?.why || ''));

o = shape(scan({ lp: { burnedPct: 0 }, pool: { address: '0xp', venue: 'PancakeSwap V2', liquidityUsd: 40000 } }), route(), 250);
ok('an unburned LP on a thin pool is a caution …', codes(o.caution).includes('lp_withdrawable'));
o = shape(scan({ lp: { burnedPct: 0 } }), route(), 250);
ok('… and on a five-million pool (CAKE burns none of its LP) it is not', !codes(o.caution).includes('lp_withdrawable'));

o = shape(scan(), null, 750, 'No PancakeSwap route against this pair’s deepest quote.');
ok('without a route the ladder answers, read between its rungs, and says so', codes(o.caution).includes('no_route_quote') && o.entry.cost_pct === 1.8 && o.exit.cost_pct === 1.9 && o.exit.round_trip_cost_pct === 3.7, JSON.stringify([o.entry, o.exit]));
o = shape(scan(), null, 90000, 'x');
ok('a size beyond the ladder is flagged, not extrapolated', codes(o.caution).includes('size_beyond_ladder') && o.entry.cost_pct === 3.3);
ok('costAtSize: below the first rung is the first rung; no rows is null', costAtSize(ladder, 10, 'buyCostPct').pct === 0.3 && costAtSize([], 10, 'buyCostPct').pct === null);

o = shape({ address: '0xc', symbol: 'C', name: 'C', quotable: false, reason: 'curve', curve: { progressPct: 41.5, feePct: 1, sellQuoted: false, tradeCost: [{ sizeUsd: 100, buyCostPct: 1.2, sellCostPct: null }] } }, null, 100);
ok('on the four.meme curve: said so, the curve’s figures, and no sell quote STOPS', codes(o.caution).includes('on_launch_curve') && codes(o.stop) === 'sell_not_quotable' && o.entry.cost_pct === 1.2 && o.venue === 'four.meme bonding curve');

o = shape({ address: '0xd', symbol: 'D', name: 'D', quotable: false, reason: 'No pool at a venue whose swap fee has been verified here.' }, null, 100);
ok('no readable market: a stop with the scan’s reason, entry and exit null', codes(o.stop) === 'not_quotable' && o.entry === null && o.exit === null && /No pool/.test(o.stop[0].why));

console.log(fails ? `\n${fails} FAILED` : '\npreflight: all pins hold');
process.exit(fails ? 1 : 0);
