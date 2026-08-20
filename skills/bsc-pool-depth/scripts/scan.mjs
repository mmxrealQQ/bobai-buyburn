#!/usr/bin/env node
// Headless pool scan for BNB Smart Chain — the same measurements the browser
// scanner makes, returned as JSON instead of drawn on a page.
//
// The chain layer (scanner-chain.js) is shared verbatim with the web scanner.
// Nothing in this file computes a figure; it decides which figures to ask for,
// applies the guards that decide whether a pool is worth quoting at all, and
// prints the result. Keeping the arithmetic in one file is deliberate: a fee
// table or an impact formula that exists twice drifts, and a drifted cost
// column is worse than no cost column.
//
// Usage:  node scan.mjs <token-or-pool-address> [--json]
import {
  WBNB, BNB_PAIR, DEAD, NULLA, QUOTES, SEL as S, GOPLUS,
  balOf, call, hx, addrAt, res2, decStr, rpcBatch,
  classify, priceToken, discover,
  ladderV2, onePctV2, ladderV3, onePctV3, measureTax, venues,
} from './scanner-chain.mjs';

const parseInput = (s) => {
  const m = String(s || '').match(/0x[a-fA-F0-9]{40}/);
  return m ? m[0].toLowerCase() : null;
};

class ScanError extends Error {
  constructor(headline, detail) {
    super(headline);
    this.headline = headline;
    this.detail = detail;
  }
}

// GoPlus describes contract properties no eth_call reveals (mintable, proxy,
// LP lockers). It is asked, always attributed, and never allowed to override a
// figure that was measured on-chain.
const askGoPlus = (a) =>
  fetch(GOPLUS + a)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => j && j.result && (j.result[a] || j.result[a.toLowerCase()]))
    .catch(() => null);

export async function scan(input) {
  // Fired against the input on the chance it IS the token, because it usually
  // is and this is the slow leg. If the input turns out to be a pool, the
  // answer describes the LP token instead, so it is asked again against the
  // real token once that is known and this first answer dropped.
  let gpP = askGoPlus(input);

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
    if (token !== input) gpP = askGoPlus(token);
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
      buyPct: +(taxB * 100).toFixed(3), sellPct: +(taxS * 100).toFixed(3),
      measured: !!tax.ok,
      // The distinction that matters: measured means real executed trades were
      // read; labelled means a reputation service said so and nothing verified
      // it. Those disagree in practice, sometimes by more than a point.
      source: tax.ok ? 'measured from executed trades on-chain' : usedTax ? 'labelled by GoPlus, unverified' : 'unknown',
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
      source: gpOk ? 'GoPlus (contract properties only, never used to override a measured figure)' : 'unavailable',
    },
    source: 'measured on BNB Smart Chain via public RPC',
    disclaimer: 'Measurement, not advice. Figures describe what a trade would cost at the moment of the scan; depth and tax can change block to block.',
  };
}

const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const addr = parseInput(arg);
if (!addr) {
  console.error('Usage: node scan.mjs <bsc-token-or-pool-address>');
  console.error('Accepts a bare address or any BscScan / DexScreener / PancakeSwap link containing one.');
  process.exit(2);
}
try {
  console.log(JSON.stringify(await scan(addr), null, 2));
} catch (e) {
  console.log(JSON.stringify({ error: e.headline || 'Scan failed.', detail: e.detail || e.message || String(e), address: addr }, null, 2));
  process.exit(1);
}
