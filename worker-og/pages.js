// THE PAGE CARDS' WORDS AND FIGURES (2026-11-16). One spec per page for pageCard() in card.js, its figures read live
// from the same public sources the page itself reads, so a card never says other than its page. Pure apart from `get`
// (a JSON fetcher that answers null on failure); a figure that could not be read is "—", never a guess.
//   /token    /api/price, /api/liquidity, /api/token
//   /registry /api-registry.json (the census) and the agent server's /census (the live registered count)
//   /jobs     agent /jobs/board (the last 30 days on the ERC-8183 escrow)
//   /settle   agent /settle/public (every settle and refund since 23 Oct 2026)
//   /defi     agent /lp/portfolio (what /defi's own card reads: worth, fees, result, $BOBAI held, the range)
//   /venus    agent /venus/work (the four tiles /venus shows: actions, health factor, supplied, days)
// Every sentence here holds in every tax phase and on any day: nothing seasonal, nothing that ends.

const SITE = 'https://brainonbnb.com', AG = 'https://agent.brainonbnb.com';
const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));
const int = (v) => (num(v) == null ? '—' : Math.round(num(v)).toLocaleString('en-US'));
// $143K, $54.1K, $1.2M — the size at a glance
export const usdShort = (v) => {
  const x = num(v); if (x == null) return '—';
  if (x >= 1e6) return '$' + (x / 1e6).toFixed(x >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (x >= 1e3) return '$' + (x / 1e3).toFixed(x >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return '$' + x.toFixed(2);
};
// a token price with three significant digits: $0.000163
export const usdPrice = (v) => { const x = num(v); if (x == null || x <= 0) return '—'; return '$' + (x >= 1 ? x.toFixed(2) : x.toPrecision(3).replace(/e.*$/, '')); };
// 122,253,427 -> 122.3M
export const amountShort = (v) => { const x = num(v); if (x == null) return '—'; return x >= 1e9 ? (x / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B' : x >= 1e6 ? (x / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : int(x); };
const u2 = (v) => (num(v) == null ? '—' : num(v).toFixed(2) + ' $U');
const day = (iso) => { const t = Date.parse(iso || ''); return isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null; };

export const PAGES = ['token', 'registry', 'jobs', 'settle', 'defi', 'venus', 'services', 'connect', 'list', 'library'];
const signedPct = (v, d = 1) => (num(v) == null ? '—' : (num(v) < 0 ? '−' : '+') + Math.abs(num(v)).toFixed(d) + '%');

export async function pageSpec(name, get) {
  if (name === 'token') {
    const [p, l, t] = await Promise.all([get(SITE + '/api/price'), get(SITE + '/api/liquidity'), get(SITE + '/api/token')]);
    const total = num(t && t.totalSupply), burned = num(t && t.burned);
    const pct = total && burned != null ? (burned / total) * 100 : null;
    const ok = t && t.renounced === true && t.verified === true;
    return {
      label: '$BOBAI · BRAIN ON BNB AI', sub: 'The token on BNB Chain: every tax step a transaction you can check',
      head: ['Every trade ', 'feeds the burn'],
      box: ['CONTRACT · BNB CHAIN', '0x245c…ffff' + (ok ? ' · ownership renounced · contract verified' : '')],
      tiles: [
        ['Price', usdPrice(p && p.price_usd), 'market cap ' + usdShort(p && p.market_cap_usd), false],
        ['Burned', pct == null ? '—' : pct.toFixed(1) + '%', amountShort(burned) + ' $BOBAI, gone for good', true],
        ['Liquidity', usdShort(l && l.liquidity_usd), l && num(l.lp_burned_percent) != null ? `LP ${num(l.lp_burned_percent)}% burned for good` : 'the BOBAI/BNB pool', false],
        ['Circulating', amountShort(t && t.circulatingSupply), 'of ' + amountShort(total) + ' total supply', false],
      ],
      foot: 'Read live from the chain · a reading, not advice', cta: 'See the token', ok: !!(p || l || t),
    };
  }
  if (name === 'registry') {
    const [r, c] = await Promise.all([get(SITE + '/api-registry.json'), get(AG + '/census')]);
    const reg = Math.max(num(r && r.registered_ids) || 0, num(c && c.highest_id) || 0) || null;
    const rc = (r && r.reachability) || {};
    const when = day(r && r.measured_at);
    return {
      label: 'BRAIN PLAZA · THE REGISTRY', sub: 'Every ERC-8004 agent on BNB Chain, read and contacted',
      head: ['Which agents ', 'really answer'],
      box: ['MEASURED, NOT SELF-REPORTED', 'Every agent contacted; only the ones that answer are kept'],
      tiles: [
        ['Registered', int(reg), 'ERC-8004 ids, read live', false],
        ['Answer', int(rc.reachable), when ? 'contacted ' + when : 'when contacted', true],
        ['Speak MCP', int(rc.answering_mcp), 'tools another agent can call', false],
        ['Operators', int(r && r.independent_operators), 'run the ones that answer', false],
      ],
      foot: 'The whole registry read, every endpoint contacted · checkable', cta: 'Find an agent', ok: !!r,
    };
  }
  if (name === 'jobs') {
    const j = await get(AG + '/jobs/board');
    const t = (j && j.totals_30d) || {};
    return {
      label: 'JOB BOARD · ERC-8183 ESCROW', sub: 'Who gets hired and paid on BNB Chain, read from the chain',
      head: ['Who gets ', 'hired and paid'],
      box: ['LAST ' + (num(j && j.window_days) || 30) + ' DAYS', 'Agents ranked by jobs paid; self-hires and the farm left out'],
      tiles: [
        ['Delivered', int(t.delivered), 'jobs delivered', false],
        ['Paid', int(t.paid), u2(t.paid_u) + ' paid out', true],
        ['Paying clients', int(t.paying_clients), 'wallets that paid', false],
        ['Agents paid', int(t.providers), 'got paid for their work', false],
      ],
      foot: 'Read from the chain every day · nobody can pay for a place', cta: 'See the board', ok: !!j,
    };
  }
  if (name === 'settle') {
    const j = await get(AG + '/settle/public');
    const t = (j && j.totals) || {}, r = (j && j.refunds && j.refunds.totals) || {};
    const since = day(t.since);
    return {
      label: 'JOB SETTLER · FREE FOR EVERY AGENT', sub: 'Finished ERC-8183 jobs settled once a day on BNB Chain',
      head: ['Jobs settled ', 'for every agent'],
      box: [since ? 'SINCE ' + since.toUpperCase() : 'EVERY DAY', "Any agent's due jobs settled or refunded, the gas paid by BOBAI"],
      tiles: [
        ['Settled', int(t.jobs), 'finished jobs', false],
        ['Released', u2(t.released_u), 'to ' + int((t.providers || []).length) + ' agents', true],
        ['Refunded', int(r.jobs), 'expired, never delivered', false],
        ['Returned', u2(r.returned_u), 'to ' + int((r.clients || []).length) + ' clients', false],
      ],
      foot: 'Every settle and refund with its transaction on BscScan', cta: 'See every settle', ok: !!j,
    };
  }
  if (name === 'defi') {
    // the result is said as the page says it, loss or gain: a card that showed only the good tiles would be an advert
    const p = await get(AG + '/lp/portfolio');
    const w = (p && p.worth) || {}, pl = (p && p.pnl) || {}, h = (p && p.holdings) || {}, pool = (p && p.pool) || {};
    const bu = num(p && p.bnb_usd), since = day(pl.since);
    const feesUsd = bu && num(pl.from_fees_bnb) != null ? usdShort(num(pl.from_fees_bnb) * bu) : '—';
    const range = pool.in_range === true ? 'IN RANGE' : pool.in_range === false ? 'OUT OF RANGE' : 'RANGE';
    return {
      label: 'THE DEFI AGENT · #363709', sub: 'An AI agent running a PancakeSwap V3 position on BNB Chain, in public',
      head: ['Its fees ', 'buy $BOBAI'],
      box: [[range, pool.width_pct ? '±' + num(pool.width_pct) + '%' : null, pool.label || null].filter(Boolean).join(' · '), 'Every run, its wallet and its transactions on the record'],
      tiles: [
        ['Working', usdShort(w.usd), (num(w.bnb) == null ? '—' : num(w.bnb).toFixed(2)) + ' BNB in the position', false],
        ['Fees earned', feesUsd, (num(pl.from_fees_bnb) == null ? '—' : num(pl.from_fees_bnb).toFixed(3)) + ' BNB' + (since ? ' since ' + since : ''), true],
        ['$BOBAI held', amountShort(h.bobai_units), 'in its own wallet, never sold', false],
        ['Result', signedPct(pl.change_pct), pl.vs_holding && num(pl.vs_holding.vs_holding_pct) != null ? signedPct(pl.vs_holding.vs_holding_pct) + ' against simply holding' : 'on the capital put in', false],
      ],
      foot: 'Read from the chain at every run · a record, not advice', cta: 'See the agent', ok: !!p,
    };
  }
  if (name === 'venus') {
    // the same four figures as /venus's tiles (dashboard/_worker.js RECORD_PAGES['/venus']), from the same log
    const j = await get(AG + '/venus/work');
    const log = (j && Array.isArray(j.log)) ? j.log : [];
    const acts = log.filter((x) => x.tx);
    const hf = log.map((x) => String(x.note || '').match(/^health factor (?:now )?([\d.]+)/)).find(Boolean);
    const sup = acts.filter((x) => x.action === 'deposit').reduce((a, x) => a + (parseFloat(x.amount) || 0), 0);
    const days = new Set(log.map((x) => String(x.at).slice(0, 10))).size;
    return {
      label: 'VENUS AGENTS · #302257 · #304493', sub: 'Two AI agents on Venus, each with its own wallet, doing what they sell',
      head: ['Agents that ', 'use what they sell'],
      box: ['THEIR OWN MONEY ON VENUS', 'A loan kept safe and stablecoins put to work, every step a transaction'],
      tiles: [
        ['On chain', j ? int(acts.length) : '—', 'actions, each a transaction', false],
        ['Health factor', hf ? Number(hf[1]).toFixed(2) : '—', 'of the loan the monitor keeps', true],
        ['Supplied', j ? '$' + sup.toFixed(2) : '—', 'stablecoins put to work', false],
        ['Days at work', j ? int(days) : '—', 'a run every morning', false],
      ],
      foot: 'Read from their log and the chain · a record, not advice', cta: 'See the agents', ok: !!j,
    };
  }
  if (name === 'services') {
    // (18.11.) the same three figures as /services' own tiles (dashboard/_worker.js RECORD_PAGES['/services']), same sources
    const [r, c, st] = await Promise.all([get(SITE + '/api-registry.json'), get(AG + '/census'), get(AG + '/stats')]);
    const reg = Math.max(num(r && r.registered_ids) || 0, num(c && c.highest_id) || 0) || null;
    const when = day(r && r.measured_at);
    return {
      label: 'SERVICES · BRAIN ON BNB', sub: 'We measure BNB Chain and tell you what we found',
      head: ['Free to look, ', '$0.10 an answer'],
      box: ['PAID IN USD1, ONE SIGNATURE, NO GAS', 'Nothing signs until you buy · free with 1,000,000 $BOBAI'],
      tiles: [
        ['Answered', int(st && st.asked && st.asked.total), 'requests answered for others', true],
        ['Registered', int(reg), 'agent ids on BNB Chain', false],
        ['Reply', int(r && r.reachability && r.reachability.reachable), when ? 'census of ' + when : 'when contacted', false],
        ['Per answer', '$0.10', 'or $0.05 in $BOBAI', false],
      ],
      foot: 'Every figure read live · free to look, no wallet', cta: 'See what we do', ok: !!(r || st),
    };
  }
  if (name === 'connect') {
    // (18.11.) the tool count is the server's own list (GET /mcp), the calls are what /stats counted as MCP
    const [m, st] = await Promise.all([get(SITE + '/mcp'), get(AG + '/stats')]);
    const tools = m && Array.isArray(m.tools) ? m.tools.length : null;
    return {
      label: 'CONNECT · MCP SERVER', sub: 'Keep the Brain in your AI: Claude, Cursor, VS Code',
      head: ['One click, ', 'no key'],
      box: ['BRAINONBNB.COM/MCP', 'Nothing signs, no wallet, nothing to install'],
      tiles: [
        ['Tools', tools == null ? '—' : int(tools), 'answering now, no key', true],
        ['MCP calls', int(st && st.asked && st.asked.by_kind && st.asked.by_kind.mcp), 'answered for agents', false],
        ['Price', 'Free', 'no key, no account, no wallet', false],
        ['Clients', '3', 'Claude, Cursor and VS Code', false],
      ],
      foot: 'A token check before every trade · nothing signs', cta: 'Connect it', ok: !!(m || st),
    };
  }
  if (name === 'list') {
    // (18.11.) the price from the listing service itself, the field it joins from the census; never "listed by others"
    // (still 0: a marketplace does not lead with its empty shelf, 2026-10-30)
    const [li, r] = await Promise.all([get(AG + '/listings'), get(SITE + '/api-registry.json')]);
    const price = num(li && li.price_usd);
    return {
      label: 'BRAIN PLAZA · LIST YOUR AGENT', sub: 'The directory of BNB Chain agents that actually answer',
      head: ['Built an agent that works? ', 'List it.'],
      box: [price ? '$' + price + ' ONCE · USD1, BNB OR $BOBAI' : 'ONCE · USD1, BNB OR $BOBAI', 'A profile, a badge, a daily check · never a place in the list'],
      tiles: [
        ['Answer', int(r && r.reachability && r.reachability.reachable), 'agents reply when contacted', true],
        ['Hireable', int(r && r.hireable_here), 'with a Hire button here', false],
        ['Price', price ? '$' + price : '—', 'once, no subscription', false],
        ['Checked', 'Daily', 'silent 3 days: badge goes', false],
      ],
      foot: 'The order is the evidence · nobody can buy a place', cta: 'List your agent', ok: !!(li || r),
    };
  }
  if (name === 'library') {
    // (18.11.) the library's own manifest: how many bundles, files and lines anyone can read and run
    const m = await get(SITE + '/code/manifest.json');
    const b = m && Array.isArray(m.bundles) ? m.bundles : null;
    const sum = (k) => (b ? b.reduce((a, x) => a + (num(x[k]) || 0), 0) : null);
    return {
      label: 'THE LIBRARY · OPEN SOURCE', sub: 'Every bot and app behind $BOBAI, packaged to be read and run',
      head: ['The code behind ', 'everything'],
      box: ['MIT LICENSED · NO ACCOUNT', 'Read in the browser or take the zip · no secrets inside'],
      tiles: [
        ['Bundles', b ? int(b.length) : '—', 'bots, apps and tools', true],
        ['Files', int(sum('files')), 'in the bundles', false],
        ['Lines', b ? amountShort(sum('lines')) : '—', 'of code, every one readable', false],
        ['License', m && m.license ? String(m.license) : '—', 'take it, run it, change it', false],
      ],
      foot: 'Built from our own source · every file readable', cta: 'Open the library', ok: !!b,
    };
  }
  return null;
}
