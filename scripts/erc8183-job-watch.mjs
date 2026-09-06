#!/usr/bin/env node
// OUR OWN JOBS ON THE ERC-8183 KERNEL, watched until each one completes.
//
// The thesis this marketplace argues is that every number in the BNB agent
// economy is inflated, and the figure that carries it is 287 SUBMITTED against
// 8 COMPLETED in the last four hundred jobs: deliverables are written on-chain
// and the escrow almost never releases. Our own jobs are in that 287. If they
// stay there, we have the disease we diagnose in others, and a judge will
// notice that before we do.
//
// WHY THEY STAY THERE
// The escrow does not release itself. The OptimisticPolicy runs a dispute
// window (604800 s, read from the chain rather than assumed) from the moment
// the seller submits; once it has passed with no dispute, somebody still has
// to call settle(jobId, evidence) on the EvaluatorRouter. Nobody does. The
// buyer has what they paid for and no reason to spend gas; the seller often
// does not know the call exists. So "SUBMITTED forever" is the resting state
// of this kernel, and COMPLETED is a thing somebody has to go and do.
//
// WHAT THIS DOES
// Reads each of our jobs from the kernel, classifies it with the one shared
// rule (shared/own-jobs.js — the daily cron in worker-agent/own-jobs.js uses
// the same one), records every transition in data/erc8183/own-jobs.json, and
// says which job is settleable right now. `--sync` merges what the cron saw
// while nobody was watching. It reads. It signs nothing.
//
// SENDING IS A SEPARATE, DELIBERATE STEP
//   --settle <id>          simulate settle(id) from the buyer wallet, print the call
//   --settle <id> --send   sign it with the buyer key in .env and broadcast
//   --refund <id>          simulate claimRefund(id) on the kernel — a job that was
//                          funded, never delivered and is past expiry gives the
//                          budget back to the buyer; --send as above
// The buyer on our jobs is the NFT relayer wallet, the seller our agent
// provider wallet; both are ours, so settling is us paying ourselves the
// ten cents we escrowed — the point is the transition, not the money.
// --send is never run by the assistant; a person runs it with `!`.
//
// Usage:
//   node scripts/erc8183-job-watch.mjs                 read, record, report
//   node scripts/erc8183-job-watch.mjs --ids 1,2,3     add ids to the record (and push them to the worker)
//   node scripts/erc8183-job-watch.mjs --sync          merge the worker's daily record in first
//   node scripts/erc8183-job-watch.mjs --self-test     pin the classifier both ways
//   node scripts/erc8183-job-watch.mjs --settle 56670 [--send]
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { decodeJob, ERC8183 } from '../worker-agent/hire.js';
import { classify, recordTransition, mergeRecords, summarise, hours } from '../shared/own-jobs.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const RECORD = path.join(ROOT, 'data', 'erc8183', 'own-jobs.json');
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
const WORKER = 'https://agent.brainonbnb.com';

const KERNEL = ERC8183.commerce, ROUTER = ERC8183.router, POLICY = ERC8183.policy;
const SEL = { getJob: '0xbf22c457', settle: '0x39c2ebb9', disputeWindow: '0x117f5f92', claimRefund: '0x5b7baf64' };
const word = (n) => BigInt(n).toString(16).padStart(64, '0');

// Our side of every job we have made: the buyer wallet the hire panel was
// driven from, and the seller wallet our agents deliver with.
const BUYER = '0xBFB4b49787CE948C1Ee304f6C197a0E8b038ddb2';
const SELLER = '0x73809F69916FcF7Ddc5BB1315fBdf96A569a5963';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

if (process.argv.includes('--self-test')) {
  let n = 0; const bad = [];
  const t = (name, cond) => { n++; if (!cond) bad.push(name); console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`); };
  const W = 604800, now = 1_000_000_000;
  const job = (status, submitted_at = 0, expired_at = now + 86400) => ({ status, submitted_at, expired_at });
  t('submitted inside the window is waiting', classify(job('SUBMITTED', now - W + 60), { now, windowSec: W }).state === 'waiting');
  t('submitted one second past the window is settleable', classify(job('SUBMITTED', now - W - 1), { now, windowSec: W }).state === 'settleable');
  t('exactly at the window end is settleable, not waiting', classify(job('SUBMITTED', now - W), { now, windowSec: W }).state === 'settleable');
  t('completed is completed whatever the clock says', classify(job('COMPLETED', now - 10), { now, windowSec: W }).state === 'completed');
  t('funded and unexpired is undelivered, no refund yet', /not yet/.test(classify(job('FUNDED', 0, now + 10), { now, windowSec: W }).note));
  t('funded and expired names claimRefund', /claimRefund/.test(classify(job('FUNDED', 0, now - 10), { now, windowSec: W }).note));
  t('open is open', classify(job('OPEN'), { now, windowSec: W }).state === 'open');
  t('rejected is closed', classify(job('REJECTED'), { now, windowSec: W }).state === 'closed');
  t('a missing job is unreadable, not settleable', classify(null, { now, windowSec: W }).state === 'unreadable');
  let r = {};
  let out = recordTransition(r, '1', { status: 'SUBMITTED', state: 'waiting' }, 'a'); r = out.record;
  t('first sighting is recorded', out.changed && r['1'].history.length === 1);
  out = recordTransition(r, '1', { status: 'SUBMITTED', state: 'waiting' }, 'b'); r = out.record;
  t('the same state again is not recorded twice', !out.changed && r['1'].history.length === 1);
  out = recordTransition(r, '1', { status: 'SUBMITTED', state: 'settleable' }, 'c'); r = out.record;
  t('a state change within the same status is a transition', out.changed && r['1'].history.length === 2);
  out = recordTransition(r, '1', { status: 'COMPLETED', state: 'completed' }, 'd'); r = out.record;
  t('completion is recorded with its own timestamp', out.changed && r['1'].history[2].at === 'd');
  t('another job does not touch this history', recordTransition(r, '2', { status: 'OPEN', state: 'open' }, 'e').record['1'].history.length === 3);
  // merge: the cron and a person saw overlapping things
  const a = { 1: { history: [{ at: '2026-09-01T00:00:00Z', status: 'SUBMITTED', state: 'waiting' }] } };
  const b = { 1: { history: [{ at: '2026-09-01T00:00:00Z', status: 'SUBMITTED', state: 'waiting' }, { at: '2026-09-03T21:00:00Z', status: 'COMPLETED', state: 'completed' }] }, 2: { history: [{ at: 'x', status: 'OPEN', state: 'open' }] } };
  const m = mergeRecords(a, b);
  t('merge keeps one copy of a transition both sides saw', m['1'].history.length === 2);
  t('merge keeps a job only the other side saw', !!m['2']);
  const c2 = mergeRecords({ 1: { history: [{ at: '2026-09-02T00:00:00Z', status: 'SUBMITTED', state: 'waiting' }] } }, a);
  t('merge collapses the same state seen at two times into the earliest', c2['1'].history.length === 1 && c2['1'].history[0].at === '2026-09-01T00:00:00Z');
  const sm = summarise(m, 'now');
  t('summary names the first completion date', sm.first_completed_seen === '2026-09-03T21:00:00Z' && sm.completed.includes('1'));
  console.log(`\n${n - bad.length} of ${n} checks passed`);
  if (bad.length) { bad.forEach((x) => console.log(`  - ${x}`)); process.exitCode = 1; }
} else {
  const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
  const call = (to, data, from) => pub.call({ to, data, ...(from ? { account: from } : {}) }).then((r) => r.data);

  const rec = fs.existsSync(RECORD) ? JSON.parse(fs.readFileSync(RECORD, 'utf8')) : { jobs: {} };
  rec.note = 'Every ERC-8183 job this project has made or delivered, watched until it completes. history holds one entry per observed transition, first sighting first. The escrow does not release itself: after the dispute window somebody has to call settle(jobId) on the EvaluatorRouter.';

  // --sync: what the cron saw while nobody was watching, merged in first.
  if (process.argv.includes('--sync')) {
    try {
      const w = await fetch(`${WORKER}/jobs/own`, { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
      if (w.error) console.log(`worker: ${w.error}`);
      else { rec.jobs = mergeRecords(rec.jobs, w.jobs); console.log(`synced ${Object.keys(w.jobs || {}).length} job(s) from the worker (last cron ${w.checked_at})`); }
    } catch (e) { console.log(`worker unreachable: ${e.message}`); }
  }

  const added = arg('ids', '') ? String(arg('ids')).split(',').map((x) => x.trim()).filter(Boolean) : [];
  const ids = [...new Set([...Object.keys(rec.jobs), ...added])];
  if (!ids.length) {
    console.log('No job ids recorded yet. First run: node scripts/erc8183-job-watch.mjs --ids 56656,56657,56669,56670,56671,56672');
    process.exitCode = 1;
  } else {
    const windowSec = Number(BigInt(await call(POLICY, SEL.disputeWindow)));
    const now = Math.floor(Date.now() / 1000);
    const at = new Date().toISOString();
    console.log(`Our jobs on the ERC-8183 kernel — dispute window ${windowSec} s (${hours(windowSec)}), read from the policy\n`);

    const rows = [];
    for (const id of ids) {
      const job = decodeJob(await call(KERNEL, SEL.getJob + word(id)));
      const c = classify(job, { now, windowSec });
      const ours = job ? (job.client.toLowerCase() === BUYER.toLowerCase() ? 'buyer' : '') + (job.provider.toLowerCase() === SELLER.toLowerCase() ? ' seller' : '') : '';
      const snap = { status: job?.status || null, state: c.state, budget_u: job?.budget_u ?? null, submitted_at: job?.submitted_at ?? null, ends_at: c.ends_at ?? null };
      const out = recordTransition(rec.jobs, id, snap, at);
      rec.jobs = out.record;
      rows.push({ id, job, c, ours: ours.trim(), changed: out.changed });
    }
    rec.checked_at = at;
    rec.summary = summarise(rec.jobs, at);
    fs.mkdirSync(path.dirname(RECORD), { recursive: true });
    fs.writeFileSync(RECORD, JSON.stringify(rec, null, 2) + '\n');

    console.log('job     status      where it stands                                            ours');
    for (const r of rows) {
      console.log(`${r.id.padEnd(7)} ${String(r.job?.status || '—').padEnd(11)} ${r.c.note.padEnd(58)} ${r.ours}${r.changed ? '  ← new' : ''}`);
    }
    const settleable = rows.filter((r) => r.c.state === 'settleable');
    const completed = rows.filter((r) => r.c.state === 'completed');
    console.log('');
    if (completed.length) console.log(`COMPLETED: ${completed.map((r) => r.id).join(', ')} — first seen ${rec.summary.first_completed_seen}, recorded in ${path.relative(ROOT, RECORD)}`);
    else console.log('No job of ours has ever reached COMPLETED. That is the kernel\'s resting state, and the thing to change.');
    if (settleable.length) {
      console.log(`Settleable now: ${settleable.map((r) => r.id).join(', ')} → node scripts/erc8183-job-watch.mjs --settle <id>   (then --send, run by a person)`);
    }

    // Newly added ids go to the worker too, so the daily cron watches them.
    if (added.length) {
      const secret = process.env.HIT_SECRET;
      if (!secret) console.log('\n(HIT_SECRET not in .env — the worker was not told about the new ids)');
      else {
        try {
          const r = await fetch(`${WORKER}/own-jobs`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hit-secret': secret }, body: JSON.stringify({ ids: added }), signal: AbortSignal.timeout(60000) }).then((x) => x.json());
          console.log(`\nworker now watches ${r.jobs ?? '?'} job(s) daily${r.error ? ` — ${r.error}` : ''}`);
        } catch (e) { console.log(`\nworker not updated: ${e.message}`); }
      }
    }

    // --- settle / refund: simulate first, send only on --send ------------------
    // Two calls, one shape: settle(jobId, "") on the EvaluatorRouter releases
    // the escrow of a delivered job after its dispute window; claimRefund(jobId)
    // on the kernel returns the budget of a job that was funded, never
    // delivered and is past its expiry (56656, 2026-09-06). Both are the
    // buyer's call, both are simulated first, neither is sent by the assistant.
    const target = arg('settle', null), refund = arg('refund', null);
    const action = target ? { id: target, name: 'settle', want: 'settleable', to: ROUTER, where: `the EvaluatorRouter ${ROUTER}`, data: SEL.settle + word(target) + word(64) + word(0), show: `settle(${target}, "")` } // settle(jobId, bytes "") — offset 0x40, length 0
      : refund ? { id: refund, name: 'refund', want: 'undelivered', to: KERNEL, where: `the kernel ${KERNEL}`, data: SEL.claimRefund + word(refund), show: `claimRefund(${refund})` }
      : null;
    if (action) {
      const row = rows.find((r) => r.id === String(action.id));
      if (!row || !row.job) { console.log(`
${action.id}: not one of the jobs read above`); process.exitCode = 1; }
      else if (row.c.state !== action.want) { console.log(`
${action.id}: not ${action.want} — ${row.c.note}`); process.exitCode = 1; }
      else {
        const { data } = action;
        console.log(`
${action.show} on ${action.where}`);
        console.log(`  from   ${BUYER} (the buyer on this job)`);
        console.log(`  data   ${data}`);
        if (action.name === 'refund') console.log(`  budget ${row.job.budget_u ?? "?"} $U back to the buyer`);
        let ok = false;
        try {
          await pub.call({ to: action.to, data, account: BUYER });
          ok = true;
          console.log('  simulation from the buyer: would go through');
        } catch (e) {
          console.log(`  simulation from the buyer: REVERTS — ${(e.shortMessage || e.message).split('\n')[0]}`);
          // Is it the caller? Ask the same question from the seller and from a
          // stranger, so the answer is "who may call this" and not just "no".
          for (const [who, from] of [['seller', SELLER], ['stranger', '0x000000000000000000000000000000000000dEaD']]) {
            try { await pub.call({ to: action.to, data, account: from }); console.log(`  simulation from the ${who}: would go through`); }
            catch (e2) { console.log(`  simulation from the ${who}: reverts — ${(e2.shortMessage || e2.message).split('\n')[0]}`); }
          }
        }
        if (!ok) process.exitCode = 1;
        else if (!process.argv.includes('--send')) {
          console.log(`
Not sent. To send it, a person runs:
  ! node scripts/erc8183-job-watch.mjs --${action.name} ${action.id} --send`);
        } else {
          const key = process.env.NFT_RELAYER_PRIVATE_KEY;
          if (!key) { console.log('NFT_RELAYER_PRIVATE_KEY missing in .env'); process.exitCode = 1; }
          else {
            const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
            if (account.address.toLowerCase() !== BUYER.toLowerCase()) { console.log(`the key in .env is ${account.address}, not the buyer ${BUYER}`); process.exitCode = 1; }
            else {
              const bal = await pub.getBalance({ address: account.address });
              console.log(`  buyer gas: ${formatEther(bal)} BNB`);
              const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
              const hash = await wallet.sendTransaction({ to: action.to, data, gas: 300000n });
              console.log(`  sent ${hash}`);
              const rcpt = await pub.waitForTransactionReceipt({ hash });
              console.log(`  ${rcpt.status} in block ${rcpt.blockNumber} — run the watch again to record the transition`);
            }
          }
        }
      }
    }
  }
}
// No process.exit() after a chain read: on Windows that trips a libuv
// assertion and turns a clean run into exit code 127.
