// JOIN AND SEE WHAT TO FIX (2026-10-23, operator: "jeder Agent und jede Plattform soll dort joinen können und gleich
// sehen, was er optimieren muss"). GET /board/agent/<id>: for any ERC-8004 agent on BNB Chain, its board inbox and a
// live checkup — the things marketplaces and explorers (8004scan, Marque, Pokter, Mandate) grade and the things we got
// wrong ourselves — each with the fix. Read-only: it reads the registry and calls the agent's own public endpoints the
// way a buyer would (a card, a "What can you do?", a quote request that creates nothing).
//
// HARDENED (2026-10-23, after an independent review): a URL from a registration is never routed through our own
// worker (an endpoint naming our host could make the checkup call itself in a loop) — only our own agents' endpoints
// go through the SELF binding, and an outside registration naming our host is refused. Every answer is read up to
// 256 KB, every call has its own timeout and the whole checkup a deadline. An unreadable registry is said as such,
// never as "not registered".
const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed1.defibit.io', 'https://bsc-dataseed.binance.org'];
export const OWN_AGENT_IDS = new Set(['302257', '302258', '304493', '304494', '310460', '363709', '49467']);
const MAX_BYTES = 256 * 1024;
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const isSelfHost = (url) => { try { return new URL(url).hostname.toLowerCase() === 'agent.brainonbnb.com'; } catch { return false; } };
const isOurHost = (url) => { try { return /(^|\.)brainonbnb\.(com|ai)$/i.test(new URL(url).hostname); } catch { return false; } };

// eth_call against the registry: { result } or { unread: true } when no node answered (a revert is { result: null })
async function ethCall(data, keyed) {
  let answered = false;
  for (const url of [keyed, ...RPCS].filter(Boolean)) {
    try {
      const j = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: REGISTRY, data }, 'latest'] }), signal: AbortSignal.timeout(8000) }).then((r) => r.json());
      if (typeof j?.result === 'string') return { result: j.result };
      if (j?.error) { answered = true; break; }   // a revert: the node answered, the id has no record
    } catch { /* next node */ }
  }
  return answered ? { result: null } : { unread: true };
}
const addrOf = (w) => (w && w.length >= 66 && !/^0x0*$/.test(w) ? '0x' + w.slice(26, 66).toLowerCase() : null);
function str(hex) { try { const d = hex.slice(2), len = parseInt(d.slice(64, 128), 16); return new TextDecoder().decode(Uint8Array.from(d.slice(128, 128 + len * 2).match(/../g) || [], (h) => parseInt(h, 16))); } catch { return ''; } }

// a body read up to MAX_BYTES, never more
export async function readCapped(r, max = MAX_BYTES) {
  if (!r.body) return '';
  const reader = r.body.getReader(), parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { try { await reader.cancel(); } catch {} throw new Error(`answer larger than ${Math.round(max / 1024)} KB`); }
    parts.push(value);
  }
  const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.byteLength; }
  return new TextDecoder().decode(all);
}

// The fetcher for one agent: its own endpoints over the internet; ours (our agent ids only) through SELF; our host
// named by somebody else's registration is refused. `deadline`: ms epoch after which nothing more is called.
function fetcherFor(id, self, deadline) {
  return async (url, init = {}) => {
    if (!/^https:\/\//.test(String(url))) return { error: 'not an https URL' };
    const own = OWN_AGENT_IDS.has(String(id));
    if (isOurHost(url) && !own) return { error: 'a registration of another agent names our own host; not called' };
    const left = deadline - Date.now();
    if (left < 500) return { error: 'the checkup ran out of time' };
    try {
      // only this worker's own host goes through SELF; the site (brainonbnb.com: its card, its MCP) is another server,
      // reached over the internet (24.10.: #49467 was measured on this worker's card and MCP — 11 skills, 1 tool — not
      // on its own — 30 skills with examples, 29 tools)
      const go = own && self && isSelfHost(url) ? self.fetch(url, { ...init, signal: AbortSignal.timeout(Math.min(10000, left)) }) : fetch(url, { ...init, signal: AbortSignal.timeout(Math.min(10000, left)) });
      const r = await go;
      const t = await readCapped(r);
      // the whole text (already capped at 256 KB): a streamed answer (text/event-stream) is parsed by the caller
      try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t }; }
    } catch (e) { return { error: String(e.message || e).slice(0, 120) }; }
  };
}

// The registration document, whatever form it takes.
async function registration(uri, get) {
  if (!uri) return { error: 'no tokenURI' };
  try {
    if (uri.startsWith('data:application/json')) { const b = uri.slice(uri.indexOf(',') + 1); return { doc: JSON.parse(/;base64,/.test(uri) ? new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0))) : decodeURIComponent(b)), inline: true }; }
    if (/^ipfs:\/\//.test(uri)) { const r = await get('https://ipfs.io/ipfs/' + uri.slice(7)); return r.json ? { doc: r.json } : { error: `the ipfs document did not load (${r.status || r.error})` }; }
    if (/^https:\/\//.test(uri)) { const r = await get(uri); return r.json ? { doc: r.json } : { error: `${uri.slice(0, 80)} answered ${r.status || r.error}, not JSON` }; }
  } catch (e) { return { error: 'the document is not JSON: ' + String(e.message || e).slice(0, 80) }; }
  return { error: `unsupported tokenURI scheme: ${uri.slice(0, 30)}` };
}
const serviceUrl = (doc, names) => (Array.isArray(doc?.services) ? doc.services : Array.isArray(doc?.endpoints) ? doc.endpoints : []).find((s) => names.includes(String(s.name || s.type || '').toLowerCase()))?.endpoint || null;

export async function agentCheckup(id, { keyed = null, self = null, budgetMs = 30000 } = {}) {
  id = String(Number(id));
  const get = fetcherFor(id, self, Date.now() + budgetMs);
  const checks = [];
  const add = (key, ok, detail, fix = null) => checks.push({ check: key, ok: ok === null ? null : !!ok, detail, ...(ok === false && fix ? { fix } : {}) });
  const [o, w, u] = await Promise.all([ethCall('0x6352211e' + word(id), keyed), ethCall('0x00339509' + word(id), keyed), ethCall('0xc87b56dd' + word(id), keyed)]);
  if (o.unread) return { id: Number(id), exists: null, unread: true, checks: [{ check: 'registry', ok: null, detail: 'the ERC-8004 registry could not be read just now; try again in a minute' }] };
  const owner = addrOf(o.result);
  if (!owner) return { id: Number(id), exists: false, checks: [{ check: 'registered', ok: false, detail: `#${id} is not on the ERC-8004 identity registry on BNB Chain (${REGISTRY})`, fix: 'register(tokenURI, metadata) on the registry' }] };
  const wallet = addrOf(w.result);
  const reg = await registration(str(u.result || '0x'), get);
  const doc = reg.doc || null;
  add('registration document', !!doc, doc ? (reg.inline ? 'inline data: URI, readable without a server' : 'readable') : reg.error, 'serve valid JSON at the tokenURI (an inline data: URI cannot go offline)');
  add('name and description', !!(doc?.name && doc?.description), doc?.name ? `"${String(doc.name).slice(0, 60)}"` : 'no name', 'set name and a description that says what the agent does');
  add('image', !!doc?.image, doc?.image ? 'set' : 'none', 'add an image URL (https) — explorers and marketplaces show it');
  const selfReg = Array.isArray(doc?.registrations) && doc.registrations.some((r) => String(r.agentId) === id);
  add('registrations names itself', selfReg, selfReg ? 'yes' : 'missing', `add "registrations": [{ "agentId": ${id}, "agentRegistry": "eip155:56:${REGISTRY}" }] — 8004scan counts it toward completeness`);
  add('agentWallet', !!wallet, wallet || 'not set', 'setAgentWallet: SDK buyers check your signed quotes against it');
  const a2a = serviceUrl(doc, ['a2a']), mcp = serviceUrl(doc, ['mcp']);
  add('A2A or MCP service declared', !!(a2a || mcp), [a2a && `A2A ${String(a2a).slice(0, 100)}`, mcp && `MCP ${String(mcp).slice(0, 100)}`].filter(Boolean).join(' · ') || 'none', 'declare a service named "A2A" (exactly, the SDK matches it case-sensitively) with its endpoint');
  // the MCP endpoint, when one is declared (2026-10-23: Pokter and 8004scan measure it; the checkup did not): tools/list
  // as a client sends it, stateless first, then with initialize when the server wants a session
  // an answer as JSON or as a server-sent event stream (both are allowed by MCP and A2A): the last JSON data line
  const sse = (r) => { if (r.json) return r.json; const ds = String(r.text || '').split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()); for (const x of ds.reverse()) { try { return JSON.parse(x); } catch { /* next */ } } return null; };
  if (mcp && /^https:\/\//.test(mcp)) {
    const call = (body, sid) => get(mcp, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', ...(sid ? { 'mcp-session-id': sid } : {}), 'user-agent': 'plaza-board-checkup (+https://brainonbnb.com/board)' }, body: JSON.stringify(body) });
    let j = sse(await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    if (!j?.result?.tools) { await call({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'plaza-board-checkup', version: '1.0' } } }); j = sse(await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })); }
    const n = Array.isArray(j?.result?.tools) ? j.result.tools.length : null;
    add('MCP answers tools/list', n != null, n != null ? `${n} tool${n === 1 ? '' : 's'}` : `${String(mcp).slice(0, 80)} gave no tool list${j?.error ? ' (' + String(j.error.message || j.error.code).slice(0, 80) + ')' : ''}`, 'answer JSON-RPC tools/list at the declared MCP endpoint (streamable HTTP) — Pokter and 8004scan measure it');
  }
  let card = null, rpcUrl = null;
  if (a2a) {
    // where the card is: the URL named, else under the endpoint's path, else at the domain's root — the A2A standard
    // place (2026-10-23: two agents serve it at the root and the checkup, asking only under /a2a, called them broken)
    const tries = /agent(-card)?\.json$/.test(a2a) ? [a2a] : [String(a2a).replace(/\/$/, '') + '/.well-known/agent-card.json', (() => { try { return new URL(a2a).origin + '/.well-known/agent-card.json'; } catch { return null; } })()].filter((x, i, all) => x && all.indexOf(x) === i);
    let c = null, cardUrl = tries[0];
    for (const t of tries) { c = await get(t); cardUrl = t; if (c.json && (c.json.skills || c.json.name)) break; }
    card = c.json && (c.json.skills || c.json.name) ? c.json : null;
    add('agent card loads', !!card, card ? `${cardUrl.slice(0, 100)} · ${(card.skills || []).length} skills` : `${cardUrl.slice(0, 100)} answered ${c.status || c.error}${c.text ? ' (not JSON — a site answering every path with HTML?)' : ''}`, 'serve the A2A card as JSON at the endpoint\'s /.well-known/agent-card.json');
    if (card) {
      const noEx = (card.skills || []).filter((s) => !(s.examples || []).length).map((s) => String(s.id || s.name).slice(0, 40));
      add('every skill has an example', !noEx.length, noEx.length ? `without: ${noEx.slice(0, 8).join(', ')}` : 'yes', 'add examples to each skill — 8004scan grades A2A quality on it (ours went 77 -> 87)');
      rpcUrl = card.url || (/agent(-card)?\.json$/.test(a2a) ? null : a2a);
    }
  }
  if (rpcUrl) {
    const t0 = Date.now();
    const r = await get(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'plaza-board-checkup (+https://brainonbnb.com/board)' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'plaza-checkup-' + Date.now(), kind: 'message', parts: [{ kind: 'text', text: 'What can you do?' }] } } }) });
    const rj = sse(r);
    const ok = !!(rj && (rj.result || rj.error?.code));
    add('A2A message/send answers', ok, ok ? `${rj.result ? 'a result' : 'a JSON-RPC error ' + rj.error.code} in ${Date.now() - t0} ms` : `${String(rpcUrl).slice(0, 100)} answered ${r.status || r.error}`, 'answer JSON-RPC message/send at the card\'s url — marketplaces send exactly this ("What can you do?")');
    // the dialect the agent itself offers: BNB's SDK skill if its card has it, else the older "negotiate" (Marque's
    // reference agents, 2026-10-23 — asked in the wrong dialect they looked as if they quoted nothing)
    const skills = (card?.skills || []).map((s) => String(s.id || ''));
    const dialect = skills.includes('negotiate-erc8183-job') ? 'negotiate-erc8183-job' : skills.find((x) => /negotiate/.test(x)) || null;
    if (dialect) {
      const q = await get(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'plaza-board-checkup (+https://brainonbnb.com/board)' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'message/send', params: { message: { role: 'user', kind: 'message', messageId: 'plaza-quote-' + Date.now(), parts: [{ kind: 'data', data: { skill: dialect, task_description: 'Quote your standard deliverable so a buyer can see the price before hiring.', terms: { deliverables: 'Your standard deliverable.', quality_standards: 'As described on your card.' }, chain_id: 56 } }] } } }) });
      // a Message (result.parts) or a Task (result.artifacts[].parts, or result.status.message.parts) — both are A2A
      const res = sse(q)?.result || {};
      const parts = [...(res.parts || []), ...(res.artifacts || []).flatMap((a) => a.parts || []), ...(res.status?.message?.parts || [])];
      const d = parts.find((p) => p.kind === 'data')?.data || res || {};
      const flat = JSON.stringify(d);
      const declined = d.accepted === false || d.response?.accepted === false;
      const signed = /"(provider_sig|signature|negotiation_hash|response_hash)"\s*:\s*"0x[0-9a-fA-F]{20,}/.test(flat);
      const price = d.price || d.response?.terms?.price || d.terms?.price || null;
      add('quotes a price when asked', !declined && signed, declined ? `declined: ${String(d.reason || d.response?.reason || d.reason_code || '').slice(0, 140)}` : signed ? `signed quote (${dialect})${price ? ', price ' + String(price).slice(0, 30) : ''}` : `no signed quote in the answer to ${dialect}${d.unsigned_reason ? ` (it says: ${String(d.unsigned_reason).slice(0, 120)})` : d.signed === false ? ' (it marks its quote unsigned)' : price ? ` (a price, ${String(price).slice(0, 30)}, without a signature)` : ''}`, 'answer a plain price request ("Quote your standard deliverable…") with a signed quote — Pokter marks agents that decline it "seller-declined"');
    }
  }
  const bad = checks.filter((c) => c.ok === false).length;
  return { id: Number(id), exists: true, name: doc?.name ? String(doc.name).slice(0, 80) : null, owner, agent_wallet: wallet, score: `${checks.length - bad}/${checks.length}`, checks, checked_at: new Date().toISOString(), note: 'Read-only: the registry and the agent\'s own public endpoints, called the way a buyer calls them. A quote request creates no job.' };
}

// Where an agent takes A2A messages: its registration's A2A service, through its card's url. null when it has none,
// and null for an outside agent whose registration names our own host.
export async function a2aUrlOf(id, { keyed = null, self = null } = {}) {
  id = String(Number(id));
  const get = fetcherFor(id, self, Date.now() + 15000);
  const u = await ethCall('0xc87b56dd' + word(id), keyed);
  if (u.unread || !u.result) return null;
  const reg = await registration(str(u.result), get);
  const a2a = serviceUrl(reg.doc, ['a2a']);
  if (!a2a || !/^https:\/\//.test(a2a) || (isOurHost(a2a) && !OWN_AGENT_IDS.has(id))) return null;
  if (!/agent(-card)?\.json$/.test(a2a)) return a2a;
  const c = await get(a2a);
  const url = c.json?.url;
  return url && /^https:\/\//.test(url) && !(isOurHost(url) && !OWN_AGENT_IDS.has(id)) ? url : null;
}
