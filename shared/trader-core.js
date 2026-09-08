// THE TRADING AGENT'S ARITHMETIC — pure, no chain, no wallet, no clock.
//
// Four legs, one rule. The operator asked for a bot over BNB, BOB, BOBAI and
// CAKE that "buys the dip and sells the top, mathematically as sensible as
// possible, maximum profit" (2026-09-08). The honest reading of that is mean
// reversion: a price that has fallen unusually far below its own recent
// average is bought, and sold once it is back at or above that average.
// "Unusually far" is a z-score — how many standard deviations the log price
// sits below its rolling mean — so the same rule means the same thing on a
// coin that moves 1% a day and one that moves 10%.
//
// What the rule is NOT: a forecast. It earns when prices oscillate and loses
// when they trend away and never return, which is why every position carries
// a stop and a maximum holding time, and why the backtest reports the last
// part of the history it never saw while choosing its parameters.
//
// Costs are charged the way the wallet charges them: a percentage of each
// side, measured per leg (pool fee + price impact at the trade size + the
// wallet's own fee), plus BOBAI's 3% transfer tax on the buy. A rule that
// looks good before costs and bad after them is the usual result and the
// point of counting them.
//
// BOBAI is never sold by this agent (operator's thesis: push $BOBAI, never
// dump it). Its leg buys dips and holds; its profit is marked to market.
//
// Everything here is deterministic and pinned by scripts/trader.mjs --self-test.

export const LEGS = ['BNB', 'CAKE', 'BOB', 'BOBAI'];

// Per-side cost in percent of the amount traded, at a $25 leg. Sources
// 2026-09-08: our pool scanner's cost ladder (fee + impact at size), the
// wallet's own quotes (BNB->USDT 0.033 BNB came back within 0.05% of the
// spot price), and a wallet fee allowance nobody has yet measured on a real
// fill — set high rather than low until one has been (see trader.mjs
// --measure-fee).
export const DEFAULT_COSTS_PCT = {
  BNB: { buy: 0.30, sell: 0.30 },     // BNB <-> USDT, V3 0.01-0.05% + wallet allowance
  CAKE: { buy: 0.35, sell: 0.35 },    // CAKE <-> BNB, V3 0.05% + impact + allowance
  BOB: { buy: 0.55, sell: 0.55 },     // V2 0.25% + impact 0.26% at $25 + allowance
  BOBAI: { buy: 3.60, sell: 3.60 },   // 3% tax + V2 0.25% + impact + allowance (sell never used)
};

export const NEVER_SELL = new Set(['BOBAI']);

export const DEFAULT_PARAMS = { window: 48, entryZ: 2, exitZ: 0, stopPct: 6, maxHoldH: 72 };

export const PARAM_GRID = {
  window: [12, 24, 48, 96, 168],
  entryZ: [1, 1.5, 2, 2.5],
  exitZ: [0, 0.5, 1],
  stopPct: [6],
  maxHoldH: [72],
};

// Rolling z-score of log price. Returns null until the window is full.
export function zScores(closes, window) {
  const logs = closes.map((c) => Math.log(c));
  const out = new Array(closes.length).fill(null);
  let sum = 0, sumSq = 0;
  for (let i = 0; i < logs.length; i++) {
    sum += logs[i]; sumSq += logs[i] * logs[i];
    if (i >= window) { sum -= logs[i - window]; sumSq -= logs[i - window] * logs[i - window]; }
    if (i >= window - 1) {
      const n = window, mean = sum / n;
      const varc = Math.max(0, sumSq / n - mean * mean);
      const sd = Math.sqrt(varc);
      out[i] = sd > 0 ? (logs[i] - mean) / sd : 0;
    }
  }
  return out;
}

// One leg replayed over its closes with one parameter set. `legUsd` is the
// most this leg may hold at once; one position at a time, entered at the
// close that triggers it and exited at the close that triggers the exit.
// Costs are taken per side on the traded amount. Returns the trades, the
// net result in USD, and the drawdown of the leg's equity curve.
export function replayLeg(closes, times, params, { legUsd = 25, costsPct = { buy: 0.3, sell: 0.3 }, neverSell = false } = {}) {
  const { window, entryZ, exitZ, stopPct, maxHoldH } = params;
  const z = zScores(closes, window);
  const trades = [];
  let pos = null;            // { i, price, units, cost }
  let cash = legUsd, equityPeak = legUsd, maxDrawdown = 0, spentTotal = 0;
  const equityAt = (i) => cash + (pos ? pos.units * closes[i] : 0);
  for (let i = 0; i < closes.length; i++) {
    const p = closes[i];
    if (pos && !neverSell) {
      const heldH = (times[i] - times[pos.i]) / 36e5;
      const ret = (p - pos.price) / pos.price * 100;
      let why = null;
      if (z[i] != null && z[i] >= exitZ) why = 'back at the mean';
      else if (ret <= -stopPct) why = 'stop';
      else if (heldH >= maxHoldH) why = 'held too long';
      if (why) {
        const gross = pos.units * p;
        const fee = gross * costsPct.sell / 100;
        cash += gross - fee;
        trades.push({ entry: times[pos.i], exit: times[i], entry_price: pos.price, exit_price: p, ret_pct: Math.round(ret * 100) / 100, net_usd: Math.round((gross - fee - pos.spent) * 10000) / 10000, hours: Math.round(heldH), why });
        pos = null;
      }
    }
    if (!pos && z[i] != null && z[i] <= -entryZ && cash >= 1) {
      const spend = neverSell ? Math.min(cash, legUsd / 4) : cash;   // BOBAI: four dips per leg budget
      if (spend >= 1) {
        const fee = spend * costsPct.buy / 100;
        const units = (spend - fee) / p;
        if (neverSell) {
          // Accumulate: no exit, each dip is its own lot. Track as one growing position.
          cash -= spend; spentTotal += spend;
          pos = pos ? { i: pos.i, price: (pos.price * pos.units + p * units) / (pos.units + units), units: pos.units + units, spent: pos.spent + spend } : { i, price: p, units, spent: spend };
          trades.push({ entry: times[i], exit: null, entry_price: p, exit_price: null, ret_pct: null, net_usd: null, hours: null, why: 'dip bought, held' });
        } else {
          cash -= spend; spentTotal += spend;
          pos = { i, price: p, units, spent: spend };
        }
      }
    }
    const eq = equityAt(i);
    if (eq > equityPeak) equityPeak = eq;
    const dd = (equityPeak - eq) / equityPeak * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  const last = closes.length - 1;
  const endEquity = equityAt(last);
  const closed = trades.filter((t) => t.exit != null);
  const wins = closed.filter((t) => t.net_usd > 0).length;
  const buyHold = legUsd * (closes[last] / closes[0]) * (1 - costsPct.buy / 100);
  return {
    params, trades, closed: closed.length, open: pos ? 1 : 0,
    win_rate_pct: closed.length ? Math.round(wins / closed.length * 1000) / 10 : null,
    net_usd: Math.round((endEquity - legUsd) * 10000) / 10000,
    net_pct: Math.round((endEquity - legUsd) / legUsd * 10000) / 100,
    max_drawdown_pct: Math.round(maxDrawdown * 100) / 100,
    buy_hold_net_usd: Math.round((buyHold - legUsd) * 10000) / 10000,
    hours: closes.length,
    ...(pos ? { open_position: { entry_price: pos.price, units: pos.units, mark: closes[last], unrealised_usd: Math.round((pos.units * closes[last] - pos.spent) * 10000) / 10000 } } : {}),
  };
}

// Parameter search on the first `trainShare` of the history, judged on the
// rest. Picks the set with the best training net per day; reports both
// halves so the reader sees whether the pick survived hours it never saw.
export function walkForward(closes, times, { grid = PARAM_GRID, trainShare = 0.6, legUsd = 25, costsPct, neverSell = false, minTrades = 3 } = {}) {
  const split = Math.floor(closes.length * trainShare);
  const trainC = closes.slice(0, split), trainT = times.slice(0, split);
  const testC = closes.slice(split), testT = times.slice(split);
  const combos = [];
  for (const window of grid.window) for (const entryZ of grid.entryZ) for (const exitZ of grid.exitZ) for (const stopPct of grid.stopPct) for (const maxHoldH of grid.maxHoldH) {
    combos.push({ window, entryZ, exitZ, stopPct, maxHoldH });
  }
  const scored = combos.map((params) => {
    const r = replayLeg(trainC, trainT, params, { legUsd, costsPct, neverSell });
    const trades = neverSell ? r.trades.length : r.closed;
    return { params, train: r, score: trades >= minTrades ? r.net_usd / (trainC.length / 24) : -Infinity };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score === -Infinity) return { pick: null, reason: `no parameter set made ${minTrades} trades on the training half`, train_hours: trainC.length, test_hours: testC.length };
  // The test half is replayed with a warm window: the last `window` training
  // closes are prepended so the z-score exists from the first test hour, and
  // the equity is measured from the split.
  const warm = best.params.window;
  const testR = replayLeg(closes.slice(Math.max(0, split - warm)), times.slice(Math.max(0, split - warm)), best.params, { legUsd, costsPct, neverSell });
  return {
    pick: best.params,
    train: { hours: trainC.length, net_usd: best.train.net_usd, closed: best.train.closed, win_rate_pct: best.train.win_rate_pct, max_drawdown_pct: best.train.max_drawdown_pct, buy_hold_net_usd: best.train.buy_hold_net_usd },
    test: { hours: testC.length, net_usd: testR.net_usd, closed: testR.closed, win_rate_pct: testR.win_rate_pct, max_drawdown_pct: testR.max_drawdown_pct, buy_hold_net_usd: testR.buy_hold_net_usd, open_position: testR.open_position || null },
    runner_up: scored[1] ? { params: scored[1].params, train_net_usd: scored[1].train.net_usd } : null,
    combos_tried: combos.length,
  };
}

// What the rule says right now for one leg: the current z, and whether a
// buy or a sell is due given an open position (or none). Pure.
export function signal(closes, params, { position = null, neverSell = false, nowMs = null, entryMs = null } = {}) {
  const z = zScores(closes, params.window);
  const zi = z[z.length - 1];
  const p = closes[closes.length - 1];
  if (zi == null) return { z: null, action: 'hold', why: `the window needs ${params.window} closes, ${closes.length} on hand` };
  if (position) {
    if (neverSell) return { z: zi, action: zi <= -params.entryZ ? 'buy' : 'hold', why: zi <= -params.entryZ ? `z ${zi.toFixed(2)} ≤ −${params.entryZ}: another dip` : `z ${zi.toFixed(2)}: holding, this leg never sells` };
    const ret = (p - position.price) / position.price * 100;
    const heldH = nowMs && entryMs ? (nowMs - entryMs) / 36e5 : 0;
    if (zi >= params.exitZ) return { z: zi, action: 'sell', why: `z ${zi.toFixed(2)} ≥ ${params.exitZ}: back at the mean (${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%)` };
    if (ret <= -params.stopPct) return { z: zi, action: 'sell', why: `stop: ${ret.toFixed(2)}% against a ${params.stopPct}% stop` };
    if (heldH >= params.maxHoldH) return { z: zi, action: 'sell', why: `held ${heldH.toFixed(0)} h, the limit is ${params.maxHoldH} h` };
    return { z: zi, action: 'hold', why: `z ${zi.toFixed(2)}: in a position (${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%), waiting for the mean` };
  }
  if (zi <= -params.entryZ) return { z: zi, action: 'buy', why: `z ${zi.toFixed(2)} ≤ −${params.entryZ}: a dip` };
  return { z: zi, action: 'hold', why: `z ${zi.toFixed(2)}: no dip (a buy needs ≤ −${params.entryZ})` };
}
