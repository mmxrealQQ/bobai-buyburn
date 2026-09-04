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

import { RESET_AFTER_HOURS, MIN_HOURS_FOR_EARNINGS } from '../shared/lp-guards.js';

const MEASURE = 'https://brainonbnb.com/mcp';
export const KV_KEY = 'lp:windows';
// Hourly windows of ~37 minutes never overlap, so the count is honest by
// construction; the cap only keeps the KV value from growing without bound.
// 400 hourly windows is over two weeks, which is more than the decision needs.
export const MAX_WINDOWS = 400;
export const POSITION_USD = 50;

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
    // question a 37-minute replay cannot: would this width have held for a
    // DAY. The position went out of a +/-0.5% range within five hours of a
    // record in which that width had held every window.
    price: typeof plan.price_now === 'number' ? plan.price_now : null,
    pool_fees_usd: w.fees_the_pool_paid_usd,
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
export function verdict(log, opts = {}) {
  const sorted = (log?.windows || []).slice().sort((a, b) => a.from_block - b.from_block);
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
  // THE DAY TEST. A width that held every 37-minute window is the narrowest
  // width that held for 37 minutes; a position nobody watches is left alone
  // for a day. So each priced window is treated as a hypothetical mint and
  // asked whether the price stayed inside +/-width for the 24 hours after it.
  // Only windows with at least twenty hours of later record count as tested;
  // a width is a day-pick when it held through EVERY tested day. Until the
  // record holds a day of prices this decides nothing, and says so.
  for (const r of rows) r.day = r.width === 'full' ? null : dayHold(used, r.width);
  const dayHolders = safe.filter((r) => r.day && r.day.tested > 0 && r.day.held === r.day.tested);
  const priced = used.filter((w) => typeof w.price === 'number' && w.price > 0);
  const hoursOfPrices = priced.length >= 2 ? Math.round((Date.parse(priced[priced.length - 1].at) - Date.parse(priced[0].at)) / 36e5) : 0;
  // THE EARNINGS TEST. The day test names the width that would not have
  // needed a re-set; it says nothing about what a width earns. A width that
  // holds every day earns a tenth of one that needs a re-set a week, and a
  // position exists to earn. So each width is replayed the way the agent
  // lives it, and the one with the most left after its re-sets is the pick.
  for (const r of rows) r.earnings = r.width === 'full' ? null : earningsTest(used, r.width, opts);
  const earners = rows.filter((r) => r.earnings && r.earnings.net_usd_per_day > 0)
    .sort((a, b) => b.earnings.net_usd_per_day - a.earnings.net_usd_per_day);
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
    // Best net among the widths that held every tested day — reported, no
    // longer the width a re-set uses (it was, until 2026-09-04).
    day_pick: thin ? null : (dayHolders[0] || null),
    // The width a re-set uses: the most net per day over the recorded prices.
    earnings_pick: thin || hoursOfPrices < MIN_HOURS_FOR_EARNINGS ? null : (earners[0] || null),
    reset_cost: opts.resetCostUsd != null
      ? { usd: opts.resetCostUsd, basis: opts.resetCostBasis || 'measured: the agent\'s last re-set, in today\'s dollars' }
      : { usd: rows.find((r) => r.earnings)?.earnings?.reset_cost_usd ?? null, basis: 'assumed by the replay (median over the windows) — no re-set has been measured yet' },
    earnings_rule: `each width replayed over the recorded prices: minted centred on the first price, earning that hour's fees inside the range and nothing outside, re-set (re-centred, at the replay's re-set cost) once the price has been outside for ${RESET_AFTER_HOURS} h — the agent's own delay. Net per day is what is left after the re-sets; the pick is the width with the most of it, once ${MIN_HOURS_FOR_EARNINGS} h of prices are on record.`,
  };
}

// The re-set cost the earnings test charges: what the agent's last real
// re-set cost in gas, in today's dollars, once the record has one; the
// replay's assumption until then. `agentRecord` is the lp:agent record the
// worker writes (history entries carry the rebalance step with gas_bnb).
export function measuredResetCost(agentRecord, bnbUsd) {
  const hist = Array.isArray(agentRecord?.history) ? agentRecord.history : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const rb = hist[i]?.steps?.rebalance;
    if (rb && rb.acted && !rb.error && Number(rb.gas_bnb) > 0 && Number(bnbUsd) > 0) {
      return { usd: Math.round(Number(rb.gas_bnb) * Number(bnbUsd) * 100) / 100, gas_bnb: Number(rb.gas_bnb), at: hist[i].at, transactions: Array.isArray(rb.txs) ? rb.txs.length : null };
    }
  }
  return null;
}

// One width, lived through the record. `used` is the non-overlapping window
// list in block order; only windows that carry a price take part. A window
// earns for the hour it stands for (its fee row scaled from its own minutes
// to the time until the next window), never for a gap in the record. The
// re-set cost is the replay's own assumed cost, median over the windows,
// unless the caller passes a measured one.
const MAX_GAP_HOURS = 3;
const r2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 10000) / 10000;
export function earningsTest(used, widthPct, { resetAfterHours = RESET_AFTER_HOURS, resetCostUsd = null } = {}) {
  const priced = used.filter((w) => typeof w.price === 'number' && w.price > 0 && (w.rows || []).some((r) => r.width === widthPct));
  if (priced.length < 2) return null;
  const costs = priced.map((w) => w.rebalance_cost_usd).filter((c) => typeof c === 'number' && c > 0).sort((a, b) => a - b);
  const cost = resetCostUsd ?? (costs.length ? costs[Math.floor(costs.length / 2)] : 0.5);
  const up = 1 + widthPct / 100, down = 1 / up;
  let centre = priced[0].price, outRun = 0, fees = 0, resets = 0, hoursIn = 0, hoursOut = 0;
  for (let i = 1; i < priced.length; i++) {
    const w = priced[i], prev = priced[i - 1];
    const dtH = Math.min(MAX_GAP_HOURS, (Date.parse(w.at) - Date.parse(prev.at)) / 36e5);
    if (!(dtH > 0)) continue;
    const ratio = w.price / centre;
    if (ratio <= up && ratio >= down) {
      const row = w.rows.find((r) => r.width === widthPct);
      fees += (row.fees / ((w.minutes || 37.5) / 60)) * dtH;
      hoursIn += dtH; outRun = 0;
    } else {
      hoursOut += dtH; outRun += dtH;
      if (outRun >= resetAfterHours) { resets += 1; centre = w.price; outRun = 0; }
    }
  }
  const hours = hoursIn + hoursOut, net = fees - resets * cost;
  return {
    hours: r2(hours), hours_in_range: r2(hoursIn), fees_usd: r4(fees),
    resets, reset_cost_usd: r2(cost), net_usd: r4(net),
    net_usd_per_day: hours > 0 ? r4(net / (hours / 24)) : null,
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
  const prev = (await readLpWindows(env)) || { pool: String(env.LP_WATCH_POOL || '').toLowerCase(), usd: POSITION_USD, windows: [] };
  prev.last_error = { at: new Date().toISOString(), error: String(e?.message || e).slice(0, 200) };
  prev.errors = (prev.errors || 0) + 1;
  await env.AGENT.put(KV_KEY, JSON.stringify(prev));
}

async function measure(address, usd) {
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
  const plan = JSON.parse(text);
  if (plan.error) throw new Error(plan.error);
  if (!plan.measured_window || !Array.isArray(plan.ranges)) throw new Error('the replay came back without a window');
  return plan;
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
const CHAIN_REFUSED = /every BSC endpoint refused|rate limit|capacity|too many|quota|429|timed out|timeout|aborted|network|fetch failed/i;
const SETTLE_MS = 25000, RETRY_MS = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function recordLpWindow(env, { settle = true } = {}) {
  const pool = String(env.LP_WATCH_POOL || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(pool)) return { ok: false, error: 'LP_WATCH_POOL is not set' };
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
