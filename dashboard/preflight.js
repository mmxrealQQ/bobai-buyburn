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
//
// MACHINE-READABLE, NEXT TO THE SENTENCE (2026-10-09). `gate` is the verdict in
// one word an agent can branch on — "stop" when stop[] holds anything, "weigh"
// when only caution[] does, "no_known_stop" when neither (never "safe": it is
// what this read found, not a promise). Every stop/caution item whose sentence
// carries a figure also carries it as {value, line, unit}: the measured number,
// the line it was held against (null where the sentence draws none) and its
// unit ("usd", "pct", "bps"; "wallets" for volume_from_few_wallets since
// 2026-10-09: the wallets counted against the most that still reads as wash
// trading). `why` stays the same sentence.
import { scan, ScanError } from './scanner-scan.js';
import { swapRoute } from './swap-route.js';
import { readControl } from './scanner-chain.js';

export class PreflightError extends Error {
  constructor(headline, detail, code) { super(headline); this.headline = headline; this.detail = detail; if (code) this.code = code; }
}

const DEFAULT_USD = 250;
const HIGH_TAX_PCT = 10;         // one side; named in the sentence
const THIN_POOL_USD = 250000;    // below this an unburned LP is worth a line
const LP_PULL_PCT = 10;          // one wallet holding this much of the LP is named
// volume_from_few_wallets (2026-10-09): the hour read looks like wash trading when
// 20+ swaps came from at most max(3, swaps / 10) wallets, or its volume is 2x the
// pool's hard side or more from 10 wallets or fewer.
const WASH_MIN_SWAPS = 20, WASH_SWAPS_PER_WALLET = 10, WASH_MIN_WALLETS = 3, WASH_VOL_X = 2, WASH_FEW_WALLETS = 10;
const round = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : +n.toFixed(d));
// The figure of a stop/caution item (2026-10-09): only where there is a number.
const fig = (value, line, unit) => (value == null || !Number.isFinite(Number(value)) ? {} : { value: Number(value), line: line ?? null, unit });
export const gateOf = (stop, caution) => (stop.length ? 'stop' : caution.length ? 'weigh' : 'no_known_stop');

// The cost of a size the ladder does not carry, read between the two rungs
// around it. Used only when the route check could not answer (a venue outside
// PancakeSwap, or the request ran out of outbound calls).
export function costAtSize(rows, usd, key) {
  const pts = (rows || []).filter((r) => r && r[key] != null).sort((a, b) => a.sizeUsd - b.sizeUsd);
  if (!pts.length) return { pct: null, beyondLadder: false };
  const last = pts[pts.length - 1];
  if (usd <= pts[0].sizeUsd) return { pct: pts[0][key], beyondLadder: false };
  if (usd >= last.sizeUsd) return { pct: last[key], beyondLadder: usd > last.sizeUsd, largestUsd: last.sizeUsd };
  const i = pts.findIndex((p) => p.sizeUsd >= usd);
  const a = pts[i - 1], b = pts[i];
  return { pct: a[key] + ((b[key] - a[key]) * (usd - a.sizeUsd)) / (b.sizeUsd - a.sizeUsd), beyondLadder: false };
}

// The shaping, apart from the chain, so it can be pinned offline: `s` is a
// pool-scan answer, `r` a route answer or null, `routeError` why it is null,
// `control` the own read of who controls the contract (readControl) or null.
export function shape(s, r, usd, routeError = null, control = null) {
  const stop = [], caution = [];
  const details = {
    pool_scan: `https://brainonbnb.com/api/pool-scan?address=${s.address}`,
    best_route: `https://brainonbnb.com/api/best-route?address=${s.address}&usd=${usd}`,
  };
  // One shape on every branch (2026-10-09): `kind` names which of the three
  // answers this is, and `block` / `measured_at` are always there — the curve
  // and the unquotable answers had neither. The scan's block where it has one,
  // the control read's head otherwise.
  const kind = s.quotable ? 'pool' : s.curve ? 'curve' : 'unquotable';
  const head = { tool: 'bsc_token_preflight', kind, token: { address: s.address, symbol: s.symbol ?? null, name: s.name ?? null }, size_usd: usd,
    block: s.block ?? (control?.read ? control.block : null) ?? null, measured_at: s.measuredAt ?? new Date().toISOString() };
  const ctl = controlBlock(control);
  // The verdict word sits next to stop/caution, worked out once both are final.
  const out = (o) => ({ ...head, gate: gateOf(o.stop, o.caution), ...o });

  // Still on its four.meme curve: no pool, no route — the curve's own figures.
  if (!s.quotable && s.curve) {
    const c = s.curve;
    const buy = costAtSize(c.tradeCost, usd, 'buyCostPct'), sell = costAtSize(c.tradeCost, usd, 'sellCostPct');
    if (!c.sellQuoted) stop.push({ code: 'sell_not_quotable', why: 'four.meme’s contract returned no sell quote at any size asked.' });
    caution.push({ code: 'on_launch_curve', why: `Still raising on four.meme (${c.progressPct ?? '?'}% of the raise): trades go through four.meme’s contract, not a pool, and the price path changes when the raise completes and the token lists on PancakeSwap.`, ...fig(c.progressPct, 100, 'pct') });
    if (buy.beyondLadder || sell.beyondLadder) caution.push({ code: 'size_beyond_ladder', why: `$${usd} is larger than the largest size measured; the cost shown is the largest rung’s and the real one is higher.`, ...fig(usd, buy.largestUsd ?? sell.largestUsd, 'usd') });
    return out({ venue: 'four.meme bonding curve', stop, caution,
      entry: { cost_pct: round(buy.pct, 3), fee_pct: c.feePct ?? null },
      exit: { sell_quoted: !!c.sellQuoted, cost_pct: round(sell.pct, 3) },
      control: ctl,
      cannot_see: ['What the token does after it lists: its transfer tax and its owner’s powers only show once there is a pool to measure.'],
      details, disclaimer: 'Measurement, not advice. Figures are for this block.' });
  }

  if (!s.quotable) {
    stop.push({ code: 'not_quotable', why: s.reason || 'No pool that could be read describes this token’s market.' });
    return out({ stop, caution, entry: null, exit: null,
      ...(s.liquidity ? { liquidity: s.liquidity } : {}),
      control: ctl,
      details, disclaimer: 'Measurement, not advice. Figures are for this block.' });
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
  for (const why of (r?.refuse_to_trade || [])) {
    const kept = /returns ([0-9.]+)% of what went in/.exec(why);
    stop.push({ code: 'round_trip', why, ...(kept ? fig(+kept[1], 50, 'pct') : {}) });
  }

  // ---- the tax
  const t = s.tax || {};
  // Each side's number stays with the source it came from: the route's where
  // the route has one, the scan's otherwise — never the scan's figure under
  // the route's sentence ("0%, not measurable" was one answer, 2026-09-21).
  const fromRoute = (k) => r?.transfer_tax?.[k] != null;
  const taxBuy = fromRoute('buy_pct') ? r.transfer_tax.buy_pct : t.buyPct ?? null;
  const taxSell = fromRoute('sell_pct') ? r.transfer_tax.sell_pct : t.sellPct ?? null;
  const WORDS = { measured: 'measured from executed trades on-chain', simulated: 'simulated on-chain at this block, from a fresh address', label: 'labelled by GoPlus, unverified', unknown: 'unknown — nothing could establish it' };
  const sideSource = (k, scanSide) => (fromRoute(k) ? r.transfer_tax[k.replace('_pct', '_source')] || r.transfer_tax.source : WORDS[scanSide] || t.source || null);
  const buySource = sideSource('buy_pct', t.buySource), sellSource = sideSource('sell_pct', t.sellSource);
  for (const [side, v, src] of [['buy', taxBuy, t.buySource], ['sell', taxSell, t.sellSource]]) {
    if (fromRoute(`${side}_pct`)) continue;
    if (v != null && src === 'label') caution.push({ code: `${side}_tax_label_only`, why: `The ${side} tax of ${v}% is a GoPlus label: no executed ${side} could be read and no simulation ran for it. A label has read 0% on tokens that charged more.`, ...fig(v, null, 'pct') });
    else if (v == null && (taxBuy != null || taxSell != null)) caution.push({ code: `${side}_tax_unknown`, why: `No ${side} tax could be established — only the other side was. The costs below exclude it on the ${side}.` });
  }
  if (taxBuy == null && taxSell == null)
    caution.push({ code: 'tax_unknown', why: 'No transfer tax could be established, neither from executed trades nor by simulation. The costs below exclude it; if the token takes a cut, the trade costs more and needs about 1500 bps of slippage.', ...fig(1500, null, 'bps') });
  for (const [side, v] of [['buy', taxBuy], ['sell', taxSell]])
    if (v != null && v >= HIGH_TAX_PCT) caution.push({ code: `high_${side}_tax`, why: `The token takes ${v}% on every ${side} (line drawn at ${HIGH_TAX_PCT}%).`, ...fig(v, HIGH_TAX_PCT, 'pct') });
  const props = s.contract?.properties || {};
  if (props.slippage_modifiable === true && (taxBuy > 0 || taxSell > 0 || taxBuy == null))
    caution.push({ code: 'tax_can_change', why: 'The contract lets its owner change the transfer tax: the figure measured now is not a promise.' });

  // ---- the size against the depth
  const d = s.onePercentDepth || {};
  const thinSide = Math.min(d.buyUsd ?? Infinity, d.sellUsd ?? Infinity);
  if (Number.isFinite(thinSide) && usd > thinSide)
    caution.push({ code: 'size_moves_price', why: `$${usd} is more than the $${thinSide} that moves this pool’s price by 1%: you are the market at this size.`, ...fig(usd, thinSide, 'usd') });
  if (s.deeperPoolElsewhere)
    caution.push({ code: 'deeper_pool_elsewhere', why: `A deeper pool for this token exists (${s.deeperPoolElsewhere.pair}, about $${s.deeperPoolElsewhere.liquidityUsd} hard side) than the one measured.`, ...fig(s.deeperPoolElsewhere.liquidityUsd, null, 'usd') });
  if (s.pool?.partialMarket)
    caution.push({ code: 'partial_market', why: `The pool measured holds ${round((s.pool.shareOfLiquidity || 0) * 100, 1)}% of this token’s liquidity; the rest trades elsewhere.`, ...fig(round((s.pool.shareOfLiquidity || 0) * 100, 1), 25, 'pct') });

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
    caution.push({ code: 'lp_pullable', why: `${who} (${lw.address}) holds ${lw.pct}% of the LP and can withdraw ${lw.pct >= 99.99 ? 'all of the liquidity' : 'that share of the liquidity'}${hardUsd != null ? ` — about $${Math.round(hardUsd * lw.pct / 100)} of the pool’s hard side` : ''} — at any moment (line drawn at ${LP_PULL_PCT}% of the LP; ${cu.read === 'complete' ? 'every LP transfer since the pair was created was read' : `${cu.unreadPct}% of the LP could not be attributed`}).`, ...fig(lw.pct, LP_PULL_PCT, 'pct') });
  } else if (!cuRead && s.lp && s.lp.burnedPct != null && s.lp.burnedPct < 50 && (s.pool?.liquidityUsd ?? 0) < THIN_POOL_USD)
    caution.push({ code: 'lp_withdrawable', why: `${s.lp.burnedPct}% of the LP is burned and the pool holds $${s.pool.liquidityUsd} on its hard side (line drawn at $${THIN_POOL_USD}): whoever holds the rest of the LP can take the liquidity out.`, ...fig(s.lp.burnedPct, 50, 'pct') });
  // Liquidity that has ALREADY gone: GOL and SUPE, half an hour old at the
  // review, had 99.9% of all the LP ever minted withdrawn — the pool the scan
  // measured is what was left behind.
  const gone = (cu?.withdrawnSinceCreation || [])[0];
  if (gone && gone.pctOfLpEverMinted >= 50)
    caution.push({ code: 'lp_withdrawn', why: `${gone.pctOfLpEverMinted}% of all the LP ever minted for this pair has already been withdrawn, by ${gone.address}${gone.tokenCreator ? ' (the token’s creator)' : gone.addedFirstLiquidity ? ' (the wallet that added the first liquidity)' : ''}. The pool measured here is what is left.`, ...fig(gone.pctOfLpEverMinted, 50, 'pct') });
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
    caution.push({ code: 'dev_selling', why: `The deployer (${dep.address}, ${dep.source}) ${dep.sold.byDeployer ? `sold ${dep.sold.byDeployer.sells}×` : 'did not sell itself'}${via.length ? `${dep.sold.byDeployer ? ' and' : ', but'} ${via.length} wallet${via.length === 1 ? '' : 's'} it sent tokens to sold (${via.map((v) => v.address).join(', ')})` : ''} into this pool in the last ${fl.window?.minutes ?? '?'} minutes${dep.sold.usd != null ? ` — about $${dep.sold.usd}` : ''}${back ? ` and added $${back.usd ?? '?'} back as liquidity (${LP_FATE[back.lp]}), so about $${leftUsd ?? '?'} left the pool` : ''}; ${(fl.balanceAboveSupply || []).includes(dep.address) ? 'its balance reads ABOVE the whole supply — the contract lets it sell without limit' : dep.balancePctOfCirculating != null ? `it still holds ${dep.balancePctOfCirculating}% of the circulating supply` : 'what it still holds could not be read'}${dep.lpPct ? ` and ${dep.lpPct}% of the LP` : ''}.`, ...fig(leftUsd ?? dep.sold.usd, 1, 'usd') });
  }
  const ths = fl?.topHolderSelling || [];
  if (ths.length) {
    const w = ths[0];
    caution.push({ code: 'top_holder_selling', why: `${ths.length === 1 ? 'A top holder' : `${ths.length} top holders`} sold into this pool in the last ${fl.window?.minutes ?? '?'} minutes: ${w.address} sold ${w.soldPctOfBalance}% of what it held (${w.heldPctBefore}% of the circulating supply before, ${w.holdsPctNow}% now${w.usd != null ? `, about $${w.usd}` : ''}) (line drawn at 25% of its balance; ${fl.topHolderBasis === 'size' ? 'no holder list — a seller that held 2% or more counts' : 'the top ten of the holder list'}).`, ...fig(w.soldPctOfBalance, 25, 'pct') });
  }
  const sn = fl?.snipers;
  if (sn?.read && sn.holdPctOfCirculating > 10)
    caution.push({ code: 'sniped_launch', why: `${sn.wallets} wallet${sn.wallets === 1 ? '' : 's'} bought in the first ${sn.blocks} blocks after the liquidity went in (block ${sn.launchBlock}) and still hold${sn.wallets === 1 ? 's' : ''} ${sn.holdPctOfCirculating}% of the circulating supply (line drawn at 10%)${sn.top?.some((x) => x.deployer) ? ' — the deployer among them' : ''}: a supply that can be sold into you.`, ...fig(sn.holdPctOfCirculating, 10, 'pct') });
  // FAKE VOLUME (2026-10-09). Today's rugs are pumped with a handful of wallets
  // trading back and forth, so the volume looks like demand. Over the hour of
  // swaps the scan read: many swaps from very few addresses, or a volume far over
  // the pool's hard side from few of them. Never a certainty — a router or an
  // aggregator that trades for many wallets counts as one address — so the
  // sentence says "looks like" and gives the figures. The same lines as the rug
  // watch's fake_volume (worker-agent/rug-watch.js, TREND).
  const act = s.activity;
  if (act && act.swaps >= WASH_MIN_SWAPS && act.uniqueTraders >= 1) {
    const few = Math.max(WASH_MIN_WALLETS, Math.floor(act.swaps / WASH_SWAPS_PER_WALLET));
    const hard = s.pool?.liquidityUsd;
    const overPool = act.volumeUsd != null && hard > 0 && act.volumeUsd >= WASH_VOL_X * hard && act.uniqueTraders <= WASH_FEW_WALLETS;
    if (act.uniqueTraders <= few || overPool) {
      const mins = act.window?.minutes ?? '?';
      caution.push({ code: 'volume_from_few_wallets', why: `In the last ${mins} minutes ${act.swaps} swaps came from ${act.uniqueTraders} wallet${act.uniqueTraders === 1 ? '' : 's'}${act.volumeUsd != null ? ` — $${act.volumeUsd} of volume` : ''}${hard != null ? ` on a pool holding $${Math.round(hard)} on its hard side` : ''}. That looks like wash trading: a handful of wallets made most of the volume, so it says little about real demand (lines drawn at ${act.uniqueTraders <= few ? `${few} wallets or fewer for ${act.swaps} swaps — ten swaps or more per wallet` : `a volume ${WASH_VOL_X}x the pool from ${WASH_FEW_WALLETS} wallets or fewer`}; a router or aggregator trading for many wallets counts as one address).`,
        ...fig(act.uniqueTraders, act.uniqueTraders <= few ? few : WASH_FEW_WALLETS, 'wallets') });
    }
  }
  const flags = Object.entries(props).filter(([k, v]) => v === true && k !== 'is_open_source' && k !== 'is_in_dex').map(([k]) => k);
  // Who else can sell (2026-09-26): one wallet that could take a quarter of the pool, or a handful holding half
  // the float, moves this price far more than any trade you size.
  // Known exchange, lock and burn addresses are out of these figures and named
  // apart (2026-09-27): CAKE's "largest wallet" was Binance 8. A list GoPlus has
  // not built yet (a token minutes old: 0 or 3 holders) is unknown, and said —
  // silence here read as "spread out".
  const hd = s.holders;
  if (!hd || hd.unknown)
    // "a new token" only where it is one (2026-10-07: USDT, six years old, read as a fresh launch)
    caution.push({ code: 'holders_unknown', why: `Who holds this token could not be read${hd?.reason ? `: ${hd.reason}` : ''}. Unknown, not spread out${s.age?.token?.ageHours != null && s.age.token.ageHours < 168 ? ' — on a new token the deployer and a few wallets often hold most of it' : ''}.` });
  else if (hd.largestSellTakesPctOfPool >= 25 || hd.top10PctOfCirculating >= 50) {
    const big = hd.top?.[0];
    const named = (hd.excluded || []).slice(0, 3).map((x) => `${x.name} ${x.pct}%`).join(', ');
    caution.push({ code: 'holders_concentrated', why: `The largest wallet${big?.contract ? ' (a contract the list does not name)' : ''} holds ${hd.largestPct}% of the circulating supply${hd.largestSellTakesPctOfPool != null ? ` — selling it all at once would take about ${hd.largestSellTakesPctOfPool}% of this pool's hard side` : ''}; the top ${hd.wallets} hold ${hd.top10PctOfCirculating}% (lines drawn at 25% of the pool and 50% of the float; balances read on-chain, the list is GoPlus's${named ? `; left out as exchange, lock or staking wallets: ${named}` : ''}).`,
      ...(hd.largestSellTakesPctOfPool >= 25 ? fig(hd.largestSellTakesPctOfPool, 25, 'pct') : fig(hd.top10PctOfCirculating, 50, 'pct')) });
  }
  if (flags.length) caution.push({ code: 'contract_flags', why: `GoPlus reads these as true: ${flags.join(', ')}. A label, not a measurement — and none of them has to have been used yet.` });
  if (s.contract?.openSource === false) caution.push({ code: 'source_not_verified', why: 'The contract source is not verified, so nobody has read what it can do.' });
  // ONE KEY OVER A LEVER (2026-10-09), from the own control read: an owner that
  // is a plain wallet (no code at it) is one private key, and it matters where
  // the contract gives the owner something to pull — a tax, a mint function, an
  // upgradeable implementation. An EOA owner of a contract with none of the
  // three is not a line; a renounced or contract owner never is here.
  const levers = [];
  if ((taxBuy ?? 0) > 0 || (taxSell ?? 0) > 0) levers.push(`takes a transfer tax (${taxBuy ?? '?'}% buy, ${taxSell ?? '?'}% sell)`);
  if (ctl?.mint_selector) levers.push('carries a mint(address,uint256) function in its bytecode');
  if (ctl?.proxy) levers.push(`is an upgradeable EIP-1967 proxy (implementation ${ctl.proxy.implementation})`);
  if (ctl?.owner?.kind === 'eoa' && levers.length)
    caution.push({ code: 'owner_is_eoa', why: `The owner (${ctl.owner.address}, read from ${ctl.owner.source}) is a plain wallet — one private key, no contract or timelock in front of it — and the token ${levers.join(', ')}. Whatever the contract lets its owner do, that one key can do at any block.` });

  // ---- the figures at this size: the route's when it answered, the ladder's otherwise
  let entry, exit;
  if (r) {
    const keep = r.round_trip?.you_keep_pct ?? null;
    entry = {
      route: r.best_route, pool: r.best_route_pool, venue: 'PancakeSwap',
      pay: r.you_pay ? `${r.you_pay.amount} ${r.you_pay.symbol}` : null,
      // the exact amount to swap with, as the route gave it (2026-10-07: only the string above reached the caller)
      you_pay: r.you_pay ?? null,
      ...(r.slippage_note ? { slippage_note: r.slippage_note } : {}),
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
    if (buy.beyondLadder || sell.beyondLadder) caution.push({ code: 'size_beyond_ladder', why: `$${usd} is larger than the largest size measured; the costs shown are the largest rung’s and the real ones are higher.`, ...fig(usd, buy.largestUsd ?? sell.largestUsd, 'usd') });
    const fot = (taxBuy ?? 0) > 0.1 || (taxSell ?? 0) > 0.1;
    entry = { route: null, pool: s.pool?.address ?? null, venue: s.pool?.venue ?? null, cost_pct: round(buy.pct, 3),
      slippage_bps_needed: fot || (taxBuy == null && taxSell == null) ? 1500 : (buy.pct == null ? null : Math.max(50, Math.ceil((buy.pct + 0.5) * 100))) };
    exit = { sellable: simHere ? sim.sellable !== false : null, cost_pct: round(sell.pct, 3),
      round_trip_cost_pct: buy.pct == null || sell.pct == null ? null : round(buy.pct + sell.pct, 2) };
  }

  // LP burned, one number under both names (2026-10-09): lp_burned_pct (kept
  // for callers that read it) and lp_custody.burned_pct came from two reads and
  // could differ in the last digit. Both are now the scan's direct read of the
  // burn addresses, the custody's sum only where that read is missing.
  const lpBurned = s.lp?.burnedPct ?? cu?.burnedPct ?? null;
  return out({
    stop, caution, entry, exit,
    tax: { buy_pct: taxBuy, sell_pct: taxSell, buy_source: buySource, sell_source: sellSource,
      source: buySource === sellSource ? buySource : `buy: ${buySource}; sell: ${sellSource}` },
    // `pool` names what the depth describes — the pool the scan measured, which
    // is not always the pool the best route goes through (entry.pool).
    depth: { pool: s.pool?.address ?? null, one_percent_buy_usd: d.buyUsd ?? null, one_percent_sell_usd: d.sellUsd ?? null, pool_hard_side_usd: s.pool?.liquidityUsd ?? null },
    lp_burned_pct: lpBurned,
    // Who holds the rest (2026-09-27), in the scan's own words — null on a V3
    // pool (position NFTs, not read) or when the reads failed.
    lp_custody: cu ? { read: cu.read, burned_pct: lpBurned, locked_pct: cu.lockedPct, wallet_pct: cu.walletPct, unread_pct: cu.unreadPct, farm_pct: cu.farmPct ?? null, exchange_fee_pct: cu.exchangeFeePct ?? null, contract_pct: cu.contractPct ?? null,
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
      // what they sold, in dollars (2026-10-09): the rug watch adds insiders' sells up across its reads
      top_holders_sold_usd: ths.length ? (ths.some((x) => x.usd != null) ? ths.reduce((a, x) => a + (x.usd || 0), 0) : null) : 0,
      snipers_hold_pct: sn?.read ? sn.holdPctOfCirculating : null } : null,
    // What stays open after this answer, and the one thing here that costs
    // money (2026-09-24, A3 of the review): nothing a trading agent touched
    // ever named it. Neutral and only where it works — the watch reads V2
    // reserves, so a V3 or Infinity pool gets no pointer. Price and term come
    // from the watch's own 402 answer, not from this text.
    // The free rug watch beside it (2026-10-09, worker-agent/rug-watch.js): this
    // same preflight read again every 15 minutes, a webhook when it turns
    // dangerous. It reads the preflight, not reserves, so any pool gets it —
    // the paid pool watch above stays V2-only.
    keep_watching: s.pool?.address ? {
      ...(s.pool?.kind === 'v2' ? {
        why: 'This answer is one block. If you hold, the depth that lets you out can leave after it.',
        what: 'A paid watch re-reads this pool on a schedule and POSTs your callback when the size that moves the price 1% falls below the figure you set — in the call below, your trade size; set it to the depth you need to get out.',
        how: `POST https://agent.brainonbnb.com/watch {"token":"${s.address}","pair":"${s.pool.address}","depthBelowUsd":${usd},"callback":"https://…"}`,
        terms: 'Sent without payment, it answers 402 with the price and the term. Over MCP: bsc_pool_watch at https://agent.brainonbnb.com/mcp.',
      } : { why: 'This answer is one block. If you hold, what it found can change after it.' }),
      rug_watch: {
        what: 'Free, webhook only: this preflight is read again every 15 minutes and your callback is POSTed when the sell stops going through, the liquidity is pulled, a tax rises, LP is withdrawn, or the owner or the proxy changes — and, from its own 24-hour history, when the volume looks faked by a handful of wallets, the price is pumped or dumped after a pump, or it bleeds in a slow rug while insiders sell. One watch free per caller; 25 for wallets holding 1,000,000 $BOBAI.',
        how: `POST https://agent.brainonbnb.com/rug-watch {"token":"${s.address}","callback":"https://…"}`,
        terms: 'GET https://agent.brainonbnb.com/rug-watch. Over MCP: bsc_rug_watch at https://brainonbnb.com/mcp.',
      },
    } : null,
    // Who controls the contract, read on-chain (2026-10-09; controlBlock below).
    control: ctl,
    cannot_see: [
      'An owner who has not acted yet, a proxy not yet upgraded, a blacklist you are not on today: this is the trip as it stands at this block.',
      'Anything off-chain — the team, the socials, the deployer’s history.',
    ],
    details,
    disclaimer: 'Measurement, not advice. Figures are for this block and this size; depth and tax can change block to block.',
  });
}

// The control read as the answer states it (2026-10-09): own eth_call /
// eth_getStorageAt / eth_getCode reads, no label. null when it was not run.
export function controlBlock(c) {
  if (!c) return null;
  if (!c.read) return { read: false, reason: c.reason || 'not read' };
  return {
    read: true,
    owner: c.owner ? { address: c.owner.address, kind: c.owner.kind, source: c.owner.source } : null,
    owner_note: c.owner ? ({ renounced: 'The owner is the zero or dead address: ownership was given up.', eoa: 'The owner is a plain wallet: one private key.', contract: 'The owner is a contract (a multisig, a timelock or anything else — not read further).', unread: 'Whether the owner has code could not be read.' })[c.owner.kind] ?? null
      : 'Neither owner() nor getOwner() answers: no owner function of the usual name (powers held another way are not seen here).',
    proxy: c.proxy ? { standard: c.proxy.standard, implementation: c.proxy.implementation, admin: c.proxy.admin ?? null, admin_kind: c.proxy.admin_kind ?? null } : null,
    mint_selector: !!c.mint_selector,
    ...(c.mint_selector_in ? { mint_selector_in: c.mint_selector_in } : {}),
    source: 'own reads at this block: owner() and getOwner(), the EIP-1967 implementation and admin slots, eth_getCode on each address found, and the bytecode searched for the mint(address,uint256) selector 0x40c10f19 (a function by that name exists; who may call it is not read)',
  };
}

export async function preflight(input, opts = {}, env) {
  const address = String(input || '').toLowerCase();
  const usd = Number(opts.usd) > 0 ? Number(opts.usd) : DEFAULT_USD;
  // The control read (two small batches, 2026-10-09) runs beside the scan, on
  // the address as given; a pasted pool is read again once the scan has named
  // its token, beside the route.
  const ctlP = readControl(address).catch(() => null);
  let s;
  try { s = await scan(address, env); }
  catch (e) {
    if (e instanceof ScanError) throw new PreflightError(e.headline, e.detail, e.code);
    throw e;
  }
  const ctl2P = s.address && s.address !== address ? readControl(s.address).catch(() => null) : ctlP;
  // The route only where there is a pool to route through. One after the
  // other, not side by side: both walk the same pools, and an account cut off
  // at fifty outbound calls a request should lose the route — which has a
  // fallback in the scan's own ladder — and never the scan.
  let r = null, routeError = null;
  if (s.quotable) {
    try { r = await swapRoute(address, { usd, codeChecked: true }); }
    catch (e) { routeError = e?.headline || e?.message || 'route check failed'; }
  }
  return shape(s, r, usd, routeError, await ctl2P);
}
