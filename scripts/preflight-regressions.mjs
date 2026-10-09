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
  holders: { count: 5000, wallets: 10, top10PctOfCirculating: 18, largestPct: 3, largestSellTakesPctOfPool: 4, top: [] },
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
// Who else can sell (2026-09-26), both ways: a wallet that could take a quarter of the pool is said, a spread-out
// token is not. Since 2026-09-27 a scan without a real holder list is NOT silent: holders_unknown (below).
o = shape(scan({ holders: { wallets: 8, top10PctOfCirculating: 36.3, largestPct: 8.2, largestSellTakesPctOfPool: 31 } }), route(), 250);
ok('a wallet that could take 31% of the pool is a caution, with its figures', codes(o.caution).includes('holders_concentrated') && /31%/.test(o.caution.find((c) => c.code === 'holders_concentrated')?.why || ''), codes(o.caution));
o = shape(scan({ holders: { wallets: 10, top10PctOfCirculating: 22, largestPct: 4, largestSellTakesPctOfPool: 9 } }), route(), 250);
ok('… a spread-out holder list is not', !codes(o.caution).includes('holders_concentrated'), codes(o.caution));
o = shape(scan({ holders: { wallets: 10, top10PctOfCirculating: 61, largestPct: 12 } }), route(), 250);
ok('… and half the float in ten wallets is, even on a V3 pool with no sell figure', codes(o.caution).includes('holders_concentrated'), codes(o.caution));
// B1 (2026-09-27): no holder list is "unknown", said — GoPlus answers 0 or 3 holders for a token minutes old.
o = shape(scan({ holders: { unknown: true, count: 3, reason: 'GoPlus counts 3 holders — too few to be the market' } }), route(), 250);
ok('a holder list GoPlus has not built is a caution, with its reason', codes(o.caution).includes('holders_unknown') && /3 holders/.test(o.caution.find((c) => c.code === 'holders_unknown')?.why || '') && !codes(o.caution).includes('holders_concentrated'), codes(o.caution));
o = shape(scan({ holders: undefined }), route(), 250);
ok('… and a scan with no holder block at all says the same, never nothing', codes(o.caution).includes('holders_unknown'), codes(o.caution));
o = shape(scan(), route(), 250);
ok('… while a real, spread-out list raises neither', !codes(o.caution).includes('holders_unknown') && !codes(o.caution).includes('holders_concentrated'), codes(o.caution));
// B2: exchange, lock and staking wallets are out of the figure and named in the sentence.
o = shape(scan({ holders: { count: 1.9e6, wallets: 4, top10PctOfCirculating: 9.6, largestPct: 3.45, largestSellTakesPctOfPool: 47, top: [{ address: '0x86', pct: 3.45, contract: true }], excluded: [{ address: '0xf977', kind: 'exchange', name: 'Binance 8', pct: 23.47 }] } }), route(), 250);
const hc = o.caution.find((c) => c.code === 'holders_concentrated')?.why || '';
ok('the concentration line names what it left out (Binance 8) and says the largest is a contract', /Binance 8 23\.47%/.test(hc) && /a contract/.test(hc) && /3\.45%/.test(hc) && !/may be an exchange/.test(hc), hc);

// I1 (2026-09-27): who holds the LP, by name.
const cust = (over = {}) => ({ read: 'complete', burnedPct: 0, lockedPct: 0, farmPct: 0, exchangeFeePct: 0, walletPct: 100, contractPct: 0, unreadPct: 0,
  largestWallet: { address: '0xdep', pct: 100, deployer: true, tokenCreator: true, addedFirstLiquidity: true }, holders: [], ...over });
o = shape(scan({ lp: { burnedPct: 0, custody: cust() }, pool: { address: '0xp', kind: 'v2', venue: 'PancakeSwap V2', liquidityUsd: 61064 } }), route(), 250);
const lpp = o.caution.find((c) => c.code === 'lp_pullable')?.why || '';
ok('a creator holding 100% of the LP is named: who, how much, in dollars — and the vaguer line is not added', /token’s creator \(0xdep\) holds 100% .*all of the liquidity.*\$61064/.test(lpp) && !codes(o.caution).includes('lp_withdrawable') && o.lp_custody?.largest_wallet?.deployer === true, codes(o.caution) + ' ' + lpp);
o = shape(scan({ lp: { burnedPct: 0, custody: cust({ walletPct: 0, farmPct: 82, unreadPct: 18, read: 'partial', largestWallet: null }) }, pool: { address: '0xp', kind: 'v2', venue: 'PancakeSwap V2', liquidityUsd: 40000 } }), route(), 250);
ok('… LP read as farms, burned or locked raises neither line, even at 0% burned on a thin pool', !codes(o.caution).includes('lp_pullable') && !codes(o.caution).includes('lp_withdrawable'), codes(o.caution));
o = shape(scan({ lp: { burnedPct: 0, custody: cust({ read: 'partial', unreadPct: 80, walletPct: 20, largestWallet: { address: '0xw', pct: 20 } }) }, pool: { address: '0xp', kind: 'v2', venue: 'PancakeSwap V2', liquidityUsd: 40000 } }), route(), 250);
ok('… a read that attributed under half of the LP falls back to the burned-share line', codes(o.caution).includes('lp_withdrawable') && !codes(o.caution).includes('lp_pullable'), codes(o.caution));
o = shape(scan({ lp: { burnedPct: 0, custody: cust({ largestWallet: { address: '0xw', pct: 6 } }) }, pool: { address: '0xp', kind: 'v2', venue: 'PancakeSwap V2', liquidityUsd: 40000 } }), route(), 250);
ok('… and a wallet under the 10% line is not named', !codes(o.caution).includes('lp_pullable'), codes(o.caution));
o = shape(scan({ lp: { burnedPct: 0, custody: cust({ largestWallet: null, withdrawnSinceCreation: [{ address: '0xrug', pctOfLpEverMinted: 99.88 }] }) } }), route(), 250);
ok('LP already withdrawn (99.88% of all ever minted) is said, with who', /99\.88%.*0xrug/.test(o.caution.find((c) => c.code === 'lp_withdrawn')?.why || ''), codes(o.caution));
o = shape(scan({ lp: { burnedPct: 0, custody: cust({ largestWallet: null, withdrawnSinceCreation: [{ address: '0xlp', pctOfLpEverMinted: 12 }] }) } }), route(), 250);
ok('… an ordinary 12% withdrawal is not', !codes(o.caution).includes('lp_withdrawn'), codes(o.caution));

// WHO IS SELLING (2026-09-27): the scan's flow block, each line both ways.
const flow = (over = {}) => ({ window: { blocks: 7900, minutes: 59 }, deployer: { address: '0xdep', source: 'first mint', contract: false, balancePctOfCirculating: 12, lpPct: 100,
  sold: { sells: 0, quote: 0, usd: 0 } }, sellers: { sells: 3, wallets: 3, unattributed: 0, top: [] }, topHolderSelling: [], topHolderBasis: 'holder list', snipers: null, ...over });
o = shape(scan({ flow: flow({ deployer: { address: '0xdep', source: 'first mint', balancePctOfCirculating: 12, lpPct: 100, sold: { sells: 2, quote: 3, usd: 1800, byDeployer: { sells: 1, usd: 1200 }, viaWalletsItFunded: [{ address: '0xhop', sells: 1, usd: 600 }] } } }) }), route(), 250);
const ds = o.caution.find((c) => c.code === 'dev_selling')?.why || '';
ok('the deployer selling is a caution: itself and the wallet it funded, the dollars, what it still holds and its LP', /0xdep/.test(ds) && /0xhop/.test(ds) && /\$1800/.test(ds) && /12%/.test(ds) && /100% of the LP/.test(ds) && o.flow?.deployer?.sold_usd === 1800, ds);
o = shape(scan({ flow: flow() }), route(), 250);
ok('… a deployer with no sell in the window raises nothing, and the compact flow still says who it is', !codes(o.caution).includes('dev_selling') && o.flow?.deployer?.address === '0xdep' && o.flow.deployer.sells === 0, codes(o.caution));
o = shape(scan({ flow: flow({ deployer: { address: '0xdep', source: 'first mint', balancePctOfCirculating: 0, lpPct: 0, sold: { sells: 1, quote: 0.0000004, usd: 0, byDeployer: { sells: 1, usd: 0 } } } }) }), route(), 250);
ok('… nor a dust sell worth under a dollar into a pool already emptied (BUL)', !codes(o.caution).includes('dev_selling'), codes(o.caution));
o = shape(scan({ flow: flow({ deployer: { address: '0xdep', source: 'first mint', balancePctOfCirculating: null, lpPct: 0, sold: null } }) }), route(), 250);
ok('… and sellers that could not be read are not a deployer sell (sold null stays null)', !codes(o.caution).includes('dev_selling') && o.flow.deployer.sold_usd === null, JSON.stringify(o.flow));
o = shape(scan({ flow: flow({ balanceAboveSupply: ['0xdep'], deployer: { address: '0xdep', source: 'first mint', balancePctOfCirculating: null, lpPct: 0, sold: { sells: 1, usd: 16339, byDeployer: { sells: 1, usd: 16339 } } } }) }), route(), 250);
ok('a deployer whose balance reads above the supply is said so in the sell line (RAYCAT)', /ABOVE the whole supply/.test(o.caution.find((c) => c.code === 'dev_selling')?.why || ''), codes(o.caution));
o = shape(scan({ flow: flow({ topHolderSelling: [{ address: '0xwhale', sells: 2, usd: 900, soldPctOfBalance: 50, heldPctBefore: 8, holdsPctNow: 4 }] }) }), route(), 250);
ok('a top holder selling half of its balance is a caution, with its figures and the line', /0xwhale sold 50%/.test(o.caution.find((c) => c.code === 'top_holder_selling')?.why || '') && o.flow.top_holders_selling === 1, codes(o.caution));
o = shape(scan({ flow: flow() }), route(), 250);
ok('… none selling, none said', !codes(o.caution).includes('top_holder_selling'));
o = shape(scan({ flow: flow({ snipers: { read: true, launchBlock: 5, blocks: 10, wallets: 34, holdPctOfCirculating: 66.54, top: [] } }) }), route(), 250);
ok('launch buyers still holding 66.54% is sniped_launch, with the count and the line', /34 wallets .*66\.54%/.test(o.caution.find((c) => c.code === 'sniped_launch')?.why || '') && o.flow.snipers_hold_pct === 66.54, codes(o.caution));
o = shape(scan({ flow: flow({ snipers: { read: true, launchBlock: 5, blocks: 10, wallets: 3, holdPctOfCirculating: 4.2, top: [] } }) }), route(), 250);
ok('… 4.2% is not, and an unread sniper figure is null, never 0', !codes(o.caution).includes('sniped_launch')
  && shape(scan({ flow: flow({ snipers: { read: false, reason: 'x' } }) }), route(), 250).flow.snipers_hold_pct === null, codes(o.caution));
// Netted against liquidity put back (2026-09-27): BOBAI's own creator run sells, adds it all back, burns the LP.
const backed = (addedBack, netUsd, netQuote) => flow({ deployer: { address: '0xdep', source: 'contract creator (GoPlus)', balancePctOfCirculating: 0, lpPct: null,
  sold: { sells: 3, quote: 0.0503, usd: 30, byDeployer: { sells: 3, usd: 30 }, addedBack, netQuote, netUsd } } });
o = shape(scan({ flow: backed({ adds: 1, quote: 0.0519, usd: 31, lp: 'burned', lpBurnedPct: 100 }, 0, 0) }), route(), 250);
ok('a deployer that sold and put it all back as liquidity (LP burned) raises no dev_selling, and the summary says so', !codes(o.caution).includes('dev_selling') && o.flow.deployer.added_back_usd === 31 && o.flow.deployer.added_back_lp === 'burned' && o.flow.deployer.net_sold_usd === 0, codes(o.caution));
o = shape(scan({ flow: backed({ adds: 1, quote: 0.5, usd: 300, lp: 'kept' }, 1500, 2.5) }), route(), 250);
const dsb = o.caution.find((c) => c.code === 'dev_selling')?.why || '';
ok('… one that put back only part is a caution on the part that left, naming both halves and the LP it kept', /added \$300 back as liquidity \(its LP kept by the wallet/.test(dsb) && /about \$1500 left the pool/.test(dsb), dsb);

o = shape(scan(), route(), 250);
ok('… and a scan without a flow block says flow null, and none of the three', o.flow === null && !/dev_selling|top_holder_selling|sniped_launch/.test(codes(o.caution)));

o = shape(scan(), route(), 250);
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
// 2026-10-09 review: a raise in a quote token this tool cannot price asked no dollar size; that is no refused sell
o = shape({ address: '0xc', symbol: 'C', name: 'C', quotable: false, reason: 'curve', curve: { progressPct: 5, feePct: 1, sellQuoted: false, quotePriced: false, quoteSymbol: null, tradeCost: [] } }, null, 100);
ok('… but a raise in an unpriced quote token is a caution (quote_not_priced), not a stop', !codes(o.stop) && codes(o.caution).includes('quote_not_priced'), JSON.stringify([o.stop, o.caution]));

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
  // Since 2026-10-09 a V3 pool gets the free rug watch (it reads the preflight, not reserves) — still never the
  // pool watch, which reads V2 reserves.
  ok('a V3 pool gets no pointer to a watch that cannot read it', !!v3.keep_watching && !('how' in v3.keep_watching) && !/agent\.brainonbnb\.com\/watch\b/.test(JSON.stringify(v3.keep_watching)), JSON.stringify(v3.keep_watching));
  ok('… both name the free rug watch with this token filled in, and no price', [v2, v3].every((o) => o.keep_watching?.rug_watch?.how?.includes(`/rug-watch {"token":"${o.token.address}"`)) && !/\$\s?\d|USD1|\d+\s?days?/i.test(JSON.stringify(v3.keep_watching)));
  const none = shape(scan({ quotable: false, reason: 'no pool' }), null, 500);
  ok('… and a token with no pool gets none', none.keep_watching == null);
}

// A size that is given but unreadable is refused, not answered at 250 (2026-10-05). sizeArg is lifted out of
// the site worker as text (importing the worker pulls in the whole site), and all three sized tools must use it.
{
  const fs = await import('node:fs');
  const w = fs.readFileSync(path.resolve(import.meta.dirname, '../dashboard/_worker.js'), 'utf8');
  const src = w.match(/function sizeArg\([\s\S]*?\n\}/)?.[0];
  ok('the site worker has one sizeArg, and no tool reads Number(args?.usd) or Number(args?.capitalUsd) itself', !!src && !/Number\(args\?\.(usd|capitalUsd)\)/.test(w));
  const sizeArg = src ? new Function(src + '\nreturn sizeArg;')() : () => { throw new Error('missing'); };
  const refused = (v) => { try { sizeArg({ usd: v }, 'usd', 250); return false; } catch (e) { return /usd must be a positive number, e\.g\. 250/.test(e.message); } };
  ok('usd=1,000, abc, -5, 0 and Infinity are refused in plain words', ['1,000', 'abc', '-5', '0', 0, 'Infinity'].every(refused));
  ok('… absent or empty is the default, and 500 / "500" / " 1e3 " read as numbers', sizeArg({}, 'usd', 250) === undefined && sizeArg({ usd: '' }, 'usd', 250) === undefined
    && sizeArg({ usd: 500 }, 'usd', 250) === 500 && sizeArg({ usd: '500' }, 'usd', 250) === 500 && sizeArg({ usd: ' 1e3 ' }, 'usd', 250) === 1000);
  ok('… and the REST route answers that refusal with 400, not 422', /const bad = \/[^\n]*must be a positive number/.test(w));
}

// ---- 2026-10-09: the answer an agent branches on, the own control read, one shape on every branch ----
{
  // gate, the verdict word, all three ways
  o = shape(scan(), route(), 250);
  ok('gate: nothing stops and nothing to weigh reads "no_known_stop" (never "safe")', o.gate === 'no_known_stop' && !/safe/i.test(String(o.gate)), String(o.gate));
  o = shape(scan({ onePercentDepth: { buyUsd: 171, sellUsd: 400 } }), route(), 250);
  ok('… a caution alone reads "weigh"', o.gate === 'weigh', String(o.gate));
  o = shape(scan({ sellability: { ok: true, sellable: false, buyable: true } }), route(), 250);
  ok('… and a stop reads "stop"', o.gate === 'stop', String(o.gate));
  // the figures beside the sentence, and the sentence unchanged
  o = shape(scan({ onePercentDepth: { buyUsd: 171, sellUsd: 400 } }), route(), 250);
  const sm = o.caution.find((c) => c.code === 'size_moves_price') || {};
  ok('size_moves_price carries value 250, line 171, unit usd — and its sentence is the old one', sm.value === 250 && sm.line === 171 && sm.unit === 'usd'
    && sm.why === '$250 is more than the $171 that moves this pool’s price by 1%: you are the market at this size.', JSON.stringify(sm));
  o = shape(scan({ tax: { buyPct: 12, sellPct: 3, buySource: 'measured', sellSource: 'measured' } }), route({ transfer_tax: { buy_pct: 12, sell_pct: 3, source: 'measured' } }), 250);
  const hb = o.caution.find((c) => c.code === 'high_buy_tax') || {};
  ok('high_buy_tax carries value 12, line 10, unit pct', hb.value === 12 && hb.line === 10 && hb.unit === 'pct', JSON.stringify(hb));
  o = shape(scan(), route({ refuse_to_trade: ['An immediate round trip returns 31.2% of what went in. Whatever the cause, it is not a cost anybody would accept knowingly.'] }), 250);
  const rt = o.stop.find((c) => c.code === 'round_trip') || {};
  ok('a round-trip stop carries what came back (31.2) against the 50% line', rt.value === 31.2 && rt.line === 50 && rt.unit === 'pct', JSON.stringify(rt));
  o = shape(scan({ holders: { wallets: 8, top10PctOfCirculating: 36.3, largestPct: 8.2, largestSellTakesPctOfPool: 31 } }), route(), 250);
  const hcf = o.caution.find((c) => c.code === 'holders_concentrated') || {};
  ok('holders_concentrated carries the figure that crossed its line (31% of the pool, line 25)', hcf.value === 31 && hcf.line === 25 && hcf.unit === 'pct', JSON.stringify(hcf));
  o = shape(scan({ contract: { openSource: false, properties: {} } }), route(), 250);
  const sv = o.caution.find((c) => c.code === 'source_not_verified') || {};
  ok('… and an item with no number in its sentence carries none', sv.why && !('value' in sv) && !('line' in sv), JSON.stringify(sv));

  // kind, block and measured_at on every branch
  const ctlRead = { read: true, block: 4242, has_code: true, owner: null, owner_function: false, proxy: null, mint_selector: false };
  o = shape({ address: '0xc', symbol: 'C', name: 'C', quotable: false, reason: 'curve', curve: { progressPct: 41.5, feePct: 1, sellQuoted: true, tradeCost: [{ sizeUsd: 100, buyCostPct: 1.2, sellCostPct: 1.3 }] } }, null, 100, null, ctlRead);
  ok('the curve answer says kind "curve", a block and measured_at', o.kind === 'curve' && o.block === 4242 && typeof o.measured_at === 'string' && o.gate === 'weigh', JSON.stringify({ k: o.kind, b: o.block, m: o.measured_at, g: o.gate }));
  o = shape({ address: '0xd', symbol: 'D', name: 'D', quotable: false, reason: 'No pool.' }, null, 100, null, ctlRead);
  ok('… the unquotable one "unquotable", with them too', o.kind === 'unquotable' && o.block === 4242 && typeof o.measured_at === 'string' && o.gate === 'stop', JSON.stringify({ k: o.kind, b: o.block, m: o.measured_at }));
  o = shape(scan(), route(), 250);
  ok('… and a pool answer "pool", with the scan’s block', o.kind === 'pool' && o.block === 1 && o.measured_at === 'now');
  // one LP-burned number under both names
  o = shape(scan({ lp: { burnedPct: 99.9972, custody: cust({ burnedPct: 99.99, largestWallet: null, walletPct: 0 }) } }), route(), 250);
  ok('lp_burned_pct and lp_custody.burned_pct are the same number (the direct read)', o.lp_burned_pct === 99.9972 && o.lp_custody?.burned_pct === 99.9972, JSON.stringify([o.lp_burned_pct, o.lp_custody?.burned_pct]));

  // the own control read
  const ctl = (over = {}) => ({ read: true, block: 9, has_code: true, owner: { address: '0x' + 'e'.repeat(40), kind: 'eoa', source: 'owner()' }, owner_function: true, proxy: null, mint_selector: false, ...over });
  o = shape(scan({ tax: { buyPct: 3, sellPct: 3, buySource: 'measured', sellSource: 'measured' } }), route({ transfer_tax: { buy_pct: 3, sell_pct: 3, source: 'measured' } }), 250, null, ctl());
  ok('an EOA owner of a taxed token is a caution, naming the owner and the tax', /0xeeee.*plain wallet.*3% buy, 3% sell/.test(o.caution.find((c) => c.code === 'owner_is_eoa')?.why || '') && o.control?.owner?.kind === 'eoa', codes(o.caution));
  o = shape(scan(), route(), 250, null, ctl({ mint_selector: true }));
  ok('… of a token with a mint function, too', codes(o.caution).includes('owner_is_eoa') && o.control?.mint_selector === true, codes(o.caution));
  o = shape(scan(), route(), 250, null, ctl({ proxy: { implementation: '0x' + '1'.repeat(40), admin: null, admin_kind: null, standard: 'EIP-1967' } }));
  ok('… and of an upgradeable proxy', /EIP-1967 proxy/.test(o.caution.find((c) => c.code === 'owner_is_eoa')?.why || '') && o.control?.proxy?.implementation === '0x' + '1'.repeat(40), codes(o.caution));
  o = shape(scan(), route(), 250, null, ctl());
  ok('… but an EOA owner with no tax, no mint and no proxy is not a line', !codes(o.caution).includes('owner_is_eoa') && o.gate === 'no_known_stop', codes(o.caution));
  o = shape(scan({ tax: { buyPct: 3, sellPct: 3 } }), route({ transfer_tax: { buy_pct: 3, sell_pct: 3, source: 'measured' } }), 250, null, ctl({ owner: { address: '0x' + '0'.repeat(40), kind: 'renounced', source: 'owner()' } }));
  ok('… nor a renounced owner, tax or not', !codes(o.caution).includes('owner_is_eoa') && o.control?.owner?.kind === 'renounced', codes(o.caution));
  o = shape(scan(), route(), 250, null, { read: false, reason: 'the node did not answer the control reads' });
  ok('a control read that failed is said, not dropped', o.control?.read === false && /did not answer/.test(o.control.reason), JSON.stringify(o.control));
}

// FAKE VOLUME (2026-10-09): today's rugs are pumped by a handful of wallets trading back and forth. The scan's
// hour of swaps becomes a caution when many swaps came from very few addresses — said as "looks like", never a fact.
{
  const act = (over = {}) => ({ window: { blocks: 7900, minutes: 59 }, swaps: 41, buys: 30, sells: 11, uniqueBuyers: 2, uniqueSellers: 2, uniqueTraders: 3, volumeUsd: 12000, largestSellUsd: 900, ...over });
  const thin = { address: '0x' + 'b'.repeat(40), kind: 'v2', venue: 'PancakeSwap V2', liquidityUsd: 8000, shareOfLiquidity: 1, partialMarket: false };
  o = shape(scan({ activity: act(), pool: thin }), route(), 250);
  const vf = o.caution.find((c) => c.code === 'volume_from_few_wallets') || {};
  ok('41 swaps from 3 wallets in 59 minutes is volume_from_few_wallets, with the figures, "looks like" and {value 3, line 4, unit wallets}',
    /41 swaps came from 3 wallets/.test(vf.why || '') && /\$12000 of volume/.test(vf.why) && /\$8000 on its hard side/.test(vf.why) && /looks like wash trading/.test(vf.why) && /a handful of wallets made most of the volume/.test(vf.why) && /aggregator/.test(vf.why)
    && vf.value === 3 && vf.line === 4 && vf.unit === 'wallets' && o.gate === 'weigh', JSON.stringify(vf));
  o = shape(scan({ activity: act({ swaps: 60, uniqueTraders: 8, volumeUsd: 20000 }), pool: thin }), route(), 250);
  const vf2 = o.caution.find((c) => c.code === 'volume_from_few_wallets') || {};
  ok('… 60 swaps by 8 wallets, $20000 on an $8000 pool: the volume-over-the-pool line (10 wallets)', vf2.value === 8 && vf2.line === 10 && /2x the pool/.test(vf2.why || ''), JSON.stringify(vf2));
  o = shape(scan({ activity: act({ swaps: 300, buys: 160, sells: 140, uniqueTraders: 120, volumeUsd: 50000 }), pool: { ...thin, liquidityUsd: 20000 } }), route(), 250);
  ok('… a busy market of 120 wallets is not, even at $50000 on a $20000 pool', !codes(o.caution).includes('volume_from_few_wallets') && o.activity?.unique_traders === 120 && vf.code === 'volume_from_few_wallets', codes(o.caution));
  o = shape(scan({ activity: act({ swaps: 19, uniqueTraders: 1 }), pool: thin }), route(), 250);
  const under = !codes(o.caution).includes('volume_from_few_wallets');
  o = shape(scan({ activity: act({ swaps: 41, uniqueTraders: 5 }), pool: thin }), route(), 250);
  const five = !codes(o.caution).includes('volume_from_few_wallets');
  o = shape(scan({ activity: act({ uniqueTraders: null }), pool: thin }), route(), 250);
  ok('… nor 19 swaps (under 20), 41 swaps by 5 wallets (line 4), or wallets that could not be read — and the line is checked at all (the 3-wallet case above is)', under && five && !codes(o.caution).includes('volume_from_few_wallets') && vf.code === 'volume_from_few_wallets', String([under, five]));
  // what top holders sold, in dollars, for the rug watch's insider sum
  o = shape(scan({ flow: { window: { minutes: 59 }, deployer: null, sellers: { wallets: 4 }, topHolderSelling: [{ address: '0xw', soldPctOfBalance: 50, heldPctBefore: 4, holdsPctNow: 2, usd: 700 }, { address: '0xv', soldPctOfBalance: 30, heldPctBefore: 3, holdsPctNow: 2, usd: 300 }] } }), route(), 250);
  ok('the compact flow carries what top holders sold in dollars (top_holders_sold_usd)', o.flow?.top_holders_sold_usd === 1000 && shape(scan({ flow: { window: { minutes: 59 }, deployer: null, topHolderSelling: [] } }), route(), 250).flow?.top_holders_sold_usd === 0, JSON.stringify(o.flow));
}

// The refusal an agent can branch on (2026-10-09): errorAnswer lifted out of the site worker as text, like sizeArg.
{
  const fs = await import('node:fs');
  const w = fs.readFileSync(path.resolve(import.meta.dirname, '../dashboard/_worker.js'), 'utf8');
  const src = w.match(/function errorAnswer\([\s\S]*?\n\}/)?.[0];
  const errorAnswer = src ? new Function(src + '\nreturn errorAnswer;')() : () => ({ status: 0, body: {} });
  const E = (msg, code) => Object.assign(new Error(msg), code ? { code } : {});
  let a = errorAnswer(E('That address is a wallet, not a token. There is no contract code at it on BNB Smart Chain.', 'is_wallet'));
  ok('a wallet answers 422 with code is_wallet and a hint', a.status === 422 && a.body.code === 'is_wallet' && /wallet/.test(a.body.hint || '') && /a wallet, not a token/.test(a.body.error), JSON.stringify(a));
  a = errorAnswer(E('That address is not a BSC token. It answers nothing to symbol()…', 'not_a_token'));
  ok('… a contract that is no token: not_a_token', a.status === 422 && a.body.code === 'not_a_token' && !!a.body.hint, JSON.stringify(a));
  a = errorAnswer(E('Give a BSC token or pool address (0x followed by 40 hex characters), or a link containing one.'));
  ok('… a malformed address: 400 bad_address', a.status === 400 && a.body.code === 'bad_address' && !!a.body.hint, JSON.stringify(a));
  a = errorAnswer(E('usd must be a positive number, e.g. 250 (got "abc").'));
  ok('… a size that is no number: 400 bad_usd', a.status === 400 && a.body.code === 'bad_usd' && !!a.body.hint, JSON.stringify(a));
  a = errorAnswer(E('The chain did not answer. The public BSC node refused or timed out.'));
  ok('… the chain silent: 503 chain_unavailable', a.status === 503 && a.body.code === 'chain_unavailable', JSON.stringify(a));
  a = errorAnswer(E('That pool cannot be priced. It trades against a token with no BNB pool of its own.'));
  ok('… and any other determinate answer: 422 with a code too', a.status === 422 && a.body.code === 'not_measurable' && !!a.body.hint, JSON.stringify(a));
  const rest = w.match(/const \{ status, body \} = errorAnswer\(e\);\s*return new Response\(JSON\.stringify\(body\), \{ status, headers \}\)/);
  ok('the REST route answers with errorAnswer’s status and body', !!rest);
  const mcpErr = /const \{ body: eb \} = errorAnswer\(e\);[\s\S]{0,300}code: \$\{eb\.code\}[\s\S]{0,120}structuredContent: eb, isError: true/.test(w);
  ok('MCP carries the same code: in the text and as structuredContent, with isError', mcpErr);
  // structuredContent for the three trading reads (MCP 2025-06-18)
  const st = w.match(/const STRUCTURED_TOOLS = new Set\(\[([^\]]*)\]\)/)?.[1] || '';
  ok('tools/call answers bsc_token_preflight, bsc_pool_scan and pancakeswap_best_route with structuredContent', ['bsc_token_preflight', 'bsc_pool_scan', 'pancakeswap_best_route'].every((n) => st.includes(`'${n}'`))
    && /STRUCTURED_TOOLS\.has\([^)]*\)[^\n]*\{ structuredContent: out \}/.test(w) && /protocolVersion: '2025-06-18'/.test(w));
  const stdio = fs.readFileSync(path.resolve(import.meta.dirname, '../mcp/server.mjs'), 'utf8');
  ok('… and the stdio server the same, carrying the REST refusal’s code and hint', /STRUCTURED\.has\(params\?\.name\)[^\n]*structuredContent: out/.test(stdio) && /e\.code = String\(body\.code\)/.test(stdio) && /structuredContent: \{ error: msg, code: e\.code/.test(stdio));
  // fee tiers: sixty seconds in the edge cache, and no tool description says "nothing cached" any more
  const ft = w.match(/case 'pancakeswap_fee_tiers': \{[\s\S]*?\n    \}/)?.[0] || '';
  ok('pancakeswap_fee_tiers is cached 60 s per token in caches.default, and says which copy it is', /caches\.default/.test(ft) && /max-age=60/.test(ft) && /fee-tiers\/\$\{m\[0\]\.toLowerCase\(\)\}/.test(ft) && /cache: \{ hit: true/.test(ft));
  const pfDesc = w.match(/name: 'bsc_token_preflight', description: '((?:[^'\\]|\\.)*)'/)?.[1] || '';
  ok('the preflight description no longer says "nothing cached" and names the 6 h GoPlus cache', !!pfDesc && !/nothing cached/i.test(pfDesc) && /6 h/.test(pfDesc), pfDesc.slice(-160));
  // the route answer names its block too
  const sr = fs.readFileSync(path.resolve(import.meta.dirname, '../dashboard/swap-route.js'), 'utf8');
  ok('the best-route answer carries block and measured_at', /\n    block: tag !== 'latest' \? parseInt\(tag, 16\) : \(tax\.block \?\? null\), measured_at: new Date\(\)\.toISOString\(\),/.test(sr));
}

console.log(fails ? `\n${fails} FAILED` : '\npreflight: all pins hold');
process.exit(fails ? 1 : 0);
