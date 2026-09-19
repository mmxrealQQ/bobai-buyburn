// One command that answers "is everything actually running".
//
// The project is now eight workers, a Pages site, a paid agent service and a
// census — and the state of each lived in a different place. Checking meant
// remembering which endpoint proves what, which is exactly how a stopped bot
// goes unnoticed for a week.
//
// Every check reads a response BODY and applies a real criterion. Two habits
// this codebase learned the hard way and that are enforced here:
//
//   A status code proves nothing. brainonbnb.com answers any unrouted path
//   with 200 and the dashboard HTML, so "200 OK" is compatible with the
//   endpoint not existing.
//
//   Silence is not health. A bot that has burned nothing in thirty hours is
//   either idle or dead, and those look identical from the burn log alone.
//   Liveness comes from the heartbeat; the burn log only says how busy it was.
//
// One body, two callers: `node scripts/health.mjs` runs it by hand, and the
// worker in worker-health/ runs it every morning and tells the operator on
// Telegram. So nothing in here may need Node: fetch, Web Crypto, Uint8Array.
import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import { WALLETS, SOURCE, assess, bnb } from './gas-wallets.mjs';

const SITE = 'https://brainonbnb.com';
const AGENT = 'https://agent.brainonbnb.com';
const LOGS = 'https://logs.brainonbnb.com';
// The Telegram bot has no custom domain; workers.dev is its only public origin.
const TG_BOT = 'https://bobai-tg-bot.bobbuildonbnb.workers.dev';

const UA = { 'user-agent': 'bobai-smoke-test' }; // not counted in public stats
const fetch = (url, init = {}) =>
  globalThis.fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) } });

// Like getJson, but it never turns a failure into a blank. Whatever came back —
// a status, a body that was not JSON, a timeout — is carried into the message,
// because "no answer" printed for a throttled request and for a dead endpoint
// is the same sentence about two different worlds.
const askJson = async (url, ms = 30000) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    const text = await r.text();
    try { return { ...JSON.parse(text), _status: r.status }; }
    catch { return { error: `HTTP ${r.status}, not JSON: ${text.slice(0, 80)}`, _status: r.status }; }
  } catch (e) { return { error: `request failed: ${e.name}`, _status: 0 }; }
};
const getJson = async (url, init, via = fetch) => {
  try {
    const r = await via(url, { ...init, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    if (/^\s*<!doctype html/i.test(text)) return { html: true, status: r.status };
    try { return { json: JSON.parse(text), status: r.status }; }
    catch { return { text, status: r.status }; }
  } catch (e) { return { error: String(e.message || e) }; }
};

const ageHours = (iso) => (Date.now() - new Date(iso).getTime()) / 3600000;
const fmtAge = (h) => (h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);

// A daily post is on time when its date flag names today — or yesterday, while
// today's window (it closes at `closesUtc`) is still open. Pinned both ways on
// every run: a rule that can only say "fine" is how six silent days got by.
export const dailyOnTime = (flag, closesUtc, now = new Date()) => {
  const day = (d) => d.toISOString().slice(0, 10);
  const due = now.getUTCHours() >= closesUtc ? day(now) : day(new Date(now.getTime() - 86400000));
  return typeof flag === 'string' && flag >= due;
};
// THE DeFi AGENT, WATCHED (2026-09-18). Until now the only things known about
// it each morning were that its card went out and its page loads. On 09-16/17
// it stood still for a day — every step answering, politely and with ok:true,
// that two positions were "a decision for a person" — and nothing here could
// see it. What is read: how old the last ten-minute look and the last daily
// run are, whether a run failed, whether a step is waiting for a person,
// whether the price has been out of the range longer than the wait allows,
// and whether the wallet still holds the ranges the record names. Pure over
// what it is given, so it is pinned below with the day it would have caught.
export function defiVerdicts({ rec, portfolio = null, owners = null, wallet = null, now = Date.now() }) {
  const out = [];
  const add = (label, pass, detail = '') => out.push({ label, pass: !!pass, detail });
  if (!rec || !rec.last) { add('the DeFi agent record answers', false, 'no record'); return out; }
  const ageMin = (t) => (t ? (now - Date.parse(t)) / 60000 : null);
  const look = rec.last_check && rec.last_check.at ? rec.last_check : rec.last;
  const lookAge = ageMin(look.at), dayAge = ageMin(rec.last.at);
  // Every ten minutes; three missed looks is a stopped cron, not a late one.
  add('DeFi agent looked at its position in the last 35 min', lookAge != null && lookAge < 35, lookAge == null ? 'no timestamp' : `last look ${Math.round(lookAge)} min ago`);
  add('DeFi agent ran its day (04:23 UTC) in the last 26 h', dayAge != null && dayAge < 26 * 60, dayAge == null ? 'no timestamp' : `last daily run ${(dayAge / 60).toFixed(1)} h ago`);
  const stepsOf = (e) => Object.entries((e && e.steps) || {}).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => [k, x || {}]));
  const all = [...stepsOf(rec.last), ...stepsOf(rec.last_check)];
  const errs = all.filter(([, x]) => x.error).map(([k, x]) => `${k}: ${String(x.error).slice(0, 80)}`);
  add('no step of the last run or look failed', rec.last.ok !== false && (rec.last_check ? rec.last_check.ok !== false : true) && !errs.length, errs[0] || (portfolio && portfolio.day && portfolio.day.errors ? `${portfolio.day.errors} error(s) in the last 24 h` : ''));
  const waits = all.filter(([, x]) => /decision (for )?a person|a person should make/i.test(String(x.why || ''))).map(([k, x]) => `${k}: ${String(x.why).slice(0, 90)}`);
  add('no step is waiting for a person', !waits.length, waits[0] || '');
  const rb = (rec.last_check && rec.last_check.steps && rec.last_check.steps.rebalance) || (rec.last.steps && rec.last.steps.rebalance) || {};
  const outH = portfolio && portfolio.pool && portfolio.pool.outside_hours != null ? Number(portfolio.pool.outside_hours) : null;
  const waitH = rb.wait_h != null ? Number(rb.wait_h) : 24;
  add('the range is not left longer than its wait allows', outH == null || outH <= waitH + 3, outH == null ? 'in range or at its edge' : `out of range for ${outH.toFixed(1)} h, the wait is ${waitH} h`);
  if (owners && rec.ladder) {
    const mine = (id) => id == null || (owners[String(id)] && wallet && String(owners[String(id)]).toLowerCase() === String(wallet).toLowerCase());
    const named = [rec.ladder.main, rec.ladder.reserve].filter((x) => x != null);
    add('the wallet holds the ranges the ladder record names', named.length > 0 && named.every(mine), named.map((id) => `#${id} ${mine(id) ? 'held' : 'NOT held'}`).join(', ') || 'the record names no range');
  }
  return out;
}
const defiVerdictsHold = () => {
  const now = Date.parse('2026-09-17T03:00:00Z');
  const W = '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A';
  const stood = { ladder: { main: '7450561', reserve: '7450613' }, last: { at: '2026-09-16T04:23:00Z', ok: true, steps: { rebalance: { acted: false, why: 'this wallet holds 2 positions — which one to re-set is a decision for a person' } } }, last_check: { at: '2026-09-17T02:50:00Z', ok: true, steps: { increase: { acted: false, why: 'this wallet holds 2 positions — which one to grow is a decision for a person' } } } };
  const red = (v, re) => v.some((c) => !c.pass && re.test(c.label));
  const a = defiVerdicts({ rec: stood, owners: { 7450613: W }, wallet: W, now });
  const fine = { ladder: { main: '7451444', reserve: '7461743' }, last: { at: '2026-09-17T00:00:00Z', ok: true, steps: { rebalance: { acted: false, why: 'the price is inside the range — nothing to re-set' } } }, last_check: { at: '2026-09-17T02:50:00Z', ok: true, steps: {} } };
  const b = defiVerdicts({ rec: fine, portfolio: { pool: { outside_hours: null }, day: { errors: 0 } }, owners: { 7451444: W, 7461743: W }, wallet: W, now });
  const stale = defiVerdicts({ rec: { ...fine, last_check: { at: '2026-09-17T01:00:00Z', ok: true, steps: {} } }, now });
  const failed = defiVerdicts({ rec: { ...fine, last_check: { at: '2026-09-17T02:50:00Z', ok: false, steps: { collect: { error: 'Address "undefined" is invalid' } } } }, now });
  const stuck = defiVerdicts({ rec: fine, portfolio: { pool: { outside_hours: 30 } }, now });
  return red(a, /waiting for a person/) && red(a, /holds the ranges/) && b.every((c) => c.pass) && b.length === 6
    && red(stale, /last 35 min/) && red(failed, /failed/) && red(stuck, /longer than its wait/);
};
// THE BUYBACK BOT IS JUDGED BY THE MONEY, NOT BY ITS HEARTBEAT (2026-09-18).
// Both money bots write their heartbeat in a `finally`: a bot that throws on its
// first line, or can no longer send, is as green as one that works, and "last
// burn" is informational by design (no volume, no burn). What a working bot
// cannot do is leave tax lying: above 0.004 BNB (its GAS_RESERVE 0.003 +
// MIN_BNB 0.001) it splits the wallet on its next ten-minute run. So: one look
// above that line proves nothing (the tax may have just arrived) and asks for a
// second look after the bot's next run; above it at BOTH looks with the same
// nonce — a run went by and nothing was sent — is red. Read from the chain,
// outside the bot's code. Pure; the second look is the health worker's.
export const BUYBACK_WALLET = '0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce';
export const BUYBACK_ACTS_ABOVE_BNB = 0.004;
export function buybackWalletVerdict(look, prior = null) {
  if (!look || !(look.bnb >= 0) || look.nonce == null) return { good: false, recheck: false, detail: 'the buyback wallet could not be read' };
  const held = `${look.bnb.toFixed(5)} BNB`;
  if (look.bnb <= BUYBACK_ACTS_ABOVE_BNB) return { good: true, recheck: false, detail: `${held} — under the ${BUYBACK_ACTS_ABOVE_BNB} BNB the bot acts from` };
  if (!prior) return { good: true, recheck: true, detail: `${held} waits for the bot's next run — one look; the health worker looks again after that run` };
  if (prior.bnb > BUYBACK_ACTS_ABOVE_BNB && prior.nonce === look.nonce) {
    const mins = look.at && prior.at ? Math.round((look.at - prior.at) / 60000) : null;
    return { good: false, recheck: false, detail: `held ${held} through a run of the bot and sent nothing (nonce ${look.nonce} at both looks${mins != null ? `, ${mins} min apart` : ''}) — the heartbeat is green either way` };
  }
  return { good: true, recheck: false, detail: `${held}, and the bot has sent since the first look (nonce ${prior.nonce} → ${look.nonce})` };
}
// When to look again: 90 seconds after the bot's next ten-minute mark, so a whole run lies between the looks.
export const msToSecondLook = (now = Date.now()) => (600000 - (now % 600000)) + 90000;
export async function readBuybackLook(rpc = 'https://bsc-dataseed.binance.org') {
  try {
    const client = createPublicClient({ chain: bsc, transport: http(rpc) });
    const [wei, nonce] = await Promise.all([client.getBalance({ address: BUYBACK_WALLET }), client.getTransactionCount({ address: BUYBACK_WALLET })]);
    return { bnb: Number(wei) / 1e18, nonce, at: Date.now() };
  } catch { return null; }
}
const buybackVerdictHolds = () => {
  const a = { bnb: 0.0521, nonce: 3117, at: 1000 }, b = { bnb: 0.0533, nonce: 3117, at: 661000 };
  return buybackWalletVerdict({ bnb: 0.00298, nonce: 1 }).good === true && buybackWalletVerdict({ bnb: 0.00298, nonce: 1 }).recheck === false
    && buybackWalletVerdict(a).good === true && buybackWalletVerdict(a).recheck === true
    && buybackWalletVerdict(b, a).good === false && /11 min apart/.test(buybackWalletVerdict(b, a).detail)
    && buybackWalletVerdict({ ...b, nonce: 3124 }, a).good === true
    && buybackWalletVerdict({ bnb: 0.0031, nonce: 3124 }, a).good === true
    && buybackWalletVerdict(null).good === false
    && msToSecondLook(Date.UTC(2026, 8, 18, 9, 10, 40)) === 650000 && msToSecondLook(Date.UTC(2026, 8, 18, 9, 20, 0)) === 690000;
};
const dailyOnTimeHolds = () => {
  const at = (h) => new Date(Date.UTC(2026, 8, 17, h, 30));
  const pins = [[dailyOnTime('2026-09-17', 9, at(10)), true], [dailyOnTime('2026-09-16', 9, at(10)), false], [dailyOnTime('2026-09-16', 9, at(7)), true],
    [dailyOnTime('2026-09-11', 9, at(7)), false], [dailyOnTime(null, 9, at(7)), false]];
  return pins.every(([got, want]) => got === want);
};

// `rpc`: explicit, so the gas section reads the same node the bots spend
// against. `tgFetch`: how to reach the Telegram bot — a worker cannot fetch a
// sibling's workers.dev address (it gets a 404 from Cloudflare's own router),
// so the health worker hands in its service binding here.
export async function runHealth({ rpc = 'https://bsc-dataseed.binance.org', tgFetch = fetch, buybackPrior = null } = {}) {
const RPC = rpc;
const results = [];
const ok = (area, name, good, detail = '') => results.push({ area, name, good, detail });
ok('Health', 'the daily-post rule passes its own pins', dailyOnTimeHolds());
ok('Health', 'the DeFi agent checks pass their own pins (the day it stood still reads red)', defiVerdictsHold());
ok('Health', 'the buyback-wallet rule passes its own pins (tax held through a run reads red, tax that just arrived does not)', buybackVerdictHolds());

// ---- the bots -------------------------------------------------------------
{
  const h = await getJson(`${LOGS}/health`);
  const j = h.json;
  ok('Bots', 'heartbeat endpoint answers', !!j, h.error || (h.html ? 'HTML fallback' : ''));
  if (j) {
    // Cron every 10 min and hourly. Two missed cycles is noise; six hours is a
    // stopped worker, and that is the distinction worth alarming on.
    const b = j.buyback ? ageHours(j.buyback) : null;
    const d = j.devBuyback ? ageHours(j.devBuyback) : null;
    ok('Bots', 'buyback bot ran recently', b !== null && b < 1, b === null ? 'no timestamp' : `last run ${fmtAge(b)} ago`);
    ok('Bots', 'dev-buyback bot ran recently', d !== null && d < 3, d === null ? 'no timestamp' : `last run ${fmtAge(d)} ago`);
    // A run whose money moved and whose line could not be written parks the
    // entry; the next append carries it in. Until then the public log, the
    // burn table and the Giggle card count too little.
    ok('Bots', 'no log entry of a money bot is waiting to be written', Array.isArray(j.unlogged) && j.unlogged.length === 0,
      Array.isArray(j.unlogged) ? j.unlogged.join(', ') : 'the endpoint does not say');
  }
}
{
  // The heartbeat says the cron fired; this says the tax does not lie around.
  const look = await readBuybackLook(RPC);
  const v = buybackWalletVerdict(look, buybackPrior);
  results.push({ area: 'Bots', name: 'the buyback bot is not sitting on tax', good: v.good, detail: v.detail, recheck: v.recheck, look });
}
{
  // The Telegram bot was in no check at all until 29 August. It is the surface
  // the channel sees — buy alerts, burn alerts, every command — and a stopped
  // cron is indistinguishable from a quiet market from the outside. So it
  // publishes its own heartbeat, written every tenth minute by its cron, and
  // this reads the age of it rather than the fact that the worker answers:
  // a worker whose cron has died still serves HTTP perfectly.
  const h = await getJson(`${TG_BOT}/health`, undefined, tgFetch);
  const j = h.json;
  ok('Bots', 'telegram bot answers', !!j?.ok, h.error || (h.html ? 'HTML fallback' : ''));
  if (j) {
    const age = typeof j.age_seconds === 'number' ? j.age_seconds : null;
    ok('Bots', 'telegram bot cron alive', j.cron_alive === true,
      age === null ? 'no heartbeat recorded yet' : `last tick ${fmtAge(age / 3600)} ago`);
    ok('Bots', 'telegram bot can post', j.channel_configured === true,
      j.channel_configured ? 'token + chat id set' : 'BOT_TOKEN or chat id missing — alerts would fail silently');
    // The heartbeat proves the cron runs, not that the daily posts go out: the
    // whale recap was silent 2026-09-12 to 09-17 behind a green heartbeat.
    const d = j.daily || {};
    ok('Bots', 'whale recap went out (internal, 06:00 UTC)', dailyOnTime(d.whale_recap, 9), `last sent ${d.whale_recap || 'never'}`);
    ok('Bots', 'DeFi card went out (channel, 05:00 UTC)', dailyOnTime(d.lp_card, 8), `last sent ${d.lp_card || 'never'}`);
  }
}
{
  const r = await getJson(`${LOGS}/logs/burns.json`);
  const items = Array.isArray(r.json) ? r.json : (r.json?.burns || r.json?.items || []);
  ok('Bots', 'burn audit log readable', items.length > 0, `${items.length} entries`);
  if (items.length) {
    const last = items[items.length - 1];
    const t = last?.time || last?.timestamp;
    // Deliberately NOT a failure: no burn means no volume, not a broken bot.
    // Reported so a long gap is visible without being called an outage.
    const h = t ? ageHours(t) : null;
    ok('Bots', 'last burn (informational)', true, h === null ? 'no timestamp' : `${fmtAge(h)} ago — idle is normal when volume is low`);
  }
}

// ---- the money numbers ----------------------------------------------------
{
  const p = await getJson(`${SITE}/api/price`);
  const price = p.json?.price_usd;
  ok('Token', 'price endpoint returns a live price', typeof price === 'number' && price > 0, price ? `$${price}` : '');

  const l = await getJson(`${SITE}/api/liquidity`);
  const liq = l.json?.liquidity_usd ?? l.json?.liquidityUsd;
  ok('Token', 'liquidity endpoint answers', liq != null, liq != null ? `$${Math.round(Number(liq)).toLocaleString('en-US')}` : '');

  // Fetched as raw text, not through getJson: a bare number is valid JSON, so
  // JSON.parse succeeds and the value lands in .json rather than .text. The
  // first version of this check asked for .text, found nothing, and reported a
  // working endpoint as broken — a false alarm in a health check is worse than
  // no check, because people learn to ignore red.
  const supplyRaw = await fetch(`${SITE}/api/circulating-supply`)
    .then((r) => r.text()).catch(() => '');
  ok('Token', 'circulating supply is a bare number', /^\d+$/.test(supplyRaw.trim()), supplyRaw.trim().slice(0, 20));

  // The same figure reached two ways must agree. A drift here means one surface
  // is reading a stale or different source, which is the failure this project
  // treats as most serious.
  const t = await getJson(`${SITE}/api/token`);
  const fromToken = Number(t.json?.circulating_supply ?? t.json?.circulatingSupply);
  const fromBare = Number(supplyRaw.trim());
  ok('Token', 'supply agrees across two endpoints',
    Number.isFinite(fromToken) && Number.isFinite(fromBare) && Math.abs(fromToken - fromBare) / fromBare < 0.001,
    Number.isFinite(fromToken) ? `${fromToken.toLocaleString('en-US')} vs ${fromBare.toLocaleString('en-US')}` : '');
}

// ---- the agent surface ----------------------------------------------------
{
  const r = await fetch(`${SITE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }).then((x) => x.json()).catch(() => null);
  const tools = r?.result?.tools || [];
  ok('Agents', 'MCP server lists tools', tools.length >= 17, `${tools.length} tools`);
  ok('Agents', 'Brain Plaza tools are exposed',
    tools.some((t) => t.name === 'find_agents_on_bnb_chain') && tools.some((t) => t.name === 'bnb_agent_census'));

  // The pool scan is the one tool here that serves somebody else's token, so
  // "it is listed" is not enough — it has to come back with a real measurement.
  // Checked against a token with several venues rather than our own, because
  // the failure this guards against is the outbound-call ceiling, and only a
  // busy token gets near it.
  const scanned = await fetch(`${SITE}/api/pool-scan?address=0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82`)
    .then((r) => r.json()).catch(() => null);
  ok('Agents', 'pool scan answers for any token',
    scanned?.quotable === true && Array.isArray(scanned?.tradeCost) && scanned.tradeCost.length > 0,
    scanned?.symbol ? `${scanned.symbol}: 1% depth $${scanned.onePercentDepth?.buyUsd?.toLocaleString('en-US')}` : (scanned?.error || 'no answer'));
  // Zero would be a claim about the token; null is the honest answer when
  // neither a measurement nor a label could be had. This asserts the field is
  // never silently zero-filled.
  ok('Agents', 'unknown tax reads as unknown, never as 0%',
    scanned?.tax?.source === 'unknown' ? scanned.tax.buyPct === null : true,
    scanned?.tax?.source || '');

  // The tier comparison reads five pools and their logs in one request, so it
  // sits closer to the outbound-call ceiling than the scan does. Checked on the
  // same busy token, and checked for the figure rather than for a 200: an
  // answer that came back with every tier unmeasured is a failure wearing the
  // shape of a success.
  // ONE PATIENT RETRY, AND THE REASON IS THIS CHECKER'S OWN LOAD.
  //
  // The pool scan directly above asks for the same token and reads the same
  // public endpoints. Run back to back they throttle each other, and the tier
  // scan then came back as a bare "no answer" — the identical line this check
  // would print if the endpoint were dead. A checker that cannot tell its own
  // footprint from an outage will eventually report one as the other, and the
  // day it matters it will be the wrong way round. So: a breath between the
  // two, one retry, and whatever actually came back gets named.
  const askTiers = () => askJson(`${SITE}/api/fee-tiers?address=0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82`);
  await new Promise((r) => setTimeout(r, 1500));
  let tiers = await askTiers();
  if (!tiers?.tiers?.length) {
    await new Promise((r) => setTimeout(r, 4000));
    const again = await askTiers();
    if (again?.tiers?.length) tiers = again;
    else tiers = { ...tiers, error: `${tiers.error || 'no tiers'} (twice, 4s apart)` };
  }
  const priced = (tiers?.tiers || []).filter((t) => t.fees_per_1000_usd_parked != null);
  // An incomplete comparison is a correct answer, not a failed one — since
  // 2026-08-29 the tool withholds the winner when a tier could not be read,
  // because ranking over whatever survived the rate limiter named the wrong
  // tier under load. So this reports completeness rather than demanding it, and
  // still fails when nothing at all came back priced.
  ok('Agents', 'fee-tier comparison answers with measured tiers',
    priced.length >= 2 && !!tiers?.measured_window?.minutes,
    !tiers || tiers.error ? (tiers?.error || 'no answer')
      : !tiers.measured_window?.minutes
        ? `${priced.length} tiers priced but the window's minutes could not be read (block timestamps refused) — the comparison is unusable without them`
        : tiers.comparison_complete === false
        ? `${priced.length} tiers priced over ${tiers.measured_window?.minutes} min; ${tiers.tiers_unreadable?.length} unreadable, so no winner declared — correct behaviour under a throttled log endpoint`
        : `${priced.length} tiers priced over ${tiers.measured_window?.minutes} min, best ${tiers.best_paying_tier}`);
  // The window has to travel with the figures. A tier yield without the window
  // it was measured over is the number this tool exists to stop people quoting.
  ok('Agents', 'the tier figures carry the window they were measured over',
    !tiers?.tiers?.length || (tiers?.measured_window?.blocks > 0 && /not annualised/i.test(tiers?.measured_window?.note || '')));

  // WORKING CAPITAL, checked for the property that makes it worth having.
  //
  // Not "is the field present" — a field that is present and equal to the pool
  // balance would mean the tick walk silently degraded to counting everything,
  // and the panel would keep printing a number that had quietly stopped saying
  // anything. So: it must be there, it must be a strict subset of what the pool
  // holds, and on a V2 pool it must land on the closed form it cannot avoid
  // (1 - 1/sqrt(1.02) = 0.985% of the balance, whatever the pool's size).
  const withBand = (tiers?.tiers || []).filter((t) => t.working_capital_usd != null);
  const v2row = (tiers?.tiers || []).find((t) => /^V2/.test(t.tier) && t.working_share_pct != null);
  const expectV2 = (1 - 1 / Math.sqrt(1 + (tiers?.band_pct || 2) / 100)) * 100;
  ok('Agents', 'working capital is measured and is a subset of the pool',
    withBand.length >= 2
      && withBand.every((t) => t.working_capital_usd <= t.capital_usd * 1.005)
      && (!v2row || Math.abs(v2row.working_share_pct - expectV2) < 0.05),
    !withBand.length ? 'no tier carried a working-capital figure'
      : `${withBand.length} tiers, band ±${tiers?.band_pct}%`
        + (v2row ? `, V2 share ${v2row.working_share_pct}% against ${expectV2.toFixed(3)}% required by the constant-product identity` : ''));

  // THE RANGE REPLAY, checked for the property that makes it honest.
  //
  // Not "did it answer" but "does it still discriminate": a wider range must
  // never be in range for less of the window than a narrower one inside it, and
  // a full-range position must collect least of all. If the width ever stopped
  // being used, every row would still be a plausible number and the ordering
  // would quietly go flat — which is the failure that looks most like success.
  await new Promise((r) => setTimeout(r, 1500));
  let rng = await askJson(`${SITE}/api/range-plan?address=0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82`);
  if (!rng?.ranges?.length) {
    await new Promise((r) => setTimeout(r, 4000));
    const again = await askJson(`${SITE}/api/range-plan?address=0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82`);
    if (again?.ranges?.length) rng = again; else rng = { ...rng, error: `${rng.error || 'no ranges'} (twice, 4s apart)` };
  }
  const rr = (rng?.ranges || []).filter((r) => !r.full_range);
  const rfull = (rng?.ranges || []).find((r) => r.full_range);
  const widerHoldsMore = rr.every((r, i) => i === 0 || r.share_of_window_in_range_pct == null
    || rr[i - 1].share_of_window_in_range_pct == null
    || r.share_of_window_in_range_pct >= rr[i - 1].share_of_window_in_range_pct - 0.05);
  ok('Agents', 'the range replay still separates the widths',
    rr.length >= 4 && !!rfull && widerHoldsMore
      && rfull.fees_usd_in_window <= Math.min(...rr.map((r) => r.fees_usd_in_window)) * 1.001,
    !rr.length ? (rng?.error || 'no answer')
      : `${rng.measured_window?.swaps} swaps over ${rng.measured_window?.minutes} min; narrowest that held ${rng.narrowest_range_that_held_the_whole_window || 'none'}`);

  // THE ROUTE CHECK, held to the one relation it cannot fake.
  //
  // Asked about $BOBAI, which charges a measurable transfer tax. The round trip
  // reported after tax, divided by the same trip through the pools alone, has
  // to equal (1 - buy) x (1 - sell) from the measured tax. If the tax ever
  // stopped being folded in — the bug this shipped with once, where a 3% token
  // was reported as returning 98.6% of a round trip — that ratio goes to
  // exactly 1 and this check is the only thing that would notice.
  await new Promise((r) => setTimeout(r, 1500));
  // A pair that is not quoted in BNB must not invent a sell tax (2026-09-18):
  // the sell test trades through the BNB pair and was solved against the
  // scanned pair's reserves — CAKE, which has no tax, read 99.87% on its USDT pair.
  const usdtPair = await askJson(`${SITE}/api/pool-scan?address=0xA39Af17CE4a8eb807E076805Da1e2B8EA7D0755b`);
  const simSell = usdtPair?.sellability?.tax?.sell_pct ?? usdtPair?.tax?.simulated?.sellPct ?? null;
  ok('Agents', 'a USDT-quoted pair of an untaxed token reads no sell tax', usdtPair != null && (simSell == null || simSell < 1), `CAKE/USDT simulated sell tax ${simSell}`);
  const route = await askJson(`${SITE}/api/best-route?address=0x245c386dcfed896f5c346107596141e5edcbffff&usd=100`);
  // The size asked for is the size answered (2026-09-18): the REST route handed
  // on the address alone, so every caller — the stdio MCP server included —
  // was answered for $250 whatever it asked. This call asks for $100.
  ok('Agents', 'the route check answers at the size that was asked', route?.size_usd === 100, `asked 100, answered ${route?.size_usd}`);
  const rt = route?.round_trip || {};
  const tx = route?.transfer_tax || {};
  const implied = (1 - (tx.buy_pct || 0) / 100) * (1 - (tx.sell_pct || 0) / 100);
  const seen = rt.you_keep_pct_pools_only > 0 ? rt.you_keep_pct / rt.you_keep_pct_pools_only : null;
  // $BOBAI trades a few times a day, so the tax is not always measurable inside
  // a 5,000-block window. When it is not, the ratio above is trivially 1.0 and
  // proves nothing — a green tick that means "we did not look" is the exact
  // failure this file exists to avoid. So there are two criteria, and which one
  // applied is stated rather than hidden: with a measured tax, the ratio has to
  // match it; without one, the answer has to carry the caveat saying the round
  // trip is optimistic. Either the arithmetic is verified or the honesty is.
  const taxSeen = (tx.buy_pct || 0) + (tx.sell_pct || 0) > 0;
  const sane = rt.you_keep_pct != null && rt.you_keep_pct < 100
    && rt.you_keep_pct <= rt.you_keep_pct_pools_only + 0.001;
  ok('Agents', taxSeen
    ? 'the route check folds the measured transfer tax into the round trip'
    : 'the route check declares a tax it could not measure',
    taxSeen
      ? (seen != null && Math.abs(seen - implied) < 0.005 && sane)
      : (sane && !!route?.round_trip_caveat),
    !route?.round_trip ? (route?.error || 'no answer')
      : taxSeen
        ? `keeps ${rt.you_keep_pct}% after tax against ${rt.you_keep_pct_pools_only}% through the pools alone; the measured ${tx.buy_pct}%/${tx.sell_pct}% tax implies ${implied.toFixed(4)} and the answer shows ${seen.toFixed(4)}`
        : `no trade in the window to measure the tax from, so the ratio would be a vacuous 1.0 — checked instead that the answer says so: "${String(route?.round_trip_caveat || 'NO CAVEAT').slice(0, 90)}"`);

  const sk = await getJson(`${SITE}/.well-known/skills/index.json`);
  const entry = sk.json?.skills?.[0];
  ok('Agents', 'skill manifest serves JSON', !!entry, sk.html ? 'HTML fallback' : '');
  if (entry) {
    const tar = await fetch(entry.url).then((x) => x.arrayBuffer()).catch(() => null);
    const buf = tar ? new Uint8Array(tar) : null;
    const sha = buf ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('') : '';
    ok('Agents', 'skill tarball is gzip and matches its digest',
      !!buf && buf[0] === 0x1f && buf[1] === 0x8b && 'sha256:' + sha === entry.digest);
  }
}

// ---- the paid service -----------------------------------------------------
{
  const r = await fetch(`${AGENT}/watch`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: '0x245c386dcfed896f5c346107596141e5edcbffff', pair: '0x6eadd4cb786898b34929444988380ed0cc6fd9a6' }),
  }).catch(() => null);
  ok('Paid', 'unpaid request is refused with 402', r?.status === 402, r ? `got ${r.status}` : 'no response');
  const hdr = r?.headers.get('PAYMENT-REQUIRED');
  let decoded = null;
  try { decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(hdr), (c) => c.charCodeAt(0)))); } catch {}
  ok('Paid', 'PAYMENT-REQUIRED decodes', !!decoded?.accepts?.length, `${decoded?.accepts?.length ?? 0} payment options`);

  const fake = await getJson(`${AGENT}/watch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': '0x' + '11'.repeat(32) },
    body: JSON.stringify({ token: '0x245c386dcfed896f5c346107596141e5edcbffff', pair: '0x6eadd4cb786898b34929444988380ed0cc6fd9a6' }),
  });
  ok('Paid', 'invented payment is rejected', /not found|malformed|need/i.test(fake.json?.reason || ''), fake.json?.reason || '');

  const guard = await fetch(`${AGENT}/run-checks`, { method: 'POST' }).catch(() => null);
  ok('Paid', 'admin trigger needs the secret', guard?.status === 403, guard ? `got ${guard.status}` : '');
}

// ---- brain plaza ----------------------------------------------------------
{
  const c = await getJson(`${SITE}/api-registry.json`);
  ok('Plaza', 'census data served', !!c.json?.registered_ids, c.html ? 'HTML fallback' : '');
  ok('Plaza', 'census scan was complete', c.json?.ids_scanned === c.json?.registered_ids,
    c.json ? `${c.json.ids_scanned?.toLocaleString('en-US')} of ${c.json.registered_ids?.toLocaleString('en-US')}` : '');
  ok('Plaza', 'nothing left unreadable', c.json?.registrations?.unread_after_retries === 0);

  const o = await getJson(`${SITE}/api-operators.json`);
  ok('Plaza', 'operator view served', (o.json?.operators || []).length > 0, `${o.json?.independent_operators ?? 0} operators`);

  const f = await getJson(`${AGENT}/find?q=protocol%20stats&limit=3`);
  ok('Plaza', 'broker returns candidates', (f.json?.results || []).length > 0, `${f.json?.returned ?? 0} of ${f.json?.searched ?? 0}`);

  // The safety rule the dispatcher exists to enforce, checked live rather than
  // trusted: a task naming an action must be declined, not answered sideways.
  const d = await getJson(`${AGENT}/dispatch`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task: 'build swap calldata and sign it' }),
  });
  ok('Plaza', 'dispatcher refuses action requests', d.json?.dispatched === false,
    (d.json?.reason || '').slice(0, 60));

  const cen = await getJson(`${AGENT}/census`);
  const last = cen.json?.last_checked_at;
  ok('Plaza', 'self-update ran in the last 48h', last ? ageHours(last) < 48 : false,
    last ? `${fmtAge(ageHours(last))} ago` : 'never');

  // The employment census. Checked the same way as the identity one: served,
  // complete, and nothing swept under the rug. The third check is the one that
  // matters — if SUBMITTED ever gets folded into COMPLETED, every reputation
  // figure on the page becomes flattering and wrong at the same time.
  const j = await getJson(`${SITE}/api-jobs.json`);
  ok('Plaza', 'employment census served', !!j.json?.jobs?.read, j.html ? 'HTML fallback' : '');
  ok('Plaza', 'job scan was complete', j.json?.jobs?.read === j.json?.jobs?.job_counter,
    j.json ? `${j.json.jobs?.read?.toLocaleString('en-US')} of ${j.json.jobs?.job_counter?.toLocaleString('en-US')}` : '');
  ok('Plaza', 'delivered is not confused with submitted',
    typeof j.json?.jobs?.escrow_released === 'number'
    && typeof j.json?.jobs?.deliverable_never_released === 'number'
    && j.json.jobs.escrow_released + j.json.jobs.deliverable_never_released <= j.json.jobs.read,
    j.json ? `${j.json.jobs?.escrow_released?.toLocaleString('en-US')} released, ${j.json.jobs?.deliverable_never_released?.toLocaleString('en-US')} not` : '');
}

// ---- can the bots still pay ------------------------------------------------
// Everything above proves a service answers. This proves it can still act.
// A wallet at zero throws nothing, logs nothing and answers every endpoint
// normally — it just stops sending transactions, which from the outside is a
// quiet market rather than a stopped bot. Balances are public, so this needs no
// key; scripts/gas-check.mjs is the same measurement on its own with the
// per-wallet detail and the refill plan.
{
  const client = createPublicClient({ chain: bsc, transport: http(RPC) });
  for (const w of WALLETS) {
    let balance = null;
    try { balance = await client.getBalance({ address: w.address }); } catch { balance = null; }
    const a = assess(w, balance);
    // A wallet that is empty on purpose passes. It is reported, with the reason,
    // so it is visible without being an alarm — a health check that is red for
    // a decision teaches everybody to ignore red.
    ok('Gas', `${w.name} can pay`, a.state === 'ok' || a.state === 'dormant',
      a.state === 'unknown' ? 'balance unreadable — not the same as empty'
        : a.state === 'dormant' ? 'not funded yet, and deliberately so — no position is open'
        : `${bnb(balance)}, ${a.cycles} cycle(s) of ${w.does}${a.state === 'low' ? ` — below floor, short ${bnb(a.short)}` : ''}`);
  }
  let src = null;
  try { src = await client.getBalance({ address: SOURCE.address }); } catch { src = null; }
  ok('Gas', 'the refill source holds its reserve', src !== null && src >= SOURCE.reserve,
    src === null ? 'balance unreadable' : `${bnb(src)} against a ${bnb(SOURCE.reserve)} reserve — this is the wallet to top up by hand`);
}

// ---- the DeFi agent --------------------------------------------------------
{
  const [r, pf] = await Promise.all([getJson(`${AGENT}/lp/agent?format=json`), getJson(`${AGENT}/lp/portfolio?format=json`)]);
  const rec = r.json;
  ok('DeFi', 'the DeFi agent record answers', !!(rec && rec.last), r.error || (r.html ? 'HTML fallback' : ''));
  if (rec && rec.last) {
    const wallet = rec.last.wallet || '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A';
    // Who holds the ranges the record names, asked of the position manager.
    // A burnt id reverts: that is "not held", which is the finding.
    let owners = null;
    if (rec.ladder && (rec.ladder.main != null || rec.ladder.reserve != null)) {
      owners = {};
      const client = createPublicClient({ chain: bsc, transport: http(RPC) });
      for (const id of [rec.ladder.main, rec.ladder.reserve].filter((x) => x != null)) {
        try { owners[String(id)] = await client.readContract({ address: '0x46a15b0b27311cedf172ab29e4f4766fbe7f4364', abi: [{ type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] }], functionName: 'ownerOf', args: [BigInt(id)] }); }
        catch (e) { owners[String(id)] = /revert|nonexistent|invalid token/i.test(String(e.shortMessage || e.message)) ? null : undefined; }
      }
      // An RPC that did not answer is not a finding: leave the check out.
      if (Object.values(owners).some((v) => v === undefined)) owners = null;
    }
    for (const c of defiVerdicts({ rec, portfolio: pf.json, owners, wallet })) ok('DeFi', c.label, c.pass, c.detail);
  }
}

// ---- the site -------------------------------------------------------------
{
  for (const [name, path] of [['homepage', '/'], ['Brain Plaza', '/registry'], ['scanner', '/scanner'], ['whitepaper', '/whitepaper'], ['the DeFi agent page', '/defi'], ['the Library', '/library']]) {
    const r = await fetch(SITE + path).catch(() => null);
    const body = r ? await r.text() : '';
    ok('Site', `${name} serves real content`, !!r?.ok && body.length > 2000 && /<title>/.test(body));
  }
  // The clone the site promises on /source, the homepage tile, llms.txt and
  // the agent card (2026-09-18): info/refs must name main, or a clone fails.
  const refs = await fetch(SITE + '/source.git/info/refs?service=git-upload-pack').then((r) => (r.ok ? r.text() : null)).catch(() => null);
  ok('Site', 'the source mirror can still be cloned', /^[0-9a-f]{40}\s+refs\/heads\/main/m.test(refs || ''), refs ? refs.trim().split('\n')[0].slice(0, 60) : 'info/refs did not answer');
  const csp = (await fetch(SITE).catch(() => null))?.headers.get('content-security-policy') || '';
  ok('Site', 'CSP allows the agent subdomain', csp.includes('agent.brainonbnb.com'));
}

return results;
}
