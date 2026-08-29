// ERC-8004 registry census on BNB Smart Chain.
//
// Reads every agent id in the identity registry and records what is actually
// there: whether the token URI parses at all, whether the registration names
// any services, whether those services carry a reachable-looking endpoint, and
// whether the agent speaks MCP, A2A or x402.
//
// The point is a number nobody has. "200,000 agents are registered on BNB
// Chain" is repeated everywhere; what none of those repetitions say is how many
// of them are anything more than a row in a contract. A sample of 150 already
// showed one — one — third-party agent with a reachable HTTP endpoint. This
// script is that sample done exhaustively, so the claim can be stated as a
// measurement instead of an impression.
//
// Design notes that are not optional:
//
//   Batched eth_call, 25 per request. Measured on this chain: 40 per batch gets
//   "method eth_call in batch triggered rate limit"; 25 goes through. Batching
//   is the difference between forty minutes and a day.
//
//   Endpoints are rotated and failures move on rather than abort. A public node
//   dropping a batch is not an agent that does not exist, and conflating those
//   two is the single easiest way to publish a wrong census.
//
//   Progress is written continuously and the run resumes from it. A scan of a
//   quarter of a million ids will be interrupted; losing it would mean nobody
//   ever finishes one, which is presumably why the number does not exist yet.
//
// Usage:
//   node scripts/erc8004-scan.mjs             scan (resumes automatically)
//   node scripts/erc8004-scan.mjs --report    summarise what has been scanned
//   node scripts/erc8004-scan.mjs --max 5000  stop after this id (for a quick pass)
import fs from 'node:fs';
import path from 'node:path';
import { censusDirArg } from './lib/census-dir.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
// The output directory is selectable so a re-scan with a changed classifier can
// run to completion beside the live data instead of overwriting it. The page
// keeps serving the finished census until the new one is finished too.
//   node scripts/erc8004-scan.mjs --dir erc8004-v3
const OUT_DIR = censusDirArg();
const OUT = path.join(ROOT, 'data', OUT_DIR);
const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

// tokenURI(uint256) — the registry is ERC-721 shaped and keeps the whole
// registration document in a data: URI, so one call per agent returns
// everything. There is no separate endpoint accessor to ask.
const TOKEN_URI = '0xc87b56dd';

// Eleven endpoints, each verified to answer a batched eth_call against this
// registry before being listed. Breadth is the throughput lever: every node
// rate-limits independently, so the scan goes as fast as the sum of them
// tolerates rather than as fast as the slowest one allows. Six endpoints ran at
// ~1,500 ids/min, which is three hours for the registry; this list is what
// makes a full census finishable in one sitting.
// Deliberately absent because they refused the probe: ankr, llamarpc, drpc,
// nodies. Listing an endpoint that does not answer only slows the rotation.
const RPCS = [
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-mainnet.public.blastapi.io',
  'https://bsc-dataseed.binance.org',
  'https://bsc.publicnode.com',
  'https://bsc-dataseed2.defibit.io',
  'https://bsc-dataseed3.defibit.io',
  'https://bsc-dataseed4.defibit.io',
  'https://bsc-dataseed1.ninicoin.io',
  'https://bsc-dataseed2.bnbchain.org',
  'https://bsc-dataseed3.bnbchain.org',
  'https://bsc-dataseed4.bnbchain.org',
];
const BATCH = 25;
const CONCURRENCY = 8;

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

let rr = 0;
const nextRpc = () => RPCS[rr++ % RPCS.length];

const id32 = (n) => BigInt(n).toString(16).padStart(64, '0');

// Rate-limit pressure, measured rather than assumed. Every refused batch backs
// the whole scan off a little; a clean run relaxes it again. Without this the
// scan produces "unread" entries, and an unread entry is not a fact about an
// agent — it is a fact about a node. A census with 10% unread in it cannot
// state a percentage about anything.
let pause = 0;
const breathe = async () => { if (pause > 0) await new Promise((r) => setTimeout(r, pause)); };

async function callBatch(ids, { patient = false } = {}) {
  const payload = ids.map((id, i) => ({
    jsonrpc: '2.0', id: i, method: 'eth_call',
    params: [{ to: REGISTRY, data: TOKEN_URI + id32(id) }, 'latest'],
  }));
  const rounds = patient ? RPCS.length * 3 : RPCS.length;
  for (let attempt = 0; attempt < rounds; attempt++) {
    await breathe();
    const url = nextRpc();
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) { pause = Math.min(2000, pause + 120); continue; }
      const j = await r.json();
      if (!Array.isArray(j)) { pause = Math.min(2000, pause + 120); continue; }
      const out = new Array(ids.length).fill(null);
      let got = 0;
      for (const item of j) {
        if (typeof item.id !== 'number') continue;
        // An entry-level error is the node refusing THAT call, not the token
        // being absent — left null so the id goes on the retry list.
        if (item.error) continue;
        out[item.id] = item.result;
        got++;
      }
      if (got === 0) { pause = Math.min(2000, pause + 120); continue; }
      if (got === ids.length) pause = Math.max(0, pause - 25);
      return out;
    } catch { pause = Math.min(2000, pause + 120); }
    if (patient) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return new Array(ids.length).fill(null);
}

// ABI-decodes a dynamic string return value.
function decodeString(hex) {
  if (!hex || hex === '0x') return null;
  const b = hex.slice(2);
  try {
    const len = parseInt(b.slice(64, 128), 16);
    if (!(len > 0) || len > 2_000_000) return null;
    const bytes = [];
    for (let i = 0; i < len; i++) bytes.push(parseInt(b.substr(128 + i * 2, 2), 16));
    return Buffer.from(bytes).toString('utf8');
  } catch { return null; }
}

const HTTP_RE = /^https?:\/\/[^\s"']+$/i;
// A hostname whose TLD is not a real one cannot resolve, so it is separated
// from endpoints that merely happen to be down right now. The registry has
// entries pointing at things like "https://hypercollector.agent" — that is not
// an outage, it is an address that was never going to work.
const REAL_TLD_RE = /\.(com|org|net|io|ai|xyz|app|dev|co|me|fun|finance|tech|cloud|so|gg|sh|to|it|de|fr|uk|eu|us|jp|kr|cn|in|ru|br|es|nl|se|no|fi|pl|ch|at|be|dk|cz|pt|gr|tr|za|au|nz|ca|mx|ar|cl|id|my|sg|th|vn|ph|hk|tw|ae|sa|il|info|biz|online|site|store|space|website|live|life|world|network|systems|digital|studio|agency|solutions|team|group|club|link|click|page|wiki|blog|news|press|art|design|money|market|exchange|capital|fund|trade|bot|chat|inc|ltd|llc)(:\d+)?(\/|$)/i;

// A registration can carry its document in the token URI, or it can point at
// one. Both are ordinary ERC-721 practice and the first version of this scan
// only understood the first, which put every off-chain pointer in the same
// bucket as genuine junk and let the page say 119,336 registrations "are not a
// readable document". A random sample of 125 ids says otherwise: 50% inline,
// **43% an https link**, 3% empty. That claim was wrong, and the shape of the
// mistake matters more than the number — it is the same "counted what was easy
// to count" error the census exists to expose.
//
// So a pointer is now its own state. What is behind it is a separate question
// with a separate answer, and answering it needs a fetch, not a decode.
const OFFCHAIN_RE = /^(https?|ipfs|ar):/i;

const hostOfUri = (u) => {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
};

function classify(raw) {
  if (!raw) return { state: 'unread' };
  const s = decodeString(raw);
  if (!s) return { state: 'empty' };

  let meta = null;
  const b64 = s.includes('base64,') ? s.split('base64,')[1] : null;
  if (b64) {
    try { meta = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); } catch { /* not json */ }
  } else if (s.trim().startsWith('{')) {
    try { meta = JSON.parse(s); } catch { /* not json */ }
  }
  if (!meta || typeof meta !== 'object') {
    const t = s.trim();
    if (OFFCHAIN_RE.test(t)) {
      return { state: 'offchain', uri: t.slice(0, 300), host: hostOfUri(t), scheme: t.split(':')[0].toLowerCase() };
    }
    return { state: 'unparsable' };
  }

  const services = Array.isArray(meta.services) ? meta.services : [];
  const endpoints = services
    .map((x) => x && typeof x.endpoint === 'string' ? x.endpoint : null)
    .filter(Boolean);
  const httpEndpoints = endpoints.filter((e) => HTTP_RE.test(e));
  const plausible = httpEndpoints.filter((e) => REAL_TLD_RE.test(e.replace(/^https?:\/\//i, '')));

  return {
    state: 'valid',
    name: typeof meta.name === 'string' ? meta.name.slice(0, 80) : null,
    active: meta.active === true,
    services: services.length,
    endpoints: httpEndpoints.slice(0, 6),
    plausible: plausible.length,
    mcp: services.some((x) => x && /mcp/i.test(String(x.name || ''))),
    a2a: services.some((x) => x && /a2a/i.test(String(x.name || ''))),
    x402: !!meta.x402Support || services.some((x) => x && /x402/i.test(String(x.name || ''))),
    trust: Array.isArray(meta.supportedTrust) ? meta.supportedTrust : [],
  };
}

// ---------------------------------------------------------------- storage

fs.mkdirSync(OUT, { recursive: true });
const STATE_FILE = path.join(OUT, 'scan-state.json');
const HITS_FILE = path.join(OUT, 'agents-with-endpoints.jsonl');
// Every registration that points somewhere instead of carrying its document.
// Kept in full because the follow-up question — does that URL actually serve an
// agent document — cannot be answered without the URL itself.
const OFFCHAIN_FILE = path.join(OUT, 'offchain-uris.jsonl');

const loadState = () => {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch {
    return {
      cursor: 1,
      highestId: null,
      counts: { unread: 0, empty: 0, unparsable: 0, offchain: 0, valid: 0, active: 0, withServices: 0, withHttpEndpoint: 0, plausibleEndpoint: 0, mcp: 0, a2a: 0, x402: 0 },
      startedAt: null,
      updatedAt: null,
    };
  }
};
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

// ---------------------------------------------------------------- highest id

// ownerOf(uint256) — reverts for an id that was never minted, returns an
// address for one that was. Used instead of tokenURI because it answers the
// question "does this id exist" directly, with no dependence on whether the
// registration document happens to be readable.
const OWNER_OF = '0x6352211e';

async function findHighestId() {
  // A node dropping a request looks exactly like a revert unless the two are
  // told apart deliberately. Getting this wrong once already reported the
  // registry as 671 ids when it holds a quarter of a million: the doubling
  // probe hit one transient failure and treated it as the end of the registry.
  // So a "no" is only believed after several endpoints independently say so.
  const exists = async (id) => {
    let sawRevert = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      const url = nextRpc();
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call',
            params: [{ to: REGISTRY, data: OWNER_OF + id32(id) }, 'latest'] }),
          signal: AbortSignal.timeout(15000),
        });
        const j = await r.json();
        if (j.result && j.result !== '0x' && BigInt(j.result) !== 0n) return true;
        // An explicit revert, or a zero owner, is evidence of absence — but
        // only evidence. Two independent ones are required.
        if (j.error || j.result === '0x' || (j.result && BigInt(j.result) === 0n)) {
          if (++sawRevert >= 2) return false;
        }
      } catch { /* transport failure proves nothing either way */ }
    }
    return false;
  };

  let hi = 1024;
  while (await exists(hi) && hi < 100_000_000) hi *= 2;
  let a = Math.floor(hi / 2), b = hi;
  while (a < b - 1) {
    const m = Math.floor((a + b) / 2);
    if (await exists(m)) a = m; else b = m;
  }
  return a;
}

// ---------------------------------------------------------------- report

function report() {
  const s = loadState();
  const c = s.counts;
  const scanned = s.cursor - 1;
  const pct = (n) => scanned ? ((n / scanned) * 100).toFixed(2) + '%' : '–';
  console.log(`\nERC-8004 registry census — BNB Smart Chain`);
  console.log(`registry ${REGISTRY}`);
  console.log(`highest id: ${s.highestId ? s.highestId.toLocaleString('en-US') : '(not determined)'}`);
  console.log(`scanned:    ${scanned.toLocaleString('en-US')}${s.highestId ? ` of ${s.highestId.toLocaleString('en-US')} (${((scanned / s.highestId) * 100).toFixed(1)}%)` : ''}\n`);
  const row = (label, n) => console.log(`  ${label.padEnd(30)} ${String(n).padStart(9)}  ${pct(n).padStart(7)}`);
  row('registration parses', c.valid);
  row('  of those, active:true', c.active);
  row('  names any service', c.withServices);
  row('  has an http endpoint', c.withHttpEndpoint);
  row('  endpoint on a real TLD', c.plausibleEndpoint);
  row('  speaks MCP', c.mcp);
  row('  speaks A2A', c.a2a);
  row('  supports x402', c.x402);
  console.log();
  row('points off-chain (URL)', c.offchain || 0);
  row('unparsable / not JSON', c.unparsable);
  row('empty token URI', c.empty);
  row('unread (node refused)', c.unread);
  if (fs.existsSync(HITS_FILE)) {
    const lines = fs.readFileSync(HITS_FILE, 'utf8').trim().split('\n').filter(Boolean);
    console.log(`\n  ${lines.length} agents with endpoints recorded in ${path.relative(ROOT, HITS_FILE)}`);
  }
  console.log();
}

if (args.includes('--report')) { report(); process.exit(0); }

// ---------------------------------------------------------------- scan

const state = loadState();
if (!state.startedAt) state.startedAt = new Date().toISOString();

// The frontier is re-read on EVERY run, not only the first.
//
// It used to be located once and then trusted forever, guarded by
// `if (!state.highestId)`. That made the census permanently blind to anything
// registered after the first run: the cursor would reach the old frontier,
// the script would report a complete scan, and every agent minted since would
// be missing — with nothing in the output to suggest it. We found this by
// registering two of our own agents and watching our own marketplace not
// notice them.
//
// A frontier that only ever moves forward is also the safe direction: a node
// answering badly could report a lower id than we have already scanned, and
// accepting that would rewind the census.
process.stdout.write('locating highest agent id… ');
const foundHighest = await findHighestId();
const previousHighest = state.highestId || 0;
state.highestId = Math.max(previousHighest, foundHighest);
console.log(
  state.highestId.toLocaleString('en-US')
  + (previousHighest && state.highestId > previousHighest
    ? `  (+${(state.highestId - previousHighest).toLocaleString('en-US')} new since the last run)`
    : previousHighest ? '  (unchanged)' : ''),
);
if (foundHighest < previousHighest) {
  console.log(`  note: the registry reported ${foundHighest.toLocaleString('en-US')}, below the ${previousHighest.toLocaleString('en-US')} already scanned. Keeping the higher figure — a frontier does not move backwards.`);
}
saveState(state);

const limit = Math.min(Number(arg('--max', state.highestId)) || state.highestId, state.highestId);
const hits = fs.createWriteStream(HITS_FILE, { flags: 'a' });
const offchain = fs.createWriteStream(OFFCHAIN_FILE, { flags: 'a' });

// Ids the nodes refused. Drained in patient mode at the end of the run; only
// what survives THAT is genuinely unreadable.
//
// Persisted with the cursor, and that is not a detail. It used to live only in
// memory, so a run that was interrupted — a laptop closing, an internet drop —
// lost the list while the cursor had already moved past those ids. They stayed
// counted as unread forever, and nothing recorded WHICH ones they were, so
// there was no way to go back for them short of rescanning a quarter of a
// million ids. An unread entry is a fact about a node, and a census that cannot
// re-ask the node has quietly turned it into a fact about an agent.
const pendingRetry = Array.isArray(state.pendingRetry) ? state.pendingRetry.slice() : [];

console.log(`scanning ids ${state.cursor.toLocaleString('en-US')} … ${limit.toLocaleString('en-US')}`);
const t0 = Date.now();
let sinceLog = 0;

while (state.cursor <= limit) {
  // Several batches in flight, but not so many that the endpoints start
  // refusing — which would turn agents into "unread" and understate the census.
  const groups = [];
  for (let g = 0; g < CONCURRENCY && state.cursor + g * BATCH <= limit; g++) {
    const start = state.cursor + g * BATCH;
    const ids = [];
    for (let i = 0; i < BATCH && start + i <= limit; i++) ids.push(start + i);
    if (ids.length) groups.push(ids);
  }
  if (!groups.length) break;

  const results = await Promise.all(groups.map((ids) => callBatch(ids)));

  for (let gi = 0; gi < groups.length; gi++) {
    const ids = groups[gi];
    const res = results[gi];
    for (let i = 0; i < ids.length; i++) {
      const c = classify(res[i]);
      const k = state.counts;
      if (c.state === 'unread') { k.unread++; pendingRetry.push(ids[i]); }
      else if (c.state === 'empty') k.empty++;
      else if (c.state === 'offchain') {
        k.offchain++;
        offchain.write(JSON.stringify({ id: ids[i], uri: c.uri, host: c.host, scheme: c.scheme }) + '\n');
      }
      else if (c.state === 'unparsable') k.unparsable++;
      else {
        k.valid++;
        if (c.active) k.active++;
        if (c.services > 0) k.withServices++;
        if (c.endpoints.length) k.withHttpEndpoint++;
        if (c.plausible) k.plausibleEndpoint++;
        if (c.mcp) k.mcp++;
        if (c.a2a) k.a2a++;
        if (c.x402) k.x402++;
        if (c.endpoints.length) {
          hits.write(JSON.stringify({
            id: ids[i], name: c.name, active: c.active,
            endpoints: c.endpoints, mcp: c.mcp, a2a: c.a2a, x402: c.x402,
            plausible: c.plausible > 0, trust: c.trust,
          }) + '\n');
        }
      }
    }
  }

  state.cursor += groups.reduce((s, g) => s + g.length, 0);
  state.updatedAt = new Date().toISOString();
  sinceLog += groups.reduce((s, g) => s + g.length, 0);

  if (sinceLog >= 5000) {
    state.pendingRetry = pendingRetry;
    saveState(state);
    const done = state.cursor - 1;
    const rate = done / ((Date.now() - t0) / 1000);
    const left = (limit - done) / rate;
    console.log(`  ${done.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')}  ·  ${rate.toFixed(0)}/s  ·  ~${(left / 60).toFixed(0)} min left  ·  endpoints so far: ${state.counts.withHttpEndpoint}`);
    sinceLog = 0;
  }
}

// Go back for the ids the nodes refused.
//
// The comment above the retry list has claimed since the first version that
// this happens "at the end of the run". It did not: the list was collected and
// then dropped on the floor. It never showed because the first full census hit
// zero refusals, so `unread: 0` was true by luck rather than by design — and
// the moment a run hit a real outage it carried 1,675 permanently unread ids
// while still calling itself a census.
//
// Patient mode gives every endpoint several tries with backoff. What survives
// that is genuinely unreadable and is reported as such.
if (pendingRetry.length) {
  console.log(`\ndraining ${pendingRetry.length.toLocaleString('en-US')} refused ids patiently…`);
  const still = [];
  let recovered = 0;
  for (let i = 0; i < pendingRetry.length; i += BATCH) {
    const ids = pendingRetry.slice(i, i + BATCH);
    const res = await callBatch(ids, { patient: true });
    for (let k = 0; k < ids.length; k++) {
      const c = classify(res[k]);
      if (c.state === 'unread') { still.push(ids[k]); continue; }
      recovered++;
      const counts = state.counts;
      counts.unread = Math.max(0, counts.unread - 1);
      if (c.state === 'empty') counts.empty++;
      else if (c.state === 'offchain') {
        counts.offchain++;
        offchain.write(JSON.stringify({ id: ids[k], uri: c.uri, host: c.host, scheme: c.scheme }) + '\n');
      } else if (c.state === 'unparsable') counts.unparsable++;
      else {
        counts.valid++;
        if (c.active) counts.active++;
        if (c.services > 0) counts.withServices++;
        if (c.endpoints.length) counts.withHttpEndpoint++;
        if (c.plausible) counts.plausibleEndpoint++;
        if (c.mcp) counts.mcp++;
        if (c.a2a) counts.a2a++;
        if (c.x402) counts.x402++;
        if (c.endpoints.length) {
          hits.write(JSON.stringify({
            id: ids[k], name: c.name, active: c.active,
            endpoints: c.endpoints, mcp: c.mcp, a2a: c.a2a, x402: c.x402,
            plausible: c.plausible > 0, trust: c.trust,
          }) + '\n');
        }
      }
    }
  }
  state.pendingRetry = still;
  console.log(`  ${recovered.toLocaleString('en-US')} recovered, ${still.length.toLocaleString('en-US')} still unread`);
}

saveState(state);
// Both files are closed and flushed before the report reads anything back.
// end() only asks a stream to close; reporting straight after it reads a short
// file, which looks exactly like data the scan failed to collect.
await new Promise((r) => hits.end(r));
await new Promise((r) => offchain.end(r));
console.log(`\ndone in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
report();
