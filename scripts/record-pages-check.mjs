// WHAT A RECORD PAGE SAYS WITHOUT A BROWSER (2026-11-04)
// /jobs, /settle, /venus and /screener said only "Reading the board…" / "Reading the record…" / "Reading every agent…"
// to a crawler or an agent reading the HTML. The site worker writes one sentence of the record in. This reads the raw
// HTML as such a reader does and holds the sentence against the endpoint it came from.
//   node scripts/record-pages-check.mjs [base=https://brainonbnb.com]
const BASE = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const H = { 'user-agent': 'brainonbnb-record-pages-check' };
let bad = 0;
const pin = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 170) : ''}`); };
const raw = async (p) => fetch(BASE + p, { headers: H }).then((r) => r.text()).catch(() => '');
const api = async (p) => fetch('https://agent.brainonbnb.com' + p, { headers: H }).then((r) => r.json()).catch(() => null);
const inner = (html, id) => ((html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`)) || [])[1] || '').trim();

const jb = await api('/jobs/board'), jh = await raw('/jobs');
const head = inner(jh, 'jb-head');
pin('/jobs: the head says the 30-day totals, not "Reading"', !/^Reading/.test(head) && jb && head.includes(`${jb.totals_30d.paid} paid`), head);
pin('/jobs: the campaign address is named apart', /shown apart/.test(inner(jh, 'jb-farm')), inner(jh, 'jb-farm'));
const st = await api('/settle/public'), sh = await raw('/settle');
const last = inner(sh, 'rc-last');
pin('/settle: the record says how many jobs were settled and released', !/^Reading/.test(last) && st && last.includes(`${st.totals.jobs} finished jobs`) && last.includes(`${st.totals.released_u} $U`), last);
const vh = await raw('/venus'), state = inner(vh, 'rc-state');
pin('/venus: the record names both agents with their last note', !/^Reading/.test(state) && /#302257/.test(state) && /#304493/.test(state), state);
const sc = await api('/screener'), sch = await raw('/screener');
const cell = ((sch.match(/<td class="tl" colspan="12">([^<]*)</) || [])[1] || '').trim();
pin('/screener: the table says how many answered and names the top outside agents', !/^Reading/.test(cell) && sc && cell.includes(`${Number(sc.agents).toLocaleString('en-US')} agents`) && /Highest evidence scores outside ours: \S/.test(cell), cell);
// the front page's bar (Price, MC, Liq, LP, Burned) opened as dashes; it carries the on-chain figures now (a minute old at most)
const home = await raw('/'), bl = (k) => ((home.match(new RegExp(`data-bl="${k}">([^<]*)<`)) || [])[1] || '').trim();
const pr = await fetch('https://brainonbnb.com/api/price', { headers: H }).then((r) => r.json()).catch(() => null);
pin('/: the bar carries Price, MC, Liq, LP and Burned, no dash', ['price', 'mc', 'liq', 'lp', 'burned'].every((k) => bl(k) && bl(k) !== '—'), ['price', 'mc', 'liq', 'lp', 'burned'].map((k) => `${k} ${bl(k)}`).join(' · '));
const mc = Number(bl('mc').replace(/[$,]/g, ''));
pin("/: the bar's MC is within 5% of /api/price", pr && mc > 0 && Math.abs(mc - pr.market_cap_usd) / pr.market_cap_usd < 0.05, `${mc} vs ${pr?.market_cap_usd}`);
pin("/: 24h vol keeps its dash (it needs the chart's trades)", bl('vol') === '—', bl('vol'));
// 4.11. later: /nft/, /pass, /set-and-earn, /advantage, /pancakeswap and who is active on /board
const nft = await fetch('https://brainonbnb.com/api/nft/state', { headers: H }).then((r) => r.json()).catch(() => null), nh = await raw('/nft/');
const minted = inner(nh, 'stat-minted');
pin('/nft/: total minted and holders in the page, the same as /api/nft/state', nft && minted === nft.minted.reduce((x, y) => x + y, 0).toLocaleString('en-US') && inner(nh, 'stat-buyers') === Number(nft.holders).toLocaleString('en-US'), `${minted} · ${inner(nh, 'stat-buyers')} · ${inner(nh, 'stat-last')}`);
pin('/nft/: tiers, rarities and the newest drops are written, not "Loading"', !/Loading/.test(nh.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '')) && /NICE BUY \$100\+: \d/.test(nh) && /Common \d/.test(nh));
const ph = await raw('/pass'), hp = inner(ph, 'hp-line');
pin('/pass: the line in dollars at the on-chain price', /^The line today: 1,000,000 \$BOBAI \(≈\$[\d,]+\)/.test(hp), hp);
const se = inner(await raw('/set-and-earn'), 'se-live');
pin('/set-and-earn: the position, in or out of range, its worth', /^Right now: position #\d+ is (in|out of) range.*worth [\d.]+ BNB/.test(se), se);
const tr = inner(await raw('/advantage'), 'tr-sum');
pin('/advantage: the result on the capital and against holding', /on the capital/.test(tr) && /against simply holding/.test(tr), tr);
const pch = await raw('/pancakeswap'), own = inner(pch, 't-own');
pin('/pancakeswap: our position and the PancakeSwap library entries', /^Position #\d+/.test(own) && /<div id="t-lib"[^>]*><div class="rc-empty">#\d+ /.test(pch), own);
const bh = await raw('/board'), who = ((bh.match(/<div id="pb-active"><div class="rc-empty">([^<]*)</) || [])[1] || '');
pin('/board: who is active, not "Reading"', /others here in 30 days, \d+ of them wrote/.test(who), who);
// the burn table on the front page, /classic and /archive (4.11.): the newest runs of the bot's live log, with their tx
const log = await fetch('https://logs.brainonbnb.com/logs/burns.json', { headers: H }).then((r) => r.json()).catch(() => null);
const newestTx = log ? [...log].reverse().map((x) => x.bobaiBurnTx || x.burnTx || x.bobBurnTx).find(Boolean) : null;
const pages = { '/': home, '/classic': await raw('/classic'), '/archive': await raw('/archive') };
for (const [p, h] of Object.entries(pages)) {
  const body = (h.match(/<tbody id="tx-body">([\s\S]*?)<\/tbody>/) || [])[1] || '';
  pin(`${p}: the burn table holds the newest runs with their tx, not "Loading burns"`, !/Loading burns/.test(body) && /BURN BOBAI/.test(body) && !!newestTx && body.includes(newestTx), (body.match(/<td>([^<]*)<\/td>/) || [])[1]);
}
const cl = pages['/classic'], cv = (id) => ((cl.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`)) || [])[1] || '').trim();
pin('/classic: Market Cap, Liquidity, $BOBAI Burned, Burn runs and Supply Burned are figures', ['mcap', 'volume', 'total-bobai-burned', 'burn-count', 'supply-burned-pct'].every((k) => cv(k) && cv(k) !== '--'), ['mcap', 'volume', 'total-bobai-burned', 'burn-count', 'supply-burned-pct'].map((k) => `${k} ${cv(k)}`).join(' · '));
pin('/classic: Burn runs is the length of the live log', log && cv('burn-count') === log.length.toLocaleString('en-US'), `${cv('burn-count')} vs ${log?.length}`);
const rh = await raw('/registry'), rv = (id) => ((rh.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`)) || [])[1] || '').trim();
pin('/registry: the board counts and hires / settled tiles are figures', ['pb-n-all', 'pb-n-open', 'pb-n-done', 'aw-n-hired', 'aw-n-settled'].every((k) => /^[\d,]+$/.test(rv(k))), ['pb-n-all', 'pb-n-open', 'pb-n-done', 'aw-n-hired', 'aw-n-settled'].map((k) => `${k} ${rv(k)}`).join(' · '));
pin('/board: the newest threads are links in the list', /<div id="pb-list"><div class="rc-rows"><div class="rc-row"><span class="rc-what"><a href="\/board\/\d+">/.test(bh));
// the A-Z pass, block 2 (4.11.): Liquidity Boost III and the Giggle pot said "the first add / send lands with the next
// run" weeks after the first ones; /defi said "Reading the portfolio"
for (const p of ['/token', '/classic', '/']) {
  const h = p === '/' ? home : p === '/classic' ? cl : await raw('/token');
  const bb3 = (h.match(/<tbody id="bb3-tx-body">([\s\S]*?)<\/tbody>/) || [])[1] || '';
  pin(`${p}: Liquidity Boost III shows its adds with their tx, not "the first add lands"`, /bscscan\.com\/tx\/0x/.test(bb3) && !/First add lands/.test(bb3), (h.match(/id="bb3-count"[^>]*>([^<]*)</) || [])[1]);
}
for (const p of ['/classic', '/']) {
  const h = p === '/' ? home : cl, gg = (h.match(/<tbody id="gg-tx-body">([\s\S]*?)<\/tbody>/) || [])[1] || '';
  pin(`${p}: the Giggle pot shows its sends with their tx, not "the first send lands"`, /bscscan\.com\/tx\/0x/.test(gg) && !/first send lands/.test(gg), (h.match(/id="gg-bnb"[^>]*>([^<]*)</) || [])[1]);
}
const dh = await raw('/defi'), dcard = (dh.match(/<div class="agt-flow fi" id="defi-card">\s*<p class="agt-note">([^<]*)</) || [])[1] || '';
pin('/defi: the portfolio says what went in, what it is worth and the result against holding', /^Put in: [\d.]+ BNB/.test(dcard) && /against simply holding/.test(dcard), dcard);
pin('/defi: the series line says runs, days and where the fees went', /runs over \d+ days since/.test(inner(dh, 'ag-lp-series-sum')), inner(dh, 'ag-lp-series-sum'));
// the A-Z pass, block 3 (4.11.): the figure tiles of /jobs, /settle, /venus and /pancakeswap opened as dashes
const tileOf = (h, id) => ((h.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`)) || [])[1] || '').trim();
const pcs = await raw('/pancakeswap');
for (const [p, h, ids] of [['/jobs', jh, ['n-paid', 'n-u', 'n-prov', 'n-cli']], ['/settle', sh, ['n-jobs', 'n-u', 'n-prov', 'n-wait', 'r-jobs', 'r-u', 'r-cl']], ['/venus', vh, ['n-acts', 'n-hf', 'n-sup', 'n-days']], ['/pancakeswap', pcs, ['n-run', 'n-in', 'n-lib']]]) {
  pin(`${p}: its figure tiles carry figures, not dashes`, ids.every((k) => tileOf(h, k) && tileOf(h, k) !== '—'), ids.map((k) => `${k} ${tileOf(h, k)}`).join(' · '));
}
pin('/jobs: the paid tile is the board\'s own count', jb && tileOf(jh, 'n-paid') === Number(jb.totals_30d.paid).toLocaleString('en-US'), `${tileOf(jh, 'n-paid')} vs ${jb?.totals_30d?.paid}`);
// the lists under the head on /venus and /settle (4.11.): no "Reading the record…" left in either page's HTML
for (const p of ['/venus', '/settle']) {
  const h = (await raw(p)).replace(/<script[\s\S]*?<\/script>/g, '');
  pin(`${p}: no "Reading the record…" left for a reader without a browser`, !/Reading the record/.test(h), (h.match(/rc-empty">([^<]{0,120})/) || [])[1]);
}
console.log(bad ? `${bad} FAIL` : 'all PASS');
process.exitCode = bad ? 1 : 0;
