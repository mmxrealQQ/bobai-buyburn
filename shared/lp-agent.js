// The DeFi agent's steps, written once.
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
//             jobs) is sold for BNB and sent to the DeFi wallet
//   collect   the position's fees are collected and sold for BNB; part of it
//             stays as capital (FEE_SHARE_KEPT_PCT, half since 2026-09-04),
//             the rest buys $BOBAI the wallet holds (buyBobaiHold, since
//             2026-09-09; the buyback wallet before) — only the fees, never
//             the capital
//   rebalance a range the price has left is re-set beside the price, on
//             the side the price came from, with the one token the old
//             range ended in and no trade (one-sided, since 2026-09-16);
//             the fees the old range owed are split the same way on the way
//             (since 2026-09-08): the kept share is minted into the new
//             capital, the rest buys $BOBAI before the mint
//   ladder    BNB that arrives while the main range is all of the other side
//             opens a reserve range below the price, WBNB only, no trade
//             (since 2026-09-16); the two merge at the main range's re-set
//   increase  BNB above the reserve is put into the same position — the
//             income the sweep brought and the fee share the collect kept
//
// Every plan* function only reads. Every execute* function signs, and takes
// the plan it was given rather than reading again, so what was printed is
// what gets sent. A chain read that fails throws — an RPC that did not answer
// must never look like a wallet that holds nothing.
import { parseAbi, formatEther, formatUnits, parseEther, encodeFunctionData } from 'viem';
import {
  refuseCollect, refuseSweep, refuseIncrease, refuseRebalance, refuseRelocate, splitFees, resetForward, reserveCollect, widthClassOf, rangeLeft, ONE_SIDED_GAP_TICKS, pickWidth, ladderDecision, ladderHeal, resumeSide,
  GAS_RESERVE_BNB, MAX_SWEEP_USD, INCREASE_GAS_BUDGET_BNB, MIN_INCREASE_BNB, FEE_SHARE_KEPT_PCT, V2_SWAP_FEE_PCT,
  MIN_GAS_BNB,
} from './lp-guards.js';

export const ADDR = {
  V3_POSITION_MANAGER: '0x46a15b0b27311cedf172ab29e4f4766fbe7f4364',
  V2_ROUTER: '0x10ed43c718714eb63d5aa57b78b54704e256024e',
  // PancakeSwap V3 swap router and quoter, verified on chain 2026-09-09: both
  // answer factory() = 0x0bfb…1865 (the factory the positions live in) and
  // WETH9() = WBNB. The re-centring trade goes through the position's own
  // pool (fee tier from positions()[4], 500 = 0.05%) instead of the V2
  // router's 0.25% pool — the same swap for a fifth of the fee (measured
  // 2026-09-09: 0.02 WBNB bought 6.526 CAKE on V3 against 6.501 on V2). The
  // V2 router stays for the sweep and the collect, whose tokens have no V3
  // pool worth the name.
  V3_SWAP_ROUTER: '0x1b81d678ffb9c0263b24a97847620c99d213eb14',
  V3_QUOTER: '0xb048bbc1ee6b733fffcfb9e9cef7375518e25997',
  WBNB: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  // Where collected fees went until 2026-09-09. Nothing in this file sends
  // to it any more; the address stays for the records that name it.
  BUYBACK_WALLET: '0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce',
  // The agent's own profit share buys this and holds it (2026-09-09); it does
  // not go to the buyback wallet any more. BOBAI is a 3% fee-on-transfer token.
  BOBAI: '0x245c386dcfed896f5c346107596141e5edcbffff',
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
  // The same wallet, the other coin (2026-09-24, the operator's go): since
  // e29b14e worker-lp settles standard x402 payments (USDC through Permit2)
  // into this wallet, and a sweep that knew only USD1 left them there.
  {
    key: 'x402-usdc', name: 'x402 service (USDC)', keyEnv: 'X402_PRIVATE_KEY',
    wallet: '0x690E950214980BC329823A2DB2fD90C06Bd54dE4',
    token: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', symbol: 'USDC', decimals: 18,
    earns: 'USDC paid by agents through standard x402, settled by worker-lp',
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
    'function ownerOf(uint256) view returns (address)',
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
    'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable',
  ]),
  V3_ROUTER: parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)']),
  // QuoterV2 answers through a revert it catches itself; as an eth_call it
  // simply returns, so it is declared view here.
  V3_QUOTER: parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) view returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']),
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
// THE BUMP IS PER STEP (2026-09-24, D4 of the review; the operator's go).
// Every transaction paid 1.5x the node's price: 0.075 gwei on a chain that
// clears at 0.05, a third of all the agent's gas, while the buyback bot has
// run at the plain price without a gap. A step that only collects, sells,
// buys or tops up can wait a block and pays the price (bumpTenths 10); a
// re-set or a ladder move, where a half-done sequence leaves the position
// out of the pool, keeps the margin (15). Floor and cap unchanged.
export const GAS_BUMP_PLAIN = 10n;
export const GAS_BUMP_RESET = 15n;
export async function gasPriceNow(pub, bumpTenths = GAS_BUMP_RESET) {
  const g = await pub.getGasPrice().catch(() => null);
  if (g == null) return GAS_PRICE;
  const floor = 50_000_000n, cap = 3_000_000_000n;
  const bumped = (g * BigInt(bumpTenths)) / 10n;
  return bumped < floor ? floor : bumped > cap ? cap : bumped;
}

// One transaction, waited for, refused to continue past a revert. `txs` is
// the caller's list so a failure mid-sequence still reports what was sent.
// Since 2026-09-14 every execute step takes that list from its caller
// instead of making its own: only a throw out of `send` carried it back,
// so a step that sent and then failed on a READ reported no transactions
// at all. The collect of that morning recorded an empty list against a
// collect that had already run on chain.
export function sender(pub, wallet, txs, log = () => {}, bumpTenths = GAS_BUMP_RESET) {
  let price = null;
  const send = async (label, req) => {
    // Whatever throws — a simulation that reverts before sending, a sent
    // transaction that reverts — carries the list of what was sent so far,
    // so a failed run's record still names its transactions and their gas.
    // Without it the two failed runs of 2026-09-05 (7 transactions) counted
    // as none, and the page said "8 transactions so far" against a wallet
    // nonce of 34.
    let sent = false;
    try {
      if (price == null) price = await gasPriceNow(pub, bumpTenths);
      const hash = req.to
        ? await wallet.sendTransaction({ ...req, gasPrice: price })
        : await wallet.writeContract({ ...req, gasPrice: price });
      const entry = { label, hash };
      txs.push(entry);
      log(`  ${label}: ${hash}`);
      sent = true;
      const r = await pub.waitForTransactionReceipt({ hash, timeout: 90000 });
      // What the transaction really cost, so the record can say what a re-set
      // costs in measured BNB rather than in the replay's assumption.
      if (r.gasUsed != null && r.effectiveGasPrice != null) entry.gas_bnb = Number(formatEther(r.gasUsed * r.effectiveGasPrice));
      if (r.status !== 'success') throw new Error(`${label} reverted — stopped before the next step`);
      return r;
    } catch (e) {
      // `sent` tells a caller whether anything left the wallet: a swap refused
      // in the node's estimate cost nothing and may be asked again at a fresh
      // quote; one that was broadcast may not.
      if (e && typeof e === 'object') e.sent = sent;
      if (e && typeof e === 'object' && !e.txs) e.txs = txs;
      throw e;
    }
  };
  // The wallet's owner rides on the sender, so an allowance check knows whom
  // to ask. Until 2026-09-14 each execute step set it by hand and the collect
  // forgot: its first V3 sale asked the allowance of "undefined" and stopped
  // after the collect transaction, the fees left in the wallet unsold.
  send.owner = wallet && wallet.account ? wallet.account.address : undefined;
  return send;
}

// --------------------------------------------------------------------------
// The position
// --------------------------------------------------------------------------

// The position this wallet holds, and what a collect would return right now.
// Asked by simulation, not read off the struct: tokensOwed only updates when
// the position is touched, so an untouched position reads zero there. A
// simulation that fails throws — it is not "nothing owed".
async function readOne(pub, address, tokenId) {
  const pos = await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'positions', [tokenId]);
  let owed0 = 0n, owed1 = 0n;
  if (pos[7] > 0n) {
    const sim = await pub.simulateContract({
      address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'collect',
      args: [{ tokenId, recipient: address, amount0Max: MAX128, amount1Max: MAX128 }], account: address,
    }).catch((e) => { throw new Error(`collect simulation failed: ${e.shortMessage || e.message}`); });
    owed0 = sim.result[0]; owed1 = sim.result[1];
  }
  return { tokenId, pos, owed0, owed1 };
}
// `ladder` (2026-09-16) is the worker's ladder record {main, reserve}: a
// wallet that holds exactly the two positions it names reads as ONE — the
// main range, with the reserve attached as `reserve` — so every step that
// knows one position keeps working on the main one, and the ladder step
// alone handles the reserve. Two positions the record does not name still
// read as two, and every guard refuses as before.
export async function readPosition(pub, address, ladder = null) {
  // BY THE RECORD'S IDS, NOT BY THE COUNT (2026-09-18). Anyone can mint a dust
  // position to this wallet, or send one, for a few cents; counted, it made
  // "3 positions — a decision for a person" and every step refused until a
  // person removed it. The ranges the record names are asked for by id
  // (ownerOf): what else the wallet holds is not the agent's and is not
  // read. A burnt id reverts and reads as not held. Neither held: the count
  // below decides as before, and ladderHeal follows the chain.
  if (ladder && ladder.main != null) {
    const owns = (id) => (id == null ? Promise.resolve(false)
      : read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'ownerOf', [BigInt(id)]).then((o) => String(o).toLowerCase() === String(address).toLowerCase()).catch(() => false));
    const [mainHeld, reserveHeld] = await Promise.all([owns(ladder.main), owns(ladder.reserve)]);
    if (mainHeld) {
      const main = await readOne(pub, address, BigInt(ladder.main));
      if (reserveHeld) return { positions: 1, ...main, reserve: await readOne(pub, address, BigInt(ladder.reserve)), positions_held: 2 };
      return { positions: 1, ...main, positions_held: 1 };
    }
    // The main range is gone, the reserve stands (see below): no main range,
    // the reserve rides along, the re-set is finished from the wallet.
    if (reserveHeld) return { positions: 0, tokenId: null, pos: null, owed0: 0n, owed1: 0n, reserve: await readOne(pub, address, BigInt(ladder.reserve)), positions_held: 1, main_missing: String(ladder.main) };
  }
  const positions = Number(await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'balanceOf', [address]));
  if (positions === 2 && ladder && ladder.reserve != null) {
    const ids = [await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'tokenOfOwnerByIndex', [address, 0n]), await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'tokenOfOwnerByIndex', [address, 1n])];
    const rid = ids.find((i) => String(i) === String(ladder.reserve));
    const mid = ids.find((i) => String(i) !== String(ladder.reserve));
    if (rid != null && mid != null && (ladder.main == null || String(mid) === String(ladder.main))) {
      const main = await readOne(pub, address, mid), reserve = await readOne(pub, address, rid);
      return { positions: 1, ...main, reserve, positions_held: 2 };
    }
  }
  if (positions !== 1) return { positions, tokenId: null, pos: null, owed0: 0n, owed1: 0n };
  const tokenId = await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'tokenOfOwnerByIndex', [address, 0n]);
  // THE MAIN RANGE IS GONE, THE RESERVE STANDS (2026-09-18, read in the code,
  // never seen with money). A re-set burnt the main range and its mint failed:
  // the wallet holds the reserve alone and the main range's capital loose.
  // Read as "the position", the reserve took that capital through the
  // increase step — all of the other side counted as a deposit and sold into
  // the reserve's ratio, at the low. The one position being the reserve the
  // record names (beside a main range it also names) is NOT the main range:
  // the wallet holds no main range, the reserve rides along, and the re-set
  // is finished from the wallet beside it (planRebalance's resume, one-sided
  // — resumeSide). A reserve left with nothing worth minting beside it is
  // closed into the main range by ladderHeal on the next tick.
  if (ladder && ladder.main != null && ladder.reserve != null && String(tokenId) === String(ladder.reserve)) {
    return { positions: 0, tokenId: null, pos: null, owed0: 0n, owed1: 0n, reserve: await readOne(pub, address, tokenId), positions_held: 1, main_missing: String(ladder.main) };
  }
  return { positions, ...(await readOne(pub, address, tokenId)), positions_held: 1 };
}

// The ids of the positions a wallet holds, as strings. A mint is named by the
// id that is there after it and was not before — readPosition alone returns
// no id for a wallet that holds the main range and a reserve (2026-09-17: the
// re-set of 09-16 08:50 minted #7451444 beside reserve #7450613, read "two
// positions", recorded new_position null, and the ladder record kept naming
// the burnt main range — every step refused for a day).
// Bounded: a wallet anyone can send NFTs to is never enumerated past this.
export const HELD_IDS_CAP = 12;
export async function heldIds(pub, address) {
  const n = Math.min(HELD_IDS_CAP, Number(await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'balanceOf', [address])));
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(String(await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'tokenOfOwnerByIndex', [address, BigInt(i)])));
  return ids;
}
// The chain half of ladderHeal (lp-guards.js): what the wallet holds, and
// whether the one position beside the reserve is in the reserve's pool.
// Reads the two positions only when exactly one of the two the record names
// is still held (both held: nothing to heal; neither: the guards decide).
export async function healLadder(pub, address, ladder) {
  if (!ladder || ladder.main == null) return null;
  const held = await heldIds(pub, address);
  if (held.length === 1) {
    if (ladder.reserve == null || held[0] !== String(ladder.reserve)) return null;
    // Only the reserve is left. What lies loose beside it decides: enough to
    // mint is a re-set to finish (no heal), less closes the ladder. A read
    // that fails throws — the caller heals nothing on a guess.
    const pos = await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'positions', [BigInt(held[0])]);
    const wbnbIs0 = pos[2].toLowerCase() === ADDR.WBNB;
    const other = wbnbIs0 ? pos[3] : pos[2];
    const { sqrtP } = await readPool(pub, pos);
    const otherInWbnb = wbnbIs0 ? 1 / (sqrtP ** 2) : sqrtP ** 2;
    const [w, o] = await Promise.all([read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [address]), read(pub, other, ABI.ERC20, 'balanceOf', [address])]);
    return ladderHeal({ main: ladder.main, reserve: ladder.reserve, held, samePool: null, looseBnb: (Number(w) + Number(o) * otherInWbnb) / 1e18 });
  }
  if (held.length !== 2) return null;
  const mainHeld = held.includes(String(ladder.main)), reserveHeld = ladder.reserve != null && held.includes(String(ladder.reserve));
  if (mainHeld === reserveHeld) return null;
  const [a, b] = await Promise.all(held.map((i) => read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'positions', [BigInt(i)])));
  const samePool = a[2].toLowerCase() === b[2].toLowerCase() && a[3].toLowerCase() === b[3].toLowerCase() && Number(a[4]) === Number(b[4]);
  return ladderHeal({ main: ladder.main, reserve: ladder.reserve, held, samePool });
}
// The id a mint made, from the mint's own receipt: the position manager's
// Transfer from the zero address to the owner. Until 2026-09-18 the id was
// the one held after the mint and not before — two enumerations of the
// wallet, which a read behind the chain's head answered with no new id (the
// record then named none) and a wallet stuffed with strangers' NFTs made as
// long as they liked. The enumeration stays as the fallback. Pure.
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export function mintedIn(receipt, owner) {
  for (const l of (receipt && receipt.logs) || []) {
    const t = l.topics || [];
    if (String(l.address).toLowerCase() !== ADDR.V3_POSITION_MANAGER || t.length !== 4 || t[0] !== TRANSFER_TOPIC) continue;
    if (BigInt(t[1]) === 0n && BigInt(t[2]) === BigInt(owner)) return String(BigInt(t[3]));
  }
  return null;
}
async function mintedSince(pub, address, idsBefore) {
  const id = (await heldIds(pub, address)).find((i) => !idsBefore.includes(i));
  if (id == null) return { tokenId: null, pos: null };
  return { tokenId: BigInt(id), pos: await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'positions', [BigInt(id)]) };
}

// What a position holds at a price, in WBNB terms, and which side that is:
// 'other' (all of the other side, the price below the range), 'wbnb' (all
// WBNB, the price above it) or 'both' (inside). Pure.
export function positionSide(pos, sqrtP, wbnbIs0) {
  const L = Number(pos[7]);
  const { perL0, perL1 } = splitForRange(sqrtP, Number(pos[5]), Number(pos[6]));
  const in0 = L * perL0, in1 = L * perL1;
  const price = sqrtP ** 2, otherInWbnb = wbnbIs0 ? 1 / price : price;
  const wbnb = wbnbIs0 ? in0 : in1, other = wbnbIs0 ? in1 : in0;
  const side = other > 0 && wbnb <= 0 ? 'other' : wbnb > 0 && other <= 0 ? 'wbnb' : L > 0 ? 'both' : null;
  return { side, wbnb, other, valueBnb: (wbnb + other * otherInWbnb) / 1e18 };
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

// The trade that leaves the wallet holding the range's own ratio, so the
// mint (or increase) that follows takes everything. Solved, not estimated:
// spend x WBNB on the other side when the other side is short, sell s of
// the other side when it is long, with x and s chosen so that after the
// trade both sides buy the same liquidity —
//   (W - x) / perLWbnb = (C + x·r) / perLOther   ->  x = (W·pO - C·pW) / (pO + r·pW)
//   (W + s·r') / perLWbnb = (C - s) / perLOther  ->  s = (C·pW - W·pO) / (pW + r'·pO)
// where r is what a WBNB buys of the other side (the quoter's rate, fee
// included) and r' what a unit of the other side sells for. Until
// 2026-09-14 the re-set sized the other side at 99% of the capital and
// bought 2% more than that; the WBNB side then bound the mint and 1.6% of
// the capital stayed in the wallet as CAKE, which the increase step put in
// with four more transactions and a second swap fee. The same share at any
// size. An edge of the range (one perL zero) resolves to "all of one side".
// Pure; the self-test pins it.
//
// "All of one side" is the balance itself, never the double nearest to it:
// above 2^53 wei (0.009 of a token) Number(balance) rounds up about every
// second time, and a swap asking for a few hundred wei more than the wallet
// holds reverts ("STF") — after the old range is already burnt (found by
// reading 2026-09-18, before the first re-set upward ever ran).
const capTo = (amount, balance) => { const b = BigInt(balance); return amount > b ? b : amount; };
export function tradeToRatio({ wbnb, other, perLWbnb, perLOther, otherPerWbnb, wbnbPerOther }) {
  const W = Number(wbnb), C = Number(other), pW = perLWbnb, pO = perLOther;
  if (!(pW > 0) && !(pO > 0)) return { side: null, amount: 0n };
  const gap = W * pO - C * pW;
  if (gap > 0) {
    const x = gap / (pO + otherPerWbnb * pW);
    const amount = capTo(BigInt(Math.floor(Math.min(x, W))), wbnb);
    return amount > 0n ? { side: 'buy', amount } : { side: null, amount: 0n };
  }
  if (gap < 0) {
    const s = -gap / (pW + wbnbPerOther * pO);
    const amount = capTo(BigInt(Math.floor(Math.min(s, C))), other);
    return amount > 0n ? { side: 'sell', amount } : { side: null, amount: 0n };
  }
  return { side: null, amount: 0n };
}

// THE PROFIT SHARE OF A RE-SET DOWNWARD (2026-09-18). A range the price fell
// out of paid its fees mostly in the other side, so after the unwind the
// wallet's WBNB is short of the share and the re-set kept all of it as
// capital — the 50/50 rule held on the way up and never on the way down.
// The missing part is sold out of the other side, the token the fees came
// in, the way the collect sells it: `short` WBNB wanted, at `wbnbPerOther`
// (the quoter's rate for one unit, fee in), half a percent over for the
// rounding of rate and impact, never more than the wallet holds. Pure.
export function shareShortfallSale({ short, wbnbPerOtherX18, haveOther }) {
  if (!(short > 0n) || !(wbnbPerOtherX18 > 0n) || !(haveOther > 0n)) return 0n;
  const want = ((short * 10n ** 18n) / wbnbPerOtherX18) * 1005n / 1000n + 1n;
  return want > haveOther ? haveOther : want;
}

// A trade of no size costs a transaction and moves nothing: below this much
// WBNB the wallet is left as it is and the mint takes the ratio it can.
export const TRADE_DUST_WBNB = 10n ** 14n;   // 0.0001 BNB

// --------------------------------------------------------------------------
// collect: fees -> BNB -> part kept as capital, the rest to the buyback wallet
// --------------------------------------------------------------------------

export async function planCollect(pub, address, ladder = null) {
  const { positions, tokenId, pos, owed0, owed1, reserve } = await readPosition(pub, address, ladder);
  const gasBal = await pub.getBalance({ address });
  const token0 = pos ? pos[2].toLowerCase() : null, token1 = pos ? pos[3].toLowerCase() : null;
  const wbnbIs0 = token0 === ADDR.WBNB;
  const other = pos ? (wbnbIs0 ? token1 : token0) : null;
  if (pos && !wbnbIs0 && token1 !== ADDR.WBNB) throw new Error('the position is not against WBNB; this agent only knows how to turn a WBNB pair into BNB');
  const mainOwedWbnb = wbnbIs0 ? owed0 : owed1;
  const mainOwedOther = wbnbIs0 ? owed1 : owed0;
  // The reserve range beside it, when it stands in the same pool: its fees
  // are fees of the same position in two pieces (reserveCollect, lp-guards).
  const beside = !!(pos && reserve && reserve.pos && reserve.pos[2].toLowerCase() === token0 && reserve.pos[3].toLowerCase() === token1 && Number(reserve.pos[4]) === Number(pos[4]));
  const reserveOwedWbnb = beside ? (wbnbIs0 ? reserve.owed0 : reserve.owed1) : 0n;
  const reserveOwedOther = beside ? (wbnbIs0 ? reserve.owed1 : reserve.owed0) : 0n;

  // Tokens the wallet holds OUTSIDE the position — the headroom the mint left
  // over, or what an interrupted run did not finish — are capital, not fees.
  // They are reported here and re-used by the increase and the re-set; the
  // collect sells only what the collect itself returns.
  let heldOther = 0n, heldWbnb = 0n;
  if (pos) {
    heldOther = await read(pub, other, ABI.ERC20, 'balanceOf', [address]);
    heldWbnb = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [address]);
  }
  let otherInBnb = 0n, quoteOffPct = null, poolInfo = null, quoteVia = null;
  if (pos) poolInfo = await readPool(pub, pos);
  const fee = pos ? Number(pos[4]) : null;
  const poolWbnbPerOther = poolInfo ? (wbnbIs0 ? 1 / (poolInfo.sqrtP ** 2) : poolInfo.sqrtP ** 2) : 0;
  const reserveOwedBnb = bn(reserveOwedWbnb) + (Number(reserveOwedOther) / 1e18) * poolWbnbPerOther;
  const withReserve = beside ? reserveCollect(reserveOwedBnb) : { collect: false, why: null };
  const owedWbnb = mainOwedWbnb + (withReserve.collect ? reserveOwedWbnb : 0n);
  const owedOther = mainOwedOther + (withReserve.collect ? reserveOwedOther : 0n);
  if (pos && owedOther > 0n) {
    // The collected other side is sold in the position's own V3 pool (since
    // 2026-09-13; until then through the V2 router, a 0.25% pair, five times
    // the 0.05% the position lives in). The quoter names the proceeds; the
    // V2 router only if the quoter will not answer, and the record says which.
    try {
      otherInBnb = await quoteV3(pub, other, ADDR.WBNB, fee, owedOther);
      quoteVia = 'v3';
    } catch {
      const q = await read(pub, ADDR.V2_ROUTER, ABI.ROUTER, 'getAmountsOut', [owedOther, [other, ADDR.WBNB]]);
      otherInBnb = q[1];
      quoteVia = 'v2';
    }
    // The quote against the pool's own price. A broken quoter or a thin or
    // manipulated V2 pair would show here as a price far from the one the
    // position lives at.
    const quotedWbnbPerOther = Number(otherInBnb) / Number(owedOther);
    quoteOffPct = poolWbnbPerOther > 0 ? ((quotedWbnbPerOther - poolWbnbPerOther) / poolWbnbPerOther) * 100 : null;
  }
  const proceeds = bn(owedWbnb + otherInBnb);
  const state = { positions, liquidity: pos ? pos[7] : 0n, owedBnbEquivalent: proceeds, gasBnb: bn(gasBal), quoteOffPct };
  return {
    step: 'collect', state, no: refuseCollect(state),
    tokenId, pos, other, wbnbIs0, fee, owedWbnb, owedOther, heldOther, heldWbnb, otherInBnb, quoteOffPct, quoteVia,
    reserveTokenId: withReserve.collect ? reserve.tokenId : null,
    summary: {
      position: tokenId == null ? null : String(tokenId),
      ticks: pos ? [Number(pos[5]), Number(pos[6])] : null,
      liquidity: pos ? String(pos[7]) : null,
      in_range: poolInfo ? poolInfo.inRange : null,
      owed: { wbnb: formatEther(owedWbnb), other: formatUnits(owedOther, 18), other_token: other, bnb_equivalent: proceeds },
      ...(beside ? { reserve_owed: { position: String(reserve.tokenId), wbnb: formatEther(reserveOwedWbnb), other: formatUnits(reserveOwedOther, 18), bnb_equivalent: Number(reserveOwedBnb.toFixed(6)), collected_with_it: withReserve.collect, ...(withReserve.why ? { why: withReserve.why } : {}) } } : {}),
      held_outside_position: heldOther > 0n || heldWbnb > 0n ? { wbnb: formatEther(heldWbnb), other: formatUnits(heldOther, 18), note: 'capital, re-used by increase and re-set, not sold here' } : null,
      quote_off_pct: quoteOffPct == null ? null : Number(quoteOffPct.toFixed(2)),
      sells_via: quoteVia == null ? null : (quoteVia === 'v3' ? `the position's own V3 pool (${fee / 1e4}%)` : 'the V2 router (0.25%) — the V3 quoter did not answer'),
      wallet_bnb: state.gasBnb,
    },
  };
}

// Collect, sell, unwrap, split, forward — and forward ONLY what this run
// produced. The wallet also holds the capital the sweep delivers for the next
// increase; "everything above the reserve" would have sent that to the
// buyback bot. `keptPct` of what was produced stays in the wallet as BNB —
// capital for the next increase, so the position grows out of its own fees —
// and the rest goes to the buyback wallet. The record carries both figures.
export async function executeCollect(pub, wallet, account, plan, log = () => {}, { keptPct = FEE_SHARE_KEPT_PCT, txs = [] } = {}) {
  const send = sender(pub, wallet, txs, log, GAS_BUMP_PLAIN);
  send.owner = account.address;
  const before = await pub.getBalance({ address: account.address });
  const otherBefore = await read(pub, plan.other, ABI.ERC20, 'balanceOf', [account.address]);
  // WBNB the wallet already holds is capital that a wrap left behind (a
  // re-set, a reserve mint or an increase that stopped after its wrap), not
  // fees: it is unwrapped below so the increase step finds it as BNB, and it
  // is taken out of what this collect counts as produced (2026-09-18 — until
  // then half of it would have bought $BOBAI, never to come back).
  const wbnbBefore = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  await send('collect', { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'collect',
    args: [{ tokenId: plan.tokenId, recipient: account.address, amount0Max: MAX128, amount1Max: MAX128 }] });
  // The reserve range's fees in the same run, when they are worth a
  // transaction (reserveCollect): sold, split and counted with the rest.
  if (plan.reserveTokenId != null) await send("collect the reserve range's fees", { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'collect',
    args: [{ tokenId: plan.reserveTokenId, recipient: account.address, amount0Max: MAX128, amount1Max: MAX128 }] });
  // Only what the collect returned is sold; what the wallet held before it is
  // capital and stays.
  const otherAfter = await read(pub, plan.other, ABI.ERC20, 'balanceOf', [account.address]);
  const sell = otherAfter > otherBefore ? otherAfter - otherBefore : 0n;
  let swap = null;
  if (sell > 0n && plan.quoteVia === 'v3') {
    // The position's own pool, at its own fee, with the impact measured —
    // the same trade a re-set makes. The V3 router's allowance is set once.
    const q = await quoteV3(pub, plan.other, ADDR.WBNB, plan.fee, sell);
    swap = await swapV3(pub, send, account.address, plan.other, ADDR.WBNB, plan.fee, sell, q, q, 'sell the other side in its own pool');
  } else if (sell > 0n) {
    await send('approve for sale', { address: plan.other, abi: ABI.ERC20, functionName: 'approve', args: [ADDR.V2_ROUTER, sell] });
    // The other side of the home pool keeps nothing of a transfer, so the
    // floor is the trade's alone: 1% under the quote for its exact size (it
    // was 15% until 2026-09-19; this path has never run — the V3 quoter has
    // answered at every collect).
    const q = await read(pub, ADDR.V2_ROUTER, ABI.ROUTER, 'getAmountsOut', [sell, [plan.other, ADDR.WBNB]]);
    await send('sell the other side', { address: ADDR.V2_ROUTER, abi: ABI.ROUTER, functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
      args: [sell, (q[1] * 99n) / 100n, [plan.other, ADDR.WBNB], account.address, deadline()] });
    const n = Number(formatEther(q[1]));
    swap = { side: 'sell', venue: `pancakeswap v2 ${V2_SWAP_FEE_PCT}%`, fee_pct: V2_SWAP_FEE_PCT, notional_bnb: Number(n.toFixed(6)), fee_bnb: Number((n * V2_SWAP_FEE_PCT / 100).toFixed(8)), why: 'the V3 quoter did not answer at plan time' };
  }
  // Everything wrapped is unwrapped: this collect's WBNB is fees, what was
  // there before is capital that goes back to waiting as BNB.
  const wbnbHave = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  if (wbnbHave > 0n) await send('unwrap', { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'withdraw', args: [wbnbHave] });

  const after = await pub.getBalance({ address: account.address });
  const producedRaw = after - before - wbnbBefore;   // net of the gas this run spent, without the capital found wrapped
  const produced = producedRaw > 0n ? producedRaw : 0n;
  const aboveReserve = after - GAS_RESERVE;   // never dip into the reserve
  const forward = produced < aboveReserve ? produced : aboveReserve;
  const found = wbnbBefore > 0n ? { capital_found_wrapped_bnb: formatEther(wbnbBefore), capital_found_note: 'WBNB the wallet held before the collect, a wrap an earlier step left behind: unwrapped here as capital, not counted as fees' } : {};
  if (forward <= 0n) return { txs, swap, ...found, forwarded_bnb: '0', kept_bnb: '0', why: 'collected, but nothing net of gas and the reserve to forward' };
  const split = splitFees(forward, keptPct);
  const out = { txs, swap, ...found, produced_bnb: formatEther(forward), kept_bnb: formatEther(split.keep), kept_pct: split.pct };
  if (split.buyback <= 0n) return { ...out, bobai_bnb: '0', why: `collected ${formatEther(forward)} BNB of fees; all of it stays as capital (kept share ${split.pct}%)` };
  const bought = await buyBobaiHold(pub, send, account.address, split.buyback);
  return { ...out, bobai_bnb: formatEther(bought.spent), bobai_units: formatUnits(bought.units, 18), held_in: account.address };
}

// --------------------------------------------------------------------------
// sweep: AI income -> BNB -> DeFi wallet
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
      capped: balance > capRaw, wallet_bnb: state.gasBnb,
    },
  };
}

// Approve exactly the amount, sell it, and have the router pay the BNB
// straight to the DeFi wallet — one transaction fewer, and the income
// wallet never holds BNB it could be tempted to keep.
export async function executeSweep(pub, wallet, account, plan, log = () => {}, { txs = [] } = {}) {
  const send = sender(pub, wallet, txs, log, GAS_BUMP_PLAIN);
  const before = await pub.getBalance({ address: ADDR.LP_WALLET });
  await send(`approve ${plan.source.symbol}`, { address: plan.source.token, abi: ABI.ERC20, functionName: 'approve', args: [ADDR.V2_ROUTER, plan.amount] });
  // 3% floor: both pairs are deep and both tokens are dollars; the guard has
  // already refused a route that prices them off a dollar.
  await send(`sell ${plan.source.symbol} for BNB to the DeFi wallet`, {
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

// THE ONE-SIDED RANGE (2026-09-16). A position the price has left holds one
// token: all of token0 below its range, all of token1 above it. Until now a
// re-set sold half of it to re-centre — at the low when the price had
// fallen, at the high when it had risen — and twelve such trades cost 3.4%
// of the capital in a fortnight, twice the fees. The new range is placed
// beside the price instead, on the side the price came from, and needs
// exactly the token the old range ended in: below its range the position
// is all token0, and a range above the price is all token0 too; above, all
// token1, and a range below the price is all token1. Nothing is traded;
// the re-set costs its gas. The range spans what a centred ±width range
// spans (the same liquidity for the same money, so the width record's fee
// rows apply to it) and starts ONE_SIDED_GAP_TICKS beyond the price, so a
// few ticks of drift before the block cannot put the price inside it. If
// the price comes back it earns from the first tick and turns the fallen
// side into the other one on the way up, with fees; if it goes on, the
// position holds what it held — no worse than the hold the old rule
// resorted to, and one re-set's gas away from earning again.
// `side` is where the price is relative to the old range (rangeLeft): a
// price below it gets a range above the price, and the other way round.
export function ticksAdjacent(tick, widthPct, spacing, side, gapTicks = ONE_SIDED_GAP_TICKS) {
  const span = Math.round(2 * Math.log(1 + widthPct / 100) / Math.log(1.0001) / spacing) * spacing;
  if (side === 'below') {
    const tickLower = Math.ceil((tick + gapTicks) / spacing) * spacing;
    return { tickLower, tickUpper: tickLower + span, side: 'above_price' };
  }
  const tickUpper = Math.floor((tick - gapTicks) / spacing) * spacing;
  return { tickLower: tickUpper - span, tickUpper, side: 'below_price' };
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
export async function planRebalance(pub, address, { record = null, widthOverride = null, position = null, pool = null, keptPct = FEE_SHARE_KEPT_PCT, ladder = null } = {}) {
  let p = position || (await readPosition(pub, address, ladder));
  let resume = false;
  if (p.positions === 0 && pool) { p = { ...p, pos: await readPoolPair(pub, pool) }; resume = true; }
  let poolInfo = null, spacing = null, other = null, wbnbIs0 = false, valueBnb = 0, have = null, target = null, ticks = null, trade = null;
  let owedWei = 0n, share = null, left = null, oneSided = null;
  // The record's pick, re-read with the width the position is in: a width
  // in use is kept unless another leads it by the bar (pickWidth). Records
  // without weekly rows (before 2026-09-16) keep their own pick.
  const inUse = p.positions === 1 && p.pos ? widthClassOf([Number(p.pos[5]), Number(p.pos[6])]) : null;
  const pick = (Array.isArray(record?.rows) && record.rows.some((r) => r.earnings_7d) && (record.earnings_pick || record.hours_of_prices >= 24) ? pickWidth(record.rows, { current: inUse }) : null) || record?.earnings_pick || null;
  const width = widthOverride ?? pick?.width ?? null;
  const widthBasis = widthOverride != null ? 'named by hand'
    : (pick ? (pick.basis || `netted the most per day over ${record?.hours_of_prices} h of recorded prices: about $${pick.earnings?.net_usd_per_day} a day on $50 after ${pick.earnings?.resets} re-set${pick.earnings?.resets === 1 ? '' : 's'} at $${pick.earnings?.reset_cost_usd} each`) : null);
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
    // Where the price stands to the old range: inside, at an edge, or gone.
    if (!resume) left = rangeLeft(poolInfo.tick, Number(p.pos[5]), Number(p.pos[6]));
    if (width != null) {
      // A range the price has left is re-set one-sided, beside the price
      // (ticksAdjacent); a mint from the wallet (resume) or a range by hand
      // with the price inside is centred as before.
      oneSided = left && left.left ? left.side : null;
      // A resume finishes the re-set it belongs to: a wallet holding one
      // token alone is minted beside the price on that token's side, no
      // trade (resumeSide); a mixed wallet is centred as before.
      if (resume && valueBnb > 0) oneSided = resumeSide((have.other * otherInWbnb) / (valueBnb * 1e18));
      ticks = oneSided ? ticksAdjacent(poolInfo.tick, width, spacing, oneSided) : ticksAround(poolInfo.tick, width, spacing);
      if (ticks.tickUpper <= ticks.tickLower) throw new Error(`a ${width}% range is narrower than this pool's tick spacing (${spacing})`);
      const n = splitForRange(poolInfo.sqrtP, ticks.tickLower, ticks.tickUpper);
      const perLOther = wbnbIs0 ? n.perL1 : n.perL0, perLWbnb = wbnbIs0 ? n.perL0 : n.perL1;
      const perLValue = perLWbnb + perLOther * otherInWbnb;
      const Ln = perLValue > 0 ? (valueBnb * 1e18) / perLValue : 0;
      target = { other: Ln * perLOther, wbnb: Ln * perLWbnb, perLOther, perLWbnb, otherInWbnb };
      // The trade that turns what is held into what the new range needs —
      // the plan's estimate at the pool's mid price; the run sizes it again
      // from the wallet and the quoter (tradeToRange).
      const est = tradeToRatio({ wbnb: have.wbnb, other: have.other, perLWbnb, perLOther, otherPerWbnb: otherInWbnb > 0 ? 1 / otherInWbnb : 0, wbnbPerOther: otherInWbnb });
      trade = est.side === 'sell' ? { sell: 'other', amount: Number(est.amount) }
        : est.side === 'buy' ? { sell: 'wbnb', amount: Number(est.amount) } : null;
    }
  }
  // A wallet without a position is never "in range"; resume says the plan is
  // a mint from what the wallet holds, and the guard sizes it like a re-set.
  const walletBnb = bn(await pub.getBalance({ address }));
  const state = { positions: p.positions, resume, walletBnb, inRange: poolInfo && !resume ? poolInfo.inRange : false, atEdge: !!(left && left.outside && !left.left), side: left ? left.side : null, ticksAway: left ? left.ticks_away : null, width, hoursOfPrices: record?.hours_of_prices || 0, valueBnb };
  return {
    step: 'rebalance', state, no: refuseRebalance(state), resume, oneSided,
    tokenId: p.tokenId, pos: p.pos, poolInfo, spacing, other, wbnbIs0, width, ticks, target, trade,
    summary: {
      position: p.tokenId == null ? null : String(p.tokenId),
      ...(p.main_missing ? { main_missing: p.main_missing } : {}),
      ...(resume ? { resumed_from_wallet: true, held: have ? { other: (have.other / 1e18).toFixed(6), wbnb: (have.wbnb / 1e18).toFixed(6) } : null } : {}),
      ticks: p.tokenId != null ? [Number(p.pos[5]), Number(p.pos[6])] : null,
      tick: poolInfo ? poolInfo.tick : null, in_range: state.inRange, ...(state.atEdge ? { at_edge: true } : {}),
      ...(left && left.outside ? { price_side: left.side, ticks_beyond_edge: left.ticks_away } : {}),
      ...(oneSided ? { one_sided: ticks.side, one_sided_why: `the price is ${oneSided} the old range, which ended all in one token; the new range sits ${ticks.side === 'above_price' ? 'above' : 'below'} the price and takes that token as it is — no trade` } : {}),
      pool: poolInfo ? String(poolInfo.pool).toLowerCase() : null, wbnb_is0: wbnbIs0,
      // The main range and what waits in the wallet; the reserve range of
      // the ladder, when there is one, beside it — the sizing above is the
      // main range's alone, the reserve stays where it is.
      value_bnb: Number(valueBnb.toFixed(6)),
      ...(p.reserve && poolInfo ? { reserve: { position: String(p.reserve.tokenId), ticks: [Number(p.reserve.pos[5]), Number(p.reserve.pos[6])], value_bnb: Number(positionSide(p.reserve.pos, poolInfo.sqrtP, wbnbIs0).valueBnb.toFixed(6)), side: positionSide(p.reserve.pos, poolInfo.sqrtP, wbnbIs0).side }, value_with_reserve_bnb: Number((valueBnb + positionSide(p.reserve.pos, poolInfo.sqrtP, wbnbIs0).valueBnb).toFixed(6)) } : {}),
      width_pct: width, width_basis: widthBasis,
      expected_net_usd_per_day: pick ? pick.earnings.net_usd_per_day : null,
      new_ticks: ticks ? [ticks.tickLower, ticks.tickUpper] : null,
      trade: trade ? (trade.sell === 'other' ? `sell ${(trade.amount / 1e18).toFixed(6)} of ${other} for WBNB` : `buy the other side with ${(trade.amount / 1e18).toFixed(6)} WBNB`) : null,
      fees_owed_bnb: Number((Number(owedWei) / 1e18).toFixed(6)),
      fees_to_bobai_bnb: share ? Number((Number(share.forward) / 1e18).toFixed(6)) : 0,
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
// The re-centring trade, written down: which side, how much in WBNB terms,
// which pool and the fee it paid. The window record charges this on top of
// the gas when it replays the re-sets; without it the replay undercounted a
// re-set by half (2026-09-09).
export function swapNote(side, wbnbWei, fee) {
  const n = Number(formatEther(wbnbWei)), pct = fee / 10000;
  return { side, venue: `pancakeswap v3 ${pct}%`, fee_pct: pct, notional_bnb: Number(n.toFixed(6)), fee_bnb: Number((n * pct / 100).toFixed(8)) };
}

// The one V3 swap the agent makes, as the router's struct. Pure, so the
// self-test can pin every field; sqrtPriceLimitX96 = 0 means "no limit, the
// minimum out is the guard".
export function v3SwapArgs(tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, dl) {
  return { tokenIn, tokenOut, fee, recipient, deadline: dl, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n };
}

// What the position's own pool gives for amountIn, from the quoter.
export async function quoteV3(pub, tokenIn, tokenOut, fee, amountIn) {
  const q = await read(pub, ADDR.V3_QUOTER, ABI.V3_QUOTER, 'quoteExactInputSingle', [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }]);
  return q[0];
}

// Allow, swap, and return the note for the record. notionalWbnb is the
// trade in WBNB terms: what went in when WBNB is sold, what the quote said
// comes out when the other side is.
// Since 2026-09-11 the swap also measures what it lost against the pool's
// mid price: the quoter is asked for a sliver first (a fill too small to
// move the price, the fee already off), that rate times the amount is what
// a trade of no size would have received, and the wallet's balance of the
// out-token before and after says what this one did. The gap is the price
// impact, in WBNB — the piece of a re-set's cost that neither gas nor the
// fee rate names, and the piece that grows with the position. A wallet
// that cannot be read for it records the trade without it, never a guess.
//
// THE FLOOR UNDER A SWAP (2026-09-19). The minimum out guards one thing: the
// price moving between the quote and the block, by itself or pushed by someone
// who saw the transaction. The quote is for the exact size, so the pool's fee
// and the trade's own impact are already in it. Until today the floor was 1%
// below the quote and the $BOBAI buy's 15%. Read off the chain for every swap
// this code has sent: nine pool swaps, eight received the quote to the wei and
// one 0.0057% less; eleven $BOBAI buys, each exactly the 3% the token keeps and
// nothing else. A floor of 1% is room nobody but a sandwich uses. Now 0.3%
// under a pool quote, and the $BOBAI buy as the tax bot sizes its own
// (worker/index.js minOutFor): the 3% off first, then 5% — that pair is thin
// and one other buyer in the block moves it. A floor that close can refuse a
// swap the old one let through; a swap refused in the node's estimate has cost
// nothing, so it is asked once more at a fresh quote (requoteOnce). One that
// was broadcast and reverted is not repeated: the step stops, as before.
export const POOL_SWAP_FLOOR_BPS = 30n;
export const BOBAI_TRANSFER_TAX_BPS = 300n;
export const BOBAI_BUY_ROOM_PCT = 5n;
export function swapFloor(quoted) { return (quoted * (10000n - POOL_SWAP_FLOOR_BPS)) / 10000n; }
export function bobaiBuyFloor(quoted) { return (((quoted * (10000n - BOBAI_TRANSFER_TAX_BPS)) / 10000n) * (100n - BOBAI_BUY_ROOM_PCT)) / 100n; }
export async function requoteOnce(attempt) {
  try { return await attempt(false); } catch (e) {
    if (!e || e.sent !== false) throw e;
    return attempt(true);
  }
}

async function swapV3(pub, send, owner, tokenIn, tokenOut, fee, amountIn, quoted, notionalWbnb, label) {
  await ensureAllowance(pub, send, tokenIn, ADDR.V3_SWAP_ROUTER, amountIn, `allow the V3 router to spend ${tokenIn === ADDR.WBNB ? 'WBNB' : 'the other side'} (once)`);
  let sliver = null, before = null;
  try {
    const tiny = 10n ** 12n;
    sliver = await quoteV3(pub, tokenIn, tokenOut, fee, tiny);
    before = await read(pub, tokenOut, ABI.ERC20, 'balanceOf', [owner]);
  } catch { sliver = null; }
  await requoteOnce(async (again) => {
    const q = again ? await quoteV3(pub, tokenIn, tokenOut, fee, amountIn) : quoted;
    return send(label, { address: ADDR.V3_SWAP_ROUTER, abi: ABI.V3_ROUTER, functionName: 'exactInputSingle', args: [v3SwapArgs(tokenIn, tokenOut, fee, owner, amountIn, swapFloor(q), deadline())] });
  });
  const note = swapNote(tokenIn === ADDR.WBNB ? 'buy' : 'sell', notionalWbnb, fee);
  if (sliver != null && sliver > 0n && before != null) {
    try {
      const after = await read(pub, tokenOut, ABI.ERC20, 'balanceOf', [owner]);
      const received = after > before ? after - before : 0n;
      const atMid = (sliver * amountIn) / 10n ** 12n;
      const gapOut = atMid > received ? atMid - received : 0n;
      // A buy's gap is in the other token; the sliver's own rate turns it into WBNB.
      const gapWbnb = tokenOut === ADDR.WBNB ? Number(gapOut) : (Number(gapOut) * Number(amountIn)) / Number(atMid);
      note.impact_bnb = Number((gapWbnb / 1e18).toFixed(8));
      note.impact_pct = note.notional_bnb > 0 ? Number(((gapWbnb / 1e18) / note.notional_bnb * 100).toFixed(3)) : null;
      note.impact_basis = 'measured: the quoter\'s rate for a sliver times the amount, against what the wallet received';
    } catch { /* the trade stands in the record without its impact */ }
  }
  return note;
}

// The agent's profit share buys BOBAI and holds it in the DeFi wallet,
// never sells it — so the operator sees, in the wallet, exactly what the agent
// earned (2026-09-09: "keep it as BOBAI in its own wallet, then I see what
// really comes in"). It used to send that BNB to the buyback wallet. BOBAI
// takes a 3% transfer tax, so the swap uses the fee-supporting router call and
// the floor takes the tax off the quote first, then 5% (bobaiBuyFloor; it was a
// flat 15% until 2026-09-19). Returns BNB spent and BOBAI held.
async function buyBobaiHold(pub, send, owner, bnbWei) {
  const before = await read(pub, ADDR.BOBAI, ABI.ERC20, 'balanceOf', [owner]);
  await requoteOnce(async () => {
    const q = await read(pub, ADDR.V2_ROUTER, ABI.ROUTER, 'getAmountsOut', [bnbWei, [ADDR.WBNB, ADDR.BOBAI]]);
    return send('buy BOBAI with the profit share and hold it', { address: ADDR.V2_ROUTER, abi: ABI.ROUTER, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens', args: [bobaiBuyFloor(q[1]), [ADDR.WBNB, ADDR.BOBAI], owner, deadline()], value: bnbWei });
  });
  const after = await read(pub, ADDR.BOBAI, ABI.ERC20, 'balanceOf', [owner]);
  return { spent: bnbWei, units: after > before ? after - before : 0n };
}

// What the position holds at today's price plus the two tokens sitting in
// the wallet beside it, in BNB. The re-set plan values the same way; the
// increase records it too since 2026-09-09, because a deposit the watch puts
// in between daily runs is a series point of its own and a point without a
// value read as the capital gone (the −30 $ of 2026-09-09 11:00).
export async function positionValueBnb(pub, address, p, poolInfo) {
  if (!p || p.positions !== 1 || !poolInfo) return null;
  const token0 = p.pos[2].toLowerCase(), token1 = p.pos[3].toLowerCase();
  const wbnbIs0 = token0 === ADDR.WBNB;
  const other = wbnbIs0 ? token1 : token0;
  const L = Number(p.pos[7]);
  const s = splitForRange(poolInfo.sqrtP, Number(p.pos[5]), Number(p.pos[6]));
  const in0 = L * s.perL0, in1 = L * s.perL1;
  const heldOther = Number(await read(pub, other, ABI.ERC20, 'balanceOf', [address]));
  const heldWbnb = Number(await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [address]));
  const price = poolInfo.sqrtP ** 2;
  const otherInWbnb = wbnbIs0 ? 1 / price : price;
  const wbnb = (wbnbIs0 ? in0 : in1) + heldWbnb, oth = (wbnbIs0 ? in1 : in0) + heldOther;
  return Number(((wbnb + oth * otherInWbnb) / 1e18).toFixed(6));
}

// Trade the wallet into the range's ratio (tradeToRatio) from what it really
// holds now, at the quoter's rate for the size that will trade: the rate is
// asked for a unit first, the size solved from it, then asked again for that
// size and solved once more, so the fee and the impact of the trade itself
// are in the amount. `reserved` WBNB (the profit share) is kept out of the
// sizing and never spent. Returns the swap note, or null when nothing traded.
async function tradeToRange(pub, send, owner, other, fee, perLWbnb, perLOther, { reserved = 0n, buyLabel = 'buy the missing other side', sellLabel = 'sell the excess of the other side' } = {}) {
  const haveOther = await read(pub, other, ABI.ERC20, 'balanceOf', [owner]);
  const haveWbnbAll = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [owner]);
  const haveWbnb = haveWbnbAll > reserved ? haveWbnbAll - reserved : 0n;
  const unit = 10n ** 18n;
  const rateBuy = async (amountIn) => { const q = await quoteV3(pub, ADDR.WBNB, other, fee, amountIn); return { q, r: Number(q) / Number(amountIn) }; };
  const rateSell = async (amountIn) => { const q = await quoteV3(pub, other, ADDR.WBNB, fee, amountIn); return { q, r: Number(q) / Number(amountIn) }; };
  const u = await rateBuy(unit);
  const v = u.q > 0n ? await rateSell(u.q) : { q: 0n, r: 0 };
  const args = { wbnb: haveWbnb, other: haveOther, perLWbnb, perLOther, otherPerWbnb: u.r, wbnbPerOther: v.r };
  let t = tradeToRatio(args);
  if (t.side == null) return null;
  // Second pass at the size itself.
  if (t.side === 'buy') {
    const at = await rateBuy(t.amount);
    t = tradeToRatio({ ...args, otherPerWbnb: at.r });
    if (t.side !== 'buy' || t.amount < TRADE_DUST_WBNB) return null;
    const q = await quoteV3(pub, ADDR.WBNB, other, fee, t.amount);
    return swapV3(pub, send, owner, ADDR.WBNB, other, fee, t.amount, q, t.amount, buyLabel);
  }
  const at = await rateSell(t.amount);
  t = tradeToRatio({ ...args, wbnbPerOther: at.r });
  if (t.side !== 'sell') return null;
  const q = await quoteV3(pub, other, ADDR.WBNB, fee, t.amount);
  if (q < TRADE_DUST_WBNB) return null;
  return swapV3(pub, send, owner, other, ADDR.WBNB, fee, t.amount, q, q, sellLabel);
}

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
// The BNB waiting in the wallet above the reserve and the gas budget, wrapped
// so a re-set or a move mints it with the rest. Until 2026-09-10 12:20 UTC a
// re-set forced by a deposit sold the other side down to the ratio and the
// increase a minute later bought it back: two trades, two fees, two price
// impacts on the same capital. Sized like the increase step's own reserve.
async function wrapWaiting(pub, send, address) {
  const bal = await pub.getBalance({ address });
  const spend = bal - parseEther(String(GAS_RESERVE_BNB)) - parseEther(String(INCREASE_GAS_BUDGET_BNB));
  if (spend < parseEther(String(MIN_INCREASE_BNB))) return 0n;
  await send(`wrap ${formatEther(spend)} BNB waiting in the wallet so the new range takes it`, { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'deposit', value: spend });
  return spend;
}

export async function executeRebalance(pub, wallet, account, plan, log = () => {}, { keptPct = FEE_SHARE_KEPT_PCT, wrapFirst = false, txs = [] } = {}) {
  const send = sender(pub, wallet, txs, log, GAS_BUMP_RESET);
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
  const fee = Number(plan.pos[4]);
  if (plan.tokenId != null) {
    // The range the plan names, read by its id — not "the wallet's position":
    // beside a reserve the wallet holds two, that read names none, and the
    // fees the old range owed were folded in uncounted, with no $BOBAI bought
    // for their half (2026-09-17; the re-set of 09-16 08:50 owed 0.000005 BNB).
    const old = await readOne(pub, account.address, plan.tokenId);
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
  // A deposit waiting as BNB joins a centred mint wrapped, and a one-sided
  // mint below the price (all WBNB) the same way; a one-sided mint above the
  // price is all of the other side, and the trade below buys it with the
  // WBNB the wallet then holds — the deposit buys the fallen side at its
  // low instead of idling, which is what a deposit beside a left range is
  // for. Either way the BNB is wrapped first.
  const wrapped = wrapFirst ? await wrapWaiting(pub, send, account.address) : 0n;

  // Sized from what the wallet really holds now, not from the plan's
  // estimate, into the new range's exact ratio (tradeToRange). The buyback
  // share is not capital: it is kept out of the sizing, so the trade leaves
  // it as WBNB for the transfer.
  const t = plan.target;
  swap = await tradeToRange(pub, send, account.address, plan.other, fee, t.perLWbnb, t.perLOther, { reserved });
  // The buyback share of the old range's fees leaves here, before the mint
  // can fold it into the new capital: unwrapped and sent in the same breath.
  // A wallet that holds less WBNB than the share after the trades (a range
  // that ended all on the other side, with the buy capped) keeps it as
  // capital and says so; the mint takes what is there.
  let boughtBobai = 0n, bobaiUnits = 0n, forwardWhy = share ? share.why : null;
  let shareSwap = null;
  if (reserved > 0n) {
    let wbnbNow = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
    if (wbnbNow < reserved) {
      // Short of the share: the fees came in the other side (a re-set
      // downward). Sell that much of it — the share is not capital.
      const haveOther = await read(pub, plan.other, ABI.ERC20, 'balanceOf', [account.address]);
      const unit = await quoteV3(pub, plan.other, ADDR.WBNB, fee, 10n ** 18n).catch(() => 0n);
      const amountIn = shareShortfallSale({ short: reserved - wbnbNow, wbnbPerOtherX18: unit, haveOther });
      if (amountIn > 0n) {
        const q = await quoteV3(pub, plan.other, ADDR.WBNB, fee, amountIn);
        shareSwap = await swapV3(pub, send, account.address, plan.other, ADDR.WBNB, fee, amountIn, q, q, "sell the profit share's part of the old range's fees (they came in the other side)");
        wbnbNow = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
      }
    }
    if (wbnbNow >= reserved) {
      await send("unwrap the profit share of the old range's fees", { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'withdraw', args: [reserved] });
      const bought = await buyBobaiHold(pub, send, account.address, reserved);
      boughtBobai = reserved; bobaiUnits = bought.units;
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
  // A one-sided range is entirely on one side of the price: the manager takes
  // all of the held token and none of the other, and the minimum is 97% of
  // the held token as it is. The drift tolerance of a centred mint would
  // shift the price INTO the range on one side and read the minimum as
  // zero there; a mint the price has entered would then take almost
  // nothing without reverting. Here it reverts instead, and the hour after
  // finishes the re-set from the wallet (resume).
  // A ONE-SIDED RANGE IS PLACED WHERE THE PRICE IS NOW (2026-09-18), not where
  // it was when the plan was read: between the two lie the merge, the unwind,
  // the share's sale and the $BOBAI buy. The plan's ticks start 20-29 ticks
  // from the plan's price; a price that crossed them by now would take the
  // held token only in part — dust liquidity, or a revert with the old range
  // already burnt. Beside the price now it takes all of it, always.
  const poolNow = await readPool(pub, plan.pos);
  const sqrtNow = poolNow.sqrtP;
  if (plan.oneSided && plan.width != null && plan.spacing) plan = { ...plan, ticks: ticksAdjacent(poolNow.tick, plan.width, plan.spacing, plan.oneSided) };
  const mintMins = plan.oneSided
    ? (() => { const a = amountsForRange(sqrtNow, plan.ticks.tickLower, plan.ticks.tickUpper, amount0Desired, amount1Desired); return { amount0Min: (a.amount0 * MIN_SHARE) / 100n, amount1Min: (a.amount1 * MIN_SHARE) / 100n }; })()
    : minsForRange(sqrtNow, plan.ticks.tickLower, plan.ticks.tickUpper, amount0Desired, amount1Desired);
  const idsBeforeMint = await heldIds(pub, account.address);
  const mintReceipt = await send(`mint the new range ${plan.ticks.tickLower} … ${plan.ticks.tickUpper}`, { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'mint',
    args: [{
      token0: plan.pos[2], token1: plan.pos[3], fee: Number(plan.pos[4]),
      tickLower: plan.ticks.tickLower, tickUpper: plan.ticks.tickUpper,
      amount0Desired, amount1Desired,
      ...mintMins,
      recipient: account.address, deadline: deadline(),
    }] });
  const wbnbLeft = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  if (wbnbLeft > 0n) await send('unwrap what was not needed', { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'withdraw', args: [wbnbLeft] });
  const mintedId = mintedIn(mintReceipt, account.address);
  const np = mintedId != null ? { tokenId: BigInt(mintedId), pos: await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'positions', [BigInt(mintedId)]) } : await mintedSince(pub, account.address, idsBeforeMint);
  const gasBnb = txs.reduce((s, t) => s + (t.gas_bnb || 0), 0);
  // fees_folded_bnb is all the old range owed; fees_forwarded_bnb the part of
  // it that went to the buyback wallet; the difference was minted into the
  // new capital. Records before 2026-09-08 carry only the first.
  return { txs, gas_bnb: Number(gasBnb.toFixed(6)), swap, swap_fee_bnb: swap ? swap.fee_bnb : 0, ...(plan.oneSided ? { one_sided: plan.ticks.side } : {}), ...(wrapped > 0n ? { wrapped_waiting_bnb: Number(formatEther(wrapped)) } : {}), ...(shareSwap ? { share_swap: shareSwap } : {}), new_position: np.tokenId == null ? null : String(np.tokenId), new_ticks: [plan.ticks.tickLower, plan.ticks.tickUpper], liquidity_after: np.pos ? String(np.pos[7]) : null,
    ...(folded ? {
      fees_folded: folded, fees_folded_bnb: folded.bnb_equivalent,
      bobai_bnb: Number(formatEther(boughtBobai)), bobai_units: Number(formatUnits(bobaiUnits, 18)), fees_kept_pct: share ? share.pct : null,
      ...(boughtBobai > 0n ? { bobai_held_in: account.address } : { fees_forward_why: forwardWhy }),
    } : {}) };
}

// --------------------------------------------------------------------------
// relocate: the whole position -> another pool of the universe
// --------------------------------------------------------------------------
// A re-set that changes pools. The pool record (worker-agent/lp-pools.js)
// replays the same fifty dollars in every pool the rule allows and its
// switch rule says when the best of them is worth the move; this is the
// move. Everything the position holds, plus what waits beside it, goes:
// withdraw and burn the old range, sell its other side for WBNB in its own
// tier (unless the new pool is the same pair in another tier), buy the new
// pair's other side in the new tier for the share the new range needs, send
// the profit share of the old range's fees into $BOBAI as a re-set does,
// mint in the new pool. The width is the class the position had: the width
// record measures the pool the agent is in, and it starts over on the new
// pool the hour after the move (lp-windows.js drops a record whose pool
// changed), so the first range there is the shape that earned here and the
// record corrects it once it can.
export async function planRelocate(pub, address, { toPool = null, widthOverride = null, keptPct = FEE_SHARE_KEPT_PCT, move = null } = {}) {
  const p = await readPosition(pub, address);
  const to = String(toPool || '').toLowerCase();
  let from = null, target = null, have = null, valueBnb = 0, owedWei = 0n, share = null, ticks = null, tgt = null;
  let width = widthOverride ?? null;
  if (p.positions === 1) {
    const poolInfo = await readPool(pub, p.pos);
    const token0 = p.pos[2].toLowerCase(), token1 = p.pos[3].toLowerCase();
    const wbnbIs0 = token0 === ADDR.WBNB;
    if (!wbnbIs0 && token1 !== ADDR.WBNB) throw new Error('the position is not against WBNB; this agent only knows how to move a WBNB pair');
    const other = wbnbIs0 ? token1 : token0;
    const L = Number(p.pos[7]);
    const sp = splitForRange(poolInfo.sqrtP, Number(p.pos[5]), Number(p.pos[6]));
    const in0 = L * sp.perL0, in1 = L * sp.perL1;
    const heldOther = Number(await read(pub, other, ABI.ERC20, 'balanceOf', [address]));
    const heldWbnb = Number(await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [address]));
    const price = poolInfo.sqrtP ** 2;
    const otherInWbnb = wbnbIs0 ? 1 / price : price;
    have = { other: (wbnbIs0 ? in1 : in0) + heldOther, wbnb: (wbnbIs0 ? in0 : in1) + heldWbnb };
    valueBnb = (have.wbnb + have.other * otherInWbnb) / 1e18;
    if (width == null) width = widthClassOf([Number(p.pos[5]), Number(p.pos[6])]);
    if (p.owed0 != null) {
      const owedWbnb = wbnbIs0 ? p.owed0 : p.owed1, owedOther = wbnbIs0 ? p.owed1 : p.owed0;
      owedWei = owedWbnb + BigInt(Math.floor(Number(owedOther) * otherInWbnb));
      share = resetForward(owedWei, keptPct);
    }
    from = { pool: String(poolInfo.pool).toLowerCase(), other, fee: Number(p.pos[4]), wbnbIs0, tokenId: p.tokenId, tick: poolInfo.tick, inRange: poolInfo.inRange, otherInWbnb, ticks: [Number(p.pos[5]), Number(p.pos[6])] };
  }
  if (/^0x[0-9a-f]{40}$/.test(to)) {
    const pair = await readPoolPair(pub, to);
    const t0 = String(pair[2]).toLowerCase(), t1 = String(pair[3]).toLowerCase();
    const wbnbIs0 = t0 === ADDR.WBNB;
    const hasWbnb = wbnbIs0 || t1 === ADDR.WBNB;
    const spacing = Number(await read(pub, to, ABI.POOL, 'tickSpacing')) || 1;
    const s0 = await read(pub, to, ABI.POOL, 'slot0');
    const sqrtP = Number(s0[0]) / 2 ** 96, tick = Number(s0[1]);
    const price = sqrtP ** 2;
    const otherInWbnb = wbnbIs0 ? 1 / price : price;
    target = { pool: to, pair, token0: pair[2], token1: pair[3], fee: Number(pair[4]), other: wbnbIs0 ? t1 : t0, wbnbIs0, hasWbnb, spacing, sqrtP, tick, otherInWbnb };
    if (hasWbnb && width != null && valueBnb > 0) {
      ticks = ticksAround(tick, width, spacing);
      if (ticks.tickUpper <= ticks.tickLower) throw new Error(`a ${width}% range is narrower than this pool's tick spacing (${spacing})`);
      const n = splitForRange(sqrtP, ticks.tickLower, ticks.tickUpper);
      const perLOther = wbnbIs0 ? n.perL1 : n.perL0, perLWbnb = wbnbIs0 ? n.perL0 : n.perL1;
      const perLValue = perLWbnb + perLOther * otherInWbnb;
      const capital = valueBnb * 1e18 - (share ? Number(share.forward) : 0);
      const Ln = perLValue > 0 ? capital / perLValue : 0;
      tgt = { other: Ln * perLOther, wbnb: Ln * perLWbnb, perLOther, perLWbnb, otherInWbnb };
    }
  }
  const sameOther = !!(from && target && from.other === target.other);
  const state = {
    positions: p.positions, hasTarget: !!target, targetHasWbnb: target ? target.hasWbnb : false,
    samePool: !!(from && target && from.pool === target.pool), toPool: target ? target.pool : null, width, valueBnb, move,
  };
  const trades = [];
  if (from && target && tgt) {
    if (!sameOther && have.other > 0) trades.push(`sell all ${(have.other / 1e18).toFixed(6)} of ${from.other} for WBNB in the old pool`);
    const keep = sameOther ? have.other : 0;
    if (tgt.other > keep) trades.push(`buy ${((tgt.other - keep) / 1e18).toFixed(6)} of ${target.other} with ~${(((tgt.other - keep) * tgt.otherInWbnb) / 1e18).toFixed(6)} WBNB in the new pool`);
    else if (keep > tgt.other) trades.push(`sell ${((keep - tgt.other) / 1e18).toFixed(6)} of ${target.other} for WBNB in the new pool`);
  }
  return {
    step: 'relocate', state, no: refuseRelocate(state),
    tokenId: p.tokenId, pos: p.pos, from, to: target, width, ticks, target: tgt, sameOther, share,
    summary: {
      position: p.tokenId == null ? null : String(p.tokenId),
      from_pool: from ? from.pool : null, from_ticks: from ? from.ticks : null, in_range: from ? from.inRange : false,
      to_pool: target ? target.pool : null, to_fee_pct: target ? target.fee / 10000 : null, to_tick: target ? target.tick : null,
      value_bnb: Number(valueBnb.toFixed(6)),
      width_pct: width, width_basis: widthOverride != null ? 'named by hand' : 'the class the position had; the width record starts over on the new pool',
      new_ticks: ticks ? [ticks.tickLower, ticks.tickUpper] : null,
      trades: trades.length ? trades : null,
      fees_owed_bnb: Number((Number(owedWei) / 1e18).toFixed(6)),
      fees_to_bobai_bnb: share ? Number((Number(share.forward) / 1e18).toFixed(6)) : 0,
      fees_kept_pct: share ? share.pct : null,
      ...(move ? { move: move.move, move_why: move.why } : {}),
    },
  };
}

export async function executeRelocate(pub, wallet, account, plan, log = () => {}, { keptPct = FEE_SHARE_KEPT_PCT, wrapFirst = true, txs = [] } = {}) {
  if (!plan.from || !plan.to || !plan.target || !plan.ticks) throw new Error('the plan carries no move');
  const send = sender(pub, wallet, txs, log, GAS_BUMP_RESET);
  send.owner = account.address;
  const swaps = [];
  // 1. What the old range owes, read now, so the record counts it as fees
  //    and the profit share of it can leave before the mint.
  const old = await readPosition(pub, account.address);
  if (old.tokenId == null || String(old.tokenId) !== String(plan.tokenId)) throw new Error('the position changed since the plan was made');
  const owedWbnb = plan.from.wbnbIs0 ? old.owed0 : old.owed1, owedOther = plan.from.wbnbIs0 ? old.owed1 : old.owed0;
  const owedWei = owedWbnb + BigInt(Math.floor(Number(owedOther) * plan.from.otherInWbnb));
  const folded = { wbnb: formatEther(owedWbnb), other: formatUnits(owedOther, 18), bnb_equivalent: Number((Number(owedWei) / 1e18).toFixed(6)) };
  const share = resetForward(owedWei, keptPct);
  const reserved = share.forward > 0n ? share.forward : 0n;
  // 2. Withdraw, collect and burn the old range, one transaction.
  {
    const liquidity = plan.pos[7];
    const sim = await pub.simulateContract({
      address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'decreaseLiquidity',
      args: [{ tokenId: plan.tokenId, liquidity, amount0Min: 0n, amount1Min: 0n, deadline: deadline() }], account,
    });
    const calls = unwindCalls(plan.tokenId, liquidity, (sim.result[0] * 99n) / 100n, (sim.result[1] * 99n) / 100n, account.address, deadline());
    await pub.simulateContract({ address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'multicall', args: [calls], account });
    await send('withdraw, collect and burn the old range (one transaction)', { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'multicall', args: [calls] });
  }
  const wrapped = wrapFirst ? await wrapWaiting(pub, send, account.address) : 0n;
  // 3. Leave the old pair: its other side becomes WBNB in the old tier.
  if (!plan.sameOther) {
    const haveOld = await read(pub, plan.from.other, ABI.ERC20, 'balanceOf', [account.address]);
    if (haveOld > 0n) {
      const q = await quoteV3(pub, plan.from.other, ADDR.WBNB, plan.from.fee, haveOld);
      swaps.push(await swapV3(pub, send, account.address, plan.from.other, ADDR.WBNB, plan.from.fee, haveOld, q, q, 'leave the old pair: sell its other side for WBNB'));
    }
  }
  // 4. Size the new range from what the wallet really holds now; the
  //    profit share is kept out of the sizing so it stays as WBNB.
  const t = plan.target, fee = plan.to.fee, other = plan.to.other;
  const entry = await tradeToRange(pub, send, account.address, other, fee, t.perLWbnb, t.perLOther, { reserved, buyLabel: 'enter the new pair: buy its other side', sellLabel: 'sell the excess of the new other side' });
  if (entry) swaps.push(entry);
  // 5. The profit share of the old range's fees becomes $BOBAI, held.
  let boughtBobai = 0n, bobaiUnits = 0n, forwardWhy = share.why;
  if (reserved > 0n) {
    const wbnbNow = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
    if (wbnbNow >= reserved) {
      await send("unwrap the profit share of the old range's fees", { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'withdraw', args: [reserved] });
      const bought = await buyBobaiHold(pub, send, account.address, reserved);
      boughtBobai = reserved; bobaiUnits = bought.units;
    } else {
      forwardWhy = `the wallet held ${formatEther(wbnbNow)} WBNB after the trades, less than the ${formatEther(reserved)} BNB share — it stays as capital`;
    }
  }
  // 6. Mint in the new pool.
  const mintOther = await read(pub, other, ABI.ERC20, 'balanceOf', [account.address]);
  const mintWbnb = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  await ensureAllowance(pub, send, other, ADDR.V3_POSITION_MANAGER, mintOther, 'allow the position manager to take the new other side (once)');
  await ensureAllowance(pub, send, ADDR.WBNB, ADDR.V3_POSITION_MANAGER, mintWbnb, 'allow the position manager to take WBNB (once)');
  const amount0Desired = plan.to.wbnbIs0 ? mintWbnb : mintOther;
  const amount1Desired = plan.to.wbnbIs0 ? mintOther : mintWbnb;
  const now = await readPool(pub, plan.to.pair);
  const mintMins = minsForRange(now.sqrtP, plan.ticks.tickLower, plan.ticks.tickUpper, amount0Desired, amount1Desired);
  await send(`mint the range ${plan.ticks.tickLower} … ${plan.ticks.tickUpper} in the new pool`, { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'mint',
    args: [{
      token0: plan.to.token0, token1: plan.to.token1, fee,
      tickLower: plan.ticks.tickLower, tickUpper: plan.ticks.tickUpper,
      amount0Desired, amount1Desired,
      ...mintMins,
      recipient: account.address, deadline: deadline(),
    }] });
  const wbnbLeft = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
  if (wbnbLeft > 0n) await send('unwrap what was not needed', { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'withdraw', args: [wbnbLeft] });
  const np = await readPosition(pub, account.address);
  const gasBnb = txs.reduce((a, x) => a + (x.gas_bnb || 0), 0);
  const swapFee = swaps.reduce((a, x) => a + (x && x.fee_bnb ? x.fee_bnb : 0), 0);
  return {
    txs, gas_bnb: Number(gasBnb.toFixed(6)), swaps, swap_fee_bnb: Number(swapFee.toFixed(6)), ...(wrapped > 0n ? { wrapped_waiting_bnb: Number(formatEther(wrapped)) } : {}),
    new_position: np.tokenId == null ? null : String(np.tokenId), new_pool: plan.to.pool, new_ticks: [plan.ticks.tickLower, plan.ticks.tickUpper],
    liquidity_after: np.pos ? String(np.pos[7]) : null,
    fees_folded: folded, fees_folded_bnb: folded.bnb_equivalent,
    bobai_bnb: Number(formatEther(boughtBobai)), bobai_units: Number(formatUnits(bobaiUnits, 18)), fees_kept_pct: share.pct,
    ...(boughtBobai > 0n ? { bobai_held_in: account.address } : { fees_forward_why: forwardWhy }),
  };
}

// --------------------------------------------------------------------------
// increase: BNB above the reserve -> more of the same position
// --------------------------------------------------------------------------

export async function planIncrease(pub, address, position = null, ladder = null) {
  const p = position || (await readPosition(pub, address, ladder));
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
    // The L this much capital buys and the trade into the range's ratio
    // (tradeToRatio, at the pool's mid price here; the run asks the quoter).
    const perLValue = perLWbnb + perLOther * otherInWbnb;
    const L = perLValue > 0 ? capital / perLValue : 0;
    const est = tradeToRatio({ wbnb: nativeRaw + heldWbnb, other: heldOther, perLWbnb, perLOther, otherPerWbnb: otherInWbnb > 0 ? 1 / otherInWbnb : 0, wbnbPerOther: otherInWbnb });
    if (est.side === 'buy') {
      buyCostRaw = est.amount;
      buyOtherRaw = BigInt(Math.floor(Number(est.amount) / otherInWbnb));
    } else if (est.side === 'sell') {
      sellOtherRaw = est.amount;
    }
    target = { perLOther, perLWbnb, otherInWbnb, L };
  }
  const spendableBnb = poolInfo ? bn(nativeRaw + heldWbnb) + heldOtherInWbnb / 1e18 : bn(nativeRaw);
  // A range that lies entirely below the price holds only WBNB: BNB joins
  // it as it is (refuseIncrease, wbnbOnly). The reserve range of the ladder
  // is counted in the value the record shows, never in what this step adds.
  const side = poolInfo ? positionSide(p.pos, poolInfo.sqrtP, wbnbIs0).side : null;
  const reserveValue = poolInfo && p.reserve ? positionSide(p.reserve.pos, poolInfo.sqrtP, wbnbIs0).valueBnb : 0;
  const state = { positions: p.positions, spendableBnb, inRange: poolInfo ? poolInfo.inRange : false, wbnbOnly: side === 'wbnb' };
  return {
    step: 'increase', state, no: refuseIncrease(state),
    tokenId: p.tokenId, pos: p.pos, reserve: p.reserve || null, other, wbnbIs0, nativeRaw, heldWbnb, heldOther, buyOtherRaw, sellOtherRaw, buyCostRaw, target,
    summary: {
      position: p.tokenId == null ? null : String(p.tokenId),
      value_bnb: poolInfo ? Number(((await positionValueBnb(pub, address, p, poolInfo)) + reserveValue).toFixed(6)) : null,
      ...(p.reserve && poolInfo ? { reserve: { position: String(p.reserve.tokenId), ticks: [Number(p.reserve.pos[5]), Number(p.reserve.pos[6])], value_bnb: Number(reserveValue.toFixed(6)), side: positionSide(p.reserve.pos, poolInfo.sqrtP, wbnbIs0).side } } : {}),
      side, wallet_bnb: bn(bal), spendable_bnb: spendableBnb, in_range: state.inRange, tick: poolInfo ? poolInfo.tick : null, pool: poolInfo ? String(poolInfo.pool).toLowerCase() : null,
      capital: poolInfo ? { bnb_above_reserve: bn(nativeRaw), wbnb_held: bn(heldWbnb), other_held: formatUnits(heldOther, 18), other_held_in_bnb: Number((heldOtherInWbnb / 1e18).toFixed(6)) } : null,
      would_add: poolInfo && target && target.L > 0 ? {
        other: formatUnits(BigInt(Math.floor(target.L * target.perLOther)), 18), other_token: other, wbnb: formatEther(BigInt(Math.floor(target.L * target.perLWbnb))),
        ...(buyOtherRaw > 0n ? { buying_other: formatUnits(buyOtherRaw, 18), buying_other_costs_bnb: formatEther(buyCostRaw) } : {}),
        ...(sellOtherRaw > 0n ? { selling_other: formatUnits(sellOtherRaw, 18) } : {}),
      } : null,
    },
  };
}

export async function executeIncrease(pub, wallet, account, plan, log = () => {}, { txs = [] } = {}) {
  const send = sender(pub, wallet, txs, log, GAS_BUMP_PLAIN);
  send.owner = account.address;
  const before = await pub.getBalance({ address: account.address });
  // 1. BNB above the reserve becomes WBNB. Nothing to wrap when the capital
  //    is only what was already held beside the position.
  if (plan.nativeRaw > 0n) await send('wrap', { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'deposit', value: plan.nativeRaw });
  // 2. Trade to the range's ratio, the way the re-set does: buy the other
  //    side that is missing, or sell what exceeds it. Sized from what the
  //    wallet really holds now, at the price now.
  const t = plan.target;
  const fee = Number(plan.pos[4]);
  const swap = await tradeToRange(pub, send, account.address, plan.other, fee, t.perLWbnb, t.perLOther);
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
  // A range entirely on one side of the price (a buy ladder below it) takes
  // all of the held token; the minimum is 97% of that, read at the price
  // now — the drift tolerance of a two-sided increase would read zero there
  // (see the one-sided mint in executeRebalance).
  const sqrtInc = (await readPool(pub, plan.pos)).sqrtP;
  const oneSide = positionSide(plan.pos, sqrtInc, plan.wbnbIs0).side;
  const mins = oneSide === 'wbnb' || oneSide === 'other'
    ? (() => { const a = amountsForRange(sqrtInc, Number(plan.pos[5]), Number(plan.pos[6]), amount0Desired, amount1Desired); return { amount0Min: (a.amount0 * MIN_SHARE) / 100n, amount1Min: (a.amount1 * MIN_SHARE) / 100n }; })()
    : minsForRange(sqrtInc, Number(plan.pos[5]), Number(plan.pos[6]), amount0Desired, amount1Desired);
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
  const poolAfter = await readPool(pub, pos);
  const reserveAfter = plan.reserve ? positionSide(await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'positions', [plan.reserve.tokenId]), poolAfter.sqrtP, plan.wbnbIs0).valueBnb : 0;
  const valueAfter = await positionValueBnb(pub, account.address, { positions: 1, tokenId: plan.tokenId, pos }, poolAfter).then((v) => (v == null ? null : Number((v + reserveAfter).toFixed(6)))).catch(() => null);
  return { txs, swap, swap_fee_bnb: swap ? swap.fee_bnb : 0, liquidity_after: String(pos[7]), value_after_bnb: valueAfter, other_used: formatUnits(haveOther - (await read(pub, plan.other, ABI.ERC20, 'balanceOf', [account.address])), 18), wbnb_used: formatEther(haveWbnb - wbnbLeft), bnb_spent: formatEther(before > after ? before - after : 0n) };
}

// --------------------------------------------------------------------------
// ladder: BNB that waits beside a sell ladder opens a buy ladder (2026-09-16)
// --------------------------------------------------------------------------
// See ladderDecision in lp-guards.js for the rule. The plan reads the main
// range (and the reserve, when the ladder record names one), decides, and
// sizes: a reserve is minted or grown from the BNB above the reserve and
// the gas budget, as WBNB, into a range beside the price on its lower side
// (ticksAdjacent with the price "above" it), in the width the record picks
// — the same shape the main range would take there. Nothing is traded in
// this step, ever. A merge is not done here: the reserve is unwound at the
// main range's next re-set (worker-lp), whose mint takes the wallet's
// tokens with it.
export async function planLadder(pub, address, { record = null, ladder = null, position = null, widthOverride = null } = {}) {
  const p = position || (await readPosition(pub, address, ladder));
  const bal = await pub.getBalance({ address });
  const spendRaw0 = bal - GAS_RESERVE - parseEther(String(INCREASE_GAS_BUDGET_BNB));
  const spendRaw = spendRaw0 > 0n ? spendRaw0 : 0n;
  // WBNB a stopped run left wrapped (the wrap went through, the mint after it
  // did not) waits for the ladder like native BNB does. Until 2026-09-18 only
  // native BNB counted: the wrapped deposit read as "only 0.00… BNB waits",
  // the increase refused it beside a main range that is all of the other
  // side, and it stood still until the next deposit or re-set.
  const heldWbnb = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [address]);
  let poolInfo = null, spacing = null, wbnbIs0 = false, mainSide = null, reserveSide = null, reserveLeft = false, ticks = null, width = null, reserveInfo = null, reserveBnb = null;
  if (p.positions === 1 && p.pos) {
    poolInfo = await readPool(pub, p.pos);
    wbnbIs0 = p.pos[2].toLowerCase() === ADDR.WBNB;
    spacing = Number(await read(pub, poolInfo.pool, ABI.POOL, 'tickSpacing')) || 1;
    mainSide = positionSide(p.pos, poolInfo.sqrtP, wbnbIs0).side;
    if (p.reserve) {
      const rs = positionSide(p.reserve.pos, poolInfo.sqrtP, wbnbIs0);
      reserveSide = rs.side; reserveBnb = rs.valueBnb;
      const lf = rangeLeft(poolInfo.tick, Number(p.reserve.pos[5]), Number(p.reserve.pos[6]));
      reserveLeft = lf.left;
      reserveInfo = { position: String(p.reserve.tokenId), ticks: [Number(p.reserve.pos[5]), Number(p.reserve.pos[6])], side: reserveSide, value_bnb: Number(rs.valueBnb.toFixed(6)), left: lf.left, ticks_beyond_edge: lf.ticks_away };
    }
    // The same pick the main range's plan makes, with the width the main
    // range is in as the one in use (until 2026-09-18 the ladder picked
    // without it: the reserve took ±10% beside a main range kept at ±7%).
    const inUse = widthClassOf([Number(p.pos[5]), Number(p.pos[6])]);
    const pick = (Array.isArray(record?.rows) && record.rows.some((r) => r.earnings_7d) && (record.earnings_pick || record.hours_of_prices >= 24) ? pickWidth(record.rows, { current: inUse }) : null) || record?.earnings_pick || null;
    width = widthOverride ?? pick?.width ?? null;
    // A range below the price: the price is "above" it (ticksAdjacent's side).
    if (width != null) ticks = ticksAdjacent(poolInfo.tick, width, spacing, 'above');
  }
  const positionsHeld = p.positions === 1 ? (p.reserve ? 2 : 1) : p.positions;
  const decision = ladderDecision({ positions: positionsHeld, reserve: !!p.reserve, mainSide, reserveSide, spendableBnb: bn(spendRaw + heldWbnb), reserveLeft, reserveBnb });
  let no = null;
  if (decision.act && decision.act !== 'merge' && !(bn(bal) >= MIN_GAS_BNB)) no = `the wallet holds ${bn(bal).toFixed(6)} BNB, below the ${MIN_GAS_BNB} BNB it takes to be sure of paying the step through`;
  else if (decision.act && (decision.act === 'mint_reserve' || decision.act === 'reset_reserve') && (width == null || !ticks)) no = 'the width record names no width yet — the reserve range waits for a day of prices';
  return {
    step: 'ladder', act: decision.act, why: decision.why, no,
    tokenId: p.tokenId, pos: p.pos, reserve: p.reserve || null, poolInfo, spacing, wbnbIs0, spendRaw, heldWbnb, ticks, width,
    summary: {
      position: p.tokenId == null ? null : String(p.tokenId), positions_held: positionsHeld,
      tick: poolInfo ? poolInfo.tick : null, main_side: mainSide, main_ticks: p.pos ? [Number(p.pos[5]), Number(p.pos[6])] : null,
      reserve: reserveInfo, wallet_bnb: bn(bal), spendable_bnb: bn(spendRaw + heldWbnb), ...(heldWbnb > 0n ? { wbnb_held: bn(heldWbnb) } : {}),
      act: decision.act, width_pct: width,
      new_reserve_ticks: ticks && (decision.act === 'mint_reserve' || decision.act === 'reset_reserve') ? [ticks.tickLower, ticks.tickUpper] : null,
    },
  };
}

// The ladder's transactions. mint_reserve: wrap, allow once, mint the WBNB
// range below the price; the new token id is the one the wallet did not
// hold before. increase_reserve: wrap, add the WBNB to the reserve.
// reset_reserve: unwind the reserve (its WBNB and fees come back to the
// wallet), mint the WBNB again beside the price. merge: unwind the reserve
// alone — the caller re-sets the main range next and that mint takes what
// came back. No trade in any of them.
export async function executeLadder(pub, wallet, account, plan, log = () => {}, { txs = [] } = {}) {
  const send = sender(pub, wallet, txs, log, GAS_BUMP_RESET);
  send.owner = account.address;
  const before = await pub.getBalance({ address: account.address });
  const held = () => heldIds(pub, account.address);
  const gasOf = () => Number(txs.reduce((s, t) => s + (t.gas_bnb || 0), 0).toFixed(6));
  const mintReserve = async (label) => {
    const wbnb = await read(pub, ADDR.WBNB, ABI.ERC20, 'balanceOf', [account.address]);
    if (wbnb <= 0n) throw new Error('no WBNB to mint the reserve range from');
    await ensureAllowance(pub, send, ADDR.WBNB, ADDR.V3_POSITION_MANAGER, wbnb, 'allow the position manager to take WBNB (once)');
    const amount0Desired = plan.wbnbIs0 ? wbnb : 0n, amount1Desired = plan.wbnbIs0 ? 0n : wbnb;
    // Placed beside the price as it is now, not as the plan read it (see
    // executeRebalance): the wrap or the unwind lies in between.
    const poolNow = await readPool(pub, plan.pos);
    const sqrtNow = poolNow.sqrtP;
    if (plan.width != null && plan.spacing) plan = { ...plan, ticks: ticksAdjacent(poolNow.tick, plan.width, plan.spacing, 'above') };
    const a = amountsForRange(sqrtNow, plan.ticks.tickLower, plan.ticks.tickUpper, amount0Desired, amount1Desired);
    const idsBefore = await held();
    const receipt = await send(label, { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'mint',
      args: [{ token0: plan.pos[2], token1: plan.pos[3], fee: Number(plan.pos[4]), tickLower: plan.ticks.tickLower, tickUpper: plan.ticks.tickUpper,
        amount0Desired, amount1Desired, amount0Min: (a.amount0 * MIN_SHARE) / 100n, amount1Min: (a.amount1 * MIN_SHARE) / 100n, recipient: account.address, deadline: deadline() }] });
    const fromReceipt = mintedIn(receipt, account.address);
    if (fromReceipt != null) return fromReceipt;
    const idsAfter = await held();
    return idsAfter.find((i) => !idsBefore.includes(i)) || null;
  };
  const unwindReserve = async () => {
    const r = plan.reserve;
    const sim = await pub.simulateContract({ address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'decreaseLiquidity', args: [{ tokenId: r.tokenId, liquidity: r.pos[7], amount0Min: 0n, amount1Min: 0n, deadline: deadline() }], account });
    const calls = unwindCalls(r.tokenId, r.pos[7], (sim.result[0] * 99n) / 100n, (sim.result[1] * 99n) / 100n, account.address, deadline());
    await pub.simulateContract({ address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'multicall', args: [calls], account });
    await send('withdraw, collect and burn the reserve range (one transaction)', { address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'multicall', args: [calls] });
    const owedWbnb = plan.wbnbIs0 ? r.owed0 : r.owed1, owedOther = plan.wbnbIs0 ? r.owed1 : r.owed0;
    // What they were worth, so the fee sum can count them (lp-flow): the
    // collect step takes the reserve's fees since 2026-09-19, what is left
    // here is under its floor and stays as capital — counted, not shared.
    let worth = null;
    try { const pool = await readPool(pub, r.pos); const perOther = plan.wbnbIs0 ? 1 / (pool.sqrtP ** 2) : pool.sqrtP ** 2; worth = Number((bn(owedWbnb) + (Number(owedOther) / 1e18) * perOther).toFixed(8)); } catch { worth = null; }
    return { reserve_fees_folded: { wbnb: formatEther(owedWbnb), other: formatUnits(owedOther, 18), ...(worth != null ? { bnb_equivalent: worth } : {}) } };
  };
  if (plan.act === 'mint_reserve') {
    if (plan.spendRaw <= 0n && !(plan.heldWbnb > 0n)) throw new Error('nothing above the reserve to put into the ladder');
    if (plan.spendRaw > 0n) await send(`wrap ${formatEther(plan.spendRaw)} BNB for the reserve range`, { address: ADDR.WBNB, abi: ABI.ERC20, functionName: 'deposit', value: plan.spendRaw });
  }
  if (plan.act === 'mint_reserve') {
    const id = await mintReserve(`mint the reserve range ${plan.ticks.tickLower} … ${plan.ticks.tickUpper} below the price, WBNB only`);
    const after = await pub.getBalance({ address: account.address });
    return { txs, gas_bnb: gasOf(), new_reserve: id, new_reserve_ticks: [plan.ticks.tickLower, plan.ticks.tickUpper], bnb_spent: formatEther(before > after ? before - after : 0n), one_sided: 'below_price' };
  }
  if (plan.act === 'increase_reserve') {
    // THE RESERVE GROWS THE WAY THE MAIN RANGE DOES (2026-09-17). The main
    // range is all of the other side above the price exactly when the price
    // has fallen out of it — into the reserve below, as often as not. A
    // reserve the price is IN takes both tokens: WBNB alone is liquidity
    // zero and the manager reverts (simulated on chain against #7461743 and
    // #7451444; the same WBNB mints fine into a range below the price). So
    // the BNB joins the reserve through the increase itself, read for the
    // reserve's range at the price now: below the price it is WBNB as it
    // is, no trade; with the price inside, the part the range needs of the
    // other side is bought first, the way every in-range increase does. It
    // also takes WBNB a stopped run left wrapped in the wallet.
    const inc = await planIncrease(pub, account.address, { positions: 1, tokenId: plan.reserve.tokenId, pos: plan.reserve.pos, reserve: null });
    if (inc.no) throw new Error(`the reserve range does not take the BNB: ${inc.no}`);
    const done = await executeIncrease(pub, wallet, account, inc, log, { txs });
    return { txs, gas_bnb: gasOf(), reserve: String(plan.reserve.tokenId), reserve_side: inc.summary.side, swap: done.swap, swap_fee_bnb: done.swap_fee_bnb, liquidity_after: done.liquidity_after, bnb_spent: done.bnb_spent };
  }
  if (plan.act === 'reset_reserve') {
    const folded = await unwindReserve();
    const id = await mintReserve(`mint the reserve range ${plan.ticks.tickLower} … ${plan.ticks.tickUpper} again beside the price, WBNB only`);
    return { txs, gas_bnb: gasOf(), old_reserve: String(plan.reserve.tokenId), new_reserve: id, new_reserve_ticks: [plan.ticks.tickLower, plan.ticks.tickUpper], ...folded, one_sided: 'below_price' };
  }
  if (plan.act === 'merge') {
    const folded = await unwindReserve();
    return { txs, gas_bnb: gasOf(), merged_reserve: String(plan.reserve.tokenId), ...folded };
  }
  throw new Error(`the ladder plan names no action (${plan.act})`);
}
