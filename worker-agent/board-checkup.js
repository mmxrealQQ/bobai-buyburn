// JOIN AND SEE WHAT TO FIX (2026-10-23, operator: "jeder Agent und jede Plattform soll dort joinen können und gleich
// sehen, was er optimieren muss"). GET /board/agent/<id>: for any ERC-8004 agent on BNB Chain, its board inbox and a
// live checkup — the things marketplaces and explorers (8004scan, Marque, Pokter, Mandate) grade and the things we got
// wrong ourselves — each with the fix. Read-only: it reads the registry and calls the agent's own public endpoints the
// way a buyer would (a card, a "list", a quote request that creates nothing).
const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const RPCS = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed1.defibit.io', 'https://bsc-dataseed.binance.org'];
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
async function ethCall(data, keyed) {
  for (const url of [keyed, ...RPCS].filter(Boolean)) {
    try { const j = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: REGISTRY, data }, 'latest'] }), signal: AbortSignal.timeout(8000) }).then((r) => r.json()); if (typeof j?.result === 'string') return j.result; } catch { /* next */ }
  }
  return null;
}
const addrOf = (w) => (w && w.length >= 66 && !/^0x0*$/.test(w) ? '0x' + w.slice(26, 66).toLowerCase() : null);
function str(hex) { try { const d = hex.slice(2), len = parseInt(d.slice(64, 128), 16); return new TextDecoder().decode(Uint8Array.from(d.slice(128, 128 + len * 2).match(/../g) || [], (h) => parseInt(h, 16))); } catch { return ''; } }
// a worker cannot reach its own custom domain over the internet (Cloudflare answers 522): our own endpoints go through
// the worker's SELF binding, everybody else's through fetch (2026-10-23, the checkup read our card as "522")
let SELF = null;
const fx = (url, init) => (SELF && /^https:\/\/agent\.brainonbnb\.com\//.test(url) ? SELF.fetch(url, init) : fetch(url, init));
const getJson = async (url, init = {}) => { try { const r = await fx(url, { ...init, signal: AbortSignal.timeout(10000) }); const t = await r.text(); try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t.slice(0, 200) }; } } catch (e) { return { error: String(e.message || e).slice(0, 120) }; } };

// The registration document, whatever form it takes.
async function registration(uri) {
  if (!uri) return { error: 'no tokenURI' };
  try {
    if (uri.startsWith('data:application/json')) { const b = uri.slice(uri.indexOf(',') + 1); return { doc: JSON.parse(/;base64,/.test(uri) ? new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0))) : decodeURIComponent(b)), inline: true }; }
    if (/^ipfs:\/\//.test(uri)) { const r = await getJson('https://ipfs.io/ipfs/' + uri.slice(7)); return r.json ? { doc: r.json } : { error: `the ipfs document did not load (${r.status || r.error})` }; }
    if (/^https?:\/\//.test(uri)) { const r = await getJson(uri); return r.json ? { doc: r.json } : { error: `${uri} answered ${r.status || r.error}, not JSON` }; }
  } catch (e) { return { error: 'the document is not JSON: ' + String(e.message || e).slice(0, 80) }; }
  return { error: `unsupported tokenURI scheme: ${uri.slice(0, 30)}` };
}
const serviceUrl = (doc, names) => (Array.isArray(doc?.services) ? doc.services : Array.isArray(doc?.endpoints) ? doc.endpoints : []).find((s) => names.includes(String(s.name || s.type || '').toLowerCase()))?.endpoint || null;

export async function agentCheckup(id, { keyed = null, self = null } = {}) {
  SELF = self;
  const checks = [];
  const add = (key, ok, detail, fix = null) => checks.push({ check: key, ok: ok === null ? null : !!ok, detail, ...(ok === false && fix ? { fix } : {}) });
  const [o, w, u] = await Promise.all([ethCall('0x6352211e' + word(id), keyed), ethCall('0x00339509' + word(id), keyed), ethCall('0xc87b56dd' + word(id), keyed)]);
  const owner = addrOf(o);
  if (!owner) return { id: Number(id), exists: false, checks: [{ check: 'registered', ok: false, detail: `#${id} is not on the ERC-8004 identity registry on BNB Chain (${REGISTRY})`, fix: 'register(tokenURI, metadata) on the registry' }] };
  const wallet = addrOf(w);
  const reg = await registration(str(u || '0x'));
  const doc = reg.doc || null;
  add('registration document', !!doc, doc ? (reg.inline ? 'inline data: URI, readable without a server' : 'readable') : reg.error, 'serve valid JSON at the tokenURI (an inline data: URI cannot go offline)');
  add('name and description', !!(doc?.name && doc?.description), doc?.name ? `"${String(doc.name).slice(0, 60)}"` : 'no name', 'set name and a description that says what the agent does');
  add('image', !!doc?.image, doc?.image ? 'set' : 'none', 'add an image URL (https) — explorers and marketplaces show it');
  const selfReg = Array.isArray(doc?.registrations) && doc.registrations.some((r) => String(r.agentId) === String(id));
  add('registrations names itself', selfReg, selfReg ? 'yes' : 'missing', `add "registrations": [{ "agentId": ${id}, "agentRegistry": "eip155:56:${REGISTRY}" }] — 8004scan counts it toward completeness`);
  add('agentWallet', !!wallet, wallet || 'not set', 'setAgentWallet: SDK buyers check your signed quotes against it');
  const a2a = serviceUrl(doc, ['a2a']), mcp = serviceUrl(doc, ['mcp']);
  add('A2A or MCP service declared', !!(a2a || mcp), [a2a && `A2A ${a2a}`, mcp && `MCP ${mcp}`].filter(Boolean).join(' · ') || 'none', 'declare a service named "A2A" (exactly, the SDK matches it case-sensitively) with its endpoint');
  let card = null, rpcUrl = null;
  if (a2a) {
    const cardUrl = /agent(-card)?\.json$/.test(a2a) ? a2a : a2a.replace(/\/$/, '') + '/.well-known/agent-card.json';
    const c = await getJson(cardUrl);
    card = c.json && (c.json.skills || c.json.name) ? c.json : null;
    add('agent card loads', !!card, card ? `${cardUrl} · ${(card.skills || []).length} skills` : `${cardUrl} answered ${c.status || c.error}${c.text ? ' (not JSON — a site answering every path with HTML?)' : ''}`, 'serve the A2A card as JSON at the endpoint\'s /.well-known/agent-card.json');
    if (card) {
      const noEx = (card.skills || []).filter((s) => !(s.examples || []).length).map((s) => s.id || s.name);
      add('every skill has an example', !noEx.length, noEx.length ? `without: ${noEx.join(', ')}` : 'yes', 'add examples to each skill — 8004scan grades A2A quality on it (ours went 77 -> 87)');
      rpcUrl = card.url || (/agent(-card)?\.json$/.test(a2a) ? null : a2a);
    }
  }
  if (rpcUrl) {
    const t0 = Date.now();
    const r = await getJson(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'plaza-board-checkup' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'plaza-checkup-' + Date.now(), kind: 'message', parts: [{ kind: 'text', text: 'What can you do?' }] } } }) });
    const ok = !!(r.json && (r.json.result || r.json.error?.code));
    add('A2A message/send answers', ok, ok ? `${r.json.result ? 'a result' : 'a JSON-RPC error ' + r.json.error.code} in ${Date.now() - t0} ms` : `${rpcUrl} answered ${r.status || r.error}`, 'answer JSON-RPC message/send at the card\'s url — marketplaces send exactly this ("What can you do?")');
    // the dialect the agent itself offers: BNB's SDK skill if its card has it, else the older "negotiate" (Marque's
    // reference agents, 2026-10-23 — asked in the wrong dialect they looked as if they quoted nothing)
    const skills = (card?.skills || []).map((s) => String(s.id || ''));
    const dialect = skills.includes('negotiate-erc8183-job') ? 'negotiate-erc8183-job' : skills.find((x) => /negotiate/.test(x)) || null;
    if (dialect) {
      const q = await getJson(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'plaza-board-checkup' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'message/send', params: { message: { role: 'user', messageId: 'plaza-quote-' + Date.now(), parts: [{ kind: 'data', data: { skill: dialect, task_description: 'Quote your standard deliverable so a buyer can see the price before hiring.', terms: { deliverables: 'Your standard deliverable.', quality_standards: 'As described on your card.' }, chain_id: 56 } }] } } }) });
      const d = q.json?.result?.parts?.find?.((p) => p.kind === 'data')?.data || q.json?.result || {};
      const flat = JSON.stringify(d);
      const declined = d.accepted === false || d.response?.accepted === false;
      const signed = /"(provider_sig|signature|negotiation_hash|response_hash)"\s*:\s*"0x[0-9a-fA-F]{20,}/.test(flat);
      const price = d.price || d.response?.terms?.price || d.terms?.price || null;
      add('quotes a price when asked', !declined && signed, declined ? `declined: ${String(d.reason || d.response?.reason || d.reason_code || '').slice(0, 140)}` : signed ? `signed quote (${dialect})${price ? ', price ' + price : ''}` : `no signed quote in the answer to ${dialect}`, 'answer a plain price request ("Quote your standard deliverable…") with a signed quote — Pokter marks agents that decline it "seller-declined"');
    }
  }
  const bad = checks.filter((c) => c.ok === false).length;
  return { id: Number(id), exists: true, name: doc?.name || null, owner, agent_wallet: wallet, score: `${checks.length - bad}/${checks.length}`, checks, checked_at: new Date().toISOString(), note: 'Read-only: the registry and the agent\'s own public endpoints, called the way a buyer calls them. A quote request creates no job.' };
}

// Where an agent takes A2A messages: its registration's A2A service, through its card's url. null when it has none.
export async function a2aUrlOf(id, { keyed = null, self = null } = {}) {
  SELF = self;
  const u = await ethCall('0xc87b56dd' + word(id), keyed);
  const reg = await registration(str(u || '0x'));
  const a2a = serviceUrl(reg.doc, ['a2a']);
  if (!a2a) return null;
  if (!/agent(-card)?\.json$/.test(a2a)) return a2a;
  const c = await getJson(a2a);
  return c.json?.url || null;
}
