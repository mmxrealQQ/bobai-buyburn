#!/usr/bin/env node
// Seed the public settle (worker-agent/public-settle.js) with the jobs it should look after (2026-10-21).
// From the job census (data/erc8183/jobs.jsonl) and the kernel's jobs since: every job that is not finished and not
// past expiry — open, funded or delivered — of a provider that is not a farm. Farms: a provider with more than 1,000
// jobs in the census (on 21.10. one: 0xc0d7…7c8d, 56,167 jobs at 0.01 $U for 24,013 clients); they go to KV as
// settle:farms, so the job watcher never adds their jobs again. The worker's daily rule decides what is settled.
// From then on the job watcher adds every new job of the kernel by itself.
//   node scripts/public-settle-seed.mjs            plan: what would be sent
//   node scripts/public-settle-seed.mjs --confirm  POST /settle/public/seed (HIT_SECRET)
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const AGENT = 'https://agent.brainonbnb.com';
const KERNEL = '0xEa4DAa3100A767e86FDed867729ae7446476EBA6';
const RPC = 'https://bsc-dataseed.binance.org';
const FARM_LINE = 1000;
const confirm = process.argv.includes('--confirm');
const now = Math.floor(Date.now() / 1000);

const census = fs.readFileSync(path.join(ROOT, 'data', 'erc8183', 'jobs.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const count = {}; for (const j of census) count[j.provider.toLowerCase()] = (count[j.provider.toLowerCase()] || 0) + 1;
const farms = Object.entries(count).filter(([, c]) => c > FARM_LINE).map(([p]) => p);

const rpc = async (method, params) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
const { decodeJob } = await import('../worker-agent/hire.js');
const counter = Number(BigInt(await rpc('eth_call', [{ to: KERNEL, data: '0x50355d76' }, 'latest'])));
const last = Math.max(...census.map((j) => j.id));
const tail = [];
for (let id = last + 1; id <= counter; id++) {
  const j = decodeJob(await rpc('eth_call', [{ to: KERNEL, data: '0xbf22c457' + BigInt(id).toString(16).padStart(64, '0') }, 'latest']));
  if (j) tail.push({ id: Number(j.id), provider: j.provider, status: j.status, expired_at: j.expired_at });
}
const live = (j) => j.status === 'SUBMITTED' || (['OPEN', 'FUNDED'].includes(j.status) && j.expired_at > now);
const pickFrom = (list) => list.filter((j) => live(j) && !farms.includes(String(j.provider).toLowerCase())).map((j) => ({ id: String(j.id), provider: String(j.provider).toLowerCase() }));
const candidates = [...pickFrom(census), ...pickFrom(tail)];
console.log(`census up to job ${last}, kernel at ${counter} (${tail.length} read since)`);
console.log(`farms (> ${FARM_LINE} jobs): ${farms.join(', ') || 'none'}`);
console.log(`candidates: ${candidates.length} (of them ${candidates.filter((c) => census.find((j) => String(j.id) === c.id)?.status === 'SUBMITTED').length} delivered in the census)`);
if (!confirm) { console.log('\nplan only. Nothing was sent. Re-run with --confirm.'); process.exit(0); }
const secret = process.env.HIT_SECRET;
if (!secret) { console.error('refused: HIT_SECRET is not in .env'); process.exit(1); }
const r = await fetch(`${AGENT}/settle/public/seed`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hit-secret': secret }, body: JSON.stringify({ candidates, farms }) });
console.log(r.status, await r.text());
