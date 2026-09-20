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
// THE SHAPE — RECOVERED FIRST, THEN VERIFIED
//   getClients(uint256 agentId)                      -> address[]
//   getLastIndex(uint256 agentId, address client)    -> uint64      (1-based)
//   readFeedback(uint256, address, uint64 index)
//        -> (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)
// The README for these contracts names the functions and not their types, so
// this was originally recovered by calling the contract until something
// answered. On 1 September 2026 the implementation behind the proxy turned out
// to be verified source and could simply be read (see lib/erc8004-reputation.mjs),
// which corrected one type: `value` is int128, not uint128. Nothing on this
// chain is negative today, so no published number was ever wrong — but the
// first negative rating would have decoded as 3.4e38 instead of a minus sign.
// The other correction: getSummary and readAllFeedback never had a wrong
// selector. They revert with "clientAddresses required" on an empty client
// list. They work; we were calling them wrongly.
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
import { isOperational, unitFor } from './lib/erc8004-reputation.mjs';

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
    parseAbiParameters('int128, uint8, string, string, bool'), d,
  );
  return { value: Number(value), decimals: Number(decimals), tag1, tag2, revoked };
};

// A value only means something next to its unit, so the unit travels with it.
const asNumber = (f) => f.value / 10 ** f.decimals;

// TWO KINDS OF CLAIM, AND THEY ARE NOT COMPARABLE — the set that decides which
// is which lives in lib/erc8004-reputation.mjs, because the writer
// (erc8004-give-feedback.mjs) enforces the same list as a rule about what this
// project is willing to put on a public registry. A reader that separates
// measurement from taste while the writer does not obey the separation would be
// a rule we only apply to other people.
//
// This sentence travels with the summary rather than with the raw records: the
// first version of this file called every record an attestation "not an
// opinion", which the reaggregation then disproved, and a stale sentence
// survived into the published API because only the numbers were refreshed.
const WHAT_THIS_IS = [
  'Every rating in the ERC-8004 ReputationRegistry on BNB Smart Chain for the agents this marketplace lists.',
  'tag1 is what is being claimed, tag2 is the window it covers, and the value carries its own decimal places.',
  'Two kinds of claim live in here and they are not comparable: measurements a third party could take again',
  '(uptime, response time, liveness), and taste scores about an agent that nobody can falsify.',
  'The `checkable` block separates them; on this chain today almost all of it is the second kind.',
].join(' ');

// Latest value per metric, PER RATER. Not an average across windows: a 1d and
// a 3d uptime are two different measurements of two different periods, and
// averaging them would invent a window nobody measured.
//
// WHY THIS IS A LIST PER TAG AND NOT ONE VALUE
// feedbackIndex is per (agent, client). Index 2 from one rater is not "newer"
// than index 1 from another, and the record the contract stores carries no
// timestamp to break the tie. The first version of this function kept one value
// per tag by highest index, which silently dropped a second rater's measurement
// the moment one existed — and one existed the day this marketplace wrote its
// own. Two independent parties measuring the same agent is the most useful
// thing a reputation registry can show; hiding one of them for a tidier row
// would throw away the only part that makes the registry worth reading.
const byTag = (rec) => {
  const m = {};
  for (const f of rec.feedback || []) {
    if (f.revoked) continue;
    const k = f.tag1 || '(untagged)';
    if (!m[k]) m[k] = new Map();
    const prev = m[k].get(f.client);
    if (!prev || f.index > prev.index) {
      m[k].set(f.client, { client: f.client, value: f.number, unit: f.unit, window: f.tag2 || null, index: f.index });
    }
  }
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v.values()].sort((a, b) => a.client.localeCompare(b.client))]));
};

// Everything the registry holds about one agent. The full scan and the targeted
// refresh must read identically, or a refreshed row would differ from a scanned
// one for reasons nobody could see.
async function readAgent(id, name) {
  const cs = await getClients(id);
  const rec = { id, name: name || null, clients: cs, feedback: [] };
  for (const c of cs) {
    const last = await getLastIndex(id, c);
    for (let i = 1; i <= last; i++) {
      const f = await readFeedback(id, c, i);
      if (!f) continue;
      rec.feedback.push({ client: c, index: i, ...f, number: asNumber(f), unit: unitFor(f.tag1) });
    }
  }
  return rec;
}

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
  // An id nobody can have rated: far past the last one the registry has issued.
  // Until 2026-09-20 this pin named our own #304493 as "unrated" — true the day
  // it was written, and false once two wallets had rated it; the self-test then
  // failed for a fact about the chain, not about the decoder.
  const NEVER_ISSUED = 4_000_000_000;
  const none = await getClients(NEVER_ISSUED);
  if (none.length) problems.push(`id ${NEVER_ISSUED} was never issued and still returned ${none.length} raters`);
  // And the same call on an agent that IS rated must not come back empty — or
  // an empty answer above would prove nothing.
  const some = await getClients(KNOWN.id);
  if (!some.length) problems.push(`#${KNOWN.id} carries the known attestation and returned no raters`);

  // The signed-value pin. Until 1 September this decoder read `value` as
  // uint128, which is right for every record on this chain today and wrong for
  // the first one anybody writes below zero: -5 would have been published as
  // 3.4e38. There is no negative record to read, so the check is made against a
  // payload instead — which is also what stops the type being "tidied" back.
  const negative = decodeAbiParameters(
    parseAbiParameters('int128, uint8, string, string, bool'),
    encodeAbiParameters(parseAbiParameters('int128, uint8, string, string, bool'), [-5n, 0, 'uptime', '1d', false]),
  );
  if (Number(negative[0]) !== -5) problems.push(`a value of -5 decoded as ${negative[0]} — value is int128, not uint128`);

  console.log('\nReputation decoder self-test');
  if (problems.length) { for (const p of problems) console.log('  x ' + p); process.exit(1); }
  console.log('  bound to the same identity registry we census');
  console.log(`  known record decodes to ${KNOWN.value}${unitFor(KNOWN.tag1)} ${KNOWN.tag1}/${KNOWN.tag2}`);
  console.log('  an index past the end returns nothing, not a zero');
  console.log('  an unrated agent returns no raters');
  console.log('  a negative value decodes as negative, not as 3.4e38');
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
  // `latest` is derived too, not carried over. It changed shape once already —
  // from one value per tag to one per rater — and a reaggregation that refreshed
  // the numbers while leaving the old shape in place would publish two shapes in
  // one file, which is how a renderer ends up printing one rater and dropping
  // the other.
  const agents = (j.agents || []).map((a) => (a.feedback ? { ...a, latest: byTag(a) } : a));
  const next = { ...j, what_this_is: WHAT_THIS_IS, ...analyse(agents), agents, reaggregated_at: new Date().toISOString() };
  fs.writeFileSync(f, JSON.stringify(next, null, 1) + '\n');
  console.log(`re-derived the summary of ${j.rated.attestations} attestations over ${j.rated.agents} agents`);
  console.log(`  checkable: ${next.checkable.attestations} attestations over ${next.checkable.agents} agents (${next.checkable.tags.join(', ')})`);
  console.log(`  the rest:  ${j.rated.attestations - next.checkable.attestations} taste scores`);
  for (const t of next.tags.slice(0, 8)) {
    console.log(`  ${t.tag.padEnd(14)} ${String(t.attestations).padStart(6)} · ${String(t.agents).padStart(4)} agents · most common ${t.most_common} in ${(t.most_common_share * 100).toFixed(0)}%`);
  }
  process.exit(0);
}

// ── refresh a few agents without re-reading 20,000 attestations ───────────
// A full --all scan is 20,732 calls and about twenty minutes, and it is not
// resumable: a failure at minute nineteen costs the lot. That is the wrong
// tool for "we just wrote two attestations and the file should say so". This
// re-reads exactly the named agents, merges them into the file that is already
// there, and re-derives the summary through the same analyse() the scan uses.
if (arg('refresh', false)) {
  const wanted = String(arg('refresh', '')).split(/[,\s]+/).filter(Boolean).map(Number);
  if (!wanted.length) { console.error('--refresh needs one or more agent ids'); process.exit(1); }
  const f = path.join(DIR, 'reputation.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const agents = (j.agents || []).slice();
  for (const id of wanted) {
    const before = agents.findIndex((a) => Number(a.id) === id);
    const rec = await readAgent(id, before > -1 ? agents[before].name : null);
    rec.latest = byTag(rec);
    const was = before > -1 ? (agents[before].feedback?.length || 0) : 0;
    if (before > -1) agents[before] = rec; else agents.push(rec);
    console.log(`  ${String(id).padEnd(8)} ${was} -> ${rec.feedback.length} attestations from ${rec.clients.length} client(s)`);
  }
  const attestations = agents.reduce((n, a) => n + (a.feedback?.length || 0), 0);
  const distinct = new Set();
  for (const a of agents) for (const fb of a.feedback || []) distinct.add(fb.client);
  const next = {
    ...j,
    what_this_is: WHAT_THIS_IS,
    rated: { ...j.rated, agents: agents.filter((a) => a.feedback?.length).length, attestations, distinct_raters: distinct.size },
    ...analyse(agents),
    agents,
    refreshed_at: new Date().toISOString(),
    // The scan timestamp is NOT moved. Most of this file is still as old as the
    // scan that produced it, and stamping it "now" because two rows were
    // re-read would age-launder the other 794.
    refreshed: wanted,
  };
  fs.writeFileSync(f, JSON.stringify(next, null, 1) + '\n');
  console.log(`\n${attestations} attestations over ${next.rated.agents} agents · checkable ${next.checkable.attestations} over ${next.checkable.agents}`);
  console.log(`refreshed ${wanted.length} agent(s) in ${path.relative(ROOT, f)} — scan timestamp left at ${String(j.measured_at).slice(0, 16)}`);
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
      const rec = await readAgent(id, names.get(id) || null);
      for (const c of rec.clients) raters.set(c, (raters.get(c) || 0) + 1);
      if (rec.feedback.length) { rated++; attestations += rec.feedback.length; out.push(rec); }
    } catch (e) {
      failed++;
      out.push({ id, name: names.get(id) || null, error: String(e.shortMessage || e.message).slice(0, 120) });
    }
    if (++done % 100 === 0) process.stderr.write(`  ${done}/${list.length} · ${rated} rated · ${attestations} attestations\n`);
  }
}));

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
  const bits = Object.entries(r.latest || {}).flatMap(([tag, vs]) => vs.map((v) => `${tag} ${v.value}${v.unit}${v.window ? ` /${v.window}` : ''}`));
  console.log(`  ${String(r.id).padEnd(8)} ${String(r.name || '').slice(0, 34).padEnd(36)} ${bits.join(' · ')}`);
}
console.log(`\nwrote ${path.relative(ROOT, path.join(DIR, 'reputation.json'))}`);
