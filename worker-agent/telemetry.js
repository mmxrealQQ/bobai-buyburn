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

import { cappedText } from './net.js';
import { isOwnWallet } from './own-wallets.js';
import { healthFactor } from './venus.js';
import { gridPlan } from './grid.js';
import { yieldPlan } from './yield.js';
import { rebalancePlan } from './rebalance.js';
import { lpTierPlan } from './lp-tiers.js';
import { OWN_AGENT_IDS } from '../shared/agent-registrations.js';

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
// The agents we run ourselves come from shared/agent-registrations.js
// (imported at the top), which the domain proof on both origins is built from
// as well. Registering an agent used to mean remembering four separate literal
// copies, and the one that gets forgotten fails silently, as a row that is
// simply never live. Re-exported below because this module is what the check
// scripts already import.

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
    const text = await cappedText(r);
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
// The LP probe uses CAKE rather than WBNB: it is PancakeSwap's own token,
// four of its five fee tiers see flow in a normal window, and the fifth holds
// money and sees none — which is the whole point being demonstrated.
const CAKE = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82';

// WHY A FAILED PROBE HAS TO SAY WHICH KIND OF FAILURE IT WAS
//
// Each of the five probes below used to answer every failure with the same
// sentence — ready:false, "not answering right now" — although three quite
// different things hide behind it:
//
//   1. the agent's own code broke        — ours, and the only urgent one
//   2. every BSC endpoint refused a read — upstream, and usually over in
//                                          seconds; the agent is fine
//   3. neither; the snapshot is just old — nothing is wrong at all
//
// Measured 2026-09-01: the surface check went red with
// "302258: every BSC endpoint refused this request". That reads as a dead grid
// planner and was a throttled node — the agent had not been asked a question it
// failed to answer, it had not been able to ask the chain one. Telling the
// three apart cost an evening, and would have cost it again on the next tick,
// because the sentence carried nothing to tell them apart WITH.
//
// So the cause is classified here, where the error still exists, and published
// as a field. The page and the checks read the field instead of guessing from
// prose. Same rule the fee-tier headline already follows further down: an
// unmeasured tick and an empty result must never print the same words.

// Phrases that mean the chain would not answer, not that we asked it wrongly.
// Deliberately narrow. A revert IS an answer and never matches here, and an
// agent bug — a TypeError, a bad field — matches nothing in this list, so it
// keeps its own classification and stays red where it belongs.
const CHAIN_REFUSED = /every BSC endpoint refused|rate limit|capacity|too many|quota|429|timed out|timeout|aborted|network|fetch failed/i;

const isChainRefusal = (e) => {
  const m = String(e?.message || e);
  if (/revert|execution/i.test(m)) return false;
  return CHAIN_REFUSED.test(m);
};

/**
 * The failure half of a probe, with the cause named.
 *
 * `not_ready_because` is 'chain_unreachable' or 'agent_error'. Anything that is
 * not demonstrably the chain is called ours: a classifier in doubt has to
 * accuse itself, or every unknown fault quietly becomes somebody else's.
 */
function notReady(e, at, attempt = {}, extra = {}) {
  const last_error = String(e?.message || e).slice(0, 140);
  const upstream = isChainRefusal(e);
  return {
    ready: false,
    not_ready_because: upstream ? 'chain_unreachable' : 'agent_error',
    chain_needed_a_second_attempt: attempt.retried === true,
    checked_at: at,
    live: null,
    headline: upstream
      ? 'the chain refused every endpoint this tick — not measured, which is not the same as not working'
      : 'not answering right now',
    last_error,
    ...extra,
  };
}

/**
 * Run a probe, and give it a second chance if — and only if — the chain was
 * what refused.
 *
 * A probe that threw a TypeError will throw the same TypeError a second later,
 * so retrying that only delays an honest red. A throttled endpoint is often
 * free again within a second or two, and the five probes run together against
 * one pool of nodes, so some of this contention is our own
 * (the census learned the same lesson and serialised its per-host probes).
 * Serialising all five here would fix that outright, and it is still the right
 * answer if this ever stops being enough. It is not free: five refreshes timed
 * 2026-09-01 ran 15s, 16s, 19s, 20s and 74s, and one exceeded three minutes, so
 * the parallel version is already slow enough to matter on the cold-key path,
 * where a waiting request pays for it. One retry, only on the upstream class,
 * costs nothing on a healthy tick and is paid only after something has already
 * gone wrong.
 */
async function withSecondChance(run, attempt = {}) {
  try {
    return await run();
  } catch (e) {
    if (!isChainRefusal(e)) throw e;
    // Recorded, not swallowed. A retry that leaves no trace turns a degrading
    // chain into a page that looks perfectly healthy right up to the tick where
    // it stops working — the same mistake as printing "none traded"
    // for a pair that trades every block. A tick that only came back on the
    // second ask is a different fact from a tick that came back.
    attempt.retried = true;
    await new Promise((r) => setTimeout(r, 1500));
    return await run();
  }
}

async function probeHealthFactor(lastJob) {
  const at = new Date().toISOString();
  const started = Date.now();
  const attempt = {};
  try {
    const hf = await withSecondChance(() => healthFactor(SELF_ACCOUNT), attempt);
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
      not_ready_because: null,
      chain_needed_a_second_attempt: attempt.retried === true,
      last_error: null,
    };
  } catch (e) {
    return notReady(e, at, attempt, { proven_by: null });
  }
}

async function probeGrid() {
  const at = new Date().toISOString();
  const attempt = {};
  try {
    const plan = await withSecondChance(() => gridPlan({ token: REFERENCE_POOL, levels: 10, bandPct: 15, capitalUsd: 1000 }), attempt);
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
      not_ready_because: null,
      chain_needed_a_second_attempt: attempt.retried === true,
      last_error: null,
    };
  } catch (e) {
    return notReady(e, at, attempt);
  }
}

// The yield agent, measured the same way: run the real service and publish what
// it returned. The headline is the block time rather than the top APY on
// purpose — the rate is on a dozen dashboards, the fact that most of them
// compute it from a stale block constant is not.
async function probeYield() {
  const at = new Date().toISOString();
  const attempt = {};
  try {
    const plan = await withSecondChance(() => yieldPlan({}), attempt);
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
      not_ready_because: null,
      chain_needed_a_second_attempt: attempt.retried === true,
      last_error: null,
    };
  } catch (e) {
    return notReady(e, at, attempt);
  }
}

// The rebalancer, run against a deliberately awkward reference portfolio: one
// deep pool and one thin taxed one. A rebalancer that only ever reports cheap
// corrections has not been tested on anything that matters.
async function probeRebalance() {
  const at = new Date().toISOString();
  const attempt = {};
  try {
    const plan = await withSecondChance(() => rebalancePlan({
      holdings: [
        { token: REFERENCE_POOL, usd: 600 },
        { token: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', usd: 400 },
      ],
    }), attempt);
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
      not_ready_because: null,
      chain_needed_a_second_attempt: attempt.retried === true,
      last_error: null,
    };
  } catch (e) {
    return notReady(e, at, attempt);
  }
}

// The DeFi agent, probed on the pair with the most fee tiers actually trading.
//
// The headline here is a claim nothing else on this chain publishes, and it is
// re-checked every run rather than asserted once: whether the PancakeSwap tier
// holding the most capital is the one paying best. It usually is not, and on
// the run where it is, this says so.
async function probeLpTiers() {
  const at = new Date().toISOString();
  const attempt = {};
  try {
    const plan = await withSecondChance(() => lpTierPlan({ token: CAKE, capitalUsd: 1000 }), attempt);
    const aligned = plan.capital_is_in_the_best_paying_tier;
    const idle = (plan.idle_capital || []).reduce((s, x) => s + (x.capital_usd || 0), 0);
    return {
      ready: true,
      checked_at: at,
      live: {
        reference_pair: `${plan.pair?.token?.symbol || 'CAKE'}/${plan.pair?.quote?.symbol || 'BNB'}`,
        tiers_found: plan.tiers_found ?? (plan.tiers || []).length,
        tiers_measured: plan.tiers_measured ?? null,
        best_paying_tier: plan.best_paying_tier,
        most_capital_tier: plan.most_capital_tier,
        capital_is_in_the_best_paying_tier: aligned,
        idle_capital_usd: Math.round(idle),
        measured_over_minutes: plan.measured_window?.minutes ?? null,
      },
      // Three different outcomes that a single sentence used to flatten into
      // one. "None traded" was printed for CAKE — a pair that trades every
      // block — on a run where the log endpoint had refused every range. That
      // is a statement about our measurement wearing the clothes of a
      // statement about the market.
      headline: plan.best_paying_tier
        ? (aligned === false
          ? `${plan.most_capital_tier} holds the most capital, ${plan.best_paying_tier} is paying best`
          : `${plan.best_paying_tier} holds the most capital and is paying best`)
        : (plan.tiers_measured === 0
          ? 'the log endpoint refused every range — not measured this tick, which is not the same as nothing trading'
          : `none of the ${plan.tiers_measured} readable tiers traded in this window`),
      measures: 'what each PancakeSwap fee tier actually paid its liquidity providers per dollar of capital in it',
      // Said here rather than only in the deliverable, because a number on a
      // status page is the one most likely to be quoted without its window.
      note: `Measured over ${plan.measured_window?.minutes ?? '~38'} minutes of chain and deliberately not annualised. Capital is both sides of the pool, and in V3 includes liquidity parked outside the current range, which earns nothing.`,
      not_ready_because: null,
      chain_needed_a_second_attempt: attempt.retried === true,
      last_error: null,
    };
  } catch (e) {
    return notReady(e, at, attempt);
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
    // … of which our own test purchases (the client is one of our wallets): a
    // count that mixes them with strangers' jobs says "nine delivered" where
    // four were (2026-09-18).
    const ownByService = {};
    const last = {};
    read.forEach((jobId, i) => {
      const rec = stored[i];
      if (!rec) return;
      let doc = null;
      try { doc = JSON.parse(rec.document); } catch { /* keep null */ }
      const service = doc?.service ?? null;
      if (!service) return;
      byService[service] = (byService[service] || 0) + 1;
      if (isOwnWallet(doc?.client)) ownByService[service] = (ownByService[service] || 0) + 1;
      // ids are descending, so the first one seen for a service is its latest.
      if (!last[service]) {
        last[service] = {
          job_id: String(jobId),
          service,
          at: doc?.produced_at ?? null,
          // Whether OUR maths agreed with the protocol's on that job. Only
          // health-factor deliveries carry it; the grid planner has no protocol
          // to check itself against, it measures the pool directly.
          // Read where the deliverable carries it (result.position.cross_check).
          // The path read until 2026-09-18 does not exist, so this was always
          // null — and two deliveries whose arithmetic DISAGREED with Venus by
          // 7% and 10% showed nothing.
          agrees: doc?.result?.position?.cross_check?.agrees ?? doc?.result?.cross_check?.agrees ?? rec.result?.cross_check?.agrees ?? null,
          tx: rec.delivery?.tx ?? null,
        };
      }
    });
    return { byService, ownByService, last, truncated: ids.length > RECENT };
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
  const [peers, hf, grid, yld, reb, lp] = await Promise.all([
    Promise.all(PEERS.map(askPeer)),
    probeHealthFactor(jobs.last.health_factor || null),
    probeGrid(),
    probeYield(),
    probeRebalance(),
    probeLpTiers(),
  ]);

  // Null means the job list could not be read, and stays null. A KV failure
  // must not be rendered as "this agent has never been hired".
  const delivered = (id) => (jobs.byService ? (jobs.byService[id] || 0) : null);
  const split = (id) => (jobs.byService ? { jobs_for_strangers: (jobs.byService[id] || 0) - ((jobs.ownByService || {})[id] || 0), jobs_own_test_purchases: (jobs.ownByService || {})[id] || 0 } : {});

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
        ...split('health_factor'),
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
        ...split('grid_plan'),
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
        ...split('yield_plan'),
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
        ...split('rebalance_plan'),
        last_delivery: jobs.last.rebalance_plan || null,
        ...reb,
      },
      {
        id: 310460,
        name: 'Brain on BNB — PancakeSwap Fee Tier Placement',
        category: 'yield-optimization',
        origin: 'https://agent.brainonbnb.com',
        hireable: 'ERC-8183',
        price: '0.10 $U',
        jobs_delivered: delivered('lp_tier_plan'),
        ...split('lp_tier_plan'),
        last_delivery: jobs.last.lp_tier_plan || null,
        ...lp,
      },
    ],
    peers,
    // How many deliverables the per-agent counts were derived from. Published
    // because it is the invariant that catches the bug this replaced: the sum
    // of the per-agent counts can never exceed the number of deliverables
    // examined. When the count was origin-wide, one job produced a sum of two.
    jobs_counted_from: { deliverables_examined: jobs.byService ? Object.values(jobs.byService).reduce((n, v) => n + v, 0) : null, truncated: jobs.truncated },
    method: 'Our own five entries are measured by running the service against a reference input, through the same code a paid job runs. The peer entries are quotes: each agent\'s own /status document, stored as served and timestamped. Nothing here is averaged, filled in or carried over from a previous run.',
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
