// brainonbnb.com/pancakeswap reads five public routes and the library (2026-10-27). This holds what the page relies on:
// the page answers and links each route, and each route still carries the fields the page reads — a renamed field
// would leave a card on "Reading…" or print [object Object] (both happened while it was built: refuse_to_trade is an
// empty list when the trade is fine, and range-plan's pair is an object).
//   node scripts/pancakeswap-page-check.mjs        (live)
const SITE = 'https://brainonbnb.com', AGENT = 'https://agent.brainonbnb.com', CAKE = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82';
const UA = { 'user-agent': 'brainonbnb-test' };
let pass = 0, fail = 0;
const is = (name, ok, why = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !why ? '' : ' — ' + why}`); };
const json = (u) => fetch(u, { headers: UA, signal: AbortSignal.timeout(60000) }).then((r) => r.json()).catch((e) => ({ __error: String(e.message || e) }));

const page = await fetch(SITE + '/pancakeswap', { headers: UA }).then(async (r) => ({ status: r.status, text: await r.text() })).catch(() => ({ status: 0, text: '' }));
is('PC1 /pancakeswap answers 200', page.status === 200, String(page.status));
is('PC2 it reads and links every route it shows', ['/api/best-route', '/api/pool-scan', '/api/fee-tiers', '/api/range-plan', '/lp/look', '/lp/portfolio', 'board?type=library&q=pancakeswap'].every((s) => page.text.includes(s)));
// NO TOKEN CHOSEN FOR THE VISITOR (2026-10-27, operator: "was ist das für ein Token im Feld? mach lieber keinen dort"): both fields
// start empty with a hint, and nothing is read before something is pasted
is('PC2b the token and position fields start empty, with a hint', /id="pc-token"[^>]*value=""/.test(page.text) && /id="pc-token"[^>]*placeholder="Paste a token/.test(page.text) && /id="pc-pos"[^>]*placeholder="(Paste a )?V3 position/.test(page.text) && !/value="0x/.test(page.text) && !/\bread\('0x/.test(page.text) && !/\blook\('\d/.test(page.text));
is('PC3 the scanner and the DeFi agent link to it', await Promise.all(['/scanner', '/defi'].map((p) => fetch(SITE + p, { headers: UA }).then((r) => r.text()).then((t) => t.includes('href="/pancakeswap"')).catch(() => false))).then((a) => a.every(Boolean)));

const [route, scan, tiers, range, look, folio, lib] = await Promise.all([
  json(`${SITE}/api/best-route?address=${CAKE}&usd=250`), json(`${SITE}/api/pool-scan?address=${CAKE}`), json(`${SITE}/api/fee-tiers?address=${CAKE}`),
  json(`${SITE}/api/range-plan?address=${CAKE}&capitalUsd=1000`), json(`${AGENT}/lp/look?position=7637521`), json(`${AGENT}/lp/portfolio`),
  json(`${AGENT}/board?type=library&q=pancakeswap&limit=50`)]);
is('PC4 best-route: best_route, routes with worse_than_best_pct, refuse_to_trade a list', typeof route.best_route === 'string' && Array.isArray(route.routes) && route.routes.some((r) => r.quoted && typeof r.worse_than_best_pct === 'number') && Array.isArray(route.refuse_to_trade ?? []) && route.token?.symbol, JSON.stringify(route).slice(0, 200));
is('PC5 pool-scan: tradeCost rows with sizeUsd/buyCostPct/sellCostPct, tax.buyPct, pool.venue', Array.isArray(scan.tradeCost) && scan.tradeCost.some((r) => r.sizeUsd && typeof r.buyCostPct === 'number' && typeof r.sellCostPct === 'number') && 'buyPct' in (scan.tax || {}) && scan.pool?.venue, JSON.stringify(scan).slice(0, 200));
is('PC6 fee-tiers: best_paying_tier, most_capital_tier, capital_is_in_the_best_paying_tier', typeof tiers.best_paying_tier === 'string' && typeof tiers.most_capital_tier === 'string' && typeof tiers.capital_is_in_the_best_paying_tier === 'boolean', JSON.stringify(tiers).slice(0, 200));
is('PC7 range-plan: best_range_after_paying_to_put_it_back, pair.token.symbol / pair.quote.symbol', typeof range.best_range_after_paying_to_put_it_back === 'string' && range.pair?.token?.symbol && range.pair?.quote?.symbol, JSON.stringify(range).slice(0, 200));
is('PC8 lp/look: verdict and in_range for a position id', typeof look.verdict === 'string' && typeof look.in_range === 'boolean', JSON.stringify(look).slice(0, 200));
is('PC9 lp/portfolio: pool.position, pool.label, pool.in_range', folio.pool?.position && folio.pool?.label && typeof folio.pool?.in_range === 'boolean', JSON.stringify(folio).slice(0, 200));
is('PC10 the library holds PancakeSwap entries (matched, threads with id and title)', (lib.matched || 0) > 0 && !lib.near && (lib.threads || []).every((t) => t.id && t.title), JSON.stringify(lib).slice(0, 200));
// THE STRANGER TEST ON THIS PAGE (2026-10-27): one pool across the cards, no winner the tool does not claim, no slippage advice
is('PC11 best-route carries the round trip the cost card shows (you_keep_pct, you_keep_pct_pools_only)', typeof route.round_trip?.you_keep_pct === 'number' && typeof route.round_trip?.you_keep_pct_pools_only === 'number', JSON.stringify(route.round_trip).slice(0, 160));
is('PC12 range-plan says whether its window ranks the widths, and why it chose its tier', typeof range.window_ranks_the_widths === 'boolean' && typeof range.tier_chosen_because === 'string', JSON.stringify({ w: range.window_ranks_the_widths, t: range.tier_chosen_because }));
is('PC13 the page prices the trade on the best route, hides an unranked width, shows no slippage figure, and the result with losses', /you_keep_pct/.test(page.text) && /window_ranks_the_widths === false/.test(page.text) && !/slippage_bps_needed/.test(page.text) && /profit_bnb/.test(page.text));
is('PC14 lp/portfolio carries the result the page shows (pnl.profit_bnb, change_pct, put_in.bnb)', typeof folio.pnl?.profit_bnb === 'number' && typeof folio.pnl?.change_pct === 'number' && typeof folio.put_in?.bnb === 'number');
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
