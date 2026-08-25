// ERC-8183 employment census on BNB Smart Chain.
//
// The identity census answered "how many agents are registered". This one
// answers the question that actually decides whether hiring an agent is a real
// thing on this chain: how many of them have ever been PAID, by whom, for how
// much, and whether the work was delivered.
//
// The kernel's jobCounter() reads 56,655. That number gets quoted as proof of a
// working agent economy. It is not one. A job id exists the moment somebody
// calls createJob — before any money is escrowed, before a provider agrees,
// before anything is delivered. Reading every single job is the only way to say
// what the 56,655 are made of, and this script reads every single job.
//
// Design notes carried over from the identity census, all of them earned:
//
//   Batched eth_call, 25 per request, endpoints rotated. 40 per batch trips the
//   rate limiter on this chain; 25 goes through.
//
//   A refused batch is a fact about a node, not about a job. Refusals go on a
//   retry list and are drained patiently at the end. Anything still unread
//   after that is reported as unread rather than folded into a percentage.
//
//   Progress is written continuously and the run resumes from it.
//
//   SUBMITTED IS NOT COMPLETED. The kernel's status enum has both, and in the
//   tail of the job list SUBMITTED outnumbers COMPLETED by roughly 35 to 1. A
//   deliverable on-chain whose escrow never released is not finished work, and
//   counting it as such is how a reputation number becomes a lie.
//
// Usage:
//   node scripts/erc8183-job-scan.mjs            scan (resumes automatically)
//   node scripts/erc8183-job-scan.mjs --max 500  stop after this job id
//   node scripts/erc8183-job-scan.mjs --owners   resolve provider addresses to agent ids
//   node scripts/erc8183-job-scan.mjs --report   employment balance per provider
import fs from 'node:fs';
import path from 'node:path';
import { ERC8183, decodeJob, JOB_STATUS } from '../worker-agent/hire.js';
// Aggregation lives in one place so the terminal report and the published page
// can never state different numbers for the same measurement.
import { loadJobs, aggregate } from './lib/job-aggregate.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'data', 'erc8183');
const JOBS_FILE = path.join(OUT, 'jobs.jsonl');
const STATE_FILE = path.join(OUT, 'scan-state.json');
const OWNERS_FILE = path.join(OUT, 'owners.json');
const CENSUS_HITS = path.join(ROOT, 'data', 'erc8004', 'agents-with-endpoints.jsonl');

// getJob(uint256) 0xbf22c457 · jobCounter() 0x50355d76 · ownerOf(uint256) 0x6352211e
const SEL_GET_JOB = '0xbf22c457';
const SEL_JOB_COUNTER = '0x50355d76';
const SEL_OWNER_OF = '0x6352211e';

// The same list the identity census uses: every one of them was verified to
// answer a batched eth_call against a BSC contract. Breadth is the throughput
// lever, because each node rate-limits independently.
const RPCS = [
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-mainnet.public.blastapi.io',
  'https://bsc-dataseed.binance.org',
  'https://bsc.publicnode.com',
  'https://bsc-dataseed2.defibit.io',
  'https://bsc-dataseed3.defibit.io',
  'https://bsc-dataseed4.defibit.io',
  'https://bsc-dataseed1.ninicoin.io',
  'https://bsc-dataseed2.bnbchain.org',
  'https://bsc-dataseed3.bnbchain.org',
  'https://bsc-dataseed4.bnbchain.org',
];
const BATCH = 25;
const CONCURRENCY = 8;

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

let rr = 0;
const nextRpc = () => RPCS[rr++ % RPCS.length];
const id32 = (n) => BigInt(n).toString(16).padStart(64, '0');

let pause = 0;
const breathe = async () => { if (pause > 0) await new Promise((r) => setTimeout(r, pause)); };

// One batched eth_call against `to`, one call per id. Returns an array aligned
// with `ids`, null where the node declined that particular entry.
async function callBatch(to, selector, ids, { patient = false } = {}) {
  const payload = ids.map((id, i) => ({
    jsonrpc: '2.0', id: i, method: 'eth_call',
    params: [{ to, data: selector + id32(id) }, 'latest'],
  }));
  const rounds = patient ? RPCS.length * 3 : RPCS.length;
  for (let attempt = 0; attempt < rounds; attempt++) {
    await breathe();
    const url = nextRpc();
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) { pause = Math.min(2000, pause + 120); continue; }
      const j = await r.json();
      if (!Array.isArray(j)) { pause = Math.min(2000, pause + 120); continue; }
      const out = new Array(ids.length).fill(null);
      let got = 0;
      for (const item of j) {
        if (typeof item.id !== 'number') continue;
        if (item.error) continue; // node refused THAT call — retry it, do not record it
        out[item.id] = item.result;
        got++;
      }
      if (got === 0) { pause = Math.min(2000, pause + 120); continue; }
      if (got === ids.length) pause = Math.max(0, pause - 25);
      return out;
    } catch { pause = Math.min(2000, pause + 120); }
    if (patient) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return new Array(ids.length).fill(null);
}

async function readJobCounter() {
  for (let attempt = 0; attempt < RPCS.length * 2; attempt++) {
    try {
      const r = await fetch(nextRpc(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call',
          params: [{ to: ERC8183.commerce, data: SEL_JOB_COUNTER }, 'latest'] }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json();
      if (j.result && j.result !== '0x') return Number(BigInt(j.result));
    } catch { /* try the next endpoint */ }
  }
  throw new Error('jobCounter() unreadable on every endpoint');
}

// ---------------------------------------------------------------- storage

fs.mkdirSync(OUT, { recursive: true });

const loadState = () => {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch {
    return {
      cursor: 1, jobCounter: null, unread: 0,
      startedAt: null, updatedAt: null, finishedAt: null,
    };
  }
};
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

// A job id that does not exist does NOT revert. The kernel returns a zero-filled
// struct, which decodes into a perfectly plausible OPEN job with a zero client
// and a zero budget — measured: id 56,656 reads exactly like an unfunded job.
// Recording those would inflate the census with phantoms that no eye would
// catch, so a row is only kept when the struct reports back the id we asked for.
const isRealJob = (job, requestedId) => job && Number(job.id) === requestedId;

// One compact line per job. The description is kept because it is where the
// competition signs its own name — several jobs carry "platform":"termix" or
// "Hire via Agents Marketplace" — but truncated, because 56k full descriptions
// is a file nobody opens twice.
const jobLine = (j) => JSON.stringify({
  id: Number(j.id),
  client: j.client,
  provider: j.provider,
  evaluator: j.evaluator,
  budget: j.budget,
  status: j.status,
  expired_at: j.expired_at,
  submitted_at: j.submitted_at,
  desc: (j.description || '').slice(0, 240),
});

// ---------------------------------------------------------------- owners

// A job names a provider ADDRESS. A marketplace listing names an agent ID.
// Joining the two needs ownerOf() on the identity registry — the same registry
// the identity census read, which is the whole reason the join is possible at
// all.
//
// Resolved for the agents that carry an endpoint, i.e. exactly the population a
// marketplace could list. That is a deliberate limit, not an oversight:
// resolving all 285,447 ids costs another full-registry pass and would only add
// owners of agents nobody can reach. The coverage is printed in the report
// rather than hidden.
async function resolveOwners() {
  if (!fs.existsSync(CENSUS_HITS)) {
    console.log(`no census hits at ${path.relative(ROOT, CENSUS_HITS)} — run erc8004-scan.mjs first`);
    return;
  }
  const agents = fs.readFileSync(CENSUS_HITS, 'utf8').trim().split('\n')
    .filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  console.log(`resolving owners for ${agents.length} agents with endpoints…`);

  const byOwner = {};
  let unread = 0;
  for (let i = 0; i < agents.length; i += BATCH * CONCURRENCY) {
    const groups = [];
    for (let g = 0; g < CONCURRENCY; g++) {
      const slice = agents.slice(i + g * BATCH, i + (g + 1) * BATCH);
      if (slice.length) groups.push(slice);
    }
    if (!groups.length) break;
    const results = await Promise.all(groups.map((slice) =>
      callBatch(ERC8183.registry, SEL_OWNER_OF, slice.map((a) => a.id), { patient: true })));
    for (let gi = 0; gi < groups.length; gi++) {
      for (let k = 0; k < groups[gi].length; k++) {
        const raw = results[gi][k];
        if (!raw || raw === '0x') { unread++; continue; }
        const owner = ('0x' + raw.slice(-40)).toLowerCase();
        (byOwner[owner] ||= []).push({ id: groups[gi][k].id, name: groups[gi][k].name });
      }
    }
    process.stdout.write(`\r  ${Math.min(i + BATCH * CONCURRENCY, agents.length)} / ${agents.length}`);
  }
  console.log();
  fs.writeFileSync(OWNERS_FILE, JSON.stringify({
    resolvedAt: new Date().toISOString(),
    population: 'ERC-8004 agents carrying an http endpoint',
    agents: agents.length, unread, owners: byOwner,
  }, null, 2));
  console.log(`${Object.keys(byOwner).length} distinct owners over ${agents.length - unread} agents -> ${path.relative(ROOT, OWNERS_FILE)}`);
}

// ---------------------------------------------------------------- report

const fmt = (n) => Number(n).toLocaleString('en-US');

function report() {
  if (!fs.existsSync(JOBS_FILE)) { console.log('nothing scanned yet'); return; }
  const state = loadState();
  const a = aggregate(loadJobs(JOBS_FILE));

  let owners = null;
  try { owners = JSON.parse(fs.readFileSync(OWNERS_FILE, 'utf8')); } catch { /* optional */ }
  const nameOf = (addrLower) => {
    const list = owners?.owners?.[addrLower];
    if (!list?.length) return null;
    const named = list.find((x) => x.name) || list[0];
    return `#${named.id}${named.name ? ' ' + named.name : ''}${list.length > 1 ? ` (+${list.length - 1} more)` : ''}`;
  };

  console.log(`\nERC-8183 employment census — BNB Smart Chain`);
  console.log(`kernel ${ERC8183.commerce}  ·  payment token $U ${ERC8183.paymentToken}`);
  console.log(`jobCounter(): ${state.jobCounter ? fmt(state.jobCounter) : '(unknown)'}   read: ${fmt(a.total)}${state.unread ? `   unread: ${fmt(state.unread)}` : ''}\n`);

  console.log('  status of every job in the kernel');
  const known = new Set(JOB_STATUS);
  for (const s of [...JOB_STATUS, ...Object.keys(a.byStatus).filter((k) => !known.has(k))]) {
    const n = a.byStatus[s] || 0;
    if (!n && !known.has(s)) continue;
    console.log(`    ${s.padEnd(12)} ${String(fmt(n)).padStart(9)}  ${((n / a.total) * 100).toFixed(2).padStart(6)}%`);
  }
  console.log(`\n    escrow actually released on ${fmt(a.completed)} of ${fmt(a.total)} jobs (${((a.completed / a.total) * 100).toFixed(2)}%).`);
  console.log(`    ${fmt(a.submitted)} carry a deliverable that was never released.`);
  console.log(`    ${fmt(a.fundedJobs)} jobs were ever funded; ${a.escrowedU.toFixed(2)} $U escrowed in total.`);
  console.log(`    ${fmt(a.buyers)} distinct buyers, ${fmt(a.providers.length)} distinct providers.`);
  console.log(`    ${fmt(a.providersWithRealWork)} providers ever completed a job for more than one buyer.\n`);

  const top = Number(arg('--top', 15));
  console.log(`  employment balance — top ${Math.min(top, a.providers.length)} providers by jobs\n`);
  for (const r of a.providers.slice(0, top)) {
    const name = nameOf(r.address);
    console.log(`  ${r.address}${name ? `  ${name}` : ''}`);
    console.log(`    ${String(fmt(r.jobs)).padStart(7)} jobs · ${fmt(r.funded)} funded · ${fmt(r.completed)} completed · ${fmt(r.submitted_not_released)} submitted-not-released · ${fmt(r.expired)} expired · ${fmt(r.rejected)} rejected`);
    console.log(`    ${fmt(r.distinct_buyers)} distinct buyers · ${r.escrowed_u.toFixed(2)} $U escrowed · median budget ${r.median_budget_u.toFixed(4)} $U · job ids ${fmt(r.first_job_id)}–${fmt(r.last_job_id)}`);
    console.log(`    delivery rate ${(r.delivery_rate * 100).toFixed(1)}% of funded jobs`);
    if (r.samples[0]) console.log(`    e.g. ${JSON.stringify(r.samples[0].slice(0, 110))}`);
    console.log();
  }

  // The concentration number is the headline. If a handful of addresses hold
  // most of the job history, "56,655 jobs" describes a few deployments talking
  // to each other, not a market.
  console.log(`  concentration: top provider holds ${(a.concentration.top_provider_share * 100).toFixed(1)}% of all jobs, top 5 hold ${(a.concentration.top5_share * 100).toFixed(1)}%.`);
  if (owners) {
    const matched = a.providers.filter((r) => owners.owners?.[r.address]).length;
    console.log(`  identity join: ${matched} of ${a.providers.length} provider addresses map to a registered agent that carries an endpoint (population: ${fmt(owners.agents)} agents).`);
  } else {
    console.log(`  identity join: not resolved — run with --owners to map provider addresses to agent ids.`);
  }
  console.log();
}
// ---------------------------------------------------------------- main

if (args.includes('--owners')) { await resolveOwners(); process.exit(0); }
if (args.includes('--report')) { report(); process.exit(0); }

const state = loadState();
if (!state.startedAt) state.startedAt = new Date().toISOString();
if (!state.jobCounter) {
  process.stdout.write('reading jobCounter()… ');
  state.jobCounter = await readJobCounter();
  console.log(fmt(state.jobCounter));
  saveState(state);
}

const limit = Math.min(Number(arg('--max', state.jobCounter)) || state.jobCounter, state.jobCounter);
const out = fs.createWriteStream(JOBS_FILE, { flags: 'a' });
const pendingRetry = [];
// Ids whose struct came back empty — the id does not exist. Expected to be zero
// for a range of 1..jobCounter(); anything else means the counter and the
// storage disagree, which is worth seeing rather than absorbing.
let absent = 0;

console.log(`scanning jobs ${fmt(state.cursor)} … ${fmt(limit)}`);
const t0 = Date.now();
let sinceLog = 0;

while (state.cursor <= limit) {
  const groups = [];
  for (let g = 0; g < CONCURRENCY && state.cursor + g * BATCH <= limit; g++) {
    const start = state.cursor + g * BATCH;
    const ids = [];
    for (let i = 0; i < BATCH && start + i <= limit; i++) ids.push(start + i);
    if (ids.length) groups.push(ids);
  }
  if (!groups.length) break;

  const results = await Promise.all(groups.map((ids) => callBatch(ERC8183.commerce, SEL_GET_JOB, ids)));
  for (let gi = 0; gi < groups.length; gi++) {
    for (let i = 0; i < groups[gi].length; i++) {
      const reqId = groups[gi][i];
      const j = results[gi][i] ? decodeJob(results[gi][i]) : null;
      // Three outcomes, and conflating any two of them corrupts the census:
      // the node did not answer (retry), the id does not exist (skip, count),
      // or a real job came back (record).
      if (!j) pendingRetry.push(reqId);
      else if (isRealJob(j, reqId)) out.write(jobLine(j) + '\n');
      else absent++;
    }
  }

  const advanced = groups.reduce((s, g) => s + g.length, 0);
  state.cursor += advanced;
  state.updatedAt = new Date().toISOString();
  sinceLog += advanced;

  if (sinceLog >= 2500) {
    saveState(state);
    const done = state.cursor - 1;
    const rate = done / ((Date.now() - t0) / 1000);
    console.log(`  ${fmt(done)} / ${fmt(limit)}  ·  ${rate.toFixed(0)}/s  ·  ~${(((limit - done) / rate) / 60).toFixed(1)} min left  ·  retry queue ${pendingRetry.length}`);
    sinceLog = 0;
  }
}

// Drain the refusals patiently. Whatever survives this is genuinely unreadable
// and is reported as such instead of being quietly dropped from the totals.
if (pendingRetry.length) {
  console.log(`\ndraining ${fmt(pendingRetry.length)} refused ids patiently…`);
  const still = [];
  for (let i = 0; i < pendingRetry.length; i += BATCH) {
    const ids = pendingRetry.slice(i, i + BATCH);
    const res = await callBatch(ERC8183.commerce, SEL_GET_JOB, ids, { patient: true });
    for (let k = 0; k < ids.length; k++) {
      const j = res[k] ? decodeJob(res[k]) : null;
      if (!j) still.push(ids[k]);
      else if (isRealJob(j, ids[k])) out.write(jobLine(j) + '\n');
      else absent++;
    }
  }
  state.unread = still.length;
  console.log(`  ${fmt(pendingRetry.length - still.length)} recovered, ${fmt(still.length)} still unread`);
}

state.finishedAt = new Date().toISOString();
state.absent = absent;
if (absent) console.log(`\n${fmt(absent)} ids in range returned an empty struct — the id does not exist. Not recorded.`);
saveState(state);

// Wait for the file to actually be on disk before reading it back. end() only
// asks the stream to close; reporting straight after it read a short file and
// printed 401 of 500 jobs, which looked exactly like a hundred unreadable ids.
await new Promise((resolve) => out.end(resolve));
console.log(`\ndone in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
report();
