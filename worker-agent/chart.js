// THE AGENT CHART — everything measured about one agent, in one answer (Brain Plaza agent chart, phase 2, 2026-10-12).
//
// DexScreener shows a token by what the chain says, not by what its team says. This is that for an agent on BNB Chain:
// who it is (its own on-chain registration), whether it is up (our daily pulse), whether it gets paid and delivers (every
// job on the ERC-8183 escrow, put on the right agent), whether it names a price when asked (Brain Plaza's quote run),
// what other raters wrote about it (ERC-8004 ReputationRegistry), and whether its builder has listed it.
// GET /chart/<id> serves it; brainonbnb.com/agent/<id> draws it; an agent can read it the same way.
//
// THE EVIDENCE SCORE (0-100) is computed here and only here, and every part says what it was made of:
//   40 x uptime over the last 30 days of our pulse      (needs 3 measured days)
//   30 x delivery rate of its funded escrow jobs       (needs 1 funded job; under 3 it counts in proportion)
//   20 x outside buyers who paid it, 10 = full         (our own test purchases never count)
//   10 if it named a price the last time it was asked
// A part with no evidence yet scores 0 and says "not measured yet" — the score never guesses upward.

import { readPulse } from './pulse.js';
import { readListing, ownerOf, agentWalletOf } from './listing.js';
import { registrationOf } from './hire.js';

const SITE = 'https://brainonbnb.com';
const cache = new Map(); // url -> { at, data }
async function cached(url, ttlMs) {
  const c = cache.get(url);
  if (c && Date.now() - c.at < ttlMs) return c.data;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  const data = await r.json(); cache.set(url, { at: Date.now(), data }); return data;
}

export function evidenceScore({ pulse, jobs, quote }) {
  const parts = [];
  const up = pulse?.last_30d;
  parts.push(up && up.days_measured >= 3
    ? { part: 'uptime', max: 40, points: Math.round(40 * (up.uptime_pct / 100) * 10) / 10, basis: `${up.uptime_pct}% of ${up.days_measured} measured days (our daily pulse)` }
    : { part: 'uptime', max: 40, points: 0, basis: `not measured yet — ${up?.days_measured || 0} of 3 days` });
  const t = jobs?.totals;
  // outside buyers' jobs only: a builder who hires their own agent buys nothing here
  if (t && t.funded_outside > 0) {
    const weight = Math.min(1, t.funded_outside / 3);
    parts.push({ part: 'delivers paid work', max: 30, points: Math.round(30 * ((t.delivery_rate_outside_pct || 0) / 100) * weight * 10) / 10, basis: `${t.delivery_rate_outside_pct}% of ${t.funded_outside} job${t.funded_outside === 1 ? '' : 's'} funded by outside buyers delivered${weight < 1 ? ` (counted at ${Math.round(weight * 100)}% while under 3 jobs)` : ''}` });
  } else parts.push({ part: 'delivers paid work', max: 30, points: 0, basis: t && t.funded ? 'only its owner\'s own test purchases so far — they do not count' : 'no funded escrow job on record' });
  const b = t?.buyers_outside || 0;
  parts.push({ part: 'outside buyers', max: 20, points: Math.round(20 * Math.min(1, Math.log2(1 + b) / Math.log2(11)) * 10) / 10, basis: b ? `${b} wallet${b === 1 ? '' : 's'} not ours paid it` : 'nobody outside has paid it yet' });
  parts.push(quote ? { part: 'names a price', max: 10, points: quote.quotes ? 10 : 0, basis: quote.quotes ? `quoted ${quote.price} when asked` : `did not quote when asked${quote.reason ? ': ' + String(quote.reason).slice(0, 90) : ''}` }
    : { part: 'names a price', max: 10, points: 0, basis: 'not asked: no Hire button on Brain Plaza' });
  return { score: Math.round(parts.reduce((a, p) => a + p.points, 0)), max: 100, parts };
}

export async function agentChart(env, idRaw) {
  const id = String(idRaw || '').replace(/[^0-9]/g, '');
  if (!id) return { status: 400, body: { error: 'GET /chart/<ERC-8004 id on BNB Smart Chain>' } };
  const [index, jobsAll, plaza, rep, pulse, listing, owner, agentWallet] = await Promise.all([
    cached(`${SITE}/api-agents.json`, 30 * 60e3).catch(() => null),
    cached(`${SITE}/api-agent-jobs.json`, 15 * 60e3).catch(() => null),
    cached(`${SITE}/api-plaza-index.json`, 15 * 60e3).catch(() => null),
    cached(`${SITE}/api-reputation.json`, 60 * 60e3).catch(() => null),
    readPulse(env, id), readListing(env, id).catch(() => null), ownerOf(id), agentWalletOf(id),
  ]);
  if (!owner) return { status: 404, body: { error: `#${id} is not registered on the ERC-8004 identity registry on BNB Smart Chain` } };
  let a = (index?.agents || []).find((x) => String(x.id) === id) || null;
  const inCensus = !!a;
  if (!a) { const reg = await registrationOf(Number(id)).catch(() => null); a = reg ? { id: Number(id), name: reg.name, description: reg.description, image: reg.image, endpoints: reg.endpoints, speaks: [], declared_services: reg.services } : { id: Number(id) }; }
  // the census keeps the first ~250 characters of a description; the registration on the chain has all of it
  else if (String(a.description || '').length >= 240) { const reg = await registrationOf(Number(id)).catch(() => null); if (reg?.description && reg.description.length > String(a.description).length) a = { ...a, description: reg.description }; else a = { ...a, description: String(a.description).replace(/\s+\S*$/, '') + '…' }; }
  const jobs = jobsAll?.agents?.[id] || null;
  const shared = jobs?.shared_provider ? jobsAll.providers?.[jobs.shared_provider] || null : null;
  const pz = plaza?.agents?.[id] || null;
  const r = (rep?.agents || []).find((x) => String(x.id) === id) || null;
  const ratings = r ? Object.entries(r.latest || {}).flatMap(([tag, vs]) => vs.map((v) => ({ tag, value: v.value, unit: v.unit || '', window: v.window || null, rater: v.client }))).slice(0, 12) : [];
  const listed = listing && listing.status !== 'removed' ? { verified_and_maintained: listing.status === 'verified', since: listing.since, ...(listing.house ? { ours: true } : {}), profile: `https://agent.brainonbnb.com/listed/${id}` } : null;
  return { status: 200, body: {
    id: Number(id), name: a.name || null, description: a.description || null, image: a.image || null,
    owner, agent_wallet: agentWallet, in_census: inCensus,
    speaks: a.speaks || [], endpoints: a.endpoints || [],
    services: (a.declared_services || []).filter((s) => s && s.endpoint).map((s) => ({ name: s.name, endpoint: s.endpoint })).slice(0, 12),
    tools: (a.tools || []).map((t) => t.name || t).slice(0, 30), skills: (a.skills || []).slice(0, 20),
    plaza: pz, listed,
    pulse,
    jobs: jobs ? { provider: jobs.provider, attributed_by: jobs.attributed_by, totals: jobs.totals, by_day: jobs.by_day || [], trades: jobs.trades } : null,
    shared_provider: shared ? { address: jobs.shared_provider, agents: shared.agents, totals: shared.totals, note: shared.note } : null,
    ratings, raters: r?.raters || 0,
    // its state as our last check found it, and how to be told when it changes (agent-watch.js)
    state: JSON.parse((await env.AGENT.get(`agentstate:${id}`)) || 'null'),
    watch: { how: 'POST https://agent.brainonbnb.com/agent-watch {"agent":"' + id + '","callback":"https://your.server/hook"}', sends: '{agent, state: "down"|"up", at, was, since, chart} on every change', checked: listed ? 'every hour (listed) and once a day' : 'once a day' },
    evidence: evidenceScore({ pulse, jobs, quote: pz?.quote }),
    sources: {
      registration: 'ERC-8004 identity registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 (BNB Smart Chain)',
      pulse: 'agent.brainonbnb.com/pulse/' + id, jobs: `${SITE}/api-agent-jobs.json (measured ${jobsAll?.measured_at || '—'})`,
      plaza: `${SITE}/registry`, ratings: 'ERC-8004 ReputationRegistry, read in full',
    },
    measured_at: new Date().toISOString(),
  } };
}

// WHO IS THE MOST RELIABLE ONE (agent chart phase 3, 2026-10-12): the agents Brain Plaza files under a category, ordered
// by the same evidence score as their charts. For machines first — "the most reliable health-factor agent on BNB Chain"
// is one call — and the same answer a person gets by opening the charts one by one. Only firm filings count ("possibly
// related" stays out); a listing changes nothing here.
export async function agentRank(env, categoryRaw, limitRaw) {
  const ALIAS = { 'health-factor-monitoring': 'health-factor', yield: 'yield-optimization', 'yield-optimisation': 'yield-optimization', grid: 'grid-trading', rebalance: 'rebalancing' };
  const c = String(categoryRaw || '').trim().toLowerCase(); const category = ALIAS[c] || c;
  const limit = Math.min(25, Math.max(1, Number(limitRaw) || 10));
  const [jobsAll, plaza] = await Promise.all([cached(`${SITE}/api-agent-jobs.json`, 15 * 60e3), cached(`${SITE}/api-plaza-index.json`, 15 * 60e3)]);
  const cats = new Set(Object.values(plaza.agents || {}).flatMap((p) => p.categories.map((x) => x.id)));
  if (!cats.has(category)) return { status: 400, body: { error: `unknown category "${c}"`, categories: [...cats] } };
  const ids = Object.entries(plaza.agents).filter(([, p]) => p.categories.some((x) => x.id === category && !x.weak)).map(([id]) => id);
  const rows = await Promise.all(ids.map(async (id) => {
    const p = plaza.agents[id]; const pulse = await readPulse(env, id); const jobs = jobsAll.agents?.[id] || null;
    const ev = evidenceScore({ pulse, jobs, quote: p.quote }); const t = jobs?.totals;
    const listing = await readListing(env, id).catch(() => null);
    return { id: Number(id), score: ev.score, parts: Object.fromEntries(ev.parts.map((x) => [x.part, x.points])),
      uptime_30d_pct: pulse.last_30d.uptime_pct, days_measured: pulse.last_30d.days_measured, median_ms: pulse.last_30d.median_ms,
      outside_jobs_delivered_pct: t?.delivery_rate_outside_pct ?? null, outside_buyers: t?.buyers_outside || 0,
      quote: p.quote?.quotes ? p.quote.price : null, hire: p.hire, ours: !!p.ours,
      listed: listing && listing.status !== 'removed' ? { verified_and_maintained: listing.status === 'verified' } : null,
      chart: `${SITE}/agent/${id}`, data: `https://agent.brainonbnb.com/chart/${id}` };
  }));
  rows.sort((a, b) => b.score - a.score || b.outside_buyers - a.outside_buyers || a.id - b.id);
  return { status: 200, body: { category, ranked_by: 'evidence score (40 uptime 30d · 30 outside delivery rate · 20 outside buyers · 10 names a price) — the same as each agent\'s chart; a listing never changes it', agents: rows.slice(0, limit), of: rows.length, measured_at: new Date().toISOString() } };
}
