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
  const all = [...new Set([...Object.keys(prev.jobs), ...ids.map(String)])].filter((x) => /^\d+$/.test(x));
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
    const c = classify(job, { now, windowSec });
    const snap = { status: job?.status || null, state: c.state, budget_u: job?.budget_u ?? null, submitted_at: job?.submitted_at ?? null, ends_at: c.ends_at ?? null };
    const out = recordTransition(record, id, snap, at);
    record = out.record;
    if (out.changed) changes++;
    rows.push({ id, status: snap.status, state: c.state, note: c.note });
  }
  const next = { jobs: record, checked_at: at, dispute_window_sec: windowSec, summary: summarise(record, at) };
  if (changes || !prev.checked_at) await env.AGENT.put(KV_KEY, JSON.stringify(next));
  else await env.AGENT.put(KV_KEY, JSON.stringify({ ...prev, checked_at: at, summary: summarise(record, at) }));
  return { ok: true, jobs: all.length, transitions: changes, rows };
}
