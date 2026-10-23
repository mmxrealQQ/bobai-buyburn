// A QUESTION IN PLAIN WORDS GETS AN ANSWER TO THAT QUESTION (2026-10-13, operator: "our agents must work 100% and be top
// intelligent — Marque lists us"). An outside agent asked our Venus monitor "what is the health factor of 0x489A…?" and
// got the same self-description and the whole catalogue whatever it asked. Now each agent reads the question for what
// its one service needs (an address, a token, an amount, a number of levels, a position), says what it understood and
// what is still missing, and hands back the request that gets the measured answer — filled in, ready to send. Nothing
// is paid or signed here; the price and the paths are the ones the catalogue already states.

const ADDR = /0x[a-fA-F0-9]{40}/g;
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
// "with 5000 USDT" is dollars too (2026-10-23: Marque job 57037 named its capital in USDT and was planned at $1,000)
const usd = (t) => { const m = String(t).match(/\$\s?([\d,]+(?:\.\d+)?)\s*(k|K)?/) || String(t).match(/([\d,]+(?:\.\d+)?)\s*(?:usd[tc1]?|busd|fdusd|dollars?)\b/i); if (!m) return null; const v = parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1); return v > 0 ? v : null; };

// "$600 CAKE (0x…)", "1000 USD of 0x…", "0x… worth 1k": each address with the dollar figure written beside it (2026-10-18:
// an outside review wrote "1000 USD of 0x… and 1000 USD of 0x…" and was understood as 500 each)
const AMT = '(?:\\$\\s?([\\d,]+(?:\\.\\d+)?)\\s*(k|K)?|([\\d,]+(?:\\.\\d+)?)\\s*(k|K)?\\s*(?:usd[a-z1]*|dollars?|\\$))';
const num = (a, k) => parseFloat(String(a).replace(/,/g, '')) * (k ? 1000 : 1);
// The figure stands on the side the sentence puts it: an address written before the first figure takes the figure after
// it. Only a reading that gives EVERY address its figure counts; anything less is not a portfolio read correctly.
export function readHoldings(t) {
  const addrs = new Set((t.match(ADDR) || []).map((a) => a.toLowerCase()));
  const firstAddr = t.search(/0x[a-fA-F0-9]{40}/), firstAmt = t.replace(ADDR, (a) => 'x'.repeat(a.length)).search(new RegExp(AMT, 'i'));
  const addrFirst = firstAddr >= 0 && (firstAmt < 0 || firstAddr < firstAmt);
  const rx = addrFirst ? new RegExp('(0x[a-fA-F0-9]{40})[^$\\d]{0,24}?' + AMT, 'gi') : new RegExp(AMT + '[^$\\d]{0,40}?(0x[a-fA-F0-9]{40})', 'gi');
  const h = [], seen = new Set(); let m;
  while ((m = rx.exec(t))) {
    const [token, a, k] = addrFirst ? [m[1], m[2] ?? m[4], m[3] ?? m[5]] : [m[5], m[1] ?? m[3], m[2] ?? m[4]];
    if (!seen.has(token.toLowerCase())) { seen.add(token.toLowerCase()); h.push({ token, usd: num(a, k) }); }
  }
  return h.length === addrs.size ? h : [];
}
// "to 70/30" (weights in the order the holdings were named) or "70% 0x… 30% 0x…"; only when they add up to 100
export function readTargets(t, holdings = []) {
  const out = {};
  const rx = /(\d{1,3}(?:\.\d+)?)\s*%\s*(?:of|in|into|for)?\s*(?:[A-Za-z$]{1,10}\s*)?\(?\s*(0x[a-fA-F0-9]{40})/g; let m;
  while ((m = rx.exec(t))) out[m[2]] = Number(m[1]);
  if (!Object.keys(out).length && holdings.length >= 2) {
    const r = t.match(/(\d{1,3}(?:\.\d+)?(?:\s*\/\s*\d{1,3}(?:\.\d+)?)+)/);
    const w = r ? r[1].split('/').map(Number) : [];
    if (w.length === holdings.length) holdings.forEach((h, i) => { out[h.token] = w[i]; });
  }
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  return Object.keys(out).length >= 2 && Math.abs(sum - 100) < 0.5 ? out : null;
}
// "amountUsd 5000", "from: vUSDT" — a field named the way the card names it is read as that field
const named = (t, key) => t.match(new RegExp('\\b' + key + '\\b["\']?\\s*[:=]?\\s*["\']?([^\\s,;"\'}]+)', 'i'))?.[1];

// what each service takes, read from the sentence (only the keys the service names in its `needs`)
export function understand(service, text = '') {
  const t = String(text), addrs = [...new Set(t.match(ADDR) || [])], p = {};
  const need = Object.keys(service.needs || {});
  if (need.includes('address') && addrs[0]) p.address = addrs[0];
  if (need.includes('token') && addrs[0]) p.token = addrs[0];
  // "a grid for WBNB/USDT" names the token without its address (Mandate's grid question, 2026-10-15): WBNB is the one
  // token read by name, since BNB Chain's wrapped BNB has exactly one address
  else if (need.includes('token') && /\bW?BNB\b/.test(t)) p.token = WBNB;
  if (need.includes('position')) { const m = t.match(/position\s*(?:id\s*)?#?\s*(\d{3,})/i); if (m) p.position = m[1]; else if (addrs[0]) p.address = addrs[0]; }
  if (need.includes('capitalUsd')) { const v = usd(t); if (v) p.capitalUsd = v; }
  if (need.includes('amountUsd')) { const v = usd(t) ?? (Number(named(t, 'amountUsd')) > 0 ? Number(named(t, 'amountUsd')) : null); if (v) p.amountUsd = v; }
  if (need.includes('currentApyPct')) {
    // "I earn 2% on USDT today", "currentApyPct 2"
    const m = t.match(/earn(?:s|ing)?\s+(?:about\s+|around\s+)?(\d{1,2}(?:\.\d+)?)\s*%(?:\s*(?:apy|apr))?(?:\s+(?:on|in|from)\s+(v?[A-Za-z]{2,8}))?/i);
    const v = m ? Number(m[1]) : Number(named(t, 'currentApyPct'));
    if (v > 0) p.currentApyPct = v;
    if (need.includes('from') && m?.[2] && !/^(today|now|it|my|the|venus)$/i.test(m[2])) p.from = m[2];
  }
  if (need.includes('from') && !p.from) {
    const v = named(t, 'from') || t.match(/\b(?:from|out of|holding|hold|in)\s+(v[A-Z]{2,8}|[A-Z]{3,6})\b/)?.[1];
    if (v && !/^(USD|BSC|VENUS)$/i.test(v)) p.from = v;
  }
  if (need.includes('levels')) { const m = t.match(/(\d{1,3})\s*[- ]?\s*(?:levels?|grids?|steps?)/i); if (m) p.levels = Number(m[1]); }
  // AN EXPLICIT RANGE AND A STOP (2026-10-23): "between 500 and 5500 … stop below 400" (Marque job 57037) is a grid
  // with fixed bounds, not a ± band around the price; the stop is kept and reported, not traded
  if (need.includes('bandPct')) {
    const r = t.match(/between\s+\$?\s?([\d,]+(?:\.\d+)?)\s+and\s+\$?\s?([\d,]+(?:\.\d+)?)/i) || t.match(/from\s+\$?\s?([\d,]+(?:\.\d+)?)\s+to\s+\$?\s?([\d,]+(?:\.\d+)?)/i);
    if (r) { const a = parseFloat(r[1].replace(/,/g, '')), b = parseFloat(r[2].replace(/,/g, '')); if (a > 0 && b > a) { p.lowerPrice = a; p.upperPrice = b; } }
    const s = t.match(/stop(?:-loss)?\s+(?:below|under|at)\s+\$?\s?([\d,]+(?:\.\d+)?)/i);
    if (s) p.stopPrice = parseFloat(s[1].replace(/,/g, ''));
  }
  if (need.includes('bandPct')) { const m = t.match(/(?:band|range)\D{0,12}(\d{1,2}(?:\.\d+)?)\s*%|(\d{1,2}(?:\.\d+)?)\s*%\s*(?:band|range|either side|each side|on (?:each|either|both) sides?|above and below)|±\s*(\d{1,2}(?:\.\d+)?)\s*%/i); if (m) p.bandPct = Number(m[1] || m[2] || m[3]); }
  if (need.includes('holdings')) {
    // "$600 CAKE (0x…) and $400 WBNB (0x…)": each address with the dollar figure written just before it
    const h = readHoldings(t);
    if (h.length) p.holdings = h; else if (addrs.length) p.holdings = addrs.map((a) => ({ token: a, usd: usd(t) ? usd(t) / addrs.length : 1000 / addrs.length }));
    if (need.includes('targets') && p.holdings) { const tg = readTargets(t, p.holdings); if (tg) p.targets = tg; }
  }
  return p;
}

// the reply: the sentence first (what a reader sees), the filled-in calls as data (what a machine sends next)
export function understoodReply({ service, text, missing, agentUrl }) {
  const p = understand(service, text), keys = Object.keys(p);
  const got = keys.length ? keys.map((k) => `${k} ${typeof p[k] === 'object' ? JSON.stringify(p[k]) : p[k]}`).join(', ') : null;
  const miss = missing(service.id, p);
  const price = 'ten cents: 0.10 USD1 or USDC per answer over x402, or 0.10 $U through the ERC-8183 escrow';
  const sentence = miss
    ? `I read your question as: ${service.name}. ${got ? `From it I took ${got}. ` : ''}Still missing — ${miss}. Ask again with that, and the measured answer costs ${price}.`
    : `I read your question as: ${service.name}${got ? `, for ${got}` : ' (it needs nothing more from you)'}. The measured answer costs ${price}. The request below is filled in: its first reply is a 402 with the price; pay and send it again. Or hire me over the escrow with a signed quote. A real answer in the same format, free: https://agent.brainonbnb.com/example?service=${service.id}`;
  return {
    sentence,
    data: {
      understood: { service: service.id, params: p },
      missing: miss || null,
      price: service.price_display,
      pay_per_answer: { method: 'POST', url: `https://agent.brainonbnb.com/answer?service=${service.id}`, body: { params: p }, note: 'the first reply is HTTP 402 with the price and how to pay; pay, then send the same request again' },
      escrow: { endpoint: agentUrl, send: { kind: 'data', data: { skill: 'negotiate-erc8183-job', task_description: text, terms: { deliverables: service.deliverables } } } },
      example: `https://agent.brainonbnb.com/example?service=${service.id}`,
    },
  };
}
