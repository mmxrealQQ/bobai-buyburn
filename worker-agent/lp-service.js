// The DeFi agent, for somebody else's position.
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
import { ADDR, ABI, RPCS, readPool, splitForRange, planRebalance, planIncrease, readBnbUsd } from '../shared/lp-agent.js';
import { widthVerdict } from './lp-windows.js';
import { HOME_POOL } from '../shared/lp-guards.js';

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
  let tokenId = null, alsoHeld = null;
  const idIn = params.position ?? params.tokenId ?? params.id;
  if (idIn != null && /^\d+$/.test(String(idIn))) tokenId = BigInt(String(idIn));
  const address = String(params.address || params.wallet || params.owner || '').match(/0x[a-fA-F0-9]{40}/)?.[0] || null;
  if (tokenId == null) {
    if (!address) throw new Error('give a PancakeSwap V3 position id, or the address of a wallet that holds exactly one');
    const n = Number(await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'balanceOf', [address]));
    if (n === 0) return { facts: { service: 'lp_position_plan', address, positions: 0, verdict: 'This wallet holds no PancakeSwap V3 position. Nothing to plan.' } };
    if (n > 1) {
      // Name the ids, so the holder can pick one without another tool (up to
      // ten: the dead address holds tens of thousands of burned LP NFTs).
      const ids = [];
      for (let i = 0n; i < BigInt(Math.min(n, 10)); i++) ids.push(String(await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'tokenOfOwnerByIndex', [address, i])));
      // The agent's own wallet holds two by design since 2026-09-16: the main
      // range and the reserve range of its ladder. Asked by that address, the
      // look is the main range, and it says which other id the wallet holds.
      const ladder = params.ladder && params.ladder.main != null ? params.ladder : null;
      if (ladder && ids.includes(String(ladder.main))) {
        tokenId = BigInt(String(ladder.main));
        alsoHeld = ids.filter((id) => id !== String(ladder.main));
      } else {
        return { facts: { service: 'lp_position_plan', address, positions: n, position_ids: ids, verdict: `This wallet holds ${n} PancakeSwap V3 positions${n > ids.length ? ` (the first ${ids.length})` : ''}: ${ids.map((id) => '#' + id).join(', ')}. Name one by its id (position: <tokenId>) and the plan is for that one.` } };
      }
    } else tokenId = await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'tokenOfOwnerByIndex', [address, 0n]);
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
  // THE FLIP (2026-10-14, PancakeSwap's proposal: LPs on v3 and Infinity keep 88% of swap fees, up from 66-68%). What
  // this pool hands its LPs today is read from the pool itself (slot0.feeProtocol, 1/10,000 per token, low 16 bits
  // token0, high 16 token1) — so the day the change lands on the chain, this line shows it without a code change.
  let flip = null;
  try {
    const fp = Number((await read(pub, poolInfo.pool, ABI.POOL, 'slot0'))[5]);
    const kept = Math.max(fp % 65536, Math.floor(fp / 65536)) / 10000, lpShare = 1 - kept;
    if (lpShare > 0 && lpShare < 1) {
      const k = 0.88 / lpShare;
      flip = { lp_share_now_pct: +(lpShare * 100).toFixed(2), lp_share_under_the_flip_pct: 88, fees_factor: +k.toFixed(3),
        ...(owedBnbEquiv != null ? { fees_owed_now_bnb: +owedBnbEquiv.toFixed(6), fees_owed_under_the_flip_bnb: +(owedBnbEquiv * k).toFixed(6) } : {}),
        status: lpShare >= 0.879 ? 'this pool already pays its LPs 88% or more' : 'a proposal in discussion (forum, 14 Oct 2026; a Snapshot vote follows, the rollout would run Nov 2026 – Jan 2027), not live: the share now is read from the pool and changes here the day it lands on the chain',
        proposal: 'https://forum.pancakeswap.finance/t/proposal-discussion-the-flip-liquidity-should-get-paid-more/1658' };
    }
  } catch { /* a pool that does not answer slot0 here gets no line, never a guessed one */ }
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
    ...(flip ? { the_flip: flip } : {}),
    ...(alsoHeld ? { also_held: alsoHeld, also_held_note: 'the wallet holds these too; this is the main range of the ladder the agent runs, the other is its reserve range' } : {}),
  };
  return { facts, pub, p, owner, poolInfo, owedBnbEquiv };
}

// The free look: the facts, and the one sentence a holder wants first — in
// range or not, room left, fees owed and whether collecting them pays. No
// plan: the width, the re-set and what spare BNB would add are the paid
// answer. A holder who has seen the look knows what the plan is about.
// The ladder record (worker-lp, KV lp:ladder): which position is the main
// range and which the reserve. Read only when the worker's KV is at hand and
// the question came as an address, so the agent's own wallet resolves to its
// main range rather than to "name one of two".
async function withLadder(params, env) {
  if (!env || !env.AGENT || params.position != null || params.ladder) return params;
  try { const l = JSON.parse((await env.AGENT.get('lp:ladder')) || 'null'); return l && l.main != null ? { ...params, ladder: l } : params; } catch { return params; }
}
// THE PLAN WHEN NOTHING IS NAMED (2026-10-14). A marketplace's hire button
// pays and sends no words at all (Mandate's "Hire for $0.10"): the plan was
// refused (422, nothing charged) and the hire never happened. Now the paying
// wallet is the input — its one position, or the first of several — and a
// wallet without one gets the plan for the position this agent runs itself,
// the same work, said so in the answer.
export const OWN_LP_WALLET = '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A';
export async function lpDefaultTarget(payer) {
  if (/^0x[a-fA-F0-9]{40}$/.test(String(payer || ''))) {
    payer = payer.toLowerCase(); // checksum or not, as signed
    const pub = client(), n = Number(await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'balanceOf', [payer]));
    if (n === 1) return { address: payer, target: `no position was named: this is the plan for the one PancakeSwap V3 position the paying wallet ${payer} holds` };
    if (n > 1) {
      const id = String(await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'tokenOfOwnerByIndex', [payer, 0n]));
      return { position: id, target: `no position was named: this is the plan for #${id}, the first of the ${n} the paying wallet ${payer} holds — name another with position: <id>` };
    }
  }
  return { address: OWN_LP_WALLET, target: `no position was named and the paying wallet holds none: this is the plan for the position this agent runs itself (wallet ${OWN_LP_WALLET}) — name yours with position: <id> or address: 0x…` };
}
// A full-range position's edges are the tick limits: its room read '1.5e+62% above' (2026-10-14)
const roomSaid = (r) => `${r.to_lower_pct >= 99.99 ? 'no lower limit' : `${r.to_lower_pct}% of room below the price`}, ${r.to_upper_pct > 10000 ? 'no upper limit (full range)' : `${r.to_upper_pct}% above`}`;
export async function lpPositionLook(params = {}, env = null) {
  const r = await lpPositionFacts(await withLadder(params, env));
  if (r.facts.positions !== 1) return { ...r.facts, service: 'lp_position_look' };
  const { facts, poolInfo, owedBnbEquiv } = r;
  const lines = [];
  lines.push(poolInfo.inRange
    ? `In range: ${roomSaid(facts.room)}.`
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
  params = await withLadder(params, env);
  const r = await lpPositionFacts(params);
  // A PAID PLAN THAT HAS NO POSITION TO PLAN IS NOT DELIVERED (2026-09-18). A
  // wallet with none, or with several and no id named, used to be answered
  // with the free look's facts — and charged 0.10 for it, because the sale
  // refunds only when the work throws. It throws, with the same sentence (and
  // the ids to choose from): the buyer keeps the payment as a credit.
  if (r.facts.positions !== 1) throw new Error(`${r.facts.verdict}${Array.isArray(r.facts.position_ids) && r.facts.position_ids.length ? ` Position ids: ${r.facts.position_ids.join(', ')}.` : ''} The free look says the same: https://agent.brainonbnb.com/lp/look`);
  const { facts, pub, p, owner, poolInfo, owedBnbEquiv } = r;
  // NOT A WBNB PAIR: THE RANGE CHECK (2026-10-23). It used to be handed back with one sentence ("plans only WBNB
  // pairs") and declined at the quote; the width replay and the BNB amounts need a WBNB side, the range check does not.
  if (!facts.against_wbnb) {
    const rc = await lpRangeCheck({ position: facts.position });
    return { ...facts, ...rc.positions[0], service: 'lp_position_plan', mode: 'range_check', verdict: `${rc.positions[0].verdict} Not a WBNB pair: this is the range check — the width replay and the BNB amounts are planned for WBNB pairs only.`, method: rc.method, measured_at: rc.measured_at };
  }
  // The agent's own decisions, on this position, from the same code.
  // The verdict the agent itself acts on: measured re-set cost and the price
  // tape in (widthVerdict) — not a bare replay of the hourly windows.
  const record = env ? await widthVerdict(env, await readBnbUsd(pub).then((r) => r.bnbUsd).catch(() => null)).then((x) => x.v).catch(() => null) : null;
  let rebalance = null, increase = null;
  try { rebalance = await planRebalance(pub, owner, { record, position: p, ladder: params.ladder || null }); } catch (e) { rebalance = { error: String(e.shortMessage || e.message).slice(0, 200) }; }
  try { increase = await planIncrease(pub, owner, p, params.ladder || null); } catch (e) { increase = { error: String(e.shortMessage || e.message).slice(0, 200) }; }
  const strip = (x) => (x && x.summary ? { ...x.summary, ...(x.no ? { why: x.no } : {}) } : x);
  const collectPays = owedBnbEquiv != null ? owedBnbEquiv >= 0.002 : null;
  const lines = [];
  lines.push(poolInfo.inRange
    ? `In range: ${roomSaid(facts.room)}.`
    : 'Out of range: the position is all one token and earns nothing until the price returns or the range is re-set.');
  lines.push(owedBnbEquiv != null ? (collectPays ? `Fees owed: ${owedBnbEquiv.toFixed(6)} BNB — collecting pays for its gas.` : `Fees owed: ${owedBnbEquiv.toFixed(6)} BNB — under the 0.002 BNB floor, collecting would cost more gas than it recovers.`) : 'Fees owed could not be priced.');
  // a buyer reads this as sentences and figures (2026-10-05): every line ends as one, dust is not printed with
  // seventeen digits, and ticks shown beside "nothing to re-set" say what they are
  const dot = (s) => (/[.!?]$/.test(String(s).trim()) ? String(s).trim() : `${String(s).trim()}.`);
  const tidy = (x) => (x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'number' && /_bnb$/.test(k) ? Number(v.toFixed(6)) : v])) : x);
  const rb = tidy(strip(rebalance));
  if (rb && rb.why && (rb.new_ticks || rb.trade)) rb.note = 'No re-set is due. new_ticks and trade describe the re-set that would apply if one were due right now.';
  if (rb && rb.why) lines.push(`Re-set: ${dot(rb.why)}`);
  else if (rb && rb.new_ticks) lines.push(`Re-set due: the agent would move the range to ticks ${rb.new_ticks.join(' … ')} (±${rb.width_pct}%, ${rb.width_basis || 'from the width record'}).`);
  // The width record is measured on the agent's own pool (review 2026-09-21): on any other pool the
  // width is borrowed, and the answer says so instead of passing it off as this pool's own measurement.
  const foreignPool = String(facts.pool?.address || '').toLowerCase() !== String(HOME_POOL.pool).toLowerCase();
  if (foreignPool && rb && (rb.new_ticks || rb.width_pct)) lines.push(`The width comes from the price record of ${HOME_POOL.label}, the pool this agent runs on; this pool's own swings may call for a different one.`);
  const ic = tidy(strip(increase));
  if (ic && ic.why) lines.push(`Grow: ${dot(ic.why)}`);
  else if (ic && ic.would_add) lines.push(`Grow: the capital beside the position would add ${ic.would_add.wbnb} WBNB and ${ic.would_add.other} of the other side${ic.would_add.buying_other ? `, buying ${ic.would_add.buying_other} of it first` : ic.would_add.selling_other ? `, selling ${ic.would_add.selling_other} of the other side first` : ''}.`);
  return {
    ...facts,
    collect: { pays_for_gas: collectPays, floor_bnb: 0.002 },
    rebalance: rb, increase: ic,
    width_record: record ? { measured_on: HOME_POOL.label, applies_to_this_pool: !foreignPool, width_pct: record.earnings_pick?.width ?? null, expected_net_usd_per_day_on_50: record.earnings_pick?.earnings?.net_usd_per_day ?? null, expected_net_basis: 'the width record\'s own figure: fees net of re-sets over hours_of_prices of recorded prices. It is a different measure from the last week against holding, which stands in rebalance.width_basis', hours_of_prices: record.hours_of_prices ?? null, source: 'https://agent.brainonbnb.com/lp/windows' } : null,
    verdict: lines.join(' '),
    what_this_is_not: 'An execution. This agent signs nothing on your position; it tells you what it would do, from the same code that runs its own. Measurement, not advice.',
    measured_at: new Date().toISOString(),
    source: 'PancakeSwap V3 NonfungiblePositionManager and the pool itself, read live; the width from the recorded price windows',
  };
}

// THE RANGE CHECK, ANY PAIR, EVERY POSITION (2026-10-23). Marketplaces file "rebalancing" as LP range work: Pokter
// asked our Rebalancer "Range check for the PancakeSwap v3 positions held by 0x…: which are in range, and what should
// be re-centred?" and it declined (it priced portfolios only), and the DeFi agent declined too (not a WBNB pair). The
// reading needs no pair of ours: per position the ticks, the pool's tick, in range or not, the room to each edge, and
// where the same width would sit centred on today's price, aligned to the pool's tick spacing. Read-only: it moves
// nothing. Up to MAX_RANGE positions per wallet; empty ones (liquidity 0) are named, not judged.
const MAX_RANGE = 20;
const ERC20_SYMBOL = [{ name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }];
const SPACING_ABI = [{ name: 'tickSpacing', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'int24' }] }];
const FEE_SPACING = { 100: 1, 500: 10, 2500: 50, 10000: 200 };
// Pure: one position's verdict from its ticks, the pool's tick and the spacing.
export function rangeVerdict(lower, upper, tick, spacing) {
  const pct = (a, b) => +((Math.pow(1.0001, a - b) - 1) * 100).toFixed(2);
  const width = upper - lower;
  const inRange = tick >= lower && tick < upper;
  const sp = Math.max(1, spacing || 1);
  const newLower = Math.floor((tick - width / 2) / sp) * sp;
  const newUpper = newLower + Math.max(sp, Math.round(width / sp) * sp);
  const out = { ticks: [lower, upper], tick, tick_spacing: sp, in_range: inRange, width_pct: pct(upper, lower) };
  if (inRange) {
    out.room = { to_lower_pct: -pct(lower, tick), to_upper_pct: pct(upper, tick) };
    // near an edge: less than a tenth of the width left on one side
    const left = Math.min((tick - lower) / width, (upper - tick) / width);
    out.near_edge = left < 0.1;
    out.recentre = out.near_edge ? 'soon' : 'no';
  } else {
    out.out_of_range = tick < lower ? { side: 'below', price_must_rise_pct: pct(lower, tick) } : { side: 'above', price_must_fall_pct: -pct(upper, tick) };
    out.recentre = 'yes';
  }
  out.recentred_ticks = [newLower, newUpper];
  out.verdict = inRange
    ? `In range: ${out.room.to_lower_pct}% of room below the price, ${out.room.to_upper_pct}% above${out.near_edge ? ' — near an edge; re-centring soon keeps it earning' : ''}.`
    : `Out of range (${out.out_of_range.side}): all one token, earning nothing. The same width centred on the price is ticks ${newLower} to ${newUpper}.`;
  return out;
}
export async function lpRangeCheck(params = {}) {
  const pub = client();
  const idIn = params.position ?? params.tokenId ?? params.id;
  const ids = [];
  let address = String(params.address || params.wallet || params.owner || '').match(/0x[a-fA-F0-9]{40}/)?.[0] || null, n = null;
  if (idIn != null && /^\d+$/.test(String(idIn))) ids.push(BigInt(String(idIn)));
  else {
    if (!address) throw new Error('a range check needs a PancakeSwap V3 position id or the wallet that holds the positions (0x…)');
    n = Number(await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'balanceOf', [address]));
    for (let i = 0; i < Math.min(n, MAX_RANGE); i++) ids.push(await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'tokenOfOwnerByIndex', [address, BigInt(i)]));
  }
  const symbols = new Map();
  const sym = async (t) => { if (!symbols.has(t)) symbols.set(t, await read(pub, t, ERC20_SYMBOL, 'symbol').catch(() => t.slice(0, 8))); return symbols.get(t); };
  const positions = [];
  for (const id of ids) {
    const pos = await read(pub, ADDR.V3_POSITION_MANAGER, ABI.NPM, 'positions', [id]).catch(() => null);
    if (!pos) { positions.push({ position: String(id), error: 'not on the PancakeSwap V3 manager' }); continue; }
    const pair = `${await sym(pos[2])}/${await sym(pos[3])}`;
    const base = { position: String(id), pair, token0: pos[2], token1: pos[3], fee_tier_pct: Number(pos[4]) / 10000 };
    if (pos[7] === 0n) { positions.push({ ...base, empty: true, verdict: 'Empty: no liquidity left in it, nothing to re-centre.' }); continue; }
    const poolInfo = await readPool(pub, pos);
    const spacing = Number(await read(pub, poolInfo.pool, SPACING_ABI, 'tickSpacing').catch(() => FEE_SPACING[Number(pos[4])] || 1));
    positions.push({ ...base, pool: poolInfo.pool, ...rangeVerdict(Number(pos[5]), Number(pos[6]), poolInfo.tick, spacing) });
  }
  const live = positions.filter((p) => p.ticks);
  const out = live.filter((p) => !p.in_range), soon = live.filter((p) => p.near_edge);
  return {
    service: 'range_check',
    ...(address && n != null ? { address, positions_held: n, ...(n > MAX_RANGE ? { read: `the first ${MAX_RANGE}` } : {}) } : {}),
    summary: !positions.length ? 'This wallet holds no PancakeSwap V3 position. Nothing to check.'
      : !live.length ? `${positions.length} position${positions.length === 1 ? '' : 's'}, none with liquidity left — nothing to re-centre.`
      : `${live.length} position${live.length === 1 ? '' : 's'} with liquidity: ${live.length - out.length} in range, ${out.length} out of range${soon.length ? `, ${soon.length} near an edge` : ''}.${out.length ? ` Re-centre: ${out.map((p) => '#' + p.position).join(', ')}.` : ''}`,
    positions,
    method: 'Per position: its ticks and the pool\'s current tick, read live; room to each edge as a price move in percent; re-centred = the same width centred on the current tick, aligned to the pool\'s tick spacing. Near an edge = less than a tenth of the width left on one side.',
    what_this_is_not: 'An execution or advice on whether to provide liquidity. It reads and moves nothing.',
    measured_at: new Date().toISOString(),
    source: 'PancakeSwap V3 NonfungiblePositionManager and each pool, read live',
  };
}
