#!/usr/bin/env node
// Writes feedback INTO the ERC-8004 ReputationRegistry, instead of only reading it.
//
// WHY THIS EXISTS
// Our registration document has claimed `supportedTrust: ["reputation"]` since
// the day it was written. On 31 August we finally read the registry and
// published what is in it: 20,732 ratings on BNB Smart Chain, of which 36 say
// anything a third party could check. Reading it closed half the claim. This
// closes the other half — the half where we stop being a spectator of a trust
// layer we advertise support for.
//
// WHAT IS ATTESTED, AND WHY ONLY THIS
// One number: `responseTime`, in milliseconds, being the median time a seller
// took to answer an ERC-8183 price negotiation, over several probes in a stated
// window. Not a star rating, not a "personality" score. The registry is full of
// the second kind — 20,696 of them, most sitting on the constant 70 — and this
// project's standing rule is that a measurement and a taste claim never get
// added together. A writer that will not obey the rule its own reader enforces
// is worth nothing, so this refuses any tag outside the operational set.
//
// WHERE THE MILLISECONDS COME FROM
// Not from this machine. The timing is taken inside our Cloudflare worker
// around the seller's HTTP call alone (`seller_ms` from /hire), because a
// number measured over a phone hotspot would be a fact about the hotspot. Our
// own agents answer that broker in-process and are marked `loopback`; their
// timing is not comparable and is never attested — and the contract would
// refuse it anyway, since it blocks feedback from an agent's own operator.
//
// THE EVIDENCE IS PART OF THE ATTESTATION
// giveFeedback carries `feedbackURI` and `feedbackHash`, and almost nothing on
// this chain uses them. Every probe — including the failures — is written to a
// file, published, and the keccak256 of its exact bytes goes on-chain with the
// number. That is the difference between "we say 352 ms" and "here is the run,
// go and disagree with it". `--confirm` refuses to send unless the URI is live
// and serves exactly those bytes: we do not attest a document we cannot fetch.
//
// WHAT IS DELIBERATELY NOT WRITTEN
// Nothing about the agents that did not answer. A 0 on a public registry from a
// single window is a heavier claim than a page that says "did not quote when
// asked, at this timestamp, for this reason" — which is what /registry already
// says, with the reason kept verbatim. `--include-silent` exists so the choice
// is on the record rather than hidden, and it is off.
//
//   node scripts/erc8004-give-feedback.mjs                 # measure, write the evidence, print the plan
//   node scripts/erc8004-give-feedback.mjs --confirm       # verify the published evidence, then send
//   node scripts/erc8004-give-feedback.mjs --self-test     # pin the encoder and every refusal
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, http, keccak256, toBytes, formatEther, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { CENSUS_DIR } from './lib/census-dir.mjs';
import {
  REPUTATION, IDENTITY, REPUTATION_ABI, IDENTITY_ABI, ABI_SOURCE, OPERATIONAL, isOperational, unitFor,
} from './lib/erc8004-reputation.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const has = (name) => process.argv.includes(`--${name}`);

const DIR = path.join(ROOT, 'data', String(arg('dir', CENSUS_DIR)));
const EVIDENCE_DIR = path.join(DIR, 'feedback');
const PUBLISH_DIR = path.join(ROOT, 'dashboard', 'evidence');
const EVIDENCE_BASE = 'https://brainonbnb.com/evidence/';
const ORIGIN = String(arg('origin', 'https://agent.brainonbnb.com'));

const PROBES = Number(arg('probes', 5));
const INTERVAL_S = Number(arg('interval', 60));
const CONFIRM = has('confirm');
const SELFTEST = has('self-test');
const INCLUDE_SILENT = has('include-silent');

// ── the rails ─────────────────────────────────────────────────────────────
// Each one is a refusal, not a warning. A writer to a public registry that
// warns and proceeds is a writer with no rules.
const RAILS = {
  // Three is the smallest number from which a median means anything. One probe
  // is an anecdote and must not become a permanent public number.
  minProbes: 3,
  // A run that wants to write more than this is a bug in the plan.
  maxPerRun: 6,
  // A negotiation that took longer than this did not measure a seller, it
  // measured a timeout.
  maxMs: 25000,
  // Milliseconds are integers; a fractional millisecond is fake precision.
  decimals: 0,
  tag: 'responseTime',
};

const TASK = {
  rebalancing: 'quote rebalancing my liquidity position back to its target range',
  'grid-trading': 'quote a grid trading plan for the BNB/USDT pair',
  'yield-optimization': 'quote finding the best yield for my BNB on BNB Chain',
  'health-factor': 'monitor the health factor on my Venus position',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};
// A window a reader can hold in their head, derived from the run that was
// actually performed rather than chosen to look impressive.
const windowLabel = (ms) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.round(m / 60)}h` : `${Math.max(1, m)}m`;
};

const publicClient = createPublicClient({
  chain: bsc,
  transport: http(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org'),
});

// ── what may be attested at all ───────────────────────────────────────────
// Returned as reasons rather than thrown, so a run prints every refusal
// instead of stopping at the first.
export function vet(record, { self }) {
  const bad = [];
  if (!isOperational(record.tag1)) {
    bad.push(`"${record.tag1}" is not a measurement — this writer only attests ${[...OPERATIONAL].join(', ')}`);
  }
  if (self) bad.push('we own or operate this agent; rating it would be self-feedback, which the contract also refuses');
  if (record.loopback) bad.push('the timing came from an in-process loopback, which is not comparable to a network call');
  if (record.probes_ok < RAILS.minProbes) {
    bad.push(`${record.probes_ok} usable probe(s); a median needs at least ${RAILS.minProbes}`);
  }
  if (!(record.value > 0) || record.value > RAILS.maxMs) {
    bad.push(`${record.value} ms is outside the range this measurement can produce (1..${RAILS.maxMs})`);
  }
  if (!Number.isInteger(record.value)) bad.push('a millisecond count must be an integer');
  if (!record.endpoint || !/^https:\/\//.test(record.endpoint)) {
    bad.push('the probed endpoint is not an https URL, so nobody can repeat the measurement');
  }
  return bad;
}

// ── self-test ─────────────────────────────────────────────────────────────
if (SELFTEST) {
  const problems = [];
  const ok = { tag1: RAILS.tag, value: 352, probes_ok: 5, endpoint: 'https://example.org/a2a', loopback: false };
  if (vet(ok, { self: false }).length) problems.push('a valid measurement was refused');
  const cases = [
    ['a taste score', { ...ok, tag1: 'personality' }, { self: false }],
    ['our own agent', ok, { self: true }],
    ['a loopback timing', { ...ok, loopback: true }, { self: false }],
    ['a single probe', { ...ok, probes_ok: 1 }, { self: false }],
    ['a timeout', { ...ok, value: 90000 }, { self: false }],
    ['a zero', { ...ok, value: 0 }, { self: false }],
    ['a fractional millisecond', { ...ok, value: 352.4 }, { self: false }],
    ['an http endpoint', { ...ok, endpoint: 'http://example.org/a2a' }, { self: false }],
  ];
  for (const [what, rec, opts] of cases) {
    if (!vet(rec, opts).length) problems.push(`${what} was accepted`);
  }

  // The encoder, against viem, on the exact call this script sends. Other
  // parts of this project hand-encode ABI, and that is where the bugs live.
  const hash = keccak256(toBytes('evidence'));
  const data = encodeFunctionData({
    abi: REPUTATION_ABI,
    functionName: 'giveFeedback',
    args: [265375n, 352n, 0, 'responseTime', '5m', 'https://x.invalid/a2a', 'https://brainonbnb.com/evidence/x.json', hash],
  });
  if (!/^0x[0-9a-f]+$/.test(data)) problems.push('giveFeedback did not encode');

  // Both directions on the chain itself: the contract must refuse our own
  // agents and accept a foreign one. A rail nobody has watched fire is a
  // comment, not a rail.
  const me = process.env.AGENT_PROVIDER_WALLET;
  if (me) {
    for (const [id, expected] of [[302257n, true], [265375n, false]]) {
      const authorized = await publicClient.readContract({
        address: IDENTITY, abi: IDENTITY_ABI, functionName: 'isAuthorizedOrOwner', args: [me, id],
      });
      if (authorized !== expected) problems.push(`isAuthorizedOrOwner(us, ${id}) is ${authorized}, expected ${expected}`);
    }
  }
  const bound = await publicClient.readContract({ address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getIdentityRegistry' });
  if (bound.toLowerCase() !== IDENTITY.toLowerCase()) {
    problems.push(`the reputation contract points at ${bound}, not the identity registry this project censuses`);
  }

  console.log('\nFeedback writer self-test');
  if (problems.length) {
    for (const p of problems) console.log('  x ' + p);
    process.exitCode = 1;
  } else {
    console.log('  a measured response time is accepted');
    console.log(`  refused: ${cases.map(([w]) => w).join(', ')}`);
    console.log('  giveFeedback encodes against the verified ABI');
    console.log('  the chain agrees about who we are allowed to rate');
    console.log('  the registry is bound to the identity registry we census');
    console.log('\nno problems.');
    process.exitCode = 0;
  }
  // NO process.exit HERE. After a viem read, process.exit() trips a libuv
  // assertion on Windows (Node 24) and the run ends with code 127 — a
  // self-test that passed and then reported failure, measured 2026-09-02.
  // The live path below is skipped and the process closes its own sockets.
}

if (!SELFTEST) {
// ── who gets probed ───────────────────────────────────────────────────────
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const confirmFile = path.join(DIR, 'hire-confirm.json');

function population() {
  const only = arg('agent', null);
  const all = readJson(confirmFile, { agents: [] }).agents || [];
  if (!all.length) throw new Error(`${confirmFile} is empty — run scripts/erc8004-hire-confirm.mjs first`);
  let list = all.filter((a) => !a.ours);
  if (only && only !== true) list = list.filter((a) => String(a.id) === String(only));
  // The ones that answered when the marketplace last asked. See the header for
  // why silence is published on the page and not on the chain.
  if (!INCLUDE_SILENT) list = list.filter((a) => a.quotes);
  return list;
}

// ── the measurement ───────────────────────────────────────────────────────
async function probe(agent) {
  let j = {};
  try {
    const r = await fetch(`${ORIGIN}/hire`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: String(agent.id), task: TASK[agent.category] || TASK.rebalancing }),
      signal: AbortSignal.timeout(90000),
    });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    j = { error: String(e.message || e) };
  }
  const ok = !!(j.negotiated && j.quote?.price);
  return {
    at: new Date().toISOString(),
    ok,
    seller_ms: typeof j.seller_ms === 'number' ? j.seller_ms : null,
    loopback: !!j.seller_ms_loopback,
    endpoint: j.endpoint || null,
    price: j.quote?.price || null,
    // Verbatim. A seller failing with its own wallet-store permission error is
    // a different fact from one that is offline, and flattening both to
    // "unavailable" throws away the more interesting half.
    error: ok ? null : String(j.error || 'no quote in the answer').slice(0, 160),
  };
}

async function measure(agents) {
  const startedAt = Date.now();
  const runs = new Map(agents.map((a) => [a.id, []]));
  console.log(`Probing ${agents.length} agent(s) ${PROBES}x at ${INTERVAL_S}s spacing — about ${Math.round((PROBES - 1) * INTERVAL_S / 60)} minutes.\n`);
  for (let round = 1; round <= PROBES; round++) {
    for (const a of agents) {
      // Serial, one host at a time. These are strangers' servers and the whole
      // point is to be the kind of caller we wish other people's scanners were.
      const p = await probe(a);
      runs.get(a.id).push(p);
      console.log(`  round ${round}  ${String(a.id).padEnd(7)} ${p.ok ? `${String(p.seller_ms).padStart(5)} ms` : '   --  '}  ${p.ok ? p.price : p.error}`);
      await sleep(500);
    }
    if (round < PROBES) await sleep(INTERVAL_S * 1000);
  }
  const endedAt = Date.now();

  const records = [];
  for (const a of agents) {
    const probes = runs.get(a.id);
    const good = probes.filter((p) => p.ok && typeof p.seller_ms === 'number');
    const times = good.map((p) => p.seller_ms);
    records.push({
      id: a.id,
      label: a.label,
      category: a.category,
      endpoint: good[0]?.endpoint || probes[0]?.endpoint || null,
      loopback: probes.some((p) => p.loopback),
      tag1: RAILS.tag,
      tag2: windowLabel(endedAt - startedAt),
      value: times.length ? median(times) : 0,
      decimals: RAILS.decimals,
      unit: unitFor(RAILS.tag),
      probes: probes.length,
      probes_ok: good.length,
      min_ms: times.length ? Math.min(...times) : null,
      max_ms: times.length ? Math.max(...times) : null,
      // Recorded, not attested: availability over this window is a fact about
      // a few minutes, and a few minutes is not an uptime.
      answered_share: +(good.length / probes.length).toFixed(4),
      runs: probes,
    });
  }
  return { startedAt, endedAt, records };
}

// ── the evidence document ─────────────────────────────────────────────────
const evidenceDoc = (m) => ({
  what_this_is:
    'Every probe behind the responseTime feedback this marketplace wrote into the ERC-8004 '
    + 'ReputationRegistry on BNB Smart Chain, including the ones that failed. The number on-chain is the '
    + 'median of the successful probes; this file is what it was taken from, and the keccak256 of these '
    + 'exact bytes is the feedbackHash stored beside it.',
  how_to_repeat:
    'POST {"agent":"<id>","task":"<the task for its category>"} to https://agent.brainonbnb.com/hire and read '
    + 'seller_ms. That field times the seller\'s HTTP call alone, inside a Cloudflare worker, so it contains '
    + 'neither our connection nor yours. The prober is scripts/erc8004-give-feedback.mjs.',
  not_attested:
    'The share of probes that answered is recorded here and is NOT written on-chain: a few minutes of '
    + 'availability is not an uptime. Agents that did not answer at all are not rated here either — they are '
    + 'published on https://brainonbnb.com/registry with the reason they gave, verbatim.',
  chain: 56,
  contract: REPUTATION,
  abi_source: ABI_SOURCE,
  written_by: process.env.AGENT_PROVIDER_WALLET || null,
  measured_from: 'Cloudflare worker at agent.brainonbnb.com',
  window_started: new Date(m.startedAt).toISOString(),
  window_ended: new Date(m.endedAt).toISOString(),
  probes_per_agent: PROBES,
  agents: m.records,
});

const stampName = (d) => `reputation-${d.toISOString().replace(/[:.]/g, '-').slice(0, 16)}Z.json`;

// ── plan: measure, write the evidence, print what would go on-chain ───────
if (!CONFIRM) {
  const agents = population();
  if (!agents.length) { console.error('nobody to probe.'); process.exit(1); }
  const m = await measure(agents);
  const doc = evidenceDoc(m);
  // Serialised once. These bytes are the thing that gets hashed, so nothing
  // may re-serialise them later.
  const bytes = JSON.stringify(doc, null, 1) + '\n';
  const name = stampName(new Date(m.endedAt));
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.mkdirSync(PUBLISH_DIR, { recursive: true });
  // A new file every run. Overwriting one would silently break the hash of a
  // feedback already on the chain, and nothing on a public registry may be
  // quietly rewritten.
  for (const p of [path.join(EVIDENCE_DIR, name), path.join(PUBLISH_DIR, name)]) {
    if (fs.existsSync(p)) { console.error(`${p} already exists — refusing to overwrite published evidence`); process.exit(1); }
    fs.writeFileSync(p, bytes);
  }
  const hash = keccak256(toBytes(bytes));
  const uri = EVIDENCE_BASE + name;

  const me = process.env.AGENT_PROVIDER_WALLET;
  console.log(`\nEvidence  ${path.relative(ROOT, path.join(PUBLISH_DIR, name))}`);
  console.log(`  keccak256 ${hash}`);
  console.log(`  will be attested as ${uri}\n`);
  console.log('Planned feedback:');
  let sendable = 0;
  for (const r of doc.agents) {
    const self = me
      ? await publicClient.readContract({ address: IDENTITY, abi: IDENTITY_ABI, functionName: 'isAuthorizedOrOwner', args: [me, BigInt(r.id)] })
      : false;
    const bad = vet(r, { self });
    if (!bad.length) {
      sendable++;
      console.log(`  ${String(r.id).padEnd(7)} ${r.tag1} = ${r.value} ${r.unit} over ${r.tag2}  (${r.probes_ok}/${r.probes} answered, ${r.min_ms}-${r.max_ms} ms)  ${r.label}`);
    } else {
      console.log(`  ${String(r.id).padEnd(7)} not written — ${bad.join('; ')}`);
    }
  }
  console.log(`\n${sendable} of ${doc.agents.length} would be written.`);
  console.log('\nNext:');
  console.log('  1. deploy the dashboard so the evidence URL is live');
  console.log(`  2. node scripts/erc8004-give-feedback.mjs --confirm --evidence ${name}`);
  process.exit(0);
}

// ── confirm: verify the published evidence, then write ────────────────────
const chosen = String(arg('evidence', '') || '') || fs.readdirSync(EVIDENCE_DIR).filter((f) => !f.includes('.receipts.')).sort().pop();
if (!chosen) { console.error('no evidence file — run without --confirm first'); process.exit(1); }
const localPath = path.join(EVIDENCE_DIR, chosen);
const bytes = fs.readFileSync(localPath, 'utf8');
const hash = keccak256(toBytes(bytes));
const uri = EVIDENCE_BASE + chosen;

// THE TRAP THIS CHECKS FOR
// An unrouted path on this domain answers 200 with the HTML shell, so "it did
// not 404" proves nothing. The published bytes must be byte-identical to the
// file that was hashed, or the attestation points at a document that says
// something else.
const res = await fetch(uri, { headers: { accept: 'application/json' } });
const served = await res.text();
const ctype = (res.headers.get('content-type') || '').split(';')[0];
if (!res.ok || ctype !== 'application/json' || keccak256(toBytes(served)) !== hash) {
  console.error('the evidence URL does not serve the document that was hashed.');
  console.error(`  ${uri}`);
  console.error(`  HTTP ${res.status} · ${ctype || 'no content-type'} · ${served.length} bytes served vs ${bytes.length} local`);
  console.error('  deploy the dashboard first — nothing is attested to a document that cannot be fetched.');
  process.exit(1);
}
console.log(`Evidence live and byte-identical: ${uri}\n  keccak256 ${hash}\n`);

const key = process.env.AGENT_PROVIDER_PRIVATE_KEY;
if (!key) { console.error('AGENT_PROVIDER_PRIVATE_KEY is not set'); process.exit(1); }
const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const wallet = createWalletClient({
  account, chain: bsc, transport: http(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org'),
});

const doc = JSON.parse(bytes);
const queue = [];
for (const r of doc.agents) {
  const self = await publicClient.readContract({
    address: IDENTITY, abi: IDENTITY_ABI, functionName: 'isAuthorizedOrOwner', args: [account.address, BigInt(r.id)],
  });
  const bad = vet(r, { self });
  if (bad.length) { console.log(`  skip ${r.id} — ${bad.join('; ')}`); continue; }
  queue.push(r);
}
if (!queue.length) { console.error('nothing passed the rails.'); process.exit(1); }
if (queue.length > RAILS.maxPerRun) { console.error(`${queue.length} writes exceeds the ${RAILS.maxPerRun} cap for one run`); process.exit(1); }

const balance = await publicClient.getBalance({ address: account.address });
console.log(`Writing as ${account.address} (${formatEther(balance)} BNB)\n`);

for (const r of queue) {
  const args = [BigInt(r.id), BigInt(r.value), r.decimals, r.tag1, r.tag2, r.endpoint, uri, hash];
  const gas = await publicClient.estimateContractGas({
    address: REPUTATION, abi: REPUTATION_ABI, functionName: 'giveFeedback', args, account: account.address,
  });
  const tx = await wallet.writeContract({
    address: REPUTATION, abi: REPUTATION_ABI, functionName: 'giveFeedback', args, gas: (gas * 12n) / 10n,
  });
  const rec = await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log(`  ${r.id}  ${r.tag1} = ${r.value} ${r.unit} over ${r.tag2}  ${rec.status}  ${tx}`);

  // Proved by a read, not by a receipt. A receipt says the transaction was
  // mined; only readFeedback says what the registry now returns to everybody
  // else — and that is the thing we claimed to have written.
  const index = await publicClient.readContract({
    address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getLastIndex', args: [BigInt(r.id), account.address],
  });
  const back = await publicClient.readContract({
    address: REPUTATION, abi: REPUTATION_ABI, functionName: 'readFeedback', args: [BigInt(r.id), account.address, index],
  });
  console.log(`    reads back as index ${index}: ${back[0]} (${back[1]} dec) ${back[2]}/${back[3]}${back[4] ? ' REVOKED' : ''}`);
  r.written = { tx, index: Number(index), block: Number(rec.blockNumber), at: new Date().toISOString() };
}

// The receipts go beside the evidence, never into it: the evidence file is
// hashed on-chain and must not change after it has been attested.
const receipts = path.join(EVIDENCE_DIR, chosen.replace(/\.json$/, '.receipts.json'));
fs.writeFileSync(receipts, JSON.stringify({
  evidence: uri,
  evidence_hash: hash,
  contract: REPUTATION,
  chain: 56,
  written_by: account.address,
  written: queue.map((r) => ({ id: r.id, tag1: r.tag1, tag2: r.tag2, value: r.value, unit: r.unit, ...r.written })),
}, null, 1) + '\n');
console.log(`\n${queue.length} attestation(s) written. Receipts: ${path.relative(ROOT, receipts)}`);
}
