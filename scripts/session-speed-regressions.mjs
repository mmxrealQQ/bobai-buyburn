// Pins /session's chain read (2026-11-16, Liste A: /session took 10-16 s from the Worker): every key's isValidKey at
// once and both chains at once, with the answers still right — a failed validity read is null (never "revoked"),
// an unreadable chain is an error (never "no session"). Offline: fetch is a fake KeyStore with 300 ms per call.
//   node scripts/session-speed-regressions.mjs
import { readFileSync } from 'node:fs';
import { readSessionState, handleSession } from '../worker-agent/session.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '  ok    ' : '  FAIL  ') + name + (cond || !extra ? '' : ' — ' + extra)); if (!cond) fails++; };
const W = '0x' + '11'.repeat(20), KEYS = Array.from({ length: 8 }, (_, i) => '0x' + String(i + 1).padStart(64, '0'));
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const getKeysResult = (keys) => '0x' + word(32) + word(keys.length) + keys.map((k) => k.slice(2)).join('');
let calls = 0, inFlight = 0, peak = 0;
const fake = ({ keys = KEYS, validOf = (i) => i < 2, failValid = -1, failAll = false } = {}) => async (endpoint, init) => {
  calls++; inFlight++; peak = Math.max(peak, inFlight);
  await new Promise((r) => setTimeout(r, 300));
  inFlight--;
  if (failAll) throw new Error('down');
  const data = JSON.parse(init.body).params[0].data;
  if (data.startsWith('0x34e80c34')) return { json: async () => ({ result: getKeysResult(keys) }) };
  const i = keys.indexOf('0x' + data.slice(-64));
  if (i === failValid) throw new Error('timeout');
  return { json: async () => ({ result: '0x' + word(validOf(i) ? 1 : 0) }) };
};

globalThis.fetch = fake();
let t = Date.now(); const s = await readSessionState(56, W); const ms = Date.now() - t;
ok('8 keys read in about two call times, not nine', ms < 1000, `${ms} ms`);
ok('validity right: 2 of 8 valid', s.state === '2 of 8 registered keys are currently valid', s.state);
ok('keys keep their order', s.keys.map((k) => k.keyId).join() === KEYS.join());

globalThis.fetch = fake({ failValid: 3 });
const s2 = await readSessionState(56, W);
ok('a validity that could not be read is null, never false', s2.keys[3].valid === null && s2.keys[0].valid === true && s2.keys[5].valid === false);

globalThis.fetch = fake({ failAll: true });
const s3 = await readSessionState(56, W);
ok('an unreadable chain is an error, not "no session"', /KeyStore unreadable/.test(s3.error || '') && !s3.state);

globalThis.fetch = fake({ keys: [] }); peak = 0;
t = Date.now(); await handleSession(new URL('https://agent.brainonbnb.com/session'), { ALTANA_AGENT_WALLET: W });
ok('both chains read at once', Date.now() - t < 550 && peak >= 2, `${Date.now() - t} ms, peak ${peak}`);

const idx = readFileSync(new URL('../worker-agent/index.js', import.meta.url), 'utf8');
ok('the route keeps the read 60 s and a POST revoke clears it', /session\/state\?chain=/.test(idx) && /max-age=60/.test(idx) && /caches\.default\.delete\(new Request\(`https:\/\/agent\.brainonbnb\.com\/session\/state/.test(idx));
ok('an unreadable chain is not cached', /if \(!st\.chains\.some\(\(c\) => c\.error\)\)/.test(idx));

console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exitCode = fails ? 1 : 0;
