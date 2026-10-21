#!/usr/bin/env node
// The two Venus agents at work — on a fork (2026-10-21). worker-agent/venus-work.js moves real money on Venus; before
// it is switched on it runs here, against the real Venus markets, oracle and registry at the current block. Anvil
// forks BSC; throwaway keys stand in for Backup 1 and 2 (the real keys are never read); the owner of #302257 and
// #304493 (0xbFAA) is impersonated to point their agentWallets at those keys, signed the way the registry checks.
//
// Held against:
//   the move       setAgentWallet with our signature format is accepted and getAgentWallet names the new wallets;
//                  the other agents keep theirs
//   the guard      nothing runs while VENUS_WORK is off, and an agent whose agentWallet is another acts not at all
//   day 1          health: BNB supplied, the market entered, USDT borrowed to a health factor of 2.2 (± 0.03),
//                  cross-checked by Venus's own getAccountLiquidity; yield: 2 of the better-paying coin supplied
//   once a day     a second run the same day does nothing
//   day 2          health inside its band: nothing; yield: the next tranche
//   the keeper     a target of 3.0 makes it repay to 3.0, then a target of 2.2 makes it borrow back to 2.2
//   the way back   unwind refuses while the wallet holds less USDT than the debt with interest, then repays all
//                  and redeems all: no debt, no vTokens, the BNB and the stablecoins back in the wallets
// and, offline, the decisions: setup, the band, the caps (most debt, floor after a borrow, Venus's own limit).
//
// Needs anvil (~/.foundry/bin) and BSC_RPC_KEYED_URL_2 in .env, like buyback-fork-test.mjs.
//   node scripts/venus-work-fork-test.mjs
import 'dotenv/config';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createPublicClient, createWalletClient, createTestClient, http, parseAbi, parseEther, formatEther, formatUnits } from 'viem';
import { bsc } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { agentWalletSig, IDENTITY_REGISTRY, SET_AGENT_WALLET_ABI } from './lib/agent-wallet-sig.mjs';

const PORT = 8549, LOCAL = `http://127.0.0.1:${PORT}`;
const FORK_URL = process.env.BSC_RPC_KEYED_URL_2 || process.env.BSC_RPC_KEYED_URL_1;
const ANVIL = process.env.ANVIL || path.join(os.homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil');
let failed = 0, n = 0;
const ok = (label, pass, detail = '') => { n++; if (!pass) failed++; console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const V = await import('../worker-agent/venus-work.js');
const E = (x) => parseEther(String(x));

// ── offline: the decisions ───────────────────────────────────────────────────
console.log('the decisions (offline)');
{
  const base = { collateralSupplied: true, entered: true, usdtPrice: E(1), walletBnb: E(0.01), lendable: E(100) };
  const s0 = V.healthSteps({ ...base, collateralSupplied: false, entered: false, walletBnb: E(0.03), debt: 0n, weighted: 0n, walletUsdt: 0n });
  ok('a new wallet supplies the collateral and enters the market first', s0.map((x) => x.kind).join() === 'supply,enter' && s0[0].value === E(0.02));
  ok('without the BNB for it, it waits and says so', V.healthSteps({ ...base, collateralSupplied: false, entered: false, walletBnb: E(0.01), debt: 0n, weighted: 0n, walletUsdt: 0n })[0]?.kind === 'wait');
  const open = V.healthSteps({ ...base, debt: 0n, weighted: E(11), walletUsdt: 0n });
  ok('with collateral and no debt it borrows to 2.2: $11 weighted -> 5 USDT', open[0]?.kind === 'borrow' && open[0].amount === E(5), formatEther(open[0]?.amount || 0n));
  ok('inside the band (2.2 ± 5 %) it does nothing', V.healthSteps({ ...base, debt: E(5), weighted: E(11), walletUsdt: E(5) }).length === 0 && V.healthSteps({ ...base, debt: E(5), weighted: E(11.5), walletUsdt: E(5) }).length === 0);
  const low = V.healthSteps({ ...base, debt: E(5), weighted: E(10), walletUsdt: E(5) });
  ok('at 2.0 it repays to 2.2: 5 - 10/2.2 = 0.4545… USDT', low[0]?.kind === 'repay' && Math.abs(Number(formatEther(low[0].amount)) - (5 - 10 / 2.2)) < 1e-6, formatEther(low[0]?.amount || 0n));
  const lowPoor = V.healthSteps({ ...base, debt: E(5), weighted: E(10), walletUsdt: E(0.1) });
  ok('and repays what the wallet holds when it holds less', lowPoor[0]?.kind === 'repay' && lowPoor[0].amount === E(0.1));
  const high = V.healthSteps({ ...base, debt: E(4), weighted: E(11), walletUsdt: E(4) });
  ok('at 2.75 it borrows to 2.2: 1 USDT', high[0]?.kind === 'borrow' && high[0].amount === E(1), formatEther(high[0]?.amount || 0n));
  ok('never past 8 USDT of debt', V.healthSteps({ ...base, debt: 0n, weighted: E(100), walletUsdt: 0n })[0]?.amount === E(8));
  ok('never more than nine tenths of what Venus would still lend', V.healthSteps({ ...base, lendable: E(2), debt: 0n, weighted: E(11), walletUsdt: 0n })[0]?.amount === E(1.8));
  const floorCase = V.healthSteps({ ...base, debt: 0n, weighted: E(11), walletUsdt: 0n }, { ...V.HEALTH, target: 1.5 });
  ok('never below a health factor of 2.0 after a borrow, whatever the target says', floorCase[0]?.amount === E(5.5), formatEther(floorCase[0]?.amount || 0n));
  const y = V.yieldSteps({ USDT: { wallet: E(5), apr: 2.0 }, USDC: { wallet: E(5), apr: 2.4 } });
  ok('yield: a tranche of 2 to the better-paying coin it holds', y[0]?.coin === 'USDC' && y[0].amount === E(2));
  ok('a coin it does not hold is not chosen, however well it pays', V.yieldSteps({ USDT: { wallet: E(5), apr: 2.0 }, USDC: { wallet: 0n, apr: 9 } })[0]?.coin === 'USDT');
  ok('the last part smaller than a tranche goes whole; an empty wallet does nothing', V.yieldSteps({ USDT: { wallet: E(0.5), apr: 2 }, USDC: { wallet: 0n, apr: 3 } })[0]?.amount === E(0.5) && V.yieldSteps({ USDT: { wallet: 0n, apr: 2 }, USDC: { wallet: 0n, apr: 3 } }).length === 0);
}

if (!FORK_URL) { ok('an archive node for the fork', false, 'BSC_RPC_KEYED_URL_2 not in .env'); process.exit(1); }
console.log('\nthe run (fork)');
const anvil = spawn(ANVIL, ['--fork-url', FORK_URL, '--port', String(PORT), '--chain-id', '56', '--silent', '--no-rate-limit', '--gas-price', '100000000', '--block-base-fee-per-gas', '0'], { stdio: 'ignore' });
const stop = () => { try { anvil.kill(); } catch { /* gone */ } };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(130); });
const chain = { ...bsc, rpcUrls: { default: { http: [LOCAL] } } };
const pub = createPublicClient({ chain, transport: http(LOCAL, { timeout: 120000 }) });
const test = createTestClient({ chain, mode: 'anvil', transport: http(LOCAL, { timeout: 120000 }) });
for (let i = 0; i < 60; i++) { try { await pub.getBlockNumber(); break; } catch { await sleep(500); } }

const kB1 = generatePrivateKey(), kB2 = generatePrivateKey(), kB3 = generatePrivateKey();
const B1 = privateKeyToAccount(kB1), B2 = privateKeyToAccount(kB2);
const OWNER = '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A';
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)']);
const ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E', WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const ROUTER_ABI = parseAbi(['function swapExactETHForTokens(uint256,address[],address,uint256) payable returns (uint256[])']);
const bal = (t, a) => pub.readContract({ address: t, abi: ERC20, functionName: 'balanceOf', args: [a] });
const USDT = V.MARKETS.USDT.token, USDC = V.MARKETS.USDC.token;

// the move, as scripts/set-venus-agent-wallets.mjs makes it
await test.setBalance({ address: B1.address, value: E(0.05) });
await test.setBalance({ address: B2.address, value: E(0.1) });
await test.impersonateAccount({ address: OWNER });
await test.setBalance({ address: OWNER, value: E(1) });
const ownerWal = createWalletClient({ account: OWNER, chain, transport: http(LOCAL) });
const deadline = BigInt(Math.floor(Date.now() / 1000) + 240);
const otherBefore = await pub.readContract({ address: IDENTITY_REGISTRY, abi: SET_AGENT_WALLET_ABI, functionName: 'getAgentWallet', args: [302258n] });
for (const [id, acct] of [[302257n, B1], [304493n, B2]]) {
  const sig = await agentWalletSig(acct, { agentId: id, owner: OWNER, deadline });
  const h = await ownerWal.writeContract({ address: IDENTITY_REGISTRY, abi: SET_AGENT_WALLET_ABI, functionName: 'setAgentWallet', args: [id, acct.address, deadline, sig], gas: 300000n });
  await pub.waitForTransactionReceipt({ hash: h });
}
const w1 = await pub.readContract({ address: IDENTITY_REGISTRY, abi: SET_AGENT_WALLET_ABI, functionName: 'getAgentWallet', args: [302257n] });
const w2 = await pub.readContract({ address: IDENTITY_REGISTRY, abi: SET_AGENT_WALLET_ABI, functionName: 'getAgentWallet', args: [304493n] });
const otherAfter = await pub.readContract({ address: IDENTITY_REGISTRY, abi: SET_AGENT_WALLET_ABI, functionName: 'getAgentWallet', args: [302258n] });
ok('setAgentWallet with our signature is accepted: #302257 -> Backup 1, #304493 -> Backup 2', w1 === B1.address && w2 === B2.address, `${w1.slice(0, 10)} ${w2.slice(0, 10)}`);
ok('the other agents keep their agentWallet', otherAfter === otherBefore, otherAfter);

// stablecoins for the yield wallet: ~0.01 BNB each, bought the way the relayer buys
const b2wal = createWalletClient({ account: B2, chain, transport: http(LOCAL) });
for (const t of [USDT, USDC]) {
  const h = await b2wal.writeContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'swapExactETHForTokens', args: [0n, [WBNB, t], B2.address, deadline], value: E(0.01), gas: 300000n });
  await pub.waitForTransactionReceipt({ hash: h });
}
const startStable = { USDT: await bal(USDT, B2.address), USDC: await bal(USDC, B2.address) };

const kv = new Map();
const KV = { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } };
const env = { VENUS_WORK: 'on', BACKUP1_PRIVATE_KEY: kB1, BACKUP2_PRIVATE_KEY: kB2, AGENT: KV };
const day1 = new Date(), day2 = new Date(Date.now() + 86400e3);

ok('nothing runs while VENUS_WORK is off', (await V.runVenusWork({ ...env, VENUS_WORK: undefined }, { rpcUrl: LOCAL, now: day1 })).off === true);
const stranger = await V.runVenusWork({ ...env, BACKUP1_PRIVATE_KEY: kB3, BACKUP2_PRIVATE_KEY: undefined }, { rpcUrl: LOCAL, now: day1, force: true });
ok('a key that is not the agent\'s agentWallet acts not at all', stranger.log.some((x) => /nothing done/.test(x.note || '')) && !stranger.log.some((x) => x.tx), stranger.log.map((x) => x.note || x.action).join(' | ').slice(0, 120));

const r1 = await V.runVenusWork(env, { rpcUrl: LOCAL, now: day1 });
const acts1 = r1.log.filter((x) => x.tx).map((x) => `${x.agent}:${x.action}`);
console.log('    day 1:', r1.log.map((x) => x.error ? `ERROR ${x.error}` : x.action ? `${x.agent} ${x.action} ${x.amount || ''}` : `${x.agent} ${x.note}`).join(' | '));
const h1 = await V.readHealth(pub, B1.address, [LOCAL]);
ok('day 1, health: supplied, entered, borrowed', acts1.includes('302257:supply') && acts1.includes('302257:enter') && acts1.includes('302257:borrow'), acts1.join(' '));
ok('the health factor lands at 2.2', h1.hf != null && Math.abs(h1.hf - 2.2) < 0.03, String(h1.hf));
const liq = await pub.readContract({ address: V.UNITROLLER, abi: parseAbi(['function getAccountLiquidity(address) view returns (uint256,uint256,uint256)']), functionName: 'getAccountLiquidity', args: [B1.address] });
ok('Venus itself sees the position healthy (no shortfall), and the borrowed USDT is in the wallet', liq[0] === 0n && liq[2] === 0n && (await bal(USDT, B1.address)) === h1.debt, `debt ${formatUnits(h1.debt, 18)} USDT, wallet ${formatUnits(await bal(USDT, B1.address), 18)}`);
const dep1 = r1.log.find((x) => x.agent === 304493 && x.action === 'deposit');
ok('day 1, yield: 2 of the better-paying coin it holds supplied', !!dep1 && /^2(\.0+)? (USDT|USDC)$/.test(dep1.amount), dep1 ? `${dep1.amount} — ${dep1.why}` : JSON.stringify(r1.log.filter((x) => x.agent === 304493)));

const again = await V.runVenusWork(env, { rpcUrl: LOCAL, now: day1 });
ok('a second run the same day does nothing', !again.log.some((x) => x.tx), String(again.log.length));

const r2 = await V.runVenusWork(env, { rpcUrl: LOCAL, now: day2 });
ok('day 2, health inside its band: nothing', !r2.log.some((x) => x.agent === 302257 && x.tx), r2.log.filter((x) => x.agent === 302257).map((x) => x.note).join(' '));
ok('day 2, yield: the next tranche', r2.log.some((x) => x.agent === 304493 && x.action === 'deposit'));

V.HEALTH.target = 3.0;
const r3 = await V.runVenusWork(env, { rpcUrl: LOCAL, now: day2, force: true });
const h3 = await V.readHealth(pub, B1.address, [LOCAL]);
ok('the keeper repays when the health factor is under its band (target 3.0)', r3.log.some((x) => x.agent === 302257 && x.action === 'repay') && Math.abs(h3.hf - 3.0) < 0.04, `hf ${h3.hf}`);
V.HEALTH.target = 2.2;
const r4 = await V.runVenusWork(env, { rpcUrl: LOCAL, now: day2, force: true });
const h4 = await V.readHealth(pub, B1.address, [LOCAL]);
ok('and borrows when it is over its band (target 2.2)', r4.log.some((x) => x.agent === 302257 && x.action === 'borrow') && Math.abs(h4.hf - 2.2) < 0.03, `hf ${h4.hf}`);
ok('no run ended in an error', ![r1, r2, r3, r4].some((r) => r.log.some((x) => x.error)), [r1, r2, r3, r4].flatMap((r) => r.log.filter((x) => x.error).map((x) => x.error)).join(' | ').slice(0, 200));

// the way back
await test.mine({ blocks: 20 });   // interest accrues: the debt is now above the USDT the wallet holds (2000 blocks left the oracle stale on the fork)
let refused = null; try { await V.unwindVenus(env, 302257, { rpcUrl: LOCAL }); } catch (e) { refused = e.message; }
ok('unwind refuses while the wallet holds less USDT than the debt with interest', /send it the difference/.test(refused || ''), (refused || 'went through').slice(0, 100));
const h = await b2wal.writeContract({ address: USDT, abi: ERC20, functionName: 'transfer', args: [B1.address, E(0.05)], gas: 100000n });
await pub.waitForTransactionReceipt({ hash: h });
const bnbBefore = await pub.getBalance({ address: B1.address });
const u1 = await V.unwindVenus(env, 302257, { rpcUrl: LOCAL });
const vAbi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function borrowBalanceStored(address) view returns (uint256)']);
const debtLeft = await pub.readContract({ address: V.MARKETS.USDT.vToken, abi: vAbi, functionName: 'borrowBalanceStored', args: [B1.address] });
const vbnbLeft = await pub.readContract({ address: V.VBNB, abi: vAbi, functionName: 'balanceOf', args: [B1.address] });
const bnbBack = (await pub.getBalance({ address: B1.address })) - bnbBefore;
ok('health unwind: no debt, no vBNB, the 0.02 BNB back (less gas)', debtLeft === 0n && vbnbLeft === 0n && bnbBack > E(0.0199), `${u1.done.map((x) => x.action).join(', ')}; +${formatEther(bnbBack)} BNB`);
const u2 = await V.unwindVenus(env, 304493, { rpcUrl: LOCAL });
const vLeft = await Promise.all(Object.values(V.MARKETS).map((m) => pub.readContract({ address: m.vToken, abi: vAbi, functionName: 'balanceOf', args: [B2.address] })));
const endStable = { USDT: await bal(USDT, B2.address), USDC: await bal(USDC, B2.address) };
const back = Number(formatUnits(endStable.USDT + endStable.USDC, 18)), put = Number(formatUnits(startStable.USDT + startStable.USDC - E(0.05), 18));
ok('yield unwind: no vTokens left, the stablecoins back (to the cent, with interest)', vLeft.every((v) => v === 0n) && back >= put - 0.01, `${u2.done.map((x) => x.action).join(', ')}; ${back.toFixed(4)} back of ${put.toFixed(4)}`);

console.log(`\n${n - failed}/${n} ok${failed ? `, ${failed} FAIL` : ''}`);
stop();
process.exit(failed ? 1 : 0);
