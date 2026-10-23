#!/usr/bin/env node
// BOBAI settles every agent's finished jobs — on a fork first (2026-10-21, operator: "ja, Settle-Helfer").
// worker-agent/public-settle.js sends settle(jobId) for strangers' jobs from the provider wallet. Before it does that
// on BNB Chain it runs here: anvil forks the chain at the current block, a throwaway key stands in for the provider
// (the real key is never read), and the candidates are real jobs from the census (data/erc8183/jobs.jsonl).
//
// Held against:
//   offline   the rule: a delivered job past its window, router as evaluator, >= 0.01 $U, client not the provider
//             is due; a self-hire, a wei budget, a farm (named, or over the line), a job still in its window, a
//             finished or expired one are not — the last three leave the list; ten a provider a day, oldest first
//   fork      the due jobs become COMPLETED on the kernel and their providers' $U grows; a self-hire and a farm job
//             in the list get no transaction and leave it; one provider's twelve jobs: ten today, two stay;
//             a second run the same day does nothing; a wallet at its reserve stops before sending
//   the page  /settle/public's record: the totals add up to what was released
//
// Needs anvil (~/.foundry/bin) and BSC_RPC_KEYED_URL_2 in .env.   node scripts/public-settle-fork-test.mjs
import 'dotenv/config';
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createTestClient, http, parseAbi, parseEther } from 'viem';
import { bsc } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8551, LOCAL = `http://127.0.0.1:${PORT}`;
const FORK_URL = process.env.BSC_RPC_KEYED_URL_2 || process.env.BSC_RPC_KEYED_URL_1;
const ANVIL = process.env.ANVIL || path.join(os.homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil');
let failed = 0, n = 0;
const ok = (label, pass, detail = '') => { n++; if (!pass) failed++; console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = await import('../worker-agent/public-settle.js');
const { ERC8183, decodeJob } = await import('../worker-agent/hire.js');

// ── offline: the rule ────────────────────────────────────────────────────────
console.log('the rule (offline)');
{
  const now = 2_000_000_000, W = 604800, R = ERC8183.router;
  const P = (i) => '0x' + String(i).padStart(40, '0');
  const job = (o) => ({ status: 'SUBMITTED', submitted_at: now - W - 100, expired_at: now + 9e5, evaluator: R, budget_u: 0.1, client: P(900), provider: P(1), ...o });
  const jobs = [
    { id: '1', job: job({}) },
    { id: '2', job: job({ client: P(2), provider: P(2) }) },
    { id: '3', job: job({ budget_u: 1e-12 }) },
    { id: '4', job: job({ provider: P(77) }) },
    { id: '5', job: job({ submitted_at: now - 100 }) },
    { id: '6', job: job({ status: 'COMPLETED' }) },
    { id: '7', job: job({ status: 'FUNDED', expired_at: now - 1 }) },
    { id: '8', job: job({ status: 'OPEN', expired_at: now + 100 }) },
    { id: '9', job: job({ evaluator: P(5) }) },
    { id: '10', job: null },
  ];
  const cand = Object.fromEntries(jobs.map((x) => [x.id, { provider: x.job?.provider || P(1) }]));
  const r = S.pickDue(jobs, cand, { now, windowSec: W, router: R, knownFarms: [P(77)] });
  ok('a delivered job past its window, paid by another, >= 0.01 $U, is due', r.due.join() === '1', r.due.join());
  ok('a self-hire, a wei budget, a farm job and another evaluator are dropped', ['2', '3', '4', '9'].every((x) => r.drop.includes(x)), r.drop.join());
  ok('a job still in its window and an open job before expiry stay on the list, untouched', !r.drop.includes('5') && !r.due.includes('5') && !r.drop.includes('8'));
  ok('a completed job leaves the list; a funded job past expiry stays on it, unsettled, for the public refund (2026-10-23)', r.drop.includes('6') && !r.drop.includes('7') && !r.due.includes('7'));
  ok('a job that could not be read stays for the next day', !r.drop.includes('10') && !r.due.includes('10'));
  const many = Array.from({ length: 14 }, (_, i) => ({ id: String(100 + i), job: job({ client: P(900 + i) }) }));
  const c2 = Object.fromEntries(many.map((x) => [x.id, { provider: P(1) }]));
  const r2 = S.pickDue(many, c2, { now, windowSec: W, router: R });
  ok('ten a provider a day, the oldest first', r2.due.length === 10 && r2.due[0] === '100' && r2.due[9] === '109', r2.due.join());
  // not to be milked (operator, 21.10.)
  const oneClient = Array.from({ length: 12 }, (_, i) => ({ id: String(200 + i), job: job({ provider: P(20 + i), client: P(500) }) }));
  const r4 = S.pickDue(oneClient, Object.fromEntries(oneClient.map((x) => [x.id, { provider: x.job.provider }])), { now, windowSec: W, router: R });
  ok('one client, twelve providers: ten a client a day', r4.due.length === 10, String(r4.due.length));
  const onePair = Array.from({ length: 6 }, (_, i) => ({ id: String(300 + i), job: job({ provider: P(30), client: P(600) }) }));
  const r5 = S.pickDue(onePair, Object.fromEntries(onePair.map((x) => [x.id, { provider: P(30) }])), { now, windowSec: W, router: R });
  ok('the same client and provider over and over: three a day', r5.due.length === 3, String(r5.due.length));
  // an attacker's 200 jobs (many providers, many clients) made BEFORE three honest jobs cannot take the day from them
  const attack = Array.from({ length: 200 }, (_, i) => ({ id: String(1000 + i), job: job({ provider: P(4000 + (i % 40)), client: P(7000 + i) }) }));
  const honest = [0, 1, 2].map((i) => ({ id: String(9000 + i), job: job({ provider: P(60 + i), client: P(800 + i) }) }));
  const all = [...attack, ...honest];
  const r6 = S.pickDue(all, Object.fromEntries(all.map((x) => [x.id, { provider: x.job.provider }])), { now, windowSec: W, router: R });
  ok('providers take turns: three honest providers behind 200 jobs of 40 others are all settled today', honest.every((h) => r6.due.includes(h.id)) && r6.due.length === 80, `${r6.due.length} due, honest ${honest.filter((h) => r6.due.includes(h.id)).length}/3`);
  ok('and the day is capped at 80 whatever is due', r6.due.length <= S.MAX_PER_DAY);
  const spikeJobs = Array.from({ length: 201 }, (_, i) => ({ id: String(20000 + i), job: job({ provider: P(100 + i), client: P(300 + i) }) }));
  const r7 = S.pickDue(spikeJobs, Object.fromEntries(spikeJobs.map((x) => [x.id, { provider: x.job.provider }])), { now, windowSec: W, router: R });
  ok('more than 200 due in a day is marked as a spike (and still capped)', r7.spike === 201 && r7.due.length === 80);
  const farm = Array.from({ length: 1001 }, (_, i) => ({ id: String(5000 + i), job: job({ provider: P(8) }) }));
  const r3 = S.pickDue(farm, Object.fromEntries(farm.map((x) => [x.id, { provider: P(8) }])), { now, windowSec: W, router: R });
  ok('a provider with more than 1,000 candidates is a farm: none due, all dropped', r3.due.length === 0 && r3.farms.includes(P(8)) && r3.drop.length === 1001);
}

if (!FORK_URL) { ok('an archive node for the fork', false); process.exit(1); }
console.log('\nthe run (fork)');
const anvil = spawn(ANVIL, ['--fork-url', FORK_URL, '--port', String(PORT), '--chain-id', '56', '--silent', '--no-rate-limit', '--gas-price', '100000000', '--block-base-fee-per-gas', '0'], { stdio: 'ignore' });
const stop = () => { try { anvil.kill(); } catch { /* gone */ } };
process.on('exit', stop);
const chain = { ...bsc, rpcUrls: { default: { http: [LOCAL] } } };
const pub = createPublicClient({ chain, transport: http(LOCAL, { timeout: 120000 }) });
const test = createTestClient({ chain, mode: 'anvil', transport: http(LOCAL, { timeout: 120000 }) });
for (let i = 0; i < 60; i++) { try { await pub.getBlockNumber(); break; } catch { await sleep(500); } }
const readJob = async (id) => decodeJob((await pub.call({ to: ERC8183.commerce, data: '0xbf22c457' + BigInt(id).toString(16).padStart(64, '0') })).data);

// candidates from the census: still-due real jobs at this block, a self-hire and a farm job
const FARM = '0xc0d7d888d8ff8925dc95fbb16c89217718bf7c8d', R = ERC8183.router.toLowerCase();
const census = fs.readFileSync(path.join(ROOT, 'data', 'erc8183', 'jobs.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const realIds = census.filter((j) => j.status === 'SUBMITTED' && String(j.evaluator).toLowerCase() === R && BigInt(j.budget || 0) >= 10n ** 16n && j.provider !== FARM && j.client.toLowerCase() !== j.provider.toLowerCase()).map((j) => j.id);
const selfId = census.find((j) => j.status === 'SUBMITTED' && j.client.toLowerCase() === j.provider.toLowerCase() && BigInt(j.budget || 0) > 0n)?.id;
const farmId = census.find((j) => j.provider === FARM && j.status === 'SUBMITTED')?.id;
const realNow = [];
for (const id of realIds) { const j = await readJob(id); if (j?.status === 'SUBMITTED') realNow.push({ id: String(id), job: j }); }
ok('the census still has real jobs due at this block', realNow.length >= 3, `${realNow.length} of ${realIds.length}`);
const byProv = {}; for (const x of realNow) (byProv[x.job.provider.toLowerCase()] ??= []).push(x.id);
const busy = Object.entries(byProv).sort((a, b) => b[1].length - a[1].length)[0];
const pick = [...new Set([...(busy?.[1] || []), ...realNow.slice(0, 6).map((x) => x.id)])];
const cand = Object.fromEntries([...pick.map((id) => [id, { provider: realNow.find((x) => x.id === id).job.provider.toLowerCase() }]), [String(selfId), { provider: 'self' }], [String(farmId), { provider: FARM }]]);

const key = generatePrivateKey(), me = privateKeyToAccount(key).address;
await test.setBalance({ address: me, value: parseEther('0.01') });
const kv = new Map([[S.CANDIDATES_KEY, JSON.stringify(cand)], [S.FARMS_KEY, JSON.stringify([FARM])]]);
const env = { AGENT_PROVIDER_PRIVATE_KEY: key, AGENT: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } } };
const U = ERC8183.paymentToken, ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const provs = [...new Set(pick.map((id) => cand[id].provider))];
const before = Object.fromEntries(await Promise.all(provs.map(async (p) => [p, await pub.readContract({ address: U, abi: ERC20, functionName: 'balanceOf', args: [p] })])));

const run = await S.runPublicSettle(env, { rpcUrl: LOCAL });
const settled = run.done.filter((d) => d.settled).map((d) => String(d.id));
console.log(`    run: ${run.candidates} candidates, ${run.due} due, ${run.settled} settled, ${run.refused} refused, ${run.dropped} dropped${run.stopped ? ', stopped: ' + run.stopped : ''}`);
const after = await Promise.all(settled.map(readJob));
ok('every job it settled is COMPLETED on the kernel', settled.length > 0 && after.every((j) => j.status === 'COMPLETED'), `${settled.length} settled`);
const grew = await Promise.all(provs.map(async (p) => (await pub.readContract({ address: U, abi: ERC20, functionName: 'balanceOf', args: [p] })) > before[p]));
ok('and each provider it settled for holds more $U than before', provs.filter((p) => settled.some((id) => cand[id].provider === p)).every((p) => grew[provs.indexOf(p)]));
ok('the self-hire and the farm job got no transaction and left the list', !run.done.some((d) => [String(selfId), String(farmId)].includes(String(d.id))) && !JSON.parse(kv.get(S.CANDIDATES_KEY))[selfId] && !JSON.parse(kv.get(S.CANDIDATES_KEY))[farmId], `self ${selfId}, farm ${farmId}`);
const busyDone = settled.filter((id) => busy[1].includes(id)).length;
// at most ten a provider, three a client->provider pair: what it may settle today, the rest stays on the list
const pairs = {}; for (const id of busy[1]) { const c = realNow.find((x) => x.id === id).job.client.toLowerCase(); pairs[c] = (pairs[c] || 0) + 1; }
const allowed = Math.min(10, Object.values(pairs).reduce((s, k) => s + Math.min(3, k), 0));
ok(`the busiest provider (${busy[1].length} due, ${Object.keys(pairs).length} client(s)): ${allowed} today, the rest waits`, busyDone === allowed && Object.keys(JSON.parse(kv.get(S.CANDIDATES_KEY))).filter((id) => busy[1].includes(id)).length === busy[1].length - busyDone, `${busyDone} settled`);
ok('no simulation refused a due job', run.refused === 0, JSON.stringify(run.done.filter((d) => !d.settled)).slice(0, 160));
const second = await S.runPublicSettle(env, { rpcUrl: LOCAL });
ok('a second run the same day does nothing', second.skipped === 'ran today');
const page = await S.readPublicSettle(env);
ok('the record adds up: jobs, providers and $U released', page.totals.jobs === settled.length && page.totals.providers.length === new Set(settled.map((id) => cand[id].provider)).size && Math.abs(page.totals.released_u - run.done.filter((d) => d.settled).reduce((s, d) => s + d.released_u, 0)) < 1e-9, JSON.stringify(page.totals).slice(0, 120));
// a wallet at its reserve stops before it sends
const poor = generatePrivateKey();
await test.setBalance({ address: privateKeyToAccount(poor).address, value: parseEther('0.00101') });
kv.delete(`settle:public:day:${new Date().toISOString().slice(0, 10)}`);
const low = await S.runPublicSettle({ ...env, AGENT_PROVIDER_PRIVATE_KEY: poor }, { rpcUrl: LOCAL });
ok('a wallet at its reserve stops before sending anything', low.settled === 0 && /stays for our own deliveries/.test(low.stopped || '') || low.due === 0, low.stopped || `due ${low.due}`);

console.log(`\n${n - failed}/${n} ok${failed ? `, ${failed} FAIL` : ''}`);
stop();
process.exit(failed ? 1 : 0);
