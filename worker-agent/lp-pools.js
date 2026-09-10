// THE POOL RECORD: what the same fifty dollars would have earned in each of
// the pools the DeFi agent could live in, hour by hour.
//
// The width record (lp-windows.js) answers "how wide" for the pool the agent
// is in. This answers the question that comes before it: "which pool". Until
// 2026-09-10 the candidates were three pools the operator named by hand
// (CAKE/BNB in two tiers, BOB/BNB). From 2026-09-10 the operator's rule is
// "always the best pool BNB Chain has on offer", so the candidates are the
// universe the rule allows: every PancakeSwap V3 pool on BSC that pairs
// WBNB with a major — a token whose price is set on many venues and cannot
// be pulled out from under a position overnight — in every fee tier that
// holds liquidity. The one-hour screen of 2026-09-10 11:45 UTC put the
// USDT/WBNB and USDC/WBNB 0.01% pools level with CAKE/WBNB 0.05% at ±1%,
// the BTCB and ETH pools far behind, and meme pools (BNC4/USDT 0.25%,
// SPCXB/WBNB) at four to five times the fees — those are out by the rule:
// the fee rate is the price of the risk that the other token goes to zero
// or that the whole pool's liquidity leaves with its deployer, and a
// position quoted in BNB cannot carry a token that is not quoted against
// anything. Pools without WBNB are out for the same reason from the other
// side: the record and the series are in BNB, and a USDT/BTCB position's
// value in BNB says nothing about the position. A sample is not a rate.
// This keeps the samples until they are one.
//
// It reads. It signs nothing, holds no key and moves nothing. The verdict
// names the best pool once every pool has a day of hours; switchVerdict()
// below says whether that finding is worth acting on (the margin, the
// payback, the lead holding over the last day). The agent's daily run acts
// on that rule once the relocate step is wired to it; until then the record
// says so in words.
//
// COST. Every candidate but the watched one is one replay per hour on our
// own MCP endpoint (the watched pool's window is copied from the width
// record, which measured it minutes earlier in the same tick). Twelve
// candidates is ~290 replays a day and one KV write an hour; the screen of
// 2026-09-10 measured 1.4-2.8 s per replay, the busiest pool (USDT/WBNB
// 0.01%, 16k swaps an hour) 2.8 s.
import { KV_KEY as WINDOWS_KEY, POSITION_USD, measure, windowFromPlan } from './lp-windows.js';

export const KV_KEY = 'lp:pools';
// Hourly windows; 200 is over a week per pool, which is more than a pool
// decision should rest on before somebody looks at it.
export const MAX_WINDOWS = 200;
// A day of hours before any pool is called better than another. Below this
// the record reports and refuses to pick — the same threshold the width
// record uses before it trusts its earnings test.
export const MIN_HOURS_TO_PICK = 24;

// The universe, by address: WBNB paired with a major, every fee tier with
// liquidity. The watched pool is whichever of these env.LP_WATCH_POOL points
// at; the others are measured beside it. BOB/BNB stays as the operator's
// own token pair (named 2026-09-07), measured, never favoured.
export const CANDIDATES = [
  { pool: '0xafb2da14056725e3ba3a30dd846b6bbbd7886c56', label: 'CAKE/BNB 0.05%', pair: 'CAKE/BNB', fee_pct: 0.05 },
  { pool: '0x1e213600fa9317feac4ef4087acdf5d0e25d7187', label: 'CAKE/BNB 0.01%', pair: 'CAKE/BNB', fee_pct: 0.01 },
  { pool: '0x172fcd41e0913e95784454622d1c3724f546f849', label: 'USDT/BNB 0.01%', pair: 'USDT/BNB', fee_pct: 0.01 },
  { pool: '0x36696169c63e42cd08ce11f5deebbcebae652050', label: 'USDT/BNB 0.05%', pair: 'USDT/BNB', fee_pct: 0.05 },
  { pool: '0xf2688fb5b81049dfb7703ada5e770543770612c4', label: 'USDC/BNB 0.01%', pair: 'USDC/BNB', fee_pct: 0.01 },
  { pool: '0x4a3218606af9b4728a9f187e1c1a8c07fbc172a9', label: 'USD1/BNB 0.05%', pair: 'USD1/BNB', fee_pct: 0.05 },
  { pool: '0x6bbc40579ad1bbd243895ca0acb086bb6300d636', label: 'BTCB/BNB 0.05%', pair: 'BTCB/BNB', fee_pct: 0.05 },
  { pool: '0x62edaf2a56c9fb55be5f9b1399ac067f6a37013b', label: 'BTCB/BNB 0.01%', pair: 'BTCB/BNB', fee_pct: 0.01 },
  { pool: '0xd0e226f674bbf064f54ab47f42473ff80db98cba', label: 'ETH/BNB 0.05%', pair: 'ETH/BNB', fee_pct: 0.05 },
  { pool: '0x62fcb3c1794fb95bd8b1a97f6ad5d8a7e4943a1e', label: 'ETH/BNB 0.01%', pair: 'ETH/BNB', fee_pct: 0.01 },
  { pool: '0xbffec96e8f3b5058b1817c14e4380758fada01ef', label: 'SOL/BNB 0.05%', pair: 'SOL/BNB', fee_pct: 0.05 },
  { pool: '0x910a64e36da4bec09a0772b11d437869ad07dc4b', label: 'BOB/BNB 0.05%', pair: 'BOB/BNB', fee_pct: 0.05 },
];
// The rule the universe is drawn by, in words the page can show.
export const UNIVERSE_RULE = 'PancakeSwap V3 pools on BNB Chain that pair WBNB with a major (CAKE, USDT, USDC, USD1, BTCB, ETH, SOL) plus the project\'s own BOB/BNB, in every fee tier holding liquidity. Meme pairs are out whatever they pay: the fee is the price of the other token going to zero. Pools without WBNB are out: the record is in BNB.';
const labelOf = (pool) => (CANDIDATES.find((c) => c.pool === String(pool).toLowerCase()) || {}).label || String(pool);

// One window, the shape the width record uses, trimmed to what a pool
// comparison reads: the fees each width earned in the window, whether it
// held, and how busy the pool was.
export function poolWindow(entry) {
  return {
    at: entry.at,
    from_block: entry.from_block,
    to_block: entry.to_block,
    minutes: entry.minutes,
    swaps: entry.swaps,
    price: entry.price,
    pool_fees_usd: entry.pool_fees_usd,
    rows: (entry.rows || []).map((r) => ({ width: r.width, fees: r.fees, held: r.held })),
  };
}

// Appends unless this exact chain slice is already there for that pool.
export function appendPoolWindow(log, pool, entry) {
  const key = String(pool).toLowerCase();
  const rec = log.pools[key] || { label: labelOf(key), windows: [] };
  if (rec.windows.some((x) => x.from_block === entry.from_block && x.to_block === entry.to_block)) return { log, added: false };
  const windows = rec.windows.concat(poolWindow(entry));
  if (windows.length > MAX_WINDOWS) windows.splice(0, windows.length - MAX_WINDOWS);
  return { log: { ...log, pools: { ...log.pools, [key]: { ...rec, label: labelOf(key), windows } } }, added: true };
}

// WHAT THE RECORD SAYS, per pool, at one width. Pure; pinned by
// scripts/lp-pools.mjs --self-test.
//   - each pool is read over its own recorded hours (windows carry their
//     minutes; a window earns for the minutes it covers, nothing more),
//   - fees are what the replay says $usd would have collected inside the
//     width, so a pool where $50 is a large share of the working capital is
//     already diluted by its own arithmetic,
//   - a pool is "quiet" for a window in which nobody swapped,
//   - nothing is picked until every pool has a day of hours; then the pool
//     with the most fees per day at this width is named, and the watched
//     pool is named beside it whether or not they are the same,
//   - the pick is a finding. The agent never acts on it by itself.
export function poolVerdict(log, widthPct, { watched = null, minHours = MIN_HOURS_TO_PICK } = {}) {
  const usd = log?.usd || POSITION_USD;
  const pools = Object.entries(log?.pools || {}).map(([pool, rec]) => {
    let fees = 0, hours = 0, swaps = 0, quiet = 0, held = 0, priced = 0, lastMinutes = null;
    for (const w of rec.windows || []) {
      const row = (w.rows || []).find((r) => r.width === widthPct);
      if (!row || typeof row.fees !== 'number') continue;
      const h = (w.minutes || 37.5) / 60;
      lastMinutes = w.minutes || 37.5;
      fees += row.fees; hours += h; priced += 1;
      swaps += Number(w.swaps || 0);
      if (!Number(w.swaps || 0)) quiet += 1;
      if (row.held) held += 1;
    }
    const r4 = (x) => Math.round(x * 10000) / 10000, r1 = (x) => Math.round(x * 10) / 10;
    return {
      pool,
      label: rec.label || labelOf(pool),
      watched: !!watched && pool === String(watched).toLowerCase(),
      windows: priced,
      hours: r1(hours),
      swaps,
      quiet_windows: quiet,
      held_pct: priced ? Math.round((held / priced) * 1000) / 10 : null,
      fees_usd: r4(fees),
      fees_usd_per_day: hours > 0 ? r4((fees / hours) * 24) : null,
      // What the newest window covers: the forecast of runs to go rests on it,
      // not on an average over windows of two sizes.
      minutes_per_window: lastMinutes,
      first: (rec.windows || [])[0]?.at || null,
      last: (rec.windows || []).slice(-1)[0]?.at || null,
    };
  }).sort((a, b) => (b.fees_usd_per_day ?? -1) - (a.fees_usd_per_day ?? -1));
  const enough = pools.length >= 2 && pools.every((p) => p.hours >= minHours);
  const pick = enough ? pools[0] : null;
  const watchedRow = pools.find((p) => p.watched) || null;
  // The hours are sampled chain, not clock time: an hourly window covers the
  // minutes it covers (37.5 until 2026-09-09, ~59 since), so a day of hours
  // took a day and a half of runs. On 2026-09-09 the record read "20 h" after 33 hours
  // and the operator took it for a delay. Each pool says how many more
  // hourly runs it needs, and the record names the hour the pick is due.
  const toGo = pools.map((p) => {
    if (!p.windows || p.hours >= minHours) return { ...p, runs_to_go: 0 };
    const perWindow = (p.minutes_per_window || 37.5) / 60;
    return { ...p, runs_to_go: Math.ceil((minHours - p.hours) / perWindow) };
  });
  const pending = toGo.filter((p) => p.runs_to_go > 0 && p.last);
  const pickDue = !enough && pending.length && pending.every((p) => Date.parse(p.last))
    ? new Date(Math.max(...pending.map((p) => Date.parse(p.last) + p.runs_to_go * 3600e3))).toISOString()
    : null;
  return {
    usd,
    width_pct: widthPct,
    pools: toGo,
    pick: pick ? { pool: pick.pool, label: pick.label, fees_usd_per_day: pick.fees_usd_per_day } : null,
    pick_due: pickDue,
    watched: watchedRow ? { pool: watchedRow.pool, label: watchedRow.label, fees_usd_per_day: watchedRow.fees_usd_per_day } : null,
    why: !pools.length ? 'nothing recorded yet'
      : !enough ? `no pick until every pool has ${minHours} h of sampled chain (${toGo.map((p) => `${p.label} ${p.hours} h`).join(', ')}); an hourly window covers about ${Math.round(pools[0].minutes_per_window || 37.5)} minutes, so ${Math.max(...toGo.map((p) => p.runs_to_go))} more hourly runs${pickDue ? `, the pick is due around ${pickDue.slice(11, 16)} UTC on ${pickDue.slice(0, 10)}` : ''}`
      : pick && watchedRow && pick.pool === watchedRow.pool ? `${pick.label}, the pool the agent is in, earned the most per day for $${usd} in ±${widthPct}%`
      : pick && watchedRow ? `${pick.label} earned $${pick.fees_usd_per_day} a day for $${usd} in ±${widthPct}% against $${watchedRow.fees_usd_per_day} in ${watchedRow.label}, where the agent is. Whether that is worth a move is the switch rule beside this.`
      : `${pick.label} earned the most per day for $${usd} in ±${widthPct}%`,
    rule: 'Each pool is replayed with the same code over its own recorded hours; fees are what this much capital would have collected inside the width, diluted by the pool\'s own working capital. Nothing is picked until every pool has a day of windows. Whether the pick is worth a move is the switch rule (move): a lead of a quarter over all hours and over the last day, paying the move back within three days.',
  };
}

// WHETHER THE FINDING IS WORTH ACTING ON. Pure; pinned by scripts/lp-pools.mjs.
// A pool change is a withdrawal, two trades and a mint — about two re-sets
// of cost — and a record that says "the other pool paid more this week" is
// evidence, not a move. The rule that turns it into one:
//   - every pool has its day of hours (the verdict has a pick),
//   - the pick is not the pool the agent is in,
//   - the pick leads the watched pool by SWITCH_MARGIN over all recorded hours
//     AND over the last day alone — a lead built on one busy hour a week ago
//     is not a lead,
//   - the extra fees on the position's own capital pay for the move within
//     SWITCH_PAYBACK_DAYS.
// Anything short of that is a "stay", with the reason.
export const SWITCH_MARGIN = 0.25;
export const SWITCH_PAYBACK_DAYS = 3;
export const SWITCH_COST_IN_RESETS = 2;
export const DEFAULT_RESET_COST_USD = 0.25;
export function switchVerdict(log, widthPct, { watched = null, positionUsd = POSITION_USD, resetCostUsd = DEFAULT_RESET_COST_USD, now = Date.now(), minHours = MIN_HOURS_TO_PICK } = {}) {
  const v = poolVerdict(log, widthPct, { watched, minHours });
  const usd = v.usd;
  const stay = (why, extra = {}) => ({ move: false, from: v.watched, to: null, why, width_pct: widthPct, ...extra });
  if (!v.pick) return stay(v.why);
  if (!v.watched) return stay('the watched pool is not in the record, so there is nothing to compare the pick against');
  if (v.pick.pool === v.watched.pool) return stay(`${v.pick.label}, the pool the agent is in, earns the most; nothing to move to`);
  const all = v.pools;
  const pickAll = all.find((p) => p.pool === v.pick.pool), homeAll = all.find((p) => p.pool === v.watched.pool);
  // The last day alone, from the same windows.
  const since = now - 24 * 3600e3;
  const recentLog = { usd, pools: Object.fromEntries(Object.entries(log.pools || {}).map(([k, rec]) => [k, { ...rec, windows: (rec.windows || []).filter((w) => Date.parse(w.at) >= since) }])) };
  const recent = poolVerdict(recentLog, widthPct, { watched, minHours: 0 }).pools;
  const pickRecent = recent.find((p) => p.pool === v.pick.pool), homeRecent = recent.find((p) => p.pool === v.watched.pool);
  const rate = (p) => (p && typeof p.fees_usd_per_day === 'number' ? p.fees_usd_per_day : null);
  const leadOf = (a, b) => (b > 0 ? (a || 0) / b - 1 : (a || 0) > 0 ? Infinity : 0);
  const leadAll = leadOf(rate(pickAll), rate(homeAll));
  const leadRecent = leadOf(rate(pickRecent), rate(homeRecent));
  const pct = (x) => (x === Infinity ? 'every dollar' : `${Math.round(x * 100)}%`);
  const scale = positionUsd / usd;
  const gainPerDay = Math.max(0, (rate(pickAll) || 0) - (rate(homeAll) || 0)) * scale;
  const cost = SWITCH_COST_IN_RESETS * resetCostUsd;
  const payback = gainPerDay > 0 ? cost / gainPerDay : Infinity;
  const facts = {
    lead_all_pct: leadAll === Infinity ? null : Math.round(leadAll * 1000) / 10,
    lead_recent_pct: leadRecent === Infinity ? null : Math.round(leadRecent * 1000) / 10,
    gain_usd_per_day_on_position: Math.round(gainPerDay * 10000) / 10000,
    switch_cost_usd: Math.round(cost * 10000) / 10000,
    payback_days: payback === Infinity ? null : Math.round(payback * 10) / 10,
    recent_hours: { pick: pickRecent?.hours ?? 0, watched: homeRecent?.hours ?? 0 },
  };
  if (leadAll < SWITCH_MARGIN) return stay(`${v.pick.label} leads ${v.watched.label} by ${pct(leadAll)} over ${homeAll.hours} h — under the ${Math.round(SWITCH_MARGIN * 100)}% a move needs`, facts);
  if (!pickRecent || !homeRecent || !pickRecent.hours || !homeRecent.hours) return stay(`${v.pick.label} leads over all hours but one of the two has no window in the last day; no move on a stale lead`, facts);
  if (leadRecent < SWITCH_MARGIN) return stay(`${v.pick.label} leads by ${pct(leadAll)} over all hours but only ${pct(leadRecent)} over the last day — a lead that is fading is not acted on`, facts);
  if (payback > SWITCH_PAYBACK_DAYS) return stay(`${v.pick.label} leads by ${pct(leadAll)}, but $${facts.gain_usd_per_day_on_position} a day more on $${positionUsd} pays the $${facts.switch_cost_usd} move back in ${facts.payback_days} days — over the ${SWITCH_PAYBACK_DAYS} the rule allows`, facts);
  return {
    move: true, from: v.watched, to: v.pick, width_pct: widthPct,
    why: `${v.pick.label} earned ${pct(leadAll)} more than ${v.watched.label} over ${homeAll.hours} h and ${pct(leadRecent)} more over the last day; on $${positionUsd} that is $${facts.gain_usd_per_day_on_position} a day and pays the $${facts.switch_cost_usd} move back in ${facts.payback_days} days`,
    ...facts,
  };
}

export async function readLpPools(env) {
  const raw = await env.AGENT.get(KV_KEY);
  return raw ? JSON.parse(raw) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHAIN_REFUSED = /every BSC endpoint refused|log endpoint refused|rate limit|capacity|too many|quota|429|timed out|timeout|aborted|network|fetch failed/i;

// The hourly tick, run after the width record's own so the watched pool's
// window is already there to copy. One replay per other candidate, one KV
// read, one KV write. A candidate the chain refuses this hour is skipped
// this hour — a missing window is a gap, an invented one is a lie.
export async function recordLpPools(env) {
  const watched = String(env.LP_WATCH_POOL || '').toLowerCase();
  const prev = (await readLpPools(env)) || { usd: POSITION_USD, since: new Date().toISOString(), pools: {} };
  let log = { ...prev, usd: POSITION_USD, pools: { ...(prev.pools || {}) } };
  const added = [], skipped = [];

  // One replay with the width record's own patience: a refusal from the
  // chain gets a second try, anything else is a reason in the skip list.
  const replay = async (pool) => {
    try { return await measure(pool, POSITION_USD); }
    catch (e) {
      if (!CHAIN_REFUSED.test(String(e.message))) { skipped.push({ pool, why: String(e.message).slice(0, 120) }); return null; }
      await sleep(15000);
      try { return await measure(pool, POSITION_USD); }
      catch (e2) { skipped.push({ pool, why: String(e2.message).slice(0, 120) }); return null; }
    }
  };

  // The watched pool: the width record measured it minutes ago — unless its
  // own measurement failed this hour (2026-09-08 08:31: "the log endpoint
  // refused this range" while the two other pools replayed fine seconds
  // later). A window older than this tick is not copied; the pool is
  // replayed here instead, so the hours stay comparable across pools.
  if (watched) {
    const w = JSON.parse((await env.AGENT.get(WINDOWS_KEY)) || 'null');
    const latest = w && w.pool && w.pool.toLowerCase() === watched ? (w.windows || []).slice(-1)[0] : null;
    const fresh = latest && Date.now() - Date.parse(latest.at) < 50 * 60 * 1000;
    if (fresh) {
      const r = appendPoolWindow(log, watched, latest);
      log = r.log; if (r.added) added.push(labelOf(watched));
    } else {
      const plan = await replay(watched);
      if (plan) {
        const r = appendPoolWindow(log, watched, windowFromPlan(plan, POSITION_USD));
        log = r.log; if (r.added) added.push(labelOf(watched) + ' (replayed here; the width record had no window this hour)');
      }
      await sleep(3000);
    }
  }

  // The others: measured now.
  for (const c of CANDIDATES) {
    if (c.pool === watched) continue;
    const plan = await replay(c.pool);
    if (!plan) continue;
    const r = appendPoolWindow(log, c.pool, windowFromPlan(plan, POSITION_USD));
    log = r.log; if (r.added) added.push(c.label);
    await sleep(1500);
  }

  // Every run leaves a note, added or not: a pool missing from an hour
  // is a gap the reader should be able to explain (2026-09-08 07:30 the
  // BOB/BNB window was missing and the record could not say why).
  log.last_run = { at: new Date().toISOString(), added, skipped };
  await env.AGENT.put(KV_KEY, JSON.stringify(log));
  return { ok: true, added, skipped, pools: Object.keys(log.pools).length };
}

export async function noteLpPoolsError(env, e) {
  const prev = (await readLpPools(env)) || { usd: POSITION_USD, since: new Date().toISOString(), pools: {} };
  prev.last_error = { at: new Date().toISOString(), message: String(e && e.message || e).slice(0, 200) };
  await env.AGENT.put(KV_KEY, JSON.stringify(prev));
}
