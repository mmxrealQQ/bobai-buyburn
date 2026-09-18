// Putting agents into the four categories the marketplace has to cover, and
// saying how each one got there.
//
// The four are fixed by what a buyer comes here looking for: rebalancing, grid
// trading, yield optimisation, health-factor monitoring.
//
// WHY EVERY ANSWER CARRIES ITS SOURCE
// There are three ways to learn what an agent does, and they are not equally
// good:
//
//   declared    the agent's own /status returns a machine-readable category.
//               Measured: two of the four BNB Agent Studio reference agents do
//               this (yield-optimization, health-factor). The other two answer
//               404 on /status entirely.
//   registered  the on-chain registration carries a Category attribute. Ours
//               do; almost nothing else in the registry does.
//   derived     we matched its tools, skills, name or description. This is a
//               guess made from evidence, and it is the only one that can be
//               wrong.
//
// A directory that prints all three the same way is a directory that launders
// a keyword match into a fact. So the source travels with the answer, every
// derived match keeps the string that produced it, and the page shows it.
//
// WHY NOT JUST ASK EVERY AGENT
// Because 784 endpoints answer and a page cannot wait for 784 requests. Live
// status is fetched for the agents that matter — the reference set and our own
// — and cached; the rest are classified from what the census already read.

export const CATEGORIES = [
  {
    id: 'rebalancing',
    label: 'Rebalancing',
    blurb: 'Moving a position back to its target: LP ranges that have drifted out of band, portfolios that have gone lopsided.',
    // Aliases are the strings other agents actually use for the same thing.
    aliases: ['rebalancing', 'rebalance', 'portfolio-rebalancing', 'lp-rebalancing', 'liquidity-rebalancing'],
    strong: /rebalanc|lp[ -]?range|liquidity[ -]?range|range[ -]?manag/i,
    loose: /portfolio.{0,12}balance/i,
  },
  {
    id: 'grid-trading',
    label: 'Grid Trading',
    blurb: 'Laying buy and sell orders across a price band and earning the spacing between them — if the spacing beats what the pool charges to trade.',
    aliases: ['grid-trading', 'grid', 'gridbot', 'grid-bot'],
    strong: /grid[ -]?trad|grid[ -]?bot|grid[ -]?strateg|grid[ -]?plan/i,
    loose: /\bgrid\b/i,
  },
  {
    id: 'yield-optimization',
    label: 'Yield Optimisation',
    blurb: 'Finding where capital earns more, and what moving it costs.',
    aliases: ['yield-optimization', 'yield-optimisation', 'yield', 'yield-farming', 'apy-optimization'],
    strong: /yield[ -]?optimi|yield[ -]?farm|auto.?compound|best[ -]?(apy|apr)|harvest[ -]?reward/i,
    loose: /\byield\b|\bapy\b|\bapr\b|farming|vault/i,
  },
  {
    id: 'health-factor',
    label: 'Health Factor Monitoring',
    blurb: 'Watching a lending position and saying how far it is from liquidation — before it gets there.',
    aliases: ['health-factor', 'health-factor-monitoring', 'liquidation-monitoring', 'lending-monitoring'],
    strong: /health[ -]?factor|liquidat|collateral[ -]?ratio|lending[ -]?guard/i,
    loose: /borrow.{0,12}health|\bcollateral\b/i,
  },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
const byId = new Map(CATEGORIES.map((c) => [c.id, c]));
export const categoryOf = (id) => byId.get(id) || null;

// An agent's own word for its category, mapped onto ours. Their strings and
// ours agree on three of four by luck rather than by standard — theirs says
// "health-factor" where ours says "health-factor-monitoring" — so this is a
// lookup and not a string comparison.
export function canonicalise(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (!s) return null;
  for (const c of CATEGORIES) {
    if (c.id === s || c.aliases.includes(s)) return c.id;
  }
  // A word we have not seen before still counts if it plainly contains one of
  // ours; anything else is left unmatched rather than forced into a bucket.
  for (const c of CATEGORIES) if (c.strong.test(s) || c.loose.test(s)) return c.id;
  return null;
}

// Evidence, split by how much weight it can carry.
//
// `titles` are things somebody chose as a label: the agent's name, a tool's
// name, a skill's name. A single word there means something.
// `prose` is free text — descriptions. A word in prose is far weaker, and
// treating the two alike is what filed 250 agents under yield optimisation:
// a fleet of 123 identical portfolio bots whose tool description happens to
// contain "allocation". None of them optimise yield; the word does.
//
// So a loose single-word pattern only counts against a title. Prose has to
// carry an unambiguous phrase — "health factor", "grid trading", "rebalance" —
// before it files anything anywhere.
function evidenceOf(agent) {
  const titles = [];
  const prose = [];
  if (agent.name) titles.push({ where: 'name', text: String(agent.name) });
  if (agent.description) prose.push({ where: 'description', text: String(agent.description) });
  for (const t of agent.tools || []) {
    titles.push({ where: 'tool name', text: String(t.name || t) });
    if (t.description) prose.push({ where: 'tool description', text: String(t.description) });
  }
  for (const s of agent.skills || []) {
    if (typeof s === 'string') { titles.push({ where: 'skill', text: s }); continue; }
    if (s.name) titles.push({ where: 'skill name', text: String(s.name) });
    if (s.description) prose.push({ where: 'skill description', text: String(s.description) });
  }
  for (const s of agent.declared_services || []) {
    if (typeof s === 'string') { titles.push({ where: 'declared service', text: s }); continue; }
    if (s.name) titles.push({ where: 'declared service', text: String(s.name) });
    if (s.description) prose.push({ where: 'declared service description', text: String(s.description) });
  }
  return { titles: titles.filter((b) => b.text), prose: prose.filter((b) => b.text) };
}

/**
 * Classify one agent.
 *
 * `status` is its own /status document if we have one. Returns every category
 * it plausibly belongs to — an agent that both optimises yield and watches a
 * health factor is not misfiled by appearing twice, whereas forcing it into one
 * bucket loses a real capability.
 */
export function classifyAgent(agent, status = null) {
  const out = [];
  const seen = new Set();

  const add = (id, source, detail) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ category: id, source, detail });
  };

  // 1. The agent said so itself, live.
  if (status && typeof status === 'object') {
    const id = canonicalise(status.category || status.agent_category || status.type);
    if (id) add(id, 'declared', `its own /status returns category "${status.category || status.agent_category || status.type}"`);
  }

  // 2. The on-chain registration says so.
  for (const attr of agent.attributes || []) {
    if (/^category$/i.test(String(attr.trait_type || ''))) {
      const id = canonicalise(attr.value);
      if (id) add(id, 'registered', `its on-chain registration carries Category "${attr.value}"`);
    }
  }

  // 3. Matched from what it exposes. Lowest confidence, and the match is kept
  //    so the page can show the string rather than the conclusion.
  const { titles, prose } = evidenceOf(agent);
  for (const c of CATEGORIES) {
    let hit = null;
    for (const b of prose) {
      const m = b.text.match(c.strong);
      if (m) { hit = { m: m[0], where: b.where }; break; }
    }
    if (!hit) for (const b of titles) {
      const m = b.text.match(c.strong) || b.text.match(c.loose);
      if (m) { hit = { m: m[0], where: b.where }; break; }
    }
    if (hit) add(c.id, 'derived', `matched "${hit.m}" in its ${hit.where}`);
  }

  return out;
}

/** Convenience: does this agent belong to `categoryId` at all, and how well. */
export function categoryMatch(agent, categoryId, status = null) {
  return classifyAgent(agent, status).find((m) => m.category === categoryId) || null;
}

// Ranking for a category listing. An agent that says what it is beats one we
// guessed at, and one that has actually been paid beats one that has not —
// which is the whole reason the employment census exists.
const SOURCE_RANK = { declared: 0, registered: 1, derived: 2 };
export function rankForCategory(a, b) {
  const s = (SOURCE_RANK[a.source] ?? 3) - (SOURCE_RANK[b.source] ?? 3);
  if (s) return s;
  const paid = (b.employment?.completed || 0) - (a.employment?.completed || 0);
  if (paid) return paid;
  const funded = (b.employment?.funded || 0) - (a.employment?.funded || 0);
  if (funded) return funded;
  return (a.id || 0) - (b.id || 0);
}
