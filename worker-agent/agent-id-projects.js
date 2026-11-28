// AGENT ID PROJECTS (2026-11-28, operator: "ja, mach 1" - the 30 Agent ID addresses for the Agent ID Hackathon).
// Every project of the hackathon is ranked (Pioneer Award) by how many Agent ID addresses interact with its contracts,
// and none of them can see that number. This counts it, live and in the open:
//   a project lists itself by signing the Agent ID Book with a note that names its contract(s), e.g.
//   "My Project 0x1234…abcd" (up to 3 addresses, the note is at most 140 bytes);
//   from then on, every 15 minutes, the worker reads that contract's events, takes the sender (tx.from) of each
//   transaction behind them, and asks the Agent ID contract (balanceOf) whether the sender holds an Agent ID.
// Our own contracts ($BOBAI and the Book) are always counted.
//
// HONEST LIMITS: free BNB Chain nodes keep event logs for only ~40,000 blocks (5-6 h) and answer older ranges with an
// empty list, no error (holders.js, FRESH_BLOCKS). So a count starts at most ~5 h before the listing and never claims
// the time before; `counting_since` says from where. A sender is counted once, by tx.from (who signed the transaction),
// so a router or an aggregator in between does not hide the person. Read-only: nothing here writes to the chain.
//
//   GET /agent-id/projects                every listed contract with its count
//   GET /agent-id/projects/<contract>     one contract: its count and the Agent ID addresses seen
import { rpcOf, FRESH_BLOCKS } from './holders.js';

export const OWN = [
  { contract: '0x245c386dcfed896f5c346107596141e5edcbffff', name: '$BOBAI token', own: true },
  { contract: '0xec2f55ed6b2304bc4496f7b8e9ab11b3dae4c3ca', name: 'BOBAI Agent ID Book', own: true },
];
const AGENT_ID_NFT = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f';
const SEL_BAL = '0x70a08231';
const KEY = 'aid:proj';
const CHUNK = 5000, MIN_SPAN = 50, CONFIRMATIONS = 3;
// a tick's budget, shared by every contract: the cron runs other work in the same invocation (1,000 subrequests)
const MAX_REQUESTS_A_TICK = 120, MAX_PROJECTS = 60, MAX_CONTRACTS_A_NOTE = 3, TX_BATCH = 50, BAL_BATCH = 50;
const MAX_SEEN = 50000; // senders kept per contract (each checked once); past it the count goes on, new senders are not checked

// THE DAYS SINCE THE START (2026-11-28, operator: "stell den Zähler um"): the hackathon counts from 18 Nov, and the free
// nodes only gave the last ~5 h, so every count started at its listing. NodeReal (BSC_RPC_KEYED_URL, an archive) gives
// the old logs. Each contract now has a second cursor (back) that reads from the start block up to where the live count
// began; the live cursor is untouched, so a backfill never makes the live count fall behind. Measured 28.11. with our
// own key: 18 Nov 00:00 UTC = block 134211719 (timestamp read back), eth_getLogs up to 50,000 blocks a call (the worker's
// key was noted at 300 on 9.11., so the span halves on any refusal down to 300 and grows back after an answer).
// A busy contract would spend the key the NFT minter and the TG bot share: a backfill stops after 20,000 transactions
// and says so (backfill_capped), the count then covers what was read.
export const HACKATHON_START_BLOCK = 134211719;
const ARCHIVE_SPAN = 50000, ARCHIVE_MIN_SPAN = 300, MAX_BACKFILL_TXS = 20000;
const archiveOf = (env) => (env.BSC_RPC_KEYED_URL ? async (body) => {
  try { return await fetch(env.BSC_RPC_KEYED_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }).then((x) => x.json()); } catch { return null; }
} : null);

// the contracts a note names, in order, without repeats; the Book's own sign() note is plain text
export function contractsInNote(note) {
  const out = [];
  for (const m of String(note || '').matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)) {
    const a = m[0].toLowerCase();
    if (!out.includes(a) && a !== AGENT_ID_NFT) out.push(a);
    if (out.length === MAX_CONTRACTS_A_NOTE) break;
  }
  return out;
}
// the project's name: the note without its addresses, trimmed to one line
export function nameInNote(note) {
  return String(note || '').replace(/0x[0-9a-fA-F]{40}/g, ' ').replace(/[\s·|,;:–—-]+$/g, '').replace(/^[\s·|,;:–—-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || null;
}

export const emptyProjects = () => ({ contracts: {}, at: null });
const pad = (hex) => hex.replace(/^0x/, '').padStart(64, '0');

// listings from the Book's signers (state.signers of agent-id.js): contract -> who listed it, first come first kept
export function listingsOf(signers) {
  const out = {};
  for (const o of OWN) out[o.contract] = { name: o.name, own: true, by: null, place: null };
  const bySigned = Object.entries(signers || {}).sort((a, b) => a[1].place - b[1].place);
  for (const [holder, e] of bySigned) {
    for (const c of contractsInNote(e.note)) {
      if (out[c] || Object.keys(out).length >= MAX_PROJECTS + OWN.length) continue;
      out[c] = { name: nameInNote(e.note), own: false, by: holder, place: e.place, listed_block: e.updated_block };
    }
  }
  return out;
}

// one tick: list from the Book, then read each contract forward; budgeted, never applies an unread range as empty
export async function projectsTick(env, signers, { rpc = rpcOf(env), archive = archiveOf(env), head: headIn = null } = {}) {
  const st = JSON.parse((await env.AGENT.get(KEY)) || 'null') || emptyProjects();
  let budget = MAX_REQUESTS_A_TICK;
  const ask = async (body) => { if (budget <= 0) return null; budget--; return rpc(body); };
  const askA = archive ? async (body) => { if (budget <= 0) return null; budget--; return archive(body); } : null;
  let head = headIn;
  if (head == null) { const h = await ask({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }); if (!h) return { ok: false, error: 'no block number' }; head = Number(h.result) - CONFIRMATIONS; }
  const listed = listingsOf(signers);
  for (const [c, l] of Object.entries(listed)) {
    const p = st.contracts[c];
    if (!p) {
      // a new listing: is it a contract? (an EOA in a note is not a project)
      const code = await ask({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [c, 'latest'] });
      if (!code) continue; // unread: asked again next tick
      if (!code.result || code.result === '0x') { st.contracts[c] = { ...l, not_a_contract: true }; continue; }
      st.contracts[c] = { ...l, since_block: head - FRESH_BLOCKS + 1, block: head - FRESH_BLOCKS, txs: 0, senders: 0, agent_ids: [], seen: {} };
    } else if (!p.not_a_contract) Object.assign(p, { name: l.name, by: l.by, place: l.place, own: l.own });
  }
  // the contracts that fell out of every note are kept (their count is history), but no longer read
  const order = Object.entries(st.contracts).filter(([c, p]) => listed[c] && !p.not_a_contract).sort((a, b) => a[1].block - b[1].block);
  // one chunk [a, b] of contract c: its senders counted into p; 'ok', 'unread' (a node did not answer: nothing applied)
  // or 'wide' (more transactions than this tick can still look up: nothing applied, read narrower)
  const readChunk = async (c, p, a, b, logsAsk, txAsk) => {
    const r = await logsAsk({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: c, fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16) }] });
    if (r?.error) return { s: 'refused' }; // an answer ("exceed maximum block range"): narrower at once
    if (!r || !Array.isArray(r.result)) return { s: 'unread' };
    const hashes = [...new Set(r.result.map((l) => l.transactionHash))];
    if (Math.ceil(hashes.length / TX_BATCH) + Math.ceil(hashes.length / BAL_BATCH) > budget - 1) return { s: 'wide', n: hashes.length };
    const froms = await sendersOf(txAsk, hashes);
    if (!froms) return { s: 'unread' }; // a transaction lookup unanswered: the chunk stays unread
    const fresh = [...new Set(froms)].filter((f) => !(f in p.seen));
    const holds = await agentIdsOf(ask, fresh);
    if (!holds) return { s: 'unread' };
    for (const f of fresh) {
      if (Object.keys(p.seen).length >= MAX_SEEN) break;
      p.seen[f] = holds[f] ? 1 : 0;
      if (holds[f]) p.agent_ids.push(f);
    }
    p.txs += hashes.length;
    p.senders = Object.keys(p.seen).length;
    return { s: 'ok', n: hashes.length };
  };
  const moved = {}, back = {};
  // the live count first, so it stays at the head
  for (const [c, p] of order) {
    while (p.block < head && budget > 3) {
      // a busy contract can return more logs than a node gives in one answer: the span halves on a refusal (down to
      // MIN_SPAN) and grows back after an answer, so one crowded range never stops the count for good
      const span = p.span || CHUNK;
      const a = p.block + 1, b = Math.min(head, a + span - 1);
      const got = await readChunk(c, p, a, b, ask, ask);
      if (got.s !== 'ok') { p.span = Math.max(MIN_SPAN, Math.floor(span / 2)); break; }
      p.span = Math.min(CHUNK, span * 2);
      p.block = b;
      moved[c] = (moved[c] || 0) + (b - a + 1);
    }
  }
  // then the days since the start, from the archive, with what the tick has left
  if (askA) {
    for (const [c, p] of order) {
      if (!p.back && p.since_block > HACKATHON_START_BLOCK) p.back = { from: HACKATHON_START_BLOCK, to: p.since_block - 1, block: HACKATHON_START_BLOCK - 1, txs: 0, span: ARCHIVE_SPAN };
      const k = p.back;
      if (!k || k.done || k.capped) continue;
      k.span = Math.min(k.span, st.archive_span || ARCHIVE_SPAN);
      while (k.block < k.to && budget > 3) {
        const a = k.block + 1, b = Math.min(k.to, a + k.span - 1);
        const got = await readChunk(c, p, a, b, askA, askA);
        if (got.s !== 'ok') {
          // the node away: again next tick; a refused range or too many transactions for what is left: narrower at once
          if (got.s === 'unread') break;
          // a refused range is the node's limit: kept for every contract (st.archive_span), so it is not asked again
          if (got.s === 'refused') st.archive_span = Math.max(ARCHIVE_MIN_SPAN, Math.floor(k.span / 2));
          if (k.span > ARCHIVE_MIN_SPAN) { k.span = Math.max(ARCHIVE_MIN_SPAN, Math.floor(k.span / 2)); continue; }
          if (got.s === 'refused') break;
          // 300 blocks and still more transactions than this tick can look up: a full tick may manage, a bigger one never
          if (Math.ceil(got.n / TX_BATCH) + Math.ceil(got.n / BAL_BATCH) > MAX_REQUESTS_A_TICK - 5) { k.capped = `blocks ${a}-${b} hold ${got.n.toLocaleString('en-US')} transactions, more than one read can look up`; }
          break;
        }
        k.span = Math.min(st.archive_span || ARCHIVE_SPAN, k.span * 2);
        k.block = b; k.txs += got.n;
        back[c] = (back[c] || 0) + (b - a + 1);
        if (k.txs >= MAX_BACKFILL_TXS && k.block < k.to) { k.capped = `over ${MAX_BACKFILL_TXS.toLocaleString('en-US')} transactions read`; break; }
      }
      if (k.block >= k.to) { k.done = true; p.since_block = k.from; }
    }
  }
  st.at = new Date().toISOString();
  await env.AGENT.put(KEY, JSON.stringify(st));
  return { ok: true, head, contracts: order.length, moved, backfilled: back, requests_left: budget };
}

// A LOOK BEFORE SIGNING (2026-11-28, operator: "ja, mach 1 und 2" — builders reached on X and Binance Square): a builder
// types a contract and sees its Agent ID addresses since the start at once, before paying gas to list it. One read from
// the archive, at most PREVIEW_MAX_TXS transactions (past them: what was read, said as partial), kept an hour per
// contract at the edge; a caller gets PREVIEW_PER_HOUR fresh reads an hour (a kept answer is free). Nothing is stored
// on the list: only signing the book lists a contract.
const PREVIEW_MAX_TXS = 2000, PREVIEW_PER_HOUR = 20;
export async function previewCount(env, contract, { rpc = rpcOf(env), archive = archiveOf(env), head: headIn = null } = {}) {
  const c = String(contract || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(c)) return { status: 400, body: { error: 'contract: 0x and 40 hex characters' } };
  if (c === AGENT_ID_NFT) return { status: 400, body: { error: 'that is the Agent ID contract itself, not a project' } };
  if (!archive) return { status: 503, body: { error: 'the archive node is not set on this worker' } };
  let budget = MAX_REQUESTS_A_TICK;
  const ask = async (f, body) => { if (budget <= 0) return null; budget--; return f(body); };
  const code = await ask(rpc, { jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [c, 'latest'] });
  if (!code) return { status: 503, body: { error: 'BNB Chain did not answer; try again in a minute' } };
  if (!code.result || code.result === '0x') return { status: 422, body: { error: 'no contract at this address (a wallet?)', contract: c } };
  let head = headIn;
  if (head == null) { const h = await ask(rpc, { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }); if (!h) return { status: 503, body: { error: 'BNB Chain did not answer; try again in a minute' } }; head = Number(h.result) - CONFIRMATIONS; }
  const hashes = new Set();
  let span = ARCHIVE_SPAN, block = HACKATHON_START_BLOCK - 1, partial = false;
  while (block < head && budget > 10) {
    const a = block + 1, b = Math.min(head, a + span - 1);
    const r = await ask(archive, { jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: c, fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16) }] });
    if (r?.error && span > ARCHIVE_MIN_SPAN) { span = Math.max(ARCHIVE_MIN_SPAN, Math.floor(span / 2)); continue; }
    if (!r || !Array.isArray(r.result)) break;
    for (const l of r.result) hashes.add(l.transactionHash);
    block = b;
    if (hashes.size >= PREVIEW_MAX_TXS) { partial = block < head; break; }
  }
  if (block < head && !partial) return { status: 503, body: { error: 'the archive node did not answer in full; try again in a minute', contract: c } };
  const list = [...hashes].slice(0, PREVIEW_MAX_TXS);
  const froms = await sendersOf((b) => ask(archive, b), list);
  if (!froms) return { status: 503, body: { error: 'the archive node did not answer in full; try again in a minute', contract: c } };
  const senders = [...new Set(froms)];
  const holds = await agentIdsOf((b) => ask(rpc, b), senders);
  if (!holds) return { status: 503, body: { error: 'BNB Chain did not answer in full; try again in a minute', contract: c } };
  const ids = senders.filter((s) => holds[s]);
  return { status: 200, body: {
    contract: c, agent_id_addresses: ids.length, senders: senders.length, transactions: list.length,
    from_block: HACKATHON_START_BLOCK, to_block: block, complete: !partial,
    ...(partial ? { partial: `more than ${PREVIEW_MAX_TXS.toLocaleString('en-US')} transactions since the start: this counts them up to block ${block}; listed, the 15-minute read counts it in full (up to ${MAX_BACKFILL_TXS.toLocaleString('en-US')} transactions back, then live)` } : {}),
    agent_id_holders: ids,
    list_it: `sign the Agent ID Book with a note naming it, e.g. "My Project ${c}": https://brainonbnb.com/agent-id#projects (gas only)`,
    counted: 'tx.from of every transaction behind the contract\'s events since 18 Nov 2026 00:00 UTC, each sender once, today\'s balanceOf on the Agent ID contract. Not the official ranking.',
  } };
}
// the look as the worker serves it: kept an hour per contract, PREVIEW_PER_HOUR fresh reads per caller an hour
export async function handlePreview(request, env, url) {
  const c = String(url.searchParams.get('contract') || '').toLowerCase();
  const cache = caches.default, key = new Request(`https://agent.brainonbnb.com/__aid-preview/${c}`);
  if (/^0x[0-9a-f]{40}$/.test(c)) { const hit = await cache.match(key).catch(() => null); if (hit) return { status: 200, body: { ...(await hit.json()), kept: true } }; }
  const ip = request.headers.get('cf-connecting-ip') || 'none', hour = new Date().toISOString().slice(0, 13);
  const ik = new Request(`https://agent.brainonbnb.com/__aid-preview-ip/${encodeURIComponent(ip)}/${hour}`);
  const used = Number(await (await cache.match(ik).catch(() => null))?.text().catch(() => '0') || 0);
  if (used >= PREVIEW_PER_HOUR) return { status: 429, body: { error: `${PREVIEW_PER_HOUR} fresh looks an hour per caller; a contract looked up in the last hour is answered from the kept read` } };
  await cache.put(ik, new Response(String(used + 1), { headers: { 'cache-control': 'public, max-age=3600' } })).catch(() => {});
  const out = await previewCount(env, c);
  if (out.status === 200) await cache.put(key, new Response(JSON.stringify(out.body), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } })).catch(() => {});
  return out;
}

// tx.from of each hash, in batches; null when one batch did not answer in full
async function sendersOf(ask, hashes) {
  const out = [];
  for (let i = 0; i < hashes.length; i += TX_BATCH) {
    const part = hashes.slice(i, i + TX_BATCH);
    const r = await ask(part.map((h, id) => ({ jsonrpc: '2.0', id, method: 'eth_getTransactionByHash', params: [h] })));
    if (!Array.isArray(r) || r.length < part.length) return null;
    for (const x of r) { if (!x?.result?.from) return null; out.push(x.result.from.toLowerCase()); }
  }
  return out;
}
// address -> holds an Agent ID (balanceOf > 0), in batches; null when one batch did not answer in full
async function agentIdsOf(ask, addrs) {
  const out = {};
  for (let i = 0; i < addrs.length; i += BAL_BATCH) {
    const part = addrs.slice(i, i + BAL_BATCH);
    const r = await ask(part.map((a, id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to: AGENT_ID_NFT, data: SEL_BAL + pad(a) }, 'latest'] })));
    if (!Array.isArray(r) || r.length < part.length) return null;
    for (const x of r) { if (typeof x?.result !== 'string') return null; out[part[x.id]] = BigInt(x.result === '0x' ? '0x0' : x.result) > 0n; }
  }
  return out;
}

const row = (c, p, head) => ({
  contract: c, name: p.name, own: Boolean(p.own), listed_by: p.by, place: p.place,
  ...(p.not_a_contract ? { not_a_contract: true } : {
    agent_id_addresses: p.agent_ids.length, senders: p.senders, transactions: p.txs,
    counting_since_block: p.since_block, read_to_block: p.block, behind_blocks: head != null ? Math.max(0, head - p.block) : null,
    // the days before the live count, while they are being read (or where a busy contract's read stopped)
    since_hackathon_start: p.since_block <= HACKATHON_START_BLOCK,
    ...(p.back && !p.back.done ? { backfill: { from_block: p.back.from, read_to_block: p.back.block, until_block: p.back.to, ...(p.back.capped ? { stopped: `${p.back.capped}: the count covers blocks ${p.back.from}-${p.back.block} and the live count from ${p.since_block}` } : {}) } } : {}),
  }),
  bscscan: `https://bscscan.com/address/${c}`,
});

export async function handleProjects(env, path) {
  const st = JSON.parse((await env.AGENT.get(KEY)) || 'null') || emptyProjects();
  const head = Math.max(0, ...Object.values(st.contracts).map((p) => p.block || 0));
  if (path === '/agent-id/projects' || path === '/agent-id/projects/') {
    const rows = Object.entries(st.contracts).map(([c, p]) => row(c, p, head))
      .sort((a, b) => (b.agent_id_addresses ?? -1) - (a.agent_id_addresses ?? -1) || (a.place ?? 0) - (b.place ?? 0));
    return {
      what_this_is: 'Live count of the Agent ID addresses (SPACE ID Agent ID holders) that send transactions to each listed contract on BNB Chain: the number the Agent ID Hackathon ranks projects by. Read from the chain every 15 minutes.',
      list_yours: 'Sign the Agent ID Book (gas only) with a note naming your project and contract, e.g. "My Project 0x1234…abcd" (up to 3 contracts, 140 bytes). Counting starts within 15 minutes. Sign: https://brainonbnb.com/agent-id or GET https://agent.brainonbnb.com/agent-id/tx?action=sign&note=<name%200x…>',
      how_counted: 'tx.from of every transaction behind the contract\'s events, each sender once, checked with balanceOf on the Agent ID contract 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F.',
      limits: `Counted from the hackathon start, 18 Nov 2026 00:00 UTC (block ${HACKATHON_START_BLOCK}): the days before a listing are read from an archive node after it (backfill, shown per project while it runs); a very busy contract's backfill stops after ${MAX_BACKFILL_TXS.toLocaleString('en-US')} transactions and says where. The Agent ID check is today's balanceOf. A contract without events is not seen. Not the official ranking.`,
      read_at: st.at, projects: rows,
    };
  }
  const m = path.match(/^\/agent-id\/projects\/(0x[0-9a-fA-F]{40})$/);
  if (m) {
    const c = m[1].toLowerCase(), p = st.contracts[c];
    if (!p) return { status: 404, body: { error: 'not listed', contract: c, list_yours: 'sign the Agent ID Book with a note naming this contract: https://brainonbnb.com/agent-id' } };
    return { ...row(c, p, head), agent_id_holders: p.agent_ids || [], read_at: st.at };
  }
  return null;
}
