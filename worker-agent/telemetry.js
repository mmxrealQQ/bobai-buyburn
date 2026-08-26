// Live state, asked of the agents themselves, on a schedule.
//
// A directory that prints a name, a category and a price is a card index. What
// decides a hire is none of those: it is whether the thing is answering right
// now, what it currently costs to use, and what it is currently seeing. That is
// the difference between "BNB Lending Guardian, health-factor monitoring" and
// "BNB Lending Guardian, answering, risk SAFE, checked four minutes ago".
//
// WHY A NAMED LIST AND NOT A SWEEP
// 784 endpoints in the census answer something. Polling all of them every
// fifteen minutes to decorate a page is a load we would be putting on other
// people's servers for our own benefit, and it is the same discourtesy the
// canary is deliberately small to avoid. So this asks the set that a buyer is
// actually choosing between — the four BNB Agent Studio reference agents and
// our own two — and says so on the page rather than implying chain-wide reach.
//
// WHY 404 IS A RESULT AND NOT AN ERROR
// Measured 2026-08-25: two of the four reference agents serve /status and two
// answer 404 on every state path they have (/status, /health, /state, /info;
// GET / is 405 — they are A2A endpoints and nothing else). "This agent exposes
// no live state" is a true and useful thing to know before hiring it, so it is
// recorded and displayed. Hiding it would leave a blank that reads like our
// poller broke.
//
// A MEASUREMENT TRAP, PAID FOR ONCE
// All four hosts answer plain http:// with a 301 to https. A poller that does
// not follow redirects records four dead agents and a poller that follows them
// silently records the redirect body. Both are wrong and both look fine. The
// URLs below are https from the start.
//
// WHAT WE DO NOT DO WITH THE NUMBERS
// A peer's /status is that peer's claim about itself. It is stored and shown as
// theirs, timestamped, and never folded into anything this project states as
// measured. The census measures; this quotes.

import { healthFactor } from './venus.js';
import { gridPlan } from './grid.js';
import { yieldPlan } from './yield.js';
import { rebalancePlan } from './rebalance.js';

const KEY = 'telemetry:latest';

// The reference set. Hosts are pinned rather than resolved from the census on
// purpose: these four are a fixed, named cohort — the agents the studio ships
// as its own examples — and a page that says "the reference agents" has to poll
// exactly those and not whatever the last scan happened to rank highest.
const PEERS = [
  { id: 'bnb-yield', name: 'BNB Yield Optimizer', origin: 'https://bnb-yield.172-104-171-139.nip.io' },
  { id: 'bnb-guardian', name: 'BNB Lending Guardian', origin: 'https://bnb-guardian.172-104-171-139.nip.io' },
  { id: 'bnb-lp', name: 'BNB LP Range Rebalancer', origin: 'https://bnb-lp.172-104-171-139.nip.io' },
  { id: 'bnb-grid', name: 'BNB Grid Trader (test)', origin: 'https://bnb-grid.172-104-171-139.nip.io' },
];

// Which fields are worth putting under a row, per category, in the order a
// buyer reads them. Everything a peer returns is stored; this decides what gets
// surfaced, because a status document with twenty fields shown in full is a
// wall of JSON and not information.
//
// The labels are ours. The values are theirs, unconverted — no rounding, no
// unit-fixing, no filling in of a null. A null in their document means they do
// not currently know, and rewriting that as a zero would be inventing a
// measurement.
// The agents we run ourselves, in one place. These ids appear in the domain
// proof on two origins, in the telemetry document, in the registry page's
// live-line mapping and in two check scripts. The first four of those had their
// own literal copy of the list, so registering an agent meant remembering all
// of them — and the one that gets forgotten fails silently, as a row that is
// simply never live.
const OWN_AGENT_IDS = [302257, 302258, 304493, 304494];

const SURFACE = {
  'health-factor': [
    ['health_factor', 'health factor'],
    ['risk', 'risk'],
    ['liquidation_distance', 'distance to liquidation', '%'],
    ['account', 'account watched'],
  ],
  'yield-optimization': [
    ['current_apr', 'current APR', '%'],
    ['best_apr', 'best APR found', '%'],
    ['apr_improvement', 'improvement available', '%'],
    ['risk_score', 'risk score'],
  ],
};

// A peer's own word for what it is. Recorded because it is the strongest
// category evidence there is — the agent saying so itself, live — and it is
// what makes `source: 'declared'` in the classifier true rather than aspirational.
const declaredCategory = (doc) => doc?.category ?? doc?.agent_category ?? doc?.type ?? null;

// TWO DIFFERENT FACTS, AND THE FIRST DRAFT OF THIS CONFLATED THEM
//   reachable       the host answered us at all
//   has_live_state  it answered with a machine-readable document
// A 404 on /status is a reachable host with no live state, and recording that
// as unreachable would say the agent is gone when it is running fine and simply
// does not publish what it is doing. That is the same misreading this project
// spends its time correcting in other people's data — an endpoint returning the
// technically-correct 404 is indistinguishable from a dead one only if you stop
// looking at the status code.
async function askPeer(peer) {
  const at = new Date().toISOString();
  const base = { ...peer, checked_at: at, state: null, declared_category: null };
  try {
    const r = await fetch(`${peer.origin}/status`, {
      headers: { accept: 'application/json' },
      // Short. This runs inside a cron tick that also serves paid watches, and
      // one unresponsive host must not spend the invocation's time budget.
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      return { ...base, reachable: true, has_live_state: false, http: r.status,
        note: r.status === 404 ? 'running, but publishes no live state' : `answered ${r.status}` };
    }
    const text = await r.text();
    let doc = null;
    try { doc = JSON.parse(text); } catch { /* not json */ }
    if (!doc || typeof doc !== 'object') {
      return { ...base, reachable: true, has_live_state: false, http: r.status,
        note: 'answered, but not with a machine-readable document' };
    }
    return { ...base, reachable: true, has_live_state: true, http: r.status,
      state: doc, declared_category: declaredCategory(doc), note: null };
  } catch (e) {
    // A timeout is not a dead agent either, and the two are kept apart so a
    // page can say "did not answer in 8s" instead of "gone".
    const msg = String(e?.message || e);
    return { ...base, reachable: false, has_live_state: false, http: null,
      note: /timeout|abort/i.test(msg) ? 'did not answer within 8 seconds' : `unreachable: ${msg.slice(0, 60)}` };
  }
}

// ---------------------------------------------------------------------------
// Our own two agents.
//
// THE HONEST SHAPE OF THIS
// The reference agents run a loop over a position somebody gave them, so their
// /status is the position. Ours are hired per job and hold nothing between
// jobs, so a /status of ours reporting a health factor would be reporting
// somebody else's position or an invented one. Neither is acceptable.
//
// What is true, useful before hiring, and checkable is the readiness of the
// machinery: can the thing reach the chain right now, does the protocol it
// reads still look the way it expects, and — for the grid planner — what does
// a cycle currently cost on a reference pool, which is the number the service
// exists to produce. That last one is a live market measurement, not a
// self-report, and it is the same code path a paying job runs.

// The only position we may quote without asking anybody: our own provider
// wallet. It has entered no Venus market, so the probe cannot exercise the
// health-factor arithmetic — it proves the chain is reachable, the Comptroller
// answers and the pipeline returns, and it says exactly that rather than
// dressing "no position" up as a clean bill of health.
//
// Naming a stranger's address here to get a livelier number was considered and
// dropped. Venus positions are public, but putting one person's liquidation
// distance on our marketing page because it made the demo better is not a
// trade this project makes.
const SELF_ACCOUNT = '0x73809F69916FcF7Ddc5BB1315fBdf96A569a5963';

// WBNB. The reference pool for the grid probe: the deepest pair on the chain,
// so the break-even spacing it yields is the floor — no BNB Chain grid costs
// less to run than this, and a buyer can read their own pool against it.
const REFERENCE_POOL = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

async function probeHealthFactor(lastJob) {
  const at = new Date().toISOString();
  const started = Date.now();
  try {
    const hf = await healthFactor(SELF_ACCOUNT);
    return {
      ready: true,
      checked_at: at,
      live: {
        chain_reachable: true,
        responded_ms: Date.now() - started,
        venus_markets_entered: hf.has_position ? hf.markets_entered : 0,
        // Only present when the probe account actually holds a position. Shown
        // as null rather than true when it does not, because "our arithmetic
        // agrees with Venus" is a claim the probe did not test today.
        agrees_with_protocol: hf.cross_check?.agrees ?? null,
      },
      // One line, decided here rather than in the page. What a row can show is
      // a sentence, so the sentence is written where the numbers and their
      // caveats both are — a template in the HTML would have to re-derive when
      // a figure is meaningful, and would get it wrong the first time a probe
      // came back empty.
      headline: `Comptroller answering in ${Date.now() - started} ms`,
      measures: 'health factor, liquidation distance and a collateral stress table for any Venus position, market by market',
      // The cross-check is the thing worth trusting this agent for, and the
      // readiness probe cannot demonstrate it on an empty account. The last
      // real delivery can, so it is carried alongside instead of implied.
      proven_by: lastJob && lastJob.service === 'health_factor'
        ? { job_id: lastJob.job_id, agreed_with_protocol: lastJob.agrees, at: lastJob.at }
        : null,
      note: 'This agent holds no position of its own; it is hired per job. The probe runs the full pipeline against our own wallet, which has entered no Venus market — so it shows the machinery answering, not a health factor. The arithmetic itself is checked against Venus\'s own getAccountLiquidity on every real job.',
      last_error: null,
    };
  } catch (e) {
    return { ready: false, checked_at: at, live: null, proven_by: null, headline: 'not answering right now', last_error: String(e?.message || e).slice(0, 140) };
  }
}

async function probeGrid() {
  const at = new Date().toISOString();
  try {
    const plan = await gridPlan({ token: REFERENCE_POOL, levels: 10, bandPct: 15, capitalUsd: 1000 });
    return {
      ready: true,
      checked_at: at,
      live: {
        reference_pool: 'WBNB',
        break_even_spacing_pct: plan.economics?.break_even_spacing_pct ?? null,
        round_trip_cost_pct: plan.economics?.round_trip_cost_pct ?? null,
        max_levels_that_still_break_even: plan.economics?.max_levels_that_still_break_even ?? null,
        pool_liquidity_usd: plan.pool?.liquidity_usd ?? null,
      },
      headline: plan.economics?.break_even_spacing_pct != null
        ? `break-even spacing on WBNB ${plan.economics.break_even_spacing_pct}% right now`
        : 'pool measured, spacing not derivable',
      measures: 'grid levels for any BNB Chain pool with the round-trip cost of a cycle measured from the pool itself',
      note: 'Measured on the deepest pair on the chain, so this is the floor: no grid on BNB Chain costs less per cycle than this. A thinner pool costs more.',
      last_error: null,
    };
  } catch (e) {
    return { ready: false, checked_at: at, live: null, headline: 'not answering right now', last_error: String(e?.message || e).slice(0, 140) };
  }
}

// The yield agent, measured the same way: run the real service and publish what
// it returned. The headline is the block time rather than the top APY on
// purpose — the rate is on a dozen dashboards, the fact that most of them
// compute it from a stale block constant is not.
async function probeYield() {
  const at = new Date().toISOString();
  try {
    const plan = await yieldPlan({});
    const best = plan.best_available || null;
    return {
      ready: true,
      checked_at: at,
      live: {
        markets_read: plan.markets_read ?? null,
        blocks_per_year_measured: plan.measured_block_time?.blocks_per_year ?? null,
        seconds_per_block: plan.measured_block_time?.seconds_per_block ?? null,
        best_market: best?.symbol ?? null,
        best_supply_apy_pct: best?.supply_apy_pct ?? null,
        second_sourced: plan.cross_check?.second_sourced ?? null,
        agrees_with_venus: plan.cross_check?.agrees ?? null,
      },
      headline: plan.measured_block_time
        ? `BSC is at ${plan.measured_block_time.seconds_per_block}s per block — ${plan.measured_block_time.blocks_per_year.toLocaleString('en-US')} a year, not the 10,512,000 most BSC yield figures still assume`
        : 'markets read, block time not measurable',
      measures: 'every Venus core-pool market ranked by what it actually pays, and the days until a move pays for its own gas',
      note: 'The APY depends entirely on the block time, which is measured here from two blocks a hundred thousand apart rather than assumed. Cross-checked against Venus’s own published figures.',
      last_error: null,
    };
  } catch (e) {
    return { ready: false, checked_at: at, live: null, headline: 'not answering right now', last_error: String(e?.message || e).slice(0, 140) };
  }
}

// The rebalancer, run against a deliberately awkward reference portfolio: one
// deep pool and one thin taxed one. A rebalancer that only ever reports cheap
// corrections has not been tested on anything that matters.
async function probeRebalance() {
  const at = new Date().toISOString();
  try {
    const plan = await rebalancePlan({
      holdings: [
        { token: REFERENCE_POOL, usd: 600 },
        { token: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', usd: 400 },
      ],
    });
    const e = plan.economics || {};
    const top = (plan.where_the_cost_sits || [])[0] || null;
    return {
      ready: true,
      checked_at: at,
      live: {
        reference_portfolio: 'WBNB + CAKE, 60/40, corrected to equal weight',
        cost_pct_of_value_moved: e.cost_pct_of_value_moved ?? null,
        cost_pct_of_portfolio: e.cost_pct_of_portfolio ?? null,
        cost_concentrated_in: top ? top.leg : null,
        its_share_of_the_bill_pct: top ? top.share_of_cost_pct : null,
      },
      headline: e.cost_pct_of_value_moved != null
        ? `correcting the reference portfolio costs ${e.cost_pct_of_value_moved}% of the money moved`
        : 'pools measured, cost not derivable',
      measures: 'the swaps to reach target weights, priced against the pools that would execute them',
      note: 'It does not claim whether rebalancing is worth doing. A correction does not earn the dollars it moves, and what it is worth is a judgement about risk rather than a quantity in any pool.',
      last_error: null,
    };
  } catch (e) {
    return { ready: false, checked_at: at, live: null, headline: 'not answering right now', last_error: String(e?.message || e).slice(0, 140) };
  }
}

// Jobs we have actually delivered, counted from the stored deliverables rather
// than from a tally we keep ourselves. A counter we increment is a counter we
// can get wrong; the deliverables are what the on-chain digests commit to.
//
// KV lists lexicographically, so job:9 sorts after job:56657 — the newest is
// picked by number, not by position in the list. Getting that wrong would put
// a stale job under "last delivered" and nothing would look broken.
// TALLIED PER SERVICE, WHICH THE FIRST VERSION DID NOT DO
// Two agents share this origin, so an origin-wide count put the one delivered
// job under both of them: the grid planner claimed credit for a health-factor
// delivery. One job, two agents, two claims — the arithmetic that inflates
// every number this project spends its time deflating in other people's data.
// So each deliverable is opened and attributed to the service that produced it.
const RECENT = 25;

async function ownJobs(env) {
  try {
    const list = await env.AGENT.list({ prefix: 'job:', limit: 1000 });
    const ids = list.keys
      .map((k) => Number(k.name.slice(4)))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);
    if (!ids.length) return { byService: {}, last: {}, truncated: false };

    // Newest first, capped. Opening every deliverable would grow without bound
    // and the count would eventually cost more than it is worth; the cap is
    // reported rather than hidden so a "25" can never quietly mean "at least".
    const read = ids.slice(0, RECENT);
    const stored = await Promise.all(read.map((n) => env.AGENT.get(`job:${n}`, 'json')));

    const byService = {};
    const last = {};
    read.forEach((jobId, i) => {
      const rec = stored[i];
      if (!rec) return;
      let doc = null;
      try { doc = JSON.parse(rec.document); } catch { /* keep null */ }
      const service = doc?.service ?? null;
      if (!service) return;
      byService[service] = (byService[service] || 0) + 1;
      // ids are descending, so the first one seen for a service is its latest.
      if (!last[service]) {
        last[service] = {
          job_id: String(jobId),
          service,
          at: doc?.produced_at ?? null,
          // Whether OUR maths agreed with the protocol's on that job. Only
          // health-factor deliveries carry it; the grid planner has no protocol
          // to check itself against, it measures the pool directly.
          agrees: rec.result?.cross_check?.agrees ?? null,
          tx: rec.delivery?.tx ?? null,
        };
      }
    });
    return { byService, last, truncated: ids.length > RECENT };
  } catch {
    // A KV list that fails is not zero jobs. Null says "not known right now",
    // and the page prints nothing rather than a confident 0.
    return { byService: null, last: {}, truncated: false };
  }
}

/**
 * Refresh everything and store it. Called from the cron.
 *
 * One KV write per run, at the end, holding the whole document: the page reads
 * one key, and a run that dies halfway leaves the previous complete snapshot in
 * place rather than a half-updated one.
 */
export async function refreshTelemetry(env) {
  // Jobs first: the health-factor probe carries the last real delivery as its
  // proof of arithmetic, so it needs the answer before it runs.
  const jobs = await ownJobs(env);
  const [peers, hf, grid, yld, reb] = await Promise.all([
    Promise.all(PEERS.map(askPeer)),
    probeHealthFactor(jobs.last.health_factor || null),
    probeGrid(),
    probeYield(),
    probeRebalance(),
  ]);

  // Null means the job list could not be read, and stays null. A KV failure
  // must not be rendered as "this agent has never been hired".
  const delivered = (id) => (jobs.byService ? (jobs.byService[id] || 0) : null);

  const doc = {
    checked_at: new Date().toISOString(),
    ours: [
      {
        id: 302257,
        name: 'Brain on BNB — Venus Health Factor Monitor',
        category: 'health-factor',
        origin: 'https://agent.brainonbnb.com',
        hireable: 'ERC-8183',
        price: '0.10 $U',
        jobs_delivered: delivered('health_factor'),
        ...hf,
      },
      {
        id: 302258,
        name: 'Brain on BNB — BSC Grid Planner',
        category: 'grid-trading',
        origin: 'https://agent.brainonbnb.com',
        hireable: 'ERC-8183',
        price: '0.10 $U',
        jobs_delivered: delivered('grid_plan'),
        last_delivery: jobs.last.grid_plan || null,
        ...grid,
      },
      {
        id: 304493,
        name: 'Brain on BNB — Venus Yield Ranking',
        category: 'yield-optimization',
        origin: 'https://agent.brainonbnb.com',
        hireable: 'ERC-8183',
        price: '0.10 $U',
        jobs_delivered: delivered('yield_plan'),
        last_delivery: jobs.last.yield_plan || null,
        ...yld,
      },
      {
        id: 304494,
        name: 'Brain on BNB — Portfolio Rebalance Pricer',
        category: 'rebalancing',
        origin: 'https://agent.brainonbnb.com',
        hireable: 'ERC-8183',
        price: '0.10 $U',
        jobs_delivered: delivered('rebalance_plan'),
        last_delivery: jobs.last.rebalance_plan || null,
        ...reb,
      },
    ],
    peers,
    // How many deliverables the per-agent counts were derived from. Published
    // because it is the invariant that catches the bug this replaced: the sum
    // of the per-agent counts can never exceed the number of deliverables
    // examined. When the count was origin-wide, one job produced a sum of two.
    jobs_counted_from: { deliverables_examined: jobs.byService ? Object.values(jobs.byService).reduce((n, v) => n + v, 0) : null, truncated: jobs.truncated },
    method: 'Our own four entries are measured by running the service against a reference input, through the same code a paid job runs. The peer entries are quotes: each agent\'s own /status document, stored as served and timestamped. Nothing here is averaged, filled in or carried over from a previous run.',
    cadence: 'every 15 minutes',
  };

  await env.AGENT.put(KEY, JSON.stringify(doc));
  return doc;
}

/**
 * The stored snapshot.
 *
 * On a cold key — a fresh deploy, or the first request ever — it is computed
 * once rather than answering 503 until the next cron tick. Without this there
 * is a window of up to fifteen minutes after every deploy in which our own
 * /status is down, which is a poor advertisement for an agent selling
 * reliability. The window it opens in exchange is the few seconds before the
 * first successful run writes the key.
 */
export async function readTelemetry(env, { compute = true } = {}) {
  const stored = await env.AGENT.get(KEY, 'json');
  if (stored) return stored;
  if (!compute) return null;
  return refreshTelemetry(env).catch(() => null);
}

/**
 * What the page needs: one flat list keyed by the thing it can match a row on,
 * with the fields already picked and labelled. Built here rather than in the
 * page so the rule about which fields are shown lives next to the rule about
 * what they mean.
 */
export function surfaceFor(entry) {
  const cat = entry.category || entry.declared_category || '';
  const spec = SURFACE[cat] || SURFACE[String(cat).replace(/-monitoring$/, '')] || [];
  const state = entry.state || entry.live || {};
  const out = [];
  for (const [key, label, unit] of spec) {
    if (!(key in state)) continue;
    out.push({ label, value: state[key], unit: unit || null });
  }
  return out;
}

export { PEERS, SURFACE, OWN_AGENT_IDS };
