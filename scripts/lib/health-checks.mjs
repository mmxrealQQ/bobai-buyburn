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
// every call gets a deadline unless it brings its own (2026-10-07): one origin that hangs held the whole
// morning run past the cron's wall time, and then no message went out at all
const fetch = (url, init = {}) =>
  globalThis.fetch(url, { signal: AbortSignal.timeout(30000), ...init, headers: { ...UA, ...(init.headers || {}) } });

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
// `since` = the first day the post existed: a day before it is not owed (the market card was born 2026-10-09 06:29 UTC
// and the morning check called its missing 10-08 card red).
export const dailyOnTime = (flag, closesUtc, now = new Date(), since = '') => {
  const day = (d) => d.toISOString().slice(0, 10);
  const due = now.getUTCHours() >= closesUtc ? day(now) : day(new Date(now.getTime() - 86400000));
  if (since && due < since) return true;
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
    [dailyOnTime('2026-09-11', 9, at(7)), false], [dailyOnTime(null, 9, at(7)), false],
    // born on the 17th: the 16th's post is not owed, the 17th's is once its window closed
    [dailyOnTime(null, 9, at(7), '2026-09-17'), true], [dailyOnTime(null, 9, at(10), '2026-09-17'), false], [dailyOnTime(null, 9, at(10), '2026-09-16'), false]];
  return pins.every(([got, want]) => got === want);
};

// THE BOT TOLD WHAT HAPPENED (2026-10-09). Read from the Telegram bot's /health (buy_alerts, burn_alerts): every buy
// of $100+ in the last day that the ledger saw is marked by the alert scan (told, queued for its NFT, or one of the
// project's own wallets — those are marked when skipped); no buy waits for its NFT past a quarter hour (the bot tells
// it after five minutes either way); and the dead address does not hold 1,000+ BOBAI more than the last burn told for
// over an hour. A bot that does not report it is red: the check cannot be green on silence. Pure; pinned below.
export function tgEvidenceVerdicts(j, now = Date.now()) {
  const out = [];
  const add = (name, good, detail) => out.push({ name, good: !!good, detail });
  const ba = j && j.buy_alerts;
  if (!ba || ba.error) {
    add('every $100+ buy of the last 24 h was posted', false, ba ? `the bot could not read it: ${ba.error}` : 'the bot does not report buy_alerts');
    add('no buy alert waits for its NFT longer than 15 min', false, 'the bot does not report its queue');
  } else {
    const short = (t) => String(t).slice(0, 10) + '…';
    add('every $100+ buy of the last 24 h was posted', ba.missing_count === 0,
      `${ba.posted} of ${ba.buys_100_24h} marked${ba.missing_count ? ` — ${ba.missing_count} never told: ${(ba.missing || []).map(short).join(', ')}` : ''}`);
    // told once (2026-10-25): a bot that does not report it yet (before its deploy) is not judged on it
    if (ba.told_twice_7d != null) add('no buy was told twice in the last 7 days', ba.told_twice_7d === 0, ba.told_twice_7d ? `${ba.told_twice_7d} told twice: ${(ba.told_twice || []).map(short).join(', ')}` : 'each buy told once');
    const old = ba.pending && ba.pending.oldest_min;
    add('no buy alert waits for its NFT longer than 15 min', !(old > 15), ba.pending && ba.pending.count ? `${ba.pending.count} waiting, the oldest ${old} min` : 'nothing waiting');
  }
  const bu = j && j.burn_alerts;
  if (!bu || bu.error) add('burn alerts are not stuck', false, bu ? `the bot could not read it: ${bu.error}` : 'the bot does not report burn_alerts');
  else if (bu.gap == null) add('burn alerts are not stuck', false, `the dead balance or the last burn told could not be read (last_burned ${bu.last_burned})`);
  else if (bu.gap < 1000) add('burn alerts are not stuck', true, `dead address ${Math.round(bu.gap).toLocaleString('en-US')} BOBAI above the last burn told`);
  else {
    const h = bu.stuck_since ? (now - Date.parse(bu.stuck_since)) / 36e5 : null;
    add('burn alerts are not stuck', !(h != null && h >= 1), `${Math.round(bu.gap).toLocaleString('en-US')} BOBAI burned and not told${h == null ? ' — the bot meets it on its next tick' : `, could not go out for ${fmtAge(h)}`}`);
  }
  return out;
}
const tgEvidenceHolds = () => {
  const now = Date.parse('2026-10-09T09:10:00Z');
  const v = (j) => tgEvidenceVerdicts(j, now).map((x) => x.good).join();
  const fine = { buy_alerts: { buys_100_24h: 4, posted: 4, missing_count: 0, missing: [], pending: { count: 0, oldest_min: null } }, burn_alerts: { gap: 12, last_burned: 1, stuck_since: null } };
  return v(fine) === 'true,true,true'
    && v({ ...fine, buy_alerts: { ...fine.buy_alerts, posted: 3, missing_count: 1, missing: ['0xabc'] } }) === 'false,true,true'
    && v({ ...fine, buy_alerts: { ...fine.buy_alerts, pending: { count: 1, oldest_min: 22 } } }) === 'true,false,true'
    && v({ ...fine, burn_alerts: { gap: 50000, stuck_since: '2026-10-09T07:00:00Z' } }) === 'true,true,false'
    && v({ ...fine, burn_alerts: { gap: 50000, stuck_since: '2026-10-09T08:50:00Z' } }) === 'true,true,true'
    && v({ ...fine, burn_alerts: { gap: 50000, stuck_since: null } }) === 'true,true,true'
    && v({ ok: true }) === 'false,false,false'
    // told once (25.10.): judged only once the bot reports it; a buy in the record twice reads red
    && v({ ...fine, buy_alerts: { ...fine.buy_alerts, told_twice_7d: 0, told_twice: [] } }) === 'true,true,true,true'
    && v({ ...fine, buy_alerts: { ...fine.buy_alerts, told_twice_7d: 1, told_twice: ['0xdef'] } }) === 'true,false,true,true';
};

// A PAYMENT REFUSED ON OUR SIDE (2026-10-25): /buys/refused keeps every payment that came back without buying, with
// the reason the paying path gave. A payer's own fault — no balance, a used or expired signature, the wrong amount,
// token or signer, input missing, a hash not found, the facilitator's own policy — is the payer's; any other reason
// (an RPC that failed, a settle we could not send, a reason this list does not know) is ours to look at and reads red.
// Our own checks (brainonbnb- user agents) and our site are left out; the last 24 h. Pure; pinned below.
export const PAYER_SIDE = /exceeds balance|insufficient|malformed|not a scan pass|not issued by|expired|more than a day old|failed on-chain|already been used|transaction not found|paid [\d.]+ .* need|signature|signer|not valid yet|expires too soon|nonce|must be|is not (a|an) |below the price|above the price|smaller than the price|another token|not a Permit2|policy:|below_line|bad_issued|holder pass not accepted|needs `|the pass needs [\d,]+ \$BOBAI/i;   // 26.10.: "holds 0 $BOBAI; the pass needs 1,000,000 $BOBAI" read red
export function refusedVerdict(list, now = Date.now()) {
  if (!Array.isArray(list)) return { good: false, detail: 'the agent server did not report /buys/refused' };
  const day = list.filter((r) => r && !/^brainonbnb-/i.test(r.ua || '') && !r.own_site && now - Date.parse(r.at) < 864e5);
  const ours = day.filter((r) => !PAYER_SIDE.test(r.why || ''));
  return { good: ours.length === 0, detail: ours.length
    ? `${ours.length} refused on our side: ${ours.slice(0, 2).map((r) => `${r.product} ${String(r.at).slice(11, 16)} — ${String(r.why || 'no reason').slice(0, 90)}`).join(' | ')}`
    : `${day.length} refused in 24 h, each for the payer's own reason${day.length ? ' (' + [...new Set(day.map((r) => (String(r.why).match(PAYER_SIDE) || ['?'])[0]))].slice(0, 2).join('; ') + ')' : ''}` };
}
const refusedHolds = () => {
  const now = Date.parse('2026-10-25T16:00:00Z'), at = '2026-10-25T15:45:00Z';
  const g = (list) => refusedVerdict(list, now).good;
  return g([]) === true
    && g([{ at, ua: 'node', product: 'answer:x', why: 'verify: the payment would not settle: Execution reverted with reason: ERC20: transfer amount exceeds balance' }]) === true
    && g([{ at, ua: 'node', product: 'answer:x', why: 'verify: the payment would not settle: HTTP request failed. Status: 429' }]) === false
    && g([{ at, ua: 'node', product: 'answer:x', why: 'the settlement could not be sent' }]) === false
    && g([{ at, ua: 'brainonbnb-paycheck/1', product: 'answer:x', why: 'HTTP request failed' }]) === true
    && g([{ at: '2026-10-24T10:00:00Z', ua: 'node', product: 'answer:x', why: 'HTTP request failed' }]) === true
    && g([{ at, ua: 'x', product: 'tip', why: 'transaction not found — if it was just sent, wait for it to confirm' }]) === true
    // a wallet below the holder-pass line is the payer's (26.10.: two such read red in the morning message)
    && g([{ at, ua: 'Mozilla/5.0', product: 'answer:health_factor', proof: 'holder pass', why: '0x68a6c61bc99b7113cbc8765fa548ebca0a033101 holds 0 $BOBAI; the pass needs 1,000,000 $BOBAI.' }]) === true
    && g([{ at, ua: 'node', product: 'answer:x', why: 'the pass needs a reading of the chain that failed' }]) === false
    && g(null) === false;
};

// FIVE WALLETS KEEP 808.41 BOBAI (operator, 2026-10-08): the buyback wallet 1ce (worker/index.js KEEP_TOKENS), the
// creator wallet d38 (add-liquidity-safe.js KEEP_BOBAI), the NFT relayer, the Giggle pot and the operator's wallet.
// "Exactly" to the hundredth: the operator's wallet carries 0.000000003 BOBAI of dust from a tax rounding, which is
// not a broken rule; anything a cent off is. A transient while a burn or a liquidity run is mid-way recovers within
// the minute the morning run waits before asking again. Pure; pinned below.
export const KEEP_808_WALLETS = {
  'buyback 0xdeFC…01ce': '0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce',
  'creator 0x15Ba…3d38': '0x15Ba17075ef5E0736292b030e3715d9100fe3d38',
  'NFT relayer 0xBFB4…ddb2': '0xBFB4b49787CE948C1Ee304f6C197a0E8b038ddb2',
  'Giggle pot 0x5E41…D105': '0x5E4102520A71B2AA18a1208330d4848dea4BD105',
  'operator 0x5c82…dc3C': '0x5c82D2F12EE6AC09297784f94ebF9331277Bdc3C',
};
// AT LEAST, FOR HIS OWN WALLET (operator, 2026-10-10: "I added BOBAI to c3c — that is normal and must not be an error"):
// the operator's wallet is his own; it may hold more than 808.41 whenever he likes, only below it is red. The other four
// are bots' wallets whose code keeps exactly 808.41.
export const KEEP_808_AT_LEAST = new Set(['0x5c82D2F12EE6AC09297784f94ebF9331277Bdc3C']);
// THREE WALLETS KEEP 80,841 BOBAI (operator, 2026-10-20: "these three at 80841, fixed"): topped up once by the NFT relayer
// (temp/topup-80841.mjs, buy 0x945dbd97…). x402 income is paid in $BOBAI too and keeps all of it, so it holds AT LEAST.
export const KEEP_80841_WALLETS = {
  'Altana admin 0xC5A1…F7d3': '0xC5A17B5295Fc50BAdB1F9f9C09b412fE5e84F7d3',
  'agent provider 0x7380…5963': '0x73809F69916FcF7Ddc5BB1315fBdf96A569a5963',
  'x402 income 0x690E…4dE4': '0x690E950214980BC329823A2DB2fD90C06Bd54dE4',
};
export const KEEP_80841_AT_LEAST = new Set(['0x690E950214980BC329823A2DB2fD90C06Bd54dE4']);
const KEEP_WEI = 80841n * 10n ** 16n, KEEP_TOL_WEI = 10n ** 16n, KEEP_BIG_WEI = 80841n * 10n ** 18n;
export function keepVerdict(label, wei, atLeast = false, keep = KEEP_WEI) {
  const amt = (Number(keep / 10n ** 14n) / 1e4).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const name = `${label} holds ${atLeast ? 'at least ' : ''}${amt} BOBAI`;
  if (typeof wei !== 'bigint') return { name, good: false, detail: 'could not be read' };
  const diff = wei - keep, off = diff < 0n ? -diff : diff, good = atLeast ? diff >= -KEEP_TOL_WEI : off <= KEEP_TOL_WEI;
  const shown = (Number(wei) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 4 });
  return { name, good, detail: good ? `${shown} BOBAI` : `${shown} BOBAI — ${diff < 0n ? 'below' : 'above'} the ${amt} it keeps` };
}
const keepHolds = () => keepVerdict('x', 808410000002992638762n).good === true && keepVerdict('x', 808410000000000000000n).good === true
  && keepVerdict('x', 0n).good === false && keepVerdict('x', 26792110000000000000000n).good === false && keepVerdict('x', 808390000000000000000n).good === false
  && keepVerdict('x', null).good === false
  && keepVerdict('x', 26792110000000000000000n, true).good === true && keepVerdict('x', 808390000000000000000n, true).good === false && keepVerdict('x', null, true).good === false
  && keepVerdict('x', KEEP_BIG_WEI, false, KEEP_BIG_WEI).good === true && keepVerdict('x', KEEP_WEI, false, KEEP_BIG_WEI).good === false
  && keepVerdict('x', KEEP_BIG_WEI + 10n ** 18n, false, KEEP_BIG_WEI).good === false && keepVerdict('x', KEEP_BIG_WEI + 10n ** 18n, true, KEEP_BIG_WEI).good === true
  && keepVerdict('x', KEEP_BIG_WEI - 10n ** 18n, true, KEEP_BIG_WEI).good === false && keepVerdict('x', KEEP_BIG_WEI, false, KEEP_BIG_WEI).name === 'x holds 80,841 BOBAI';
export async function readKeepBalances(rpc = 'https://bsc-dataseed.binance.org') {
  const client = createPublicClient({ chain: bsc, transport: http(rpc) });
  const abi = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }];
  const bal = (a) => client.readContract({ address: '0x245c386dcfed896f5c346107596141e5edcbffff', abi, functionName: 'balanceOf', args: [a] });
  const all = [...Object.entries(KEEP_808_WALLETS).map(([l, a]) => [l, a, KEEP_808_AT_LEAST.has(a), KEEP_WEI]),
    ...Object.entries(KEEP_80841_WALLETS).map(([l, a]) => [l, a, KEEP_80841_AT_LEAST.has(a), KEEP_BIG_WEI])];
  return Promise.all(all.map(async ([label, a, least, keep]) => {
    try {
      const v = keepVerdict(label, await bal(a), least, keep);
      if (v.good) return v;
      // MID-RUN IS NOT BROKEN (2026-10-09 review): a liquidity run of d38 lasts minutes, longer than the minute the
      // morning run waits, and its wallet holds more than 808.41 between its steps. Off by more than a cent: look
      // again 45 s later — a wallet that sent a transaction meanwhile (or is back at 808.41) is mid-run, not judged.
      const n0 = await client.getTransactionCount({ address: a, blockTag: 'latest' });
      await new Promise((r) => setTimeout(r, 45000));
      const [n1, again] = await Promise.all([client.getTransactionCount({ address: a, blockTag: 'latest' }), bal(a)]);
      const v2 = keepVerdict(label, again, least, keep);
      if (v2.good) return v2;
      return n1 > n0 ? { ...v2, good: true, detail: `${v2.detail.split(' — ')[0]} — mid-run (sent ${n1 - n0} tx in 45 s), not judged` } : v2;
    } catch { return keepVerdict(label, null, least, keep); }
  }));
}

// THE HOURLY LIGHT LOOK (2026-10-09). The morning run is once a day; a bot that stops at 09:30 was unseen for a day.
// Every hour the health worker asks only the three things that silence the channel — the Telegram bot's heartbeat,
// whether it can post, and the buyback bot's heartbeat — and speaks only when one is red (asked twice, like the
// morning run). Pure over the two /health answers; runLight fetches them.
export function lightVerdicts(tg, logs, now = Date.now()) {
  const out = [];
  const add = (name, good, detail) => out.push({ area: 'Bots', name, good: !!good, detail });
  if (!tg || !tg.ok) add('telegram bot answers', false, tg && tg.error ? tg.error : 'no answer');
  else {
    add('telegram bot cron alive', tg.cron_alive === true, typeof tg.age_seconds === 'number' ? `last tick ${fmtAge(tg.age_seconds / 3600)} ago` : 'no heartbeat recorded');
    const se = tg.last_send_error, seAge = se && se.at ? (now - Date.parse(se.at)) / 36e5 : null, seRed = !!(se && se.lasting && seAge != null && seAge < 24);
    add('telegram bot can post', tg.channel_configured === true && !seRed, !tg.channel_configured ? 'BOT_TOKEN or chat id missing' : seRed ? `Telegram refused ${se.method} ${fmtAge(seAge)} ago: ${se.description}` : 'yes');
  }
  const b = logs && logs.buyback ? (now - Date.parse(logs.buyback)) / 36e5 : null;
  add('buyback bot ran recently', b != null && b < 1, b == null ? 'no heartbeat' : `last run ${fmtAge(b)} ago`);
  return out;
}
export async function runLight({ tgFetch = fetch } = {}) {
  return (await runLightFull({ tgFetch })).results;
}
// The same look, with each bot's heartbeat age in minutes (null = none): the three crons that tick on their own —
// the Telegram bot (heartbeat every tenth minute), the buyback bot (every ten minutes), the dev buyback (hourly).
export async function runLightFull({ tgFetch = fetch, now = Date.now() } = {}) {
  const [t, l] = await Promise.all([getJson(`${TG_BOT}/health`, undefined, tgFetch), getJson(`${LOGS}/health`)]);
  const tg = t.json || (t.error ? { error: t.error } : null), logs = l.json || null;
  const min = (iso) => (iso ? Math.round((now - Date.parse(iso)) / 6e4) : null);
  return { results: lightVerdicts(tg, logs, now), ages: { tg: tg && typeof tg.age_seconds === 'number' ? Math.round(tg.age_seconds / 60) : null, buyback: min(logs && logs.buyback), dev: min(logs && logs.devBuyback) } };
}

// IS IT US OR CLOUDFLARE (2026-10-23). On 23.10. the hourly look went red at 03:40 UTC while every bot was healthy:
// Cloudflare started cron ticks up to 13 minutes late (the buyback bot's 03:50 tick ran at 04:03, its 04:00 tick at
// 04:05:59). A late heartbeat reads the same whether a bot is stuck or its tick was not started. Two witnesses tell
// them apart: how late Cloudflare started this look itself (scheduledTime vs now), and whether every bot is late
// together (each against its own rhythm: TG 10 min, buyback 10 min, dev buyback 60 min) or only one. Pure.
export const LATE_RHYTHM_MIN = { tg: 10, buyback: 10, dev: 60 };
export function dispatchNote(failing, ages = {}, lookLateMin = 0) {
  const beats = (failing || []).filter((r) => /cron alive|ran recently/.test(r.name));
  if (!beats.length) return '';
  const late = Object.keys(LATE_RHYTHM_MIN).filter((k) => ages[k] == null || ages[k] > LATE_RHYTHM_MIN[k] + 2);
  const said = (k) => `${{ tg: 'TG bot', buyback: 'buyback', dev: 'dev buyback' }[k]} ${ages[k] == null ? 'none' : ages[k] + ' min'}`;
  const all = Object.keys(LATE_RHYTHM_MIN).map(said).join(', ');
  if (lookLateMin >= 2 || late.length === Object.keys(LATE_RHYTHM_MIN).length)
    return `☁️ Likely Cloudflare, not a stuck bot: ${lookLateMin >= 2 ? `this look itself was started ${Math.round(lookLateMin)} min late` : 'every bot is late together'} (last ticks: ${all}).`;
  return `🔎 Only ${late.map(said).join(' and ')} — the other bots tick on time, so look at ${late.length === 1 ? 'this one' : 'these'} (last ticks: ${all}).`;
}

// `rpc`: explicit, so the gas section reads the same node the bots spend
// against. `tgFetch`: how to reach the Telegram bot — a worker cannot fetch a
// sibling's workers.dev address (it gets a 404 from Cloudflare's own router),
// so the health worker hands in its service binding here. `nftFetch`: the same for the NFT minter (2026-10-26: its
// drop log was asked at its workers.dev address and every morning read "the minter did not report its drops").
export async function runHealth({ rpc = 'https://bsc-dataseed.binance.org', tgFetch = fetch, nftFetch = fetch, buybackPrior = null } = {}) {
const RPC = rpc;
const results = [];
const ok = (area, name, good, detail = '') => results.push({ area, name, good, detail });
ok('Health', 'the daily-post rule passes its own pins', dailyOnTimeHolds());
ok('Health', 'the DeFi agent checks pass their own pins (the day it stood still reads red)', defiVerdictsHold());
ok('Health', 'the buyback-wallet rule passes its own pins (tax held through a run reads red, tax that just arrived does not)', buybackVerdictHolds());
ok('Health', 'the told-buys / burn-alert rules pass their own pins (an untold buy, a stuck queue, a burn stuck an hour read red)', tgEvidenceHolds());
ok('Health', 'the refused-payment rule passes its own pins (a payer\'s empty wallet is theirs, a failed RPC or an unknown reason is ours)', refusedHolds());
ok('Health', 'the 808.41 rule passes its own pins (dust is fine, a cent off is not, an unread wallet is red)', keepHolds());

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
    // Configured is not the same as able (2026-10-07): a refused send in the last day for a lasting cause (kicked,
    // no rights, chat gone) is red; a passing one (a rate limit, a timeout) is named, not red.
    const se = j.last_send_error, seAge = se && se.at ? (Date.now() - Date.parse(se.at)) / 36e5 : null, seRed = !!(se && se.lasting && seAge != null && seAge < 24);
    ok('Bots', 'telegram bot can post', j.channel_configured === true && !seRed,
      !j.channel_configured ? 'BOT_TOKEN or chat id missing — alerts would fail silently'
        : seRed ? `Telegram refused ${se.method} ${fmtAge(seAge)} ago: ${se.description}`
        : se && seAge != null && seAge < 24 ? `token + chat id set; a passing refusal ${fmtAge(seAge)} ago (${se.description})` : 'token + chat id set, no refused send in the last day');
    // The heartbeat proves the cron runs, not that the daily posts go out: the
    // whale recap was silent 2026-09-12 to 09-17 behind a green heartbeat.
    const d = j.daily || {};
    ok('Bots', 'whale recap went out (internal, 06:00 UTC)', dailyOnTime(d.whale_recap, 9), `last sent ${d.whale_recap || 'never'}`);
    ok('Bots', 'DeFi card went out (channel, 05:00 UTC)', dailyOnTime(d.lp_card, 8), `last sent ${d.lp_card || 'never'}`);
    // 2026-10-09: the public 24 h market card (16:00-18:59 UTC); an older bot that does not name it is not asked
    if ('market_card' in d) ok('Bots', 'market card went out (channel, 16:00 UTC)', dailyOnTime(d.market_card, 19, new Date(), '2026-10-09'), `last sent ${d.market_card || 'never'}`);
    for (const v of tgEvidenceVerdicts(j)) ok('Bots', v.name, v.good, v.detail);
    // ONE NFT PER BUY (2026-10-25, operator: "es gab wieder zwei NFT"): the drop log of the minter, the last 36 h (wider
    // than the day between two reports); two drops for one buy transaction is the double mint MintGate stops (23.10.)
    { const dr = await getJson('https://bobai-nft-mint.bobbuildonbnb.workers.dev/drops', undefined, nftFetch), D = dr.json && Array.isArray(dr.json.drops) ? dr.json.drops : null; // getJson, the module's: runHealth's getJ is declared further down
      if (!D) ok('Bots', 'no buy got two NFTs in the last 36 h', false, 'the minter did not report its drops');
      else { const since = Date.now() - 36 * 3600e3, n = new Map();
        for (const d of D) { const t = d.ts < 1e12 ? d.ts * 1000 : d.ts; if (t >= since && d.buyTx) n.set(String(d.buyTx).toLowerCase(), (n.get(String(d.buyTx).toLowerCase()) || 0) + 1); }
        const two = [...n].filter(([, c]) => c > 1).map(([k]) => k.slice(0, 10) + '…');
        ok('Bots', 'no buy got two NFTs in the last 36 h', !two.length, two.length ? `${two.length} buy(s) minted twice: ${two.join(', ')}` : `${n.size} buy(s), one NFT each`); } }
    // informational: a degraded log scan walks on from its cursor (2026-10-09); said, not red
    ok('Bots', 'telegram bot log scans read whole (informational)', true, j.scan_degraded_since ? `degraded since ${j.scan_degraded_since}, walking from the cursor` : 'not degraded');
  }
}
{
  for (const v of await readKeepBalances(RPC)) ok('Bots', v.name, v.good, v.detail);
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

  // THE HIRE AND PAY SURFACES OF 2026-10-04, checked daily.
  const getJ = (u, init) => fetch(u, { ...(init || {}), signal: AbortSignal.timeout(30000) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })).catch(() => ({ status: 0, body: null }));
  // 1. Each agent of ours answers at its own endpoint with a card whose name and id are its registration's.
  const CARDS = { 'health-factor': [302257, 'Brain on BNB — Venus Health Factor Monitor'], 'grid-trader': [302258, 'Brain on BNB — BSC Grid Planner'], 'yield-optimizer': [304493, 'Brain on BNB — Venus Yield Ranking'], rebalancer: [304494, 'Brain on BNB — Portfolio Rebalance Pricer'], 'lp-placement': [310460, 'Brain on BNB — PancakeSwap Fee Tier Placement'], 'defi-agent': [363709, 'Brain on BNB — DeFi Agent'] };
  const cardBad = [];
  for (const [slug, [id, name]] of Object.entries(CARDS)) {
    const c = (await getJ(`${AGENT}/${slug}/a2a/.well-known/agent-card.json`)).body;
    if (!c || c.name !== name || !(c.registrations || []).some((r) => r.agentId === id) || !(c.skills || []).some((s) => s.id === 'negotiate-erc8183-job')) cardBad.push(slug);
  }
  ok('Agents', 'each of our six agents has its own card matching its registration', cardBad.length === 0, cardBad.length ? `wrong or missing: ${cardBad.join(', ')}` : 'six cards');
  // 2. BNB's standard hire: a signed quote naming the agentWallet — the one the registry holds for that agent, read
  // here (2026-10-21: the two Venus agents get wallets of their own; an SDK buyer refuses a quote from any other).
  const QUOTED = { 'defi-agent': [363709, 'health check: plan for position 7575224'], 'health-factor': [302257, 'health check: health factor of 0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A on Venus'], 'yield-optimizer': [304493, 'health check: best stablecoin yield on Venus'] };
  const quoteBad = [];
  for (const [slug, [id, task]] of Object.entries(QUOTED)) {
    const sq = (await getJ(`${AGENT}/${slug}/a2a`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'health', parts: [{ kind: 'data', data: { skill: 'negotiate-erc8183-job', task_description: task, terms: { deliverables: 'plan', quality_standards: 'on-chain' } } }] } } }) })).body;
    const env = sq?.result?.parts?.[0]?.data;
    const word = await fetch('https://bsc-dataseed1.defibit.io', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', data: '0x00339509' + BigInt(id).toString(16).padStart(64, '0') }, 'latest'] }) }).then((r) => r.json()).then((j) => j.result).catch(() => null);
    const wallet = word && word.length >= 66 ? '0x' + word.slice(26, 66) : null;
    const good = /^0x[0-9a-f]{64}$/i.test(env?.negotiation_hash || '') && /^0x[0-9a-f]{130}$/i.test(env?.provider_sig || '') && !!wallet && String(env?.provider_address || '').toLowerCase() === wallet;
    if (!good) quoteBad.push(`${slug}: quote ${env?.provider_address || JSON.stringify(sq).slice(0, 60)} vs agentWallet ${wallet}`);
  }
  ok('Agents', 'a signed ERC-8183 quote comes back from each agent, naming its agentWallet', quoteBad.length === 0, quoteBad.length ? quoteBad.join('; ') : 'DeFi agent, health factor, yield: each signed by its agentWallet');
  // 3. The funded-job watcher keeps up with the kernel.
  const watch = (await getJ(`${AGENT}/jobs/watch`)).body;
  const counterHex = await fetch('https://bsc-dataseed1.defibit.io', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '0xEa4DAa3100A767e86FDed867729ae7446476EBA6', data: '0x50355d76' }, 'latest'] }) }).then((r) => r.json()).then((j) => j.result).catch(() => null);
  const counter = counterHex ? Number(BigInt(counterHex)) : null;
  ok('Agents', 'the funded-job watcher is level with the escrow kernel', counter != null && watch?.cursor_job_id != null && counter - watch.cursor_job_id <= 30 && !Object.keys(watch.retrying || {}).length, `kernel ${counter} · cursor ${watch?.cursor_job_id} · retrying ${Object.keys(watch?.retrying || {}).length}`);
  // 3b. Marque keeps listing our six agents only while they answered a probe in the last 24 h (2026-10-06: five had
  //     dropped off); the agent worker asks Marque to probe every 8 h. Each round must be fresh and every agent answer.
  const mp = watch?.marque_probe, mpAge = mp?.at ? (Date.now() - Date.parse(mp.at)) / 3600e3 : null, mpBad = mp ? Object.entries(mp.agents || {}).filter(([, v]) => !v.ok).map(([k]) => '#' + k) : [];
  // ONLY DISCOVERED IS NOT A FAULT (2026-10-22): since 21.10. Marque's probe only discovers (discoveryOnly: true,
  // "message/send not validated") and answers ok:false for every agent, ours and others' alike — red every day while all
  // six stayed listed (the listing has its own check below). Red here: a stale round, or an agent Marque could not even
  // discover (unbound, down, an error) — the faults that are ours to fix.
  // SINCE 25.10. EVERY AGENT MUST BE CALLABLE: Marque's answer to our report — the probe sends message/send only with
  // taskConsent: true, which our round now sends; so "discovered" again means our message/send was not validated. A
  // round from before the change (no taskConsent) is still judged the old way until the first new one.
  const mpNew = mp?.at && Date.parse(mp.at) > Date.parse('2026-10-25T12:00:00Z');
  const mpReal = mp ? Object.entries(mp.agents || {}).filter(([, v]) => !v.ok && (mpNew || v.liveness !== 'discovered')).map(([k, v]) => `#${k} ${v.liveness || v.detail || 'no answer'}`) : [];
  ok('Agents', 'Marque probes all six agents every 8 h, each found', mpAge != null && mpAge < 9 && Object.keys(mp.agents || {}).length === 6 && !mpReal.length, mp ? `${mpAge.toFixed(1)} h ago · ${mpReal.length ? 'failing: ' + mpReal.join(', ') : mpBad.length ? `all found (Marque only discovers since 21.10., ${mpBad.length} not validated)` : 'all ok'}` : 'no probe round yet');
  // THE VENUS AGENTS AT WORK (2026-10-22, venus-work.js): once a day at 05:00 UTC from their own wallets. The newest run
  // within 26 h, no error in it, and the health factor agent's loan read back inside its band's floor and ceiling.
  const vw = (await getJ(`${AGENT}/venus/work`)).body, vlog = vw?.log || [], vlast = vlog[0], vAge = vlast?.at ? (Date.now() - Date.parse(vlast.at)) / 3600e3 : null;
  const vrun = vlog.filter((x) => x.at === vlast?.at), verr = vrun.filter((x) => x.error), vhf = vlog.map((x) => String(x.note || '').match(/^health factor (?:now )?([\d.]+)/)).find(Boolean);
  ok('Agents', 'the Venus agents worked in the last 26 h, without an error, health factor 1.8-3', !vw?.switched_on ? true : vAge != null && vAge < 26 && !verr.length && (!vhf || (+vhf[1] >= 1.8 && +vhf[1] <= 3)),
    !vw?.switched_on ? 'switched off' : vlast ? `${vAge.toFixed(1)} h ago · ${vrun.filter((x) => x.tx).length} actions${verr.length ? ' · ERROR: ' + verr.map((x) => '#' + x.agent + ' ' + x.error).join('; ').slice(0, 160) : ''}${vhf ? ' · health factor ' + vhf[1] : ''}` : 'no run yet');
  // 3d. Settled by us (2026-10-14, own-jobs.js settleDue): the daily tick settles every job of ours whose dispute
  //     window is over. One that has lain settleable for more than two days means the settling stopped (or the provider
  //     may not settle it) — a hire that never counts as completed and $U left in escrow. And the tick itself must run.
  const own = (await getJ(`${AGENT}/jobs/own`)).body, ownAge = own?.checked_at ? (Date.now() - Date.parse(own.checked_at)) / 3600e3 : null;
  const stale = (own?.summary?.settleable || []).filter((id) => { const h = own.jobs?.[id]?.history || [], e = h.length ? h[h.length - 1].ends_at : null; return e && Date.now() / 1000 - e > 2 * 86400; });
  const lastTry = (own?.settled_by_us || []).find((x) => stale.includes(String(x.id)));
  // EVERY AGENT'S FINISHED JOBS (public-settle.js, 2026-10-21): the daily public settle ran within a day and a bit, and
  // none of its last run's sends failed, and no spike of due jobs (more than 200 in a day: someone making jobs for us
  // to pay the gas of — capped anyway, but somebody should look). Its first run is 21.10. 21:15 UTC; until then "not run yet" is no fault.
  const ps = (await getJ(`${AGENT}/settle/public`)).body, psLast = ps?.last_run, psAge = psLast?.at ? (Date.now() - Date.parse(psLast.at)) / 3600e3 : null;
  ok('Agents', 'the public settle ran within 26 hours, nothing it sent failed', psLast ? psAge < 26 && !psLast.failed && !psLast.spike && !(psLast.unread > psLast.candidates / 2) : Date.now() < Date.parse('2026-10-22T22:00:00Z'), psLast ? `${psAge.toFixed(1)} h ago · ${psLast.settled} settled, ${psLast.refused} refused, ${psLast.left} waiting${psLast.unread ? ` · ${psLast.unread} of ${psLast.candidates} UNREAD` : ''}${psLast.stopped ? ' · stopped: ' + psLast.stopped : ''}${psLast.spike ? ` · SPIKE: ${psLast.spike} due` : ''} · gas ${psLast.gas_bnb} BNB · ${ps.totals?.jobs ?? 0} jobs for ${ps.totals?.providers?.length ?? 0} providers so far` : 'not run yet (first run 21.10. 21:15 UTC)');
  // AND THE MONEY OF JOBS NOBODY DELIVERED BACK TO THEIR CLIENTS (public-refund.js, 2026-10-23): it runs right after the
  // settle, so the same day and a bit; nothing it sent failed. First run 23.10. 21:15 UTC; until then not a fault.
  const rf = ps?.refunds, rfLast = rf?.last_run, rfAge = rfLast?.at ? (Date.now() - Date.parse(rfLast.at)) / 3600e3 : null;
  ok('Agents', 'the public refund ran within 26 hours, nothing it sent failed', rfLast ? rfAge < 26 && !rfLast.failed && !(rfLast.unread > rfLast.read / 2) : Date.now() < Date.parse('2026-10-24T22:00:00Z'), rfLast ? `${rfAge.toFixed(1)} h ago · ${rfLast.refunded} refunded ($${rfLast.returned_u}), ${rfLast.refused} refused${rfLast.unread ? ` · ${rfLast.unread} of ${rfLast.read} UNREAD` : ''}${rfLast.stopped ? ' · stopped: ' + rfLast.stopped : ''} · gas ${rfLast.gas_bnb} BNB · ${rf.totals?.jobs ?? 0} jobs, $${rf.totals?.returned_u ?? 0} back to ${rf.totals?.clients?.length ?? 0} clients so far` : 'not run yet (first run 23.10. 21:15 UTC)');
  ok('Agents', 'no job of ours lies settleable for more than two days (the worker settles them)', ownAge != null && ownAge < 26 && !stale.length, ownAge == null ? 'no own-jobs record' : stale.length ? `${stale.join(', ')} still settleable${lastTry ? ` — last try: ${lastTry.why || lastTry.tx}` : ''}` : `tick ${ownAge.toFixed(1)} h ago · ${(own.summary.completed || []).length} completed, ${(own.summary.waiting || []).length} waiting`);
  // The screener's and every agent chart's paid work (api-agent-jobs.json) comes from the offline escrow census; on
  // 25.10. it was eleven days old under a page that said "built today". A week is the limit; the page names the date.
  const aj = await fetch('https://brainonbnb.com/api-agent-jobs.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  const ajAge = aj?.measured_at ? (Date.now() - Date.parse(aj.measured_at)) / 86400e3 : null;
  ok('Agents', "the screener's paid work was read from the escrow within 7 days", ajAge != null && ajAge < 7, ajAge == null ? 'api-agent-jobs.json not readable' : `read ${ajAge.toFixed(1)} days ago${ajAge >= 7 ? ' — run erc8183-job-scan, then --owners, agent-jobs-export, deploy the site' : ''}`);
  // 3c. An agent that hires an agent (2026-10-14): every morning the DeFi agent buys a second opinion on its position
  //     from Mandate Range-1 through its Altana leash. One must have been answered in the last 26 h, the newest must not
  //     contradict the agent, and the leash must still hold enough $U for a few more.
  const op = (await getJ(`${AGENT}/second-opinion`)).body, ops = Array.isArray(op?.opinions) ? op.opinions : [];
  const lastOk = ops.find((o) => o.status === 'answered'), lastAge = lastOk ? (Date.now() - Date.parse(lastOk.at)) / 3600e3 : null;
  // the LP worker's own note of its last ask (2026-10-18: the 04:23 ask timed out and left no row, the red line said only "29.9 h ago")
  const ask = op?.last_ask, askNote = ask ? ` · last ask ${ask.at.slice(5, 16).replace('T', ' ')} UTC: ${ask.status}${ask.job ? ` job ${ask.job}` : ''}${ask.reason ? ` (${ask.reason})` : ''}` : '';
  const fresh = lastAge != null && lastAge < 26;
  ok('Agents', 'the DeFi agent bought its second opinion in the last 26 h', fresh, (lastOk ? `${lastAge.toFixed(1)} h ago, job ${lastOk.job}` : `none answered — newest: ${ops[0] ? `${ops[0].status}: ${ops[0].reason || ''}` : 'no attempt yet'}`) + (fresh ? '' : askNote));
  ok('Agents', 'the newest second opinion does not contradict the agent', !lastOk || lastOk.agrees !== false, lastOk ? `agrees ${lastOk.agrees} on #${(lastOk.answer || [])[0]?.position || '?'}` : 'none yet');
  const leashU = await fetch('https://bsc-dataseed1.defibit.io', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '0xcE24439F2D9C6a2289F741120FE202248B666666', data: '0x70a08231000000000000000000000000c5a17b5295fc50badb1f9f9c09b412fe5e84f7d3' }, 'latest'] }) }).then((r) => r.json()).then((j) => (j.result ? Number(BigInt(j.result)) / 1e18 : null)).catch(() => null);
  ok('Agents', 'the Altana leash holds $U for at least five more second opinions', leashU != null && leashU >= 0.05, leashU == null ? 'unreadable' : `${leashU.toFixed(2)} $U (top up: node scripts/fund-leash.mjs --send)`);
  // Marque keeps brainonbnb.com/defi as #363709's endpoint (2026-10-09: its live test got the page's 405 and the
  // listing dropped): a JSON-RPC POST there must reach the agent.
  const dp = await fetch(SITE + '/defi', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', kind: 'message', messageId: 'health', parts: [{ kind: 'text', text: 'what can you do' }] } } }), signal: AbortSignal.timeout(30000) }).catch(() => null);
  const dpj = dp ? await dp.json().catch(() => null) : null;
  ok('Agents', 'brainonbnb.com/defi answers an A2A call (Marque tests #363709 there)', dp?.status === 200 && !!dpj?.result, dp ? `${dp.status}${dpj?.result ? ' json-rpc result' : ''}` : 'no answer');
  // Mandate fills "Tools" from #363709's MCP (on chain since 2026-10-14) and compares "in range" / "current tick" of a
  // free call with the chain: the MCP must list its tools and its free look must carry both figures at the top.
  const dm = await getJ(`${AGENT}/defi-agent/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lp_position_look', arguments: {} } }) });
  const dms = dm.body?.result?.structuredContent;
  ok('Agents', "the DeFi agent's MCP answers a free look with in_range and current_tick (Mandate checks them)", typeof dms?.in_range === 'boolean' && Number.isInteger(dms?.current_tick), dms ? `in range ${dms.in_range}, tick ${dms.current_tick}` : `http ${dm.status}`);
  // ... and every other agent of ours lists its two tools (one free of its category, its paid answer)
  const mcpBad = [];
  for (const slug of ['health-factor', 'grid-trader', 'yield-optimizer', 'rebalancer', 'lp-placement']) {
    const r = await getJ(`${AGENT}/${slug}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    if ((r.body?.result?.tools || []).length !== 2) mcpBad.push(`${slug} (${r.status})`);
  }
  ok('Agents', 'every agent of ours publishes its tool list over MCP (Mandate: Tools)', !mcpBad.length, mcpBad.length ? `missing: ${mcpBad.join(', ')}` : 'all five list two tools');
  // What the card promises, over A2A (2026-10-15): a question as data ({wallet}) is answered with the free reading,
  // in_range and current_tick at the top — it used to get the agent's self-description (scripts/a2a-free-half-check.mjs)
  const fa = await getJ(`${AGENT}/defi-agent/a2a`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'health', parts: [{ kind: 'data', data: { wallet: '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A' } }] } } }) });
  const fad = (fa.body?.result?.parts || []).find((p) => p.kind === 'data')?.data;
  ok('Agents', 'the DeFi agent answers a position question over A2A with in_range and current_tick (what its card promises)', typeof fad?.in_range === 'boolean' && Number.isInteger(fad?.current_tick), fad ? `in range ${fad.in_range}, tick ${fad.current_tick}` : `http ${fa.status}, no data part`);
  // 4. x402 offers USD1 by EIP-3009 (what marketplaces pay with).
  const terms = (await getJ(`${AGENT}/answer?service=yield_plan`)).body;
  ok('Agents', 'x402 offers USD1 by EIP-3009', (terms?.accepts || []).some((a) => String(a.asset).toLowerCase() === '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d' && (a.extra?.assetTransferMethod === 'eip3009' || a.extra?.transferMethod === 'eip3009')), (terms?.accepts || []).map((a) => a.extra?.assetTransferMethod).join(', '));
  // 15 OCT 2026, WHAT THE DAY FIXED STAYS FIXED: (a) no service refuses a payment that names no input (Mandate's hire
  // button; the grid planner was "Not available to hire" and the pricer refused it daily) — sent with a zero signature,
  // no money moves, and the answer must be about the payment; (b) the six agents listed on Marque, 5/5 each; (c) each
  // in the official MCP registry; (d) the pool scan ends with the paid watch on its pool.
  {
    const refused = [];
    for (const s of ['lp_position_plan', 'health_factor', 'grid_plan', 'lp_tier_plan', 'rebalance_plan', 'yield_plan']) {
      const t = (await getJ(`${AGENT}/answer?service=${s}`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'bobai-smoke-test' }, body: '{}' })).body || {};
      const acc = (t.accepts || [])[0] || {};
      const pay = { x402Version: 1, scheme: 'exact', network: acc.network || 'bsc', payload: { signature: '0x' + '00'.repeat(65), authorization: { from: '0xfceafec082f9e8b17cdb51f33c3d5c9759a25e03', to: acc.payTo, value: String(acc.maxAmountRequired || acc.amount || '100000000000000000'), validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 600), nonce: '0x' + '22'.repeat(32) } } };
      const r = await getJ(`${AGENT}/answer?service=${s}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-PAYMENT': btoa(JSON.stringify(pay)), 'user-agent': 'bobai-smoke-test' }, body: '{}' });
      if (r.status === 422 && /needs/.test(String(r.body?.error || ''))) refused.push(s);
    }
    ok('Agents', 'no service refuses a payment that names no input (a marketplace hire button)', !refused.length, refused.length ? `refused for the input: ${refused.join(', ')}` : 'six of six look at the payment');
    const mq = (await getJ('https://marque.trade/api/v1/phase2/owner/0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A')).body?.agents || [];
    const notListed = ['363709', '302257', '302258', '304493', '304494', '310460'].filter((id) => !mq.some((a) => String(a.agentId) === id && a.listedOnMarque && a.quality?.passed === 5));
    ok('Agents', 'all six agents listed on Marque, 5/5', mq.length > 0 && !notListed.length, notListed.length ? `not listed or under 5/5: #${notListed.join(', #')} — ${mq.filter((a) => notListed.includes(String(a.agentId))).map((a) => (a.quality?.checks || []).filter((c) => !c.pass).map((c) => c.reason).join('; ')).join(' | ').slice(0, 160)}` : 'six of six');
    // asked twice when the first answer is empty (15 Oct: one run read none of the seven, the next all seven)
    // 22 Oct: the registry took 12-39 s to answer this search and the 30 s read came back empty — read as "all seven
    // missing" while all seven were there. Now 60 s, and a registry that does not answer is said as unread, not missing.
    const readReg = async () => { const r = await fetch('https://registry.modelcontextprotocol.io/v0/servers?search=com.brainonbnb', { signal: AbortSignal.timeout(60000) }).then((x) => x.json()).catch(() => null); return Array.isArray(r?.servers) ? r.servers : null; };
    let reg = await readReg();
    if (!reg?.length) { await new Promise((r) => setTimeout(r, 4000)); reg = await readReg(); }
    const latest = new Set((reg || []).filter((x) => x._meta?.['io.modelcontextprotocol.registry/official']?.isLatest).map((x) => x.server.name));
    const missing = ['bobai', 'defi-agent', 'health-factor', 'grid-trader', 'yield-optimizer', 'rebalancer', 'lp-placement'].filter((n) => !latest.has('com.brainonbnb/' + n));
    ok('Agents', 'the site and the six agents in the official MCP registry', reg === null || !missing.length, reg === null ? 'the registry did not answer in 60 s, twice — not read this time (its own outage, nothing of ours)' : missing.length ? `missing: ${missing.join(', ')}` : `${latest.size} entries`);
    const ps = (await getJ(`${SITE}/api/pool-scan?address=0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82`, { headers: { 'user-agent': 'bobai-smoke-test' } })).body;
    ok('Agents', 'the pool scan ends with the paid watch on its pool', !!ps?.watch_this_pool?.buy?.body?.token, ps?.watch_this_pool ? `depthBelowUsd ${ps.watch_this_pool.buy.body.depthBelowUsd}` : 'no offer');
  }
  // 5. An /api/ path we do not serve is a 404, not the front page.
  const u404 = await fetch(SITE + '/api/health-check-no-such-route').catch(() => null);
  ok('Site', 'an unknown /api/ path is a 404 with the route list', u404?.status === 404 && /json/.test(u404.headers.get('content-type') || ''), u404 ? `${u404.status} ${u404.headers.get('content-type')}` : 'no answer');
  // 6. The day's statistics are counted whole (rolled up), not a sample.
  const det = (await getJ(`${AGENT}/stats/detail?day=${new Date(Date.now() - 86400e3).toISOString().slice(0, 10)}`)).body;
  ok('Agents', "yesterday's request statistics are whole, not truncated", det && det.truncated === false, det ? `${det.isolates} isolates, ${det.rolled_up} rolled up` : 'no answer');
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
  // every option carries what x402 requires (2026-10-25: Marque read our 402 as bad_schema — two had no maxTimeoutSeconds)
  const REQ = ['scheme', 'network', 'amount', 'maxAmountRequired', 'asset', 'payTo', 'resource', 'description', 'mimeType', 'maxTimeoutSeconds'];
  const short = (decoded?.accepts || []).map((a, i) => [i, REQ.filter((k) => a[k] == null || a[k] === '')]).filter(([, m]) => m.length);
  ok('Paid', 'every payment option has the fields x402 requires', !!decoded?.accepts?.length && !short.length, short.length ? short.map(([i, m]) => `#${i} lacks ${m.join(',')}`).join('; ') : `${decoded?.accepts?.length ?? 0} complete`);

  const fake = await getJson(`${AGENT}/watch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': '0x' + '11'.repeat(32) },
    body: JSON.stringify({ token: '0x245c386dcfed896f5c346107596141e5edcbffff', pair: '0x6eadd4cb786898b34929444988380ed0cc6fd9a6' }),
  });
  ok('Paid', 'invented payment is rejected', /not found|malformed|need/i.test(fake.json?.reason || ''), fake.json?.reason || '');
  // the payments that came back without buying (/buys/refused, 2026-10-25): one refused on our side is red
  const rf = await getJson(`${AGENT}/buys/refused`);
  const rv = refusedVerdict(rf.json && rf.json.refused);
  ok('Paid', 'no payment of the last 24 h was refused on our side', rv.good, rv.detail);

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
  // SHARE CARDS (2026-09-27): brainonbnb.com/m/<moment> is what X, Telegram and WhatsApp draw as the big preview of a
  // shared moment. The page must name its image, and the image must come back as a real PNG drawn by bobai-cards.
  const mPage = await fetch(SITE + '/m/now').then((r) => (r.ok ? r.text() : '')).catch(() => '');
  ok('Site', 'the share page names its card image', /og:image" content="https:\/\/brainonbnb\.com\/m\/now\.png/.test(mPage));
  const mImg = await fetch(SITE + '/m/now.png').catch(() => null);
  const mBytes = mImg?.ok ? (await mImg.arrayBuffer()).byteLength : 0;
  ok('Site', 'the share card image is drawn', !!mImg?.ok && /image\/png/.test(mImg.headers.get('content-type') || '') && mBytes > 50000, mImg ? `${mImg.status} · ${Math.round(mBytes / 1024)} KB` : 'no answer');
  // SCAN CARDS (2026-10-13): a scan link names /og/scan/<token>.png, drawn by bobai-og from /api/preflight. When the card
  // worker fails the site falls back to the banner (a redirect), so a real PNG here means the card itself is drawn.
  const CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';
  const sPage = await fetch(`${SITE}/scanner?token=${CAKE}`, { headers: { 'user-agent': 'Twitterbot/1.0' } }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  ok('Site', 'a scan link names its own card', sPage.includes(`og:image" content="https://brainonbnb.com/og/scan/${CAKE}.png`));
  const sImg = await fetch(`${SITE}/og/scan/${CAKE}.png`, { redirect: 'manual' }).catch(() => null);
  const sBytes = sImg?.status === 200 ? (await sImg.arrayBuffer()).byteLength : 0;
  ok('Site', 'the scan card is drawn (not the banner fallback)', sImg?.status === 200 && /image\/png/.test(sImg.headers.get('content-type') || '') && sBytes > 50000, sImg ? `${sImg.status} · ${Math.round(sBytes / 1024)} KB` : 'no answer');
}

return results;
}
