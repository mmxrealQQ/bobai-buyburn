// bsc_token_preflight — the two questions an agent has before it signs, in one
// call and at ITS size: can I get in, and can I get out again — and what does
// the trip cost.
//
// Nothing here is measured twice or differently. It asks the pool scan
// (scanner-scan.js: depth, the transfer tax from executed trades, the sell
// simulation from a fresh address, LP burned, contract flags) and the route
// check (swap-route.js: which pool returns the most AT THIS SIZE, the round
// trip with the tax applied, the slippage this size needs), and puts what an
// agent decides on into one short answer: what stops the trade, what to weigh,
// the figures, and what it cannot see. Six kilobytes and three of the scan and
// the route become about three (one and a half until 2026-09-27, when who holds
// the LP, the pool's age and its last hour of swaps joined it).
//
// WHY A THIRD TOOL OVER TWO THAT EXIST (2026-09-20). An agent that trades asks
// this before every trade, and "call two tools, join them on the pool address
// and work out which field stops you" is a step most callers skip. The two
// long answers stay for whoever wants every figure; this one names them under
// `details`.
//
// It does not say "safe" and does not return a score. `stop` lists facts that
// end an automated trade (the sell does not go through, nothing quotes, half
// the money is gone on the round trip). `caution` lists facts with the figure
// and the threshold in the sentence, so the caller can disagree with the line.
import { scan, ScanError } from './scanner-scan.js';
import { swapRoute } from './swap-route.js';

export class PreflightError extends Error {
  constructor(headline, detail) { super(headline); this.headline = headline; this.detail = detail; }
}

const DEFAULT_USD = 250;
const HIGH_TAX_PCT = 10;         // one side; named in the sentence
const THIN_POOL_USD = 250000;    // below this an unburned LP is worth a line
const LP_PULL_PCT = 10;          // one wallet holding this much of the LP is named
const round = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : +n.toFixed(d));

// The cost of a size the ladder does not carry, read between the two rungs
// around it. Used only when the route check could not answer (a venue outside
// PancakeSwap, or the request ran out of outbound calls).
export function costAtSize(rows, usd, key) {
  const pts = (rows || []).filter((r) => r && r[key] != null).sort((a, b) => a.sizeUsd - b.sizeUsd);
  if (!pts.length) return { pct: null, beyondLadder: false };
  if (usd <= pts[0].sizeUsd) return { pct: pts[0][key], beyondLadder: false };
  const last = pts[pts.length - 1];
  if (usd >= last.sizeUsd) return { pct: last[key], beyondLadder: usd > last.sizeUsd };
  const i = pts.findIndex((p) => p.sizeUsd >= usd);
  const a = pts[i - 1], b = pts[i];
  return { pct: a[key] + ((b[key] - a[key]) * (usd - a.sizeUsd)) / (b.sizeUsd - a.sizeUsd), beyondLadder: false };
}

// The shaping, apart from the chain, so it can be pinned offline: `s` is a
// pool-scan answer, `r` a route answer or null, `routeError` why it is null.
export function shape(s, r, usd, routeError = null) {
  const stop = [], caution = [];
  const details = {
    pool_scan: `https://brainonbnb.com/api/pool-scan?address=${s.address}`,
    best_route: `https://brainonbnb.com/api/best-route?address=${s.address}&usd=${usd}`,
  };
  const head = { tool: 'bsc_token_preflight', token: { address: s.address, symbol: s.symbol ?? null, name: s.name ?? null }, size_usd: usd };

  // Still on its four.meme curve: no pool, no route — the curve's own figures.
  if (!s.quotable && s.curve) {
    const c = s.curve;
    const buy = costAtSize(c.tradeCost, usd, 'buyCostPct'), sell = costAtSize(c.tradeCost, usd, 'sellCostPct');
    if (!c.sellQuoted) stop.push({ code: 'sell_not_quotable', why: 'four.meme’s contract returned no sell quote at any size asked.' });
    caution.push({ code: 'on_launch_curve', why: `Still raising on four.meme (${c.progressPct ?? '?'}% of the raise): trades go through four.meme’s contract, not a pool, and the price path changes when the raise completes and the token lists on PancakeSwap.` });
    if (buy.beyondLadder || sell.beyondLadder) caution.push({ code: 'size_beyond_ladder', why: `$${usd} is larger than the largest size measured; the cost shown is the largest rung’s and the real one is higher.` });
    return { ...head, venue: 'four.meme bonding curve', stop, caution,
      entry: { cost_pct: round(buy.pct, 3), fee_pct: c.feePct ?? null },
      exit: { sell_quoted: !!c.sellQuoted, cost_pct: round(sell.pct, 3) },
      cannot_see: ['What the token does after it lists: its transfer tax and its owner’s powers only show once there is a pool to measure.'],
      details, disclaimer: 'Measurement, not advice. Figures are for this block.' };
  }

  if (!s.quotable) {
    stop.push({ code: 'not_quotable', why: s.reason || 'No pool that could be read describes this token’s market.' });
    return { ...head, stop, caution, entry: null, exit: null,
      ...(s.liquidity ? { liquidity: s.liquidity } : {}),
      details, disclaimer: 'Measurement, not advice. Figures are for this block.' };
  }

  // ---- exit first: a buy that works and a sell that does not is the trap
  // A test that had to go through the token's side pair against BNB (the
  // scanner names the pair it traded) is a fact about THAT pair. It neither
  // stops a trade in the pool measured here nor clears it: a sell block tied
  // to the main pool does not show on a side pair, and a dead side pair
  // reverts on a token that sells fine.
  const sim = s.sellability || {};
  const simHere = sim.ok && sim.through_scanned_pool !== false;
  if (simHere && sim.sellable === false)
    stop.push({ code: 'not_sellable', why: `A test balance sold on the router from a fresh address did not go through${sim.sell_error ? `: ${String(sim.sell_error).slice(0, 140)}` : '.'}` });
  if (simHere && sim.buyable === false)
    stop.push({ code: 'not_buyable', why: `A test buy on the router did not go through${sim.buy_error ? `: ${String(sim.buy_error).slice(0, 140)}` : '.'}` });
  if (!sim.ok) caution.push({ code: 'sell_not_simulated', why: `The sell simulation did not run${sim.reason ? ` (${String(sim.reason).slice(0, 120)})` : ''} — that is "not checked", never "sellable".` });
  else if (!simHere) caution.push({ code: 'sell_tested_on_another_pair', why: `The sell test could not trade through the pool measured here; it went through this token’s PancakeSwap V2 pair against BNB (${sim.pair}) and ${sim.sellable === false ? 'did NOT go through there' : 'went through there'}. That says nothing certain about the pool you would trade in — "not checked" for it.` });
  for (const why of (r?.refuse_to_trade || [])) stop.push({ code: 'round_trip', why });

  // ---- the tax
  const t = s.tax || {};
  // Each side's number stays with the source it came from: the route's where
  // the route has one, the scan's otherwise — never the scan's figure under
  // the route's sentence ("0%, not measurable" was one answer, 2026-09-21).
  const fromRoute = (k) => r?.transfer_tax?.[k] != null;
  const taxBuy = fromRoute('buy_pct') ? r.transfer_tax.buy_pct : t.buyPct ?? null;
  const taxSell = fromRoute('sell_pct') ? r.transfer_tax.sell_pct : t.sellPct ?? null;
  const WORDS = { measured: 'measured from executed trades on-chain', simulated: 'simulated on-chain at this block, from a fresh address', label: 'labelled by GoPlus, unverified', unknown: 'unknown — nothing could establish it' };
  const sideSource = (k, scanSide) => (fromRoute(k) ? r.transfer_tax.source : WORDS[scanSide] || t.source || null);
  const buySource = sideSource('buy_pct', t.buySource), sellSource = sideSource('sell_pct', t.sellSource);
  for (const [side, v, src] of [['buy', taxBuy, t.buySource], ['sell', taxSell, t.sellSource]]) {
    if (fromRoute(`${side}_pct`)) continue;
    if (v != null && src === 'label') caution.push({ code: `${side}_tax_label_only`, why: `The ${side} tax of ${v}% is a GoPlus label: no executed ${side} could be read and no simulation ran for it. A label has read 0% on tokens that charged more.` });
    else if (v == null && (taxBuy != null || taxSell != null)) caution.push({ code: `${side}_tax_unknown`, why: `No ${side} tax could be established — only the other side was. The costs below exclude it on the ${side}.` });
  }
  if (taxBuy == null && taxSell == null)
    caution.push({ code: 'tax_unknown', why: 'No transfer tax could be established, neither from executed trades nor by simulation. The costs below exclude it; if the token takes a cut, the trade costs more and needs about 1500 bps of slippage.' });
  for (const [side, v] of [['buy', taxBuy], ['sell', taxSell]])
    if (v != null && v >= HIGH_TAX_PCT) caution.push({ code: `high_${side}_tax`, why: `The token takes ${v}% on every ${side} (line drawn at ${HIGH_TAX_PCT}%).` });
  const props = s.contract?.properties || {};
  if (props.slippage_modifiable === true && (taxBuy > 0 || taxSell > 0 || taxBuy == null))
    caution.push({ code: 'tax_can_change', why: 'The contract lets its owner change the transfer tax: the figure measured now is not a promise.' });

  // ---- the size against the depth
  const d = s.onePercentDepth || {};
  const thinSide = Math.min(d.buyUsd ?? Infinity, d.sellUsd ?? Infinity);
  if (Number.isFinite(thinSide) && usd > thinSide)
    caution.push({ code: 'size_moves_price', why: `$${usd} is more than the $${thinSide} that moves this pool’s price by 1%: you are the market at this size.` });
  if (s.deeperPoolElsewhere)
    caution.push({ code: 'deeper_pool_elsewhere', why: `A deeper pool for this token exists (${s.deeperPoolElsewhere.pair}, about $${s.deeperPoolElsewhere.liquidityUsd} hard side) than the one measured.` });
  if (s.pool?.partialMarket)
    caution.push({ code: 'partial_market', why: `The pool measured holds ${round((s.pool.shareOfLiquidity || 0) * 100, 1)}% of this token’s liquidity; the rest trades elsewhere.` });

  // ---- who can pull what
  // WHO HOLDS THE LP, by name (2026-09-27). The scan now reads the LP ledger
  // (lp.custody): complete for a pair younger than the hour of logs a public
  // node serves, candidates-only for an older one. Where it attributed most of
  // the LP, the sentence names the wallet and its share instead of inferring
  // "whoever holds the rest" from the burned share alone — AIMU, 34 minutes
  // old, has one wallet, its creator, holding 100% of the LP, and that is the
  // line an agent needs. Only where the read did not cover half does the old
  // burned-share line stand in for it.
  const cu = s.lp?.custody;
  const cuRead = cu && (cu.read === 'complete' || (cu.unreadPct ?? 100) < 50);
  const lw = cu?.largestWallet;
  if (cuRead && lw && lw.pct >= LP_PULL_PCT) {
    const who = lw.tokenCreator ? 'The token’s creator' : lw.addedFirstLiquidity ? 'The wallet that added the first liquidity' : 'One wallet';
    const hardUsd = s.pool?.liquidityUsd;
    caution.push({ code: 'lp_pullable', why: `${who} (${lw.address}) holds ${lw.pct}% of the LP and can withdraw ${lw.pct >= 99.99 ? 'all of the liquidity' : 'that share of the liquidity'}${hardUsd != null ? ` — about $${Math.round(hardUsd * lw.pct / 100)} of the pool’s hard side` : ''} — at any moment (line drawn at ${LP_PULL_PCT}% of the LP; ${cu.read === 'complete' ? 'every LP transfer since the pair was created was read' : `${cu.unreadPct}% of the LP could not be attributed`}).` });
  } else if (!cuRead && s.lp && s.lp.burnedPct != null && s.lp.burnedPct < 50 && (s.pool?.liquidityUsd ?? 0) < THIN_POOL_USD)
    caution.push({ code: 'lp_withdrawable', why: `${s.lp.burnedPct}% of the LP is burned and the pool holds $${s.pool.liquidityUsd} on its hard side (line drawn at $${THIN_POOL_USD}): whoever holds the rest of the LP can take the liquidity out.` });
  // Liquidity that has ALREADY gone: GOL and SUPE, half an hour old at the
  // review, had 99.9% of all the LP ever minted withdrawn — the pool the scan
  // measured is what was left behind.
  const gone = (cu?.withdrawnSinceCreation || [])[0];
  if (gone && gone.pctOfLpEverMinted >= 50)
    caution.push({ code: 'lp_withdrawn', why: `${gone.pctOfLpEverMinted}% of all the LP ever minted for this pair has already been withdrawn, by ${gone.address}${gone.tokenCreator ? ' (the token’s creator)' : gone.addedFirstLiquidity ? ' (the wallet that added the first liquidity)' : ''}. The pool measured here is what is left.` });
  // WHO IS SELLING (2026-09-27, the scan's flow block): the three sellers a buyer
  // fears, each only on what the logs show over the window read. The deployer or
  // a wallet it paid selling at all is the line (any size: the one wallet that
  // knows the token best is leaving); a top-ten holder only past a quarter of its
  // balance (whales trim); launch-block buyers only past a tenth of the float.
  const fl = s.flow;
  const dep = fl?.deployer;
  // …but not a dust sell worth under a dollar: BUL's deployer "sold 1× — about $0" into a pool it had already
  // emptied, and lp_withdrawn says that one.
  // Netted against liquidity it put back (2026-09-27): BOBAI's own creator sells a third, then adds the BNB and
  // the rest to the same pair and burns the LP — true as "sold $X", misleading as a caution. The line stands only
  // on what did NOT go back in, at the same dollar floor.
  const back = dep?.sold?.addedBack;
  const leftQ = back ? dep.sold.netQuote : dep?.sold?.quote, leftUsd = back ? dep.sold.netUsd : dep?.sold?.usd;
  const LP_FATE = { burned: 'its LP burned', kept: 'its LP kept by the wallet — withdrawable', 'partly burned': `${back?.lpBurnedPct}% of its LP burned`, 'not read': 'where its LP went not read' };
  if (dep?.sold?.sells > 0 && (leftUsd == null ? leftQ > 0 : leftUsd >= 1)) {
    const via = dep.sold.viaWalletsItFunded || [];
    caution.push({ code: 'dev_selling', why: `The deployer (${dep.address}, ${dep.source}) ${dep.sold.byDeployer ? `sold ${dep.sold.byDeployer.sells}×` : 'did not sell itself'}${via.length ? `${dep.sold.byDeployer ? ' and' : ', but'} ${via.length} wallet${via.length === 1 ? '' : 's'} it sent tokens to sold (${via.map((v) => v.address).join(', ')})` : ''} into this pool in the last ${fl.window?.minutes ?? '?'} minutes${dep.sold.usd != null ? ` — about $${dep.sold.usd}` : ''}${back ? ` and added $${back.usd ?? '?'} back as liquidity (${LP_FATE[back.lp]}), so about $${leftUsd ?? '?'} left the pool` : ''}; ${(fl.balanceAboveSupply || []).includes(dep.address) ? 'its balance reads ABOVE the whole supply — the contract lets it sell without limit' : dep.balancePctOfCirculating != null ? `it still holds ${dep.balancePctOfCirculating}% of the circulating supply` : 'what it still holds could not be read'}${dep.lpPct ? ` and ${dep.lpPct}% of the LP` : ''}.` });
  }
  const ths = fl?.topHolderSelling || [];
  if (ths.length) {
    const w = ths[0];
    caution.push({ code: 'top_holder_selling', why: `${ths.length === 1 ? 'A top holder' : `${ths.length} top holders`} sold into this pool in the last ${fl.window?.minutes ?? '?'} minutes: ${w.address} sold ${w.soldPctOfBalance}% of what it held (${w.heldPctBefore}% of the circulating supply before, ${w.holdsPctNow}% now${w.usd != null ? `, about $${w.usd}` : ''}) (line drawn at 25% of its balance; ${fl.topHolderBasis === 'size' ? 'no holder list — a seller that held 2% or more counts' : 'the top ten of the holder list'}).` });
  }
  const sn = fl?.snipers;
  if (sn?.read && sn.holdPctOfCirculating > 10)
    caution.push({ code: 'sniped_launch', why: `${sn.wallets} wallet${sn.wallets === 1 ? '' : 's'} bought in the first ${sn.blocks} blocks after the liquidity went in (block ${sn.launchBlock}) and still hold${sn.wallets === 1 ? 's' : ''} ${sn.holdPctOfCirculating}% of the circulating supply (line drawn at 10%)${sn.top?.some((x) => x.deployer) ? ' — the deployer among them' : ''}: a supply that can be sold into you.` });
  const flags = Object.entries(props).filter(([k, v]) => v === true && k !== 'is_open_source' && k !== 'is_in_dex').map(([k]) => k);
  // Who else can sell (2026-09-26): one wallet that could take a quarter of the pool, or a handful holding half
  // the float, moves this price far more than any trade you size.
  // Known exchange, lock and burn addresses are out of these figures and named
  // apart (2026-09-27): CAKE's "largest wallet" was Binance 8. A list GoPlus has
  // not built yet (a token minutes old: 0 or 3 holders) is unknown, and said —
  // silence here read as "spread out".
  const hd = s.holders;
  if (!hd || hd.unknown)
    caution.push({ code: 'holders_unknown', why: `Who holds this token could not be read${hd?.reason ? `: ${hd.reason}` : ''}. Unknown, not spread out — on a new token the deployer and a few wallets often hold most of it.` });
  else if (hd.largestSellTakesPctOfPool >= 25 || hd.top10PctOfCirculating >= 50) {
    const big = hd.top?.[0];
    const named = (hd.excluded || []).slice(0, 3).map((x) => `${x.name} ${x.pct}%`).join(', ');
    caution.push({ code: 'holders_concentrated', why: `The largest wallet${big?.contract ? ' (a contract the list does not name)' : ''} holds ${hd.largestPct}% of the circulating supply${hd.largestSellTakesPctOfPool != null ? ` — selling it all at once would take about ${hd.largestSellTakesPctOfPool}% of this pool's hard side` : ''}; the top ${hd.wallets} hold ${hd.top10PctOfCirculating}% (lines drawn at 25% of the pool and 50% of the float; balances read on-chain, the list is GoPlus's${named ? `; left out as exchange, lock or staking wallets: ${named}` : ''}).` });
  }
  if (flags.length) caution.push({ code: 'contract_flags', why: `GoPlus reads these as true: ${flags.join(', ')}. A label, not a measurement — and none of them has to have been used yet.` });
  if (s.contract?.openSource === false) caution.push({ code: 'source_not_verified', why: 'The contract source is not verified, so nobody has read what it can do.' });

  // ---- the figures at this size: the route's when it answered, the ladder's otherwise
  let entry, exit;
  if (r) {
    const keep = r.round_trip?.you_keep_pct ?? null;
    entry = {
      route: r.best_route, pool: r.best_route_pool, venue: 'PancakeSwap',
      pay: r.you_pay ? `${r.you_pay.amount} ${r.you_pay.symbol}` : null,
      receive_tokens: r.you_would_receive ?? null,
      best_route_is_the_deepest_pool: r.best_route_is_the_deepest_pool ?? null,
      slippage_bps_needed: r.slippage_bps_needed ?? null,
    };
    exit = {
      sellable: simHere ? sim.sellable !== false : null,
      round_trip_keep_pct: keep,
      round_trip_cost_pct: keep == null ? null : round(100 - keep, 2),
      of_which_pools_only_pct: r.round_trip?.you_keep_pct_pools_only == null ? null : round(100 - r.round_trip.you_keep_pct_pools_only, 2),
      ...(r.round_trip_caveat ? { caveat: r.round_trip_caveat } : {}),
    };
  } else {
    const buy = costAtSize(s.tradeCost, usd, 'buyCostPct'), sell = costAtSize(s.tradeCost, usd, 'sellCostPct');
    caution.push({ code: 'no_route_quote', why: `The route check did not answer (${String(routeError || 'no PancakeSwap route').slice(0, 160)}). Entry and exit below come from the measured pool’s cost ladder, read between its rungs — the pool is ${s.pool?.venue || 'the one scanned'}.` });
    if (buy.beyondLadder || sell.beyondLadder) caution.push({ code: 'size_beyond_ladder', why: `$${usd} is larger than the largest size measured; the costs shown are the largest rung’s and the real ones are higher.` });
    const fot = (taxBuy ?? 0) > 0.1 || (taxSell ?? 0) > 0.1;
    entry = { route: null, pool: s.pool?.address ?? null, venue: s.pool?.venue ?? null, cost_pct: round(buy.pct, 3),
      slippage_bps_needed: fot || (taxBuy == null && taxSell == null) ? 1500 : (buy.pct == null ? null : Math.max(50, Math.ceil((buy.pct + 0.5) * 100))) };
    exit = { sellable: simHere ? sim.sellable !== false : null, cost_pct: round(sell.pct, 3),
      round_trip_cost_pct: buy.pct == null || sell.pct == null ? null : round(buy.pct + sell.pct, 2) };
  }

  return {
    ...head,
    block: s.block ?? null, measured_at: s.measuredAt ?? null,
    stop, caution, entry, exit,
    tax: { buy_pct: taxBuy, sell_pct: taxSell, buy_source: buySource, sell_source: sellSource,
      source: buySource === sellSource ? buySource : `buy: ${buySource}; sell: ${sellSource}` },
    // `pool` names what the depth describes — the pool the scan measured, which
    // is not always the pool the best route goes through (entry.pool).
    depth: { pool: s.pool?.address ?? null, one_percent_buy_usd: d.buyUsd ?? null, one_percent_sell_usd: d.sellUsd ?? null, pool_hard_side_usd: s.pool?.liquidityUsd ?? null },
    lp_burned_pct: s.lp?.burnedPct ?? null,
    // Who holds the rest (2026-09-27), in the scan's own words — null on a V3
    // pool (position NFTs, not read) or when the reads failed.
    lp_custody: cu ? { read: cu.read, burned_pct: cu.burnedPct, locked_pct: cu.lockedPct, wallet_pct: cu.walletPct, unread_pct: cu.unreadPct,
      largest_wallet: lw ? { address: lw.address, pct: lw.pct, deployer: !!lw.deployer } : null } : null,
    // How old, and who trades it over the window read (the scan's age and activity).
    age_hours: { pool: s.age?.pool?.ageHours ?? null, token: s.age?.token?.ageHours ?? null },
    activity: s.activity ? { window_minutes: s.activity.window?.minutes ?? null, swaps: s.activity.swaps, buys: s.activity.buys, sells: s.activity.sells,
      unique_traders: s.activity.uniqueTraders, volume_usd: s.activity.volumeUsd, largest_sell_usd: s.activity.largestSellUsd } : null,
    // Who sold over the same window (the scan's flow, 2026-09-27): the deployer, top holders, launch snipers.
    flow: fl ? { window_minutes: fl.window?.minutes ?? null,
      deployer: dep ? { address: dep.address, holds_pct: dep.balancePctOfCirculating, lp_pct: dep.lpPct, sold_usd: dep.sold ? dep.sold.usd : null, sells: dep.sold ? dep.sold.sells : null,
        ...(back ? { added_back_usd: back.usd, added_back_lp: back.lp, net_sold_usd: dep.sold.netUsd } : {}) } : null,
      sellers: fl.sellers ? fl.sellers.wallets : null, top_holders_selling: ths.length,
      snipers_hold_pct: sn?.read ? sn.holdPctOfCirculating : null } : null,
    // What stays open after this answer, and the one thing here that costs
    // money (2026-09-24, A3 of the review): nothing a trading agent touched
    // ever named it. Neutral and only where it works — the watch reads V2
    // reserves, so a V3 or Infinity pool gets no pointer. Price and term come
    // from the watch's own 402 answer, not from this text.
    keep_watching: s.pool?.kind === 'v2' && s.pool?.address ? {
      why: 'This answer is one block. If you hold, the depth that lets you out can leave after it.',
      what: 'A paid watch re-reads this pool on a schedule and POSTs your callback when the size that moves the price 1% falls below the figure you set.',
      how: `POST https://agent.brainonbnb.com/watch {"token":"${s.address}","pair":"${s.pool.address}","depthBelowUsd":${usd},"callback":"https://…"}`,
      terms: 'Sent without payment, it answers 402 with the price and the term. Over MCP: bsc_pool_watch at https://agent.brainonbnb.com/mcp.',
    } : null,
    cannot_see: [
      'An owner who has not acted yet, a proxy not yet upgraded, a blacklist you are not on today: this is the trip as it stands at this block.',
      'Anything off-chain — the team, the socials, the deployer’s history.',
    ],
    details,
    disclaimer: 'Measurement, not advice. Figures are for this block and this size; depth and tax can change block to block.',
  };
}

export async function preflight(input, opts = {}, env) {
  const address = String(input || '').toLowerCase();
  const usd = Number(opts.usd) > 0 ? Number(opts.usd) : DEFAULT_USD;
  let s;
  try { s = await scan(address, env); }
  catch (e) {
    if (e instanceof ScanError) throw new PreflightError(e.headline, e.detail);
    throw e;
  }
  // The route only where there is a pool to route through. One after the
  // other, not side by side: both walk the same pools, and an account cut off
  // at fifty outbound calls a request should lose the route — which has a
  // fallback in the scan's own ladder — and never the scan.
  let r = null, routeError = null;
  if (s.quotable) {
    try { r = await swapRoute(address, { usd }); }
    catch (e) { routeError = e?.headline || e?.message || 'route check failed'; }
  }
  return shape(s, r, usd, routeError);
}
