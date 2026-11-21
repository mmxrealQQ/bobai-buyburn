// PUBLIC SETTLE, ONE RUN AT A TIME (A-Z 2026-11-21). The 21:15 and the 21:22 firing were both due and the day key was
// written only at the end: a long run had a second one beside it on the provider wallet. Offline, nothing sent:
//   1  a run while another holds the lock does nothing ("running")
//   2  a run that ends (here: no provider key) takes its lock away again
//   3  the refund of the same firing is chained only when the settle did not stand aside
//   4  the hire wallet's refund waits while the 05:30 hires may be sending (05:28-05:50 UTC)
//   node scripts/settle-lock-regressions.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(import.meta.dirname, '..');
let n = 0, failed = 0;
const ok = (what, cond, detail = '') => { n++; if (!cond) failed++; console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${what}${detail ? ' — ' + detail : ''}`); };
const { runPublicSettle } = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'public-settle.js')).href);
const kv = (init = {}) => { const m = new Map(Object.entries(init)); return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, list: async () => ({ keys: [] }) }; };
const now = new Date('2026-11-21T21:22:00Z'), LOCK = 'settle:running:2026-11-21';
const busy = kv({ [LOCK]: '2026-11-21T21:15:03Z' });
const r1 = await runPublicSettle({ AGENT: busy }, { now });
ok('1 another run holds the lock: this one does nothing', r1 && r1.skipped === 'running', JSON.stringify(r1));
const free = kv();
const r2 = await runPublicSettle({ AGENT: free }, { now });
ok('2 a run that ends takes its lock away again', r2 && r2.error === 'no provider key' && !free.m.has(LOCK), JSON.stringify(r2));
const idx = fs.readFileSync(path.join(ROOT, 'worker-agent', 'index.js'), 'utf8');
ok('3 the refund is chained only when the settle did not stand aside', /runPublicSettle\(env\)[^\n]*r\.skipped === 'running' \? null : runPublicRefund\(env\)/.test(idx));
const hires = fs.readFileSync(path.join(ROOT, 'worker-agent', 'agent-hires.js'), 'utf8');
const win = hires.slice(hires.indexOf('export async function refundUndelivered'), hires.indexOf('export const agentHiresDue'));
ok('4 the refund waits while the hires may be sending (05:28-05:50 UTC), before any send', /5 \* 60 \+ 28/.test(win) && /5 \* 60 \+ 50/.test(win) && win.indexOf('5 * 60 + 28') < win.indexOf('sendTransaction'));
console.log(`\nsettle lock: ${n - failed}/${n}`);
process.exit(failed ? 1 : 0);
