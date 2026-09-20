// Grid trading parameters for any BNB Chain pool, costed against the real pool.
//
// This is the second of the four categories the marketplace has to cover, and
// like the health-factor agent it computes rather than claims.
//
// THE NUMBER EVERY GRID BOT LEAVES OUT
// A grid earns the spacing between two levels and pays the round trip to get
// there: buy at level n, sell at level n+1. The round trip costs the swap fee
// twice, the price impact of each fill, and the transfer tax twice if the token
// charges one. If the spacing is narrower than that, every completed cycle
// loses money — reliably, quietly, and faster the better the grid "performs",
// because more fills means more losses.
//
// So the first thing this returns is the break-even spacing. A grid tighter
// than that number cannot work on that pool, no matter how it is tuned, and
// saying so is worth more than any parameter set.
//
// WHERE THE COSTS COME FROM
// The pool scanner behind brainonbnb.com/scanner, called over our own MCP
// endpoint. One implementation of the pool arithmetic, used by the page, the
// installable skill, the Telegram bot and now this — the same rule that made
// the BNB price a single Chainlink read everywhere. Costs come back MEASURED:
// the transfer tax is read from executed trades rather than from a label,
// because those disagree, sometimes by more than a point.
//
// WHAT THIS DOES NOT DO
// It does not trade, hold funds, or tell anybody what a price will do. It sizes
// a grid against measured liquidity and states what that grid costs to run. The
// direction of the market is not a thing we can measure, so we do not sell it.

const SCANNER = 'https://brainonbnb.com/mcp';

// Ten levels over a ±15% band is the shape most grid UIs default to. Kept as a
// default rather than a recommendation: the interesting output is what that
// costs, not the shape itself.
const DEFAULTS = { levels: 10, bandPct: 15, capitalUsd: 1000 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

async function scanPool(address) {
  const r = await fetch(SCANNER, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'bsc_pool_scan', arguments: { address } },
    }),
    signal: AbortSignal.timeout(45000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'the pool could not be measured');
  const text = j.result?.content?.[0]?.text;
  if (!text) throw new Error('the scanner returned nothing readable');
  // A tool that could not answer says why in plain words with isError set
  // (MCP's way). Parsing that as JSON turned "every BSC endpoint refused …"
  // into "Unexpected token 'e'" — and a throttled node into a fault of ours
  // on the readiness check (2026-09-20).
  if (j.result?.isError) throw new Error(String(text).slice(0, 300));
  const scan = JSON.parse(text);
  if (!scan.quotable) throw new Error(`${scan.symbol || address} has no pool that can be priced`);
  return scan;
}

// What one fill of `usd` actually costs, in percent, as a one-way trade.
//
// The scanner measures a fixed ladder of sizes. Inside that ladder the answer is
// interpolated between two measurements; beyond it, it is derived from the
// pool's 1%-depth, which for a constant-product pool is a straight line through
// the origin. The two cases are labelled differently in the output on purpose —
// a measured number and a derived one should never look alike.
function costOfFill(scan, usd, side) {
  const key = side === 'buy' ? 'buyCostPct' : 'sellCostPct';
  const rows = (scan.tradeCost || []).filter((r) => typeof r[key] === 'number');
  if (!rows.length) return null;

  const first = rows[0];
  const last = rows[rows.length - 1];

  if (usd <= first.sizeUsd) return { pct: first[key], basis: 'measured' };

  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (usd <= b.sizeUsd) {
      const t = (usd - a.sizeUsd) / (b.sizeUsd - a.sizeUsd);
      return { pct: +(a[key] + t * (b[key] - a[key])).toFixed(4), basis: 'measured' };
    }
  }

  // Past the measured ladder. Split the last measurement into its fixed part
  // (swap fee plus tax, which do not grow with size) and its impact part, then
  // scale only the impact.
  const depth = side === 'buy' ? scan.onePercentDepth?.buyUsd : scan.onePercentDepth?.sellUsd;
  const fixedPct = (scan.pool?.swapFeePct || 0)
    + ((side === 'buy' ? scan.tax?.buyPct : scan.tax?.sellPct) || 0);
  if (!depth) return { pct: last[key], basis: 'measured-ceiling' };
  const impactPct = (usd / depth) * 1;
  return { pct: +(fixedPct + impactPct).toFixed(4), basis: 'derived from 1% depth' };
}

/**
 * Plan a grid and cost it against the live pool.
 * Read-only: measures, computes, and signs nothing.
 */
export async function gridPlan(input = {}) {
  const address = String(input.token || input.address || '').match(/0x[a-fA-F0-9]{40}/)?.[0];
  if (!address) throw new Error('Give a BSC token or pool address.');

  const levels = Math.round(clamp(Number(input.levels) || DEFAULTS.levels, 2, 100));
  const bandPct = clamp(Number(input.bandPct) || DEFAULTS.bandPct, 0.5, 90);
  const capitalUsd = clamp(Number(input.capitalUsd) || DEFAULTS.capitalUsd, 10, 10_000_000);

  const scan = await scanPool(address);
  const price = scan.price?.usd;
  if (!price) throw new Error('no live price for that pool');

  // Geometric spacing, not arithmetic. A grid earns a percentage per cycle, so
  // the levels have to be a percentage apart — evenly spaced dollars would make
  // the bottom of the range earn several times what the top earns, on the same
  // capital, and no explanation of the result would make sense.
  const low = price * (1 - bandPct / 100);
  const high = price * (1 + bandPct / 100);
  const ratio = Math.pow(high / low, 1 / (levels - 1));
  const spacingPct = (ratio - 1) * 100;

  const perLevelUsd = capitalUsd / levels;
  const buy = costOfFill(scan, perLevelUsd, 'buy');
  const sell = costOfFill(scan, perLevelUsd, 'sell');
  if (!buy || !sell) throw new Error('the pool could not be costed at that size');

  const roundTripPct = +(buy.pct + sell.pct).toFixed(4);
  const netPerCyclePct = +(spacingPct - roundTripPct).toFixed(4);
  const viable = netPerCyclePct > 0;

  // The spacing at which a cycle breaks exactly even, and the widest grid that
  // still fits in the band at that spacing. Both are what somebody actually
  // needs in order to fix an unviable grid.
  const breakEvenSpacingPct = roundTripPct;
  const maxLevelsAtBreakEven = Math.max(2, Math.floor(
    Math.log(high / low) / Math.log(1 + breakEvenSpacingPct / 100) + 1,
  ));

  const gridLevels = [];
  for (let i = 0; i < levels; i++) {
    const p = low * Math.pow(ratio, i);
    gridLevels.push({
      level: i + 1,
      price: +p.toPrecision(8),
      side: p < price ? 'buy' : 'sell',
      capital_usd: +perLevelUsd.toFixed(2),
    });
  }

  // A grid level big enough to move the price it is trading against is not a
  // grid level, it is the market. Worth saying out loud, because the capital
  // figure that triggers it looks perfectly reasonable on a thin pool.
  const depthRef = scan.onePercentDepth?.buyUsd || 0;
  const shareOfDepth = depthRef ? perLevelUsd / depthRef : null;

  const warnings = [];
  if (!viable) {
    warnings.push(`At ${levels} levels across ±${bandPct}% the spacing is ${spacingPct.toFixed(3)}% and one round trip costs ${roundTripPct.toFixed(3)}%. Every completed cycle loses ${Math.abs(netPerCyclePct).toFixed(3)}%. This grid cannot be tuned into profit — it needs fewer levels, a wider band, or a deeper pool.`);
  }
  if (shareOfDepth != null && shareOfDepth > 0.25) {
    warnings.push(`Each fill is ${(shareOfDepth * 100).toFixed(0)}% of the size that moves this pool 1%. Fills of that size move the price against the next fill, and the cost figures here do not model a grid trading against itself.`);
  }
  if (scan.tax?.buyPct === null || scan.tax?.sellPct === null) {
    warnings.push('No transfer tax could be established for this token, so the costs above exclude it. If it charges one, every figure here is optimistic by twice that rate.');
  }
  if (scan.pool?.partialMarket) {
    warnings.push('Only part of this token\'s liquidity sits in the pool that was read, so real costs may be lower than shown.');
  }

  return {
    token: { address: scan.address, symbol: scan.symbol, name: scan.name, price_usd: price },
    pool: {
      address: scan.pool?.address, venue: scan.pool?.venue,
      swap_fee_pct: scan.pool?.swapFeePct,
      liquidity_usd: scan.pool?.liquidityUsd,
      one_pct_depth_usd: scan.onePercentDepth?.buyUsd,
    },
    transfer_tax: {
      buy_pct: scan.tax?.buyPct, sell_pct: scan.tax?.sellPct,
      source: scan.tax?.source,
    },
    grid: {
      levels, band_pct: bandPct, capital_usd: capitalUsd,
      lower_price: +low.toPrecision(8), upper_price: +high.toPrecision(8),
      spacing_pct: +spacingPct.toFixed(4),
      capital_per_level_usd: +perLevelUsd.toFixed(2),
      prices: gridLevels,
    },
    // The whole point of the exercise.
    economics: {
      cost_per_buy_pct: buy.pct,
      cost_per_sell_pct: sell.pct,
      cost_basis: buy.basis === sell.basis ? buy.basis : `${buy.basis} / ${sell.basis}`,
      round_trip_cost_pct: roundTripPct,
      net_per_completed_cycle_pct: netPerCyclePct,
      net_per_completed_cycle_usd: +(perLevelUsd * netPerCyclePct / 100).toFixed(4),
      viable,
      break_even_spacing_pct: +breakEvenSpacingPct.toFixed(4),
      max_levels_that_still_break_even: maxLevelsAtBreakEven,
      explanation: 'A cycle is one buy at a level and one sell at the level above. It earns the spacing and pays the round trip: swap fee twice, price impact of each fill, and the transfer tax twice where the token charges one. Spacing below the round-trip cost loses money on every fill.',
    },
    warnings,
    what_this_is_not: 'A view on the price. Nothing here predicts direction — it sizes a grid against measured liquidity and states what running it costs. Measurement only, not financial advice.',
    measured_at: new Date().toISOString(),
    source: 'Pool measured live via https://brainonbnb.com/scanner — the same arithmetic the public scanner and the installable skill run.',
  };
}
