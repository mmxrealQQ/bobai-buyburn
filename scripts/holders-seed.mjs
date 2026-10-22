// Seeds the worker's $BOBAI holder index (worker-agent/holders.js) from a full scan (2026-10-22).
// The scan: every address in a $BOBAI Transfer since the deployment (block 88,987,679), balances by balanceOf at one
// block — written by a read-only scan to a JSON file { block, holders: [[address, bobai]] }. This script reads the
// exact balances again at that block (the file rounds), asks each address once whether it has code, and hands both to
// the worker; from there the worker keeps it every quarter hour.
//   node scripts/holders-seed.mjs <scan.json>           plan: counts it would seed
//   node scripts/holders-seed.mjs <scan.json> --send    seed, run one tick, read /holders back
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from '../worker-agent/holders.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const RPC = env.BSC_RPC_KEYED_URL_2, TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.log('usage: node scripts/holders-seed.mjs <scan.json> [--send]'); process.exit(1); }
const scan = JSON.parse(fs.readFileSync(file, 'utf8'));
const addrs = scan.holders.map(([a]) => a.toLowerCase());
const batch = async (calls) => { for (let k = 0; k < 6; k++) { try { const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls), signal: AbortSignal.timeout(45000) }).then((x) => x.json()); if (Array.isArray(r) && calls.every((_, i) => r.some((y) => y.id === i && y.result !== undefined))) return r; } catch {} await new Promise((z) => setTimeout(z, 1500)); } throw new Error('rpc batch failed'); };
const bal = {}, code = {};
for (let i = 0; i < addrs.length; i += 50) {
  const part = addrs.slice(i, i + 50);
  const b = await batch(part.map((a, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_call', params: [{ to: TOKEN, data: '0x70a08231' + a.slice(2).padStart(64, '0') }, '0x' + scan.block.toString(16)] })));
  const c = await batch(part.map((a, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_getCode', params: [a, 'latest'] })));
  for (const x of b) { const v = BigInt(x.result); if (v > 0n) bal[part[x.id]] = String(v); }
  for (const x of c) if (x.result && x.result !== '0x') code[part[x.id]] = 1;
}
const s = summarize({ bal, code });
console.log(`block ${scan.block}: ${Object.keys(bal).length} addresses with a balance, ${Object.keys(code).length} contracts — holders ${s.holders}, 1M+ ${s.holders_1m}, ours ${s.ours}`);
console.log('bands', s.bands.map((b) => `${b.from}${b.to ? '-' + b.to : '+'}: ${b.holders}`).join(' · '));
if (process.argv.includes('--send')) {
  const post = (p, body) => fetch('https://agent.brainonbnb.com' + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hit-secret': env.HIT_SECRET }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
  console.log('seed', JSON.stringify(await post('/holders/seed', { block: scan.block, bal, code })));
  for (let i = 0; i < 40; i++) { const t = await post('/holders/tick'); console.log('tick', JSON.stringify(t)); if (!t.ok || !t.behind) break; }
  const h = await fetch('https://agent.brainonbnb.com/holders').then((r) => r.json());
  console.log('live', h.block, 'holders', h.holders, '1M+', h.holders_1m, 'crossings', h.crossings_1m?.length);
}
