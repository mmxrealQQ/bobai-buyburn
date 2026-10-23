// worker-agent/escrow-for.js — one address, its ERC-8183 escrow at a glance (2026-10-23)
//
// Operator, 23.10.: AI agents, platforms and builders should find their way to us by themselves, because we are the
// most useful place. An agent that sells or buys on the escrow wants one answer: what is waiting for me, and what has
// BOBAI already done for me? This reads the job board's store (every job on the kernel but the farm's, refreshed daily
// at 21:45 UTC), the public settle's record and the public refund's record — nothing new is read from the chain.
//
//   GET https://agent.brainonbnb.com/escrow/for/<address>     (MCP: erc8183_escrow_status on brainonbnb.com/mcp)

import { STATUS } from '../shared/job-board.js';

const WINDOW_SEC = 604800;   // the router's dispute window (7 days), as public-settle reads it from the chain

// Pure. jobs: { id: [provider, client, status letter, budget, submitted_at, expired_at] }; logs: the settle and refund
// records ({ id, provider|client, tx, released_u|returned_u, at, settled|refunded }). Returns the address's view.
export function escrowFor(address, { jobs = {}, settleLog = [], refundLog = [], now = Math.floor(Date.now() / 1000), windowSec = WINDOW_SEC } = {}) {
  const a = String(address || '').toLowerCase();
  const asProvider = [], asClient = [];
  for (const [id, j] of Object.entries(jobs)) {
    if (!Array.isArray(j)) continue;
    const [p, c, s, budget, sub, exp] = j;
    if (p !== a && c !== a) continue;
    const status = STATUS[s] || s;
    let next;
    if (s === 'F' && exp && now >= exp) next = c === p ? 'expired undelivered (a self-hire: claimRefund(jobId) returns it to you)' : 'expired undelivered: the budget goes back to the client at BOBAI\'s next public refund (21:15 UTC), or claimRefund(jobId) on the kernel now';
    else if (s === 'F') next = `funded, waiting for delivery until ${new Date(exp * 1000).toISOString().slice(0, 16)} UTC`;
    else if (s === 'S' && sub && now >= sub + windowSec) next = c === p ? 'delivered, window over (a self-hire: BOBAI does not settle those)' : 'delivered, window over: BOBAI\'s next public settle (21:15 UTC) releases it to the provider, or settle(jobId) on the router now';
    else if (s === 'S') next = `delivered, in the dispute window until ${new Date((sub + windowSec) * 1000).toISOString().slice(0, 16)} UTC`;
    else if (s === 'O') next = now >= exp ? 'never funded, expired' : 'created, not funded yet';
    else next = status.toLowerCase();
    const row = { job: Number(id), status, budget: Number(budget), next };
    if (p === a) asProvider.push({ ...row, client: c });
    if (c === a) asClient.push({ ...row, provider: p });
  }
  const byId = (x, y) => y.job - x.job;
  const settled = settleLog.filter((d) => d.settled && String(d.provider).toLowerCase() === a).map((d) => ({ job: Number(d.id), released: Number(d.released_u), tx: d.tx, at: d.at }));
  const refunded = refundLog.filter((d) => d.refunded && String(d.client).toLowerCase() === a).map((d) => ({ job: Number(d.id), returned: Number(d.returned_u), tx: d.tx, at: d.at }));
  const sum = (xs, k) => Number(xs.reduce((s, x) => s + (Number(x[k]) || 0), 0).toFixed(4));
  const waitingPay = asProvider.filter((x) => /window over/.test(x.next));
  const waitingBack = asClient.filter((x) => /expired undelivered/.test(x.next) && !/self-hire/.test(x.next));
  return {
    address: a,
    summary: {
      jobs_as_provider: asProvider.length, jobs_as_client: asClient.length,
      pay_waiting_release: { jobs: waitingPay.length, amount: sum(waitingPay, 'budget') },
      money_waiting_refund: { jobs: waitingBack.length, amount: sum(waitingBack, 'budget') },
      settled_for_you_by_bobai: { jobs: settled.length, amount: sum(settled, 'released') },
      refunded_to_you_by_bobai: { jobs: refunded.length, amount: sum(refunded, 'returned') },
    },
    as_provider: asProvider.sort(byId).slice(0, 100),
    as_client: asClient.sort(byId).slice(0, 100),
    settled_for_you: settled.slice(0, 100),
    refunded_to_you: refunded.slice(0, 100),
  };
}

export async function readEscrowFor(env, address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(address || ''))) return { error: 'an address, 0x and 40 hex characters' };
  const [jobs, meta, sl, rl] = await Promise.all(['jobboard:jobs', 'jobboard:board', 'settle:public:log', 'refund:public:log'].map((k) => env.AGENT.get(k)));
  const board = JSON.parse(meta || '{}');
  return {
    what: 'One address on the ERC-8183 escrow kernel on BNB Chain (0xEa4DAa3100A767e86FDed867729ae7446476EBA6): its jobs as provider and as client with what happens next to each, the pay waiting to be released, the money waiting to come back, and what BOBAI\'s public settle and refund did for it. Amounts are in the job\'s stablecoin ($U for most, USDT for some).',
    read_at: board.measured_at || null,
    note: 'Job states are as of the job board\'s last daily read (read_at, 21:45 UTC); the settle and refund records are live. One campaign address that holds nearly every job ever minted is not in the store.',
    ...escrowFor(address, { jobs: JSON.parse(jobs || '{}'), settleLog: JSON.parse(sl || '[]'), refundLog: JSON.parse(rl || '[]') }),
    settle_and_refund: 'https://brainonbnb.com/settle',
    help: 'Something between agents not working? https://agent.brainonbnb.com/board.md',
  };
}
