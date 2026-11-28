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
export async function projectsTick(env, signers, { rpc = rpcOf(env), head: headIn = null } = {}) {
  const st = JSON.parse((await env.AGENT.get(KEY)) || 'null') || emptyProjects();
  let budget = MAX_REQUESTS_A_TICK;
  const ask = async (body) => { if (budget <= 0) return null; budget--; return rpc(body); };
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
  const moved = {};
  for (const [c, p] of order) {
    while (p.block < head && budget > 3) {
      // a busy contract can return more logs than a node gives in one answer: the span halves on a refusal (down to
      // MIN_SPAN) and grows back after an answer, so one crowded range never stops the count for good
      const span = p.span || CHUNK;
      const a = p.block + 1, b = Math.min(head, a + span - 1);
      const r = await ask({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: c, fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16) }] });
      if (!r || !Array.isArray(r.result)) { p.span = Math.max(MIN_SPAN, Math.floor(span / 2)); break; }
      p.span = Math.min(CHUNK, span * 2);
      const hashes = [...new Set(r.result.map((l) => l.transactionHash))];
      const froms = await sendersOf(ask, hashes);
      if (!froms) break; // a transaction lookup unanswered: the chunk stays unread
      const fresh = [...new Set(froms)].filter((f) => !(f in p.seen));
      const holds = await agentIdsOf(ask, fresh);
      if (!holds) break;
      for (const f of fresh) {
        if (Object.keys(p.seen).length >= MAX_SEEN) break;
        p.seen[f] = holds[f] ? 1 : 0;
        if (holds[f]) p.agent_ids.push(f);
      }
      p.txs += hashes.length;
      p.senders = Object.keys(p.seen).length;
      p.block = b;
      moved[c] = (moved[c] || 0) + (b - a + 1);
    }
  }
  st.at = new Date().toISOString();
  await env.AGENT.put(KEY, JSON.stringify(st));
  return { ok: true, head, contracts: order.length, moved, requests_left: budget };
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
      limits: 'Free BNB Chain nodes keep event logs for ~40,000 blocks (5-6 h): a count starts at most that long before the listing and never covers earlier days. A contract without events is not seen. Not the official ranking.',
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
