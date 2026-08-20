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

// A census that reports zero MCP agents is either a finding about the ecosystem
// or a broken detector, and from the outside those look identical. --self-test
// resolves that: it runs the same detection against our own registration, which
// definitely exposes MCP and an agent card. If it comes back negative, no other
// number in this file is worth reading.
const SELF_TEST = args.includes('--self-test');

if (!SELF_TEST && !fs.existsSync(HITS)) {
  console.error(`No scan output at ${path.relative(ROOT, HITS)} — run erc8004-scan.mjs first.`);
  process.exit(1);
}

const seen = new Set();
const agents = [];
for (const line of (SELF_TEST ? '' : fs.readFileSync(HITS, 'utf8')).split('\n')) {
  if (!line.trim()) continue;
  try {
    const a = JSON.parse(line);
    if (seen.has(a.id)) continue;   // the scan appends; a resumed run can repeat ids
    seen.add(a.id);
    agents.push(a);
  } catch { /* skip malformed line */ }
}
// Our own registration, used by --self-test. Known to expose MCP with a
// double-digit tool count and an agent card, so it is the one case where the
// expected answer is certain — and therefore the only honest way to tell a
// finding of zero from a detector that cannot detect.
if (SELF_TEST) agents.push({
  id: 49467, name: 'Brain On BNB AI ($BOBAI)',
  endpoints: ['https://brainonbnb.com/', 'https://brainonbnb.com/mcp'],
});
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

    // An agent card that parses is proof of an agent, not just a server —
    // and its skills are the only machine-readable statement of what the
    // agent actually does. A directory that lists names is the thing this
    // census exists to be better than, so the capabilities get recorded.
    if (/agent-card\.json$/i.test(url) || /\/\.well-known\//i.test(url)) {
      try {
        const j = await res.r.clone().json();
        if (j && (j.name || j.protocolVersion || j.skills)) {
          result.live.a2a = true;
          if (Array.isArray(j.skills)) {
            result.live.skills = j.skills
              .map((s) => (s && typeof s === 'object' ? s.name || s.id : s))
              .filter((s) => typeof s === 'string')
              .slice(0, 25);
          }
          if (typeof j.description === 'string') result.live.cardDescription = j.description.slice(0, 240);
        }
      } catch { /* served something that was not a card */ }
    }
  }

  // Most registrations name a bare domain, not the path to the agent card —
  // so looking only at what was written down finds almost nothing. The
  // well-known locations are where an A2A card is supposed to live, so a
  // reachable host gets asked directly. This is the difference between
  // "nobody publishes a card" and "nobody writes the path in the registry",
  // and those are very different findings.
  if (result.reachable && !result.live.a2a) {
    const hosts = [...new Set(a.endpoints.map((e) => { try { return new URL(e).origin; } catch { return null; } }).filter(Boolean))];
    for (const origin of hosts.slice(0, 2)) {
      for (const p of ['/.well-known/agent-card.json', '/.well-known/agent.json', '/.well-known/ai-agent.json']) {
        const res = await probeOne(origin + p);
        if (!res.ok || res.status >= 400) continue;
        try {
          const j = await res.r.json();
          if (j && (j.name || j.protocolVersion || j.skills)) {
            result.live.a2a = true;
            result.live.cardUrl = origin + p;
            if (Array.isArray(j.skills)) {
              result.live.skills = j.skills
                .map((s) => (s && typeof s === 'object' ? s.name || s.id : s))
                .filter((s) => typeof s === 'string').slice(0, 25);
            }
            if (typeof j.description === 'string') result.live.cardDescription = j.description.slice(0, 240);
          }
        } catch { /* not a card */ }
        if (result.live.a2a) break;
      }
      if (result.live.a2a) break;
    }
  }

  // MCP is spoken to rather than assumed from the URL shape. Same reasoning as
  // the card lookup: an agent that runs MCP at /mcp on its own domain will
  // usually have registered only the domain.
  const mcpUrl = a.endpoints.find((e) => /\/mcp(\/|$)/i.test(e))
    || (result.reachable ? (() => {
      try { return new URL(a.endpoints[0]).origin + '/mcp'; } catch { return null; }
    })() : null);
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
          // The tool names are the whole point. "This agent exists" is a
          // directory entry; "this agent exposes these fourteen callable
          // tools, and here is what each is for" is something another agent
          // can act on without a human in the loop.
          result.live.tools = j.result.tools
            .map((t) => t && typeof t.name === 'string'
              ? { name: t.name.slice(0, 60), description: String(t.description || '').slice(0, 160) }
              : null)
            .filter(Boolean)
            .slice(0, 40);
          result.reachable = true;
        }
      } catch { /* answered, but not with MCP */ }
    }
  }
  return result;
}

// The self-test writes somewhere else. Sharing the output file meant a single
// self-test run replaced a full probe's results with one row, while census.json
// still held the totals from the real run — a page showing "372 reachable"
// above a table with one entry in it. Wrong in the most embarrassing possible
// way: internally inconsistent, on the page whose entire point is that its
// numbers can be checked.
const out = fs.createWriteStream(SELF_TEST ? OUT.replace(/\.jsonl$/, '.selftest.jsonl') : OUT, { flags: 'w' });
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

if (SELF_TEST) {
  const r = JSON.parse(fs.readFileSync(OUT.replace(/\.jsonl$/, '.selftest.jsonl'), 'utf8').trim().split('\n')[0]);
  console.log('\n--- self-test against our own agent ---');
  console.log('  reachable  :', r.reachable);
  console.log('  MCP        :', !!r.live.mcp, r.live.mcpTools ? `(${r.live.mcpTools} tools)` : '');
  console.log('  agent card :', !!r.live.a2a, r.live.cardUrl || '');
  console.log('  tools      :', (r.live.tools || []).slice(0, 5).map((t) => t.name).join(', ') || '(none)');
  const good = r.reachable && r.live.mcp && (r.live.tools || []).length >= 10;
  console.log(good
    ? '\n  DETECTOR WORKS — a zero elsewhere is a finding, not a bug\n'
    : '\n  DETECTOR BROKEN — fix this before publishing any count\n');
  process.exit(good ? 0 : 1);
}

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
