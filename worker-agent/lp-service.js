// The liquidity agent, for somebody else's position.
//
// Point 5 of the Block-05 list. The agent that runs this project's own
// PancakeSwap V3 position reads, plans and re-sets it every day from ONE core
// (shared/lp-agent.js). This module points the same reading and the same
// planning at any position on the chain — by token id, or by the wallet that
// holds exactly one — and returns what the agent would decide about it: is it
// in range, what it is worth, what it is owed, whether collecting pays for its
// own gas, whether a re-set is due and in which width (the width that netted
// the most per day when every width was replayed over the window record's
// prices with the agent's own re-set delay and cost — the same record and
// rule our own position uses), and what the wallet's spare BNB would add.
//
// STAGE 1, DELIBERATELY: it reads and advises. It signs nothing and it holds
// nothing. Executing on a stranger's position needs a session key on THEIR
// account with an allowlist and a cap (the Altana path this project already
// runs for its own escrow spending), and that stage is designed, not built —
// see docs/lp-service-stage2.md. A plan you can check against the chain is
// worth shipping today; a key to somebody's liquidity is not something to
// ship in an afternoon.
import { createPublicClient, http, fallback, formatEther } from 'viem';
import { bsc } from 'viem/chains';
import { ADDR, ABI, RPCS, readPool, splitForRange, planRebalance, planIncrease } from '../shared/lp-agent.js';
import { readLpWindows, verdict } from './lp-windows.js';

const MAX128 = (1n << 128n) - 1n;
const ZERO = '0x0000000000000000000000000000000000000000';
const bn = (v) => Number(formatEther(v));
const client = () => createPublicClient({ chain: bsc, transport: fallback(RPCS.map((u) => http(u, { timeout: 15000 }))) });
const read = (pub, address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });

const OWNER_ABI = [{ name: 'ownerOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] }];

// A position by id: the struct, its owner, and what a collect would pay out
// right now (simulated as the owner, so the manager answers for them).
async function readById(pub, tokenId) {
  const pos = await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'positions', [tokenId]).catch(() => null);
  if (!pos) throw new Error(`position #${tokenId} does not exist on the PancakeSwap V3 manager`);
  const owner = await read(pub, ADDR.V3_POSITION_MANAGER, OWNER_ABI, 'ownerOf', [tokenId]).catch(() => null);
  if (!owner || owner === ZERO) throw new Error(`position #${tokenId} has no owner — burned?`);
  let owed0 = 0n, owed1 = 0n;
  if (pos[7] > 0n) {
    const sim = await pub.simulateContract({
      address: ADDR.V3_POSITION_MANAGER, abi: ABI.NPM, functionName: 'collect',
      args: [{ tokenId, recipient: owner, amount0Max: MAX128, amount1Max: MAX128 }], account: owner,
    }).catch(() => null);
    if (sim) { owed0 = sim.result[0]; owed1 = sim.result[1]; }
  }
  return { positions: 1, tokenId, pos, owed0, owed1, owner };
}

// The facts of a position, read from the chain: what it holds, whether it is
// in range and how much room is left, what it is worth, what it is owed.
// Shared by the free look (/lp/look) and the paid plan — the plan is these
// facts plus the agent's decisions about them.
export async function lpPositionFacts(params = {}) {
  const pub = client();
  let tokenId = null;
  const idIn = params.position ?? params.tokenId ?? params.id;
  if (idIn != null && /^\d+$/.test(String(idIn))) tokenId = BigInt(String(idIn));
  const address = String(params.address || params.wallet || params.owner || '').match(/0x[a-fA-F0-9]{40}/)?.[0] || null;
  if (tokenId == null) {
    if (!address) throw new Error('lp_position_plan needs a PancakeSwap V3 position id, or the address of a wallet that holds exactly one');
    const n = Number(await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'balanceOf', [address]));
    if (n === 0) return { facts: { service: 'lp_position_plan', address, positions: 0, verdict: 'This wallet holds no PancakeSwap V3 position. Nothing to plan.' } };
    if (n > 1) return { facts: { service: 'lp_position_plan', address, positions: n, verdict: `This wallet holds ${n} PancakeSwap V3 positions. Name one by its id (position: <tokenId>) and the plan is for that one.` } };
    tokenId = await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'tokenOfOwnerByIndex', [address, 0n]);
  }
  const p = await readById(pub, tokenId);
  const owner = p.owner;
  const token0 = p.pos[2].toLowerCase(), token1 = p.pos[3].toLowerCase();
  const wbnbIs0 = token0 === ADDR.WBNB, wbnbIs1 = token1 === ADDR.WBNB;
  const poolInfo = await readPool(pub, p.pos);
  const L = Number(p.pos[7]);
  const s = splitForRange(poolInfo.sqrtP, Number(p.pos[5]), Number(p.pos[6]));
  const in0 = L * s.perL0 / 1e18, in1 = L * s.perL1 / 1e18;
  const priceOtherInBnb = wbnbIs0 ? 1 / (poolInfo.sqrtP * poolInfo.sqrtP) : poolInfo.sqrtP * poolInfo.sqrtP; // other per BNB → BNB per other
  const holdsBnb = wbnbIs0 ? in0 : wbnbIs1 ? in1 : null;
  const holdsOther = wbnbIs0 ? in1 : wbnbIs1 ? in0 : null;
  const valueBnb = holdsBnb == null ? null : holdsBnb + holdsOther * priceOtherInBnb;
  const owedBnb = wbnbIs0 ? bn(p.owed0) : wbnbIs1 ? bn(p.owed1) : null;
  const owedOther = wbnbIs0 ? bn(p.owed1) : wbnbIs1 ? bn(p.owed0) : null;
  const owedBnbEquiv = owedBnb == null ? null : owedBnb + owedOther * priceOtherInBnb;
  const facts = {
    service: 'lp_position_plan',
    positions: 1,
    position: String(tokenId), owner,
    pool: { address: poolInfo.pool, token0: p.pos[2], token1: p.pos[3], fee_tier_pct: Number(p.pos[4]) / 10000, tick: poolInfo.tick, ticks: [Number(p.pos[5]), Number(p.pos[6])] },
    in_range: poolInfo.inRange,
    // Distance to each edge in percent of price: how much room is left.
    room: { to_lower_pct: +((1 - Math.pow(1.0001, Number(p.pos[5]) - poolInfo.tick)) * 100).toFixed(2), to_upper_pct: +((Math.pow(1.0001, Number(p.pos[6]) - poolInfo.tick) - 1) * 100).toFixed(2) },
    liquidity: p.pos[7].toString(),
    holds: { token0: in0, token1: in1 },
    value_bnb: valueBnb == null ? null : +valueBnb.toFixed(6),
    fees_owed: { token0: bn(p.owed0), token1: bn(p.owed1), bnb_equivalent: owedBnbEquiv == null ? null : +owedBnbEquiv.toFixed(6) },
    against_wbnb: wbnbIs0 || wbnbIs1,
  };
  return { facts, pub, p, owner, poolInfo, owedBnbEquiv };
}

// The free look: the facts, and the one sentence a holder wants first — in
// range or not, room left, fees owed and whether collecting them pays. No
// plan: the width, the re-set and what spare BNB would add are the paid
// answer. A holder who has seen the look knows what the plan is about.
export async function lpPositionLook(params = {}) {
  const r = await lpPositionFacts(params);
  if (r.facts.positions !== 1) return { ...r.facts, service: 'lp_position_look' };
  const { facts, poolInfo, owedBnbEquiv } = r;
  const lines = [];
  lines.push(poolInfo.inRange
    ? `In range: ${facts.room.to_lower_pct}% of room below the price, ${facts.room.to_upper_pct}% above.`
    : 'Out of range: the position is all one token and earns nothing until the price returns or the range is re-set.');
  if (owedBnbEquiv != null) lines.push(owedBnbEquiv >= 0.002 ? `Fees owed: ${owedBnbEquiv.toFixed(6)} BNB — collecting pays for its gas.` : `Fees owed: ${owedBnbEquiv.toFixed(6)} BNB — under the 0.002 BNB floor, collecting would cost more gas than it recovers.`);
  return {
    ...facts,
    service: 'lp_position_look',
    verdict: lines.join(' '),
    the_plan: facts.against_wbnb
      ? 'What the agent would do about it — whether a re-set is due and in which width, what the wallet\'s spare BNB would add — is the paid answer: lp_position_plan, 0.10 USD1, POST /answer?service=lp_position_plan.'
      : 'The position is not against WBNB. The agent reads it, but plans only WBNB pairs — that is the one thing it knows how to turn into BNB and back.',
    measured_at: new Date().toISOString(),
    source: 'PancakeSwap V3 NonfungiblePositionManager and the pool itself, read live',
  };
}

export async function lpPositionPlan(params = {}, env = null) {
  const r = await lpPositionFacts(params);
  if (r.facts.positions !== 1) return r.facts;
  const { facts, pub, p, owner, poolInfo, owedBnbEquiv } = r;
  if (!facts.against_wbnb) {
    return { ...facts, verdict: 'The position is not against WBNB. This agent reads it, but plans only WBNB pairs — that is the one thing it knows how to turn into BNB and back.', measured_at: new Date().toISOString() };
  }
  // The agent's own decisions, on this position, from the same code.
  const record = env ? await readLpWindows(env).then((log) => (log ? verdict(log) : null)).catch(() => null) : null;
  let rebalance = null, increase = null;
  try { rebalance = await planRebalance(pub, owner, { record, position: p }); } catch (e) { rebalance = { error: String(e.shortMessage || e.message).slice(0, 200) }; }
  try { increase = await planIncrease(pub, owner, p); } catch (e) { increase = { error: String(e.shortMessage || e.message).slice(0, 200) }; }
  const strip = (x) => (x && x.summary ? { ...x.summary, ...(x.no ? { why: x.no } : {}) } : x);
  const collectPays = owedBnbEquiv != null ? owedBnbEquiv >= 0.002 : null;
  const lines = [];
  lines.push(poolInfo.inRange
    ? `In range: ${facts.room.to_lower_pct}% of room below the price, ${facts.room.to_upper_pct}% above.`
    : 'Out of range: the position is all one token and earns nothing until the price returns or the range is re-set.');
  lines.push(owedBnbEquiv != null ? (collectPays ? `Fees owed: ${owedBnbEquiv.toFixed(6)} BNB — collecting pays for its gas.` : `Fees owed: ${owedBnbEquiv.toFixed(6)} BNB — under the 0.002 BNB floor, collecting would cost more gas than it recovers.`) : 'Fees owed could not be priced.');
  const rb = strip(rebalance);
  if (rb && rb.why) lines.push(`Re-set: ${rb.why}`);
  else if (rb && rb.new_ticks) lines.push(`Re-set due: the agent would move the range to ticks ${rb.new_ticks.join(' … ')} (±${rb.width_pct}%, ${rb.width_basis || 'from the width record'}).`);
  const ic = strip(increase);
  if (ic && ic.why) lines.push(`Grow: ${ic.why}`);
  else if (ic && ic.wbnb) lines.push(`Grow: the wallet's spare BNB would add ${ic.wbnb} WBNB and buy ${ic.other} of the other side.`);
  return {
    ...facts,
    collect: { pays_for_gas: collectPays, floor_bnb: 0.002 },
    rebalance: rb, increase: ic,
    width_record: record ? { width_pct: record.earnings_pick?.width ?? null, expected_net_usd_per_day_on_50: record.earnings_pick?.earnings?.net_usd_per_day ?? null, hours_of_prices: record.hours_of_prices ?? null, source: 'https://agent.brainonbnb.com/lp/windows' } : null,
    verdict: lines.join(' '),
    what_this_is_not: 'An execution. This agent signs nothing on your position; it tells you what it would do, from the same code that runs its own. Measurement, not advice.',
    measured_at: new Date().toISOString(),
    source: 'PancakeSwap V3 NonfungiblePositionManager and the pool itself, read live; the width from the recorded price windows',
  };
}
