// Our own ERC-8183 jobs, read once a day and written down when they change.
//
// The escrow on this kernel does not release itself: after the dispute
// window somebody has to call settle(jobId) on the EvaluatorRouter, and
// almost nobody does — 287 SUBMITTED against 8 COMPLETED in the last four
// hundred jobs. Our jobs sit in that 287, and a marketplace that argues the
// number is inflated had better be able to show the date its own jobs left it.
//
// So the cron reads every job we have made or delivered, classifies it with
// the same rule the script and the page use (shared/own-jobs.js), and appends
// a transition to KV when one happens. GET /jobs/own serves the record; the
// script's --sync merges it into data/erc8183/own-jobs.json. One KV read and
// at most one write per day. It reads. It signs nothing — settling is a
// person's call, and the script prints it for them.
import { decodeJob, readDisputeWindow, ERC8183 } from './hire.js';
import { classify, recordTransition, summarise } from '../shared/own-jobs.js';
import { createWalletClient, createPublicClient, http, fallback } from 'viem';
import { bsc } from 'viem/chains';
import { providerAccount } from './submit.js';
import { readOpinions } from './second-opinion.js';

// SETTLED BY US, NOT LEFT TO CHANCE (2026-10-14, operator's go). A job's escrow releases only when somebody calls
// router.settle(jobId) after the dispute window, and nearly nobody does (27,230 jobs on the kernel sit SUBMITTED). A
// stranger who hires one of our agents and never settles leaves the job SUBMITTED for ever: the hire never counts as
// completed (Set and Earn wants completed hires) and the $U never reaches the provider. So every job this worker has
// made or delivered whose window is over is settled from the provider wallet — simulated first, sent only when the
// simulation goes through, at most five a day, 0.1 gwei. A job the provider may not settle fails the simulation and
// nothing is sent. Every attempt is written to jobs:settled (GET /jobs/own shows it).
const SETTLE_KEY = 'jobs:settled';
const settleData = (id) => '0x39c2ebb9' + BigInt(id).toString(16).padStart(64, '0') + (64).toString(16).padStart(64, '0') + '0'.padStart(64, '0');
const RPC_LIST = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-rpc.publicnode.com'];
export async function settleDue(env, rows, { max = 5 } = {}) {
  const account = providerAccount(env);
  const due = rows.filter((r) => r.state === 'settleable').slice(0, max);
  if (!account || !due.length) return [];
  const transport = fallback(RPC_LIST.map((u) => http(u, { timeout: 20000 })));
  const pub = createPublicClient({ chain: bsc, transport }), wal = createWalletClient({ account, chain: bsc, transport });
  const out = [];
  for (const r of due) {
    const data = settleData(r.id), at = new Date().toISOString();
    try { await pub.call({ account, to: ERC8183.router, data }); }
    catch (e) { out.push({ id: r.id, at, settled: false, why: `the simulation refused: ${String(e.shortMessage || e.message).slice(0, 120)}` }); continue; }
    try {
      const hash = await wal.sendTransaction({ to: ERC8183.router, data, gasPrice: 100000000n });
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 60000 });
      out.push({ id: r.id, at, settled: rc.status === 'success', tx: hash });
    } catch (e) { out.push({ id: r.id, at, settled: false, why: String(e.shortMessage || e.message).slice(0, 160) }); }
  }
  try { const prev = JSON.parse((await env.AGENT.get(SETTLE_KEY)) || '[]'); await env.AGENT.put(SETTLE_KEY, JSON.stringify([...out, ...prev].slice(0, 100))); } catch { /* the record is a log, the settle stands either way */ }
  return out;
}
export async function readSettled(env) { try { return JSON.parse((await env.AGENT.get(SETTLE_KEY)) || '[]'); } catch { return []; } }

export const KV_KEY = 'jobs:own';
const JOB_CALL = (id) => '0xbf22c457' + BigInt(id).toString(16).padStart(64, '0');

export async function readOwnJobs(env) {
  const raw = await env.AGENT.get(KV_KEY);
  return raw ? JSON.parse(raw) : null;
}

// `ids` may extend the list (from /own-jobs with the shared secret); the tick
// on its own reads whatever is already recorded.
export async function tickOwnJobs(env, rpc, ids = []) {
  const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
  const prev = (await readOwnJobs(env)) || { jobs: {}, checked_at: null };
  // EVERY JOB THIS WORKER DELIVERED IS WATCHED (2026-09-18). The list was the
  // previous record plus ids posted by hand — a job a STRANGER hired and we
  // delivered never entered it. Four of them sat SUBMITTED with their dispute
  // windows long over (56668, 56699, 56711, 56712: 0.40 $U of strangers' money
  // waiting for settle()) while this route answered "settleable: []". The
  // seller stores each deliverable under job:<id>; those keys are the list.
  let delivered = [];
  try {
    let cursor; do {
      const page = await env.AGENT.list({ prefix: 'job:', limit: 1000, ...(cursor ? { cursor } : {}) });
      delivered.push(...page.keys.map((k) => k.name.slice(4)));
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
  } catch { delivered = []; }
  // and every second opinion we bought (2026-10-18: job 57021 was paid while its caller had stopped waiting and never
  // reached this list; its row in the opinion log is now written as soon as the hire goes out)
  let bought = [];
  try { bought = (await readOpinions(env)).map((o) => o.job).filter(Boolean); } catch { bought = []; }
  const all = [...new Set([...Object.keys(prev.jobs), ...delivered, ...bought, ...ids.map(String)])].filter((x) => /^\d+$/.test(x));
  if (!all.length) return { ok: false, error: 'no job ids recorded yet — POST /own-jobs with the secret and {"ids":[…]}' };

  const windowSec = await readDisputeWindow(call);
  const now = Math.floor(Date.now() / 1000);
  const at = new Date().toISOString();
  let record = prev.jobs;
  let changes = 0;
  const rows = [];
  for (const id of all) {
    let job = null;
    try { job = decodeJob(await call(ERC8183.commerce, JOB_CALL(id))); } catch { job = null; }
    // A read that failed is not a state of the job: it used to be written into
    // the job's permanent history as a transition to "unknown".
    if (!job) { rows.push({ id, status: null, state: 'unread', note: 'the kernel did not answer for this job on this tick' }); continue; }
    const c = classify(job, { now, windowSec });
    const snap = { status: job?.status || null, state: c.state, budget_u: job?.budget_u ?? null, submitted_at: job?.submitted_at ?? null, ends_at: c.ends_at ?? null };
    const out = recordTransition(record, id, snap, at);
    record = out.record;
    if (out.changed) changes++;
    // who paid and who delivered (2026-10-20): the front page's "Works with us" line counts the jobs of each partner
    if (record[id].client !== job.client || record[id].provider !== job.provider) {
      record = { ...record, [id]: { ...record[id], client: job.client, provider: job.provider } };
      changes++;
    }
    rows.push({ id, status: snap.status, state: c.state, note: c.note });
  }
  const next = { jobs: record, checked_at: at, dispute_window_sec: windowSec, summary: summarise(record, at) };
  if (changes || !prev.checked_at) await env.AGENT.put(KV_KEY, JSON.stringify(next));
  else await env.AGENT.put(KV_KEY, JSON.stringify({ ...prev, checked_at: at, summary: summarise(record, at) }));
  // settle what is due (a settled job is read as COMPLETED on the next tick)
  const settled = await settleDue(env, rows).catch((e) => [{ settled: false, why: String(e && e.message || e).slice(0, 120) }]);
  return { ok: true, jobs: all.length, transitions: changes, rows, settled };
}
