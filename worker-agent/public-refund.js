// worker-agent/public-refund.js — BOBAI returns the money of jobs nobody delivered, for every client (2026-10-23)
//
// Operator, 23.10.: "ja, bauen" (Public Refund beside the public settle). A job funded on the ERC-8183 escrow and never
// delivered keeps the client's money in the kernel after its expiry until somebody calls claimRefund(jobId). Measured on
// 23.10. in the job board's store: 122 jobs FUNDED and past expiry, 114 of them for a client that is not the provider
// (30 clients, 26 providers). claimRefund is anyone's to call and pays the client the whole budget — proven on a fork
// the same day: a stranger called it for jobs 57002 and 56933, the clients got 0.05 and 0.1 $U, the caller nothing,
// 76,093 gas each (about half a cent at 0.1 gwei). The budget comes back in the token the job was paid in: most jobs
// pay $U, some USDT (the fork run of 23.10. returned USDT to two clients) — both dollars, so amounts are said in $.
//
// So once a day, right after the public settle, this worker refunds the jobs that are due:
//   the list     every job the job board holds as FUNDED (jobboard:jobs) and every FUNDED settle candidate, read live
//   the rule     FUNDED, expiry passed, at least 0.01 $U, client not the provider, not a known farm on either side,
//                not one of our own wallets (our hires refund themselves: agent-hires.js refundUndelivered)
//   the money    simulated first, sent only when the simulation goes through, 0.1 gwei, at most MAX_PER_DAY a day,
//                PER_CLIENT_DAY a client and PER_PAIR_DAY a client->provider pair, never below the provider wallet's
//                reserve (it pays for our own deliveries first)
//   the record   every refund in KV, served with GET /settle/public (refunds), and one Plaza Board entry per run

import { createWalletClient, createPublicClient, http, fallback, formatEther } from 'viem';
import { bsc } from 'viem/chains';
import { ERC8183 } from './hire.js';
import { providerAccount } from './submit.js';
import { readJobs, batchRead, CANDIDATES_KEY, FARMS_KEY, RESERVE_BNB, MIN_BUDGET_U } from './public-settle.js';
import { OWN_WALLETS } from './own-wallets.js';

const LOG_KEY = 'refund:public:log';
const TOTALS_KEY = 'refund:public:totals';
const LAST_KEY = 'refund:public:last';
const DAY_KEY = (day) => `refund:public:day:${day}`;
export const MAX_PER_DAY = 40;
export const PER_CLIENT_DAY = 5;
export const PER_PAIR_DAY = 3;
const GAS_PER_REFUND = 100000n, GAS_PRICE = 100000000n;   // measured 76,093 on a fork (23.10., jobs 57002, 56933); 0.1 gwei
const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-rpc.publicnode.com'];
export const refundData = (id) => '0x5b7baf64' + BigInt(id).toString(16).padStart(64, '0');

// Which jobs to refund today, pure. jobs: [{ id, job }] read now. Returns { due: [ids], skipped: { reason: n } }.
export function pickRefunds(jobs, { now, knownFarms = [], own = OWN_WALLETS, max = MAX_PER_DAY, perClient = PER_CLIENT_DAY, perPair = PER_PAIR_DAY } = {}) {
  const farms = new Set(knownFarms.map((x) => String(x).toLowerCase()));
  const skipped = {}, skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
  const ok = [], gone = [];   // gone: funded, expired and never ours to refund — they leave the settle list for good
  for (const { id, job } of jobs) {
    if (!job) { skip('unread'); continue; }
    if (job.status !== 'FUNDED' || !(now >= job.expired_at)) continue;
    const c = String(job.client).toLowerCase(), p = String(job.provider).toLowerCase();
    if (!(Number(job.budget_u) >= MIN_BUDGET_U)) { skip('under 0.01 $U'); gone.push(String(id)); continue; }
    if (c === p) { skip('client is the provider'); gone.push(String(id)); continue; }
    if (farms.has(c) || farms.has(p)) { skip('farm'); gone.push(String(id)); continue; }
    if (own.has(c)) { skip('our own hire'); gone.push(String(id)); continue; }
    ok.push({ id: String(id), c, p });
  }
  // NOT TO BE MILKED, as the settle: the gas is ours, so whoever can make jobs could make us pay for their refunds or
  // crowd the others out. Oldest first; at most perClient a client and perPair one client->provider pair a day.
  const nC = {}, nPair = {}, due = [];
  for (const x of ok.sort((a, b) => Number(a.id) - Number(b.id))) {
    if (due.length >= max) { skip('over the day\'s cap'); continue; }
    const pair = `${x.c}>${x.p}`;
    if ((nC[x.c] || 0) >= perClient || (nPair[pair] || 0) >= perPair) { skip('client or pair had its turns today'); continue; }
    nC[x.c] = (nC[x.c] || 0) + 1; nPair[pair] = (nPair[pair] || 0) + 1;
    due.push(x.id);
  }
  return { due, skipped, gone };
}

// The ids worth reading: the job board's FUNDED jobs and the FUNDED settle candidates (a job the watcher saw funded).
export async function refundCandidates(env) {
  const [jb, cand] = await Promise.all([env.AGENT.get('jobboard:jobs'), env.AGENT.get(CANDIDATES_KEY)]);
  const ids = new Set();
  for (const [id, j] of Object.entries(JSON.parse(jb || '{}'))) if (Array.isArray(j) && j[2] === 'F') ids.add(String(id));
  for (const id of Object.keys(JSON.parse(cand || '{}'))) ids.add(String(id));
  return [...ids];
}

// The daily run. opts.rpcUrl: one node (a fork); opts.now: the time (tests); opts.ids: the list (tests).
export async function runPublicRefund(env, { rpcUrl = null, now = new Date(), ids = null } = {}) {
  const day = now.toISOString().slice(0, 10);
  if (await env.AGENT.get(DAY_KEY(day))) return { skipped: 'ran today' };
  const account = providerAccount(env);
  if (!account) return { ok: false, error: 'no provider key' };
  const list = ids || await refundCandidates(env);
  const transport = rpcUrl ? http(rpcUrl, { timeout: 60000 }) : fallback(RPCS.map((u) => http(u, { timeout: 20000 })));
  const pub = createPublicClient({ chain: bsc, transport }), wal = createWalletClient({ account, chain: bsc, transport });
  const jobs = rpcUrl ? await batchRead(list, rpcUrl) : await readJobs(list, env);
  const knownFarms = JSON.parse((await env.AGENT.get(FARMS_KEY)) || '[]');
  const meta = JSON.parse((await env.AGENT.get('jobboard:meta')) || '{}');
  const { due, skipped, gone } = pickRefunds(jobs, { now: Math.floor(now.getTime() / 1000), knownFarms: [...knownFarms, ...(meta.farms || [])] });
  const byId = Object.fromEntries(jobs.map((x) => [String(x.id), x.job]));
  const done = [];
  let stopped = null;
  // THE RECORD IS WRITTEN WHATEVER HAPPENS (2026-10-23 review): a node that throws mid-run must not leave refunds that
  // went out unrecorded — the loop is held in try/finally, and a sent refund whose receipt did not come keeps its hash
  try {
    for (const id of due) {
      const bal = await pub.getBalance({ address: account.address }).catch(() => null);
      if (bal == null) { stopped = 'the wallet balance could not be read'; break; }
      if (bal < RESERVE_BNB + GAS_PER_REFUND * GAS_PRICE) { stopped = `the provider wallet holds ${formatEther(bal)} BNB; ${formatEther(RESERVE_BNB)} stays for our own deliveries`; break; }
      const data = refundData(id);
      try { await pub.call({ account, to: ERC8183.commerce, data }); }
      catch (e) { done.push({ id, refunded: false, why: `the simulation refused: ${String(e.shortMessage || e.message).slice(0, 100)}` }); continue; }
      const j = byId[id];
      let hash = null;
      try {
        hash = await wal.sendTransaction({ to: ERC8183.commerce, data, gasPrice: GAS_PRICE, gas: 200000n });
        const rc = await pub.waitForTransactionReceipt({ hash, timeout: 60000 });
        done.push({ id, refunded: rc.status === 'success', tx: hash, client: j.client, provider: j.provider, returned_u: j.budget_u, returned_wei: j.budget, expired_at: j.expired_at, gas_wei: String(rc.gasUsed * (rc.effectiveGasPrice ?? GAS_PRICE)) });
      } catch (e) { done.push({ id, refunded: false, ...(hash ? { tx: hash, client: j.client, provider: j.provider, unconfirmed: true } : {}), why: String(e.shortMessage || e.message).slice(0, 140) }); }
    }
  } catch (e) { stopped = `the run stopped: ${String(e.shortMessage || e.message || e).slice(0, 140)}`; }
  // the settle list: refunded jobs and jobs that will never be ours to refund leave it (the settle keeps funded,
  // expired jobs on it for this run)
  if (!rpcUrl || env.AGENT) {
    const cand = JSON.parse((await env.AGENT.get(CANDIDATES_KEY)) || '{}');
    let n = 0;
    for (const id of [...gone, ...done.filter((d) => d.refunded).map((d) => String(d.id))]) if (cand[id]) { delete cand[id]; n++; }
    if (n) await env.AGENT.put(CANDIDATES_KEY, JSON.stringify(cand));
  }
  const ok = done.filter((d) => d.refunded);
  const prevLog = JSON.parse((await env.AGENT.get(LOG_KEY)) || '[]');
  await env.AGENT.put(LOG_KEY, JSON.stringify([...done.map((d) => ({ at: now.toISOString(), ...d })), ...prevLog].slice(0, 1000)));
  const t = JSON.parse((await env.AGENT.get(TOTALS_KEY)) || '{"jobs":0,"returned_u":0,"clients":[],"since":null}');
  const clients = new Set([...t.clients, ...ok.map((d) => String(d.client).toLowerCase())]);
  const totals = { jobs: t.jobs + ok.length, returned_u: Number((t.returned_u + ok.reduce((s, d) => s + Number(d.returned_u || 0), 0)).toFixed(4)), clients: [...clients], since: t.since || (ok.length ? now.toISOString() : null) };
  await env.AGENT.put(TOTALS_KEY, JSON.stringify(totals));
  const summary = { at: now.toISOString(), read: list.length, unread: jobs.filter((x) => !x.job).length, due: due.length, refunded: ok.length, returned_u: Number(ok.reduce((s, d) => s + Number(d.returned_u || 0), 0).toFixed(4)), refused: done.filter((d) => !d.refunded && !d.tx).length, failed: done.filter((d) => !d.refunded && d.tx).length, unconfirmed: done.filter((d) => d.unconfirmed).length, skipped, stopped, gas_bnb: formatEther(done.reduce((s, d) => s + BigInt(d.gas_wei || 0), 0n)) };
  await env.AGENT.put(DAY_KEY(day), JSON.stringify(summary), { expirationTtl: 60 * 60 * 72 });
  await env.AGENT.put(LAST_KEY, JSON.stringify(summary));
  const told = rpcUrl ? null : await tellRefunded(env, ok, { now: now.getTime() }).catch((e) => ({ error: String(e.message || e).slice(0, 120) }));
  if (told) await env.AGENT.put(LAST_KEY, JSON.stringify({ ...summary, board: told }));
  return { ok: true, ...summary, done, board: told };
}

// ONE ENTRY A RUN ON THE PLAZA BOARD: which jobs came back to whom, each transaction. Within 7 days of the last one it
// is a reply in that thread, so the board carries one running record rather than a thread a day. Pure part: refundEntry.
const usd = (n) => Number(n || 0).toFixed(2);
const short = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`;
export function refundEntry(ok) {
  const sum = ok.reduce((s, d) => s + Number(d.returned_u || 0), 0);
  const clients = new Set(ok.map((d) => String(d.client).toLowerCase())).size;
  const head = `On the ERC-8183 escrow a funded job that is never delivered keeps the client's money after its expiry until somebody calls claimRefund(). We called it for these jobs and paid the gas; the whole budget went back to each job's client, in the stablecoin it was paid in:\n`;
  const tail = `\nNothing to do on your side. BOBAI does this every day at 21:15 UTC for every client on BNB Chain, beside settling delivered jobs: https://brainonbnb.com/settle\nAny wallet's escrow, every job and what waits: https://agent.brainonbnb.com/escrow/for/<address>\nA provider in this list missed a paid job — if that was a fault on your side, tell other builders here what broke.`;
  // the board takes 4000 characters (a reply also carries the title): the lines that fit, the rest at the full record
  const lines = [];
  for (const d of ok) {
    const l = `- job ${d.id}: $${usd(d.returned_u)} to client ${short(d.client)} (provider ${short(d.provider)}) — https://bscscan.com/tx/${d.tx}`;
    if (head.length + tail.length + lines.join('\n').length + l.length + 120 > 3700) { lines.push(`- and ${ok.length - lines.length} more, each with its transaction: https://agent.brainonbnb.com/settle/public`); break; }
    lines.push(l);
  }
  return {
    title: `Refunded: ${ok.length} expired job${ok.length === 1 ? '' : 's'} nobody delivered, $${usd(sum)} back to ${clients} client${clients === 1 ? '' : 's'}`,
    body: head + lines.join('\n') + tail,
    returned_u: Number(sum.toFixed(4)),
  };
}
export async function tellRefunded(env, ok, { now = Date.now() } = {}) {
  if (!ok.length || !env.BOARD) return null;
  const { ownPost } = await import('./board.js');
  const { accountForAgent } = await import('./agent-wallets.js');
  const self = await accountForAgent(env, 'defi-agent');   // its agentWallet is the provider wallet that sends the refunds
  if (!self.account) return { error: 'no key for the refunder' };
  const e = refundEntry(ok);
  const prev = JSON.parse((await env.AGENT.get('refund:board')) || 'null');
  const reuse = prev && now - prev.at < 7 * 86400e3;
  let r = reuse ? await ownPost(env, self.account, { action: 'reply', agent: '363709', thread: String(prev.thread), body: `${e.title}.\n${e.body}` }, { trusted: true }) : null;
  // a thread hidden or full takes no reply (2026-10-23 review): then a new one, which the next week's replies go to
  const fresh = !r || !r.ok;
  if (fresh) r = await ownPost(env, self.account, { action: 'post', agent: '363709', type: 'note', to: 'all', title: e.title, body: e.body }, { trusted: true });
  if (r.ok && fresh) await env.AGENT.put('refund:board', JSON.stringify({ thread: r.thread, at: now }), { expirationTtl: 30 * 86400 });
  return { ok: !!r.ok, thread: r.thread || prev?.thread || null, error: r.ok ? undefined : r.error };
}

export async function readPublicRefund(env) {
  const [log, totals, last] = await Promise.all([LOG_KEY, TOTALS_KEY, LAST_KEY].map((k) => env.AGENT.get(k)));
  return { totals: totals ? JSON.parse(totals) : null, last_run: last ? JSON.parse(last) : null, log: log ? JSON.parse(log).slice(0, 200) : [] };
}
