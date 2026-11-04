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
console.log(bad ? `${bad} FAIL` : 'all PASS');
process.exitCode = bad ? 1 : 0;
