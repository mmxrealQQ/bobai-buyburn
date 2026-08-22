// Checks the GoPlus account key end to end, and the signature that gets you one.
//
// WHY THIS EXISTS
// The contract section of every pool scan has read "unavailable — GoPlus
// answered code 4029 (too many requests)" for a long time. Anonymous requests
// share a quota tied to the caller's IP, and a Cloudflare Worker's IP belongs to
// all of Cloudflare, so the quota is spent before we ask. An account key is the
// only fix. This script tells you whether the key works before it is trusted in
// production, and separates the two ways it can fail: a signature we compute
// wrong, and a key GoPlus refuses.
//
// The signature check runs with no key at all. It holds our implementation
// against the worked example in GoPlus's own documentation:
//   sha1("mBOMg20QW11BbtyH4Zh0" + "1647847498" + "V6aRfxlPJwN3ViJSIFSCdxPvneajuJsh")
//   = 7293d385b9225b3c3f232b76ba97255d0e21063e
// Concatenation order is the thing that is easy to get wrong and impossible to
// diagnose from the outside — a wrong order just returns "invalid sign".
//
// Usage:
//   node scripts/goplus-check.mjs          # signature only, no key needed
//   node scripts/goplus-check.mjs --live   # also fetch a token and scan a token
import 'dotenv/config';
import { createHash } from 'node:crypto';

const TOKEN_URL = 'https://api.gopluslabs.io/api/v1/token';
const SEC_URL = 'https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=';
// $BOBAI: we know what the answer should look like, and asking about our own
// token keeps the check from depending on somebody else's listing.
const PROBE = '0x245c386dcfed896f5c346107596141e5edcbffff';

const sign = (key, time, secret) => createHash('sha1').update(`${key}${time}${secret}`).digest('hex');

let failed = 0;
const ok = (name, pass, detail) => {
  if (!pass) failed++;
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

console.log('\nGoPlus account key\n');

// --- 1. the signature, against GoPlus's own example -------------------------
const vector = sign('mBOMg20QW11BbtyH4Zh0', 1647847498, 'V6aRfxlPJwN3ViJSIFSCdxPvneajuJsh');
ok('sign matches the documented example', vector === '7293d385b9225b3c3f232b76ba97255d0e21063e', vector);
// A wrong concatenation order is the failure this guards against, so prove the
// check would actually notice one.
const wrongOrder = createHash('sha1').update('V6aRfxlPJwN3ViJSIFSCdxPvneajuJsh' + '1647847498' + 'mBOMg20QW11BbtyH4Zh0').digest('hex');
ok('and a swapped order would be caught', wrongOrder !== '7293d385b9225b3c3f232b76ba97255d0e21063e');

const KEY = process.env.GOPLUS_APP_KEY;
const SECRET = process.env.GOPLUS_APP_SECRET;

if (!KEY || !SECRET) {
  console.log('\n  GOPLUS_APP_KEY / GOPLUS_APP_SECRET are not in .env — stopping here.');
  console.log('  Register at https://console.gopluslabs.io, then re-run with --live.');
  process.exitCode = failed ? 1 : 0;
} else if (!process.argv.includes('--live')) {
  console.log('\n  Key found in .env. Re-run with --live to actually use it.');
  process.exitCode = failed ? 1 : 0;
} else {
  // --- 2. exchange the key for a token --------------------------------------
  const time = Math.floor(Date.now() / 1000);
  let token = null;
  try {
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_key: KEY, sign: sign(KEY, time, SECRET), time }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => null);
    token = j?.result?.access_token || null;
    ok('the key is exchanged for an access token', !!token,
      token ? `expires in ${j.result.expires_in}s` : `code ${j?.code} ${String(j?.message || '').slice(0, 60)}`);
  } catch (e) {
    ok('the key is exchanged for an access token', false, String(e.message).slice(0, 70));
  }

  if (token) {
    // --- 3. the same request, with and without the token --------------------
    // Both are run because the point is the difference. If the anonymous call
    // happens to succeed today, the key has not been shown to fix anything.
    const call = async (headers) => {
      try {
        const r = await fetch(SEC_URL + PROBE, { headers, signal: AbortSignal.timeout(10000) });
        const j = await r.json();
        return { code: j?.code, msg: j?.message, hit: !!(j?.result && j.result[PROBE]) };
      } catch (e) { return { code: null, msg: String(e.message).slice(0, 50), hit: false }; }
    };
    const anon = await call({});
    const auth = await call({ authorization: token });
    console.log(`\n  anonymous     code ${anon.code}  ${anon.hit ? 'got data' : 'no data'}  ${anon.msg || ''}`);
    console.log(`  with token    code ${auth.code}  ${auth.hit ? 'got data' : 'no data'}  ${auth.msg || ''}`);
    ok('an authenticated request returns the token data', auth.hit,
      auth.hit ? '' : `code ${auth.code} ${String(auth.msg || '').slice(0, 60)}`);
    if (auth.hit && anon.hit) {
      console.log('\n  Note: the anonymous call also worked from this machine. That is expected -');
      console.log('  the quota is per IP and your laptop has its own. The Worker is the caller');
      console.log('  that was being refused.');
    }
  }
  process.exitCode = failed ? 1 : 0;
}

console.log(`\n${failed ? failed + ' failed' : 'all checks passed'}`);
