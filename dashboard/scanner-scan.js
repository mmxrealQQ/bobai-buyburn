// Pool scan for BNB Smart Chain, as data — the same measurements the browser
// scanner draws on a page, returned as JSON instead.
//
// THIS FILE IS THE ONE IMPLEMENTATION. Three surfaces import it and none of
// them owns a second copy:
//   the installable skill   (skills/bsc-pool-depth, pulled at build time)
//   the MCP tool            (bsc_pool_scan, in dashboard/_worker.js)
//   the browser scanner     (shares scanner-chain.js, the layer below this one)
// A fee table or an impact formula that exists twice drifts, and a drifted cost
// column is worse than no cost column. If a figure needs changing, it changes
// here and everywhere at once.
//
// Nothing in this file computes a figure. It decides which figures to ask for,
// applies the guards that decide whether a pool is worth quoting at all, and
// assembles the answer. The arithmetic lives one layer down in
// scanner-chain.js, which the browser page loads directly.
import {
  WBNB, BNB_PAIR, DEAD, NULLA, QUOTES, SEL as S, GOPLUS, GOPLUS_TOKEN,
  balOf, call, hx, addrAt, res2, decStr, rpcBatch,
  classify, priceToken, discover,
  ladderV2, onePctV2, ladderV3, onePctV3, measureTax, venues, simulateRoundTrip,
  STEPS, curveInfo, curveLadder, decOf,
} from './scanner-chain.js';

const parseInput = (s) => {
  const m = String(s || '').match(/0x[a-fA-F0-9]{40}/);
  return m ? m[0].toLowerCase() : null;
};

export class ScanError extends Error {
  constructor(headline, detail) {
    super(headline);
    this.headline = headline;
    this.detail = detail;
  }
}

// The contract properties the page shows as chips, in the API too. The page
// (scanner.js FLAGS) carries the labels; this is the key list, one source.
export const CONTRACT_PROPERTIES = [
  'is_mintable', 'is_proxy', 'can_take_back_ownership', 'hidden_owner', 'selfdestruct', 'transfer_pausable',
  'is_blacklisted', 'slippage_modifiable', 'personal_slippage_modifiable', 'trading_cooldown', 'is_anti_whale',
  'anti_whale_modifiable', 'cannot_sell_all', 'is_honeypot',
];

// GoPlus describes contract properties no eth_call reveals (mintable, proxy,
// LP lockers). It is asked, always attributed, and never allowed to override a
// figure that was measured on-chain.
//
// The explicit user-agent and timeout are not decoration. From a Cloudflare
// Worker the bare call came back with nothing, and because a missing answer
// used to read as "no tax", BOBAI was reported at 0% when it charges 3%. The
// tax field now says "unknown" rather than zero in that case — this makes the
// case rarer as well as harmless.
// Asked twice, with a different presentation each time. The plain call works
// from a browser and from Node and comes back with nothing from a Cloudflare
// Worker, which is where the MCP tool runs — so the second attempt announces
// itself as an ordinary client instead. One extra outbound call, and only when
// the first one failed.
// Why it failed is recorded, not swallowed. "unavailable" is a dead end for
// whoever has to fix it; "HTTP 403" and "timed out" point at completely
// different causes, and the difference decides whether a retry, a header or an
// account is the answer.
const gpWhy = { reason: null };

const goPlusOnce = async (a, init) => {
  try {
    const r = await fetch(GOPLUS + a, { ...init, signal: AbortSignal.timeout(7000) });
    if (!r.ok) { gpWhy.reason = 'HTTP ' + r.status; return null; }
    const j = await r.json();
    const hit = j && j.result && (j.result[a] || j.result[a.toLowerCase()]);
    // GoPlus answers 200 and puts the real outcome in `code`. Its own message
    // is repeated verbatim rather than paraphrased: the first version of this
    // guessed "no entry for this token" from an empty result, when what the
    // service actually said was that the request quota was gone. Those call for
    // opposite responses, and inventing the wrong one wasted an investigation.
    if (!hit) {
      gpWhy.reason = j && j.code != null
        ? 'answered code ' + j.code + (j.message ? ' (' + String(j.message).slice(0, 60) + ')' : '')
        : 'answered with no entry';
    }
    return hit || null;
  } catch (e) {
    gpWhy.reason = /abort|timeout/i.test(String(e && e.name) + String(e && e.message)) ? 'timed out' : 'connection failed';
    return null;
  }
};

// Edge cache, and only for answers that worked.
//
// The quota that runs out is attached to the caller's IP, and on Cloudflare
// that IP is shared with every other Worker in the world — so from there GoPlus
// returns "rate limit" while the identical request from a laptop returns the
// data. Caching a success for six hours means the second, tenth and hundredth
// scan of the same token get the properties even when a fresh request would be
// refused. It does not fix the first scan of a token nobody has asked about,
// and nothing short of an account key will.
//
// Failures are deliberately NOT cached: storing "rate limited" would turn a
// temporary refusal into six hours of certain refusal.
const CACHE_SECONDS = 21600;
const gpCached = async (a, fetcher) => {
  const store = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
  if (!store) return fetcher();
  const key = new Request('https://goplus-cache.brainonbnb.com/' + a);
  try {
    const hit = await store.match(key);
    if (hit) return await hit.json();
  } catch { /* a broken cache must never break the scan */ }
  const fresh = await fetcher();
  if (fresh) {
    try {
      await store.put(key, new Response(JSON.stringify(fresh), {
        headers: { 'content-type': 'application/json', 'cache-control': 'max-age=' + CACHE_SECONDS },
      }));
    } catch { /* same */ }
  }
  return fresh;
};

// --- account key -----------------------------------------------------------
// Anonymous requests share a quota tied to the caller's IP, and a Worker's IP
// belongs to all of Cloudflare, so the quota is usually spent before we ask.
// Measured 2026-08-22 over eight tokens not in the edge cache: two answered,
// six came back "code 4029 (too many requests)". It is not a hard wall, which
// is worse than one — the contract section appears for some visitors and not
// others, on the same token, for no reason anybody can see. An account key
// moves the quota onto us and is the only thing that fixes it.
//
// Key set 2026-08-23, and the same eight tokens then answered eight of eight.
// Note that the key only takes effect after a Pages deployment: uploading the
// secret alone left the running deployment anonymous and still at 4029.
//
// The secret stays in the Worker. It is not handed to the browser page and not
// to the packaged skill — both run on somebody else's machine, and a key in a
// downloadable bundle is a published key. A caller that passes no env stays
// anonymous and behaves exactly as before.
// Web Crypto, which the Worker and any Node 19+ have. Older runtimes reach this
// only through the packaged skill, and there the honest outcome is to stay
// anonymous rather than to throw in the middle of a scan that otherwise works.
const sha1Hex = async (s) => {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
};

// sign = sha1(app_key + time + app_secret). Exported so scripts/goplus-check.mjs
// can hold it against GoPlus's own worked example rather than trusting that the
// concatenation order was read correctly.
export const goPlusSign = (key, time, secret) => sha1Hex(`${key}${time}${secret}`);

// One token per isolate, renewed a minute before it lapses. `inflight` matters:
// several scans can land at once on a cold isolate, and without it each would
// fetch its own token.
let gpTok = { value: null, expires: 0, inflight: null };

const goPlusToken = (env) => {
  if (!env || !env.GOPLUS_APP_KEY || !env.GOPLUS_APP_SECRET) return Promise.resolve(null);
  const now = () => Math.floor(Date.now() / 1000);
  if (gpTok.value && gpTok.expires > now() + 60) return Promise.resolve(gpTok.value);
  if (gpTok.inflight) return gpTok.inflight;
  gpTok.inflight = (async () => {
    try {
      const time = now();
      const sign = await goPlusSign(env.GOPLUS_APP_KEY, time, env.GOPLUS_APP_SECRET);
      if (!sign) { gpWhy.reason = 'no SHA-1 available in this runtime'; return null; }
      const r = await fetch(GOPLUS_TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app_key: env.GOPLUS_APP_KEY, sign, time }),
        signal: AbortSignal.timeout(7000),
      });
      const j = await r.json().catch(() => null);
      const tok = j && j.result && j.result.access_token;
      if (!tok) {
        // Said plainly, because a wrong key and a reachable-but-refusing service
        // need different fixes and both otherwise show up as "unavailable".
        gpWhy.reason = 'account key rejected: ' + (j && j.code != null
          ? 'code ' + j.code + (j.message ? ' (' + String(j.message).slice(0, 60) + ')' : '')
          : 'HTTP ' + r.status);
        return null;
      }
      gpTok.value = tok;
      gpTok.expires = now() + Math.max(60, Number(j.result.expires_in) || 3600);
      return tok;
    } catch {
      gpWhy.reason = 'account key request failed';
      return null;
    } finally {
      gpTok.inflight = null;
    }
  })();
  return gpTok.inflight;
};

const askGoPlus = (a, env) => gpCached(a, async () => {
  const tok = await goPlusToken(env);
  // With a key, one request is the whole story: a refusal is then about the
  // account, and repeating it dressed as a browser only blurs which of the two
  // paths failed. Without a key, the second attempt stays — it used to help.
  if (tok) return (await goPlusOnce(a, { headers: { authorization: tok } })) || null;
  return (await goPlusOnce(a, {})) ||
    (await goPlusOnce(a, {
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })) ||
    null;
});

// `env` is optional and only ever carries the GoPlus account key. The Worker
// passes it; the browser page and the packaged skill call scan(input) with one
// argument and keep running anonymously.
export async function scan(input, env) {
  // Lowercased at the door, for the reason spelled out in tier-scan.js: every
  // address comparison downstream is a string comparison against a value that
  // came back from `addrAt`, which is lowercase. A checksummed address does not
  // error, it just matches nothing — and a scan that matches nothing still
  // returns a full, confident, wrong answer.
  input = String(input || '').toLowerCase();
  // Fired against the input on the chance it IS the token, because it usually
  // is and this is the slow leg. If the input turns out to be a pool, the
  // answer describes the LP token instead, so it is asked again against the
  // real token once that is known and this first answer dropped.
  let gpP = askGoPlus(input, env);

  let what;
  try {
    what = await classify(input);
  } catch {
    throw new ScanError(
      'The chain did not answer.',
      'The public BSC node refused or timed out. Nothing is cached here, so a retry in a few seconds usually works.',
    );
  }

  let token, pool = null, tokDec, bnbUsd, hop, deeper = null;

  const base = await rpcBatch([call(BNB_PAIR, S.reserves), call(BNB_PAIR, S.token0)]);
  const br = res2(base[0]);
  const bIs0 = addrAt(base[1]) === WBNB;
  bnbUsd = br ? (bIs0 ? br[1] / br[0] : br[0] / br[1]) : 0;
  if (!(bnbUsd > 0))
    throw new ScanError(
      'Could not price BNB.',
      'The reference pool read back empty, so nothing could be stated in dollars.',
    );

  if (what.kind === 'v2pair' || what.kind === 'v3pool') {
    // A pasted pool tells us the venue directly. Which side is "the token" is
    // then the only open question: it is the side that is not the quote, and
    // the quote is whichever side can be priced.
    const [a, b] = [what.token0, what.token1];
    const qa = QUOTES.find(([x]) => x === a);
    const qb = QUOTES.find(([x]) => x === b);
    if (qa && !qb) token = b;
    else if (qb && !qa) token = a;
    else if (qa && qb) token = a;
    else {
      const pa = await priceToken(a, bnbUsd);
      const pb = await priceToken(b, bnbUsd);
      token =
        pb.usd != null && pa.usd == null ? a
        : pa.usd != null && pb.usd == null ? b
        : (pb.hopBnb || 0) >= (pa.hopBnb || 0) ? a : b;
    }
    const quote = token === a ? b : a;
    const info = await rpcBatch([call(token, S.decimals), call(token, S.symbol), call(token, S.name)]);
    tokDec = decOf(info[0]);
    hop = await priceToken(quote, bnbUsd);
    if (hop.usd == null)
      throw new ScanError(
        'That pool cannot be priced.',
        'It trades against a token with no BNB pool of its own — so there is no way to express its depth in dollars without inventing one.',
      );
    // A pool quoted in a token that does not count in 18 decimals: the reserve,
    // the ladder and the 1% depth all divide the quote side by 1e18. DOGE/VIN
    // (DOGE has 8) was answered with a price 1e10 too low, liquidity $0 and a
    // price move of 2e16 % (2026-09-18). Refused, with the way that works.
    if (hop.dec != null && hop.dec !== 18)
      throw new ScanError(
        'That pool is quoted in a token with ' + hop.dec + ' decimals.',
        'Its depth cannot be stated correctly here yet: the maths of this scan counts the quote side in 18 decimals, as BNB and the stablecoins do. Paste the token itself instead — the scan then measures it in its deepest pool against BNB or a stablecoin.',
      );
    if (what.kind === 'v3pool' && !what.pancake)
      throw new ScanError(
        'That V3 pool is not a PancakeSwap pool.',
        'Its factory is ' + (what.factory || 'unreadable') + '. The concentrated-liquidity maths here is priced through PancakeSwap\'s own quoter, which knows nothing about another venue\'s pool — scanning it under PancakeSwap\'s name would state another pool\'s costs. Paste the token instead and the scan finds its PancakeSwap pools.',
      );
    if (what.kind === 'v2pair' && !what.venue)
      throw new ScanError(
        'That pool is on a venue this tool does not price.',
        'Its factory is not one of the constant-product venues whose swap fee has been derived and verified here (PancakeSwap V2, Uniswap V2, Biswap). Applying somebody else’s fee would quietly understate what a trade costs, so no figures are shown.',
      );
    pool =
      what.kind === 'v2pair'
        ? {
            kind: 'v2', pair: input, quote, sym: hop.sym, usd: hop.usd,
            fee: what.venue.fee, venue: what.venue.name, factory: what.factory,
            tok: (addrAt(what.token0) === token ? what.reserves[0] : what.reserves[1]) / Math.pow(10, tokDec),
            q: (addrAt(what.token0) === token ? what.reserves[1] : what.reserves[0]) / 1e18,
          }
        : {
            kind: 'v3', pair: input, quote, sym: hop.sym, usd: hop.usd,
            fee: what.fee / 1e6, feeRaw: what.fee, sqrt: what.sqrt,
            tokenIs0: what.token0 === token,
          };
    if (pool.kind === 'v3') {
      const bal = await rpcBatch([call(quote, balOf(input)), call(token, balOf(input))]);
      pool.q = Number(hx(bal[0])) / 1e18;
      pool.tok = Number(hx(bal[1])) / Math.pow(10, tokDec);
    }
    if (token !== input) gpP = askGoPlus(token, env);
    // A pasted pool is honoured — you asked about that one. But the factories
    // are still asked what else exists, because a link often points at a side
    // pool while the real depth sits one fee tier over.
    try {
      const alt = (await discover(token, tokDec, bnbUsd)).find(
        (c) => c.pair.toLowerCase() !== pool.pair.toLowerCase() && c.hard > (pool.q || 0) * pool.usd * 1.15,
      );
      if (alt) deeper = alt;
    } catch { /* a missing alternative is not a failed scan */ }
  } else {
    token = input;
    const info = await rpcBatch([call(token, S.decimals), call(token, S.symbol), call(token, S.name)]);
    tokDec = decOf(info[0]);
    const cands = await discover(token, tokDec, bnbUsd);
    pool = cands[0] || null;
    hop = { direct: true, sym: pool ? pool.sym : 'BNB' };
    if (pool && pool.kind === 'v3') {
      const s = await rpcBatch([call(pool.pair, S.slot0), call(pool.pair, S.token0)]);
      pool.sqrt = hx('0x' + s[0].slice(2, 66));
      pool.tokenIs0 = addrAt(s[1]) === token;
    }
  }

  const gp = (await gpP) || {};
  const gpOk = !!(gp.token_name || gp.dex || gp.is_open_source != null);
  const nameInfo = await rpcBatch([
    call(token, S.symbol), call(token, S.name), call(token, S.totalSupply),
    call(token, balOf(DEAD)), call(token, balOf(NULLA)),
  ]);
  const symb = (gp.token_symbol || decStr(nameInfo[0]) || '?').trim().slice(0, 16);
  const name = (gp.token_name || decStr(nameInfo[1]) || 'Unknown token').trim().slice(0, 60);
  const supply = nameInfo[2] ? Number(hx(nameInfo[2])) / Math.pow(10, tokDec) : null;
  const burned = (Number(hx(nameInfo[3])) + Number(hx(nameInfo[4]))) / Math.pow(10, tokDec);

  // Venues from DexScreener, which indexes the small DEXes, AND from GoPlus,
  // whose list is already in hand — merged by pair, the larger figure per pair.
  // GoPlus was only the fallback until 2026-09-21, and DexScreener does not
  // index Pancake Infinity: ZAMA, $1.2M there, was answered "quotable" from a
  // $75 pool as holding a third of the token's liquidity, with a round trip
  // "returning 1%" — a liquid token that read like a honeypot. The right
  // refusal came only on the calls where DexScreener happened to fail.
  const dsAll = await venues(token);
  const mineKey = pool ? pool.pair.toLowerCase() : null;
  const byPair = new Map();
  for (const x of dsAll || [])
    if (x.pair && x.pair.toLowerCase() !== mineKey)
      byPair.set(x.pair.toLowerCase(), { pair: x.pair, name: x.name + (x.quote ? ' · ' + x.quote : ''), liquidity: x.liq || 0 });
  for (const x of gp.dex || []) {
    const key = String(x.pair || '').toLowerCase();
    if (!key || key === mineKey) continue;
    const liq = parseFloat(x.liquidity) || 0, had = byPair.get(key);
    if (!had) byPair.set(key, { pair: x.pair, name: x.name || x.liquidity_type || 'Unknown', liquidity: liq });
    else if (liq > had.liquidity) had.liquidity = liq;
  }
  const others = [...byPair.values()].sort((a, b) => b.liquidity - a.liquidity);
  const otherLiq = others.reduce((s, x) => s + (x.liquidity || 0), 0);
  const hard = pool ? (pool.q || 0) * pool.usd : 0;

  // "Is the pool I can measure representative?" — and the comparison must use
  // ONE yardstick. Weighing our own one-sided figure against a two-sided one
  // makes every V3 pool look like a rounding error, so when the index has a
  // figure for OUR pool, both sides of the ratio come from the index.
  const mineFrom = (list) => {
    if (!list || !pool) return null;
    const e = list.find((x) => (x.pair || '').toLowerCase() === pool.pair.toLowerCase());
    return e ? (e.liq != null ? e.liq : parseFloat(e.liquidity) || 0) : null;
  };
  const mine = mineFrom(dsAll) != null ? mineFrom(dsAll) : mineFrom(gp.dex);
  const share = !pool ? 0
    : mine != null && mine + otherLiq > 0 ? mine / (mine + otherLiq)
    : otherLiq > 0 ? hard / (hard + otherLiq) : 1;

  if (!pool && !others.length && !gpOk && !(supply > 0) && !decStr(nameInfo[0]))
    throw new ScanError(
      'That address is not a BSC token.',
      'It answers nothing to symbol() or totalSupply(), has no pool at any venue this tool can read, and GoPlus does not list it. A wallet address, or a contract that is not a token, looks exactly like this.',
    );

  const mineUsd = mine != null ? mine : hard * 2;
  const deepEnough = mineUsd >= 100000;
  // A readable pool holding a sliver of the real liquidity describes a side
  // pocket, and a ladder off it would describe a market nobody trades in. But
  // share alone refuses genuinely deep pools that are merely one of several, so
  // a pool also qualifies on its own absolute depth.
  // No pool at all: ask four.meme before concluding "no pool". A token still
  // raising there has no pool by design; its market is the platform's own
  // contract, which quotes a buy and a sell of each size on request. A
  // graduated token (liquidityAdded) falls through to the pool path.
  if (!pool && !others.length) {
    const cv = await curveInfo(token);
    if (cv && !cv.liquidityAdded) {
      const quoteUsd = cv.quoteSym === 'BNB' ? bnbUsd : cv.quoteIsStable ? 1 : 0;
      const rows = await curveLadder(token, cv, quoteUsd, STEPS);
      const sellRow = rows.find((r) => r.sellCost != null);
      return {
        address: token, name, symbol: symb, quotable: false,
        reason: 'Still on its four.meme launch curve — there is no PancakeSwap pool yet; trades go through four.meme’s contract.',
        curve: {
          platform: 'four.meme',
          stage: 'bonding curve',
          quoteSymbol: cv.quoteSym,
          priceQuote: cv.price,
          priceUsd: quoteUsd > 0 ? cv.price * quoteUsd : null,
          feePct: cv.feePct,
          raised: cv.raised, maxRaising: cv.maxRaising, progressPct: cv.progressPct == null ? null : +cv.progressPct.toFixed(2),
          tokensLeft: cv.offersLeft, maxOffers: cv.maxOffers,
          launchTime: cv.launchTime ? new Date(cv.launchTime * 1000).toISOString() : null,
          tradeCost: rows.map((r) => ({
            sizeUsd: r.usd,
            buyCostPct: r.buyCost == null ? null : +r.buyCost.toFixed(3),
            sellCostPct: r.sellCost == null ? null : +r.sellCost.toFixed(3),
            note: r.buyNote || r.sellNote || undefined,
          })),
          sellQuoted: !!sellRow,
          custody: 'The money raised sits in four.meme’s TokenManager contract until the raise completes, not in the creator’s wallet; there is no pool and therefore no liquidity to withdraw.',
          onCompletion: 'When the raise completes, four.meme lists the token on PancakeSwap; the pool path of this tool applies from then on.',
          source: 'four.meme TokenManagerHelper3 (getTokenInfo, tryBuy, trySell) on BNB Smart Chain, at this block',
        },
        venues: [],
        source: 'measured on BNB Smart Chain via public RPC',
      };
    }
  }
  if (!pool || (share < 0.25 && !deepEnough))
    return {
      address: token, name, symbol: symb, quotable: false,
      // …and WHERE the market is, when an index knows: "not quotable" alone
      // reads as "nothing there" about a token with a million dollars at a
      // venue this tool cannot read.
      reason: (pool
        ? 'The readable pool holds too small a share of this token’s liquidity to describe its market.'
        : 'No pool at a venue whose swap fee has been verified here.')
        + (others[0] && others[0].liquidity >= 1000
          ? ` Most of it sits at ${others[0].name} (about $${Math.round(others[0].liquidity).toLocaleString('en-US')} by index figures, not measured here).`
          : ''),
      liquidity: { readablePoolUsd: Math.round(hard), elsewhereUsd: Math.round(otherLiq), shareOfLiquidity: +share.toFixed(4) },
      venues: others.slice(0, 12),
      source: 'measured on BNB Smart Chain via public RPC',
    };

  const partial = share < 0.25 ? share : null;

  // For a constant-product pair the ratio of the two reserves IS the price. For
  // a concentrated-liquidity pool it is not — V3 keeps its price in
  // sqrtPriceX96, so that is where it is read from.
  let px;
  if (pool.kind === 'v3') {
    const d0 = pool.tokenIs0 ? tokDec : 18;
    const d1 = pool.tokenIs0 ? 18 : tokDec;
    const r = Math.pow(Number(pool.sqrt) / Math.pow(2, 96), 2) * Math.pow(10, d0 - d1);
    px = (pool.tokenIs0 ? r : 1 / r) * pool.usd;
  } else px = (pool.q / pool.tok) * pool.usd;
  if (!(px > 0))
    throw new ScanError('That pool is empty.', 'Both sides read back as zero — there is nothing to measure.');

  // The tax, read off trades that actually happened rather than off a label.
  const tokenIs0 =
    pool.kind === 'v2'
      ? await rpcBatch([call(pool.pair, S.token0)]).then((r) => addrAt(r[0]) === token)
      : pool.tokenIs0;
  let tax = await measureTax(token, pool.pair.toLowerCase(), tokenIs0, pool.kind);
  // Can it be sold at all? Asked of the chain, not of a label (see the
  // function's header). V2 pairs only; anything else says so.
  let sim = await simulateRoundTrip(token, pool.pair.toLowerCase(), tokenIs0, pool.kind);
  // One patient retry before the label wins. Measured on 2026-09-08: one scan
  // in ten came back with status 200 and the tax "labelled by GoPlus" and the
  // sell test "every BSC endpoint refused" — the same question, answered by
  // measurement nine times and by a label once, because the log endpoint was
  // throttled for the second the scan needed it. A caller cannot tell that
  // answer from a measured one by its status. A second try after a beat is
  // three to five calls; a label sold as a measurement costs more than that.
  const simMeasured = (s) => !!(s && s.tax && (s.tax.buy_pct != null || s.tax.sell_pct != null));
  let secondTry = false;
  if (!tax.ok && !simMeasured(sim)) {
    await new Promise((r) => setTimeout(r, 1500));
    secondTry = true;
    tax = await measureTax(token, pool.pair.toLowerCase(), tokenIs0, pool.kind);
    if (!simMeasured(sim)) sim = await simulateRoundTrip(token, pool.pair.toLowerCase(), tokenIs0, pool.kind);
  }
  // GoPlus answers buy_tax:"" for a token it has no figure for. Number("") is 0
  // and 0 is finite: the blank was read as a labelled 0% — "unknown is never
  // zero" broken at the last fallback (2026-09-18). Blank, null and garbage
  // are all "no label".
  const label = (v) => (v == null || String(v).trim() === '' || !isFinite(Number(v)) ? NaN : Number(v));
  const gB = label(gp.buy_tax);
  const gS = label(gp.sell_tax);
  // Per direction: an executed trade first, the simulated trade second (the
  // probe read what arrived at this block), the label last.
  // …and only a simulated trade through the pool that was READ. A test that had
  // to go through the token's side pair against BNB says what that pair
  // charges; taken as this market's tax it put 0% on ARK beside three executed
  // sells at 2.5% (2026-09-21). It is still returned, under its own pair.
  const simHere = !!sim && sim.through_scanned_pool !== false;
  const sB = simHere && sim.tax && sim.tax.buy_pct != null ? sim.tax.buy_pct / 100 : null;
  const sS = simHere && sim.tax && sim.tax.sell_pct != null ? sim.tax.sell_pct / 100 : null;
  // A MEASURED ZERO THAT THE SIMULATION CONTRADICTS IS NOT A MEASUREMENT
  // (2026-09-18). A reflection-style token emits only the net Transfer: the
  // executed trade then reads 0% "measured", and that outranked the simulation,
  // which reads what really arrived. Where the trades say ~0 and the simulated
  // trade at this block says more, the simulation is used for that direction.
  const hidden = (m, sim) => m != null && sim != null && m < 0.0015 && sim - m > 0.0015;
  const simOverB = tax.ok && hidden(tax.buy, sB), simOverS = tax.ok && hidden(tax.sell, sS);
  const taxB = tax.ok && tax.buy != null && !simOverB ? tax.buy : sB != null ? sB : isFinite(gB) ? gB : 0;
  const taxS = tax.ok && tax.sell != null && !simOverS ? tax.sell : sS != null ? sS : isFinite(gS) ? gS : 0;
  const simulated = sB != null || sS != null;
  const usedTax = tax.ok || simulated || isFinite(gB) || isFinite(gS);
  // WHERE EACH SIDE CAME FROM (2026-09-21). One `source` for both sides said
  // "measured from executed trades" about TUT with three sells read and NO
  // buy: its buy figure was a label, or the literal 0 above — the "zero is a
  // claim" case, under the word "measured". Each side carries its own origin,
  // and a side nothing could establish is null in the answer (the arithmetic
  // still has to use a number, and uses the 0).
  const origin = (measuredSide, simOver, s, g) =>
    tax.ok && measuredSide != null && !simOver ? 'measured' : s != null ? 'simulated' : isFinite(g) ? 'label' : 'unknown';
  const srcB = origin(tax.buy, simOverB, sB, gB), srcS = origin(tax.sell, simOverS, sS, gS);
  const SOURCE_WORDS = {
    measured: 'measured from executed trades on-chain',
    simulated: 'simulated on-chain at this block, from a fresh address',
    label: 'labelled by GoPlus, unverified',
    unknown: 'unknown — nothing could establish it',
  };

  let rows, up, down, upMin = null, downMin = null;
  if (pool.kind === 'v2') {
    rows = ladderV2(pool.tok, pool.q, pool.fee, taxB, taxS, px, pool.usd);
    up = onePctV2(pool.q, pool.fee, 1.01) * pool.usd;
    down = (onePctV2(pool.tok, pool.fee, 1 / 0.99) / (1 - taxS)) * px;
  } else {
    rows = await ladderV3(pool.pair, token, pool.quote, pool.feeRaw, tokDec, px, pool.usd, taxB, taxS, pool.sqrt, pool.tokenIs0);
    const oc = await onePctV3(pool.pair, token, pool.quote, pool.feeRaw, tokDec, px, pool.usd, pool.sqrt, pool.tokenIs0, taxS);
    up = oc.up; down = oc.down; upMin = oc.upMin; downMin = oc.downMin;
  }

  // LP custody. A constant-product pair mints LP to the factory's feeTo() on
  // every liquidity event, so on any pool that has run for a while some
  // unburned LP belongs to the exchange rather than to anybody near the token.
  let lpTot = 0, lpDead = 0, lpNull = 0, lpFee = 0, feeTo = null;
  if (pool.kind === 'v2') {
    const lp = await rpcBatch([
      call(pool.pair, S.totalSupply), call(pool.pair, balOf(DEAD)), call(pool.pair, balOf(NULLA)),
      pool.factory ? call(pool.factory, S.feeTo) : call(pool.pair, S.totalSupply),
    ]);
    lpTot = Number(hx(lp[0])) / 1e18;
    lpDead = Number(hx(lp[1])) / 1e18;
    lpNull = Number(hx(lp[2])) / 1e18;
    if (pool.factory) {
      feeTo = addrAt(lp[3]);
      if (feeTo && feeTo !== NULLA) {
        const fb = await rpcBatch([call(pool.pair, balOf(feeTo))]);
        lpFee = Number(hx(fb[0])) / 1e18;
      } else feeTo = null;
    }
  }

  return {
    address: token, name, symbol: symb, quotable: true,
    // "At this block" has to name the block (2026-09-12): the head the tax
    // window ended at, and when this answer was made.
    block: tax.block ?? null, measuredAt: new Date().toISOString(),
    price: { usd: px, quoteSymbol: pool.sym, quoteUsd: pool.usd },
    supply: { total: supply, burned, circulating: supply != null ? supply - burned : null },
    pool: {
      address: pool.pair, kind: pool.kind, venue: pool.venue || (pool.kind === 'v3' ? 'PancakeSwap V3' : null),
      swapFeePct: +(pool.fee * 100).toFixed(4),
      tokenReserve: pool.tok, quoteReserve: pool.q,
      liquidityUsd: Math.round(hard),
      // Which of the two possible meanings this figure has, said out loud.
      // liquidityUsd is the QUOTE SIDE ONLY — the BNB or USDT actually in the
      // pool, the half that does not evaporate when the token's own price does.
      // pancakeswap_fee_tiers reports capital_usd for the same pool counting
      // BOTH sides, because an LP has to put up both, so the two figures differ
      // by roughly 2x on purpose. Without this line they read as a contradiction
      // between our own endpoints, which is how a correct number loses an
      // argument it should win.
      liquidityBasis: 'quote side only — the hard asset in the pool. Counting both sides, as an LP would, is roughly twice this; that is what pancakeswap_fee_tiers reports as capital_usd.',
      shareOfLiquidity: +share.toFixed(4),
      partialMarket: partial != null,
    },
    // What a trade of each size actually costs, tax and slippage and swap fee
    // together — not the headline slippage a router shows.
    // A rung the pool cannot fill (V3, more than sits in range) carries null
    // figures and a note; before, KII's ladder said "+5.33e+41%" there.
    tradeCost: rows.map((r) => ({
      sizeUsd: r.usd,
      buyCostPct: r.buyCost == null ? null : +r.buyCost.toFixed(3), buyPriceMovePct: r.buyMove == null ? null : +r.buyMove.toFixed(3),
      sellCostPct: r.sellCost == null ? null : +r.sellCost.toFixed(3), sellPriceMovePct: r.sellMove == null ? null : +r.sellMove.toFixed(3),
      ...(r.buyNote ? { buyNote: r.buyNote } : {}), ...(r.sellNote ? { sellNote: r.sellNote } : {}),
    })),
    onePercentDepth: {
      buyUsd: Math.round(up), sellUsd: Math.round(down),
      note: 'USD size that moves the price by 1% in each direction',
      ...(upMin != null ? { buyUsdLowerBound: Math.round(upMin), sellUsdLowerBound: Math.round(downMin) } : {}),
    },
    // The sell test. `ok:false` with a reason is "not checked" and must never
    // be read as "safe"; `sellable:false` carries the router's own reason.
    sellability: sim,
    tax: {
      // null, not 0, when nothing could be established. Zero is a claim — it
      // says this token takes no cut on transfer — and printing it because a
      // lookup failed is how a reader ends up budgeting three percent short.
      // BOBAI itself surfaced this: with GoPlus unreachable the answer came
      // back "0% tax" for a token that charges 3%. The arithmetic below still
      // has to use a number, so it uses zero and says so here.
      buyPct: srcB !== 'unknown' ? +(taxB * 100).toFixed(3) : null,
      sellPct: srcS !== 'unknown' ? +(taxS * 100).toFixed(3) : null,
      // Per side: measured | simulated | label | unknown. `measured` below is
      // true only when BOTH sides were read off executed trades.
      buySource: srcB, sellSource: srcS,
      measured: srcB === 'measured' && srcS === 'measured',
      // Why not, when not: a quiet pool and a throttled log endpoint are
      // different answers for a caller — one is final, the other says retry.
      ...(tax.ok ? {} : { reason: tax.reason || null }),
      windowMinutes: tax.windowBlocks ? Math.round(tax.windowBlocks * 0.45 / 60) : null,
      // Named when the first read was throttled and the second answered: a
      // caller measuring the path can count how often the retry earned its keep.
      ...(secondTry ? { read_on_second_try: true } : {}),
      // The distinction that matters: measured means real executed trades were
      // read; simulated means the same trade was run on the chain at this block
      // from a fresh address and its gap read; labelled means a reputation
      // service said so and nothing verified it. Those disagree in practice,
      // sometimes by more than a point.
      source: tax.ok && (simOverB || simOverS) ? 'simulated on-chain at this block — executed trades showed no fee leg (a reflection-style transfer hides it), the simulated trade did'
        : srcB === srcS ? SOURCE_WORDS[srcB]
        : `buy: ${SOURCE_WORDS[srcB]}; sell: ${SOURCE_WORDS[srcS]}`,
      ...(simulated ? { simulated: { buyPct: sB == null ? null : +(sB * 100).toFixed(2), sellPct: sS == null ? null : +(sS * 100).toFixed(2), method: sim.tax.method } } : {}),
      ...(usedTax ? {} : { warning: 'No transfer tax could be established — neither from executed trades nor from a label. The cost figures below therefore EXCLUDE any transfer tax. If this token takes a cut on transfer, a real trade costs more than shown.' }),
      // How many executed trades each median stands on, and their spread — a
      // median of one reads differently from a median of three (tradesSampled
      // was emitted from a field measureTax never set).
      ...(tax.ok ? { tradesMeasured: { buys: tax.nBuy ?? 0, sells: tax.nSell ?? 0 }, spreadPct: tax.spread || null } : {}),
    },
    ...(pool.kind === 'v2'
      ? {
          lp: {
            totalSupply: lpTot,
            // Four places, and never rounded UP to "all of it": 99.9972% burned is
            // not 100%, and the one agent that acts on "LP fully burned" should not
            // be told so by a toFixed.
            burnedPct: lpTot > 0 ? Math.floor(((lpDead + lpNull) / lpTot) * 1e6) / 1e4 : null,
            exchangeFeeShare: lpFee > 0 ? +((lpFee / lpTot) * 100).toFixed(2) : 0,
            feeToAddress: feeTo,
            note: 'LP held at the burn addresses cannot be withdrawn. Any balance at the factory feeTo() belongs to the exchange, not to the token team.',
          },
        }
      : {}),
    venues: others.slice(0, 12),
    ...(deeper ? { deeperPoolElsewhere: { pair: deeper.pair, liquidityUsd: Math.round(deeper.hard) } } : {}),
    contract: {
      openSource: gp.is_open_source === '1' ? true : gp.is_open_source === '0' ? false : null,
      proxy: gp.is_proxy === '1' ? true : gp.is_proxy === '0' ? false : null,
      mintable: gp.is_mintable === '1' ? true : gp.is_mintable === '0' ? false : null,
      // The whole set the page renders (2026-09-18), three-state: true, false,
      // or null for "GoPlus returned no value", which is not "no". Above all
      // slippage_modifiable — a measured 3% that can be raised tomorrow.
      properties: Object.fromEntries(CONTRACT_PROPERTIES.map((k) => [k, gp[k] === '1' ? true : gp[k] === '0' ? false : null])),
      notChecked: CONTRACT_PROPERTIES.filter((k) => gp[k] == null),
      ...(gp.owner_address ? { owner: gp.owner_address } : {}),
      source: gpOk
        ? 'GoPlus (contract properties only, never used to override a measured figure)'
        : 'unavailable' + (gpWhy.reason ? ' — GoPlus ' + gpWhy.reason : ''),
    },
    source: 'measured on BNB Smart Chain via public RPC',
    disclaimer: 'Measurement, not advice. Figures describe what a trade would cost at the moment of the scan; depth and tax can change block to block.',
  };
}

