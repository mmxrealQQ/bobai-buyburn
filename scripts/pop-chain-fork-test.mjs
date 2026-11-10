// BRAIN POP ON CHAIN, ON A FORK (2026-11-10, operator: "the ecosystem on the blockchain", option 1). worker-agent/
// pop-chain.js writes each closed day's champion and the sha256 of its board as a 0-BNB transaction to the prize
// wallet. This runs it on an anvil fork of BNB Chain with a throwaway wallet and the real boards of the season so far:
//   1  the days since 6.11. are written, oldest first, one transaction each, 0 BNB, to the prize wallet
//   2  the input data is the record text, readable as UTF-8; its sha256 is the hash of the board GET /pop/chain gives
//   3  a second run writes nothing (each day once)
//   4  a wallet at its reserve sends nothing and says why
//   5  the cron calls it only in the first hour of the UTC day, only on the quarter-hour cron
// Read-only on mainnet; the fork is local and thrown away.   node scripts/pop-chain-fork-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseEther } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
const ROOT = path.resolve(import.meta.dirname, '..');
const envFile = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const ANVIL = process.env.ANVIL || path.join(os.homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil');
const PORT = 8600 + Math.floor(Math.random() * 300), LOCAL = `http://127.0.0.1:${PORT}`;
let n = 0, failed = 0;
const ok = (what, cond, detail = '') => { n++; if (!cond) failed++; console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };
const { runPopChain, readPopChain, popChainDue, PRIZE_WALLET } = await import('file:///' + path.join(ROOT, 'worker-agent', 'pop-chain.js').replace(/\\/g, '/'));
// 5: the cron wiring
const idx = fs.readFileSync(path.join(ROOT, 'worker-agent', 'index.js'), 'utf8');
ok('the quarter-hour cron runs it in the first hour of the UTC day', /event\.cron === '\*\/15 \* \* \* \*' && popChainDue\(/.test(idx));
ok('… due from 00:15 to 00:59, not before, not after', !popChainDue(new Date('2026-11-10T00:00:00Z')) && popChainDue(new Date('2026-11-10T00:15:00Z')) && popChainDue(new Date('2026-11-10T00:45:00Z')) && !popChainDue(new Date('2026-11-10T01:00:00Z')));
if (!fs.existsSync(ANVIL)) { console.error(`anvil not found at ${ANVIL}`); process.exit(2); }
const FORK_URL = envFile.BSC_RPC_KEYED_URL_2 || 'https://bsc-rpc.publicnode.com';
const anvil = spawn(ANVIL, ['--fork-url', FORK_URL, '--port', String(PORT), '--chain-id', '56', '--silent', '--block-time', '1'], { stdio: 'ignore' });
const stop = () => { try { anvil.kill(); } catch {} };
const rpc = async (method, params = []) => (await (await fetch(LOCAL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json());
try {
  for (let i = 0; i < 60; i++) { try { if ((await rpc('eth_blockNumber')).result) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  const kv = new Map(), KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } };
  const key = generatePrivateKey(), me = privateKeyToAccount(key);
  await rpc('anvil_setBalance', [me.address, '0x' + parseEther('0.01').toString(16)]);
  const env = { AGENT: KV, AGENT_PROVIDER_PRIVATE_KEY: key };
  const now = new Date('2026-11-10T00:15:00Z');
  const r1 = await runPopChain(env, { rpcUrl: LOCAL, now });
  const days = (await readPopChain(env)).days.slice().reverse();
  ok('1 the days 6.-9.11. are written, oldest first, one transaction each', r1.ok && days.map((d) => d.day).join() === '2026-11-06,2026-11-07,2026-11-08,2026-11-09', JSON.stringify({ written: r1.written, skipped: r1.skipped, stopped: r1.stopped, days: days.map((d) => d.day) }));
  let allTo = true, allZero = true, allText = true, allHash = true, firstMemo = '';
  for (const d of days) {
    const tx = (await rpc('eth_getTransactionByHash', [d.tx])).result, one = await readPopChain(env, d.day);
    allTo &&= tx.to.toLowerCase() === PRIZE_WALLET.toLowerCase(); allZero &&= BigInt(tx.value) === 0n;
    const memo = Buffer.from(tx.input.slice(2), 'hex').toString('utf8'); firstMemo ||= memo;
    allText &&= memo === one.memo && memo.includes(`CHAMPION ${d.champion}`) && memo.includes(d.run);
    allHash &&= crypto.createHash('sha256').update(one.board, 'utf8').digest('hex') === d.sha256 && memo.includes(d.sha256);
  }
  ok('1 … to the prize wallet, 0 BNB', allTo && allZero);
  ok('2 the input data is the record, readable as UTF-8', allText, firstMemo.slice(0, 160));
  ok('2 … and its sha256 is the hash of the board /pop/chain hands back', allHash);
  const r2 = await runPopChain(env, { rpcUrl: LOCAL, now });
  ok('3 a second run writes nothing', r2.nothing === true, JSON.stringify(r2));
  // 4: a fresh wallet at its reserve, one day open
  const key2 = generatePrivateKey(), me2 = privateKeyToAccount(key2), kv2 = new Map();
  await rpc('anvil_setBalance', [me2.address, '0x' + parseEther('0.001').toString(16)]);
  const r3 = await runPopChain({ AGENT: { get: async (k) => kv2.get(k) ?? null, put: async (k, v) => { kv2.set(k, v); } }, AGENT_PROVIDER_PRIVATE_KEY: key2 }, { rpcUrl: LOCAL, now });
  const sent2 = parseInt((await rpc('eth_getTransactionCount', [me2.address, 'latest'])).result, 16);
  ok('4 a wallet at its reserve sends nothing and says why', sent2 === 0 && /holds .* BNB/.test(r3.stopped || ''), r3.stopped);
} finally { stop(); }
console.log(`\npop-chain fork test: ${n - failed}/${n}`);
process.exit(failed ? 1 : 0);
