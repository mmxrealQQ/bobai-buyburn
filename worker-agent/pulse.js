// THE PULSE — the history under every agent's chart (Brain Plaza agent chart, phase 1, 2026-10-12).
//
// A DexScreener chart needs history, and nobody keeps any for agents: the
// census says who answered on the day it ran, 8004scan shows a score, and
// neither says whether an agent has been up every day for a month. So from
// today every agent in the census index (the ones that answered our last full
// probe, ~950) is asked once a day, spread over the day, and the answer is kept
// for 90 days: did it answer, how fast, by which door.
//
// POLITE BY DESIGN. One light request per agent per day — an MCP initialize,
// or the agent card's GET — never a task, never a payment, never a message that
// shows up in somebody's session log as a job. About ten agents per 15-minute
// tick, in turn, so a host with many ids (fleets of 200+) is never asked for
// all of them at once.
//
// STORED: KV `pulse:<id>` = [[day, ok 1/0, ms, via], …] newest last, at most
// 90 days; `pulse:cursor` = where the round stands. GET /pulse/<id> serves one
// agent's series with its 7- and 30-day uptime and median response time.

import { noteAgentState } from './agent-watch.js';

const AGENTS_URL = 'https://brainonbnb.com/api-agents.json';
export const PULSE_PER_TICK = 11;   // 96 ticks a day x 11 = 1,056 >= the ~950 in the index
const KEEP_DAYS = 90;
const TIMEOUT_MS = 12000;

let idx = { at: 0, list: null };
async function agents() {
  if (!idx.list || Date.now() - idx.at > 6 * 3600e3) {
    const r = await fetch(AGENTS_URL, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('index ' + r.status);
    const j = await r.json();
    idx = { at: Date.now(), list: (j.agents || j).map((a) => ({ id: a.id, endpoints: a.endpoints || [], speaks: a.speaks || [], card: a.agent_card || null,
      services: (a.declared_services || []).filter((s) => s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint)) })).sort((a, b) => a.id - b.id) };
  }
  return idx.list;
}

// The door the agent names itself first (its "MCP" / "A2A" service), as the census does; then a /mcp endpoint; then
// <origin>/mcp for an agent that speaks MCP (2026-10-12: #49467 speaks MCP at /mcp but lists its homepage first —
// asking the homepage answered 405 and read as "down").
const svc = (a, re) => a.services.find((s) => re.test(String(s.name || '')))?.endpoint || null;
const mcpUrl = (a) => svc(a, /^mcp$/i) || a.endpoints.find((e) => /\/mcp(\/|$|\?)/i.test(e))
  || (a.speaks.includes('mcp') && a.endpoints[0] ? (() => { try { return new URL(a.endpoints[0]).origin + '/mcp'; } catch { return null; } })() : null);
const cardUrl = (a) => (typeof a.card === 'string' ? a.card : a.card?.url) || [svc(a, /^(a2a|agentcard|agent-card)$/i)].find((e) => e && /agent-card\.json$|\.well-known\/agent/i.test(e))
  || a.endpoints.find((e) => /agent-card\.json$|\.well-known\/agent/i.test(e))
  || (a.speaks.includes('a2a') && a.endpoints[0] ? (() => { try { return new URL(a.endpoints[0]).origin + '/.well-known/agent-card.json'; } catch { return null; } })() : null);

// One look at one agent: the protocol it speaks, else its card, else its first endpoint at all.
export async function pulseOne(a) {
  const t0 = Date.now();
  const done = (ok, via, status) => ({ ok: ok ? 1 : 0, ms: Date.now() - t0, via, status });
  try {
    const m = mcpUrl(a);
    if (m) {
      const r = await fetch(m, { method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'brain-plaza-pulse', version: '1.0' } } }) });
      const t = await r.text();
      if (r.ok && /"result"/.test(t)) return done(true, 'mcp', r.status);
      if (!cardUrl(a)) return done(false, 'mcp', r.status); // no other door to try
    }
    const c = cardUrl(a);
    if (c) {
      const r = await fetch(c, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
      const j = r.ok ? await r.json().catch(() => null) : null;
      return done(!!(j && (j.name || j.skills || j.url)), 'card', r.status);
    }
    if (a.endpoints[0]) {
      const r = await fetch(a.endpoints[0], { signal: AbortSignal.timeout(TIMEOUT_MS) });
      return done(r.status < 500, 'http', r.status);
    }
    return done(false, 'none', 0);
  } catch (e) {
    return done(false, 'error', 0);
  }
}

export async function runPulseTick(env, n = PULSE_PER_TICK) {
  const list = await agents();
  if (!list.length) return { skipped: 'empty index' };
  const today = new Date().toISOString().slice(0, 10);
  let cur = Number((await env.AGENT.get('pulse:cursor')) || 0) % list.length;
  const batch = []; for (let i = 0; i < Math.min(n, list.length); i++) batch.push(list[(cur + i) % list.length]);
  const res = await Promise.all(batch.map(async (a) => [a, await pulseOne(a)]));
  // THE SCREENER'S ROW (2026-10-12): one compact summary of every agent, kept up to date here, so a table of ~950 agents
  // reads one key instead of ~950: [uptime 7d, uptime 30d, days measured 30d, median ms 30d, last ok, last day, last 14 days as "1/0/-"]
  const sum = JSON.parse((await env.AGENT.get('pulse:summary')) || '{}');
  for (const [a, p] of res) {
    const key = `pulse:${a.id}`;
    const s = JSON.parse((await env.AGENT.get(key)) || '[]').filter((x) => x[0] !== today);
    s.push([today, p.ok, p.ms, p.via]);
    const kept = s.slice(-KEEP_DAYS);
    await env.AGENT.put(key, JSON.stringify(kept));
    await noteAgentState(env, a.id, !!p.ok, 'daily pulse').catch(() => null); // agent-watch.js: an alarm on a change
    const s7 = summarize(kept, 7), s30 = summarize(kept, 30), byDay = new Map(kept.map((x) => [x[0], x[1]]));
    const spark = Array.from({ length: 14 }, (_, i) => { const d = new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10); return byDay.has(d) ? (byDay.get(d) ? '1' : '0') : '-'; }).join('');
    sum[a.id] = [s7.uptime_pct, s30.uptime_pct, s30.days_measured, s30.median_ms, p.ok ? 1 : 0, today, spark];
  }
  await env.AGENT.put('pulse:summary', JSON.stringify(sum));
  await env.AGENT.put('pulse:cursor', String((cur + batch.length) % list.length));
  return { asked: res.map(([a, p]) => [a.id, p.ok, p.ms, p.via]) };
}

// Uptime and the median response time over the last `days` days that were measured.
export function summarize(series, days) {
  const cut = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const s = series.filter((x) => x[0] >= cut);
  const ok = s.filter((x) => x[1]);
  const ms = ok.map((x) => x[2]).sort((a, b) => a - b);
  return { days_measured: s.length, uptime_pct: s.length ? Math.round((ok.length / s.length) * 1000) / 10 : null, median_ms: ms.length ? ms[Math.floor(ms.length / 2)] : null };
}

export async function readPulse(env, id) {
  const series = JSON.parse((await env.AGENT.get(`pulse:${id}`)) || '[]');
  return {
    id: Number(id), series: series.map(([day, ok, ms, via]) => ({ day, ok: !!ok, ms, via })),
    last_7d: summarize(series, 7), last_30d: summarize(series, 30), last_90d: summarize(series, 90),
    method: 'Once a day, spread over the day: an MCP initialize if the agent speaks MCP, else a GET of its agent card, else its first endpoint. No task, no payment. ok = a real answer (an MCP result, a card with a name or skills, or any non-5xx response for a plain endpoint).',
    since: series[0]?.[0] || null,
  };
}

// The summary rebuilt from every series on record (once, after the summary was introduced; safe to repeat).
export async function rebuildPulseSummary(env) {
  const sum = {}; let cursor;
  do {
    const page = await env.AGENT.list({ prefix: 'pulse:', cursor });
    for (const k of page.keys) {
      const id = k.name.slice(6); if (!/^\d+$/.test(id)) continue;
      const kept = JSON.parse((await env.AGENT.get(k.name)) || '[]'); if (!kept.length) continue;
      const s7 = summarize(kept, 7), s30 = summarize(kept, 30), byDay = new Map(kept.map((x) => [x[0], x[1]])), last = kept[kept.length - 1];
      const spark = Array.from({ length: 14 }, (_, i) => { const d = new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10); return byDay.has(d) ? (byDay.get(d) ? '1' : '0') : '-'; }).join('');
      sum[id] = [s7.uptime_pct, s30.uptime_pct, s30.days_measured, s30.median_ms, last[1] ? 1 : 0, last[0], spark];
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  await env.AGENT.put('pulse:summary', JSON.stringify(sum));
  return { agents: Object.keys(sum).length };
}
