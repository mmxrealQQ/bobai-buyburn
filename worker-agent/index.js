// BOBAI AGENT SERVICE — the paid surface, and the numbers behind it.
//
// Two jobs, deliberately in one worker because they are the same story:
//
//   1. A pool watch that agents pay for. The free scanner answers "what does
//      this trade cost right now"; this answers "tell me when that changes",
//      which is the part that cannot be done client-side because somebody has
//      to still be running in an hour.
//
//   2. The counters behind the public transparency block: how often we were
//      asked, what we earned, where the money went. Kept here rather than in
//      the dashboard worker so that the thing being measured and the thing
//      doing the measuring are not the same process.
//
// PAYMENT MODEL
// x402, scheme "exact": the caller sends USD1 to our address and hands us the
// transaction hash; we read the chain and confirm it. We do NOT use eip3009
// here even though the Bazaar entries do, and the reason is gas: an eip3009
// authorization has to be submitted by the recipient, so we would be paying gas
// to collect payment, with no facilitator sponsoring it until a Binance partner
// account exists. Direct transfer costs us nothing and needs nobody's approval.
// When the partner account lands, eip3009 gets added alongside — the accepts[]
// array is built to carry both.
//
// The receiving wallet's private key is NOT here and must never be. Verifying a
// payment is a read; the worker never moves funds.

import { runCensusTick, runFrontierTick } from './census.js';
import { handleFind } from './find.js';
import { dexterAccepts, verifyAndSettle, parsePaymentHeader } from './x402.js';
import { handleDispatch } from './dispatch.js';
import { readSessions, MAX_SESSIONS, trackRecord } from './sessions.js';
import { runCanary } from './canary.js';
import { buildCatalog } from './x402-catalog.js';
import { handleHire, decodeJob, ERC8183 } from './hire.js';
import { handleA2A, handleJobResult, SERVICES, exampleFor, doWork, extractParams } from './sell.js';
import { summarize } from '../shared/job-summary.js';
import { moneyFlow, flowLines } from '../shared/lp-flow.js';
import { lpPositionLook } from './lp-service.js';
import { encodeFunctionData, keccak256, toBytes } from 'viem';
import { REPUTATION, REPUTATION_ABI } from '../scripts/lib/erc8004-reputation.mjs';
import { SOLD_BY } from './catalog.js';
import { refreshTelemetry, readTelemetry } from './telemetry.js';
import { registrations, OWN_AGENT_IDS } from '../shared/agent-registrations.js';
import { handleSession } from './session.js';
import { handleSessionRevoke, readRevocations, annotateRoles } from './session-revoke.js';
import { recordLpWindow, readLpWindows, noteLpWindowError, verdict as lpVerdict, measuredResetCost } from './lp-windows.js';
import { recordLpPools, readLpPools, noteLpPoolsError, poolVerdict, CANDIDATES as LP_POOL_CANDIDATES } from './lp-pools.js';
import { tickOwnJobs, readOwnJobs } from './own-jobs.js';
import { CAPABILITIES, WATCH_PRICE_USD1, WATCH_DAYS, fmtUsd1, offering } from './catalog.js';

// The host our hireable agents name on-chain. Written out rather than derived
// from the incoming request: this exact string is in the registration of
// #302257 and #304493 and cannot be changed, so a card that reported some other
// origin — a preview deployment, a workers.dev hostname — would be describing
// an agent that does not exist.
const SELF_ORIGIN = 'https://agent.brainonbnb.com';

const RPCS = [
  'https://bsc.publicnode.com',
  'https://bsc-rpc.publicnode.com',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-mainnet.public.blastapi.io',
];
// Logs are a separate endpoint on purpose: Binance's own dataseed refuses
// eth_getLogs outright, and a payment that cannot be read is a payment we would
// wrongly reject.
const LOGS_RPC = 'https://bsc-rpc.publicnode.com';

// Receipts need their OWN list, and this is not a detail. Both publicnode
// endpoints answer eth_getTransactionReceipt with "Archive requests require..."
// — even for a transaction minutes old. Reading receipts off the logs endpoint,
// as this worker did at first, rejected a real 96 USD1 transfer as "transaction
// not found": harmless for security, fatal for a paying customer, and invisible
// unless you test with a transaction that actually exists. Ordered so the two
// endpoints measured to serve receipts come first.
const RECEIPT_RPCS = [
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-mainnet.public.blastapi.io',
  'https://bsc-dataseed.binance.org',
];

// USD1. Chosen by measurement, not by preference: on BSC, USDT and USDC do NOT
// implement EIP-3009, while USD1 and U do — which is why 40 of the 44 payment
// options across the whole B402 catalogue are one of those two. Picking USDT
// would have produced a service nobody could pay for with the standard scheme.
const USD1 = '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d';
const USD1_DECIMALS = 18n;

const NETWORK = 'eip155:56';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// The watch price, its window and the USD1 formatter now live in catalog.js,
// beside the description of the thing being priced.

// ==================== THE PAGE SHELL ====================
// The four pages this worker serves to a browser (/job, /sessions, /lp/agent,
// /lp/windows) wear the same shell as every sub-page on brainonbnb.com: a
// fixed header with a way back, the page's name and one gold action, the
// site's own fonts (Inter, Space Grotesk — served by the dashboard, CORS
// open) and the aurora ground. Before 2026-09-05 each page carried its own
// pill nav and looked like a different site from the page that linked to it.
// The header rules mirror dashboard/styles.css (.nav, .back-btn, .brand-link,
// .nb) — change both together.
const SHELL_CSS = ':root{color-scheme:dark;--gold:#f0b90b;--gold2:#ffd54a;--bg:#0c0b0c;--text:#eceaf5;--muted:#a0a2c0;--border:rgba(198,143,118,.16)}'
  + '*{box-sizing:border-box}'
  + 'body{margin:0;color:var(--text);font:15px/1.6 Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;background:radial-gradient(1200px 700px at 50% -6%,rgba(240,185,11,.13),transparent 66%),radial-gradient(900px 620px at 50% 40%,rgba(198,143,118,.06),transparent 70%),radial-gradient(700px 500px at 88% 78%,rgba(120,48,24,.07),transparent 72%),var(--bg);background-attachment:fixed}'
  + '.aur{position:fixed;inset:-25%;z-index:0;pointer-events:none;filter:blur(110px);opacity:.5}.aur i{position:absolute;display:block;border-radius:50%}'
  + '.aur .a1{width:48vw;height:48vw;left:-4%;top:-4%;background:rgba(240,185,11,.4);animation:drift1 34s ease-in-out infinite}'
  + '.aur .a2{width:40vw;height:40vw;right:-6%;top:20%;background:rgba(198,143,118,.3);animation:drift2 42s ease-in-out infinite}'
  + '.aur .a3{width:38vw;height:38vw;left:18%;bottom:-4%;background:rgba(120,48,24,.34);animation:drift3 38s ease-in-out infinite}'
  + '.aur .a4{width:26vw;height:26vw;right:22%;bottom:12%;background:rgba(34,211,238,.1);animation:drift2 48s ease-in-out infinite reverse}'
  + '@keyframes drift1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(6vw,4vh) scale(1.12)}}'
  + '@keyframes drift2{0%,100%{transform:translate(0,0) scale(1.05)}50%{transform:translate(-5vw,6vh) scale(.94)}}'
  + '@keyframes drift3{0%,100%{transform:translate(0,0) scale(.96)}50%{transform:translate(4vw,-5vh) scale(1.1)}}'
  + '@media (prefers-reduced-motion:reduce){.aur .a1,.aur .a2,.aur .a3,.aur .a4{animation:none}}'
  + '.page{position:relative;z-index:1}'
  + 'nav{position:fixed;top:0;left:0;right:0;z-index:100;background:#0b0916;border-bottom:1px solid var(--border)}'
  + '.nav{position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:0 24px;display:flex;align-items:center;justify-content:space-between;gap:12px;height:58px}'
  + '.back-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 0;color:var(--gold);font-size:12px;font-weight:600;letter-spacing:.3px;white-space:nowrap;text-decoration:underline;text-decoration-color:rgba(240,185,11,.32);text-underline-offset:3px;text-decoration-thickness:1px;transition:transform .2s ease,text-decoration-color .2s}'
  + '.back-btn:hover{transform:translateX(-2px);text-decoration-color:var(--gold)}.back-btn span{font-size:14px;line-height:1}'
  + ".brand-link{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:14px;letter-spacing:.5px;color:var(--gold);white-space:nowrap;text-decoration:none}.brand-link:hover{opacity:.85}"
  + '.nb{background:linear-gradient(135deg,var(--gold),#e0a800);color:#000;padding:9px 24px;border-radius:999px;font-weight:700;font-size:.78rem;text-decoration:none;transition:all .25s;border:none;box-shadow:0 2px 20px rgba(240,185,11,.2);letter-spacing:.3px;white-space:nowrap}'
  + '.nb:hover{transform:translateY(-1px);box-shadow:0 4px 32px rgba(240,185,11,.35)}'
  + '@media (max-width:560px){.brand-link{font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis}.nb{padding:7px 14px;font-size:.72rem}.nav{gap:8px;padding:0 14px}}'
  + 'main{margin:0 auto;padding:86px 18px 60px}'
  + "h1{font-family:'Space Grotesk',sans-serif;font-size:1.5rem;margin:0 0 4px;letter-spacing:-.3px}h2{font-family:'Space Grotesk',sans-serif;font-size:1rem;margin:26px 0 8px;color:var(--gold)}"
  + 'a{color:var(--gold)}code{font-size:.85em}'
  // The link system of the dashboard (dashboard/styles.css, THE LINK SYSTEM):
  // a change of page carries a right arrow, a way out of the site an up-right
  // arrow, a jump within the page none — the same marks on these pages.
  + ':is(p,li,dd,td,th,figcaption,small,.note) > a:not(.nb):not(.back-btn):not(.brand-link):not(.no-mark):not(:has(img)){color:var(--gold);text-decoration:underline;text-decoration-color:rgba(240,185,11,.32);text-underline-offset:3px;text-decoration-thickness:1px}'
  + ':is(p,li,dd,td,th,figcaption,small,.note) > a:not(.nb):not(.back-btn):not(.brand-link):not(.no-mark):not(:has(img)):hover{text-decoration-color:var(--gold)}'
  + ':is(p,li,dd,td,th,figcaption,small,.note) > a:not([href^="#"]):not([href^="mailto:"]):not(.nb):not(.back-btn):not(.brand-link):not(.no-mark):not(:has(img))::after{content:"";display:inline-block;width:.62em;height:.62em;margin-left:.3em;vertical-align:-.02em;background:currentColor;opacity:.75;-webkit-mask:url(data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2012%2012%27%3E%3Cpath%20d%3D%27M1.5%206h8.2M6.3%202.6%209.7%206l-3.4%203.4%27%20fill%3D%27none%27%20stroke%3D%27%23000%27%20stroke-width%3D%271.7%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%2F%3E%3C%2Fsvg%3E) center/contain no-repeat;mask:url(data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2012%2012%27%3E%3Cpath%20d%3D%27M1.5%206h8.2M6.3%202.6%209.7%206l-3.4%203.4%27%20fill%3D%27none%27%20stroke%3D%27%23000%27%20stroke-width%3D%271.7%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%2F%3E%3C%2Fsvg%3E) center/contain no-repeat}'
  + ':is(p,li,dd,td,th,figcaption,small,.note) > a[target="_blank"]:not(.nb):not(.back-btn):not(.brand-link):not(.no-mark):not(:has(img))::after{-webkit-mask-image:url(data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2012%2012%27%3E%3Cpath%20d%3D%27M3%209l6-6M4.2%203H9v4.8%27%20fill%3D%27none%27%20stroke%3D%27%23000%27%20stroke-width%3D%271.7%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%2F%3E%3C%2Fsvg%3E);mask-image:url(data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2012%2012%27%3E%3Cpath%20d%3D%27M3%209l6-6M4.2%203H9v4.8%27%20fill%3D%27none%27%20stroke%3D%27%23000%27%20stroke-width%3D%271.7%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%2F%3E%3C%2Fsvg%3E)}';

// The head of a page: title, icon, the site's fonts, the shell rules, then the
// page's own. Opens the ground and the .page layer; pageTail closes them.
const pageHead = (title, css) => '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'
  + '<title>' + title + '</title><link rel="icon" href="https://brainonbnb.com/favicon.png"><link rel="stylesheet" href="https://brainonbnb.com/fonts.css?v=1">\n'
  + '<style>' + SHELL_CSS + '\n' + css + '\n</style></head><body><div class="aur" aria-hidden="true"><i class="a1"></i><i class="a2"></i><i class="a3"></i><i class="a4"></i></div><div class="page">\n';
// The header: a way back, the page's name, one action — the same three
// things, in the same three places, as on every sub-page of the dashboard.
const pageNav = (back, name, action) => '<nav><div class="nav"><a class="back-btn" href="' + back.href + '" title="Back to ' + back.label + '"><span>&larr;</span> ' + back.label + '</a>'
  + '<a class="brand-link" href="' + name.href + '">' + name.label + '</a>'
  + '<a class="nb" href="' + action.href + '"' + (action.external ? ' target="_blank" rel="noopener"' : '') + '>' + action.label + '</a></div></nav>\n<main>\n';
const pageTail = '</main></div></body></html>';
const BUY = { href: 'https://pancakeswap.finance/swap?outputCurrency=0x245c386dcfed896f5c346107596141e5edcbffff', label: 'Buy $BOBAI', external: true };
const SITE = 'https://brainonbnb.com';

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });

// btoa() only handles Latin-1. The moment a description contained an em dash
// the whole /watch endpoint returned 500 — the payload was fine, the encoder
// was not. Encoding to UTF-8 bytes first makes any character safe, which
// matters because these strings are human-readable copy that will keep
// acquiring punctuation.
const b64 = (obj) => {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const rpc = async (method, params, endpoints) => {
  const list = endpoints ? (Array.isArray(endpoints) ? endpoints : [endpoints]) : RPCS;
  let last;
  for (const endpoint of list) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json();
      if (j.error) { last = new Error(j.error.message); continue; }
      return j.result;
    } catch (e) { last = e; }
  }
  throw last || new Error('all RPC endpoints failed');
};

const hexToBig = (h) => (h && h !== '0x' ? BigInt(h) : 0n);
const addrFromTopic = (t) => '0x' + String(t).slice(26).toLowerCase();

// ---------------------------------------------------------------- counters

// One KV read+write per counted event would cost a write on every single
// request. Counters are therefore bucketed by day and the totals derived on
// read, which also gives the transparency block a time series for free.
const today = () => new Date().toISOString().slice(0, 10);

async function bump(env, kind, n = 1) {
  const key = `count:${kind}:${today()}`;
  const cur = Number((await env.AGENT.get(key)) || 0);
  await env.AGENT.put(key, String(cur + n), { expirationTtl: 60 * 60 * 24 * 400 });
}

async function readCounters(env) {
  const list = await env.AGENT.list({ prefix: 'count:' });
  const byKind = {};
  const byDay = {};
  for (const k of list.keys) {
    const [, kind, day] = k.name.split(':');
    const v = Number((await env.AGENT.get(k.name)) || 0);
    byKind[kind] = (byKind[kind] || 0) + v;
    byDay[day] = byDay[day] || {};
    byDay[day][kind] = v;
  }
  return { byKind, byDay };
}

// ---------------------------------------------------------------- payment

// Confirms that a specific transaction really moved at least `min` USD1 into
// our address, and that we have not already honoured it.
//
// Every one of these checks earns its place. Without the receipt status a
// reverted transfer counts as payment. Without the token check any worthless
// token sent to the same address counts. Without the recipient check somebody
// pastes a transfer between two strangers. Without the KV guard one payment
// buys unlimited watches.
// `asset` is the token whose transfer counts (USD1 by default); `label` is how
// its amount is written back to the payer. Since 2026-09-03 an answer can
// also be paid in $BOBAI — the token this whole loop exists to burn.
async function verifyPayment(env, txHash, payTo, min, asset = USD1, label = 'USD1') {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash || '')) return { ok: false, reason: 'malformed transaction hash' };

  const spent = await env.AGENT.get(`paid:${txHash.toLowerCase()}`);
  if (spent) return { ok: false, reason: 'this payment has already been used' };

  const receipt = await rpc('eth_getTransactionReceipt', [txHash], RECEIPT_RPCS).catch(() => null);
  if (!receipt) return { ok: false, reason: 'transaction not found — if it was just sent, wait for it to confirm' };
  if (receipt.status !== '0x1') return { ok: false, reason: 'that transaction failed on-chain' };

  let paid = 0n;
  for (const log of receipt.logs || []) {
    if ((log.address || '').toLowerCase() !== asset.toLowerCase()) continue;
    if ((log.topics || [])[0] !== TRANSFER_TOPIC) continue;
    if (addrFromTopic(log.topics[2]) !== payTo.toLowerCase()) continue;
    paid += hexToBig(log.data);
  }
  if (paid < min)
    return {
      ok: false,
      reason: `paid ${fmtUsd1(paid)} ${label}, need ${fmtUsd1(min)} ${label}`,
      paid,
    };

  return { ok: true, paid, asset: asset.toLowerCase(), from: (receipt.from || '').toLowerCase(), block: receipt.blockNumber };
}

// $BOBAI as a second coin for the per-answer sale. The amount is the answer's
// dollar price in $BOBAI at the moment of the 402, read from the pair's own
// reserves and the BNB reference pair — the same on-chain arithmetic every
// page of this project prices $BOBAI with — with a tenth of slack so a price
// that moved between the quote and the block still clears. $BOBAI paid here
// sits in the income wallet as $BOBAI: off the market, until the liquidity
// agent's sweep learns the token. Said on the 402, not implied.
const BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff';
const BOBAI_PAIR = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6';
async function bobaiForUsd(usd) {
  const [res, t0, price] = await Promise.all([call(BOBAI_PAIR, SEL.getReserves), call(BOBAI_PAIR, SEL.token0), bnbUsd()]);
  const b = res.slice(2);
  const r0 = Number(BigInt('0x' + b.slice(0, 64))) / 1e18, r1 = Number(BigInt('0x' + b.slice(64, 128))) / 1e18;
  const bobaiIs0 = ('0x' + t0.slice(26)).toLowerCase() === BOBAI;
  const bnbPerBobai = bobaiIs0 ? r1 / r0 : r0 / r1;
  const usdPerBobai = bnbPerBobai * price;
  if (!(usdPerBobai > 0)) throw new Error('could not price $BOBAI');
  // `tokens` is what to SEND (the full price, rounded up); `atomic` is the
  // least that must ARRIVE — a tenth less, which covers the token's own 3 %
  // transfer tax and a price that moved between the quote and the block.
  // The first draft slacked both and told the payer to send the slacked
  // amount, which after the tax would have arrived short and been refused.
  const tokens = Math.ceil(usd / usdPerBobai);
  return { atomic: BigInt(Math.floor(tokens * 0.9 * 1e18)), tokens, usd_per_bobai: usdPerBobai };
}


// ------------------------------------------------------------ pool reading

const SEL = {
  getReserves: '0x0902f1ac',
  token0: '0x0dfe1681',
  balanceOf: '0x70a08231',
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
};

const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
const padAddr = (a) => a.toLowerCase().replace('0x', '').padStart(64, '0');

// getJob(uint256) — the one ERC-8183 read this worker makes directly. Selector
// from the kernel ABI in @altananetwork/sdk, verified against viem by
// scripts/erc8183-encoding-check.mjs along with everything hire.js encodes.
const JOB_CALL = (id) => '0xbf22c457' + BigInt(id).toString(16).padStart(64, '0');

// Depth of a V2 pair in USD, read from the quote side only. One-sided on
// purpose: it is the number that decides what a sell can actually get out, and
// it needs no price oracle beyond the quote token itself.
async function poolDepthUsd(pair, quoteToken, quoteUsd) {
  const bal = await call(quoteToken, SEL.balanceOf + padAddr(pair));
  const raw = hexToBig(bal);
  return Number(raw) / 1e18 * quoteUsd;
}

// BNB price from the reference pair, the same source the rest of the project
// uses so that one number does not disagree with itself across surfaces.
const BNB_PAIR = '0x58f876857a02d6762e0101bb5c46a8c1ed44dc16';
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
async function bnbUsd() {
  const [res, t0] = await Promise.all([
    call(BNB_PAIR, SEL.getReserves),
    call(BNB_PAIR, SEL.token0),
  ]);
  const b = res.slice(2);
  const r0 = Number(BigInt('0x' + b.slice(0, 64))) / 1e18;
  const r1 = Number(BigInt('0x' + b.slice(64, 128))) / 1e18;
  const bnbIs0 = ('0x' + t0.slice(26)).toLowerCase() === WBNB;
  return bnbIs0 ? r1 / r0 : r0 / r1;
}

// ---------------------------------------------------------------- watches

async function createWatch(env, spec, payment) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const watch = {
    id,
    token: spec.token.toLowerCase(),
    pair: spec.pair.toLowerCase(),
    quote: (spec.quote || WBNB).toLowerCase(),
    depthBelowUsd: spec.depthBelowUsd ?? null,
    callback: spec.callback || null,
    createdAt: now,
    expiresAt: now + WATCH_DAYS * 86400000,
    paidTx: payment.tx,
    paidBy: payment.from,
    lastDepthUsd: null,
    triggered: [],
  };
  await env.AGENT.put(`watch:${id}`, JSON.stringify(watch), {
    expirationTtl: WATCH_DAYS * 86400 + 86400,
  });
  return watch;
}

async function checkWatches(env) {
  const list = await env.AGENT.list({ prefix: 'watch:' });
  if (!list.keys.length) return { checked: 0, fired: 0 };
  const price = await bnbUsd().catch(() => 0);
  if (!price) return { checked: 0, fired: 0, error: 'could not price BNB' };

  let fired = 0;
  for (const k of list.keys) {
    const raw = await env.AGENT.get(k.name);
    if (!raw) continue;
    const w = JSON.parse(raw);
    if (Date.now() > w.expiresAt) { await env.AGENT.delete(k.name); continue; }

    let depth;
    try {
      depth = await poolDepthUsd(w.pair, w.quote, w.quote === WBNB ? price : 1);
    } catch { continue; } // a node dropping a call is not a depth collapse
    w.lastDepthUsd = Math.round(depth);
    w.lastCheckedAt = Date.now();

    if (w.depthBelowUsd != null && depth < w.depthBelowUsd) {
      const already = w.triggered.some((t) => Date.now() - t.at < 6 * 3600000);
      if (!already) {
        w.triggered.push({ at: Date.now(), depthUsd: Math.round(depth) });
        fired++;
        if (w.callback) {
          // Fire-and-forget: a subscriber's endpoint being down must not stall
          // the run for everyone else on the list.
          await fetch(w.callback, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              watch: w.id, token: w.token, pair: w.pair,
              depthUsd: Math.round(depth), threshold: w.depthBelowUsd,
              at: new Date().toISOString(),
            }),
            signal: AbortSignal.timeout(5000),
          }).catch(() => {});
        }
      }
    }
    await env.AGENT.put(k.name, JSON.stringify(w), {
      expirationTtl: Math.max(60, Math.floor((w.expiresAt - Date.now()) / 1000) + 86400),
    });
  }
  await bump(env, 'watch_checks', list.keys.length);
  return { checked: list.keys.length, fired };
}

// ---------------------------------------------------------------- the liquidity series
//
// One point per run of the liquidity agent, taken from the record it writes
// (worker-lp, 04:23 UTC) and never from a counter: what the position was
// worth, whether it was in range, what it was owed, what had already been
// sent on. Kept here, by the worker with no keys, so the series exists
// without touching the worker that moves money. The first point is the
// baseline every later "since it started" figure is measured against.
const LP_SERIES_KEY = 'lp:series';
// A run that found no position has no position value, and is neither in
// nor out of a range. 2026-09-06 05:23 the record found none (the re-set of
// the day before had stopped between its unwind and its mint, the capital
// sat in the wallet) and the point carried value 0 and "out" — which read
// as the capital gone, -100%. Such a point says "no position", nothing
// more; the rule is applied on read so the point already written obeys it.
function lpSeriesPoint(p) {
  if (p.position) return p;
  return { ...p, value_bnb: null, in_range: null };
}
async function readLpSeries(env) {
  const raw = await env.AGENT.get(LP_SERIES_KEY);
  return raw ? JSON.parse(raw).map(lpSeriesPoint) : [];
}
async function recordLpSeries(env) {
  const raw = await env.AGENT.get('lp:agent');
  if (!raw) return { recorded: false, why: 'no record yet' };
  const rec = JSON.parse(raw);
  // The newest run on record: the daily one, or an hourly check that acted
  // (those land in history). A re-set at 07:50 is a run the series must show.
  const hist0 = Array.isArray(rec.history) ? rec.history : [];
  const newestHist = hist0.length ? hist0[hist0.length - 1] : null;
  const last = newestHist && rec.last && Date.parse(newestHist.at) > Date.parse(rec.last.at) ? newestHist : rec.last;
  if (!last || !last.at || last.dry) return { recorded: false, why: 'no live run in the record' };
  const series = await readLpSeries(env);
  const prev = series.length ? series[series.length - 1] : null;
  const flow = moneyFlow(rec);
  const totals = {
    forwarded_total_bnb: flow.out.buyback_bnb,
    kept_total_bnb: flow.out.kept_as_capital_bnb,
    fees_total_bnb: flow.in.fees.bnb,
    folded_total_bnb: flow.in.fees.folded_bnb || 0,
    into_position_total_bnb: flow.out.into_position_bnb || 0,
    swept_total_bnb: flow.in.income_bnb,
  };
  let point = null;
  if (!prev || Date.parse(prev.at) < Date.parse(last.at)) {
    const st = last.steps || {}, c = st.collect || {}, rb = st.rebalance || {}, inc = st.increase || {};
    const reset = rb.acted && !rb.error && rb.new_position;
    const sweeps = Array.isArray(st.sweep) ? st.sweep : [];
    point = {
      at: last.at,
      position: reset ? String(rb.new_position) : (c.position || rb.position || null),
      in_range: reset ? true : (c.in_range != null ? c.in_range : (rb.in_range ?? null)),
      tick: rb.tick ?? null,
      ticks: reset ? (rb.new_ticks || rb.ticks || null) : (rb.ticks || null),
      reset: reset ? { from: rb.position, to: String(rb.new_position), width_pct: rb.width_pct ?? null, gas_bnb: rb.gas_bnb ?? null } : null,
      value_bnb: rb.value_bnb != null ? Number(rb.value_bnb) : null,
      owed_bnb: c.owed ? Number(c.owed.bnb_equivalent) || 0 : 0,
      wallet_bnb: inc.wallet_bnb != null ? Number(inc.wallet_bnb) : null,
      waiting: sweeps.filter((s) => s.balance > 0).map((s) => ({ token: s.token || s.source, amount: Number(s.balance) })),
      ...totals,
      acted: !!last.acted,
      ok: last.ok !== false,
    };
  } else {
    // An hourly check that found a position the series does not know — one
    // minted by hand after a stopped re-set (2026-09-06 06:06, seen at the
    // 06:50 check) — is a point too, else the series says "no position" all
    // day while there is one. A check that sees the position the series
    // already has is not a point: the hours are not a history.
    const chk = rec.last_check, cr = chk && chk.steps && chk.steps.rebalance;
    if (chk && !chk.dry && cr && cr.position && Date.parse(chk.at) > Date.parse(prev.at) && String(cr.position) !== String(prev.position || '')) {
      point = {
        at: chk.at,
        position: String(cr.position),
        in_range: cr.in_range ?? null,
        tick: cr.tick ?? null,
        ticks: cr.ticks || null,
        reset: null,
        value_bnb: cr.value_bnb != null ? Number(cr.value_bnb) : null,
        // The check only looked at the range: fees owed and the wallet were
        // not read, so they are unknown here, not zero.
        owed_bnb: null,
        wallet_bnb: null,
        waiting: prev.waiting || [],
        ...totals,
        acted: false,
        ok: chk.ok !== false,
        seen: 'hourly check found a position the series did not know',
      };
    }
  }
  if (!point) return { recorded: false, why: 'already recorded', points: series.length };
  point.bnb_usd = await bnbUsd().catch(() => null);
  series.push(lpSeriesPoint(point));
  const kept = series.slice(-400);
  await env.AGENT.put(LP_SERIES_KEY, JSON.stringify(kept));
  return { recorded: true, points: kept.length, point };
}
// What the series says so far, in the terms a person asks: is the capital
// still there, what did it earn, did the price leave the range. Value is in
// BNB because the position is quoted in BNB; a dollar figure would move with
// BNB and say nothing about the position.
// The series a reader sees: only runs that had a position. A run that found
// none (2026-09-06 05:23, between a stopped re-set and the mint by hand) is
// kept in the store, so the record of that day exists, but it is not a row:
// it has no value, no range, nothing to compare — the operator: "kann raus".
function lpSeriesShown(series) {
  return series.filter((p) => p.position);
}
// `gas_bnb` is the record's own gas total (moneyFlow), so the profit line can
// net it: the series points carry no gas.
// Where the fees in the profit line are: collected by the collect step,
// folded into the capital by re-sets, still owed by the position. Shared
// with the liquidity page (app.js, same words) so the two never differ.
function lpFeesWhere(p) {
  const f5 = (v) => Number(v || 0).toFixed(5);
  const parts = [];
  if (p.fees_collected_bnb > 0) parts.push(`${f5(p.fees_collected_bnb)} collected`);
  if (p.fees_folded_bnb > 0) parts.push(`${f5(p.fees_folded_bnb)} folded into the capital by re-sets`);
  parts.push(`${f5(p.fees_owed_bnb)} still owed by the position`);
  return parts.join(', ');
}
function lpSeriesSummary(series, { gas_bnb = null, owed_now_bnb = null, totals = null } = {}) {
  if (!series.length) return null;
  const first = series[0], last0 = series[series.length - 1];
  // The totals (fees, buyback share, kept, swept) are the record's own
  // money-flow figures when the caller has them: a point carries the totals
  // as they were when it was written, and a record corrected afterwards
  // (the re-sets' folded fees, 2026-09-07) would otherwise stay wrong until
  // the next point.
  const last = totals ? { ...last0, ...totals } : last0;
  const withValue = series.filter((p) => p.value_bnb != null);
  const f0 = withValue[0], f1 = withValue[withValue.length - 1];
  const days = Math.max(0, Math.round((Date.parse(last.at) - Date.parse(first.at)) / 86400000));
  const tickMove = first.tick != null && last.tick != null ? last.tick - first.tick : null;
  const out = {
    points: series.length,
    since: first.at,
    days_covered: days,
    value_bnb: f0 && f1 ? { start: f0.value_bnb, now: f1.value_bnb, change_pct: f0.value_bnb ? +(((f1.value_bnb - f0.value_bnb) / f0.value_bnb) * 100).toFixed(2) : null } : null,
    fees_sent_to_buyback_bnb: last.forwarded_total_bnb,
    fees_kept_as_capital_bnb: last.kept_total_bnb ?? 0,
    fees_produced_bnb: last.fees_total_bnb ?? last.forwarded_total_bnb,
    income_put_in_bnb: last.swept_total_bnb,
    fees_owed_now_bnb: owed_now_bnb != null ? owed_now_bnb : last.owed_bnb,
    // 1 tick = 0.01 % of price; the sign says which way the pair moved.
    price_move_pct_since_start: tickMove != null ? +((Math.pow(1.0001, tickMove) - 1) * 100).toFixed(2) : null,
    // Only a run that saw a position was in or out of a range; "in range on
    // 3 of 6" must not count a run that found none.
    runs_with_a_position: series.filter((p) => p.in_range === true || p.in_range === false).length,
    days_in_range: series.filter((p) => p.in_range === true).length,
    days_out_of_range: series.filter((p) => p.in_range === false).length,
    days_it_acted: series.filter((p) => p.acted).length,
  };
  // Profit, the way the operator asks it ("was haben wir fuer profit?"): what
  // the position is worth now against the first point, plus the fees it has
  // produced and still owes, minus the gas on record. The value part is
  // mostly the pair's price moving; the sentence says so, because on $55 in
  // a 0.05 % pool the fees are the small part and hiding that would be spin.
  if (out.value_bnb && out.value_bnb.start != null && out.value_bnb.now != null) {
    // Capital that was added to the position is in its value now but is not
    // a gain of the price: the fees a re-set folded in and the income the
    // increase put in. Take them out of the price part, else the folded fees
    // count twice — once in the value, once as fees (2026-09-07, +0.001 BNB).
    const folded = Number(last.folded_total_bnb) || 0, putIn = Number(last.into_position_total_bnb) || 0;
    const price = +(out.value_bnb.now - out.value_bnb.start - folded - putIn).toFixed(6);
    const collected = Math.max(0, (out.fees_produced_bnb || 0) - folded);
    const fees = +((out.fees_produced_bnb || 0) + (out.fees_owed_now_bnb || 0)).toFixed(6);
    // The pool is CAKE/BNB: "the pair's price" is CAKE moving against BNB.
    const gas = gas_bnb != null ? +Number(gas_bnb).toFixed(6) : null;
    const bnb = +(price + fees - (gas || 0)).toFixed(6);
    const usd = last.bnb_usd ? +(bnb * last.bnb_usd).toFixed(2) : null;
    out.profit = { bnb, usd, from_price_bnb: price, from_fees_bnb: fees, fees_collected_bnb: +collected.toFixed(6), fees_folded_bnb: +folded.toFixed(6), fees_owed_bnb: +(out.fees_owed_now_bnb || 0).toFixed(6), gas_bnb: gas, bnb_usd: last.bnb_usd || null };
  }
  // The same figures as one sentence — the line /liquidity opens with and the
  // whole of the Telegram daily report, so the two never say different things.
  const f = (v, d) => (v == null || !isFinite(Number(v))) ? '—' : Number(v).toFixed(d);
  const pct = (v) => v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  const v = out.value_bnb;
  out.sentence = `Since ${String(out.since).slice(0, 10)}: ${out.points} run${out.points === 1 ? '' : 's'}`
    + (v && v.start != null ? `, position worth ${f(v.start, 4)} → ${f(v.now, 4)} BNB (${pct(v.change_pct)})` : '')
    + (out.price_move_pct_since_start != null ? `, the pair moved ${pct(out.price_move_pct_since_start)}` : '')
    + `, in range on ${out.days_in_range} of ${out.runs_with_a_position}`
    + `, fees sent to the buyback bot ${f(out.fees_sent_to_buyback_bnb, 5)} BNB`
    + (out.fees_kept_as_capital_bnb ? `, kept as capital ${f(out.fees_kept_as_capital_bnb, 5)} BNB` : '')
    + `, income put in ${f(out.income_put_in_bnb, 5)} BNB.`;
  const sign = (x) => (x > 0 ? '+' : '') + f(x, 5);
  if (out.profit) {
    const p = out.profit;
    out.sentence += ` Profit so far ${sign(p.bnb)} BNB${p.usd != null ? ` (about $${p.usd.toFixed(2)})` : ''}: ${sign(p.from_price_bnb)} BNB from CAKE moving against BNB, ${sign(p.from_fees_bnb)} BNB of fees earned (${lpFeesWhere(p)})${p.gas_bnb != null ? `, −${f(p.gas_bnb, 5)} BNB of gas` : ''}.`;
  }
  return out;
}

// ---------------------------------------------------------------- earnings

async function readEarnings(env) {
  const list = await env.AGENT.list({ prefix: 'earn:' });
  let total = 0n;
  const payments = [];
  for (const k of list.keys) {
    const rec = JSON.parse((await env.AGENT.get(k.name)) || '{}');
    if (!rec.amount) continue;
    total += BigInt(rec.amount);
    payments.push({ at: rec.at, amountUsd1: fmtUsd1(BigInt(rec.amount)), tx: rec.tx, for: rec.for });
  }
  payments.sort((a, b) => (b.at || 0) - (a.at || 0));
  return { totalUsd1: fmtUsd1(total), totalRaw: total.toString(), count: payments.length, payments: payments.slice(0, 25) };
}

// ---------------------------------------------------------------- handler

// CAPABILITIES moved to catalog.js — see the header there for why.

// The one paid tool. Its description says the price in the first sentence:
// an agent deciding whether to call something should not have to call it to
// find out that it costs money.
const WATCH_TOOL = {
  name: 'bsc_pool_watch',
  description:
    'PAID (0.50 USD1, 30 days). Watch one BNB Smart Chain liquidity pool around the clock and '
    + 'get told the moment it can no longer absorb a trade of your size. Checked every fifteen '
    + 'minutes for thirty days; fires a callback when depth falls below your threshold. '
    + 'Call it once WITHOUT `payment` and it answers with the price and where to send it — that '
    + 'call is free. Measuring a pool once is free too and always will be: use bsc_pool_scan at '
    + 'https://brainonbnb.com/mcp for that. This tool is only worth paying for because somebody '
    + 'has to still be running in an hour.',
  inputSchema: {
    type: 'object',
    required: ['token', 'pair'],
    properties: {
      token: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$', description: 'The BEP-20 token address.' },
      pair: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$', description: 'The PancakeSwap pair holding it.' },
      quote: { type: 'string', description: 'Optional. The other side of the pair, if it is not WBNB.' },
      depthBelowUsd: {
        type: 'number',
        description:
          'Alert when the pool can no longer absorb a trade of this many dollars. '
          + 'Leave it out and the watch records depth but never fires, which is a real thing to '
          + 'want and a bad thing to get by accident.',
      },
      callback: { type: 'string', format: 'uri', description: 'Where to POST when it fires. Without one, poll /watch/<id>.' },
      payment: {
        type: 'string',
        description:
          'The transaction hash of your USD1 transfer, or a base64 x402 payload. Omit it on the '
          + 'first call to be told what to pay and where.',
      },
    },
  },
};

// The paid purchase itself, lifted out of the HTTP route so that MCP can sell
// the same thing without a second copy of the payment logic living beside it.
// Returns what the caller should be told rather than a Response: the two front
// doors format it differently, and only one of them can carry a header.
// One payment check for everything sold over x402 here. Two ways to pay the
// same price into the same wallet: standard x402 through the facilitator (a
// stock client can do it unattended), or our own direct USD1 transfer with the
// transaction hash as proof, which needs no facilitator and no signature
// support. Either way the proof is marked spent BEFORE the goods are produced:
// if production fails the caller has lost nothing they cannot retry with
// support, whereas the reverse order lets a retry storm mint goods off one
// payment. Returns { ok, tx, paid, from } or { ok:false, status, body }.
async function chargeX402(env, { payTo, price, description, resource, proof, sold, alt = null }) {
  const parsed = parsePaymentHeader(proof);
  let check, tx, asset = 'USD1';
  if (parsed.kind === 'x402') {
    const accepts = dexterAccepts({ payTo, amountAtomic: price.toString(), description, resource });
    const r = await verifyAndSettle(parsed.value, accepts);
    if (!r.ok) return { ok: false, status: 402, body: { error: 'payment not accepted', stage: r.stage, reason: r.reason } };
    tx = (r.tx || `x402:${Date.now()}`).toLowerCase();
    if (await env.AGENT.get(`paid:${tx}`)) return { ok: false, status: 402, body: { error: 'payment not accepted', reason: 'this settlement has already been used' } };
    check = { ok: true, paid: price, from: r.payer };
  } else {
    check = await verifyPayment(env, String(proof).trim(), payTo, price);
    // Not a USD1 payment at all? If a second coin is accepted for this
    // resource, the same receipt is read again for that one.
    if (!check.ok && alt && check.paid === 0n) {
      const c2 = await verifyPayment(env, String(proof).trim(), payTo, alt.min, alt.asset, alt.label);
      if (c2.ok) { check = c2; asset = alt.label; }
      else if (c2.paid > 0n) check = c2;
    }
    if (!check.ok) return { ok: false, status: 402, body: { error: 'payment not accepted', reason: check.reason } };
    tx = String(proof).trim().toLowerCase();
  }
  await env.AGENT.put(`paid:${tx}`, '1', { expirationTtl: 60 * 60 * 24 * 400 });
  // earn: records USD1 amounts only — /stats sums them as dollars. A payment
  // in another coin is recorded with its coin and its dollar price at the
  // quote, so the total stays a dollar figure and the coin stays visible.
  const earn = asset === 'USD1'
    ? { at: Date.now(), amount: check.paid.toString(), tx, for: sold }
    : { at: Date.now(), amount: price.toString(), tx, for: sold, paid_in: asset, paid_atomic: check.paid.toString() };
  await env.AGENT.put(`earn:${tx}`, JSON.stringify(earn), { expirationTtl: 60 * 60 * 24 * 400 });
  return { ok: true, tx, paid: check.paid, from: check.from, asset };
}

// The five deliveries, sold per answer. The same doWork() the escrow path
// runs, the same price the agents quote on Brain Plaza, one payment and the
// document comes straight back — no job, no dispute window, no settle call.
// The escrow stays for buyers who want a kernel between them and the seller;
// this is for an agent that wants the answer now and has a wallet.
const ANSWER_PRICE = 100000000000000000n; // 0.10 USD1, the price every service quotes
async function sellAnswer(env, ctx, payTo, serviceId, body, proof) {
  const service = SERVICES[serviceId];
  if (!service) return { status: 400, body: { error: 'unknown service', services: Object.keys(SERVICES) } };
  const resource = `https://agent.brainonbnb.com/answer?service=${serviceId}`;
  const description = `${service.name} — one answer`;
  // The same price in $BOBAI, quoted now. If the pair cannot be read the
  // answer is still for sale in USD1; the $BOBAI door just stays shut.
  const bobai = await bobaiForUsd(Number(ANSWER_PRICE) / 1e18).catch(() => null);
  if (!proof) {
    const requirements = {
      x402Version: 2,
      accepts: [
        dexterAccepts({ payTo, amountAtomic: ANSWER_PRICE.toString(), description, resource }),
        {
          scheme: 'exact', network: NETWORK, asset: USD1, maxAmountRequired: ANSWER_PRICE.toString(), payTo, resource,
          description: `${description} — direct transfer, then send the transaction hash in PAYMENT-SIGNATURE`,
          extra: { name: 'World Liberty Financial USD', version: '1', decimals: 18, assetTransferMethod: 'direct-transfer' },
        },
        ...(bobai ? [{
          scheme: 'exact', network: NETWORK, asset: BOBAI, maxAmountRequired: bobai.atomic.toString(), payTo, resource,
          description: `${description} — the same price in $BOBAI (${bobai.tokens.toLocaleString('en-US')} BOBAI at this quote, a tenth of slack included): direct transfer, then the transaction hash in PAYMENT-SIGNATURE`,
          extra: { name: 'BOB', symbol: 'BOBAI', version: '1', decimals: 18, assetTransferMethod: 'direct-transfer', usd_per_bobai: bobai.usd_per_bobai, quoted_at: new Date().toISOString() },
        }] : []),
      ],
    };
    return {
      status: 402,
      headers: { 'PAYMENT-REQUIRED': b64(requirements) },
      body: {
        error: 'payment required',
        service: service.id, name: service.name, what: service.deliverables, needs: service.needs,
        how: `Send ${fmtUsd1(ANSWER_PRICE)} USD1${bobai ? ` or ${bobai.tokens.toLocaleString('en-US')} $BOBAI` : ''} to ${payTo} on BNB Smart Chain, then repeat this POST with header PAYMENT-SIGNATURE: <transaction hash> and a JSON body {"task":"<what you want, with the address in it>"} or {"params":{…}} using the field names under needs.`,
        ...(bobai ? { in_bobai: { tokens: bobai.tokens, usd_per_bobai: bobai.usd_per_bobai, note: '$BOBAI paid here stays in the income wallet as $BOBAI — off the market — until the liquidity agent’s sweep learns the token. USD1 is swept into the liquidity position the day it clears the gas floor.' } } : {}),
        example: `https://agent.brainonbnb.com/example?service=${serviceId} — what the answer looks like, free`,
        or_escrow: 'The same answer is sold through the ERC-8183 escrow on https://brainonbnb.com/registry, for buyers who want a kernel between them and the seller.',
        accepts: requirements.accepts,
      },
    };
  }
  const pay = await chargeX402(env, { payTo, price: ANSWER_PRICE, description, resource, proof, sold: `answer:${serviceId}`,
    alt: bobai ? { asset: BOBAI, min: bobai.atomic, label: 'BOBAI' } : null });
  if (!pay.ok) return { status: pay.status, body: pay.body };
  const params = extractParams(String(body?.task || ''), { ...(body?.params || {}), service: serviceId });
  let result;
  try {
    result = await doWork(serviceId, params, env);
  } catch (e) {
    // Paid and not deliverable — the one case that must never be silent.
    // The payment is recorded as unspent again so the caller can retry with
    // the input fixed, and the reason is the service's own.
    await env.AGENT.delete(`paid:${pay.tx}`).catch(() => {});
    await env.AGENT.delete(`earn:${pay.tx}`).catch(() => {});
    return { status: 422, body: { error: `could not produce the answer: ${String(e.message || e).slice(0, 200)}`, needs: service.needs, payment: 'not consumed — repeat with the same PAYMENT-SIGNATURE once the input is fixed' } };
  }
  ctx.waitUntil(bump(env, 'answer_sold'));
  return { status: 200, body: {
    ok: true, service: serviceId, name: service.name, paid: `${fmtUsd1(pay.paid)} ${pay.asset || 'USD1'}`, tx: pay.tx,
    produced_at: new Date().toISOString(),
    result,
    summary: summarize(serviceId, result),
    method: 'Every figure here is read from the chain at the time above. Nothing is cached and nothing is self-reported.',
  } };
}

async function purchaseWatch(env, ctx, payTo, spec, proof) {
  if (!proof) {
    // The 402 itself. accepts[] is an array because a second scheme
    // (eip3009, once a facilitator is in place) will sit beside this one
    // rather than replace it.
    // Two ways to pay the same price into the same wallet. The first is
    // standard x402 that any stock client can execute unattended; the
    // second is our own direct transfer, which needs no facilitator and
    // no signature support. A client takes whichever it can do.
    const resource = 'https://agent.brainonbnb.com/watch';
    const requirements = {
      x402Version: 2,
      accepts: [
        dexterAccepts({
          payTo,
          amountAtomic: WATCH_PRICE_USD1.toString(),
          description: `Pool watch for ${WATCH_DAYS} days`,
          resource,
        }),
        {
          scheme: 'exact',
          network: NETWORK,
          asset: USD1,
          maxAmountRequired: WATCH_PRICE_USD1.toString(),
          payTo,
          resource,
          description: `Pool watch for ${WATCH_DAYS} days — direct transfer, then send the transaction hash in PAYMENT-SIGNATURE`,
          extra: { name: 'World Liberty Financial USD', version: '1', decimals: 18, assetTransferMethod: 'direct-transfer' },
        },
      ],
    };
    return {
      status: 402,
      headers: { 'PAYMENT-REQUIRED': b64(requirements) },
      requirements,
      body: {
        error: 'payment required',
        how: `Send ${fmtUsd1(WATCH_PRICE_USD1)} USD1 to ${payTo} on BNB Smart Chain, then repeat this request with header PAYMENT-SIGNATURE: <transaction hash>.`,
        accepts: requirements.accepts,
      },
    };
  }

  // The payment half is shared with the per-answer sale above; the proof is
  // marked spent before the watch exists, for the reason given there.
  const pay = await chargeX402(env, {
    payTo, price: WATCH_PRICE_USD1, description: `Pool watch for ${WATCH_DAYS} days`,
    resource: 'https://agent.brainonbnb.com/watch', proof, sold: 'watch',
  });
  if (!pay.ok) return { status: pay.status, body: pay.body };
  const tx = pay.tx, check = { paid: pay.paid, from: pay.from };

  const watch = await createWatch(env, spec, { tx, from: check.from });
  ctx.waitUntil(bump(env, 'watch_created'));

  // Anything the caller sent that this endpoint does not read is named back
  // to them. The first paid request in the service's life passed
  // "threshold_pct", which is not a field here — it was swallowed in
  // silence, and the watch was created with no threshold at all. It would
  // have run for thirty days, never fired, and looked like it was working.
  // A caller who mistypes a field has to be told, or they are paying for
  // something they did not ask for.
  const KNOWN = new Set(['token', 'pair', 'quote', 'depthBelowUsd', 'callback']);
  const ignored = Object.keys(spec || {}).filter((k) => !KNOWN.has(k));

  return { status: 200, body: {
    ok: true,
    watch: watch.id,
    expires: new Date(watch.expiresAt).toISOString(),
    watching: { token: watch.token, pair: watch.pair, depthBelowUsd: watch.depthBelowUsd },
    callback: watch.callback ? 'will POST on trigger' : 'none set — read it back at the url below',
    // Spelled out, not left as a pattern to fill in. This is the only copy of
    // the id the buyer will ever be handed.
    read_back: `https://agent.brainonbnb.com/watch/${watch.id}`,
    paid: `${fmtUsd1(check.paid)} USD1`,
    // Stated rather than implied: a watch with no threshold records depth
    // and never alerts, which is a legitimate thing to want and a terrible
    // thing to receive by accident.
    ...(watch.depthBelowUsd == null ? {
      alerting: 'OFF — no depthBelowUsd was given, so this watch records depth but will never fire. Send depthBelowUsd (a number, in USD) to be alerted when the pool falls below it.',
    } : {}),
    ...(ignored.length ? {
      ignored_fields: ignored,
      ignored_note: 'These were not recognised and had no effect. The fields this endpoint reads are: token, pair, quote, depthBelowUsd, callback.',
    } : {}),
  } };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS')
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          // x-operator-token: the revoke route's lock (session-revoke.js). A
          // header the preflight does not name is a fetch the browser refuses
          // before it leaves the page — "Failed to fetch", no status, no body.
          'Access-Control-Allow-Headers': 'Content-Type,PAYMENT-SIGNATURE,x-operator-token',
        },
      });

    const payTo = env.X402_WALLET;

    // The catalogue. Reads the same payTo and price the 402 below quotes, so
    // the two cannot disagree — an agent that budgets from this file and then
    // calls /watch finds exactly the terms it was promised.
    if (path === '/.well-known/x402') {
      return json(buildCatalog({
        payTo,
        price: `${fmtUsd1(WATCH_PRICE_USD1)} USD1`,
        days: WATCH_DAYS,
        asset: USD1,
        network: NETWORK,
      }), 200, { 'Cache-Control': 'public, max-age=300' });
    }

    // Browsers ask for this on every HTML page this worker serves (/job,
    // /sessions, /lp/agent) and got a 404 in the console each time. One icon,
    // the site's own.
    if (path === '/favicon.ico') {
      return Response.redirect('https://brainonbnb.com/favicon.png', 301);
    }

    if (path === '/') {
      return json({
        service: 'Brain On BNB AI — agent service',
        what_this_is: 'Paid, continuous pool monitoring on BNB Smart Chain, plus the public counters behind brainonbnb.com. Measurement only — nothing here is financial advice.',
        capabilities: offering(),
        payment: { protocol: 'x402', network: NETWORK, asset: USD1, symbol: 'USD1', payTo },
        transparency: 'https://agent.brainonbnb.com/stats',
      });
    }

    // The A2A discovery card, on the origin the hireable agents live on.
    //
    // This host answered 404 here, and #302257 and #304493 name this exact URL
    // on-chain as one of their endpoints — a dead link written into the
    // registration of the agents built to be discovered. Worse, it is the path
    // our OWN marketplace fetches to resolve a stranger's agent
    // (cardEndpoint() in hire.js): we required of everyone else a file we did
    // not serve.
    //
    // The card on brainonbnb.com is a different thing and stays as it is: it
    // describes the free public tools and points at the website. It names no
    // negotiation skill and none of the four hireable services, so an indexer
    // reading it learns that we sell nothing.
    //
    // Skills are derived from SERVICES rather than listed again, because a card
    // advertising a service the seller does not implement is the failure this
    // whole project keeps documenting in other people's agents.
    if (path === '/.well-known/agent-card.json') {
      return json({
        protocolVersion: '0.3.0',
        name: 'Brain On BNB AI — hireable agents',
        // Counted from the list, not typed. It said "four" for three days
        // after the fifth agent went live — a number in prose is a number that
        // goes stale the moment somebody registers something.
        description: `${OWN_AGENT_IDS.length} hireable agents on BNB Smart Chain, covering every BNB Agent Studio category. Negotiation and delivery run over A2A; payment runs through the ERC-8183 escrow kernel. Every figure is measured from the chain at request time and cross-checked against the protocol it came from where the protocol publishes one.`,
        // The A2A endpoint, not the website. The card on the apex points at
        // https://brainonbnb.com/ — an HTML page — which is why a machine
        // following it finds nothing to talk to.
        url: `${SELF_ORIGIN}/a2a`,
        preferredTransport: 'JSONRPC',
        version: '1.0.0',
        provider: { organization: 'Brain On BNB AI', url: 'https://brainonbnb.com' },
        capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
        // THE LINK BACK TO THE CHAIN, which this card did not carry.
        //
        // /.well-known/agent-registration.json has listed these ids since the
        // day it was written, and that document is what a verifier fetches
        // AFTER it already knows which ids to check. The A2A card is what a
        // client reads FIRST, and without registrations on it there was no
        // machine-readable path from "I am talking to this endpoint" to "these
        // are its on-chain identities" — the same gap this marketplace flags
        // in other people's cards.
        registrations: registrations(),
        // Declared here as well as in the registration document, because the
        // two are read by different clients and a trust model that appears on
        // only one of them is a trust model half the readers never see. It is
        // backed: the ratings are readable at the ReputationRegistry below,
        // and the marketplace prints them per agent.
        supportedTrust: ['reputation'],
        trustRegistries: {
          identity: 'eip155:56:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
          reputation: 'eip155:56:0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
        },
        defaultInputModes: ['application/json', 'text/plain'],
        defaultOutputModes: ['application/json'],
        skills: [
          {
            id: 'negotiate',
            name: 'Negotiate an ERC-8183 job',
            description: 'Ask for a price. Returns this provider\'s address, the price in atomic units of the payment token, and the escrow parameters to fund a job against.',
            tags: ['erc-8183', 'negotiation', 'escrow'],
            examples: ['quote finding the best yield for my BNB on BNB Chain'],
          },
          {
            id: 'notify_funded',
            name: 'Notify the seller a job is funded',
            description: 'Tell the seller a job exists in the kernel and is funded. The seller reads the job from the chain rather than trusting the message, then delivers.',
            tags: ['erc-8183', 'delivery'],
          },
          ...Object.values(SERVICES).map((s) => ({
            id: s.id,
            name: s.name,
            description: s.deliverables,
            tags: [s.category, 'bnb-chain', 'measured-on-chain'],
            // What the buyer has to supply. A card that lists a service and
            // not its inputs makes the caller guess, and a guessed parameter
            // fails after the money is already in escrow.
            inputs: s.needs,
            price: s.price_display,
          })),
        ],
        // Where the rest of the story is, for a reader rather than a parser.
        additionalInterfaces: [
          { transport: 'JSONRPC', url: `${SELF_ORIGIN}/a2a` },
        ],
        documentationUrl: 'https://brainonbnb.com/registry',
      });
    }

    // The domain proof, on the origin the hireable agents actually name as
    // their endpoint. The ERC-8004 verifier fetches
    // /.well-known/agent-registration.json on the endpoint's own host — and
    // this host answered 404 for it, which is the same failure that left
    // #49467 unverified for months. An agent nobody can attribute is an
    // anonymous agent, whatever its description says.
    if (path === '/.well-known/agent-registration.json') {
      return json({
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: 'Brain On BNB AI — agent service',
        description: 'The hireable agents run by Brain On BNB AI on BNB Smart Chain. Negotiation and delivery run over A2A at https://agent.brainonbnb.com/a2a; payment runs through the ERC-8183 escrow kernel.',
        image: 'https://brainonbnb.com/logo-200x200.png',
        active: true,
        // The same list dashboard/_worker.js serves on the other origin, from
        // shared/agent-registrations.js. A newly registered agent missing from
        // the proof is unattributable on the host it names, which is the
        // failure that left #49467 unverified for months.
        registrations: registrations(),
        supportedTrust: ['reputation'],
        // Where the live state is. The card is what an indexer reads, so an
        // endpoint that is only mentioned on the A2A GET is discoverable by
        // people and not by the machines this card exists for.
        endpoints: {
          a2a: 'https://agent.brainonbnb.com/a2a',
          status: 'https://agent.brainonbnb.com/status',
          marketplace: 'https://brainonbnb.com/registry',
        },
        operator: { name: 'Brain On BNB AI', parent_agent: 49467, site: 'https://brainonbnb.com', marketplace: 'https://brainonbnb.com/registry' },
      });
    }

    // Being hireable, which is the half a marketplace usually forgets about
    // itself. A2A JSON-RPC: negotiate a price, then tell us the job is funded
    // and we deliver it on-chain. See sell.js for why it is A2A and not MCP.
    if (path === '/a2a') {
      if (request.method === 'POST') return await handleA2A(request, env);
      // A GET here is somebody looking, not somebody hiring — a person pasting
      // the URL, or an indexer checking whether the endpoint is alive. Answering
      // 404 is technically correct and reads as broken, which is precisely the
      // misreading this project keeps having to correct in other people's data.
      return json({
        endpoint: 'A2A JSON-RPC, POST only',
        method: 'message/send',
        example: {
          jsonrpc: '2.0', id: 1, method: 'message/send',
          params: { message: { role: 'user', messageId: 'example', parts: [{ kind: 'data', data: { skill: 'list' } }] } },
        },
        skills: ['list — what is for sale', 'negotiate — get a quote', 'notify_funded — deliver a job whose escrow is funded'],
        services: Object.values(SERVICES).map((x) => ({ id: x.id, name: x.name, category: x.category, price: x.price, price_display: x.price_display })),
        agents: { 302257: 'Venus Health Factor Monitor', 302258: 'BSC Grid Planner' },
        // Advertised, not just served. A buyer deciding whether to hire needs
        // to know the live state exists before it can ask for it, and a card
        // that omits it leaves the endpoint discoverable only by guessing.
        status: 'https://agent.brainonbnb.com/status',
        human_readable: 'https://brainonbnb.com/registry',
      });
    }

    // The deliverable of a finished job, served so the digest written on-chain
    // can be checked against the document it commits to.
    {
      const m = path.match(/^\/job\/(\d+)\/result$/);
      if (m) return await handleJobResult(m[1], env);
    }

    // ATTEST A DELIVERY ON-CHAIN, as the buyer. After a job this worker
    // delivered is SUBMITTED, the buyer can write one measurement into the
    // ERC-8004 ReputationRegistry: responsetime, the milliseconds between the
    // block that funded the escrow and the block that carried the deliverable
    // — two on-chain timestamps anyone can read again and disagree with. Not
    // a star rating: this project's rule is that a measurement and a taste
    // claim never share a column, and the writer enforces what the reader
    // separates. The evidence travels with it: feedbackURI is the delivered
    // document, feedbackHash its keccak256, so "delivered in 41 s" points at
    // exactly what was delivered. Returns the unsigned call; the buyer's own
    // wallet sends it. The contract refuses the agent's owner, so we could
    // not write this about ourselves even if we wanted to.
    if (path === '/attest') {
      const id = url.searchParams.get('job') || '';
      const fundTx = String(url.searchParams.get('fundTx') || '').toLowerCase();
      if (!/^\d+$/.test(id)) return json({ error: 'job is required — the numeric jobId' }, 400);
      if (!/^0x[a-f0-9]{64}$/.test(fundTx)) return json({ error: 'fundTx is required — the hash of the transaction that funded the escrow' }, 400);
      const raw = await call(ERC8183.commerce, JOB_CALL(id)).catch(() => null);
      const job = raw ? decodeJob(raw) : null;
      if (!job) return json({ error: 'job not found or unreadable', id }, 404);
      if (job.status !== 'SUBMITTED' && job.status !== 'COMPLETED') return json({ error: `job ${id} is ${job.status} — nothing has been delivered to attest`, status: job.status }, 409);
      const stored = await env.AGENT.get(`job:${id}`, 'json').catch(() => null);
      if (!stored || !stored.document) return json({ error: 'this worker holds no document for that job — it was not the provider' }, 404);
      let service = null; try { service = JSON.parse(stored.document).service || null; } catch { /* no service */ }
      const agentId = service && SOLD_BY[service] ? SOLD_BY[service].agent : null;
      if (!agentId) return json({ error: 'the delivering agent could not be identified from the document', service }, 500);
      const receipt = await rpc('eth_getTransactionReceipt', [fundTx], RECEIPT_RPCS).catch(() => null);
      if (!receipt || receipt.status !== '0x1') return json({ error: 'the funding transaction was not found or failed' }, 404);
      if (String(receipt.to || '').toLowerCase() !== ERC8183.commerce.toLowerCase()) return json({ error: 'that transaction did not go to the kernel' }, 400);
      const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false], RECEIPT_RPCS).catch(() => null);
      const fundedAt = block ? Number(BigInt(block.timestamp)) : null;
      if (!fundedAt) return json({ error: 'could not read the funding block' }, 503);
      const submittedAt = Number(job.submitted_at || 0);
      if (!(submittedAt > fundedAt)) return json({ error: 'the deliverable predates the funding transaction — wrong fundTx?', funded_at: fundedAt, submitted_at: submittedAt }, 400);
      const ms = (submittedAt - fundedAt) * 1000;
      const feedbackURI = `https://agent.brainonbnb.com/job/${id}/result`;
      const feedbackHash = keccak256(toBytes(stored.document));
      const data = encodeFunctionData({ abi: REPUTATION_ABI, functionName: 'giveFeedback', args: [BigInt(agentId), BigInt(ms), 0, 'responsetime', '', 'https://agent.brainonbnb.com/a2a', feedbackURI, feedbackHash] });
      ctx.waitUntil(bump(env, 'attest_prepared'));
      return json({
        job: id, agent_id: agentId, service, status: job.status,
        tag1: 'responsetime', value: ms, unit: 'ms',
        means: `The deliverable was on-chain ${submittedAt - fundedAt} seconds after the escrow was funded.`,
        measured_from: { funded_block: Number(BigInt(receipt.blockNumber)), funded_at: fundedAt, submitted_at: submittedAt },
        evidence: { feedbackURI, feedbackHash, note: 'keccak256 of the exact document served at feedbackURI' },
        call: { to: REPUTATION, data, value: '0x0' },
        rule: 'One measurement, two on-chain timestamps, the document hashed. No star rating: this registry already holds twenty thousand of those and they mean nothing.',
        who_may_send: 'Any wallet except the agent\'s owner. The buyer is the natural one.',
      });
    }

    // A worked example of what each service delivers, run by the same code a
    // funded job runs and cached a day. The marketplace card carries it so a
    // buyer sees the shape of the answer before paying for one.
    if (path === '/example') {
      const id = url.searchParams.get('service') || '';
      if (!SERVICES[id]) return json({ error: id ? `unknown service "${id.slice(0, 40)}"` : 'service is required', services: Object.keys(SERVICES) }, 400);
      try {
        const ex = await exampleFor(id, env, { fresh: url.searchParams.get('fresh') === '1' && request.headers.get('x-hit-secret') === env.HIT_SECRET });
        return json(ex, 200, { 'Cache-Control': 'public, max-age=3600' });
      } catch (e) {
        return json({ error: `the example could not be produced right now: ${String(e.message || e).slice(0, 200)}`, service: id }, 503);
      }
    }

    // Public transparency surface. Everything the dashboard block shows comes
    // from here, so the page cannot present a number this endpoint would not.
    // What the self-updating half of the census knows. The headline figures
    // come from a full offline scan; this reports what has changed since.
    // The broker. Ask what you need done, get agents that expose something
    // matching — open, no key, so another agent can use it mid-task.
    if (path === '/find') {
      const r = await handleFind(url);
      return json(r.body, r.status);
    }
    // The liquidity agent's free look at anybody's PancakeSwap V3 position:
    // in range or not, room left, value, fees owed. Open, no key, read live.
    // The plan (re-set, width, what spare BNB adds) is the paid answer.
    if (path === '/lp/look') {
      const params = { position: url.searchParams.get('position') || undefined, address: url.searchParams.get('address') || undefined };
      if (!params.position && !params.address) return json({ error: 'give ?position=<PancakeSwap V3 token id> or ?address=<wallet that holds exactly one>', example: '/lp/look?position=7324788' }, 400);
      try { return json(await lpPositionLook(params), 200, { 'Cache-Control': 'no-store' }); }
      catch (e) { return json({ error: String(e.shortMessage || e.message).slice(0, 200) }, 400); }
    }

    // Dispatch: a task in, an answer back, with the agent that produced it
    // named. Read-only tools only — see dispatch.js for why that line is not
    // moved. This is the free half of the marketplace: it answers questions.
    if (path === '/dispatch') {
      const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
      const r = await handleDispatch(url, body, env);
      ctx.waitUntil(bump(env, 'dispatch'));
      return json(r.body, r.status);
    }

    // Hire: negotiate a price with a seller agent over A2A and hand back the
    // ERC-8183 escrow calls, unsigned. This is the paid half — and the reason
    // it can exist without contradicting the read-only rule is that we build
    // the transactions and the buyer signs them. See hire.js.
    if (path === '/hire') {
      const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
      // Our own agents live on this worker, and a Worker cannot fetch its own
      // custom domain. Without this, hiring a stranger's agent would work and
      // hiring ours would fail — so the message is handed to the same A2A
      // handler in-process instead of going out and coming back.
      const r = await handleHire(url, body, env, { localA2A: async (endpoint, data) => {
        if (new URL(endpoint).host !== url.host) return null;
        const res = await handleA2A(new Request(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send',
            params: { message: { role: 'user', messageId: 'local', parts: [{ kind: 'data', data }] } } }),
        }), env);
        return await res.json();
      } });
      ctx.waitUntil(bump(env, 'hire'));
      return json(r.body, r.status);
    }

    // One job's state, straight from the kernel. Kept separate from /hire so
    // that a buyer who funded a job through some other client — the Altana SDK,
    // their own script, the seller's own page — can still track it here.
    if (path === '/job') {
      const id = url.searchParams.get('id');
      if (!/^\d+$/.test(id || '')) return json({ error: 'id is required — the numeric jobId' }, 400);
      const raw = await call(ERC8183.commerce, JOB_CALL(id)).catch(() => null);
      const job = raw ? decodeJob(raw) : null;
      if (!job) return json({ error: 'job not found or unreadable', id }, 404);
      ctx.waitUntil(bump(env, 'job'));
      // SUBMITTED is not COMPLETED, and the difference is money: a
      // deliverable exists, the escrow has not released. Saying so here keeps
      // anyone reading this endpoint from counting one as the other.
      const means = job.status === 'SUBMITTED'
        ? 'A deliverable is on-chain and the dispute window is running. The escrow has not released yet.'
        : job.status === 'COMPLETED' ? 'Delivered and the escrow released to the provider.'
        : job.status === 'OPEN' ? 'Created but not funded. Nothing is at stake yet.'
        : job.status === 'FUNDED' ? 'Escrow holds the budget. Waiting on the provider to deliver.'
        : job.status === 'EXPIRED' ? 'Expired undelivered — the client can call claimRefund(jobId) for the full budget.'
        : 'Rejected.';
      // THE DELIVERY, READABLE. A job page that showed a bytes32 and nothing
      // else told the buyer their money had gone somewhere; it did not show
      // them what they got. When this worker was the provider the document is
      // in KV, its SHA-256 is checked against the digest on the kernel right
      // here, and the answer is summarised by the same module the marketplace
      // card uses for its example — so before and after are read by one rule.
      let delivery = null;
      const stored = await env.AGENT.get(`job:${id}`, 'json').catch(() => null);
      if (stored && stored.document) {
        let digest = null;
        try {
          const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stored.document));
          digest = '0x' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
        } catch { /* no digest, no claim */ }
        let doc = null; try { doc = JSON.parse(stored.document); } catch { /* served raw below */ }
        const service = doc?.service || stored.result?.service || null;
        delivery = {
          service,
          produced_at: doc?.produced_at || null,
          summary: summarize(service, doc?.result || stored.result || null),
          document_url: `https://agent.brainonbnb.com/job/${id}/result`,
          digest_of_document: digest,
          digest_on_chain: job.deliverable || null,
          digest_matches: digest && job.deliverable ? digest.toLowerCase() === String(job.deliverable).toLowerCase() : null,
          tx: stored.delivery?.tx || null,
        };
      }
      const out = { ...job, chain_id: ERC8183.chainId, kernel: ERC8183.commerce, explorer: `https://bscscan.com/address/${ERC8183.commerce}`, means, delivery };
      if (delivery && delivery.summary && delivery.summary.subject) {
        let t = null; try { t = JSON.parse(job.description || '').task || null; } catch { t = job.description || null; }
        const sj = String(delivery.summary.subject);
        out.delivery_subject = sj;
        out.task_names_subject = t ? new RegExp(`\\b${sj.replace(/[.*+?^${}()|[\]\\$]/g, '\\$&')}\\b`, 'i').test(t) : null;
      }
      const wantsHtml = /text\/html/.test(request.headers.get('accept') || '') && url.searchParams.get('format') !== 'json';
      if (!wantsHtml) return json(out);

      // The same facts as a page. Plain markup, no script: it has to read on a
      // phone from a Telegram link and inside a judge's screenshot alike.
      const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
      const addr = (a) => (a ? `<a href="https://bscscan.com/address/${h(a)}" target="_blank" rel="noopener"><code>${h(short(a))}</code></a>` : '—');
      const when = (t) => (t ? new Date(Number(t) * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');
      let task = null, svcName = null;
      try { const d = JSON.parse(job.description || ''); task = d.task || null; svcName = d.service || null; } catch { task = job.description || null; }
      const sum = delivery?.summary;
      // The delivery's subject against the task's words. Job 56670 asked
      // "grid plan for WBNB" and was delivered for BOBAI; the page showed
      // COMPLETED and "SHA-256 matches" and never said so. The page is the
      // evidence, so it says it in one line.
      const subject = sum && sum.subject ? String(sum.subject) : null;
      const taskNamesSubject = subject && task ? new RegExp(`\\b${subject.replace(/[.*+?^${}()|[\]\\$]/g, '\\$&')}\\b`, 'i').test(task) : null;
      const mismatch = subject && task && taskNamesSubject === false;
      const tone = job.status === 'COMPLETED' ? 'ok' : job.status === 'SUBMITTED' || job.status === 'FUNDED' ? 'wait' : job.status === 'OPEN' ? 'dim' : 'bad';
      const html = `${pageHead(`Job #${h(id)} — ${h(job.status)}`, `
main{max-width:720px}
.st{display:inline-block;padding:3px 10px;border-radius:999px;font-size:.78rem;font-weight:700;letter-spacing:.3px;margin-left:8px;vertical-align:middle}
.ok{background:rgba(63,224,154,.15);color:#3fe09a}.wait{background:rgba(255,196,107,.15);color:#ffc46b}.dim{background:rgba(255,255,255,.08);color:#a9a49a}.bad{background:rgba(255,143,107,.15);color:#ff8f6b}
p.means{color:#cfc9bd;margin:6px 0 0}dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0;font-size:.9rem}dt{color:#a9a49a}dd{margin:0;overflow-wrap:anywhere}
.task{font-style:italic;color:#cfc9bd;margin:0 0 10px}.head{font-size:1.05rem;font-weight:700;margin:0 0 8px}
.card{border:1px solid rgba(240,185,11,.22);border-radius:14px;padding:14px 16px;background:rgba(240,185,11,.04)}
.note{color:#a9a49a;font-size:.82rem;margin-top:10px}.none{color:#a9a49a}`)}${pageNav({ href: SITE + '/registry', label: 'Brain Plaza' }, { href: '/job?id=' + h(id), label: 'Job #' + h(id) }, BUY)}<h1>Job #${h(id)}<span class="st ${tone}">${h(job.status)}</span></h1>
<p class="means">${h(means)}</p>
<h2>What was asked</h2>
${task ? `<p class="task">&ldquo;${h(task)}&rdquo;</p>` : '<p class="none">No description on the job.</p>'}
<dl><dt>Service</dt><dd>${h(svcName || delivery?.service || '—')}</dd><dt>Budget</dt><dd>${h(job.budget_u ?? '—')} $U in escrow</dd>
<dt>Client</dt><dd>${addr(job.client)}</dd><dt>Provider</dt><dd>${addr(job.provider)}</dd>
<dt>Submitted</dt><dd>${when(job.submitted_at)}</dd><dt>${job.status === 'COMPLETED' || job.status === 'EXPIRED' || job.status === 'REJECTED' ? 'Was due' : 'Expires'}</dt><dd>${when(job.expired_at)}</dd>
<dt>Kernel</dt><dd>${addr(ERC8183.commerce)} on BNB Chain</dd></dl>
<h2>What was delivered</h2>
${delivery ? `<div class="card">${sum?.headline ? `<p class="head">${h(sum.headline)}</p>` : ''}${mismatch ? `<p class="note" style="margin:0 0 8px;color:#ffc46b">Delivered for ${h(subject)}, which the task text does not name — the seller read the task differently from how it was written. The digest check below says only that the document is the one committed, not that it answers the question.</p>` : ''}
${sum?.facts?.length ? `<dl>${sum.facts.map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(v)}</dd>`).join('')}</dl>` : ''}
<p class="note">Produced ${h(delivery.produced_at ? String(delivery.produced_at).replace('T', ' ').slice(0, 16) + ' UTC' : '—')}. <a href="${h(delivery.document_url)}">Full document</a>${delivery.tx ? ` · <a href="https://bscscan.com/tx/${h(delivery.tx)}" target="_blank" rel="noopener">delivery transaction</a>` : ''}.<br>
${delivery.digest_matches === true ? 'The SHA-256 of that document matches the digest written on the kernel: what you read is what was committed.'
    : delivery.digest_matches === false ? 'The SHA-256 of the stored document does NOT match the digest on the kernel — read the document, not this page.'
    : 'No digest on the kernel to check against yet.'}</p></div>`
    : `<p class="none">${job.status === 'COMPLETED' || job.status === 'SUBMITTED' ? 'A deliverable is on the kernel, but this worker was not the provider, so the document itself is not held here.' : 'Nothing delivered yet.'}</p>`}
<p class="note">Same facts as JSON: <a href="/job?id=${h(id)}&amp;format=json">/job?id=${h(id)}&amp;format=json</a> · <a href="https://brainonbnb.com/registry">Brain Plaza</a></p>
${pageTail}`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
    }

    // The series. Daily points and full-scan points are returned separately,
    // never merged into one line — one is a sample of two dozen endpoints, the
    // other is every id in the registry, and a chart that averages them would
    // be lying with real numbers.
    // The public record. Every task this router passed on, and the track
    // record that falls out of it — derived from the log, never declared by
    // the operator it describes.
    if (path === '/sessions') {
      const sessions = await readSessions(env);
      const record = trackRecord(sessions);
      // A browser gets the same record as a page. /registry links here with
      // "Full log", and until 2026-09-03 a person following that link landed on
      // raw JSON. Agents keep getting JSON: no Accept: text/html, or ?format=json.
      const wantsHtml = /text\/html/.test(request.headers.get('accept') || '') && url.searchParams.get('format') !== 'json';
      if (wantsHtml) {
        const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const when = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) + ' UTC' : '—');
        const probes = sessions.filter((s) => s.probe).length;
        const recent = sessions.slice(-40).reverse();
        const html = `${pageHead('What has actually been asked — Brain Plaza', `
main{max-width:960px}
p.means{color:#cfc9bd;margin:6px 0 0}.note{color:#a9a49a;font-size:.82rem;margin-top:10px}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.84rem}th{text-align:left;color:#a9a49a;font-weight:600;font-size:.72rem;letter-spacing:.4px;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.12)}
td{padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:top}td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.ok{color:#3fe09a}.bad{color:#ff8f6b}.dim{color:#a9a49a}.task{font-style:italic;color:#cfc9bd}.ex{color:#a9a49a;font-size:.78rem}`)}${pageNav({ href: SITE + '/registry', label: 'Brain Plaza' }, { href: '/sessions', label: 'What has actually been asked' }, BUY)}<h1>What has actually been asked</h1>
<p class="means">Every task Brain Plaza has routed to another agent, and how each one went. Failures included: a record that only showed successes would be marketing. Nobody reports their own score here; an operator appears because it was asked something, and its reliability is the count of times it answered.</p>
<p class="note">${h(sessions.length)} tasks recorded (the last ${MAX_SESSIONS} are kept) · ${h(record.length)} operators seen · ${h(probes)} of the tasks were our own daily checks, marked below and counted separately. What was asked is stored with a short excerpt of the answer, never the full response.</p>
<h2>Track record, by operator</h2>
<div class="wrap"><table><thead><tr><th>Operator</th><th>Answered</th><th>Median</th><th>Tools it answered with</th><th>Last seen</th><th>Recent failures</th></tr></thead><tbody>
${record.map((r) => `<tr><td>${h(r.operator)}${r.agent && String(r.agent) !== String(r.operator) ? `<br><span class="dim">${h(r.agent)}</span>` : ''}</td><td class="n ${r.answered === r.tasks_routed ? 'ok' : r.answered ? '' : 'bad'}">${h(r.reliability)}${r.of_which_our_scheduled_checks ? `<br><span class="dim">${h(r.of_which_our_scheduled_checks)} our checks</span>` : ''}</td><td class="n">${r.median_ms == null ? '—' : h(r.median_ms) + ' ms'}</td><td>${r.tools_used.length ? h(r.tools_used.join(' · ')) : '<span class="dim">—</span>'}</td><td class="n">${h(when(r.last_seen))}</td><td class="ex">${r.recent_failures ? h(r.recent_failures.join(' · ')) : ''}</td></tr>`).join('')}
</tbody></table></div>
<h2>The last ${h(recent.length)} tasks, newest first</h2>
<div class="wrap"><table><thead><tr><th>When</th><th>Asked</th><th>Routed to</th><th>Outcome</th><th>Took</th></tr></thead><tbody>
${recent.map((s) => `<tr><td class="n">${h(when(s.at))}${s.probe ? '<br><span class="dim">our check</span>' : ''}</td><td><span class="task">&ldquo;${h(s.task)}&rdquo;</span>${s.excerpt ? `<br><span class="ex">${h(s.excerpt)}</span>` : ''}</td><td>${h(s.operator || s.agent || '—')}${s.tool ? `<br><code class="dim">${h(s.tool)}</code>` : ''}</td><td class="${s.ok ? 'ok' : 'bad'}">${h(s.outcome)}</td><td class="n">${typeof s.ms === 'number' ? h(s.ms) + ' ms' : '—'}</td></tr>`).join('')}
</tbody></table></div>
<p class="note">Same record as JSON: <a href="/sessions?format=json">/sessions?format=json</a> · <a href="https://brainonbnb.com/registry">Brain Plaza</a></p>
${pageTail}`;
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
      }
      return json({
        what_this_is: 'Every task Brain Plaza has routed to another agent, and how each one went. Failures included — a record that only showed successes would be marketing.',
        how_to_read_it: 'Nobody reports their own score here. An operator appears because it was asked something, and its reliability is the count of times it answered. We store what was asked and a short excerpt of the answer, never the full response.',
        sessions_recorded: sessions.length,
        operators_seen: record.length,
        track_record: record,
        recent: sessions.slice(-40).reverse(),
      });
    }

    if (path === '/census-history') {
      const raw = JSON.parse((await env.AGENT.get('census:history')) || '[]');
      const daily = raw.filter((p) => p.kind === 'daily');
      const full = raw.filter((p) => p.kind === 'full');
      const first = daily[0], last = daily[daily.length - 1];
      return json({
        what_this_is: 'How the ERC-8004 registry on BNB Chain has moved since we started watching it.',
        note: 'Daily points track the registry high-water mark and re-check a rotating slice of known endpoints — a sample, not the whole registry. Full points come from scanning every id offline. They are kept apart because they measure different things.',
        watching_since: first?.date || null,
        days_observed: daily.length,
        growth: first && last ? {
          from: first.highest_id, to: last.highest_id,
          new_registrations: (last.highest_id || 0) - (first.highest_id || 0),
          per_day: daily.length > 1
            ? Math.round(((last.highest_id || 0) - (first.highest_id || 0)) / (daily.length - 1))
            : null,
        } : null,
        daily,
        full_scans: full,
      });
    }

    // Records a completed offline scan as a fixed point in the series. Secret
    // guarded: these are the numbers the page quotes, and anyone able to post
    // them could rewrite the history the page is built on.
    if (path === '/census-history' && request.method === 'POST') {
      return json({ error: 'use /census-full' }, 400);
    }
    if (path === '/census-full' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      const b = await request.json().catch(() => null);
      if (!b || !Number.isInteger(b.registered_ids)) return json({ error: 'registered_ids required' }, 400);
      const hist = JSON.parse((await env.AGENT.get('census:history')) || '[]');
      const date = (b.date || new Date().toISOString()).slice(0, 10);
      const point = {
        date, kind: 'full',
        registered_ids: b.registered_ids,
        parse: b.parse ?? null,
        with_endpoint: b.with_endpoint ?? null,
        reachable: b.reachable ?? null,
        operators: b.operators ?? null,
        mcp: b.mcp ?? null,
      };
      const i = hist.findIndex((h) => h.date === date && h.kind === 'full');
      if (i >= 0) hist[i] = point; else hist.push(point);
      hist.sort((x, y) => (x.date < y.date ? -1 : 1));
      await env.AGENT.put('census:history', JSON.stringify(hist));
      return json({ ok: true, recorded: point, points: hist.length });
    }

    // The LP width record, as the cron has built it. Same shape as
    // data/lp-windows.json so `lp-windows.mjs --sync` can merge it straight
    // in, plus the verdict the decision module would draw from it — computed
    // by the same function, so the two cannot disagree.
    // THE POOL RECORD: the same fifty dollars replayed in each pool the
    // operator named, hour by hour, at the width the agent uses. A finding
    // for the operator; the agent never changes pools on its own.
    if (path === '/lp/pools') {
      const log = await readLpPools(env);
      if (!log || !Object.keys(log.pools || {}).length) {
        return json({ error: 'no pool window has been recorded yet', cadence: "hourly, after the width record's own tick", candidates: LP_POOL_CANDIDATES }, 503);
      }
      // The width: the one the agent's position uses, else what the query asks, else ±1%.
      let width = 1;
      try {
        const rec = JSON.parse((await env.AGENT.get('lp:agent')) || 'null');
        const w = Number(rec?.last?.steps?.rebalance?.width_pct);
        if (w > 0) width = w;
      } catch { /* the default stands */ }
      const q = Number(url.searchParams.get('width'));
      if (q > 0 && q <= 50) width = q;
      const v = poolVerdict(log, width, { watched: env.LP_WATCH_POOL });
      const body = {
        ...v,
        since: log.since || null,
        cadence: "hourly, after the width record's own tick; the watched pool's window is the width record's, the others are replayed with the same code",
        width_record: 'https://agent.brainonbnb.com/lp/windows',
        agent_record: 'https://agent.brainonbnb.com/lp/agent',
        last_error: log.last_error || null,
      };
      const wantsHtml = /text\/html/.test(request.headers.get('accept') || '') && url.searchParams.get('format') !== 'json';
      if (wantsHtml) {
        const h = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const when = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) + ' UTC' : '—');
        const f = (x, d = 4) => (x == null || !isFinite(Number(x)) ? '—' : Number(x).toFixed(d));
        const usd = (x) => (x == null ? '—' : '$' + f(x));
        const html = `${pageHead('The pool record — the liquidity agent', `
main{max-width:820px}
p.lead{color:#cfc9bd;margin:6px 0 0}
.card{border:1px solid rgba(240,185,11,.22);border-radius:14px;padding:14px 16px;background:rgba(240,185,11,.04);margin-bottom:10px}
.note{color:#a9a49a;font-size:.82rem;margin-top:10px}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.86rem;min-width:560px}th,td{text-align:right;padding:7px 8px;border-top:1px solid rgba(255,255,255,.08);white-space:nowrap}th{color:#a9a49a;font-weight:600;font-size:.74rem;letter-spacing:.4px;text-transform:uppercase;border-top:0}th:first-child,td:first-child{text-align:left}tr.w td{color:var(--gold)}
`)}${pageNav({ href: '/lp/windows', label: 'The width record' }, { href: '/lp/pools', label: 'The pool record' }, BUY)}<h1>The pool record</h1>
<p class="lead">What ${h(usd(v.usd))} would have earned in each pool the operator named, replayed hour by hour with the same code, in a ±${h(v.width_pct)}% range. The agent is in the pool marked gold. Since ${h(when(log.since))}.</p>
<div class="card"><b>${h(v.why.replace(/^[a-z]/, (ch) => ch.toUpperCase()))}</b><p class="note">${h(v.rule)}</p></div>
<div class="card"><div class="wrap"><table><thead><tr><th>Pool</th><th>Hours</th><th>Windows</th><th>Fees</th><th>Per day</th><th>Swaps</th><th>Quiet</th><th>Held</th><th>Last</th></tr></thead><tbody>
${v.pools.map((p) => `<tr${p.watched ? ' class="w"' : ''}><td>${h(p.label)}${p.watched ? ' · the agent is here' : ''}</td><td>${h(p.hours)}</td><td>${h(p.windows)}</td><td>${h(usd(p.fees_usd))}</td><td>${h(usd(p.fees_usd_per_day))}</td><td>${h(p.swaps)}</td><td>${h(p.quiet_windows)}</td><td>${p.held_pct == null ? '—' : h(p.held_pct) + '%'}</td><td>${h(when(p.last))}</td></tr>`).join('')}
</tbody></table></div>
<p class="note">Quiet = windows in which nobody swapped in that pool. Held = share of windows the range held through without crossing an edge. Fees are for this capital inside the width, diluted by the pool's own working capital, and are not annualised.</p></div>
${log.last_error ? `<p class="note">Last hour that could not be measured: ${h(when(log.last_error.at))} — ${h(log.last_error.message)}</p>` : ''}
<p class="note">Same facts as JSON: <a href="/lp/pools?format=json">/lp/pools?format=json</a> · another width: <a href="/lp/pools?width=2">?width=2</a> · the width record: <a href="/lp/windows">/lp/windows</a> · <a href="https://brainonbnb.com/liquidity">how it works</a></p>
${pageTail}`;
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
      }
      return json(body, 200, { 'Cache-Control': 'public, max-age=300' });
    }

    if (path === '/lp/windows') {
      const log = await readLpWindows(env);
      if (!log) return json({ error: 'no LP window has been recorded yet', cadence: 'hourly' }, 503);
      // The re-set cost the verdict charges is the agent's own last one when
      // there is one — the same figure worker-lp uses, from the same record.
      let costOpts = {};
      try {
        const rec = JSON.parse((await env.AGENT.get('lp:agent')) || 'null');
        const m = measuredResetCost(rec, await bnbUsd().catch(() => null));
        if (m) costOpts = { resetCostUsd: m.usd, resetCostBasis: `measured: the re-set of ${m.at.slice(0, 16).replace('T', ' ')} UTC cost ${m.gas_bnb} BNB in ${m.transactions ?? '?'} transactions` };
      } catch { /* the replay's assumption stands */ }
      const v = lpVerdict(log, costOpts);
      // THE WIDTH RECORD, READABLE. The record page and /liquidity link here
      // as "the width record", and a person arrived at raw JSON (pressed
      // 2026-09-04). The same verdict as a page: which width the agent would
      // use and why, every width replayed side by side, and what the record
      // is made of. Nothing is computed here that the verdict does not carry.
      const wantsHtml = /text\/html/.test(request.headers.get('accept') || '') && url.searchParams.get('format') !== 'json';
      if (wantsHtml && v) {
        const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const when = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) + ' UTC' : '—');
        const f = (x, d = 2) => (x == null || !isFinite(Number(x)) ? '—' : Number(x).toFixed(d));
        const pick = v.earnings_pick || null;
        const rows = (v.rows || []).slice().sort((a, b) => a.width - b.width);
        const usd = log.usd || 50;
        const html = `${pageHead('The width record — the liquidity agent', `
main{max-width:820px}
p.lead{color:#cfc9bd;margin:6px 0 0}
.card{border:1px solid rgba(240,185,11,.22);border-radius:14px;padding:14px 16px;background:rgba(240,185,11,.04);margin-bottom:10px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0;font-size:.9rem}dt{color:#a9a49a}dd{margin:0;overflow-wrap:anywhere}
.note{color:#a9a49a;font-size:.82rem;margin-top:10px}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.86rem;min-width:560px}th,td{text-align:right;padding:7px 8px;border-top:1px solid rgba(255,255,255,.08);white-space:nowrap}th{color:#a9a49a;font-weight:600;text-transform:none;border-top:0}td:first-child,th:first-child{text-align:left}tr.pick td{color:#f0b90b;font-weight:700}
`)}${pageNav({ href: '/lp/agent', label: 'The record' }, { href: '/lp/windows', label: 'The width record' }, BUY)}<h1>The width record</h1>
<p class="lead">How wide the liquidity agent sets its price range, and why. Every hour a cron replays a position of $${h(usd)} through the last ~37 minutes of the CAKE/BNB 0.05% pool and records what each width would have earned; the widths are then replayed over every recorded price with the agent's own re-set delay and its measured re-set cost. The width that nets the most per day is the one the next re-set uses. Nothing here is a forecast.</p>
<h2>The pick</h2>
<div class="card"><dl>
<dt>Width</dt><dd>${pick ? `<b>±${h(pick.width)}%</b> — about $${h(f(pick.earnings.net_usd_per_day, 2))} a day on $${h(usd)} after ${h(pick.earnings.resets)} re-set${pick.earnings.resets === 1 ? '' : 's'} at $${h(f(pick.earnings.reset_cost_usd, 2))} each, over ${h(f(pick.earnings.hours, 0))} h of recorded prices (${h(f(pick.earnings.hours_in_range, 0))} h of them inside the range)` : `none yet — ${h(v.hours_of_prices || 0)} h of prices are on record and 24 h are needed before a width may be picked`}</dd>
<dt>Re-set cost</dt><dd>$${h(f(v.reset_cost && v.reset_cost.usd, 2))} — ${h(v.reset_cost && v.reset_cost.basis)}</dd>
<dt>Held a full day</dt><dd>${v.day_pick ? `±${h(v.day_pick.width)}% is the narrowest width that stayed in range through every tested 24-hour window (${h(v.day_pick.day.held)} of ${h(v.day_pick.day.tested)}). It earns less than the pick; holding is not the goal, netting is.` : 'no width has held through every tested day yet'}</dd>
<dt>Record</dt><dd>${h(v.windows)} windows, ${h(when(v.from))} to ${h(when(v.to))}, blocks ${h(v.from_block)} to ${h(v.to_block)}${v.overlapping_runs_not_counted ? `; ${h(v.overlapping_runs_not_counted)} overlapping run${v.overlapping_runs_not_counted === 1 ? '' : 's'} counted once` : ''}${v.thin ? ' — thin: too few windows to lean on yet' : ''}</dd>
</dl></div>
<h2>Every width, replayed</h2>
<div class="card"><div class="wrap"><table>
<tr><th>Width</th><th>Net per day</th><th>Fees earned</th><th>Re-sets</th><th>Hours in range</th><th>Windows held</th><th>Days held</th></tr>
${rows.map((r) => { const e = r.earnings; const money = (x, d) => (x == null ? '—' : '$' + f(x, d)); return `<tr${pick && r.width === pick.width ? ' class="pick"' : ''}><td>${isFinite(Number(r.width)) ? `±${h(r.width)}%` : 'full range (V2-like)'}</td><td>${h(money(e && e.net_usd_per_day, 3))}</td><td>${h(money(e && e.fees_usd, 3))}</td><td>${h(e ? e.resets : 'never')}</td><td>${e ? `${h(f(e.hours_in_range, 0))} of ${h(f(e.hours, 0))}` : 'always'}</td><td>${h(r.held)} of ${h(r.of)}</td><td>${r.day ? `${h(r.day.held)} of ${h(r.day.tested)}` : 'all'}</td></tr>`; }).join('')}
</table></div>
<p class="note">Net per day is fees earned inside the range minus the re-sets paid, on $${h(usd)}, over the recorded prices. A narrow width earns more per hour inside the range and leaves it more often; a wide one rarely leaves and earns little. The pick is where those two meet on this pool's recent prices, and it moves as the prices do.</p>
<p class="note">${h(String(v.earnings_rule || '').replace(/^[a-z]/, (ch) => ch.toUpperCase()))}</p></div>
${log.last_error ? (() => { const since = (Array.isArray(log.windows) ? log.windows : []).filter((w) => w && w.at && Date.parse(w.at) > Date.parse(log.last_error.at)).length; return `<p class="note">Last hour that could not be measured: ${h(when(log.last_error.at))} (${h(log.last_error.error)}). ${since ? `${h(since)} window${since === 1 ? '' : 's'} recorded since; it is skipped, not guessed.` : 'Skipped, not guessed.'}</p>`; })() : ''}
<p class="note">Same facts as JSON: <a href="/lp/windows?format=json">/lp/windows?format=json</a> · the agent's record: <a href="/lp/agent">/lp/agent</a> · which pool: <a href="/lp/pools">the pool record</a> · <a href="https://brainonbnb.com/liquidity">how it works</a></p>
${pageTail}`;
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
      }
      return json({ ...log, verdict: v, cadence: 'hourly',
        note: 'Every entry is one replay of pancakeswap_range_plan over ~37 minutes of live chain, recorded by the cron whether anybody is watching or not. Overlapping entries are counted once in the verdict. Nothing here is a forecast.' });
    }

    // Our own ERC-8183 jobs and the date each one was first seen to complete.
    // The figure this marketplace argues with is 287 SUBMITTED against 8
    // COMPLETED; this is where our own jobs stand against it, checked daily.
    // What the LP agent's daily tick did — sweep, collect, rebalance,
    // increase (worker-lp writes it, this serves it; that worker holds the
    // keys and no public face on purpose). /lp/collect is the old name.
    if (path === '/lp/agent' || path === '/lp/collect') {
      const raw = await env.AGENT.get('lp:agent');
      if (!raw) return json({ error: 'the LP agent has not run yet', cadence: 'daily' }, 503);
      const rec = JSON.parse(raw);
      // Where the money came from and where it went: computed once, here,
      // from the record and the service's own earnings — the page below, the
      // liquidity page and the Telegram report all read this one figure set.
      const earned = await readEarnings(env).catch(() => null);
      const flow = moneyFlow(rec, { earned });
      const wantsHtml = /text\/html/.test(request.headers.get('accept') || '') && url.searchParams.get('format') !== 'json';
      if (!wantsHtml) return json({ ...rec, flow, cadence: 'daily' });
      // THE RECORD, READABLE. The homepage, /agents and the Telegram alert all
      // say "the daily record is here" and pointed a person at raw JSON. The
      // same facts as a page: what the agent holds, what it decided on its
      // last run and why (the record's own sentences, written for exactly
      // this), and every day it actually moved money. Nothing is computed
      // here that the record does not carry; the one addition is a dollar
      // figure for the BNB, from the same reference pair every page uses.
      const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const f = (v, d = 4) => (v == null || !isFinite(Number(v)) ? '—' : Number(v).toFixed(d));
      const when = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) + ' UTC' : '—');
      const price = await bnbUsd().catch(() => 0);
      const usd = (bnb) => (price > 0 && bnb != null && isFinite(Number(bnb)) ? ` (≈ $${(Number(bnb) * price).toFixed(2)})` : '');
      // The newest run on record: the daily one, or an hourly re-set after it
      // (those land in history) — the rule the liquidity page, the series and
      // the Telegram alert use. Reading `last` alone said "quiet day, last run
      // 2026-09-06 05:23" the morning after two automatic re-sets, with the
      // collect step still saying "this wallet holds no position". The sweep,
      // collect and increase steps come from the daily run: an hourly re-set
      // has only the rebalance step.
      const daily = rec.last || {}, dst = daily.steps || {};
      const histAll = Array.isArray(rec.history) ? rec.history.filter((e) => e && !e.dry) : [];
      const newest = histAll.length ? histAll[histAll.length - 1] : null;
      const last = newest && daily.at && Date.parse(newest.at) > Date.parse(daily.at) ? newest : daily;
      const st = last.steps || {};
      const rb = st.rebalance || {};
      const c = st.collect || dst.collect || {}, inc = st.increase || dst.increase || {};
      const sweeps = Array.isArray(st.sweep) ? st.sweep : (Array.isArray(dst.sweep) ? dst.sweep : []);
      // When a step is the daily run's and the newest run is a later re-set,
      // the step's figures are dated by the daily run.
      const fromDaily = last !== daily && !st.collect;
      const dailyWhen = when(daily.at);
      // The record's reasons are the agent's own words for its operator; one
      // of them names a script ("open one first with lp-open.mjs") — not for
      // a visitor.
      const plain = (t) => String(t || '').replace(/\s*[\u2014-]\s*open one first with lp-open\.mjs/i, '');
      const reset = rb.acted && !rb.error && rb.new_position;
      const pos = reset ? rb.new_position : (c.position || rb.position || null);
      const inRange = reset ? true : (c.in_range != null ? c.in_range : rb.in_range);
      // The record is the run's view; the chain's is the present. Read live,
      // so "in range and earning" is never nine hours old — it was, on
      // 2026-09-03, for the whole morning after the price had left the range.
      let live = null;
      if (pos) {
        try {
          const NPM = '0x46a15b0b27311cedf172ab29e4f4766fbe7f4364', FACTORY = '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865';
          const s24 = (x) => { let n = BigInt('0x' + x); if (n >= (1n << 255n)) n -= (1n << 256n); return Number(n); };
          const pr = await rpc('eth_call', [{ to: NPM, data: '0x99fbab88' + BigInt(pos).toString(16).padStart(64, '0') }, 'latest']);
          const w = (i) => pr.slice(2 + 64 * i, 2 + 64 * (i + 1));
          const poolAddr = '0x' + (await rpc('eth_call', [{ to: FACTORY, data: '0x1698ee82' + w(2) + w(3) + w(4) }, 'latest'])).slice(26);
          const slot = await rpc('eth_call', [{ to: poolAddr, data: '0x3850c7bd' }, 'latest']);
          const tick = s24(slot.slice(66, 130)), lo = s24(w(5)), hi = s24(w(6));
          live = { tick, lo, hi, inRange: tick >= lo && tick < hi };
        } catch { live = null; }
      }
      // The collect step's "fees owed" is about the position that step read.
      // When that is not the one open now (none, after the stopped re-set of
      // 2026-09-05; the new one minted by hand the next morning), the fees
      // owed are read from the chain, the same reading /lp/look gives.
      let liveOwed = null;
      if (pos && String(c.position || '') !== String(pos)) {
        try {
          const lk = await lpPositionLook({ position: String(pos) });
          if (lk && lk.fees_owed && lk.fees_owed.bnb_equivalent != null) liveOwed = Number(lk.fees_owed.bnb_equivalent);
        } catch { liveOwed = null; }
      }
      if (liveOwed != null) flow.waiting.fees_owed_bnb = liveOwed;
      // Dry runs are the operator checking a deploy; they sign nothing and
      // moved nothing, and the first one (2026-09-02, before the income keys
      // were set) stood under "Runs that failed" for two days.
      const hist = (Array.isArray(rec.history) ? rec.history : []).filter((e) => e && !e.dry);
      const fl = flowLines(flow);
      const stepRows = [
        ...sweeps.map((s) => ({ name: `Sweep — ${s.source || 'income'} wallet`, acted: !!s.acted, err: s.error, why: s.why, detail: (s.balance != null ? `${f(s.balance, 4)} ${s.token || ''} waiting${s.bnb_equivalent != null ? `, worth ${f(s.bnb_equivalent, 6)} BNB` : ''}` : '') + (fromDaily ? `${s.balance != null ? '; ' : ''}from the daily run at ${dailyWhen}` : '') })),
        { name: 'Collect — the position\'s fees', acted: !!c.acted, err: c.error, why: plain(c.why), detail: (c.owed ? `owed at that run: ${f(c.owed.bnb_equivalent, 6)} BNB${usd(c.owed.bnb_equivalent)}` : '') + (fromDaily ? `${c.owed ? '; ' : ''}from the daily run at ${dailyWhen}` : '') },
        { name: 'Rebalance — the price range', acted: !!rb.acted, err: rb.error, why: rb.why, detail: (rb.ticks ? `ticks ${rb.ticks.join(' … ')}, price at tick ${rb.tick ?? '—'}` : '') + (rb.width_pct != null ? `; the next re-set would use ±${rb.width_pct}%${rb.expected_net_usd_per_day != null ? ` (about $${rb.expected_net_usd_per_day} a day on $50 over the recorded prices)` : ''}` : '') + (rb.outside_since ? `, outside since ${String(rb.outside_since).replace('T', ' ').slice(0, 16)} UTC` : '') + (last.range_checked_at ? `, range checked ${String(last.range_checked_at).replace('T', ' ').slice(0, 16)} UTC` : '') },
        { name: 'Increase — grow the position', acted: !!inc.acted, err: inc.error, why: plain(inc.why), detail: (inc.wallet_bnb != null ? `${f(inc.wallet_bnb, 5)} BNB in the wallet, ${f(inc.spendable_bnb, 5)} above the reserve` : '') + (fromDaily ? `${inc.wallet_bnb != null ? '; ' : ''}from the daily run at ${dailyWhen}` : '') },
      ].filter((r) => r.why || r.err || r.detail);
      const histRows = hist.slice().reverse().slice(0, 60).map((e) => {
        const s = e.steps || {}; const parts = [];
        for (const x of Array.isArray(s.sweep) ? s.sweep : []) if (x.acted && !x.error) parts.push(`swept ${f(x.sold, 2)} ${x.token || ''} → ${f(x.received_bnb, 5)} BNB into the liquidity wallet`);
        if (s.collect?.acted && !s.collect.error && (Number(s.collect.forwarded_bnb) > 0 || Number(s.collect.kept_bnb) > 0)) parts.push(`collected fees → ${f(s.collect.forwarded_bnb, 5)} BNB to the buyback bot${Number(s.collect.kept_bnb) > 0 ? `, ${f(s.collect.kept_bnb, 5)} BNB kept as capital` : ''}`);
        if (s.rebalance?.acted && !s.rebalance.error) parts.push(`range re-set${s.rebalance.width_pct ? ` ±${s.rebalance.width_pct}%` : ''}${s.rebalance.new_position ? `, position #${s.rebalance.new_position}` : ''}`);
        if (s.increase?.acted && !s.increase.error) parts.push(`added ${f(s.increase.wbnb_used, 5)} BNB to the position`);
        const errs = [...(Array.isArray(s.sweep) ? s.sweep : []), s.collect, s.rebalance, s.increase].filter((x) => x && x.error).map((x) => x.error);
        if (e.error) errs.push(e.error);
        return { at: e.at, parts, errs, ok: e.ok !== false };
      });
      const html = `${pageHead('The liquidity agent — its record', `
main{max-width:760px}
p.lead{color:#cfc9bd;margin:6px 0 0}dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0;font-size:.9rem}dt{color:#a9a49a}dd{margin:0;overflow-wrap:anywhere}
.card{border:1px solid rgba(240,185,11,.22);border-radius:14px;padding:14px 16px;background:rgba(240,185,11,.04);margin-bottom:10px}
.flow{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:560px){.flow{grid-template-columns:1fr}}.flow div{border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px 12px}.flow b{display:block;color:#f0b90b;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}.flow span{display:block;font-size:.9rem;color:#f3efe6}.flow i{display:block;font-style:normal;color:#a9a49a;font-size:.8rem;margin-top:4px}
.st{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.74rem;font-weight:700;margin-left:8px;vertical-align:middle}
.ok{background:rgba(63,224,154,.15);color:#3fe09a}.quiet{background:rgba(255,255,255,.08);color:#a9a49a}.bad{background:rgba(255,143,107,.15);color:#ff8f6b}
.step b{display:block}.step span{display:block;color:#cfc9bd;font-size:.88rem}.step i{display:block;color:#a9a49a;font-size:.8rem;font-style:normal;margin-top:2px}
.note{color:#a9a49a;font-size:.82rem;margin-top:10px}ul.hist{list-style:none;padding:0;margin:0}ul.hist li{padding:8px 0;border-top:1px solid rgba(255,255,255,.08);font-size:.9rem}ul.hist li:first-child{border-top:0}ul.hist time{color:#a9a49a;font-size:.8rem;display:block}
`)}${pageNav({ href: SITE + '/liquidity', label: 'Liquidity' }, { href: '/lp/agent', label: 'The liquidity agent — its record' }, BUY)}<h1>The liquidity agent <span class="st ${last.ok === false ? 'bad' : last.acted ? 'ok' : 'quiet'}">${last.ok === false ? 'one step failed' : reset ? 're-set the range' : last.acted ? 'acted' : 'quiet day'}</span></h1>
<p class="lead">Once a day, on its own: what the AI side earned is sold for BNB and put into the project's own liquidity position; of the fees that position earns, ${flow.rule ? `${h(flow.rule.fee_share_buyback_pct)}% go to the buyback bot, which buys $BOBAI and burns it, and ${h(flow.rule.fee_share_kept_pct)}% stay as capital so the position grows out of its own earnings` : 'part goes to the buyback bot, which buys $BOBAI and burns it, and part stays as capital'}. Every step is a transaction on BNB Chain. Last run ${h(when(last.at))}${last !== daily ? ` (an hourly check that ${reset ? 're-set the range' : 'acted'}; the daily run before it, ${h(dailyWhen)}, ${daily.acted ? 'acted' : 'had nothing to do'})` : ''}.</p>
<h2>What it holds</h2>
<div class="card"><dl>
<dt>Position</dt><dd>${pos ? `PancakeSwap V3 <a href="https://pancakeswap.finance/liquidity/${h(pos)}?chain=bsc" target="_blank" rel="noopener">#${h(pos)}</a>, ${live ? (live.inRange ? 'in range and earning' : `out of range right now (tick ${live.tick}, range ${live.lo} to ${live.hi}) — earning nothing until an hourly check re-sets it, two hours after the price left`) : (inRange === false ? 'out of range at the last run' : 'in range at the last run')}${live && live.inRange !== inRange ? ` — the run at ${h(when(last.at))} saw it ${inRange === false ? 'out of' : 'in'} range` : ''}${rb.value_bnb != null ? `, worth ${f(rb.value_bnb, 4)} BNB${usd(rb.value_bnb)}` : ''}` : 'none open'}</dd>
<dt>Fees owed now</dt><dd>${liveOwed != null ? `${f(liveOwed, 6)} BNB${usd(liveOwed)} — read from the chain just now; ${reset ? `the re-set at ${h(when(last.at))} folded the old range's fees into the new capital, so the new position started at zero` : `the run at ${h(fromDaily ? dailyWhen : when(last.at))} ${c.position ? `read position #${h(c.position)}` : 'saw no position'}`}. Left to grow until collecting beats the gas` : c.owed ? `${f(c.owed.bnb_equivalent, 6)} BNB${usd(c.owed.bnb_equivalent)} — left to grow until collecting beats the gas` : '—'}</dd>
<dt>Income waiting</dt><dd>${sweeps.filter((s) => s.balance > 0).map((s) => `${f(s.balance, 2)} ${h(s.token || s.source)}`).join(' + ') || 'nothing'} — moves once it is worth more than the gas</dd>
<dt>Wallet</dt><dd><a href="https://bscscan.com/address/${h(rec.last?.wallet || '')}" target="_blank" rel="noopener"><code>${h(rec.last?.wallet || '—')}</code></a>${inc.wallet_bnb != null ? `, ${f(inc.wallet_bnb, 5)} BNB` : ''}</dd>
</dl></div>
<h2>Where the money came from, where it went</h2>
<div class="card"><div class="flow">
<div><b>Came in</b><span>${h(fl.came_in)}</span>${flow.paid_for && flow.paid_for.x402_answers ? `<i>The x402 service has been paid ${h(f(flow.paid_for.usd1, 2))} USD1 for ${h(flow.paid_for.x402_answers)} answer${flow.paid_for.x402_answers === 1 ? '' : 's'} since it opened. What of it has reached the income wallet is under Waiting and is swept once it is worth more than the gas; the rest went through the earlier path, which burned it directly.</i>` : ''}</div>
<div><b>Went out</b><span>${h(fl.went_out)}${flow.out.buyback_bnb > 0 && usd(flow.out.buyback_bnb) ? ` — the buyback share${usd(flow.out.buyback_bnb)}` : ''}</span><i>${flow.out.resets} re-set${flow.out.resets === 1 ? '' : 's'} of the range · ${h(fl.cost)}${usd(flow.gas.bnb)}</i></div>
<div><b>Waiting</b><span>${flow.waiting.income.length ? flow.waiting.income.map((w) => `${f(w.amount, 2)} ${h(w.token)} on the ${h(w.source || 'income')} wallet`).join(', ') : 'no income on the wallets'}; ${f(flow.waiting.fees_owed_bnb, 6)} BNB of fees owed by the position${flow.waiting.wallet_spendable_bnb != null ? `; ${f(flow.waiting.wallet_spendable_bnb, 5)} BNB in the liquidity wallet above the reserve` : ''}</span><i>Each moves once it is worth more than the gas it costs.</i></div>
<div><b>The rule</b><span>${flow.rule ? `${h(flow.rule.fee_share_kept_pct)}% of every collect stays as capital, ${h(flow.rule.fee_share_buyback_pct)}% goes to the buyback wallet.` : 'The share of the fees kept as capital is named with the next collect.'} Income goes in as capital in full. The capital never leaves.</span><i>Set in the open: LP_FEE_KEEP_PCT in worker-lp/wrangler.toml, in <a href="https://brainonbnb.com/source">the published source</a>.</i></div>
</div></div>
<h2>The last run, step by step</h2>${fromDaily ? `<p class="note" style="margin:0 0 8px">The newest run, ${h(when(last.at))}, was an hourly range check; it has the rebalance step only. The other steps run once a day and are shown from ${h(dailyWhen)}.</p>` : ''}
<div class="card">${stepRows.map((r) => `<div class="step" style="margin:0 0 10px"><b>${h(r.name)}<span class="st ${r.err ? 'bad' : r.acted ? 'ok' : 'quiet'}">${r.err ? 'failed' : r.acted ? 'acted' : 'nothing to do'}</span></b><span>${h(r.err || r.why || '')}</span>${r.detail ? `<i>${h(r.detail)}</i>` : ''}</div>`).join('')}
<p class="note">Each step has a floor under which moving the money would cost more than the money. A day under a floor is a decision, recorded as one, not an error.</p></div>
<h2>Days it moved money</h2>
<div class="card">${histRows.filter((r) => r.parts.length).length ? `<ul class="hist">${histRows.filter((r) => r.parts.length).map((r) => `<li><time>${h(when(r.at))}</time>${r.parts.length ? r.parts.map(h).join(' · ') : (r.errs.length ? '' : 'recorded')}${r.errs.length ? `<span class="st bad">error</span> ${h(r.errs.join(' · '))}` : ''}</li>`).join('')}</ul>` : '<p class="note">None yet. The position was opened by hand; the agent has had only quiet days since.</p>'}
${histRows.some((r) => !r.parts.length && r.errs.length) ? `<h2>Runs that failed</h2><div class="card"><ul class="hist">${histRows.filter((r) => !r.parts.length && r.errs.length).map((r) => `<li><time>${h(when(r.at))}</time><span class="st bad">error</span> ${h(r.errs.join(' · '))}</li>`).join('')}</ul><p class="note">A failed run moved nothing; it is listed so the record cannot hide it.</p></div>` : ''}
<p class="note">Quiet days are not listed; the last one is always above. Same facts as JSON: <a href="/lp/agent?format=json">/lp/agent?format=json</a> · width record: <a href="/lp/windows">/lp/windows</a> · <a href="https://brainonbnb.com/liquidity">Back to the liquidity page</a></p></div>
${pageTail}`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
    }

    if (path === '/jobs/own') {
      const rec = await readOwnJobs(env);
      if (!rec) return json({ error: 'no own-jobs tick has run yet', cadence: 'daily' }, 503);
      return json({ ...rec, cadence: 'daily',
        note: 'Every job this project has made or delivered on the ERC-8183 kernel, classified with the same rule as scripts/erc8183-job-watch.mjs. The escrow does not release itself: after the dispute window somebody has to call settle(jobId) on the EvaluatorRouter. history holds one entry per observed transition.' });
    }

    if (path === '/census') {
      const latest = await env.AGENT.get('census:latest');
      if (!latest) return json({ error: 'no census tick has run yet' }, 503);
      return json(JSON.parse(latest));
    }

    // Live state of our own two agents, in the shape the rest of this chain
    // uses it: the four reference agents serve /status, so ours does too, at
    // the same path and with the same content type. An agent that asks the
    // market to be machine-readable and is not is a poster.
    //
    // Served from the snapshot the cron writes, not computed per request. The
    // grid probe measures a live pool and the health probe reads the
    // Comptroller; doing that on every hit would let anybody with a loop spend
    // our RPC budget and other people's.
    // What this agent is allowed to SPEND, as opposed to what it can do. Read
    // from the Altana KeyStore on-chain rather than from our own config, so the
    // answer is one a stranger can reproduce with two view calls. See
    // session.js for why revocation is deliberately not reachable from here.
    if (path === '/session') {
      const out = annotateRoles(await handleSession(url, env), env);
      // The revocations fired from the product, beside the live state, so the
      // page can show the control and its record together.
      out.revocations = await readRevocations(env);
      out.revoke = { how: 'POST /session/revoke with the operator token — see GET /session/revoke', public: false };
      return json(out);
    }
    // Revocation from the product: two locks (admin key as a worker secret,
    // operator token on the request), see session-revoke.js.
    if (path === '/session/revoke') {
      return handleSessionRevoke(request, env);
    }

    if (path === '/status') {
      const t = await readTelemetry(env);
      if (!t) return json({ error: 'no telemetry tick has run yet' }, 503);
      const want = url.searchParams.get('agent') || url.searchParams.get('id');
      if (want) {
        const one = t.ours.find((a) => String(a.id) === want || a.category === want);
        if (!one) return json({ error: `no agent "${want}" here`, agents: t.ours.map((a) => ({ id: a.id, category: a.category })) }, 404);
        return json({ ...one, checked_at: one.checked_at || t.checked_at, method: t.method });
      }
      return json({
        origin: 'https://agent.brainonbnb.com',
        agents: t.ours,
        checked_at: t.checked_at,
        cadence: t.cadence,
        method: t.method,
        note: 'Two agents share this origin, so this answers with both. Ask for one with ?agent=302257 or ?agent=grid-trading.',
      });
    }

    // Everything the telemetry tick collected, ours and the reference set's,
    // for the category pages on brainonbnb.com/registry.
    if (path === '/telemetry.json') {
      const t = await readTelemetry(env);
      if (!t) return json({ error: 'no telemetry tick has run yet' }, 503);
      return json(t);
    }

    if (path === '/run-telemetry' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      return json(await refreshTelemetry(env));
    }

    if (path === '/stats') {
      const [counters, earnings, watches] = await Promise.all([
        readCounters(env),
        readEarnings(env),
        env.AGENT.list({ prefix: 'watch:' }),
      ]);
      // "Requests answered" must mean requests somebody made. Our own cron
      // sweeps are counted too — they are worth knowing — but folding them into
      // the public total would inflate it with our own activity, which is the
      // exact dishonesty this block exists to avoid.
      const INTERNAL = new Set(['watch_checks']);
      const external = Object.fromEntries(
        Object.entries(counters.byKind).filter(([k]) => !INTERNAL.has(k)),
      );
      return json({
        asked: {
          total: Object.values(external).reduce((a, b) => a + b, 0),
          by_kind: external,
          by_day: counters.byDay,
          internal: Object.fromEntries(
            Object.entries(counters.byKind).filter(([k]) => INTERNAL.has(k)),
          ),
          note: 'total counts requests made by others. Our own scheduled sweeps are listed separately under internal.',
        },
        earned: earnings,
        active_watches: watches.keys.length,
        money_flow: {
          '1': 'an agent pays USD1 for a watch, or $U for a job delivered on the ERC-8183 kernel',
          '2': `it lands at ${payTo || '(not configured)'} (USD1) or 0x73809F69916FcF7Ddc5BB1315fBdf96A569a5963 ($U) — wallets used for nothing else`,
          '3': 'once a day it is sold for BNB and sent to the liquidity wallet 0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A, which holds the project\'s PancakeSwap V3 position and grows it with what arrives; the capital never leaves',
          '4': 'the fees that position earns are collected daily and sold for BNB; half stays as capital so the position grows out of its own earnings (LP_FEE_KEEP_PCT on worker-lp, since 2026-09-04), the other half is sent to the buyback wallet 0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce, which buys and burns $BOBAI as it always has — one burn path, one log',
          '5': 'every step is a public transaction, verifiable on BscScan; the daily record is at /lp/agent',
          floors: 'nothing is sold below 0.004 BNB of value, no fees are collected below 0.002 BNB and nothing is added to the position below 0.005 BNB — under a floor, gas would eat the amount, and a day under one is recorded as a decision, not an error',
          before: 'until 2026-09-02 the earnings were burned directly from the service wallet, by hand. The first: 0.50 USD1 -> 6,043.28 $BOBAI, burned 2026-08-22: https://bscscan.com/tx/0x0da33c6339fd88de8fa443f7d41d0e0749fbac14e678c976fd3dc0f6ea39b27e',
          note: 'Automated since 2026-09-02 by the LP agent (worker-lp): sweep, collect, increase, and a re-set of the range once the record holds a day of prices. The burn log at logs.brainonbnb.com lists the buyback bot\'s own runs, and the LP fees reach it through that bot, so nothing here needs a second log.',
        },
        capabilities: offering(),
        generated_at: new Date().toISOString(),
      });
    }

    // Called by the dashboard worker so that MCP and REST traffic lands in the
    // same counters as everything else. Shared-secret rather than open, or the
    // public numbers would be whatever a stranger felt like posting.
    if (path === '/hit' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      const body = await request.json().catch(() => ({}));
      const kind = String(body.kind || '').replace(/[^a-z0-9_]/gi, '').slice(0, 32);
      if (!kind) return json({ error: 'kind required' }, 400);
      ctx.waitUntil(bump(env, kind));
      return json({ ok: true });
    }

    // MCP, carrying exactly one tool: the paid watch.
    //
    // WHY THIS EXISTS SEPARATELY FROM brainonbnb.com/mcp
    // That server has seventeen tools and every one of them is free. This one
    // has one tool and it costs money. Keeping them apart means an agent that
    // wants the free surface never has to reason about payment, and the paid
    // tool does not have to be smuggled into a server advertised as free.
    //
    // WHY AN MCP TOOL AT ALL, WHEN /watch ALREADY SELLS IT
    // Measured 2026-08-23: all 976 entries in Binance's B402 Bazaar are type
    // "http". Not one is "mcp", though the format has supported it all along.
    // An agent that speaks MCP and wants to buy something has, today, nothing
    // in that catalog it can call natively. The tool below is the same product
    // through the door those agents already have open.
    if (path === '/mcp') {
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
      };
      const rpcOk = (id, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: cors });
      const rpcErr = (id, code, message) => new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), { headers: cors });

      if (request.method === 'GET') {
        return new Response(JSON.stringify({
          name: 'Brain On BNB AI — paid pool watch',
          protocol: '2025-06-18',
          tools: ['bsc_pool_watch'],
          note: 'One tool, and it is paid. The free tools live at https://brainonbnb.com/mcp.',
        }), { headers: cors });
      }

      let body;
      try { body = await request.json(); } catch { return rpcErr(null, -32700, 'Parse error'); }
      const { id, method, params } = body || {};
      if (method && method.startsWith('notifications/')) return new Response(null, { status: 202, headers: cors });

      if (method === 'initialize') {
        return rpcOk(id, {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'Brain On BNB AI — paid pool watch', version: '1.0.0' },
        });
      }
      if (method === 'ping') return rpcOk(id, {});
      if (method === 'tools/list') {
        ctx.waitUntil(bump(env, 'mcp'));
        return rpcOk(id, { tools: [WATCH_TOOL] });
      }
      if (method === 'tools/call') {
        ctx.waitUntil(bump(env, 'mcp'));
        if (params?.name !== 'bsc_pool_watch') return rpcErr(id ?? null, -32602, 'Unknown tool: ' + params?.name);
        if (!payTo) return rpcErr(id ?? null, -32000, 'service not configured to receive payments yet');
        const a = params?.arguments || {};
        if (!/^0x[a-fA-F0-9]{40}$/.test(a.token || '') || !/^0x[a-fA-F0-9]{40}$/.test(a.pair || '')) {
          return rpcOk(id, {
            isError: true,
            content: [{ type: 'text', text: 'token and pair must both be BSC addresses (0x + 40 hex).' }],
          });
        }
        const { payment, ...spec } = a;
        const out = await purchaseWatch(env, ctx, payTo, spec, payment || null);
        // A 402 here is not a failure — it is the price list, which is what a
        // first call is for. Reporting it as an error would make every client
        // that checks isError abandon the purchase before it began.
        // The HTTP wording tells the caller to resend with a header. Over MCP
        // there is no header to set — the same proof goes in the `payment`
        // argument — and instructions a caller cannot follow are worse than
        // none, so the sentence is rewritten for the door it came through.
        const forMcp = (b) => ({
          ...b,
          how: `Send ${fmtUsd1(WATCH_PRICE_USD1)} USD1 to ${payTo} on BNB Smart Chain, then call this tool again with the same arguments plus payment: "<transaction hash>".`,
        });
        const answer = out.status === 402 && !payment
          ? { payment_required: true, ...forMcp(out.body) }
          : out.status === 402
            ? { payment_rejected: true, ...out.body }
            : out.body;
        return rpcOk(id, {
          content: [{ type: 'text', text: JSON.stringify(answer, null, 2) }],
          structuredContent: answer,
          ...(out.status === 402 && payment ? { isError: true } : {}),
        });
      }
      return rpcErr(id ?? null, -32601, 'Method not found: ' + method);
    }

    // Reading back one watch. The tool description has always told a buyer
    // without a callback to "poll /watch/<id>" — and this route did not exist,
    // so that buyer had no way to reach the thing they paid for. The id is a
    // v4 UUID handed only to the payer, which is what makes it readable
    // without a second credential.
    if (path.startsWith('/watch/') && request.method === 'GET') {
      const id = path.slice(7);
      const raw = id && (await env.AGENT.get(`watch:${id}`));
      // Expired and never-existed are the same answer on purpose: a watch is
      // deleted the first sweep after it expires, so the service cannot tell
      // them apart and should not pretend to.
      if (!raw) return json({ error: 'no watch with that id — it may have expired', watch: id }, 404);
      const w = JSON.parse(raw);
      return json({
        watch: w.id,
        watching: { token: w.token, pair: w.pair, quote: w.quote, depthBelowUsd: w.depthBelowUsd },
        callback: w.callback,
        lastDepthUsd: w.lastDepthUsd,
        lastCheckedAt: w.lastCheckedAt ? new Date(w.lastCheckedAt).toISOString() : null,
        // Never checked yet reads as "broken" unless we say why: the sweep runs
        // on a cron, so a watch bought a minute ago legitimately has no reading.
        note: w.lastCheckedAt ? undefined : 'not swept yet — the depth check runs on a schedule, first reading follows shortly',
        triggered: w.triggered.map((t) => ({ at: new Date(t.at).toISOString(), depthUsd: t.depthUsd })),
        created: new Date(w.createdAt).toISOString(),
        expires: new Date(w.expiresAt).toISOString(),
        paidTx: w.paidTx,
      });
    }

    // A GET on the resource itself. x402 says the terms live in the 402 that a
    // POST returns, but a crawler, an agent following llms.txt, or a person
    // pasting the URL all send GET — and answering "not found" tells every one
    // of them the service does not exist. It does; this says so, and quotes the
    // price from the same builder the 402 uses so the two cannot drift apart.
    // The five deliveries, per answer over x402. GET describes; POST without
    // payment answers 402 with the terms; POST with PAYMENT-SIGNATURE delivers.
    if (path === '/answer') {
      if (!payTo) return json({ error: 'service not configured to receive payments yet' }, 503);
      const id = url.searchParams.get('service') || '';
      if (request.method === 'GET') {
        if (!id) return json({
          what: 'Any of the six answers this project sells, one payment each, delivered at once — no escrow, no job, no dispute window.',
          price: `${fmtUsd1(ANSWER_PRICE)} USD1 per answer, by direct transfer or through the x402 facilitator — or the same price in $BOBAI, quoted on each 402`,
          services: Object.values(SERVICES).map((s) => ({ id: s.id, name: s.name, needs: s.needs, terms: `POST https://agent.brainonbnb.com/answer?service=${s.id}`, example: `https://agent.brainonbnb.com/example?service=${s.id}` })),
          how: 'POST /answer?service=<id> once without payment: the 402 names the price and the wallet. Pay, then POST again with PAYMENT-SIGNATURE and a body naming the task.',
          or_escrow: 'The same answers through the ERC-8183 escrow: https://brainonbnb.com/registry',
          catalogue: 'https://agent.brainonbnb.com/.well-known/x402',
        });
        const out = await sellAnswer(env, ctx, payTo, id, {}, null);
        return json(out.body, out.status, out.headers || {});
      }
      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const proof = request.headers.get('PAYMENT-SIGNATURE');
        const out = await sellAnswer(env, ctx, payTo, id, body || {}, proof);
        return json(out.body, out.status, out.headers || {});
      }
    }

    if (path === '/watch' && request.method === 'GET') {
      if (!payTo) return json({ error: 'service not configured to receive payments yet' }, 503);
      const terms = await purchaseWatch(env, ctx, payTo, {}, null);
      return json({
        service: 'pool watch',
        what: `Continuous depth monitoring of one BSC pool for ${WATCH_DAYS} days, with a callback when depth falls below a threshold you set.`,
        // Both schemes in accepts[] are quoted, because only one of them is
        // USD1: a client that takes the facilitator route pays the same amount
        // in USDC, and a price line naming one asset hides the other.
        price: `${fmtUsd1(WATCH_PRICE_USD1)} USD1 by direct transfer, or the same amount in USDC through the x402 facilitator — either lands in the same wallet`,
        buy: 'POST this same URL with {"token":"0x…","pair":"0x…","depthBelowUsd":1000,"callback":"https://…"}',
        how: terms.body.how,
        accepts: terms.body.accepts,
        read_back: 'GET /watch/<id> — returned to you when the purchase settles',
        free_alternative: 'https://brainonbnb.com/api/pool-scan?address=0x… — one reading, no payment, no watching',
        catalogue: 'https://agent.brainonbnb.com/.well-known/x402',
      });
    }

    if (path === '/watch' && request.method === 'POST') {
      if (!payTo) return json({ error: 'service not configured to receive payments yet' }, 503);
      const spec = await request.json().catch(() => null);
      const proof = request.headers.get('PAYMENT-SIGNATURE');
      const specOk = spec
        && /^0x[a-fA-F0-9]{40}$/.test(spec.token || '')
        && /^0x[a-fA-F0-9]{40}$/.test(spec.pair || '');

      // Price discovery must not require a valid body. An x402 client — or an
      // aggregator indexing the catalogue at /.well-known/x402 — probes the
      // resource to read its terms out of the 402, and it has no token or pair
      // to send yet. Answering 400 there makes a listed resource look broken
      // and hides the price behind a guess at the schema.
      //
      // Validation still runs before anything is bought: it is only skipped on
      // the unpaid call, which sells nothing and charges nothing.
      if (!proof) {
        const out = await purchaseWatch(env, ctx, payTo, spec || {}, null);
        return json(out.body, out.status, out.headers || {});
      }

      // A payment is on the table, so the spec has to be right before it is
      // spent. This ordering is deliberate — a caller who pays with a malformed
      // body gets told, not charged.
      if (!specOk) return json({ error: 'token and pair must both be BSC addresses' }, 400);

      const out = await purchaseWatch(env, ctx, payTo, spec, proof);
      return json(out.body, out.status, out.headers || {});
    }

    // Runs the watch sweep on demand. Exists because a cron that only fires
    // every fifteen minutes cannot be verified after a deploy without either
    // waiting for it or trusting that it works — and "the paid part is
    // presumably fine" is not a state this service should ever be shipped in.
    // Same shared secret as /hit; nothing here is reachable without it.
    // The liquidity series: every run of the liquidity agent as one point,
    // and what the points say so far. Read by /liquidity.
    if (path === '/lp/series') {
      const series = lpSeriesShown(await readLpSeries(env));
      const recRaw = await env.AGENT.get('lp:agent');
      const liveFlow = recRaw ? moneyFlow(JSON.parse(recRaw)) : null;
      const gas_bnb = liveFlow ? liveFlow.gas.bnb : null;
      const totals = liveFlow ? {
        forwarded_total_bnb: liveFlow.out.buyback_bnb,
        kept_total_bnb: liveFlow.out.kept_as_capital_bnb,
        fees_total_bnb: liveFlow.in.fees.bnb,
        folded_total_bnb: liveFlow.in.fees.folded_bnb || 0,
        into_position_total_bnb: liveFlow.out.into_position_bnb || 0,
        swept_total_bnb: liveFlow.in.income_bnb,
      } : null;
      // Fees owed now, from the chain: the last point is often a re-set, whose
      // own figure is zero by construction, while the liquidity page shows the
      // live figure two lines below the profit — the two must agree.
      let owed_now_bnb = null;
      const lastPt = series[series.length - 1];
      if (lastPt && lastPt.position) {
        try { const lk = await lpPositionLook({ position: String(lastPt.position) }); if (lk && lk.fees_owed && lk.fees_owed.bnb_equivalent != null) owed_now_bnb = Number(lk.fees_owed.bnb_equivalent); } catch { owed_now_bnb = null; }
      }
      return json({
        what_this_is: 'One point per run of the liquidity agent, taken from its own record: position value in BNB, in range or not, fees owed, fees already sent to the buyback bot and kept as capital, income already put in, and the profit so far netted against the gas on record. Not a counter; every figure is in the record it came from.',
        summary: lpSeriesSummary(series, { gas_bnb, owed_now_bnb, totals }),
        points: series,
        record: 'https://agent.brainonbnb.com/lp/agent',
        cadence: 'daily, after the 04:23 UTC run; the range itself is checked every hour, and an hourly check gets a point of its own only when it re-set the position or found one the series did not know. A run that found no position is not a point',
      }, 200, { 'Cache-Control': 'public, max-age=300' });
    }
    if (path === '/run-lp-series' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      return json({ ok: true, ...(await recordLpSeries(env)) });
    }

    if (path === '/run-checks' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      const result = await checkWatches(env);
      return json({ ok: true, ...result });
    }

    // Runs the census tick on demand. Same reason as /run-checks: a job that
    // fires once a day cannot be verified after a deploy without waiting a
    // day, and "it will presumably work tomorrow" is not a state to ship in.
    if (path === '/run-census' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      const r = await runCensusTick(env);
      return json({ ok: true, ...r });
    }

    // The hourly high-water probe on its own. Same reason as the two above:
    // an hour is long enough that "it presumably fires" would ship untested.
    if (path === '/run-frontier' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      const r = await runFrontierTick(env);
      return json({ ok: true, ...r });
    }

    // Same reason as /run-census: a job that fires once a day is untestable
    // after a deploy unless it can be triggered by hand.
    if (path === '/run-canary' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      const r = await runCanary(env);
      return json({ ok: true, ...r });
    }

    // The daily own-jobs tick on demand, optionally with ids to add to the
    // list. Same reason as the others: a daily job is untestable after a
    // deploy unless it can be triggered by hand.
    if (path === '/own-jobs' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      let ids = [];
      try { ids = (await request.json())?.ids || []; } catch { ids = []; }
      const r = await tickOwnJobs(env, rpc, Array.isArray(ids) ? ids : []);
      return json(r, r.ok ? 200 : 500);
    }

    // The hourly LP window on demand. Same reason as the four above.
    if (path === '/run-lp-window' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      // By hand there is no cron burst to wait out.
      const r = await recordLpWindow(env, { settle: false });
      return json(r, r.ok ? 200 : 500);
    }

    // Accepts the endpoint list produced by the offline publish step. Written
    // once per full scan, not per run — this is the input the rotating
    // reachability check walks through.
    if (path === '/census-endpoints' && request.method === 'POST') {
      if (request.headers.get('x-hit-secret') !== env.HIT_SECRET) return json({ error: 'no' }, 403);
      const body = await request.json().catch(() => null);
      if (!Array.isArray(body)) return json({ error: 'expected an array of {id,url}' }, 400);
      const clean = body
        .filter((x) => x && Number.isInteger(x.id) && typeof x.url === 'string' && /^https?:\/\//i.test(x.url))
        .slice(0, 20000)
        .map((x) => ({ id: x.id, url: x.url.slice(0, 300) }));
      await env.AGENT.put('census:endpoints', JSON.stringify(clean));

      // The offline scan's high-water mark seeds the growth check. Without it
      // the daily tick has no baseline to count new registrations from, and
      // reports highest_id: null forever — which is what it did on the first
      // run. Sent alongside the list because the two come from the same scan
      // and would otherwise drift apart.
      const seed = Number(new URL(request.url).searchParams.get('highestId'));
      let seeded = null;
      if (Number.isInteger(seed) && seed > 0) {
        const st = JSON.parse((await env.AGENT.get('census:state')) || '{}');
        st.highestId = seed;
        // A full scan IS a new baseline — it just read every id up to this one.
        // Carrying the old "new since baseline" forward would count the four
        // thousand agents the scan already includes as if they had arrived
        // since, and the page would state a growth figure that double-counts.
        // Zero here, and the frontier moved up to the same mark so tomorrow's
        // tick starts reading where the scan stopped instead of redoing it.
        // ...but never DOWN. The sync is meant to run the minute a scan ends;
        // run five days later (2026-09-03, to record the scan in the series)
        // it dragged a live counter of 332,143 back to the scan's 316,472 and
        // the page walked its own headline backwards until the next frontier
        // tick. The baseline moves to the scan; the high-water mark keeps
        // whatever the chain has shown since, and "new since" is the gap.
        const cur = Number(st.highestId) || 0;
        st.baselineId = seed;
        st.highestId = Math.max(cur, seed);
        st.newSinceBaseline = Math.max(0, st.highestId - seed);
        st.lastScannedNew = Math.max(Number(st.lastScannedNew) || 0, seed);
        await env.AGENT.put('census:state', JSON.stringify(st));

        // /census serves the snapshot, not the state — so seeding the state
        // alone left the public figure on the previous baseline until the next
        // daily tick, which is how /registry ended up overwriting its own
        // freshly published headline with a smaller number. The snapshot moves
        // with the seed; the rotating-check half is left as the last real run
        // wrote it, because a seed measures no endpoints.
        const snap = JSON.parse((await env.AGENT.get('census:latest')) || 'null');
        if (snap) {
          snap.highest_id = Math.max(Number(snap.highest_id) || 0, seed);
          snap.registered_since_baseline = Math.max(0, snap.highest_id - seed);
          snap.high_water_checked_at = new Date().toISOString();
          if (snap.frontier) {
            snap.frontier.read_up_to = Math.max(Number(snap.frontier.read_up_to) || 0, seed);
            snap.frontier.behind_by = Math.max(0, snap.highest_id - snap.frontier.read_up_to);
          }
          await env.AGENT.put('census:latest', JSON.stringify(snap));
        }
        seeded = seed;
      }
      return json({ ok: true, stored: clean.length, ...(seeded ? { baseline_highest_id: seeded } : {}) });
    }

    const one = path.match(/^\/watch\/([0-9a-f-]{36})$/i);
    if (one) {
      const raw = await env.AGENT.get(`watch:${one[1]}`);
      if (!raw) return json({ error: 'no such watch, or it has expired' }, 404);
      ctx.waitUntil(bump(env, 'watch_polled'));
      return json(JSON.parse(raw));
    }

    return json({ error: 'not found', see: 'https://agent.brainonbnb.com/' }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkWatches(env).catch(() => {}));
    // One point per liquidity-agent run; a tick that finds the same record
    // again records nothing.
    ctx.waitUntil(recordLpSeries(env).catch(() => {}));
    // The six example answers (/example?service=…) are what /services and
    // every 402 body point a stranger at. They lived in KV for 24 h and were
    // computed on demand after that: whoever came first waited 27 s for
    // yield_plan, and the LP-plan example kept describing a position burned
    // by the re-set of the morning. One example per tick, in turn, so each is
    // at most 90 minutes old and the link always lands on the cache.
    ctx.waitUntil((async () => {
      const ids = Object.keys(SERVICES);
      const id = ids[Math.floor(Date.now() / (15 * 60 * 1000)) % ids.length];
      await exampleFor(id, env, { fresh: true });
    })().catch(() => {}));

    // Live state, every tick. Six outbound calls — four peers, one Comptroller
    // read, one pool measurement — which is why it rides the fifteen-minute
    // cron rather than being computed when somebody loads the page. A snapshot
    // fifteen minutes old and labelled with its age is worth more than a fresh
    // one that costs a stranger's server a request per visitor.
    ctx.waitUntil(refreshTelemetry(env).catch(() => {}));

    // The cron fires every fifteen minutes for the watch checks. The two daily
    // jobs below hang off it, each pinned to ONE tick rather than to an hour:
    // matching on the hour alone ran the census four times every morning, which
    // is four times the KV writes on an account already close to the free-plan
    // ceiling, for a registry that does not change that fast.
    const t = new Date(event.scheduledTime);
    const firstTickOfHour = t.getUTCMinutes() < 15;

    // 03:0x UTC — read what is new in the registry, re-check a slice of the
    // known endpoints.
    if (t.getUTCHours() === 3 && firstTickOfHour) {
      ctx.waitUntil(runCensusTick(env).catch(() => {}));
    }

    // Every other hour, the cheap half on its own: how many ids exist now.
    // The registry mints thousands a day, so a high-water mark refreshed once
    // at 03:00 is stale by breakfast — and after an offline full scan it reads
    // BELOW the figure that scan published, which made the live counter on
    // /registry walk its own headline backwards. Skipped at 03:0x because the
    // full tick does the same probe as its first step.
    if (firstTickOfHour && t.getUTCHours() !== 3) {
      ctx.waitUntil(runFrontierTick(env).catch(() => {}));
    }

    // 15:0x UTC — ask a few real questions and write down how they went. Kept
    // twelve hours away from the census so the two never share an invocation's
    // outbound-call budget.
    if (t.getUTCHours() === 15 && firstTickOfHour) {
      ctx.waitUntil(runCanary(env).catch(() => {}));
    }

    // xx:3x every hour — one replay of the LP pool's last ~37 minutes into the
    // width record (lp-windows.js). Pinned to the half-hour tick so it never
    // shares an invocation with the census, the frontier probe or the canary,
    // and hourly because a 37-minute window every 15 minutes would be the same
    // chain counted four times. 24 KV writes a day.
    if (t.getUTCMinutes() >= 30 && t.getUTCMinutes() < 45) {
      // The pool record follows the width record in the same invocation, so
      // the watched pool's window is there to copy and the two other
      // candidates are replayed once each (lp-pools.js). 24 KV writes a day.
      ctx.waitUntil(
        recordLpWindow(env).catch((e) => noteLpWindowError(env, e).catch(() => {}))
          .then(() => recordLpPools(env))
          .catch((e) => noteLpPoolsError(env, e).catch(() => {})),
      );
    }

    // 21:0x UTC — where our own jobs stand on the kernel, once a day, so the
    // first COMPLETED we ever see carries a date nobody had to be awake for.
    if (t.getUTCHours() === 21 && firstTickOfHour) {
      ctx.waitUntil(tickOwnJobs(env, rpc).catch(() => {}));
    }
  },
};
