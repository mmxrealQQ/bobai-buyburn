// How many of the agents we count as speaking A2A actually speak A2A.
//
// WHY THIS EXISTS
// The probe marked an agent as A2A if anything at a well-known path parsed as
// JSON and carried a name, a protocolVersion or a skills array. That is far
// looser than the standard: an A2A AgentCard names the URL you POST JSON-RPC
// to, and without that field there is nothing to call. Measured by hand on
// cryptocurrency.cv — counted as A2A — the document is a paid REST catalogue
// for a different chain, with no url and no transport. POSTing JSON-RPC at it
// returns Forbidden, which is the correct answer to a request that should
// never have been made.
//
// This project's whole claim is that the numbers in the BNB agent economy are
// inflated and we measured them all. That has to include ours.
//
// Run: node scripts/a2a-card-audit.mjs [--limit N]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'dashboard', 'api-agents.json'), 'utf8'));
const agents = Array.isArray(raw) ? raw : (raw.agents || raw.results || []);
const flagged = agents.filter((a) => (a.speaks || []).includes('a2a') && (a.endpoints || []).length);

// One request per host, not per agent. 290 agents sit behind far fewer
// deployments, and asking the same server 40 times to learn one fact about it
// is the discourtesy this project keeps criticising in others.
const byHost = new Map();
for (const a of flagged) {
  let origin;
  try { origin = new URL(a.endpoints[0]).origin; } catch { continue; }
  if (!byHost.has(origin)) byHost.set(origin, []);
  byHost.get(origin).push(a);
}

const PATHS = ['/.well-known/agent-card.json', '/.well-known/agent.json', '/.well-known/ai-agent.json'];

// The A2A card fields that decide whether there is anything to call:
//   url     where to POST JSON-RPC. Without it the card is a description.
//   skills  what to ask for. Without it there is nothing to name in a call.
// Everything else — name, description, version — is documentation.
const verdictOf = (j) => {
  if (!j || typeof j !== 'object') return 'not json';
  const hasUrl = typeof j.url === 'string' && /^https?:\/\//i.test(j.url);
  const skills = Array.isArray(j.skills) ? j.skills : null;
  const named = skills && skills.some((s) => s && typeof s === 'object' && (s.id || s.name));
  if (hasUrl && named) return 'callable';
  if (skills && named) return 'skills but no url';
  if (hasUrl) return 'url but no skills';
  if (j.name || j.description) return 'a document, not a card';
  return 'unrecognisable';
};

const fetchCard = async (origin) => {
  for (const p of PATHS) {
    try {
      const r = await fetch(origin + p, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
      if (!r.ok) continue;
      const j = await r.json();
      return { path: p, json: j };
    } catch { /* next */ }
  }
  return null;
};

const hosts = [...byHost.keys()].slice(0, LIMIT);
console.log(`${flagged.length} agents flagged as speaking A2A, behind ${byHost.size} hosts. Asking ${hosts.length}.\n`);

const tally = {};
const examples = {};
let done = 0;

// Modest concurrency: enough to finish, low enough that no single host sees a
// burst from us.
const QUEUE = [...hosts];
const worker = async () => {
  while (QUEUE.length) {
    const origin = QUEUE.shift();
    const got = await fetchCard(origin);
    const verdict = got ? verdictOf(got.json) : 'no card served now';
    tally[verdict] = (tally[verdict] || 0) + byHost.get(origin).length;
    if (!examples[verdict]) examples[verdict] = origin;
    if (++done % 10 === 0) process.stdout.write(`  ${done}/${hosts.length}\r`);
  }
};
await Promise.all(Array.from({ length: 6 }, worker));

console.log(`  ${done}/${hosts.length} hosts asked\n`);
const total = Object.values(tally).reduce((a, b) => a + b, 0);
const rows = Object.entries(tally).sort((a, b) => b[1] - a[1]);
for (const [verdict, n] of rows) {
  console.log(`  ${String(n).padStart(4)}  ${(n / total * 100).toFixed(1).padStart(5)}%  ${verdict.padEnd(24)} e.g. ${examples[verdict]}`);
}
const callable = tally.callable || 0;
console.log(`\n  ${callable} of ${total} agents counted as A2A serve a card that names an endpoint AND skills.`);
console.log(`  ${(total - callable)} do not — there is nothing to POST to, or nothing to ask for.`);
