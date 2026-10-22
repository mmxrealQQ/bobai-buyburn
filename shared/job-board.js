// shared/job-board.js — who gets hired on BNB Chain, ranked from the ERC-8183 escrow itself (2026-10-22)
//
// Operator, 22.10.: "make the ecosystem the most active and #1 on BNB Chain" — and, always, "without fake". No board
// anywhere ranks the agents that actually get hired and paid on BNB Chain's escrow kernel, so this one does, from the
// chain alone, with every rule written here once and used by the worker, the seed script and the check alike.
//
//   ACTIVE      work delivered in the last 30 days (the job's own submitted_at) for a client who put money in escrow:
//               SUBMITTED or COMPLETED, budget above zero. SUBMITTED is delivered and not yet released, and is shown
//               apart from paid; it is never added to paid.
//   NOT WORK    a client that is the provider itself; and for our own providers, any client that is one of our wallets
//               (we know our wallets, nobody else's — so the stricter rule applies to us, not to them).
//   THE FARM    one campaign address holds 98.5 % of every job the kernel ever minted, at a cent each, and its last
//               delivery was 2026-06-23. It is shown on its own line with its census figures, never in the ranking:
//               counted in, it would describe that one campaign rather than the market around it.
//   RANK        jobs paid in 30 days (the escrow released: the strongest fact the chain holds — a delivery a client
//               never accepted, or one client hiring the same agent twelve times, does not move it), then distinct
//               paying clients in 30 days, then delivered in 30 days, then paid ever. The clients stand beside it on
//               every row: an agent paid often by few is not the same as one paid by many, and the page says which.

export const WINDOW_DAYS = 30;
export const STATUS = { O: 'OPEN', F: 'FUNDED', S: 'SUBMITTED', C: 'COMPLETED', R: 'REJECTED', E: 'EXPIRED' };
const CODE = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [v, k]));

// A job as stored: [provider, client, status letter, budget in $U, submitted_at, expired_at], addresses lower-case.
export const pack = (j) => [String(j.provider).toLowerCase(), String(j.client).toLowerCase(), CODE[j.status] || '?', Number(j.budget_u ?? Number(BigInt(j.budget || 0)) / 1e18), Number(j.submitted_at) || 0, Number(j.expired_at) || 0];

// Still able to change: read again on the next run. An OPEN job past its expiry can never be funded.
export const live = (r, now) => r[2] === 'F' || r[2] === 'S' || (r[2] === 'O' && r[5] > now);

// records: { id: packed }; ours: Set of our wallets; names: { provider: [{ id, name }] }; farms: [provider];
// now: unix seconds. Returns the board, pure.
export function buildBoard(records, { ours = new Set(), names = {}, farms = [], now = Math.floor(Date.now() / 1000), windowDays = WINDOW_DAYS, top = 25 } = {}) {
  const farmSet = new Set(farms.map((f) => String(f).toLowerCase()));
  const since = now - windowDays * 86400;
  const per = {};
  let delivered = 0, paid = 0, paidU = 0;
  const clientsAll = new Set(), providersActive = new Set();
  for (const r of Object.values(records)) {
    const [p, c, s, b, t] = r;
    if (farmSet.has(p)) continue;
    if (!(b > 0) || (s !== 'S' && s !== 'C')) continue;              // funded and delivered, nothing else is work
    if (c === p) continue;                                           // an address hiring itself
    const own = ours.has(p);
    if (own && ours.has(c)) continue;                                // our wallets hiring our agents: a test
    const x = (per[p] ??= { provider: p, ours: own, delivered_30d: 0, paid_30d: 0, clients_30d: new Set(), paid_ever: 0, paid_ever_u: 0, clients_ever: new Set(), last_delivery: 0 });
    x.clients_ever.add(c);
    if (s === 'C') { x.paid_ever++; x.paid_ever_u += b; }
    if (t > x.last_delivery) x.last_delivery = t;
    if (t >= since) {
      x.delivered_30d++; x.clients_30d.add(c); delivered++; clientsAll.add(c); providersActive.add(p);
      if (s === 'C') { x.paid_30d++; paid++; paidU += b; }
    }
  }
  const rows = Object.values(per)
    .map((x) => ({ ...x, clients_30d: x.clients_30d.size, clients_ever: x.clients_ever.size, paid_ever_u: Number(x.paid_ever_u.toFixed(4)), agents: names[x.provider] || [] }))
    .sort((a, b) => b.paid_30d - a.paid_30d || b.clients_30d - a.clients_30d || b.delivered_30d - a.delivered_30d || b.paid_ever - a.paid_ever || a.provider.localeCompare(b.provider))
    .map((x, i) => ({ rank: i + 1, ...x }));
  const active = rows.filter((x) => x.delivered_30d > 0);
  // the leader by the other measure, named on the page beside the ranking
  const byClients = [...rows].sort((a, b) => b.clients_30d - a.clients_30d || b.paid_30d - a.paid_30d)[0] || null;
  return {
    most_clients_30d: byClients && byClients.clients_30d ? { provider: byClients.provider, agents: byClients.agents, ours: byClients.ours, clients_30d: byClients.clients_30d, rank: byClients.rank } : null,
    window_days: windowDays,
    totals_30d: { delivered, paid, paid_u: Number(paidU.toFixed(4)), providers: providersActive.size, paying_clients: clientsAll.size },
    ranking: rows.slice(0, top),
    ours: rows.filter((x) => x.ours),
    active_providers: active.length,
  };
}
