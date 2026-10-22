#!/usr/bin/env node
// scripts/scan-quota-check.mjs — 1,000 free pool scans a caller a day, then the day pass (2026-10-18)
//
// Operator, 18.10.: volume and profit for $BOBAI through the tools — option 1, 50 a day. The pool scan stays free for 50
// scans per caller and UTC day; the 51st is refused (429, code free_limit, how to carry on); a day pass bought at
// agent.brainonbnb.com/scan-pass (USD1/USDC, half in $BOBAI, nothing with the holder pass) and sent as X-Scan-Pass
// carries on. Offline: the pass is signed and checked, a changed, expired or foreign one is refused. Live: the terms and
// the 402 of the pass, the holder pass read for it (a fresh key below the line: refused for that reason, not as "not
// for this"), a caller run to the line under a test name (x-hit-secret + x-scan-quota-key, so the address this runs from
// keeps its day), the pass past the line, a forged pass, and MCP refusing the same way. Since 21.10. the 51st REST scan
// is the pass's own x402 402 (a bot ran into the 429 600 times a day and never bought): its terms, a payment that is
// none refused, and the pass kept for a caller at the agent worker carrying that caller on with nothing to send.
//
//   node scripts/scan-quota-check.mjs [base]     (default https://brainonbnb.com)   exit 1 on any FAIL
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
registerHooks({ load(url, ctx, next) { return /\/(dashboard|shared)\/[^/]+\.js$/.test(url) ? next(url, { ...ctx, format: 'module' }) : next(url, ctx); } });
const P = await import(pathToFileURL(path.resolve(import.meta.dirname, '../shared/scan-pass.js')).href);

const BASE = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const AGENT = 'https://agent.brainonbnb.com';
const SECRET = process.env.HIT_SECRET || (fs.readFileSync(path.resolve(import.meta.dirname, '../.env'), 'utf8').match(/^HIT_SECRET=(.*)$/m)?.[1] || '').trim();
let pass = 0, fail = 0;
const check = (ok, what, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };

// --- offline: the pass itself
{
  const p = await P.issueScanPass('s1');
  check((await P.checkScanPass('s1', p.pass)).ok, 'a pass checks with the secret it was signed with', p.pass.slice(0, 30) + '…');
  const flipped = p.pass.slice(0, -1) + (p.pass.endsWith('0') ? '1' : '0');
  check(!(await P.checkScanPass('s1', flipped)).ok, 'a changed signature is refused');
  check(!(await P.checkScanPass('s2', p.pass)).ok, 'a pass signed with another secret is refused');
  const old = await P.issueScanPass('s1', Date.now() - (P.SCAN_PASS_HOURS + 1) * 3600e3);
  check(/expired/.test((await P.checkScanPass('s1', old.pass)).reason || ''), 'an expired pass is refused as expired');
  const later = p.pass.replace(/\.(\d{13})\./, (m, e) => `.${Number(e) + 3600e3}.`);
  check(!(await P.checkScanPass('s1', later)).ok, 'a pass with its expiry moved is refused');
  check(!(await P.checkScanPass('s1', 'nonsense')).ok && !(await P.checkScanPass('', p.pass)).ok, 'garbage, or no secret, is never a pass');
}

// --- live: the pass for sale
{
  const r = await fetch(`${AGENT}/scan-pass`, { headers: { 'user-agent': 'bobai-smoke-test' } });
  const j = await r.json().catch(() => ({}));
  check(r.status === 200 && (j.accepts || []).length >= 3 && /0\.50/.test(j.price || '') && !!j.holder_pass && /X-Scan-Pass/.test(j.use || ''), 'GET /scan-pass: the terms (price, ways to pay, holder pass, how to use)', `${r.status} ${(j.price || j.error || '').slice(0, 70)}`);
  const r2 = await fetch(`${AGENT}/scan-pass`, { method: 'POST', headers: { 'user-agent': 'bobai-smoke-test' } });
  check(r2.status === 402 && !!r2.headers.get('payment-required'), 'POST /scan-pass unpaid: 402 with PAYMENT-REQUIRED', String(r2.status));
  const a = privateKeyToAccount(generatePrivateKey()), w = a.address.toLowerCase(), issued = new Date().toISOString();
  const sig = await a.signMessage({ message: `BOBAI holder pass\nwallet: ${w}\nissued: ${issued}` });
  const r3 = await fetch(`${AGENT}/scan-pass`, { method: 'POST', headers: { 'user-agent': 'bobai-smoke-test', 'PAYMENT-SIGNATURE': `bobai-holder ${w} ${issued} ${sig}` } });
  const j3 = await r3.json().catch(() => ({}));
  check(r3.status === 402 && j3.code === 'below_line', 'the holder pass is read for the day pass: a wallet without $BOBAI is refused as below the line', `${r3.status} ${j3.code}`);
}

// --- live: a caller run to the line, under a test name
if (!SECRET) check(false, 'HIT_SECRET for the live quota run', 'not in the environment or .env');
else {
  const key = 'chk-' + Math.random().toString(16).slice(2, 10);
  const hdr = { accept: 'application/json', 'user-agent': 'bobai-smoke-test', 'x-hit-secret': SECRET, 'x-scan-quota-key': key };
  const scan = (h = hdr) => fetch(`${BASE}/api/pool-scan?address=0x1&r=${Math.random()}`, { headers: h });   // refused at once as bad_address: cheap
  const codes = [];
  for (let i = 0; i < P.SCAN_FREE_PER_DAY; i++) codes.push((await scan()).status);
  check(codes.every((c) => c === 400), `scans 1–${P.SCAN_FREE_PER_DAY} go through (answered, here bad_address)`, [...new Set(codes)].join(','));
  // 2026-10-21: on REST the 51st scan is the day pass's own 402, which an x402 client pays and repeats.
  const over = await scan(), oj = await over.json().catch(() => ({}));
  let offer = null; try { offer = JSON.parse(Buffer.from(over.headers.get('payment-required') || '', 'base64').toString()); } catch {}
  check(over.status === 402 && oj.code === 'free_limit' && /PAYMENT-SIGNATURE/.test(oj.hint || '') && Number(over.headers.get('retry-after')) > 0, `scan ${P.SCAN_FREE_PER_DAY + 1} is refused as the day pass's 402: free_limit, how to pay it here, Retry-After`, `${over.status} ${oj.code} retry-after ${over.headers.get('retry-after')}`);
  const pt = (offer?.accepts || []).map((x) => String(x.payTo || '').toLowerCase());
  check(pt.length >= 3 && new Set(pt).size === 1 && /^0x[0-9a-f]{40}$/.test(pt[0]) && (oj.accepts || []).length === pt.length && /0\.50/.test(oj.price || '') && !!oj.holder_pass, 'its PAYMENT-REQUIRED is the pass for sale: every way to pay, one wallet, the price, the holder pass', `${pt.length} ways, ${new Set(pt).size} wallet(s), ${(oj.price || '').slice(0, 40)}`);
  const junk = await scan({ ...hdr, 'x-payment': '0x' + '00'.repeat(32) }), jj = await junk.json().catch(() => ({}));
  check(junk.status === 402 && !junk.headers.get('x-scan-pass') && !!junk.headers.get('payment-required') && /Nothing was taken/.test(jj.hint || ''), 'a payment that is none is refused: 402, no pass, no scan, the terms again', `${junk.status} ${(jj.reason || jj.error || '').slice(0, 60)}`);
  const minted = await P.issueScanPass(SECRET);
  const withPass = await scan({ ...hdr, 'x-scan-pass': minted.pass });
  check(withPass.status === 400, 'past the line, a valid X-Scan-Pass carries on', String(withPass.status));
  const forged = await scan({ ...hdr, 'x-scan-pass': minted.pass.slice(0, -1) + (minted.pass.endsWith('0') ? '1' : '0') });
  const fj = await forged.json().catch(() => ({}));
  check(forged.status === 402 && fj.code === 'bad_scan_pass', 'a forged pass is refused (402 bad_scan_pass)', `${forged.status} ${fj.code}`);
  const m = await (await fetch(`${BASE}/mcp`, { method: 'POST', headers: { ...hdr, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bsc_pool_scan', arguments: { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82' } } }) })).json().catch(() => null);
  check(m?.result?.isError && m.result.structuredContent?.code === 'free_limit', 'MCP bsc_pool_scan past the line: isError, code free_limit', m?.result?.structuredContent?.code || JSON.stringify(m).slice(0, 80));
  // The agent MCP servers relay the scan from our own worker, which the site does not count: the caller's day has to
  // travel with it. A forged pass sent there is refused by the site, which proves the relay goes through the line.
  const g = await (await fetch(`${AGENT}/grid-trader/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-scan-pass': minted.pass.slice(0, -1) + (minted.pass.endsWith('0') ? '1' : '0') }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bsc_pool_scan', arguments: { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82' } } }) })).json().catch(() => null);
  check(g?.result?.isError && /not issued by/.test(g.result.content?.[0]?.text || ''), 'the agent MCP relay (grid-trader bsc_pool_scan) is held to the same line', (g?.result?.content?.[0]?.text || JSON.stringify(g)).slice(0, 90));
  const other = await scan({ ...hdr, 'x-scan-quota-key': key + 'x' });
  check(other.status === 400, 'another caller still has its own 50', String(other.status));
  // The pass bought on the scan is kept under the caller's key at the agent worker: past the line, that caller scans
  // on without sending anything. Kept first, then run to the line (a caller looked up and found without one is
  // remembered for a minute in that data centre).
  const k2 = key + 'u', ck = await P.scanCallerKey('test:' + k2), unlockUrl = `${AGENT}/scan-pass/unlock`;
  const anon = await fetch(unlockUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ for: ck, pass: minted.pass }) });
  check(anon.status === 401, 'the kept pass is written by the site alone (no secret: 401)', String(anon.status));
  const fake = await fetch(unlockUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hit-secret': SECRET }, body: JSON.stringify({ for: ck, pass: minted.pass.slice(0, -1) + (minted.pass.endsWith('0') ? '1' : '0') }) });
  check(fake.status === 400, 'a pass that does not check is not kept', String(fake.status));
  const kept = await fetch(unlockUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hit-secret': SECRET }, body: JSON.stringify({ for: ck, pass: minted.pass }) });
  check(kept.status === 200, 'a real pass is kept for the caller', String(kept.status));
  const h2 = { ...hdr, 'x-scan-quota-key': k2 }, codes2 = [];
  for (let i = 0; i <= P.SCAN_FREE_PER_DAY + 1; i++) codes2.push((await scan(h2)).status);
  check(codes2.every((c) => c === 400), `a caller with a kept pass scans past the line with nothing to send (${P.SCAN_FREE_PER_DAY + 2} scans)`, [...new Set(codes2)].join(','));
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
