// The LP agent's three steps, written once.
//
// worker-lp/index.js runs them daily with the keys as Worker secrets;
// scripts/lp-agent.mjs runs the same functions from a laptop, plan by default.
// The first build had the collect in two files that had already drifted apart
// — the worker forwarded BNB to the buyback bot while the hand script still
// bought and burned $BOBAI itself — so the logic now lives here and the two
// callers only differ in where the record goes.
//
// THE MONEY, in the order the daily tick runs it:
//   sweep     what the AI side earned (USD1 for watches, $U for delivered
//             jobs) is sold for BNB and sent to the liquidity wallet
//   collect   the position's fees are collected and sold for BNB; part of it
//             stays as capital (FEE_SHARE_KEPT_PCT, half since 2026-09-04),
//             the rest goes to the buyback wallet — only the fees, never the
//             capital
//   rebalance a range the price has left is re-set around the price; the
//             fees the old range owed are split the same way on the way
//             (since 2026-09-08): the kept share is minted into the new
//             capital, the rest goes to the buyback wallet before the mint
//   increase  BNB above the reserve is put into the same position — the
//             income the sweep brought and the fee share the collect kept
//
// Every plan* function only reads. Every execute* function signs, and takes
// the plan it was given rather than reading again, so what was printed is
// what gets sent. A chain read that fails throws — an RPC that did not answer
// must never look like a wallet that holds nothing.
import { parseAbi, formatEther, formatUnits, parseEther, encodeFunctionData } from 'viem';
import {
  refuseCollect, refuseSweep, refuseIncrease, refuseRebalance, splitFees, resetForward,
  GAS_RESERVE_BNB, MAX_SWEEP_USD, INCREASE_GAS_BUDGET_BNB, FEE_SHARE_KEPT_PCT,
  V2_SWAP_FEE_PCT,
} from './lp-guards.js';

export const ADDR = {
  V3_POSITION_MANAGER: '0x46a15b0b27311cedf172ab29e4f4766fbe7f4364',
  V2_ROUTER: '0x10ed43c718714eb63d5aa57b78b54704e256024e',
  WBNB: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  // Where collected fees go: the buyback bot's wallet, which buys and burns
  // $BOBAI as it always has. One burn path, one record.
  BUYBACK_WALLET: '0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce',
  // Where AI income goes: the wallet that holds the position.
  LP_WALLET: '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A',
  // BSC mainnet BNB/USD, 8 decimals. On-chain, so the worker needs no outside API.
  CHAINLINK_BNB_USD: '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE',
};
export const RPCS = [
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-rpc.publicnode.com',
];
export const GAS_PRICE = 1_000_000_000n;
export const GAS_RESERVE = parseEther(String(GAS_RESERVE_BNB));
const MAX128 = (1n << 128n) - 1n;
const ZERO = '0x0000000000000000000000000000000000000000';

// The wallets the AI side is paid into, and what each one earns. Each is used
// for nothing else, which is what makes its history the earnings record.
export const INCOME_SOURCES = [
  {
    key: 'x402', name: 'x402 service', keyEnv: 'X402_PRIVATE_KEY',
    wallet: '0x690E950214980BC329823A2DB2fD90C06Bd54dE4',
    token: '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d', symbol: 'USD1', decimals: 18,
    earns: 'USD1 paid by agents for pool watches',
  },
  {
    key: 'provider', name: 'agent provider', keyEnv: 'AGENT_PROVIDER_PRIVATE_KEY',
    wallet: '0x73809F69916FcF7Ddc5BB1315fBdf96A569a5963',
    token: '0xcE24439F2D9C6a2289F741120FE202248B666666', symbol: '$U', decimals: 18,
    earns: '$U released from ERC-8183 job escrows',
  },
];

export const ABI = {
  ERC20: parseAbi([
    'function balanceOf(address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
    'function allowance(address,address) view returns (uint256)',
    'function withdraw(uint256)',
    'function deposit() payable',
  ]),
  NPM: parseAbi([
    'function balanceOf(address) view returns (uint256)',
    'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
    'function positions(uint256) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)',
    'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) payable returns (uint256 amount0,uint256 amount1)',
    'function increaseLiquidity((uint256 tokenId,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns (uint128 liquidity,uint256 amount0,uint256 amount1)',
    'function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns (uint256 amount0,uint256 amount1)',
    'function burn(uint256 tokenId) payable',
    'function multicall(bytes[] data) payable returns (bytes[] results)',
    'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
    'function factory() view returns (address)',
  ]),
  FACTORY: parseAbi(['function getPool(address,address,uint24) view returns (address)']),
  POOL: parseAbi([
    'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint32 feeProtocol,bool unlocked)',
    'function tickSpacing() view returns (int24)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    'function fee() view returns (uint24)',
  ]),
  ROUTER: parseAbi([
    'function getAmountsOut(uint256,address[]) view returns (uint256[])',
    'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)',
    'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns (uint256[])',
  ]),
  FEED: parseAbi(['function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)']),
};

const bn = (v) => Number(formatEther(v));
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);
const read = (pub, address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });

// What a transaction pays per gas: the chain's own answer with headroom,
// floored at BSC's 0.05 gwei minimum and capped at 3 gwei. The floors and
// reserves in lp-guards.js are still priced at 1 gwei — that is the safety
// margin — but paying 1 gwei on a chain that clears at 0.05 was paying
// twenty times the fare, measured 2026-09-02.
export async function gasPriceNow(pub) {
  const g = await pub.getGasPrice().catch(() => null);
  if (g == null) return GAS_PRICE;
  const floor = 50_000_000n, cap = 3_000_000_000n;
  const bumped = (g * 15n) / 10n;
  return bumped < floor ? floor : bumped > cap ? cap : bumped;
}

// One transaction, waited for, refused to continue past a revert. `txs` is
// the caller's list so a failure mid-sequence still reports what was sent.
export function sender(pub, wallet, txs, log = () => {}) {
  let price = null;
  return async (label, req) => {
    // Whatever throws — a simulation that reverts before sending, a sent
    // transaction that reverts — carries the list of what was sent so far,
    // so a failed run's record still names its transactions and their gas.
    // Without it the two failed runs of 2026-09-05 (7 transactions) counted
    // as none, and the page said "8 transactions so far" against a wallet
    // nonce of 34.
    try {
      if (price == null) price = await gasPriceNow(pub);
      const hash = req.to
        ? await wallet.sendTransaction({ ...req, gasPrice: price })
        : await wallet.writeContract({ ...req, gasPrice: price });
      const entry = { label, hash };
      txs.push(entry);
      log(`  ${label}: ${hash}`);
      const r = await pub.waitForTransactionReceipt({ hash, timeout: 90000 });
      // What the transaction really cost, so the record can say what a re-set
      // costs in measured BNB rather than in the replay's assumption.
      if (r.gasUsed != null && r.effectiveGasPrice != null) entry.gas_bnb = Number(formatEther(r.gasUsed * r.effectiveGasPrice));
      if (r.status !== 'success') throw new Error(`${label} reverted — stopped before the next step`);
      return r;
    } catch (e) {
      if (e && typeof e === 'object' && !e.txs) e.txs = txs;
      throw e;
    }
  };
}

// --------------------------------------------------------------------------
// The position
// --------------------------------------------------------------------------

// The position this wallet holds, and what a collect would return right now.
// Asked by simulation, not read off the struct: tokensOwed only updates when
// the position is touched, so an untouched position reads zero there. A
// simulation that fails throws — it is not "nothing owed".
export async function readPosition(pub, address) {
  const positions = Number(await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'balanceOf', [address]));
  if (positions !== 1) return { positions, tokenId: null, pos: null, owed0: 0n, owed1: 0n };
  const tokenId = await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'tokenOfOwnerByIndex', [address, 0n]);
  const pos = await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'positions', [tokenId]);
  let owed0 = 0n, owed1 = 0n;
  if (pos[7] > 0n) {
    const sim = await pub.simulateContract({
      address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'collect',
      args: [{ tokenId, recipient: address, amount0Max: MAX128, amount1Max: MAX128 }], account: address,
    }).catch((e) => { throw new Error(`collect simulation failed: ${e.shortMessage || e.message}`); });
    owed0 = sim.result[0]; owed1 = sim.result[1];
  }
  return { positions, tokenId, pos, owed0, owed1 };
}

// The pool behind a position, from the manager's own factory rather than a
// constant, and where its price stands.
export async function readPool(pub, pos) {
  const factory = await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'factory');
  const pool = await read(pub, factory, ABI.FACTORY, 'getPool', [pos[2], pos[3], pos[4]]);
  if (!pool || pool === ZERO) throw new Error('the position names a pool the factory does not know');
  const s = await read(pub, pool, ABI.POOL, 'slot0');
  const sqrtP = Number(s[0]) / 2 ** 96;
  const tick = Number(s[1]);
  return { pool, sqrtP, tick, inRange: tick >= Number(pos[5]) && tick < Number(pos[6]) };
}

// The pair behind a pool address, in the shape the position manager's
// positions() returns (token0 at [2], token1 at [3], fee at [4], no ticks, no
// liquidity), so a wallet that holds the two tokens but no position can be
// planned with the same code as one that holds a position.
export async function readPoolPair(pub, pool) {
  const [token0, token1, fee] = await Promise.all([
    read(pub, pool, ABI.POOL, 'token0'), read(pub, pool, ABI.POOL, 'token1'), read(pub, pool, ABI.POOL, 'fee'),
  ]);
  return [0n, ZERO, token0, token1, fee, 0, 0, 0n];
}

// How much of each token one unit of liquidity holds inside a range at a
// price. Standard V3 identities, and not a preference: inside a range the
// split is fixed by where the price sits in it. Pure, exported for the
// self-test.
const sqrtAtTick = (t) => Math.pow(1.0001, t / 2);
export function splitForRange(sqrtP, tickLower, tickUpper) {
  const sLo = sqrtAtTick(tickLower), sHi = sqrtAtTick(tickUpper);
  const perL0 = sqrtP >= sHi ? 0 : (1 / Math.max(sqrtP, sLo) - 1 / sHi);
  const perL1 = sqrtP <= sLo ? 0 : (Math.min(sqrtP, sHi) - sLo);
  return { perL0, perL1 };
}

// What the position manager will actually take from two balances at a price
// inside a range: the liquidity the shorter side allows, and the two amounts
// that liquidity needs. Minimums for a mint or an increase are a share of
// THESE amounts — never of the balances. 2026-09-05: an increase asked for
// 90% of every token the wallet held, the manager took the range's ratio,
// the other side fell short of its own minimum and the call reverted
// ("Price slippage check") after the tokens had already been bought.
// Pure, exported for the self-test.
export function amountsForRange(sqrtP, tickLower, tickUpper, have0, have1) {
  const { perL0, perL1 } = splitForRange(sqrtP, tickLower, tickUpper);
  const l0 = perL0 > 0 ? Number(have0) / perL0 : Infinity;
  const l1 = perL1 > 0 ? Number(have1) / perL1 : Infinity;
  const L = Math.min(l0, l1);
  if (!isFinite(L) || L <= 0) return { amount0: 0n, amount1: 0n, L: 0 };
  return { amount0: BigInt(Math.floor(L * perL0)), amount1: BigInt(Math.floor(L * perL1)), L };
}

// Minimums for a mint or an increase: what the range takes at the price now,
// AND at that price moved by MINT_DRIFT_TICKS either way — per token the
// smallest of the three, at 97%. The tolerance is in ticks, not in percent
// of the amounts, because a percentage does not know how wide the range is.
// 2026-09-05 12:50: a ±1% range (190 ticks) was minted with minimums at 97%
// of the amounts read seconds before; the pool moved a few ticks before the
// block, which in a range that narrow shifts the ratio by a percent per tick,
// and the mint reverted ("Price slippage check") after the old position was
// already unwound. 20 ticks is 0.2% of price: a normal few seconds on
// CAKE/BNB pass, a sandwich that far costs less than a cent on this size.
export const MIN_SHARE = 97n;
export const MINT_DRIFT_TICKS = 20;
export function minsForRange(sqrtP, tickLower, tickUpper, have0, have1, driftTicks = MINT_DRIFT_TICKS) {
  const shift = (t) => sqrtP * Math.pow(1.0001, t / 2);
  const at = [0, -driftTicks, driftTicks, -driftTicks / 2, driftTicks / 2].map((t) => amountsForRange(shift(t), tickLower, tickUpper, have0, have1));
  const amount0 = at.reduce((m, x) => (x.amount0 < m ? x.amount0 : m), at[0].amount0);
  const amount1 = at.reduce((m, x) => (x.amount1 < m ? x.amount1 : m), at[0].amount1);
  return { amount0Min: (amount0 * MIN_SHARE) / 100n, amount1Min: (amount1 * MIN_SHARE) / 100n };
}

// --------------------------------------------------------------------------
// collect: fees -> BNB -> part kept as capital, the rest to the buyback wallet
// --------------------------------------------------------------------------

export async function planCollect(pub, address) {
  const { positions, tokenId, pos, owed0, owed1 } = await readPosition(pub, address);
  const gasBal = await pub.getBalance({ address });
  const token0 = pos ? pos[2].toLowerCase() : null, token1 = pos ? pos[3].toLowerCase() : null;
  const wbnbIs0 = token0 === ADDR.WBNB;
  const other = pos ? (wbnbIs0 ? token1 : token0) : null;
  if (pos && !wbnbIs0 && token1 !== ADDR.WBNB) throw new Error('the position is not against WBNB; this agent only knows how to turn a WBNB pair into BNB');
  const owedWbnb = wbnbIs0 ? owed0 : owed1;
  const owedOther = wbnbIs0 ? owed1 : owed0;

  // Tokens the wallet holds OUTSIDE the position — the headroom the mint left
  // over, or what an interrupted run did not finish — are capital, not fees.
  // They are reported here and re-used by the increase and the re-set; the
  // collect sells only what the collect itself returns.
  let heldOther = 0n, heldWbnb = 0n;
  if (pos) {
    heldOther = await read(pub, other, ABI.ERC20, 'balanceOf', [address]);
    heldWbnb = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [address]);
  }
  let otherInBnb = 0n, quoteOffPct = null, poolInfo = null;
  if (pos) poolInfo = await readPool(pub, pos);
  if (pos && owedOther > 0n) {
    const q = await read(pub, ADDR.V2_ROUTER, ABI.ROUTER, 'getAmountsOut', [owedOther, [other, ADDR.WBNB]]);
    otherInBnb = q[1];
    // The V2 quote against the V3 pool's own price. A thin or manipulated V2
    // pair would show here as a price far from the one the position lives at.
    const poolWbnbPerOther = wbnbIs0 ? 1 / (poolInfo.sqrtP ** 2) : poolInfo.sqrtP ** 2;
    const v2WbnbPerOther = Number(otherInBnb) / Number(owedOther);
    quoteOffPct = poolWbnbPerOther > 0 ? ((v2WbnbPerOther - poolWbnbPerOther) / poolWbnbPerOther) * 100 : null;
  }
  const proceeds = bn(owedWbnb + otherInBnb);
  const state = { positions, liquidity: pos ? pos[7] : 0n, owedBnbEquivalent: proceeds, gasBnb: bn(gasBal), quoteOffPct };
  return {
    step: 'collect', state, no: refuseCollect(state),
    tokenId, pos, other, wbnbIs0, owedWbnb, owedOther, heldOther, heldWbnb, otherInBnb, quoteOffPct,
    summary: {
      position: tokenId == null ? null : String(tokenId),
      ticks: pos ? [Number(pos[5]), Number(pos[6])] : null,
      liquidity: pos ? String(pos[7]) : null,
      in_range: poolInfo ? poolInfo.inRange : null,
      owed: { wbnb: formatEther(owedWbnb), other: formatUnits(owedOther, 18), other_token: other, bnb_equivalent: proceeds },
      held_outside_position: heldOther > 0n || heldWbnb > 0n ? { wbnb: formatEther(heldWbnb), other: formatUnits(heldOther, 18), note: 'capital, re-used by increase and re-set, not sold here' } : null,
      quote_off_pct: quoteOffPct == null ? null : Number(quoteOffPct.toFixed(2)),
      gas_bnb: state.gasBnb,
    },
  };
}

// Collect, sell, unwrap, split, forward — and forward ONLY what this run
// produced. The wallet also holds the capital the sweep delivers for the next
// increase; "everything above the reserve" would have sent that to the
// buyback bot. `keptPct` of what was produced stays in the wallet as BNB —
// capital for the next increase, so the position grows out of its own fees —
// and the rest goes to the buyback wallet. The record carries both figures.
export async function executeCollect(pub, wallet, account, plan, log = () => {}, { keptPct = FEE_SHARE_KEPT_PCT } = {}) {
  const txs = [];
  const send = sender(pub, wallet, txs, log);
  const before = await pub.getBalance({ address: account.address });
  const otherBefore = await read(pub, plan.other, ABI.ERC20, 'balanceOf', [account.address]);
  await send('collect', { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'collect',
    args: [{ tokenId: plan.tokenId, recipient: account.address, amount0Max: MAX128, amount1Max: MAX128 }] });
  // Only what the collect returned is sold; what the wallet held before it is
  // capital and stays.
  const otherAfter = await read(pub, plan.other, ABI.ERC20, 'balanceOf', [account.address]);
  const sell = otherAfter > otherBefore ? otherAfter - otherBefore : 0n;
  if (sell > 0n) {
    await send('approve for sale', { address: plan.other, abi: ABI.ERC20, functionName: 'approve', args: [ADDR.V2_ROUTER, sell] });
    // 15% floor, the same this project uses for fee-on-transfer tokens; the
    // guard already refused anything that moved more than that.
    const q = await read(pub, ADDR.V2_ROUTER, ABI.ROUTER, 'getAmountsOut', [sell, [plan.other, ADDR.WBNB]]);
    await send('sell the other side', { address: ADDR.V2_ROUTER, abi: ABI.ROUTER, functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
      args: [sell, (q[1] * 8500n) / 10000n, [plan.other, ADDR.WBNB], account.address, deadline()] });
  }
  // WBNB is never capital-in-waiting (that waits as BNB), so all of it is
  // fees: this collect's, or an earlier one's that never got unwrapped.
  const wbnbHave = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  if (wbnbHave > 0n) await send('unwrap', { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'withdraw', args: [wbnbHave] });

  const after = await pub.getBalance({ address: account.address });
  const produced = after - before;           // net of the gas this run spent
  const aboveReserve = after - GAS_RESERVE;   // never dip into the reserve
  const forward = produced < aboveReserve ? produced : aboveReserve;
  if (forward <= 0n) return { txs, forwarded_bnb: '0', kept_bnb: '0', why: 'collected, but nothing net of gas and the reserve to forward' };
  const split = splitFees(forward, keptPct);
  const out = { txs, produced_bnb: formatEther(forward), kept_bnb: formatEther(split.keep), kept_pct: split.pct, forwarded_bnb: formatEther(split.buyback), to: ADDR.BUYBACK_WALLET };
  if (split.buyback <= 0n) return { ...out, to: null, why: `collected ${formatEther(forward)} BNB of fees; all of it stays as capital (kept share ${split.pct}%)` };
  await send(`forward ${100 - split.pct}% to the buyback wallet`, { to: ADDR.BUYBACK_WALLET, value: split.buyback, gas: 21000n });
  return out;
}

// --------------------------------------------------------------------------
// sweep: AI income -> BNB -> liquidity wallet
// --------------------------------------------------------------------------

export async function readBnbUsd(pub) {
  const r = await read(pub, ADDR.CHAINLINK_BNB_USD, ABI.FEED, 'latestRoundData');
  return { bnbUsd: Number(r[1]) / 1e8, feedAgeS: Math.floor(Date.now() / 1000) - Number(r[3]) };
}

export async function planSweep(pub, source, feed = null) {
  const balance = await read(pub, source.token, ABI.ERC20, 'balanceOf', [source.wallet]);
  const gasBal = await pub.getBalance({ address: source.wallet });
  const { bnbUsd, feedAgeS } = feed || (await readBnbUsd(pub));
  // Bounded per run: a balance above the cap is swept in daily slices.
  const capRaw = parseEther(String(MAX_SWEEP_USD));
  const amount = balance > capRaw ? capRaw : balance;
  let bnbOut = 0n, impliedUsd = null;
  if (amount > 0n) {
    const q = await read(pub, ADDR.V2_ROUTER, ABI.ROUTER, 'getAmountsOut', [amount, [source.token, ADDR.WBNB]]);
    bnbOut = q[1];
    impliedUsd = (bn(bnbOut) * bnbUsd) / Number(formatUnits(amount, source.decimals));
  }
  const state = { symbol: source.symbol, balance: Number(formatUnits(balance, source.decimals)), bnbEquivalent: bn(bnbOut), gasBnb: bn(gasBal), bnbUsd, feedAgeS, impliedUsd };
  return {
    step: 'sweep', source, state, no: refuseSweep(state), amount, bnbOut,
    summary: {
      source: source.key, wallet: source.wallet, token: source.symbol,
      balance: state.balance, sweeping: Number(formatUnits(amount, source.decimals)),
      bnb_equivalent: state.bnbEquivalent, implied_usd: impliedUsd == null ? null : Number(impliedUsd.toFixed(4)),
      capped: balance > capRaw, gas_bnb: state.gasBnb,
    },
  };
}

// Approve exactly the amount, sell it, and have the router pay the BNB
// straight to the liquidity wallet — one transaction fewer, and the income
// wallet never holds BNB it could be tempted to keep.
export async function executeSweep(pub, wallet, account, plan, log = () => {}) {
  const txs = [];
  const send = sender(pub, wallet, txs, log);
  const before = await pub.getBalance({ address: ADDR.LP_WALLET });
  await send(`approve ${plan.source.symbol}`, { address: plan.source.token, abi: ABI.ERC20, functionName: 'approve', args: [ADDR.V2_ROUTER, plan.amount] });
  // 3% floor: both pairs are deep and both tokens are dollars; the guard has
  // already refused a route that prices them off a dollar.
  await send(`sell ${plan.source.symbol} for BNB to the liquidity wallet`, {
    address: ADDR.V2_ROUTER, abi: ABI.ROUTER, functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
    args: [plan.amount, (plan.bnbOut * 9700n) / 10000n, [plan.source.token, ADDR.WBNB], ADDR.LP_WALLET, deadline()],
  });
  const after = await pub.getBalance({ address: ADDR.LP_WALLET });
  return { txs, sold: formatUnits(plan.amount, plan.source.decimals), received_bnb: formatEther(after - before), to: ADDR.LP_WALLET };
}

// --------------------------------------------------------------------------
// rebalance: a position the price has left is re-set around today's price
// --------------------------------------------------------------------------

// What a range of this width around the current tick looks like on this
// pool's grid. Rounded INWARD, so the range is never wider than the one the
// record tested.
export function ticksAround(tick, widthPct, spacing) {
  const span = Math.log(1 + widthPct / 100) / Math.log(1.0001);
  const tickLower = Math.ceil((tick - span) / spacing) * spacing;
  const tickUpper = Math.floor((tick + span) / spacing) * spacing;
  return { tickLower, tickUpper };
}

// `record` is the verdict of the window record (agent.brainonbnb.com/lp/windows
// or the same function over KV); its earnings_pick names the width — the one
// that netted the most per day when every width was replayed over the recorded
// prices with the agent's own re-set delay and cost. `widthOverride` is a
// person's explicit choice from the hand script, and is reported as one.
// `pool` is the pool the window record watches: when the wallet holds no
// position but does hold that pool's two tokens, the plan is a mint from the
// wallet — a re-set that stopped between its unwind and its mint (2026-09-05
// 12:50) is finished on the next run instead of leaving the capital idle.
export async function planRebalance(pub, address, { record = null, widthOverride = null, position = null, pool = null, keptPct = FEE_SHARE_KEPT_PCT } = {}) {
  let p = position || (await readPosition(pub, address));
  let resume = false;
  if (p.positions === 0 && pool) { p = { ...p, pos: await readPoolPair(pub, pool) }; resume = true; }
  let poolInfo = null, spacing = null, other = null, wbnbIs0 = false, valueBnb = 0, have = null, target = null, ticks = null, trade = null;
  let owedWei = 0n, share = null;
  const pick = record?.earnings_pick || null;
  const width = widthOverride ?? pick?.width ?? null;
  const widthBasis = widthOverride != null ? 'named by hand'
    : (pick ? `netted the most per day over ${record?.hours_of_prices} h of recorded prices: about $${pick.earnings.net_usd_per_day} a day on $50 after ${pick.earnings.resets} re-set${pick.earnings.resets === 1 ? '' : 's'} at $${pick.earnings.reset_cost_usd} each` : null);
  if (p.positions === 1 || resume) {
    poolInfo = await readPool(pub, p.pos);
    spacing = Number(await read(pub, poolInfo.pool, ABI.POOL, 'tickSpacing')) || 1;
    const token0 = p.pos[2].toLowerCase(), token1 = p.pos[3].toLowerCase();
    wbnbIs0 = token0 === ADDR.WBNB;
    if (!wbnbIs0 && token1 !== ADDR.WBNB) throw new Error('the position is not against WBNB; this agent only knows how to re-set a WBNB pair');
    other = wbnbIs0 ? token1 : token0;
    // What the position holds at today's price, plus what sits in the wallet
    // outside it — all of it goes into the new range.
    const L = Number(p.pos[7]);
    const s = splitForRange(poolInfo.sqrtP, Number(p.pos[5]), Number(p.pos[6]));
    const in0 = L * s.perL0, in1 = L * s.perL1;
    const heldOther = Number(await read(pub, other, ABI.ERC20, 'balanceOf', [address]));
    const heldWbnb = Number(await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [address]));
    const price = poolInfo.sqrtP ** 2;
    const otherInWbnb = wbnbIs0 ? 1 / price : price;
    have = { other: (wbnbIs0 ? in1 : in0) + heldOther, wbnb: (wbnbIs0 ? in0 : in1) + heldWbnb };
    valueBnb = (have.wbnb + have.other * otherInWbnb) / 1e18;
    // What the old range still owes in fees, in WBNB terms, and the part of
    // it a re-set would send on to the buyback wallet.
    if (!resume && p.owed0 != null) {
      const owedWbnb = wbnbIs0 ? p.owed0 : p.owed1, owedOther = wbnbIs0 ? p.owed1 : p.owed0;
      owedWei = owedWbnb + BigInt(Math.floor(Number(owedOther) * otherInWbnb));
      share = resetForward(owedWei, keptPct);
    }
    if (width != null) {
      ticks = ticksAround(poolInfo.tick, width, spacing);
      if (ticks.tickUpper <= ticks.tickLower) throw new Error(`a ${width}% range is narrower than this pool's tick spacing (${spacing})`);
      const n = splitForRange(poolInfo.sqrtP, ticks.tickLower, ticks.tickUpper);
      const perLOther = wbnbIs0 ? n.perL1 : n.perL0, perLWbnb = wbnbIs0 ? n.perL0 : n.perL1;
      const perLValue = perLWbnb + perLOther * otherInWbnb;
      const Ln = perLValue > 0 ? (valueBnb * 1e18 * 0.99) / perLValue : 0;
      target = { other: Ln * perLOther, wbnb: Ln * perLWbnb, perLOther, perLWbnb, otherInWbnb };
      // The trade that turns what is held into what the new range needs.
      trade = have.other > target.other
        ? { sell: 'other', amount: have.other - target.other }
        : { sell: 'wbnb', amount: (target.other - have.other) * otherInWbnb * 1.02 };
    }
  }
  // A wallet without a position is never "in range"; resume says the plan is
  // a mint from what the wallet holds, and the guard sizes it like a re-set.
  const state = { positions: p.positions, resume, inRange: poolInfo && !resume ? poolInfo.inRange : false, width, hoursOfPrices: record?.hours_of_prices || 0, valueBnb };
  return {
    step: 'rebalance', state, no: refuseRebalance(state), resume,
    tokenId: p.tokenId, pos: p.pos, poolInfo, spacing, other, wbnbIs0, width, ticks, target, trade,
    summary: {
      position: p.tokenId == null ? null : String(p.tokenId),
      ...(resume ? { resumed_from_wallet: true, held: have ? { other: (have.other / 1e18).toFixed(6), wbnb: (have.wbnb / 1e18).toFixed(6) } : null } : {}),
      ticks: p.tokenId != null ? [Number(p.pos[5]), Number(p.pos[6])] : null,
      tick: poolInfo ? poolInfo.tick : null, in_range: state.inRange,
      value_bnb: Number(valueBnb.toFixed(6)),
      width_pct: width, width_basis: widthBasis,
      expected_net_usd_per_day: pick ? pick.earnings.net_usd_per_day : null,
      new_ticks: ticks ? [ticks.tickLower, ticks.tickUpper] : null,
      trade: trade ? (trade.sell === 'other' ? `sell ${(trade.amount / 1e18).toFixed(6)} of ${other} for WBNB` : `buy the other side with ${(trade.amount / 1e18).toFixed(6)} WBNB`) : null,
      fees_owed_bnb: Number((Number(owedWei) / 1e18).toFixed(6)),
      fees_to_buyback_bnb: share ? Number((Number(share.forward) / 1e18).toFixed(6)) : 0,
      fees_kept_pct: share ? share.pct : null,
    },
  };
}

// The three calls that empty the old position, as one transaction: withdraw
// its liquidity, collect what it held, burn the NFT. The position manager's
// multicall runs them in order inside one transaction and reverts as a whole
// if any of them does. Pure, so the self-test can pin what is encoded.
export function unwindCalls(tokenId, liquidity, amount0Min, amount1Min, recipient, dl) {
  return [
    encodeFunctionData({ abi: ABI.NPM, functionName: 'decreaseLiquidity', args: [{ tokenId, liquidity, amount0Min, amount1Min, deadline: dl }] }),
    encodeFunctionData({ abi: ABI.NPM, functionName: 'collect', args: [{ tokenId, recipient, amount0Max: MAX128, amount1Max: MAX128 }] }),
    encodeFunctionData({ abi: ABI.NPM, functionName: 'burn', args: [tokenId] }),
  ];
}

// An approval that is only sent when the allowance is short. The first
// build approved the exact amount before every trade and every mint — four
// approvals in a nine-transaction re-set, each one paid for. An allowance of
// the full amount range to PancakeSwap's own router and position manager is
// what every PancakeSwap user grants in the interface, and it means the next
// re-set skips these four transactions entirely.
const MAX_ALLOWANCE = (1n << 256n) - 1n;
async function ensureAllowance(pub, send, token, spender, amount, label) {
  const have = await read(pub, token, ABI.ERC20, 'allowance', [send.owner, spender]);
  if (have >= amount) return false;
  await send(label, { address: token, abi: ABI.ERC20, functionName: 'approve', args: [spender, MAX_ALLOWANCE] });
  return true;
}

// Empty the old position, burn its NFT, trade to the new ratio, send the
// buyback share of the old range's fees on, mint the new range from what the
// wallet then holds. Native BNB is not touched: the reserve and any capital
// waiting for the increase stay where they are (the forwarded share is
// unwrapped and sent in the same breath, so it never sits there).
// Nine transactions on 2026-09-02; four to five since 2026-09-04 (one
// multicall for the unwind, approvals only when the allowance is short);
// two more since 2026-09-08 when the fee share is worth sending.
export async function executeRebalance(pub, wallet, account, plan, log = () => {}, { keptPct = FEE_SHARE_KEPT_PCT } = {}) {
  const txs = [];
  const send = sender(pub, wallet, txs, log);
  send.owner = account.address;
  // A resumed re-set (plan.resume) has no position to unwind: the earlier run
  // already did that and stopped before its mint.
  // The fees the old range still owes are not collected as fees here: the
  // unwind pays them out with the principal. Read them first, so the record
  // can count them as fees — on 2026-09-07 the three re-sets had folded in
  // 0.000998 BNB that every fees figure said was zero — and so the buyback
  // share of them can be sent on before the mint folds the rest in.
  let folded = null, share = null;
  // The re-centring trade, written down: which side, how much in WBNB terms,
  // and the pool fee it paid. The window record charges this on top of the
  // gas when it replays the re-sets; without it the replay undercounted a
  // re-set by half (2026-09-09).
  let swap = null;
  const swapNote = (side, wbnbWei) => { const n = Number(formatEther(wbnbWei)); return { side, venue: 'pancakeswap v2', fee_pct: V2_SWAP_FEE_PCT, notional_bnb: Number(n.toFixed(6)), fee_bnb: Number((n * V2_SWAP_FEE_PCT / 100).toFixed(8)) }; };
  if (plan.tokenId != null) {
    const old = await readPosition(pub, account.address);
    if (old.tokenId != null && String(old.tokenId) === String(plan.tokenId)) {
      const owedWbnb = plan.wbnbIs0 ? old.owed0 : old.owed1, owedOther = plan.wbnbIs0 ? old.owed1 : old.owed0;
      const otherInWbnb = plan.target && plan.target.otherInWbnb ? plan.target.otherInWbnb : 0;
      const owedWei = owedWbnb + BigInt(Math.floor(Number(owedOther) * otherInWbnb));
      folded = { wbnb: formatEther(owedWbnb), other: formatUnits(owedOther, 18), bnb_equivalent: Number((Number(owedWei) / 1e18).toFixed(6)) };
      share = resetForward(owedWei, keptPct);
    }
  }
  const reserved = share && share.forward > 0n ? share.forward : 0n;
  if (plan.tokenId != null) {
    const liquidity = plan.pos[7];
    const sim = await pub.simulateContract({
      address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'decreaseLiquidity',
      args: [{ tokenId: plan.tokenId, liquidity, amount0Min: 0n, amount1Min: 0n, deadline: deadline() }], account,
    });
    const calls = unwindCalls(plan.tokenId, liquidity, (sim.result[0] * 99n) / 100n, (sim.result[1] * 99n) / 100n, account.address, deadline());
    await pub.simulateContract({ address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'multicall', args: [calls], account });
    await send('withdraw, collect and burn the old range (one transaction)', { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'multicall', args: [calls] });
  }

  // Sized from what the wallet really holds now, not from the plan's estimate.
  const haveOther = await read(pub, plan.other, ABI.ERC20, 'balanceOf', [account.address]);
  const haveWbnb = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  const t = plan.target;
  // The buyback share is not capital: it is kept out of the sizing, so the
  // trade below leaves it as WBNB for the transfer.
  const value = Number(haveWbnb - reserved) + Number(haveOther) * t.otherInWbnb;
  const perLValue = t.perLWbnb + t.perLOther * t.otherInWbnb;
  const Ln = (value * 0.99) / perLValue;
  const targetOther = BigInt(Math.floor(Ln * t.perLOther));
  if (haveOther > targetOther) {
    const sell = haveOther - targetOther;
    const q = await read(pub, ADDR.V2_ROUTER, ABI.ROUTER, 'getAmountsOut', [sell, [plan.other, ADDR.WBNB]]);
    await ensureAllowance(pub, send, plan.other, ADDR.V2_ROUTER, sell, 'allow the router to sell the other side (once)');
    await send('sell the excess of the other side', { address: ADDR.V2_ROUTER, abi: ABI.ROUTER, functionName: 'swapExactTokensForTokens',
      args: [sell, (q[1] * 99n) / 100n, [plan.other, ADDR.WBNB], account.address, deadline()] });
    swap = swapNote('sell', q[1]);
  } else if (targetOther > haveOther) {
    const need = targetOther - haveOther;
    const q = await read(pub, ADDR.V2_ROUTER, ABI.ROUTER, 'getAmountsOut', [10n ** 18n, [ADDR.WBNB, plan.other]]);
    const spend = q[1] > 0n ? (need * 10n ** 18n * 102n) / (q[1] * 100n) : 0n;
    const cap = haveWbnb > reserved ? haveWbnb - reserved : 0n;
    const wbnbIn = spend > cap ? cap : spend;
    if (wbnbIn > 0n) {
      await ensureAllowance(pub, send, ADDR.WBNB, ADDR.V2_ROUTER, wbnbIn, 'allow the router to spend WBNB (once)');
      await send('buy the missing other side', { address: ADDR.V2_ROUTER, abi: ABI.ROUTER, functionName: 'swapExactTokensForTokens',
        args: [wbnbIn, (need * 99n) / 100n, [ADDR.WBNB, plan.other], account.address, deadline()] });
      swap = swapNote('buy', wbnbIn);
    }
  }
  // The buyback share of the old range's fees leaves here, before the mint
  // can fold it into the new capital: unwrapped and sent in the same breath.
  // A wallet that holds less WBNB than the share after the trades (a range
  // that ended all on the other side, with the buy capped) keeps it as
  // capital and says so; the mint takes what is there.
  let forwarded = 0n, forwardWhy = share ? share.why : null;
  if (reserved > 0n) {
    const wbnbNow = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
    if (wbnbNow >= reserved) {
      await send("unwrap the buyback share of the old range's fees", { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'withdraw', args: [reserved] });
      await send(`send ${100 - share.pct}% of the old range's fees to the buyback wallet`, { to: ADDR.BUYBACK_WALLET, value: reserved, gas: 21000n });
      forwarded = reserved;
    } else {
      forwardWhy = `the wallet held ${formatEther(wbnbNow)} WBNB after the trades, less than the ${formatEther(reserved)} BNB share — it stays as capital`;
    }
  }
  const mintOther = await read(pub, plan.other, ABI.ERC20, 'balanceOf', [account.address]);
  const mintWbnb = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  await ensureAllowance(pub, send, plan.other, ADDR.V3_POSITION_MANAGER, mintOther, 'allow the position manager to take the other side (once)');
  await ensureAllowance(pub, send, ADDR.WBNB, ADDR.V3_POSITION_MANAGER, mintWbnb, 'allow the position manager to take WBNB (once)');
  const amount0Desired = plan.wbnbIs0 ? mintWbnb : mintOther;
  const amount1Desired = plan.wbnbIs0 ? mintOther : mintWbnb;
  // The minimums come from what the new range takes at the price now, not
  // from the balances (see amountsForRange).
  const mintMins = minsForRange((await readPool(pub, plan.pos)).sqrtP, plan.ticks.tickLower, plan.ticks.tickUpper, amount0Desired, amount1Desired);
  await send(`mint the new range ${plan.ticks.tickLower} … ${plan.ticks.tickUpper}`, { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'mint',
    args: [{
      token0: plan.pos[2], token1: plan.pos[3], fee: Number(plan.pos[4]),
      tickLower: plan.ticks.tickLower, tickUpper: plan.ticks.tickUpper,
      amount0Desired, amount1Desired,
      ...mintMins,
      recipient: account.address, deadline: deadline(),
    }] });
  const wbnbLeft = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  if (wbnbLeft > 0n) await send('unwrap what was not needed', { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'withdraw', args: [wbnbLeft] });
  const np = await readPosition(pub, account.address);
  const gasBnb = txs.reduce((s, t) => s + (t.gas_bnb || 0), 0);
  // fees_folded_bnb is all the old range owed; fees_forwarded_bnb the part of
  // it that went to the buyback wallet; the difference was minted into the
  // new capital. Records before 2026-09-08 carry only the first.
  return { txs, gas_bnb: Number(gasBnb.toFixed(6)), swap, swap_fee_bnb: swap ? swap.fee_bnb : 0, new_position: np.tokenId == null ? null : String(np.tokenId), new_ticks: [plan.ticks.tickLower, plan.ticks.tickUpper], liquidity_after: np.pos ? String(np.pos[7]) : null,
    ...(folded ? {
      fees_folded: folded, fees_folded_bnb: folded.bnb_equivalent,
      fees_forwarded_bnb: Number(formatEther(forwarded)), fees_kept_pct: share ? share.pct : null,
      ...(forwarded > 0n ? { forwarded_to: ADDR.BUYBACK_WALLET } : { fees_forward_why: forwardWhy }),
    } : {}) };
}

// --------------------------------------------------------------------------
// increase: BNB above the reserve -> more of the same position
// --------------------------------------------------------------------------

export async function planIncrease(pub, address, position = null) {
  const p = position || (await readPosition(pub, address));
  const bal = await pub.getBalance({ address });
  const spendRaw = bal - GAS_RESERVE - parseEther(String(INCREASE_GAS_BUDGET_BNB));
  const nativeRaw = spendRaw > 0n ? spendRaw : 0n;
  let poolInfo = null, target = null, other = null, wbnbIs0 = false, heldWbnb = 0n, heldOther = 0n, heldOtherInWbnb = 0, buyOtherRaw = 0n, sellOtherRaw = 0n, buyCostRaw = 0n;
  if (p.positions === 1) {
    poolInfo = await readPool(pub, p.pos);
    const token0 = p.pos[2].toLowerCase(), token1 = p.pos[3].toLowerCase();
    wbnbIs0 = token0 === ADDR.WBNB;
    if (!wbnbIs0 && token1 !== ADDR.WBNB) throw new Error('the position is not against WBNB; this agent only knows how to grow it out of BNB');
    other = wbnbIs0 ? token1 : token0;
    // Capital is everything the wallet holds beside the position: BNB above
    // the reserve, WBNB, and the other side. The re-set's headroom and an
    // interrupted run both leave tokens here; until 2026-09-05 the increase
    // saw only the BNB and then tripped over the tokens it had not counted.
    heldWbnb = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [address]);
    heldOther = await read(pub, other, ABI.ERC20, 'balanceOf', [address]);
    const { perL0, perL1 } = splitForRange(poolInfo.sqrtP, Number(p.pos[5]), Number(p.pos[6]));
    const price = poolInfo.sqrtP ** 2;                  // token1 per token0
    const perLOther = wbnbIs0 ? perL1 : perL0;
    const perLWbnb = wbnbIs0 ? perL0 : perL1;
    const otherInWbnb = wbnbIs0 ? 1 / price : price;    // WBNB per unit of the other token
    heldOtherInWbnb = Number(heldOther) * otherInWbnb;
    const capital = Number(nativeRaw) + Number(heldWbnb) + heldOtherInWbnb;
    // The L this much capital buys, with 2% kept back for the trade's
    // headroom, and the other side that L needs — bought or sold to match.
    const perLValue = perLWbnb + perLOther * otherInWbnb;
    const L = perLValue > 0 ? (capital * 0.98) / perLValue : 0;
    const targetOther = BigInt(Math.floor(L * perLOther));
    if (targetOther > heldOther) {
      buyOtherRaw = targetOther - heldOther;
      // Priced by the router that will do the swap, not by the pool.
      const q = await read(pub, ADDR.V2_ROUTER, ABI.ROUTER, 'getAmountsOut', [10n ** 18n, [ADDR.WBNB, other]]);
      buyCostRaw = q[1] > 0n ? (buyOtherRaw * 10n ** 18n * 102n) / (q[1] * 100n) : 0n;
    } else {
      sellOtherRaw = heldOther - targetOther;
    }
    target = { perLOther, perLWbnb, otherInWbnb, L };
  }
  const spendableBnb = poolInfo ? bn(nativeRaw + heldWbnb) + heldOtherInWbnb / 1e18 : bn(nativeRaw);
  const state = { positions: p.positions, spendableBnb, inRange: poolInfo ? poolInfo.inRange : false };
  return {
    step: 'increase', state, no: refuseIncrease(state),
    tokenId: p.tokenId, pos: p.pos, other, wbnbIs0, nativeRaw, heldWbnb, heldOther, buyOtherRaw, sellOtherRaw, buyCostRaw, target,
    summary: {
      wallet_bnb: bn(bal), spendable_bnb: spendableBnb, in_range: state.inRange, tick: poolInfo ? poolInfo.tick : null,
      capital: poolInfo ? { bnb_above_reserve: bn(nativeRaw), wbnb_held: bn(heldWbnb), other_held: formatUnits(heldOther, 18), other_held_in_bnb: Number((heldOtherInWbnb / 1e18).toFixed(6)) } : null,
      would_add: poolInfo && target && target.L > 0 ? {
        other: formatUnits(BigInt(Math.floor(target.L * target.perLOther)), 18), other_token: other, wbnb: formatEther(BigInt(Math.floor(target.L * target.perLWbnb))),
        ...(buyOtherRaw > 0n ? { buying_other: formatUnits(buyOtherRaw, 18), buying_other_costs_bnb: formatEther(buyCostRaw) } : {}),
        ...(sellOtherRaw > 0n ? { selling_other: formatUnits(sellOtherRaw, 18) } : {}),
      } : null,
    },
  };
}

export async function executeIncrease(pub, wallet, account, plan, log = () => {}) {
  const txs = [];
  const send = sender(pub, wallet, txs, log);
  send.owner = account.address;
  const before = await pub.getBalance({ address: account.address });
  // 1. BNB above the reserve becomes WBNB. Nothing to wrap when the capital
  //    is only what was already held beside the position.
  if (plan.nativeRaw > 0n) await send('wrap', { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'deposit', value: plan.nativeRaw });
  // 2. Trade to the range's ratio, the way the re-set does: buy the other
  //    side that is missing, or sell what exceeds it. Sized from what the
  //    wallet really holds now, at the price now.
  const t = plan.target;
  const haveOther0 = await read(pub, plan.other, ABI.ERC20, 'balanceOf', [account.address]);
  const haveWbnb0 = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  const value = Number(haveWbnb0) + Number(haveOther0) * t.otherInWbnb;
  const perLValue = t.perLWbnb + t.perLOther * t.otherInWbnb;
  const Ln = (value * 0.98) / perLValue;
  const targetOther = BigInt(Math.floor(Ln * t.perLOther));
  if (haveOther0 > targetOther) {
    const sell = haveOther0 - targetOther;
    const q = await read(pub, ADDR.V2_ROUTER, ABI.ROUTER, 'getAmountsOut', [sell, [plan.other, ADDR.WBNB]]);
    await ensureAllowance(pub, send, plan.other, ADDR.V2_ROUTER, sell, 'allow the router to sell the other side (once)');
    await send('sell the excess of the other side', { address: ADDR.V2_ROUTER, abi: ABI.ROUTER, functionName: 'swapExactTokensForTokens',
      args: [sell, (q[1] * 99n) / 100n, [plan.other, ADDR.WBNB], account.address, deadline()] });
  } else if (targetOther > haveOther0) {
    const need = targetOther - haveOther0;
    const q = await read(pub, ADDR.V2_ROUTER, ABI.ROUTER, 'getAmountsOut', [10n ** 18n, [ADDR.WBNB, plan.other]]);
    const spend = q[1] > 0n ? (need * 10n ** 18n * 102n) / (q[1] * 100n) : 0n;
    const wbnbIn = spend > haveWbnb0 ? haveWbnb0 : spend;
    if (wbnbIn > 0n) {
      await ensureAllowance(pub, send, ADDR.WBNB, ADDR.V2_ROUTER, wbnbIn, 'allow the router to spend WBNB (once)');
      await send('buy the missing other side', { address: ADDR.V2_ROUTER, abi: ABI.ROUTER, functionName: 'swapExactTokensForTokens',
        args: [wbnbIn, (need * 99n) / 100n, [ADDR.WBNB, plan.other], account.address, deadline()] });
    }
  }
  // 3. Add what the wallet holds. Approvals only when the allowance is short
  //    (see ensureAllowance). The manager takes only the ratio the range
  //    needs; the minimums are 97% of that ratio's amounts at the price now
  //    (amountsForRange) — never a share of the balances, which is what
  //    reverted the run of 2026-09-05.
  const haveOther = await read(pub, plan.other, ABI.ERC20, 'balanceOf', [account.address]);
  const haveWbnb = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  await ensureAllowance(pub, send, plan.other, ADDR.V3_POSITION_MANAGER, haveOther, 'allow the position manager to take the other side (once)');
  await ensureAllowance(pub, send, ADDR.WBNB, ADDR.V3_POSITION_MANAGER, haveWbnb, 'allow the position manager to take WBNB (once)');
  const amount0Desired = plan.wbnbIs0 ? haveWbnb : haveOther;
  const amount1Desired = plan.wbnbIs0 ? haveOther : haveWbnb;
  const mins = minsForRange((await readPool(pub, plan.pos)).sqrtP, Number(plan.pos[5]), Number(plan.pos[6]), amount0Desired, amount1Desired);
  await send('increase the position', { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'increaseLiquidity',
    args: [{ tokenId: plan.tokenId, amount0Desired, amount1Desired, ...mins, deadline: deadline() }] });
  // What the manager did not take goes back to being capital. The other
  // token's dust is left; tomorrow's collect sells it with the fees.
  const wbnbLeft = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  if (wbnbLeft > 0n) await send('unwrap what was not needed', { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'withdraw', args: [wbnbLeft] });
  const pos = await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'positions', [plan.tokenId]);
  // What left the wallet as BNB for this increase, gas included — the figure
  // the money-flow view adds up as "put into the position".
  const after = await pub.getBalance({ address: account.address });
  return { txs, liquidity_after: String(pos[7]), other_used: formatUnits(haveOther - (await read(pub, plan.other, ABI.ERC20, 'balanceOf', [account.address])), 18), wbnb_used: formatEther(haveWbnb - wbnbLeft), bnb_spent: formatEther(before > after ? before - after : 0n) };
}
