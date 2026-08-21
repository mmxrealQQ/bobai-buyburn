// A handful of real questions, asked of real agents, once a day.
//
// The session log is the part of Brain Plaza that makes the rest mean anything:
// a directory lists what an operator says about itself, and only the log says
// whether it delivers. But a log that fills up at the speed of organic traffic
// says nothing for months — four entries and three operators is a promise, not
// a record.
//
// So the router asks a few questions of its own each day. Not synthetic pings:
// the same broker, the same read-only rule, the same recording as any caller
// gets, because a check that takes a different path is not checking the thing
// people use. What is different is the label — every entry that comes from here
// is marked as our own scheduled check, and the track record states how many of
// an operator's answers came from us. Padding a reliability score with our own
// cron and presenting the total as demand would be exactly the kind of number
// this project exists not to publish.
//
// Cost and courtesy, which are the same constraint here:
//   Three tasks a day, rotating, at most three agents tried per task. That is a
//   few calls against endpoints whose whole purpose is to be called, and it
//   stays far inside the free plan's fifty outbound requests per invocation.
//   Asking more often would tell us nothing new — an agent that answered an
//   hour ago is not meaningfully more proven than one that answered yesterday —
//   and would put load on other people's servers for our benefit.

import { handleDispatch } from './dispatch.js';

// Ordinary questions, phrased the way somebody would actually ask them, and
// spread across subjects so the rotation reaches different kinds of agent
// rather than the same three every time. All read-only by construction: the
// dispatcher would refuse an action anyway, and a check that trips its own
// safety rule tests nothing.
// Every one of these was tried against the live index before it went in, and
// the ones that never landed were dropped rather than left in to fail daily.
// What separates them is not the subject but the shape: the router refuses to
// invent arguments for somebody else's tool, so a question that maps to
// get_position_by_id can never be dispatched, while one that maps to a tool
// taking no required input can. A rotation that mostly produces "the best
// matching tool needs arguments" would record nothing and look like an outage.
const TASKS = [
  'get protocol stats for a dex on bnb chain',
  'find stablecoin payment endpoints',
  'list endpoints you expose',
  'show protocol overview',
];
// Four, not eight. "look up token metadata on bsc" was dropped because the only
// agent that could answer it was our own, and "list active agents" because the
// one that used to had stopped. Both are worth adding back the day somebody
// else can serve them — the list is short on purpose, and grows by measurement.

const PER_RUN = 3;
const KEY = 'canary:cursor';

export async function runCanary(env) {
  const cursor = Number((await env.AGENT.get(KEY)) || 0) || 0;
  const url = new URL('https://agent.brainonbnb.com/dispatch');

  const done = [];
  for (let i = 0; i < PER_RUN; i++) {
    const task = TASKS[(cursor + i) % TASKS.length];
    try {
      // probe:true is the only thing that separates this from a stranger's
      // call. Everything else — candidate selection, the read-only filter, the
      // 12 KB cap, the recording — is the identical code path.
      const r = await handleDispatch(url, { task }, env, { probe: true, excludeOperator: 'brainonbnb.com' });
      done.push({ task, dispatched: !!r.body?.dispatched, by: r.body?.answered_by?.operator || null });
    } catch (e) {
      // A failed probe must never take the scheduled run down with it: the
      // watch checks that share this cron are somebody's paid service.
      done.push({ task, dispatched: false, error: String(e?.message || e).slice(0, 80) });
    }
  }

  // One write, and only after the batch — so a run that dies halfway repeats
  // the same three tasks tomorrow rather than skipping them silently.
  await env.AGENT.put(KEY, String((cursor + PER_RUN) % TASKS.length));
  return { asked: done.length, answered: done.filter((d) => d.dispatched).length, done };
}
