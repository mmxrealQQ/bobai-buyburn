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
  ladderV2, onePctV2, ladderV3, onePctV3, measureTax, venues,
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
    tokDec = Number(hx(info[0])) || 18;
    hop = await priceToken(quote, bnbUsd);
    if (hop.usd == null)
      throw new ScanError(
        'That pool cannot be priced.',
        'It trades against a token with no BNB pool of its own — so there is no way to express its depth in dollars without inventing one.',
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
    tokDec = Number(hx(info[0])) || 18;
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

  // Venues from DexScreener, which indexes the small DEXes; GoPlus's list is
  // the fallback and only covers what it happens to know.
  const dsAll = await venues(token);
  const others = dsAll
    ? dsAll
        .filter((x) => !pool || x.pair !== pool.pair.toLowerCase())
        .map((x) => ({ pair: x.pair, name: x.name + (x.quote ? ' · ' + x.quote : ''), liquidity: x.liq }))
    : (gp.dex || [])
        .filter((x) => x.pair && (!pool || x.pair.toLowerCase() !== pool.pair.toLowerCase()))
        .map((x) => ({ pair: x.pair, name: x.name || x.liquidity_type || 'Unknown', liquidity: parseFloat(x.liquidity) || 0 }))
        .sort((a, b) => b.liquidity - a.liquidity);
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
  if (!pool || (share < 0.25 && !deepEnough))
    return {
      address: token, name, symbol: symb, quotable: false,
      reason: pool
        ? 'The readable pool holds too small a share of this token’s liquidity to describe its market.'
        : 'No pool at a venue whose swap fee has been verified here.',
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
  const tax = await measureTax(token, pool.pair.toLowerCase(), tokenIs0, pool.kind);
  const gB = Number(gp.buy_tax);
  const gS = Number(gp.sell_tax);
  const taxB = tax.ok && tax.buy != null ? tax.buy : isFinite(gB) ? gB : 0;
  const taxS = tax.ok && tax.sell != null ? tax.sell : isFinite(gS) ? gS : 0;
  const usedTax = tax.ok || isFinite(gB) || isFinite(gS);

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
    price: { usd: px, quoteSymbol: pool.sym, quoteUsd: pool.usd },
    supply: { total: supply, burned, circulating: supply != null ? supply - burned : null },
    pool: {
      address: pool.pair, kind: pool.kind, venue: pool.venue || (pool.kind === 'v3' ? 'PancakeSwap V3' : null),
      swapFeePct: +(pool.fee * 100).toFixed(4),
      tokenReserve: pool.tok, quoteReserve: pool.q,
      liquidityUsd: Math.round(hard),
      shareOfLiquidity: +share.toFixed(4),
      partialMarket: partial != null,
    },
    // What a trade of each size actually costs, tax and slippage and swap fee
    // together — not the headline slippage a router shows.
    tradeCost: rows.map((r) => ({
      sizeUsd: r.usd,
      buyCostPct: +r.buyCost.toFixed(3), buyPriceMovePct: +r.buyMove.toFixed(3),
      sellCostPct: +r.sellCost.toFixed(3), sellPriceMovePct: +r.sellMove.toFixed(3),
    })),
    onePercentDepth: {
      buyUsd: Math.round(up), sellUsd: Math.round(down),
      note: 'USD size that moves the price by 1% in each direction',
      ...(upMin != null ? { buyUsdLowerBound: Math.round(upMin), sellUsdLowerBound: Math.round(downMin) } : {}),
    },
    tax: {
      // null, not 0, when nothing could be established. Zero is a claim — it
      // says this token takes no cut on transfer — and printing it because a
      // lookup failed is how a reader ends up budgeting three percent short.
      // BOBAI itself surfaced this: with GoPlus unreachable the answer came
      // back "0% tax" for a token that charges 3%. The arithmetic below still
      // has to use a number, so it uses zero and says so here.
      buyPct: usedTax ? +(taxB * 100).toFixed(3) : null,
      sellPct: usedTax ? +(taxS * 100).toFixed(3) : null,
      measured: !!tax.ok,
      // The distinction that matters: measured means real executed trades were
      // read; labelled means a reputation service said so and nothing verified
      // it. Those disagree in practice, sometimes by more than a point.
      source: tax.ok ? 'measured from executed trades on-chain' : usedTax ? 'labelled by GoPlus, unverified' : 'unknown',
      ...(usedTax ? {} : { warning: 'No transfer tax could be established — neither from executed trades nor from a label. The cost figures below therefore EXCLUDE any transfer tax. If this token takes a cut on transfer, a real trade costs more than shown.' }),
      ...(tax.ok && tax.trades ? { tradesSampled: tax.trades } : {}),
    },
    ...(pool.kind === 'v2'
      ? {
          lp: {
            totalSupply: lpTot,
            burnedPct: lpTot > 0 ? +(((lpDead + lpNull) / lpTot) * 100).toFixed(2) : null,
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
      source: gpOk
        ? 'GoPlus (contract properties only, never used to override a measured figure)'
        : 'unavailable' + (gpWhy.reason ? ' — GoPlus ' + gpWhy.reason : ''),
    },
    source: 'measured on BNB Smart Chain via public RPC',
    disclaimer: 'Measurement, not advice. Figures describe what a trade would cost at the moment of the scan; depth and tax can change block to block.',
  };
}

