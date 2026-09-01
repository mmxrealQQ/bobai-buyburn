#!/usr/bin/env node
// The Binance Web3 API: the signing, proved without a key, and the live call
// the moment there is one.
//
// WHY THIS IS NOT THE B402 STORY AGAIN
// B402 was abandoned on 2026-08-23 for a specific, measured reason: its public
// settle host answered EVERY request with an empty 202, including nonsense, and
// the real one answered 403. You cannot build a payment path on an endpoint
// that says "Accepted" to anything, and the application form behind it was shut
// to outsiders. That decision stands and this is a different product.
//
// Measured 2026-09-01: `web3.binance.com/build/api/v1/...` answers an unknown
// path with `{"code":404,"msg":"No static resource ...","timestamp":...}` — a
// real backend giving a real error, which is the same test that told us B402's
// host was not one. The documented onboarding is self-serve: create a project
// in the developer portal, get a key and a secret, sign with HMAC-SHA256. No
// partner agreement, no RSA registration, no IP whitelist.
//
// WHAT IS WORTH HAVING FROM IT
// The Trading API returns cross-DEX aggregated quotes. Our own best-route tool
// quotes PancakeSwap only, deliberately, and says so. Having a second opinion
// from an aggregator is a genuine cross-check on the one number we would most
// hate to be quietly wrong about — and it stays a cross-check, run from here,
// never a source the live page depends on. External APIs do not belong in the
// workers that hold money, and this project already keeps that line.
//
// WHAT THIS SCRIPT WILL NOT DO
// It will not create an account and it will not generate credentials. That is
// an account action with a password behind it, and it belongs to a person.
// What it does is make the credential the only missing piece.
//
// Usage:
//   node scripts/binance-web3-check.mjs              prove the signing, no key needed
//   node scripts/binance-web3-check.mjs --probe PATH call PATH with the key in .env
import 'dotenv/config';
import { createHmac } from 'node:crypto';

const HOST = 'https://web3.binance.com';
// The docs are explicit about this and call it the number one cause of
// "40102 Invalid signature": the SIGNED path includes the /build prefix. So the
// prefix lives in one place and both the signature and the URL are built from
// it, rather than being written out twice and drifting.
const PREFIX = '/build';

export function sign({ secret, timestamp, method, requestPath, body = '' }) {
  const preHash = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
  return { preHash, signature: createHmac('sha256', secret).update(preHash, 'utf8').digest('base64') };
}

export function headersFor({ apiKey, secret, method, path, body = '' }) {
  const requestPath = path.startsWith(PREFIX) ? path : PREFIX + path;
  const timestamp = new Date().toISOString();
  const { signature } = sign({ secret, timestamp, method, requestPath, body });
  return {
    url: HOST + requestPath,
    headers: {
      'X-OC-APIKEY': apiKey,
      'X-OC-TIMESTAMP': timestamp,
      'X-OC-SIGN': signature,
      'Content-Type': 'application/json',
    },
  };
}

let failed = 0, checks = 0;
const ok = (name, pass, detail) => {
  checks += 1;
  if (!pass) failed += 1;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// --- the signature, pinned without needing a key -----------------------------
//
// Binance publishes no worked example to check against, so this pins the
// properties a correct implementation cannot lack: it is deterministic, it
// changes when ANY of the four parts change, and the path it signs carries the
// /build prefix. A signature that ignored one of its inputs would still look
// like a signature.
{
  const secret = 'test-secret-not-a-real-one';
  const baseArgs = { secret, timestamp: '2026-09-01T12:00:00.000Z', method: 'GET', requestPath: '/build/api/v1/x', body: '' };
  const a = sign(baseArgs);
  const again = sign(baseArgs);
  ok('the signature is deterministic', a.signature === again.signature, a.signature.slice(0, 24) + '…');

  const variants = [
    ['timestamp', { ...baseArgs, timestamp: '2026-09-01T12:00:00.001Z' }],
    ['method', { ...baseArgs, method: 'POST' }],
    ['path', { ...baseArgs, requestPath: '/build/api/v1/y' }],
    ['body', { ...baseArgs, body: '{"a":1}' }],
    ['secret', { ...baseArgs, secret: 'other' }],
  ];
  for (const [what, args] of variants) {
    ok(`changing the ${what} changes the signature`, sign(args).signature !== a.signature);
  }

  ok('the pre-hash is timestamp + method + path + body, in that order',
    a.preHash === '2026-09-01T12:00:00.000ZGET/build/api/v1/x', a.preHash);

  const h = headersFor({ apiKey: 'k', secret, method: 'GET', path: '/api/v1/x' });
  ok('the /build prefix is added to the URL and to what is signed',
    h.url === 'https://web3.binance.com/build/api/v1/x'
      && !!h.headers['X-OC-SIGN'] && !!h.headers['X-OC-TIMESTAMP'] && h.headers['X-OC-APIKEY'] === 'k',
    h.url);
  // And it must not be doubled when the caller already wrote it.
  const h2 = headersFor({ apiKey: 'k', secret, method: 'GET', path: '/build/api/v1/x' });
  ok('a path that already carries the prefix is not given a second one',
    h2.url === 'https://web3.binance.com/build/api/v1/x', h2.url);
}

// --- the host itself, which is the part that told us B402 was not real -------
{
  const r = await fetch(`${HOST}${PREFIX}/api/v1/__does_not_exist__`, { signal: AbortSignal.timeout(15000) })
    .then(async (x) => ({ status: x.status, body: (await x.text()).slice(0, 160) }))
    .catch((e) => ({ status: 0, body: String(e.name) }));
  // The distinction that matters: a real backend refuses an unknown path with a
  // real message. An empty 202 to everything — which is what Binance's public
  // b402 settle host does to this day — is not an endpoint, it is a sink.
  ok('the host answers an unknown path with a real error, not an empty accept',
    r.status >= 400 && r.status < 500 && /code|msg|error/i.test(r.body),
    `HTTP ${r.status} ${r.body.slice(0, 90)}`);
}

// --- the live call, if and only if there is a credential ---------------------
const apiKey = process.env.BINANCE_WEB3_API_KEY;
const secret = process.env.BINANCE_WEB3_API_SECRET;
const probeIdx = process.argv.indexOf('--probe');
const probePath = probeIdx >= 0 ? process.argv[probeIdx + 1] : null;

if (!apiKey || !secret) {
  console.log(`\n${checks - failed}/${checks} checks passed — the signing is right and the host is real.`);
  console.log('\nNo credential yet, and this script will not create one: making an account and');
  console.log('generating a key is an action with a password behind it and belongs to a person.');
  console.log('\nWhat is left to do, once:');
  console.log('  1. open https://web3.binance.com/en/dev-portal and create a project');
  console.log('  2. put the two values in .env (gitignored):');
  console.log('       BINANCE_WEB3_API_KEY=...');
  console.log('       BINANCE_WEB3_API_SECRET=...');
  console.log('  3. node scripts/binance-web3-check.mjs --probe /api/v1/<a path from the docs>');
  console.log('\nThen the cross-check against our own best-route tool can be built: their');
  console.log('aggregated quote against our PancakeSwap-only measurement, on the same token');
  console.log('and the same size, run from here — never from a worker that holds money.');
  process.exitCode = failed ? 1 : 0;
} else if (!probePath) {
  console.log(`\n${checks - failed}/${checks} checks passed. A credential is present.`);
  console.log('Give it a path to call: --probe /api/v1/<endpoint>');
  process.exitCode = failed ? 1 : 0;
} else {
  const { url, headers } = headersFor({ apiKey, secret, method: 'GET', path: probePath });
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) })
    .then(async (x) => ({ status: x.status, body: (await x.text()).slice(0, 400) }))
    .catch((e) => ({ status: 0, body: String(e.name) }));
  // 40102 is the documented signature failure and is worth naming rather than
  // reporting as "it did not work": it means the credential is fine and the
  // string being signed is not.
  const badSig = /40102|invalid signature/i.test(r.body);
  ok('the credential is accepted', r.status === 200 && !badSig,
    `HTTP ${r.status}${badSig ? ' — 40102 invalid signature: the credential is fine, the signed string is not' : ''} ${r.body.slice(0, 200)}`);
  console.log(`\n${checks - failed}/${checks} checks passed`);
  process.exitCode = failed ? 1 : 0;
}
