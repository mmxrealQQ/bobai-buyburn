// THE RECORD THAT DECIDES THE LP POSITION'S WIDTH, kept around the clock.
//
// scripts/lp-windows.mjs records one window each time somebody runs it, and
// scripts/lib/lp-decision.mjs lets that record overrule the single fresh replay
// once it holds two non-overlapping windows. That is the right rule — measured
// on the same pool two hours apart, +/-0.25% went from best in the list to six
// crossings and minus $2.74 on fifty dollars — but a record that only grows
// while a person is at a keyboard is a record of that person's working hours.
// The price moves at 4 a.m. too.
//
// So the agent worker records a window every hour on its own cron. It reads
// the same measurement the script reads, over our own MCP endpoint rather
// than by copying the arithmetic (a second copy of a replay is how two answers
// drift apart), and it appends to a log in KV that has exactly the shape of
// data/lp-windows.json. `lp-windows.mjs --sync` pulls that log into the local
// file, and the decision keeps reading ONE file.
//
// It reads. It holds no key, signs nothing and moves nothing. Phase B — the
// collect-and-burn leg with a key on the worker — is deliberately not here:
// there is no position yet to test it against.
//
// The aggregation lives in this file and nowhere else. The script's --report
// and the decision module both import verdict() from here, so the number a
// person reads and the number the mint is sized on come from one function.

import { RESET_AFTER_HOURS, MIN_HOURS_FOR_EARNINGS, waitInUse, V2_SWAP_FEE_PCT, widthClassOf, DERIVED_WIDTHS, rangeValue, pickWidth, WIDTH_WINDOW_HOURS, ONE_SIDED_GAP_TICKS, RANGE_LEFT_TICKS } from '../shared/lp-guards.js';
import { isReset } from '../shared/lp-flow.js';

const MEASURE = 'https://brainonbnb.com/mcp';
export const KV_KEY = 'lp:windows';
// Hourly windows of ~59 minutes (37 before 2026-09-09) never overlap, so the count is honest by
// construction; the cap only keeps the KV value from growing without bound.
// 400 hourly windows is over two weeks, which is more than the decision needs.
export const MAX_WINDOWS = 400;
export const POSITION_USD = 50;

// THE PRICE TAPE (2026-09-11). The hourly window carries one price, so the
// earnings test saw the price once an hour: a range left and re-entered
// within the hour never happened to it, and a wait of "three hours outside"
// was three hourly readings. The DeFi worker reads the pool every ten
// minutes anyway (the deposit watch, the hourly check) and now writes the
// tick down: one sample, one KV write, 144 a day. The tape sharpens the
// replay's in-or-out and its re-set timing; the fees still come from the
// hourly windows, scaled to the minutes each sample stands for. Thirty days
// at six an hour is the cap.
export const TICKS_KEY = 'lp:ticks';
export const MAX_TICKS = 4320;
// Appends a sample unless one within a minute of it is already there. Pure.
export function appendTick(tape, sample) {
  const list = Array.isArray(tape) ? tape : [];
  if (!sample || !sample.at || !(Number(sample.price) > 0)) return { tape: list, added: false };
  const t = Date.parse(sample.at);
  if (list.some((x) => Math.abs(Date.parse(x.at) - t) < 60e3)) return { tape: list, added: false };
  const next = list.concat({ at: sample.at, tick: sample.tick ?? null, price: Number(sample.price), pool: sample.pool ? String(sample.pool).toLowerCase() : null })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (next.length > MAX_TICKS) next.splice(0, next.length - MAX_TICKS);
  return { tape: next, added: true };
}
export async function readLpTicks(env) {
  try { const raw = await env.AGENT.get(TICKS_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
export async function recordLpTick(env, sample) {
  const { tape, added } = appendTick(await readLpTicks(env), sample);
  if (added) await env.AGENT.put(TICKS_KEY, JSON.stringify(tape));
  return added;
}

// ONE PRICE SERIES from the hourly windows and the tape: every window's head
// price and every tape sample, in time order, a sample within a minute of a
// window's head counted once. Each point names the window whose hour it
// falls in (the first window at or after it; past the last window, the
// last), so the fee rate a point earns at is that window's row.
export function priceSeries(priced, tape = null) {
  const pts = priced.map((w) => ({ at: w.at, t: Date.parse(w.at), price: w.price, window: w }));
  for (const x of Array.isArray(tape) ? tape : []) {
    if (!x || !x.at || !(Number(x.price) > 0)) continue;
    const t = Date.parse(x.at);
    if (pts.some((p) => Math.abs(p.t - t) < 60e3)) continue;
    pts.push({ at: x.at, t, price: Number(x.price), window: null });
  }
  pts.sort((a, b) => a.t - b.t);
  let wi = 0;
  for (const p of pts) {
    if (p.window) { wi = priced.indexOf(p.window); continue; }
    while (wi < priced.length - 1 && Date.parse(priced[wi].at) < p.t) wi++;
    p.window = priced[wi];
  }
  return pts;
}

// One replay -> one log entry. Same field names, same "held" rule as the
// script: in range for the WHOLE window and never across the edge. A range is
// centred on today's price and replayed backwards, so it can just as easily be
// arrived in as left, and "never seen leaving" would call that a hold.
export function windowFromPlan(plan, usd, at = new Date().toISOString()) {
  const w = plan.measured_window;
  return {
    at,
    from_block: w.from_block,
    to_block: w.to_block,
    minutes: w.minutes,
    swaps: w.swaps,
    // The price at the window's head, kept so the record can answer the
    // question an hour's replay cannot: would this width have held for a
    // DAY. The position went out of a +/-0.5% range within five hours of a
    // record in which that width had held every window.
    price: typeof plan.price_now === 'number' ? plan.price_now : null,
    pool_fees_usd: w.fees_the_pool_paid_usd,
    // The liquidity's share of a fee (2026-09-13): CAKE/BNB 0.05% keeps 34%
    // for the protocol, so the rows hold 66% of what the trader paid. Null
    // on a window recorded before the replay knew — those were scaled once
    // on 2026-09-13 and carry `lp_share` since.
    lp_share: typeof w.paid_to_liquidity_pct === 'number' ? Number((w.paid_to_liquidity_pct / 100).toFixed(4)) : null,
    rebalance_cost_usd: plan.rebalance_cost_usd_assumed,
    rows: plan.ranges.map((r) => ({
      width: r.full_range ? 'full' : r.width_pct,
      held: r.share_of_window_in_range_pct === 100 && r.times_it_crossed_the_edge === 0,
      in_range_pct: r.share_of_window_in_range_pct,
      crossings: r.times_it_crossed_the_edge,
      fees: r.fees_usd_in_window,
      net: r.net_after_rebalancing_usd_in_window,
    })),
  };
}

// Appends, unless this exact chain slice is already in the log. Two runs that
// read the same blocks are one observation, and the report already refuses to
// count overlaps twice — but an identical entry is not even a second reading,
// it is the same reading written down again.
export function appendWindow(log, entry) {
  const dup = log.windows.some((x) => x.from_block === entry.from_block && x.to_block === entry.to_block);
  if (dup) return { log, added: false };
  const windows = log.windows.concat(entry);
  if (windows.length > MAX_WINDOWS) windows.splice(0, windows.length - MAX_WINDOWS);
  return { log: { ...log, windows }, added: true };
}

// Merges two logs of the SAME pool by chain slice. Used by --sync: the local
// file may hold windows the worker never saw (recorded by hand before the cron
// existed) and the worker holds windows nobody was awake for. Refuses across
// pools — averaging two pools into one history would average away the thing
// being measured.
export function mergeLogs(a, b) {
  if (a.pool && b.pool && a.pool.toLowerCase() !== b.pool.toLowerCase()) {
    throw new Error(`records are about different pools: ${a.pool} and ${b.pool}`);
  }
  const seen = new Set();
  const windows = [];
  for (const w of a.windows.concat(b.windows)) {
    const k = `${w.from_block}-${w.to_block}`;
    if (seen.has(k)) continue;
    seen.add(k);
    windows.push(w);
  }
  windows.sort((x, y) => x.from_block - y.from_block);
  return { pool: a.pool || b.pool, usd: a.usd || b.usd, windows };
}

// WHAT THE RECORD SAYS. This is the decision's input, so its rules are
// spelled out here and pinned by scripts/lp-windows.mjs --self-test:
//   - overlapping windows count once (the earliest survives),
//   - fewer than two non-overlapping windows is "thin" and decides nothing,
//   - a width that ever went negative is not a candidate, whatever its average,
//   - a width that ever failed to hold is not a candidate,
//   - among the rest, the one with the most net collected wins,
//   - full range is reported but never picked; it is the floor, not a choice.
//   - the width a re-set USES is the earnings pick: the most net per day when
//     every width is replayed over the recorded prices with the agent's own
//     re-set delay and cost (see earningsTest); nothing until a day of prices.
// THE WIDTHS BETWEEN THE REPLAYED ONES. For each derived width the row is
// read off its wider replayed neighbour (fees by the liquidity law,
// widthShare — until 2026-09-18 by neighbour/width, 2% too much at ±7%), and whether it held, how often it crossed and what it
// netted off its narrower neighbour — a width that held at ±2% held at ±3%,
// and a width that crossed at ±2% crossed at most as often at ±3%, so the
// derived row is never rosier than the record allows. A window that lacks
// either neighbour gets no derived row for that width. Pure; pinned.
// WHAT A RANGE EARNS WHILE THE PRICE IS IN IT (2026-09-18). A centred ±w range
// holds, per dollar, liquidity in proportion to 1 / (1 − 1/√(1+w)) — the V3
// identity, not a fit: the record's own rows follow it to the digit (±5% to
// ±10%: 0.009614 / 0.004979 = 1.931; the law says 1.931, "1/w" says 2). Two
// ranges the price is inside see the same swaps, so their fees stand in that
// proportion exactly. widthShare(W, w) is what a ±w range earns for every
// dollar a ±W range earns while both hold the price. Pure; pinned.
const liqPerUsd = (w) => 1 / (1 - 1 / Math.sqrt(1 + Number(w) / 100));
export const widthShare = (fromWidth, toWidth) => liqPerUsd(toWidth) / liqPerUsd(fromWidth);
// A window's row counts the fees of a range centred on the window's first
// price, in hindsight, and only the swaps made while that range held the
// price (in_range_pct). The earnings test follows its OWN range and asks
// whether the price is inside it — so a narrow width was marked down twice
// for the time it spends outside: once in the row, once by the test (±0.25%
// read 40% too little over a week, ±0.5% 7%). The rate the test needs is
// what the width earns per hour WHILE INSIDE: read off the narrowest
// replayed row of the window that held the price throughout, by the law
// above. A window where no row held (a move past ±10% inside the hour)
// keeps the row's own figure. Pure; pinned.
export function inRangeFeeRate(window, widthPct) {
  const rows = Array.isArray(window?.rows) ? window.rows : [];
  const hours = (window?.minutes || 37.5) / 60;
  const held = rows.filter((r) => typeof r.width === 'number' && !r.derived && typeof r.fees === 'number' && Number(r.in_range_pct) >= 100).sort((a, b) => a.width - b.width)[0];
  if (held) return (held.fees * widthShare(held.width, widthPct)) / hours;
  const own = rows.find((r) => r.width === widthPct);
  return own && typeof own.fees === 'number' ? own.fees / hours : 0;
}
export function deriveWidths(window, derived = DERIVED_WIDTHS) {
  const rows = Array.isArray(window?.rows) ? window.rows : [];
  const numeric = rows.filter((r) => isFinite(Number(r.width))).map((r) => ({ ...r, width: Number(r.width) }));
  const out = rows.slice();
  for (const w of derived) {
    if (numeric.some((r) => r.width === w)) continue;
    const wider = numeric.filter((r) => r.width > w).sort((a, b) => a.width - b.width)[0];
    const narrower = numeric.filter((r) => r.width < w).sort((a, b) => b.width - a.width)[0];
    if (!wider || !narrower || typeof wider.fees !== 'number') continue;
    const fees = wider.fees * widthShare(wider.width, w);
    out.push({
      width: w, derived: true, derived_from: [narrower.width, wider.width],
      held: !!narrower.held, in_range_pct: narrower.in_range_pct, crossings: narrower.crossings,
      fees: Number(fees.toFixed(6)),
      net: Number((fees - (Number(narrower.fees) - Number(narrower.net))).toFixed(6)),
    });
  }
  return { ...window, rows: out };
}

export function verdict(log, opts = {}) {
  const poolOf = String(log?.pool || '').toLowerCase();
  const tape = (Array.isArray(opts.tape) ? opts.tape : []).filter((x) => x && (!x.pool || !poolOf || String(x.pool).toLowerCase() === poolOf));
  opts = { ...opts, tape };
  const sorted = (log?.windows || []).slice().sort((a, b) => a.from_block - b.from_block).map((w) => deriveWidths(w));
  const used = [];
  for (const w of sorted) {
    const last = used[used.length - 1];
    if (!last || w.from_block > last.to_block) used.push(w);
  }
  const skipped = sorted.length - used.length;
  const widths = [...new Set(used.flatMap((w) => w.rows.map((r) => r.width)))]
    .sort((a, b) => (a === 'full' ? 1e9 : a) - (b === 'full' ? 1e9 : b));
  const rows = widths.map((w) => {
    const rs = used.map((x) => x.rows.find((r) => r.width === w)).filter(Boolean);
    return {
      width: w,
      derived: rs.length > 0 && rs.every((r) => r.derived === true),
      derived_from: rs.find((r) => r.derived)?.derived_from || null,
      of: rs.length,
      held: rs.filter((r) => r.held).length,
      heldEvery: rs.length > 0 && rs.every((r) => r.held),
      everNegative: rs.some((r) => r.net < 0),
      crossings: rs.reduce((s, r) => s + r.crossings, 0),
      fees: rs.reduce((s, r) => s + r.fees, 0),
      net: rs.reduce((s, r) => s + r.net, 0),
    };
  });
  const thin = used.length < 2;
  const safe = rows.filter((r) => r.width !== 'full' && r.heldEvery && !r.everNegative && r.net > 0);
  safe.sort((a, b) => b.net - a.net);
  // THE DAY TEST. A width that held every hourly window is the narrowest
  // width that held for an hour; a position nobody watches is left alone
  // for a day. So each priced window is treated as a hypothetical mint and
  // asked whether the price stayed inside +/-width for the 24 hours after it.
  // Only windows with at least twenty hours of later record count as tested;
  // a width is a day-pick when it held through EVERY tested day. Until the
  // record holds a day of prices this decides nothing, and says so.
  for (const r of rows) r.day = r.width === 'full' ? null : dayHold(used, r.width);
  const dayHolders = safe.filter((r) => r.day && r.day.tested > 0 && r.day.held === r.day.tested);
  const priced = used.filter((w) => typeof w.price === 'number' && w.price > 0);
  const hoursOfPrices = priced.length >= 2 ? Math.round((Date.parse(priced[priced.length - 1].at) - Date.parse(priced[0].at)) / 36e5) : 0;
  // THE DELAY TEST. On 2026-09-08 CAKE rose 18% in five days, the ±1%
  // range was re-set twice before noon, and an hour after the second re-set
  // the price was back below the new range — the case the wait before a
  // re-set exists for, and the case it costs earning hours in. So every
  // width is replayed with a wait of 0, 1, 2 and 3 hours (more since), and the best net
  // per day for each wait is named. Reported only until 2026-09-09; since
  // then the re-set USES the wait that netted the most, behind the bar in
  // waitInUse (a week of prices, a tenth over the set wait) — the same way
  // the width has been measured rather than set since 2026-09-04.
  // Up to 12 h since 2026-09-12: with 0-3 h the net still rose at the last
  // step (0.002 / 0.002 / 0.12 / 0.21 a day), so the grid ended where the
  // curve had not. 18 and 24 h since 2026-09-13: 12 h was the edge again
  // and led for a day (0.30 a day on 229 h) — a grid's last step must never
  // be its answer, so the grid now reaches a full day, the wait a position
  // nobody watches would get.
  const DELAYS_H = [0, 1, 2, 3, 4, 6, 8, 12, 18, 24];
  const delayRows = thin || hoursOfPrices < MIN_HOURS_FOR_EARNINGS ? [] : DELAYS_H.map((h) => {
    const best = rows.filter((r) => r.width !== 'full')
      .map((r) => ({ width: r.width, e: earningsTest(used, r.width, { ...opts, resetAfterHours: h }) }))
      .filter((x) => x.e && x.e.net_usd_per_day > 0)
      .sort((a, b) => b.e.net_usd_per_day - a.e.net_usd_per_day)[0];
    return best
      ? { hours: h, width: best.width, net_usd_per_day: best.e.net_usd_per_day, resets: best.e.resets, fees_usd: best.e.fees_usd }
      : { hours: h, width: null, net_usd_per_day: null, resets: null, fees_usd: null };
  });
  const wait = waitInUse(delayRows, hoursOfPrices);
  const delays = delayRows.map((d) => ({ ...d, in_use: d.hours === wait.hours }));
  const delayPick = delays.filter((d) => d.net_usd_per_day != null).sort((a, b) => b.net_usd_per_day - a.net_usd_per_day)[0] || null;
  // THE EARNINGS TEST, with the wait in use. The day test names the width
  // that would not have needed a re-set; it says nothing about what a width
  // earns. A width that holds every day earns a tenth of one that needs a
  // re-set a week, and a position exists to earn. So each width is replayed
  // the way the agent lives it — with the wait it really uses before a
  // re-set — and the one with the most left after its re-sets is the pick.
  for (const r of rows) r.earnings = r.width === 'full' ? null : earningsTest(used, r.width, { ...opts, resetAfterHours: wait.hours });
  // THE LAST DAY ALONE (2026-09-11). A width that leads over the whole record
  // but not over the last day is a lead the market has already moved away
  // from; the width-upgrade rule asks for both (widthUpgrade). Replayed over
  // the windows of the last 24 h with the wait in use; null under two of them.
  const dayAgo = used.length ? Date.parse(used[used.length - 1].at) - 24 * 36e5 : 0;
  const lastDayWins = used.filter((w) => Date.parse(w.at) >= dayAgo);
  const dayTape = tape.filter((x) => Date.parse(x.at) >= dayAgo);
  for (const r of rows) r.earnings_24h = r.width === 'full' ? null : earningsTest(lastDayWins, r.width, { ...opts, tape: dayTape, resetAfterHours: wait.hours });
  // THE LAST WEEK (2026-09-16): the window the width is picked on —
  // WIDTH_WINDOW_HOURS of windows and tape, the wait in use, one-sided
  // re-sets. A fortnight ago is not this week's volatility; a day is a mood.
  const weekAgo = used.length ? Date.parse(used[used.length - 1].at) - WIDTH_WINDOW_HOURS * 36e5 : 0;
  const weekWins = used.filter((w) => Date.parse(w.at) >= weekAgo);
  const weekTape = tape.filter((x) => Date.parse(x.at) >= weekAgo);
  for (const r of rows) r.earnings_7d = r.width === 'full' ? null : earningsTest(weekWins, r.width, { ...opts, tape: weekTape, resetAfterHours: wait.hours });
  const earners = rows.filter((r) => r.earnings && r.earnings.net_usd_per_day > 0)
    .sort((a, b) => b.earnings.net_usd_per_day - a.earnings.net_usd_per_day);
  const widthPick = thin || hoursOfPrices < MIN_HOURS_FOR_EARNINGS ? null : pickWidth(rows);
  const first = used[0], last = used[used.length - 1];
  return {
    windows: used.length,
    overlapping_runs_not_counted: skipped,
    thin,
    from: first?.at || null,
    to: last?.at || null,
    from_block: first?.from_block ?? null,
    to_block: last?.to_block ?? null,
    rows,
    pick: thin ? null : (safe[0] || null),
    priced_windows: priced.length,
    hours_of_prices: hoursOfPrices,
    // The ten-minute tape beside the hourly heads (2026-09-11): how many
    // samples the replay walked and since when. None before the tape began.
    price_samples: tape.length,
    price_samples_since: tape.length ? tape[0].at : null,
    // Best net among the widths that held every tested day — reported, no
    // longer the width a re-set uses (it was, until 2026-09-04).
    day_pick: thin ? null : (dayHolders[0] || null),
    // The width a re-set uses (2026-09-16): the width that ended the most
    // ahead against holding over the last week, fees in, replayed with
    // one-sided re-sets (pickWidth); the plan re-reads it with the width in
    // use for the bar. The most-net width is still named beside it.
    earnings_pick: widthPick,
    net_pick: thin || hoursOfPrices < MIN_HOURS_FOR_EARNINGS ? null : (earners[0] ? { width: earners[0].width, earnings: earners[0].earnings } : null),
    width_window_hours: WIDTH_WINDOW_HOURS,
    delay_test: {
      in_use_hours: wait.hours,
      wait_basis: wait.basis,
      why: wait.why,
      delays,
      pick: delayPick,
      note: 'Every width replayed with each wait before a re-set; the best width per wait is named. The re-set uses the wait that netted the most once the record holds a week of prices and it beats the set wait by a tenth; under either bar the set wait stands.',
    },
    reset_cost: opts.resetCostUsd != null
      ? { usd: opts.resetCostUsd, basis: (opts.resetCostBasis || 'measured: the agent\'s last re-set, in today\'s dollars') + `; charged per $${POSITION_USD} of the position, the size every width is replayed at. Since 2026-09-16 a re-set trades nothing (one-sided), so it costs its gas and nothing is lost to the price at it` }
      : { usd: rows.find((r) => r.earnings)?.earnings?.reset_cost_usd ?? null, basis: 'assumed by the replay (median over the windows) — no re-set has been measured yet. Since 2026-09-16 a re-set trades nothing (one-sided), so it costs its gas and nothing is lost to the price at it' },
    earnings_rule: `each width replayed over the recorded prices: minted centred on the first price, earning that hour's fees inside the range and nothing outside, re-set once the price has been outside for ${wait.hours} h — the wait the agent uses (${wait.basis}). Since 2026-09-16 the re-set is one-sided, the way the agent does it: the new range sits beside the price on the side it came from, takes the one token the old range ended in and trades nothing, so it is charged its gas alone. Net per day is fees less re-sets. The width a re-set uses is the one that ended the most ahead against holding over the last ${WIDTH_WINDOW_HOURS} h in that replay, fees included (fees_usd + vs_holding_usd: what the liquidity earned plus where it ended against a wallet that held the minted amounts — the line the card judges the agent by); a width in use is kept unless another leads it by a tenth of its own score and at least two cents on $50 a week; nothing until ${MIN_HOURS_FOR_EARNINGS} h of prices are on record.`,
  };
}

// The re-set cost the earnings test charges: what the agent's last real
// re-set cost in gas, in today's dollars, once the record has one; the
// replay's assumption until then. `agentRecord` is the lp:agent record the
// worker writes (history entries carry the rebalance step with gas_bnb).
// The swap fee a re-set paid. Records since 2026-09-09 carry it measured
// (steps.rebalance.swap); older ones name the trade, and the fee is worked
// out from it — a buy names its WBNB, a sell is taken as half the position
// (what a re-centre moves). A re-set with no trade on record paid none.
export function resetSwapFee(rb) {
  if (rb?.swap && Number(rb.swap.fee_bnb) >= 0) return { bnb: Number(rb.swap.fee_bnb), basis: 'measured' };
  const trade = String(rb?.trade || '');
  const buy = /with ([\d.]+) WBNB/.exec(trade);
  if (buy) return { bnb: Number((Number(buy[1]) * V2_SWAP_FEE_PCT / 100).toFixed(8)), basis: `estimated from the trade (${buy[1]} WBNB through the ${V2_SWAP_FEE_PCT}% pool)` };
  if (/^sell /.test(trade) && Number(rb.value_bnb) > 0) return { bnb: Number((Number(rb.value_bnb) / 2 * V2_SWAP_FEE_PCT / 100).toFixed(8)), basis: `estimated as half the position through the ${V2_SWAP_FEE_PCT}% pool` };
  return { bnb: 0, basis: 'no trade on record' };
}

// What the agent's last clean re-set cost: its gas plus the fee of its
// re-centring trade, in today's dollars. Gas alone was the figure until
// 2026-09-09, and it was half the truth.
export function measuredResetCost(agentRecord, bnbUsd) {
  const hist = Array.isArray(agentRecord?.history) ? agentRecord.history : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const rb = hist[i]?.steps?.rebalance;
    if (rb && rb.acted && !rb.error && Number(rb.gas_bnb) > 0 && Number(bnbUsd) > 0) {
      const fee = resetSwapFee(rb);
      // The trade's price impact, measured by the swap itself since
      // 2026-09-11 (swap.impact_bnb); older re-sets carry none and are
      // charged none — the record says which.
      const impact = rb.swap && Number(rb.swap.impact_bnb) >= 0 ? Number(rb.swap.impact_bnb) : null;
      const bnb = Number(rb.gas_bnb) + fee.bnb + (impact || 0);
      // The same cost per $50 of the position it was paid on: the replay
      // sizes every width at $50 (POSITION_USD), and until 2026-09-12 it
      // charged each replayed re-set the whole $0.16 a $424 position had
      // paid — eight times too much, which tilted the pick to wide ranges.
      const positionUsd = Number(rb.value_bnb) > 0 ? Number(rb.value_bnb) * Number(bnbUsd) : null;
      const per50 = positionUsd ? bnb * Number(bnbUsd) * POSITION_USD / positionUsd : null;
      return {
        usd: Math.round(bnb * Number(bnbUsd) * 100) / 100, bnb: Number(bnb.toFixed(8)),
        usd_per_50: per50 == null ? null : Math.round(per50 * 10000) / 10000,
        position_usd_at_reset: positionUsd == null ? null : Math.round(positionUsd * 100) / 100,
        gas_bnb: Number(rb.gas_bnb), swap_fee_bnb: fee.bnb, swap_basis: fee.basis,
        impact_bnb: impact, impact_basis: impact == null ? 'not measured by this re-set (before 2026-09-11)' : 'measured by the swap against the pool\'s mid price',
        at: hist[i].at, transactions: Array.isArray(rb.txs) ? rb.txs.length : null,
      };
    }
  }
  return null;
}

// WHAT EACH RE-SET COST, from the record's own ticks. A re-set's range was
// minted centred on a price (the middle of its ticks) and left at another
// (the tick the re-set saw); rangeValue says exactly what that range then
// held against the amounts it was minted with — the loss against holding,
// realised the moment the re-set trades. Beside it the execution: gas, the
// swap fee and, since 2026-09-11, the measured impact. Nothing here is a
// replay; every number comes from a re-set that happened. Newest first.
export function resetLosses(agentRecord, { bnbUsd = null } = {}) {
  const hist = Array.isArray(agentRecord?.history) ? agentRecord.history : [];
  const out = [];
  // Counted by the one definition (isReset, lp-flow); valued where the record
  // names the range that was left and the tick it was left at. A re-set
  // finished from the wallet after a failed run has no old range to value.
  let counted = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i]?.dry) continue;
    const rb = hist[i]?.steps?.rebalance;
    if (!isReset(rb)) continue;
    counted += 1;
    if (!Array.isArray(rb.ticks) || rb.ticks.length !== 2 || rb.tick == null) continue;
    const width = widthClassOf(rb.ticks);
    if (width == null) continue;
    const centre = (rb.ticks[0] + rb.ticks[1]) / 2;
    const pMint = Math.pow(1.0001, centre), pNow = Math.pow(1.0001, Number(rb.tick));
    // A one-sided re-set (2026-09-16) trades nothing: the token the old range
    // ended in goes into the new range as it is, and nothing is realised.
    const loss = rb.one_sided ? 0 : rangeValue(pMint, width, pNow).loss;
    const base = Number(rb.value_bnb || 0) + Number(rb.fees_folded_bnb || 0);
    const fee = resetSwapFee(rb);
    const impact = rb.swap && Number(rb.swap.impact_bnb) >= 0 ? Number(rb.swap.impact_bnb) : null;
    const execution = Number(rb.gas_bnb || 0) + fee.bnb + (impact || 0);
    out.push({
      at: hist[i].at, from_width_pct: width, to_width_pct: rb.width_pct ?? null,
      price_move_pct: Number(((pNow / pMint - 1) * 100).toFixed(2)),
      position_bnb: Number(base.toFixed(6)),
      lost_to_price_bnb: Number((loss * base).toFixed(6)), lost_to_price_pct: Number((loss * 100).toFixed(3)),
      execution_bnb: Number(execution.toFixed(6)), gas_bnb: Number(rb.gas_bnb || 0), swap_fee_bnb: fee.bnb, impact_bnb: impact,
      forced_by_deposit: !!rb.forced_by_deposit, one_sided: rb.one_sided || null,
      ...(bnbUsd > 0 ? { lost_to_price_usd: Math.round(loss * base * bnbUsd * 100) / 100, execution_usd: Math.round(execution * bnbUsd * 100) / 100 } : {}),
    });
  }
  const sum = (k) => Number(out.reduce((a, r) => a + (r[k] || 0), 0).toFixed(6));
  return {
    resets: counted, valued: out.length,
    lost_to_price_bnb: sum('lost_to_price_bnb'), execution_bnb: sum('execution_bnb'),
    impact_measured: out.filter((r) => r.impact_bnb != null).length,
    rows: out,
    basis: 'each re-set: the range it left, minted at the middle of its ticks, valued at the tick the re-set saw against the amounts it was minted with (rangeValue) — the loss against holding, realised by the re-set\'s trade; a one-sided re-set (since 2026-09-16) trades nothing and realises nothing; execution is gas, swap fee and the measured impact',
  };
}

// rangeValue — what a range is worth at another price against holding —
// lives in shared/lp-guards.js since 2026-09-11 (the width-upgrade rule
// needs it too) and is re-exported here for the record and its pins.
export { rangeValue };

// One width, lived through the record. `used` is the non-overlapping window
// list in block order; only windows that carry a price take part. A window
// earns for the hour it stands for (its fee row scaled from its own minutes
// to the time until the next window), never for a gap in the record. The
// re-set cost is the replay's own assumed cost, median over the windows,
// unless the caller passes a measured one.
//
// A RE-SET IS CHARGED WHAT IT LOSES AGAINST HOLDING. Until 2026-09-11 a
// re-set cost its gas and its swap fee, $0.16, and +/-1% was the pick. That
// night the agent re-set twice on CAKE/BNB: out below the range at 16:50 it
// sold CAKE at the low, out above the next range at 02:50 it bought CAKE
// back 1.5% higher, and with the price back where it had started the
// position was 3.5% lighter, $15 on $424, against $1.90 of fees. The gas
// was never the cost. The cost is that a range sells the side that is
// rising and holds the side that is falling, and a re-set makes that
// permanent. So every re-set in the replay is charged what the range it
// leaves had lost against simply holding its minted amounts (rangeValue),
// and the range still open at the end is marked the same way at the last
// price. Net is what is left after the fees paid for all of it.
const MAX_GAP_HOURS = 3;
const r2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 10000) / 10000;
// What one unit of liquidity holds of each side at price p in [lo, hi]:
// token0 (the priced side) and token1 (the quote), the pool's own curve.
const perL = (p, lo, hi) => ({
  x: p >= hi ? 0 : 1 / Math.sqrt(Math.max(p, lo)) - 1 / Math.sqrt(hi),
  y: p <= lo ? 0 : Math.sqrt(Math.min(p, hi)) - Math.sqrt(lo),
});
// THE ONE-SIDED REPLAY (2026-09-16). The agent re-sets one-sided: the new
// range sits beside the price on the side the price came from, spans what
// a centred ±width range spans, starts ONE_SIDED_GAP_TICKS beyond the
// price, and takes the one token the old range ended in — nothing is
// traded. So the replay does the same: a re-set costs its gas (the
// measured cost, swap fee zero) and nothing is "lost to the price" at it,
// because nothing is sold. What the position holds is followed exactly
// (perL) from the centred mint through every re-set, and at the end it is
// valued against holding the minted amounts: vs_holding_usd, the honest
// line — an LP behind holding in a trend, ahead of it when the price comes
// back through its ranges. It is reported, not charged: the width is
// picked by how much of the time it earns (pickWidth), the wait by net.
// oneSided false is the replay as it was until 2026-09-16 (centred re-sets
// charged their realised loss), kept for the pins and the older records.
export function earningsTest(used, widthPct, { resetAfterHours = RESET_AFTER_HOURS, resetCostUsd = null, usd = POSITION_USD, tape = null, oneSided = true, resetAfterHoursAbove = null } = {}) {
  const priced = used.filter((w) => typeof w.price === 'number' && w.price > 0 && (w.rows || []).some((r) => r.width === widthPct));
  if (priced.length < 2) return null;
  const costs = priced.map((w) => w.rebalance_cost_usd).filter((c) => typeof c === 'number' && c > 0).sort((a, b) => a - b);
  const cost = resetCostUsd ?? (costs.length ? costs[Math.floor(costs.length / 2)] : 0.5);
  const up = 1 + widthPct / 100, down = 1 / up, gap = Math.pow(1.0001, ONE_SIDED_GAP_TICKS);
  // The agent's own notion of "left" (rangeLeft): a price within the slack
  // of an edge has not left, and the wait does not run there. A one-sided
  // range sits the gap beyond the price by construction; without the slack
  // the replay would re-set it every hour for gas, which the agent does not.
  const slack = oneSided ? Math.pow(1.0001, RANGE_LEFT_TICKS) : 1;
  const series = priceSeries(priced, tape);
  const p0 = series[0].price;
  let centre = p0, lo = p0 * down, hi = p0 * up;
  // The position followed exactly: L units of liquidity in [lo, hi], and the
  // amounts it was minted with, for the holding line.
  const m0 = perL(p0, lo, hi);
  let L = usd / (m0.x * p0 + m0.y);
  const x0 = L * m0.x, y0 = L * m0.y;
  let outRun = 0, fees = 0, resets = 0, hoursIn = 0, hoursOut = 0, lost = 0, samples = 0;
  for (let i = 1; i < series.length; i++) {
    const pt = series[i], prev = series[i - 1];
    const dtH = Math.min(MAX_GAP_HOURS, (pt.t - prev.t) / 36e5);
    if (!(dtH > 0)) continue;
    if (pt.window.at !== pt.at) samples += 1;
    const p = pt.price;
    if (p <= hi && p >= lo) {
      fees += inRangeFeeRate(pt.window, widthPct) * dtH;
      hoursIn += dtH; outRun = 0;
    } else {
      hoursOut += dtH;
      if (p < lo / slack || p > hi * slack) outRun += dtH; else outRun = 0;
      // resetAfterHoursAbove (a measurement option, 2026-09-17): a wait of its
      // own for a price that left above the range (the position all WBNB).
      if (outRun >= (p > hi && resetAfterHoursAbove != null ? resetAfterHoursAbove : resetAfterHours) && (p < lo / slack || p > hi * slack)) {
        resets += 1;
        const held = perL(p, lo, hi);
        const x = L * held.x, y = L * held.y;
        if (oneSided) {
          // Below the range all token0: a range above the price, all token0.
          // Above it all token1: a range below the price, all token1.
          if (p < lo) { lo = p * gap; hi = lo * up * up; } else { hi = p / gap; lo = hi * down * down; }
          const n = perL(p, lo, hi);
          L = p < lo ? x / n.x : y / n.y;
        } else {
          lost += rangeValue(centre, widthPct, p).loss * usd;
          centre = p; lo = p * down; hi = p * up;
          const n = perL(p, lo, hi);
          L = (x * p + y) / (n.x * p + n.y);
        }
        outRun = 0;
      }
    }
  }
  const pEnd = series[series.length - 1].price;
  const open = oneSided ? 0 : rangeValue(centre, widthPct, pEnd).loss * usd;
  const end = perL(pEnd, lo, hi);
  const valueEnd = L * (end.x * pEnd + end.y), holdEnd = x0 * pEnd + y0;
  const hours = hoursIn + hoursOut, net = fees - resets * cost - lost - open;
  return {
    hours: r2(hours), hours_in_range: r2(hoursIn), in_range_share: hours > 0 ? Math.round((hoursIn / hours) * 1000) / 1000 : null, fees_usd: r4(fees),
    resets, reset_cost_usd: r4(cost), one_sided: !!oneSided,
    lost_to_price_usd: r4(lost), open_loss_usd: r4(open),
    // The position at the end against holding what it was minted with, fees
    // beside it: what the liquidity itself did to the money.
    vs_holding_usd: r4(valueEnd - holdEnd),
    net_usd: r4(net),
    net_usd_per_day: hours > 0 ? r4(net / (hours / 24)) : null,
    price_points: series.length, tape_samples: samples,
  };
}

// THE CALIBRATION. The replay says what $50 in a width would have collected
// from the pool's fees; the agent's own position says what it did collect.
// On 2026-09-10 the position at the 2% class had earned about three
// quarters of what the replay put on that width — the replay overstates
// every width alike, so the pick stands, but the dollar figure on the record
// should say so. `points` is the liquidity series (fees_total_bnb, owed_bnb,
// value_bnb, at), `rows` the verdict's rows, `widthClass` the position's
// width class. Gross fees on both sides: the measured window may hold
// re-sets, whose cost is not a fee. Null under a day of series.
export function calibration(points, rows, widthClass, { minHours = 20, maxHours = 72 } = {}) {
  const pts = (points || []).filter((p) => p && p.at && typeof p.value_bnb === 'number' && p.value_bnb > 0 && p.fees_total_bnb != null);
  if (pts.length < 2 || widthClass == null) return null;
  const last = pts[pts.length - 1];
  const cutoff = Date.parse(last.at) - maxHours * 36e5;
  const used = pts.filter((p) => Date.parse(p.at) >= cutoff);
  if (used.length < 2) return null;
  const first = used[0];
  const hours = (Date.parse(last.at) - Date.parse(first.at)) / 36e5;
  if (!(hours >= minHours)) return null;
  const feesBnb = (Number(last.fees_total_bnb) + Number(last.owed_bnb || 0)) - (Number(first.fees_total_bnb) + Number(first.owed_bnb || 0));
  // Capital, time-weighted over the points, minus what the operator put in
  // with each point (a deposit is not fees' doing).
  let capBnbH = 0;
  for (let i = 1; i < used.length; i++) capBnbH += used[i - 1].value_bnb * ((Date.parse(used[i].at) - Date.parse(used[i - 1].at)) / 36e5);
  const capitalBnb = capBnbH / hours;
  if (!(capitalBnb > 0) || !(feesBnb >= 0)) return null;
  // Fees over capital is a rate; on $50 a day it is dollars, whatever BNB costs.
  const measured = (feesBnb / capitalBnb) * 50 * (24 / hours);
  const row = (rows || []).find((r) => r.width === widthClass && r.earnings && r.earnings.hours > 0);
  const replay = row ? row.earnings.fees_usd / (row.earnings.hours / 24) : null;
  const factor = replay > 0 ? measured / replay : null;
  return {
    hours: r2(hours), from: first.at, to: last.at,
    position_width_pct: widthClass,
    fees_bnb: Number(feesBnb.toFixed(6)),
    capital_bnb: Number(capitalBnb.toFixed(6)),
    measured_usd_per_day_on_50: r4(measured),
    replay_usd_per_day_on_50: replay == null ? null : r4(replay),
    factor: factor == null ? null : r2(factor),
    basis: `the position's own fees over ${r2(hours)} h against the replay's gross fees for the ±${widthClass}% width, both on $50 a day; the pick compares widths with each other and is not scaled`,
  };
}

const DAY_MS = 24 * 3600 * 1000;
const MIN_LATER_MS = 20 * 3600 * 1000;
function dayHold(used, widthPct) {
  const priced = used.filter((w) => typeof w.price === 'number' && w.price > 0);
  const up = 1 + widthPct / 100, down = 1 / up;
  let tested = 0, held = 0;
  for (let i = 0; i < priced.length; i++) {
    const t0 = Date.parse(priced[i].at), p0 = priced[i].price;
    const later = priced.slice(i + 1).filter((w) => Date.parse(w.at) - t0 <= DAY_MS);
    if (!later.length || Date.parse(later[later.length - 1].at) - t0 < MIN_LATER_MS) continue;
    tested += 1;
    if (later.every((w) => w.price / p0 <= up && w.price / p0 >= down)) held += 1;
  }
  return { tested, held };
}

// A failed hour is written down. The cron swallowed its errors, and between
// 06:30 and 14:00 UTC on 2026-09-02 four of eight hourly windows were simply
// missing, with nothing anywhere to say why.
export async function noteLpWindowError(env, e) {
  const prev = (await readLpWindows(env)) || { pool: await watchedPool(env), usd: POSITION_USD, windows: [] };
  prev.last_error = { at: new Date().toISOString(), error: String(e?.message || e).slice(0, 200) };
  prev.errors = (prev.errors || 0) + 1;
  await env.AGENT.put(KV_KEY, JSON.stringify(prev));
}

export async function measure(address, usd) {
  const r = await fetch(MEASURE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'pancakeswap_range_plan', arguments: { address, capitalUsd: usd } },
    }),
    signal: AbortSignal.timeout(45000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'the range could not be replayed');
  const text = j.result?.content?.[0]?.text;
  if (!text) throw new Error('the replay returned nothing readable');
  // A tool that could not answer says why in plain words with isError set.
  // Parsed as JSON, "every BSC endpoint refused …" became "Unexpected token
  // 'e'" — which CHAIN_REFUSED below does not match, so the one refusal the
  // retry exists for was never retried and the hour's window went missing
  // (2026-09-20; the same line in grid.js, lp-tiers.js and rebalance.js).
  if (j.result?.isError) throw new Error(String(text).slice(0, 300));
  const plan = JSON.parse(text);
  if (plan.error) throw new Error(plan.error);
  if (!plan.measured_window || !Array.isArray(plan.ranges)) throw new Error('the replay came back without a window');
  return plan;
}

// The pool the agent is in: what its own record says (worker-lp writes the
// position's pool with every run since 2026-09-10, so a relocate is followed
// the hour after), else the var the first weeks used.
export async function watchedPool(env) {
  try {
    const rec = JSON.parse((await env.AGENT.get('lp:agent')) || 'null');
    const p = String(rec?.pool || '').toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(p)) return p;
  } catch { /* the var stands */ }
  return String(env.LP_WATCH_POOL || '').toLowerCase();
}

// THE VERDICT THE AGENT ACTS ON, FOR EVERY READER (2026-09-18). The replay
// charged with the agent's own measured re-set cost (per $50) and walked over
// the ten-minute price tape. /lp/windows and the portfolio used it; the paid
// position plan called verdict(log) bare — an assumed cost ~280 times the
// measured one and hourly prices only — and printed another week table and
// another wait than the agent's own record while saying "the same record and
// rule". One loader; `bnbUsd` is the caller's BNB price (null: the replay's
// own cost assumption stands).
export async function widthVerdict(env, bnbUsd = null) {
  const log = await readLpWindows(env);
  if (!log) return { log: null, v: null };
  let costOpts = {};
  try {
    const rec = JSON.parse((await env.AGENT.get('lp:agent')) || 'null');
    const m = measuredResetCost(rec, bnbUsd);
    // The replay is charged the cost per $50 of the position (usd_per_50);
    // the full figure is what a real re-set pays (the width-upgrade rule).
    if (m) costOpts = { resetCostUsd: m.usd_per_50 ?? m.usd, resetCostBasis: `measured: the re-set of ${m.at.slice(0, 16).replace('T', ' ')} UTC cost $${m.usd} on a $${m.position_usd_at_reset ?? '?'} position — ${m.gas_bnb} BNB of gas in ${m.transactions ?? '?'} transactions and ${m.swap_fee_bnb} BNB of swap fee (${m.swap_basis})` };
  } catch { /* the replay's assumption stands */ }
  return { log, v: verdict(log, { ...costOpts, tape: await readLpTicks(env) }) };
}
export async function readLpWindows(env) {
  const raw = await env.AGENT.get(KV_KEY);
  return raw ? JSON.parse(raw) : null;
}

// The hourly tick. One measurement, one KV read, one KV write.
// WHY THE TICK WAITS BEFORE IT MEASURES, AND ASKS TWICE.
// On 2026-09-02 four of eight hourly windows were missing and the record
// said why: "every BSC endpoint refused eth_blockNumber". The window tick
// rides the same cron invocation as the telemetry refresh and the watch
// checks, so all three hit the same public nodes from the same egress in the
// same second — we throttled ourselves, the lesson the census already taught.
// So the replay starts after the burst has passed, and a refusal gets one
// more try a little later. The entry says how many asks it took.
// "The log endpoint refused this range" (2026-09-08 08:31) is the same class
// of refusal and used to fall through to the error note without a retry.
const CHAIN_REFUSED = /every BSC endpoint refused|log endpoint refused|rate limit|capacity|too many|quota|429|timed out|timeout|aborted|network|fetch failed/i;
const SETTLE_MS = 25000, RETRY_MS = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function recordLpWindow(env, { settle = true } = {}) {
  const pool = await watchedPool(env);
  if (!/^0x[0-9a-f]{40}$/.test(pool)) return { ok: false, error: 'no watched pool: the agent record names none and LP_WATCH_POOL is not set' };
  if (settle) await sleep(SETTLE_MS);
  let plan, attempts = 1;
  try { plan = await measure(pool, POSITION_USD); }
  catch (e) {
    if (!CHAIN_REFUSED.test(String(e.message))) throw e;
    attempts = 2;
    await sleep(RETRY_MS);
    plan = await measure(pool, POSITION_USD);
  }
  const prev = (await readLpWindows(env)) || { pool, usd: POSITION_USD, windows: [] };
  if (prev.pool && prev.pool.toLowerCase() !== plan.pool.toLowerCase()) {
    // The var changed pools. Start over rather than mix — the old record is
    // in the local file of whoever synced it, and a mixed one is worth nothing.
    prev.pool = plan.pool; prev.windows = [];
  }
  const entry = windowFromPlan(plan, POSITION_USD);
  if (attempts > 1) entry.attempts = attempts;
  const { log, added } = appendWindow({ ...prev, pool: plan.pool, usd: POSITION_USD }, entry);
  if (added) await env.AGENT.put(KV_KEY, JSON.stringify(log));
  return { ok: true, added, attempts, windows: log.windows.length, from_block: entry.from_block, to_block: entry.to_block };
}
