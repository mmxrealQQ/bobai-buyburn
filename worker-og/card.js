// THE SHARE CARD's picture (2026-10-13): one pre-trade check (/api/preflight, the same reading the scanner page and
// the MCP tool bsc_token_preflight give) drawn as a 1200x630 SVG, rendered to PNG by index.js. Pure: answer in, SVG out.
//
// Its words follow the scanner page's rule — "we make no claim about any token": the verdict line names what was
// MEASURED (a stop sign, things to weigh, none found), never whether the token is good. Every figure is the check's own;
// a figure the check did not give is a dash, never a guess.

const W = 1200, H = 630;
const GOLD = '#f0b90b', MUTED = '#9a9cb8', TEXT = '#f2f2f7', GREEN = '#3fe09a', AMBER = '#f5b942', RED = '#ff7a6e';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const cut = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));
const pct = (v, d = 2) => { const x = num(v); return x == null ? '—' : (Math.abs(x) < 10 ? x.toFixed(d) : x.toFixed(1)).replace(/\.?0+$/, '') + '%'; };
const usd = (v) => { const x = num(v); if (x == null) return '—'; return x >= 1e6 ? '$' + (x / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : x >= 1e3 ? '$' + (x / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : '$' + Math.round(x); };

// what each measured sign is called on the card (the codes of dashboard/preflight.js)
export const SIGNS = {
  not_sellable: 'cannot be sold', not_buyable: 'cannot be bought', lp_withdrawn: 'liquidity withdrawn', lp_pullable: 'liquidity can be pulled',
  lp_withdrawable: 'liquidity withdrawable', dev_selling: 'deployer selling', top_holder_selling: 'top holder selling', tax_can_change: 'tax can change',
  tax_unknown: 'tax unknown', round_trip: 'costly round trip', size_moves_price: 'this size moves the price', size_beyond_ladder: 'size beyond the measured ladder',
  holders_concentrated: 'holders concentrated', holders_unknown: 'holders not readable', contract_flags: 'contract flags set', owner_is_eoa: 'owned by a wallet',
  source_not_verified: 'source not verified', sniped_launch: 'sniped launch', volume_from_few_wallets: 'volume from few wallets', on_launch_curve: 'still on the launch curve',
  deeper_pool_elsewhere: 'a deeper pool elsewhere', partial_market: 'part of the market unread', no_route_quote: 'no route quoted', not_quotable: 'no quote',
  quote_not_priced: 'quote not priced', sell_not_quotable: 'sell not quotable', sell_not_simulated: 'sell not simulated', sell_tested_on_another_pair: 'sell tested on another pair',
};

export function card(pf, { address = '' } = {}) {
  const ok = pf && pf.token;
  const sym = cut(ok ? (pf.token.symbol || pf.token.name) : 'Any token', 12);
  const name = cut(ok ? pf.token.name : 'Paste a BNB Chain token and see what a trade really costs', 74);
  const addr = String((ok && pf.token.address) || address || '');
  const short = /^0x[0-9a-fA-F]{40}$/.test(addr) ? addr.slice(0, 6) + '…' + addr.slice(-4) + ' · BNB Chain' : 'BNB Chain';
  const stop = (ok && pf.stop) || [], caution = (ok && pf.caution) || [];
  const gate = !ok ? null : stop.length ? 'stop' : caution.length ? 'weigh' : 'clear';
  const tone = { stop: RED, weigh: AMBER, clear: GREEN }[gate] || GOLD;
  const head = { stop: 'Stop sign measured', weigh: 'Things to weigh', clear: 'No stop sign measured' }[gate] || 'Read live from the chain';
  const signs = [...stop, ...caution].map((x) => SIGNS[x.code] || String(x.code || '').replace(/_/g, ' ')).filter(Boolean);
  // as many signs as fit whole, and how many more there are (cutting a word off lost the count)
  let verdict = head;
  for (let k = Math.min(3, signs.length); k >= 1; k--) {
    const t = head + ': ' + signs.slice(0, k).join(' · ') + (signs.length > k ? ` +${signs.length - k} more` : '');
    if (t.length <= 76 || k === 1) { verdict = cut(t, 78); break; }
  }

  const size = ok ? num(pf.size_usd) || 500 : 500;
  const sellable = ok && pf.exit ? pf.exit.sellable : null;
  const tiles = [
    ['Can you sell it?', sellable === true ? 'Yes' : sellable === false ? 'No' : '—', sellable === true ? GREEN : sellable === false ? RED : MUTED, 'a sell simulated just now'],
    ['Round trip at ' + usd(size), ok && pf.exit ? pct(pf.exit.round_trip_cost_pct) : '—', TEXT, 'fees + impact + tax'],
    ['Tax buy / sell', ok && pf.tax && pf.tax.buy_pct != null ? pct(pf.tax.buy_pct, 1) + ' / ' + pct(pf.tax.sell_pct, 1) : '—', TEXT, ok && pf.tax && /measured/.test(pf.tax.source || '') ? 'measured from real trades' : 'as read'],
    ['Moves the price 1%', ok && pf.depth ? usd(pf.depth.one_percent_sell_usd ?? pf.depth.one_percent_buy_usd) : '—', TEXT, 'sell size, deepest pool'],
  ];
  const when = ok && pf.measured_at ? new Date(pf.measured_at) : null;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const stamp = when && !isNaN(when) ? `${when.getUTCDate()} ${MON[when.getUTCMonth()]} ${when.getUTCFullYear()} ${String(when.getUTCHours()).padStart(2, '0')}:${String(when.getUTCMinutes()).padStart(2, '0')} UTC` : '';
  const foot = ok ? cut(`Measured on BNB Chain${pf.block ? ' · block ' + Number(pf.block).toLocaleString('en-US') : ''}${stamp ? ' · ' + stamp : ''} · a reading, not advice`, 96) : 'Free, no wallet, nothing sent from your account · a reading, not advice';

  const TW = 255, TG = 20, TX = 60, TY = 372, TH = 160;
  // no reading: no dashes pretending to be figures — what a scan gives, in the scanner page's own four headings
  const promise = [['What a trade', 'really costs', 'impact + fees at six sizes'], ['The hidden tax,', 'measured', 'from trades that happened'], ['Who can pull', 'the money out', 'LP burned, locked or not'], ['Can you', 'sell it?', 'a sell simulated live']];
  const tileSvg = !ok ? promise.map(([a, b, sub], i) => {
    const x = TX + i * (TW + TG);
    return `<g><rect x="${x}" y="${TY}" width="${TW}" height="${TH}" rx="18" fill="#17171f" stroke="#2a2a36"/>`
      + `<text x="${x + 22}" y="${TY + 52}" font-family="Space Grotesk" font-weight="700" font-size="27" fill="${TEXT}">${esc(a)}</text>`
      + `<text x="${x + 22}" y="${TY + 86}" font-family="Space Grotesk" font-weight="700" font-size="27" fill="${GOLD}">${esc(b)}</text>`
      + `<text x="${x + 22}" y="${TY + 132}" font-family="Inter" font-weight="400" font-size="15" fill="${MUTED}">${esc(sub)}</text></g>`;
  }).join('') : tiles.map(([label, value, color, sub], i) => {
    const x = TX + i * (TW + TG);
    return `<g><rect x="${x}" y="${TY}" width="${TW}" height="${TH}" rx="18" fill="#17171f" stroke="#2a2a36"/>`
      + `<text x="${x + 22}" y="${TY + 40}" font-family="Inter" font-weight="600" font-size="19" fill="${MUTED}">${esc(label)}</text>`
      + `<text x="${x + 22}" y="${TY + 102}" font-family="Space Grotesk" font-weight="700" font-size="${String(value).length > 10 ? 34 : String(value).length > 8 ? 40 : 50}" fill="${color}">${esc(value)}</text>`
      + `<text x="${x + 22}" y="${TY + 136}" font-family="Inter" font-weight="400" font-size="15" fill="${MUTED}">${esc(cut(sub, 30))}</text></g>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <radialGradient id="glow" cx="0.08" cy="0" r="0.9"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.22"/><stop offset="0.6" stop-color="${GOLD}" stop-opacity="0.03"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>
  <clipPath id="logo"><circle cx="88" cy="70" r="30"/></clipPath>
</defs>
<rect width="${W}" height="${H}" fill="#0b0b10"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="28" fill="none" stroke="${GOLD}" stroke-opacity="0.35" stroke-width="2"/>
<image x="58" y="40" width="60" height="60" clip-path="url(#logo)" xlink:href="LOGO_DATA_URI"/>
<text x="134" y="66" font-family="Space Grotesk" font-weight="700" font-size="22" letter-spacing="3" fill="${GOLD}">BOBAI POOL SCANNER</text>
<text x="134" y="93" font-family="Inter" font-weight="400" font-size="18" fill="${MUTED}">What would buying this token really cost?</text>
<text x="${W - 60}" y="72" text-anchor="end" font-family="Inter" font-weight="600" font-size="21" fill="${GOLD}">brainonbnb.com</text>
<text x="60" y="210" font-family="Space Grotesk" font-weight="700" font-size="86" fill="${TEXT}">${esc(sym)}</text>
<text x="60" y="252" font-family="Inter" font-weight="600" font-size="24" fill="${TEXT}" fill-opacity="0.85">${esc(ok ? name : '')}</text>
<text x="60" y="${ok ? 284 : 252}" font-family="Inter" font-weight="400" font-size="${ok ? 18 : 22}" fill="${MUTED}">${esc(ok ? short : name)}</text>
<rect x="60" y="306" width="${W - 120}" height="46" rx="23" fill="${tone}" fill-opacity="0.12" stroke="${tone}" stroke-opacity="0.55"/>
<circle cx="88" cy="329" r="7" fill="${tone}"/>
<text x="106" y="336" font-family="Inter" font-weight="600" font-size="20" fill="${tone}">${esc(verdict)}</text>
${tileSvg}
<text x="60" y="586" font-family="Inter" font-weight="400" font-size="16" fill="${MUTED}">${esc(foot)}</text>
<text x="${W - 84}" y="586" text-anchor="end" font-family="Inter" font-weight="600" font-size="17" fill="${GOLD}">Scan any token free</text>
<path d="M${W - 76} 580 h14 M${W - 68} 574 l7 6 l-7 6" stroke="${GOLD}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}
