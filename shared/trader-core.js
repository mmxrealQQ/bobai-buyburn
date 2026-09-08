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

// Two rule families, judged by the same evidence. 'reversion' buys a dip
// (z ≤ −entryZ) and sells at the mean (z ≥ exitZ). 'trend' is the mirror:
// it buys a breakout (z ≥ entryZ) and sells once the price is back under
// the mean (z ≤ −exitZ). In a market that oscillates the first earns and
// the second bleeds; in one that trends the reverse. Which one a leg gets
// is decided by hours it has not seen, not by preference.
export const MODES = ['reversion', 'trend'];
export const PARAM_GRID = {
  mode: MODES,
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
  const sign = params.mode === 'trend' ? -1 : 1;
  const z = zScores(closes, window).map((v) => (v == null ? null : sign * v));
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
  for (const mode of (grid.mode || ['reversion'])) for (const window of grid.window) for (const entryZ of grid.entryZ) for (const exitZ of grid.exitZ) for (const stopPct of grid.stopPct) for (const maxHoldH of grid.maxHoldH) {
    combos.push({ mode, window, entryZ, exitZ, stopPct, maxHoldH });
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
  const sign = params.mode === 'trend' ? -1 : 1;
  const z = zScores(closes, params.window).map((v) => (v == null ? null : sign * v));
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

// THE PORTFOLIO — the operator's rule of 2026-09-08 ("BNB, BOB und CAKE
// profit kaufen und wenn BOBAI dippt nur den profit rein, 50%; das andere
// wieder verwenden zum wachsen"). Three trading legs share the capital.
// Every closed trade's net result goes into a profit pool. When BOBAI dips
// (its own z-score below `bobaiDipZ`), half of the pool buys BOBAI, which is
// never sold; the other half is added to the trading capital, split evenly
// across the legs. A losing trade shrinks the pool first, then the capital.
export const TRADING_LEGS = ['BNB', 'CAKE', 'BOB'];

// Align a sparse series (BOBAI has hours without a trade) to a dense hourly
// grid by carrying the last close forward.
export function alignTo(times, sparse) {
  const out = new Array(times.length).fill(null);
  let j = 0, last = null;
  for (let i = 0; i < times.length; i++) {
    while (j < sparse.length && sparse[j][0] <= times[i]) { last = sparse[j][1]; j++; }
    out[i] = last;
  }
  return out;
}

export function replayPortfolio(legs, bobai, picks, { capitalUsd = 100, profitToBobaiPct = 50, bobaiDipZ = 1, bobaiWindow = 168, costsPct = DEFAULT_COSTS_PCT } = {}) {
  // legs: { BNB: {closes, times}, ... } on one hourly grid (times identical);
  // bobai: { closes (aligned to that grid) }.
  const names = TRADING_LEGS.filter((l) => picks[l]);
  const times = legs[names[0]].times;
  const n = times.length;
  const z = Object.fromEntries(names.map((l) => [l, zScores(legs[l].closes, picks[l].window)]));
  const zb = bobai && bobai.closes.every((c) => c != null) ? zScores(bobai.closes, bobaiWindow) : (bobai ? zScores(bobai.closes.map((c) => c ?? bobai.closes.find((x) => x != null)), bobaiWindow) : null);
  const budget = Object.fromEntries(names.map((l) => [l, capitalUsd / names.length]));
  const pos = Object.fromEntries(names.map((l) => [l, null]));
  let cashInLegs = capitalUsd, profitPool = 0, bobaiUnits = 0, bobaiSpent = 0, bobaiBuys = 0, grownBy = 0;
  const trades = [];
  let peak = capitalUsd, maxDD = 0;
  for (let i = 0; i < n; i++) {
    for (const l of names) {
      const p = legs[l].closes[i], zi = z[l][i], P = picks[l], c = costsPct[l];
      const open = pos[l];
      if (open) {
        const heldH = (times[i] - times[open.i]) / 36e5;
        const ret = (p - open.price) / open.price * 100;
        let why = null;
        if (zi != null && zi >= P.exitZ) why = 'back at the mean';
        else if (ret <= -P.stopPct) why = 'stop';
        else if (heldH >= P.maxHoldH) why = 'held too long';
        if (why) {
          const gross = open.units * p, fee = gross * c.sell / 100, net = gross - fee - open.spent;
          // the leg gets its stake back; the result goes to the pool (a loss
          // eats the pool first, then the leg's own budget)
          budget[l] += open.spent;
          if (net >= 0) profitPool += net;
          else if (profitPool + net >= 0) profitPool += net;
          else { budget[l] += profitPool + net; profitPool = 0; }
          trades.push({ leg: l, entry: times[open.i], exit: times[i], ret_pct: Math.round(ret * 100) / 100, net_usd: Math.round(net * 10000) / 10000, hours: Math.round(heldH), why });
          pos[l] = null;
        }
      }
      if (!pos[l] && zi != null && zi <= -P.entryZ && budget[l] >= 1) {
        const spend = budget[l], fee = spend * c.buy / 100;
        pos[l] = { i, price: p, units: (spend - fee) / p, spent: spend };
        budget[l] = 0;
      }
    }
    // BOBAI dip: half the pool buys, the other half grows the legs
    if (zb && zb[i] != null && zb[i] <= -bobaiDipZ && profitPool >= 1 && bobai.closes[i]) {
      const toBobai = profitPool * profitToBobaiPct / 100, toGrow = profitPool - toBobai;
      const fee = toBobai * costsPct.BOBAI.buy / 100;
      bobaiUnits += (toBobai - fee) / bobai.closes[i]; bobaiSpent += toBobai; bobaiBuys += 1;
      for (const l of names) budget[l] += toGrow / names.length;
      grownBy += toGrow; profitPool = 0;
      trades.push({ leg: 'BOBAI', entry: times[i], exit: null, ret_pct: null, net_usd: null, hours: null, why: `dip: $${toBobai.toFixed(2)} of profit into BOBAI, $${toGrow.toFixed(2)} into the legs` });
    }
    const markLegs = names.reduce((s, l) => s + budget[l] + (pos[l] ? pos[l].units * legs[l].closes[i] : 0), 0);
    const markBobai = bobai && bobai.closes[i] ? bobaiUnits * bobai.closes[i] : bobaiSpent;
    const eq = markLegs + profitPool + markBobai;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak * 100; if (dd > maxDD) maxDD = dd;
  }
  const last = n - 1;
  const legsMark = names.reduce((s, l) => s + budget[l] + (pos[l] ? pos[l].units * legs[l].closes[last] : 0), 0);
  const bobaiMark = bobai && bobai.closes[last] ? bobaiUnits * bobai.closes[last] : bobaiSpent;
  const closed = trades.filter((t) => t.exit != null);
  const r4 = (x) => Math.round(x * 10000) / 10000;
  return {
    capital_usd: capitalUsd, legs: names, hours: n,
    closed_trades: closed.length, wins: closed.filter((t) => t.net_usd > 0).length,
    realised_profit_usd: r4(closed.reduce((s, t) => s + t.net_usd, 0)),
    profit_pool_usd: r4(profitPool),
    grown_into_legs_usd: r4(grownBy),
    bobai: { buys: bobaiBuys, spent_usd: r4(bobaiSpent), units: r4(bobaiUnits), mark_usd: r4(bobaiMark) },
    trading_capital_now_usd: r4(legsMark + profitPool),
    total_now_usd: r4(legsMark + profitPool + bobaiMark),
    net_usd: r4(legsMark + profitPool + bobaiMark - capitalUsd),
    max_drawdown_pct: Math.round(maxDD * 100) / 100,
    trades,
  };
}

// THE ROTATION — the operator's second sentence of 2026-09-08: "immer wenn
// einer dippt ist es die Moeglichkeit rein zu gehen von einem wo on top ist
// und profit gemacht hat". One pot. It sits in USDT when nothing dips, buys
// the deepest dip among BNB, CAKE and BOB, sells when that asset is back at
// its mean (or stopped, or held too long), and can do both in the same hour
// — out of a top, into a dip. Every closed trade's net result goes to the
// pool; at a BOBAI dip half the pool buys BOBAI (never sold) and half grows
// the pot. Losses eat the pool first, then the pot.
export function replayRotation(legs, bobai, picks, { capitalUsd = 100, profitToBobaiPct = 50, bobaiDipZ = 1, bobaiWindow = 168, costsPct = DEFAULT_COSTS_PCT, minDipZ = null } = {}) {
  const names = TRADING_LEGS.filter((l) => picks[l]);
  const times = legs[names[0]].times, n = times.length;
  const z = Object.fromEntries(names.map((l) => [l, zScores(legs[l].closes, picks[l].window).map((v) => (v == null ? null : (picks[l].mode === 'trend' ? -v : v)))]));
  const bob = bobai ? bobai.closes.map((c, i, a) => c ?? (i ? a[i - 1] : null)) : null;
  for (let i = 1; bob && i < bob.length; i++) if (bob[i] == null) bob[i] = bob[i - 1];
  const zb = bob && bob.every((c) => c != null) ? zScores(bob, bobaiWindow) : null;
  let pot = capitalUsd, pos = null, profitPool = 0, bobaiUnits = 0, bobaiSpent = 0, bobaiBuys = 0, grownBy = 0;
  const trades = []; let peak = capitalUsd, maxDD = 0;
  for (let i = 0; i < n; i++) {
    if (pos) {
      const l = pos.leg, p = legs[l].closes[i], P = picks[l], c = costsPct[l];
      const heldH = (times[i] - times[pos.i]) / 36e5, ret = (p - pos.price) / pos.price * 100;
      let why = null;
      if (z[l][i] != null && z[l][i] >= P.exitZ) why = 'back at the mean';
      else if (ret <= -P.stopPct) why = 'stop';
      else if (heldH >= P.maxHoldH) why = 'held too long';
      if (why) {
        const gross = pos.units * p, fee = gross * c.sell / 100, net = gross - fee - pos.spent;
        pot += pos.spent;
        if (net >= 0) profitPool += net; else if (profitPool + net >= 0) profitPool += net; else { pot += profitPool + net; profitPool = 0; }
        trades.push({ leg: l, entry: times[pos.i], exit: times[i], ret_pct: Math.round(ret * 100) / 100, net_usd: Math.round(net * 10000) / 10000, hours: Math.round(heldH), why });
        pos = null;
      }
    }
    if (!pos && pot >= 1) {
      // the deepest dip of the hour, if any dips at all
      let best = null;
      for (const l of names) {
        const zi = z[l][i];
        if (zi == null || zi > -picks[l].entryZ) continue;
        if (minDipZ != null && zi > -minDipZ) continue;
        if (!best || zi < best.z) best = { leg: l, z: zi };
      }
      if (best) {
        const l = best.leg, p = legs[l].closes[i], fee = pot * costsPct[l].buy / 100;
        pos = { leg: l, i, price: p, units: (pot - fee) / p, spent: pot };
        pot = 0;
      }
    }
    if (zb && zb[i] != null && zb[i] <= -bobaiDipZ && profitPool >= 1 && bob[i]) {
      const toBobai = profitPool * profitToBobaiPct / 100, toGrow = profitPool - toBobai;
      bobaiUnits += (toBobai - toBobai * costsPct.BOBAI.buy / 100) / bob[i]; bobaiSpent += toBobai; bobaiBuys += 1;
      pot += toGrow; grownBy += toGrow; profitPool = 0;
      trades.push({ leg: 'BOBAI', entry: times[i], exit: null, ret_pct: null, net_usd: null, hours: null, why: `dip: $${toBobai.toFixed(2)} of profit into BOBAI, $${toGrow.toFixed(2)} into the pot` });
    }
    const eq = pot + profitPool + (pos ? pos.units * legs[pos.leg].closes[i] : 0) + (bob && bob[i] ? bobaiUnits * bob[i] : bobaiSpent);
    if (eq > peak) peak = eq; const dd = (peak - eq) / peak * 100; if (dd > maxDD) maxDD = dd;
  }
  const last = n - 1;
  const potMark = pot + profitPool + (pos ? pos.units * legs[pos.leg].closes[last] : 0);
  const bobaiMark = bob && bob[last] ? bobaiUnits * bob[last] : bobaiSpent;
  const closed = trades.filter((t) => t.exit != null);
  const r4 = (x) => Math.round(x * 10000) / 10000;
  const perLeg = Object.fromEntries(names.map((l) => [l, { closed: closed.filter((t) => t.leg === l).length, net_usd: r4(closed.filter((t) => t.leg === l).reduce((s, t) => s + t.net_usd, 0)) }]));
  return {
    capital_usd: capitalUsd, legs: names, hours: n, closed_trades: closed.length, wins: closed.filter((t) => t.net_usd > 0).length,
    per_leg: perLeg, realised_profit_usd: r4(closed.reduce((s, t) => s + t.net_usd, 0)), profit_pool_usd: r4(profitPool), grown_into_pot_usd: r4(grownBy),
    bobai: { buys: bobaiBuys, spent_usd: r4(bobaiSpent), units: r4(bobaiUnits), mark_usd: r4(bobaiMark) },
    open: pos ? { leg: pos.leg, since: times[pos.i], unrealised_usd: r4(pos.units * legs[pos.leg].closes[last] - pos.spent) } : null,
    trading_capital_now_usd: r4(potMark), total_now_usd: r4(potMark + bobaiMark), net_usd: r4(potMark + bobaiMark - capitalUsd),
    max_drawdown_pct: Math.round(maxDD * 100) / 100, trades,
  };
}
