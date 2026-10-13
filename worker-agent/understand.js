// A QUESTION IN PLAIN WORDS GETS AN ANSWER TO THAT QUESTION (2026-10-13, operator: "our agents must work 100% and be top
// intelligent — Marque lists us"). An outside agent asked our Venus monitor "what is the health factor of 0x489A…?" and
// got the same self-description and the whole catalogue whatever it asked. Now each agent reads the question for what
// its one service needs (an address, a token, an amount, a number of levels, a position), says what it understood and
// what is still missing, and hands back the request that gets the measured answer — filled in, ready to send. Nothing
// is paid or signed here; the price and the paths are the ones the catalogue already states.

const ADDR = /0x[a-fA-F0-9]{40}/g;
const usd = (t) => { const m = String(t).match(/\$\s?([\d,]+(?:\.\d+)?)\s*(k|K)?/) || String(t).match(/([\d,]+(?:\.\d+)?)\s*(?:usd|dollars?)\b/i); if (!m) return null; const v = parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1); return v > 0 ? v : null; };

// what each service takes, read from the sentence (only the keys the service names in its `needs`)
export function understand(service, text = '') {
  const t = String(text), addrs = [...new Set(t.match(ADDR) || [])], p = {};
  const need = Object.keys(service.needs || {});
  if (need.includes('address') && addrs[0]) p.address = addrs[0];
  if (need.includes('token') && addrs[0]) p.token = addrs[0];
  if (need.includes('position')) { const m = t.match(/position\s*(?:id\s*)?#?\s*(\d{3,})/i); if (m) p.position = m[1]; else if (addrs[0]) p.address = addrs[0]; }
  if (need.includes('capitalUsd')) { const v = usd(t); if (v) p.capitalUsd = v; }
  if (need.includes('amountUsd')) { const v = usd(t); if (v) p.amountUsd = v; }
  if (need.includes('levels')) { const m = t.match(/(\d{1,3})\s*(?:levels?|grids?|steps?)/i); if (m) p.levels = Number(m[1]); }
  if (need.includes('bandPct')) { const m = t.match(/(?:band|range)\D{0,12}(\d{1,2}(?:\.\d+)?)\s*%|(\d{1,2}(?:\.\d+)?)\s*%\s*(?:band|range)/i); if (m) p.bandPct = Number(m[1] || m[2]); }
  if (need.includes('holdings')) {
    // "$600 CAKE (0x…) and $400 WBNB (0x…)": each address with the dollar figure written just before it
    const h = []; const rx = /\$\s?([\d,]+(?:\.\d+)?)\s*(k|K)?[^$]{0,40}?(0x[a-fA-F0-9]{40})/g; let m;
    while ((m = rx.exec(t))) h.push({ token: m[3], usd: parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1) });
    if (h.length) p.holdings = h; else if (addrs.length) p.holdings = addrs.map((a) => ({ token: a, usd: usd(t) ? usd(t) / addrs.length : 1000 / addrs.length }));
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
