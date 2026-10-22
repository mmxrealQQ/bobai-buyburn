// The job board's starting point, from the job census (2026-10-22). See worker-agent/job-board.js.
//
// Every job of data/erc8183/jobs.jsonl that is not the farm's goes to the worker packed (shared/job-board.js), with
// the census cursor, the farm's own figures for its line, and the agent names the census resolved per provider.
// After that the worker keeps it fresh by itself, once a day.
//
// Usage:
//   node scripts/job-board-seed.mjs            plan: what would be sent, and the board it gives today
//   node scripts/job-board-seed.mjs --send     send it (HIT_SECRET from .env), then run the worker once and read back
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJobs } from './lib/job-aggregate.mjs';
import { buildBoard, pack } from '../shared/job-board.js';
import { OWN_WALLETS } from '../worker-agent/own-wallets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'data', 'erc8183');
const AGENT = 'https://agent.brainonbnb.com';
const FARM = '0xc0d7d888d8ff8925dc95fbb16c89217718bf7c8d';   // the campaign address of the census (job-aggregate.mjs withoutTopProvider)
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));

const state = JSON.parse(fs.readFileSync(path.join(DIR, 'scan-state.json'), 'utf8'));
if (state.unread || state.cursor - 1 !== state.jobCounter) { console.error('the census is not complete — run scripts/erc8183-job-scan.mjs first'); process.exit(1); }
const all = loadJobs(path.join(DIR, 'jobs.jsonl'));
const owners = JSON.parse(fs.readFileSync(path.join(DIR, 'owners.json'), 'utf8')).owners;

const jobs = {}, names = {};
const farm = { address: FARM, jobs: 0, completed: 0, clients: new Set(), paid_u: 0, last_delivery: 0 };
for (const j of all.values()) {
  const p = j.provider.toLowerCase();
  if (p === FARM) {
    farm.jobs++; farm.clients.add(j.client.toLowerCase());
    if (j.status === 'COMPLETED' && BigInt(j.budget || 0) > 0n) { farm.completed++; farm.paid_u += Number(BigInt(j.budget)) / 1e18; }
    if (j.submitted_at > farm.last_delivery) farm.last_delivery = j.submitted_at;
    continue;
  }
  jobs[j.id] = pack(j);
  if (owners[p] && !names[p]) names[p] = owners[p].slice(0, 6).map((a) => ({ id: a.id, name: String(a.name || '').slice(0, 60) }));
}
const farmOut = { address: FARM, jobs: farm.jobs, completed: farm.completed, clients: farm.clients.size, paid_u: Number(farm.paid_u.toFixed(2)), last_delivery: new Date(farm.last_delivery * 1000).toISOString() };
const body = { jobs, cursor: state.jobCounter, farms: [FARM], farm: farmOut, names, census_at: state.finishedAt };

const board = buildBoard(jobs, { ours: OWN_WALLETS, names, farms: [FARM] });
console.log(`census ${state.finishedAt}: ${Object.keys(jobs).length} jobs besides the farm (${farm.jobs} of its own), cursor ${state.jobCounter}, ${JSON.stringify(body).length} bytes`);
console.log('farm', JSON.stringify(farmOut));
console.log('30 days', JSON.stringify(board.totals_30d));
for (const r of board.ranking.slice(0, 8)) console.log(`${r.rank}. ${r.provider.slice(0, 10)} ${r.agents.map((a) => a.name).join(', ') || (r.ours ? 'ours' : '-')}: delivered ${r.delivered_30d}, paid ${r.paid_30d}, clients ${r.clients_30d} · ever paid ${r.paid_ever} ($U ${r.paid_ever_u})`);

if (process.argv.includes('--send')) {
  const post = (p, b) => fetch(AGENT + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hit-secret': env.HIT_SECRET }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
  console.log('seed', JSON.stringify(await post('/jobs/board/seed', body)));
  console.log('run', JSON.stringify(await post('/jobs/board/run')));
  const live = await fetch(AGENT + '/jobs/board').then((r) => r.json());
  console.log('live', live.measured_at, JSON.stringify(live.totals_30d), 'ranked', live.ranking?.length);
}
