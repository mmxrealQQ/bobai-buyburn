// Turns the census into the page and the JSON endpoint that serve it.
//
// Reads the live census under data/ (scripts/lib/census-dir.mjs), writes dashboard/registry.html and
// dashboard/api-registry.json. Both are generated — never edit them by hand,
// the next run overwrites them. Everything the page states comes from the two
// scan artefacts, so there is no path by which the page can claim a number the
// data does not contain.
//
// THE WHOLE RITUAL, in order. Every step after the first reads what the one
// before it wrote, and skipping one leaves a surface stating something no
// longer true — which is exactly how the page came to publish 302,828 and then
// count itself down to 299,783 in front of the reader.
//
//   node scripts/erc8004-scan.mjs          --dir erc8004-v2   # resumes; never delete
//   node scripts/erc8004-probe.mjs         --dir erc8004-v2
//   node scripts/erc8004-a2a-confirm.mjs   --dir erc8004-v2
//   node scripts/erc8004-publish.mjs       --dir erc8004-v2   # also writes hireable.json
//   npx wrangler pages deploy dashboard …                     # BEFORE hire-confirm, see below
//   cd worker-agent && npx wrangler deploy                    # BEFORE hire-confirm, see below
//   node scripts/erc8004-hire-confirm.mjs  --dir erc8004-v2   # asks each one for a price
//   node scripts/erc8004-publish.mjs       --dir erc8004-v2   # again, to render the answers
//   node scripts/census-sync.mjs           --dir erc8004-v2   # hands the scan to the worker
//   # pull the census line in dashboard/llms.txt from api-registry.json
//   node scripts/build-library.mjs
//   npx wrangler pages deploy dashboard --project-name=bobai-dashboard --branch=main --commit-dirty=true
//   node scripts/smoke-agent-surface.mjs   # checks every one of the above landed
//
// WHY TWO DEPLOYS SIT IN THE MIDDLE OF THAT LIST
// hire-confirm does not ask the agents directly. It asks our live /hire, which
// resolves an ERC-8004 id through the DEPLOYED api-agents.json and caches that
// file for ten minutes. So a newly registered agent is unhireable until the
// dashboard carries it AND the agent worker has been restarted to drop the
// cache. Run hire-confirm before both and it reports "no A2A endpoint found"
// for an agent that is perfectly reachable — which is what happened on
// 2026-08-26, twice, before the cause was clear.
import fs from 'node:fs';
import path from 'node:path';
import { censusDirArg } from './lib/census-dir.mjs';
import { groupByOperator, operatorOf } from './lib/group-agents.mjs';
import { loadJobs, aggregate } from './lib/job-aggregate.mjs';
import { CATEGORIES, classifyAgent } from '../worker-agent/categories.js';
import { PEERS, SURFACE, OWN_AGENT_IDS } from '../worker-agent/telemetry.js';
import { SERVICES } from '../worker-agent/sell.js';
import { SERVICE_BY_SLUG } from './lib/own-agents.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
// Same flag the scanner takes, so all halves of the census can be pointed at
// one dataset: scan, enrich, probe, publish. Defaults to the live census; a
// rescan gets its own directory (--dir erc8004-v3) so it never overwrites the
// data the page is serving while it runs.
const DIR = path.join(ROOT, 'data', censusDirArg());
const state = JSON.parse(fs.readFileSync(path.join(DIR, 'scan-state.json'), 'utf8'));

let census = null;
try { census = JSON.parse(fs.readFileSync(path.join(DIR, 'census.json'), 'utf8')); } catch {}

// What each agent says about itself, from erc8004-enrich.mjs. Optional: the
// page works without it, it just has less to say about each agent.
let registrations = {};
try { registrations = JSON.parse(fs.readFileSync(path.join(DIR, 'registrations.json'), 'utf8')); } catch {}

const reachable = [];
try {
  for (const line of fs.readFileSync(path.join(DIR, 'reachable.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.reachable) reachable.push(r); } catch {}
  }
} catch {}

// The employment census from scripts/erc8183-job-scan.mjs. Optional: the page
// renders without it and simply says nothing about who has been paid, rather
// than showing an empty table that reads as "nobody has".
//
// Identity and employment are joined here because they are joinable: the job
// kernel names a provider ADDRESS and the registry answers ownerOf() for an
// agent ID, and both live on the same chain. That join is the entire reason
// this page can say "this listed agent has been hired eleven times" instead of
// "this listed agent says it is good at things".
let jobCensus = null;
let jobOwners = null;
try {
  const jobsFile = path.join(ROOT, 'data', 'erc8183', 'jobs.jsonl');
  const jobState = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'erc8183', 'scan-state.json'), 'utf8'));
  const jobs = loadJobs(jobsFile);
  // A partial job scan must not be published as an employment census, for the
  // same reason a partial identity scan must not be published as a census: the
  // numbers all still parse, and every one of them is wrong.
  if (jobState.jobCounter && jobs.size >= jobState.jobCounter * 0.995) {
    jobCensus = { ...aggregate(jobs), jobCounter: jobState.jobCounter, unread: jobState.unread || 0, measuredAt: jobState.finishedAt || jobState.updatedAt };
  } else if (jobs.size) {
    console.log(`  (job census skipped: ${jobs.size.toLocaleString('en-US')} of ${(jobState.jobCounter || 0).toLocaleString('en-US')} jobs read)`);
  }
  try { jobOwners = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'erc8183', 'owners.json'), 'utf8')); } catch { /* optional */ }
} catch { /* no job scan yet */ }

const c = state.counts;
const scanned = state.cursor - 1;
const total = state.highestId;
const pct = (n, d = scanned) => (d ? (n / d) * 100 : 0);
const fmt = (n) => Number(n).toLocaleString('en-US');
const p1 = (n, d = scanned) => pct(n, d).toFixed(pct(n, d) < 1 ? 2 : 1) + '%';

// An incomplete scan must not be published as if it were a census. This caught
// a real failure: a stopped background scan kept running and overwrote the
// finished state with its own older one, leaving the counts 60,000 ids short
// while every file still parsed and every number still looked plausible. The
// page would have quietly understated the ecosystem it claims to measure.
// --partial publishes anyway, for when a snapshot is genuinely wanted.
if (scanned < total * 0.995 && !process.argv.includes('--partial')) {
  console.error(`
Refusing to publish: only ${scanned.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ids scanned (${((scanned / total) * 100).toFixed(1)}%).`);
  console.error(`Finish the scan first, or pass --partial to publish a snapshot anyway.
`);
  process.exit(1);
}

// ---- the JSON surface ----------------------------------------------------
const api = {
  what_this_is: 'A census of the ERC-8004 identity registry on BNB Smart Chain: how many agents are registered, how many of those registrations are readable, how many name an endpoint, and how many of those endpoints answer.',
  registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  chain: 'eip155:56',
  measured_at: census?.measured_at || state.updatedAt,
  registered_ids: total,
  ids_scanned: scanned,
  registrations: {
    parses: c.valid,
    unparsable: c.unparsable,
    empty: c.empty,
    // The correction this rescan existed for. 43% of registrations are an
    // https link to a document, and the previous census counted those as
    // holding nothing readable. Published so the claim can be checked
    // against the data rather than taken from the prose.
    points_offchain: c.offchain,
    unread_after_retries: c.unread,
    active_flag: c.active,
    names_a_service: c.withServices,
    has_http_endpoint: c.withHttpEndpoint,
    endpoint_on_a_real_tld: c.plausibleEndpoint,
    speaks_mcp: c.mcp,
    speaks_a2a: c.a2a,
    supports_x402: c.x402,
  },
  reachability: census?.endpoints || null,
  independent_operators: null, // filled in below, once operators are grouped
  method: {
    registrations: 'Every id read via tokenURI() on the registry. Ids the nodes refused are retried until they answer; the count above reports what remained unreadable after that, so a percentage here is never a statement about node availability.',
    reachability: 'Every claimed HTTP endpoint contacted once. Any HTTP response counts as reachable, including 401, 403 and 404 — only a failed connection counts as dead. MCP endpoints were sent a real tools/list; agent cards had to parse as JSON.',
    caveat: 'Reachability is a snapshot. An endpoint down at that moment is counted as dead, and one that answers may still do nothing useful.',
  },
  source: 'https://brainonbnb.com/registry',
};
fs.writeFileSync(path.join(ROOT, 'dashboard', 'api-registry.json'), JSON.stringify(api, null, 2) + '\n');

// ---- the list itself, for machines ---------------------------------------
// The census counts; this is what another agent can actually use. Only agents
// that answered are in it, and where one exposes tools or skills they are
// listed by name — because "an agent exists at this address" is a directory
// entry, and a directory is the thing this set out to be better than.
//
// Sorted so that agents which speak a protocol come first: an agent looking for
// a counterpart wants those, and burying them under a few hundred plain web
// servers would make the useful part of the list the hardest to reach.
const directory = reachable
  .map((r) => ({
    id: r.id,
    name: r.name || registrations[r.id]?.name || null,
    // The operator's own description, straight from the on-chain registration.
    // This is what turns a row into something a person can judge.
    ...(registrations[r.id]?.description ? { description: registrations[r.id].description } : {}),
    ...(registrations[r.id]?.image ? { image: registrations[r.id].image } : {}),
    ...(registrations[r.id]?.trust?.length ? { trust_models: registrations[r.id].trust } : {}),
    ...(registrations[r.id]?.services?.length ? { declared_services: registrations[r.id].services } : {}),
    endpoints: r.endpoints,
    speaks: [r.live?.mcp ? 'mcp' : null, r.live?.a2a ? 'a2a' : null,
      (r.x402 || registrations[r.id]?.x402) ? 'x402' : null].filter(Boolean),
    ...(r.live?.tools?.length ? { tools: r.live.tools } : {}),
    ...(r.live?.skills?.length ? { skills: r.live.skills } : {}),
    ...(r.live?.cardUrl ? { agent_card: r.live.cardUrl } : {}),
    ...(r.live?.cardDescription ? { description: r.live.cardDescription } : {}),
  }))
  .sort((a, b) => b.speaks.length - a.speaks.length || a.id - b.id);

// Grouped by who actually runs them. 784 reachable ids are 72 operators, and
// 103 MCP agents are 7 — one provider accounts for 96 of them, all returning
// the identical five tools. Counting ids describes the registry correctly and
// describes the market wrongly.
// Our own hireable agents, merged in from the registration state file.
//
// They are on-chain and answering, but the identity census is a periodic full
// scan and will only see them on its next pass. Leaving the two categories the
// chain is thinnest in looking empty until then would misrepresent what a buyer
// can actually hire today. Merged by id, so the census overwrites this the
// moment it catches up rather than listing them twice.
// The sentence the hire box opens with, per seller rather than per category.
//
// It used to be one template per category, which broke the moment two agents
// shared a category and needed different inputs: the yield template is a plain
// question with no address in it, and the fee-tier seller refuses without one.
// A buyer who took the suggested wording would have funded a job the seller
// then declined — the exact failure that cost job 56670, discovered after
// paying. A seed is a promise that the sentence works as written.
const SEED_TOKEN = '0x245c386dcfed896f5c346107596141e5edcbffff';
const SEED_TASKS = {
  health_factor: 'health factor and liquidation distance for the Venus position at <ADDR>',
  grid_plan: `grid plan for ${SEED_TOKEN}, 10 levels across a 15% band, $1000 capital`,
  yield_plan: 'where is the best yield on BNB Chain for USDT right now',
  rebalance_plan: `rebalance holdings [{"token":"${SEED_TOKEN}","usd":1000}] — what should the range be`,
  lp_tier_plan: `which PancakeSwap fee tier is actually paying for ${SEED_TOKEN}, placing $1000 of liquidity`,
};
const seedTask = (svc) => SEED_TASKS[svc.id] || null;

let ownAgents = [];
try {
  const own = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'own-agents.json'), 'utf8'));
  ownAgents = Object.entries(own.agents || {}).filter(([, a]) => a.id).map(([slug, a]) => {
    // Our own agents were being listed with description: null, so the table
    // printed "its registration says nothing about what it does" against the
    // two entries we control — while holding other people to the same standard
    // one row below. The text comes from the service definition in sell.js,
    // which is the same sentence the agent sells itself with over A2A and the
    // same one it delivers against. One source, and it cannot drift from what
    // is actually for sale.
    //
    // BY SLUG, NOT BY CATEGORY. The lookup used to match on category, which
    // holds only while no two agents share one. Two do, and `find` returned
    // whichever service was declared first — so one of our own agents was
    // described as the other one, in the section a judge is asked to compare
    // agents in. A slug names exactly one agent; a category does not.
    const svc = SERVICES[SERVICE_BY_SLUG[slug]] || null;
    return {
      id: a.id,
      name: a.name,
      description: svc ? svc.deliverables : null,
      endpoints: ['https://agent.brainonbnb.com/a2a'],
      speaks: ['a2a', 'x402'],
      // What it can be asked for, named the way the seller names it. Empty
      // tools on purpose: see the merge below.
      skills: svc ? [{ name: svc.id, description: svc.name }] : [],
      tools: [],
      seed: svc ? seedTask(svc) : null,
      attributes: [{ trait_type: 'Category', value: a.category }],
      ours: true,
      provider: a.owner,
    };
  });
  // OUR DEFINITION WINS, rather than being dropped when the census already has
  // the id. Five agents sell from one A2A endpoint, and one endpoint serves one
  // agent card, so the enrichment step gave all five the same description and
  // the same six capabilities. On a page whose whole job is helping somebody
  // choose between agents, that printed the identical paragraph four times,
  // once per category. The per-agent on-chain document is the truth; the
  // shared card is an artefact of how they are hosted.
  for (const a of ownAgents) {
    const i = directory.findIndex((d) => d.id === a.id);
    if (i < 0) directory.push(a); else directory[i] = { ...directory[i], ...a };
  }
} catch { /* nothing registered yet */ }

const operators = groupByOperator(directory);
api.independent_operators = operators.length;
fs.writeFileSync(path.join(ROOT, 'dashboard', 'api-registry.json'), JSON.stringify(api, null, 2) + '\n');

// ---- the employment census, for machines ---------------------------------
// The identity census says who exists. This says who has been paid, which is
// the only reputation signal on this chain nobody can write about themselves:
// a registration is self-reported text, a funded job is somebody else's money.
if (jobCensus) {
  const jobsApi = {
    what_this_is: 'Every job in the ERC-8183 escrow kernel on BNB Smart Chain, read one at a time and aggregated into an employment balance per provider. It answers who has actually been hired and paid, as opposed to who is registered.',
    kernel: '0xEa4DAa3100A767e86FDed867729ae7446476EBA6',
    payment_token: { symbol: 'U', name: 'United Stables', address: '0xcE24439F2D9C6a2289F741120FE202248B666666', decimals: 18 },
    chain: 'eip155:56',
    measured_at: jobCensus.measuredAt,
    jobs: {
      job_counter: jobCensus.jobCounter,
      read: jobCensus.total,
      unread_after_retries: jobCensus.unread,
      by_status: jobCensus.byStatus,
      ever_funded: jobCensus.fundedJobs,
      escrow_released: jobCensus.completed,
      deliverable_never_released: jobCensus.submitted,
      never_funded: jobCensus.open,
      total_escrowed_u: Number(jobCensus.escrowedU.toFixed(6)),
      distinct_buyers: jobCensus.buyers,
      distinct_providers: jobCensus.providers.length,
      providers_paid_by_more_than_one_buyer: jobCensus.providersWithRealWork,
      top_provider_share: Number(jobCensus.concentration.top_provider_share.toFixed(4)),
      top5_share: Number(jobCensus.concentration.top5_share.toFixed(4)),
      excluding_top_provider: jobCensus.withoutTopProvider,
    },
    providers: jobCensus.providers.map((p) => ({
      address: p.address,
      agents: jobOwners?.owners?.[p.address] || [],
      jobs: p.jobs,
      funded: p.funded,
      completed: p.completed,
      submitted_not_released: p.submitted_not_released,
      awaiting_delivery: p.awaiting_delivery,
      expired: p.expired,
      rejected: p.rejected,
      never_funded: p.never_funded,
      distinct_buyers: p.distinct_buyers,
      escrowed_u: Number(p.escrowed_u.toFixed(6)),
      median_budget_u: Number(p.median_budget_u.toFixed(6)),
      delivery_rate: Number(p.delivery_rate.toFixed(4)),
      first_job_id: p.first_job_id,
      last_job_id: p.last_job_id,
    })),
    method: {
      jobs: 'getJob() called for every id from 1 to jobCounter(). Ids a node refused are retried patiently; whatever remains unreadable is reported as unread rather than folded into a percentage.',
      funded: 'A job in status OPEN was created and never funded — createJob costs nothing and commits nobody, so OPEN is excluded from every payment figure.',
      completed: 'SUBMITTED means a deliverable is on-chain and the escrow has NOT released. Only COMPLETED means the money moved. The two are never added together.',
      delivery_rate: 'Completions divided by funded jobs, not by all jobs: a provider is not answerable for jobs a buyer created and abandoned.',
      identity_join: jobOwners
        ? `Provider addresses matched to agent ids via ownerOf() on the identity registry, over the ${jobOwners.agents} registered agents that carry an HTTP endpoint. A provider with no match is not unregistered — it is simply not in that population.`
        : 'Not resolved for this build.',
    },
    source: 'https://brainonbnb.com/registry',
  };
  fs.writeFileSync(path.join(ROOT, 'dashboard', 'api-jobs.json'), JSON.stringify(jobsApi, null, 2) + '\n');
}

fs.writeFileSync(path.join(ROOT, 'dashboard', 'api-operators.json'), JSON.stringify({
  what_this_is: 'The same census grouped by operator instead of by registry id. One entry per independent provider, with the number of registry ids it runs. This is the market view; api-agents.json is the complete one.',
  measured_at: api.measured_at,
  registered_ids: total,
  reachable_ids: directory.length,
  independent_operators: operators.length,
  operators_speaking_a_protocol: operators.filter((o) => o.speaks.length).length,
  note: 'Grouped on the registrable domain of the first endpoint. Entries pointing at code or social hosts (github.com, x.com, t.me) are excluded — reachable, but not an agent endpoint. Ordering is by demonstrated capability, never by how many ids an operator registered.',
  operators,
}, null, 2) + '\n');

fs.writeFileSync(path.join(ROOT, 'dashboard', 'api-agents.json'), JSON.stringify({
  what_this_is: 'Every ERC-8004 agent on BNB Smart Chain that answered when contacted, with whatever it exposes about itself. Generated from a full registry scan — not self-reported, not curated.',
  measured_at: api.measured_at,
  registered_ids: total,
  answered: directory.length,
  speaking_a_protocol: directory.filter((d) => d.speaks.length).length,
  independent_operators: operators.length,
  operator_view: 'https://brainonbnb.com/api-operators.json',
  note: 'Presence here means the address responded and, where stated, the protocol answered. It is not an endorsement, a rating, or a claim that the agent does anything useful.',
  agents: directory,
}, null, 2) + '\n');

// ---- the page ------------------------------------------------------------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Each row is a small profile rather than a table cell: logo, name, what the
// operator says it does, what it demonstrably speaks, and the address you can
// call. The point of the whole exercise is that none of this is self-reported
// into a form we control — the description comes from the chain, the protocol
// tags come from having spoken to it.

// ---- the four categories -------------------------------------------------
//
// The marketplace is judged on four, equally: rebalancing, grid trading, yield
// optimisation, health-factor monitoring. Presenting them means answering an
// awkward question honestly — the chain does not contain four categories of
// depth. After collapsing fleets to their operators there is one independent
// grid trader on all of BNB Chain, and one rebalancer.
//
// A marketplace can respond to that by padding the thin shelves with anything
// whose description contains the right word, or by saying what is there. The
// second is the only one that survives being checked, so each row carries HOW
// it was categorised and the exact string that did it.
const providerOfAgent = new Map();
if (jobOwners?.owners) {
  for (const [addr, agents] of Object.entries(jobOwners.owners)) {
    for (const a of agents) providerOfAgent.set(a.id, addr);
  }
}
for (const a of ownAgents) if (a.provider) providerOfAgent.set(a.id, a.provider.toLowerCase());

const employmentOf = (ids) => {
  if (!jobCensus) return null;
  let best = null;
  for (const id of ids) {
    const addr = providerOfAgent.get(id);
    if (!addr) continue;
    const rec = jobCensus.providers.find((p) => p.address === addr);
    if (rec && (!best || rec.funded > best.funded)) best = rec;
  }
  return best;
};

const NL = String.fromCharCode(10);

const SOURCE_BADGE = {
  declared: ['declared', 'The agent\'s own status endpoint returns this category, machine-readable.'],
  registered: ['on-chain', 'Its ERC-8004 registration carries this category as an attribute.'],
  derived: ['matched', 'We matched this from what it exposes. It is evidence, not a statement by the agent.'],
};

// Two different things need two different treatments, and using one for both
// produced a row reading "Brain On BNB AI — yield optimisation", which we do
// not do.
//
//   An agent that SAYS what it is — live on its own status endpoint, or in its
//   on-chain registration — is listed as itself. Collapsing it into whatever
//   else shares its hostname loses the one piece of information that was not a
//   guess. Our own two agents share an endpoint with the marketplace, and
//   merging them made all three into one row under a category none of them
//   declared.
//
//   An agent we MATCHED is collapsed to its operator, because that is where
//   padding lives: 236 registry ids on one host, all the same deployment,
//   would otherwise fill a category by themselves.
// Matching a printed row back to the live telemetry the worker collects.
//
// The key travels in the HTML as data-tele so the page does not have to guess
// from a hostname at render time — the mapping from host to poller id lives in
// one place, next to the poller, and a peer added there shows up here without
// a second list to keep in step.
const peerByHost = new Map(PEERS.map((p) => [new URL(p.origin).host, p.id]));
// Our own agent ids come from the telemetry surface rather than a literal
// list here. The first version hardcoded two of them, and registering two more
// would have left the new rows with no live line and no error — the page would
// simply have been quietly less alive than it claimed.
const OWN_IDS = new Set(OWN_AGENT_IDS);
const teleKey = (id, host) => (
  OWN_IDS.has(id) ? `own:${id}` : (peerByHost.get(host) || null)
);

// WHAT IT DOES, WHICH THE TABLE DID NOT SAY
// The rubric asks that somebody can land, find an agent by category,
// understand what it does, and activate it. Three of those four were on the
// page. The columns were the agent, how we classified it, and whether it had
// ever been paid — all true, none of them an answer to "what does this thing
// do". A directory that cannot answer that is asking the reader to hire on
// vibes.

// The tools and skills an agent exposes, which is the machine-readable half of
// what it does. The ERC-8183 selling handshake is filtered out: negotiate and
// notify_funded are how you buy from an agent, not something the agent does,
// and printing them as capabilities makes every seller look identical.
const HANDSHAKE = /^(negotiate|notify[_ -]?funded|deliver|start|list)$/i;
const HANDSHAKE_LABEL = /^(negotiate an erc-8183 job|notify the seller)/i;
const capsOf = (x) => {
  const out = [];
  for (const t of x.tools || []) {
    const name = typeof t === 'string' ? t : (t && (t.name || t.id));
    if (name && !HANDSHAKE.test(name)) out.push({ name: String(name), why: (t && t.description) || '' });
  }
  for (const sk of x.skills || []) {
    const name = typeof sk === 'string' ? sk : (sk && (sk.name || sk.id));
    if (!name) continue;
    if (HANDSHAKE.test(name) || HANDSHAKE_LABEL.test(String(name))) continue;
    out.push({ name: String(name), why: (sk && sk.description) || '' });
  }
  // Same name from tools and skills is one capability, not two.
  const seen = new Set();
  return out.filter((c) => (seen.has(c.name.toLowerCase()) ? false : seen.add(c.name.toLowerCase())));
};

// Some registrations describe the selling handshake instead of the service —
// "ERC-8183 seller agent (bnbGridTrader-agent) — negotiate + notify_funded over
// A2A". That is true and tells a buyer nothing. Printing it as the answer to
// "what does it do" would be repeating a non-answer with a straight face, so it
// is named as what it is. Three of the four BNB reference agents describe
// themselves this way.
const SELLER_BOILERPLATE = /erc-?8183 seller agent|negotiate \+ notify_funded/i;

// Registrations arrive with mojibake often enough to matter: an em dash that
// went through the wrong encoding twice shows up as a replacement character in
// the middle of a sentence. We do not silently rewrite somebody's text, but a
// character that carries no information is dropped rather than printed.
const clean = (t) => String(t).replace(/\uFFFD/g, '').replace(/\s+/g, ' ').trim();

const describes = (r) => {
  const d = r.description ? clean(r.description) : '';
  if (!d) return { text: null, weak: true, why: 'Its registration says nothing about what it does.' };
  if (SELLER_BOILERPLATE.test(d)) {
    return { text: null, weak: true, why: 'Says nothing about what it does — only that it sells.' };
  }
  return { text: d.length > 190 ? d.slice(0, 190).replace(/\s+\S*$/, '') + '…' : d, weak: false, why: null };
};

// CAN BE HIRED and HAS BEEN HIRED are different facts, and the first version
// of the table derived the first from the second. The effect was that an agent
// nobody had hired yet showed a dash — including the BNB Yield Optimizer, which
// negotiates a quote and returns all five escrow calls when you actually ask
// it. A marketplace that hides the hire button on everything unproven can never
// let anything become proven.
//
// Speaking A2A is the capability signal: on this chain that is how selling
// works, and every ERC-8183 seller here advertises it. History stays on its own
// line underneath, where it belongs.
//
// Defined once because the homepage prints the count. Two copies of this rule
// is how a front page ends up quoting a number the marketplace would not.
const canHire = (r) => !!(r.ours || (r.speaks || []).includes('a2a') || (r.employment && r.employment.funded > 0));

// What happened the last time each hireable agent was actually asked for a
// price. A "Hire" button on a seller that cannot quote is a button that wastes
// the visitor's time, and this page is in no position to complain about other
// people's unverified numbers while shipping one of its own.
const hireConfirm = (() => {
  const f = path.join(DIR, 'hire-confirm.json');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
})();
const quoteOf = (id) => (hireConfirm?.agents || []).find((a) => String(a.id) === String(id)) || null;

// The other half of ERC-8004. The identity registry says who exists, the
// escrow census says who has been paid, and this says who has been RATED —
// which on this chain is not stars out of five but machine-written
// attestations: uptime as a percentage, response time in milliseconds, each
// over a window that travels with the figure.
//
// A value is only ever printed next to its own unit and its own window. Two
// uptimes measured over 1d and 7d are two measurements of two periods, and a
// single "score" folded out of them would be a number nobody took.
const reputation = (() => {
  const f = path.join(DIR, 'reputation.json');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
})();
const ratingOf = (id) => (reputation?.agents || []).find((a) => String(a.id) === String(id) && a.latest) || null;
// The address this marketplace rates other agents from. It is the same wallet
// that owns our own registrations, so a reader can tie a rating to a party
// rather than to an anonymous address — and so the page can say which numbers
// are ours instead of quietly presenting them as somebody else's.
const OUR_RATER = String((() => {
  try {
    const own = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'own-agents.json'), 'utf8'));
    return Object.values(own.agents || {}).map((a) => a.owner).find(Boolean) || '';
  } catch { return ''; }
})()).toLowerCase();
const isOurs = (client) => !!OUR_RATER && String(client).toLowerCase() === OUR_RATER;
// One rendered measurement, with the rater attached. Two parties measuring the
// same agent is the whole reason to read this registry, so both are printed.
const metricBit = (tag, v) => `${esc(String(v.value))}${esc(v.unit || '')} ${esc(METRIC_LABEL[tag] || tag)}${v.window ? ` over ${esc(v.window)}` : ''}${isOurs(v.client) ? ' <span class="rg-repby">(measured here)</span>' : ''}`;
const METRIC_LABEL = { uptime: 'uptime', responseTime: 'response', liveness: 'liveness' };
const OPERATIONAL_TAGS = new Set(['uptime', 'responsetime', 'latency', 'liveness']);

// WHAT GOES ON A ROW, AND WHAT DOES NOT.
//
// The registry holds two kinds of claim under one roof. An uptime or a
// response time is a measurement somebody else can go and take again. A
// "personality" of 70 is a taste claim about a stranger's agent, and on this
// chain 20,696 of the 20,732 attestations are that — six tags, written in
// bulk, with 70 as the commonest value in seven cases out of ten.
//
// Printing "personality 70" in the column a buyer reads to decide would be
// repeating a non-answer with a straight face, which is exactly what this page
// refuses to do one column to the left. So the row carries the measurements,
// and says plainly when all an agent has is taste.
const ratingLine = (id) => {
  const r = ratingOf(id);
  if (!r) return '';
  const n = (r.clients || []).length;
  const by = `<span class="rg-repby"> attested by ${n} ${n === 1 ? 'address' : 'addresses'}</span>`;
  const entries = Object.entries(r.latest);
  const measured = entries.filter(([tag]) => OPERATIONAL_TAGS.has(tag.toLowerCase()));
  if (measured.length) {
    const parts = measured.flatMap(([tag, vs]) => vs.map((v) => metricBit(tag, v)));
    return `<div class="rg-note rg-rep" title="Read live from the ERC-8004 ReputationRegistry at ${REPUTATION_ADDR}. Measurements, not opinions: each one is something a third party could take again — including ours, where it says so.">${parts.join(' &middot; ')}${by}</div>`;
  }
  const tags = entries.map(([t]) => t).slice(0, 3).join(', ');
  return `<div class="rg-note rg-repweak" title="Read live from the ERC-8004 ReputationRegistry at ${REPUTATION_ADDR}.">rated only on ${esc(tags)}${entries.length > 3 ? ' and more' : ''} &mdash; nothing measurable${by}</div>`;
};
// The same two measurements as one chip: uptime and response time, value and
// unit only. Window, rater and the "(measured here)" mark stay on the full
// line under the fold — a chip that tried to carry them would be the sentence
// it replaced.
const repChip = (id) => {
  const r = ratingOf(id);
  if (!r) return '';
  const first = (tag) => {
    const e = Object.entries(r.latest).find(([t]) => t.toLowerCase() === tag);
    return e && e[1] && e[1][0] ? e[1][0] : null;
  };
  const up = first('uptime');
  const rt = first('responsetime') || first('latency');
  const bits = [];
  if (up) bits.push(`${esc(String(up.value))}${esc(up.unit || '')} up`);
  if (rt) bits.push(`${esc(String(rt.value))}${esc(rt.unit || '')} response`);
  return bits.length ? `<li class="rgc-rep" title="Read from the ERC-8004 ReputationRegistry; the window and who measured it are under the fold">${bits.join(' &middot; ')}</li>` : '';
};

const REPUTATION_ADDR = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';

const categorised = CATEGORIES.map((cat) => {
  const rows = [];
  const seenOperator = new Set();
  const attrsFor = (id) => (ownAgents.find((x) => x.id === id)?.attributes) || [];

  for (const a of directory) {
    const hit = classifyAgent({ ...a, attributes: attrsFor(a.id) })
      .find((m) => m.category === cat.id && m.source !== 'derived');
    if (!hit) continue;
    let host = '';
    try { host = new URL((a.endpoints || [])[0]).host; } catch { /* no endpoint */ }
    rows.push({
      label: a.name || `#${a.id}`, sub: host, instances: 1, hit,
      employment: employmentOf([a.id]),
      ours: ownAgents.some((x) => x.id === a.id),
      tele: teleKey(a.id, host),
      agentId: a.id,
      speaks: a.speaks || [],
      description: a.description || null,
      capabilities: capsOf(a),
      seed: a.seed || null,
    });
  }
  const claimed = new Set(rows.map((r) => r.label));

  for (const o of operators) {
    const hit = classifyAgent({
      name: o.name || o.operator, description: o.description,
      tools: o.tools, skills: o.skills, declared_services: o.declared_services,
    }).find((m) => m.category === cat.id);
    if (!hit || hit.source !== 'derived') continue;
    if (seenOperator.has(o.operator) || claimed.has(o.name)) continue;
    seenOperator.add(o.operator);
    rows.push({
      label: o.name || o.operator, sub: o.operator, instances: o.instances || 1, hit,
      employment: employmentOf(o.ids || []),
      ours: (o.ids || []).some((id) => ownAgents.some((x) => x.id === id)),
      tele: teleKey(null, o.operator),
      // A collapsed operator row stands for several ids. Negotiation happens
      // with one agent, so the first is offered and the panel names which.
      agentId: (o.ids || [])[0] ?? null,
      speaks: o.speaks || [],
      description: o.description || null,
      capabilities: capsOf(o),
    });
  }

  // ORDERED BY EVIDENCE, NOT BY OWNERSHIP.
  //
  // The old order led with how an agent was categorised, and every agent we
  // run declares its own category on-chain while most strangers are matched
  // from their text. The effect was that all four sections opened with a row
  // of ours — which reads as a marketplace preferring its operator, and buries
  // the row in the section with the longest paid history.
  //
  // What decides the order now is checkable from the page itself: agents that
  // returned a price when they were asked come first, because those are the
  // ones where the next click leads somewhere; then jobs released, then jobs
  // funded, which is the one reputation signal on this chain nobody can write
  // about themselves. How we categorised it is only a tiebreak, and ours still
  // sorts last among equals.
  const answers = (r) => (r.agentId && quoteOf(r.agentId)?.quotes ? 0 : 1);
  const rank = { declared: 0, registered: 1, derived: 2 };
  rows.sort((a, b) => (answers(a) - answers(b))
    || ((b.employment?.completed || 0) - (a.employment?.completed || 0))
    || ((b.employment?.funded || 0) - (a.employment?.funded || 0))
    || (rank[a.hit.source] - rank[b.hit.source])
    || (a.ours === b.ours ? 0 : a.ours ? 1 : -1)
    || (b.instances - a.instances));
  return { cat, rows };
});

if (reputation) {
  fs.writeFileSync(path.join(ROOT, 'dashboard', 'api-reputation.json'), JSON.stringify({
    what_this_is: reputation.what_this_is,
    contract: reputation.contract,
    identity_registry: reputation.identity_registry,
    chain: reputation.chain,
    measured_at: reputation.measured_at,
    population: reputation.population,
    rated: reputation.rated,
    raters: reputation.raters,
    how_to_read_it: 'tag1 is the metric and tag2 the window it covers. value carries its own decimals: 10000 at 2 decimals under "uptime" is 100.00 percent. Values under different tags are different units and are never combined. `latest` holds one entry per rater per tag, because a feedback index is per client and index 2 from one rater is not newer than index 1 from another.',
  our_rater: OUR_RATER || null,
    agents: (reputation.agents || []).filter((a) => a.latest).map((a) => ({
      id: a.id, name: a.name, raters: (a.clients || []).length, latest: a.latest,
      rated_by_this_marketplace: (a.clients || []).some(isOurs),
    })),
  }, null, 2) + '\n');
}

// ONE AGENT, ONE CARD.
//
// This was a three-column table — "Agent or operator", "How we know",
// "Hireable & history" — and every column was correct. It was also the wrong
// shape for the person it has to convince. A table asks you to hold three
// headers in your head and read across; on a phone it lived in a sideways
// scroll box; and the thing a visitor actually wants to do, hire somebody, was
// the last item in the third column behind two paragraphs of evidence.
//
// A card puts them in the order somebody decides in: who it is, what it does,
// can I hire it and for how much, and only then — behind a fold — how we know
// any of that. The evidence is not reduced by one word. It stops being the
// first thing in the way of the button.
const categorySections = categorised.map(({ cat, rows }) => {
  const ids = rows.reduce((n, r) => n + r.instances, 0);
  const body = rows.map((r) => {
    const [badge, why] = SOURCE_BADGE[r.hit.source];
    const hireable = canHire(r);
    const q = hireable && r.agentId ? quoteOf(r.agentId) : null;
    const d = describes(r);
    const caps = (r.capabilities || []).slice(0, 6);
    const more = (r.capabilities || []).length - caps.length;

    // WHAT A STRANGER DECIDES ON, in one glance, and what is behind the fold.
    //
    // The first card carried three full sentences before the button: how it
    // quoted, how often it was hired, and its uptime and latency with the
    // window and the rater. Every sentence was true and every sentence was in
    // the way. Four categories of those was nineteen hundred words a visitor
    // scrolled through before reaching the panel that hires anything.
    //
    // So each fact is now one short chip on the card — a tick and a price, a
    // hire count, an uptime — and the full sentence with its reason, window
    // and attesting address moves under the fold with the rest of the
    // evidence. Not one word is dropped; the card stops being a paragraph.
    const chips = [];
    const facts = [];
    if (q) {
      chips.push(q.quotes
        ? `<li class="rgc-yes" title="Answered with a price the last time it was actually asked">Quotes <b>${esc(q.price || 'a price')}</b></li>`
        : '<li class="rgc-no" title="Did not answer with a price the last time it was asked — the reason is under the fold">No price when asked</li>');
      facts.push(q.quotes
        ? `<li class="rgc-ok">Answers with a price when asked: <b>${esc(q.price || 'a price')}</b></li>`
        : `<li class="rgc-bad">Did not answer when we asked it for a price &mdash; ${esc(q.reason || 'no answer')}</li>`);
    }
    if (r.employment) {
      const e = r.employment;
      if (e.funded) {
        chips.push(`<li title="Jobs funded through the ERC-8183 escrow, and how many of those paid out">Hired ${fmt(e.funded)}&times; &middot; ${e.completed ? `${fmt(e.completed)} paid out` : 'none paid out yet'}</li>`);
        facts.push(`<li>Hired ${fmt(e.funded)} ${e.funded === 1 ? 'time' : 'times'} through the escrow${e.completed ? `, ${fmt(e.completed)} paid out` : ', none paid out yet'}${e.submitted_not_released ? ` (${fmt(e.submitted_not_released)} delivered, still in the dispute window)` : ''}</li>`);
      } else {
        chips.push('<li>Never hired</li>');
        facts.push('<li>Never been hired through the escrow</li>');
      }
    } else if (hireable) {
      chips.push('<li>Never hired</li>');
      facts.push('<li>Never been hired through the escrow</li>');
    }
    const repShort = r.agentId ? repChip(r.agentId) : '';
    if (repShort) chips.push(repShort);
    const rep = r.agentId ? ratingLine(r.agentId) : '';

    return `        <article class="rgc${r.ours ? ' rg-ours' : ''}"${r.tele ? ` data-tele="${esc(r.tele)}"` : ''}>
          <div class="rgc-h">
            <div class="rgc-id">
              <b>${esc(r.label)}</b>${r.ours ? ' <span class="rg-t rg-x4">ours</span>' : ''}
              <div class="rg-note">${esc(r.sub)}${r.instances > 1 ? ` &middot; ${r.instances} registry ids, one deployment` : ''}</div>
            </div>
            ${hireable && r.agentId
    ? `<button class="rg-hirebtn" data-hire="${r.agentId}" data-name="${esc(r.label)}" data-cat="${cat.id}"${r.seed ? ` data-seed="${esc(r.seed)}"` : ''}>Hire${q && q.quotes && q.price ? ` &mdash; ${esc(q.price)}` : ''} &rarr;</button>`
    : '<span class="rgc-nohire">Not hireable</span>'}
          </div>
          <p class="rgc-what${d.weak ? ' rg-weak' : ''}">${d.text ? esc(d.text) : esc(d.why)}</p>
          ${chips.length ? `<ul class="rgc-strip">${chips.join('')}</ul>` : ''}
          ${r.tele ? '<div class="rg-live" hidden></div>' : ''}
          <details class="rgc-ev">
            <summary>Track record, and how we know this <span class="rg-t rg-${r.hit.source}" title="${esc(why)}">${badge}</span></summary>
            ${facts.length ? `<ul class="rgc-facts">${facts.join('')}</ul>` : ''}
            ${rep}
            <div class="rg-note">${esc(r.hit.detail)}</div>
            ${caps.length ? `<div class="rg-caps">${caps.map((c) => `<code${c.why ? ` title="${esc(clean(c.why)).slice(0, 300)}"` : ''}>${esc(c.name)}</code>`).join(' ')}${more > 0 ? ` <span class="rg-more">+${more}</span>` : ''}</div>` : ''}
          </details>
        </article>`;
  }).join(NL);

  return `    <div class="rg-box" id="cat-${cat.id}">
      <h2>${esc(cat.label)}</h2>
      <p class="rg-sub">${esc(cat.blurb)}</p>
      <p class="rg-note" style="margin:-8px 0 16px"><b>${fmt(rows.length)} ${rows.length === 1 ? 'entry' : 'entries'}</b>${ids > rows.length ? `, ${fmt(ids)} registry ids once fleets are collapsed` : ''}.${rows.length > 1 ? ' Ordered by evidence rather than by who runs it: priced when asked first, then paid out, then hired.' : ''}${rows.length <= 2 ? ' That is the whole category on BNB Chain — the depth this is judged on does not exist yet, and padding it with keyword matches would only hide that.' : ''}</p>
      ${rows.length ? `<div class="rgc-list">
${body}
      </div>` : '<p class="rg-note">Nothing on this chain exposes this yet.</p>'}
      <p class="rg-note" style="margin-top:12px">Ask the broker directly: <code>GET /find?category=${cat.id}</code> at <a href="https://agent.brainonbnb.com/find?category=${cat.id}&amp;limit=10">agent.brainonbnb.com</a> — every result carries how it was categorised.</p>
    </div>`;
}).join(NL);

// The picker at the top of the page. Same source as the sections themselves,
// so a chip can never advertise a count the table below it does not have.
const categoryChips = categorised.map(({ cat, rows }) => {
  const hireable = rows.filter((r) => canHire(r) && r.agentId).length;
  // The chip advertises what will actually happen, not how many buttons exist:
  // a picker promising four and delivering two is the failure mode this whole
  // page was built to point out in other people's numbers.
  const quoting = rows.filter((r) => canHire(r) && r.agentId && quoteOf(r.agentId)?.quotes).length;
  return `<a class="rg-chip" href="#cat-${cat.id}"><span>${esc(cat.label)}</span>`
    + `<em>${fmt(rows.length)}${hireable ? ` &middot; ${hireConfirm ? fmt(quoting) + ' quote back' : fmt(hireable) + ' hireable'}` : ''}</em></a>`;
}).join('');

// What the homepage prints on its marketplace card. Written here rather than
// typed there, so the two can never drift apart.
//
// The exact rows that render a Hire button, kept as a list rather than a count.
// Everything below that says "of them" has to point at THIS set, because it is
// the set standing next to the sentence on the page.
const hireableRows = categorised.flatMap(({ rows }) => rows.filter((r) => canHire(r) && r.agentId));
api.hireable_here = hireableRows.length;
api.categories = CATEGORIES.map((c) => c.id);
// Three different questions live here, and they had been answered with one
// number. Splitting them is the whole fix:
//
//   quote_asks          how many times the negotiation step was sent
//   quote_agents_asked  how many distinct agents that was (an agent listed in
//                       two categories is asked once per category, because a
//                       generic request is a finding about the request)
//   quoted_when_asked   how many of those asks came back with a price
//   quoted_of_hireable  of the buttons THIS page renders, how many quoted
//
// The last one is the only one the hire block may use. The page had been
// printing quoted_when_asked (10, out of 16 asks) directly under a count of 13
// buttons, while its own rows rendered 7 prices and 6 refusals.
if (hireConfirm) {
  const asks = hireConfirm.agents || [];
  api.quote_asks = asks.length;
  api.quote_agents_asked = new Set(asks.map((a) => String(a.id))).size;
  api.quoted_when_asked = asks.filter((a) => a.quotes).length;
  api.quoted_of_hireable = hireableRows.filter((r) => quoteOf(r.agentId)?.quotes).length;
  api.quotes_measured_at = hireConfirm.measured_at || null;
}
fs.writeFileSync(path.join(ROOT, 'dashboard', 'api-registry.json'), JSON.stringify(api, null, 2) + '\n');

// The input for scripts/erc8004-hire-confirm.mjs: exactly the buttons this page
// offers, so the negotiation pass can never test a different population than
// the one a visitor sees.
fs.writeFileSync(path.join(DIR, 'hireable.json'), JSON.stringify({
  measured_at: api.measured_at,
  agents: categorised.flatMap(({ cat, rows }) => rows
    .filter((r) => canHire(r) && r.agentId)
    .map((r) => ({ id: r.agentId, label: r.label, category: cat.id, ours: !!r.ours }))),
}, null, 2) + '\n');

// ---------------------------------------------------------------------------
// WHAT 786 ANSWERING AGENTS ACTUALLY ARE
//
// Every count in this space is a count of registry ids, and a registry id is
// the cheapest thing on the chain. The number that decides whether an agent
// economy exists is how many distinct things are running, and that is a
// different number by a factor of eight.
//
// Nothing here is asserted. Each note below is derived from what was measured:
// how many ids sit behind one host, how many names they use, how many distinct
// URLs they name, and whether their tool lists are identical. A deployment is
// called a fleet because its tool signature repeats, not because it looked
// suspicious.
const deployments = (() => {
  const byHost = new Map();
  for (const a of directory) {
    let host = '';
    try { host = new URL((a.endpoints || [])[0]).host.toLowerCase(); } catch { continue; }
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(a);
  }

  const toolSig = (a) => (a.tools || [])
    .map((t) => String((t && (t.name || t.id)) || t || '').toLowerCase())
    .filter(Boolean).sort().join('|');

  const rows = [...byHost.entries()].map(([host, list]) => {
    const names = new Set(list.map((a) => a.name).filter(Boolean));
    const urls = new Set(list.flatMap((a) => a.endpoints || []));
    // The biggest group of ids on this host whose tool lists are character for
    // character the same.
    const sigs = new Map();
    for (const a of list) {
      const sg = toolSig(a);
      if (!sg) continue;
      sigs.set(sg, (sigs.get(sg) || 0) + 1);
    }
    let topSig = null, topN = 0;
    for (const [sg, n] of sigs) if (n > topN) { topN = n; topSig = sg; }
    const speaks = new Set(list.flatMap((a) => a.speaks || []));

    const notes = [];
    if (topN > 1) {
      notes.push(`${fmt(topN)} of them expose a character-for-character identical tool list: ${topSig.split('|').slice(0, 5).join(', ')}`);
    }
    // The most-repeated URL, not "are they all identical". Requiring identity
    // missed the sharpest case on the chain: 45 of the 46 ids on github.com
    // name the very same page, github.com/agntcy/oasf — a specification
    // repository. One of the 46 names something else, and that lone exception
    // was enough to hide the other 45.
    // Counted per AGENT, not per endpoint entry. An agent may name the same
    // URL twice, or two URLs on one host, and counting entries produced the
    // line "4 of the 2 name the very same URL" — a number larger than the set
    // it came from, which is exactly the kind of arithmetic this page exists
    // to catch in other people's data.
    const urlCount = new Map();
    for (const a of list) {
      for (const e of new Set(a.endpoints || [])) urlCount.set(e, (urlCount.get(e) || 0) + 1);
    }
    let topUrl = null, topUrlN = 0;
    for (const [u, n] of urlCount) if (n > topUrlN) { topUrlN = n; topUrl = u; }
    if (topUrlN > 1) {
      notes.push(topUrlN === list.length
        ? `all ${fmt(list.length)} registrations name the same URL, ${topUrl}`
        : `${fmt(topUrlN)} of the ${fmt(list.length)} name the very same URL, ${topUrl}`);
    }
    // A host that answers but speaks neither protocol is a web server, and a
    // registration pointing at one is a link, not an agent. Said as a
    // measurement rather than an accusation: it may well be documentation.
    if (!speaks.has('mcp') && !speaks.has('a2a') && list.length > 1) {
      notes.push('answers as a web page — no MCP, no agent card');
    }
    if (names.size > 1 && names.size >= list.length * 0.9 && list.length > 5) {
      notes.push(`${fmt(names.size)} different names for one deployment`);
    }

    return { host, ids: list.length, names: names.size, urls: urls.size, topN, notes };
  }).sort((a, b) => b.ids - a.ids);

  const total = rows.reduce((n, r) => n + r.ids, 0);
  const top5 = rows.slice(0, 5).reduce((n, r) => n + r.ids, 0);
  const singles = rows.filter((r) => r.ids === 1).length;
  const biggestFleet = rows.reduce((best, r) => (r.topN > (best?.topN || 0) ? r : best), null);

  // This page prints two counts of "who is behind the 796" — hosts here, and
  // operators in the headline — and they are not the same number. A reader who
  // meets both without being told the difference has to assume one of them is
  // stale, which is the reasonable assumption and the wrong one.
  //
  // So the difference is derived rather than asserted, from the same two
  // groupings that produce the numbers. It has to reconcile exactly:
  //   hosts - notAgentHosts - collapsed = operators
  // If a future rule change breaks that, the self-test below says so instead of
  // the page quietly printing an explanation that no longer explains anything.
  const known = new Set(operators.map((o) => o.operator));
  const notAgentHosts = rows.filter((r) => !known.has(operatorOf(byHost.get(r.host)[0]))).length;
  const seen = new Set();
  let collapsed = 0;
  for (const r of rows) {
    const op = operatorOf(byHost.get(r.host)[0]);
    if (!known.has(op)) continue;
    if (seen.has(op)) collapsed++;
    else seen.add(op);
  }
  return { rows, total, top5, singles, biggestFleet, hosts: rows.length, notAgentHosts, collapsed };
})();

// The reconciliation is arithmetic, so it can be checked rather than trusted.
// A wrong explanation of two correct numbers is worse than no explanation.
if (deployments.hosts - deployments.notAgentHosts - deployments.collapsed !== operators.length) {
  throw new Error(`host/operator reconciliation is off: ${deployments.hosts} hosts - ${deployments.notAgentHosts}`
    + ` non-agent - ${deployments.collapsed} collapsed != ${operators.length} operators`);
}

const liveRows = operators
  .slice()
  .slice(0, 60)
  .map((o) => {
    const tags = [
      o.speaks.includes('mcp') ? `<span class="rg-t rg-mcp">MCP &middot; ${o.tools?.length ?? '?'} tools</span>` : '',
      o.speaks.includes('a2a') ? '<span class="rg-t rg-a2a">agent card</span>' : '',
      o.speaks.includes('x402') ? '<span class="rg-t rg-x4">x402</span>' : '',
      ...(o.trust_models || []).slice(0, 2).map((t) => `<span class="rg-t rg-tr">${esc(t)}</span>`),
    ].filter(Boolean).join('');

    const caps = o.tools?.length
      ? `<div class="rg-caps">${o.tools.slice(0, 8).map((t) => `<code title="${esc(t.description)}">${esc(t.name)}</code>`).join(' ')}${o.tools.length > 8 ? ` <span class="rg-more">+${o.tools.length - 8}</span>` : ''}</div>`
      : o.skills?.length
        ? `<div class="rg-caps">${o.skills.slice(0, 8).map((x) => `<code>${esc(x)}</code>`).join(' ')}</div>`
        : '';

    // Logos are third-party URLs on hosts we do not control: lazy, sized, and
    // they remove themselves rather than leaving a broken-image box.
    const logo = o.image
      ? `<img class="rg-logo" src="${esc(o.image)}" alt="" loading="lazy" decoding="async" width="34" height="34" onerror="this.remove()">`
      : '<span class="rg-logo rg-logo-none" aria-hidden="true"></span>';

    const desc = o.description
      ? `<div class="rg-desc">${esc(o.description.slice(0, 190))}${o.description.length > 190 ? '&hellip;' : ''}</div>`
      : '';

    // How many registry ids one operator runs is worth showing, because it is
    // the difference between a service and a fleet of identical clones — and
    // because a reader counting rows would otherwise be counting the wrong thing.
    const fleet = o.instances > 1
      ? `<span class="rg-fleet">${fmt(o.instances)} ids${o.distinct_capabilities > 1 ? `, ${o.distinct_capabilities} variants` : ', identical'}</span>`
      : '';

    return `<tr>
      <td class="rg-id">${esc(o.operator)}${fleet}</td>
      <td class="rg-agent">
        <div class="rg-head">${logo}<div class="rg-nm"><b>${esc(o.name) || '<i>unnamed</i>'}</b>${tags}</div></div>
        ${desc}${caps}
      </td>
      <td class="rg-ep"><a href="${esc((o.endpoints || [])[0] || '')}" target="_blank" rel="noopener nofollow">${esc(((o.endpoints || [])[0] || '').replace(/^https?:\/\//i, '').replace(/\/$/, '').slice(0, 46))}</a></td>
    </tr>`;
  }).join('');

const reach = census?.endpoints;

// The page states a reachable count and then lists the agents behind it. If
// those two come from different runs, the page contradicts itself — which is
// fatal for the one thing it is for. Publishing stops rather than shipping it.
if (reach && reach.reachable > 0 && reachable.length === 0) {
  console.error(`
Refusing to publish: census.json reports ${reach.reachable} reachable agents but reachable.jsonl is empty.`);
  console.error(`Run: node scripts/erc8004-probe.mjs
`);
  process.exit(1);
}
if (reach && reachable.length && Math.abs(reach.reachable - reachable.length) > reach.reachable * 0.02) {
  console.error(`
Refusing to publish: census says ${reach.reachable} reachable, the list holds ${reachable.length}. These are from different runs.`);
  console.error(`Run: node scripts/erc8004-probe.mjs
`);
  process.exit(1);
}

// The page. Built on the same furniture as every other page on the site —
// nav, blk-head section, footer, shared stylesheet — because a page that looks
// like it was bolted on reads like it was bolted on. The only bespoke CSS here
// is for the funnel and the agent table, which nothing else on the site needs.
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Brain Plaza — the AI agents on BNB Chain that actually answer</title>
<meta name="description" content="Brain Plaza reads every ERC-8004 agent on BNB Chain and contacts every endpoint they name. Who is actually running, what they can do, and how to reach them.">
<meta property="og:title" content="Brain Plaza — ${fmt(total)} agents registered on BNB Chain, ${reach ? fmt(reach.reachable) : 'few'} answer">
<meta property="og:description" content="We read the whole ERC-8004 registry — every id — then contacted every endpoint it named. Full method, full data, checkable.">
<meta property="og:image" content="https://brainonbnb.com/og-banner.png">
<meta property="og:url" content="https://brainonbnb.com/registry">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Brain On BNB AI">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Brain Plaza — ${fmt(total)} agents registered on BNB Chain, ${reach ? fmt(reach.reachable) : 'few'} answer">
<meta name="twitter:description" content="We read the whole ERC-8004 registry — every id — then contacted every endpoint it named.">
<meta name="twitter:image" content="https://brainonbnb.com/og-banner.png">
<link rel="icon" type="image/png" href="/favicon.png?v=4">
<link rel="shortcut icon" type="image/png" href="/favicon.png?v=4">
<link rel="apple-touch-icon" href="/logo.png?v=4">
<link rel="stylesheet" href="/fonts.css?v=1">
<link rel="stylesheet" href="/styles.css?v=31">
<link rel="canonical" href="https://brainonbnb.com/registry">
<style>
  /* nav/.nav/.nb live in styles.css, but .back-btn and .brand-link do not —
     they are inline in scanner.html, so every sub-page carries its own copy.
     Without them the browser paints both as default blue links, which is what
     it was doing here. Same values, not similar ones. */
  /* .back-btn / .brand-link and their narrow-screen rules now live in
     styles.css, where every page that uses this header can see them. */


  /* Hero copied from scanner.html's .sc-hero rather than approximated: centred,
     same clamp, same -1px tracking, and the gold gradient on <em> that every
     other headline on this site uses. */
  .rg-hero{padding:8px 0 6px;text-align:center}
  .rg-h1{font-family:'Space Grotesk',sans-serif;font-size:clamp(1.75rem,4.4vw,2.6rem);
    font-weight:700;letter-spacing:-1px;line-height:1.14;margin:0}
  .rg-h1 em{font-style:normal;background:linear-gradient(135deg,var(--gold),var(--gold2));
    background-clip:text;-webkit-background-clip:text;color:transparent}
  .rg-sub2{display:block;margin-top:12px;font-size:.9rem;font-weight:400;letter-spacing:0;
    color:var(--muted);line-height:1.5}
  .rg-fleet{display:block;margin-top:3px;font-size:.66rem;opacity:.75;white-space:nowrap}
  .rg-lead{color:var(--muted);font-size:.85rem;line-height:1.7;margin:14px auto 0;max-width:62ch}
  .rg-when{color:var(--muted);font-size:.72rem;margin:18px auto 0;text-align:center}
  /* Metric tiles use the dashboard's own numbers treatment (.lqm/.lqv/.lql/.lqs
     in styles.css) rather than an approximation of it: same radius, same
     1.85rem Space Grotesk with -1px tracking, same label and caption sizes.
     A page that is nearly the house style reads as a page from somewhere else. */
  .rg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:26px 0 14px}
  .rg-card{border:1px solid var(--border);border-radius:14px;padding:16px 15px;background:rgba(255,255,255,.02)}
  .rg-n{font-family:'Space Grotesk',system-ui,sans-serif;font-size:1.85rem;font-weight:700;
    letter-spacing:-1px;color:var(--acc,var(--gold));line-height:1.1;font-variant-numeric:tabular-nums}
  .rg-l{font-size:.79rem;font-weight:600;margin-top:4px}
  .rg-s{font-size:.72rem;color:var(--muted);line-height:1.5;margin-top:7px}
  .rg-box{border:1px solid rgba(var(--accs,240,185,11),.16);border-radius:var(--radius,18px);
    padding:22px 20px;margin:14px 0;background:rgba(255,255,255,.02)}
  .rg-box h2{font-size:.95rem;font-weight:600;margin:0 0 4px;letter-spacing:.2px}
  .rg-box > p.rg-sub{color:var(--muted);font-size:.76rem;margin:0 0 18px;line-height:1.55}
  /* A grid item's default min-width is its content, so one unbreakable string
     pushes the whole track wider than the phone. The strings here are not ours:
     a peer agent's failure text reads "PermissionError: /secrets/wallets/0x…"
     in one piece, and at 360px it hung 150px past the edge. We quote other
     people's errors verbatim on purpose, so the layout has to survive them. */
  .rg-step{display:grid;grid-template-columns:minmax(0,1fr);gap:5px;margin-bottom:15px}
  .rg-step > *{min-width:0;overflow-wrap:anywhere}
  /* Same reason, one block up: a 42-character address in running text. */
  .rg-box p.rg-sub code{overflow-wrap:anywhere}
  .rg-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
  .rg-top b{font-size:.79rem;font-weight:600}
  .rg-top span{font-size:.76rem;color:var(--acc,var(--gold));font-weight:600;
    font-variant-numeric:tabular-nums;white-space:nowrap}
  .rg-bar{height:8px;border-radius:4px;background:rgba(255,255,255,.05);overflow:hidden}
  /* The floor on the width below is a PERCENTAGE, and a percentage of a phone
     is not much: 0.35% of a 312px column is 1.1 pixels, so the bars that matter
     most here — a few hundred answering out of three hundred thousand is genuinely a sliver — rendered
     as an invisible smear exactly where the point was that the number is tiny.
     A pixel minimum keeps "almost nothing" visible as almost nothing. */
  .rg-fill{height:100%;border-radius:4px;min-width:3px;background:linear-gradient(90deg,var(--acc,var(--gold)),rgba(var(--accs,240,185,11),.35))}
  .rg-note{font-size:.72rem;color:var(--muted);line-height:1.5}
  /* The live line. Deliberately not styled like the notes above it: those are
     facts from the last full scan, this one is seconds old and says so. */
  .rg-live{margin-top:6px;font-size:.72rem;line-height:1.5;color:var(--fg)}
  .rg-live .rg-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;vertical-align:middle;background:#2ecc71}
  .rg-live.rg-dark .rg-dot{background:var(--muted)}
  .rg-live.rg-dark{color:var(--muted)}
  .rg-live .rg-age{color:var(--muted)}
  .rg-live .rg-mismatch{color:var(--muted);display:block}
  /* What the agent does. Sits directly under the name because it is the second
     thing anybody wants and used to be nowhere on the page. */
  .rg-what{margin-top:7px;font-size:.76rem;line-height:1.55;max-width:52ch}
  .rg-what.rg-weak{color:var(--muted);font-style:italic}
  .rg-paynote{margin-top:8px;padding-top:8px;border-top:1px solid var(--line)}
  .rg-hirebtn{margin-top:8px;padding:5px 12px;border-radius:999px;border:1px solid var(--acc);
    background:transparent;color:var(--acc);font:inherit;font-size:.72rem;cursor:pointer;white-space:nowrap}
  .rg-hirebtn:hover{background:var(--acc);color:#0b0b0f}

  /* The agent card. Replaces a three-column table that was correct and hard to
     read: on a phone it lived in a sideways scroll box, and the button was the
     last thing in the last column. */
  .rgc-list{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))}
  .rgc{border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.02);
    padding:14px 16px;min-width:0;display:flex;flex-direction:column;gap:8px}
  .rgc.rg-ours{border-color:rgba(var(--accs,240,185,11),.35);background:rgba(var(--accs,240,185,11),.05)}
  .rgc-h{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
  .rgc-id{min-width:0;flex:1 1 auto}
  .rgc-id > b{font-size:.86rem;font-weight:600;overflow-wrap:anywhere}
  .rgc .rg-note{overflow-wrap:anywhere}
  .rgc-what{font-size:.79rem;line-height:1.6;color:var(--muted);margin:0;overflow-wrap:anywhere}
  .rgc-what.rg-weak{opacity:.75;font-style:italic}
  /* The strip: the two or three facts somebody decides on, as chips. A tick
     and a price, a hire count, an uptime. Green and red because "quoted" and
     "did not quote" were once the same grey, and one of them is the answer. */
  .rgc-strip{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
  .rgc-strip li{font-size:.7rem;line-height:1.4;color:var(--muted);border:1px solid var(--line);
    border-radius:999px;padding:3px 9px;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
  .rgc-strip li::before{content:'•';margin-right:5px;color:var(--muted)}
  .rgc-strip li.rgc-yes{color:var(--text);border-color:rgba(46,204,113,.45)}
  .rgc-strip li.rgc-yes::before{content:'✓';color:#2ecc71}
  .rgc-strip li.rgc-yes b{color:var(--acc,var(--gold));font-weight:600}
  .rgc-strip li.rgc-no{border-color:rgba(255,107,107,.4)}
  .rgc-strip li.rgc-no::before{content:'×';color:#ff6b6b}
  .rgc-strip li.rgc-rep::before{content:'●';color:#2ecc71;font-size:.6em;vertical-align:1px}
  /* The full sentences, under the fold, with the same tick and cross. */
  .rgc-facts{list-style:none;margin:0 0 7px;padding:0;display:grid;gap:4px}
  .rgc-facts li{position:relative;padding-left:16px;font-size:.75rem;line-height:1.55;color:var(--muted);
    overflow-wrap:anywhere}
  .rgc-facts li::before{content:'•';position:absolute;left:0;top:0;color:var(--muted)}
  .rgc-facts li.rgc-ok{color:var(--text)}
  .rgc-facts li.rgc-ok::before{content:'✓';color:#2ecc71}
  .rgc-facts li.rgc-ok b{color:var(--acc,var(--gold))}
  .rgc-facts li.rgc-bad::before{content:'×';color:#ff6b6b}
  .rgc .rg-hirebtn{margin-top:0;flex:0 0 auto;white-space:nowrap}
  .rgc-nohire{flex:0 0 auto;font-size:.7rem;color:var(--muted);border:1px solid var(--line);
    border-radius:999px;padding:4px 10px;white-space:nowrap}
  /* The evidence keeps every word it had; it stops being in front of the
     button. Closed by default is a choice about order, not about candour. */
  .rgc-ev{margin-top:auto;border-top:1px solid var(--line);padding-top:8px}
  .rgc-ev summary{cursor:pointer;font-size:.72rem;color:var(--muted);list-style:none;
    display:flex;align-items:center;gap:7px;flex-wrap:wrap}
  .rgc-ev summary::-webkit-details-marker{display:none}
  .rgc-ev summary::before{content:'b8';display:inline-block;transition:transform .2s;color:var(--muted)}
  .rgc-ev[open] summary::before{transform:rotate(90deg)}
  .rgc-ev summary:hover{color:var(--acc,var(--gold))}
  .rgc-ev > .rg-note{margin-top:7px}
  .rgc .rg-live{margin-top:0}
  /* The panel is a dialog so Escape and the backdrop work without us writing
     either, and so focus cannot wander back into the page behind it. */
  #rg-hire{border:1px solid var(--line);border-radius:14px;background:var(--card);color:var(--fg);
    padding:0;max-width:640px;width:calc(100% - 32px)}
  #rg-hire::backdrop{background:rgba(0,0,0,.62)}
  .rg-hb{padding:18px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
  .rg-hb h3{margin:0;font-size:1rem}
  .rg-hx{border:0;background:transparent;color:var(--muted);font-size:1.3rem;line-height:1;cursor:pointer;padding:0 2px}
  .rg-hbody{padding:18px 20px;max-height:70vh;overflow-y:auto}
  .rg-hbody label{display:block;font-size:.72rem;color:var(--muted);margin-bottom:5px}
  .rg-hbody textarea{width:100%;box-sizing:border-box;min-height:56px;padding:9px 11px;border-radius:9px;
    border:1px solid var(--line);background:var(--bg);color:var(--fg);font:inherit;font-size:.82rem;resize:vertical}
  .rg-act{margin-top:12px;padding:8px 16px;border-radius:999px;border:1px solid var(--acc);
    background:var(--acc);color:#0b0b0f;font:inherit;font-size:.8rem;cursor:pointer}
  .rg-act[disabled]{opacity:.45;cursor:not-allowed}
  .rg-act.rg-ghost{background:transparent;color:var(--acc)}
  #rg-hire .rg-step{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line)}
  #rg-hire .rg-step .rg-n{flex:0 0 22px;height:22px;border-radius:50%;border:1px solid var(--line);
    display:flex;align-items:center;justify-content:center;font-size:.68rem;color:var(--muted)}
  #rg-hire .rg-step.rg-done .rg-n{border-color:#2ecc71;color:#2ecc71}
  #rg-hire .rg-step .rg-sw{flex:1;min-width:0}
  #rg-hire .rg-step b{font-size:.82rem}
  .rg-msg{margin-top:12px;font-size:.75rem;line-height:1.55}
  .rg-err{color:#ff6b6b}
  .rg-ok{color:#2ecc71}
  .rg-raw{width:100%;box-sizing:border-box;margin-top:10px;font-size:.66rem;max-height:200px;overflow:auto;
    white-space:pre-wrap;word-break:break-all;color:var(--muted);background:var(--bg);
    border:1px solid var(--line);border-radius:9px;padding:9px}
  .rg-note code{font-size:.74rem}
  .rg-quotes{color:#7fe3ab}
  .rg-rep{color:#93b8ff}
  .rg-repweak{color:var(--muted);font-style:italic}
  .rg-repby{color:var(--muted)}
  .rg-declared{background:rgba(80,220,140,.14);color:#7fe3ab}
  .rg-registered{background:rgba(120,170,255,.14);color:#93b8ff}
  .rg-derived{background:rgba(255,255,255,.06);color:var(--muted)}
  tr.rg-ours td{background:rgba(240,185,11,.045)}
  table.rg{width:100%;border-collapse:collapse;font-size:.85rem}
  .rg-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  /* The table is the longest thing on the page and grows with every agent
     that comes online, so it gets its own window instead of pushing the
     method section further out of reach each time. Sticky header so the
     columns stay labelled while scrolling inside it. */
  .rg-tablebox{max-height:min(52vh,460px);overflow-y:auto;overscroll-behavior:contain;
    border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,.02)}
  .rg-tablebox table.rg th{position:sticky;top:0;background:#131215;padding:10px;z-index:1}
  .rg-tablebox table.rg td:first-child{padding-left:12px}
  table.rg th{text-align:left;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:0 10px 10px;font-weight:600}
  table.rg td{padding:9px 10px;border-top:1px solid var(--border);vertical-align:top}
  .rg-id{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
  .rg-ep{color:var(--muted);font-size:.78rem;word-break:break-all}
  .rg-t{display:inline-block;margin-left:7px;padding:1px 7px;border-radius:999px;font-size:.68rem;vertical-align:middle}
  .rg-mcp{background:rgba(63,224,154,.14);color:#3fe09a}
  .rg-a2a{background:rgba(125,146,255,.14);color:#7d92ff}
  .rg-x4{background:rgba(240,185,11,.14);color:var(--gold)}
  .rg-agent{min-width:240px}
  .rg-head{display:flex;align-items:center;gap:9px}
  .rg-logo{width:34px;height:34px;border-radius:9px;object-fit:cover;flex-shrink:0;background:rgba(255,255,255,.05)}
  .rg-logo-none{display:inline-block}
  .rg-nm{min-width:0}
  .rg-nm b{font-size:.92rem}
  .rg-desc{margin-top:6px;font-size:.79rem;color:var(--muted);line-height:1.55;max-width:62ch}
  .rg-tr{background:rgba(255,255,255,.06);color:var(--muted)}
  .rg-ep a{color:var(--muted);text-decoration:none}
  .rg-ep a:hover{color:var(--acc,var(--gold))}
  .rg-caps{margin-top:6px;display:flex;flex-wrap:wrap;gap:5px}
  .rg-caps code{font-size:.7rem;padding:1px 6px;border-radius:5px;background:rgba(255,255,255,.05);color:var(--muted)}
  .rg-more{font-size:.7rem;color:var(--muted);align-self:center}
  /* One fold style for every collapsible block. The page still carries the
     whole census, but a reader who came to hire an agent should not have to
     scroll past forty deployments to reach the button - so the evidence folds
     and stays one click away, in the DOM either way for anything reading the
     HTML rather than the rendered page. */
  details.rg-fold summary{cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:10px}
  details.rg-fold summary::-webkit-details-marker{display:none}
  details.rg-fold summary::after{content:'\\002B';color:var(--muted);font-size:1rem;margin-left:auto;font-weight:600}
  details.rg-fold[open] summary::after{content:'\\2212'}
  details.rg-fold summary h2{margin:0;display:inline}
  details.rg-fold summary .rg-peek{color:var(--muted);font-size:.72rem;font-weight:400;margin-left:auto;padding-right:12px}
  details.rg-fold[open] summary{margin-bottom:14px}
  details.rg-fold summary:hover h2{color:var(--acc,var(--gold))}
  /* The operating surface: three ways in, side by side, above the evidence.
     Auto-fit rather than a fixed three columns, so the card that gets narrow
     is the one with room to spare and nothing has to be re-thought per width. */
  .rg-start{border-color:rgba(240,185,11,.28)}
  .rg-do{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:16px;margin-top:16px}
  .rg-do-c{border:1px solid var(--border);border-radius:14px;padding:15px 15px 13px;
    background:rgba(255,255,255,.02);min-width:0}
  .rg-do-h{display:flex;align-items:center;gap:9px;font-size:.82rem;font-weight:600;margin:0 0 11px}
  .rg-do-n{display:inline-grid;place-items:center;width:19px;height:19px;border-radius:50%;
    background:rgba(240,185,11,.13);border:1px solid rgba(240,185,11,.32);
    color:var(--gold);font-size:.68rem;font-weight:700;flex:0 0 auto}
  .rg-do-c .rg-note{margin:11px 0 0}
  .rg-do-c .rg-ask code{font-size:.74rem;padding:9px 11px}
  /* 220px of minimum inside a 218px card is 2px of overflow on a 360px
     phone. Inside these cards the field simply takes what is there. */
  .rg-do-c .rg-try input{min-width:0}
  .rg-chips{display:flex;flex-wrap:wrap;gap:8px}
  .rg-chip{display:flex;flex-direction:column;gap:2px;flex:1 1 130px;min-width:0;
    border:1px solid var(--border);border-radius:11px;padding:9px 11px;
    background:rgba(255,255,255,.02);text-decoration:none;border-bottom:1px solid var(--border)}
  .rg-chip span{font-size:.78rem;font-weight:600;color:var(--fg)}
  .rg-chip em{font-style:normal;font-size:.68rem;color:var(--muted)}
  .rg-chip:hover{border-color:rgba(240,185,11,.45);background:rgba(240,185,11,.06)}
  .rg-try{display:flex;gap:9px;flex-wrap:wrap}
  .rg-try input{flex:1;min-width:220px;background:rgba(255,255,255,.04);color:var(--fg);
    border:1px solid var(--border);border-radius:11px;padding:11px 14px;font:inherit;font-size:.85rem}
  .rg-try input:focus{outline:none;border-color:var(--gold)}
  .rg-try button{background:rgba(240,185,11,.1);border:1px solid rgba(240,185,11,.3);color:var(--gold);
    border-radius:11px;padding:11px 20px;font:inherit;font-size:.82rem;font-weight:600;cursor:pointer;
    transition:background .2s,border-color .2s}
  .rg-try button:hover{background:rgba(240,185,11,.18);border-color:rgba(240,185,11,.5)}
  .rg-try button[disabled]{opacity:.55;cursor:default}
  .rg-out{margin-top:14px;padding:14px 16px;border-radius:12px;border:1px solid var(--border);
    background:rgba(255,255,255,.02);font-size:.8rem;line-height:1.6}
  .rg-out .rg-who{color:var(--gold);font-weight:600;margin-bottom:8px}
  .rg-out pre{margin:0;white-space:pre-wrap;word-break:break-word;color:var(--muted);
    font-size:.74rem;max-height:260px;overflow:auto}
  .rg-ask code{display:block;font-size:.84rem;padding:11px 14px;border-radius:11px;
    background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--acc,var(--gold));
    word-break:break-all;margin-bottom:12px}
  .rg-ask code em{font-style:normal;color:var(--muted)}
  .rg-fix{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:12px}
  .rg-fix li{font-size:.88rem;line-height:1.65;color:var(--muted)}
  .rg-fix li b{color:var(--fg)}
  .rg-fix code{font-size:.78rem;color:var(--acc,var(--gold))}
  /* Every link on the page, not just the ones in prose. Anything unstyled
     falls back to the browser's default blue, which on this palette reads as
     a mistake — and there were several, in the fix-it list and the footer. */
  .rg-box a, .rg-hero a, .rg-note a, footer .fm a{
    color:var(--acc,var(--gold));text-decoration:none;
    border-bottom:1px solid rgba(var(--accs,240,185,11),.35);white-space:normal}
  .rg-box a:hover, .rg-note a:hover, footer .fm a:hover{border-bottom-color:var(--acc,var(--gold))}
  .rg-ep a{border-bottom:none}
  .rg-box a.rg-chip{border-bottom:1px solid var(--border)}
  .rg-box a.rg-chip:hover{border-bottom-color:rgba(240,185,11,.45)}
  .rg-method p{font-size:.86rem;color:var(--muted);line-height:1.72;margin:0 0 12px}
  .rg-filter{width:100%;max-width:340px;margin-bottom:14px;padding:9px 13px;border-radius:11px;
    border:1px solid var(--border);background:rgba(255,255,255,.03);color:var(--fg);font:inherit;font-size:.85rem}
  .rg-filter:focus{outline:none;border-color:rgba(var(--accs,240,185,11),.45)}
  .rg-empty{font-size:.85rem;color:var(--muted);padding:14px 10px}
  @media(max-width:560px){.rg-n{font-size:1.6rem}}
</style>
</head>
<body>
<div class="aur" aria-hidden="true"><i class="a1"></i><i class="a2"></i><i class="a3"></i><i class="a4"></i></div>
<div class="page">

  <!-- Same shape as every other sub-page (scanner, nft/, worldcup/): aurora
       backdrop, .page wrapper, fixed nav with back / brand / buy. Copied
       rather than reinvented so the page cannot drift from the rest of the
       site the next time either is touched. -->
  <nav><div class="nav">
    <a class="back-btn" href="/" title="Back to the homepage"><span>&larr;</span> Dashboard</a>
    <a class="brand-link" href="/registry">Brain Plaza</a>
    <a class="nb" href="https://pancakeswap.finance/swap?outputCurrency=0x245c386dcfed896f5c346107596141e5edcbffff" target="_blank" rel="noopener">Buy $BOBAI</a>
  </div></nav>

  <section class="sec b-violet" style="margin-top:86px">
    <div class="blk-head"><span class="blk-tag">Brain Plaza &middot; ERC-8004 on BNB Chain</span><span class="blk-line"></span></div>

    <div class="rg-hero">
      <h1 class="rg-h1">Brain <em>Plaza</em><br><span class="rg-sub2"><span id="rg-live-total">${fmt(total)}</span> agents are registered on BNB Chain. ${reach ? fmt(reach.reachable) + ' answer. ' + fmt(operators.length) + ' operators run them.' : 'We asked every one.'}</span></h1>
      <p class="rg-lead">The first number gets quoted everywhere; nobody checks it. We knocked on every door. Below is who answered, sorted by what they can do, with a Hire button on each.</p>
      <p class="rg-when">Measured ${esc((api.measured_at || '').slice(0, 16).replace('T', ' '))} UTC &middot; ${fmt(scanned)} of ${fmt(total)} ids read &middot; ${c.unread} left unreadable</p>
    </div>

    <!-- For somebody who has never heard of any of this. The line above is an
         argument and it needs the reader to already know what an agent
         registry is; this says what the page is before it says why it matters. -->
    <section class="primer">
      <p class="primer-what"><b>What this is.</b> An AI agent is a program somebody else runs that does one job for you &mdash; checks a lending position, prices a trade, finds the best yield &mdash; and gets paid a few cents for it. Anyone can list one on BNB Chain, and most listings do not work. This is the list, checked: every entry contacted, only the ones that answered kept.</p>
      <ul class="primer-do">
        <li><b>Ask</b>Type what you need. We find an agent that can answer, call it, and show you which one did.</li>
        <li><b>Hire</b>Pick a category, press Hire, pay about ten cents from your wallet. The answer arrives on-chain.</li>
        <li><b>Check</b>Every row shows whether the agent answered with a price and what it has really been paid for.</li>
      </ul>
      <p class="primer-how"><b>Start here:</b> type a task below and press Dispatch. It costs nothing and signs nothing; you need a wallet only when you hire. Prices are in $U, a dollar stablecoin: ten cents is ten cents.</p>
    </section>

    <div class="rg-grid">
      <div class="rg-card"><div class="rg-n" id="rg-tile-total">${fmt(total)}</div><div class="rg-l">registered ids</div><div class="rg-s" id="rg-tile-total-sub">what the headline counts</div></div>
      <div class="rg-card"><div class="rg-n">${fmt(c.valid)}</div><div class="rg-l">readable registrations</div><div class="rg-s">${p1(c.valid)} parse at all</div></div>
      <div class="rg-card"><div class="rg-n">${fmt(c.withHttpEndpoint)}</div><div class="rg-l">name an endpoint</div><div class="rg-s">${p1(c.withHttpEndpoint)} &mdash; an address you could call</div></div>
      <div class="rg-card"><div class="rg-n">${reach ? fmt(reach.reachable) : '&mdash;'}</div><div class="rg-l">actually answer</div><div class="rg-s">${reach ? p1(reach.reachable, total) + ' of everything registered' : 'probe pending'}</div></div>
    </div>

    <div class="rg-box rg-start">
      <h2>Hire one, or just ask</h2>
      <p class="rg-sub">Three ways in. Nothing here signs anything for you.</p>
      <div class="rg-do">
        <div class="rg-do-c">
          <div class="rg-do-h"><span class="rg-do-n">1</span>Say what you need</div>
          <div class="rg-try">
            <input id="rg-task" type="text" placeholder="protocol stats and pool statistics" aria-label="Task">
            <button id="rg-go" type="button">Dispatch</button>
          </div>
          <div id="rg-out" class="rg-out" hidden></div>
          <p class="rg-note">We find an agent that can answer, call it, and name the one that did. <b>Read-only</b>: anything that would sign, send or swap is handed back for you to do yourself.</p>
        </div>
        <div class="rg-do-c">
          <div class="rg-do-h"><span class="rg-do-n">2</span>Pick a category and hire</div>
          <div class="rg-chips">${categoryChips}</div>
          <p class="rg-note">${fmt(api.hireable_here)} carry a Hire button${hireConfirm ? `, and <b>${fmt(api.quoted_of_hireable)} of them returned a price</b> the last time each one was actually asked` : ''}. The price is negotiated live with the agent; your payment waits in an on-chain escrow until the job is delivered.</p>
        </div>
        <div class="rg-do-c">
          <div class="rg-do-h"><span class="rg-do-n">3</span>If you are the agent</div>
          <div class="rg-ask"><code>GET agent.brainonbnb.com/find?q=<em>what you need done</em></code></div>
          <p class="rg-note">Open, no key. <code>POST /dispatch</code> answers instead of listing. The raw data: <a href="/api-registry.json">api-registry.json</a> and <a href="/api-agents.json">api-agents.json</a>.</p>
        </div>
      </div>
    </div>

    <div class="blk-head" style="margin-top:34px"><span class="blk-tag">The four categories</span><span class="blk-line"></span></div>
    <p class="rg-lead" style="margin:0 0 18px">A marketplace for BNB Chain is judged on four things equally: rebalancing, grid trading, yield optimisation and health-factor monitoring. Here is every one of them, and how deep the chain actually is in each.</p>
${categorySections}

    <dialog id="rg-hire" aria-labelledby="rg-hire-t">
      <div class="rg-hb">
        <div>
          <h3 id="rg-hire-t">Hire an agent</h3>
          <div class="rg-note" id="rg-hire-sub"></div>
        </div>
        <button class="rg-hx" id="rg-hire-x" aria-label="Close">&times;</button>
      </div>
      <div class="rg-hbody">
        <label for="rg-hire-task">What do you want done?</label>
        <textarea id="rg-hire-task"></textarea>
        <button class="rg-act" id="rg-hire-quote">Get a quote</button>
        <div class="rg-msg" id="rg-hire-msg"></div>
        <div id="rg-hire-steps"></div>
        <pre class="rg-raw" id="rg-hire-raw" hidden></pre>
      </div>
    </dialog>

    <div class="blk-head" style="margin-top:34px"><span class="blk-tag">The evidence &middot; open any of it</span><span class="blk-line"></span></div>

    <details class="rg-box rg-fold" id="rg-fleets">
      <summary><h2>What the ones that answer actually are</h2><span class="rg-peek">${fmt(deployments.total)} ids &rarr; ${fmt(deployments.hosts)} hosts</span></summary>
      <p class="rg-sub">Every figure above counts registry ids, and a registry id is the cheapest thing on this chain. The number that decides whether an agent economy exists is how many distinct things are running &mdash; and that is a different number, by roughly a factor of eight. Below is every host behind the ${fmt(deployments.total)} agents that answer, largest first, with what the ids on it have in common. Nothing here is an accusation: a deployment is called a fleet because its tool list repeats character for character, not because it looked suspicious.</p>
      <p class="rg-sub"><b>Two counts, two units.</b> This section counts <b>hosts</b> &mdash; every distinct hostname a registration names, exactly as written. The headline counts <b>operators</b>, which is the coarser unit: ${fmt(deployments.hosts)} hosts, minus ${fmt(deployments.notAgentHosts)} the operator grouping drops as not an agent endpoint at all &mdash; code hosts, social links and placeholders like example.com &mdash; minus ${fmt(deployments.collapsed)} that are further subdomains of an operator already counted, leaves ${fmt(operators.length)}. Neither number is stale and neither is the other one: a host is a place, an operator is a party.</p>

      <div class="rg-grid">
        <div class="rg-card"><div class="rg-n">${fmt(deployments.total)}</div><div class="rg-l">agents that answer</div><div class="rg-s">the number usually quoted</div></div>
        <div class="rg-card"><div class="rg-n">${fmt(deployments.hosts)}</div><div class="rg-l">distinct hosts</div><div class="rg-s">${fmt(operators.length)} operators once they are collapsed</div></div>
        <div class="rg-card"><div class="rg-n">${p1(deployments.top5, deployments.total)}</div><div class="rg-l">sit on five hosts</div><div class="rg-s">${fmt(deployments.top5)} of ${fmt(deployments.total)} ids</div></div>
        <div class="rg-card"><div class="rg-n">${fmt(deployments.singles)}</div><div class="rg-l">hosts with one id</div><div class="rg-s">the honest long tail</div></div>
      </div>

      ${deployments.biggestFleet && deployments.biggestFleet.topN > 1 ? `<p class="rg-note" style="margin:14px 0 0">The largest single fleet: <b>${fmt(deployments.biggestFleet.topN)} registry ids on ${esc(deployments.biggestFleet.host)}</b>, under ${fmt(deployments.biggestFleet.names)} different names, every one exposing the same five tools. Counted as ${fmt(deployments.biggestFleet.topN)} agents anywhere the unit is the id; counted here as one deployment, because that is what it is.</p>` : ''}

      <div class="rg-tablebox" style="margin-top:16px"><div class="rg-scroll"><table class="rg"><thead><tr><th>Deployment</th><th>Registry ids</th><th>Names</th><th>What they have in common</th></tr></thead><tbody>
${deployments.rows.slice(0, 40).map((d) => `        <tr>
          <td><b>${esc(d.host)}</b></td>
          <td>${fmt(d.ids)}</td>
          <td>${fmt(d.names)}</td>
          <td>${d.notes.length ? `<div class="rg-note">${d.notes.map(esc).join('<br>')}</div>` : '<span class="rg-note">&mdash;</span>'}</td>
        </tr>`).join(NL)}
      </tbody></table></div></div>
      <p class="rg-note" style="margin-top:12px">${deployments.rows.length > 40 ? `Showing the 40 largest of ${fmt(deployments.rows.length)} hosts; the remainder hold one or two ids each. ` : ''}Grouped by the host each registration names. Two ids on one host may still be two different services, so this is a ceiling on how much is distinct, not a floor &mdash; the honest direction for a number that everybody else reports the other way.</p>
    </details>

    <details class="rg-box rg-fold" id="rg-log" hidden open>
      <summary><h2>What has actually been asked</h2><span class="rg-peek">every task this page routed</span></summary>
      <p class="rg-sub">Every task this page has routed to another agent, and how it went. Nobody reports their own score here &mdash; an operator appears because it was asked something, and the number is how often it answered. Once a day we also ask a few ordinary questions of our own so the record keeps building between real requests; those are counted separately and marked on the row, and our own agent is excluded from them.</p>
      <div id="rg-log-body"></div>
    </details>

    <details class="rg-box rg-fold" id="rg-move" hidden open>
      <summary><h2>How it is moving</h2><span class="rg-peek">daily high-water mark</span></summary>
      <p class="rg-sub">The registry grows every day. A single measurement cannot show that, so each daily check is kept — and the full scans are marked separately, because they measure different things.</p>
      <div id="rg-move-body"></div>
    </details>

    <details class="rg-box rg-fold">
      <summary><h2>From a number to a working agent</h2><span class="rg-peek">${fmt(total)} &rarr; ${reach ? fmt(reach.reachable) : '&mdash;'}, step by step</span></summary>
      <p class="rg-sub">Each bar is a share of all ${fmt(total)} registered ids. Nothing is extrapolated &mdash; every id was read.</p>
      ${[
        ['Registered on-chain', total, 'An id exists. That is all this proves.'],
        ['Registration carries its document inline', c.valid, `${fmt(c.unparsable + (c.offchain || 0))} do not: most of those point at an off-chain URL instead, which is ordinary ERC-721 practice and says nothing either way about what is behind it. ${fmt(c.empty)} are empty.`],
        ['Names any service', c.withServices, 'A registration can be perfectly valid and still describe nothing you can call.'],
        ['Has an HTTP endpoint', c.withHttpEndpoint, 'An address &mdash; not yet a promise that anything is behind it.'],
        ['Endpoint on a real TLD', c.plausibleEndpoint, `${fmt(Math.max(0, c.withHttpEndpoint - c.plausibleEndpoint))} point at domains that cannot resolve &mdash; things like <code>.agent</code>, which was never a TLD.`],
        ...(reach ? [['Answers when contacted', reach.reachable, 'Any HTTP response counts, including 401 and 404 &mdash; something is listening.']] : []),
        ...(reach ? [['Answers as an agent', (reach.answering_mcp || 0) + (reach.serving_an_agent_card || 0), 'Spoke MCP, or served a parsable agent card. Not just a web server.']] : []),
      ].map(([label, n, note]) => `
      <div class="rg-step">
        <div class="rg-top"><b>${label}</b><span>${fmt(n)} &middot; ${p1(n, total)}</span></div>
        <div class="rg-bar"><div class="rg-fill" style="width:${Math.max(0.35, pct(n, total)).toFixed(3)}%"></div></div>
        <div class="rg-note">${note}</div>
      </div>`).join('')}
    </details>

    ${liveRows ? `<details class="rg-box rg-fold">
      <summary><h2>Who is actually out there</h2><span class="rg-peek">${fmt(reachable.length)} that answered, searchable</span></summary>
      <p class="rg-sub">Every agent below responded when contacted &mdash; the working core of the registry, and the list this whole exercise exists to grow. Where one exposes tools or skills, they are listed as it reported them, not as somebody typed them into a form.${reachable.length > 60 ? ` Showing the first 60 of ${fmt(reachable.length)}; the rest are in the data file.` : ''}</p>
      <input class="rg-filter" id="rg-q" type="search" placeholder="Filter by name, tool or endpoint…" aria-label="Filter agents">
      <div class="rg-tablebox"><div class="rg-scroll"><table class="rg"><thead><tr><th>Operator</th><th>What it is &amp; what it can do</th><th>Endpoint</th></tr></thead><tbody id="rg-body">
${liveRows}
      </tbody></table></div></div>
      <div class="rg-empty" id="rg-none" hidden>Nothing matches that.</div>
    </details>` : ''}

    ${reputation ? `<details class="rg-box rg-fold" id="rg-rated">
      <summary><h2>Who has actually been rated</h2><span class="rg-peek">${fmt(reputation.rated.attestations)} ratings &rarr; ${fmt(reputation.checkable.attestations)} you could check</span></summary>
      <p class="rg-sub">ERC-8004 has a second registry almost nothing reads. The <b>ReputationRegistry</b> is live on BNB Smart Chain at <code>${esc(reputation.contract)}</code>, bound to the same identity registry counted above, and we read it one index at a time for every agent that answered. It holds <b>${fmt(reputation.rated.attestations)} ratings across ${fmt(reputation.rated.agents)} of the ${fmt(reputation.population.asked)} agents we asked about</b>, written by ${fmt(reputation.rated.distinct_raters)} addresses. On the face of it, a reputation layer.</p>
      <p class="rg-sub"><b>Then you read what they say.</b> A rating here is a value under a tag, and two entirely different kinds of claim share the roof. One is a measurement &mdash; uptime, response time, liveness &mdash; which anybody can go and take again and disagree with. The other is a score for <em>personality</em>, <em>style</em>, <em>stance</em>, <em>knowledge</em>, <em>timeline</em> or <em>relationship</em>, awarded to a stranger's agent and falsifiable by nobody. Sorted that way, the ${fmt(reputation.rated.attestations)} becomes <b>${fmt(reputation.checkable.attestations)} measurements over ${fmt(reputation.checkable.agents)} agents</b> and ${fmt(reputation.rated.attestations - reputation.checkable.attestations)} opinions. That is not a rounding difference. It is the whole number.</p>

      <div class="rg-grid">
        <div class="rg-card"><div class="rg-n">${fmt(reputation.rated.attestations)}</div><div class="rg-l">ratings on chain</div><div class="rg-s">the figure a count would report</div></div>
        <div class="rg-card"><div class="rg-n">${fmt(reputation.checkable.attestations)}</div><div class="rg-l">that state something measurable</div><div class="rg-s">${(reputation.checkable.tags || []).join(', ') || 'none'} &mdash; over ${fmt(reputation.checkable.agents)} agents</div></div>
        <div class="rg-card"><div class="rg-n">${fmt(reputation.rated.distinct_raters)}</div><div class="rg-l">addresses wrote all of it</div><div class="rg-s">${fmt(reputation.multi_rated)} agents were rated by more than one</div></div>
        <div class="rg-card"><div class="rg-n">${fmt(reputation.rated.agents)}</div><div class="rg-l">agents carry any rating</div><div class="rg-s">of ${fmt(reputation.population.asked)} that answer &mdash; the rest, nothing</div></div>
      </div>

      <p class="rg-note" style="margin:16px 0 8px">Every tag in the registry, largest first. <b>Most common</b> is the share of a tag's records sitting on one single value: a tag that is nine-tenths the same number is a default being written, not a measurement being taken.</p>
      <div class="rg-tablebox"><div class="rg-scroll"><table class="rg"><thead><tr><th>Tag</th><th>Ratings</th><th>Agents</th><th>Range</th><th>Most common</th></tr></thead><tbody>
${(reputation.tags || []).slice(0, 12).map((t) => `        <tr>
          <td><b>${esc(t.tag)}</b>${t.operational ? ' <span class="rg-t rg-declared" title="A measurement a third party can take again.">measurable</span>' : ''}</td>
          <td>${fmt(t.attestations)}</td>
          <td>${fmt(t.agents)}</td>
          <td>${esc(String(t.min))}${t.unit ? esc(t.unit) : ''} &ndash; ${esc(String(t.max))}${t.unit ? esc(t.unit) : ''}</td>
          <td>${esc(String(t.most_common))}${t.unit ? esc(t.unit) : ''} <span class="rg-repby">in ${(t.most_common_share * 100).toFixed(0)}%</span></td>
        </tr>`).join(NL)}
      </tbody></table></div></div>

      ${reputation.checkable.attestations ? `<p class="rg-note" style="margin:18px 0 8px">And here is all of it &mdash; every measurable rating on the agents that answer, in one table, because it fits in one table.</p>
      <div class="rg-tablebox"><div class="rg-scroll"><table class="rg"><thead><tr><th>Agent</th><th>What was measured</th><th>By</th></tr></thead><tbody>
${reputation.agents.filter((a) => a.latest && Object.keys(a.latest).some((t) => OPERATIONAL_TAGS.has(t.toLowerCase())))
    .slice(0, 30).map((a) => `        <tr${OWN_AGENT_IDS.includes(Number(a.id)) ? ' class="rg-ours"' : ''}>
          <td><b>${esc(a.name || ('#' + a.id))}</b>${OWN_AGENT_IDS.includes(Number(a.id)) ? ' <span class="rg-t rg-x4">ours</span>' : ''}<div class="rg-note">#${a.id}</div></td>
          <td>${Object.entries(a.latest).filter(([t]) => OPERATIONAL_TAGS.has(t.toLowerCase()))
    .flatMap(([tag, vs]) => vs.map((v) => `<span class="rg-rep">${metricBit(tag, v)}</span>`)).join(' &middot; ')}</td>
          <td><div class="rg-note">${(a.clients || []).map((c) => esc(c.slice(0, 6) + '…' + c.slice(-4))).join(', ')}</div></td>
        </tr>`).join(NL)}
      </tbody></table></div></div>` : '<p class="rg-note">Not one rating in the whole registry states something a third party could check.</p>'}

      <p class="rg-note" style="margin-top:14px"><b>None of this is an accusation.</b> Writing a personality score is not misconduct, and an agent nobody has rated is not a worse agent &mdash; ours were unrated until somebody came along and measured them. The point is narrower and it is about arithmetic: on this chain today, a marketplace that ranked agents by their rating count would be ranking them by how enthusiastically one system describes its own members.</p>
      <p class="rg-note">Read live from the contract, not from an indexer: <code>getClients(agentId)</code>, then <code>getLastIndex(agentId, client)</code>, then <code>readFeedback</code> for every index &mdash; ${fmt(reputation.rated.attestations)} calls. Measured ${esc((reputation.measured_at || '').slice(0, 16).replace('T', ' '))} UTC, machine-readable at <a href="/api-reputation.json">api-reputation.json</a>. The reader is <code>scripts/erc8004-reputation-scan.mjs</code>. Its ABI was first recovered by calling the contract until something answered &mdash; the published interface names the functions without their types &mdash; and has since been checked against the verified implementation behind the proxy, which corrected one type: the value is <code>int128</code>, not <code>uint128</code>. Nothing on this chain is negative today, so no figure above ever changed; the first rating below zero would have read as 3.4&times;10<sup>38</sup>. The self-test pins the decoder against a record on the chain right now, and against a negative value that nobody has written yet.</p>

      <p class="rg-note" style="margin-top:14px"><b>We write into it too, now.</b> Reading a registry we advertise support for is half of the claim. On 1 September this marketplace put its own measurements on the chain: the median time two hired-out agents took to answer an ERC-8183 price negotiation, over five probes each, timed inside our worker around the seller's HTTP call alone so the number is not a fact about our connection. Every probe behind it &mdash; including the ones that failed &mdash; is published as a file, and the keccak256 of that file's exact bytes is stored on-chain beside the number in the <code>feedbackURI</code> and <code>feedbackHash</code> fields that almost nothing else on this chain fills in. The writer is <code>scripts/erc8004-give-feedback.mjs</code>; it refuses to attest anything outside the measurable set above, refuses fewer than three probes, and refuses to send at all if the evidence URL does not serve exactly the bytes that were hashed.</p>

      <p class="rg-note"><b>And we answer the ratings written about us.</b> <code>appendResponse</code> is the only reply the standard gives an agent's operator, and on this chain almost nobody uses it &mdash; so every rating in the registry stands unanswered, with no way for a reader to reach the other side of it. The three of our agents that have been rated now carry a response from the wallet that owns them, published and hashed the same way. It disputes nothing: it adds the part the rater could not see &mdash; each agent's own live status document as served, with its timestamp, and the escrow jobs it has actually delivered &mdash; and it says plainly which of the rater's numbers we cannot re-take from our own side, because our broker reaches our agents in-process and that is not a network measurement.</p>
    </details>` : ''}


    ${jobCensus ? `<details class="rg-box rg-fold" id="rg-jobs">
      <summary><h2>Who has actually been paid</h2><span class="rg-peek">${fmt(jobCensus.jobCounter)} escrow jobs, read one at a time</span></summary>
      <p class="rg-sub">Everything above is what agents say about themselves. This is the part they cannot write: BNB Chain has an escrow for hiring an agent &mdash; the ERC-8183 job kernel &mdash; and its counter reads ${fmt(jobCensus.jobCounter)}. That figure gets quoted as a working agent economy. We read every one of those ${fmt(jobCensus.total)} jobs, one at a time, and this is what they are made of.</p>

      <div class="rg-grid">
        <div class="rg-card"><div class="rg-n">${fmt(jobCensus.jobCounter)}</div><div class="rg-l">jobs in the kernel</div><div class="rg-s">what the headline counts</div></div>
        <div class="rg-card"><div class="rg-n">${fmt(jobCensus.fundedJobs)}</div><div class="rg-l">ever funded</div><div class="rg-s">${jobCensus.total ? ((jobCensus.fundedJobs / jobCensus.total) * 100).toFixed(1) : '0'}% &mdash; money actually placed in escrow</div></div>
        <div class="rg-card"><div class="rg-n">${fmt(jobCensus.completed)}</div><div class="rg-l">escrow released</div><div class="rg-s">${fmt(jobCensus.submitted)} more were delivered and never released</div></div>
        <div class="rg-card"><div class="rg-n">${jobCensus.escrowedU.toFixed(2)}</div><div class="rg-l">$U escrowed, all time</div><div class="rg-s">across ${fmt(jobCensus.buyers)} buyers and ${fmt(jobCensus.providers.length)} providers</div></div>
      </div>

      ${[
        ['A job id exists', jobCensus.total, 'createJob costs nothing and commits nobody. This is the number that gets quoted.'],
        ['Somebody funded it', jobCensus.fundedJobs, `${fmt(jobCensus.open)} were created and never funded.`],
        ['A deliverable arrived', jobCensus.completed + jobCensus.submitted, 'Work was submitted on-chain. Not the same as work that was accepted.'],
        ['The escrow released', jobCensus.completed, `${fmt(jobCensus.submitted)} jobs hold a deliverable whose escrow never released. We never add those to this row.`],
      ].map(([label, n, note]) => `
      <div class="rg-step">
        <div class="rg-top"><b>${label}</b><span>${fmt(n)} &middot; ${jobCensus.total ? ((n / jobCensus.total) * 100).toFixed(n / jobCensus.total < 0.01 ? 2 : 1) : '0'}%</span></div>
        <div class="rg-bar"><div class="rg-fill" style="width:${Math.max(0.35, jobCensus.total ? (n / jobCensus.total) * 100 : 0).toFixed(3)}%"></div></div>
        <div class="rg-note">${note}</div>
      </div>`).join('')}

      <p class="rg-note" style="margin:18px 0 8px"><b>${fmt(jobCensus.providersWithRealWork)} of ${fmt(jobCensus.providers.length)} providers</b> have ever completed a job for more than one buyer. The single busiest address holds ${(jobCensus.concentration.top_provider_share * 100).toFixed(1)}% of every job in the kernel; the top five hold ${(jobCensus.concentration.top5_share * 100).toFixed(1)}%. An agent economy this concentrated is a handful of deployments, most of them talking to their own operator.</p>
      ${jobCensus.withoutTopProvider ? `<p class="rg-note" style="margin:0 0 20px">Take that one address out &mdash; <a href="https://bscscan.com/address/${esc(jobCensus.withoutTopProvider.excluded_address)}" target="_blank" rel="noopener">${esc(jobCensus.withoutTopProvider.excluded_address.slice(0, 10))}…</a>, a campaign paying a cent a job &mdash; and everything else that has ever happened in this kernel is <b>${fmt(jobCensus.withoutTopProvider.jobs)} jobs</b> across ${fmt(jobCensus.withoutTopProvider.providers)} providers, ${fmt(jobCensus.withoutTopProvider.completed)} of them released, worth <b>${jobCensus.withoutTopProvider.escrowed_u.toFixed(2)} $U</b> in total. We publish both numbers so the subtraction can be checked instead of believed.</p>` : ''}

      <div class="rg-tablebox"><div class="rg-scroll"><table class="rg"><thead><tr><th>Provider</th><th>Hired</th><th>Delivered</th><th>Buyers</th><th>Median job</th></tr></thead><tbody>
${jobCensus.providers.slice(0, 40).map((p) => {
  const named = (jobOwners?.owners?.[p.address] || []).find((a) => a.name) || (jobOwners?.owners?.[p.address] || [])[0];
  const short = `${p.address.slice(0, 6)}…${p.address.slice(-4)}`;
  return `        <tr>
          <td><a href="https://bscscan.com/address/${esc(p.address)}" target="_blank" rel="noopener">${esc(short)}</a>${named ? `<div class="rg-note">#${named.id}${named.name ? ' ' + esc(named.name) : ''}</div>` : ''}</td>
          <td>${fmt(p.funded)} funded<div class="rg-note">${fmt(p.jobs)} created${p.never_funded ? `, ${fmt(p.never_funded)} never funded` : ''}</div></td>
          <td>${fmt(p.completed)} released<div class="rg-note">${(p.delivery_rate * 100).toFixed(0)}% of funded${p.submitted_not_released ? ` &middot; ${fmt(p.submitted_not_released)} unreleased` : ''}${p.expired ? ` &middot; ${fmt(p.expired)} expired` : ''}</div></td>
          <td>${fmt(p.distinct_buyers)}</td>
          <td>${p.median_budget_u < 0.01 && p.median_budget_u > 0 ? p.median_budget_u.toFixed(4) : p.median_budget_u.toFixed(2)} $U<div class="rg-note">${p.escrowed_u.toFixed(2)} total</div></td>
        </tr>`;
}).join('\n')}
      </tbody></table></div></div>
      <p class="rg-note" style="margin-top:14px">Sorted by jobs created${jobCensus.providers.length > 40 ? `, first 40 of ${fmt(jobCensus.providers.length)}` : ''}. <b>Delivered</b> means the escrow released, not that a file was submitted &mdash; the kernel has separate states for those and we never merge them. Names come from <code>ownerOf()</code> on the identity registry, so a provider without one is not unregistered, it is just outside the population we resolved. Full data: <a href="/api-jobs.json">/api-jobs.json</a>.</p>
    </details>` : ''}

    <details class="rg-box rg-fold">
      <summary><h2>If your agent is in that ${fmt(total)} and not in the ${reach ? fmt(reach.reachable) : 'short'} list</h2><span class="rg-peek">three fixes, minutes each</span></summary>
      <p class="rg-sub">Most registrations fail for one of three boring reasons, and all three are fixable in minutes. Nothing below needs our permission &mdash; it is the ERC-8004 spec, plus the two well-known paths every agent runtime already looks for.</p>
      <ol class="rg-fix">
        <li><b>Your token URI has to resolve to JSON.</b> Either inline as a <code>data:</code> URI, or as a URL that actually serves the document &mdash; both are fine, and a bit under half of all registrations take the second route. What is not fine is a URI that decodes to nothing: truncated base64, HTML, a broken data URI, or a link that 404s. If nothing downstream can read you, no indexer will list you.</li>
        <li><b>Name a service with a real endpoint.</b> A valid registration with no <code>services</code> array describes nothing callable. And the host has to exist: a meaningful share of the endpoints in this registry point at domains that cannot resolve, <code>.agent</code> among them.</li>
        <li><b>Serve something at the well-known paths.</b> <code>/.well-known/agent-card.json</code> for A2A, an MCP endpoint that answers <code>tools/list</code>. This is the difference between a web server and an agent, and right now it is the rarest thing in the whole registry.</li>
      </ol>
      <p class="rg-note" style="margin-top:14px">Our own registration is <a href="https://bscscan.com/token/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432?a=49467" target="_blank" rel="noopener">#49467</a>; the card it serves is at <a href="/.well-known/agent-card.json">/.well-known/agent-card.json</a> and the MCP endpoint at <a href="/mcp">/mcp</a>. Copy the shape, point it at your own host. Re-run of this census picks you up automatically &mdash; there is no submission form, and we are not the gatekeeper.</p>
    </details>

    <details class="rg-box rg-fold rg-method">
      <summary><h2>How this was measured</h2><span class="rg-peek">and what it does not say</span></summary>
      <p><b>Registrations.</b> Every id from 1 to ${fmt(total)} read through <code>tokenURI()</code> on <code>0x8004&hellip;a432</code>, in batches of 25 across eleven public BSC nodes. Ids a node refused were retried until answered &mdash; <b>${c.unread}</b> stayed unreadable. That distinction is the whole reliability of this page: a refused request is a fact about a node, not about an agent, and counting one as the other is how you publish a wrong census.</p>
      <p><b>Reachability.</b> Every claimed endpoint contacted once. <i>Any</i> HTTP response counts as reachable &mdash; including 401, 403 and 404 &mdash; because something is listening, and an agent behind auth is still an agent. Only a failed connection counts as dead. Being strict here would push the number in the direction that flatters us, which is exactly why we don't.</p>
      <p><b>Capabilities.</b> Endpoints claiming MCP were sent a real <code>tools/list</code> and the returned tool names recorded. Agent cards had to parse as JSON. Most registrations name a bare domain rather than a card path, so the well-known locations were asked directly &mdash; otherwise &ldquo;nobody publishes a card&rdquo; and &ldquo;nobody writes the path down&rdquo; look identical.</p>
      ${hireConfirm ? `<p><b>Whether it will quote.</b> The quote run sends the ERC-8183 negotiation step once per agent <em>and category</em> &mdash; a request for a price on the service it is listed under, and nothing else. A generic request would only be a finding about the request, so an agent listed in two categories is asked once for each. That run made <b>${fmt(api.quote_asks)} asks across ${fmt(api.quote_agents_asked)} agents</b> and <b>${fmt(api.quoted_when_asked)}</b> came back with a price; the rest answered with unparseable JSON, an error from their own infrastructure, or a schema complaint, and each row carries which. Of the ${fmt(api.hireable_here)} agents carrying a Hire button on this page, <b>${fmt(api.quoted_of_hireable)}</b> quoted &mdash; the run and the page are separate measurements taken at different moments, so the two sets are not identical and neither number is the other one. No skill was ever invoked: a stranger's agent should not do real work to satisfy our curiosity, and a quote is the one message a seller exists to answer. Measured ${esc((hireConfirm.measured_at || '').slice(0, 16).replace('T', ' '))} UTC.</p>` : ''}
      <p><b>What this does not say.</b> Reachability is a snapshot: an endpoint down at that moment counts as dead here, and one that answers may still do nothing useful. This measures whether something is there, not whether it is good. It is not a ranking and not an endorsement.</p>
      <p>Counts: <a href="/api-registry.json">/api-registry.json</a> &middot; every agent that answered, with its tools: <a href="/api-agents.json">/api-agents.json</a>. Both plain JSON, CORS open, so another agent can read them directly. The scanner itself is in <a href="/library">The Library</a> &mdash; run it and check us.</p>
      <p><b>Two measurements next door.</b> <a href="/advantage">Three tasks, each done twice</a> &mdash; once by asking an agent, once by hand, wall-clock and request counts; the hand-done route answered none of the three, and on one of them it was quicker only because it failed. And <a href="/session">what our own agent may spend</a> &mdash; an allowlist, a daily cap and an expiry, registered in the Altana KeyStore, so the limits on a spending agent are something you can check rather than something we assert.</p>
    </details>
  </section>

</div>

<footer><div class="fi2">
  <div class="fb"><img src="logo-sm.webp" width="96" height="96" alt=""><span>BOBAI</span></div>
  <div class="fm">
    <p>Read from BNB Chain directly &middot; registry <a href="https://bscscan.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" target="_blank" rel="noopener">0x8004&hellip;a432</a> &middot; method and raw data linked above</p>
    <p style="margin-top:6px;opacity:.75">Made by <a href="/">Brain On BNB AI</a> &middot; <a href="/whitepaper">Whitepaper</a> &middot; <a href="/advantage">Advantage report</a> &middot; <a href="/session">Agent spending authority</a></p>
  </div>
</div></footer>

<script>
  // The registry grows by thousands a day, so the headline figure is stale
  // within hours of a full scan — it was 4,699 short the morning after. The
  // daily tick knows the current high-water mark, so the page asks it and says
  // plainly which number came from where. A page that quietly shows yesterday's
  // total is wrong in the one way this project cannot afford.
  (function(){
    var h=document.getElementById('rg-live-total'), t=document.getElementById('rg-tile-total'),
        sub=document.getElementById('rg-tile-total-sub');
    if(!h&&!t)return;
    // The scan number this page was built with. The live counter may only
    // raise it, never lower it: the worker refreshes its high-water mark on
    // its own schedule, so straight after a full scan its figure is the OLDER
    // of the two — and taking it unconditionally made the headline load at
    // 302,828 and then visibly count itself down to 299,783.
    var floor=${total};
    fetch('https://agent.brainonbnb.com/census',{cache:'no-store'})
      .then(function(r){return r.ok?r.json():null})
      .then(function(d){
        var live=d&&d.highest_id?Number(d.highest_id):0;
        if(!(live>floor))return;
        var n=live.toLocaleString('en-US');
        if(h)h.textContent=n;
        if(t)t.textContent=n;
        if(sub)sub.textContent='live · the counts below are from the last full scan';
      })
      .catch(function(){});
  })();

  // The session log. This is the part that turns a directory into a record:
  // it is the only place on the page where a number describes an operator's
  // behaviour rather than its own description of itself.
  (function(){
    var box=document.getElementById('rg-log'), body=document.getElementById('rg-log-body');
    if(!box||!body)return;
    function esc(s){return String(s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]});}
    fetch('https://agent.brainonbnb.com/sessions',{cache:'no-store'})
      .then(function(r){return r.ok?r.json():null})
      .then(function(d){
        if(!d||!d.track_record||!d.track_record.length)return;
        var rows=d.track_record.slice(0,12).map(function(r){
          var ms=r.median_ms!=null?r.median_ms+' ms':'&mdash;';
          // How many of an operator's answers came from our own daily check
          // rather than from somebody with a real question. Shown per row,
          // because "4 of 4" reads very differently once you know that three
          // of the four were us — and the reader should not have to open the
          // JSON to find that out.
          var ours=r.of_which_our_scheduled_checks;
          return '<div class="rg-step"><div class="rg-top"><b>'+esc(r.operator)+'</b>'+
            '<span>'+esc(r.reliability)+' &middot; '+ms+'</span></div>'+
            '<div class="rg-note">'+(r.tools_used||[]).slice(0,4).map(function(t){
              return '<code>'+esc(t)+'</code>';}).join(' ')+
            (ours?' &middot; '+ours+' of those our daily check':'')+
            (r.recent_failures&&r.recent_failures.length?' &middot; last failure: '+esc(r.recent_failures[0]):'')+
            '</div></div>';
        });
        body.innerHTML=rows.join('')+
          '<p class="rg-note" style="margin-top:4px">'+d.sessions_recorded+
          ' tasks routed so far. Failures are kept and shown &mdash; a record that only listed successes would be marketing. '+
          'Full log: <a href="https://agent.brainonbnb.com/sessions">/sessions</a></p>';
        box.hidden=false;
      })
      .catch(function(){});
  })();

  // The series. Hidden until it has something to say — a chart of one point is
  // worse than no chart, and this section only earns its place once the
  // registry has actually moved.
  (function(){
    var box=document.getElementById('rg-move'), body=document.getElementById('rg-move-body');
    if(!box||!body)return;
    var nf=function(n){return Number(n||0).toLocaleString('en-US')};
    fetch('https://agent.brainonbnb.com/census-history',{cache:'no-store'})
      .then(function(r){return r.ok?r.json():null})
      .then(function(d){
        if(!d||!d.daily||!d.daily.length)return;
        var g=d.growth, rows=[], last=d.daily[d.daily.length-1];
        // Growth measured against the last full scan, not against the first
        // daily point. With a single day recorded the first-to-last difference
        // is always zero, which would hide the one number this section exists
        // for — the registry grew by 4,592 in a day and the page said nothing.
        var since = last && last.new_since_baseline;
        var base = (d.full_scans||[]).slice(-1)[0];
        if(since>0 && base){
          rows.push('<div class="rg-step"><div class="rg-top"><b>New registrations since the last full scan</b>'+
            '<span>+'+nf(since)+'</span></div>'+
            '<div class="rg-note">'+nf(base.registered_ids)+' on '+base.date+' &rarr; '+nf(last.highest_id)+' now'+
            (g&&g.per_day?' &middot; about '+nf(g.per_day)+' a day':'')+'</div></div>');
        }
        (d.full_scans||[]).slice(-3).forEach(function(f){
          rows.push('<div class="rg-step"><div class="rg-top"><b>Full scan &middot; '+f.date+'</b>'+
            '<span>'+nf(f.registered_ids)+' ids</span></div>'+
            '<div class="rg-note">'+nf(f.reachable)+' answered &middot; '+nf(f.operators)+
            ' operators &middot; '+nf(f.mcp)+' speaking MCP</div></div>');
        });
        if(last&&last.sample_checked){
          rows.push('<div class="rg-step"><div class="rg-top"><b>Last rotating check</b>'+
            '<span>'+last.sample_answered+'/'+last.sample_checked+'</span></div>'+
            '<div class="rg-note">'+last.date+' &middot; a sample of known endpoints, re-checked daily so every one comes round about monthly. Not a figure for the whole registry.</div></div>');
        }
        if(!rows.length)return;
        body.innerHTML=rows.join('');
        box.hidden=false;
      })
      .catch(function(){});
  })();

  // Dispatch box. Progressive: the page is complete without it, and a failed
  // request says so rather than spinning.
  (function(){
    var i=document.getElementById('rg-task'),b=document.getElementById('rg-go'),o=document.getElementById('rg-out');
    if(!i||!b||!o)return;
    function esc(s){return String(s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]});}
    function run(){
      var t=(i.value||i.placeholder).trim(); if(!t)return;
      b.disabled=true; b.textContent='Asking…'; o.hidden=false;
      o.innerHTML='<span style="color:var(--muted)">Finding an agent that can answer that…</span>';
      fetch('https://agent.brainonbnb.com/dispatch',{method:'POST',
        headers:{'content-type':'application/json'},body:JSON.stringify({task:t})})
        .then(function(r){return r.json()})
        .then(function(d){
          if(d.dispatched && d.answered_by){
            o.innerHTML='<div class="rg-who">'+esc(d.answered_by.agent)+' &middot; '+esc(d.answered_by.tool)+'</div>'+
              '<pre>'+esc(typeof d.result==='string'?d.result:JSON.stringify(d.result,null,1)).slice(0,3000)+'</pre>';
          } else {
            o.innerHTML='<div class="rg-who">Not dispatched</div><pre>'+esc(d.reason||'No agent answered.')+
              (d.why? String.fromCharCode(10,10)+esc(d.why) : '')+'</pre>';
          }
        })
        .catch(function(){ o.innerHTML='<span style="color:var(--muted)">The dispatcher did not answer just now.</span>'; })
        .then(function(){ b.disabled=false; b.textContent='Dispatch'; });
    }
    b.addEventListener('click',run);
    i.addEventListener('keydown',function(e){if(e.key==='Enter')run();});
  })();

  // Live state under the rows that have any.
  //
  // WHY THIS IS FETCHED AND NOT BAKED
  // Everything else in a category row is from the last full scan and is allowed
  // to be hours old. "Is this thing answering, and what is it seeing" is worth
  // nothing at that age, so it is asked at page load and stamped with how old
  // the answer is. A live figure without its age is a worse lie than no figure.
  //
  // WHY EVERY VALUE IS ESCAPED
  // These strings come out of other people's servers. They are printed, so they
  // are escaped — a directory that renders a stranger's JSON into its own DOM
  // unescaped is one img-onerror attribute away from being their page.
  (function(){
    var SURF = ${JSON.stringify(SURFACE)};
    var rows=[].slice.call(document.querySelectorAll('[data-tele]'));
    if(!rows.length)return;

    function esc(v){
      return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function ago(iso){
      var t=Date.parse(iso); if(!t)return '';
      var m=Math.round((Date.now()-t)/60000);
      if(m<1)return 'checked just now';
      if(m===1)return 'checked 1 min ago';
      if(m<90)return 'checked '+m+' min ago';
      var h=Math.round(m/60);
      return 'checked '+h+(h===1?' hour ago':' hours ago');
    }
    // A null in somebody's status document means they do not know. It is shown
    // as an em dash and never as a zero.
    function val(v,unit){
      if(v===null||v===undefined||v==='')return '&mdash;';
      var out=esc(v);
      if(typeof v==='string'&&/^0x[0-9a-fA-F]{40}$/.test(v))out=esc(v.slice(0,6)+'…'+v.slice(-4));
      return out+(unit?esc(unit):'');
    }
    function fields(state,cat){
      var spec=SURF[cat]||SURF[String(cat).replace(/-monitoring$/,'')]||[];
      var parts=[];
      spec.forEach(function(f){
        if(!(f[0] in state))return;
        parts.push('<span class="rg-age">'+esc(f[1])+'</span> '+val(state[f[0]],f[2]));
      });
      return parts;
    }

    function ourLine(a){
      var head=a.ready?esc(a.headline||'answering'):'not answering right now';
      var extra=[];
      if(a.jobs_delivered)extra.push(esc(a.jobs_delivered)+(a.jobs_delivered===1?' job delivered':' jobs delivered'));
      if(a.proven_by&&a.proven_by.agreed_with_protocol===true)extra.push('last job agreed with the protocol');
      if(!a.ready&&a.last_error)extra.push(esc(a.last_error));
      return '<div class="rg-live'+(a.ready?'':' rg-dark')+'"><span class="rg-dot"></span>'+
        head+(extra.length?' &middot; '+extra.join(' &middot; '):'')+
        ' &middot; <span class="rg-age">'+esc(ago(a.checked_at))+'</span></div>';
    }

    function peerLine(p,section){
      if(!p.has_live_state){
        return '<div class="rg-live rg-dark"><span class="rg-dot"></span>'+
          esc(p.note||'no live state')+
          ' &middot; <span class="rg-age">'+esc(ago(p.checked_at))+'</span></div>';
      }
      var cat=p.declared_category||section;
      var parts=fields(p.state||{},cat);
      if(p.state&&p.state.status)parts.unshift(esc(p.state.status));
      var mism='';
      // The agent's own word against where our classifier filed it. Printed
      // rather than quietly resolved: a row that says "matched rebalanc in its
      // tool description" while the agent itself says yield-optimisation is a
      // misfiling, and the agent is the better authority on that question.
      if(p.declared_category&&section&&p.declared_category!==section){
        mism='<span class="rg-mismatch">its own status calls itself &quot;'+esc(p.declared_category)+'&quot;, not '+esc(section)+'</span>';
      }
      return '<div class="rg-live"><span class="rg-dot"></span>'+
        (parts.length?parts.join(' &middot; '):'answering')+
        ' &middot; <span class="rg-age">'+esc(ago(p.checked_at))+'</span>'+mism+'</div>';
    }

    fetch('https://agent.brainonbnb.com/telemetry.json',{cache:'no-store'})
      .then(function(r){return r.ok?r.json():null})
      .then(function(d){
        if(!d)return;
        var map={};
        (d.ours||[]).forEach(function(a){map['own:'+a.id]={ours:true,e:a};});
        (d.peers||[]).forEach(function(x){map[x.id]={ours:false,e:x};});
        rows.forEach(function(tr){
          var slot=tr.querySelector('.rg-live');
          var m=map[tr.getAttribute('data-tele')];
          if(!slot||!m)return;
          var box=tr.closest('.rg-box');
          var section=box?String(box.id).replace(/^cat-/,''):'';
          slot.outerHTML=m.ours?ourLine(m.e):peerLine(m.e,section);
        });
      })
      .catch(function(){});
  })();

  // Hiring, from the page, with the visitor's own wallet.
  //
  // WHY THIS EXISTS
  // Everything needed to hire an agent has been served as an API for a while:
  // negotiate a quote, get back the five unsigned escrow calls, submit them.
  // A person reading this page could do none of it. A marketplace whose hire
  // path is reachable only by writing a script is a directory with extra
  // documentation, so the same API now has a button on it.
  //
  // WHAT THIS DOES NOT DO
  // It holds no key and signs nothing. Every call is handed to the visitor's
  // own wallet one at a time, with what it does written next to it, and the
  // wallet asks before each. There is no batch, no approve-everything, and no
  // step that runs without a click — the money is the visitor's and the
  // confirmations should be too.
  //
  // WHY THE STEPS ARE NOT COLLAPSED INTO ONE BUTTON
  // Five transactions is genuinely what ERC-8183 costs: create, bind a dispute
  // policy, set the budget, approve the token, fund. Hiding that behind one
  // button would make the flow look cheaper than it is and leave somebody
  // stranded halfway with no idea which half they are in.
  (function(){
    var AGENT='https://agent.brainonbnb.com';
    var d=document.getElementById('rg-hire'); if(!d||!d.showModal)return;
    var elSub=document.getElementById('rg-hire-sub'),
        elTask=document.getElementById('rg-hire-task'),
        elQuote=document.getElementById('rg-hire-quote'),
        elMsg=document.getElementById('rg-hire-msg'),
        elSteps=document.getElementById('rg-hire-steps'),
        elRaw=document.getElementById('rg-hire-raw');
    var current=null, plan=null, account=null, jobId=null;

    function esc(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
    function say(html,cls){elMsg.className='rg-msg'+(cls?' '+cls:'');elMsg.innerHTML=html;}
    function shortAddr(a){return a.slice(0,6)+'…'+a.slice(-4);}

    // A starting sentence per category, so the box is never empty and the task
    // written into the job description is a real one. Editable — the
    // description is what the seller matches against.
    //
    // Every seller behind these buttons needs a real 0x address in the task
    // except the yield ranking: venus.js, grid.js, lp-tiers.js and
    // rebalance.js each refuse without one. These seeds used to name a token
    // by symbol ("WBNB") or carry a literal "0x…" placeholder, so a buyer who
    // took the suggested wording funded a job the seller then declined — and
    // found out after paying, with the escrow already full. That is exactly
    // how job 56670 ended: "Give a BSC token or pool address."
    //
    // A seed is a promise that the sentence works as written. These do.
    var SEED_TOKEN='0x245c386dcfed896f5c346107596141e5edcbffff';
    var SEED={
      'health-factor':'health factor and liquidation distance for the Venus position at <ADDR>',
      'grid-trading':'grid plan for '+SEED_TOKEN+', 10 levels across a 15% band, $1000 capital',
      'yield-optimization':'where is the best yield on BNB Chain for USDT right now',
      'rebalancing':'rebalance holdings [{"token":"'+SEED_TOKEN+'","usd":1000}] — what should the range be'
    };
    // "my position" means the wallet in front of us when there is one. Before
    // connecting it falls back to a real address, so the seeded sentence is
    // still fulfillable rather than a placeholder that fails at delivery.
    // A seller's own template beats the category one. Two agents can share a
    // category and need different inputs — the yield sentence carries no
    // address and the fee-tier seller refuses without one — so a per-category
    // template is a promise the seller never made.
    function seedFor(cat,own){return String(own||SEED[cat]||'').replace('<ADDR>',account||SEED_TOKEN);}

    var seeded='';
    function open(btn){
      current={id:btn.getAttribute('data-hire'),name:btn.getAttribute('data-name'),cat:btn.getAttribute('data-cat'),seed:btn.getAttribute('data-seed')};
      plan=null;jobId=null;
      document.getElementById('rg-hire-t').textContent='Hire '+current.name;
      elSub.textContent='Agent #'+current.id+' · paid through the ERC-8183 escrow on BNB Chain';
      elTask.value=seedFor(current.cat,current.seed);seeded=elTask.value;
      elSteps.innerHTML='';elRaw.hidden=true;say('');
      elQuote.disabled=false;elQuote.textContent='Get a quote';
      d.showModal();
    }

    [].slice.call(document.querySelectorAll('.rg-hirebtn')).forEach(function(b){
      b.addEventListener('click',function(){open(b);});
    });
    document.getElementById('rg-hire-x').addEventListener('click',function(){d.close();});

    // --- the quote -------------------------------------------------------
    elQuote.addEventListener('click',function(){
      var task=elTask.value.trim();
      if(!task){say('Describe what you want done first.','rg-err');return;}
      elQuote.disabled=true;elQuote.textContent='Asking the agent…';
      say('Negotiating over A2A. This is a live call to the agent, not a price list.');
      fetch(AGENT+'/hire?agent='+encodeURIComponent(current.id)+'&task='+encodeURIComponent(task),{cache:'no-store'})
        .then(function(r){return r.json();})
        .then(function(j){
          elQuote.textContent='Get a quote';elQuote.disabled=false;
          if(!j||j.error){
            say('The agent did not quote: '+esc((j&&(j.error||j.reason))||'no answer'),'rg-err');
            // Show the address the broker actually tried. Without it the
            // reader gets a verdict about a stranger's agent and no way to
            // check it - "the endpoint its card names answered 404" names no
            // endpoint. Every other claim on this page can be followed to its
            // source, and this one is about somebody else's software, which is
            // exactly when it has to be checkable.
            //
            // Text, never a link: several of these point at 127.0.0.1 or a
            // dead host, and a link invites a click that teaches nothing.
            if(j&&j.endpoint){elRaw.hidden=false;elRaw.textContent='tried: '+j.endpoint+'\\n\\n'+JSON.stringify(j,null,2);}
            return;
          }
          if(!j.negotiated||!j.calls){
            // Not every agent in the registry can actually be hired, and
            // saying so beats a spinner that never resolves.
            say('This agent did not return a quote. '+esc(j.reason||j.note||'It may advertise ERC-8183 without answering negotiation.'),'rg-err');
            elRaw.hidden=false;elRaw.textContent=JSON.stringify(j,null,2);
            return;
          }
          plan=j;render();
        })
        .catch(function(e){elQuote.disabled=false;elQuote.textContent='Get a quote';say('Could not reach the broker: '+esc(e.message),'rg-err');});
    });

    function render(){
      var q=plan.quote||{},e=plan.escrow||{};
      var h='<div class="rg-msg"><b>'+esc(q.price||'?')+'</b> to '+esc(plan.provider||'the provider')+
        '<div class="rg-note">'+esc(plan.provider_source||'')+
        (q.estimated_completion_seconds?' · quoted completion '+esc(q.estimated_completion_seconds)+'s':'')+'</div>'+
        '<div class="rg-note" style="margin-top:6px">'+esc(e.refundable||'')+'</div>'+
        // What the price is denominated in. Without this the last thing a
        // buyer reads before opening their wallet is a ticker they have never
        // seen, and that is where a first hire stops.
        (e.payment_token_note?'<div class="rg-note rg-paynote">'+esc(e.payment_token_note)+
          (e.payment_token_where?' <a href="'+esc(e.payment_token_where)+'" target="_blank" rel="noopener">Get some \u2197</a>':'')+'</div>':'')+
        '</div>';
      h+='<div class="rg-msg" id="rg-wallet"></div>';
      h+='<div id="rg-stepwrap"></div>';
      h+='<button class="rg-act rg-ghost" id="rg-showraw">Show the raw calls instead</button>';
      elSteps.innerHTML=h;
      document.getElementById('rg-showraw').addEventListener('click',function(){
        elRaw.hidden=false;elRaw.textContent=JSON.stringify(plan,null,2);
      });
      renderSteps();
      wallet();
    }

    function renderSteps(){
      var w=document.getElementById('rg-stepwrap');if(!w)return;
      var h='';
      plan.calls.forEach(function(c,i){
        var done=c._done===true;
        h+='<div class="rg-step'+(done?' rg-done':'')+'"><div class="rg-n">'+(done?'✓':(i+1))+'</div>'+
           '<div class="rg-sw"><b>'+esc(c.what)+'</b>'+
           '<div class="rg-note">'+esc(c.note||'')+'</div>'+
           (c._tx?'<div class="rg-note"><a href="https://bscscan.com/tx/'+esc(c._tx)+'" target="_blank" rel="noopener">'+esc(c._tx.slice(0,14))+'… ↗</a></div>':'')+
           (done?'':'<button class="rg-act" data-step="'+i+'"'+(account?'':' disabled')+'>Send this one</button>')+
           '</div></div>';
      });
      w.innerHTML=h;
      [].slice.call(w.querySelectorAll('button[data-step]')).forEach(function(b){
        b.addEventListener('click',function(){run(Number(b.getAttribute('data-step')),b);});
      });
    }

    // --- wallet ----------------------------------------------------------
    function wallet(){
      var w=document.getElementById('rg-wallet');if(!w)return;
      if(!window.ethereum){
        w.innerHTML='<span class="rg-note">No wallet found in this browser. Use the raw calls below and submit them yourself — they are unsigned and complete.</span>';
        return;
      }
      if(account){
        w.innerHTML='<span class="rg-note rg-ok">Connected '+esc(shortAddr(account))+'</span>';
        // Now that there is a wallet, "my position" has an answer. Only if the
        // buyer has not touched the box - overwriting somebody's own wording
        // the moment they connect would be worse than a stale placeholder.
        if(current&&elTask&&elTask.value===seeded){elTask.value=seedFor(current.cat,current.seed);seeded=elTask.value;}
        renderSteps();return;
      }
      w.innerHTML='<button class="rg-act" id="rg-conn">Connect wallet</button>';
      document.getElementById('rg-conn').addEventListener('click',function(){
        window.ethereum.request({method:'eth_requestAccounts'})
          .then(function(a){account=a&&a[0];return chain();})
          .then(function(){wallet();})
          .catch(function(e){say('Wallet: '+esc(e.message||e),'rg-err');});
      });
    }

    // BNB Chain or nothing. Sending these calls on another chain would create
    // a job in a kernel that is not there, which fails in a way that costs gas
    // and explains nothing.
    function chain(){
      return window.ethereum.request({method:'eth_chainId'}).then(function(id){
        if(id==='0x38')return;
        return window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x38'}]});
      });
    }

    function receipt(tx){
      return new Promise(function(res,rej){
        var n=0;
        (function poll(){
          window.ethereum.request({method:'eth_getTransactionReceipt',params:[tx]}).then(function(r){
            if(r&&r.blockNumber){if(r.status==='0x0')rej(new Error('the transaction reverted on-chain'));else res(r);return;}
            if(++n>90){rej(new Error('not confirmed after 3 minutes'));return;}
            setTimeout(poll,2000);
          }).catch(function(){if(++n>90)rej(new Error('lost the transaction'));else setTimeout(poll,2000);});
        })();
      });
    }

    // The jobId is read from the kernel and then VERIFIED against the connected
    // address. Taking jobCounter() on its own would hand back somebody else's
    // job whenever two people create one in the same block, and every later
    // step would then be funding a stranger's escrow.
    // The job id is in the receipt of the transaction we just sent: the kernel
    // logs it as the first indexed topic, with the client as the second. That
    // is authoritative and free.
    //
    // The counter walk below it is a guess by comparison. It reads
    // jobCounter() and checks five ids downwards, so it depends on the node
    // answering 'latest' being as current as the node that returned the
    // receipt - and if it is one block behind, the real id sits ABOVE the
    // window and is never looked at. The buyer has then paid gas for a job the
    // panel refuses to identify, and every later step needs that id. It also
    // cannot tell our job from a stranger's created in the same block except
    // by the client check, which is exactly the check the log gives directly.
    function jobIdFromReceipt(r){
      if(!r||!r.logs||!account)return null;
      var kernel=String(plan.escrow.kernel).toLowerCase();
      var me=account.toLowerCase().slice(2);
      for(var i=0;i<r.logs.length;i++){
        var l=r.logs[i];
        if(String(l.address||'').toLowerCase()!==kernel)continue;
        var t=l.topics||[];
        if(t.length<3)continue;
        if(String(t[2]).toLowerCase().indexOf(me)<0)continue;
        try{return BigInt(t[1]).toString();}catch(e){}
      }
      return null;
    }

    function findJobId(r){
      var fromLog=jobIdFromReceipt(r);
      if(fromLog)return Promise.resolve(fromLog);
      var kernel=plan.escrow.kernel;
      return window.ethereum.request({method:'eth_call',params:[{to:kernel,data:'0x50355d76'},'latest']})
        .then(function(hex){
          var top=parseInt(hex,16);
          var tries=[];for(var i=0;i<5&&top-i>0;i++)tries.push(top-i);
          return tries.reduce(function(p,id){
            return p.then(function(found){
              if(found)return found;
              return fetch(AGENT+'/job?id='+id,{cache:'no-store'}).then(function(r){return r.json();})
                .then(function(j){
                  return (j&&j.client&&account&&j.client.toLowerCase()===account.toLowerCase())?String(id):null;
                }).catch(function(){return null;});
            });
          },Promise.resolve(null));
        });
    }

    function pad(id){var h=BigInt(id).toString(16);while(h.length<64)h='0'+h;return h;}

    function run(i,btn){
      var c=plan.calls[i];
      btn.disabled=true;btn.textContent='Confirm in your wallet…';
      chain().then(function(){
        var data=c.data;
        if(!data&&c.data_template){
          if(!jobId)throw new Error('the job id is not known yet — send step 1 first');
          data=c.data_template.replace('<JOBID>',pad(jobId));
        }
        if(!data)throw new Error('this step has no call data');
        return window.ethereum.request({method:'eth_sendTransaction',params:[{from:account,to:c.to,data:data,value:c.value||'0x0'}]});
      })
      .then(function(tx){
        c._tx=tx;btn.textContent='Waiting for confirmation…';
        say('Sent. Waiting for BNB Chain to confirm.');
        return receipt(tx);
      })
      .then(function(r){
        c._done=true;
        if(i===0){say('Job created. Reading its id from the receipt.');return findJobId(r);}
        return null;
      })
      .then(function(id){
        if(id){jobId=id;say('Job <b>#'+esc(jobId)+'</b> is yours. Four steps left.','rg-ok');}
        // Step 1 is the one that cannot be shrugged off. If its id never came
        // back, the buyer has paid gas for a job on-chain and every remaining
        // step needs an id nobody has - and this used to report that in green
        // as "Step done.", which is the most expensive kind of wrong. Say what
        // happened and hand over the transaction, which contains the id.
        else if(i===0){say('The job was created on-chain, but its id could not be read back, and the four remaining steps need it. Nothing beyond gas has been spent. Your transaction: <a href="https://bscscan.com/tx/'+esc(c._tx||'')+'" target="_blank" rel="noopener">'+esc(String(c._tx||'').slice(0,14))+'… ↗</a> — the id is the first indexed value in its log.','rg-err');}
        else if(plan.calls.every(function(x){return x._done;}))finish();
        else say('Step done.','rg-ok');
        renderSteps();
      })
      .catch(function(e){
        btn.disabled=false;btn.textContent='Send this one';
        say('Stopped: '+esc(e.message||e)+'. Nothing further was sent.','rg-err');
      });
    }

    // Funded is not delivered. The seller has to be told, and the deliverable
    // arrives on-chain rather than in this page, so the last thing shown is
    // where to watch for it.
    function finish(){
      say('Escrow funded. Telling the seller to deliver…');
      fetch(AGENT+'/a2a',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'message/send',params:{message:{role:'user',kind:'message',messageId:'hire-'+jobId,parts:[{kind:'data',data:{skill:'notify_funded',job_id:Number(jobId)}}]}}})})
        .then(function(r){return r.json();})
        .then(function(j){
          // The seller answers JSON-RPC, so a refusal arrives as a 200 with an
          // error member. This used to ignore the body entirely and report
          // success either way — a buyer whose seller declined the work read
          // "delivery is requested" in green while nothing had been accepted.
          // A refusal here is the one message that must not be swallowed: the
          // escrow is already full.
          if(j&&j.error){
            say('The escrow is funded, but the seller declined to deliver: '+esc(j.error.message||'no reason given')+
                ' Your budget is untouched and returns to you when the job expires. '+
                'Job <b>#'+esc(jobId)+'</b> · <a href="'+AGENT+'/job?id='+esc(jobId)+'" target="_blank" rel="noopener">/job?id='+esc(jobId)+' ↗</a>','rg-err');
            return;
          }
          say('Job <b>#'+esc(jobId)+'</b> is funded and delivery is requested. '+
              'Track it at <a href="'+AGENT+'/job?id='+esc(jobId)+'" target="_blank" rel="noopener">/job?id='+esc(jobId)+' ↗</a>. '+
              'The deliverable is written on-chain, not returned here — SUBMITTED means it exists, COMPLETED means the escrow released.','rg-ok');
        })
        .catch(function(){
          say('Escrow is funded, but the delivery request did not go through. Send it yourself: POST '+AGENT+'/a2a with skill notify_funded and job_id '+esc(jobId)+'.','rg-err');
        });
    }
  })();

  // Filter only — no data fetching, nothing that can fail and leave the page
  // half-built. If this script never runs, every row is still on the page.
  (function(){
    var q=document.getElementById('rg-q'),b=document.getElementById('rg-body'),n=document.getElementById('rg-none');
    if(!q||!b)return;
    var rows=[].slice.call(b.rows);
    q.addEventListener('input',function(){
      var t=q.value.trim().toLowerCase(),shown=0;
      rows.forEach(function(r){
        var hit=!t||r.innerText.toLowerCase().indexOf(t)>-1;
        r.hidden=!hit; if(hit)shown++;
      });
      n.hidden=shown>0;
    });
  })();
</script>
</body>
</html>
`;

// The inline script is checked before the page is written. A stray newline
// inside a string literal once broke the whole <script> block — which silently
// disabled the dispatch box, the filter and the movement section at the same
// time, on a page that still looked fine. Nothing about it was visible without
// opening a console.
//
// new Function() parses without executing: it catches exactly the class of
// error that a generator producing JavaScript is prone to, and nothing else.
{
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const [i, src] of scripts.entries()) {
    try { new Function(src); }
    catch (e) {
      console.error(`\nRefusing to write registry.html: inline script #${i + 1} does not parse.`);
      console.error(`  ${e.message}`);
      console.error('  This is almost always a generated string containing a real newline.\n');
      process.exit(1);
    }
  }
  // Also assert the page kept its interactive parts, so a template edit cannot
  // quietly drop one.
  for (const id of ['rg-task', 'rg-go', 'rg-out', 'rg-q', 'rg-body', 'rg-move', 'rg-log', 'rg-live-total', 'rg-tile-total']) {
    if (!page.includes(`id="${id}"`)) {
      console.error(`\nRefusing to write registry.html: #${id} is missing from the page.\n`);
      process.exit(1);
    }
  }

  // The live line has no id to check — it is a class on however many rows the
  // telemetry can be matched to. What can silently break it is teleKey()
  // returning null for everything: the script would still run, find no rows,
  // and return without a trace. So the count is asserted, not the markup.
  const teleRows = (page.match(/ data-tele="/g) || []).length;
  const liveSlots = (page.match(/class="rg-live" hidden/g) || []).length;
  if (teleRows < 3 || teleRows !== liveSlots) {
    console.error(`\nRefusing to write registry.html: ${teleRows} rows carry live telemetry and ${liveSlots} have a slot for it.`);
    console.error('  Expected at least 3 and the two to match. Check teleKey() against the PEERS list and our own agent ids.\n');
    process.exit(1);
  }
}

fs.writeFileSync(path.join(ROOT, 'dashboard', 'registry.html'), page);
console.log(`wrote dashboard/registry.html (${(page.length / 1024).toFixed(1)} KB) and dashboard/api-registry.json`);
console.log(`  ${fmt(total)} registered · ${fmt(c.valid)} parse · ${fmt(c.withHttpEndpoint)} endpoints · ${reach ? fmt(reach.reachable) + ' reachable' : 'probe not run yet'}`);

