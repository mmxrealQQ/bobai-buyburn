// Finding our funded jobs on the chain, without being told.
//
// BNB's standard hire never sends notify_funded: the buyer signs createJob and
// fund, and the reference seller watches the kernel for a JobFunded naming it.
// Every marketplace in the Set and Earn shortlist that runs on the BNB Agent
// SDK hires that way, so a seller that only listens for the message keeps the
// buyer's money in escrow until it expires and delivers nothing.
//
// Each cron tick reads JobFunded(jobId, client, provider, amount) with our
// provider address as the third topic, from the block after the last one
// read, and hands every job it finds to deliverJob() — the same path
// notify_funded takes, which reads the job from the chain and refuses
// anything not funded, not ours, not evaluated by the router, or under the
// price. A job already delivered is skipped there, so reading a block twice
// costs nothing but a read.
//
// topic0 = keccak256("JobFunded(uint256,address,address,uint256)"), checked
// against the live kernel on 2026-10-04 (15 events in the last 400k blocks).
import { ERC8183 } from './hire.js';
import { deliverJob } from './sell.js';
import { providerAccount } from './submit.js';

const JOB_FUNDED = '0xbdb056de345bfeadca7c9fd7df6430bdb83c677c8eefbb601dff56f34d3dac52';
const CURSOR_KEY = 'jobs:watch:block';
const RETRY_KEY = 'jobs:watch:retry';
// About 37 minutes of BSC at 0.45 s blocks: two missed ticks are caught up in
// one, and a range this size is inside what the public logs endpoint serves.
const MAX_RANGE = 5000;
// A cold start looks back this far, so a job funded just before the first
// deploy is not lost.
const COLD_LOOKBACK = 20000;

const hex = (n) => '0x' + n.toString(16);
const topicOf = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

// rpc(method, params) — the worker's logs-capable reader is passed in.
export async function watchFundedJobs(env, rpc) {
  const account = providerAccount(env);
  if (!account) return { ok: false, error: 'no provider key' };
  const head = Number(BigInt(await rpc('eth_blockNumber', [])));
  const stored = Number(await env.AGENT.get(CURSOR_KEY)) || 0;
  const from = stored ? stored + 1 : head - COLD_LOOKBACK;
  if (from > head) return { ok: true, from, head, found: [] };
  const found = [];
  let to = from - 1;
  // Walk forward in MAX_RANGE steps up to the head (a cold start is four
  // steps), writing the cursor once at the end — one KV write per tick.
  while (to < head) {
    const lo = to + 1;
    to = Math.min(head, lo + MAX_RANGE - 1);
    const logs = await rpc('eth_getLogs', [{ address: ERC8183.commerce, fromBlock: hex(lo), toBlock: hex(to), topics: [JOB_FUNDED, null, null, topicOf(account.address)] }]);
    for (const l of logs || []) found.push(String(BigInt(l.topics[1])));
  }
  // A job whose delivery failed (an RPC hiccup at submit, a read that timed
  // out) is tried again on the next ticks for six hours, then left to the
  // escrow's expiry, which refunds the buyer.
  const retry = JSON.parse((await env.AGENT.get(RETRY_KEY)) || '{}');
  const results = [];
  const nextRetry = {};
  for (const jobId of [...new Set([...found, ...Object.keys(retry)])]) {
    const r = await deliverJob(jobId, env).catch((e) => ({ error: String(e?.message || e) }));
    results.push({ job_id: jobId, delivered: !!r.result?.delivered, already: !!r.result?.already_delivered, error: r.error || null });
    const since = retry[jobId] || Date.now();
    if (r.error && Date.now() - since < 6 * 3600 * 1000) nextRetry[jobId] = since;
  }
  if (Object.keys(retry).length || Object.keys(nextRetry).length) await env.AGENT.put(RETRY_KEY, JSON.stringify(nextRetry));
  // The cursor moves only after the deliveries were attempted: a tick that
  // dies mid-way reads the same blocks again next time, and deliverJob's lock
  // and "already delivered" check make that harmless.
  await env.AGENT.put(CURSOR_KEY, String(head));
  if (results.length) await env.AGENT.put('jobs:watch:last', JSON.stringify({ at: new Date().toISOString(), from, head, results }), { expirationTtl: 60 * 60 * 24 * 30 });
  return { ok: true, from, head, found: results };
}
