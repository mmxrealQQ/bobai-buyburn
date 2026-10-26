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
// A PRICE A PERSON CAN READ (2026-10-26): a quote names its price in the token's smallest unit — Lattice's read
// "price 100000000000000000" in the checkup, which is 0.10 $U. The stablecoins an ERC-8183 job is paid in on BNB Chain
// (hire.js TOKENS), all 18 decimals there; another token stays raw, with its address, never a guessed figure.
const QUOTE_TOKENS = { '0xce24439f2d9c6a2289f741120fe202248b666666': '$U', '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d': 'USD1', '0x55d398326f99059ff775485246999027b3197955': 'USDT', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 'USDC' };
export const priceText = (raw, currency) => {
  const sym = QUOTE_TOKENS[String(currency || '').toLowerCase()], s = String(raw).trim();
  if (sym && /^\d{1,40}$/.test(s)) { const v = Number(BigInt(s)) / 1e18; return `${v >= 0.01 ? v.toFixed(2) : v.toPrecision(2)} ${sym}`; }
  return s.slice(0, 30) + (currency ? ` (in token ${String(currency).slice(0, 6)}…${String(currency).slice(-4)})` : '');
};
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
      const pr = r.headers?.get?.('payment-required') || null; // an x402 seller's terms (x402 v2), read by the x402 check
      try { return { status: r.status, json: JSON.parse(t), pr }; } catch { return { status: r.status, text: t, pr }; }
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
// an A2A service that names its card, not its endpoint — read without the query (2026-10-25: AgentCore's ends
// "agent-card.json?qualifier=DEFAULT")
const isCardUrl = (u) => /agent(-card)?\.json$/.test(String(u).split(/[?#]/)[0]);
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
  add('name and description', !!(doc?.name && doc?.description), doc?.name ? `"${String(doc.name).slice(0, 60)}"` : 'no name', 'in the registration JSON (the agent\'s tokenURI): "name": "…", "description": "what it does, for whom, what it costs"');
  add('image', !!doc?.image, doc?.image ? 'set' : 'none', 'in the registration JSON (the agent\'s tokenURI): "image": "https://…/logo.png" — a square https picture; explorers and marketplaces show it');
  const selfReg = Array.isArray(doc?.registrations) && doc.registrations.some((r) => String(r.agentId) === id);
  add('registrations names itself', selfReg, selfReg ? 'yes' : 'missing', `add "registrations": [{ "agentId": ${id}, "agentRegistry": "eip155:56:${REGISTRY}" }] — 8004scan counts it toward completeness`);
  add('agentWallet', !!wallet, wallet || 'not set', `call setAgentWallet for agent ${id} on the ERC-8004 registry ${REGISTRY} (BNB Chain) with the wallet that signs your quotes — SDK buyers check your signed quotes against it`);
  const a2a = serviceUrl(doc, ['a2a']), mcp = serviceUrl(doc, ['mcp']);
  add('A2A or MCP service declared', !!(a2a || mcp), [a2a && `A2A ${String(a2a).slice(0, 100)}`, mcp && `MCP ${String(mcp).slice(0, 100)}`].filter(Boolean).join(' · ') || 'none', 'in the registration JSON (the agent\'s tokenURI): "services": [{ "name": "A2A", "endpoint": "https://…/.well-known/agent-card.json" }] — the name exactly "A2A", the SDK matches it case-sensitively (an MCP server: "name": "MCP" and its endpoint)');
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
    // the card URL named with a query (2026-10-25: AWS Bedrock AgentCore's ends "agent-card.json?qualifier=DEFAULT";
    // the test read the whole string, missed it, and asked the domain's root — Firstshare Checker was told "404, a site
    // answering HTML?" where its card asks for credentials)
    const tries = isCardUrl(a2a) ? [a2a] : [String(a2a).replace(/\/$/, '') + '/.well-known/agent-card.json', (() => { try { return new URL(a2a).origin + '/.well-known/agent-card.json'; } catch { return null; } })()].filter((x, i, all) => x && all.indexOf(x) === i);
    let c = null, cardUrl = tries[0];
    for (const t of tries) { c = await get(t); cardUrl = t; if (c.json && (c.json.skills || c.json.name)) break; }
    card = c.json && (c.json.skills || c.json.name) ? c.json : null;
    // a card behind credentials is there, only not for a reader: a fix of its own, not "serve it at /.well-known"
    const locked = !card && (c.status === 401 || c.status === 403);
    const shown = cardUrl.length > 100 ? cardUrl.slice(0, 99) + '…' : cardUrl; // a long URL cut visibly, not mid-word
    add('agent card loads', !!card, card ? `${shown} · ${(card.skills || []).length} skills` : `${shown} answered ${c.status || c.error}${locked ? ' (asks for credentials)' : c.text ? ' (not JSON — a site answering every path with HTML?)' : ''}`, locked ? 'let the card be read without credentials — marketplaces and explorers send none; the task endpoint behind it may stay authenticated' : 'serve the A2A card as JSON at the endpoint\'s /.well-known/agent-card.json');
    if (card) {
      const noEx = (card.skills || []).filter((s) => !(s.examples || []).length).map((s) => String(s.id || s.name).slice(0, 40));
      // the fix says where and how (2026-10-26): the card's own host, the field, one line to paste
      const cardHost = (() => { try { return new URL(cardUrl).host; } catch { return 'your card'; } })();
      add('every skill has an example', !noEx.length, noEx.length ? `without: ${noEx.slice(0, 8).join(', ')}` : 'yes', `in the agent card (served at ${cardHost}), give every skill an "examples" list — for ${noEx[0] || 'each skill'}: "examples": ["<one request a buyer would send>"] — 8004scan grades A2A quality on it (ours went 77 -> 87)`);
      rpcUrl = card.url || (isCardUrl(a2a) ? null : a2a);
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
      const rawPrice = d.price || d.response?.terms?.price || d.terms?.price || null;
      const price = rawPrice == null ? null : priceText(rawPrice, d.response?.terms?.currency || d.terms?.currency || d.currency);
      add('quotes a price when asked', !declined && signed, declined ? `declined: ${String(d.reason || d.response?.reason || d.reason_code || '').slice(0, 140)}` : signed ? `signed quote (${dialect})${price ? ', price ' + price : ''}` : `no signed quote in the answer to ${dialect}${d.unsigned_reason ? ` (it says: ${String(d.unsigned_reason).slice(0, 120)})` : d.signed === false ? ' (it marks its quote unsigned)' : price ? ` (a price, ${price}, without a signature)` : ''}`, 'answer a plain price request ("Quote your standard deliverable…") with a signed quote — Pokter marks agents that decline it "seller-declined"');
    }
  }
  // THE x402 SERVICE, when one is declared (2026-10-25: Marque read ours as bad_schema and never once good — two of five
  // payment options had no maxTimeoutSeconds; complete, all six read live within the hour). Asked unpaid as a client
  // asks (GET, then POST): a 402 whose terms (PAYMENT-REQUIRED, else the body) carry every field x402 requires in each
  // accepts[] entry — a strict client drops the whole 402 over one incomplete option.
  const x402 = serviceUrl(doc, ['x402']);
  if (x402 && /^https:\/\//.test(x402)) {
    const UAH = { 'user-agent': 'plaza-board-checkup (+https://brainonbnb.com/board)' };
    let r = await get(x402, { headers: UAH });
    if (r.status !== 402) { const p = await get(x402, { method: 'POST', headers: { ...UAH, 'content-type': 'application/json' }, body: '{}' }); if (p.status === 402) r = p; }
    let terms = null;
    try { terms = r.pr ? JSON.parse(atob(r.pr)) : null; } catch { /* not base64 JSON */ }
    if (!terms && r.json && Array.isArray(r.json.accepts)) terms = r.json;
    const v2 = Number(terms?.x402Version) >= 2;
    const need = v2 ? ['scheme', 'network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds'] : ['scheme', 'network', 'maxAmountRequired', 'resource', 'description', 'mimeType', 'payTo', 'maxTimeoutSeconds', 'asset'];
    const short = (terms?.accepts || []).map((a, i) => [i, need.filter((k) => a?.[k] == null || a[k] === '')]).filter(([, m]) => m.length);
    const n = terms?.accepts?.length || 0;
    add('x402 terms are complete', r.status === 402 && n > 0 && !short.length,
      r.status !== 402 ? `${String(x402).slice(0, 80)} answered ${r.status || r.error} to an unpaid request` : !n ? 'a 402 without accepts[] (neither in PAYMENT-REQUIRED nor in the body)'
        : short.length ? `x402 v${v2 ? 2 : 1}, ${n} option${n === 1 ? '' : 's'}: ${short.slice(0, 3).map(([i, m]) => `#${i} lacks ${m.join(', ')}`).join('; ')}` : `x402 v${v2 ? 2 : 1}, ${n} option${n === 1 ? '' : 's'}, each complete`,
      r.status !== 402 ? 'answer an unpaid request with 402 and your terms (PAYMENT-REQUIRED header, base64 JSON) — that is how an x402 client reads the price'
        : `give every accepts[] entry ${need.join(', ')} — a strict client (Marque reads it as bad_schema) drops the whole 402 over one incomplete option`);
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
  if (!isCardUrl(a2a)) return a2a;
  const c = await get(a2a);
  const url = c.json?.url;
  return url && /^https:\/\//.test(url) && !(isOurHost(url) && !OWN_AGENT_IDS.has(id)) ? url : null;
}
