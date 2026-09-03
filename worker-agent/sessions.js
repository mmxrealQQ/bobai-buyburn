// The public record of every task this router has passed on.
//
// This is the part of the Plaza that makes the rest mean anything. A directory
// lists what an operator says about itself. A broker matches those claims to a
// question. Neither can tell you whether the agent actually delivers — and that
// is the only thing a person hiring one wants to know.
//
// So every dispatch is written down: what was asked, who was asked, how long
// they took, and what came back or why nothing did. Nobody reports their own
// score. The score is the log.
//
// Two design points that matter more than they look:
//
//   Failures are kept, and kept visible. A record that only shows successes is
//   marketing. The useful signal is precisely the agent that stopped answering
//   last Tuesday, and hiding that would make the whole thing worthless.
//
//   The task text is stored, the answer is not. What an agent returned can be
//   long, can contain anything, and belongs to whoever asked. We keep the shape
//   of the exchange — tool, duration, success — and a short excerpt, never the
//   full payload.
//
// COST: one read and one write per dispatch, on an account near the free-plan
// KV limit. All sessions live in a single rolling key rather than one key each,
// which is the difference between two operations a day and two thousand.

const KEY = 'plaza:sessions';
export const MAX_SESSIONS = 400;
const EXCERPT = 220;

export async function recordSession(env, entry) {
  try {
    const log = JSON.parse((await env.AGENT.get(KEY)) || '[]');
    log.push({
      at: new Date().toISOString(),
      task: String(entry.task || '').slice(0, 160),
      operator: entry.operator || null,
      agent: entry.agent || null,
      tool: entry.tool || null,
      ms: entry.ms ?? null,
      ok: !!entry.ok,
      // Why it did not work is the part worth keeping. "no read-only tool
      // matched" and "did not answer" are different facts about an operator,
      // and collapsing them into "failed" throws away the useful half.
      outcome: String(entry.outcome || (entry.ok ? 'answered' : 'no result')).slice(0, 120),
      // Set when the task came from our own daily check rather than from
      // somebody with a real question. Kept because the alternative — letting
      // scheduled probes pad the same counter as organic traffic — would make
      // the record describe our cron instead of the operators.
      ...(entry.probe ? { probe: true } : {}),
      excerpt: entry.excerpt ? String(entry.excerpt).replace(/\s+/g, ' ').slice(0, EXCERPT) : null,
    });
    while (log.length > MAX_SESSIONS) log.shift();
    await env.AGENT.put(KEY, JSON.stringify(log));
  } catch { /* a lost log entry must never fail the dispatch it describes */ }
}

export async function readSessions(env) {
  try { return JSON.parse((await env.AGENT.get(KEY)) || '[]'); }
  catch { return []; }
}

// The track record, derived rather than declared. Every number here comes from
// the log above; there is no field an operator can set.
export function trackRecord(sessions) {
  const by = new Map();
  for (const s of sessions) {
    const k = s.operator || s.agent;
    if (!k) continue;
    if (!by.has(k)) by.set(k, { operator: k, agent: s.agent, asked: 0, answered: 0, probes: 0, times: [], tools: new Set(), last: null, failures: [] });
    const r = by.get(k);
    r.asked++;
    if (s.probe) r.probes++;
    if (s.ok) {
      r.answered++;
      if (s.tool) r.tools.add(s.tool);
      if (typeof s.ms === 'number') r.times.push(s.ms);
    } else if (r.failures.length < 3 && !r.failures.includes(s.outcome)) {
      // Distinct reasons, not the same one three times over.
      r.failures.push(s.outcome);
    }
    if (!r.last || s.at > r.last) r.last = s.at;
  }
  return [...by.values()]
    .map((r) => ({
      operator: r.operator,
      agent: r.agent,
      tasks_routed: r.asked,
      answered: r.answered,
      // Stated as a fraction, not a percentage, while the counts are small.
      // "67%" off three attempts reads as a measurement; "2 of 3" reads as
      // what it is.
      reliability: `${r.answered} of ${r.asked}`,
      // Said out loud rather than hidden, because a record built mostly from
      // our own scheduled checks means something different from one built from
      // strangers' questions, and the reader is entitled to tell them apart.
      ...(r.probes ? { of_which_our_scheduled_checks: r.probes } : {}),
      // A real median. The field carried this name from the start but was a
      // mean until 2026-09-03 — one 9-second answer among twenty 150 ms ones
      // read as "600 ms", which is a number no single request ever took.
      median_ms: r.times.length ? (() => { const t = [...r.times].sort((a, b) => a - b); const m = t.length >> 1; return Math.round(t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2); })() : null,
      tools_used: [...r.tools].slice(0, 8),
      last_seen: r.last,
      ...(r.failures.length ? { recent_failures: r.failures } : {}),
    }))
    // Coerced: the operator key arrives as whatever the caller passed, and an
    // agent id is a number. localeCompare on a number throws, which took the
    // whole endpoint down with a 500 the first time a session was recorded.
    .sort((a, b) => b.answered - a.answered || String(a.operator).localeCompare(String(b.operator)));
}
