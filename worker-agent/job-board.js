// worker-agent/job-board.js — the job board, kept fresh by the worker (2026-10-22)
//
// The ranking itself is shared/job-board.js. This file keeps its input current without the 25-minute offline census:
// the census seeds every job that is not the farm's (scripts/job-board-seed.mjs, ~860 jobs), and once a day at 21:45
// UTC — after the public settle, so the jobs it released read COMPLETED — the worker reads every job minted since
// (the kernel mints about six a day) and every stored job that can still change (open, funded, delivered: ~500),
// 50 to a JSON-RPC batch, and writes the board. A job no node would read keeps its last state and is counted in
// the run's `unread`; the cursor stops before the first unread new id, so it is read again the next day.
//
//   jobboard:jobs   { id: packed job }  (shared/job-board.js pack)
//   jobboard:meta   { cursor, farms, farm, names, seeded_at }
//   jobboard:board  what GET /jobs/board serves

import { buildBoard, pack, live } from '../shared/job-board.js';
import { batchRead } from './public-settle.js';
import { ERC8183 } from './hire.js';
import { OWN_WALLETS } from './own-wallets.js';

const JOBS_KEY = 'jobboard:jobs', META_KEY = 'jobboard:meta', BOARD_KEY = 'jobboard:board';
const MAX_NEW = 1500;   // a burst of new jobs is read over several days
const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-rpc.publicnode.com'];

export const jobBoardDue = (d) => d.getUTCHours() === 21 && d.getUTCMinutes() >= 45;

async function jobCounter() {
  for (const u of RPCS) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: ERC8183.commerce, data: '0x50355d76' }, 'latest'] }), signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      if (j.result && j.result !== '0x') return Number(BigInt(j.result));
    } catch { /* next node */ }
  }
  return null;
}

// body: { jobs: { id: packed }, cursor, farms, farm, names } from the census.
export async function seedJobBoard(env, body) {
  const jobs = body && typeof body.jobs === 'object' ? body.jobs : null;
  if (!jobs || !Number(body.cursor)) return { ok: false, error: 'jobs and cursor required' };
  await env.AGENT.put(JOBS_KEY, JSON.stringify(jobs));
  await env.AGENT.put(META_KEY, JSON.stringify({ cursor: Number(body.cursor), farms: (body.farms || []).map((f) => String(f).toLowerCase()), farm: body.farm || null, names: body.names || {}, seeded_at: new Date().toISOString(), census_at: body.census_at || null }));
  return { ok: true, jobs: Object.keys(jobs).length, cursor: Number(body.cursor) };
}

export async function runJobBoard(env, { now = new Date() } = {}) {
  const meta = JSON.parse((await env.AGENT.get(META_KEY)) || 'null');
  if (!meta) return { ok: false, error: 'not seeded' };
  const jobs = JSON.parse((await env.AGENT.get(JOBS_KEY)) || '{}');
  const sec = Math.floor(now.getTime() / 1000);
  const counter = await jobCounter();
  if (!counter) return { ok: false, error: 'the job counter could not be read' };
  const to = Math.min(counter, meta.cursor + MAX_NEW);
  const fresh = [];
  for (let id = meta.cursor + 1; id <= to; id++) fresh.push(String(id));
  const again = Object.keys(jobs).filter((id) => live(jobs[id], sec));
  // the keyed node first (public nodes answer a run of 50-call batches with rate-limit errors: 500 of 528 unread on
  // the first run, 22.10.), then whatever it left unread from the public ones
  let read = env.BSC_RPC_KEYED_URL_2 ? await batchRead([...fresh, ...again], env.BSC_RPC_KEYED_URL_2) : await batchRead([...fresh, ...again]);
  const missed = read.filter((x) => !x.job).map((x) => x.id);
  if (missed.length && env.BSC_RPC_KEYED_URL_2) {
    const got = Object.fromEntries((await batchRead(missed)).map((x) => [x.id, x.job]));
    read = read.map((x) => (x.job ? x : { id: x.id, job: got[x.id] || null }));
  }
  const farms = new Set(meta.farms || []);
  let unreadNew = 0, unreadOld = 0, changed = 0, farmNew = 0;
  for (const { id, job } of read) {
    const isNew = Number(id) > meta.cursor;
    if (!job) { if (isNew) unreadNew++; else unreadOld++; continue; }
    if (farms.has(String(job.provider).toLowerCase())) { if (isNew) farmNew++; continue; }
    const p = pack(job);
    if (!jobs[id] || jobs[id][2] !== p[2]) changed++;
    jobs[id] = p;
  }
  // the cursor moves only over ids that were read: an unread new id is read again tomorrow
  const firstUnread = read.find((x) => !x.job && Number(x.id) > meta.cursor);
  const cursor = firstUnread ? Number(firstUnread.id) - 1 : to;
  const board = buildBoard(jobs, { ours: OWN_WALLETS, names: meta.names, farms: meta.farms, now: sec });
  const run = { at: now.toISOString(), job_counter: counter, read_through: cursor, new_read: fresh.length - unreadNew, reread: again.length - unreadOld, unread: unreadNew + unreadOld, changed, farm_new: farmNew };
  await env.AGENT.put(JOBS_KEY, JSON.stringify(jobs));
  await env.AGENT.put(META_KEY, JSON.stringify({ ...meta, cursor, farm_new: (meta.farm_new || 0) + farmNew }));
  await env.AGENT.put(BOARD_KEY, JSON.stringify({ measured_at: now.toISOString(), run, jobs_held: Object.keys(jobs).length, farm: meta.farm ? { ...meta.farm, new_since_census: (meta.farm_new || 0) + farmNew } : null, census_at: meta.census_at, ...board }));
  return { ok: true, ...run };
}

export async function readJobBoard(env) {
  return JSON.parse((await env.AGENT.get(BOARD_KEY)) || 'null');
}
