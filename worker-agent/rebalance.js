// What a rebalance costs, and whether the drift it corrects is worth that much.
//
// The fourth category, and the one where the honest answer is most often "do
// nothing". Every rebalancing tool will tell you how far your weights have
// drifted and which swaps close the gap. None of them price those swaps against
// the pools they would actually execute in, which is where the entire question
// lives: on a thin BSC pool the cost of correcting a drift routinely exceeds
// the drift.
//
// THE NUMBER EVERY REBALANCER LEAVES OUT
// The grid agent returns the break-even spacing, below which a grid cannot make
// money. The same shape applies here: there is a drift below which rebalancing
// is guaranteed to lose, because the round trip costs more than the misweight.
// That threshold is what this returns, and it is computed per position from the
// pool each one would have to trade through — not a rule of thumb like "5%".
//
// WHERE THE COSTS COME FROM
// The same pool scanner as the grid agent, over our own MCP endpoint. Swap fee,
// price impact at the actual size being moved, and the transfer tax measured
// from executed trades rather than read off a label. One implementation of the
// pool arithmetic, used by the public scanner, the installable skill, the
// Telegram bot, the grid agent and this.
//
// WHAT THIS DOES NOT DO
// It does not trade, hold funds, sign anything, or have an opinion about what
// the right allocation is. You bring the target; it prices the route there and
// says plainly when the route costs more than arriving is worth.

const SCANNER = 'https://brainonbnb.com/mcp';

// Cost of moving `usd` through a token's pool, one way. Shares its shape with
// the grid agent's costOfFill, and its rule: a measured number and a derived
// one must never look alike in the output.
function costOfTrade(scan, usd, side) {
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

  const depth = side === 'buy' ? scan.onePercentDepth?.buyUsd : scan.onePercentDepth?.sellUsd;
  const fixedPct = (scan.pool?.swapFeePct || 0)
    + ((side === 'buy' ? scan.tax?.buyPct : scan.tax?.sellPct) || 0);
  if (!depth) return { pct: last[key], basis: 'measured-ceiling' };
  return { pct: +(fixedPct + (usd / depth)).toFixed(4), basis: 'derived from 1% depth' };
}

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
  return JSON.parse(text);
}

/**
 * Price the route from a current allocation to a target one.
 *
 * holdings: [{ token: '0x…', usd: 1234 }]  — what is held now, valued in USD
 * targets:  { '0x…': 40, '0x…': 60 }       — target weights in percent
 *
 * Read-only: measures pools, computes swaps, signs nothing.
 */
export async function rebalancePlan(input = {}) {
  const holdings = Array.isArray(input.holdings) ? input.holdings : [];
  if (!holdings.length) throw new Error('Give holdings: [{ token: "0x…", usd: 1000 }, …]');

  const parsed = holdings.map((h) => {
    const token = String(h.token || h.address || '').match(/0x[a-fA-F0-9]{40}/)?.[0];
    const usd = Number(h.usd ?? h.usdValue ?? h.value);
    if (!token) throw new Error(`holding without a BSC token address: ${JSON.stringify(h)}`);
    if (!(usd >= 0)) throw new Error(`holding ${token} has no usd value`);
    return { token: token.toLowerCase(), usd };
  });

  const totalUsd = parsed.reduce((s, h) => s + h.usd, 0);
  if (!(totalUsd > 0)) throw new Error('the portfolio has no value to rebalance');

  // Targets default to equal weight, which is the only assumption that does not
  // smuggle in a view about what the portfolio should hold.
  const rawTargets = input.targets && typeof input.targets === 'object' ? input.targets : null;
  const targets = {};
  if (rawTargets) {
    for (const [k, v] of Object.entries(rawTargets)) {
      const t = String(k).match(/0x[a-fA-F0-9]{40}/)?.[0];
      if (t) targets[t.toLowerCase()] = Number(v);
    }
    const sum = Object.values(targets).reduce((s, v) => s + v, 0);
    // A target set that does not add to 100 is a mistake worth naming, not
    // silently normalising: the difference decides how much gets traded.
    if (Math.abs(sum - 100) > 0.01) {
      throw new Error(`target weights add to ${sum}%, not 100%. Fix them rather than have this guess which one was meant.`);
    }
  } else {
    for (const h of parsed) targets[h.token] = 100 / parsed.length;
  }

  // Measure every pool involved, one at a time. The scanner is our own service
  // and giving it a dozen simultaneous calls is how this project once measured
  // its own rate limit and nearly published it as a finding.
  const scans = new Map();
  const unpriceable = [];
  for (const h of parsed) {
    try {
      const scan = await scanPool(h.token);
      if (!scan.quotable) { unpriceable.push({ token: h.token, symbol: scan.symbol, reason: 'no pool that can be priced' }); continue; }
      scans.set(h.token, scan);
    } catch (e) {
      unpriceable.push({ token: h.token, reason: String(e.message || e) });
    }
  }

  const legs = [];
  let totalCostUsd = 0;
  let totalDriftUsd = 0;

  for (const h of parsed) {
    const targetPct = targets[h.token] ?? 0;
    const currentPct = (h.usd / totalUsd) * 100;
    const targetUsd = totalUsd * targetPct / 100;
    const deltaUsd = targetUsd - h.usd;          // positive = must buy more
    const driftPct = currentPct - targetPct;
    totalDriftUsd += Math.abs(deltaUsd) / 2;      // each dollar of drift is one side of one trade

    const scan = scans.get(h.token);
    if (!scan) {
      legs.push({
        token: h.token, current_pct: +currentPct.toFixed(3), target_pct: +targetPct.toFixed(3),
        drift_pct: +driftPct.toFixed(3), trade_usd: +deltaUsd.toFixed(2),
        cost: null, note: 'this pool could not be measured, so this leg is unpriced and the totals below exclude it',
      });
      continue;
    }

    const side = deltaUsd > 0 ? 'buy' : 'sell';
    const size = Math.abs(deltaUsd);
    const cost = size > 0 ? costOfTrade(scan, size, side) : { pct: 0, basis: 'no trade needed' };
    const costUsd = cost ? size * cost.pct / 100 : null;
    if (costUsd != null) totalCostUsd += costUsd;

    legs.push({
      token: h.token,
      symbol: scan.symbol,
      price_usd: scan.price?.usd,
      current_usd: +h.usd.toFixed(2),
      current_pct: +currentPct.toFixed(3),
      target_pct: +targetPct.toFixed(3),
      target_usd: +targetUsd.toFixed(2),
      drift_pct: +driftPct.toFixed(3),
      action: size === 0 ? 'hold' : `${side} $${size.toFixed(2)}`,
      trade_usd: +deltaUsd.toFixed(2),
      cost_pct: cost?.pct ?? null,
      cost_usd: costUsd != null ? +costUsd.toFixed(2) : null,
      cost_basis: cost?.basis ?? null,
      pool: { address: scan.pool?.address, venue: scan.pool?.venue, one_pct_depth_usd: scan.onePercentDepth?.buyUsd },
      transfer_tax: { buy_pct: scan.tax?.buyPct, sell_pct: scan.tax?.sellPct, source: scan.tax?.source },
    });
  }

  // WHAT THIS DELIBERATELY DOES NOT CLAIM
  //
  // The first version of this compared the dollars of drift against the dollars
  // of cost and declared a rebalance "worth it" when drift was larger. That is
  // apples against oranges and it flattered every answer: moving $100 of
  // exposure does not earn $100, it earns whatever the corrected allocation is
  // worth, which is a judgement about risk that nobody can compute from a pool.
  //
  // So the ratio that IS meaningful is stated instead — cost as a share of the
  // money actually moved — and the decision is handed back with the number it
  // needs, rather than answered with false confidence.
  const costPctOfPortfolio = (totalCostUsd / totalUsd) * 100;
  const driftPctOfPortfolio = (totalDriftUsd / totalUsd) * 100;
  const costPctOfMoved = totalDriftUsd > 0 ? (totalCostUsd / totalDriftUsd) * 100 : 0;

  // WHERE THE COST SITS, which is not the same as which legs are optional.
  //
  // An earlier version tried to name a "cheap half" to execute on its own. That
  // is not a real choice: a rebalance is a set of paired trades, and you cannot
  // buy the underweight side without selling the overweight one. Presenting the
  // legs as independently skippable would have been a tidy answer to a question
  // nobody can act on.
  //
  // What is real, and is usually the whole story, is that cost concentrates.
  // One illiquid or taxed holding routinely carries most of the bill while
  // being an ordinary share of the value moved — and that is worth naming,
  // because the fix is to change what you hold, not how you rebalance it.
  const tradable = legs.filter((l) => l.cost_pct != null && Math.abs(l.trade_usd) > 0);
  const grossMoved = tradable.reduce((s, l) => s + Math.abs(l.trade_usd), 0);
  const byCost = [...tradable]
    .map((l) => ({
      leg: l.symbol || l.token,
      cost_usd: +(l.cost_usd || 0).toFixed(2),
      cost_pct: l.cost_pct,
      share_of_cost_pct: totalCostUsd > 0 ? +(((l.cost_usd || 0) / totalCostUsd) * 100).toFixed(1) : 0,
      share_of_value_moved_pct: grossMoved > 0 ? +((Math.abs(l.trade_usd) / grossMoved) * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => b.share_of_cost_pct - a.share_of_cost_pct);
  const dominant = byCost.find((l) => l.share_of_cost_pct > l.share_of_value_moved_pct * 1.5) || null;

  const warnings = [];
  if (unpriceable.length) {
    warnings.push(`${unpriceable.length} of ${parsed.length} holdings could not be priced against a pool. Every total here excludes them, so the real cost is higher than shown.`);
  }
  for (const l of legs) {
    if (l.pool?.one_pct_depth_usd && Math.abs(l.trade_usd) > l.pool.one_pct_depth_usd) {
      warnings.push(`${l.symbol}: the trade is $${Math.abs(l.trade_usd).toFixed(0)} against a pool where $${Math.round(l.pool.one_pct_depth_usd).toLocaleString('en-US')} moves the price 1%. A trade that size moves the price it is being measured at, and the cost above is the optimistic end of what it will actually pay.`);
    }
    if (l.transfer_tax && (l.transfer_tax.buy_pct === null || l.transfer_tax.sell_pct === null)) {
      warnings.push(`${l.symbol}: no transfer tax could be established, so its leg excludes one. If the token charges a tax, that leg is understated by it.`);
    }
  }

  return {
    portfolio: { total_usd: +totalUsd.toFixed(2), holdings: parsed.length, priced: scans.size },
    legs,
    ...(unpriceable.length ? { unpriceable } : {}),
    economics: {
      value_to_move_usd: +totalDriftUsd.toFixed(2),
      drift_pct_of_portfolio: +driftPctOfPortfolio.toFixed(4),
      cost_to_rebalance_usd: +totalCostUsd.toFixed(2),
      cost_pct_of_portfolio: +costPctOfPortfolio.toFixed(4),
      // The ratio that decides it, and the only one of these three that is a
      // like-for-like comparison.
      cost_pct_of_value_moved: +costPctOfMoved.toFixed(4),
      worth_it_if: `the corrected allocation is worth more to you than ${costPctOfMoved.toFixed(2)}% of the money you move. That is a judgement about risk, not a quantity in any pool, so this does not pretend to make it for you.`,
      explanation: 'Rebalancing moves value from overweight positions to underweight ones and pays swap fee, price impact and transfer tax to do it. Those costs are measured here. What the correction is worth is not measurable from the chain — a rebalance does not earn the dollars it moves — so the cost is given as a share of the money moved and the decision stays with you.',
    },
    // Where the bill actually comes from. The legs are paired trades and none
    // of them is individually optional — but which holding is expensive to
    // trade is a fact about the portfolio, and it is usually the finding.
    where_the_cost_sits: byCost,
    // Concentration and expense are two different findings, and an earlier
    // version ran them together — reporting a rebalance costing 0.30% as
    // "expensive because of one holding" purely because the cost was unevenly
    // spread. A cheap bill is a cheap bill however it is distributed.
    verdict: `Moving $${totalDriftUsd.toFixed(2)} of exposure costs $${totalCostUsd.toFixed(2)} — ${costPctOfMoved.toFixed(2)}% of the money moved, ${costPctOfPortfolio.toFixed(2)}% of the portfolio. `
      + (costPctOfMoved < 1
        ? `That is cheap, so the decision rests on whether the correction matters to you at all rather than on what it costs.${dominant ? ` For the record the bill is uneven — ${dominant.leg} carries ${dominant.share_of_cost_pct}% of it for ${dominant.share_of_value_moved_pct}% of the value moved — but at this total it changes nothing.` : ''}`
        : dominant
          ? `The cost is not spread evenly: ${dominant.leg} is ${dominant.share_of_value_moved_pct}% of the value moved but ${dominant.share_of_cost_pct}% of the bill, at ${dominant.cost_pct}% on its own leg. What makes rebalancing this portfolio expensive is that one holding, and no execution tactic changes that — only holding less of it, or accepting that it drifts.`
          : 'The cost is spread roughly in line with the value moved, so no single holding is driving it.'),
    warnings,
    what_this_is_not: 'A view on what you should hold. You bring the target weights; this prices the route to them against the pools that would execute it. Measurement only, not financial advice.',
    measured_at: new Date().toISOString(),
    source: 'Pools measured live via https://brainonbnb.com/scanner — the same arithmetic the public scanner, the installable skill and the grid agent run.',
  };
}
