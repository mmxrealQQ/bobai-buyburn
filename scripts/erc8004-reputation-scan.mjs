// The half of ERC-8004 nobody reads: the ReputationRegistry.
//
// The identity registry says who exists. The escrow census says who has been
// paid. This says who has been RATED — and on BNB Smart Chain that turns out
// not to be stars out of five but machine-written attestations: uptime as a
// percentage and response time in milliseconds, each over a stated window.
//
// WHY THIS EXISTS
// Our own registration document has claimed `supportedTrust: ["reputation"]`
// since the day it was written, and nothing in this repo had ever called the
// contract. A claim nobody backs is the same class of thing this marketplace
// spends its time catching in other people's registrations.
//
// THE SHAPE, MEASURED RATHER THAN ASSUMED
//   getClients(uint256 agentId)                      -> address[]
//   getLastIndex(uint256 agentId, address client)    -> uint64      (1-based)
//   readFeedback(uint256, address, uint64 index)
//        -> (uint128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)
// The README for these contracts names the functions and not their types, and
// every getSummary/readAllFeedback shape we tried reverted empty — an empty
// revert says "wrong selector or wrong arguments" and nothing else, so the ABI
// here was recovered by calling until something answered and decoding what came
// back. Do not "tidy" it against the README.
//
// TAGS ARE UNITS, NOT LABELS. tag1 is the metric ("uptime", "responseTime"),
// tag2 is the window ("1d", "2d", "3d"). 10000 with 2 decimals under "uptime"
// is 100.00 percent; 224 with 0 decimals under "responseTime" is 224
// milliseconds. Averaging across tags would produce a number with no unit, so
// values are only ever aggregated within one tag.
//
// Usage:
//   node scripts/erc8004-reputation-scan.mjs --dir erc8004-v2
//   node scripts/erc8004-reputation-scan.mjs --dir erc8004-v2 --all
//   node scripts/erc8004-reputation-scan.mjs --self-test
import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, http, toFunctionSelector, encodeAbiParameters, parseAbiParameters, decodeAbiParameters } from 'viem';
import { bsc } from 'viem/chains';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const DIR = path.join(ROOT, 'data', String(arg('dir', 'erc8004-v2')));
const ALL = !!arg('all', false);
const SELFTEST = process.argv.includes('--self-test');

const REPUTATION = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
const IDENTITY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

// One client per host at a time. The identity census published 54 MCP servers
// instead of 235 because a dozen parallel requests to one host looked like a
// dead host — the same mistake here would publish "nobody is rated".
const RPCS = [
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed2.defibit.io',
  'https://bsc.publicnode.com',
];
const clients = RPCS.map((url) => ({ url, client: createPublicClient({ chain: bsc, transport: http(url) }), busy: false }));
let turn = 0;

const SEL = {
  clients: toFunctionSelector('getClients(uint256)'),
  lastIndex: toFunctionSelector('getLastIndex(uint256,address)'),
  read: toFunctionSelector('readFeedback(uint256,address,uint64)'),
  identityOf: toFunctionSelector('getIdentityRegistry()'),
};

async function raw(data, tries = RPCS.length * 2) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    const c = clients[turn++ % clients.length];
    try {
      const r = await c.client.call({ to: REPUTATION, data });
      return r.data ?? '0x';
    } catch (e) {
      lastErr = e;
      // An empty revert is the contract saying no, not the endpoint failing.
      // Retrying it against three more endpoints only wastes their patience.
      if (/reverted/i.test(String(e.shortMessage || e.message))) return null;
    }
  }
  throw lastErr || new Error('all endpoints failed');
}

const getClients = async (id) => {
  const d = await raw(SEL.clients + encodeAbiParameters(parseAbiParameters('uint256'), [BigInt(id)]).slice(2));
  if (!d || d === '0x') return [];
  return decodeAbiParameters(parseAbiParameters('address[]'), d)[0];
};
const getLastIndex = async (id, client) => {
  const d = await raw(SEL.lastIndex + encodeAbiParameters(parseAbiParameters('uint256, address'), [BigInt(id), client]).slice(2));
  if (!d || d === '0x') return 0;
  return Number(decodeAbiParameters(parseAbiParameters('uint64'), d)[0]);
};
const readFeedback = async (id, client, index) => {
  const d = await raw(SEL.read + encodeAbiParameters(parseAbiParameters('uint256, address, uint64'), [BigInt(id), client, BigInt(index)]).slice(2));
  if (!d || d === '0x') return null;
  const [value, decimals, tag1, tag2, revoked] = decodeAbiParameters(
    parseAbiParameters('uint128, uint8, string, string, bool'), d,
  );
  return { value: Number(value), decimals: Number(decimals), tag1, tag2, revoked };
};

// A value only means something next to its unit, so the unit travels with it.
const asNumber = (f) => f.value / 10 ** f.decimals;
const UNITS = { uptime: '%', responsetime: 'ms', latency: 'ms' };
const unitFor = (tag) => UNITS[String(tag || '').toLowerCase()] || '';

// TWO KINDS OF CLAIM, AND THEY ARE NOT COMPARABLE.
//
// An uptime or a response time is a measurement: a third party can go and take
// it again, and disagree. A "personality" of 70 is a taste claim about
// somebody else's agent — unfalsifiable, and on this chain written in bulk with
// the same constant. Both live in the same registry, and a marketplace that
// adds them up publishes a reputation layer that does not exist.
const WHAT_THIS_IS = [
  'Every rating in the ERC-8004 ReputationRegistry on BNB Smart Chain for the agents this marketplace lists.',
  'tag1 is what is being claimed, tag2 is the window it covers, and the value carries its own decimal places.',
  'Two kinds of claim live in here and they are not comparable: measurements a third party could take again',
  '(uptime, response time, liveness), and taste scores about an agent that nobody can falsify.',
  'The `checkable` block separates them; on this chain today almost all of it is the second kind.',
].join(' ');

const OPERATIONAL = new Set(['uptime', 'responsetime', 'latency', 'liveness']);
const isOperational = (tag) => OPERATIONAL.has(String(tag || '').toLowerCase());

// Everything derived from the raw records, in one place, so `--reaggregate`
// and a fresh scan can never produce two different summaries of one file.
function analyse(agents) {
  const rated = agents.filter((a) => a.feedback?.length);
  const rater = new Map(), tag = new Map();
  for (const a of rated) {
    for (const f of a.feedback) {
      const r = rater.get(f.client) || { attestations: 0, agents: new Set(), tags: new Set() };
      r.attestations++; r.agents.add(a.id); r.tags.add(f.tag1); rater.set(f.client, r);
      const t = tag.get(f.tag1) || { attestations: 0, agents: new Set(), values: [] };
      t.attestations++; t.agents.add(a.id); t.values.push(f.number); tag.set(f.tag1, t);
    }
  }
  const tags = [...tag].map(([name, t]) => {
    const sorted = t.values.slice().sort((a, b) => a - b);
    const counts = new Map();
    for (const v of t.values) counts.set(v, (counts.get(v) || 0) + 1);
    const [modeValue, modeCount] = [...counts].sort((a, b) => b[1] - a[1])[0];
    return {
      tag: name || '(untagged)',
      operational: isOperational(name),
      unit: unitFor(name),
      attestations: t.attestations,
      agents: t.agents.size,
      min: sorted[0],
      median: sorted[Math.floor(sorted.length / 2)],
      max: sorted[sorted.length - 1],
      // The share sitting on a single value. A tag whose commonest value covers
      // most of its records is a default being written, not a measurement.
      most_common: modeValue,
      most_common_share: +(modeCount / t.attestations).toFixed(4),
    };
  }).sort((a, b) => b.attestations - a.attestations);

  const raters = [...rater].map(([address, r]) => ({ address, attestations: r.attestations, agents: r.agents.size, tags: [...r.tags] }))
    .sort((a, b) => b.attestations - a.attestations);

  const opTags = tags.filter((t) => t.operational);
  const opAgents = new Set();
  let opCount = 0;
  for (const a of rated) for (const f of a.feedback) if (isOperational(f.tag1)) { opCount++; opAgents.add(a.id); }

  return {
    tags,
    raters,
    // The line that matters. Everything else in this file is a count of things
    // that can be written for free.
    checkable: {
      what: 'Attestations a third party could go and take again: uptime, response time, liveness. Everything else in this registry is a claim about an agent that cannot be falsified.',
      attestations: opCount,
      agents: opAgents.size,
      tags: opTags.map((t) => t.tag),
      share_of_all: agents.length ? +(opCount / Math.max(1, rated.reduce((n, a) => n + a.feedback.length, 0))).toFixed(6) : 0,
    },
    multi_rated: rated.filter((a) => (a.clients || []).length > 1).length,
    single_rated: rated.filter((a) => (a.clients || []).length === 1).length,
  };
}

// ── self-test ─────────────────────────────────────────────────────────────
// Pinned against a record that is on the chain right now, in both directions:
// the decoder must produce exactly this, and it must NOT produce it from a
// record that says something else.
if (SELFTEST) {
  const problems = [];
  const idHex = await raw(SEL.identityOf);
  const boundTo = idHex && idHex !== '0x' ? decodeAbiParameters(parseAbiParameters('address'), idHex)[0] : null;
  if (String(boundTo).toLowerCase() !== IDENTITY.toLowerCase()) {
    problems.push(`the reputation contract points at identity registry ${boundTo}, not the one this project censuses`);
  }
  const KNOWN = { id: 302257, client: '0xc7F5cdC8dd028E0b9aF2cA9d3891F135b23f4B92', index: 1, tag1: 'uptime', tag2: '1d', value: 100 };
  const f = await readFeedback(KNOWN.id, KNOWN.client, KNOWN.index);
  if (!f) problems.push(`the known attestation on #${KNOWN.id} could not be read at all`);
  else {
    if (f.tag1 !== KNOWN.tag1 || f.tag2 !== KNOWN.tag2) problems.push(`decoded tags "${f.tag1}"/"${f.tag2}", expected "${KNOWN.tag1}"/"${KNOWN.tag2}" — the ABI has drifted`);
    if (asNumber(f) !== KNOWN.value) problems.push(`decoded ${asNumber(f)} where the chain holds ${KNOWN.value} — value/decimals are being read wrong`);
  }
  // The other direction: an index past the end must come back empty rather
  // than as a confident zero. A scanner that turns "no data" into "rated 0"
  // would slander every agent nobody has rated.
  const past = await readFeedback(KNOWN.id, KNOWN.client, 99);
  if (past && !Number.isNaN(asNumber(past)) && (past.tag1 || past.value)) {
    problems.push('reading past the last index returned a record instead of nothing — absent ratings would be published as real ones');
  }
  const none = await getClients(304493);
  if (none.length) problems.push(`#304493 was expected to have no raters and returned ${none.length}`);

  console.log('\nReputation decoder self-test');
  if (problems.length) { for (const p of problems) console.log('  x ' + p); process.exit(1); }
  console.log('  bound to the same identity registry we census');
  console.log(`  known record decodes to ${KNOWN.value}${unitFor(KNOWN.tag1)} ${KNOWN.tag1}/${KNOWN.tag2}`);
  console.log('  an index past the end returns nothing, not a zero');
  console.log('  an unrated agent returns no raters');
  console.log('\nno problems.');
  process.exit(0);
}

// ── re-derive the summary without touching the chain ──────────────────────
// The raw records are the expensive part: 20,732 attestations is 20,732 calls.
// Once they are on disk, changing how they are summarised must not mean asking
// the chain again — and it must produce exactly what a fresh scan would, which
// is why both paths call the same analyse().
if (process.argv.includes('--reaggregate')) {
  const f = path.join(DIR, 'reputation.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  // WHAT_THIS_IS travels with the summary, not with the raw records. The
  // first version of this file called every record an attestation "not an
  // opinion", which the reaggregation then disproved — and a stale sentence
  // survived into the published API because only the numbers were refreshed.
  const next = { ...j, what_this_is: WHAT_THIS_IS, ...analyse(j.agents || []), agents: j.agents, reaggregated_at: new Date().toISOString() };
  fs.writeFileSync(f, JSON.stringify(next, null, 1) + '\n');
  console.log(`re-derived the summary of ${j.rated.attestations} attestations over ${j.rated.agents} agents`);
  console.log(`  checkable: ${next.checkable.attestations} attestations over ${next.checkable.agents} agents (${next.checkable.tags.join(', ')})`);
  console.log(`  the rest:  ${j.rated.attestations - next.checkable.attestations} taste scores`);
  for (const t of next.tags.slice(0, 8)) {
    console.log(`  ${t.tag.padEnd(14)} ${String(t.attestations).padStart(6)} · ${String(t.agents).padStart(4)} agents · most common ${t.most_common} in ${(t.most_common_share * 100).toFixed(0)}%`);
  }
  process.exit(0);
}

// ── which agents to ask about ─────────────────────────────────────────────
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return d; } };
const ids = new Set();
const names = new Map();

for (const a of readJson('hireable.json', { agents: [] }).agents || []) { ids.add(Number(a.id)); names.set(Number(a.id), a.label || a.name); }
try {
  const own = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'own-agents.json'), 'utf8'));
  for (const a of Object.values(own.agents || {})) if (a.id) { ids.add(Number(a.id)); names.set(Number(a.id), a.name); }
} catch { /* nothing registered yet */ }

if (ALL) {
  // Everything that answered at all. The denominator has to be a set somebody
  // can name, or "N agents are rated" is a number without a population.
  const f = path.join(DIR, 'reachable.jsonl');
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const j = JSON.parse(line); if (j.reachable) { ids.add(Number(j.id)); names.set(Number(j.id), j.name); } } catch { /* skip */ }
    }
  }
}

const list = [...ids].sort((a, b) => a - b);
console.log(`Reading the ERC-8004 ReputationRegistry for ${list.length} agents on BNB Smart Chain\n`);

// ── the scan ──────────────────────────────────────────────────────────────
const out = [];
let done = 0, rated = 0, attestations = 0, failed = 0;
const raters = new Map();

const CONC = clients.length;
const queue = list.slice();
await Promise.all(Array.from({ length: CONC }, async () => {
  for (;;) {
    const id = queue.shift();
    if (id === undefined) return;
    try {
      const cs = await getClients(id);
      const rec = { id, name: names.get(id) || null, clients: cs, feedback: [] };
      for (const c of cs) {
        const last = await getLastIndex(id, c);
        for (let i = 1; i <= last; i++) {
          const f = await readFeedback(id, c, i);
          if (!f) continue;
          rec.feedback.push({ client: c, index: i, ...f, number: asNumber(f), unit: unitFor(f.tag1) });
        }
        raters.set(c, (raters.get(c) || 0) + 1);
      }
      if (rec.feedback.length) { rated++; attestations += rec.feedback.length; out.push(rec); }
    } catch (e) {
      failed++;
      out.push({ id, name: names.get(id) || null, error: String(e.shortMessage || e.message).slice(0, 120) });
    }
    if (++done % 100 === 0) process.stderr.write(`  ${done}/${list.length} · ${rated} rated · ${attestations} attestations\n`);
  }
}));

// Latest value per metric, per agent. Not an average across windows: a 1d and
// a 3d uptime are two different measurements of two different periods, and
// averaging them would invent a window nobody measured.
const byTag = (rec) => {
  const m = {};
  for (const f of rec.feedback || []) {
    if (f.revoked) continue;
    const k = f.tag1 || '(untagged)';
    if (!m[k] || f.index > m[k].index) m[k] = { value: f.number, unit: f.unit, window: f.tag2 || null, index: f.index, client: f.client };
  }
  return m;
};
for (const rec of out) if (rec.feedback) rec.latest = byTag(rec);

const kept = out.filter((r) => r.feedback?.length || r.error).sort((a, b) => (b.feedback?.length || 0) - (a.feedback?.length || 0));
const payload = {
  what_this_is: WHAT_THIS_IS,
  contract: REPUTATION,
  identity_registry: IDENTITY,
  chain: 'eip155:56',
  measured_at: new Date().toISOString(),
  population: { asked: list.length, source: ALL ? 'every agent that answered in the last scan, plus everything hireable here' : 'everything hireable on this marketplace, plus our own agents' },
  rated: { agents: rated, attestations, distinct_raters: raters.size, unreadable: failed },
  ...analyse(kept),
  agents: kept,
};
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'reputation.json'), JSON.stringify(payload, null, 1) + '\n');

console.log(`asked            ${list.length}`);
console.log(`rated            ${rated}`);
console.log(`attestations     ${attestations}`);
console.log(`distinct raters  ${raters.size}`);
if (failed) console.log(`unreadable       ${failed}`);
console.log('');
for (const r of payload.agents.slice(0, 14)) {
  if (r.error) { console.log(`  ${String(r.id).padEnd(8)} ${String(r.name || '').slice(0, 34).padEnd(36)} unreadable: ${r.error}`); continue; }
  const bits = Object.entries(r.latest || {}).map(([tag, v]) => `${tag} ${v.value}${v.unit}${v.window ? ` /${v.window}` : ''}`);
  console.log(`  ${String(r.id).padEnd(8)} ${String(r.name || '').slice(0, 34).padEnd(36)} ${bits.join(' · ')}`);
}
console.log(`\nwrote ${path.relative(ROOT, path.join(DIR, 'reputation.json'))}`);
