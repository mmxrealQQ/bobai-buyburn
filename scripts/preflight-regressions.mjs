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

// Each side of the tax keeps its own origin: a label never travels under the
// word "measured", and the scan's figure never under the route's sentence.
o = shape(scan({ tax: { buyPct: 0, sellPct: 0, buySource: 'label', sellSource: 'measured', measured: false, source: 'x' } }), route({ transfer_tax: { buy_pct: null, sell_pct: 0, source: 'route measured it' } }), 250);
ok('a buy side known only from a label is said, with the figure, and keeps its own source', codes(o.caution).includes('buy_tax_label_only') && /labelled by GoPlus/.test(o.tax.buy_source) && o.tax.sell_source === 'route measured it' && /^buy: .*; sell: /.test(o.tax.source), JSON.stringify(o.tax));
o = shape(scan({ tax: { buyPct: null, sellPct: 2.5, buySource: 'unknown', sellSource: 'measured', measured: false, source: 'x' } }), route({ transfer_tax: { buy_pct: null, sell_pct: null, source: 'not measurable (quiet)' } }), 250);
ok('a side nothing could establish stays null and is named', o.tax.buy_pct === null && o.tax.sell_pct === 2.5 && codes(o.caution).includes('buy_tax_unknown') && !/not measurable/.test(o.tax.sell_source), JSON.stringify(o.tax));
o = shape(scan({ tax: { buyPct: 3, sellPct: 3, buySource: 'measured', sellSource: 'measured', measured: true, source: 'measured from executed trades on-chain' } }), route({ transfer_tax: { buy_pct: 3, sell_pct: 3, source: 'measured from executed trades on-chain' } }), 250);
ok('two measured sides raise nothing and read as one source; depth names its pool', !codes(o.caution).includes('tax_label_only') && !/;/.test(o.tax.source) && o.depth.pool === '0x' + 'b'.repeat(40), JSON.stringify([o.tax.source, o.depth.pool]));

// A sell test that had to run on the token's side pair against BNB is a fact
// about that pair: it neither clears the pool measured here nor stops it.
o = shape(scan({ sellability: { ok: true, sellable: true, buyable: true, through_scanned_pool: false, pair: '0xside' } }), route(), 250);
ok('a sell test on ANOTHER pair does not clear the exit: sellable null, and said so', o.exit.sellable === null && codes(o.caution).includes('sell_tested_on_another_pair') && o.stop.length === 0, JSON.stringify([o.exit.sellable, codes(o.caution)]));
o = shape(scan({ sellability: { ok: true, sellable: false, buyable: true, sell_error: 'x', through_scanned_pool: false, pair: '0xside' } }), route(), 250);
ok('… and a refusal on that other pair does not stop the trade here', !codes(o.stop).includes('not_sellable') && /did NOT go through there/.test(o.caution.find((c) => c.code === 'sell_tested_on_another_pair')?.why || ''), codes(o.stop));
o = shape(scan({ sellability: { ok: true, sellable: false, buyable: true, sell_error: 'x', through_scanned_pool: true, pair: '0xmain' } }), route(), 250);
ok('through the pool that was read, a refused sell still STOPS', codes(o.stop).includes('not_sellable') && o.exit.sellable === false, codes(o.stop));

// ---- the installable skill carries it, and what it carries resolves ---------
// build-skill.mjs pulls dashboard files into the tarball under new names and
// rewrites './x.js' to './x.mjs' only for files it pulls. A module pulled
// without the ones it imports, or a CLI importing a name nothing lands under,
// builds cleanly and throws on the installer's machine.
{
  const fs = await import('node:fs');
  const root = path.resolve(import.meta.dirname, '..');
  const build = fs.readFileSync(path.join(root, 'scripts/build-skill.mjs'), 'utf8');
  const pulled = Object.fromEntries([...build.matchAll(/'(dashboard\/[\w-]+\.js)':\s*'scripts\/([\w-]+\.mjs)'/g)].map((m) => [m[1], m[2]]));
  const cliDir = path.join(root, 'skills/bsc-pool-depth/scripts');
  const clis = fs.readdirSync(cliDir);
  const members = new Set([...clis, ...Object.values(pulled)]);
  const imports = (src) => [...src.matchAll(/from\s+'\.\/([\w-]+)\.(?:js|mjs)'/g)].map((m) => m[1] + '.mjs');
  const missing = [];
  for (const f of clis) for (const i of imports(fs.readFileSync(path.join(cliDir, f), 'utf8'))) if (!members.has(i)) missing.push(`${f} -> ${i}`);
  for (const [from, to] of Object.entries(pulled)) for (const i of imports(fs.readFileSync(path.join(root, from), 'utf8'))) if (!members.has(i)) missing.push(`${to} -> ${i}`);
  ok('the skill pulls preflight.js and has a CLI on it', pulled['dashboard/preflight.js'] === 'token-preflight.mjs' && clis.includes('preflight.mjs'), JSON.stringify(pulled));
  ok('every import inside the skill tarball lands on a file in it', missing.length === 0, missing.join(', '));
  const probe = new Set([...members].filter((m) => m !== 'swap-route.mjs'));
  ok('… and the check sees a pulled file that is missing', imports(fs.readFileSync(path.join(root, 'dashboard/preflight.js'), 'utf8')).some((i) => !probe.has(i)));
  ok('a CLI and a pulled file never share a name', !clis.some((c) => Object.values(pulled).includes(c)));
}

// A3 (2026-09-24): the one paid follow-up is named, and only where it works —
// the watch reads V2 reserves.
{
  const v2 = shape(scan({ pool: { address: '0x' + 'c'.repeat(40), kind: 'v2', venue: 'PancakeSwap', liquidityUsd: 40000 } }), route(), 500);
  ok('a V2 pool names the watch, with this token, this pair and this size filled in',
    !!v2.keep_watching && v2.keep_watching.how.includes('0x' + 'c'.repeat(40)) && v2.keep_watching.how.includes(v2.token.address) && v2.keep_watching.how.includes('"depthBelowUsd":500'), JSON.stringify(v2.keep_watching));
  ok('… and states no price of its own (the 402 does)', !/\$\s?\d|USD1|\d+\s?days?/i.test(JSON.stringify(v2.keep_watching)));
  const v3 = shape(scan({ pool: { address: '0x' + 'd'.repeat(40), kind: 'v3', venue: 'PancakeSwap V3', liquidityUsd: 40000 } }), route(), 500);
  ok('a V3 pool gets no pointer to a watch that cannot read it', v3.keep_watching === null);
}

console.log(fails ? `\n${fails} FAILED` : '\npreflight: all pins hold');
process.exit(fails ? 1 : 0);
