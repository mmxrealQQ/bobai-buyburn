// Where one of our ERC-8183 jobs stands, decided once.
//
// Shared by scripts/erc8183-job-watch.mjs (a person at a keyboard) and
// worker-agent/own-jobs.js (the daily cron). The rule that decides whether a
// job is "waiting" or "settleable" is the rule a judge will read our own
// completion rate by; two copies of it is how the page and the record drift.
// Pure functions only: no chain, no clock of their own, no I/O.

// The kernel's enum, order-locked (see worker-agent/hire.js JOB_STATUS).
//   waiting     SUBMITTED, dispute window still running
//   settleable  SUBMITTED, window over, nobody has called settle
//   completed   COMPLETED — the escrow released
//   undelivered FUNDED with no submission; refundable after expiry
//   open        OPEN, never funded; expires on its own
//   closed      REJECTED / EXPIRED
//   unreadable  the kernel returned nothing for this id
export function classify(job, { now, windowSec }) {
  if (!job) return { state: 'unreadable', note: 'the kernel returned nothing for this id' };
  const s = job.status;
  if (s === 'COMPLETED') return { state: 'completed', note: 'the escrow released' };
  if (s === 'SUBMITTED') {
    const ends = job.submitted_at + windowSec;
    if (now < ends) return { state: 'waiting', ends_at: ends, note: `dispute window ends in ${hours(ends - now)}` };
    return { state: 'settleable', ends_at: ends, note: `window ended ${hours(now - ends)} ago and nobody has called settle` };
  }
  if (s === 'FUNDED') {
    return now >= job.expired_at
      ? { state: 'undelivered', note: 'funded, never delivered, past expiry — the buyer can claimRefund' }
      : { state: 'undelivered', note: `funded, not yet delivered, expires in ${hours(job.expired_at - now)}` };
  }
  if (s === 'OPEN') return { state: 'open', note: now >= job.expired_at ? 'never funded, past expiry' : 'never funded' };
  return { state: 'closed', note: String(s).toLowerCase() };
}

export const hours = (sec) => {
  const h = sec / 3600;
  return h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(1)} h`;
};

// The record: one entry per job, a history of every state it has been seen
// in. A state seen twice is not written twice — the history is of transitions,
// so the first COMPLETED carries the timestamp it was first observed.
export function recordTransition(record, id, snapshot, at) {
  const entry = record[id] || { history: [] };
  const last = entry.history[entry.history.length - 1];
  const changed = !last || last.status !== snapshot.status || last.state !== snapshot.state;
  if (changed) entry.history = entry.history.concat({ at, ...snapshot });
  return { record: { ...record, [id]: entry }, changed };
}

// Two records of the same jobs — the worker's and a person's — into one.
// Union of histories by (at, status, state), sorted by time, so a transition
// the cron saw at 21:00 and a person saw at 23:00 is one transition with the
// earlier timestamp first, and neither side loses what only it observed.
export function mergeRecords(a, b) {
  const out = {};
  for (const id of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const seen = new Set();
    const hist = [];
    for (const h of [...(a?.[id]?.history || []), ...(b?.[id]?.history || [])]) {
      const k = `${h.at}|${h.status}|${h.state}`;
      if (seen.has(k)) continue;
      seen.add(k);
      hist.push(h);
    }
    hist.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
    // Collapse consecutive duplicates of the same status+state that came from
    // two observers: only the first sighting of a state is a transition.
    const collapsed = [];
    for (const h of hist) {
      const last = collapsed[collapsed.length - 1];
      if (last && last.status === h.status && last.state === h.state) continue;
      collapsed.push(h);
    }
    out[id] = { history: collapsed };
  }
  return out;
}

// What the record says in one line each, for a page or a log.
export function summarise(record, now) {
  const ids = Object.keys(record || {});
  const latest = (id) => record[id].history[record[id].history.length - 1];
  const completed = ids.filter((id) => latest(id)?.state === 'completed');
  const settleable = ids.filter((id) => latest(id)?.state === 'settleable');
  const waiting = ids.filter((id) => latest(id)?.state === 'waiting');
  return {
    jobs: ids.length,
    completed, settleable, waiting,
    first_completed_seen: completed.map((id) => record[id].history.find((h) => h.state === 'completed')?.at).filter(Boolean).sort()[0] || null,
    checked_at: now,
  };
}
