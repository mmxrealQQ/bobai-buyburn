// The paid work under every agent's chart (Brain Plaza agent chart, phase 1, 2026-10-12).
//
// Reads the escrow census (data/erc8183/jobs.jsonl, every job on the ERC-8183
// kernel) and writes dashboard/api-agent-jobs.json: per agent id, its jobs as
// "trades" (the latest 60) and its totals — jobs, funded, delivered, paid out,
// earned, distinct buyers.
//
// WHICH AGENT A JOB BELONGS TO. The kernel knows a provider ADDRESS, not an
// agent, and one address often sells for several agents (our six share one;
// Mandate's relay names the agent in the job). So a job is put on an agent by,
// in order: (1) the job's own description naming "#<id>" of an agent that sells
// from that address; (2) for our own address, the service id in the signed job
// (grid_plan -> the grid planner, …); (3) otherwise the address's jobs are the
// agent's only when the address sells for that one agent alone, and are shown
// as "shared by N agents" when it does not. The 2026-10-12 lesson: Mandate
// counted three outside hires for our DeFi agent that were grid plans.
//
// Run after `node scripts/erc8183-job-scan.mjs` (and --owners when the census grew):
//   node scripts/agent-jobs-export.mjs
import fs from 'node:fs';
import path from 'node:path';
import { OWN_WALLETS } from '../worker-agent/own-wallets.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const JOBS = path.join(ROOT, 'data', 'erc8183', 'jobs.jsonl');
const OWNERS = path.join(ROOT, 'data', 'erc8183', 'owners.json');
const OWN = path.join(ROOT, 'data', 'own-agents.json');
const OUT = path.join(ROOT, 'dashboard', 'api-agent-jobs.json');
const KEEP = 60;
const U = 1e18;

// our six: provider and the service each one sells (worker-agent/sell.js AGENT_SERVICE)
const OUR_SERVICE = { lp_position_plan: 363709, health_factor: 302257, grid_plan: 302258, yield_plan: 304493, rebalance_plan: 304494, lp_tier_plan: 310460 };

const owners = JSON.parse(fs.readFileSync(OWNERS, 'utf8')).owners || {};
const own = JSON.parse(fs.readFileSync(OWN, 'utf8')).agents || {};
const idsOf = new Map(); // provider -> Set(agent ids)
for (const [addr, list] of Object.entries(owners)) idsOf.set(addr.toLowerCase(), new Set(list.map((a) => Number(a.id))));
const ourProvider = Object.values(own).map((a) => String(a.owner || '').toLowerCase()).find(Boolean);
if (ourProvider) { const s = idsOf.get(ourProvider) || new Set(); Object.values(OUR_SERVICE).forEach((id) => s.add(id)); idsOf.set(ourProvider, s); }
// The two Venus agents' own agentWallets (worker-agent/agent-wallets.js, 2026-10-21): a job funded to one of them is
// that agent's alone.
for (const [addr, id] of [['0xeac21928de023677a25eb925d1cb1b0786faf946', 302257], ['0x497dac54fd7238027ecbbd194b353379a1d605f0', 304493]]) idsOf.set(addr, new Set([id]));

const agentOfJob = (j, ids) => {
  const named = [...String(j.desc || '').matchAll(/#(\d{1,7})\b/g)].map((m) => Number(m[1])).find((id) => ids.has(id));
  if (named) return { id: named, how: 'named in the job' };
  if (j.provider === ourProvider) { const svc = String(j.desc || '').match(/"service"\s*:\s*"([a-z_]+)"|service[ =:]+([a-z_]+)/); const s = svc && (svc[1] || svc[2]); if (s && OUR_SERVICE[s]) return { id: OUR_SERVICE[s], how: 'its service in the job' }; }
  if (ids.size === 1) return { id: [...ids][0], how: 'the address sells for this agent alone' };
  return null;
};

// THE FULL TEXT OF A CUT DESCRIPTION. The census keeps the first 240 characters of a job's description, and a job
// funded the BNB-SDK way carries its signed envelope first and the task (with the service) after it — so the jobs of
// an address that sells for several agents are read whole once, from our own /job reader, and kept in a cache.
const CACHE = path.join(ROOT, 'data', 'erc8183', 'desc-cache.json');
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const allJobs = fs.readFileSync(JOBS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const needFull = allJobs.filter((j) => { const ids = idsOf.get(String(j.provider || '').toLowerCase()); return ids && ids.size > 1 && String(j.desc || '').length >= 240 && !cache[j.id]; });
for (let i = 0; i < needFull.length; i += 4) {
  await Promise.all(needFull.slice(i, i + 4).map(async (j) => {
    try { const r = await fetch(`https://agent.brainonbnb.com/job?id=${j.id}`, { signal: AbortSignal.timeout(20000) }); const x = await r.json(); if (x?.description) cache[j.id] = x.description; } catch { /* next run */ }
  }));
}
if (needFull.length) fs.writeFileSync(CACHE, JSON.stringify(cache));
for (const j of allJobs) if (cache[j.id]) j.desc = cache[j.id];

const per = new Map(); // agent id -> { jobs:[], shared:[] }
const shared = new Map(); // provider -> jobs that could not be put on one agent
let total = 0;
for (const j of allJobs) {
  total++;
  const prov = String(j.provider || '').toLowerCase(); const ids = idsOf.get(prov);
  if (!ids) continue;
  const client = String(j.client || '').toLowerCase();
  // own = one of our wallets, or the selling address hiring itself: shown, never counted as an outside buyer
  const row = [j.id, j.status, Number(j.budget || 0) / U, client, j.submitted_at || 0, j.expired_at || 0, OWN_WALLETS.has(client) ? 'ours' : client === prov ? 'self' : ''];
  const who = agentOfJob({ ...j, provider: prov }, ids);
  if (who) { if (!per.has(who.id)) per.set(who.id, { provider: prov, rows: [], how: new Set() }); const p = per.get(who.id); p.rows.push(row); p.how.add(who.how); }
  else { if (!shared.has(prov)) shared.set(prov, []); shared.get(prov).push(row); }
}

const summary = (rows) => {
  const by = (s) => rows.filter((r) => r[1] === s).length;
  const funded = rows.filter((r) => r[1] !== 'OPEN').length;
  const paid = rows.filter((r) => r[1] === 'COMPLETED');
  const last = rows.reduce((m, r) => Math.max(m, r[4]), 0);
  return {
    jobs: rows.length, funded, paid_out: paid.length, delivered_waiting: by('SUBMITTED'), funded_not_delivered: by('FUNDED'), expired: by('EXPIRED'), rejected: by('REJECTED'), never_funded: by('OPEN'),
    delivery_rate_pct: funded ? Math.round(((paid.length + by('SUBMITTED')) / funded) * 1000) / 10 : null,
    earned_u: Math.round(paid.reduce((a, r) => a + r[2], 0) * 100) / 100,
    // what outside buyers paid it (2026-10-13: the chart's "earned" and the screener's "Earned the most" — whose
    // subtitle says outside buyers — counted the owner's own test purchases as income)
    earned_u_outside: Math.round(paid.filter((r) => !r[6]).reduce((a, r) => a + r[2], 0) * 100) / 100,
    buyers: new Set(rows.filter((r) => r[1] !== 'OPEN').map((r) => r[3])).size,
    // our own test purchases are shown, and never counted as somebody else hiring the agent
    buyers_outside: new Set(rows.filter((r) => r[1] !== 'OPEN' && !r[6]).map((r) => r[3])).size,
    paid_out_outside: paid.filter((r) => !r[6]).length,
    // the delivery rate for outside buyers alone: the chart's score reads this one, so hiring yourself buys nothing
    funded_outside: rows.filter((r) => r[1] !== 'OPEN' && !r[6]).length,
    delivery_rate_outside_pct: (() => { const f = rows.filter((r) => r[1] !== 'OPEN' && !r[6]); return f.length ? Math.round((f.filter((r) => r[1] === 'COMPLETED' || r[1] === 'SUBMITTED').length / f.length) * 1000) / 10 : null; })(),
    last_delivery: last ? new Date(last * 1000).toISOString().slice(0, 10) : null,
  };
};
const trades = (rows) => rows.slice().sort((a, b) => b[0] - a[0]).slice(0, KEEP)
  .map(([id, status, u, client, sub, exp, own]) => ({ job: id, status, u: Math.round(u * 1000) / 1000, buyer: client.slice(0, 6) + '…' + client.slice(-4), ...(own === 'ours' ? { ours: true } : own === 'self' ? { self: true } : {}), delivered_at: sub ? new Date(sub * 1000).toISOString().slice(0, 16) : null, expires_at: exp ? new Date(exp * 1000).toISOString().slice(0, 16) : null }));

const agents = {};
// the curve under the chart: per day a job was delivered, how many, how many paid out and what they earned (all history)
const byDay = (rows) => {
  const m = new Map();
  for (const r of rows) {
    if (!r[4]) continue;
    const d = new Date(r[4] * 1000).toISOString().slice(0, 10); const x = m.get(d) || [d, 0, 0, 0];
    x[1]++; if (r[1] === 'COMPLETED') { x[2]++; x[3] = Math.round((x[3] + r[2]) * 1000) / 1000; } m.set(d, x);
  }
  return [...m.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
};
for (const [id, p] of per) agents[id] = { provider: p.provider, attributed_by: [...p.how], totals: summary(p.rows), by_day: byDay(p.rows), trades: trades(p.rows) };
const providers = {};
for (const [prov, rows] of shared) {
  providers[prov] = { agents: [...idsOf.get(prov)].sort((a, b) => a - b), totals: summary(rows), trades: trades(rows), note: 'jobs of an address that sells for several agents and does not say which one in the job' };
  for (const id of idsOf.get(prov)) if (!agents[id]) agents[id] = { provider: prov, attributed_by: [], totals: null, trades: [], shared_provider: prov };
  else agents[id].shared_provider = prov;
}

const out = {
  what_this_is: 'Paid work per agent on the ERC-8183 escrow kernel on BNB Smart Chain, from a full read of every job — the trades under each agent\'s chart on Brain Plaza.',
  kernel: '0xEa4DAa3100A767e86FDed867729ae7446476EBA6', unit: '$U (United Stables)',
  measured_at: JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'erc8183', 'scan-state.json'), 'utf8')).updatedAt || null,
  jobs_read: total, agents_with_work: Object.values(agents).filter((a) => a.totals?.funded).length,
  method: 'A job is put on an agent when the job names its id, when our own job carries its service, or when its provider address sells for that agent alone; otherwise it stays with the address as shared. delivery_rate = (paid out + delivered, waiting out the dispute window) / funded.',
  agents, providers,
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB): ${Object.keys(agents).length} agents, ${out.agents_with_work} with funded work, ${Object.keys(providers).length} shared providers, ${total} jobs read`);
