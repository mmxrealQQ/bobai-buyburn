#!/usr/bin/env node
// One address's ERC-8183 escrow at a glance (worker-agent/escrow-for.js, 2026-10-23), offline. What happens next to
// each job — funded and waiting, funded and expired (money back to the client), delivered in the window, delivered and
// the window over (pay waiting release) — the self-hire never counted as money waiting for anybody, the settle and
// refund records filtered to this address, and an address in any case. Part of self-tests.mjs.
import path from 'node:path'; import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(import.meta.dirname, '..');
const { escrowFor } = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'escrow-for.js')).href);
let pass = 0, fail = 0;
const is = (what, ok, more = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + what + (more && !ok ? ' — ' + more : '')); ok ? pass++ : fail++; };

const now = 2_000_000_000, W = 604800;
const ME = '0x' + 'a'.repeat(40), YOU = '0x' + 'b'.repeat(40), OTHER = '0x' + 'c'.repeat(40);
const jobs = {
  1: [ME, YOU, 'F', 0.1, 0, now + 3600],            // I sell, funded, waiting
  2: [ME, YOU, 'S', 0.2, now - W - 10, now + 9e5],    // I delivered, window over: my pay waits release
  3: [ME, YOU, 'S', 0.3, now - 100, now + 9e5],       // I delivered, in the window
  4: [OTHER, ME, 'F', 0.5, 0, now - 10],              // I bought, never delivered, expired: my money waits refund
  5: [ME, ME, 'F', 0.7, 0, now - 10],                 // a self-hire, expired
  6: [OTHER, YOU, 'F', 9, 0, now - 10],               // not mine
  7: [ME, YOU, 'C', 0.1, now - 2 * W, now - W],       // completed
};
const settleLog = [{ id: '2', provider: ME.toUpperCase().replace('0X', '0x'), settled: true, released_u: 0.2, tx: '0x1', at: 'x' }, { id: '9', provider: OTHER, settled: true, released_u: 1, tx: '0x2' }, { id: '10', provider: ME, settled: false }];
const refundLog = [{ id: '4', client: ME, refunded: true, returned_u: 0.5, tx: '0x3' }, { id: '11', client: YOU, refunded: true, returned_u: 2 }];
const r = escrowFor(ME.toUpperCase().replace('0X', '0x'), { jobs, settleLog, refundLog, now, windowSec: W });
const row = (list, id) => list.find((x) => x.job === id);
is('my jobs as provider and as client, not anybody else\'s', r.as_provider.length === 5 && r.as_client.length === 2 && !row(r.as_client, 6), `${r.as_provider.length}/${r.as_client.length}`);
is('funded and waiting says until when', /^funded, waiting for delivery until /.test(row(r.as_provider, 1).next));
is('delivered with the window over: the pay waits release (settle)', /window over: BOBAI's next public settle/.test(row(r.as_provider, 2).next) && r.summary.pay_waiting_release.jobs === 1 && r.summary.pay_waiting_release.amount === 0.2);
is('delivered in the window says until when', /in the dispute window until /.test(row(r.as_provider, 3).next));
is('bought, never delivered, expired: the money waits refund', /expired undelivered: the budget goes back/.test(row(r.as_client, 4).next) && r.summary.money_waiting_refund.jobs === 1 && r.summary.money_waiting_refund.amount === 0.5);
is('a self-hire is said as one and counted in neither total', /self-hire/.test(row(r.as_provider, 5).next) && r.summary.money_waiting_refund.amount === 0.5);
is('a completed job is completed', row(r.as_provider, 7).next === 'completed');
is('the settle and refund records: only this address, only what went through, any case', r.settled_for_you.length === 1 && r.settled_for_you[0].job === 2 && r.refunded_to_you.length === 1 && r.summary.settled_for_you_by_bobai.amount === 0.2 && r.summary.refunded_to_you_by_bobai.amount === 0.5);
is('newest job first', r.as_provider[0].job === 7);
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
