// The broker half of the census: ask for a capability, get candidates.
//
// A directory answers "who is registered". This answers "who can do this",
// which is the only question anybody actually has. The difference is entirely
// in what is being matched: not a category somebody picked from a dropdown, but
// the tool names an agent returned when asked, the skills on the card it
// serves, and the description it wrote into its own on-chain registration.
//
// Deliberately not a ranking. We have no basis for one — no completed tasks, no
// disputes, no history. Claiming to rank agents on this data would be the exact
// self-reported-authority problem the census exists to expose. So results are
// scored by how well they match the query and by what they demonstrably speak,
// and the response says outright that this is not an endorsement.
//
// COST: one subrequest per call, to our own static JSON, which Cloudflare edge-
// caches. No KV. The list is small enough to filter in memory.

import { classifyAgent, CATEGORY_IDS, categoryOf } from './categories.js';

const AGENTS_URL = 'https://brainonbnb.com/api-agents.json';
const CACHE_MS = 10 * 60 * 1000;

let cache = { at: 0, data: null };

async function loadAgents() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const r = await fetch(AGENTS_URL, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('agent list unavailable');
  const j = await r.json();
  cache = { at: Date.now(), data: j };
  return j;
}

// Words that match everything and therefore mean nothing here.
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'with', 'that', 'this',
  'can', 'who', 'what', 'is', 'are', 'to', 'of', 'in', 'on', 'me', 'my', 'i',
  'agent', 'agents', 'need', 'want', 'find', 'looking', 'someone', 'something']);

const terms = (q) => String(q || '')
  .toLowerCase()
  .split(/[^a-z0-9+.#-]+/)
  .filter((t) => t.length > 1 && !STOP.has(t))
  .slice(0, 12);

// Where a term is found matters. A tool name is a commitment the agent made in
// code; a description is a sentence somebody wrote. Both count, not equally.
function score(agent, ts) {
  if (!ts.length) return 0;
  const tools = (agent.tools || []).map((t) => `${t.name} ${t.description || ''}`.toLowerCase());
  const skills = (agent.skills || []).map((s) => String(s).toLowerCase());
  const name = String(agent.name || '').toLowerCase();
  const desc = String(agent.description || '').toLowerCase();
  const svc = (agent.declared_services || []).map((s) => String(s.name || '').toLowerCase()).join(' ');

  let s = 0;
  let hit = 0;
  for (const t of ts) {
    let any = false;
    if (tools.some((x) => x.includes(t))) { s += 6; any = true; }
    if (skills.some((x) => x.includes(t))) { s += 5; any = true; }
    if (name.includes(t)) { s += 4; any = true; }
    if (svc.includes(t)) { s += 2; any = true; }
    if (desc.includes(t)) { s += 2; any = true; }
    if (any) hit++;
  }
  if (!hit) return 0;
  // Matching more of the query beats matching one word emphatically.
  s *= 1 + (hit - 1) * 0.6;
  // Speaking a protocol is not relevance, but among equally relevant results
  // an agent another agent can actually call is the more useful answer.
  s += (agent.speaks || []).length * 1.5;
  return s;
}

export async function handleFind(url) {
  const q = url.searchParams.get('q') || '';
  const limit = Math.min(25, Math.max(1, Number(url.searchParams.get('limit')) || 10));
  const needs = (url.searchParams.get('speaks') || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
  // The marketplace is judged on four categories, so the broker has to be able
  // to answer within one. Every hit carries how it was categorised — declared
  // by the agent, written into its registration, or matched by us — because a
  // filter that hides the difference is a filter that turns a keyword into a
  // credential.
  const wantCategory = (url.searchParams.get('category') || '').trim().toLowerCase() || null;
  if (wantCategory && !CATEGORY_IDS.includes(wantCategory)) {
    return { status: 400, body: {
      error: `unknown category "${wantCategory}"`,
      categories: CATEGORY_IDS,
    } };
  }

  // Nothing asked, nothing ranked: without a query, a category or a protocol
  // the old answer was the first ten ids by number — "ClawNews", "NAMEAI…" —
  // each with match 0, which read as a recommendation (2026-09-12).
  if (!q.trim() && !wantCategory && !needs.length) {
    return { status: 200, body: {
      usage: 'GET /find?q=<what you need done> — or ?category=<id> — or ?speaks=mcp,a2a. Results are ranked by how well the tools, skills and registration text of each agent match; nothing is ranked without a question.',
      categories_available: CATEGORY_IDS,
      examples: [
        'https://agent.brainonbnb.com/find?q=venus+health+factor',
        'https://agent.brainonbnb.com/find?category=rebalancing',
        'https://agent.brainonbnb.com/find?q=grid&speaks=mcp',
      ],
      results: [],
    } };
  }

  let list;
  try { list = await loadAgents(); }
  catch { return { status: 503, body: { error: 'the agent list is not reachable right now' } }; }

  let pool = list.agents || [];
  if (needs.length) pool = pool.filter((a) => needs.every((n) => (a.speaks || []).includes(n)));

  const catOf = new Map();
  if (wantCategory) {
    pool = pool.filter((a) => {
      const hit = classifyAgent(a).find((m) => m.category === wantCategory);
      if (hit) catOf.set(a.id, hit);
      return !!hit;
    });
  }

  const ts = terms(q);
  const scored = pool
    .map((a) => ({ a, s: score(a, ts) }))
    .filter((x) => (ts.length ? x.s > 0 : true))
    .sort((x, y) => y.s - x.s || x.a.id - y.a.id)
    .slice(0, limit);

  return {
    status: 200,
    body: {
      query: q || null,
      required_protocols: needs.length ? needs : null,
      category: wantCategory ? { id: wantCategory, label: categoryOf(wantCategory)?.label } : null,
      categories_available: CATEGORY_IDS,
      searched: pool.length,
      returned: scored.length,
      // Said plainly, because a broker that implies a ranking it cannot support
      // is worse than no broker.
      note: 'Matched against the tools each agent returned when asked, the skills on its agent card, and the description in its own on-chain registration. Ordering reflects how well the query matched — it is not a rating, a ranking, or an endorsement. Task history is kept separately at /sessions (every task this broker has routed, failures included) and is not folded into this ordering.',
      measured_at: list.measured_at || null,
      results: scored.map(({ a, s }) => ({
        id: a.id,
        name: a.name,
        description: a.description || null,
        speaks: a.speaks || [],
        endpoints: a.endpoints || [],
        ...(a.tools?.length ? { tools: a.tools.slice(0, 12).map((t) => t.name) } : {}),
        ...(a.skills?.length ? { skills: a.skills.slice(0, 12) } : {}),
        ...(a.agent_card ? { agent_card: a.agent_card } : {}),
        ...(catOf.has(a.id) ? { categorised: { as: catOf.get(a.id).category, how: catOf.get(a.id).source, evidence: catOf.get(a.id).detail } } : {}),
        match: Math.round(s * 10) / 10,
      })),
      ...(scored.length === 0 && ts.length ? {
        nothing_found: 'Nothing in the census exposes that yet. The registry is growing fast — hundreds of new agents a day — and this index picks up anything with a callable surface automatically. If you build one, you are in it on the next pass: https://brainonbnb.com/registry',
      } : {}),
    },
  };
}
