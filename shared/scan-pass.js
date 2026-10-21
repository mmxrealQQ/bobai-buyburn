// shared/scan-pass.js — 50 free pool scans a caller a day, then a day pass (2026-10-18)
//
// Operator, 18.10.: "volume and profit with $BOBAI through the agents and tools" — option 1, 50 a day. The pool scan is
// the tool other agents call most (17.10.: ~110 outside scans, nearly all one trading bot) and it was free without
// end. It stays free for 50 scans per caller and UTC day; past that a day pass carries on: bought at
// agent.brainonbnb.com/scan-pass (USD1/USDC, half that in $BOBAI, or nothing for a wallet holding the $BOBAI line),
// handed back as a signed string and sent to brainonbnb.com as X-Scan-Pass. Signed with the secret both workers already
// share (HIT_SECRET), so the site checks a pass without asking anybody and nothing is stored to check it.
//
//   pass: bsp1.<id>.<expires ms>.<first 32 hex of HMAC-SHA256("scanpass|<id>|<expires>")>

export const SCAN_FREE_PER_DAY = 50;
export const SCAN_PASS_HOURS = 24;
export const SCAN_PASS_CAP = 2000;           // scans one pass carries, so a pass is a day of work, not a resale
export const SCAN_PASS_PRICE_USD1 = 5n * 10n ** 17n;   // 0.50 USD1, the pool watch's price
export const SCAN_PASS_URL = 'https://agent.brainonbnb.com/scan-pass';

const PASS_RE = /^bsp1\.([0-9a-f]{16})\.(\d{13})\.([0-9a-f]{32})$/;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function mac(secret, id, exp) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`scanpass|${id}|${exp}`))).slice(0, 32);
}

export async function issueScanPass(secret, now = Date.now()) {
  const id = hex(crypto.getRandomValues(new Uint8Array(8)));
  const exp = now + SCAN_PASS_HOURS * 3600e3;
  return { pass: `bsp1.${id}.${exp}.${await mac(secret, id, exp)}`, id, expires: new Date(exp).toISOString() };
}

// { ok, id, exp } or { ok:false, reason }. Constant work either way; the comparison is over fixed-length hex.
export async function checkScanPass(secret, pass, now = Date.now()) {
  const m = String(pass || '').trim().match(PASS_RE);
  if (!m || !secret) return { ok: false, reason: 'not a scan pass: bsp1.<id>.<expires>.<signature>, as returned by ' + SCAN_PASS_URL };
  const [, id, e, sig] = m, exp = Number(e);
  const want = await mac(secret, id, exp);
  let diff = 0; for (let i = 0; i < 32; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return { ok: false, reason: 'this scan pass was not issued by ' + SCAN_PASS_URL };
  if (exp <= now) return { ok: false, reason: `this scan pass expired at ${new Date(exp).toISOString()}` };
  return { ok: true, id, exp };
}

// The name a caller's day is counted under, and the day pass it paid for is kept under (2026-10-21): never the address.
export async function scanCallerKey(ip) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('bobai-scanq:' + ip))).slice(0, 32);
}

// What a caller over the free line is told. On REST (x402: true, 2026-10-21) the refusal is itself the 402 of the day
// pass: a client that speaks x402 pays it and repeats the request, the scan is answered and its address scans on for
// the day. MCP has no 402 to answer with, so there the pass is bought at its own URL and sent as X-Scan-Pass.
export const scanLimitTerms = (used, now = Date.now(), { x402 = false } = {}) => {
  const renews = new Date(now); renews.setUTCHours(24, 0, 0, 0);
  return {
    error: `The free pool scan is ${SCAN_FREE_PER_DAY} scans per caller and UTC day, and this caller has used them (${used}). It renews at ${renews.toISOString()}.`,
    code: 'free_limit',
    hint: x402
      ? `This answer is the 402 of a scan day pass (0.50 USD1 or USDC, half that in $BOBAI, nothing for a wallet holding 1,000,000 $BOBAI): pay it by x402 and send this request again with the payment in PAYMENT-SIGNATURE or X-PAYMENT. The scan is answered, and this address scans on for ${SCAN_PASS_HOURS} hours without anything else to send; the pass comes back as header X-Scan-Pass for use from elsewhere.`
      : `Carry on today with a scan day pass: POST ${SCAN_PASS_URL} (the 402 there has the terms — 0.50 USD1 or USDC, half that in $BOBAI, nothing for a wallet holding 1,000,000 $BOBAI), then send the pass it returns as header X-Scan-Pass on every scan for ${SCAN_PASS_HOURS} hours.`,
    free_per_day: SCAN_FREE_PER_DAY,
    renews_at: renews.toISOString(),
    scan_pass: { buy: `POST ${SCAN_PASS_URL}`, terms: `GET ${SCAN_PASS_URL}`, lasts: `${SCAN_PASS_HOURS} hours, up to ${SCAN_PASS_CAP.toLocaleString('en-US')} scans`, send_as: 'header X-Scan-Pass: <pass>' },
  };
};
