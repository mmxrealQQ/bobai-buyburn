// The x402 Permit2 route, RUN on a local fork of BNB Chain (2026-09-24, A8).
//
// worker-agent reads a standard payment and simulates its settle; worker-lp
// settles the queue (worker-lp/x402-settle.js). This runs the second half for
// real against PancakeSwap's router, USDC, Permit2 and the x402 Permit2 proxy
// as they stand on chain — with two throwaway keys made here, on 127.0.0.1,
// so no project key is read and nothing leaves the machine. The buyer swaps
// BNB for USDC and approves Permit2 as a buyer would, and signs the same
// EIP-712 PermitWitnessTransferFrom the official client (@x402/evm) signs.
//
// Needs anvil (~/.foundry/bin) and the archive RPC in BSC_RPC_KEYED_URL_2.
//   node -r dotenv/config scripts/x402-permit2-fork-test.mjs
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createPublicClient, createWalletClient, createTestClient, http, parseEther, parseUnits, erc20Abi, parseAbi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { permit2Mismatch, settleCalldata, permit2Id, PERMIT2_PROXY, QUEUE_PREFIX } from '../shared/x402-permit2.js';
import { settleX402Queue } from '../worker-lp/x402-settle.js';
import { INCOME_SOURCES, planSweep, executeSweep, readBnbUsd, ADDR } from '../shared/lp-agent.js';

const FORK_URL = process.env.BSC_RPC_KEYED_URL_2;
const ANVIL = process.env.ANVIL || path.join(os.homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil');
if (!FORK_URL) { console.error('No archive RPC in .env (BSC_RPC_KEYED_URL_2).'); process.exit(2); }
if (!fs.existsSync(ANVIL)) { console.error(`anvil not found at ${ANVIL}`); process.exit(2); }
const PORT = 8561, LOCAL = `http://127.0.0.1:${PORT}`;

const USDC = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const PAYTO = '0x690E950214980BC329823A2DB2fD90C06Bd54dE4';
const PRICE = parseUnits('0.1', 18);
const ROUTER_ABI = parseAbi(['function swapExactETHForTokens(uint256,address[],address,uint256) payable returns (uint256[])']);
const TYPES = {
  PermitWitnessTransferFrom: [{ name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }, { name: 'witness', type: 'Witness' }],
  TokenPermissions: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }],
  Witness: [{ name: 'to', type: 'address' }, { name: 'validAfter', type: 'uint256' }],
};

let failed = 0, n = 0;
const ok = (label, pass, detail = '') => { n++; if (!pass) failed++; console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); };

const anvil = spawn(ANVIL, ['--fork-url', FORK_URL, '--port', String(PORT), '--chain-id', '56', '--silent', '--no-rate-limit', '--gas-price', '50000000', '--block-base-fee-per-gas', '0'], { stdio: 'ignore' });
const stop = () => { try { anvil.kill(); } catch { /* gone */ } };
process.on('exit', stop);
const chain = { ...bsc, rpcUrls: { default: { http: [LOCAL] } } };
const pub = createPublicClient({ chain, transport: http(LOCAL, { timeout: 120000 }) });
const test = createTestClient({ chain, mode: 'anvil', transport: http(LOCAL, { timeout: 120000 }) });
for (let i = 0; i < 60; i++) { try { await pub.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
const block = await pub.getBlockNumber();

// The KV the two workers share, in memory: get, put, list by prefix.
const store = new Map();
const kv = { get: async (k) => (store.has(k) ? store.get(k) : null), put: async (k, v) => { store.set(k, v); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }) };

const buyerKey = generatePrivateKey(), settlerKey = generatePrivateKey();
const buyer = privateKeyToAccount(buyerKey), settler = privateKeyToAccount(settlerKey);
await test.setBalance({ address: buyer.address, value: parseEther('1') });
await test.setBalance({ address: settler.address, value: parseEther('0.01') });
const wb = createWalletClient({ account: buyer, chain, transport: http(LOCAL) });
const usdcOf = (a) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] });
const wait = (hash) => pub.waitForTransactionReceipt({ hash });
await wait(await wb.writeContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'swapExactETHForTokens', args: [0n, [WBNB, USDC], buyer.address, BigInt(Math.floor(Date.now() / 1000) + 600)], value: parseEther('0.01') }));
await wait(await wb.writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [PERMIT2, parseUnits('1', 18)] }));
console.log(`fork of block ${block}: buyer ${buyer.address} holds ${Number(await usdcOf(buyer.address)) / 1e18} USDC, Permit2 approved`);

const nowSec = async () => Number((await pub.getBlock()).timestamp);
const req = { asset: USDC, amount: PRICE.toString(), payTo: PAYTO };
let nonceSeq = BigInt(Date.now());
async function pay({ amount = PRICE, life = 3600 } = {}) {
  const deadline = BigInt((await nowSec()) + life);
  const nonce = nonceSeq++;
  const message = { permitted: { token: USDC, amount }, spender: PERMIT2_PROXY, nonce, deadline, witness: { to: PAYTO, validAfter: 0n } };
  const signature = await buyer.signTypedData({ domain: { name: 'Permit2', chainId: 56, verifyingContract: PERMIT2 }, types: TYPES, primaryType: 'PermitWitnessTransferFrom', message });
  return { signature, permit2Authorization: { from: buyer.address, spender: PERMIT2_PROXY, permitted: { token: USDC, amount: amount.toString() }, nonce: nonce.toString(), deadline: deadline.toString(), witness: { to: PAYTO, validAfter: '0' } } };
}
// What worker-agent does at the door, then what it writes.
async function door(payload) {
  const bad = permit2Mismatch(payload, req, { nowSec: await nowSec() });
  if (bad) return { ok: false, reason: bad };
  try { await pub.call({ account: PAYTO, to: PERMIT2_PROXY, data: settleCalldata(payload) }); } catch (e) { return { ok: false, reason: 'simulate: ' + (e.shortMessage || e.message).split('\n')[0] }; }
  const id = permit2Id(payload);
  store.set(QUEUE_PREFIX + id, JSON.stringify({ payload, req, at: Date.now(), for: 'test', state: 'pending' }));
  store.set(`earn:${id}`, JSON.stringify({ at: Date.now(), amount: PRICE.toString(), tx: id, paid_in: 'USDC', settle: 'pending' }));
  return { ok: true, id };
}
const env = { X402_PRIVATE_KEY: settlerKey, AGENT: kv };
const run = () => settleX402Queue(env, [LOCAL], { expectWallet: settler.address });
const rec = (id) => JSON.parse(store.get(QUEUE_PREFIX + id));
const earn = (id) => JSON.parse(store.get(`earn:${id}`));

console.log('\nA PAYMENT AT THE PRICE — checked at the door, settled by the queue');
const p1 = await pay();
const d1 = await door(p1);
ok('the door accepts it and simulates the settle without a key', d1.ok, d1.reason || '');
let before = await usdcOf(PAYTO); const buyerBefore = await usdcOf(buyer.address);
const r1 = await run();
const q1 = rec(d1.id);
ok('the queue settles it from the settler wallet', q1.state === 'settled' && /^0x[0-9a-f]{64}$/.test(q1.tx), JSON.stringify(r1.results));
ok('the price arrived at the x402 wallet, and left the buyer', (await usdcOf(PAYTO)) - before === PRICE && buyerBefore - (await usdcOf(buyer.address)) === PRICE);
ok('the earnings record says settled, with the transaction', earn(d1.id).settle === 'settled' && earn(d1.id).settle_tx === q1.tx && earn(d1.id).amount === PRICE.toString());
const r1b = await run();
ok('a settled payment is not sent again', (r1b.results || []).length === 0 && (await usdcOf(PAYTO)) - before === PRICE);

console.log('\nTHE DAILY SWEEP TAKES THE USDC TOO — sold for BNB, straight to the DeFi wallet');
{
  const src = INCOME_SOURCES.find((x) => x.key === 'x402-usdc');
  ok('the USDC source is the x402 wallet, its key and USDC', !!src && src.wallet.toLowerCase() === PAYTO.toLowerCase() && src.keyEnv === 'X402_PRIVATE_KEY' && src.token === USDC && src.decimals === 18);
  await wait(await wb.writeContract({ address: USDC, abi: erc20Abi, functionName: 'transfer', args: [PAYTO, parseUnits('5', 18)] }));
  await test.setBalance({ address: PAYTO, value: parseEther('0.01') });
  await test.impersonateAccount({ address: PAYTO });
  const held = await usdcOf(PAYTO);
  const plan = await planSweep(pub, src, await readBnbUsd(pub));
  ok('the planner takes it: a dollar on the route, above the floor', plan.no == null, plan.no || `${plan.summary.sweeping} USDC -> ${plan.summary.bnb_equivalent} BNB`);
  const lpBefore = await pub.getBalance({ address: ADDR.LP_WALLET });
  const wx = createWalletClient({ account: PAYTO, chain, transport: http(LOCAL) });
  const done = await executeSweep(pub, wx, { address: PAYTO }, plan, () => {}, { txs: [] });
  const lpAfter = await pub.getBalance({ address: ADDR.LP_WALLET });
  ok('the USDC left the x402 wallet and the BNB arrived at the DeFi wallet', held - (await usdcOf(PAYTO)) === plan.amount && lpAfter - lpBefore > 0n && Number(done.received_bnb) >= Number(plan.summary.bnb_equivalent) * 0.97, `${done.sold} USDC -> ${done.received_bnb} BNB`);
  ok('… with nothing left approved to the router', (await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'allowance', args: [PAYTO, ADDR.V2_ROUTER] })) === 0n);
  await test.stopImpersonatingAccount({ address: PAYTO });
  // The checks below count what settles from here on, the sweep having moved the rest.
  before = (await usdcOf(PAYTO)) - PRICE;
}

console.log('\nTHE SAME SIGNATURE TWICE — the chain settles a nonce once');
ok('the door refuses it before any answer goes out', !(await door(p1)).ok);
store.set(QUEUE_PREFIX + 'replay', JSON.stringify({ payload: p1, req, state: 'pending' }));
store.set('earn:replay', JSON.stringify({ amount: PRICE.toString(), settle: 'pending' }));
await run(); await run(); await run();
ok('queued anyway, it fails after three tries and counts nothing', rec('replay').state === 'failed' && earn('replay').amount === '0' && (await usdcOf(PAYTO)) - before === PRICE, rec('replay').reason);

console.log('\nTHE BUYER REVOKES AFTER THE ANSWER — the one risk of answering first');
const p2 = await pay();
const d2 = await door(p2);
await wait(await wb.writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [PERMIT2, 0n] }));
await run(); await run(); await run();
ok('the settle fails, the record is zero, no money is claimed that did not arrive', d2.ok && rec(d2.id).state === 'failed' && earn(d2.id).amount === '0' && (await usdcOf(PAYTO)) - before === PRICE, rec(d2.id).reason);
await wait(await wb.writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [PERMIT2, parseUnits('1', 18)] }));

console.log('\nTOO LITTLE, TOO SHORT, EXPIRED');
ok('less than the price is refused at the door', /smaller/.test((await door(await pay({ amount: PRICE - 1n }))).reason || ''));
ok('ten minutes of life is refused at the door', /expires within/.test((await door(await pay({ life: 600 }))).reason || ''));
const p3 = await pay({ life: 1300 });
const d3 = await door(p3);
await test.increaseTime({ seconds: 1400 }); await test.mine({ blocks: 1 });
await run();
ok('one that expired in the queue fails without a transaction', d3.ok && rec(d3.id).state === 'failed' && !rec(d3.id).tx && earn(d3.id).amount === '0', rec(d3.id).reason);

console.log('\nA RUN CUT OFF AFTER SENDING — the next run reads the receipt, sends nothing');
const p4 = await pay();
const d4 = await door(p4);
const ws = createWalletClient({ account: settler, chain, transport: http(LOCAL) });
const h4 = await ws.sendTransaction({ to: PERMIT2_PROXY, data: settleCalldata(p4) });
await wait(h4);
store.set(QUEUE_PREFIX + d4.id, JSON.stringify({ ...rec(d4.id), state: 'sent', tx: h4 }));
const nonceBefore = await pub.getTransactionCount({ address: settler.address });
await run();
ok('a sent one is finished from its receipt, and no second transaction goes out', rec(d4.id).state === 'settled' && rec(d4.id).tx === h4 && (await pub.getTransactionCount({ address: settler.address })) === nonceBefore && earn(d4.id).settle === 'settled');

console.log(`\n${n - failed}/${n} checks pass on the fork of block ${block}`);
stop();
process.exitCode = failed ? 1 : 0;
