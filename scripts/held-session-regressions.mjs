// Pins the session the agent worker HOLDS (2026-11-16: the leash was re-granted on chain on 15.11., the secret upload
// never arrived, the 04:23 second opinion was refused "expired" while the chain-only health check was green).
//   node scripts/held-session-regressions.mjs
import { readFileSync } from 'node:fs';
import { heldSession } from '../worker-agent/second-opinion.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };
const now = Math.floor(Date.now() / 1000);
const S = (expiry) => JSON.stringify({ walletAddress: '0xc5a1', publicKey: '0x04b390ec416afcd17e82a6c850eeaa', signerPrivateKey: '0x' + 'ab'.repeat(32), expiry, transactionHash: '0x15219d31' });

const good = heldSession({ ALTANA_SESSION: S(now + 29 * 86400) });
ok('a held session shows its expiry, not expired', good.held && !good.expired && /^\d{4}-\d{2}-\d{2}T/.test(good.expires_at), JSON.stringify(good));
ok('the private key never shows', !JSON.stringify(good).includes('abab'));
ok('an old session reads expired', heldSession({ ALTANA_SESSION: S(now - 86400) }).expired === true);
ok('no secret reads held: false', heldSession({}).held === false);
ok('an unreadable secret says so', heldSession({ ALTANA_SESSION: '￾{not json' }).unreadable === true);

const idx = readFileSync(new URL('../worker-agent/index.js', import.meta.url), 'utf8'), hc = readFileSync(new URL('lib/health-checks.mjs', import.meta.url), 'utf8');
ok('/second-opinion answers session_held', /session_held: heldSession\(env\)/.test(idx));
ok('the health check reads the held session and wants 3 days', /session_held/.test(hc) && /left >= 3/.test(hc));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
