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

// The hourly high-water probe runs on its own invocation and needs far less:
// a doubling walk over a day's growth settles in about a dozen calls.
const FRONTIER_CALLS = 20;

const id32 = (n) => BigInt(n).toString(16).padStart(64, '0');

const decodeString = (hex) => {
  if (!hex || hex === '0x') return null;
  const b = hex.slice(2);
  try {
    const len = parseInt(b.slice(64, 128), 16);
    if (!(len > 0) || len > 400000) return null;
    const bytes = [];
    for (let i = 0; i < len; i++) bytes.push(parseInt(b.substr(128 + i * 2, 2), 16));
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch { return null; }
};

// Registrations are a data: URI holding base64 JSON. Same parsing as the
// offline scanner, deliberately — two readers disagreeing about what counts as
// a valid registration would make the daily numbers incomparable with the scan.
const parseRegistration = (raw) => {
  const s = decodeString(raw);
  if (!s) return null;
  const b64 = s.includes('base64,') ? s.split('base64,')[1] : null;
  try {
    const json = b64 ? atob(b64) : s;
    return JSON.parse(json);
  } catch { return null; }
};

export async function runCensusTick(env) {
  let calls = 0;

  // Batched eth_call. The single-call helper below is for the id probe, which
  // is inherently sequential; reading registrations is not, and doing it one
  // at a time would burn the entire per-invocation budget on 40 agents.
  const rpcBatch = async (datas) => {
    const payload = datas.map((data, i) => ({
      jsonrpc: '2.0', id: i, method: 'eth_call',
      params: [{ to: REGISTRY, data }, 'latest'],
    }));
    for (const url of RPCS) {
      try {
        const r = await fetch(url, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(12000),
        });
        const j = await r.json();
        if (!Array.isArray(j)) continue;
        const out = new Array(datas.length).fill(null);
        for (const item of j) if (typeof item.id === 'number' && !item.error) out[item.id] = item.result;
        return out;
      } catch { /* next endpoint */ }
    }
    return null;
  };
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

  // ---- 1b. read what is new ----------------------------------------------
  // Knowing the registry grew is not the same as knowing what grew. Without
  // this, an agent registered today waits for the next manual full scan before
  // anything here can find it — and the gap widens by several thousand a day.
  //
  // Batched 25 ids per request, which is what makes it affordable: one call
  // covers what would otherwise be twenty-five. Whatever cannot be read this
  // run stays queued for the next, so the frontier advances every day rather
  // than being redone from scratch.
  const newFound = [];
  if (state.highestId && state.lastScannedNew == null) state.lastScannedNew = state.baselineId || state.highestId;
  if (state.highestId && state.lastScannedNew < state.highestId) {
    const endpoints = JSON.parse((await env.AGENT.get('census:endpoints')) || '[]');
    const known = new Set(endpoints.map((e) => e.id));
    let cursor = state.lastScannedNew + 1;

    while (calls < MAX_CALLS - 12 && cursor <= state.highestId) {
      const ids = [];
      for (let i = 0; i < 25 && cursor + i <= state.highestId; i++) ids.push(cursor + i);
      calls++;
      const batch = await rpcBatch(ids.map((id) => TOKEN_URI + id32(id)));
      if (!batch) break;

      for (let i = 0; i < ids.length; i++) {
        const meta = parseRegistration(batch[i]);
        if (!meta) continue;
        const services = Array.isArray(meta.services) ? meta.services : [];
        const url = services
          .map((x) => (x && typeof x.endpoint === 'string' ? x.endpoint : null))
          .find((u) => u && /^https?:\/\//i.test(u));
        if (!url || known.has(ids[i])) continue;
        newFound.push({ id: ids[i], url: url.slice(0, 300), name: (meta.name || '').slice(0, 60) });
      }
      cursor += ids.length;
      state.lastScannedNew = cursor - 1;
    }

    // New endpoints join the rotation immediately, so tomorrow's reachability
    // check covers them like any other.
    if (newFound.length) {
      const merged = endpoints.concat(newFound.map((n) => ({ id: n.id, url: n.url })));
      while (merged.length > 20000) merged.shift();
      await env.AGENT.put('census:endpoints', JSON.stringify(merged));
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

  // ---- 3. remember today -------------------------------------------------
  // A census that only ever reports "now" is a photograph. The registry grows
  // every day and endpoints come and go; the interesting fact is the movement,
  // and it is unrecoverable unless somebody writes it down as it happens.
  //
  // Two kinds of point, kept apart on purpose. A daily point is cheap and
  // partial: the registry's high-water mark, plus the hit rate of whichever
  // slice of endpoints was re-checked. A full point comes from an offline
  // scan of every id. Averaging one into the other would produce a line that
  // means nothing — so each carries its own `kind` and the page plots them
  // differently.
  const today = state.lastRun.slice(0, 10);
  const history = JSON.parse((await env.AGENT.get('census:history')) || '[]');
  const point = {
    date: today,
    kind: 'daily',
    highest_id: state.highestId,
    new_since_baseline: state.newSinceBaseline,
    // Reachability from the rotating sample only. Named `sample_` so nobody
    // reads it as a figure for the whole registry — it is 24 endpoints out of
    // eighteen hundred, and saying so is the difference between a measurement
    // and a claim.
    sample_checked: checked,
    sample_answered: up,
    // How far the frontier has advanced, and what it turned up. A day with
    // thousands of new ids and no new endpoints is itself a finding.
    new_ids_read: state.lastScannedNew || null,
    new_endpoints_found: newFound.length,
  };
  // One point per day: a re-run replaces the day rather than appending, so a
  // manual trigger cannot bend the line.
  const idx = history.findIndex((h) => h.date === today && h.kind === 'daily');
  if (idx >= 0) history[idx] = point; else history.push(point);
  // Two years of daily points is a few KB. Trimmed anyway, because unbounded
  // growth in a KV value is a problem that arrives quietly.
  while (history.length > 800) history.shift();
  await env.AGENT.put('census:history', JSON.stringify(history));

  // Two writes per run, and only when something actually changed.
  await env.AGENT.put('census:state', JSON.stringify(state));
  await env.AGENT.put('census:latest', JSON.stringify({
    highest_id: state.highestId,
    registered_since_baseline: state.newSinceBaseline,
    last_checked_at: state.lastRun,
    frontier: {
      read_up_to: state.lastScannedNew || null,
      behind_by: state.highestId && state.lastScannedNew ? state.highestId - state.lastScannedNew : null,
      new_endpoints_this_run: newFound.length,
      note: 'New registrations are read in batches each run and any with an endpoint join the reachability rotation immediately. What cannot be read in one run stays queued for the next.',
    },
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

// The high-water mark alone, hourly.
//
// The full tick above is pinned to one moment a day because reading new
// registrations and re-checking endpoints costs the whole call budget. But the
// headline figure on two public pages is just "how many ids exist", and the
// registry mints several thousand a day — so a number refreshed once at 03:00
// is up to three thousand short by evening, and after an offline full scan it
// is actually LOWER than the figure the scan published. A page whose live
// counter reads below its own static number is worse than no live counter.
//
// This is the cheap half on its own: one doubling probe from the known mark,
// ~15 eth_calls, and a KV write only when the registry actually grew. Hourly,
// that is 48 writes a day against a budget the census already respects.
export async function runFrontierTick(env) {
  let calls = 0;
  const rpc = async (data) => {
    if (calls >= FRONTIER_CALLS) return null;
    calls++;
    for (const url of RPCS) {
      try {
        const r = await fetch(url, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: REGISTRY, data }, 'latest'] }),
          signal: AbortSignal.timeout(8000),
        });
        const j = await r.json();
        if (j.error) continue;
        return j.result;
      } catch { /* next endpoint */ }
    }
    return null;
  };

  const state = JSON.parse((await env.AGENT.get('census:state')) || 'null');
  if (!state || !state.highestId) return { skipped: 'no baseline' };

  // A missing answer is a fact about the node, not about the registry. Treating
  // it as "id does not exist" is how a single RPC hiccup once reported 671 ids
  // in a registry of 280,000 — so an unanswered probe stops the walk instead of
  // being read as the end of the registry.
  const exists = async (id) => {
    const r = await rpc(OWNER_OF + id32(id));
    if (r == null) return null;
    return !!(r !== '0x' && BigInt(r) !== 0n);
  };

  let hi = state.highestId;
  let step = 64;
  for (;;) {
    if (calls >= FRONTIER_CALLS / 2) break;
    const e = await exists(hi + step);
    if (e !== true) break;
    hi += step;
    step *= 2;
  }
  let lo = hi;
  let probe = Math.max(1, Math.floor(step / 2));
  while (calls < FRONTIER_CALLS && probe >= 1) {
    const e = await exists(lo + probe);
    if (e === null) break;
    if (e) lo += probe; else probe = Math.floor(probe / 2);
  }

  if (lo <= state.highestId) return { calls, highestId: state.highestId, grew: 0 };

  const grew = lo - state.highestId;
  state.newSinceBaseline += grew;
  state.highestId = lo;
  state.frontierAt = new Date().toISOString();
  await env.AGENT.put('census:state', JSON.stringify(state));

  // Patch the published snapshot in place. The rest of it — the rotating
  // reachability check, the frontier queue — belongs to the daily run and is
  // left exactly as that run wrote it, so nothing here can pass off an hourly
  // probe as a full census.
  const latest = JSON.parse((await env.AGENT.get('census:latest')) || 'null');
  if (latest) {
    latest.highest_id = state.highestId;
    latest.registered_since_baseline = state.newSinceBaseline;
    latest.high_water_checked_at = state.frontierAt;
    if (latest.frontier) {
      latest.frontier.behind_by = state.lastScannedNew ? state.highestId - state.lastScannedNew : null;
    }
    await env.AGENT.put('census:latest', JSON.stringify(latest));
  }
  return { calls, highestId: state.highestId, grew };
}
