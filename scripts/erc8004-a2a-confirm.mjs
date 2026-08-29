// Settles the cards the probe could not settle from the document alone.
//
// THE CASE THIS EXISTS FOR
// An A2A card is supposed to name the URL you POST JSON-RPC to. Some do not.
// Measured 2026-08-25: 16 reachable agents serve a card with named skills and
// no `url` field, and they split two ways that the document cannot distinguish:
//
//   bnb-yield and bnb-guardian — no url, and they negotiate perfectly. Our own
//   hire path has been trading with them all day.
//   cryptocurrency.cv — no url, and POSTing JSON-RPC at it returns Forbidden.
//   It is a paid REST catalogue on another chain that happens to publish an
//   agent.json.
//
// Treating "no url" as "not callable" removed the hire button from two agents
// that can be hired — the same mistake, in a new place, as deriving hireability
// from escrow history. Treating it as "callable" would put a button on a
// catalogue that cannot answer. The card cannot tell you which; only asking can.
//
// WHAT IS SENT, AND WHY IT IS SAFE
// A JSON-RPC call to a method that does not exist. A JSON-RPC server answers
// an unknown method with an error object and does nothing else, which is
// exactly the proof wanted: this endpoint speaks the protocol. Nothing is
// negotiated, nothing is bought, and no skill of theirs is invoked. Sending a
// real skill to find out whether an agent is real would be making somebody
// work to satisfy our curiosity.
//
// Run: node scripts/erc8004-a2a-confirm.mjs        (add --dir for a rescan)
import fs from 'node:fs';
import path from 'node:path';
import { censusDirArg } from './lib/census-dir.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'data', censusDirArg());
const REACHABLE = path.join(DIR, 'reachable.jsonl');
const CENSUS = path.join(DIR, 'census.json');
const DRY = process.argv.includes('--dry');

if (!fs.existsSync(REACHABLE)) {
  console.error(`No probe output at ${path.relative(ROOT, REACHABLE)} — run erc8004-probe.mjs first.`);
  process.exit(1);
}

const rows = fs.readFileSync(REACHABLE, 'utf8').split('\n')
  .filter((l) => l.trim()).map((l) => JSON.parse(l));

// Only the ones the card left undecided: a document was served, it was not
// judged callable, and there is somewhere to ask.
const undecided = rows.filter((r) => r.live?.card && !r.live?.a2a && (r.endpoints || []).length);
console.log(`${rows.length.toLocaleString('en-US')} probed · ${undecided.length} cards undecided from the document alone`);

// WHERE TO ASK, AND WHY IT IS NOT JUST THE ORIGIN
// The first version asked the bare origin and recorded bnb-yield as silent,
// while our own hire path had been negotiating with it all day at /a2a. The
// candidates below are the ones worker-agent/hire.js resolves: an endpoint
// that already names a path is honoured as given, a card that names a url
// wins next, and a bare origin falls back to /a2a — which is where the BNB
// reference agents actually listen. Two halves of one project disagreeing
// about where an agent lives is how a directory contradicts its own
// marketplace.
const targetsOf = (r) => {
  const out = [];
  const push = (u) => { if (u && !out.includes(u)) out.push(u); };
  for (const e of r.endpoints || []) if (/\/a2a(\/|$)/i.test(e)) push(e);
  if (typeof r.live?.a2aUrl === 'string' && /^https?:\/\//i.test(r.live.a2aUrl)) push(r.live.a2aUrl);
  try {
    const origin = new URL(r.endpoints[0]).origin;
    push(origin + '/a2a');
    push(origin + '/');
  } catch { /* no usable endpoint */ }
  return out;
};

// One question per host, not per agent: eleven ids on clipx.app are eleven
// registrations of one deployment, and asking it eleven times to learn one fact
// is the discourtesy that broke the MCP count earlier today.
const byHost = new Map();
for (const r of undecided) {
  const targets = targetsOf(r);
  if (!targets.length) continue;
  let host;
  try { host = new URL(targets[0]).host; } catch { continue; }
  if (!byHost.has(host)) byHost.set(host, { targets: [], rows: [] });
  const e = byHost.get(host);
  for (const t of targets) if (!e.targets.includes(t)) e.targets.push(t);
  e.rows.push(r);
}

const speaksJsonRpc = async (url) => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'brainonbnb-erc8004-census' },
      // A method no implementation defines. A JSON-RPC server replies with
      // error -32601 and does nothing.
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'brainonbnb/does-not-exist' }),
      signal: AbortSignal.timeout(12000),
    });
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch { return { ok: false, why: `answered ${res.status} with ${text.slice(0, 40).replace(/\s+/g, ' ')}` }; }
    // Either shape proves the protocol: an error object for the unknown method,
    // or a jsonrpc envelope of any kind.
    if (j && (j.jsonrpc || j.error || j.result !== undefined)) return { ok: true, why: `JSON-RPC ${j.error?.code ?? 'envelope'}` };
    return { ok: false, why: 'answered JSON that is not JSON-RPC' };
  } catch (e) {
    return { ok: false, why: String(e?.message || e).slice(0, 50) };
  }
};

let upgraded = 0;
for (const [host, { targets, rows: list }] of byHost) {
  let hit = null;
  let why = 'no candidate answered';
  for (const t of targets) {
    const verdict = await speaksJsonRpc(t);
    if (verdict.ok) { hit = t; why = verdict.why; break; }
    why = `${t.replace(/^https?:\/\//, '')}: ${verdict.why}`;
    await new Promise((s) => setTimeout(s, 350));
  }
  console.log(`  ${hit ? 'speaks' : 'silent'}  ${String(list.length).padStart(3)} id(s)  ${host}  — ${hit ? hit + ' · ' + why : why}`);
  if (!hit) continue;
  for (const r of list) {
    r.live.a2a = true;
    // Recorded so the reason survives: this one was settled by asking, not by
    // reading, and a later reader should not think the card said so.
    r.live.a2aConfirmedBy = `json-rpc probe at ${hit} (card named no url)`;
    upgraded++;
  }
  await new Promise((s) => setTimeout(s, 350));
}

console.log(`\n${upgraded} agent(s) confirmed callable by asking`);

if (DRY) { console.log('--dry: nothing written'); process.exit(0); }
if (!upgraded) { console.log('nothing to write'); process.exit(0); }

fs.writeFileSync(REACHABLE, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

// Keep the summary in step, or the page and the raw data disagree.
if (fs.existsSync(CENSUS)) {
  const census = JSON.parse(fs.readFileSync(CENSUS, 'utf8'));
  const callable = rows.filter((r) => r.live?.a2a).length;
  if (census.endpoints) {
    census.endpoints.a2a_callable = callable;
    census.endpoints.a2a_confirmed_by_probe = upgraded;
  }
  fs.writeFileSync(CENSUS, JSON.stringify(census, null, 2) + '\n');
  console.log(`census.json updated: a2a_callable ${callable}`);
}
