// The LP agent's daily tick: AI income into the position, the position's
// fees into the buyback bot.
//
// THE FLOW, as the user set it on 2026-09-02
//   1. everything the AI side earns (USD1 for watches, $U for delivered jobs)
//      goes to the liquidity wallet, in BNB                      -> sweep
//   2. the liquidity wallet's profit — the fees the position earns — goes to
//      the buyback wallet, which buys and burns $BOBAI as it always has; the
//      capital stays in the position, always                     -> collect
//   3. capital that arrived grows the same position                -> increase
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
import { readLpWindows, verdict } from '../worker-agent/lp-windows.js';

export const KV_KEY = 'lp:agent';
const STEPS = ['sweep', 'collect', 'rebalance', 'increase'];

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
  const reasons = [];

  const run = async (name, fn) => {
    if (!steps.includes(name)) return;
    try {
      const out = await fn();
      entry.steps[name] = out;
      const parts = Array.isArray(out) ? out : [out];
      for (const p of parts) {
        if (p.acted) entry.acted = true;
        if (p.error) entry.ok = false;
        if (p.why) reasons.push(`${name}${p.source ? ` ${p.source}` : ''}: ${p.why}`);
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
    entry.why = reasons.join(' · ') || null;
    return record(env, entry);
  }
  const lp = account(lpKey);
  entry.wallet = lp.address;
  const lpWallet = () => createWalletClient({ account: lp, chain: bsc, transport: transport() });

  // 2. collect: fees -> BNB -> buyback wallet. Only what this run produced.
  await run('collect', async () => {
    const plan = await planCollect(pub, lp.address);
    if (plan.no) return { ...plan.summary, acted: false, why: plan.no };
    if (dry) return { ...plan.summary, acted: false, why: 'dry run — would have collected and forwarded', would_forward_bnb_about: plan.state.owedBnbEquivalent };
    try {
      return { ...plan.summary, acted: true, ...(await executeCollect(pub, lpWallet(), lp, plan)) };
    } catch (e) {
      return { ...plan.summary, acted: true, error: String(e.shortMessage || e.message).slice(0, 300) };
    }
  });

  // 3. rebalance: a position the price has left is re-set around today's
  //    price, in the width the window record's day test picked. Gated by
  //    LP_REBALANCE in wrangler.toml: the first re-set is run by hand and
  //    watched (scripts/lp-agent.mjs --step rebalance --confirm), and only
  //    then is the cron allowed to do it on its own.
  await run('rebalance', async () => {
    const log = await readLpWindows(env);
    const record = log ? verdict(log) : null;
    const plan = await planRebalance(pub, lp.address, { record });
    if (plan.no) return { ...plan.summary, acted: false, why: plan.no };
    if (String(env.LP_REBALANCE || '0') !== '1') return { ...plan.summary, acted: false, why: 'a re-set is due and LP_REBALANCE is not 1 — the first one is run by hand and watched, then the cron takes over' };
    if (dry) return { ...plan.summary, acted: false, why: 'dry run — would have re-set the range' };
    try {
      return { ...plan.summary, acted: true, ...(await executeRebalance(pub, lpWallet(), lp, plan)) };
    } catch (e) {
      return { ...plan.summary, acted: true, error: String(e.shortMessage || e.message).slice(0, 300) };
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
      return { ...plan.summary, acted: true, error: String(e.shortMessage || e.message).slice(0, 300) };
    }
  });

  entry.why = reasons.join(' · ') || null;
  return record(env, entry);
}

async function record(env, entry) {
  const st = await readState(env);
  // Every real action and every error is kept; quiet days are summarised as
  // the last check so the history is a history of what happened, not of the
  // cron firing.
  if (entry.acted || !entry.ok) st.history = st.history.concat(entry).slice(-200);
  st.last = entry;
  st.note = 'Once a day: what the AI side earned is sold for BNB and sent to the liquidity wallet (sweep); the fees the PancakeSwap V3 position earned are sold for BNB and sent to the buyback wallet, which buys and burns $BOBAI as it always has (collect); a position the price has left is re-set around today\'s price in the width that held through every tested day of the window record (rebalance); BNB above the reserve grows the same position (increase). The capital never leaves. Each step has a floor under which moving the money would cost more than the money, and a day under a floor is recorded as a decision, not an error.';
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
    ctx.waitUntil(agentTick(env).catch(async (e) => record(env, { at: new Date().toISOString(), ok: false, acted: false, error: String(e.message).slice(0, 300) })));
  },
};
