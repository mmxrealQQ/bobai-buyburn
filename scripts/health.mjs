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
// Usage: node scripts/health.mjs
import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import { WALLETS, SOURCE, assess, bnb } from './lib/gas-wallets.mjs';

const SITE = 'https://brainonbnb.com';
const AGENT = 'https://agent.brainonbnb.com';
const LOGS = 'https://logs.brainonbnb.com';
// The Telegram bot has no custom domain; workers.dev is its only public origin.
const TG_BOT = 'https://bobai-tg-bot.bobbuildonbnb.workers.dev';
// Explicit, so the gas section reads the same node the bots spend against.
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';

const UA = { 'user-agent': 'bobai-smoke-test' }; // not counted in public stats
const _fetch = globalThis.fetch;
globalThis.fetch = (url, init = {}) =>
  _fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) } });

const results = [];
const ok = (area, name, good, detail = '') => results.push({ area, name, good, detail });

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
const getJson = async (url, init) => {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    if (/^\s*<!doctype html/i.test(text)) return { html: true, status: r.status };
    try { return { json: JSON.parse(text), status: r.status }; }
    catch { return { text, status: r.status }; }
  } catch (e) { return { error: String(e.message || e) }; }
};

const ageHours = (iso) => (Date.now() - new Date(iso).getTime()) / 3600000;
const fmtAge = (h) => (h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);

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
  }
}
{
  // The Telegram bot was in no check at all until 29 August. It is the surface
  // the channel sees — buy alerts, burn alerts, every command — and a stopped
  // cron is indistinguishable from a quiet market from the outside. So it
  // publishes its own heartbeat, written every tenth minute by its cron, and
  // this reads the age of it rather than the fact that the worker answers:
  // a worker whose cron has died still serves HTTP perfectly.
  const h = await getJson(`${TG_BOT}/health`);
  const j = h.json;
  ok('Bots', 'telegram bot answers', !!j?.ok, h.error || (h.html ? 'HTML fallback' : ''));
  if (j) {
    const age = typeof j.age_seconds === 'number' ? j.age_seconds : null;
    ok('Bots', 'telegram bot cron alive', j.cron_alive === true,
      age === null ? 'no heartbeat recorded yet' : `last tick ${fmtAge(age / 3600)} ago`);
    ok('Bots', 'telegram bot can post', j.channel_configured === true,
      j.channel_configured ? 'token + chat id set' : 'BOT_TOKEN or chat id missing — alerts would fail silently');
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

  const sk = await getJson(`${SITE}/.well-known/skills/index.json`);
  const entry = sk.json?.skills?.[0];
  ok('Agents', 'skill manifest serves JSON', !!entry, sk.html ? 'HTML fallback' : '');
  if (entry) {
    const tar = await fetch(entry.url).then((x) => x.arrayBuffer()).catch(() => null);
    const buf = tar ? Buffer.from(tar) : null;
    ok('Agents', 'skill tarball is gzip and matches its digest',
      !!buf && buf[0] === 0x1f && buf[1] === 0x8b
      && 'sha256:' + (await import('node:crypto')).createHash('sha256').update(buf).digest('hex') === entry.digest);
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
  try { decoded = JSON.parse(Buffer.from(hdr, 'base64').toString('utf8')); } catch {}
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

// ---- the site -------------------------------------------------------------
{
  for (const [name, path] of [['homepage', '/'], ['Brain Plaza', '/registry'], ['scanner', '/scanner'], ['whitepaper', '/whitepaper']]) {
    const r = await fetch(SITE + path).catch(() => null);
    const body = r ? await r.text() : '';
    ok('Site', `${name} serves real content`, !!r?.ok && body.length > 2000 && /<title>/.test(body));
  }
  const csp = (await fetch(SITE).catch(() => null))?.headers.get('content-security-policy') || '';
  ok('Site', 'CSP allows the agent subdomain', csp.includes('agent.brainonbnb.com'));
}

// ---- report ---------------------------------------------------------------
const areas = [...new Set(results.map((r) => r.area))];
let bad = 0;
console.log('');
for (const a of areas) {
  console.log(a);
  for (const r of results.filter((x) => x.area === a)) {
    if (!r.good) bad++;
    console.log(`  ${r.good ? 'ok  ' : 'FAIL'}  ${r.name.padEnd(42)} ${r.detail}`);
  }
  console.log('');
}
console.log(bad === 0
  ? `${results.length} checks, everything running\n`
  : `${results.length} checks, ${bad} FAILING\n`);
process.exit(bad ? 1 : 0);
