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

import { createPublicClient, http, fallback } from 'viem';
import { bsc } from 'viem/chains';
import { RPCS, readBnbUsd } from '../shared/lp-agent.js';

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
  // A tool that could not answer says why in plain words with isError set
  // (MCP's way). Parsing that as JSON turned "every BSC endpoint refused …"
  // into "Unexpected token 'e'" — and a throttled node into a fault of ours
  // on the readiness check (2026-09-20).
  if (j.result?.isError) throw new Error(String(text).slice(0, 300));
  return JSON.parse(text);
}

// THE PORTFOLIO WHEN NOTHING IS NAMED (2026-10-15). Mandate's "Hire for $0.10" on the Portfolio Rebalance Pricer
// (#304494) pays every day and sends no words; it was refused each time ("needs `holdings`", nothing charged) and the
// page lists "Refused a payment" day after day. As the DeFi agent and the health monitor do since 2026-10-14, the
// paying wallet is the input: what it holds of the main BNB Chain tokens, read from the chain and valued in dollars
// (stablecoins at 1, BNB at Chainlink, the rest at their pool). A wallet holding none of them gets the plan for the
// DeFi agent's own wallet, said so. Equal weight stays the target, as for any portfolio given without one.
const DEFAULT_TOKENS = [
  ['WBNB', '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'], ['USDT', '0x55d398326f99059fF775485246999027B3197955'],
  ['USDC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'], ['USD1', '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d'],
  ['BTCB', '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c'], ['ETH', '0x2170Ed0880ac9A755fd29B2688956BD959F933F8'],
  ['CAKE', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'], ['BOBAI', '0x245c386dcfed896f5c346107596141e5edcbffff'],
];
const STABLE = new Set(['USDT', 'USDC', 'USD1']);
const OWN_WALLET = '0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A';
async function walletHoldings(addr) {
  const pub = createPublicClient({ chain: bsc, transport: fallback(RPCS.map((u) => http(u, { timeout: 15000 }))) });
  const erc20 = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }];
  const [native, ...bals] = await Promise.all([pub.getBalance({ address: addr }), ...DEFAULT_TOKENS.map(([, t]) => pub.readContract({ address: t, abi: erc20, functionName: 'balanceOf', args: [addr] }))]);
  const { bnbUsd } = await readBnbUsd(pub);
  const out = [];
  for (let i = 0; i < DEFAULT_TOKENS.length; i++) {
    const [sym, token] = DEFAULT_TOKENS[i];
    const units = Number(bals[i] + (sym === 'WBNB' ? native : 0n)) / 1e18; // all eight carry 18 decimals on BNB Chain; native BNB counts as WBNB
    if (!(units > 0)) continue;
    const px = STABLE.has(sym) ? 1 : sym === 'WBNB' ? bnbUsd : await scanPool(token).then((s) => s.price?.usd).catch(() => null);
    const usd = px ? units * px : 0;
    if (usd >= 1) out.push({ token, symbol: sym, units: +units.toPrecision(8), usd: +usd.toFixed(2) });
  }
  return out;
}
export async function rebalanceDefaultTarget(payer) {
  const p = /^0x[a-fA-F0-9]{40}$/.test(String(payer || '')) ? payer : null;
  const mine = p ? await walletHoldings(p).catch(() => []) : [];
  if (mine.length >= 2) return { holdings: mine, target: `no holdings were named: this prices the paying wallet ${p} — ${mine.map((h) => `${h.symbol} $${h.usd}`).join(', ')} — to equal weight, read from the chain now` };
  const own = await walletHoldings(OWN_WALLET);
  return { holdings: own, target: `no holdings were named and the paying wallet holds ${mine.length ? 'one' : 'none'} of the main BNB Chain tokens worth a dollar: this prices the DeFi agent's own wallet ${OWN_WALLET} — ${own.map((h) => `${h.symbol} $${h.usd}`).join(', ')} — to equal weight; name yours with holdings: [{ token, usd }]` };
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
  // A TARGET THE PORTFOLIO DOES NOT HOLD YET IS STILL A LEG (2026-09-18). The
  // legs were built from the holdings alone: holding A with targets {A: 50,
  // B: 50} came back as one leg, "sell $500 of A" — no buy of B, its cost
  // missing from the total and the value to move read at half. Every target
  // token joins the list at a holding of zero.
  for (const t of Object.keys(targets)) {
    if (targets[t] > 0 && !parsed.some((h) => h.token === t)) parsed.push({ token: t, usd: 0, not_held_yet: true });
  }

  // Measure every pool involved. The scanner is our own service
  // and giving it a dozen simultaneous calls is how this project once measured
  // its own rate limit and nearly published it as a finding.
  const scans = new Map();
  const unpriceable = [];
  // At most three at a time (2026-10-06): one after another, a two-token rebalance waited for two full scans in a row
  // (36 s on the Worker); three keeps the scanner far from the dozen-at-once that once tripped its limit. The order
  // of the results stays the order of the holdings.
  const results = new Array(parsed.length);
  let nextIdx = 0;
  const lane = async () => { while (nextIdx < parsed.length) { const i = nextIdx++; try { results[i] = { scan: await scanPool(parsed[i].token) }; } catch (e) { results[i] = { err: e }; } } };
  await Promise.all(Array.from({ length: Math.min(3, parsed.length) }, lane));
  parsed.forEach((h, i) => {
    const r = results[i];
    if (r.err) { unpriceable.push({ token: h.token, reason: String(r.err.message || r.err) }); return; }
    if (!r.scan.quotable) { unpriceable.push({ token: h.token, symbol: r.scan.symbol, reason: 'no pool that can be priced' }); return; }
    scans.set(h.token, r.scan);
  });

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
