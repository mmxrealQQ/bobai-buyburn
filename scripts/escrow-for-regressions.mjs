#!/usr/bin/env node
// One address's ERC-8183 escrow at a glance (worker-agent/escrow-for.js, 2026-10-23), offline. What happens next to
// each job — funded and waiting, funded and expired (money back to the client), delivered in the window, delivered and
// the window over (pay waiting release) — and only what BOBAI really does is promised (review, 23.10.): a self-hire, a
// budget under 0.01, a farm and (for the refund) our own hire are said as not BOBAI's, a self-hire's money is waiting
// for nobody, and a job BOBAI settled or refunded today is said as done, not counted as waiting. The settle and refund
// records filtered to this address, and an address in any case. Part of self-tests.mjs.
import path from 'node:path'; import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(import.meta.dirname, '..');
const { escrowFor } = await import(pathToFileURL(path.join(ROOT, 'worker-agent', 'escrow-for.js')).href);
let pass = 0, fail = 0;
const is = (what, ok, more = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + what + (more && !ok ? ' — ' + more : '')); ok ? pass++ : fail++; };

const now = 2_000_000_000, W = 604800;
const ME = '0x' + 'a'.repeat(40), YOU = '0x' + 'b'.repeat(40), OTHER = '0x' + 'c'.repeat(40), FARM = '0x' + 'f'.repeat(40), OWN = '0x' + 'e'.repeat(40);
const jobs = {
  1: [ME, YOU, 'F', 0.1, 0, now + 3600],            // I sell, funded, waiting
  2: [ME, YOU, 'S', 0.2, now - W - 10, now + 9e5],    // I delivered, window over: my pay waits release
  3: [ME, YOU, 'S', 0.3, now - 100, now + 9e5],       // I delivered, in the window
  4: [OTHER, ME, 'F', 0.5, 0, now - 10],              // I bought, never delivered, expired: my money waits refund
  5: [ME, ME, 'F', 0.7, 0, now - 10],                 // a self-hire, expired
  6: [OTHER, YOU, 'F', 9, 0, now - 10],               // not mine
  7: [ME, YOU, 'C', 0.1, now - 2 * W, now - W],       // completed
  8: [ME, YOU, 'S', 0.001, now - W - 10, now + 9e5],  // window over, a wei budget: not BOBAI's
  9: [FARM, ME, 'F', 1, 0, now - 10],                 // bought from a farm, expired: not BOBAI's
};
const r = escrowFor(ME.toUpperCase().replace('0X', '0x'), { jobs, now, windowSec: W, farms: [FARM], own: new Set([OWN]) });
const row = (list, id) => list.find((x) => x.job === id);
is('my jobs as provider and as client, not anybody else\'s', r.as_provider.length === 6 && r.as_client.length === 3 && !row(r.as_client, 6), `${r.as_provider.length}/${r.as_client.length}`);
is('funded and waiting says until when', /^funded, waiting for delivery until /.test(row(r.as_provider, 1).next));
is('delivered, window over, ours to settle: a coming public settle (if the router is its evaluator), or settle() now', /window over: a coming public settle by BOBAI .* if the router is its evaluator, or settle\(jobId\)/.test(row(r.as_provider, 2).next));
is('delivered in the window says until when', /in the dispute window until /.test(row(r.as_provider, 3).next));
is('bought, never delivered, expired, ours to refund: a coming public refund, or claimRefund() now', /expired undelivered: the budget goes back to the client at a coming public refund by BOBAI/.test(row(r.as_client, 4).next));
is('not BOBAI\'s, each said with why: a self-hire, under 0.01, a farm', /BOBAI does not refund this one \(a self-hire\)/.test(row(r.as_provider, 5).next) && /BOBAI does not settle this one \(under 0\.01\)/.test(row(r.as_provider, 8).next) && /BOBAI does not refund this one \(a farm\)/.test(row(r.as_client, 9).next));
is('the totals: money waiting for somebody, a self-hire\'s for nobody', r.summary.pay_waiting_release.jobs === 2 && r.summary.pay_waiting_release.amount === 0.201 && r.summary.money_waiting_refund.jobs === 2 && r.summary.money_waiting_refund.amount === 1.5, JSON.stringify(r.summary));
is('a completed job is completed; newest first', row(r.as_provider, 7).next === 'completed' && r.as_provider[0].job === 8);
const ownR = escrowFor(OWN, { jobs: { 20: [OTHER, OWN, 'F', 0.3, 0, now - 10] }, now, windowSec: W, own: new Set([OWN]) });
is('our own hire, expired: said as refunded by itself, not promised to the public refund', /BOBAI does not refund this one \(our own hire, refunded by itself\)/.test(ownR.as_client[0].next));

// what BOBAI did today: said as done, not waiting; the records filtered to this address, only what went through
const settleLog = [{ id: '2', provider: ME.toUpperCase().replace('0X', '0x'), settled: true, released_u: 0.2, tx: '0x1', at: 'x' }, { id: '90', provider: OTHER, settled: true, released_u: 1, tx: '0x2' }, { id: '91', provider: ME, settled: false }];
const refundLog = [{ id: '4', client: ME, refunded: true, returned_u: 0.5, tx: '0x3' }, { id: '92', client: YOU, refunded: true, returned_u: 2 }];
const d = escrowFor(ME, { jobs, settleLog, refundLog, now, windowSec: W, farms: [FARM] });
is('settled or refunded by BOBAI today: said as done until the job board reads it again, not counted as waiting', /settled to the provider by BOBAI today/.test(row(d.as_provider, 2).next) && /refunded to the client by BOBAI today/.test(row(d.as_client, 4).next) && d.summary.pay_waiting_release.jobs === 1 && d.summary.money_waiting_refund.jobs === 1, JSON.stringify(d.summary));
is('the settle and refund records: only this address, only what went through, any case', d.settled_for_you.length === 1 && d.settled_for_you[0].job === 2 && d.refunded_to_you.length === 1 && d.summary.settled_for_you_by_bobai.amount === 0.2 && d.summary.refunded_to_you_by_bobai.amount === 0.5);
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
