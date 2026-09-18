// The DeFi agent's tick: AI income into the position, half of the position's
// fees kept as capital, the other half into $BOBAI the agent holds.
//
// THE FLOW, as the user set it on 2026-09-02 (fee rule as of 2026-09-09)
//   1. everything the AI side earns (USD1 for watches, $U for delivered jobs)
//      goes to the DeFi wallet, in BNB                      -> sweep
//   2. the DeFi wallet's profit — the fees the position earns — is
//      split: part stays as capital so the position grows out of its own
//      earnings (LP_FEE_KEEP_PCT, half since 2026-09-04: "er soll auch davon
//      wachsen"), the rest buys $BOBAI that stays in this wallet, never sold
//      (since 2026-09-09; before that it went to the buyback wallet); the
//      capital stays in the position, always                       -> collect
//   3. a range the price has left is re-set beside the price, one-sided, with
//      the token it ended in and no trade (2026-09-16); the old range's fees
//      are split the same way on the way                           -> rebalance
//   4. BNB that arrives while the main range is all of the other side opens
//      a reserve range below the price (2026-09-16)                -> ladder
//   5. capital that arrived — swept income, the kept fee share, deposits —
//      grows the same position                                     -> increase
// The buyback bot and the dev sweep are not touched by any of this; this
// worker sends them nothing and reads nothing from either.
//
// The three steps live in shared/lp-agent.js, shared with the hand script
// scripts/lp-agent.mjs — the same functions, so what a person can plan on a
// laptop is what this cron sends. The keys are Worker secrets, the same class
// of thing the buyback bot has held since July. This worker has no public
// face beyond a secret-gated /run: everything readable about it is served by
// the agent worker from the KV record it writes (agent.brainonbnb.com/lp/agent).
import { createPublicClient, createWalletClient, http, fallback } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import {
  RPCS, INCOME_SOURCES,
  planSweep, executeSweep, planCollect, executeCollect, planIncrease, executeIncrease,
  planRebalance, executeRebalance, readBnbUsd, planLadder, executeLadder, healLadder,
} from '../shared/lp-agent.js';
import { readLpWindows, verdict, measuredResetCost, readLpTicks, recordLpTick } from '../worker-agent/lp-windows.js';
import { trimHistory, ARCHIVE_KEY } from '../shared/lp-flow.js';
import { rebalanceWait, splitFees, widthUpgrade, depositForcesReset, rangeLeft, RESET_AFTER_HOURS, HOME_POOL, LADDER_GATE, ladderActsInWatch } from '../shared/lp-guards.js';

export const KV_KEY = 'lp:agent';
// When the agent first saw the price outside the range, so an hourly check
// can tell "just left" from "gone for two hours". Cleared the moment the
// price is back inside or the range has been re-set.
export const OUT_SINCE_KEY = 'lp:out_since';
// THE LADDER RECORD (2026-09-16): which position is the main range and
// which the reserve range below the price (shared/lp-agent.js, planLadder).
// Every step reads the wallet through it, so two positions it names read as
// one main range with a reserve attached; two it does not name are refused
// as before. Written by the ladder step (a reserve minted, re-set, or
// merged away) and corrected here when the chain holds fewer positions
// than the record says.
export const LADDER_KEY = 'lp:ladder';
async function readLadder(env) {
  try { const raw = await env.AGENT.get(LADDER_KEY); const l = raw ? JSON.parse(raw) : null; return l && typeof l === 'object' ? { main: l.main ?? null, reserve: l.reserve ?? null, since: l.since ?? null } : { main: null, reserve: null, since: null }; }
  catch { return { main: null, reserve: null, since: null }; }
}
async function writeLadder(env, ladder) { await env.AGENT.put(LADDER_KEY, JSON.stringify(ladder)); }
// WHAT WAS SENT IS RECORDED, WHATEVER KV DOES AFTERWARDS (2026-09-18). The KV
// writes that follow a step's transactions used to sit in the same try: a put
// that threw turned a re-set that had happened into `{ error, txs }` without
// its new position, its fees or its $BOBAI — the money flow never counted it
// and the ladder record went stale. They run on their own now; a failure is
// named beside the result (`kv_error`), and ladderHeal follows the chain on
// the next tick.
async function afterSend(fn) { try { await fn(); return {}; } catch (e) { return { kv_error: String(e.message || e).slice(0, 200) }; } }
// relocate sits before rebalance: a day on which the pool record's switch
// rule says "move" ends with the position in the new pool, and the re-set
// step then finds it in range. It runs in the daily tick only.
// ladder sits between rebalance and increase (2026-09-16): a deposit that
// waits beside a sell ladder above the price becomes a buy ladder below it
// before the increase can refuse it; gated by LP_LADDER in wrangler.toml.
const STEPS = ['sweep', 'collect', 'relocate', 'rebalance', 'ladder', 'increase'];
const DAILY_CRON = '23 4 * * *';
// The hourly check re-sets the range and, since 2026-09-09, also puts in
// what the wallet holds — a re-set that lands the position back in range
// used to leave a deposit idle until the next 04:23. The deposit watch
// runs every ten minutes on the other minutes and does only the increase:
// one balance read, and nothing at all under the floor or out of range.
// The operator's rule, 2026-09-09: "such things have to happen within
// seconds or minutes" — a deposit that sits for a day is a broken agent.
const HOURLY_CRON = '50 * * * *';

const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const account = (key) => privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
// Three public endpoints in turn. The first build used one and a throttled
// node would have read as "the position holds nothing".
const transport = () => fallback(RPCS.map((u) => http(u, { timeout: 15000 })));

async function readState(env) {
  const raw = await env.AGENT.get(KV_KEY);
  return raw ? JSON.parse(raw) : { history: [], last: null };
}

// One run. `dry` reads and decides but signs nothing — the same code path up
// to the first transaction, which is the part worth being able to test after
// a deploy without moving money. `steps` narrows a hand-triggered run.
// `watch` marks the ten-minute deposit watch: it re-sets the range only when
// a large deposit waits beside a range the price has left (depositForcesReset),
// and its rebalance step is not recorded otherwise, so the hourly check's
// own record is not overwritten six times an hour with "no re-set".
export async function agentTick(env, { dry = false, steps = STEPS, watch = false } = {}) {
  const at = new Date().toISOString();
  const pub = createPublicClient({ chain: bsc, transport: transport() });
  const entry = { at, dry, ok: true, acted: false, steps: {} };

  const run = async (name, fn) => {
    if (!steps.includes(name)) return;
    try {
      const out = await fn();
      entry.steps[name] = out;
      const parts = Array.isArray(out) ? out : [out];
      for (const p of parts) {
        if (p.acted) entry.acted = true;
        if (p.error) entry.ok = false;
      }
    } catch (e) {
      entry.ok = false;
      entry.steps[name] = { acted: false, error: String(e.shortMessage || e.message).slice(0, 300) };
    }
  };

  // 1. sweep, one income wallet at a time. A missing key is a red line, not a
  //    quiet day: the flow the site describes would silently not be running.
  await run('sweep', async () => {
    const feed = await readBnbUsd(pub);
    const out = [];
    for (const src of INCOME_SOURCES) {
      const key = env[src.keyEnv];
      if (!key) { out.push({ source: src.key, acted: false, error: `${src.keyEnv} is not set on this worker` }); continue; }
      const acct = account(key);
      if (acct.address.toLowerCase() !== src.wallet.toLowerCase()) { out.push({ source: src.key, acted: false, error: `${src.keyEnv} does not open ${src.wallet}` }); continue; }
      const txs = [];
      try {
        const plan = await planSweep(pub, src, feed);
        if (plan.no) { out.push({ ...plan.summary, acted: false, why: plan.no }); continue; }
        if (dry) { out.push({ ...plan.summary, acted: false, why: 'dry run — would have sold and sent to the DeFi wallet' }); continue; }
        const wallet = createWalletClient({ account: acct, chain: bsc, transport: transport() });
        out.push({ ...plan.summary, acted: true, ...(await executeSweep(pub, wallet, acct, plan, () => {}, { txs })) });
      } catch (e) {
        // A sweep that sent before it failed did act: saying otherwise would
        // hide its transactions from the record and from the day's counters.
        out.push({ source: src.key, acted: txs.length > 0, error: String(e.shortMessage || e.message).slice(0, 300), txs });
      }
    }
    return out;
  });

  const lpKey = env.LP_PRIVATE_KEY;
  if (!lpKey) {
    entry.ok = false;
    for (const s of ['collect', 'relocate', 'rebalance', 'ladder', 'increase']) if (steps.includes(s)) entry.steps[s] = { acted: false, error: 'LP_PRIVATE_KEY is not set on this worker' };
    entry.why = whyOf(entry.steps);
    return record(env, entry, steps.length < STEPS.length);
  }
  const lp = account(lpKey);
  entry.wallet = lp.address;
  const lpWallet = () => createWalletClient({ account: lp, chain: bsc, transport: transport() });
  const ladder = await readLadder(env);
  // The record follows the chain (ladderHeal, 2026-09-17): a main range the
  // wallet no longer holds is replaced by the one position that stands beside
  // the reserve in the same pool. A dry run heals in hand only.
  try {
    const healed = await healLadder(pub, lp.address, ladder);
    if (healed) { entry.ladder_healed = { from: ladder.main, to: healed.main, ...(healed.closed ? { reserve_closed: ladder.reserve } : {}), ...(healed.adopted ? { reserve_adopted: healed.reserve, reserve_was: ladder.reserve ?? null } : {}), why: healed.why }; ladder.main = healed.main; if (healed.closed) ladder.reserve = null; if (healed.adopted) ladder.reserve = healed.reserve; if (!dry) await writeLadder(env, ladder); }
  } catch { /* an RPC that did not answer heals nothing; the guards refuse as before */ }
  const ladderOn = String(env[LADDER_GATE] || '0') === '1';
  // The width record's verdict, replayed once per tick (the rebalance step
  // fills it; the ladder step reads it).
  let widthRecord = null;
  // The width record's verdict with the agent's own measured re-set cost —
  // one loader for the rebalance and the ladder step, so the two never pick
  // a different width from the same record (2026-09-16: a hand-narrowed
  // ladder run replayed without the cost and named ±4% where the re-set
  // had just taken ±7%).
  const loadWidthRecord = async () => {
    const log = await readLpWindows(env);
    let costOpts = {}, bnbUsd = null;
    try {
      bnbUsd = (await readBnbUsd(pub)).bnbUsd;
      const m = measuredResetCost(await readState(env), bnbUsd);
      if (m) costOpts = { resetCostUsd: m.usd_per_50 ?? m.usd, resetCostFullUsd: m.usd, resetCostBasis: `measured: the re-set of ${m.at.slice(0, 16).replace('T', ' ')} UTC cost $${m.usd} on a $${m.position_usd_at_reset ?? '?'} position — ${m.gas_bnb} BNB of gas and ${m.swap_fee_bnb} BNB of swap fee (${m.swap_basis})` };
    } catch { /* the replay's assumption stands */ }
    const record = log ? verdict(log, { ...costOpts, tape: await readLpTicks(env) }) : null;
    return { log, record, costOpts, bnbUsd };
  };

  // 2. collect: fees -> BNB -> part kept as capital, the rest to the buyback
  //    wallet. Only what this run produced. The share is a var, not a secret:
  //    it is public policy, and the record names it with every collect.
  const keptPct = splitFees(0n, env.LP_FEE_KEEP_PCT).pct;
  await run('collect', async () => {
    const plan = await planCollect(pub, lp.address, ladder);
    const split = { kept_pct: keptPct, buyback_pct: 100 - keptPct };
    if (plan.no) return { ...plan.summary, ...split, acted: false, why: plan.no };
    if (dry) return { ...plan.summary, ...split, acted: false, why: `dry run — would have collected, kept ${keptPct}% as capital and forwarded the rest`, would_forward_bnb_about: plan.state.owedBnbEquivalent };
    const txs = [];
    try {
      return { ...plan.summary, ...split, acted: true, ...(await executeCollect(pub, lpWallet(), lp, plan, () => {}, { keptPct, txs })) };
    } catch (e) {
      return { ...plan.summary, acted: txs.length > 0, error: String(e.shortMessage || e.message).slice(0, 300), txs };
    }
  });

  // 2b. relocate: retired on 2026-09-11. For one day (2026-09-10) the pool
  //     record replayed fifty dollars in twelve pools each hour and this
  //     step would have moved the position to whichever led by a quarter.
  //     The operator closed the question: the agent stays in CAKE/BNB 0.05%
  //     and optimises there (HOME_POOL in shared/lp-guards.js). The step
  //     stays in the record so the day's entries keep their shape, and says
  //     so in words; the hand script can still bring a stray position home.
  await run('relocate', async () => ({ acted: false, move: false, why: `stay: ${HOME_POOL.why}` }));

  // 3. rebalance: a position the price has left is re-set around today's
  //    price, in the width the window record's earnings test picked — the
  //    width that netted the most per day over the recorded prices, re-sets
  //    included. Checked every hour, not once a day: a position outside its
  //    range earns nothing, and the daily tick left it there for up to a day.
  //    But not on the first hour outside — a price that just left is often
  //    back on its own, so the agent waits before paying for a re-set. The
  //    wait is the record's own since 2026-09-09: delay_test.in_use_hours,
  //    the wait that netted the most per day when every width was replayed
  //    with each wait (a set 2 h until the record clears the bar). Gated by
  //    LP_REBALANCE in wrangler.toml: the first re-set was run by hand and
  //    watched (2026-09-02), then the cron took over.
  await run('rebalance', async () => {
    // THE WATCH LOOKS BEFORE IT REPLAYS (2026-09-13). Every ten minutes the
    // watch used to read the width record (~100 KB), the price tape and
    // replay ten widths with ten waits, twice — to decide, nearly always,
    // that there is nothing for it to do: it re-sets only when a large
    // deposit waits beside a range the price has left, or finishes a re-set
    // that stopped half way. Both show in one look at the position and the
    // wallet, which the increase step reads anyway. So the watch looks first
    // and replays only when it may act; the hourly check and the daily run
    // still replay every time, since they may re-set on the wait alone.
    if (watch) {
      const inc = await planIncrease(pub, lp.address, null, ladder);
      const s = inc.summary;
      if (inc.pos && s.in_range != null) {
        // "Left" is the guard's word, not the pool's: a one-sided range sits
        // beside the price by construction, and a price within the slack of
        // an edge has not left (rangeLeft, 2026-09-16).
        const lf = rangeLeft(s.tick, Number(inc.pos[5]), Number(inc.pos[6]));
        const settled = s.in_range || !lf.left;
        const forced = settled || (ladderOn && s.side === 'other') ? null : depositForcesReset({ inRange: false, spendableBnb: s.spendable_bnb, valueBnb: s.value_bnb });
        if (!forced) {
          const outSinceRaw = await env.AGENT.get(OUT_SINCE_KEY);
          if (settled) { if (outSinceRaw != null && !dry) await env.AGENT.delete(OUT_SINCE_KEY); }
          else if (outSinceRaw == null && !dry) await env.AGENT.put(OUT_SINCE_KEY, at);
          return {
            position: s.position, ticks: [Number(inc.pos[5]), Number(inc.pos[6])], tick: s.tick, in_range: s.in_range,
            pool: s.pool, wbnb_is0: inc.wbnbIs0, value_bnb: s.value_bnb,
            acted: false, watch: true, looked_only: true, ...(lf.outside && !lf.left ? { at_edge: true, ticks_beyond_edge: lf.ticks_away } : {}),
            outside_since: settled ? null : (outSinceRaw || at),
            deposit_beside: { spendable_bnb: s.spendable_bnb, value_bnb: s.value_bnb },
            why: 'deposit watch: the range is re-set here only when a large deposit waits beside it; the hourly check does the rest',
          };
        }
      }
    }
    // The width is picked with the cost the agent really pays, once it has
    // paid one: the last re-set's gas from its own record, in today's dollars
    // (loadWidthRecord; the replay is charged the cost per $50 of the
    // position, the full figure stays for the record).
    const { log, record, costOpts, bnbUsd } = await loadWidthRecord();
    // The pool the record watches lets the plan finish a re-set that stopped
    // between its unwind and its mint: no position, the two tokens in the
    // wallet (2026-09-05 12:50). Such a resume does not wait the two hours —
    // the capital is already out of the pool and earning nothing.
    widthRecord = record;
    const plan = await planRebalance(pub, lp.address, { record, pool: log?.pool || null, keptPct, ladder });
    const outSinceRaw = await env.AGENT.get(OUT_SINCE_KEY);
    const outSince = outSinceRaw ? Date.parse(outSinceRaw) : null;
    let upgrade = null;
    // At the edge (within the slack) counts as settled: the wait does not
    // run, and a note that ran is cleared — the price is back at the range.
    if (plan.summary.at_edge === true && !plan.summary.in_range) {
      if (outSince != null && !dry) await env.AGENT.delete(OUT_SINCE_KEY);
      return { ...plan.summary, acted: false, why: plan.no };
    }
    if (plan.summary.in_range) {
      if (outSince != null && !dry) await env.AGENT.delete(OUT_SINCE_KEY);
      // In range, nothing forces a re-set — unless the record's pick now
      // nets enough more on this capital to pay for one within a day. The
      // daily run alone may upgrade (once a day, by construction).
      upgrade = widthUpgrade({
        daily: steps.length === STEPS.length, inRange: true, ticks: plan.summary.ticks, tick: plan.summary.tick,
        pick: record?.earnings_pick || null, rows: record?.rows || [], hoursOfPrices: record?.hours_of_prices || 0,
        valueBnb: plan.summary.value_bnb, bnbUsd, resetCostUsd: costOpts.resetCostFullUsd ?? record?.reset_cost?.usd ?? 0,
      });
      if (!upgrade.upgrade) return { ...plan.summary, acted: false, why: plan.no, upgrade: upgrade.why };
      if (plan.width == null || !plan.ticks) return { ...plan.summary, acted: false, why: plan.no, upgrade: 'the plan carries no new ticks to upgrade into' };
    } else if (plan.no) return { ...plan.summary, acted: false, outside_since: outSinceRaw || null, why: plan.no };
    // A large deposit waiting beside a range the price has left ends the wait.
    let forced = null, waiting = null;
    if (!plan.resume && !plan.summary.in_range) {
      try {
        const inc = await planIncrease(pub, lp.address, null, ladder);
        waiting = { spendable_bnb: inc.state.spendableBnb, value_bnb: plan.summary.value_bnb };
        // With the ladder on, a deposit beside a sell ladder (the main range
        // all of the other side, above the price) is the ladder step's: it
        // becomes a buy ladder below the price, no trade. Forcing a re-set
        // here would buy the other side with it, the very trade the ladder
        // exists to avoid.
        forced = ladderOn && inc.summary.side === 'other' ? null : depositForcesReset({ inRange: false, spendableBnb: inc.state.spendableBnb, valueBnb: plan.summary.value_bnb });
      } catch (e) { waiting = { error: String(e.shortMessage || e.message).slice(0, 160) }; forced = null; }
    }
    const forcedNote = { ...(waiting ? { deposit_beside: waiting } : {}), ...(forced ? { forced_by_deposit: forced } : {}) };
    // The ten-minute watch stamps the moment the price left the range, so the
    // wait runs from then; until 2026-09-12 only the :50 check stamped it, and
    // a range left at :51 waited up to an hour longer than the record says.
    if (watch && !plan.resume && !plan.summary.in_range && outSince == null && !dry) await env.AGENT.put(OUT_SINCE_KEY, at);
    if (watch && !forced && !plan.resume) return { ...plan.summary, ...forcedNote, acted: false, watch: true, outside_since: outSinceRaw || at, why: 'deposit watch: the range is re-set here only when a large deposit waits beside it; the hourly check does the rest' };
    if (upgrade && upgrade.upgrade) {
      if (String(env.LP_REBALANCE || '0') !== '1') return { ...plan.summary, acted: false, why: 'a width upgrade is due and LP_REBALANCE is not 1', upgrade: upgrade.why };
      if (dry) return { ...plan.summary, acted: false, why: `dry run — would have upgraded the width from ${upgrade.from}% to ${upgrade.to}%`, upgrade: upgrade.why };
      const txs = [];
      try {
        const done = await executeRebalance(pub, lpWallet(), lp, plan, () => {}, { keptPct, txs });
        return { ...plan.summary, acted: true, upgrade: upgrade.why, upgraded_from_pct: upgrade.from, upgraded_to_pct: upgrade.to, gain_usd_per_day: upgrade.gain_usd_per_day, ...done };
      } catch (e) {
        return { ...plan.summary, acted: txs.length > 0, upgrade: upgrade.why, error: String(e.shortMessage || e.message).slice(0, 300), txs };
      }
    }
    const waitH = record?.delay_test?.in_use_hours ?? RESET_AFTER_HOURS;
    const waitNote = { wait_h: waitH, wait_basis: record?.delay_test?.wait_basis || 'set', ...(forced ? { forced_by_deposit: forced } : {}) };
    if (!plan.resume && !forced) {
      if (outSince == null) {
        if (!dry) await env.AGENT.put(OUT_SINCE_KEY, at);
        const first = rebalanceWait(null, Date.parse(at), waitH);
        if (first) return { ...plan.summary, ...waitNote, acted: false, outside_since: at, why: first };
      } else {
        const wait = rebalanceWait(outSince, Date.parse(at), waitH);
        if (wait) return { ...plan.summary, ...waitNote, acted: false, outside_since: outSinceRaw, why: wait };
      }
    }
    if (String(env.LP_REBALANCE || '0') !== '1') return { ...plan.summary, ...forcedNote, acted: false, outside_since: outSinceRaw, why: 'a re-set is due and LP_REBALANCE is not 1 — the first one is run by hand and watched, then the cron takes over' };
    if (dry) return { ...plan.summary, ...forcedNote, acted: false, outside_since: outSinceRaw, why: plan.resume ? 'dry run — would have minted the range from what the wallet holds' : `dry run — would have re-set the range${plan.oneSided ? ` one-sided, ${plan.ticks.side === 'above_price' ? 'above' : 'below'} the price, no trade` : ''}${plan.summary.fees_to_bobai_bnb > 0 ? ` and bought BOBAI with ${plan.summary.fees_to_bobai_bnb} BNB of the old range's fees` : ''}` };
    const txs = [];
    try {
      // THE MERGE (2026-09-16). A reserve range that holds the same token as
      // the main range (the price went through one of them) is unwound
      // first; its tokens and fees come back to the wallet, and the mint
      // below takes them with the rest — one range again, no trade.
      let merged = null;
      if (plan.summary.reserve) {
        const lp2 = await planLadder(pub, lp.address, { record: widthRecord, ladder });
        if (lp2.act === 'merge') {
          const m = await executeLadder(pub, lpWallet(), lp, lp2, () => {}, { txs });
          merged = { merged_reserve: m.merged_reserve, reserve_fees_folded: m.reserve_fees_folded };
          ladder.reserve = null; Object.assign(merged, await afterSend(() => writeLadder(env, ladder)));
        }
      }
      // A re-set a deposit forced takes the deposit with it: wrapped after
      // the unwind, minted with the rest, no sell-then-buy-back.
      const done = await executeRebalance(pub, lpWallet(), lp, plan, () => {}, { keptPct, wrapFirst: !!forced, txs });
      if (done.new_position) { ladder.main = String(done.new_position); ladder.since = ladder.since || at; }
      const kv = await afterSend(async () => { await env.AGENT.delete(OUT_SINCE_KEY); if (done.new_position) await writeLadder(env, ladder); });
      return { ...plan.summary, ...forcedNote, acted: true, outside_since: outSinceRaw, ...(merged || {}), ...done, ...kv };
    } catch (e) {
      return { ...plan.summary, ...forcedNote, acted: txs.length > 0, outside_since: outSinceRaw, error: String(e.shortMessage || e.message).slice(0, 300), txs };
    }
  });
  // The price the check saw goes on the tape, every ten minutes, whatever
  // the step decided (lp-windows.js, THE PRICE TAPE). The price is WBNB per
  // unit of the other side, the way the window record quotes it.
  {
    const rb = entry.steps.rebalance;
    if (!dry && rb && rb.tick != null && rb.pool) {
      const raw = Math.pow(1.0001, Number(rb.tick));
      await recordLpTick(env, { at, tick: Number(rb.tick), price: rb.wbnb_is0 ? 1 / raw : raw, pool: rb.pool }).catch(() => {});
    }
  }
  // The watch's rebalance step is kept only when it did something or a
  // deposit forced it; a "no re-set here" every ten minutes is not a record.
  // A dry run keeps it, so a hand check can see what the watch saw.
  if (watch && !dry && entry.steps.rebalance && !entry.steps.rebalance.acted && !entry.steps.rebalance.forced_by_deposit && !entry.steps.rebalance.error) delete entry.steps.rebalance;

  // 3b. ladder (2026-09-16): BNB waiting beside a main range that is all of
  //     the other side above the price opens, or grows, a reserve range
  //     below the price — WBNB only, no trade (planLadder, ladderDecision).
  //     A reserve the price has left is re-set beside it the same way. The
  //     merge back into one range happens at the main range's re-set above.
  //     Gated by LP_LADDER: "0" plans and records, "1" runs. The ten-minute
  //     watch runs it too, so a deposit becomes a ladder within minutes.
  await run('ladder', async () => {
    // A hand-narrowed run (step=ladder) has no rebalance step before it to
    // fill the width record; replay it here then, so the reserve's width is known.
    if (!widthRecord) { try { widthRecord = (await loadWidthRecord()).record; } catch { widthRecord = null; } }
    const plan = await planLadder(pub, lp.address, { record: widthRecord, ladder });
    const base = { ...plan.summary, gate: ladderOn ? 'on' : 'off' };
    if (plan.no) return { ...base, acted: false, why: `${plan.why} — ${plan.no}` };
    if (!plan.act) return { ...base, acted: false, why: plan.why };
    if (plan.act === 'merge') return { ...base, acted: false, why: `${plan.why} (done at the main range's re-set)` };
    if (!ladderOn) return { ...base, acted: false, why: `${plan.why} — ${LADDER_GATE} is not 1: planned, not run` };
    // The watch opens and grows the reserve; re-setting it is the hourly
    // check's (ladderActsInWatch) — the reserve does not chase the price
    // every ten minutes.
    if (watch && !ladderActsInWatch(plan.act)) return { ...base, acted: false, why: `${plan.why} — left to the hourly check: the ten-minute watch does not re-set the reserve` };
    if (dry) return { ...base, acted: false, why: `dry run — would have ${plan.act === 'mint_reserve' ? 'minted the reserve range' : plan.act === 'increase_reserve' ? 'grown the reserve range' : 're-set the reserve range'}: ${plan.why}` };
    const txs = [];
    try {
      const done = await executeLadder(pub, lpWallet(), lp, plan, () => {}, { txs });
      // The record on KV and the one this tick holds in hand: the increase
      // step that follows must read the wallet through the new reserve too.
      let kv = {};
      if (done.new_reserve) { ladder.main = plan.summary.position; ladder.reserve = String(done.new_reserve); ladder.since = ladder.since || at; kv = await afterSend(() => writeLadder(env, ladder)); }
      return { ...base, acted: true, ...done, ...kv };
    } catch (e) {
      return { ...base, acted: txs.length > 0, error: String(e.shortMessage || e.message).slice(0, 300), txs };
    }
  });
  // The watch keeps its ladder step only when it did something.
  if (watch && !dry && entry.steps.ladder && !entry.steps.ladder.acted && !entry.steps.ladder.error) delete entry.steps.ladder;

  // 4. increase: whatever is above the reserve, into the same position.
  await run('increase', async () => {
    const plan = await planIncrease(pub, lp.address, null, ladder);
    if (plan.no) return { ...plan.summary, acted: false, why: plan.no };
    if (dry) return { ...plan.summary, acted: false, why: 'dry run — would have grown the position' };
    const txs = [];
    try {
      return { ...plan.summary, acted: true, ...(await executeIncrease(pub, lpWallet(), lp, plan, () => {}, { txs })) };
    } catch (e) {
      return { ...plan.summary, acted: txs.length > 0, error: String(e.shortMessage || e.message).slice(0, 300), txs };
    }
  });

  entry.why = whyOf(entry.steps);
  return record(env, entry, steps.length < STEPS.length);
}

// The one-line summary of a record, rebuilt from its steps — so a daily
// record whose rebalance step was replaced by an hourly check does not keep
// saying "inside the range" from the morning while the step says "outside".
function whyOf(steps) {
  const out = [];
  for (const name of STEPS) {
    const v = steps[name];
    if (!v) continue;
    for (const p of Array.isArray(v) ? v : [v]) if (p.why) out.push(`${name}${p.source ? ` ${p.source}` : ''}: ${p.why}`);
  }
  return out.join(' · ') || null;
}

// `partial` is an hourly range check (or a hand-narrowed run): it becomes
// `last_check`, and its rebalance step is folded into the daily record so
// the page and the series see the range as it is now — but the daily
// record's sweep, collect and increase are not wiped by a run that never
// looked at them. A full run replaces the daily record as before.
async function record(env, entry, partial = false) {
  const st = await readState(env);
  // A dry run reads and decides but signs nothing, and it is not the day's
  // run: on 2026-09-10 a hand-triggered dry run at 04:41 replaced the 04:23
  // daily record, the series had no point for it, and the 05:00 card was
  // held back. A dry run is kept as `last_dry` and touches nothing else.
  if (entry.dry) {
    st.last_dry = entry;
    await env.AGENT.put(KV_KEY, JSON.stringify(st));
    return entry;
  }
  // Every real action and every error is kept; quiet days are summarised as
  // the last check so the history is a history of what happened, not of the
  // cron firing.
  if (entry.acted || !entry.ok) {
    // The cap keeps the record readable every ten minutes; a run it pushes
    // out goes to the archive, where the sums still find it (lp-flow.js).
    const { kept, dropped } = trimHistory(st.history, entry);
    if (dropped.length) {
      const arch = JSON.parse((await env.AGENT.get(ARCHIVE_KEY)) || 'null') || { what_this_is: 'Runs the DeFi agent record no longer holds (it keeps the newest 200): the writer moves them here, oldest first, and every total the agent worker reports still counts them.', entries: [] };
      // Idempotent: if the archive put went through and the record's put after
      // it did not, the same oldest runs are dropped again on the next trim —
      // a run already in the archive (by its `at`) is not appended twice.
      const have = new Set((Array.isArray(arch.entries) ? arch.entries : []).map((x) => x && x.at));
      arch.entries = (Array.isArray(arch.entries) ? arch.entries : []).concat(dropped.filter((x) => x && !have.has(x.at)));
      await env.AGENT.put(ARCHIVE_KEY, JSON.stringify(arch));
    }
    st.history = kept;
  }
  st.last_check = entry;
  // Where the position lives, for the records that follow it (the width and
  // pool records watch this pool). A relocate names the new one the moment
  // it minted; every other run names what the increase step read.
  const pool = entry.steps?.relocate?.new_pool || entry.steps?.increase?.pool;
  if (pool && /^0x[0-9a-f]{40}$/i.test(pool)) st.pool = String(pool).toLowerCase();
  if (partial && st.last && st.last.steps) {
    const steps = { ...st.last.steps, ...entry.steps };
    // "Range checked" only when the range was: a hand-narrowed collect run
    // must not read as an hourly check on the record page.
    st.last = { ...st.last, steps, why: whyOf(steps), ...(entry.steps.rebalance ? { range_checked_at: entry.at } : {}) };
  } else {
    st.last = entry;
  }
  st.note = 'Once a day: what the AI side earned is sold for BNB and sent to the DeFi wallet (sweep); the fees the PancakeSwap V3 position earned are sold for BNB, part stays as capital (the kept share, named in every collect) and the rest buys $BOBAI that the agent holds in its own wallet, never sold (collect; until 2026-09-09 that share went to the buyback wallet); BNB above the reserve — swept income and kept fees — grows the same position (increase); the position stays in its home pool, CAKE/BNB 0.05% — the pool question is closed since 2026-09-11, and the relocate step only records that it stays. Every hour: a position the price has left (more than half a percent past an edge, for the wait in use) is re-set beside the price, on the side the price came from, with the one token the old range ended in and no trade — one-sided, since 2026-09-16; the width is the one that ended the most ahead against holding over the last week, fees in, when every width was replayed that way, kept unless another leads it by a tenth (rebalance). BNB that waits beside a main range that is all of the other side above the price opens a reserve range below the price, WBNB only, no trade — a buy ladder under the sell ladder (ladder, since 2026-09-16, gated by LP_LADDER); the two merge back into one at the main range\'s next re-set once they hold the same token. The capital never leaves. Each step has a floor under which moving the money would cost more than the money, and a run under a floor is recorded as a decision, not an error.';
  st.cadence = { daily_utc: '04:23 — sweep, collect, rebalance, ladder, increase (relocate is retired and only records that the position stays)', hourly_utc: ':50 — rebalance (one-sided, no trade, since 2026-09-16), ladder, then increase', deposit_watch_utc: 'every 10 min — increase (a deposit goes in within minutes, in range and above the floor), and a re-set at once when a deposit of a quarter of the position or more waits beside a range the price has left' };
  await env.AGENT.put(KV_KEY, JSON.stringify(st));
  return entry;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/run' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      // Dry unless asked otherwise: a hand-triggered run is for checking the
      // deploy, and checking must not be the thing that moves money.
      const dry = url.searchParams.get('dry') !== '0';
      const step = url.searchParams.get('step');
      const steps = step && STEPS.includes(step) ? [step] : STEPS;
      const watch = url.searchParams.get('watch') === '1';
      return json(await agentTick(env, { dry, steps, watch }));
    }
    if (url.pathname === '/') return json(await readState(env));
    return json({ error: 'not found' }, 404);
  },
  async scheduled(event, env, ctx) {
    // The daily tick runs all five steps; the :50 firing is the hourly range
    // check (rebalance, then increase so a fresh range takes what waits in the
    // wallet); every other firing is the deposit watch: increase, and a re-set
    // only when a large deposit waits beside a range the price has left.
    const watch = event.cron !== DAILY_CRON && event.cron !== HOURLY_CRON;
    const steps = event.cron === DAILY_CRON ? STEPS : ['rebalance', 'ladder', 'increase'];
    ctx.waitUntil(agentTick(env, { steps, watch }).catch(async (e) => record(env, { at: new Date().toISOString(), ok: false, acted: false, error: String(e.message).slice(0, 300) })));
  },
};
