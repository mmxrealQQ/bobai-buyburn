// THE HIRE'S NONCE, ON A FORK (2026-11-09, operator's go for the fix in worker-agent/agent-hires.js hireOnce).
// Job 57111 (27.10.) stopped after its third transaction with "nonce lower than the current nonce": viem asked the
// fallback transport for the nonce before every send, and a node a block behind answered the old number. This replays
// that on an anvil fork: a throwaway wallet sends five transactions in a row through a transport whose every second
// eth_getTransactionCount answers one block late (the lagging node). The old way (no nonce given) must fail on it,
// the new way (the pending count read once, then counted locally — exactly as hireOnce does now) must send all five.
// And the source of hireOnce must carry the new way. Read-only on mainnet; the fork is local and thrown away.
//   node scripts/hire-nonce-fork-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPublicClient, createWalletClient, custom, parseEther } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { bsc } from 'viem/chains';
const ROOT = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const ANVIL = process.env.ANVIL || path.join(os.homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil');
const PORT = 8600 + Math.floor(Math.random() * 300), LOCAL = `http://127.0.0.1:${PORT}`;
let n = 0, failed = 0;
const ok = (what, cond, detail = '') => { n++; if (!cond) failed++; console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };
// the source first
const src = fs.readFileSync(path.join(ROOT, 'worker-agent', 'agent-hires.js'), 'utf8');
const body = src.slice(src.indexOf('export async function hireOnce'), src.indexOf('export async function hireOnce') + 6000);
ok('hireOnce reads the pending nonce once, of every node, the highest taken, before its first send', /RPCS\.map\(\(u\) => fetch\(u, [^\n]*eth_getTransactionCount[^\n]*'pending'/.test(body) && /let nonce = Math\.max\(\.\.\.known\)/.test(body) && body.indexOf('let nonce') < body.indexOf('const send = async'));
ok('… and every send takes the next number', /sendTransaction\(\{ to, data, gasPrice: GAS_PRICE, nonce: nonce\+\+ \}\)/.test(body));
// the public settle run (operator's go, 9.11.): the same count, and a failed send must never leave a gap
const ps = fs.readFileSync(path.join(ROOT, 'worker-agent', 'public-settle.js'), 'utf8');
ok('the settle run asks every node for the pending count and takes the highest', /eth_getTransactionCount', params: \[account\.address, 'pending'\]/.test(ps) && /return known\.length \? Math\.max\(\.\.\.known\) : null/.test(ps));
ok('… sends with that number and counts on only after a hash came back', /sendTransaction\(\{ to: ERC8183\.router, data, gasPrice: GAS_PRICE, gas: 250000n, nonce \}\);\s*nonce\+\+;/.test(ps));
ok('… and after a send that threw without a hash asks the count again (no gap, no number twice)', /if \(!hash\) nonce = null;/.test(ps) && /if \(nonce == null\) nonce = await pendingNonce\(\);/.test(ps));
if (!fs.existsSync(ANVIL)) { console.error(`anvil not found at ${ANVIL}`); process.exit(2); }
const FORK_URL = env.BSC_RPC_KEYED_URL_2 || 'https://bsc-rpc.publicnode.com';
const anvil = spawn(ANVIL, ['--fork-url', FORK_URL, '--port', String(PORT), '--chain-id', '56', '--silent', '--block-time', '1'], { stdio: 'ignore' });
const stop = () => { try { anvil.kill(); } catch {} };
const rpc = async (method, params = []) => (await (await fetch(LOCAL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json());
for (let i = 0; i < 60; i++) { try { if ((await rpc('eth_blockNumber')).result) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
// the lagging node: every second nonce question is answered at the block before the latest
let asks = 0;
const lagging = custom({ async request({ method, params }) {
  // two of hireOnce's three nodes (defibit, binance) do not know eth_fillTransaction (checked 9.11.): viem then asks
  // the nonce itself with eth_getTransactionCount, the call a lagging node answers wrong
  if (method === 'eth_fillTransaction') { const e = new Error('The method eth_fillTransaction does not exist/is not available'); e.code = -32601; throw e; }
  // (a node that has not seen the wallet's last confirmed transaction yet: its count one lower)
  if (method === 'eth_getTransactionCount' && ++asks % 2 === 0) {
    const c = parseInt((await rpc(method, [params[0], 'latest'])).result, 16);
    return '0x' + Math.max(0, c - 1).toString(16);
  }
  const r = await rpc(method, params); if (r.error) { const e = new Error(r.error.message); e.code = r.error.code; throw e; } return r.result;
} });
async function fiveSends(counted) {
  const k = generatePrivateKey(), me = privateKeyToAccount(k);
  await rpc('anvil_setBalance', [me.address, '0x' + parseEther('1').toString(16)]);
  const pub = createPublicClient({ chain: bsc, transport: lagging }), wal = createWalletClient({ account: me, chain: bsc, transport: lagging });
  // as hireOnce: asked twice (the lagging node answers one of them) and the highest taken
  let nonce = counted ? Math.max(await pub.getTransactionCount({ address: me.address, blockTag: 'pending' }), await pub.getTransactionCount({ address: me.address, blockTag: 'pending' })) : null;
  const sent = [];
  try {
    for (let i = 0; i < 5; i++) {
      const hash = await wal.sendTransaction({ to: me.address, value: 1n, gasPrice: 1000000000n, ...(counted ? { nonce: nonce++ } : {}) });
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 30000, pollingInterval: 300 });
      sent.push(rc.status);
    }
    return { sent, error: null };
  } catch (e) { return { sent, error: String(e.shortMessage || e.message).slice(0, 120) }; }
}
try {
  const old = await fiveSends(false);
  ok('the old way (viem asks the nonce before each send) fails on the lagging node, as job 57111 did', old.sent.length < 5 && !!old.error, `${old.sent.length} sent, then: ${old.error}`);
  const now = await fiveSends(true);
  ok('the new way (read once, counted here) sends all five through the same lagging node', now.sent.length === 5 && now.sent.every((s) => s === 'success') && !now.error, `${now.sent.length} sent${now.error ? ', then: ' + now.error : ''}`);
} finally { stop(); }
console.log(`\n${n - failed}/${n} checks pass`);
process.exit(failed ? 1 : 0);
