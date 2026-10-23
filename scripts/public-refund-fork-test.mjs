#!/usr/bin/env node
// BOBAI returns the budgets of jobs nobody delivered — on a fork first (2026-10-23, operator: "ja, bauen").
// worker-agent/public-refund.js sends claimRefund(jobId) for strangers' expired jobs from the provider wallet. Before
// it does that on BNB Chain it runs here: anvil forks the chain at the current block, a throwaway key stands in for the
// provider (the real key is never read), and the jobs are the kernel's real ones around the head (read on the fork).
//
// Held against:
//   offline   the rule: FUNDED, expired, >= 0.01 $U, client not the provider, no farm on either side, not our own
//             hire is due; a job before expiry, a delivered one, a wei budget, a self-hire, a farm's, ours and an
//             unread one are not; five a client, three a pair, forty a day, oldest first; the board entry fits 4000
//   fork      every refunded job leaves FUNDED and its client's $U grows by exactly its budget, the caller's not at
//             all; the pair with fourteen expired jobs gets three today; nothing the simulation refused; a second run
//             the same day does nothing; a wallet at its reserve stops before sending; the record adds up
//
// Needs anvil (~/.foundry/bin) and BSC_RPC_KEYED_URL_2 in .env.   node scripts/public-refund-fork-test.mjs [--offline]
import 'dotenv/config';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createPublicClient, createTestClient, http, parseAbi, parseEther } from 'viem';
import { bsc } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const PORT = 8553, LOCAL = `http://127.0.0.1:${PORT}`;
const FORK_URL = process.env.BSC_RPC_KEYED_URL_2 || process.env.BSC_RPC_KEYED_URL_1;
const ANVIL = process.env.ANVIL || path.join(os.homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil');
let failed = 0, n = 0;
const ok = (label, pass, detail = '') => { n++; if (!pass) failed++; console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const F = await import('../worker-agent/public-refund.js');
const { ERC8183 } = await import('../worker-agent/hire.js');
const { batchRead } = await import('../worker-agent/public-settle.js');

// ── offline: the rule ────────────────────────────────────────────────────────
console.log('the rule (offline)');
{
  const now = 2_000_000_000;
  const P = (i) => '0x' + String(i).padStart(40, '0');
  const OWN = P(66);
  const job = (o) => ({ status: 'FUNDED', expired_at: now - 100, budget_u: 0.1, client: P(900), provider: P(1), ...o });
  const jobs = [
    { id: '1', job: job({}) },
    { id: '2', job: job({ expired_at: now + 100 }) },
    { id: '3', job: job({ status: 'SUBMITTED' }) },
    { id: '4', job: job({ budget_u: 1e-12 }) },
    { id: '5', job: job({ client: P(2), provider: P(2) }) },
    { id: '6', job: job({ provider: P(77) }) },
    { id: '7', job: job({ client: P(78) }) },
    { id: '8', job: job({ client: OWN }) },
    { id: '9', job: null },
    { id: '10', job: job({ status: 'EXPIRED' }) },
  ];
  const r = F.pickRefunds(jobs, { now, knownFarms: [P(77), P(78)], own: new Set([OWN]) });
  ok('a funded job past expiry, paid by another, >= 0.01 $U, is due', r.due.join() === '1', r.due.join());
  ok('before expiry, delivered and already expired (refunded) jobs are not', !['2', '3', '10'].some((x) => r.due.includes(x)));
  ok('a wei budget, a self-hire, a farm provider, a farm client and our own hire are skipped, each counted', r.skipped['under 0.01 $U'] === 1 && r.skipped['client is the provider'] === 1 && r.skipped.farm === 2 && r.skipped['our own hire'] === 1, JSON.stringify(r.skipped));
  ok('an unread job is left for the next day', r.skipped.unread === 1 && !r.due.includes('9'));
  const oneClient = Array.from({ length: 9 }, (_, i) => ({ id: String(100 + i), job: job({ provider: P(20 + i), client: P(500) }) }));
  ok('one client, nine providers: five a day, the oldest first', F.pickRefunds(oneClient, { now }).due.join() === '100,101,102,103,104');
  const onePair = Array.from({ length: 14 }, (_, i) => ({ id: String(200 + i), job: job({ provider: P(30), client: P(600) }) }));
  ok('the same client and provider fourteen times: three a day', F.pickRefunds(onePair, { now }).due.length === 3);
  const many = Array.from({ length: 60 }, (_, i) => ({ id: String(300 + i), job: job({ provider: P(1000 + i), client: P(2000 + i) }) }));
  const rm = F.pickRefunds(many, { now });
  ok('forty a day whatever is due, the oldest first', rm.due.length === F.MAX_PER_DAY && F.MAX_PER_DAY === 40 && rm.due[0] === '300' && rm.skipped["over the day's cap"] === 20);
  ok('the data sent is claimRefund(jobId)', F.refundData(57002) === '0x5b7baf64' + (57002).toString(16).padStart(64, '0'));
  const fake = Array.from({ length: 40 }, (_, i) => ({ id: String(57000 + i), client: P(3000 + i), provider: P(4000 + i), returned_u: 0.1, tx: '0x' + 'a'.repeat(64) }));
  const e = F.refundEntry(fake);
  ok('the board entry of a full day fits the board (4000, a reply carries the title too) and points to the rest', (e.title.length + 2 + e.body.length) <= 4000 && e.title.length <= 140 && /and \d+ more/.test(e.body) && /\$4\.00 back to 40 clients/.test(e.title), `${e.title.length + e.body.length} chars`);
  const one = F.refundEntry(fake.slice(0, 1));
  ok('one job reads as one job', /^Refunded: 1 expired job nobody delivered, \$0\.10 back to 1 client$/.test(one.title) && !/more/.test(one.body), one.title);
}
if (process.argv.includes('--offline') || process.argv.includes('--self-test')) { console.log(`\n${n - failed}/${n} ok${failed ? `, ${failed} FAIL` : ''}`); process.exit(failed ? 1 : 0); }

if (!FORK_URL) { ok('an archive node for the fork', false); process.exit(1); }
console.log('\nthe run (fork)');
const anvil = spawn(ANVIL, ['--fork-url', FORK_URL, '--port', String(PORT), '--chain-id', '56', '--silent', '--no-rate-limit', '--gas-price', '100000000', '--block-base-fee-per-gas', '0'], { stdio: 'ignore' });
const stop = () => { try { anvil.kill(); } catch { /* gone */ } };
process.on('exit', stop);
const chain = { ...bsc, rpcUrls: { default: { http: [LOCAL] } } };
const pub = createPublicClient({ chain, transport: http(LOCAL, { timeout: 120000 }) });
const test = createTestClient({ chain, mode: 'anvil', transport: http(LOCAL, { timeout: 120000 }) });
for (let i = 0; i < 60; i++) { try { await pub.getBlockNumber(); break; } catch { await sleep(500); } }

// the kernel's recent jobs, read on the fork: the expired funded ones are the run's real input
const head = Number(BigInt((await pub.call({ to: ERC8183.commerce, data: '0x50355d76' })).data));
const ids = Array.from({ length: 400 }, (_, i) => String(head - i)).filter((x) => Number(x) > 0);
const read = await batchRead(ids, LOCAL);
const nowSec = Number((await pub.getBlock()).timestamp);
const expired = read.filter((x) => x.job && x.job.status === 'FUNDED' && nowSec >= x.job.expired_at);
ok('the kernel has funded jobs past expiry around its head', expired.length >= 3, `${expired.length} of the last ${ids.length}`);

const key = generatePrivateKey(), me = privateKeyToAccount(key).address;
await test.setBalance({ address: me, value: parseEther('0.01') });
const kv = new Map([['settle:farms', JSON.stringify(['0xc0d7d888d8ff8925dc95fbb16c89217718bf7c8d'])]]);
const env = { AGENT_PROVIDER_PRIVATE_KEY: key, AGENT: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } } };
const U = ERC8183.paymentToken, ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const bal = (a) => pub.readContract({ address: U, abi: ERC20, functionName: 'balanceOf', args: [a] });
const clients = [...new Set(expired.map((x) => x.job.client.toLowerCase()))];
const before = Object.fromEntries(await Promise.all(clients.map(async (c) => [c, await bal(c)])));
const meBefore = await bal(me);

// the run's own clock is the fork's: the expiry test uses the block time, not this machine's
const run = await F.runPublicRefund(env, { rpcUrl: LOCAL, ids, now: new Date(nowSec * 1000) });
const done = run.done.filter((d) => d.refunded);
console.log(`    run: ${run.read} read, ${run.due} due, ${run.refunded} refunded (${run.returned_u} $U), ${run.refused} refused, skipped ${JSON.stringify(run.skipped)}${run.stopped ? ', stopped: ' + run.stopped : ''}`);
ok('it refunded jobs', done.length > 0, `${done.length}`);
const after = await batchRead(done.map((d) => String(d.id)), LOCAL);
ok('every job it refunded has left FUNDED on the kernel', after.every((x) => x.job && x.job.status !== 'FUNDED'), [...new Set(after.map((x) => x.job?.status))].join());
// the money: each refund's receipt carries one transfer out of the kernel to the job's client of exactly its budget,
// in whatever stablecoin the job was paid in ($U for most, USDT for some — 23.10.)
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', pad = (a) => '0x' + String(a).slice(2).toLowerCase().padStart(64, '0');
const paid = await Promise.all(done.map(async (d) => { const rc = await pub.getTransactionReceipt({ hash: d.tx }); return rc.logs.some((l) => l.topics[0] === TRANSFER && l.topics[1] === pad(ERC8183.commerce) && l.topics[2] === pad(d.client) && BigInt(l.data) === BigInt(d.returned_wei)); }));
ok('each refund paid its client exactly the job\'s budget, out of the escrow', paid.every(Boolean), `${paid.filter(Boolean).length}/${paid.length}`);
const due = {}; for (const d of done) due[String(d.client).toLowerCase()] = 1;
ok('the caller got nothing from it', (await bal(me)) === meBefore);
const pairs = {}; for (const d of done) { const k = `${String(d.client).toLowerCase()}>${String(d.provider).toLowerCase()}`; pairs[k] = (pairs[k] || 0) + 1; }
ok('no client->provider pair more than three times, no client more than five', Object.values(pairs).every((v) => v <= 3) && Object.values(done.reduce((m, d) => { const c = String(d.client).toLowerCase(); m[c] = (m[c] || 0) + 1; return m; }, {})).every((v) => v <= 5));
ok('no simulation refused a due job', run.refused === 0 && run.failed === 0, JSON.stringify(run.done.filter((d) => !d.refunded)).slice(0, 160));
const second = await F.runPublicRefund(env, { rpcUrl: LOCAL, ids, now: new Date(nowSec * 1000) });
ok('a second run the same day does nothing', second.skipped === 'ran today');
const page = await F.readPublicRefund(env);
ok('the record adds up: jobs, clients and $U returned', page.totals.jobs === done.length && page.totals.clients.length === Object.keys(due).length && Math.abs(page.totals.returned_u - done.reduce((s, d) => s + Number(d.returned_u), 0)) < 1e-4);
const poor = generatePrivateKey();
await test.setBalance({ address: privateKeyToAccount(poor).address, value: parseEther('0.001005') });
kv.delete(`refund:public:day:${new Date(nowSec * 1000).toISOString().slice(0, 10)}`);
const low = await F.runPublicRefund({ ...env, AGENT_PROVIDER_PRIVATE_KEY: poor }, { rpcUrl: LOCAL, ids, now: new Date(nowSec * 1000) });
ok('a wallet at its reserve stops before sending anything', (low.refunded === 0 && /stays for our own deliveries/.test(low.stopped || '')) || low.due === 0, low.stopped || `due ${low.due}`);

console.log(`\n${n - failed}/${n} ok${failed ? `, ${failed} FAIL` : ''}`);
stop();
process.exit(failed ? 1 : 0);
