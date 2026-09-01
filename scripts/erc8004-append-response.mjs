#!/usr/bin/env node
// The provider's half of the ERC-8004 reputation registry: answering a rating
// somebody else wrote about our agents.
//
// WHY THIS EXISTS
// `giveFeedback` lets anybody rate an agent. `appendResponse` is the only reply
// the standard gives the agent's operator, and on BNB Smart Chain essentially
// nobody uses it — which means every rating in there stands unanswered, and a
// reader has no way to reach the other side of any of them. Three of our five
// agents have been rated by one address. This answers those ratings from the
// wallet that owns them, which is the one thing on this registry that only the
// provider can do: the contract checks nothing about a responder, but the
// identity registry can prove who the owner is, and this script refuses to
// respond to anything we do not own.
//
// WHAT A RESPONSE IS FOR, AND WHAT IT IS NOT FOR
// Not for disputing a number we do not like. The response document is built
// from what can be shown: the ratings exactly as the chain returns them, the
// agent's own live status document as served at the moment of writing, and the
// escrow jobs it has actually delivered. It says plainly which parts of the
// rating we cannot reproduce and why. An operator's reply that argued with a
// measurement it could not re-take would be worth less than silence.
//
// THE SAME RULE AS THE WRITER
// The document is published, hashed, and the keccak256 of its exact bytes goes
// on-chain in `responseHash`. `--confirm` refuses to send unless the URL serves
// exactly those bytes — an unrouted path on this domain answers 200 with the
// HTML shell, so "it did not 404" proves nothing.
//
//   node scripts/erc8004-append-response.mjs               # build the document, print the plan
//   node scripts/erc8004-append-response.mjs --confirm     # verify the published document, then send
//   node scripts/erc8004-append-response.mjs --self-test   # pin every refusal
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, http, keccak256, toBytes, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { CENSUS_DIR } from './lib/census-dir.mjs';
import { REPUTATION, IDENTITY, REPUTATION_ABI, IDENTITY_ABI, ABI_SOURCE, unitFor } from './lib/erc8004-reputation.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const has = (name) => process.argv.includes(`--${name}`);

const DIR = path.join(ROOT, 'data', String(arg('dir', CENSUS_DIR)));
const RESPONSE_DIR = path.join(DIR, 'responses');
const PUBLISH_DIR = path.join(ROOT, 'dashboard', 'evidence');
const RESPONSE_BASE = 'https://brainonbnb.com/evidence/';
const ORIGIN = String(arg('origin', 'https://agent.brainonbnb.com'));
const CONFIRM = has('confirm');
const SELFTEST = has('self-test');
const AGAIN = has('again');

// A run that wants to answer more than this is a bug in the plan, not a busy
// day on the registry.
const MAX_PER_RUN = 6;

const publicClient = createPublicClient({
  chain: bsc,
  transport: http(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org'),
});

// ── what may be answered at all ───────────────────────────────────────────
// The mirror image of the writer's rails. giveFeedback refuses when we ARE the
// operator; appendResponse refuses when we are NOT. Both are checked against
// the identity registry rather than against our own list of agents, because our
// list is a file we maintain and the registry is the thing a stranger reads.
export function vet(target, { owned, again = false }) {
  const bad = [];
  if (!owned) bad.push('we do not own or operate this agent — a provider response from a stranger is just an unlabelled second opinion');
  // ONE RESPONSE PER RATING, unless asked for another in so many words. The
  // contract happily counts a second, a third and a hundredth response from the
  // same address, so nothing on-chain stops a re-run from turning one answer
  // into a pile of identical ones. This rail is why the first version of this
  // script crashing halfway through cost nothing: the finished writes are
  // visible in getResponseCount and are skipped on the next run.
  if (!again && target.responses > 0) bad.push(`already answered by us ${target.responses}x — pass --again to add another response`);
  if (!(target.index > 0)) bad.push('a feedback index is 1-based; 0 addresses nothing');
  if (target.index > target.lastIndex) bad.push(`index ${target.index} is past the last rating this client wrote (${target.lastIndex})`);
  if (!target.client || !/^0x[0-9a-fA-F]{40}$/.test(target.client)) bad.push('the rater address is not an address');
  if (!target.status_ok) bad.push('the agent could not report its own live status, so there is nothing to answer with');
  return bad;
}

if (SELFTEST) {
  const problems = [];
  const ok = { index: 3, lastIndex: 3, client: '0xc7F5cdC8dd028E0b9aF2cA9d3891F135b23f4B92', status_ok: true, responses: 0 };
  if (vet(ok, { owned: true }).length) problems.push('a valid response was refused');
  if (vet({ ...ok, responses: 1 }, { owned: true, again: true }).length) problems.push('--again did not allow a second response');
  const cases = [
    ["somebody else's agent", ok, { owned: false }],
    ['a zero index', { ...ok, index: 0 }, { owned: true }],
    ['an index past the end', { ...ok, index: 9 }, { owned: true }],
    ['a rater that is not an address', { ...ok, client: 'nobody' }, { owned: true }],
    ['an agent that cannot report its status', { ...ok, status_ok: false }, { owned: true }],
    ['a rating we have already answered', { ...ok, responses: 1 }, { owned: true }],
  ];
  for (const [what, t, o] of cases) if (!vet(t, o).length) problems.push(`${what} was accepted`);

  // The chain, in both directions: it must agree that we own ours and do not
  // own theirs. This is the same pair the writer checks, read the other way
  // round, and between them the two scripts cannot both be wrong about who we
  // are without the registry itself being wrong.
  const me = process.env.AGENT_PROVIDER_WALLET;
  if (me) {
    for (const [id, expected] of [[302257n, true], [265375n, false]]) {
      const owned = await publicClient.readContract({ address: IDENTITY, abi: IDENTITY_ABI, functionName: 'isAuthorizedOrOwner', args: [me, id] });
      if (owned !== expected) problems.push(`isAuthorizedOrOwner(us, ${id}) is ${owned}, expected ${expected}`);
    }
  }
  console.log('\nProvider response self-test');
  if (problems.length) { for (const p of problems) console.log('  x ' + p); process.exit(1); }
  console.log('  a response to a rating on our own agent is accepted');
  console.log(`  refused: ${cases.map(([w]) => w).join(', ')}`);
  console.log('  the chain agrees about which agents are ours');
  console.log('\nno problems.');
  // Let the RPC sockets settle before leaving. Calling process.exit() straight
  // out of an await on Windows trips a libuv assertion in Node 24, and the run
  // ends with exit code 127 — a self-test that passes and then reports failure
  // is worse than one that simply fails.
  await new Promise((r) => setTimeout(r, 150));
  process.exit(0);
}

// ── what we are answering ─────────────────────────────────────────────────
const own = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'own-agents.json'), 'utf8'));
const OURS = Object.values(own.agents || {}).filter((a) => a.id);
const me = process.env.AGENT_PROVIDER_WALLET;
if (!me) { console.error('AGENT_PROVIDER_WALLET is not set'); process.exit(1); }

async function collect() {
  const targets = [];
  for (const a of OURS) {
    const clients = await publicClient.readContract({ address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getClients', args: [BigInt(a.id)] });
    for (const client of clients) {
      const lastIndex = Number(await publicClient.readContract({
        address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getLastIndex', args: [BigInt(a.id), client],
      }));
      if (!lastIndex) continue;
      const ratings = [];
      for (let i = 1; i <= lastIndex; i++) {
        const f = await publicClient.readContract({
          address: REPUTATION, abi: REPUTATION_ABI, functionName: 'readFeedback', args: [BigInt(a.id), client, BigInt(i)],
        });
        ratings.push({
          index: i,
          value: Number(f[0]) / 10 ** Number(f[1]),
          decimals: Number(f[1]),
          tag1: f[2],
          tag2: f[3],
          unit: unitFor(f[2]),
          revoked: f[4],
        });
      }
      // The agent's own account of itself, taken now and stored as served. Its
      // `checked_at` is part of it: a status document without an age is a claim
      // about an unspecified moment.
      let status = null;
      try {
        const r = await fetch(`${ORIGIN}/status?agent=${a.id}`, { signal: AbortSignal.timeout(30000) });
        if (r.ok) status = await r.json();
      } catch { /* recorded as null below, never as a healthy default */ }
      const owned = await publicClient.readContract({
        address: IDENTITY, abi: IDENTITY_ABI, functionName: 'isAuthorizedOrOwner', args: [me, BigInt(a.id)],
      });
      const responses = Number(await publicClient.readContract({
        address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getResponseCount',
        args: [BigInt(a.id), client, BigInt(lastIndex), [me]],
      }));
      targets.push({
        id: a.id,
        name: a.name,
        client,
        lastIndex,
        // The newest rating this address wrote. One response per rater per
        // agent: answering every index separately would put the same document
        // on the chain three times.
        index: lastIndex,
        ratings,
        status,
        status_ok: !!status,
        owned,
        responses,
      });
    }
  }
  return targets;
}

const responseDoc = (targets) => ({
  what_this_is:
    'The provider\'s answer to ratings written about the agents this marketplace operates, attached to those '
    + 'ratings on-chain with appendResponse. The ERC-8004 ReputationRegistry gives an operator exactly one way '
    + 'to reply, and almost nobody on BNB Smart Chain uses it, so every rating in there stands unanswered.',
  what_it_is_not:
    'Not a dispute. The ratings below are reproduced exactly as the contract returns them, and we do not '
    + 'contest any of them. What is added here is the part the rater could not see: the agent\'s own live '
    + 'status document as served at the moment of writing, with its own timestamp, and the escrow jobs it has '
    + 'actually delivered.',
  what_we_cannot_reproduce:
    'The response times in these ratings were measured from outside. We cannot re-take them honestly: our own '
    + 'broker reaches these agents in-process, which reads as zero milliseconds and is not a network '
    + 'measurement. The rater\'s numbers stand as the outside view, and where this marketplace measures other '
    + 'people\'s agents it publishes every probe behind the figure for the same reason.',
  how_to_check:
    'GET https://agent.brainonbnb.com/status?agent=<id> for the live document, and readFeedback(agentId, '
    + 'client, index) on ' + REPUTATION + ' for the ratings. Both are what this file quotes.',
  chain: 56,
  contract: REPUTATION,
  identity_registry: IDENTITY,
  abi_source: ABI_SOURCE,
  responder: me,
  written_at: new Date().toISOString(),
  agents: targets.map((t) => ({
    id: t.id,
    name: t.name,
    rated_by: t.client,
    responding_to_index: t.index,
    ratings: t.ratings,
    live_status: t.status,
    jobs_delivered: t.status?.jobs_delivered ?? null,
    proven_by: t.status?.proven_by ?? null,
  })),
});

const stampName = (d) => `response-${d.toISOString().replace(/[:.]/g, '-').slice(0, 16)}Z.json`;

// ── plan ──────────────────────────────────────────────────────────────────
if (!CONFIRM) {
  const targets = await collect();
  if (!targets.length) { console.error('no ratings on our agents to answer.'); process.exit(1); }
  const usable = targets.filter((t) => !vet(t, { owned: t.owned, again: AGAIN }).length);
  const doc = responseDoc(usable.length ? usable : targets);
  const bytes = JSON.stringify(doc, null, 1) + '\n';
  const name = stampName(new Date());
  fs.mkdirSync(RESPONSE_DIR, { recursive: true });
  fs.mkdirSync(PUBLISH_DIR, { recursive: true });
  for (const p of [path.join(RESPONSE_DIR, name), path.join(PUBLISH_DIR, name)]) {
    if (fs.existsSync(p)) { console.error(`${p} already exists — refusing to overwrite a published document`); process.exit(1); }
    fs.writeFileSync(p, bytes);
  }
  console.log(`\nResponse document  ${path.relative(ROOT, path.join(PUBLISH_DIR, name))}`);
  console.log(`  keccak256 ${keccak256(toBytes(bytes))}`);
  console.log(`  will be attached as ${RESPONSE_BASE + name}\n`);
  console.log('Planned responses:');
  for (const t of targets) {
    const bad = vet(t, { owned: t.owned, again: AGAIN });
    const what = t.ratings.map((r) => `${r.tag1} ${r.value}${r.unit}/${r.tag2}`).join(' · ');
    if (bad.length) console.log(`  ${String(t.id).padEnd(7)} not answered — ${bad.join('; ')}`);
    else console.log(`  ${String(t.id).padEnd(7)} index ${t.index} by ${t.client.slice(0, 8)}…  answering: ${what}`);
  }
  console.log(`\n${usable.length} of ${targets.length} would be answered.`);
  console.log('\nNext:');
  console.log('  1. deploy the dashboard so the document URL is live');
  console.log(`  2. node scripts/erc8004-append-response.mjs --confirm --document ${name}`);
  process.exit(0);
}

// ── confirm ───────────────────────────────────────────────────────────────
const chosen = String(arg('document', '') || '') || fs.readdirSync(RESPONSE_DIR).filter((f) => !f.includes('.receipts.')).sort().pop();
if (!chosen) { console.error('no response document — run without --confirm first'); process.exit(1); }
const bytes = fs.readFileSync(path.join(RESPONSE_DIR, chosen), 'utf8');
const hash = keccak256(toBytes(bytes));
const uri = RESPONSE_BASE + chosen;

const res = await fetch(uri, { headers: { accept: 'application/json' } });
const served = await res.text();
const ctype = (res.headers.get('content-type') || '').split(';')[0];
if (!res.ok || ctype !== 'application/json' || keccak256(toBytes(served)) !== hash) {
  console.error('the response URL does not serve the document that was hashed.');
  console.error(`  ${uri}`);
  console.error(`  HTTP ${res.status} · ${ctype || 'no content-type'} · ${served.length} bytes served vs ${bytes.length} local`);
  console.error('  deploy the dashboard first — nothing is attached to a document that cannot be fetched.');
  process.exit(1);
}
console.log(`Document live and byte-identical: ${uri}\n  keccak256 ${hash}\n`);

const key = process.env.AGENT_PROVIDER_PRIVATE_KEY;
if (!key) { console.error('AGENT_PROVIDER_PRIVATE_KEY is not set'); process.exit(1); }
const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
const wallet = createWalletClient({
  account, chain: bsc, transport: http(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org'),
});

const doc = JSON.parse(bytes);
const queue = [];
for (const a of doc.agents) {
  const lastIndex = Number(await publicClient.readContract({
    address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getLastIndex', args: [BigInt(a.id), a.rated_by],
  }));
  const owned = await publicClient.readContract({
    address: IDENTITY, abi: IDENTITY_ABI, functionName: 'isAuthorizedOrOwner', args: [account.address, BigInt(a.id)],
  });
  const responses = Number(await publicClient.readContract({
    address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getResponseCount',
    args: [BigInt(a.id), a.rated_by, BigInt(a.responding_to_index), [account.address]],
  }));
  const target = { id: a.id, client: a.rated_by, index: a.responding_to_index, lastIndex, status_ok: !!a.live_status, responses };
  const bad = vet(target, { owned, again: AGAIN });
  if (bad.length) { console.log(`  skip ${a.id} — ${bad.join('; ')}`); continue; }
  queue.push(target);
}
if (!queue.length) { console.error('nothing passed the rails.'); process.exit(1); }
if (queue.length > MAX_PER_RUN) { console.error(`${queue.length} responses exceeds the ${MAX_PER_RUN} cap for one run`); process.exit(1); }

console.log(`Responding as ${account.address} (${formatEther(await publicClient.getBalance({ address: account.address }))} BNB)\n`);
const written = [];
for (const t of queue) {
  const args = [BigInt(t.id), t.client, BigInt(t.index), uri, hash];
  const gas = await publicClient.estimateContractGas({ address: REPUTATION, abi: REPUTATION_ABI, functionName: 'appendResponse', args, account: account.address });
  const tx = await wallet.writeContract({ address: REPUTATION, abi: REPUTATION_ABI, functionName: 'appendResponse', args, gas: (gas * 12n) / 10n });
  const rec = await publicClient.waitForTransactionReceipt({ hash: tx });

  // Proved by a read. getResponseCount is the only thing that says the registry
  // now returns our response to everybody else; a receipt only says a
  // transaction was mined.
  const count = await publicClient.readContract({
    address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getResponseCount', args: [BigInt(t.id), t.client, BigInt(t.index), [account.address]],
  });
  console.log(`  ${t.id}  index ${t.index}  ${rec.status}  ${tx}`);
  console.log(`    getResponseCount now returns ${count} for this responder`);
  written.push({ id: t.id, client: t.client, index: t.index, tx, block: Number(rec.blockNumber), responses: Number(count) });
}

const receipts = path.join(RESPONSE_DIR, chosen.replace(/\.json$/, '.receipts.json'));
fs.writeFileSync(receipts, JSON.stringify({
  document: uri, document_hash: hash, contract: REPUTATION, chain: 56, responder: account.address, written,
}, null, 1) + '\n');
console.log(`\n${written.length} response(s) attached. Receipts: ${path.relative(ROOT, receipts)}`);
