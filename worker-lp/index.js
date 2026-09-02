// The LP agent's daily collect: fees off the project's own PancakeSwap V3
// position, turned into BNB, sent to the buyback bot.
//
// WHY THE BUYBACK WALLET AND NOT A BURN FROM HERE
// The buyback bot (worker/index.js, wallet 0xdeFC…01ce) already buys $BOBAI
// and burns it, unattended, and its burns are the only ones the public burn
// log carries. A second buyer with its own burn path would be a second set of
// numbers to reconcile. So this worker does the one thing only it can do —
// collect from the position it owns — and hands the proceeds to the bot that
// already does the rest. One burn path, one record.
//
// WHAT IT DOES, ONCE A DAY
//   1. read the position and ask the pool what a collect would return
//   2. run the shared guards (shared/lp-guards.js) — the same ones the
//      hand-run script and its --self-test use
//   3. collect, sell the CAKE side for BNB on V2, unwrap the WBNB side
//   4. send everything above a gas reserve to the buyback wallet
//   5. write what happened to KV; agent.brainonbnb.com/lp/collect serves it
//
// The key is a Worker secret (LP_PRIVATE_KEY), the same class of thing the
// buyback bot has held since July. This worker has no public face beyond a
// secret-gated /run: everything readable about it is served by the agent
// worker from the KV record it writes.
import { createPublicClient, createWalletClient, http, parseAbi, formatEther, formatUnits } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { refuse } from '../shared/lp-guards.js';

const V3_POSITION_MANAGER = '0x46a15b0b27311cedf172ab29e4f4766fbe7f4364';
const V2_ROUTER = '0x10ed43c718714eb63d5aa57b78b54704e256024e';
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
// Where the proceeds go. The buyback bot's wallet, and only that one.
export const BUYBACK_WALLET = '0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce';
const GAS_PRICE = 1_000_000_000n;
// What the next run will cost, kept back so this run never strands the wallet.
const GAS_RESERVE = GAS_PRICE * 1_000_000n;
const MAX128 = (1n << 128n) - 1n;
const KV_KEY = 'lp:collect';
const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-rpc.publicnode.com'];

const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function withdraw(uint256)',
]);
const NPM = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function positions(uint256) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)',
  'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) payable returns (uint256 amount0,uint256 amount1)',
]);
const ROUTER = parseAbi([
  'function getAmountsOut(uint256,address[]) view returns (uint256[])',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)',
]);

const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function readState(env) {
  const raw = await env.AGENT.get(KV_KEY);
  return raw ? JSON.parse(raw) : { history: [], last: null };
}

// One run. `dry` reads and decides but signs nothing — the same code path up
// to the first transaction, which is the part worth being able to test after
// a deploy without moving money.
export async function collectTick(env, { dry = false } = {}) {
  const at = new Date().toISOString();
  const key = env.LP_PRIVATE_KEY;
  if (!key) return record(env, { at, ok: false, dry, error: 'LP_PRIVATE_KEY is not set on this worker' });
  const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
  const pub = createPublicClient({ chain: bsc, transport: http(RPCS[0], { timeout: 15000 }) });

  const positions = Number(await pub.readContract({ address: V3_POSITION_MANAGER, abi: NPM, functionName: 'balanceOf', args: [account.address] }));
  let tokenId = null, pos = null, owed0 = 0n, owed1 = 0n;
  if (positions === 1) {
    tokenId = await pub.readContract({ address: V3_POSITION_MANAGER, abi: NPM, functionName: 'tokenOfOwnerByIndex', args: [account.address, 0n] });
    pos = await pub.readContract({ address: V3_POSITION_MANAGER, abi: NPM, functionName: 'positions', args: [tokenId] });
    // Asked by simulation, not read off the struct: tokensOwed only updates
    // when the position is touched, so an untouched position reads zero there.
    const sim = await pub.simulateContract({
      address: V3_POSITION_MANAGER, abi: NPM, functionName: 'collect',
      args: [{ tokenId, recipient: account.address, amount0Max: MAX128, amount1Max: MAX128 }], account,
    }).catch(() => null);
    if (sim) { owed0 = sim.result[0]; owed1 = sim.result[1]; }
  }
  const gasBal = await pub.getBalance({ address: account.address });
  const token0 = pos ? pos[2].toLowerCase() : null, token1 = pos ? pos[3].toLowerCase() : null;
  const wbnbIs0 = token0 === WBNB;
  const other = wbnbIs0 ? token1 : token0;
  const owedWbnb = wbnbIs0 ? owed0 : owed1;
  const owedOther = wbnbIs0 ? owed1 : owed0;
  let otherInBnb = 0n;
  if (pos && owedOther > 0n) {
    const q = await pub.readContract({ address: V2_ROUTER, abi: ROUTER, functionName: 'getAmountsOut', args: [owedOther, [other, WBNB]] }).catch(() => null);
    if (q) otherInBnb = q[1];
  }
  const owedBnbEquivalent = Number(formatEther(owedWbnb + otherInBnb));
  const state = { positions, liquidity: pos ? pos[7] : 0n, owedBnbEquivalent, gasBnb: Number(formatEther(gasBal)), quoteOffPct: null };
  const no = refuse(state);

  const base = {
    at, dry, wallet: account.address,
    position: tokenId == null ? null : String(tokenId),
    ticks: pos ? [Number(pos[5]), Number(pos[6])] : null,
    liquidity: pos ? String(pos[7]) : null,
    owed: { wbnb: formatEther(owedWbnb), other: formatUnits(owedOther, 18), other_token: other, bnb_equivalent: owedBnbEquivalent },
    gas_bnb: state.gasBnb,
  };
  if (no) return record(env, { ...base, ok: true, acted: false, why: no });
  if (dry) return record(env, { ...base, ok: true, acted: false, why: 'dry run — would have collected and forwarded', would_forward_bnb_about: owedBnbEquivalent });

  const wallet = createWalletClient({ account, chain: bsc, transport: http(RPCS[0], { timeout: 15000 }) });
  const txs = [];
  const send = async (label, req) => {
    const hash = await wallet.writeContract({ ...req, gasPrice: GAS_PRICE });
    txs.push({ label, hash });
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 90000 });
    if (r.status !== 'success') throw new Error(`${label} reverted — stopped before the next step`);
    return r;
  };
  try {
    await send('collect', { address: V3_POSITION_MANAGER, abi: NPM, functionName: 'collect', args: [{ tokenId, recipient: account.address, amount0Max: MAX128, amount1Max: MAX128 }] });
    if (owedOther > 0n) {
      const have = await pub.readContract({ address: other, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
      await send('approve for sale', { address: other, abi: ERC20, functionName: 'approve', args: [V2_ROUTER, have] });
      // 15% floor, the same the project uses for fee-on-transfer tokens; the
      // guard above already refused anything that moved more than that.
      const q = await pub.readContract({ address: V2_ROUTER, abi: ROUTER, functionName: 'getAmountsOut', args: [have, [other, WBNB]] });
      const minOut = (q[1] * 8500n) / 10000n;
      await send('sell the other side', { address: V2_ROUTER, abi: ROUTER, functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens', args: [have, minOut, [other, WBNB], account.address, BigInt(Math.floor(Date.now() / 1000) + 600)] });
    }
    const wbnbHave = await pub.readContract({ address: WBNB, abi: ERC20, functionName: 'balanceOf', args: [account.address] });
    if (wbnbHave > 0n) await send('unwrap', { address: WBNB, abi: ERC20, functionName: 'withdraw', args: [wbnbHave] });

    const after = await pub.getBalance({ address: account.address });
    const forward = after > GAS_RESERVE ? after - GAS_RESERVE : 0n;
    if (forward <= 0n) return record(env, { ...base, ok: true, acted: true, txs, forwarded_bnb: '0', why: 'collected, but nothing above the gas reserve to forward' });
    const hash = await wallet.sendTransaction({ to: BUYBACK_WALLET, value: forward, gasPrice: GAS_PRICE, gas: 21000n });
    txs.push({ label: 'forward to buyback wallet', hash });
    await pub.waitForTransactionReceipt({ hash, timeout: 90000 });
    return record(env, { ...base, ok: true, acted: true, txs, forwarded_bnb: formatEther(forward), to: BUYBACK_WALLET });
  } catch (e) {
    return record(env, { ...base, ok: false, acted: txs.length > 0, txs, error: String(e.shortMessage || e.message).slice(0, 300) });
  }
}

async function record(env, entry) {
  const st = await readState(env);
  // Every real action is kept; quiet days are summarised as the last check so
  // the history is a history of what happened, not of the cron firing.
  if (entry.acted || entry.error) st.history = st.history.concat(entry).slice(-200);
  st.last = entry;
  st.note = 'Fees collected from the project\'s own PancakeSwap V3 position, sold to BNB and forwarded to the buyback wallet, which buys and burns $BOBAI as it always has. One burn path, one record. Checked daily; a quiet day is recorded under last, an action under history.';
  await env.AGENT.put(KV_KEY, JSON.stringify(st));
  return entry;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/run' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      // Dry unless asked otherwise: a hand-triggered run is for checking the
      // deploy, and checking must not be the thing that moves money.
      const dry = url.searchParams.get('dry') !== '0';
      return json(await collectTick(env, { dry }));
    }
    if (url.pathname === '/') return json(await readState(env));
    return json({ error: 'not found' }, 404);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(collectTick(env).catch(async (e) => record(env, { at: new Date().toISOString(), ok: false, error: String(e.message).slice(0, 300) })));
  },
};
