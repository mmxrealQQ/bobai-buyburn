// Pins the page share cards (2026-11-16, Liste A "an OG picture per page"): worker-og/pages.js + pageCard in card.js,
// the site's /og/page/ route and the five pages' own og:image. Offline: the sources are a fixed sample.
//   node scripts/og-page-regressions.mjs
import { readFileSync } from 'node:fs';
import { pageCard, boardCard } from '../worker-og/card.js';
import { pageSpec, PAGES, usdPrice, usdShort, amountShort } from '../worker-og/pages.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };
const SAMPLE = {
  'https://brainonbnb.com/api/price': { price_usd: 0.000163288, market_cap_usd: 143326 },
  'https://brainonbnb.com/api/liquidity': { liquidity_usd: 54116, lp_burned_percent: 99.99 },
  'https://brainonbnb.com/api/token': { totalSupply: '1000000000', circulatingSupply: '877746572', burned: '122253427', renounced: true, verified: true },
  'https://brainonbnb.com/api-registry.json': { registered_ids: 419005, measured_at: '2026-11-15T05:56:14Z', independent_operators: 135, reachability: { reachable: 1007, answering_mcp: 324 } },
  'https://agent.brainonbnb.com/census': { highest_id: 419583 },
  'https://agent.brainonbnb.com/jobs/board': { window_days: 30, totals_30d: { delivered: 162, paid: 148, paid_u: 11.42, providers: 24, paying_clients: 20 } },
  'https://agent.brainonbnb.com/lp/portfolio': { bnb_usd: 586.82, worth: { bnb: 2.3844, usd: 1399.22 }, pnl: { since: '2026-09-03T00:00:00Z', from_fees_bnb: 0.13902, change_pct: -8.44, vs_holding: { vs_holding_pct: -2.12 } }, holdings: { bobai_units: 220274 }, pool: { in_range: true, width_pct: 20, label: 'CAKE/BNB 0.05%' } },
  'https://agent.brainonbnb.com/venus/work': { log: [
    { at: '2026-11-15T05:00:35Z', agent: 302257, action: 'repay', tx: '0x1' }, { at: '2026-11-15T05:00:35Z', agent: 302257, note: 'health factor now 2.1992' },
    { at: '2026-10-22T05:00:00Z', agent: 304493, action: 'deposit', amount: '4 USDC', tx: '0x2' }, { at: '2026-10-23T05:00:00Z', agent: 304493, action: 'deposit', amount: '2.5 USDT', tx: '0x3' } ] },
  'https://agent.brainonbnb.com/settle/public': { totals: { since: '2026-10-23T21:15:36Z', jobs: 79, released_u: 9.6, providers: new Array(24).fill('0x') }, refunds: { totals: { jobs: 61, returned_u: 6.4208, clients: new Array(34).fill('0x') } } },
};
const get = async (u) => SAMPLE[u] ?? null, none = async () => null;
const text = (svg) => svg.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ');

ok('formats: $0.000163, $143K, $54.1K, 122.3M, 1B', usdPrice(0.000163288) === '$0.000163' && usdShort(143326) === '$143K' && usdShort(54116) === '$54.1K' && amountShort(122253427) === '122.3M' && amountShort(1e9) === '1B');
const tk = text(pageCard(await pageSpec('token', get)));
ok('token: price, burned 12.2%, liquidity, circulating', /\$0\.000163/.test(tk) && /12\.2%/.test(tk) && /\$54\.1K/.test(tk) && /877\.7M/.test(tk) && /LP 99\.99% burned for good/.test(tk), tk.slice(0, 200));
ok('token: renounced and verified only when the contract says so', /ownership renounced · contract verified/.test(tk));
const tk2 = text(pageCard(await pageSpec('token', async (u) => (u.endsWith('/api/token') ? { ...SAMPLE[u], renounced: false } : SAMPLE[u]))));
ok('token: not renounced -> the box does not claim it', !/renounced/.test(tk2));
const rg = text(pageCard(await pageSpec('registry', get)));
ok('registry: the higher of census and scan, 1,007 answer, 324 MCP, 135 operators', /419,583/.test(rg) && /1,007/.test(rg) && /324/.test(rg) && /135/.test(rg) && /contacted 15 Nov 2026/.test(rg));
const jb = text(pageCard(await pageSpec('jobs', get)));
ok('jobs: 162 delivered, 148 paid, 11.42 $U, 20 clients, 24 agents', /162/.test(jb) && /148/.test(jb) && /11\.42 \$U paid out/.test(jb) && /\b20\b/.test(jb) && /\b24\b/.test(jb));
const st = text(pageCard(await pageSpec('settle', get)));
ok('settle: 79 settled, 9.60 $U to 24, 61 refunded, 6.42 $U to 34, since 23 Oct 2026', /79/.test(st) && /9\.60 \$U/.test(st) && /to 24 agents/.test(st) && /61/.test(st) && /6\.42 \$U/.test(st) && /to 34 clients/.test(st) && /SINCE 23 OCT 2026/.test(st));
const df = text(pageCard(await pageSpec('defi', get)));
ok('defi: $1.4K working, $81.58 of fees since 3 Sept, 220,274 $BOBAI held, the result as the page says it (−8.4%, −2.1% against holding)', /\$1\.4K/.test(df) && /\$81\.58/.test(df) && /since 3 Sept 2026/.test(df) && /220,274/.test(df) && /−8\.4%/.test(df) && /−2\.1% against simply holding/.test(df) && /IN RANGE · ±20% · CAKE\/BNB 0\.05%/.test(df), df.slice(0, 400));
ok('defi: the $BOBAI tile does not say all of it was bought with fees (2,046 came from the Set and Earn $U)', !/bought with its fees/.test(df) && /in its own wallet, never sold/.test(df));
const dfUp = text(pageCard(await pageSpec('defi', async (u) => (u.endsWith('/lp/portfolio') ? { ...SAMPLE[u], pnl: { ...SAMPLE[u].pnl, change_pct: 3.2 }, pool: { ...SAMPLE[u].pool, in_range: false } } : SAMPLE[u]))));
ok('defi: a gain reads +, out of range says so', /\+3\.2%/.test(dfUp) && /OUT OF RANGE/.test(dfUp));
const vn = text(pageCard(await pageSpec('venus', get)));
ok('venus: 3 actions, health factor 2.20, $6.50 supplied (4 USDC + 2.5 USDT deposited), 3 days — as /venus counts them', /On chain 3 /.test(vn) && /2\.20/.test(vn) && /\$6\.50/.test(vn) && /Days at work 3 /.test(vn), vn.slice(0, 400));
for (const n of PAGES) {
  const sp = await pageSpec(n, none), t = text(pageCard(sp));
  ok(`${n}: a source that did not answer reads "—", never a number, and is not cached long`, sp.ok === false && /—/.test(t) && !/\b(NaN|undefined|null)\b/.test(t));
}
// nothing that ends: the words hold in every tax phase and after every season
const all = [tk, rg, jb, st, df, vn].join(' ');
ok('no seasonal or dated promise in the cards (until / Dec 1 / Brain Pop / Giggle / Set and Earn)', !/until|Dec 1|Brain Pop|Giggle|Set and Earn|brainrot/i.test(all));
// a long value shrinks to its tile, never past it
const big = pageCard({ label: 'x', sub: 'x', head: ['a', 'b'], box: ['x', 'x'], tiles: [['t', '$123,456,789.12', 's'], ['t', '1', 's'], ['t', '1', 's'], ['t', '1', 's']], foot: 'x', cta: 'x' });
const sz = Number((big.match(/font-size="(\d+)" fill="[^"]+">\$123,456,789\.12/) || [])[1]);
ok('a long tile value shrinks (15 chars -> at most 28 px)', sz > 0 && sz <= 28, String(sz));
// the board card's "Waiting" is what board.md calls waiting
ok('board card: "Waiting" = bugs and questions without an answer (asking), not every open entry', /Waiting/.test(text(boardCard({ total: 146, open: 39, asking: 2, resolved: 50 }, { count: 31 }))) && / 2 /.test(text(boardCard({ total: 146, open: 39, asking: 2, resolved: 50 }, { count: 31 }))) && !/ 39 /.test(text(boardCard({ total: 146, open: 39, asking: 2, resolved: 50 }, { count: 31 }))));

const w = readFileSync(new URL('../dashboard/_worker.js', import.meta.url), 'utf8');
ok('site: /og/page/<token|registry|jobs|settle|scanner|defi|venus|services|connect|list|library>.png goes to the card worker', /page\\\/\(\?:token\|registry\|jobs\|settle\|scanner\|defi\|venus\|services\|connect\|list\|library\)\)\\\.png\$\//.test(w));
// (18.11.) /list and /library
const SAMPLE3 = { ...SAMPLE, 'https://agent.brainonbnb.com/listings': { price_usd: 95, listings: [{ id: '1', house: true }] }, 'https://brainonbnb.com/api-registry.json': { ...SAMPLE['https://brainonbnb.com/api-registry.json'], hireable_here: 57 }, 'https://brainonbnb.com/code/manifest.json': { license: 'MIT', bundles: [{ files: 3, lines: 1000 }, { files: 4, lines: 2117 }] } };
const ls = text(pageCard(await pageSpec('list', async (u) => SAMPLE3[u] ?? null)));
ok('list: $95 from the listing service, 1,007 answer, 57 hireable, daily check', /\$95/.test(ls) && /1,007/.test(ls) && /\b57\b/.test(ls) && /Daily/.test(ls), ls.slice(0, 300));
ok('list: no tile counts outside listings (a marketplace does not lead with its empty shelf)', !/listed by others|Listed\b/.test(ls));
const lb = text(pageCard(await pageSpec('library', async (u) => SAMPLE3[u] ?? null)));
ok('library: bundles 2, files 7, lines 3,117, MIT from the manifest', /Bundles 2 /.test(lb) && /Files 7 /.test(lb) && /3,117/.test(lb) && /MIT/.test(lb), lb.slice(0, 300));
const lb0 = text(pageCard(await pageSpec('library', none)));
ok('library with no manifest: dashes, never 0 bundles', /Bundles — /.test(lb0) && !/Bundles 0/.test(lb0), lb0.slice(0, 200));
// (18.11.) /services and /connect: their own cards, the same figures as the pages, nothing the server does not keep
const SAMPLE2 = { ...SAMPLE, 'https://agent.brainonbnb.com/stats': { asked: { total: 680328, by_kind: { mcp: 137136 } } }, 'https://brainonbnb.com/mcp': { tools: new Array(30).fill('t') } };
const get2 = async (u) => SAMPLE2[u] ?? null;
const sv = text(pageCard(await pageSpec('services', get2)));
ok('services: answered 680,328, registered = live high-water 419,583, reply 1,007, $0.10 an answer', /680,328/.test(sv) && /419,583/.test(sv) && /1,007/.test(sv) && /\$0\.10/.test(sv) && /census of 15 Nov 2026/.test(sv), sv.slice(0, 300));
const cn = text(pageCard(await pageSpec('connect', get2)));
ok('connect: 30 tools from the server\'s own list, 137,136 MCP calls, free', /\b30\b/.test(cn) && /137,136/.test(cn) && /Free/.test(cn), cn.slice(0, 300));
ok('connect: never "read-only" (plaza_board_post writes a board entry)', !/read-only/i.test(cn));
const cn0 = text(pageCard(await pageSpec('connect', none)));
ok('connect with no source answering: a dash, never 0 tools', /Tools —/.test(cn0) && !/Tools 0/.test(cn0), cn0.slice(0, 200));
ok('the services generator names its card', readFileSync(new URL('build-services.mjs', import.meta.url), 'utf8').includes('https://brainonbnb.com/og/page/services.png'));
const og = readFileSync(new URL('../worker-og/index.js', import.meta.url), 'utf8');
ok('worker-og: the /page/ route, scanner as the plain card', /\(\?:og\\\/\)\?page\\\/\(\[a-z\]\{3,12\}\)\\\.png\$\//.test(og) && /card\(null\)/.test(og));
for (const [f, n] of [['token', 'token'], ['registry', 'registry'], ['jobs', 'jobs'], ['settle', 'settle'], ['scanner', 'scanner'], ['defi', 'defi'], ['venus', 'venus'], ['services', 'services'], ['connect', 'connect'], ['list', 'list'], ['library', 'library']]) {
  const h = readFileSync(new URL(`../dashboard/${f}.html`, import.meta.url), 'utf8');
  ok(`/${f}: og:image and twitter:image are its own card`, h.includes(`<meta property="og:image" content="https://brainonbnb.com/og/page/${n}.png">`) && h.includes(`<meta name="twitter:image" content="https://brainonbnb.com/og/page/${n}.png">`));
}
ok('the registry generator names the same card', readFileSync(new URL('erc8004-publish.mjs', import.meta.url), 'utf8').includes('https://brainonbnb.com/og/page/registry.png'));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
