// worker-agent/holders.js — every $BOBAI holder, kept by the worker from the chain (2026-10-22)
//
// Operator, 22.10.: "build it so it is a real advantage for $BOBAI and the ecosystem". Nothing anywhere counted
// $BOBAI's holders (the terminal's "Holders" were the NFT's). This is the one source: every address that holds
// $BOBAI, its balance, and whether it is a person or a contract — the pool, the burn address, routers and lockers are
// contracts and never counted as holders. Our own wallets are wallets like any other (operator, 22.10.: "treated like a
// normal wallet"), in the count and in the crossings, unmarked.
//
//   the seed     scripts/holders-seed.mjs: every address that ever appeared in a Transfer since the deployment
//                (block 88,987,679, 2026-03-27 06:35 UTC), each balance read with balanceOf at one block
//   the tick     every quarter hour: the Transfer logs since the last block, applied; a new address is asked once
//                whether it has code. A person crossing 1,000,000 $BOBAI is recorded as a crossing (with its tx).
//   the day      at the first tick of a UTC day, one point of history: holders, 1M+ holders, the bands
//
//   holders:state     { block, bal: { addr: wei string }, code: { addr: 1 } }
//   holders:history   [{ day, holders, holders_1m, bands }] (a year)
//   holders:crossings [{ at, seen_at, address, balance, block, tx }] (the last 100)
//
// at is the time of the block that carried the wallet over, never the tick that read it: from 31.10. to 3.11. the
// tick fell behind (20,000-60,000 blocks a day instead of ~192,000), caught up on 3.11. at 16:30 UTC and stamped three
// buys of 1.11. with that afternoon (operator, 4.11.: "I don't see it on chain"). seen_at is when the tick read it;
// state.behind is how many blocks the last tick left unread, shown on /holders as behind_blocks.

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
// the pass line by people (not contracts) — counted only upward, once per transfer that carries it over
export function applyTransfers(bal, transfers, isContract = () => false) {
  const crossed = [];
  for (const t of transfers) {
    for (const [a, d] of [[t.from, -t.value], [t.to, t.value]]) {
      const before = BigInt(bal[a] || '0'), after = before + d;
      bal[a] = String(after);
      if (d > 0n && before < PASS_LINE && after >= PASS_LINE && !isContract(a) && !DEAD.test(a)) crossed.push({ address: a, balance: toUnits(after), block: t.block, tx: t.tx });
    }
  }
  return crossed;
}

const post = async (u, body) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }).then((x) => x.json());
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
// A SECOND PROVIDER FOR THE LOG RANGES (2026-11-04): both entries above are publicnode, the only free provider serving
// 5,000-block getLogs. NodeReal (BSC_RPC_KEYED_URL, the key the NFT minter and the TG bot already use) caps log ranges
// at 300 blocks, so a chunk publicnode refused is read there in 300-block pieces; one piece unanswered, the chunk is
// unread as before. Without the secret on this worker nothing changes.
const NODEREAL_SPAN = 300;
// AN EMPTY ANSWER IS NOT AN ANSWER FOR OLD BLOCKS (2026-11-09): publicnode (both entries of rpcOf) keeps logs for only
// the last ~50,000-100,000 blocks (10-20 h) and answers an older range with an empty list, no error. When the tick fell
// behind (31.10.-3.11.) it caught up through those ranges and lost their transfers: 3 of the top 25 balances were
// below the chain on 9.11. (0xf738… 10.94M kept, 13.42M on chain). A range older than FRESH_BLOCKS is read at NodeReal
// only; without NodeReal it stays unread and is asked again next tick, never applied as empty.
export const FRESH_BLOCKS = 40000;
async function logsOf(env, rpc, filter, from, to, head = null) {
  const ask = (a, b) => ({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ ...filter, fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16) }] });
  const old = head != null && head - to > FRESH_BLOCKS;
  if (!old) { const r = await rpc(ask(from, to)); if (r) return r.result; }
  if (!env.BSC_RPC_KEYED_URL) return null;
  const out = [];
  for (let a = from; a <= to; a += NODEREAL_SPAN) {
    const p = await post(env.BSC_RPC_KEYED_URL, ask(a, Math.min(to, a + NODEREAL_SPAN - 1))).catch(() => null);
    if (!Array.isArray(p?.result)) return null;
    out.push(...p.result);
  }
  return out;
}

// the time of each block, read in one batch: { block: ISO }; a block that did not answer is left out
async function blockTimes(rpc, blocks) {
  const uniq = [...new Set(blocks.filter(Boolean))];
  if (!uniq.length) return {};
  const r = await rpc(uniq.map((b, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_getBlockByNumber', params: ['0x' + b.toString(16), false] })));
  const out = {};
  for (const x of r || []) if (x.result?.timestamp) out[uniq[x.id]] = new Date(Number(x.result.timestamp) * 1000).toISOString();
  return out;
}

export async function holdersTick(env, { now = new Date() } = {}) {
  const state = JSON.parse((await env.AGENT.get(STATE)) || 'null');
  if (!state) return { ok: false, error: 'not seeded' };
  const rpc = rpcOf(env);
  const headR = await rpc({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] });
  if (!headR) return { ok: false, error: 'no block number' };
  const head = Number(headR.result) - CONFIRMATIONS;
  let until = Math.min(head, state.block + MAX_BLOCKS_A_TICK);
  const transfers = [];
  // KEEP WHAT WAS READ (2026-11-04): a chunk that did not answer threw away the chunks read before it, so with one
  // provider refusing now and then the tick moved 20,000-60,000 blocks a day instead of ~192,000 (31.10.-3.11.). Now
  // the chunks read in order before the first failure are applied and the tick ends there; only a failure on the very
  // first chunk applies nothing. Nothing is skipped: the next tick starts at the first unread block.
  let partial = null;
  for (let b = state.block + 1; b <= until; b += CHUNK) {
    const to = Math.min(until, b + CHUNK - 1);
    const logs = await logsOf(env, rpc, { address: BOBAI, topics: [TRANSFER] }, b, to, head);
    if (!logs) {
      if (b === state.block + 1) return { ok: false, error: `logs unread from block ${b}; nothing applied, read again next tick` };
      until = b - 1; partial = `logs unread from block ${b}; applied up to ${until}, the rest next tick`; break;
    }
    for (const l of logs) transfers.push({ from: '0x' + l.topics[1].slice(26), to: '0x' + l.topics[2].slice(26), value: BigInt(l.data), block: Number(l.blockNumber), tx: l.transactionHash });
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
  state.behind = head - until;
  state.at = now.toISOString();
  await env.AGENT.put(STATE, JSON.stringify(state));
  // the crossings: stamped with their block's time; an older entry still stamped with the tick (before 4.11.) is
  // restamped once, its tick time kept as seen_at
  const prev = JSON.parse((await env.AGENT.get(CROSSINGS)) || '[]');
  let items = [...crossed.map((c) => ({ at: now.toISOString(), ...c })), ...prev];
  let stamped = 0;
  if (items.some((c) => !c.seen_at)) {
    const times = await blockTimes(rpc, items.filter((c) => !c.seen_at).map((c) => c.block));
    // a block whose time did not answer keeps its entry unstamped (at = the tick), tried again next tick
    items = items.map((c) => (c.seen_at || !times[c.block] ? c : (stamped++, { ...c, at: times[c.block], seen_at: c.at })));
  }
  if (crossed.length || stamped) await env.AGENT.put(CROSSINGS, JSON.stringify(items.slice(0, 100)));
  const day = now.toISOString().slice(0, 10);
  const hist = JSON.parse((await env.AGENT.get(HISTORY)) || '[]');
  if (!hist.length || hist[hist.length - 1].day !== day) {
    const s = summarize(state);
    hist.push({ day, block: state.block, holders: s.holders, holders_1m: s.holders_1m, bands: s.bands.map((x) => x.holders) });
    await env.AGENT.put(HISTORY, JSON.stringify(hist.slice(-366)));
  }
  return { ok: true, block: state.block, transfers: transfers.length, new_addresses: fresh.length, crossed: crossed.length, behind: head - until, ...(partial ? { partial } : {}) };
}

// THE REPAIR (2026-11-09): what the empty answers lost is read again at NodeReal, a few hundred blocks a piece, PIECES
// a quarter hour, from the seed (22.10.) to where the tick stood when the repair began. Every address seen there that
// the state does not know is kept; at the end every balance (known and found) is read again with balanceOf at the
// tick's own block, so the state equals the chain. First a probe: NodeReal must return the BOBAI transfers of a known
// buy (block 132,007,848, 6.11.); if it does not, nothing is changed and the status says so.
//   holders:backfill  { from, to, cursor, found: { addr: 1 }, probe, done, result }
const BACKFILL = 'holders:backfill', BACKFILL_FROM = 130400000, PROBE_BLOCK = 132007848, PIECES = 80;
export async function holdersBackfill(env, { pieces = PIECES } = {}) {
  let bf = JSON.parse((await env.AGENT.get(BACKFILL)) || 'null');
  if (bf?.done) return { ok: true, done: true, result: bf.result };
  if (!env.BSC_RPC_KEYED_URL) return { ok: false, error: 'no NodeReal secret on this worker' };
  const state = JSON.parse((await env.AGENT.get(STATE)) || 'null');
  if (!state) return { ok: false, error: 'not seeded' };
  const ask = (a, b) => ({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: BOBAI, topics: [TRANSFER], fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16) }] });
  if (!bf) {
    const p = await post(env.BSC_RPC_KEYED_URL, ask(PROBE_BLOCK, PROBE_BLOCK)).catch(() => null);
    const n = Array.isArray(p?.result) ? p.result.length : null;
    bf = { from: BACKFILL_FROM, to: state.block, cursor: BACKFILL_FROM, found: {}, probe: n, started: new Date().toISOString(), done: false };
    if (!(n > 0)) { bf.stopped = `NodeReal returned ${n == null ? 'no answer' : '0 logs'} for a block with known transfers; nothing changed`; await env.AGENT.put(BACKFILL, JSON.stringify(bf)); return { ok: false, error: bf.stopped }; }
  }
  if (bf.stopped) return { ok: false, error: bf.stopped };
  for (let i = 0; i < pieces && bf.cursor <= bf.to; i++) {
    const b = Math.min(bf.to, bf.cursor + NODEREAL_SPAN - 1);
    const p = await post(env.BSC_RPC_KEYED_URL, ask(bf.cursor, b)).catch(() => null);
    if (!Array.isArray(p?.result)) break; // unread: the same piece next quarter hour
    for (const l of p.result) for (const t of [l.topics[1], l.topics[2]]) { const a = '0x' + t.slice(26); if (!(a in state.bal) && !(a in (state.code || {})) && !DEAD.test(a)) bf.found[a] = 1; }
    bf.cursor = b + 1;
  }
  if (bf.cursor <= bf.to) { await env.AGENT.put(BACKFILL, JSON.stringify(bf)); return { ok: true, done: false, cursor: bf.cursor, to: bf.to, left_blocks: bf.to - bf.cursor + 1, found: Object.keys(bf.found).length }; }
  // the end: every balance again, at the tick's own block (the tick keeps running; state is re-read so nothing it did is lost)
  const now = JSON.parse((await env.AGENT.get(STATE)) || 'null');
  const rpc = rpcOf(env);
  const fresh = Object.keys(bf.found).filter((a) => !(a in now.bal) && !(a in (now.code || {})));
  for (let i = 0; i < fresh.length; i += 50) {
    const part = fresh.slice(i, i + 50);
    const r = await rpc(part.map((a, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_getCode', params: [a, 'latest'] })));
    if (!r) { await env.AGENT.put(BACKFILL, JSON.stringify(bf)); return { ok: false, error: 'code unread; the end runs again next quarter hour' }; }
    now.code ||= {};
    for (const x of r) if (x.result && x.result !== '0x') now.code[part[x.id]] = 1;
  }
  const all = [...new Set([...Object.keys(now.bal), ...fresh])], tag = '0x' + now.block.toString(16);
  const bal = {}; let changed = 0;
  for (let i = 0; i < all.length; i += 50) {
    const part = all.slice(i, i + 50);
    const r = await rpc(part.map((a, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_call', params: [{ to: BOBAI, data: '0x70a08231' + a.slice(2).padStart(64, '0') }, tag] })));
    if (!r) { await env.AGENT.put(BACKFILL, JSON.stringify(bf)); return { ok: false, error: 'balances unread; the end runs again next quarter hour' }; }
    for (const x of r) { const v = BigInt(x.result === '0x' ? 0 : x.result); const a = part[x.id]; if (v > 0n) bal[a] = String(v); if (String(v) !== (now.bal[a] || '0')) changed++; }
  }
  const before = summarize(now);
  now.bal = bal; now.repaired_at = new Date().toISOString();
  await env.AGENT.put(STATE, JSON.stringify(now));
  const after = summarize(now);
  bf.done = true; bf.result = { at: now.repaired_at, block: now.block, addresses: all.length, added: fresh.length, balances_changed: changed, holders_before: before.holders, holders_after: after.holders, holders_1m_before: before.holders_1m, holders_1m_after: after.holders_1m };
  await env.AGENT.put(BACKFILL, JSON.stringify(bf));
  return { ok: true, done: true, result: bf.result };
}
export async function readBackfill(env) { const bf = JSON.parse((await env.AGENT.get(BACKFILL)) || 'null'); if (!bf) return null; const { found, ...rest } = bf; return { ...rest, found: Object.keys(found || {}).length }; }
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
    block: state.block, read_at: state.at, behind_blocks: state.behind ?? null, holders: s.holders, holders_1m: s.holders_1m,
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
