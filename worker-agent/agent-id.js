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
const REGISTRY_8004 = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

// THE SCRIPT AN AGENTIC WALLET RUNS (2026-11-27): no dependencies (Node 18+), the key never leaves the wallet: every step
// goes through `baw ... preview` (shown to you) and only then `baw ... execute`. On Windows set BAW_JS to the CLI's
// dist/index.js (the npm shim mangles JSON arguments).
export const ONBOARD_SCRIPT = [
  '// onboard.mjs: BOBAI Agent ID Book for a Binance Agentic Wallet. WALLET=0x... NOTE="..." node onboard.mjs [--yes]',
  "import { execFileSync } from 'node:child_process'; import readline from 'node:readline/promises';",
  "const W = (process.env.WALLET || '').toLowerCase(), NOTE = process.env.NOTE || 'gm from an Agentic Wallet on BNB Chain', YES = process.argv.includes('--yes');",
  "if (!/^0x[0-9a-f]{40}$/.test(W)) { console.error('set WALLET=0x... (your Agentic Wallet)'); process.exit(1); }",
  "const API = 'https://agent.brainonbnb.com';",
  "const baw = (args) => JSON.parse(process.env.BAW_JS ? execFileSync(process.execPath, [process.env.BAW_JS, ...args, '--json']).toString() : execFileSync('baw', [...args, '--json'], { shell: process.platform === 'win32' }).toString());",
  "const ask = async (q) => { if (YES) return true; const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); const a = await rl.question(q + ' [y/N] '); rl.close(); return /^y/i.test(a); };",
  "const plan = await (await fetch(`${API}/agent-id/onboard?wallet=${W}&note=${encodeURIComponent(NOTE)}`)).json();",
  "if (plan.error) { console.error(plan.error); process.exit(1); }",
  "if (!plan.holds_agent_id) { console.log('No Agent ID on ' + W + '. Claim it: Binance App -> Wallet -> Agent ID banner. Then run this again.'); process.exit(0); }",
  "const s2 = plan.steps[1];",
  "if (!s2.done) {",
  "  const p = baw(['contract-call', 'preview', '--binanceChainId', '56', '--from', W, '--to', s2.tx.to, '--value', '0', '--inputData', s2.tx.data]);",
  "  console.log('Sign the Agent ID Book. Preview:', JSON.stringify({ risks: p.data?.risks?.riskDetails, balanceChanges: p.data?.simulationResult?.balanceChanges, simulation: p.data?.simulationResult?.simulationCode }));",
  "  if (!(await ask('Execute?'))) process.exit(0);",
  "  const x = baw(['contract-call', 'execute', '--requestId', p.data.requestId]); console.log('sent', x.data?.txHash);",
  "  for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 3000)); const c = await (await fetch(`${API}/agent-id/check/${W}`)).json(); if (c.place) { console.log('Your place: #' + c.place); break; } }",
  "} else console.log('Already in the book: place #' + s2.place);",
  "const issued = new Date().toISOString(), message = 'BOBAI holder pass\\nwallet: ' + W + '\\nissued: ' + issued;",
  "const typed = { types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }], Signed: [{ name: 'message', type: 'string' }] }, domain: { name: 'BOBAI Holder Pass', version: '1', chainId: 56 }, primaryType: 'Signed', message: { message } };",
  "const sp = baw(['sign-message', 'preview', '--binanceChainId', '56', '--signType', 'EIP712', '--message', JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_signTypedData_v4', params: [W, JSON.stringify(typed)] })]);",
  "console.log('Sign the free-answers pass (a signature, no transaction):', sp.data?.parsedMessage?.message);",
  "if (!(await ask('Sign?'))) process.exit(0);",
  "const sx = baw(['sign-message', 'execute', '--requestId', sp.data.requestId]);",
  "let sig = String(sx.data.signature).replace(/^0x/, ''); if (sig.length === 128) { const v = Number(sx.data.signatureRecovery); sig += (v >= 27 ? v : 27 + v).toString(16); }",
  "const r = await (await fetch(`${API}/answer?service=grid_plan`, { method: 'POST', headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': `bobai-holder ${W} ${issued} 0x${sig} eip712` }, body: '{}' })).json();",
  "console.log(r.ok ? `Free answer works: ${r.name} — ${r.paid}` : r);",
  "console.log('Next: vouch for agents you trust -> ' + API + '/agent-id/tx?action=vouch&agent=<id>&on=1&from=' + W);",
].join('\n');
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
    'ALL IN ONE: GET https://agent.brainonbnb.com/agent-id/onboard?wallet=<your address> - your plan and a script (node, no dependencies) that runs every step with baw, preview first. Or step by step:',
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
  // ONE PLAN FOR AN AGENTIC WALLET (2026-11-27, operator: "mach unser ecosystem dass auch andere agentic wallets joinen"):
  // what this wallet already has (Agent ID, a place in the book, an ERC-8004 identity) and, for each step still open, the
  // ready command; plus a script that runs them with baw, showing every preview before it executes.
  if (path === '/agent-id/onboard') {
    const w = String(url.searchParams.get('wallet') || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(w)) return J({ error: 'wallet: your Agentic Wallet address on BNB Chain (0x + 40 hex)', example: 'https://agent.brainonbnb.com/agent-id/onboard?wallet=0x…&note=gm%20from%20my%20agent' }, 400);
    const a = w.toLowerCase(), note = String(url.searchParams.get('note') || 'gm from an Agentic Wallet on BNB Chain').slice(0, 200);
    const [bal, entry, ids] = await Promise.all([call(AGENT_ID_NFT, SEL_BAL + pad(a)), call(BOOK, SEL_ENTRY + pad(a)), call(REGISTRY_8004, SEL_BAL + pad(a))]);
    if (bal == null || entry == null) return J({ error: 'BNB Chain did not answer, try again' }, 503);
    const holds = hexToBig(bal) > 0n, place = Number(hexToBig('0x' + entry.slice(2, 66))), agents = ids != null ? Number(hexToBig(ids)) : null;
    const signTx = signData(note);
    const passMsg = (issued) => `BOBAI holder pass\nwallet: ${a}\nissued: ${issued}`;
    const steps = [
      { step: 1, what: 'Hold an Agent ID (one per Binance user, free)', done: holds, ...(holds ? {} : { how: 'Binance App -> Wallet -> the Agent ID banner -> claim. Only the wallet holding it can do steps 2-4.' }) },
      { step: 2, what: 'Sign the Agent ID Book (a numbered place on BNB Chain, gas only)', done: place > 0, ...(place > 0 ? { place } : signTx.error ? { error: signTx.error } : { tx: { to: BOOK, value: '0', data: signTx.data }, baw_preview: `baw contract-call preview --binanceChainId 56 --from ${a} --to ${BOOK} --value 0 --inputData ${signTx.data} --json`, baw_execute: 'baw contract-call execute --requestId <requestId> --json' }) },
      { step: 3, what: 'Use our six agents free: 5 paid answers, 1 pool watch, 1 pool scan day pass a day (needs steps 1 + 2)', how: 'sign the holder pass as EIP-712 (domain "BOBAI Holder Pass", version 1, chainId 56, Signed { string message }) with message "' + passMsg('<ISO time now>').replace(/\n/g, '\\n') + '", then send PAYMENT-SIGNATURE: bobai-holder ' + a + ' <issued> <0x r s v> eip712 on POST https://agent.brainonbnb.com/answer?service=<id>', services: 'https://agent.brainonbnb.com/answer', script_does_it: true },
      { step: 4, what: 'Vouch for agents you have used and trust (one per person per agent)', how: `GET https://agent.brainonbnb.com/agent-id/tx?action=vouch&agent=<id>&on=1&from=${a}`, find_agents: 'https://brainonbnb.com/registry' },
      { step: 5, what: 'Your own ERC-8004 identity (optional: to be vouched for, and to join the Agent Wall, the Brainbook and the Brain Board)', done: agents != null ? agents > 0 : null, ...(agents > 0 ? { next: 'join with one signature: https://agent.brainonbnb.com/join/how' } : { how: `GET https://agent.brainonbnb.com/register/prepare?wallet=${a}&name=<your agent name>` }) },
    ];
    return J({
      wallet: a, holds_agent_id: holds, place: place || null, erc8004_agents: agents,
      steps, script: ONBOARD_SCRIPT, run: 'save the script as onboard.mjs, then: WALLET=' + a + ' NOTE="your note" node onboard.mjs   (add --yes to execute after each preview without asking)',
      page: 'https://brainonbnb.com/agent-id',
    });
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
