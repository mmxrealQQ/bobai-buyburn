// Turns the raw ERC-8183 job scan into an employment balance.
//
// One implementation, used by both the terminal report and the published page.
// The rule is the same one that made the BNB price a single Chainlink read
// across every surface: a figure that appears in two places must be computed
// once, or the two places will eventually disagree and both will look wrong.
//
// Every judgement call this file makes is written down here rather than in the
// consumer, because they are the whole substance of the measurement:
//
//   OPEN means created and never funded. createJob costs nothing and commits
//   nobody. Counting an OPEN job as employment is how 56,655 becomes a headline.
//
//   SUBMITTED means a deliverable is on-chain and the escrow has NOT released.
//   It is evidence of work, not of accepted work, and it is never folded into
//   completions.
//
//   The delivery rate is completions over FUNDED jobs, not over all jobs. A
//   provider is not responsible for jobs a buyer created and abandoned.
//
//   A provider address is only interesting once. Ten thousand jobs from one
//   address at one cent each is a load test, and the aggregate says so by
//   carrying median budget and distinct buyers next to the job count.

import fs from 'node:fs';

const ZERO = '0x0000000000000000000000000000000000000000';

export const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// The scan file is append-only and a resumed run can re-append an id, so the
// last write per id wins. Without this a restart double-counts an employment
// history — silently, because both copies are correct.
export function loadJobs(file) {
  const jobs = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const j = JSON.parse(line); jobs.set(j.id, j); } catch { /* skip a torn line */ }
  }
  return jobs;
}

export function aggregate(jobs) {
  const byStatus = {};
  const providers = new Map();
  const clients = new Set();
  let escrowed = 0n;
  let fundedJobs = 0;

  for (const j of jobs.values()) {
    byStatus[j.status] = (byStatus[j.status] || 0) + 1;
    clients.add(j.client);
    const isFunded = j.status !== 'OPEN';
    if (isFunded) { escrowed += BigInt(j.budget); fundedJobs++; }

    const p = j.provider;
    if (!p || p === ZERO) continue;
    let r = providers.get(p);
    if (!r) {
      r = {
        addr: p, jobs: 0, funded: 0, sum: 0n, budgets: [], clients: new Set(),
        status: {}, firstId: j.id, lastId: j.id, lastSubmit: 0, samples: [],
      };
      providers.set(p, r);
    }
    r.jobs++;
    r.status[j.status] = (r.status[j.status] || 0) + 1;
    r.clients.add(j.client);
    if (isFunded) { r.funded++; r.sum += BigInt(j.budget); r.budgets.push(Number(BigInt(j.budget)) / 1e18); }
    if (j.id < r.firstId) r.firstId = j.id;
    if (j.id > r.lastId) r.lastId = j.id;
    if (j.submitted_at > r.lastSubmit) r.lastSubmit = j.submitted_at;
    if (r.samples.length < 3 && j.desc) r.samples.push(j.desc);
  }

  const ranked = [...providers.values()]
    .map((r) => ({
      address: r.addr,
      jobs: r.jobs,
      funded: r.funded,
      completed: r.status.COMPLETED || 0,
      submitted_not_released: r.status.SUBMITTED || 0,
      awaiting_delivery: r.status.FUNDED || 0,
      expired: r.status.EXPIRED || 0,
      rejected: r.status.REJECTED || 0,
      never_funded: r.status.OPEN || 0,
      distinct_buyers: r.clients.size,
      escrowed_u: Number(r.sum) / 1e18,
      median_budget_u: median(r.budgets),
      delivery_rate: r.funded ? (r.status.COMPLETED || 0) / r.funded : 0,
      first_job_id: r.firstId,
      last_job_id: r.lastId,
      last_submission: r.lastSubmit || null,
      samples: r.samples,
    }))
    .sort((a, b) => b.jobs - a.jobs);

  const total = jobs.size;
  const top1 = ranked[0]?.jobs || 0;
  const top5 = ranked.slice(0, 5).reduce((s, r) => s + r.jobs, 0);

  return {
    total,
    byStatus,
    completed: byStatus.COMPLETED || 0,
    submitted: byStatus.SUBMITTED || 0,
    open: byStatus.OPEN || 0,
    fundedJobs,
    escrowedU: Number(escrowed) / 1e18,
    buyers: clients.size,
    providers: ranked,
    concentration: {
      top_provider_share: total ? top1 / total : 0,
      top5_share: total ? top5 / total : 0,
    },
    // The number worth putting on a page: providers that ever finished a job
    // for somebody who was not their only customer. Everything else in the
    // kernel is a test harness, a load generator, or an abandoned draft.
    providersWithRealWork: ranked.filter((r) => r.completed > 0 && r.distinct_buyers > 1).length,

    // The rest of the chain, with the single dominant address removed. This is
    // the honest denominator for anybody deciding whether to build here, and it
    // is not a rhetorical trick: one campaign address holds the overwhelming
    // majority of jobs at a cent apiece, and leaving it in describes that one
    // campaign rather than the market around it. Both figures are published,
    // so the subtraction can be checked rather than taken on trust.
    withoutTopProvider: ranked.length ? {
      excluded_address: ranked[0].address,
      jobs: total - ranked[0].jobs,
      completed: (byStatus.COMPLETED || 0) - ranked[0].completed,
      escrowed_u: Number((Number(escrowed) / 1e18 - ranked[0].escrowed_u).toFixed(6)),
      providers: ranked.length - 1,
    } : null,
  };
}
