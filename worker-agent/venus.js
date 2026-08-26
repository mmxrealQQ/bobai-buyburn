// Health factor for a Venus position on BNB Smart Chain.
//
// This is the working half of one of the four categories the marketplace has to
// cover, and it is deliberately not a wrapper around somebody's API. Every
// number below comes from a contract read: the markets an account has entered,
// its balance and debt in each, the collateral factor the protocol applies, and
// the oracle price the protocol itself uses for liquidation. Nothing is fetched
// from a dashboard, so nothing can be stale in a way we cannot see.
//
// WHY A HEALTH FACTOR AND NOT "liquidity"
// Venus answers getAccountLiquidity() with a surplus or a shortfall in dollars.
// That is the number the protocol acts on, but it is useless for deciding when
// to worry: $5,000 of headroom means something completely different on a
// $10,000 position than on a $3,000,000 one. The ratio does not have that
// problem, which is why every lending UI shows it and why an agent monitoring a
// position needs it.
//
//   health factor = weighted collateral / borrowed
//   liquidatable at < 1.0
//
// THE SELF-CHECK THAT MAKES THIS TRUSTWORTHY
// We compute the position market by market, then compare our own
// (weighted collateral − borrowed) against Venus's own getAccountLiquidity.
// The protocol is the authority on its own arithmetic; if our number disagrees
// with its number, ours is wrong, and the caller is told so rather than handed
// a plausible figure. A monitoring agent whose maths is silently off is worse
// than no monitoring agent, because somebody will act on it.

const UNITROLLER = '0xfD36E2c2a6789Db23113685031d7F16329158384';

// Selectors, computed from the signatures rather than copied:
//   getAllMarkets()                    0xb0772d0b
//   getAssetsIn(address)               0xabfceffc
//   markets(address)                   0x8e8f294b   -> (isListed, collateralFactorMantissa, isVenus)
//   oracle()                           0x7dc0d1d0
//   getAccountLiquidity(address)       0x5ec88c79   -> (error, liquidity, shortfall)
//   getAccountSnapshot(address)        0xc37f68e2   -> (error, vTokenBalance, borrowBalance, exchangeRateMantissa)
//   getUnderlyingPrice(address)        0xfc57d4df
//   symbol()                           0x95d89b41
//   underlying()                       0x6f307dc3
//   decimals()                         0x313ce567
const SEL = {
  getAllMarkets: '0xb0772d0b',
  getAssetsIn: '0xabfceffc',
  markets: '0x8e8f294b',
  oracle: '0x7dc0d1d0',
  getAccountLiquidity: '0x5ec88c79',
  getAccountSnapshot: '0xc37f68e2',
  getUnderlyingPrice: '0xfc57d4df',
  symbol: '0x95d89b41',
  underlying: '0x6f307dc3',
  decimals: '0x313ce567',
};

const RPCS = [
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed.binance.org',
  'https://bsc.publicnode.com',
  'https://bsc-dataseed2.defibit.io',
  'https://bsc-dataseed3.bnbchain.org',
];

const addrArg = (a) => String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0');
const word = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const uint = (hex, i) => BigInt('0x' + (word(hex, i) || '0'));
const addrAt = (hex, i) => '0x' + word(hex, i).slice(24);

// One batched eth_call per round trip. Reading a position across 52 markets one
// call at a time is 200+ requests and takes long enough that the price moves
// underneath the answer, which is exactly the kind of quiet inconsistency a
// health factor must not have.
async function batchCall(calls, { rpcs = RPCS } = {}) {
  const payload = calls.map((c, i) => ({
    jsonrpc: '2.0', id: i, method: 'eth_call',
    params: [{ to: c.to, data: c.data }, 'latest'],
  }));
  for (let attempt = 0; attempt < rpcs.length * 2; attempt++) {
    const url = rpcs[attempt % rpcs.length];
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      if (!Array.isArray(j)) continue;
      const out = new Array(calls.length).fill(null);
      let got = 0;
      for (const item of j) {
        if (typeof item.id !== 'number' || item.error) continue;
        out[item.id] = item.result;
        got++;
      }
      // A partial answer would silently drop a market — and a dropped market is
      // either collateral we did not count or debt we did not count, both of
      // which move the health factor in a direction nobody asked for.
      if (got === calls.length) return out;
    } catch { /* next endpoint */ }
  }
  throw new Error('no BSC endpoint answered the batch');
}

const decodeString = (hex) => {
  if (!hex || hex === '0x') return null;
  try {
    const len = Number(uint(hex, 1));
    if (!(len > 0) || len > 256) return null;
    const body = hex.slice(2 + 128, 2 + 128 + len * 2);
    const bytes = [];
    for (let i = 0; i < body.length; i += 2) bytes.push(parseInt(body.substr(i, 2), 16));
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch { return null; }
};

const S = 10n ** 18n;
const num = (v, dp = 2) => Number(v) / 1e18;

/**
 * Reads one account's Venus position and returns its health factor.
 * Read-only: it calls view functions and signs nothing.
 */
export async function healthFactor(account) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(account || ''))) {
    throw new Error('not an address');
  }

  // Round 1: which markets is this account in, what does the protocol itself
  // say about its liquidity, and which oracle is authoritative right now.
  const [assetsRaw, liqRaw, oracleRaw] = await batchCall([
    { to: UNITROLLER, data: SEL.getAssetsIn + addrArg(account) },
    { to: UNITROLLER, data: SEL.getAccountLiquidity + addrArg(account) },
    { to: UNITROLLER, data: SEL.oracle },
  ]);

  const oracle = addrAt(oracleRaw, 0);
  const venusError = Number(uint(liqRaw, 0));
  const venusLiquidity = uint(liqRaw, 1);
  const venusShortfall = uint(liqRaw, 2);

  const count = Number(uint(assetsRaw, 1));
  const markets = [];
  for (let i = 0; i < count; i++) markets.push(addrAt(assetsRaw, 2 + i));

  if (!markets.length) {
    return {
      account, protocol: 'Venus', chain: 'eip155:56',
      has_position: false,
      note: 'This address has entered no Venus markets. Nothing to monitor — which is an answer, not a failure.',
      measured_at: new Date().toISOString(),
    };
  }

  // Round 2: everything each market knows about this account and about itself.
  const calls = [];
  for (const m of markets) {
    calls.push({ to: m, data: SEL.getAccountSnapshot + addrArg(account) });
    calls.push({ to: UNITROLLER, data: SEL.markets + addrArg(m) });
    calls.push({ to: oracle, data: SEL.getUnderlyingPrice + addrArg(m) });
    calls.push({ to: m, data: SEL.symbol });
  }
  const res = await batchCall(calls);

  let weightedCollateral = 0n; // collateral after the protocol's own haircut
  let rawCollateral = 0n;      // before it, so the haircut is visible
  let borrowed = 0n;
  const positions = [];

  for (let i = 0; i < markets.length; i++) {
    const snap = res[i * 4];
    const mkt = res[i * 4 + 1];
    const priceRaw = res[i * 4 + 2];
    const symbol = decodeString(res[i * 4 + 3]) || markets[i].slice(0, 8);

    const snapErr = Number(uint(snap, 0));
    if (snapErr !== 0) continue;
    const vTokens = uint(snap, 1);
    const borrow = uint(snap, 2);
    const exchangeRate = uint(snap, 3);
    const collateralFactor = uint(mkt, 1);
    const price = uint(priceRaw, 0);

    // The oracle scales its answer so that (underlying amount * price) / 1e18
    // lands in dollars regardless of the token's own decimals. Keeping every
    // intermediate in BigInt matters: a position of a few million with 18
    // decimals overflows a double long before it reaches a percentage.
    const underlying = (vTokens * exchangeRate) / S;      // underlying units
    const supplyUsd = (underlying * price) / S;
    const borrowUsd = (borrow * price) / S;
    const weightedUsd = (supplyUsd * collateralFactor) / S;

    rawCollateral += supplyUsd;
    weightedCollateral += weightedUsd;
    borrowed += borrowUsd;

    if (supplyUsd > 0n || borrowUsd > 0n) {
      positions.push({
        market: markets[i],
        symbol,
        supplied_usd: num(supplyUsd),
        borrowed_usd: num(borrowUsd),
        collateral_factor: Number(collateralFactor) / 1e18,
        counts_as_collateral_usd: num(weightedUsd),
      });
    }
  }

  // Venus's own arithmetic, as the check. liquidity and shortfall are mutually
  // exclusive, so their difference is the signed headroom the protocol sees.
  const venusHeadroom = venusLiquidity - venusShortfall;
  const ourHeadroom = weightedCollateral - borrowed;
  const drift = ourHeadroom - venusHeadroom;
  const driftAbs = drift < 0n ? -drift : drift;
  // A dollar of tolerance across a position that can run into the millions:
  // rounding in the per-market integer divisions is expected, disagreement is
  // not.
  const agrees = driftAbs <= S;

  const hf = borrowed === 0n ? null : Number(weightedCollateral * 10000n / borrowed) / 10000;

  return {
    account,
    protocol: 'Venus',
    chain: 'eip155:56',
    has_position: true,
    health_factor: hf,
    liquidatable: hf !== null && hf < 1,
    // What the number means, said plainly, because a bare 1.34 is not an answer
    // to "should I do something".
    verdict: hf === null
      ? 'Collateral supplied, nothing borrowed. A position with no debt cannot be liquidated.'
      : hf < 1 ? 'Below 1.0 — this position is liquidatable right now.'
      : hf < 1.15 ? 'Under 1.15 — a small adverse move liquidates this.'
      : hf < 1.5 ? 'Thin. Survivable, but not much room.'
      : 'Comfortable.',
    borrowed_usd: num(borrowed),
    collateral_usd: num(rawCollateral),
    collateral_after_haircut_usd: num(weightedCollateral),
    headroom_usd: num(ourHeadroom),
    markets_entered: markets.length,
    positions: positions.sort((a, b) => (b.supplied_usd + b.borrowed_usd) - (a.supplied_usd + a.borrowed_usd)),
    cross_check: {
      what: 'Our per-market arithmetic against the protocol\'s own getAccountLiquidity.',
      venus_headroom_usd: num(venusHeadroom),
      our_headroom_usd: num(ourHeadroom),
      difference_usd: num(drift),
      agrees,
      venus_error_code: venusError,
    },
    measured_at: new Date().toISOString(),
    source: 'Venus Comptroller ' + UNITROLLER + ', oracle ' + oracle,
  };
}

/**
 * How far the collateral can fall before liquidation, and what that means for
 * the price of the assets actually backing the position.
 *
 * A monitoring agent that only reports today's number is a dashboard. The
 * question somebody hires an agent for is "how much room do I have", and that
 * is answerable exactly: liquidation happens when weighted collateral equals
 * debt, so the tolerable drawdown is 1 − debt/weightedCollateral.
 */
export function drawdownToLiquidation(position) {
  if (!position?.has_position || position.health_factor === null) return null;
  const hf = position.health_factor;
  const tolerable = 1 - 1 / hf; // fraction the collateral may lose
  const stress = [5, 10, 15, 20, 30].map((pct) => ({
    collateral_drop_pct: pct,
    health_factor: Number((hf * (1 - pct / 100)).toFixed(4)),
    liquidatable: hf * (1 - pct / 100) < 1,
  }));
  return {
    tolerable_collateral_drop_pct: Number((tolerable * 100).toFixed(2)),
    note: 'Assumes the borrowed asset holds its price. A stablecoin debt against volatile collateral is the case this models; the reverse is not.',
    stress,
  };
}

export const VENUS = { UNITROLLER };

// Shared with the yield agent, which reads the same protocol through the same
// batched call and the same decoders. Two implementations of "read a Venus
// market" is how two of our own agents end up quoting different numbers for the
// same market on the same block — the failure this project has already fixed
// once for the BNB price and once for the pool arithmetic.
export const chain = { batchCall, decodeString, word, uint, addrAt, addrArg, SEL, RPCS };
