// AGENT WATCH — an alarm when an agent you rely on goes down, and when it is back (agent chart phase 4, 2026-10-12).
//
// Rug Watch tells a holder when a token turns against them; this tells whoever depends on an agent when it stops
// answering. Free, for any agent on BNB Chain, webhook only (as Rug Watch): POST /agent-watch {agent, callback} and
// the callback receives {agent, state: "down"|"up", at, chart} on every change.
//   - every agent: from the daily pulse (pulse.js calls noteAgentState after each measurement)
//   - a LISTED agent: also every hour (runListedLive), so the alarm and its profile follow within the hour
// A change is only a change against the state we last recorded, so one bad minute after a good day is one alarm,
// not one per check, and nothing is sent for an agent that was down when the watch was made.

const MAX_PER_AGENT = 25;
const MAX_TOTAL_PER_CALLBACK = 20;

export async function addAgentWatch(env, body) {
  const id = String(body?.agent ?? '').replace(/[^0-9]/g, '');
  const cb = String(body?.callback || '').trim();
  if (!id) return { status: 400, body: { error: 'agent: the ERC-8004 id on BNB Smart Chain' } };
  let u; try { u = new URL(cb); } catch { return { status: 400, body: { error: 'callback: an https:// URL that accepts a POST' } }; }
  if (u.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)) return { status: 400, body: { error: 'callback must be a public https:// URL' } };
  const key = `agentwatch:${id}`;
  const list = JSON.parse((await env.AGENT.get(key)) || '[]');
  if (list.some((w) => w.cb === cb)) return { status: 200, body: { ok: true, agent: Number(id), already: true } };
  if (list.length >= MAX_PER_AGENT) return { status: 429, body: { error: `this agent has ${MAX_PER_AGENT} watches already` } };
  const per = JSON.parse((await env.AGENT.get(`agentwatchcb:${cb}`)) || '[]');
  if (per.length >= MAX_TOTAL_PER_CALLBACK) return { status: 429, body: { error: `this callback watches ${MAX_TOTAL_PER_CALLBACK} agents already` } };
  list.push({ cb, since: new Date().toISOString() }); per.push(id);
  await env.AGENT.put(key, JSON.stringify(list)); await env.AGENT.put(`agentwatchcb:${cb}`, JSON.stringify(per));
  const ids = JSON.parse((await env.AGENT.get('agentwatch:ids')) || '[]'); if (!ids.includes(id)) { ids.push(id); await env.AGENT.put('agentwatch:ids', JSON.stringify(ids)); }
  return { status: 200, body: { ok: true, agent: Number(id), callback: cb, sends: '{agent, state: "down"|"up", at, chart} on every change', from: 'the daily pulse; a listed agent every hour', remove: 'DELETE /agent-watch with the same body' } };
}

export async function removeAgentWatch(env, body) {
  const id = String(body?.agent ?? '').replace(/[^0-9]/g, ''), cb = String(body?.callback || '').trim();
  const key = `agentwatch:${id}`; const list = JSON.parse((await env.AGENT.get(key)) || '[]').filter((w) => w.cb !== cb);
  await env.AGENT.put(key, JSON.stringify(list));
  const per = JSON.parse((await env.AGENT.get(`agentwatchcb:${cb}`)) || '[]').filter((x) => x !== id);
  await env.AGENT.put(`agentwatchcb:${cb}`, JSON.stringify(per));
  return { status: 200, body: { ok: true, removed: true } };
}

// Record an agent's state; on a change, tell its watchers. `ok` is the latest measurement.
export async function noteAgentState(env, id, ok, source) {
  const key = `agentstate:${id}`; const prev = JSON.parse((await env.AGENT.get(key)) || 'null');
  const state = ok ? 'up' : 'down', at = new Date().toISOString();
  if (prev && prev.state === state) return null;
  await env.AGENT.put(key, JSON.stringify({ state, at, source }));
  if (!prev) return null; // the first record is a baseline, not a change
  const list = JSON.parse((await env.AGENT.get(`agentwatch:${id}`)) || '[]');
  const payload = { agent: Number(id), state, at, was: prev.state, since: prev.at, source, chart: `https://brainonbnb.com/agent/${id}`, from: 'Brain Plaza agent watch' };
  await Promise.all(list.map((w) => fetch(w.cb, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'BrainPlaza-AgentWatch/1.0' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) }).catch(() => null)));
  return { changed: true, state, notified: list.length };
}
