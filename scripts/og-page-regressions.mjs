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
for (const n of PAGES) {
  const sp = await pageSpec(n, none), t = text(pageCard(sp));
  ok(`${n}: a source that did not answer reads "—", never a number, and is not cached long`, sp.ok === false && /—/.test(t) && !/\b(NaN|undefined|null)\b/.test(t));
}
// nothing that ends: the words hold in every tax phase and after every season
const all = [tk, rg, jb, st].join(' ');
ok('no seasonal or dated promise in the cards (until / Dec 1 / Brain Pop / Giggle / Set and Earn)', !/until|Dec 1|Brain Pop|Giggle|Set and Earn|brainrot/i.test(all));
// a long value shrinks to its tile, never past it
const big = pageCard({ label: 'x', sub: 'x', head: ['a', 'b'], box: ['x', 'x'], tiles: [['t', '$123,456,789.12', 's'], ['t', '1', 's'], ['t', '1', 's'], ['t', '1', 's']], foot: 'x', cta: 'x' });
const sz = Number((big.match(/font-size="(\d+)" fill="[^"]+">\$123,456,789\.12/) || [])[1]);
ok('a long tile value shrinks (15 chars -> at most 28 px)', sz > 0 && sz <= 28, String(sz));
// the board card's "Waiting" is what board.md calls waiting
ok('board card: "Waiting" = bugs and questions without an answer (asking), not every open entry', /Waiting/.test(text(boardCard({ total: 146, open: 39, asking: 2, resolved: 50 }, { count: 31 }))) && / 2 /.test(text(boardCard({ total: 146, open: 39, asking: 2, resolved: 50 }, { count: 31 }))) && !/ 39 /.test(text(boardCard({ total: 146, open: 39, asking: 2, resolved: 50 }, { count: 31 }))));

const w = readFileSync(new URL('../dashboard/_worker.js', import.meta.url), 'utf8');
ok('site: /og/page/<token|registry|jobs|settle|scanner>.png goes to the card worker', /page\\\/\(\?:token\|registry\|jobs\|settle\|scanner\)\)\\\.png\$\//.test(w));
const og = readFileSync(new URL('../worker-og/index.js', import.meta.url), 'utf8');
ok('worker-og: the /page/ route, scanner as the plain card', /\(\?:og\\\/\)\?page\\\/\(\[a-z\]\{3,12\}\)\\\.png\$\//.test(og) && /card\(null\)/.test(og));
for (const [f, n] of [['token', 'token'], ['registry', 'registry'], ['jobs', 'jobs'], ['settle', 'settle'], ['scanner', 'scanner']]) {
  const h = readFileSync(new URL(`../dashboard/${f}.html`, import.meta.url), 'utf8');
  ok(`/${f}: og:image and twitter:image are its own card`, h.includes(`<meta property="og:image" content="https://brainonbnb.com/og/page/${n}.png">`) && h.includes(`<meta name="twitter:image" content="https://brainonbnb.com/og/page/${n}.png">`));
}
ok('the registry generator names the same card', readFileSync(new URL('erc8004-publish.mjs', import.meta.url), 'utf8').includes('https://brainonbnb.com/og/page/registry.png'));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
