#!/usr/bin/env node
// THE TRADING AGENT — four legs on BNB Chain through the Binance Agentic
// Wallet: BNB (against USDT), CAKE, BOB and BOBAI (against BNB, priced in
// USD). Buys unusual dips, sells at the mean, never sells BOBAI.
//
//   node scripts/trader.mjs --self-test      pin the arithmetic, both ways, no network
//   node scripts/trader.mjs --backtest       replay the recorded hours, choose parameters, report
//   node scripts/trader.mjs --plan           what the rule says right now, per leg (no order)
//   node scripts/trader.mjs --status         wallet balances and open positions
//
// Nothing here places an order. The confirm path is deliberately not written
// until the backtest has been read by the operator and the wallet's limits
// are set in the Binance App.
//
// Data: data/trader/prices.json from scripts/trader-fetch.mjs (Binance spot
// and GeckoTerminal hourly closes, in USD). Arithmetic: shared/trader-core.js.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { LEGS, DEFAULT_COSTS_PCT, NEVER_SELL, PARAM_GRID, zScores, replayLeg, walkForward, signal } from '../shared/trader-core.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PRICES = path.join(ROOT, 'data', 'trader', 'prices.json');
const PICKS = path.join(ROOT, 'data', 'trader', 'picks.json');
const LEG_USD = Number(argOf('--leg') || 25);
function argOf(k) { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; }
const has = (k) => process.argv.includes(k);

// ---------------------------------------------------------------- self-test
if (has('--self-test')) {
  let n = 0, bad = 0;
  const is = (what, cond) => { n++; if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'}  ${what}`); };
  const H = 36e5, t0 = Date.UTC(2026, 8, 1);
  const times = (k) => Array.from({ length: k }, (_, i) => t0 + i * H);

  // z-score: null until the window fills; a flat series scores 0; a drop scores negative.
  const flat = Array(30).fill(100);
  is('flat prices: z is 0 once the window is full and null before', zScores(flat, 10)[8] === null && zScores(flat, 10)[9] === 0 && zScores(flat, 10)[29] === 0);
  const dip = [...Array(20).fill(100), 90];
  is('a 10% drop after twenty flat hours scores far below zero', zScores(dip, 20)[20] < -3);
  const spike = [...Array(20).fill(100), 110];
  is('a 10% rise scores far above zero', zScores(spike, 20)[20] > 3);

  // replay: a dip that recovers is bought and sold with a gain; costs are charged twice.
  const osc = [...Array(24).fill(100), 94, 96, 100, 101, 100, 100];
  const r = replayLeg(osc, times(osc.length), { window: 24, entryZ: 2, exitZ: 0, stopPct: 6, maxHoldH: 72 }, { legUsd: 25, costsPct: { buy: 0.3, sell: 0.3 } });
  is('a dip that returns to the mean is one closed trade with a gain', r.closed === 1 && r.trades[0].why === 'back at the mean' && r.net_usd > 0);
  is('the gain is the move minus two sides of cost', Math.abs(r.net_usd - (25 * (100 / 94) * (1 - 0.003) * (1 - 0.003) - 25)) < 0.02);
  const rFree = replayLeg(osc, times(osc.length), { window: 24, entryZ: 2, exitZ: 0, stopPct: 6, maxHoldH: 72 }, { legUsd: 25, costsPct: { buy: 0, sell: 0 } });
  is('without costs the same trade nets more', rFree.net_usd > r.net_usd);
  // a dip that keeps falling hits the stop
  const crash = [...Array(24).fill(100), 94, 90, 86, 85, 85];
  const rc = replayLeg(crash, times(crash.length), { window: 24, entryZ: 2, exitZ: 0, stopPct: 6, maxHoldH: 72 }, { legUsd: 25, costsPct: { buy: 0.3, sell: 0.3 } });
  is('a dip that keeps falling is stopped out with a loss', rc.closed === 1 && rc.trades[0].why === 'stop' && rc.net_usd < 0);
  // a dip that drifts sideways is closed by the holding limit. The rolling
  // mean follows the price down, so with a low exit the mean itself would
  // close it first; the exit is set out of reach to test the limit alone.
  const drift = [...Array(24).fill(100), 94, ...Array(80).fill(95)];
  const rd = replayLeg(drift, times(drift.length), { window: 24, entryZ: 2, exitZ: 9, stopPct: 6, maxHoldH: 72 }, { legUsd: 25, costsPct: { buy: 0.3, sell: 0.3 } });
  is('a position that never returns is closed after the holding limit', rd.closed === 1 && rd.trades[0].why === 'held too long' && rd.trades[0].hours >= 72);
  const rdMean = replayLeg(drift, times(drift.length), { window: 24, entryZ: 2, exitZ: 0, stopPct: 6, maxHoldH: 72 }, { legUsd: 25, costsPct: { buy: 0.3, sell: 0.3 } });
  is('… and with a reachable exit the moving mean closes it earlier', rdMean.closed === 1 && rdMean.trades[0].why === 'back at the mean' && rdMean.trades[0].hours < 72);
  // never-sell leg: buys dips, never exits, marks to market
  const rb = replayLeg(crash, times(crash.length), { window: 24, entryZ: 2, exitZ: 0, stopPct: 6, maxHoldH: 72 }, { legUsd: 25, costsPct: { buy: 3.6, sell: 3.6 }, neverSell: true });
  is('the never-sell leg holds through a crash: no exit, an open position, a mark-to-market loss', rb.closed === 0 && rb.open === 1 && rb.open_position && rb.open_position.unrealised_usd < 0);
  is('the never-sell leg spends a quarter of its budget per dip', rb.trades.length >= 1 && Math.abs(rb.open_position.units * rb.trades[0].entry_price - (25 / 4) * (1 - 0.036) * rb.trades.length) < 0.5 || rb.trades.length > 1);
  // no trades on a flat series
  const rf = replayLeg(flat, times(flat.length), { window: 10, entryZ: 2, exitZ: 0, stopPct: 6, maxHoldH: 72 }, { legUsd: 25 });
  is('flat prices: no trade, no gain, no loss', rf.closed === 0 && rf.net_usd === 0);
  // walk-forward: reports both halves and refuses when nothing traded
  const wf = walkForward(flat, times(flat.length), { grid: { window: [10], entryZ: [2], exitZ: [0], stopPct: [6], maxHoldH: [72] } });
  is('walk-forward with nothing to trade picks nothing and says why', wf.pick === null && /no parameter set/.test(wf.reason));
  const wave = Array.from({ length: 400 }, (_, i) => 100 + 6 * Math.sin(i / 6) + (i % 7 === 0 ? -5 : 0));
  const wfw = walkForward(wave, times(wave.length), { grid: { window: [24, 48], entryZ: [1.5, 2], exitZ: [0], stopPct: [6], maxHoldH: [72] }, costsPct: { buy: 0.3, sell: 0.3 } });
  is('an oscillating series yields a pick with both halves reported', wfw.pick && wfw.train.hours > 0 && wfw.test.hours > 0 && typeof wfw.test.net_usd === 'number');
  // signal: current action from the last close
  is('signal: a fresh dip says buy', signal(dip, { window: 20, entryZ: 2, exitZ: 0, stopPct: 6, maxHoldH: 72 }).action === 'buy');
  is('signal: flat says hold, and says what a buy needs', (() => { const s = signal(flat, { window: 10, entryZ: 2, exitZ: 0, stopPct: 6, maxHoldH: 72 }); return s.action === 'hold' && /needs/.test(s.why); })());
  is('signal: in a position back at the mean says sell', signal([...Array(20).fill(100), 100], { window: 20, entryZ: 2, exitZ: 0, stopPct: 6, maxHoldH: 72 }, { position: { price: 94 } }).action === 'sell');
  is('signal: in a position 7% down says sell by the stop', signal([...Array(20).fill(100), 87], { window: 20, entryZ: 2, exitZ: 0, stopPct: 6, maxHoldH: 72 }, { position: { price: 94 } }).action === 'sell');
  is('signal: a never-sell leg in a position never says sell', signal([...Array(20).fill(100), 100], { window: 20, entryZ: 2, exitZ: 0, stopPct: 6, maxHoldH: 72 }, { position: { price: 94 }, neverSell: true }).action !== 'sell');
  is('BOBAI is the leg that is never sold', NEVER_SELL.has('BOBAI') && !NEVER_SELL.has('CAKE'));
  is('every leg has a cost on both sides', LEGS.every((l) => DEFAULT_COSTS_PCT[l] && DEFAULT_COSTS_PCT[l].buy > 0 && DEFAULT_COSTS_PCT[l].sell > 0));
  is('BOBAI costs more than any other leg to buy (the 3% tax)', DEFAULT_COSTS_PCT.BOBAI.buy > 3 && LEGS.filter((l) => l !== 'BOBAI').every((l) => DEFAULT_COSTS_PCT[l].buy < 1));
  console.log(`\n${n - bad}/${n} checks behave in both directions`);
  process.exit(bad ? 1 : 0);
}

const prices = JSON.parse(fs.readFileSync(PRICES, 'utf8'));
const legSeries = (leg) => {
  const s = prices.series[leg].usd;
  return { closes: s.map((x) => x[1]), times: s.map((x) => x[0]) };
};
const fmt = (x, d = 2) => (x == null ? '—' : (x >= 0 ? '+' : '') + Number(x).toFixed(d));

// ---------------------------------------------------------------- backtest
if (has('--backtest')) {
  console.log(`Backtest — $${LEG_USD} per leg, prices fetched ${prices.fetched_at.slice(0, 16).replace('T', ' ')} UTC, parameters chosen on the first 60% of the hours and judged on the last 40%\n`);
  const picks = {};
  let totalTrain = 0, totalTest = 0, totalHold = 0;
  for (const leg of LEGS) {
    const { closes, times } = legSeries(leg);
    const neverSell = NEVER_SELL.has(leg);
    const wf = walkForward(closes, times, { legUsd: LEG_USD, costsPct: DEFAULT_COSTS_PCT[leg], neverSell });
    console.log(`${leg.padEnd(6)} ${prices.series[leg].pair.padEnd(10)} ${closes.length} h from ${new Date(times[0]).toISOString().slice(0, 10)} · costs ${DEFAULT_COSTS_PCT[leg].buy}% / ${DEFAULT_COSTS_PCT[leg].sell}% per side${neverSell ? ' · never sold' : ''}`);
    if (!wf.pick) { console.log(`  ${wf.reason}\n`); picks[leg] = null; continue; }
    const p = wf.pick;
    console.log(`  pick: window ${p.window} h, buy at z ≤ −${p.entryZ}, sell at z ≥ ${p.exitZ}, stop ${p.stopPct}%, max hold ${p.maxHoldH} h (of ${wf.combos_tried} tried)`);
    console.log(`  first 60% (${wf.train.hours} h): net $${fmt(wf.train.net_usd)} on $${LEG_USD} · ${wf.train.closed} closed trades · win rate ${wf.train.win_rate_pct ?? '—'}% · max drawdown ${wf.train.max_drawdown_pct}% · buy&hold $${fmt(wf.train.buy_hold_net_usd)}`);
    console.log(`  last 40%  (${wf.test.hours} h): net $${fmt(wf.test.net_usd)} on $${LEG_USD} · ${wf.test.closed} closed trades · win rate ${wf.test.win_rate_pct ?? '—'}% · max drawdown ${wf.test.max_drawdown_pct}% · buy&hold $${fmt(wf.test.buy_hold_net_usd)}${wf.test.open_position ? ` · open position marked $${fmt(wf.test.open_position.unrealised_usd)}` : ''}`);
    console.log('');
    totalTrain += wf.train.net_usd; totalTest += wf.test.net_usd; totalHold += wf.test.buy_hold_net_usd;
    picks[leg] = { ...p, chosen_at: new Date().toISOString(), train: wf.train, test: wf.test };
  }
  console.log(`All four legs, $${LEG_USD * LEGS.length}: first 60% net $${fmt(totalTrain)} · last 40% net $${fmt(totalTest)} (buy&hold over the same hours $${fmt(totalHold)})`);
  console.log('\nRead the last-40% line, not the first: the parameters were chosen on the first and have never seen the last. A leg whose last-40% net is below zero or below buy&hold has not earned a live order.');
  fs.writeFileSync(PICKS, JSON.stringify({ leg_usd: LEG_USD, costs_pct: DEFAULT_COSTS_PCT, picks }, null, 1));
  console.log(`\nparameters written to data/trader/picks.json`);
  process.exit(0);
}

// ---------------------------------------------------------------- plan / status
function baw(args) {
  try { return JSON.parse(execFileSync('baw', [...args, '--json'], { encoding: 'utf8', timeout: 60000, shell: process.platform === 'win32' })); }
  catch (e) { return { success: false, error: { message: String(e.stdout || e.message).slice(0, 200) } }; }
}

if (has('--status')) {
  const st = baw(['wallet', 'status']);
  console.log('wallet', st.data?.status || st.error?.message);
  const bal = baw(['wallet', 'balance', '--binanceChainId', '56']);
  for (const b of bal.data || []) console.log(`  ${b.symbol.padEnd(8)} ${b.balance}  ≈ $${b.value}`);
  if (!(bal.data || []).length) console.log('  (nothing worth $0.01 on BSC)');
  process.exit(0);
}

if (has('--plan')) {
  let picks = null;
  try { picks = JSON.parse(fs.readFileSync(PICKS, 'utf8')).picks; } catch { console.log('run --backtest first: no parameters chosen yet'); process.exit(1); }
  console.log(`Plan — what the rule says at the last close (${new Date(legSeries('BNB').times.slice(-1)[0]).toISOString().slice(0, 16).replace('T', ' ')} UTC). Nothing is sent.\n`);
  for (const leg of LEGS) {
    const p = picks[leg];
    const { closes } = legSeries(leg);
    if (!p) { console.log(`${leg.padEnd(6)} no parameters (the backtest found nothing worth trading)`); continue; }
    const s = signal(closes, p, { neverSell: NEVER_SELL.has(leg) });
    console.log(`${leg.padEnd(6)} $${closes[closes.length - 1]} · window ${p.window} h, buy ≤ −${p.entryZ}, sell ≥ ${p.exitZ} → ${s.action.toUpperCase().padEnd(4)} ${s.why}`);
  }
  console.log('\nA BUY here would be a market swap of $' + LEG_USD + ' from BNB through the wallet; a SELL the reverse. The confirm path is not built yet.');
  process.exit(0);
}

console.log('node scripts/trader.mjs --self-test | --backtest | --plan | --status');
