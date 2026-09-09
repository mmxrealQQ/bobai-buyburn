// The LP agent's daily tick: AI income into the position, the position's
// fees into the buyback bot.
//
// THE FLOW, as the user set it on 2026-09-02
//   1. everything the AI side earns (USD1 for watches, $U for delivered jobs)
//      goes to the liquidity wallet, in BNB                      -> sweep
//   2. the liquidity wallet's profit — the fees the position earns — is
//      split: part stays as capital so the position grows out of its own
//      earnings (LP_FEE_KEEP_PCT, half since 2026-09-04: "er soll auch davon
//      wachsen"), the rest goes to the buyback wallet, which buys and burns
//      $BOBAI as it always has; the capital stays in the position, always
//                                                                  -> collect
//   3. capital that arrived — swept income and the kept fee share — grows
//      the same position                                           -> increase
//   A re-set of the range (rebalance) pays the old range's fees out on the
//   way and splits them the same: the kept share is minted into the new
//   capital, the rest goes to the buyback wallet before the mint. Until
//   2026-09-08 it folded all of them in, and since the collect step's floor
//   was never reached between two re-sets, the buyback had seen nothing.
// The buyback bot and the dev sweep are not touched by any of this. This
// worker hands BNB to one of them and reads nothing from either.
//
// WHY THE BUYBACK WALLET AND NOT A BURN FROM HERE
// The buyback bot already buys $BOBAI and burns it, unattended, and its burns
// are the only ones the public burn log carries. A second buyer with its own
// burn path would be a second set of numbers to reconcile. One burn path,
// one record.
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
  planRebalance, executeRebalance, readBnbUsd,
} from '../shared/lp-agent.js';
import { readLpWindows, verdict, measuredResetCost } from '../worker-agent/lp-windows.js';
import { rebalanceWait, splitFees, RESET_AFTER_HOURS } from '../shared/lp-guards.js';

export const KV_KEY = 'lp:agent';
// When the agent first saw the price outside the range, so an hourly check
// can tell "just left" from "gone for two hours". Cleared the moment the
// price is back inside or the range has been re-set.
export const OUT_SINCE_KEY = 'lp:out_since';
const STEPS = ['sweep', 'collect', 'rebalance', 'increase'];
const DAILY_CRON = '23 4 * * *';

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
export async function agentTick(env, { dry = false, steps = STEPS } = {}) {
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
      try {
        const plan = await planSweep(pub, src, feed);
        if (plan.no) { out.push({ ...plan.summary, acted: false, why: plan.no }); continue; }
        if (dry) { out.push({ ...plan.summary, acted: false, why: 'dry run — would have sold and sent to the liquidity wallet' }); continue; }
        const wallet = createWalletClient({ account: acct, chain: bsc, transport: transport() });
        out.push({ ...plan.summary, acted: true, ...(await executeSweep(pub, wallet, acct, plan)) });
      } catch (e) {
        out.push({ source: src.key, acted: false, error: String(e.shortMessage || e.message).slice(0, 300) });
      }
    }
    return out;
  });

  const lpKey = env.LP_PRIVATE_KEY;
  if (!lpKey) {
    entry.ok = false;
    for (const s of ['collect', 'rebalance', 'increase']) if (steps.includes(s)) entry.steps[s] = { acted: false, error: 'LP_PRIVATE_KEY is not set on this worker' };
    entry.why = whyOf(entry.steps);
    return record(env, entry, steps.length < STEPS.length);
  }
  const lp = account(lpKey);
  entry.wallet = lp.address;
  const lpWallet = () => createWalletClient({ account: lp, chain: bsc, transport: transport() });

  // 2. collect: fees -> BNB -> part kept as capital, the rest to the buyback
  //    wallet. Only what this run produced. The share is a var, not a secret:
  //    it is public policy, and the record names it with every collect.
  const keptPct = splitFees(0n, env.LP_FEE_KEEP_PCT).pct;
  await run('collect', async () => {
    const plan = await planCollect(pub, lp.address);
    const split = { kept_pct: keptPct, buyback_pct: 100 - keptPct };
    if (plan.no) return { ...plan.summary, ...split, acted: false, why: plan.no };
    if (dry) return { ...plan.summary, ...split, acted: false, why: `dry run — would have collected, kept ${keptPct}% as capital and forwarded the rest`, would_forward_bnb_about: plan.state.owedBnbEquivalent };
    try {
      return { ...plan.summary, ...split, acted: true, ...(await executeCollect(pub, lpWallet(), lp, plan, () => {}, { keptPct })) };
    } catch (e) {
      return { ...plan.summary, acted: true, error: String(e.shortMessage || e.message).slice(0, 300), txs: e.txs || [] };
    }
  });

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
    const log = await readLpWindows(env);
    // The width is picked with the cost the agent really pays, once it has
    // paid one: the last re-set's gas from its own record, in today's dollars.
    let costOpts = {};
    try {
      const m = measuredResetCost(await readState(env), (await readBnbUsd(pub)).bnbUsd);
      if (m) costOpts = { resetCostUsd: m.usd, resetCostBasis: `measured: the re-set of ${m.at.slice(0, 16).replace('T', ' ')} UTC cost ${m.gas_bnb} BNB of gas and ${m.swap_fee_bnb} BNB of swap fee (${m.swap_basis})` };
    } catch { /* the replay's assumption stands */ }
    const record = log ? verdict(log, costOpts) : null;
    // The pool the record watches lets the plan finish a re-set that stopped
    // between its unwind and its mint: no position, the two tokens in the
    // wallet (2026-09-05 12:50). Such a resume does not wait the two hours —
    // the capital is already out of the pool and earning nothing.
    const plan = await planRebalance(pub, lp.address, { record, pool: log?.pool || null, keptPct });
    const outSinceRaw = await env.AGENT.get(OUT_SINCE_KEY);
    const outSince = outSinceRaw ? Date.parse(outSinceRaw) : null;
    if (plan.summary.in_range) {
      if (outSince != null) await env.AGENT.delete(OUT_SINCE_KEY);
      return { ...plan.summary, acted: false, why: plan.no };
    }
    if (plan.no) return { ...plan.summary, acted: false, outside_since: outSinceRaw || null, why: plan.no };
    const waitH = record?.delay_test?.in_use_hours ?? RESET_AFTER_HOURS;
    const waitNote = { wait_h: waitH, wait_basis: record?.delay_test?.wait_basis || 'set' };
    if (!plan.resume) {
      if (outSince == null) {
        if (!dry) await env.AGENT.put(OUT_SINCE_KEY, at);
        const first = rebalanceWait(null, Date.parse(at), waitH);
        if (first) return { ...plan.summary, ...waitNote, acted: false, outside_since: at, why: first };
      } else {
        const wait = rebalanceWait(outSince, Date.parse(at), waitH);
        if (wait) return { ...plan.summary, ...waitNote, acted: false, outside_since: outSinceRaw, why: wait };
      }
    }
    if (String(env.LP_REBALANCE || '0') !== '1') return { ...plan.summary, acted: false, outside_since: outSinceRaw, why: 'a re-set is due and LP_REBALANCE is not 1 — the first one is run by hand and watched, then the cron takes over' };
    if (dry) return { ...plan.summary, acted: false, outside_since: outSinceRaw, why: plan.resume ? 'dry run — would have minted the range from what the wallet holds' : `dry run — would have re-set the range${plan.summary.fees_to_buyback_bnb > 0 ? ` and sent ${plan.summary.fees_to_buyback_bnb} BNB of the old range's fees to the buyback wallet` : ''}` };
    try {
      const done = await executeRebalance(pub, lpWallet(), lp, plan, () => {}, { keptPct });
      await env.AGENT.delete(OUT_SINCE_KEY);
      return { ...plan.summary, acted: true, outside_since: outSinceRaw, ...done };
    } catch (e) {
      return { ...plan.summary, acted: true, outside_since: outSinceRaw, error: String(e.shortMessage || e.message).slice(0, 300), txs: e.txs || [] };
    }
  });

  // 4. increase: whatever is above the reserve, into the same position.
  await run('increase', async () => {
    const plan = await planIncrease(pub, lp.address);
    if (plan.no) return { ...plan.summary, acted: false, why: plan.no };
    if (dry) return { ...plan.summary, acted: false, why: 'dry run — would have grown the position' };
    try {
      return { ...plan.summary, acted: true, ...(await executeIncrease(pub, lpWallet(), lp, plan)) };
    } catch (e) {
      return { ...plan.summary, acted: true, error: String(e.shortMessage || e.message).slice(0, 300), txs: e.txs || [] };
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
  // Every real action and every error is kept; quiet days are summarised as
  // the last check so the history is a history of what happened, not of the
  // cron firing.
  if (entry.acted || !entry.ok) st.history = st.history.concat(entry).slice(-200);
  st.last_check = entry;
  if (partial && st.last && st.last.steps) {
    const steps = { ...st.last.steps, ...entry.steps };
    // "Range checked" only when the range was: a hand-narrowed collect run
    // must not read as an hourly check on the record page.
    st.last = { ...st.last, steps, why: whyOf(steps), ...(entry.steps.rebalance ? { range_checked_at: entry.at } : {}) };
  } else {
    st.last = entry;
  }
  st.note = 'Once a day: what the AI side earned is sold for BNB and sent to the liquidity wallet (sweep); the fees the PancakeSwap V3 position earned are sold for BNB, part stays as capital (the kept share, named in every collect) and the rest is sent to the buyback wallet, which buys and burns $BOBAI as it always has (collect); BNB above the reserve — swept income and kept fees — grows the same position (increase). Every hour: a position the price has left for two hours is re-set around the current price, in the width that netted the most per day when every width was replayed over the recorded prices with the same delay and the re-set cost included (rebalance). The capital never leaves. Each step has a floor under which moving the money would cost more than the money, and a run under a floor is recorded as a decision, not an error.';
  st.cadence = { daily_utc: '04:23 — sweep, collect, rebalance, increase', hourly_utc: ':50 — rebalance only' };
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
      return json(await agentTick(env, { dry, steps }));
    }
    if (url.pathname === '/') return json(await readState(env));
    return json({ error: 'not found' }, 404);
  },
  async scheduled(event, env, ctx) {
    // The daily tick runs all four steps; every other firing is the hourly
    // range check and runs the rebalance step alone.
    const steps = event.cron === DAILY_CRON ? STEPS : ['rebalance'];
    ctx.waitUntil(agentTick(env, { steps }).catch(async (e) => record(env, { at: new Date().toISOString(), ok: false, acted: false, error: String(e.message).slice(0, 300) })));
  },
};
