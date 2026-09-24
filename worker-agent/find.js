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
export const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'with', 'that', 'this',
  'can', 'who', 'what', 'is', 'are', 'to', 'of', 'in', 'on', 'me', 'my', 'i',
  'agent', 'agents', 'need', 'want', 'find', 'looking', 'someone', 'something',
  // Filler of a whole sentence (2026-09-24). Words that carry meaning in one
  // question and none in another ("out", "again") are left to the weights.
  'get', 'give', 'tell', 'show', 'how', 'much', 'many', 'does', 'do', 'did', 'will',
  'would', 'should', 'could', 'which', 'when', 'where', 'why', 'there', 'it', 'its',
  'be', 'from', 'at', 'by', 'about', 'please', 'some', 'any', 'all', 'you', 'your',
  'if', 'so', 'up', 'now', 'just', 'into', 'than', 'then', 'has', 'have', 'was',
  'were', 'am']);

// A term matches a whole word (a plural counts as its singular): as a
// substring "out" matched "route" and "about", and every agent with long
// descriptions matched everything (2026-09-24, P6).
const WORD_RE = new Map();
const hasWord = (text, t) => {
  let re = WORD_RE.get(t);
  if (!re) {
    // A word of four letters or more also matches as the start of a longer
    // one ("safe" finds "safety", "scan" finds "scanner"); a shorter one must
    // stand alone, or "out" is back in "outcome".
    const body = t.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    re = new RegExp('(^|[^a-z0-9])' + body + (t.length >= 4 ? '' : '(s|es)?(?![a-z0-9])'));
    WORD_RE.set(t, re);
  }
  return re.test(text);
};

const terms = (q) => String(q || '')
  .toLowerCase()
  .split(/[^a-z0-9+.#-]+/)
  .filter((t) => t.length > 1 && !STOP.has(t))
  .slice(0, 12);

// Everything an agent says about itself, in one string, for counting how
// many agents use a word at all.
const hayOf = (a) => [
  ...(a.tools || []).map((t) => `${t.name} ${t.description || ''}`),
  ...(a.skills || []).map(String), a.name || '', a.description || '',
  ...(a.declared_services || []).map((x) => x.name || ''),
].join(' ').toLowerCase();

// HOW MUCH A WORD SAYS (2026-09-24, P6 of the review). Every term used to
// count the same, so a whole sentence ranked first whoever wrote the longest
// descriptions: 'check', 'get' and 'out' are in most of the 900, and for a
// pre-trade question two agents with forty tools each scored 139 and 122
// against the pre-trade check's 72. A word now weighs by how few agents use
// it (inverse document frequency over the pool searched): about 1 for a word
// one agent in ten uses, well under that for one most use, up to about 3 for
// a word nearly nobody does.
export function termWeights(pool, ts) {
  const hays = pool.map(hayOf);
  const n = hays.length;
  const w = {};
  for (const t of ts) {
    const df = hays.reduce((c, h) => c + (hasWord(h, t) ? 1 : 0), 0);
    w[t] = Math.log((n + 1) / (df + 1)) / Math.LN10;
  }
  return w;
}

// Where a term is found matters. A tool name is a commitment the agent made in
// code; a description is a sentence somebody wrote. Both count, not equally.
export function score(agent, ts, w = null) {
  if (!ts.length) return 0;
  const tools = (agent.tools || []).map((t) => `${t.name} ${t.description || ''}`.toLowerCase());
  const skills = (agent.skills || []).map((s) => String(s).toLowerCase());
  const name = String(agent.name || '').toLowerCase();
  const desc = String(agent.description || '').toLowerCase();
  const svc = (agent.declared_services || []).map((s) => String(s.name || '').toLowerCase()).join(' ');

  let s = 0;
  let hit = 0;
  for (const t of ts) {
    const k = w ? (w[t] ?? 1) : 1;
    let here = 0;
    if (tools.some((x) => hasWord(x, t))) here += 6;
    if (skills.some((x) => hasWord(x, t))) here += 5;
    if (hasWord(name, t)) here += 4;
    if (hasWord(svc, t)) here += 2;
    if (hasWord(desc, t)) here += 2;
    s += here * k;
    // Only a word that says something counts toward covering the question.
    if (here && k >= 0.5) hit++;
  }
  if (!s) return 0;
  hit = Math.max(hit, 1);
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
  const weights = ts.length ? termWeights(pool, ts) : null;
  const scored = pool
    .map((a) => ({ a, s: score(a, ts, weights) }))
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
        // The next step, per result (2026-09-18): a hit that stops at a score
        // leaves the caller to guess the URL pattern the dispatcher already emits.
        next: {
          dispatch: `https://agent.brainonbnb.com/dispatch?task=${encodeURIComponent(q || '')}`,
          hire: `https://agent.brainonbnb.com/hire?agent=${a.id}&task=${encodeURIComponent(q || '')}`,
        },
      })),
      next: { dispatch: `https://agent.brainonbnb.com/dispatch?task=${encodeURIComponent(q || '')}`, sessions: 'https://agent.brainonbnb.com/sessions' },
      ...(scored.length === 0 && ts.length ? {
        nothing_found: 'Nothing in the census exposes that yet. The registry is growing fast — hundreds of new agents a day — and this index picks up anything with a callable surface automatically. If you build one, you are in it on the next pass: https://brainonbnb.com/registry',
      } : {}),
    },
  };
}
