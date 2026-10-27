#!/usr/bin/env node
// The x402 headers carry human text as base64 of UTF-8 (2026-10-27, library #94). btoa() takes Latin-1 only: one em
// dash in a description once put /watch on HTTP 500 for every caller. Held both ways:
//   --self-test  offline: the worker's own encoder (worker-agent/index.js headerB64) round-trips "—", "ü" and an emoji,
//                and the plain btoa(JSON) it replaced still throws on the same text (so the pin can fail)
//   (no flag)    live as well: POST agent.brainonbnb.com/watch answers 402, and its PAYMENT-REQUIRED decodes as UTF-8
//                JSON with its non-ASCII characters intact
import path from 'node:path'; import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const is = (what, ok, more = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + what + (more && !ok ? ' — ' + more : '')); ok ? pass++ : fail++; };
const decode = (h) => new TextDecoder().decode(Uint8Array.from(atob(h), (c) => c.charCodeAt(0)));

const W = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'index.js')).href);
const offer = { x402Version: 2, accepts: [{ description: 'Pool watch — 1 day · für dich 🧠' }] };
let back = null; try { back = JSON.parse(decode(W.headerB64(offer))); } catch (e) { back = String(e.message); }
is('the worker encodes "—", "ü" and an emoji and they decode back as written', back?.accepts?.[0]?.description === offer.accepts[0].description, JSON.stringify(back));
let threw = false; try { btoa(JSON.stringify(offer)); } catch { threw = true; }
is('plain btoa(JSON) throws on the same text (the bug this holds)', threw);

if (!process.argv.includes('--self-test')) {
  const r = await fetch('https://agent.brainonbnb.com/watch', { method: 'POST', headers: { 'user-agent': 'brainonbnb-test' } }).catch(() => null);
  const h = r?.headers.get('payment-required') || '';
  let t = ''; try { t = decode(h); JSON.parse(t); } catch { t = ''; }
  is('live: POST /watch answers 402 with a PAYMENT-REQUIRED that decodes as UTF-8 JSON', r?.status === 402 && !!t, `${r?.status} ${h.slice(0, 40)}`);
  is('live: its non-ASCII text survives (no "â")', /[^\x00-\x7f]/.test(t) && !/â€/.test(t), [...t].filter((c) => c.charCodeAt(0) > 127).join(''));
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
