// THE SLOW VARIANT — measured before anything is built.
//
// The live agent (trader-live.mjs) is an hourly trader: it buys unusual moves
// and is out again within 72 h. With gas at a fixed $0.35 a swap its edge on
// a $110 pot was thin to negative (docs/trading-agent.md, 2026-09-09), while
// simply holding the same three assets earned +29 on 100 over the unseen 40%.
// The operator's brief on 2026-09-09: not fast money, slow money — long term,
// as much as possible. That is a different machine: daily closes, a target
// allocation, periodic rebalancing (sell what rose, buy what fell), capital
// always invested, few trades so gas stops mattering.
//
// This script replays that machine on the same six months of recorded hours
// the live agent was judged on, with the same cost model and the same gas,
// and puts it next to holding and next to sitting in USDT. It places no order
// and touches no file the live agent reads.
//
//   node scripts/trader-slow.mjs --self-test     pin the arithmetic, no network
//   node scripts/trader-slow.mjs                 the measurement, all capital sizes
//   node scripts/trader-slow.mjs --capital 135   one pot size
//
// Method. Daily closes are the recorded hour at 00:00 UTC. Every strategy
// starts in USDT on day 0. A rebalance is a set of swaps against USDT, each
// charged the per-side percentage in DEFAULT_COSTS_PCT plus DEFAULT_GAS_USD_PER_SWAP;
// nothing under the wallet's $10 minimum is traded. Allocation and cadence are
// chosen on the first 60% of days and judged on the last 40% — the same
// discipline as the live agent's walk-forward — and every strategy is also
// shown on the whole period and with costs and gas × 1.5. Yield on the parked
// assets (staking, lending) is NOT assumed: it would add roughly linearly and
// nobody has measured it yet; the numbers here are price and cost only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_COSTS_PCT, DEFAULT_GAS_USD_PER_SWAP } from '../shared/trader-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRICES = path.join(ROOT, 'data', 'trader', 'prices.json');
const ASSETS = ['BNB', 'CAKE', 'BOB'];
const MIN_ORDER_USD = 10;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- arithmetic

// Daily closes: the hour stamped exactly 00:00 UTC, on every series at once.
export function dailyCloses(series, assets = ASSETS) {
  const byTs = new Map();
  for (const a of assets) for (const [ts, px] of series[a].usd) if (ts % DAY_MS === 0) {
    if (!byTs.has(ts)) byTs.set(ts, {});
    byTs.get(ts)[a] = px;
  }
  const times = [...byTs.keys()].filter((ts) => assets.every((a) => byTs.get(ts)[a] > 0)).sort((x, y) => x - y);
  return { times, closes: times.map((ts) => byTs.get(ts)) };
}

// One swap against USDT: notional in dollars, sign by direction, returns what
// the other side receives after the percentage cost and the gas (gas is paid
// in BNB by the wallet; charging it in dollars here is the same money).
function swapCost(asset, usd, side, costsPct, gasUsd) {
  const pct = (costsPct[asset]?.[side] ?? 0.5) / 100;
  return usd * pct + gasUsd;
}

/**
 * Replay a target allocation with periodic rebalancing.
 * weights: { BNB, CAKE, BOB, USDT } summing to 1. everyDays: cadence; band: a
 * relative drift a sleeve must exceed before it is traded (0 = always trade
 * to target on the cadence). Trades under MIN_ORDER_USD are skipped.
 * Returns the equity curve (marked to market, USD) and what it cost.
 */
export function replayAllocation(closes, times, weights, { capitalUsd = 100, everyDays = 7, band = 0, costsPct = DEFAULT_COSTS_PCT, gasUsd = DEFAULT_GAS_USD_PER_SWAP, from = 0, to = closes.length } = {}) {
  const units = Object.fromEntries(ASSETS.map((a) => [a, 0]));
  let usdt = capitalUsd;
  let trades = 0, gasPaid = 0, feesPaid = 0, lastRebal = null;
  const equity = [];
  const value = (i) => usdt + ASSETS.reduce((s, a) => s + units[a] * closes[i][a], 0);
  for (let i = from; i < to; i++) {
    const day = (times[i] - times[from]) / DAY_MS;
    const due = lastRebal === null || day - lastRebal >= everyDays;
    if (due) {
      const total = value(i);
      // sells first, so the USDT is there for the buys
      const orders = [];
      for (const a of ASSETS) {
        const target = total * (weights[a] || 0);
        const have = units[a] * closes[i][a];
        const drift = target > 0 ? Math.abs(have - target) / target : (have > 0 ? Infinity : 0);
        if (drift <= band) continue;
        const diff = target - have;
        if (Math.abs(diff) < MIN_ORDER_USD) continue;
        orders.push({ a, diff });
      }
      orders.sort((x, y) => x.diff - y.diff); // negatives (sells) first
      for (const { a, diff } of orders) {
        if (diff < 0) {
          const usd = -diff;
          const cost = swapCost(a, usd, 'sell', costsPct, gasUsd);
          units[a] -= usd / closes[i][a];
          usdt += usd - cost;
          feesPaid += cost - gasUsd; gasPaid += gasUsd; trades++;
        } else {
          const usd = Math.min(diff, usdt);
          if (usd < MIN_ORDER_USD) continue;
          const cost = swapCost(a, usd, 'buy', costsPct, gasUsd);
          usdt -= usd;
          units[a] += (usd - cost) / closes[i][a];
          feesPaid += cost - gasUsd; gasPaid += gasUsd; trades++;
        }
      }
      lastRebal = day;
    }
    equity.push(value(i));
  }
  const final = equity[equity.length - 1];
  let peak = -Infinity, maxDd = 0;
  for (const v of equity) { peak = Math.max(peak, v); maxDd = Math.max(maxDd, (peak - v) / peak); }
  return { final, pnl: final - capitalUsd, pnlPct: (final / capitalUsd - 1) * 100, maxDdPct: maxDd * 100, trades, gasPaid, feesPaid, days: to - from, equity };
}

// The candidate allocations. Deliberately few and deliberately plain: thirds,
// thirds with a cash sleeve, BNB-heavy, and each asset alone. Anything finer
// would be fitting six months of noise.
export const ALLOCATIONS = {
  'thirds': { BNB: 1 / 3, CAKE: 1 / 3, BOB: 1 / 3, USDT: 0 },
  'thirds+cash': { BNB: 0.25, CAKE: 0.25, BOB: 0.25, USDT: 0.25 },
  'bnb-heavy': { BNB: 0.5, CAKE: 0.25, BOB: 0.25, USDT: 0 },
  'bnb-heavy+cash': { BNB: 0.4, CAKE: 0.2, BOB: 0.2, USDT: 0.2 },
  'bnb only': { BNB: 1, CAKE: 0, BOB: 0, USDT: 0 },
  'cake only': { BNB: 0, CAKE: 1, BOB: 0, USDT: 0 },
  'bob only': { BNB: 0, CAKE: 0, BOB: 1, USDT: 0 },
};
export const CADENCES = [
  { label: 'buy once, hold', everyDays: 1e9, band: 0 },
  { label: 'weekly, always', everyDays: 7, band: 0 },
  { label: 'weekly, 20% band', everyDays: 7, band: 0.2 },
  { label: 'monthly, always', everyDays: 30, band: 0 },
  { label: 'monthly, 20% band', everyDays: 30, band: 0.2 },
];

// Walk-forward: choose (allocation, cadence) on the first trainShare of days
// by net P&L, then report the choice on the rest. What the choice earns on
// the unseen part is the number that counts.
export function walkForwardSlow(closes, times, { capitalUsd, trainShare = 0.6, costsPct, gasUsd, only = null }) {
  const split = Math.floor(closes.length * trainShare);
  let best = null;
  for (const [alloc, weights] of Object.entries(ALLOCATIONS)) {
    if (only && !only(alloc)) continue;
    for (const c of CADENCES) {
      const r = replayAllocation(closes, times, weights, { capitalUsd, everyDays: c.everyDays, band: c.band, costsPct, gasUsd, from: 0, to: split });
      if (!best || r.pnl > best.train.pnl) best = { alloc, cadence: c.label, weights, c, train: r };
    }
  }
  const unseen = replayAllocation(closes, times, best.weights, { capitalUsd, everyDays: best.c.everyDays, band: best.c.band, costsPct, gasUsd, from: split, to: closes.length });
  return { ...best, unseen, splitDay: split, unseenDays: closes.length - split };
}

// ------------------------------------------------------------------ self-test

function selfTest() {
  const fails = [];
  const ok = (cond, what) => { if (!cond) fails.push(what); };
  // A market that oscillates: two assets, one up when the other is down,
  // back where they started every two days. Holding ends flat; rebalancing
  // harvests the swing — the whole reason the slow machine can beat holding.
  const N = 61;
  const times = Array.from({ length: N }, (_, i) => i * DAY_MS);
  const closes = times.map((_, i) => ({ BNB: i % 2 ? 150 : 100, CAKE: i % 2 ? 100 : 150, BOB: 1 }));
  const noCost = { BNB: { buy: 0, sell: 0 }, CAKE: { buy: 0, sell: 0 }, BOB: { buy: 0, sell: 0 } };
  const w = { BNB: 0.5, CAKE: 0.5, BOB: 0, USDT: 0 };
  const hold = replayAllocation(closes, times, w, { capitalUsd: 1000, everyDays: 1e9, costsPct: noCost, gasUsd: 0 });
  const rebal = replayAllocation(closes, times, w, { capitalUsd: 1000, everyDays: 1, costsPct: noCost, gasUsd: 0 });
  ok(Math.abs(hold.pnl) < 1e-6, `hold on an oscillation ends flat, got ${hold.pnl.toFixed(4)}`);
  ok(rebal.pnl > 1000, `daily rebalancing harvests the swing, got ${rebal.pnl.toFixed(2)}`);
  ok(rebal.trades === N * 2, `the entry and then one swap per asset per day, got ${rebal.trades}`);
  // Flat prices: nothing to earn, so the only movement is cost, and it is
  // exactly the buys (holding never sells).
  const flat = times.map(() => ({ BNB: 100, CAKE: 100, BOB: 100 }));
  const f = replayAllocation(flat, times, { BNB: 1 / 3, CAKE: 1 / 3, BOB: 1 / 3, USDT: 0 }, { capitalUsd: 300, everyDays: 1e9, costsPct: DEFAULT_COSTS_PCT, gasUsd: DEFAULT_GAS_USD_PER_SWAP });
  const expect = -(100 * 0.003 + 100 * 0.0035 + 100 * 0.0055 + 3 * DEFAULT_GAS_USD_PER_SWAP);
  ok(Math.abs(f.pnl - expect) < 1e-6, `flat prices cost exactly the entry, expected ${expect.toFixed(4)} got ${f.pnl.toFixed(4)}`);
  ok(f.trades === 3 && Math.abs(f.gasPaid - 3 * DEFAULT_GAS_USD_PER_SWAP) < 1e-9, 'three buys, three gas charges');
  // Flat prices, weekly, always: the band is 0 but the drift is 0 too, so no
  // trade fires after the entry — rebalancing must not churn a still market.
  const f2 = replayAllocation(flat, times, { BNB: 1 / 3, CAKE: 1 / 3, BOB: 1 / 3, USDT: 0 }, { capitalUsd: 300, everyDays: 7, costsPct: DEFAULT_COSTS_PCT, gasUsd: DEFAULT_GAS_USD_PER_SWAP });
  ok(f2.trades === 3, `a still market is not churned, got ${f2.trades} trades`);
  // Under the minimum order nothing trades at all.
  const tiny = replayAllocation(flat, times, { BNB: 1, CAKE: 0, BOB: 0, USDT: 0 }, { capitalUsd: 9, everyDays: 1e9 });
  ok(tiny.trades === 0 && tiny.pnl === 0, 'a $9 pot places no order');
  // Sells before buys: a 2-asset rebalance from all-BNB to all-CAKE with $100
  // in USDT must be able to fund the CAKE buy from the BNB sale.
  const c2 = [{ BNB: 100, CAKE: 100, BOB: 1 }, { BNB: 100, CAKE: 100, BOB: 1 }];
  const t2 = [0, DAY_MS];
  const shift = replayAllocation(c2, t2, { BNB: 0, CAKE: 1, BOB: 0, USDT: 0 }, { capitalUsd: 100, everyDays: 1, costsPct: noCost, gasUsd: 0 });
  ok(Math.abs(shift.final - 100) < 1e-9 && shift.trades === 1, 'a first-day allocation is one buy');
  // Daily closes pick exactly the midnight hours and only days every series has.
  const series = { BNB: { usd: [[0, 1], [3_600_000, 1], [DAY_MS, 2], [2 * DAY_MS, 3]] }, CAKE: { usd: [[0, 1], [DAY_MS, 2]] }, BOB: { usd: [[0, 1], [DAY_MS, 2], [2 * DAY_MS, 3]] } };
  const d = dailyCloses(series);
  ok(d.times.length === 2 && d.closes[1].BNB === 2, `daily closes: 2 shared midnights, got ${d.times.length}`);
  // The walk-forward judges on days it did not choose on.
  // A two-week swing (7 days at 100, 7 at 200) that the weekly cadence can catch;
  // mixed allocations only, as the report does, so a lucky single asset cannot win.
  const osc = times.map((_, i) => ({ BNB: i % 14 < 7 ? 100 : 200, CAKE: i % 14 < 7 ? 200 : 100, BOB: 1 + (i % 3) * 0.01 }));
  const wf = walkForwardSlow(osc, times, { capitalUsd: 1000, costsPct: noCost, gasUsd: 0, only: (a) => !a.endsWith('only') });
  ok(wf.unseen.days === N - Math.floor(N * 0.6), 'unseen part is the last 40% of days');
  ok(wf.unseen.pnl > 0, `the oscillation is harvested on the unseen days too, got ${wf.unseen.pnl.toFixed(2)}`);
  if (fails.length) { console.error('SELF-TEST FAILED'); for (const f of fails) console.error('  ' + f); process.exit(1); }
  console.log('self-test ok: 12 pins');
}

// ---------------------------------------------------------------- the report

const fmt = (n, d = 2) => (n >= 0 ? '+' : '') + n.toFixed(d);
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

function scale(costsPct, k) {
  const out = {};
  for (const [a, c] of Object.entries(costsPct)) out[a] = { buy: c.buy * k, sell: c.sell * k };
  return out;
}

function report(capitals) {
  const raw = JSON.parse(fs.readFileSync(PRICES, 'utf8'));
  const { times, closes } = dailyCloses(raw.series);
  const first = new Date(times[0]).toISOString().slice(0, 10), last = new Date(times[times.length - 1]).toISOString().slice(0, 10);
  console.log(`\nThe slow variant on ${closes.length} daily closes, ${first} – ${last} (from ${path.relative(ROOT, PRICES)}, fetched ${raw.fetched_at.slice(0, 16)}Z)`);
  console.log(`costs per side ${ASSETS.map((a) => `${a} ${DEFAULT_COSTS_PCT[a].buy}%`).join(', ')}; gas $${DEFAULT_GAS_USD_PER_SWAP} a swap; nothing under $${MIN_ORDER_USD}; no yield assumed.`);
  const split = Math.floor(closes.length * 0.6);
  console.log(`walk-forward: chosen on the first ${split} days, judged on the last ${closes.length - split} (from ${new Date(times[split]).toISOString().slice(0, 10)}).`);

  for (const capitalUsd of capitals) {
    console.log(`\n=== pot $${capitalUsd} ===`);
    // 1) every allocation × cadence on the whole period and on the unseen part
    console.log(`\n${pad('allocation', 16)} ${pad('cadence', 19)} ${rpad('6 months $', 11)} ${rpad('%', 7)} ${rpad('maxDD%', 7)} ${rpad('trades', 6)} ${rpad('gas $', 7)} | ${rpad('unseen 40% $', 13)} ${rpad('%', 7)} ${rpad('trades', 6)}`);
    for (const [alloc, weights] of Object.entries(ALLOCATIONS)) {
      for (const c of CADENCES) {
        if (alloc.endsWith('only') && c.label !== 'buy once, hold') continue;
        const full = replayAllocation(closes, times, weights, { capitalUsd, everyDays: c.everyDays, band: c.band });
        const un = replayAllocation(closes, times, weights, { capitalUsd, everyDays: c.everyDays, band: c.band, from: split });
        console.log(`${pad(alloc, 16)} ${pad(c.label, 19)} ${rpad(fmt(full.pnl), 11)} ${rpad(fmt(full.pnlPct, 1), 7)} ${rpad(full.maxDdPct.toFixed(1), 7)} ${rpad(full.trades, 6)} ${rpad(full.gasPaid.toFixed(2), 7)} | ${rpad(fmt(un.pnl), 13)} ${rpad(fmt(un.pnlPct, 1), 7)} ${rpad(un.trades, 6)}`);
      }
    }
    console.log(`${pad('usdt only', 16)} ${pad('sit', 19)} ${rpad('+0.00', 11)} ${rpad('+0.0', 7)} ${rpad('0.0', 7)} ${rpad(0, 6)} ${rpad('0.00', 7)} | ${rpad('+0.00', 13)} ${rpad('+0.0', 7)} ${rpad(0, 6)}`);

    // 2) the honest number: chosen blind, judged blind, and again with costs × 1.5
    const mixedOnly = (a) => !a.endsWith('only');
    const wf = walkForwardSlow(closes, times, { capitalUsd, only: mixedOnly });
    const wf15 = walkForwardSlow(closes, times, { capitalUsd, costsPct: scale(DEFAULT_COSTS_PCT, 1.5), gasUsd: DEFAULT_GAS_USD_PER_SWAP * 1.5, only: mixedOnly });
    const holdUnseen = replayAllocation(closes, times, ALLOCATIONS['thirds'], { capitalUsd, everyDays: 1e9, from: split });
    console.log(`\nchosen on the first 60% (mixed allocations only): ${wf.alloc}, ${wf.cadence} (train ${fmt(wf.train.pnl)})`);
    console.log(`  on the unseen 40%: ${fmt(wf.unseen.pnl)} (${fmt(wf.unseen.pnlPct, 1)}%), ${wf.unseen.trades} trades, gas $${wf.unseen.gasPaid.toFixed(2)}, max drawdown ${wf.unseen.maxDdPct.toFixed(1)}%`);
    console.log(`  thirds, buy once and hold, same unseen days: ${fmt(holdUnseen.pnl)} (${fmt(holdUnseen.pnlPct, 1)}%)`);
    console.log(`  with costs and gas × 1.5, chosen again: ${wf15.alloc}, ${wf15.cadence} → unseen ${fmt(wf15.unseen.pnl)} (${fmt(wf15.unseen.pnlPct, 1)}%)`);
    // 3) split-point robustness of the chosen pair
    const splits = [0.5, 0.6, 0.7, 0.8].map((s) => {
      const r = walkForwardSlow(closes, times, { capitalUsd, trainShare: s, only: mixedOnly });
      return `${Math.round(s * 100)}%: ${r.alloc}/${r.cadence.split(',')[0]} ${fmt(r.unseen.pnl)}`;
    });
    console.log(`  at other split points: ${splits.join(' · ')}`);
  }
  console.log('\nRead this as price and cost only. Yield on parked BNB/CAKE/USDT (staking, lending) is not in these numbers and nobody has measured it for this wallet yet.');
  console.log('For comparison, the hourly agent on the same unseen 40% (docs/trading-agent.md): rotation on $75 +67.98 at the 60% split, +4.89 / +6.79 / +18.08 at the others, negative everywhere with costs × 1.5.');
}

// -------------------------------------------------------------------- main
const argv = process.argv.slice(2);
if (argv.includes('--self-test')) selfTest();
else {
  const i = argv.indexOf('--capital');
  const capitals = i >= 0 ? [Number(argv[i + 1])] : [110, 135, 500, 1000];
  report(capitals);
}
