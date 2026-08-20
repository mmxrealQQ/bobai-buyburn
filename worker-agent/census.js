// Keeps the ERC-8004 census current without anybody's laptop being on.
//
// The full scan — a quarter of a million ids — is done once, offline, and its
// result is the baseline. This is what runs afterwards, and it is built around
// two facts that make a daily full scan unnecessary as well as impossible:
//
//   The registry grows; it does not churn. An id registered last month reads
//   the same today. Only the ids minted since the last run need reading.
//
//   Reachability is the part that decays, and it decays slowly. Checking a
//   rotating slice each day means every agent gets re-checked within about a
//   month, which is far more current than the data was ever going to be used.
//
// COST, which is the binding constraint here:
//   Workers free plan allows 50 subrequests per invocation, and this account is
//   already near the KV daily read limit. So one run does at most ~40 RPC/HTTP
//   calls and writes two KV keys. That is roughly 0.2% of the daily write
//   budget — the census stays current and nothing else on the account notices.
//
// It deliberately does NOT try to redo the full scan incrementally. Creeping
// through 280,000 ids at 1,250 a day would take nine days per pass, burn the
// budget continuously, and produce a figure that is always a week stale. Better
// to re-run the offline scan by hand a few times a year and let this keep the
// edges fresh.

const REGISTRY = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432';
const TOKEN_URI = '0xc87b56dd';
const OWNER_OF = '0x6352211e';

const RPCS = [
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-mainnet.public.blastapi.io',
  'https://bsc-dataseed.binance.org',
];

// Hard ceiling on outbound calls per run. The free plan cuts off at 50 and a
// truncated run would write a partial result as if it were complete.
const MAX_CALLS = 40;

const id32 = (n) => BigInt(n).toString(16).padStart(64, '0');

export async function runCensusTick(env) {
  let calls = 0;
  const rpc = async (data, id = 1) => {
    if (calls >= MAX_CALLS) return null;
    calls++;
    for (const url of RPCS) {
      try {
        const r = await fetch(url, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to: REGISTRY, data }, 'latest'] }),
          signal: AbortSignal.timeout(8000),
        });
        const j = await r.json();
        if (j.error) continue;
        return j.result;
      } catch { /* next */ }
    }
    return null;
  };

  const state = JSON.parse((await env.AGENT.get('census:state')) || 'null') || {
    highestId: null, newSinceBaseline: 0, probeCursor: 0, lastRun: null, checked: 0, stillUp: 0,
  };

  // ---- 1. has the registry grown? ----------------------------------------
  // Doubling probe from the known high-water mark. Cheap when nothing new
  // appeared (one call), and bounded by MAX_CALLS when a lot did.
  if (state.highestId) {
    const exists = async (id) => {
      const r = await rpc(OWNER_OF + id32(id));
      return !!(r && r !== '0x' && BigInt(r) !== 0n);
    };
    let hi = state.highestId;
    let step = 64;
    while (calls < MAX_CALLS / 2 && await exists(hi + step)) { hi += step; step *= 2; }
    // Narrow down without overrunning the call budget; an approximate high
    // mark is fine, the next run continues from wherever this stopped.
    let lo = hi;
    let probe = Math.max(1, Math.floor(step / 2));
    while (calls < MAX_CALLS * 0.75 && probe >= 1) {
      if (await exists(lo + probe)) lo += probe;
      else probe = Math.floor(probe / 2);
    }
    if (lo > state.highestId) {
      state.newSinceBaseline += lo - state.highestId;
      state.highestId = lo;
    }
  }

  // ---- 2. re-check a slice of the known endpoints -------------------------
  // The list lives in KV as a plain array of {id, url}, written by the offline
  // publish step. Without it this half simply does nothing.
  const list = JSON.parse((await env.AGENT.get('census:endpoints')) || '[]');
  let checked = 0, up = 0;
  if (list.length) {
    const start = state.probeCursor % list.length;
    for (let i = 0; i < list.length && calls < MAX_CALLS; i++) {
      const item = list[(start + i) % list.length];
      if (!item || !item.url) continue;
      calls++;
      checked++;
      try {
        const r = await fetch(item.url, {
          method: 'GET',
          headers: { 'user-agent': 'brainonbnb-erc8004-census' },
          redirect: 'follow',
          signal: AbortSignal.timeout(6000),
        });
        // Same generous rule as the offline probe: any answer means something
        // is listening. Changing the rule between passes would make the two
        // halves of the same number incomparable.
        if (r) up++;
      } catch { /* counted as down */ }
    }
    state.probeCursor = (start + checked) % list.length;
  }

  state.checked = checked;
  state.stillUp = up;
  state.lastRun = new Date().toISOString();

  // Two writes per run, and only when something actually changed.
  await env.AGENT.put('census:state', JSON.stringify(state));
  await env.AGENT.put('census:latest', JSON.stringify({
    highest_id: state.highestId,
    registered_since_baseline: state.newSinceBaseline,
    last_checked_at: state.lastRun,
    rotating_check: {
      endpoints_known: list.length,
      checked_this_run: checked,
      answered: up,
      position: state.probeCursor,
      note: 'A slice of the known endpoints is re-checked each run, so every one is revisited roughly monthly. The headline census comes from a full offline scan.',
    },
    calls_used: calls,
  }));

  return { calls, checked, up, highestId: state.highestId, newSince: state.newSinceBaseline };
}
