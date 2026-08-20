// Second half of the census: does the endpoint answer?
//
// The registry scan says which agents claim an endpoint. This says which of
// those claims are true. They are very different numbers, and only the second
// one means anything — an agent you cannot reach is a row in a database, not a
// participant in anything.
//
// What counts as reachable is deliberately generous. Any HTTP response at all
// — including 401, 403, 404 — proves something is listening at that address,
// and an agent that requires auth is still an agent. Only a connection that
// cannot be established counts as dead. Being strict here would flatter the
// result in the wrong direction; being generous means the low number that comes
// out cannot be argued away.
//
// Where an agent card or MCP endpoint is claimed, it is actually spoken to:
// a /.well-known/agent-card.json that returns JSON, an MCP endpoint that
// answers tools/list. That separates "a web server exists" from "an agent is
// running", which is the distinction the whole idea rests on.
//
// Usage:
//   node scripts/erc8004-probe.mjs                probe everything the scan found
//   node scripts/erc8004-probe.mjs --limit 200    probe the first N
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'data', 'erc8004');
const HITS = path.join(DIR, 'agents-with-endpoints.jsonl');
const OUT = path.join(DIR, 'reachable.jsonl');
const SUMMARY = path.join(DIR, 'census.json');

const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
const CONCURRENCY = 12;
const TIMEOUT = 12000;

if (!fs.existsSync(HITS)) {
  console.error(`No scan output at ${path.relative(ROOT, HITS)} — run erc8004-scan.mjs first.`);
  process.exit(1);
}

const seen = new Set();
const agents = [];
for (const line of fs.readFileSync(HITS, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try {
    const a = JSON.parse(line);
    if (seen.has(a.id)) continue;   // the scan appends; a resumed run can repeat ids
    seen.add(a.id);
    agents.push(a);
  } catch { /* skip malformed line */ }
}
console.log(`${agents.length.toLocaleString('en-US')} agents claim an endpoint`);

const probeOne = async (url, opts = {}) => {
  try {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers: { 'user-agent': 'brainonbnb-erc8004-census', ...(opts.headers || {}) },
      body: opts.body,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT),
    });
    return { ok: true, status: r.status, r };
  } catch (e) {
    return { ok: false, error: String(e && e.name === 'TimeoutError' ? 'timeout' : (e.message || e)).slice(0, 60) };
  }
};

async function probeAgent(a) {
  const result = { id: a.id, name: a.name, endpoints: a.endpoints, reachable: false, live: {}, checked: [] };

  for (const url of a.endpoints) {
    const res = await probeOne(url);
    result.checked.push({ url, status: res.ok ? res.status : null, error: res.error || null });
    if (!res.ok) continue;
    result.reachable = true;

    // An agent card that parses is proof of an agent, not just a server.
    if (/agent-card\.json$/i.test(url) || /\/\.well-known\//i.test(url)) {
      try {
        const j = await res.r.clone().json();
        if (j && (j.name || j.protocolVersion || j.skills)) result.live.a2a = true;
      } catch { /* served something that was not a card */ }
    }
  }

  // MCP is spoken to rather than assumed from the URL shape.
  const mcpUrl = a.endpoints.find((e) => /\/mcp(\/|$)/i.test(e));
  if (mcpUrl) {
    const res = await probeOne(mcpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    if (res.ok) {
      try {
        const txt = await res.r.text();
        const j = JSON.parse(txt.replace(/^data:\s*/gm, '').trim().split('\n').pop());
        if (j && j.result && Array.isArray(j.result.tools)) {
          result.live.mcp = true;
          result.live.mcpTools = j.result.tools.length;
          result.reachable = true;
        }
      } catch { /* answered, but not with MCP */ }
    }
  }
  return result;
}

const out = fs.createWriteStream(OUT, { flags: 'w' });
const todo = agents.slice(0, LIMIT === Infinity ? agents.length : LIMIT);
let done = 0, reachable = 0, withMcp = 0, withA2a = 0;

// Fixed-size worker pool: the targets are unrelated third-party hosts, so
// there is nothing to rate-limit against, but a few hundred simultaneous
// sockets is rude and unreliable.
const queue = todo.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const a = queue.shift();
    const r = await probeAgent(a);
    out.write(JSON.stringify(r) + '\n');
    done++;
    if (r.reachable) reachable++;
    if (r.live.mcp) withMcp++;
    if (r.live.a2a) withA2a++;
    if (done % 25 === 0) console.log(`  ${done}/${todo.length}  reachable ${reachable}  mcp ${withMcp}  a2a ${withA2a}`);
  }
}));
out.end();

// ---- census -----------------------------------------------------------
let scan = {};
try { scan = JSON.parse(fs.readFileSync(path.join(DIR, 'scan-state.json'), 'utf8')); } catch {}

const census = {
  registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  chain: 'BNB Smart Chain (eip155:56)',
  measured_at: new Date().toISOString(),
  method: 'Every agent id in the identity registry read via tokenURI, then every claimed HTTP endpoint contacted once. Any HTTP response counts as reachable, including 401/403/404 — only a failed connection counts as dead.',
  registered_ids: scan.highestId || null,
  ids_scanned: scan.cursor ? scan.cursor - 1 : null,
  registrations: scan.counts || null,
  endpoints: {
    claim_an_endpoint: agents.length,
    probed: done,
    reachable,
    dead: done - reachable,
    answering_mcp: withMcp,
    serving_an_agent_card: withA2a,
  },
  caveat: 'Reachability is a snapshot. An endpoint down at the moment of probing is counted as dead, and one that answers may still do nothing useful.',
};
fs.writeFileSync(SUMMARY, JSON.stringify(census, null, 2) + '\n');

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(2) + '%' : '–');
console.log(`\n--- endpoints ---`);
console.log(`  claimed an endpoint   ${agents.length}`);
console.log(`  probed                ${done}`);
console.log(`  answered              ${reachable}   (${pct(reachable, done)} of probed)`);
console.log(`  dead                  ${done - reachable}`);
console.log(`  answered MCP          ${withMcp}`);
console.log(`  served an agent card  ${withA2a}`);
if (scan.highestId) {
  console.log(`\n  of ${scan.highestId.toLocaleString('en-US')} registered ids, ${reachable} are reachable — ${pct(reachable, scan.highestId)}`);
}
console.log(`\nwritten: ${path.relative(ROOT, SUMMARY)}, ${path.relative(ROOT, OUT)}`);
