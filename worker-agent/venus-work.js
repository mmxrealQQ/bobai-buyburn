// worker-agent/venus-work.js — the two Venus agents act on Venus, from wallets of their own (2026-10-21)
//
// Operator, 21.10.: "machen wir beides" — the Venus health factor monitor (#302257) and the Venus yield ranking
// (#304493) advised and never acted, so a check that reads what an agent does on the chain found nothing of their
// job there. Each now does its own job, small, with its own wallet (its agentWallet in the registry):
//
//   HEALTH FACTOR KEEPER (#302257, Backup 1). 0.02 BNB supplied as collateral, USDT borrowed against it, the health
//   factor held at 2.2: below 2.09 it repays down to 2.2, above 2.31 it borrows up to 2.2 — what an agent that
//   "watches and acts on loans" does. The borrowed USDT stays in the wallet, so a repay never has to buy anything.
//   At most one action a day after the first (supply, enter the market, borrow). Never borrows past MAX_DEBT_USDT,
//   never below HF 2.0 after the borrow, never more than nine tenths of what Venus would still lend.
//
//   YIELD ROUTER (#304493, Backup 2). Stablecoins in the wallet go to Venus in tranches of 2 a day, each tranche to
//   whichever market pays more today among the coins the wallet holds (USDT, USDC — its own ranking, read from
//   supplyRatePerBlock). Money already supplied is not moved: at this size a move never earns back its gas.
//
// Every action is simulated first and must return Venus's error code 0 (Compound-style markets report a refused
// borrow or mint with a code, not a revert), is sent at 0.1 gwei, must be mined with status success, and its effect
// is read back. Nothing runs unless VENUS_WORK is "on", and an agent acts only while the registry names this very
// wallet as its agentWallet — before the move its actions would not be its own. One run per agent per UTC day.
// Every run is written to KV venus:log (GET /venus/work).

import { createPublicClient, createWalletClient, http, fallback, encodeFunctionData, decodeFunctionResult, parseAbi, parseEther, formatEther, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { agentWalletOf } from './agent-wallets.js';

export const UNITROLLER = '0xfD36E2c2a6789Db23113685031d7F16329158384';
export const VBNB = '0xA07c5b74C9B40447a954e1466938b865b6BBea36';
export const MARKETS = {
  USDT: { vToken: '0xfD5840Cd36d94D7229439859C0112a4185BC0255', token: '0x55d398326f99059fF775485246999027B3197955' },
  USDC: { vToken: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8', token: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' },
};
export const HEALTH = { agentId: 302257, key: 'BACKUP1_PRIVATE_KEY', collateralBnb: parseEther('0.02'), target: 2.2, band: 0.05, floorAfterBorrow: 2.0, maxDebtUsdt: parseEther('8') };
export const YIELD = { agentId: 304493, key: 'BACKUP2_PRIVATE_KEY', tranche: parseEther('2') };
const GAS_PRICE = 100000000n;   // 0.1 gwei
const MIN_GAS_BNB = parseEther('0.0005');
const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-rpc.publicnode.com'];
const LOG_KEY = 'venus:log';

const ABI = parseAbi([
  'function mint() payable',
  'function mint(uint256) returns (uint256)',
  'function borrow(uint256) returns (uint256)',
  'function repayBorrow(uint256) returns (uint256)',
  'function redeem(uint256) returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function borrowBalanceStored(address) view returns (uint256)',
  'function supplyRatePerBlock() view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function enterMarkets(address[]) returns (uint256[])',
  'function checkMembership(address,address) view returns (bool)',
  'function oracle() view returns (address)',
  'function getUnderlyingPrice(address) view returns (uint256)',
  'function markets(address) view returns (bool,uint256,bool)',
  'function getAccountLiquidity(address) view returns (uint256,uint256,uint256)',
]);

// ── the decisions, pure ───────────────────────────────────────────────────────
// s: { collateralSupplied, entered, debt (USDT wei), weighted (USD 1e18: collateral after the liquidation threshold),
//      lendable (USD 1e18 Venus would still lend), usdtPrice (USD 1e18 per USDT), walletUsdt, walletBnb }
// Returns the steps of this run, in order; [] when the position is where it should be.
export function healthSteps(s, p = HEALTH) {
  // First the position itself: the collateral supplied and counted. The borrow follows on the runner's next read.
  const setup = [];
  if (!s.collateralSupplied) {
    if (s.walletBnb < p.collateralBnb + MIN_GAS_BNB) return [{ kind: 'wait', why: `needs ${formatEther(p.collateralBnb + MIN_GAS_BNB)} BNB to supply the collateral and pay gas; holds ${formatEther(s.walletBnb)}` }];
    setup.push({ kind: 'supply', value: p.collateralBnb, why: 'supplies the collateral' });
  }
  if (!s.entered) setup.push({ kind: 'enter', why: 'makes the BNB count as collateral' });
  if (setup.length) return setup;
  // what the debt should be at the target, in USDT wei: weighted / target / price
  const want = (weighted) => (weighted * 10n ** 18n * 1000n) / (BigInt(Math.round(p.target * 1000)) * s.usdtPrice);
  if (s.debt === 0n) return [{ kind: 'borrow', amount: capBorrow(want(s.weighted), s, p), why: `opens the loan at health factor ${p.target}` }].filter((x) => x.amount > 0n);
  const hf = Number((s.weighted * 10n ** 22n) / (s.debt * s.usdtPrice)) / 1e4;
  if (hf < p.target * (1 - p.band)) {
    const amount = s.debt - want(s.weighted);
    const pay = amount > s.walletUsdt ? s.walletUsdt : amount;
    return pay > 0n ? [{ kind: 'repay', amount: pay, why: `health factor ${hf.toFixed(3)} under ${(p.target * (1 - p.band)).toFixed(2)}: repays to ${p.target}${pay < amount ? ' (all the USDT the wallet holds)' : ''}` }] : [{ kind: 'wait', why: `health factor ${hf.toFixed(3)} is low and the wallet holds no USDT to repay with` }];
  }
  if (hf > p.target * (1 + p.band)) {
    const amount = capBorrow(want(s.weighted) - s.debt, s, p);
    return amount > 0n ? [{ kind: 'borrow', amount, why: `health factor ${hf.toFixed(3)} over ${(p.target * (1 + p.band)).toFixed(2)}: borrows to ${p.target}` }] : [];
  }
  return [];
}
function capBorrow(amount, s, p) {
  let a = amount;
  if (s.debt + a > p.maxDebtUsdt) a = p.maxDebtUsdt - s.debt;
  const lendableUsdt = (s.lendable * 9n / 10n) * 10n ** 18n / s.usdtPrice;
  if (a > lendableUsdt) a = lendableUsdt;
  // never below the floor after the borrow
  const maxAtFloor = (s.weighted * 10n ** 18n * 1000n) / (BigInt(Math.round(p.floorAfterBorrow * 1000)) * s.usdtPrice) - s.debt;
  if (a > maxAtFloor) a = maxAtFloor;
  return a > 0n ? a : 0n;
}

// w: { USDT: { wallet, apr }, USDC: { wallet, apr } } (wallet in wei, apr in % a year)
export function yieldSteps(w, p = YIELD) {
  const held = Object.entries(w).filter(([, x]) => x.wallet > 0n).sort((a, b) => b[1].apr - a[1].apr);
  if (!held.length) return [];
  const [coin, x] = held[0];
  const amount = x.wallet < p.tranche ? x.wallet : p.tranche;
  // a coin the wallet does not hold says so (2026-10-27: "USDT at 2.08 %, the best of what the wallet holds today
  // (USDC 2.49 %)" read as the worse rate chosen — the wallet held no USDC)
  const others = Object.entries(w).filter(([c]) => c !== coin).map(([c, y]) => `${c} ${y.apr.toFixed(2)} %${y.wallet > 0n ? '' : ', not held'}`).join('; ');
  return [{ kind: 'deposit', coin, amount, why: `${formatUnits(amount, 18)} ${coin} to Venus v${coin} at ${x.apr.toFixed(2)} % a year, the best of what the wallet holds today (${others})` }];
}

// ── the chain ────────────────────────────────────────────────────────────────
const accountOf = (raw) => {
  const key = String(raw || '').trim();
  const hex = key.startsWith('0x') ? key : `0x${key}`;
  return /^0x[0-9a-fA-F]{64}$/.test(hex) ? privateKeyToAccount(hex) : null;
};
function clients(account, rpcUrl) {
  const transport = rpcUrl ? http(rpcUrl, { timeout: 60000 }) : fallback(RPCS.map((u) => http(u, { timeout: 20000 })));
  return { pub: createPublicClient({ chain: bsc, transport }), wal: createWalletClient({ account, chain: bsc, transport }) };
}
const read = (pub, address, functionName, args = []) => pub.readContract({ address, abi: ABI, functionName, args });

// Simulate (Venus's error code must be 0), send at 0.1 gwei, wait for success.
async function act(pub, wal, account, { to, functionName, args = [], value = 0n, codeOk = true }) {
  const data = encodeFunctionData({ abi: ABI, functionName, args });
  const sim = await pub.call({ account, to, data, value });
  if (codeOk && sim.data && sim.data !== '0x') {
    const out = decodeFunctionResult({ abi: ABI, functionName, args, data: sim.data });
    const code = Array.isArray(out) ? out.find((c) => c !== 0n) ?? 0n : (typeof out === 'bigint' ? out : 0n);
    if (code !== 0n) throw new Error(`${functionName} would be refused by Venus with error code ${code}; nothing sent`);
  }
  const hash = await wal.sendTransaction({ to, data, value, gasPrice: GAS_PRICE });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 90000 });
  if (rc.status !== 'success') throw new Error(`${functionName} reverted: ${hash}`);
  return hash;
}
async function usdtPriceOf(pub) {
  const oracle = await read(pub, UNITROLLER, 'oracle');
  return read(pub, oracle, 'getUnderlyingPrice', [MARKETS.USDT.vToken]);   // USD 1e18 per USDT (18 decimals)
}

export async function readHealth(pub, me, rpcs = null) {
  const [vbal, entered, debt, walletUsdt, walletBnb, liq, usdtPrice] = await Promise.all([
    read(pub, VBNB, 'balanceOf', [me]), read(pub, UNITROLLER, 'checkMembership', [me, VBNB]),
    read(pub, MARKETS.USDT.vToken, 'borrowBalanceStored', [me]), read(pub, MARKETS.USDT.token, 'balanceOf', [me]),
    pub.getBalance({ address: me }), read(pub, UNITROLLER, 'getAccountLiquidity', [me]), usdtPriceOf(pub),
  ]);
  // weighted collateral on the liquidation threshold, as the health factor is (worker-agent/venus.js): read from the
  // same module the paid answer uses, so the agent acts on the figure it sells
  const { healthFactor } = await import('./venus.js');
  // with nodes of its own (a fork), the block is theirs too: healthFactor would otherwise pin the public head
  // (cacheTime 0: viem keeps the block number a few seconds, and right after an action that is the block before it)
  const pos = vbal > 0n && entered ? await healthFactor(me, rpcs ? { rpcs, block: Number(await pub.getBlockNumber({ cacheTime: 0 })) } : {}) : null;
  const weighted = pos?.collateral_after_haircut_usd != null ? BigInt(Math.round(pos.collateral_after_haircut_usd * 1e6)) * 10n ** 12n : 0n;
  return { collateralSupplied: vbal > 0n, entered, debt, weighted, lendable: liq[1], usdtPrice, walletUsdt, walletBnb, hf: pos?.health_factor ?? null };
}

async function runHealth(env, pub, wal, account, log, rpcs) {
  const me = account.address;
  for (let round = 0; round < 3; round++) {
    const s = await readHealth(pub, me, rpcs);
    const steps = healthSteps(s);
    if (!steps.length) { log.push({ agent: HEALTH.agentId, note: `health factor ${s.hf ?? '—'}: inside the band, nothing to do` }); return; }
    for (const st of steps) {
      if (st.kind === 'wait') { log.push({ agent: HEALTH.agentId, note: st.why }); return; }
      let tx;
      if (st.kind === 'supply') tx = await act(pub, wal, account, { to: VBNB, functionName: 'mint', value: st.value, codeOk: false });
      else if (st.kind === 'enter') tx = await act(pub, wal, account, { to: UNITROLLER, functionName: 'enterMarkets', args: [[VBNB]] });
      else if (st.kind === 'borrow') tx = await act(pub, wal, account, { to: MARKETS.USDT.vToken, functionName: 'borrow', args: [st.amount] });
      else if (st.kind === 'repay') {
        if ((await read(pub, MARKETS.USDT.token, 'allowance', [me, MARKETS.USDT.vToken])) < st.amount) await act(pub, wal, account, { to: MARKETS.USDT.token, functionName: 'approve', args: [MARKETS.USDT.vToken, 2n ** 256n - 1n], codeOk: false });
        tx = await act(pub, wal, account, { to: MARKETS.USDT.vToken, functionName: 'repayBorrow', args: [st.amount] });
      }
      log.push({ agent: HEALTH.agentId, action: st.kind, amount: st.value != null ? `${formatEther(st.value)} BNB` : st.amount != null ? `${formatUnits(st.amount, 18)} USDT` : null, why: st.why || null, tx });
    }
    // after a borrow or repay the day's work is done; after the first supply/enter, read again for the borrow
    if (steps.some((x) => x.kind === 'borrow' || x.kind === 'repay')) {
      const after = await readHealth(pub, me, rpcs);
      log.push({ agent: HEALTH.agentId, note: `health factor now ${after.hf}`, debt_usdt: formatUnits(after.debt, 18) });
      return;
    }
  }
}

// THE BLOCK TIME, MEASURED (2026-10-27): 0.75 s stood here as a constant while BSC ran at 0.45 s, and every logged
// rate read 40 % low ("2.08 % a year" for 3.5 %). The ranking never depended on it — the same block count multiplies
// both rates — but the number in the log is ours. Two blocks 100,000 apart, as yield.js measures it.
export async function blockSeconds(pub, span = 100_000n) {
  const latest = await pub.getBlockNumber();
  const [a, b] = await Promise.all([pub.getBlock({ blockNumber: latest - span }), pub.getBlock({ blockNumber: latest })]);
  const s = Number(b.timestamp - a.timestamp) / Number(span);
  if (!(s > 0 && s < 10)) throw new Error(`block timestamps gave ${s} s per block`);
  return s;
}
export const BLOCK_SEC_FALLBACK = 0.45;

async function runYield(env, pub, wal, account, log) {
  const me = account.address;
  const w = {};
  let blockSec = await blockSeconds(pub).catch(() => null);
  if (blockSec == null) { blockSec = BLOCK_SEC_FALLBACK; log.push({ agent: YIELD.agentId, note: `block time not measured; the rates below assume ${BLOCK_SEC_FALLBACK} s a block` }); }
  for (const [coin, m] of Object.entries(MARKETS)) {
    const [wallet, rate] = await Promise.all([read(pub, m.token, 'balanceOf', [me]), read(pub, m.vToken, 'supplyRatePerBlock')]);
    w[coin] = { wallet, apr: Number(rate) / 1e18 * (365 * 24 * 3600 / blockSec) * 100 };
  }
  const steps = yieldSteps(w);
  if (!steps.length) { log.push({ agent: YIELD.agentId, note: 'every stablecoin of the wallet is supplied; nothing to do' }); return; }
  for (const st of steps) {
    const m = MARKETS[st.coin];
    const before = await read(pub, m.vToken, 'balanceOf', [me]);
    if ((await read(pub, m.token, 'allowance', [me, m.vToken])) < st.amount) await act(pub, wal, account, { to: m.token, functionName: 'approve', args: [m.vToken, 2n ** 256n - 1n], codeOk: false });
    const tx = await act(pub, wal, account, { to: m.vToken, functionName: 'mint', args: [st.amount] });
    const after = await read(pub, m.vToken, 'balanceOf', [me]);
    if (after <= before) throw new Error(`the ${st.coin} deposit was mined but no v${st.coin} arrived: ${tx}`);
    log.push({ agent: YIELD.agentId, action: 'deposit', amount: `${formatUnits(st.amount, 18)} ${st.coin}`, why: st.why, tx });
  }
}

// The daily run. opts.rpcUrl: one node (a fork); opts.force: ignore the once-a-day mark (tests).
export async function runVenusWork(env, { rpcUrl = null, now = new Date(), force = false } = {}) {
  if (env.VENUS_WORK !== 'on') return { off: true };
  const day = now.toISOString().slice(0, 10), out = [];
  for (const [p, run] of [[HEALTH, runHealth], [YIELD, runYield]]) {
    const log = [];
    try {
      const account = accountOf(env[p.key]);
      if (!account) { out.push({ agent: p.agentId, note: `no ${p.key}` }); continue; }
      const doneKey = `venus:done:${p.agentId}:${day}`;
      if (!force && (await env.AGENT.get(doneKey))) continue;
      const wallet = await agentWalletOf(p.agentId, rpcUrl ? { read: (to, data) => fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) }).then((r) => r.json()).then((j) => j.result) } : {});
      if (String(wallet || '').toLowerCase() !== account.address.toLowerCase()) { out.push({ agent: p.agentId, note: `the registry names ${wallet} as agentWallet, not ${account.address}: nothing done` }); continue; }
      const { pub, wal } = clients(account, rpcUrl);
      await run(env, pub, wal, account, log, rpcUrl ? [rpcUrl] : null);
      await env.AGENT.put(doneKey, '1', { expirationTtl: 60 * 60 * 36 });
    } catch (e) { log.push({ agent: p.agentId, error: String(e.shortMessage || e.message || e).slice(0, 240) }); }
    out.push(...log);
  }
  const stamped = out.map((x) => ({ at: now.toISOString(), ...x }));
  try { const prev = JSON.parse((await env.AGENT.get(LOG_KEY)) || '[]'); await env.AGENT.put(LOG_KEY, JSON.stringify([...stamped, ...prev].slice(0, 200))); } catch { /* the log is a record; the chain is the truth */ }
  return { ok: true, log: stamped };
}

// THE WAY BACK: everything out of Venus into the agent's wallet. Health: the whole debt repaid (repayBorrow of the
// maximum is Venus's "all of it", interest included — the wallet must hold that much USDT), then every vBNB redeemed.
// Yield: every vUSDT and vUSDC redeemed. Run by hand (node scripts/venus-unwind.mjs <id> --confirm), never by the cron.
export async function unwindVenus(env, agentId, { rpcUrl = null } = {}) {
  const p = agentId === HEALTH.agentId ? HEALTH : agentId === YIELD.agentId ? YIELD : null;
  if (!p) throw new Error(`#${agentId} is not one of the two Venus agents`);
  const account = accountOf(env[p.key]);
  if (!account) throw new Error(`no ${p.key}`);
  const { pub, wal } = clients(account, rpcUrl), me = account.address, done = [];
  if (p === HEALTH) {
    const debt = await read(pub, MARKETS.USDT.vToken, 'borrowBalanceStored', [me]);
    if (debt > 0n) {
      const held = await read(pub, MARKETS.USDT.token, 'balanceOf', [me]);
      if (held <= debt) throw new Error(`the debt is ${formatUnits(debt, 18)} USDT with interest and the wallet holds ${formatUnits(held, 18)}: send it the difference first`);
      if ((await read(pub, MARKETS.USDT.token, 'allowance', [me, MARKETS.USDT.vToken])) < held) await act(pub, wal, account, { to: MARKETS.USDT.token, functionName: 'approve', args: [MARKETS.USDT.vToken, 2n ** 256n - 1n], codeOk: false });
      done.push({ action: 'repay all', tx: await act(pub, wal, account, { to: MARKETS.USDT.vToken, functionName: 'repayBorrow', args: [2n ** 256n - 1n] }) });
    }
    const v = await read(pub, VBNB, 'balanceOf', [me]);
    if (v > 0n) done.push({ action: 'redeem BNB', tx: await act(pub, wal, account, { to: VBNB, functionName: 'redeem', args: [v] }) });
  } else {
    for (const [coin, m] of Object.entries(MARKETS)) {
      const v = await read(pub, m.vToken, 'balanceOf', [me]);
      if (v > 0n) done.push({ action: `redeem ${coin}`, tx: await act(pub, wal, account, { to: m.vToken, functionName: 'redeem', args: [v] }) });
    }
  }
  return { agent: p.agentId, wallet: me, done };
}

export async function readVenusLog(env) {
  return JSON.parse((await env.AGENT.get(LOG_KEY)) || '[]');
}
export const venusWorkDue = (d) => d.getUTCHours() === 5 && d.getUTCMinutes() < 15;
