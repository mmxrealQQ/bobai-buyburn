// worker-agent/holders.js — every $BOBAI holder, kept by the worker from the chain (2026-10-22)
//
// Operator, 22.10.: "build it so it is a real advantage for $BOBAI and the ecosystem". Nothing anywhere counted
// $BOBAI's holders (the terminal's "Holders" were the NFT's). This is the one source: every address that holds
// $BOBAI, its balance, and whether it is a person or a contract — the pool, the burn address, routers and lockers are
// contracts and never counted as holders. Our own wallets hold $BOBAI and count as holders like anyone (operator,
// 22.10.), unmarked; only a crossing of the pass line by one of them is never recorded as a new holder.
//
//   the seed     scripts/holders-seed.mjs: every address that ever appeared in a Transfer since the deployment
//                (block 88,987,679, 2026-03-27 06:35 UTC), each balance read with balanceOf at one block
//   the tick     every quarter hour: the Transfer logs since the last block, applied; a new address is asked once
//                whether it has code. A person crossing 1,000,000 $BOBAI is recorded as a crossing (with its tx).
//   the day      at the first tick of a UTC day, one point of history: holders, 1M+ holders, the bands
//
//   holders:state     { block, bal: { addr: wei string }, code: { addr: 1 } }
//   holders:history   [{ day, holders, holders_1m, bands }] (a year)
//   holders:crossings [{ at, address, balance, block, tx }] (the last 100)

import { OWN_WALLETS } from './own-wallets.js';

export const BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const STATE = 'holders:state', HISTORY = 'holders:history', CROSSINGS = 'holders:crossings';
export const PASS_LINE = 10n ** 6n * 10n ** 18n;   // 1,000,000 $BOBAI, the holder pass (holder-pass.js)
const E18 = 10n ** 18n;
export const BANDS = [[1e6, null], [5e5, 1e6], [1e5, 5e5], [1e4, 1e5], [0, 1e4]];
const MAX_BLOCKS_A_TICK = 20000, CHUNK = 5000, CONFIRMATIONS = 3;
const DEAD = /^0x0{36}dead$|^0x0{40}$/i;

const toUnits = (wei) => Number(BigInt(wei) / 10n ** 14n) / 1e4;

// pure: the holders view of a state (pinned in scripts/holders-check.mjs)
export function summarize(state) {
  const people = [];
  for (const [a, w] of Object.entries(state.bal || {})) {
    if (BigInt(w) <= 0n || state.code?.[a] || DEAD.test(a)) continue;
    people.push([a, BigInt(w)]);
  }
  people.sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0));
  const bands = BANDS.map(([lo, hi]) => ({ from: lo, to: hi, holders: people.filter(([, w]) => w >= BigInt(lo) * E18 && (hi == null || w < BigInt(hi) * E18)).length }));
  return { holders: people.length, holders_1m: people.filter(([, w]) => w >= PASS_LINE).length, bands, people };
}

// pure: apply decoded transfers [{ from, to, value (bigint), block, tx }] to a balance map; returns the crossings of
// the pass line by people (not contracts, not ours) — counted only upward, once per transfer that carries it over
export function applyTransfers(bal, transfers, isContract = () => false) {
  const crossed = [];
  for (const t of transfers) {
    for (const [a, d] of [[t.from, -t.value], [t.to, t.value]]) {
      const before = BigInt(bal[a] || '0'), after = before + d;
      bal[a] = String(after);
      if (d > 0n && before < PASS_LINE && after >= PASS_LINE && !isContract(a) && !OWN_WALLETS.has(a) && !DEAD.test(a)) crossed.push({ address: a, balance: toUnits(after), block: t.block, tx: t.tx });
    }
  }
  return crossed;
}

const rpcOf = (env) => async (body) => {
  const urls = [env.BSC_RPC_KEYED_URL_2, 'https://bsc-rpc.publicnode.com'].filter(Boolean);
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }).then((x) => x.json());
      if (Array.isArray(body) ? Array.isArray(r) && body.every((_, i) => r.some((y) => y.id === i && y.result !== undefined)) : r.result !== undefined) return r;
    } catch { /* next */ }
  }
  return null;
};

export async function holdersTick(env, { now = new Date() } = {}) {
  const state = JSON.parse((await env.AGENT.get(STATE)) || 'null');
  if (!state) return { ok: false, error: 'not seeded' };
  const rpc = rpcOf(env);
  const headR = await rpc({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] });
  if (!headR) return { ok: false, error: 'no block number' };
  const head = Number(headR.result) - CONFIRMATIONS;
  const until = Math.min(head, state.block + MAX_BLOCKS_A_TICK);
  const transfers = [];
  for (let b = state.block + 1; b <= until; b += CHUNK) {
    const to = Math.min(until, b + CHUNK - 1);
    const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: BOBAI, topics: [TRANSFER], fromBlock: '0x' + b.toString(16), toBlock: '0x' + to.toString(16) }] });
    if (!r) return { ok: false, error: `logs unread from block ${b}; nothing applied, read again next tick` };
    for (const l of r.result) transfers.push({ from: '0x' + l.topics[1].slice(26), to: '0x' + l.topics[2].slice(26), value: BigInt(l.data), block: Number(l.blockNumber), tx: l.transactionHash });
  }
  // a new address: asked once whether it has code
  const fresh = [...new Set(transfers.flatMap((t) => [t.from, t.to]))].filter((a) => !(a in state.bal) && !(a in (state.code || {})));
  state.code ||= {};
  for (let i = 0; i < fresh.length; i += 50) {
    const part = fresh.slice(i, i + 50);
    const r = await rpc(part.map((a, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_getCode', params: [a, 'latest'] })));
    if (!r) return { ok: false, error: 'code unread; nothing applied, read again next tick' };
    for (const x of r) if (x.result && x.result !== '0x') state.code[part[x.id]] = 1;
  }
  const crossed = applyTransfers(state.bal, transfers, (a) => !!state.code[a]);
  for (const [a, w] of Object.entries(state.bal)) if (w === '0') delete state.bal[a];
  state.block = until;
  state.at = now.toISOString();
  await env.AGENT.put(STATE, JSON.stringify(state));
  if (crossed.length) {
    const prev = JSON.parse((await env.AGENT.get(CROSSINGS)) || '[]');
    await env.AGENT.put(CROSSINGS, JSON.stringify([...crossed.map((c) => ({ at: now.toISOString(), ...c })), ...prev].slice(0, 100)));
  }
  const day = now.toISOString().slice(0, 10);
  const hist = JSON.parse((await env.AGENT.get(HISTORY)) || '[]');
  if (!hist.length || hist[hist.length - 1].day !== day) {
    const s = summarize(state);
    hist.push({ day, block: state.block, holders: s.holders, holders_1m: s.holders_1m, bands: s.bands.map((x) => x.holders) });
    await env.AGENT.put(HISTORY, JSON.stringify(hist.slice(-366)));
  }
  return { ok: true, block: state.block, transfers: transfers.length, new_addresses: fresh.length, crossed: crossed.length, behind: head - until };
}

export async function seedHolders(env, body) {
  if (!body || !Number(body.block) || typeof body.bal !== 'object') return { ok: false, error: 'block and bal required' };
  await env.AGENT.put(STATE, JSON.stringify({ block: Number(body.block), bal: body.bal, code: body.code || {}, at: new Date().toISOString(), seeded_at: new Date().toISOString() }));
  return { ok: true, block: Number(body.block), addresses: Object.keys(body.bal).length, contracts: Object.keys(body.code || {}).length };
}

// GET /holders[?address=0x…]
export async function readHolders(env, address = null) {
  const [state, hist, crossings] = await Promise.all([STATE, HISTORY, CROSSINGS].map(async (k) => JSON.parse((await env.AGENT.get(k)) || 'null')));
  if (!state) return null;
  const s = summarize(state);
  const out = {
    block: state.block, read_at: state.at, holders: s.holders, holders_1m: s.holders_1m,
    bands: s.bands, top: s.people.slice(0, 25).map(([a, w], i) => ({ rank: i + 1, address: a, bobai: toUnits(w) })),
    history: (hist || []).slice(-90), crossings_1m: (crossings || []).slice(0, 20),
  };
  if (address) {
    const a = String(address).toLowerCase(), w = BigInt(state.bal[a] || '0');
    const idx = s.people.findIndex(([x]) => x === a);
    out.address = { address: a, bobai: toUnits(w), rank: idx >= 0 ? idx + 1 : null, of: s.holders, contract: !!state.code?.[a], holder_pass: w >= PASS_LINE, short_of_pass: w >= PASS_LINE ? 0 : toUnits(PASS_LINE - w) };
  }
  return out;
}
