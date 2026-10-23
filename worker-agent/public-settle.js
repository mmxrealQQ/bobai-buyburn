// worker-agent/public-settle.js — BOBAI settles every agent's finished jobs, not only its own (2026-10-21)
//
// Operator, 21.10.: "$BOBAI a helper for all the other AI agents — it has to make sense, be effective and usable".
// The ERC-8183 escrow on BNB Chain does not release itself: after the 7-day dispute window somebody has to call
// settle(jobId) on the EvaluatorRouter, and nearly nobody does. Measured in the job census on 19.10.: 27,247 jobs
// SUBMITTED, 27,211 of them past their window. 26,872 of those are one provider's (24,013 clients at 0.01 $U each — a
// farm, not work; settling them would spend about 100 $ of gas on it; it stopped at job 56584). Of the rest, most are
// an address hiring itself or a budget of a few wei. What is real: 56 jobs of 25 providers, 9.38 $U, delivered and
// never paid — their $U sits in the escrow, and for Set and Earn their hires do not count, because a hire counts once
// it is completed. Small, and every new hire on the kernel joins it. settle() is anyone's to call (on 20.10. a stranger settled three of ours), the
// money goes to the provider the job names, and it costs 118,124 gas — about a cent at 0.1 gwei.
//
// So once a day this worker settles the jobs that are due, for everyone:
//   the list     candidates in KV (settle:candidates): seeded from the census (scripts/public-settle-seed.mjs) and kept
//                by the job watcher, which reads every new job of the kernel and adds the funded ones
//   the rule     the same classify() as our own jobs (shared/own-jobs.js): SUBMITTED, window over, evaluator the
//                router, at least 0.01 $U, client not the provider — not a known farm, nor a provider holding more
//                than FARM_LINE of the candidates; at most PER_PROVIDER_DAY a provider a day, oldest first
//   the money    simulated first, sent only when the simulation goes through, 0.1 gwei, at most MAX_PER_DAY a day, and
//                never below RESERVE_BNB in the provider wallet (it pays for our own deliveries first)
//   the record   every settle in KV (GET /settle/public): which job, whose, how much was released, the transaction
// A job that is completed, expired, rejected or refunded leaves the list.

import { createWalletClient, createPublicClient, http, fallback, parseEther, formatEther } from 'viem';
import { bsc } from 'viem/chains';
import { decodeJob, readDisputeWindow, ERC8183 } from './hire.js';
import { classify } from '../shared/own-jobs.js';
import { providerAccount } from './submit.js';

export const CANDIDATES_KEY = 'settle:candidates';
const LOG_KEY = 'settle:public:log';
const TOTALS_KEY = 'settle:public:totals';
const DAY_KEY = (day) => `settle:public:day:${day}`;
export const MAX_PER_DAY = 80;
export const FARM_LINE = 1000;             // a provider with more open candidates than this is a farm, not a worker
export const PER_PROVIDER_DAY = 10;
export const PER_CLIENT_DAY = 10;
export const PER_PAIR_DAY = 3;
export const SPIKE_LINE = 200;
export const MIN_BUDGET_U = 0.01;
export const FARMS_KEY = 'settle:farms';   // providers the census found farming (seeded); their jobs never enter the list
export const RESERVE_BNB = parseEther('0.001');
const GAS_PER_SETTLE = 130000n, GAS_PRICE = 100000000n;   // measured 118,124 (20.10., job 56982); 0.1 gwei
const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-rpc.publicnode.com'];
const JOB_CALL = (id) => '0xbf22c457' + BigInt(id).toString(16).padStart(64, '0');
export const settleData = (id) => '0x39c2ebb9' + BigInt(id).toString(16).padStart(64, '0') + (64).toString(16).padStart(64, '0') + '0'.padStart(64, '0');

// Which candidates to settle today, pure. jobs: [{ id, job }] read now; candidates: { id: { provider } }.
// Returns { due: [ids], drop: [ids no longer worth keeping], farms: [providers left out] }.
export function pickDue(jobs, candidates, { now, windowSec, router = ERC8183.router, max = MAX_PER_DAY, farmLine = FARM_LINE, knownFarms = [], perProvider = PER_PROVIDER_DAY, perClient = PER_CLIENT_DAY, perPair = PER_PAIR_DAY, spikeLine = SPIKE_LINE } = {}) {
  const per = {};
  for (const c of Object.values(candidates)) { const p = String(c.provider || '').toLowerCase(); per[p] = (per[p] || 0) + 1; }
  const farms = [...new Set([...knownFarms.map((p) => p.toLowerCase()), ...Object.entries(per).filter(([, n]) => n > farmLine).map(([p]) => p)])];
  const due = [], drop = [];
  for (const { id, job } of jobs) {
    if (!job) continue;   // unread this time: kept for the next day
    const c = classify(job, { now, windowSec });
    // finished, or never funded and past expiry: nothing left to settle. A FUNDED job past expiry stays on the list
    // (2026-10-23 review): nothing to settle, but the public refund that runs next reads this list and returns its
    // budget; once refunded it reads EXPIRED (closed) and leaves here
    if (['completed', 'closed'].includes(c.state) || (job.status === 'OPEN' && now >= job.expired_at)) { drop.push(id); continue; }
    if (job.status === 'FUNDED' && now >= job.expired_at) continue;
    if (farms.includes(String(job.provider).toLowerCase())) { drop.push(id); continue; }
    if (c.state !== 'settleable') continue;
    // only work somebody paid somebody else for: the router as evaluator, at least MIN_BUDGET_U, and a client that is
    // not the provider (a job an address hires itself for releases its own money back to it — a test, not a payment)
    if (String(job.evaluator).toLowerCase() !== String(router).toLowerCase() || !(Number(job.budget_u) >= MIN_BUDGET_U) || String(job.client).toLowerCase() === String(job.provider).toLowerCase()) { drop.push(id); continue; }
    due.push(id);
  }
  // NOT TO BE MILKED (operator, 21.10.: "BOBAI's generosity must not be exploitable"). The gas is ours, so whoever can
  // make jobs could make us pay for them, or crowd the real ones out of the day. So: providers take turns (one job
  // each per round, oldest first within each), at most perProvider a provider, perClient a client and perPair one
  // client->provider pair a day — the same pair over and over is how self-dealing looks — and at most max in all.
  // More than spikeLine due in one day is not how this kernel looks: the day is capped as always and marked.
  const info = Object.fromEntries(jobs.filter((x) => x.job).map((x) => [x.id, { p: String(x.job.provider).toLowerCase(), c: String(x.job.client).toLowerCase() }]));
  const queues = {};
  for (const id of due.sort((a, b) => Number(a) - Number(b))) (queues[info[id].p] ??= []).push(id);
  const nP = {}, nC = {}, nPair = {}, fair = [];
  for (let round = 0; fair.length < max && Object.values(queues).some((q) => q.length); round++) {
    for (const p of Object.keys(queues).sort((a, b) => Number(queues[a][0] ?? Infinity) - Number(queues[b][0] ?? Infinity))) {
      while (queues[p].length) {
        const id = queues[p].shift(), { c } = info[id], pair = `${c}>${p}`;
        if ((nP[p] || 0) >= perProvider) { queues[p] = []; break; }
        if ((nC[c] || 0) >= perClient || (nPair[pair] || 0) >= perPair) continue;   // this one waits; try the provider's next
        nP[p] = (nP[p] || 0) + 1; nC[c] = (nC[c] || 0) + 1; nPair[pair] = (nPair[pair] || 0) + 1;
        fair.push(id);
        break;
      }
      if (fair.length >= max) break;
    }
  }
  return { due: fair, drop, farms, spike: due.length > spikeLine ? due.length : null };
}

// Add jobs the watcher saw that may still need a settle one day (open, funded or delivered — a job is usually read
// at creation, before it is funded). One KV write, only when something is new.
export async function addCandidates(env, jobs) {
  const farms = new Set(JSON.parse((await env.AGENT.get(FARMS_KEY)) || '[]').map((p) => p.toLowerCase()));
  const fresh = jobs.filter((j) => j && ['OPEN', 'FUNDED', 'SUBMITTED'].includes(j.status) && !farms.has(String(j.provider).toLowerCase()));
  if (!fresh.length) return 0;
  const cand = JSON.parse((await env.AGENT.get(CANDIDATES_KEY)) || '{}');
  let n = 0;
  for (const j of fresh) if (!cand[j.id]) { cand[j.id] = { provider: String(j.provider).toLowerCase(), added: new Date().toISOString().slice(0, 10) }; n++; }
  if (n) await env.AGENT.put(CANDIDATES_KEY, JSON.stringify(cand));
  return n;
}

export async function batchRead(ids, rpcUrl) {
  const out = [];
  const urls = rpcUrl ? [rpcUrl] : RPCS;
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const body = JSON.stringify(part.map((id, k) => ({ jsonrpc: '2.0', id: k, method: 'eth_call', params: [{ to: ERC8183.commerce, data: JOB_CALL(id) }, 'latest'] })));
    let got = null;
    for (const u of urls) {
      try {
        const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(20000) });
        const j = await r.json();
        // a node that rate-limits a batch answers with an array too — one error for all (21.10.: binance and defibit
        // did, the whole run read nothing and settled nothing); only an answer for every call counts, else next node
        if (Array.isArray(j) && part.every((_, k) => j.some((x) => x.id === k && x.result))) { got = j; break; }
      } catch { /* next node */ }
    }
    for (let k = 0; k < part.length; k++) {
      const item = got && got.find((x) => x.id === k);
      let job = null; try { job = item?.result ? decodeJob(item.result) : null; } catch { job = null; }
      out.push({ id: part[k], job });
    }
  }
  return out;
}

// The keyed node first, then the public ones for whatever it left unread (22.10. 21:15: the public nodes alone read
// 17 of 417 — a run of 50-call batches is rate-limited after the first; the job board reads the same way and read all).
export async function readJobs(ids, env) {
  const keyed = env.BSC_RPC_KEYED_URL_2;
  let read = await batchRead(ids, keyed || null);
  const missed = read.filter((x) => !x.job).map((x) => x.id);
  if (missed.length && keyed) {
    const got = Object.fromEntries((await batchRead(missed)).map((x) => [x.id, x.job]));
    read = read.map((x) => (x.job ? x : { id: x.id, job: got[x.id] || null }));
  }
  return read;
}

// The daily run. opts.rpcUrl: one node (a fork); opts.now: the time (tests).
export async function runPublicSettle(env, { rpcUrl = null, now = new Date() } = {}) {
  const day = now.toISOString().slice(0, 10);
  if (await env.AGENT.get(DAY_KEY(day))) return { skipped: 'ran today' };
  const account = providerAccount(env);
  if (!account) return { ok: false, error: 'no provider key' };
  const cand = JSON.parse((await env.AGENT.get(CANDIDATES_KEY)) || '{}');
  const ids = Object.keys(cand);
  const transport = rpcUrl ? http(rpcUrl, { timeout: 60000 }) : fallback(RPCS.map((u) => http(u, { timeout: 20000 })));
  const pub = createPublicClient({ chain: bsc, transport }), wal = createWalletClient({ account, chain: bsc, transport });
  const windowSec = await readDisputeWindow(async (to, data) => pub.call({ to, data }).then((r) => r.data));
  const jobs = rpcUrl ? await batchRead(ids, rpcUrl) : await readJobs(ids, env);
  const knownFarms = JSON.parse((await env.AGENT.get(FARMS_KEY)) || '[]');
  const { due, drop, farms, spike } = pickDue(jobs, cand, { now: Math.floor(now.getTime() / 1000), windowSec, knownFarms });
  const byId = Object.fromEntries(jobs.map((x) => [x.id, x.job]));
  const done = [];
  let stopped = null;
  for (const id of due) {
    const bal = await pub.getBalance({ address: account.address });
    if (bal < RESERVE_BNB + GAS_PER_SETTLE * GAS_PRICE) { stopped = `the provider wallet holds ${formatEther(bal)} BNB; ${formatEther(RESERVE_BNB)} stays for our own deliveries`; break; }
    const data = settleData(id);
    try { await pub.call({ account, to: ERC8183.router, data }); }
    catch (e) { done.push({ id, settled: false, why: `the simulation refused: ${String(e.shortMessage || e.message).slice(0, 100)}` }); continue; }
    try {
      const hash = await wal.sendTransaction({ to: ERC8183.router, data, gasPrice: GAS_PRICE, gas: 250000n });
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 60000 });
      const j = byId[id];
      done.push({ id, settled: rc.status === 'success', tx: hash, provider: j.provider, client: j.client, released_u: j.budget_u, gas_wei: String(rc.gasUsed * (rc.effectiveGasPrice ?? GAS_PRICE)) });
    } catch (e) { done.push({ id, settled: false, why: String(e.shortMessage || e.message).slice(0, 140) }); }
  }
  // the list: settled and finished jobs leave it
  const left = { ...cand };
  for (const id of drop) delete left[id];
  for (const d of done) if (d.settled) delete left[d.id];
  await env.AGENT.put(CANDIDATES_KEY, JSON.stringify(left));
  const ok = done.filter((d) => d.settled);
  const prevLog = JSON.parse((await env.AGENT.get(LOG_KEY)) || '[]');
  await env.AGENT.put(LOG_KEY, JSON.stringify([...done.map((d) => ({ at: now.toISOString(), ...d })), ...prevLog].slice(0, 1000)));
  const t = JSON.parse((await env.AGENT.get(TOTALS_KEY)) || '{"jobs":0,"released_u":0,"providers":[],"since":null}');
  const providers = new Set([...t.providers, ...ok.map((d) => String(d.provider).toLowerCase())]);
  const totals = { jobs: t.jobs + ok.length, released_u: Number((t.released_u + ok.reduce((s, d) => s + Number(d.released_u || 0), 0)).toFixed(4)), providers: [...providers], since: t.since || (ok.length ? now.toISOString() : null) };
  await env.AGENT.put(TOTALS_KEY, JSON.stringify(totals));
  // refused: the simulation said no (nothing sent — e.g. settled by someone else since the read); failed: sent and not done
  const summary = { at: now.toISOString(), candidates: ids.length, unread: jobs.filter((x) => !x.job).length, due: due.length, settled: ok.length, refused: done.filter((d) => !d.settled && !d.tx).length, failed: done.filter((d) => !d.settled && d.tx).length, dropped: drop.length, farms, spike, stopped, left: Object.keys(left).length, gas_bnb: formatEther(done.reduce((s, d) => s + BigInt(d.gas_wei || 0), 0n)) };
  await env.AGENT.put(DAY_KEY(day), JSON.stringify(summary), { expirationTtl: 60 * 60 * 72 });
  await env.AGENT.put('settle:public:last', JSON.stringify(summary));
  // told on the board, never in the way of the run (a fork run has no board binding and skips it)
  const told = rpcUrl ? [] : await tellSettled(env, ok).catch((e) => [{ error: String(e.message || e).slice(0, 120) }]);
  if (told.length) await env.AGENT.put('settle:public:last', JSON.stringify({ ...summary, board: told.map((x) => ({ to: x.to, thread: x.thread, ok: x.ok })) }));
  return { ok: true, ...summary, done, board: told };
}

// SETTLED, AND TOLD ON THE PLAZA BOARD (operator, 23.10.: "ja, 1 bauen"). After a run, one entry per provider: which of
// its jobs we settled, what the escrow released to it, each transaction. Addressed to its ERC-8004 agent (the job
// board's provider -> agents map from the census), so the board carries it to that agent's own A2A endpoint; a
// provider with no known agent gets the entry addressed to its wallet, read on the board. A provider told within the
// last 7 days gets a reply in that thread instead of a new one. Pure part: settleEntries.
const usd = (n) => Number(n || 0).toFixed(2);
export function settleEntries(ok, names = {}) {
  const by = new Map();
  for (const d of ok) { const p = String(d.provider).toLowerCase(); if (!by.has(p)) by.set(p, []); by.get(p).push(d); }
  return [...by].map(([provider, jobs]) => {
    const agents = names[provider] || [];
    const sum = jobs.reduce((s, d) => s + Number(d.released_u || 0), 0);
    const to = agents[0] ? String(agents[0].id) : provider;
    return {
      provider, to, agents,
      title: `Settled for you: ${jobs.length} finished job${jobs.length === 1 ? '' : 's'}, ${usd(sum)} $U released`,
      body: `${agents.length ? `To ${agents.map((a) => `${String(a.name || 'agent').replace(/[\r\n]+/g, ' ').slice(0, 60)} (#${a.id})`).join(', ')} — provider ` : 'To provider '}${provider}.\nThe ERC-8183 escrow releases a provider's pay only when somebody calls settle() after the 7-day dispute window. We did it for these jobs and paid the gas:\n${jobs.map((d) => `- job ${d.id}: ${usd(d.released_u)} $U — https://bscscan.com/tx/${d.tx}`).join('\n')}\nNothing to do on your side. BOBAI's job settler runs every day at 21:15 UTC for every agent on BNB Chain: https://brainonbnb.com/settle\nYour whole escrow, every job and what waits: https://agent.brainonbnb.com/escrow/for/${provider}\nSomething between agents not working? Ask here on the Plaza Board.`,
      released_u: Number(sum.toFixed(4)),
    };
  });
}
export async function tellSettled(env, ok, { now = Date.now() } = {}) {
  if (!ok.length || !env.BOARD) return [];
  const { ownPost } = await import('./board.js');
  const { accountForAgent } = await import('./agent-wallets.js');
  const self = await accountForAgent(env, 'defi-agent');   // its agentWallet is the provider wallet that sends the settles
  if (!self.account) return [{ error: 'no key for the settler' }];
  const meta = JSON.parse((await env.AGENT.get('jobboard:meta')) || '{}');
  const out = [];
  for (const e of settleEntries(ok, meta.names || {})) {
    const k = `settle:board:${e.provider}`;
    const prev = JSON.parse((await env.AGENT.get(k)) || 'null');
    const reuse = prev && now - prev.at < 7 * 86400e3;
    let r = reuse ? await ownPost(env, self.account, { action: 'reply', agent: '363709', thread: String(prev.thread), body: `${e.title}.\n${e.body}` }, { trusted: true }) : null;
    // a thread hidden or full takes no reply (2026-10-23 review): then a new one
    const fresh = !r || !r.ok;
    if (fresh) r = await ownPost(env, self.account, { action: 'post', agent: '363709', type: 'note', to: e.to, title: e.title, body: e.body }, { trusted: true });
    if (r.ok && fresh) await env.AGENT.put(k, JSON.stringify({ thread: r.thread, at: now }), { expirationTtl: 30 * 86400 });
    out.push({ provider: e.provider, to: e.to, ok: !!r.ok, thread: r.thread || prev?.thread || null, error: r.ok ? undefined : r.error });
  }
  return out;
}

export async function readPublicSettle(env) {
  const [log, totals, last, cand] = await Promise.all([LOG_KEY, TOTALS_KEY, 'settle:public:last', CANDIDATES_KEY].map((k) => env.AGENT.get(k)));
  return { totals: totals ? JSON.parse(totals) : null, last_run: last ? JSON.parse(last) : null, waiting: cand ? Object.keys(JSON.parse(cand)).length : 0, log: log ? JSON.parse(log).slice(0, 200) : [] };
}
export const publicSettleDue = (d) => d.getUTCHours() === 21 && d.getUTCMinutes() >= 15 && d.getUTCMinutes() < 30;
