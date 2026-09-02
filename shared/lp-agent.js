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
//   collect   the position's fees are collected, sold for BNB and sent to the
//             buyback wallet — only the fees, never the capital
//   increase  BNB above the reserve is put into the same position
//
// Every plan* function only reads. Every execute* function signs, and takes
// the plan it was given rather than reading again, so what was printed is
// what gets sent. A chain read that fails throws — an RPC that did not answer
// must never look like a wallet that holds nothing.
import { parseAbi, formatEther, formatUnits, parseEther } from 'viem';
import {
  refuseCollect, refuseSweep, refuseIncrease, refuseRebalance,
  GAS_RESERVE_BNB, MAX_SWEEP_USD, INCREASE_GAS_BUDGET_BNB,
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
    'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
    'function factory() view returns (address)',
  ]),
  FACTORY: parseAbi(['function getPool(address,address,uint24) view returns (address)']),
  POOL: parseAbi([
    'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint32 feeProtocol,bool unlocked)',
    'function tickSpacing() view returns (int24)',
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
    if (price == null) price = await gasPriceNow(pub);
    const hash = req.to
      ? await wallet.sendTransaction({ ...req, gasPrice: price })
      : await wallet.writeContract({ ...req, gasPrice: price });
    txs.push({ label, hash });
    log(`  ${label}: ${hash}`);
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 90000 });
    if (r.status !== 'success') throw new Error(`${label} reverted — stopped before the next step`);
    return r;
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

// --------------------------------------------------------------------------
// collect: fees -> BNB -> buyback wallet
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

// Collect, sell, unwrap, forward — and forward ONLY what this run produced.
// The wallet also holds the capital the sweep delivers for the next increase;
// "everything above the reserve" would have sent that to the buyback bot.
export async function executeCollect(pub, wallet, account, plan, log = () => {}) {
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
  if (forward <= 0n) return { txs, forwarded_bnb: '0', why: 'collected, but nothing net of gas and the reserve to forward' };
  await send('forward to buyback wallet', { to: ADDR.BUYBACK_WALLET, value: forward, gas: 21000n });
  return { txs, forwarded_bnb: formatEther(forward), to: ADDR.BUYBACK_WALLET };
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
// or the same function over KV); its day_pick names the width. `widthOverride`
// is a person's explicit choice from the hand script, and is reported as one.
export async function planRebalance(pub, address, { record = null, widthOverride = null, position = null } = {}) {
  const p = position || (await readPosition(pub, address));
  let poolInfo = null, spacing = null, other = null, wbnbIs0 = false, valueBnb = 0, have = null, target = null, ticks = null, trade = null;
  const width = widthOverride ?? record?.day_pick?.width ?? null;
  const widthBasis = widthOverride != null ? 'named by hand' : (width != null ? `held every tested day over ${record?.hours_of_prices} h of recorded prices` : null);
  if (p.positions === 1) {
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
  const state = { positions: p.positions, inRange: poolInfo ? poolInfo.inRange : false, width, hoursOfPrices: record?.hours_of_prices || 0, valueBnb };
  return {
    step: 'rebalance', state, no: refuseRebalance(state),
    tokenId: p.tokenId, pos: p.pos, poolInfo, spacing, other, wbnbIs0, width, ticks, target, trade,
    summary: {
      position: p.tokenId == null ? null : String(p.tokenId),
      ticks: p.pos ? [Number(p.pos[5]), Number(p.pos[6])] : null,
      tick: poolInfo ? poolInfo.tick : null, in_range: state.inRange,
      value_bnb: Number(valueBnb.toFixed(6)),
      width_pct: width, width_basis: widthBasis,
      new_ticks: ticks ? [ticks.tickLower, ticks.tickUpper] : null,
      trade: trade ? (trade.sell === 'other' ? `sell ${(trade.amount / 1e18).toFixed(6)} of ${other} for WBNB` : `buy the other side with ${(trade.amount / 1e18).toFixed(6)} WBNB`) : null,
    },
  };
}

// Empty the old position, burn its NFT, trade to the new ratio, mint the new
// range from what the wallet then holds. Native BNB is not touched: the
// reserve and any capital waiting for the increase stay where they are.
export async function executeRebalance(pub, wallet, account, plan, log = () => {}) {
  const txs = [];
  const send = sender(pub, wallet, txs, log);
  const liquidity = plan.pos[7];
  const sim = await pub.simulateContract({
    address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'decreaseLiquidity',
    args: [{ tokenId: plan.tokenId, liquidity, amount0Min: 0n, amount1Min: 0n, deadline: deadline() }], account,
  });
  await send('withdraw the old range', { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'decreaseLiquidity',
    args: [{ tokenId: plan.tokenId, liquidity, amount0Min: (sim.result[0] * 99n) / 100n, amount1Min: (sim.result[1] * 99n) / 100n, deadline: deadline() }] });
  await send('collect everything it held', { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'collect',
    args: [{ tokenId: plan.tokenId, recipient: account.address, amount0Max: MAX128, amount1Max: MAX128 }] });
  await send('burn the empty position', { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'burn', args: [plan.tokenId] });

  // Sized from what the wallet really holds now, not from the plan's estimate.
  const haveOther = await read(pub, plan.other, ABI.ERC20, 'balanceOf', [account.address]);
  const haveWbnb = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  const t = plan.target;
  const value = Number(haveWbnb) + Number(haveOther) * t.otherInWbnb;
  const perLValue = t.perLWbnb + t.perLOther * t.otherInWbnb;
  const Ln = (value * 0.99) / perLValue;
  const targetOther = BigInt(Math.floor(Ln * t.perLOther));
  if (haveOther > targetOther) {
    const sell = haveOther - targetOther;
    const q = await read(pub, ADDR.V2_ROUTER, ABI.ROUTER, 'getAmountsOut', [sell, [plan.other, ADDR.WBNB]]);
    await send('approve the excess for sale', { address: plan.other, abi: ABI.ERC20, functionName: 'approve', args: [ADDR.V2_ROUTER, sell] });
    await send('sell the excess of the other side', { address: ADDR.V2_ROUTER, abi: ABI.ROUTER, functionName: 'swapExactTokensForTokens',
      args: [sell, (q[1] * 99n) / 100n, [plan.other, ADDR.WBNB], account.address, deadline()] });
  } else if (targetOther > haveOther) {
    const need = targetOther - haveOther;
    const q = await read(pub, ADDR.V2_ROUTER, ABI.ROUTER, 'getAmountsOut', [10n ** 18n, [ADDR.WBNB, plan.other]]);
    const spend = q[1] > 0n ? (need * 10n ** 18n * 102n) / (q[1] * 100n) : 0n;
    const cap = haveWbnb;
    const wbnbIn = spend > cap ? cap : spend;
    if (wbnbIn > 0n) {
      await send('approve WBNB to the router', { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'approve', args: [ADDR.V2_ROUTER, wbnbIn] });
      await send('buy the missing other side', { address: ADDR.V2_ROUTER, abi: ABI.ROUTER, functionName: 'swapExactTokensForTokens',
        args: [wbnbIn, (need * 99n) / 100n, [ADDR.WBNB, plan.other], account.address, deadline()] });
    }
  }
  const mintOther = await read(pub, plan.other, ABI.ERC20, 'balanceOf', [account.address]);
  const mintWbnb = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  await send('approve the other side to the position manager', { address: plan.other, abi: ABI.ERC20, functionName: 'approve', args: [ADDR.V3_POSITION_MANAGER, mintOther] });
  await send('approve WBNB to the position manager', { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'approve', args: [ADDR.V3_POSITION_MANAGER, mintWbnb] });
  const amount0Desired = plan.wbnbIs0 ? mintWbnb : mintOther;
  const amount1Desired = plan.wbnbIs0 ? mintOther : mintWbnb;
  await send(`mint the new range ${plan.ticks.tickLower} … ${plan.ticks.tickUpper}`, { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'mint',
    args: [{
      token0: plan.pos[2], token1: plan.pos[3], fee: Number(plan.pos[4]),
      tickLower: plan.ticks.tickLower, tickUpper: plan.ticks.tickUpper,
      amount0Desired, amount1Desired,
      amount0Min: (amount0Desired * 90n) / 100n, amount1Min: (amount1Desired * 90n) / 100n,
      recipient: account.address, deadline: deadline(),
    }] });
  const wbnbLeft = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  if (wbnbLeft > 0n) await send('unwrap what was not needed', { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'withdraw', args: [wbnbLeft] });
  const np = await readPosition(pub, account.address);
  return { txs, new_position: np.tokenId == null ? null : String(np.tokenId), new_ticks: [plan.ticks.tickLower, plan.ticks.tickUpper], liquidity_after: np.pos ? String(np.pos[7]) : null };
}

// --------------------------------------------------------------------------
// increase: BNB above the reserve -> more of the same position
// --------------------------------------------------------------------------

export async function planIncrease(pub, address, position = null) {
  const p = position || (await readPosition(pub, address));
  const bal = await pub.getBalance({ address });
  const spendRaw = bal - GAS_RESERVE - parseEther(String(INCREASE_GAS_BUDGET_BNB));
  const spendableBnb = spendRaw > 0n ? bn(spendRaw) : 0;
  let poolInfo = null, split = null, buyOtherRaw = 0n, wbnbRaw = 0n, buyCostRaw = 0n, other = null, wbnbIs0 = false;
  if (p.positions === 1) {
    poolInfo = await readPool(pub, p.pos);
    const token0 = p.pos[2].toLowerCase(), token1 = p.pos[3].toLowerCase();
    wbnbIs0 = token0 === ADDR.WBNB;
    if (!wbnbIs0 && token1 !== ADDR.WBNB) throw new Error('the position is not against WBNB; this agent only knows how to grow it out of BNB');
    other = wbnbIs0 ? token1 : token0;
    if (spendRaw > 0n) {
      const { perL0, perL1 } = splitForRange(poolInfo.sqrtP, Number(p.pos[5]), Number(p.pos[6]));
      const price = poolInfo.sqrtP ** 2;                  // token1 per token0
      const perLOther = wbnbIs0 ? perL1 : perL0;
      const perLWbnb = wbnbIs0 ? perL0 : perL1;
      const otherInWbnb = wbnbIs0 ? 1 / price : price;    // WBNB per unit of the other token
      // Value of one unit of liquidity in WBNB, and the L this much BNB buys,
      // with 2% kept back for the acquisition's headroom.
      const perLValue = perLWbnb + perLOther * otherInWbnb;
      const L = perLValue > 0 ? (Number(spendRaw) * 0.98) / perLValue : 0;
      buyOtherRaw = BigInt(Math.floor(L * perLOther));
      wbnbRaw = BigInt(Math.floor(L * perLWbnb));
      if (buyOtherRaw > 0n) {
        // Priced by the router that will do the swap, not by the pool.
        const q = await read(pub, ADDR.V2_ROUTER, ABI.ROUTER, 'getAmountsOut', [10n ** 18n, [ADDR.WBNB, other]]);
        buyCostRaw = q[1] > 0n ? (buyOtherRaw * 10n ** 18n * 102n) / (q[1] * 100n) : 0n;
      }
      split = { perLOther, perLWbnb, L };
    }
  }
  const state = { positions: p.positions, spendableBnb, inRange: poolInfo ? poolInfo.inRange : false };
  return {
    step: 'increase', state, no: refuseIncrease(state),
    tokenId: p.tokenId, pos: p.pos, other, wbnbIs0, buyOtherRaw, wbnbRaw, buyCostRaw, split,
    summary: {
      wallet_bnb: bn(bal), spendable_bnb: spendableBnb, in_range: state.inRange, tick: poolInfo ? poolInfo.tick : null,
      would_add: spendRaw > 0n && poolInfo ? { other: formatUnits(buyOtherRaw, 18), other_token: other, wbnb: formatEther(wbnbRaw), buying_other_costs_bnb: formatEther(buyCostRaw) } : null,
    },
  };
}

export async function executeIncrease(pub, wallet, account, plan, log = () => {}) {
  const txs = [];
  const send = sender(pub, wallet, txs, log);
  const wrapRaw = plan.wbnbRaw + plan.buyCostRaw;
  await send('wrap', { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'deposit', value: wrapRaw });
  if (plan.buyCostRaw > 0n) {
    await send('approve WBNB to the router', { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'approve', args: [ADDR.V2_ROUTER, plan.buyCostRaw] });
    await send('buy the other side', { address: ADDR.V2_ROUTER, abi: ABI.ROUTER, functionName: 'swapExactTokensForTokens',
      args: [plan.buyCostRaw, (plan.buyOtherRaw * 99n) / 100n, [ADDR.WBNB, plan.other], account.address, deadline()] });
  }
  // Sized from what the wallet really holds, not from what was expected.
  const haveOther = await read(pub, plan.other, ABI.ERC20, 'balanceOf', [account.address]);
  const haveWbnb = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  await send('approve the other side to the position manager', { address: plan.other, abi: ABI.ERC20, functionName: 'approve', args: [ADDR.V3_POSITION_MANAGER, haveOther] });
  await send('approve WBNB to the position manager', { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'approve', args: [ADDR.V3_POSITION_MANAGER, haveWbnb] });
  const amount0Desired = plan.wbnbIs0 ? haveWbnb : haveOther;
  const amount1Desired = plan.wbnbIs0 ? haveOther : haveWbnb;
  // The manager takes only the ratio the range needs. Minimums at 90% are a
  // floor against the price moving between the plan and the mint, not a target.
  await send('increase the position', { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'increaseLiquidity',
    args: [{ tokenId: plan.tokenId, amount0Desired, amount1Desired, amount0Min: (amount0Desired * 90n) / 100n, amount1Min: (amount1Desired * 90n) / 100n, deadline: deadline() }] });
  // What the manager did not take goes back to being capital. The other
  // token's dust is left; tomorrow's collect sells it with the fees.
  const wbnbLeft = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  if (wbnbLeft > 0n) await send('unwrap what was not needed', { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'withdraw', args: [wbnbLeft] });
  const pos = await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'positions', [plan.tokenId]);
  return { txs, liquidity_after: String(pos[7]), other_used: formatUnits(haveOther - (await read(pub, plan.other, ABI.ERC20, 'balanceOf', [account.address])), 18), wbnb_used: formatEther(haveWbnb - wbnbLeft) };
}
