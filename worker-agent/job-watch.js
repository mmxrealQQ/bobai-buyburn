// Finding our funded jobs on the chain, without being told.
//
// BNB's standard hire never sends notify_funded: the buyer signs createJob and
// fund, and the reference seller watches the kernel for a funded job naming
// it. Every marketplace in the Set and Earn shortlist that runs on the BNB
// Agent SDK hires that way, so a seller that only listens for the message
// keeps the buyer's money in escrow until it expires and delivers nothing.
//
// HOW IT LOOKS: BY THE JOB COUNTER, NOT BY LOGS. The first version read
// JobFunded logs; the public logs endpoint answers only the last ~5,000-10,000
// blocks ("Archive requests require a personal token" beyond, measured
// 2026-10-04), so a tick or two lost to an outage would have lost a buyer's
// job for good. The kernel mints about six jobs a day (56,655 on 2026-08-25,
// 56,895 on 2026-10-04), so each tick reads every job id created since the
// last one it read — plain eth_calls against the latest block, no archive —
// and remembers our jobs that are created but not yet funded, to look at them
// again until they are funded, expire, or ten days pass.
//
// Every job found funded goes to deliverJob() — the same path notify_funded
// takes, which reads the job from the chain itself and refuses anything not
// funded, not ours, not evaluated by the router, or under the price. A job
// already delivered is skipped there.
import { ERC8183 } from './hire.js';
import { deliverJob, readJob } from './sell.js';
import { providerAccount } from './submit.js';

const CURSOR_KEY = 'jobs:watch:id';
const OPEN_KEY = 'jobs:watch:open';
const RETRY_KEY = 'jobs:watch:retry';
const COLD_LOOKBACK = 300;      // ~7 weeks of this kernel on a first run
const MAX_PER_TICK = 120;       // a burst is read over several ticks
const OPEN_FOR = 10 * 24 * 3600 * 1000;
const RETRY_FOR = 6 * 3600 * 1000;

// rpc(method, params) — any eth_call-capable reader.
export async function watchFundedJobs(env, rpc) {
  const account = providerAccount(env);
  if (!account) return { ok: false, error: 'no provider key' };
  const me = account.address.toLowerCase();
  const counter = Number(BigInt(await rpc('eth_call', [{ to: ERC8183.commerce, data: '0x50355d76' }, 'latest'])));
  const stored = Number(await env.AGENT.get(CURSOR_KEY)) || 0;
  const from = stored ? stored + 1 : Math.max(1, counter - COLD_LOOKBACK);
  const to = Math.min(counter, from + MAX_PER_TICK - 1);

  const open = JSON.parse((await env.AGENT.get(OPEN_KEY)) || '{}');
  const retry = JSON.parse((await env.AGENT.get(RETRY_KEY)) || '{}');
  const toDeliver = new Set(Object.keys(retry));
  const nextOpen = {};
  const seen = [];

  // New ids since the last tick.
  for (let id = from; id <= to; id++) {
    const job = await readJob(id);
    if (!job || String(job.provider).toLowerCase() !== me) continue;
    seen.push({ id, status: job.status });
    if (job.status === 'FUNDED') toDeliver.add(String(id));
    else if (job.status === 'OPEN') nextOpen[id] = Date.now();
  }
  // Ours that were created unfunded: funded since?
  for (const [id, since] of Object.entries(open)) {
    if (nextOpen[id]) continue;
    const job = await readJob(id);
    if (job?.status === 'FUNDED') toDeliver.add(String(id));
    else if (job?.status === 'OPEN' && Date.now() - since < OPEN_FOR) nextOpen[id] = since;
    else if (!job && Date.now() - since < OPEN_FOR) nextOpen[id] = since;   // read failed: keep
  }

  const results = [];
  const nextRetry = {};
  for (const jobId of toDeliver) {
    const r = await deliverJob(jobId, env).catch((e) => ({ error: String(e?.message || e) }));
    results.push({ job_id: jobId, delivered: !!r.result?.delivered, already: !!r.result?.already_delivered, error: r.error || null });
    const since = retry[jobId] || Date.now();
    if (r.error && !r.permanent && Date.now() - since < RETRY_FOR) nextRetry[jobId] = since;
  }

  // Writes only when something changed: the cursor moves about six times a
  // day, the two lists only when one of our jobs is involved.
  if (to >= from && to !== stored) await env.AGENT.put(CURSOR_KEY, String(to));
  if (JSON.stringify(open) !== JSON.stringify(nextOpen)) await env.AGENT.put(OPEN_KEY, JSON.stringify(nextOpen));
  if (JSON.stringify(retry) !== JSON.stringify(nextRetry)) await env.AGENT.put(RETRY_KEY, JSON.stringify(nextRetry));
  if (results.length || seen.length) await env.AGENT.put('jobs:watch:last', JSON.stringify({ at: new Date().toISOString(), from, to, seen, results }), { expirationTtl: 60 * 60 * 24 * 30 });
  return { ok: true, counter, from, to, seen, results, open: Object.keys(nextOpen) };
}
