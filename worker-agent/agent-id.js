// THE AGENT ID BOOK (2026-11-27, operator: "mach uns hier zu den top 3" - Binance Wallet Agent ID Hackathon).
// BobaiAgentIdBook on BNB Chain (agentid/src/BobaiAgentIdBook.sol, no owner, no fees, rejects BNB): only a wallet that
// holds a SPACE ID Agent ID (one per Binance user, non-transferable) can
//   sign   take the next numbered place with a note of up to 140 bytes (a later call changes the note), and
//   vouch  for an ERC-8004 agent, one vouch per person per agent, withdrawable, never for an agent it owns.
// Because an Agent ID is one per person, an agent's vouch count is a count of people, not of wallets.
//
// This worker only READS: every 15 minutes it reads the contract's events from BNB Chain (the same log reader as the
// holder index) and keeps a summary; nothing here can write to the chain or hold a key.
//
//   GET /agent-id                    the book (places + notes), the agents people vouch for, the last events, the block
//   GET /agent-id/agent/<id>         one agent: how many people vouch for it, and who
//   GET /agent-id/how                the steps for a person (any EIP-1193 wallet) and for an agent (Agentic Wallet)
//   GET /agent-id/tx?action=sign&note=...        the ready transaction: to, data, value 0, and the baw command
//   GET /agent-id/tx?action=vouch&agent=<id>&on=1|0
//   GET /agent-id/check/<address>    does this address hold an Agent ID, has it signed, how many agents it vouches for
import { logsOf, rpcOf } from './holders.js';

export const BOOK = '0xEc2f55eD6b2304Bc4496f7b8E9Ab11B3Dae4C3ca';
export const AGENT_ID_NFT = '0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F';
export const BOOK_DEPLOY_BLOCK = 136027484;
const T_SIGNED = '0x95812dd7b1ec8af26cc5f8e3cf0cc8f56ad6b6bad9817afadc48ec4d230a68f0';
const T_NOTE = '0x3750441248c2019c3608fbf889b361fe2ebe612036c8a3eb002b4a431f62a392';
const T_VOUCH = '0x312b3fc4b910a285305f2eb7cef375fe33d11df028cbf3aa83cdca007865e7fb';
const SEL_SIGN = '0x79d6348d', SEL_VOUCH = '0x46e22e2b', SEL_BAL = '0x70a08231', SEL_ENTRY = '0x58bb388a', SEL_VCOUNT = '0xc9fff45c';
const STATE = 'aid:state';
const CONFIRMATIONS = 3, MAX_BLOCKS_A_TICK = 40000, CHUNK = 5000, RECENT = 40;
const READ_RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-rpc.publicnode.com'];

const J = (body, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' } });
const addr = (topic) => '0x' + topic.slice(26).toLowerCase();
const hexToBig = (h) => BigInt(h && h !== '0x' ? h : '0x0');
const pad = (hex) => hex.replace(/^0x/, '').padStart(64, '0');

// the string an event or a call returned (abi: offset, length, bytes)
export function abiString(data, word = 0) {
  const h = data.replace(/^0x/, '');
  const off = Number(BigInt('0x' + h.slice(word * 64, word * 64 + 64))) * 2;
  const len = Number(BigInt('0x' + h.slice(off, off + 64)));
  const bytes = h.slice(off + 64, off + 64 + len * 2);
  return new TextDecoder().decode(Uint8Array.from(bytes.match(/../g) || [], (b) => parseInt(b, 16)));
}
// calldata for sign(note): the note as UTF-8, at most 140 bytes (the contract refuses more)
export function signData(note) {
  const b = new TextEncoder().encode(String(note ?? ''));
  if (b.length > 140) return { error: `note: ${b.length} bytes, the contract takes at most 140` };
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const body = hex.padEnd(Math.ceil(hex.length / 64) * 64 || 0, '0');
  return { data: SEL_SIGN + pad('20') + pad(b.length.toString(16)) + body };
}
export function vouchData(agent, on) {
  if (!/^\d{1,12}$/.test(String(agent))) return { error: 'agent: an ERC-8004 agent id (a number)' };
  return { data: SEL_VOUCH + pad(BigInt(agent).toString(16)) + pad(on ? '1' : '0') };
}

// one event into the summary; events arrive in chain order
export function applyEvent(state, log) {
  const t = log.topics[0], holder = addr(log.topics[1]), block = Number(log.blockNumber), tx = log.transactionHash;
  if (t === T_SIGNED || t === T_NOTE) {
    const place = Number(hexToBig(log.topics[2])), note = abiString(log.data);
    const prev = state.signers[holder];
    state.signers[holder] = { place, note, signed_block: prev?.signed_block ?? block, signed_tx: prev?.signed_tx ?? tx, updated_block: block };
    state.recent.unshift({ kind: t === T_SIGNED ? 'signed' : 'note', holder, place, note, block, tx });
  } else if (t === T_VOUCH) {
    const agent = String(hexToBig(log.topics[2]));
    const h = log.data.replace(/^0x/, '');
    const on = hexToBig('0x' + h.slice(0, 64)) === 1n, count = Number(hexToBig('0x' + h.slice(64, 128)));
    const v = state.vouches[agent] || { count: 0, by: [] };
    v.by = v.by.filter((x) => x !== holder);
    if (on) v.by.push(holder);
    v.count = count;
    if (v.count) state.vouches[agent] = v; else delete state.vouches[agent];
    state.recent.unshift({ kind: on ? 'vouched' : 'withdrew', holder, agent, count, block, tx });
  } else return;
  state.holders[holder] = (state.holders[holder] || 0) + 1;
  state.recent = state.recent.slice(0, RECENT);
}

const empty = () => ({ block: BOOK_DEPLOY_BLOCK - 1, signers: {}, vouches: {}, holders: {}, recent: [], events: 0 });

export async function agentIdTick(env) {
  const state = JSON.parse((await env.AGENT.get(STATE)) || 'null') || empty();
  const rpc = rpcOf(env);
  const headR = await rpc({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] });
  if (!headR) return { ok: false, error: 'no block number' };
  const head = Number(headR.result) - CONFIRMATIONS;
  const until = Math.min(head, state.block + MAX_BLOCKS_A_TICK);
  let read = state.block;
  for (let a = state.block + 1; a <= until; a += CHUNK) {
    const b = Math.min(until, a + CHUNK - 1);
    const logs = await logsOf(env, rpc, { address: BOOK }, a, b, head);
    if (!Array.isArray(logs)) break; // unread: asked again next tick, never applied as empty
    logs.sort((x, y) => Number(x.blockNumber) - Number(y.blockNumber) || Number(x.logIndex) - Number(y.logIndex));
    for (const l of logs) { applyEvent(state, l); state.events++; }
    read = b;
  }
  const moved = read - state.block;
  state.block = read;
  state.at = new Date().toISOString();
  await env.AGENT.put(STATE, JSON.stringify(state));
  return { ok: true, block: read, moved, head, signers: Object.keys(state.signers).length, agents_vouched: Object.keys(state.vouches).length };
}

async function call(to, data) {
  for (const u of READ_RPCS) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }), signal: AbortSignal.timeout(10000) }).then((x) => x.json());
      if (typeof r.result === 'string') return r.result;
    } catch { /* next */ }
  }
  return null;
}

const HOW = {
  what: 'BobaiAgentIdBook on BNB Chain: only a wallet holding a SPACE ID Agent ID (one per Binance user, non-transferable) can sign the book or vouch for an ERC-8004 agent. One vouch per person per agent, so a vouch count counts people. No owner, no fees, no approvals, rejects BNB; each write costs gas only.',
  contract: BOOK, chain: 'BNB Chain (56)', agent_id_nft: AGENT_ID_NFT, verified: `https://bscscan.com/address/${BOOK}#code`,
  person: [
    'Open https://brainonbnb.com/agent-id in a browser wallet (Binance Wallet app browser or extension, MetaMask, any EIP-1193 wallet).',
    'Connect: the page reads whether your address holds an Agent ID (balanceOf on the Agent ID contract).',
    'Sign the book with a note, and/or vouch for agents by their ERC-8004 id. Your wallet shows the transaction; you confirm it.',
  ],
  agent_with_agentic_wallet: [
    'GET https://agent.brainonbnb.com/agent-id/check/<your address>: holds_agent_id must be true.',
    'GET https://agent.brainonbnb.com/agent-id/tx?action=sign&note=<text> or ?action=vouch&agent=<id>&on=1 : the ready transaction and the baw command.',
    'Run the baw contract-call preview it gives, read the preview, then baw contract-call execute --requestId <id>.',
  ],
  read: { book: 'GET https://agent.brainonbnb.com/agent-id', one_agent: 'GET https://agent.brainonbnb.com/agent-id/agent/<id>', on_chain: 'signerCount(), signers(start,count), entryOf(address), vouchCount(agentId), vouched(agentId,address)' },
};

export async function handleAgentId(request, env, path, url) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type' } });
  if (path === '/agent-id/tick' && request.method === 'POST') {
    if (!env.HIT_SECRET || request.headers.get('x-hit-secret') !== env.HIT_SECRET) return J({ error: 'unauthorized' }, 401);
    return J(await agentIdTick(env));
  }
  if (request.method !== 'GET') return J({ error: 'read-only: GET' }, 405);
  const state = JSON.parse((await env.AGENT.get(STATE)) || 'null') || empty();
  if (path === '/agent-id' || path === '/agent-id/') {
    const book = Object.entries(state.signers).map(([holder, e]) => ({ place: e.place, holder, note: e.note, signed_block: e.signed_block, signed_tx: e.signed_tx, updated_block: e.updated_block })).sort((a, b) => a.place - b.place);
    const agents = Object.entries(state.vouches).map(([agent, v]) => ({ agent: Number(agent), people: v.count, by: v.by })).sort((a, b) => b.people - a.people || a.agent - b.agent);
    return J({
      what_this_is: 'The BOBAI Agent ID Book, read from BNB Chain: who signed (Agent ID holders only) and which ERC-8004 agents real people vouch for.',
      contract: BOOK, chain: 'eip155:56', read_to_block: state.block, read_at: state.at || null,
      agent_id_holders_interacting: Object.keys(state.holders).length, transactions: state.events,
      signers: book.length, book, agents_vouched: agents.length, agents, recent: state.recent,
      how: 'https://agent.brainonbnb.com/agent-id/how', page: 'https://brainonbnb.com/agent-id',
    });
  }
  if (path === '/agent-id/how') return J(HOW);
  let m = path.match(/^\/agent-id\/agent\/(\d{1,12})$/);
  if (m) {
    const v = state.vouches[m[1]] || { count: 0, by: [] };
    const live = await call(BOOK, SEL_VCOUNT + pad(BigInt(m[1]).toString(16)));
    return J({ agent: Number(m[1]), people: live != null ? Number(hexToBig(live)) : v.count, by: v.by, read_to_block: state.block, live_from_chain: live != null });
  }
  m = path.match(/^\/agent-id\/check\/(0x[0-9a-fA-F]{40})$/);
  if (m) {
    const a = m[1].toLowerCase();
    const [bal, entry] = await Promise.all([call(AGENT_ID_NFT, SEL_BAL + pad(a)), call(BOOK, SEL_ENTRY + pad(a))]);
    if (bal == null) return J({ error: 'BNB Chain did not answer, try again' }, 503);
    const place = entry ? Number(hexToBig('0x' + entry.slice(2, 66))) : null;
    const vouchesFor = Object.entries(state.vouches).filter(([, v]) => v.by.includes(a)).map(([k]) => Number(k));
    return J({ address: a, holds_agent_id: hexToBig(bal) > 0n, place: place || null, note: place ? abiString(entry, 3) : null, vouches_for: vouchesFor, read_to_block: state.block });
  }
  if (path === '/agent-id/tx') {
    const action = url.searchParams.get('action');
    const built = action === 'sign' ? signData(url.searchParams.get('note') ?? '') : action === 'vouch' ? vouchData(url.searchParams.get('agent'), url.searchParams.get('on') !== '0') : { error: 'action: sign or vouch' };
    if (built.error) return J({ error: built.error }, 400);
    const from = url.searchParams.get('from');
    return J({
      to: BOOK, value: '0', data: built.data, chain_id: 56,
      baw_preview: `baw contract-call preview --binanceChainId 56 --from ${/^0x[0-9a-fA-F]{40}$/.test(from || '') ? from : '<your agentic wallet address>'} --to ${BOOK} --value 0 --inputData ${built.data} --json`,
      baw_execute: 'baw contract-call execute --requestId <requestId from the preview> --json',
      note: 'Only a wallet holding an Agent ID can send this; any other reverts with NoAgentId(). Gas only, no value, no approval.',
    });
  }
  return J({ error: 'not found', see: 'https://agent.brainonbnb.com/agent-id/how' }, 404);
}
