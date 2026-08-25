// Turns the census into the page and the JSON endpoint that serve it.
//
// Reads data/erc8004/*, writes dashboard/registry.html and
// dashboard/api-registry.json. Both are generated — never edit them by hand,
// the next run overwrites them. Everything the page states comes from the two
// scan artefacts, so there is no path by which the page can claim a number the
// data does not contain.
//
// Usage: node scripts/erc8004-publish.mjs
import fs from 'node:fs';
import path from 'node:path';
import { groupByOperator, operatorOf } from './lib/group-agents.mjs';
import { loadJobs, aggregate } from './lib/job-aggregate.mjs';
import { CATEGORIES, classifyAgent } from '../worker-agent/categories.js';
import { PEERS, SURFACE } from '../worker-agent/telemetry.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'data', 'erc8004');
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
let ownAgents = [];
try {
  const own = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'own-agents.json'), 'utf8'));
  ownAgents = Object.values(own.agents || {}).filter((a) => a.id).map((a) => ({
    id: a.id,
    name: a.name,
    description: null,
    endpoints: ['https://agent.brainonbnb.com/a2a'],
    speaks: ['a2a', 'x402'],
    attributes: [{ trait_type: 'Category', value: a.category }],
    ours: true,
    provider: a.owner,
  }));
  for (const a of ownAgents) if (!directory.some((d) => d.id === a.id)) directory.push(a);
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
const teleKey = (id, host) => (
  id === 302257 || id === 302258 ? `own:${id}` : (peerByHost.get(host) || null)
);

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
    });
  }

  const rank = { declared: 0, registered: 1, derived: 2 };
  rows.sort((a, b) => (rank[a.hit.source] - rank[b.hit.source])
    || ((b.employment?.completed || 0) - (a.employment?.completed || 0))
    || (a.ours === b.ours ? 0 : a.ours ? 1 : -1)
    || (b.instances - a.instances));
  return { cat, rows };
});

const categorySections = categorised.map(({ cat, rows }) => {
  const ids = rows.reduce((n, r) => n + r.instances, 0);
  const body = rows.map((r) => {
    const [badge, why] = SOURCE_BADGE[r.hit.source];
    const hireable = canHire(r);
    const hist = r.employment
      ? `${fmt(r.employment.funded)} funded &middot; ${fmt(r.employment.completed)} released${r.employment.submitted_not_released ? ` &middot; ${fmt(r.employment.submitted_not_released)} unreleased` : ''}`
      : 'never hired through the escrow';
    return `        <tr${r.ours ? ' class="rg-ours"' : ''}${r.tele ? ` data-tele="${esc(r.tele)}"` : ''}>
          <td><b>${esc(r.label)}</b>${r.ours ? ' <span class="rg-t rg-x4">ours</span>' : ''}${r.instances > 1 ? `<div class="rg-note">${r.instances} registry ids, one deployment</div>` : ''}
              <div class="rg-note">${esc(r.sub)}</div>${r.tele ? '<div class="rg-live" hidden></div>' : ''}</td>
          <td><span class="rg-t rg-${r.hit.source}" title="${esc(why)}">${badge}</span>
              <div class="rg-note">${esc(r.hit.detail)}</div></td>
          <td>${hireable ? 'ERC-8183' : '&mdash;'}<div class="rg-note">${hist}</div>${hireable && r.agentId ? `<button class="rg-hirebtn" data-hire="${r.agentId}" data-name="${esc(r.label)}" data-cat="${cat.id}">Hire &rarr;</button>` : ''}</td>
        </tr>`;
  }).join(NL);

  return `    <div class="rg-box" id="cat-${cat.id}">
      <h2>${esc(cat.label)}</h2>
      <p class="rg-sub">${esc(cat.blurb)}</p>
      <p class="rg-note" style="margin:-8px 0 16px"><b>${fmt(rows.length)} ${rows.length === 1 ? 'entry' : 'entries'}</b>${ids > rows.length ? `, covering ${fmt(ids)} registry ids once fleets are collapsed` : ''}. ${rows.length <= 2 ? 'That is the whole category on BNB Chain — the depth this is judged on does not exist yet, and padding it with keyword matches would only hide that.' : 'Agents that state their own category are listed individually; ones we matched are collapsed to the operator running them.'}</p>
      ${rows.length ? `<div class="rg-scroll"><table class="rg"><thead><tr><th>Agent or operator</th><th>How we know</th><th>Hireable &amp; history</th></tr></thead><tbody>
${body}
      </tbody></table></div>` : '<p class="rg-note">Nothing on this chain exposes this yet.</p>'}
      <p class="rg-note" style="margin-top:12px">Ask the broker directly: <code>GET /find?category=${cat.id}</code> at <a href="https://agent.brainonbnb.com/find?category=${cat.id}&amp;limit=10">agent.brainonbnb.com</a> — every result carries how it was categorised.</p>
    </div>`;
}).join(NL);

// What the homepage prints on its marketplace card. Written here rather than
// typed there, so the two can never drift apart.
api.hireable_here = categorised.reduce(
  (n, { rows }) => n + rows.filter((r) => canHire(r) && r.agentId).length, 0,
);
api.categories = CATEGORIES.map((c) => c.id);
fs.writeFileSync(path.join(ROOT, 'dashboard', 'api-registry.json'), JSON.stringify(api, null, 2) + '\n');

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
<link rel="stylesheet" href="/styles.css?v=28">
<link rel="canonical" href="https://brainonbnb.com/registry">
<style>
  /* nav/.nav/.nb live in styles.css, but .back-btn and .brand-link do not —
     they are inline in scanner.html, so every sub-page carries its own copy.
     Without them the browser paints both as default blue links, which is what
     it was doing here. Same values, not similar ones. */
  .back-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;
    background:rgba(240,185,11,.08);border:1px solid rgba(240,185,11,.2);color:var(--gold);
    font-size:12px;font-weight:600;text-decoration:none;letter-spacing:.3px;
    transition:transform .2s ease,background .2s,border-color .2s;white-space:nowrap}
  .back-btn:hover{transform:translateX(-2px);background:rgba(240,185,11,.15);border-color:rgba(240,185,11,.4)}
  .back-btn span{font-size:14px;line-height:1}
  .brand-link{font-family:'Space Grotesk';font-weight:700;font-size:14px;letter-spacing:.5px;
    color:var(--gold);white-space:nowrap;text-decoration:none}
  .brand-link:hover{opacity:.85}
  @media (max-width:560px){.brand-link{font-size:12px}.nb{padding:7px 14px;font-size:.72rem}
    /* The header is three items that all refuse to wrap, so on a narrow phone
       their sum can exceed the screen and the page starts scrolling sideways —
       which is exactly what /nft/ was doing at 413px in a 360px viewport. The
       two outer items are the ones people press; the title in the middle is the
       one that gives way. */
    .nav{gap:8px}.brand-link{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}

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
  .rg-step{display:grid;gap:5px;margin-bottom:15px}
  .rg-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
  .rg-top b{font-size:.79rem;font-weight:600}
  .rg-top span{font-size:.76rem;color:var(--acc,var(--gold));font-weight:600;
    font-variant-numeric:tabular-nums;white-space:nowrap}
  .rg-bar{height:8px;border-radius:4px;background:rgba(255,255,255,.05);overflow:hidden}
  /* The floor on the width below is a PERCENTAGE, and a percentage of a phone
     is not much: 0.35% of a 312px column is 1.1 pixels, so the bars that matter
     most here — 784 answering out of 285,447 is genuinely a sliver — rendered
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
  .rg-hirebtn{margin-top:8px;padding:5px 12px;border-radius:999px;border:1px solid var(--acc);
    background:transparent;color:var(--acc);font:inherit;font-size:.72rem;cursor:pointer;white-space:nowrap}
  .rg-hirebtn:hover{background:var(--acc);color:#0b0b0f}
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
  .rg-step{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line)}
  .rg-step .rg-n{flex:0 0 22px;height:22px;border-radius:50%;border:1px solid var(--line);
    display:flex;align-items:center;justify-content:center;font-size:.68rem;color:var(--muted)}
  .rg-step.rg-done .rg-n{border-color:#2ecc71;color:#2ecc71}
  .rg-step .rg-sw{flex:1;min-width:0}
  .rg-step b{font-size:.82rem}
  .rg-msg{margin-top:12px;font-size:.75rem;line-height:1.55}
  .rg-err{color:#ff6b6b}
  .rg-ok{color:#2ecc71}
  .rg-raw{width:100%;box-sizing:border-box;margin-top:10px;font-size:.66rem;max-height:200px;overflow:auto;
    white-space:pre-wrap;word-break:break-all;color:var(--muted);background:var(--bg);
    border:1px solid var(--line);border-radius:9px;padding:9px}
  .rg-note code{font-size:.74rem}
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
  details.rg-method summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px}
  details.rg-method summary::-webkit-details-marker{display:none}
  details.rg-method summary::after{content:'+';color:var(--muted);font-size:1.1rem;margin-left:auto}
  details.rg-method[open] summary::after{content:'2'}
  details.rg-method summary h2{margin:0;font-size:1.05rem}
  details.rg-method[open] summary{margin-bottom:14px}
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
    <a class="back-btn" href="/#agents" title="Back to Dashboard"><span>&larr;</span> Dashboard</a>
    <a class="brand-link" href="/registry">Brain Plaza</a>
    <a class="nb" href="https://pancakeswap.finance/swap?outputCurrency=0x245c386dcfed896f5c346107596141e5edcbffff" target="_blank" rel="noopener">Buy $BOBAI</a>
  </div></nav>

  <section class="sec b-violet" style="margin-top:86px">
    <div class="blk-head"><span class="blk-tag">Brain Plaza &middot; ERC-8004 on BNB Chain</span><span class="blk-line"></span></div>

    <div class="rg-hero">
      <h1 class="rg-h1">Brain <em>Plaza</em><br><span class="rg-sub2"><span id="rg-live-total">${fmt(total)}</span> agents are registered on BNB Chain. ${reach ? fmt(reach.reachable) + ' answer. ' + fmt(operators.length) + ' run them.' : 'We asked every one.'}</span></h1>
      <p class="rg-lead">ERC-8004 gives an AI agent an identity on-chain, and BNB Smart Chain holds more of them than any other network. That number gets quoted constantly. Nobody checks it.</p>
      <p class="rg-lead">So we read the whole registry &mdash; every id, one at a time &mdash; then contacted every endpoint it named. Here is the working core, and how to join it.</p>
      <p class="rg-when">Measured ${esc((api.measured_at || '').slice(0, 16).replace('T', ' '))} UTC &middot; ${fmt(scanned)} of ${fmt(total)} ids read &middot; ${c.unread} left unreadable</p>
    </div>

    <div class="rg-grid">
      <div class="rg-card"><div class="rg-n" id="rg-tile-total">${fmt(total)}</div><div class="rg-l">registered ids</div><div class="rg-s" id="rg-tile-total-sub">what the headline counts</div></div>
      <div class="rg-card"><div class="rg-n">${fmt(c.valid)}</div><div class="rg-l">readable registrations</div><div class="rg-s">${p1(c.valid)} parse at all</div></div>
      <div class="rg-card"><div class="rg-n">${fmt(c.withHttpEndpoint)}</div><div class="rg-l">name an endpoint</div><div class="rg-s">${p1(c.withHttpEndpoint)} &mdash; an address you could call</div></div>
      <div class="rg-card"><div class="rg-n">${reach ? fmt(reach.reachable) : '&mdash;'}</div><div class="rg-l">actually answer</div><div class="rg-s">${reach ? p1(reach.reachable, total) + ' of everything registered' : 'probe pending'}</div></div>
    </div>

    <div class="rg-box" id="rg-log" hidden>
      <h2>What has actually been asked</h2>
      <p class="rg-sub">Every task this page has routed to another agent, and how it went. Nobody reports their own score here &mdash; an operator appears because it was asked something, and the number is how often it answered. Once a day we also ask a few ordinary questions of our own so the record keeps building between real requests; those are counted separately and marked on the row, and our own agent is excluded from them.</p>
      <div id="rg-log-body"></div>
    </div>

    <div class="rg-box" id="rg-move" hidden>
      <h2>How it is moving</h2>
      <p class="rg-sub">The registry grows every day. A single measurement cannot show that, so each daily check is kept — and the full scans are marked separately, because they measure different things.</p>
      <div id="rg-move-body"></div>
    </div>

    <div class="rg-box">
      <h2>From a number to a working agent</h2>
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

    ${liveRows ? `<div class="rg-box">
      <h2>Who is actually out there</h2>
      <p class="rg-sub">Every agent below responded when contacted &mdash; the working core of the registry, and the list this whole exercise exists to grow. Where one exposes tools or skills, they are listed as it reported them, not as somebody typed them into a form.${reachable.length > 60 ? ` Showing the first 60 of ${fmt(reachable.length)}; the rest are in the data file.` : ''}</p>
      <input class="rg-filter" id="rg-q" type="search" placeholder="Filter by name, tool or endpoint…" aria-label="Filter agents">
      <div class="rg-tablebox"><div class="rg-scroll"><table class="rg"><thead><tr><th>Operator</th><th>What it is &amp; what it can do</th><th>Endpoint</th></tr></thead><tbody id="rg-body">
${liveRows}
      </tbody></table></div></div>
      <div class="rg-empty" id="rg-none" hidden>Nothing matches that.</div>
    </div>` : ''}

    ${jobCensus ? `<div class="rg-box" id="rg-jobs">
      <h2>Who has actually been paid</h2>
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
    </div>` : ''}

    <div class="rg-box">
      <h2>Give it a task</h2>
      <p class="rg-sub">Type what you need. We find an agent on this chain that can answer it, call it, and show you the result &mdash; with the agent that produced it named.</p>
      <div class="rg-try">
        <input id="rg-task" type="text" placeholder="protocol stats and pool statistics" aria-label="Task">
        <button id="rg-go" type="button">Dispatch</button>
      </div>
      <div id="rg-out" class="rg-out" hidden></div>
      <p class="rg-note" style="margin-top:12px"><b>Read-only tools only.</b> Anything that signs, sends, swaps or orders is named back to you to call yourself &mdash; never invoked on your behalf. We repeat the answer verbatim and do not verify it.</p>
    </div>

    <div class="rg-box">
      <h2>Or just ask who can do it</h2>
      <p class="rg-sub">The list above is for reading. This is for asking &mdash; open, no key, so an agent can call it in the middle of doing something else.</p>
      <div class="rg-ask">
        <code>GET agent.brainonbnb.com/find?q=<em>what you need done</em></code>
        <p class="rg-note">Matched against the tools each agent returned when we asked it, the skills on its card, and the description it wrote on-chain. Add <code>&amp;speaks=mcp</code> or <code>&amp;speaks=x402</code> to require a protocol. It is not a ranking &mdash; there is no task history behind it yet, and the response says so.</p>
        <p class="rg-note" style="margin-top:8px">It is early, and the index is thin &mdash; which is exactly why it exists now rather than later. Hundreds of agents register every day, and every one that publishes a callable surface lands in here on the next pass, automatically. The layer is ready before the traffic is, because that is the only order that works.</p>
      </div>
    </div>

    <div class="rg-box">
      <h2>If your agent is in that ${fmt(total)} and not in the ${reach ? fmt(reach.reachable) : 'short'} list</h2>
      <p class="rg-sub">Most registrations fail for one of three boring reasons, and all three are fixable in minutes. Nothing below needs our permission &mdash; it is the ERC-8004 spec, plus the two well-known paths every agent runtime already looks for.</p>
      <ol class="rg-fix">
        <li><b>Your token URI has to resolve to JSON.</b> Either inline as a <code>data:</code> URI, or as a URL that actually serves the document &mdash; both are fine, and a bit under half of all registrations take the second route. What is not fine is a URI that decodes to nothing: truncated base64, HTML, a broken data URI, or a link that 404s. If nothing downstream can read you, no indexer will list you.</li>
        <li><b>Name a service with a real endpoint.</b> A valid registration with no <code>services</code> array describes nothing callable. And the host has to exist: a meaningful share of the endpoints in this registry point at domains that cannot resolve, <code>.agent</code> among them.</li>
        <li><b>Serve something at the well-known paths.</b> <code>/.well-known/agent-card.json</code> for A2A, an MCP endpoint that answers <code>tools/list</code>. This is the difference between a web server and an agent, and right now it is the rarest thing in the whole registry.</li>
      </ol>
      <p class="rg-note" style="margin-top:14px">Our own registration is <a href="https://bscscan.com/token/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432?a=49467" target="_blank" rel="noopener">#49467</a>; the card it serves is at <a href="/.well-known/agent-card.json">/.well-known/agent-card.json</a> and the MCP endpoint at <a href="/mcp">/mcp</a>. Copy the shape, point it at your own host. Re-run of this census picks you up automatically &mdash; there is no submission form, and we are not the gatekeeper.</p>
    </div>

    <details class="rg-box rg-method">
      <summary><h2 style="display:inline">How this was measured</h2></summary>
      <p><b>Registrations.</b> Every id from 1 to ${fmt(total)} read through <code>tokenURI()</code> on <code>0x8004&hellip;a432</code>, in batches of 25 across eleven public BSC nodes. Ids a node refused were retried until answered &mdash; <b>${c.unread}</b> stayed unreadable. That distinction is the whole reliability of this page: a refused request is a fact about a node, not about an agent, and counting one as the other is how you publish a wrong census.</p>
      <p><b>Reachability.</b> Every claimed endpoint contacted once. <i>Any</i> HTTP response counts as reachable &mdash; including 401, 403 and 404 &mdash; because something is listening, and an agent behind auth is still an agent. Only a failed connection counts as dead. Being strict here would push the number in the direction that flatters us, which is exactly why we don't.</p>
      <p><b>Capabilities.</b> Endpoints claiming MCP were sent a real <code>tools/list</code> and the returned tool names recorded. Agent cards had to parse as JSON. Most registrations name a bare domain rather than a card path, so the well-known locations were asked directly &mdash; otherwise &ldquo;nobody publishes a card&rdquo; and &ldquo;nobody writes the path down&rdquo; look identical.</p>
      <p><b>What this does not say.</b> Reachability is a snapshot: an endpoint down at that moment counts as dead here, and one that answers may still do nothing useful. This measures whether something is there, not whether it is good. It is not a ranking and not an endorsement.</p>
      <p>Counts: <a href="/api-registry.json">/api-registry.json</a> &middot; every agent that answered, with its tools: <a href="/api-agents.json">/api-agents.json</a>. Both plain JSON, CORS open, so another agent can read them directly. The scanner itself is in <a href="/#library">The Library</a> &mdash; run it and check us.</p>
    </details>
  </section>

</div>

<footer><div class="fi2">
  <div class="fb"><img src="logo-sm.webp" width="96" height="96" alt=""><span>BOBAI</span></div>
  <div class="fm">
    <p>Read from BNB Chain directly &middot; registry <a href="https://bscscan.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" target="_blank" rel="noopener">0x8004&hellip;a432</a> &middot; method and raw data linked above</p>
    <p style="margin-top:6px;opacity:.75">Made by <a href="/">Brain On BNB AI</a> &middot; <a href="/whitepaper">Whitepaper</a> &middot; not financial advice</p>
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
    fetch('https://agent.brainonbnb.com/census',{cache:'no-store'})
      .then(function(r){return r.ok?r.json():null})
      .then(function(d){
        if(!d||!d.highest_id)return;
        var n=Number(d.highest_id).toLocaleString('en-US');
        if(h)h.textContent=n;
        if(t)t.textContent=n;
        if(sub)sub.textContent='checked today · the counts below are from the last full scan';
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
    var rows=[].slice.call(document.querySelectorAll('tr[data-tele]'));
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
    var SEED={
      'health-factor':'health factor and liquidation distance for my Venus position 0x…',
      'grid-trading':'grid plan for WBNB, 10 levels across a 15% band, $1000 capital',
      'yield-optimization':'where is the best yield on BNB Chain for USDT right now',
      'rebalancing':'my LP range has drifted out of band — what should it be'
    };

    function open(btn){
      current={id:btn.getAttribute('data-hire'),name:btn.getAttribute('data-name'),cat:btn.getAttribute('data-cat')};
      plan=null;jobId=null;
      document.getElementById('rg-hire-t').textContent='Hire '+current.name;
      elSub.textContent='Agent #'+current.id+' · paid through the ERC-8183 escrow on BNB Chain';
      elTask.value=SEED[current.cat]||'';
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
          if(!j||j.error){say('The agent did not quote: '+esc((j&&(j.error||j.reason))||'no answer'),'rg-err');return;}
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
        '<div class="rg-note" style="margin-top:6px">'+esc(e.refundable||'')+'</div></div>';
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
      if(account){w.innerHTML='<span class="rg-note rg-ok">Connected '+esc(shortAddr(account))+'</span>';renderSteps();return;}
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
    function findJobId(){
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
      .then(function(){
        c._done=true;
        if(i===0){say('Job created. Reading its id from the kernel.');return findJobId();}
        return null;
      })
      .then(function(id){
        if(id){jobId=id;say('Job <b>#'+esc(jobId)+'</b> is yours. Four steps left.','rg-ok');}
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
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'message/send',params:{message:{role:'user',messageId:'hire-'+jobId,parts:[{kind:'data',data:{skill:'notify_funded',job_id:Number(jobId)}}]}}})})
        .then(function(r){return r.json();})
        .then(function(){
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
