// $BOBAI Worldcup '26 — Live Sync + Admin Worker
// Sync match results from football-data.org → wc_matches.
// DB trigger (Phase E migration) auto-scores tips when match.played flips to true.

// ============================================================
// Team-name → our country-code map (football-data.org → wc_countries.code)
// ============================================================
const TEAM_MAP = {
  'Algeria': 'DZ',
  'Argentina': 'AR',
  'Australia': 'AU',
  'Austria': 'AT',
  'Belgium': 'BE',
  'Bosnia and Herzegovina': 'BA',
  'Bosnia-Herzegovina': 'BA',
  'Brazil': 'BR',
  'Canada': 'CA',
  'Cape Verde': 'CV',
  'Colombia': 'CO',
  'Croatia': 'HR',
  'Curaçao': 'CW',
  'Curacao': 'CW',
  'Czech Republic': 'CZ',
  'Czechia': 'CZ',
  'DR Congo': 'CD',
  'Congo DR': 'CD',
  'Democratic Republic of the Congo': 'CD',
  'Ecuador': 'EC',
  'Egypt': 'EG',
  'England': 'ENG',
  'France': 'FR',
  'Germany': 'DE',
  'Ghana': 'GH',
  'Haiti': 'HT',
  'Iran': 'IR',
  'Iraq': 'IQ',
  'Ivory Coast': 'CI',
  "Côte d'Ivoire": 'CI',
  'Cote d Ivoire': 'CI',
  'Japan': 'JP',
  'Jordan': 'JO',
  'Mexico': 'MX',
  'Morocco': 'MA',
  'Netherlands': 'NL',
  'New Zealand': 'NZ',
  'Norway': 'NO',
  'Panama': 'PA',
  'Paraguay': 'PY',
  'Portugal': 'PT',
  'Qatar': 'QA',
  'Saudi Arabia': 'SA',
  'Scotland': 'SCO',
  'Senegal': 'SN',
  'South Africa': 'ZA',
  'South Korea': 'KR',
  'Korea Republic': 'KR',
  'Spain': 'ES',
  'Sweden': 'SE',
  'Switzerland': 'CH',
  'Tunisia': 'TN',
  'Türkiye': 'TR',
  'Turkey': 'TR',
  'United States': 'US',
  'USA': 'US',
  'Uruguay': 'UY',
  'Uzbekistan': 'UZ',
};

function teamToCode(name){
  if (!name) return null;
  if (TEAM_MAP[name]) return TEAM_MAP[name];
  // Case-insensitive fallback
  const lc = name.toLowerCase();
  for (const k in TEAM_MAP) if (k.toLowerCase() === lc) return TEAM_MAP[k];
  return null;
}

// ============================================================
// Supabase REST helpers (service-role bypasses RLS)
// ============================================================
async function sbReq(env, method, path, body){
  const url = env.SUPABASE_URL + '/rest/v1/' + path;
  const headers = {
    'apikey':        env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  };
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, body: json, text };
}

async function listOurMatches(env){
  const r = await sbReq(env, 'GET',
    'wc_matches?select=id,phase,group_letter,team_home,team_away,kickoff_utc,goals_home,goals_away,played&order=kickoff_utc.asc');
  if (!Array.isArray(r.body)) {
    console.log('[SB] listOurMatches non-array:', r.status, JSON.stringify(r.body));
    return [];
  }
  return r.body;
}

async function updateMatch(env, id, fields){
  return sbReq(env, 'PATCH', 'wc_matches?id=eq.' + id, fields);
}

// ============================================================
// football-data.org fetch
// ============================================================
async function fetchFromFootballData(env){
  if (!env.FOOTBALL_DATA_API_KEY) {
    return { error: 'FOOTBALL_DATA_API_KEY not configured.' };
  }
  const url = `https://api.football-data.org/v4/competitions/${env.FOOTBALL_DATA_COMPETITION || 'WC'}/matches`;
  const res = await fetch(url, {
    headers: { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY, 'Accept': 'application/json' },
  });
  if (!res.ok) {
    return { error: `football-data.org returned ${res.status}` };
  }
  const json = await res.json();
  return { matches: json.matches || [] };
}

// ============================================================
// Match identifier — used to find OUR row that corresponds to a remote match
//   1) GROUP_STAGE: match by (group_letter, sorted-team-codes)
//   2) KO stage: by (phase, kickoff_utc within ±2h)  — KO teams in our DB are TBD until draw
// ============================================================
function ourPhaseFromRemote(stage){
  switch (stage) {
    case 'GROUP_STAGE': return 'group';
    case 'LAST_32':
    case 'ROUND_OF_32': return 'r32';
    case 'LAST_16':
    case 'ROUND_OF_16': return 'r16';
    case 'QUARTER_FINALS':  return 'qf';
    case 'SEMI_FINALS':     return 'sf';
    case 'THIRD_PLACE':     return '3rd';
    case 'FINAL':           return 'final';
    default: return null;
  }
}

function ourGroupLetter(remoteGroup){
  if (!remoteGroup) return null;
  // "GROUP_A" → "A"
  const m = remoteGroup.match(/GROUP_([A-L])/);
  return m ? m[1] : null;
}

function findOurMatch(remote, ourMatches){
  const phase = ourPhaseFromRemote(remote.stage);
  if (!phase) return null;
  const homeCode = teamToCode(remote.homeTeam?.name);
  const awayCode = teamToCode(remote.awayTeam?.name);

  if (phase === 'group') {
    const letter = ourGroupLetter(remote.group);
    if (!letter) return null;
    const candidates = ourMatches.filter(m => m.phase === 'group' && m.group_letter === letter);
    // Match by team codes (sorted, since home/away may differ in source vs draw order)
    const target = [homeCode, awayCode].sort().join('|');
    return candidates.find(m => [m.team_home, m.team_away].sort().join('|') === target) || null;
  }

  // KO: match by phase + closest kickoff_utc (±2h tolerance)
  const remoteTs = new Date(remote.utcDate).getTime();
  const candidates = ourMatches.filter(m => m.phase === phase);
  let best = null, bestDiff = Infinity;
  for (const c of candidates) {
    const diff = Math.abs(new Date(c.kickoff_utc).getTime() - remoteTs);
    if (diff < bestDiff) { best = c; bestDiff = diff; }
  }
  return (best && bestDiff <= 2 * 3600 * 1000) ? best : null;
}

// ============================================================
// Sync logic
// ============================================================
async function syncMatches(env){
  const remote = await fetchFromFootballData(env);
  if (remote.error) return { ok: false, error: remote.error };
  const ours = await listOurMatches(env);

  let scheduled = 0, finished = 0, skipped = 0;

  for (const r of remote.matches) {
    const m = findOurMatch(r, ours);
    if (!m) { skipped++; continue; }

    const updates = {};
    // KO: fill in teams once draw resolves them
    if (m.team_home === 'TBD' || m.team_away === 'TBD') {
      const h = teamToCode(r.homeTeam?.name);
      const a = teamToCode(r.awayTeam?.name);
      if (h) updates.team_home = h;
      if (a) updates.team_away = a;
    }
    // Sync kickoff (in case schedule moves)
    if (r.utcDate && new Date(r.utcDate).toISOString() !== new Date(m.kickoff_utc).toISOString()) {
      updates.kickoff_utc = r.utcDate;
    }

    // Finished match: write goals + played=true → DB trigger auto-scores tips
    if (r.status === 'FINISHED') {
      const ft = r.score?.fullTime || {};
      if (ft.home != null && ft.away != null) {
        // Only update if changed
        if (!m.played || m.goals_home !== ft.home || m.goals_away !== ft.away) {
          updates.goals_home = ft.home;
          updates.goals_away = ft.away;
          updates.played = true;
          finished++;
        }
      }
    } else if (Object.keys(updates).length === 0) {
      // No changes for non-finished match
      continue;
    } else {
      scheduled++;
    }

    if (Object.keys(updates).length > 0) {
      await updateMatch(env, m.id, updates);
    }
  }

  return { ok: true, total: remote.matches.length, scheduled, finished, skipped };
}

// ============================================================
// Worker entry
// ============================================================
function json(body, status = 200){
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function checkAdmin(request, env){
  const token = request.headers.get('X-Admin-Token') || new URL(request.url).searchParams.get('token');
  return token && env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);

    // Public: status / health
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, name: 'bobai-worldcup-sync' });
    }

    // Admin: manual sync trigger
    if (url.pathname === '/sync') {
      if (!checkAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
      const r = await syncMatches(env);
      return json(r, r.ok ? 200 : 500);
    }

    // Admin: manually set a match result (for beta testing / FIFA-result corrections)
    // POST /admin/set-result?token=...  Body: { id, goals_home, goals_away }
    if (url.pathname === '/admin/set-result' && request.method === 'POST') {
      if (!checkAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
      const b = await request.json().catch(() => ({}));
      if (!Number.isInteger(b.id) || !Number.isInteger(b.goals_home) || !Number.isInteger(b.goals_away)) {
        return json({ error: 'expected { id, goals_home, goals_away }' }, 400);
      }
      const r = await updateMatch(env, b.id, {
        goals_home: b.goals_home,
        goals_away: b.goals_away,
        played: true,
      });
      return json(r, r.ok ? 200 : 500);
    }

    // Admin: resolve bonus questions (call after tournament)
    if (url.pathname === '/admin/resolve-bonus' && request.method === 'POST') {
      if (!checkAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
      const b = await request.json().catch(() => ({}));
      const r = await sbReq(env, 'POST', 'rpc/wc_resolve_bonus', {
        p_champion:          b.champion          || null,
        p_most_goals_team:   b.most_goals_team   || null,
        p_fewest_goals_team: b.fewest_goals_team || null,
        p_red_cards_bracket: b.red_cards_bracket || null,
        p_topscorer_country: b.topscorer_country || null,
      });
      return json(r, r.ok ? 200 : 500);
    }

    return json({ error: 'not found' }, 404);
  },

  async scheduled(event, env){
    // 1. Match sync (skip if no API key)
    if (env.FOOTBALL_DATA_API_KEY) {
      const r = await syncMatches(env);
      console.log('[CRON] match sync:', JSON.stringify(r));
    } else {
      console.log('[CRON] FOOTBALL_DATA_API_KEY not set — skipping match sync.');
    }

    // 2. Prize pool sync — read on-chain BOBAI balance + price, compute pots, update wc_pool
    try {
      const pool = await syncPool(env);
      console.log('[CRON] pool sync:', JSON.stringify(pool));
    } catch (e) {
      console.log('[CRON] pool sync error:', e.message);
    }

    // 3. Dispatch worldcup-bot workflow (does the actual swap with signing)
    try {
      const dispatched = await dispatchWorldcupBot(env);
      console.log('[CRON] bot dispatch:', dispatched);
    } catch (e) {
      console.log('[CRON] bot dispatch error:', e.message);
    }
  },
};

// ============================================================
// PRIZE POOL SYNC — read on-chain BOBAI balance + compute pot split
// ============================================================
const PRIZE_WALLET = '0x5E4102520A71B2AA18a1208330d4848dea4BD105';
const BOBAI_TOKEN  = '0x245c386dcfed896f5c346107596141e5edcbffff';
const BSC_RPCS = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.binance.org/',
  'https://bsc-dataseed2.binance.org/',
];

// Tournament timing (UTC) — anchors the allocation split.
// Pre-kickoff donations sit in `total_bobai` but aren't allocated to pots yet
// (admin decides at kickoff how to seed initial pots).
const KICKOFF_UTC   = new Date('2026-06-11T19:00:00Z').getTime();
const GROUP_END_UTC = new Date('2026-06-27T00:00:00Z').getTime();   // ~1d after last group match
const FINAL_END_UTC = new Date('2026-07-20T00:00:00Z').getTime();

async function rpcCall(method, params){
  for (const rpc of BSC_RPCS) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!res.ok) continue;
      const j = await res.json();
      if (j.result !== undefined) return j.result;
    } catch (e) { /* try next */ }
  }
  throw new Error('all BSC RPCs failed for ' + method);
}

// Read ERC-20 balance via raw eth_call (no ethers/viem dep in Worker).
async function readBobaiBalance(address){
  // balanceOf(address) selector = 0x70a08231
  const data = '0x70a08231' + address.toLowerCase().replace('0x','').padStart(64, '0');
  const hex  = await rpcCall('eth_call', [{ to: BOBAI_TOKEN, data }, 'latest']);
  // 18-decimal token → divide by 1e18 as bigint→string for precision
  const wei = BigInt(hex);
  const whole = wei / (10n ** 18n);
  const frac  = wei % (10n ** 18n);
  // Return as plain JS number (precision OK for display; if pool ever exceeds 2^53 BOBAI we'd switch to string)
  return Number(whole) + Number(frac) / 1e18;
}

async function fetchBobaiPriceUsd(){
  try {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${BOBAI_TOKEN}`);
    if (!r.ok) return null;
    const d = await r.json();
    const p = parseFloat(d?.data?.attributes?.price_usd);
    return isFinite(p) ? p : null;
  } catch { return null; }
}

function computePots(total, now){
  // Pre-kickoff: pool grows but pots stay 0 (held in reserve, allocated at kickoff)
  if (now < KICKOFF_UTC) return { group: 0, end: 0, crypto: 0, phase: 'pre-kickoff' };
  // Group phase: 45/40/15
  if (now < GROUP_END_UTC) return {
    group:  total * 0.45,
    end:    total * 0.40,
    crypto: total * 0.15,
    phase:  'group',
  };
  // Post-group: group_pot would be frozen-then-paid; for now allocate 0/85/15 of total.
  // (Refined once group-payout logic lands — see PHASE_H_PLAN.md.)
  if (now < FINAL_END_UTC) return {
    group:  0,
    end:    total * 0.85,
    crypto: total * 0.15,
    phase:  'ko',
  };
  // Post-final: freeze whatever's there (payouts handled by payout engine)
  return { group: 0, end: 0, crypto: 0, phase: 'post-final' };
}

async function syncPool(env){
  const total = await readBobaiBalance(PRIZE_WALLET);
  const price = await fetchBobaiPriceUsd();
  const pots  = computePots(total, Date.now());
  const update = {
    total_bobai:     total,
    group_pot:       pots.group,
    endpool:         pots.end,
    crypto_pot:      pots.crypto,
    bobai_price_usd: price,
    updated_at:      new Date().toISOString(),
  };
  await sbReq(env, 'PATCH', 'wc_pool?id=eq.1', update);
  return { total, price, phase: pots.phase, pots };
}

// ============================================================
// WORLDCUP-BOT DISPATCH — kicks the GitHub Actions workflow that signs the swap
// ============================================================
async function dispatchWorldcupBot(env){
  if (!env.GH_TOKEN || !env.GH_REPO) {
    return 'skipped (GH_TOKEN/GH_REPO not configured)';
  }
  const url = `https://api.github.com/repos/${env.GH_REPO}/actions/workflows/worldcup-bot.yml/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'bobai-worldcup-sync',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  return `HTTP ${res.status}`;
}
