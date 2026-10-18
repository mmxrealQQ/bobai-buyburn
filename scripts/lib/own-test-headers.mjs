// Our own checkers are not callers (2026-10-18): the pool scan is free for 50 scans per caller and UTC day, and a day of
// checker runs from one address used them up (CAKE answered 429 to uniswap-v3-check). A checker sends the shared secret
// the workers already know; the site lets such a request through uncounted (scanAllowance in dashboard/_worker.js).
import fs from 'node:fs';
import path from 'node:path';
export function ownTestHeaders() {
  let secret = process.env.HIT_SECRET || '';
  if (!secret) {
    try { secret = (fs.readFileSync(path.resolve(import.meta.dirname, '../../.env'), 'utf8').match(/^HIT_SECRET=(.*)$/m)?.[1] || '').trim(); } catch { /* no .env: counted like anyone */ }
  }
  return secret ? { 'x-hit-secret': secret } : {};
}
