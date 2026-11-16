// THE PAGE CARDS' WORDS AND FIGURES (2026-11-16). One spec per page for pageCard() in card.js, its figures read live
// from the same public sources the page itself reads, so a card never says other than its page. Pure apart from `get`
// (a JSON fetcher that answers null on failure); a figure that could not be read is "—", never a guess.
//   /token    /api/price, /api/liquidity, /api/token
//   /registry /api-registry.json (the census) and the agent server's /census (the live registered count)
//   /jobs     agent /jobs/board (the last 30 days on the ERC-8183 escrow)
//   /settle   agent /settle/public (every settle and refund since 23 Oct 2026)
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

export const PAGES = ['token', 'registry', 'jobs', 'settle'];

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
  return null;
}
