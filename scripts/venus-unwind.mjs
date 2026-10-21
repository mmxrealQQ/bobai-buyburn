#!/usr/bin/env node
// Take one of the two Venus agents out of Venus (worker-agent/venus-work.js unwindVenus): the health factor keeper
// repays its whole debt and redeems its BNB; the yield router redeems its vUSDT and vUSDC. The money lands in the
// agent's own wallet. Set VENUS_WORK = "off" in worker-agent/wrangler.toml first, or the next 05:00 run starts again.
// Proved on a fork by scripts/venus-work-fork-test.mjs.
//   node scripts/venus-unwind.mjs 302257|304493            plan: what it holds on Venus
//   node scripts/venus-unwind.mjs 302257|304493 --confirm  takes it out
import 'dotenv/config';
import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { unwindVenus, HEALTH, YIELD, MARKETS, VBNB } from '../worker-agent/venus-work.js';

const id = Number(process.argv[2]);
const p = id === HEALTH.agentId ? HEALTH : id === YIELD.agentId ? YIELD : null;
if (!p) { console.error('usage: node scripts/venus-unwind.mjs 302257|304493 [--confirm]'); process.exit(1); }
const env = { [p.key]: process.env[p.key] };
const k = (env[p.key] || '').trim();
if (!k) { console.error(`refused: ${p.key} is not in .env`); process.exit(1); }
const me = privateKeyToAccount(k.startsWith('0x') ? k : `0x${k}`).address;
const pub = createPublicClient({ chain: bsc, transport: http(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org') });
const A = parseAbi(['function balanceOf(address) view returns (uint256)', 'function borrowBalanceStored(address) view returns (uint256)']);
const r = (address, functionName) => pub.readContract({ address, abi: A, functionName, args: [me] });
console.log(`#${id} ${me}`);
console.log(`  vBNB ${await r(VBNB, 'balanceOf')} · USDT debt ${formatUnits(await r(MARKETS.USDT.vToken, 'borrowBalanceStored'), 18)} · USDT in wallet ${formatUnits(await r(MARKETS.USDT.token, 'balanceOf'), 18)}`);
console.log(`  vUSDT ${await r(MARKETS.USDT.vToken, 'balanceOf')} · vUSDC ${await r(MARKETS.USDC.vToken, 'balanceOf')}`);
if (!process.argv.includes('--confirm')) { console.log('\nplan only. Nothing was sent. Re-run with --confirm.'); process.exit(0); }
const out = await unwindVenus(env, id);
for (const d of out.done) console.log(`  ok ${d.action}: ${d.tx}`);
if (!out.done.length) console.log('  nothing on Venus.');
