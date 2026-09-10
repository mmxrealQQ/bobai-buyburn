// THE CASH SLEEVE — measured before anything is built.
//
// The slow machine (trader-live.mjs since 2026-09-09) holds thirds BNB/CAKE/BOB
// and has no USDT: on 2026-09-09 the operator saw that a dip finds the agent
// with nothing to buy it. The question is not "would cash be nice" but
// whether a sleeve of USDT that buys dips earns more than the same dollars
// sitting in the thirds. This script answers it on the same 180 daily closes
// the slow machine was judged on, with the same cost model and gas, and it
// places no order and touches no file the live agent reads.
//
//   node scripts/trader-sleeve.mjs --self-test     pin the arithmetic, no network
//   node scripts/trader-sleeve.mjs                 the measurement, pot sizes 167 / 500 / 1000
//   node scripts/trader-sleeve.mjs --capital 167   one pot size
//
// The machine. Target weights 25/25/25 BNB/CAKE/BOB and 25 USDT, the monthly
// pass with the 20% band exactly as the live agent runs it (planRebalance in
// shared/trader-core.js). On every daily close, per leg: if the close is X%
// under the leg's trailing 7-day mean and the leg has no open lot, buy a lot
// from the sleeve (a third of the sleeve's target, clamped to the cash there);
// when a later close is at or above the trailing mean, the lot goes back to
// USDT. On the monthly pass every open lot folds into its leg and the plan
// refills the sleeve. X is chosen blind on the first 60% of days and judged
// on the last 40%, then the choice is repeated at the 50/70/80% splits and
// with costs and gas × 1.5. The live machine (thirds, monthly, 20% band) and
// the sleeve without the dip rule (cash drag alone) are replayed on the same
// days for comparison. The rule for building it, set with the operator on
// 2026-09-09: live only if the sleeve is ahead of the thirds at every split.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_COSTS_PCT, DEFAULT_GAS_USD_PER_SWAP, planRebalance, REBALANCE_EVERY_DAYS, REBALANCE_BAND } from '../shared/trader-core.js';
import { dailyCloses, replayAllocation, ALLOCATIONS } from './trader-slow.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRICES = path.join(ROOT, 'data', 'trader', 'prices.json');
const ASSETS = ['BNB', 'CAKE', 'BOB'];
const MIN_ORDER_USD = 10;
const DAY_MS = 86_400_000;
export const MEAN_DAYS = 7;
export const DIP_GRID = [3, 4, 5, 6, 8, 10];
export const SLEEVE = { BNB: 0.25, CAKE: 0.25, BOB: 0.25, USDT: 0.25 };

// ---------------------------------------------------------------- arithmetic

function swapCost(asset, usd, side, costsPct, gasUsd) {
  const pct = (costsPct[asset]?.[side] ?? 0.5) / 100;
  return usd * pct + gasUsd;
}

// The trailing mean of the n closes before day i (today is not in it).
export function trailingMean(closes, i, asset, n = MEAN_DAYS) {
  if (i < n) return null;
  let s = 0;
  for (let k = i - n; k < i; k++) s += closes[k][asset];
  return s / n;
}

/**
 * Replay the sleeve machine. dipPct: X, the discount to the trailing mean that
 * triggers a lot. Everything else is the live agent's monthly pass. Returns
 * the equity curve and what the lots did on their own.
 */
export function replaySleeve(closes, times, { dipPct, capitalUsd = 100, weights = SLEEVE, everyDays = REBALANCE_EVERY_DAYS, band = REBALANCE_BAND, costsPct = DEFAULT_COSTS_PCT, gasUsd = DEFAULT_GAS_USD_PER_SWAP, from = 0, to = closes.length, meanDays = MEAN_DAYS } = {}) {
  const base = Object.fromEntries(ASSETS.map((a) => [a, 0]));
  const lot = Object.fromEntries(ASSETS.map((a) => [a, 0]));
  const lotCost = Object.fromEntries(ASSETS.map((a) => [a, 0]));
  let usdt = capitalUsd, minUsdt = capitalUsd;
  let trades = 0, gasPaid = 0, feesPaid = 0, lastRebal = null;
  let lotBuys = 0, lotSells = 0, lotPnl = 0, lotsFolded = 0, lotDays = 0;
  const equity = [];
  const value = (i) => usdt + ASSETS.reduce((s, a) => s + (base[a] + lot[a]) * closes[i][a], 0);
  for (let i = from; i < to; i++) {
    const day = (times[i] - times[from]) / DAY_MS;
    // 1) the monthly pass: open lots fold into their legs, the plan is the live plan
    if (lastRebal === null || day - lastRebal >= everyDays) {
      for (const a of ASSETS) if (lot[a] > 0) { base[a] += lot[a]; lot[a] = 0; lotCost[a] = 0; lotsFolded++; }
      const holdings = Object.fromEntries(ASSETS.map((a) => [a, base[a] * closes[i][a]]));
      holdings.USDT = usdt;
      const plan = planRebalance(holdings, weights, { band, minOrderUsd: MIN_ORDER_USD, maxOrderUsd: Infinity });
      for (const o of plan.orders) {
        if (o.side === 'sell') {
          const cost = swapCost(o.leg, o.usd, 'sell', costsPct, gasUsd);
          base[o.leg] -= o.usd / closes[i][o.leg];
          usdt += o.usd - cost;
          feesPaid += cost - gasUsd; gasPaid += gasUsd; trades++;
        } else {
          const usd = Math.min(o.usd, usdt);
          if (usd < MIN_ORDER_USD) continue;
          const cost = swapCost(o.leg, usd, 'buy', costsPct, gasUsd);
          usdt -= usd;
          base[o.leg] += (usd - cost) / closes[i][o.leg];
          feesPaid += cost - gasUsd; gasPaid += gasUsd; trades++;
        }
      }
      lastRebal = day;
    }
    // 2) the dip rule on every close, per leg
    for (const a of ASSETS) {
      const m = trailingMean(closes, i, a, meanDays);
      if (m === null) continue;
      const px = closes[i][a];
      if (lot[a] > 0) {
        lotDays++;
        if (px >= m) {
          const usd = lot[a] * px;
          if (usd < MIN_ORDER_USD) continue; // under the wallet minimum it waits
          const cost = swapCost(a, usd, 'sell', costsPct, gasUsd);
          usdt += usd - cost;
          lotPnl += usd - cost - lotCost[a];
          lot[a] = 0; lotCost[a] = 0;
          feesPaid += cost - gasUsd; gasPaid += gasUsd; trades++; lotSells++;
        }
      } else if (dipPct > 0 && px <= m * (1 - dipPct / 100)) {
        const usd = Math.min(usdt, value(i) * (weights.USDT || 0) / ASSETS.length);
        if (usd < MIN_ORDER_USD) continue;
        const cost = swapCost(a, usd, 'buy', costsPct, gasUsd);
        usdt -= usd;
        lot[a] = (usd - cost) / px; lotCost[a] = usd;
        feesPaid += cost - gasUsd; gasPaid += gasUsd; trades++; lotBuys++;
      }
    }
    minUsdt = Math.min(minUsdt, usdt);
    equity.push(value(i));
  }
  const final = equity[equity.length - 1];
  let peak = -Infinity, maxDd = 0;
  for (const v of equity) { peak = Math.max(peak, v); maxDd = Math.max(maxDd, (peak - v) / peak); }
  const openLots = ASSETS.filter((a) => lot[a] > 0).length;
  const last = to - 1;
  const openLotUsd = ASSETS.reduce((s, a) => s + lot[a] * closes[last][a], 0);
  return { final, pnl: final - capitalUsd, pnlPct: (final / capitalUsd - 1) * 100, maxDdPct: maxDd * 100, trades, gasPaid, feesPaid, days: to - from, equity, lotBuys, lotSells, lotPnl, lotsFolded, lotDays, openLots, openLotUsd, cashEnd: usdt, minUsdt };
}

// Walk-forward: choose X on the first trainShare of days by net P&L, report
// the choice on the rest — and the two comparisons on the same unseen days.
export function walkForwardSleeve(closes, times, { capitalUsd, trainShare = 0.6, costsPct = DEFAULT_COSTS_PCT, gasUsd = DEFAULT_GAS_USD_PER_SWAP, grid = DIP_GRID }) {
  const split = Math.floor(closes.length * trainShare);
  let best = null;
  for (const dipPct of grid) {
    const r = replaySleeve(closes, times, { dipPct, capitalUsd, costsPct, gasUsd, from: 0, to: split });
    if (!best || r.pnl > best.train.pnl) best = { dipPct, train: r };
  }
  const unseen = replaySleeve(closes, times, { dipPct: best.dipPct, capitalUsd, costsPct, gasUsd, from: split });
  const thirds = replayAllocation(closes, times, ALLOCATIONS['thirds'], { capitalUsd, everyDays: REBALANCE_EVERY_DAYS, band: REBALANCE_BAND, costsPct, gasUsd, from: split });
  const cashOnly = replaySleeve(closes, times, { dipPct: 0, capitalUsd, costsPct, gasUsd, from: split });
  return { ...best, unseen, thirds, cashOnly, splitDay: split, unseenDays: closes.length - split, ahead: unseen.pnl > thirds.pnl };
}

// ------------------------------------------------------------------ self-test

function selfTest() {
  const fails = [];
  const ok = (cond, what) => { if (!cond) fails.push(what); };
  const noCost = { BNB: { buy: 0, sell: 0 }, CAKE: { buy: 0, sell: 0 }, BOB: { buy: 0, sell: 0 } };
  const N = 40;
  const times = Array.from({ length: N }, (_, i) => i * DAY_MS);
  const flat = times.map(() => ({ BNB: 100, CAKE: 100, BOB: 100 }));
  // The trailing mean: nothing before seven closes, then the seven before today.
  const ramp = times.map((_, i) => ({ BNB: 100 + i, CAKE: 1, BOB: 1 }));
  ok(trailingMean(ramp, 6, 'BNB') === null, 'no mean before seven closes');
  ok(trailingMean(ramp, 7, 'BNB') === 103, `day 7 mean is the mean of days 0-6 (103), got ${trailingMean(ramp, 7, 'BNB')}`);
  // Flat prices: the entry buys three legs, the sleeve stays in USDT, no lot fires.
  const f = replaySleeve(flat, times, { dipPct: 5, capitalUsd: 1000, costsPct: noCost, gasUsd: 0 });
  ok(f.trades === 3 && f.lotBuys === 0 && Math.abs(f.cashEnd - 250) < 1e-9, `flat: three entry buys and $250 of cash, got ${f.trades} trades, $${f.cashEnd.toFixed(2)}`);
  ok(Math.abs(f.pnl) < 1e-9, 'flat and free costs nothing');
  // With the real costs the flat entry costs exactly three buys and three gas charges on $250 each.
  const fc = replaySleeve(flat, times, { dipPct: 5, capitalUsd: 1000 });
  const expect = -(250 * 0.003 + 250 * 0.0035 + 250 * 0.0055 + 3 * DEFAULT_GAS_USD_PER_SWAP);
  ok(Math.abs(fc.pnl - expect) < 1e-6, `flat entry cost ${expect.toFixed(4)}, got ${fc.pnl.toFixed(4)}`);
  // A V in BNB: 100 for ten days, 90 on day 10, 100 again. X = 5: the lot is
  // bought at 90 for a third of the $250 sleeve target and sold at 100.
  const v = flat.map((c, i) => (i === 10 ? { ...c, BNB: 90 } : c));
  const r = replaySleeve(v, times, { dipPct: 5, capitalUsd: 1000, costsPct: noCost, gasUsd: 0 });
  const lotUsd = (250 + 3 * 250 - 25) * 0.25 / 3; // value on the dip day is 975
  ok(r.lotBuys === 1 && r.lotSells === 1, `one lot bought and sold on the V, got ${r.lotBuys}/${r.lotSells}`);
  ok(Math.abs(r.lotPnl - lotUsd * (100 / 90 - 1)) < 1e-6, `the lot earns the bounce: expected ${(lotUsd * (100 / 90 - 1)).toFixed(4)}, got ${r.lotPnl.toFixed(4)}`);
  ok(Math.abs(r.pnl - r.lotPnl) < 1e-6, 'on a V that closes where it opened, the whole gain is the lot');
  ok(r.openLots === 0 && Math.abs(r.cashEnd - 250 - r.lotPnl) < 1e-6, 'the lot is back in USDT');
  // A 3% dip does not trigger X = 5.
  const shallow = flat.map((c, i) => (i === 10 ? { ...c, BNB: 97 } : c));
  const s = replaySleeve(shallow, times, { dipPct: 5, capitalUsd: 1000, costsPct: noCost, gasUsd: 0 });
  ok(s.lotBuys === 0, `a 3% dip is not a 5% dip, got ${s.lotBuys} lots`);
  // X = 0 is the sleeve without the dip rule: cash drag only, never a lot.
  const drag = replaySleeve(v, times, { dipPct: 0, capitalUsd: 1000, costsPct: noCost, gasUsd: 0 });
  ok(drag.lotBuys === 0 && Math.abs(drag.pnl) < 1e-9, 'X = 0 never buys a lot');
  // Three legs dipping at once on a small pot: the lots never overdraw the cash,
  // and a third of the sleeve under the $10 minimum is no order at all.
  const all = flat.map((c, i) => (i === 10 ? { BNB: 80, CAKE: 80, BOB: 80 } : c));
  const small = replaySleeve(all, times, { dipPct: 5, capitalUsd: 100, costsPct: noCost, gasUsd: 0 });
  ok(small.lotBuys === 0, `on $100 the sleeve's third is under $10: no lot, got ${small.lotBuys}`);
  const big = replaySleeve(all, times, { dipPct: 5, capitalUsd: 1000, costsPct: noCost, gasUsd: 0 });
  ok(big.lotBuys === 3 && big.minUsdt >= -1e-9, `three lots on $1000, cash never negative (min ${big.minUsdt.toFixed(2)})`);
  // A lot still open on the monthly pass folds into its leg and the pass
  // refills the sleeve: the dip on day 29 (prices stay down), the pass on day 30.
  const down = flat.map((c, i) => (i >= 29 ? { ...c, BNB: 80 } : c));
  const fold = replaySleeve(down, times, { dipPct: 5, capitalUsd: 1000, costsPct: noCost, gasUsd: 0, band: 0 });
  ok(fold.lotsFolded === 1 && fold.openLots === 0, `the open lot folds on the pass, got folded ${fold.lotsFolded}, open ${fold.openLots}`);
  ok(Math.abs(fold.cashEnd / fold.final - 0.25) < 0.02, `after the pass the sleeve is a quarter again, got ${(fold.cashEnd / fold.final * 100).toFixed(1)}%`);
  // The walk-forward chooses X on the train days only and judges on the rest.
  const wf = walkForwardSleeve(v, times, { capitalUsd: 1000, costsPct: noCost, gasUsd: 0 });
  ok(wf.unseenDays === N - Math.floor(N * 0.6) && DIP_GRID.includes(wf.dipPct), 'unseen part is the last 40% of days, X from the grid');
  ok(typeof wf.ahead === 'boolean' && wf.thirds.days === wf.unseen.days, 'the thirds are replayed on the same unseen days');
  if (fails.length) { console.error('SELF-TEST FAILED'); for (const x of fails) console.error('  ' + x); process.exit(1); }
  console.log('self-test ok: 17 pins');
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
  console.log(`\nThe cash sleeve on ${closes.length} daily closes, ${first} – ${last} (from ${path.relative(ROOT, PRICES)}, fetched ${raw.fetched_at.slice(0, 16)}Z)`);
  console.log(`weights 25/25/25 + 25 USDT, monthly pass with the ${REBALANCE_BAND * 100}% band; a lot = a third of the sleeve at X% under the ${MEAN_DAYS}-day mean, back to USDT at the mean.`);
  console.log(`costs per side ${ASSETS.map((a) => `${a} ${DEFAULT_COSTS_PCT[a].buy}%`).join(', ')}; gas $${DEFAULT_GAS_USD_PER_SWAP} a swap; nothing under $${MIN_ORDER_USD}; no yield assumed.`);
  const split = Math.floor(closes.length * 0.6);
  console.log(`walk-forward: X chosen on the first ${split} days, judged on the last ${closes.length - split} (from ${new Date(times[split]).toISOString().slice(0, 10)}).`);

  const verdicts = [];
  for (const capitalUsd of capitals) {
    console.log(`\n=== pot $${capitalUsd} (sleeve $${(capitalUsd * SLEEVE.USDT).toFixed(0)}, a lot $${(capitalUsd * SLEEVE.USDT / 3).toFixed(0)}) ===`);
    console.log(`\n${pad('machine', 26)} ${rpad('6 months $', 11)} ${rpad('%', 7)} ${rpad('maxDD%', 7)} ${rpad('trades', 6)} ${rpad('gas $', 6)} ${rpad('lots', 5)} ${rpad('lot $', 8)} | ${rpad('unseen 40% $', 13)} ${rpad('%', 7)} ${rpad('lots', 5)} ${rpad('lot $', 8)}`);
    const thirdsFull = replayAllocation(closes, times, ALLOCATIONS['thirds'], { capitalUsd, everyDays: REBALANCE_EVERY_DAYS, band: REBALANCE_BAND });
    const thirdsUn = replayAllocation(closes, times, ALLOCATIONS['thirds'], { capitalUsd, everyDays: REBALANCE_EVERY_DAYS, band: REBALANCE_BAND, from: split });
    console.log(`${pad('thirds, monthly (live)', 26)} ${rpad(fmt(thirdsFull.pnl), 11)} ${rpad(fmt(thirdsFull.pnlPct, 1), 7)} ${rpad(thirdsFull.maxDdPct.toFixed(1), 7)} ${rpad(thirdsFull.trades, 6)} ${rpad(thirdsFull.gasPaid.toFixed(2), 6)} ${rpad('-', 5)} ${rpad('-', 8)} | ${rpad(fmt(thirdsUn.pnl), 13)} ${rpad(fmt(thirdsUn.pnlPct, 1), 7)} ${rpad('-', 5)} ${rpad('-', 8)}`);
    for (const dipPct of [0, ...DIP_GRID]) {
      const full = replaySleeve(closes, times, { dipPct, capitalUsd });
      const un = replaySleeve(closes, times, { dipPct, capitalUsd, from: split });
      const label = dipPct === 0 ? 'sleeve, no dip rule' : `sleeve, dip ${dipPct}%`;
      console.log(`${pad(label, 26)} ${rpad(fmt(full.pnl), 11)} ${rpad(fmt(full.pnlPct, 1), 7)} ${rpad(full.maxDdPct.toFixed(1), 7)} ${rpad(full.trades, 6)} ${rpad(full.gasPaid.toFixed(2), 6)} ${rpad(full.lotBuys, 5)} ${rpad(fmt(full.lotPnl), 8)} | ${rpad(fmt(un.pnl), 13)} ${rpad(fmt(un.pnlPct, 1), 7)} ${rpad(un.lotBuys, 5)} ${rpad(fmt(un.lotPnl), 8)}`);
    }
    // the honest number: X chosen blind, judged blind, stressed, and at other splits
    const wf = walkForwardSleeve(closes, times, { capitalUsd });
    const wf15 = walkForwardSleeve(closes, times, { capitalUsd, costsPct: scale(DEFAULT_COSTS_PCT, 1.5), gasUsd: DEFAULT_GAS_USD_PER_SWAP * 1.5 });
    console.log(`\nX chosen on the first 60%: ${wf.dipPct}% (train ${fmt(wf.train.pnl)}, ${wf.train.lotBuys} lots, lot P&L ${fmt(wf.train.lotPnl)})`);
    console.log(`  on the unseen 40%: ${fmt(wf.unseen.pnl)} (${fmt(wf.unseen.pnlPct, 1)}%), ${wf.unseen.trades} trades, gas $${wf.unseen.gasPaid.toFixed(2)}, ${wf.unseen.lotBuys} lots bought / ${wf.unseen.lotSells} sold / ${wf.unseen.lotsFolded} folded, lot P&L ${fmt(wf.unseen.lotPnl)}, max drawdown ${wf.unseen.maxDdPct.toFixed(1)}%`);
    console.log(`  thirds, monthly, same unseen days (the live machine): ${fmt(wf.thirds.pnl)} (${fmt(wf.thirds.pnlPct, 1)}%), max drawdown ${wf.thirds.maxDdPct.toFixed(1)}%`);
    console.log(`  the sleeve without the dip rule, same days: ${fmt(wf.cashOnly.pnl)} (${fmt(wf.cashOnly.pnlPct, 1)}%) — the cost of the cash itself`);
    console.log(`  with costs and gas × 1.5, chosen again: X ${wf15.dipPct}% → unseen ${fmt(wf15.unseen.pnl)} against thirds ${fmt(wf15.thirds.pnl)}`);
    const splits = [0.5, 0.6, 0.7, 0.8].map((s) => {
      const r = walkForwardSleeve(closes, times, { capitalUsd, trainShare: s });
      return { s, r };
    });
    console.log(`  at every split (sleeve vs thirds, unseen): ${splits.map(({ s, r }) => `${Math.round(s * 100)}%: X ${r.dipPct}% ${fmt(r.unseen.pnl)} vs ${fmt(r.thirds.pnl)} ${r.ahead ? 'AHEAD' : 'behind'}`).join(' · ')}`);
    const aheadAt = splits.filter(({ r }) => r.ahead).length;
    const verdict = aheadAt === splits.length ? 'ahead at every split — the rule for building it is met' : `ahead at ${aheadAt} of ${splits.length} splits — not built`;
    console.log(`  verdict for $${capitalUsd}: ${verdict}`);
    verdicts.push({ capitalUsd, aheadAt, of: splits.length, unseen: wf.unseen.pnl, thirds: wf.thirds.pnl, x: wf.dipPct });
  }
  console.log('\nRead this as price and cost only. The thirds are the machine that runs; the sleeve replaces a quarter of them with USDT that only works on dips.');
  console.log(`Build rule (2026-09-09): live only if the sleeve is ahead of the thirds at every split. ${verdicts.map((v) => `$${v.capitalUsd}: ${v.aheadAt}/${v.of}`).join(', ')}.`);
}

// -------------------------------------------------------------------- main
const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();
  else {
    const i = argv.indexOf('--capital');
    const capitals = i >= 0 ? [Number(argv[i + 1])] : [167, 500, 1000];
    report(capitals);
  }
}
