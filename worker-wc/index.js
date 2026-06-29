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
  'Cabo Verde': 'CV',
  'Cape Verde Islands': 'CV',
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
    'wc_matches?select=id,phase,group_letter,team_home,team_away,kickoff_utc,goals_home,goals_away,played,match_number&order=kickoff_utc.asc');
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
// Top-scorers sync — feeds the "Golden Boot" bonus question
// ============================================================
async function syncScorers(env){
  if (!env.FOOTBALL_DATA_API_KEY) return { ok: false, skipped: 'no api key' };
  const url = `https://api.football-data.org/v4/competitions/${env.FOOTBALL_DATA_COMPETITION || 'WC'}/scorers?limit=20`;
  let res;
  try {
    res = await fetch(url, {
      headers: { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY, 'Accept': 'application/json' },
    });
  } catch (e) {
    return { ok: false, error: 'fetch failed: ' + e.message };
  }
  if (!res.ok) return { ok: false, error: `football-data.org returned ${res.status}` };
  const json = await res.json();
  const scorers = json.scorers || [];

  // Rank by (goals desc, then player_id asc to keep ties stable across syncs).
  // football-data returns them already sorted but we re-rank defensively.
  const ranked = scorers
    .map(s => ({
      player_name: s.player?.name || 'Unknown',
      country_code: teamToCode(s.team?.name) || null,
      goals: Number(s.numberOfGoals || s.goals || 0),
      assists: s.assists != null ? Number(s.assists) : null,
    }))
    .sort((a, b) => b.goals - a.goals || a.player_name.localeCompare(b.player_name))
    .slice(0, 20);

  // Wipe + re-insert (table is tiny, this is the simplest "current top N" semantics).
  await sbReq(env, 'DELETE', 'wc_scorers?rank=gte.0');
  if (ranked.length) {
    const payload = ranked.map((s, i) => ({ ...s, rank: i + 1, updated_at: new Date().toISOString() }));
    await sbReq(env, 'POST', 'wc_scorers', payload);
  }
  return { ok: true, count: ranked.length };
}

// ============================================================
// Red-cards sync — feeds the "Total red cards" bonus question.
// football-data.org's per-match `bookings[]` only exists on the TIER_ONE
// plan. On the free tier it's omitted entirely → we fall back to whatever
// was last set via /admin/set-red-cards (manual override). Either way the
// public read goes through wc_tournament_stats.
// ============================================================
// Per-match cached red-cards aggregation. Strategy:
//   1. Match the remote /matches list against our wc_matches and find the
//      FINISHED matches that still have red_cards=NULL in our DB.
//   2. Fetch up to RC_BATCH of them via /matches/{id} and write the count.
//      The free tier's per-match endpoint returns bookings — the LIST
//      endpoint strips them. Rate-limit ≈ 10/min, 100/day; 8/cron is safe.
//   3. Recompute red_cards_total = SUM(wc_matches.red_cards).
// This converges to the true total within a few cron cycles even on free
// tier; once a match has a cached count, it never gets fetched again.
const RC_BATCH = 8;
async function syncRedCards(env){
  if (!env.FOOTBALL_DATA_API_KEY) return { ok: false, skipped: 'no api key' };
  const auth = { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY, 'Accept': 'application/json' };
  const comp = env.FOOTBALL_DATA_COMPETITION || 'WC';

  // Pull the list (matches, kickoffs) — we already do this elsewhere but
  // syncRedCards may run standalone too.
  let res;
  try {
    res = await fetch(`https://api.football-data.org/v4/competitions/${comp}/matches`, { headers: auth });
  } catch (e) {
    return { ok: false, error: 'fetch failed: ' + e.message };
  }
  if (!res.ok) return { ok: false, error: `football-data.org returned ${res.status}` };
  const list = await res.json();
  const remoteMatches = list.matches || [];

  // Our local matches with their cached red_cards (NULL = needs fetching).
  const ourRows = await sbReq(env, 'GET', 'wc_matches?select=id,phase,group_letter,team_home,team_away,kickoff_utc,red_cards');
  const ours = Array.isArray(ourRows.body) ? ourRows.body : [];

  // Build a small lookup: only FINISHED remote matches that we haven't
  // counted yet. We need the remote ID for the per-match call AND our
  // local row's ID to write back.
  const todo = [];
  for (const r of remoteMatches) {
    if (r.status !== 'FINISHED') continue;
    const localMatch = findOurMatch(r, ours);
    if (!localMatch) continue;
    if (localMatch.red_cards != null) continue;   // already counted
    todo.push({ remoteId: r.id, localId: localMatch.id });
  }

  // 1st pass: see if list-payload already had bookings (paid tiers); if so,
  // we'd never get into the per-match path. Run both — cheap.
  let sweptInline = 0;
  for (const r of remoteMatches) {
    if (r.status !== 'FINISHED' || !Array.isArray(r.bookings)) continue;
    const localMatch = findOurMatch(r, ours);
    if (!localMatch || localMatch.red_cards != null) continue;
    await updateMatch(env, localMatch.id, { red_cards: countReds(r.bookings) });
    sweptInline++;
  }

  // 2nd pass: per-match fetch (batched).
  let sweptPerMatch = 0, lastErr = null;
  for (const job of todo.slice(0, RC_BATCH)) {
    try {
      const d = await fetch(`https://api.football-data.org/v4/matches/${job.remoteId}`, { headers: auth });
      if (!d.ok) { lastErr = `match ${job.remoteId} HTTP ${d.status}`; continue; }
      const dj = await d.json();
      const m = dj.match || dj;
      const bookings = Array.isArray(m.bookings) ? m.bookings : null;
      if (bookings == null) { lastErr = `match ${job.remoteId} no bookings field`; continue; }
      await updateMatch(env, job.localId, { red_cards: countReds(bookings) });
      sweptPerMatch++;
    } catch (e) {
      lastErr = `match ${job.remoteId}: ${e.message}`;
    }
  }

  // Aggregate from cached per-match counts (NULL = 0). CRITICAL: only
  // overwrite the public total if we actually have something to write —
  // otherwise the free-tier "no bookings field" case would silently clobber
  // any manual /admin/set-red-cards override back to 0 on every cron tick.
  const sumRows = await sbReq(env, 'GET', 'wc_matches?select=red_cards');
  let cachedCount = 0, total = 0;
  for (const row of (Array.isArray(sumRows.body) ? sumRows.body : [])) {
    if (row.red_cards != null) { total += Number(row.red_cards) || 0; cachedCount++; }
  }
  if (cachedCount > 0) {
    await sbReq(env, 'PATCH', 'wc_tournament_stats?id=eq.1', {
      red_cards_total: total,
      updated_at: new Date().toISOString(),
    });
    return { ok: true, total, sweptInline, sweptPerMatch, cachedCount, todoRemaining: Math.max(0, todo.length - sweptPerMatch), lastErr, source: 'auto' };
  }
  // No per-match data at all → keep whatever was last written (typically a
  // manual override). Don't PATCH.
  return { ok: true, total: null, sweptInline, sweptPerMatch, cachedCount: 0, todoRemaining: Math.max(0, todo.length - sweptPerMatch), lastErr, source: 'kept manual (no cached match data yet)' };
}

function countReds(bookings){
  let n = 0;
  for (const b of bookings) {
    const card = (b.card || '').toUpperCase();
    if (card === 'RED' || card === 'RED_CARD' || card === 'SECOND_YELLOW' || card === 'SECOND_YELLOW_CARD') n++;
  }
  return n;
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
// FIFA bracket: stable match number → expected kickoff (UTC) per phase.
// Source: official FIFA 2026 schedule (CEST = UTC+2). The backfill endpoint
// uses (phase, kickoff_utc ±2h) to assign these numbers to our rows.
// ============================================================
const KO_FIFA_KICKOFFS = {
  // R32 — Sechzehntelfinale
  73: { phase: 'r32', kickoff: '2026-06-28T19:00:00.000Z' },
  74: { phase: 'r32', kickoff: '2026-06-29T20:30:00.000Z' },
  75: { phase: 'r32', kickoff: '2026-06-30T00:00:00.000Z' },
  76: { phase: 'r32', kickoff: '2026-06-29T17:00:00.000Z' },
  77: { phase: 'r32', kickoff: '2026-06-30T21:00:00.000Z' },
  78: { phase: 'r32', kickoff: '2026-06-30T17:00:00.000Z' },
  79: { phase: 'r32', kickoff: '2026-07-01T00:00:00.000Z' },
  80: { phase: 'r32', kickoff: '2026-07-01T16:00:00.000Z' },
  81: { phase: 'r32', kickoff: '2026-07-02T00:00:00.000Z' },
  82: { phase: 'r32', kickoff: '2026-07-01T20:00:00.000Z' },
  83: { phase: 'r32', kickoff: '2026-07-02T23:00:00.000Z' },
  84: { phase: 'r32', kickoff: '2026-07-02T19:00:00.000Z' },
  85: { phase: 'r32', kickoff: '2026-07-03T03:00:00.000Z' },
  86: { phase: 'r32', kickoff: '2026-07-03T22:00:00.000Z' },
  87: { phase: 'r32', kickoff: '2026-07-04T01:30:00.000Z' },
  88: { phase: 'r32', kickoff: '2026-07-03T18:00:00.000Z' },
  // R16 — Achtelfinale
  89: { phase: 'r16', kickoff: '2026-07-04T21:00:00.000Z' },
  90: { phase: 'r16', kickoff: '2026-07-04T17:00:00.000Z' },
  91: { phase: 'r16', kickoff: '2026-07-05T20:00:00.000Z' },
  92: { phase: 'r16', kickoff: '2026-07-06T00:00:00.000Z' },
  93: { phase: 'r16', kickoff: '2026-07-06T19:00:00.000Z' },
  94: { phase: 'r16', kickoff: '2026-07-07T00:00:00.000Z' },
  95: { phase: 'r16', kickoff: '2026-07-07T16:00:00.000Z' },
  96: { phase: 'r16', kickoff: '2026-07-07T20:00:00.000Z' },
  // QF — Viertelfinale
  97:  { phase: 'qf', kickoff: '2026-07-09T20:00:00.000Z' },
  98:  { phase: 'qf', kickoff: '2026-07-10T19:00:00.000Z' },
  99:  { phase: 'qf', kickoff: '2026-07-11T21:00:00.000Z' },
  100: { phase: 'qf', kickoff: '2026-07-12T00:00:00.000Z' },
  // SF — Halbfinale
  101: { phase: 'sf', kickoff: '2026-07-14T19:00:00.000Z' },
  102: { phase: 'sf', kickoff: '2026-07-15T19:00:00.000Z' },
  // 3rd place
  103: { phase: '3rd', kickoff: '2026-07-18T19:00:00.000Z' },
  // Final
  104: { phase: 'final', kickoff: '2026-07-19T19:00:00.000Z' },
};

// Bracket sources: next match → { home: {num, side}, away: {num, side} }
//   side: 'W' = winner of source match, 'L' = loser
// Once a source match flips to FINISHED with score.winner from the API, the
// W/L team code propagates into the next-match TBD slot.
const KO_BRACKET = {
  89:  { home: { num: 74, side: 'W' }, away: { num: 77, side: 'W' } },
  90:  { home: { num: 73, side: 'W' }, away: { num: 75, side: 'W' } },
  91:  { home: { num: 76, side: 'W' }, away: { num: 78, side: 'W' } },
  92:  { home: { num: 79, side: 'W' }, away: { num: 80, side: 'W' } },
  93:  { home: { num: 83, side: 'W' }, away: { num: 84, side: 'W' } },
  94:  { home: { num: 81, side: 'W' }, away: { num: 82, side: 'W' } },
  95:  { home: { num: 86, side: 'W' }, away: { num: 88, side: 'W' } },
  96:  { home: { num: 85, side: 'W' }, away: { num: 87, side: 'W' } },
  97:  { home: { num: 89, side: 'W' }, away: { num: 90, side: 'W' } },
  98:  { home: { num: 93, side: 'W' }, away: { num: 94, side: 'W' } },
  99:  { home: { num: 91, side: 'W' }, away: { num: 92, side: 'W' } },
  100: { home: { num: 95, side: 'W' }, away: { num: 96, side: 'W' } },
  101: { home: { num: 97, side: 'W' }, away: { num: 98, side: 'W' } },
  102: { home: { num: 99, side: 'W' }, away: { num: 100, side: 'W' } },
  103: { home: { num: 101, side: 'L' }, away: { num: 102, side: 'L' } },
  104: { home: { num: 101, side: 'W' }, away: { num: 102, side: 'W' } },
};

function getWinnerCode(remoteScore, ourMatch){
  const w = remoteScore?.winner;
  if (w === 'HOME_TEAM') return ourMatch.team_home;
  if (w === 'AWAY_TEAM') return ourMatch.team_away;
  return null;
}
function getLoserCode(remoteScore, ourMatch){
  const w = remoteScore?.winner;
  if (w === 'HOME_TEAM') return ourMatch.team_away;
  if (w === 'AWAY_TEAM') return ourMatch.team_home;
  return null;
}

// Backfill: assign FIFA match numbers to our KO rows by (phase, closest
// kickoff_utc ±2h). Idempotent. Returns counts + any unmatched FIFA slots
// + any rows already carrying a conflicting number.
async function backfillMatchNumbers(env){
  const res = await sbReq(env, 'GET',
    'wc_matches?select=id,phase,kickoff_utc,match_number,team_home,team_away'
    + '&phase=in.(r32,r16,qf,sf,3rd,final)&order=kickoff_utc.asc');
  if (!Array.isArray(res.body)) return { ok: false, error: 'fetch failed', body: res.body };
  const rows = res.body;
  const TOL_MS = 2 * 60 * 60 * 1000;
  const used = new Set();
  const applied = [], unmatched = [], conflicts = [], alreadySet = [];

  for (const [numStr, expect] of Object.entries(KO_FIFA_KICKOFFS)) {
    const fifaNum = Number(numStr);
    const expectedTs = new Date(expect.kickoff).getTime();
    let best = null, bestDiff = Infinity;
    for (const r of rows) {
      if (r.phase !== expect.phase) continue;
      if (used.has(r.id)) continue;
      const diff = Math.abs(new Date(r.kickoff_utc).getTime() - expectedTs);
      if (diff < bestDiff) { best = r; bestDiff = diff; }
    }
    if (!best || bestDiff > TOL_MS) {
      unmatched.push({ fifaNum, phase: expect.phase, expectedKickoff: expect.kickoff });
      continue;
    }
    used.add(best.id);
    if (best.match_number != null && best.match_number !== fifaNum) {
      conflicts.push({ rowId: best.id, currentNumber: best.match_number, wantedNumber: fifaNum });
      continue;
    }
    if (best.match_number === fifaNum) {
      alreadySet.push({ rowId: best.id, fifaNum });
      continue;
    }
    await updateMatch(env, best.id, { match_number: fifaNum });
    applied.push({ rowId: best.id, fifaNum, phase: best.phase, kickoff: best.kickoff_utc });
  }
  return { ok: true, applied: applied.length, alreadySet: alreadySet.length, unmatched, conflicts, details: { applied, alreadySet } };
}

// Propagate winner/loser of a finished KO match into the next-round TBD slot.
// Mutates `ours` in memory so chained finishes within the same cron tick cascade.
async function propagateBracket(env, ours, finishedMatchNumber, winnerCode, loserCode){
  if (!Number.isInteger(finishedMatchNumber)) return 0;
  let propagated = 0;
  for (const [nextNumStr, slots] of Object.entries(KO_BRACKET)) {
    const nextNum = Number(nextNumStr);
    const nextRow = ours.find(m => m.match_number === nextNum);
    if (!nextRow) continue;
    const patch = {};
    for (const side of ['home', 'away']) {
      const src = slots[side];
      if (src.num !== finishedMatchNumber) continue;
      const code = src.side === 'W' ? winnerCode : loserCode;
      if (!code) continue;
      const col = side === 'home' ? 'team_home' : 'team_away';
      if (nextRow[col] === 'TBD' || nextRow[col] == null) patch[col] = code;
    }
    if (Object.keys(patch).length) {
      await updateMatch(env, nextRow.id, patch);
      Object.assign(nextRow, patch);
      propagated++;
      console.log('[BRACKET] propagated:', { from: finishedMatchNumber, to: nextNum, ...patch });
    }
  }
  return propagated;
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
      // Mirror writes into the in-memory row so subsequent propagation reads see them
      Object.assign(m, updates);
    }

    // KO bracket propagation: as soon as we mark a KO match FINISHED, push
    // its winner (and loser, for the 3rd-place) into the next-round TBD slot.
    // This is independent of football-data.org's own next-round population —
    // if their Free Tier is slow, we still advance instantly.
    if (r.status === 'FINISHED' && m.match_number != null && m.phase !== 'group') {
      const winner = getWinnerCode(r.score, m);
      const loser  = getLoserCode(r.score, m);
      if (winner) {
        const n = await propagateBracket(env, ours, m.match_number, winner, loser);
        if (n) console.log('[CRON] bracket advance from', m.match_number, '→', n, 'slot(s)');
      }
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

    // Admin: manual pool sync — reads on-chain balance + live BOBAI price → wc_pool
    if (url.pathname === '/admin/sync-pool') {
      if (!checkAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
      try {
        const r = await syncPool(env);
        return json({ ok: true, ...r });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // Admin: debug — dump what football-data returns for KO stages + how our
    // matcher maps each remote KO match onto a local row. Temporary diagnostic.
    if (url.pathname === '/admin/debug-ko') {
      if (!checkAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
      const remote = await fetchFromFootballData(env);
      if (remote.error) return json(remote, 500);
      const ours = await listOurMatches(env);
      const ko = remote.matches
        .filter(r => ourPhaseFromRemote(r.stage) && ourPhaseFromRemote(r.stage) !== 'group')
        .map(r => {
          const m = findOurMatch(r, ours);
          return {
            stage: r.stage,
            phase: ourPhaseFromRemote(r.stage),
            status: r.status,
            remoteHome: r.homeTeam?.name || null,
            remoteAway: r.awayTeam?.name || null,
            remoteHomeCode: teamToCode(r.homeTeam?.name),
            remoteAwayCode: teamToCode(r.awayTeam?.name),
            utcDate: r.utcDate,
            mappedLocalId: m?.id ?? null,
            mappedLocalKickoff: m?.kickoff_utc ?? null,
            mappedLocalTeams: m ? `${m.team_home}|${m.team_away}` : null,
          };
        })
        .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
      // Detect collisions: two remote KO matches mapped onto the same local row.
      const counts = {};
      ko.forEach(x => { if (x.mappedLocalId != null) counts[x.mappedLocalId] = (counts[x.mappedLocalId] || 0) + 1; });
      const collisions = Object.entries(counts).filter(([, n]) => n > 1).map(([id]) => Number(id));
      const unmapped = ko.filter(x => x.mappedLocalId == null).length;
      return json({ ok: true, koCount: ko.length, unmapped, collisions, ko });
    }

    // Admin: backfill match_number on KO rows by (phase, kickoff_utc ±2h).
    // Idempotent; run once after the SQL migration.
    if (url.pathname === '/admin/backfill-match-numbers') {
      if (!checkAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
      const r = await backfillMatchNumbers(env);
      return json(r, r.ok ? 200 : 500);
    }

    // Admin: dump bracket state. Each KO_BRACKET entry resolved against the
    // current row by match_number, showing where the next-round team will
    // come from (W/L of which source match) and whether it's already filled.
    if (url.pathname === '/admin/debug-bracket') {
      if (!checkAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
      const res = await sbReq(env, 'GET',
        'wc_matches?select=id,match_number,phase,team_home,team_away,kickoff_utc,goals_home,goals_away,played'
        + '&match_number=not.is.null&order=match_number.asc');
      const rows = Array.isArray(res.body) ? res.body : [];
      const byNum = Object.fromEntries(rows.map(x => [x.match_number, x]));
      const bracket = Object.entries(KO_BRACKET).map(([nextNumStr, slots]) => {
        const nextNum = Number(nextNumStr);
        const row = byNum[nextNum];
        return {
          match: nextNum,
          phase: row?.phase ?? null,
          team_home: row?.team_home ?? null,
          team_away: row?.team_away ?? null,
          played: !!row?.played,
          result: row?.played ? `${row.goals_home}-${row.goals_away}` : null,
          from_home: `${slots.home.side}(${slots.home.num})`,
          from_away: `${slots.away.side}(${slots.away.num})`,
        };
      });
      const numbered = rows.length;
      const expected = Object.keys(KO_FIFA_KICKOFFS).length;
      return json({ ok: true, numbered, expected, rows, bracket });
    }

    // Admin: manually set KO teams that FIFA has officially announced but the
    // football-data.org free tier hasn't populated yet (it returns null). Only the
    // provided side(s) are written; the regular sync still fills any remaining TBD.
    // POST /admin/set-teams?token=...  Body: { updates: [{ id, team_home?, team_away? }] }
    if (url.pathname === '/admin/set-teams' && request.method === 'POST') {
      if (!checkAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const updates = Array.isArray(body?.updates) ? body.updates : [];
      if (!updates.length) return json({ error: 'no updates' }, 400);
      const applied = [];
      for (const u of updates) {
        if (u.id == null) continue;
        const patch = {};
        if (typeof u.team_home === 'string' && u.team_home) patch.team_home = u.team_home;
        if (typeof u.team_away === 'string' && u.team_away) patch.team_away = u.team_away;
        if (!Object.keys(patch).length) continue;
        await updateMatch(env, u.id, patch);
        applied.push({ id: u.id, ...patch });
      }
      return json({ ok: true, applied });
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

    // Admin: manual top-scorers sync trigger
    if (url.pathname === '/admin/sync-scorers') {
      if (!checkAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
      const r = await syncScorers(env);
      return json(r, r.ok ? 200 : 500);
    }

    // Admin: manual red-cards sync trigger (also see /admin/set-red-cards for override)
    if (url.pathname === '/admin/sync-red-cards') {
      if (!checkAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
      const r = await syncRedCards(env);
      return json(r, r.ok ? 200 : 500);
    }

    // Admin: manually set the tournament red-card counter (free-tier fallback).
    // POST /admin/set-red-cards?token=...  Body: { total }
    if (url.pathname === '/admin/set-red-cards' && request.method === 'POST') {
      if (!checkAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
      const b = await request.json().catch(() => ({}));
      if (!Number.isInteger(b.total) || b.total < 0) return json({ error: 'expected { total: int >= 0 }' }, 400);
      const r = await sbReq(env, 'PATCH', 'wc_tournament_stats?id=eq.1', {
        red_cards_total: b.total,
        updated_at: new Date().toISOString(),
      });
      return json(r, r.ok ? 200 : 500);
    }

    // Admin: manual BOBAI balance snapshot trigger (drives tie-breaker on leaderboard)
    if (url.pathname === '/admin/snapshot-bobai') {
      if (!checkAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
      try {
        const r = await snapshotBobaiBalances(env);
        return json(r, r.ok ? 200 : 500);
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // Admin: mark the group pot paid. Sets wc_pool.group_paid_at which gates
    // every "paid out" UI state in the worldcup app. Pass paid_at = null to
    // clear (for testing / revert). Defaults to current UTC.
    if (url.pathname === '/admin/mark-group-paid' && request.method === 'POST') {
      if (!checkAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
      const b = await request.json().catch(() => ({}));
      const paidAt = b.paid_at === null ? null : (b.paid_at || new Date().toISOString());
      const r = await sbReq(env, 'PATCH', 'wc_pool?id=eq.1', { group_paid_at: paidAt });
      // Re-sync the pool so the new gate flips group_pot/end/crypto right away
      try { await syncPool(env); } catch (e) { console.log('[mark-group-paid] resync failed:', e.message); }
      return json({ ok: r.ok, group_paid_at: paidAt }, r.ok ? 200 : 500);
    }

    // Admin: insert a payout receipt row. Called by the payout CLI script
    // after each successful on-chain transfer. Idempotent on (pot, group_letter,
    // position, user_id) via a clean DELETE/INSERT pattern is NOT used here —
    // the script must dedup before calling. Returns the inserted row.
    if (url.pathname === '/admin/log-payout' && request.method === 'POST') {
      if (!checkAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
      const b = await request.json().catch(() => ({}));
      const required = ['pot', 'position', 'username', 'wallet', 'bobai_amount'];
      for (const k of required) {
        if (b[k] == null || b[k] === '') return json({ error: `missing field: ${k}` }, 400);
      }
      const row = {
        pot:           b.pot,
        group_letter:  b.group_letter || null,
        position:      b.position,
        user_id:       b.user_id || null,
        username:      b.username,
        country_code:  b.country_code || null,
        wallet:        String(b.wallet).toLowerCase(),
        bobai_amount:  Number(b.bobai_amount),
        usd_at_payout: b.usd_at_payout != null ? Number(b.usd_at_payout) : null,
        tx_hash:       b.tx_hash || null,
        notes:         b.notes || null,
      };
      const r = await sbReq(env, 'POST', 'wc_payouts', row);
      return json({ ok: r.ok, status: r.status, row: r.body }, r.ok ? 200 : 500);
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
    // Daily BOBAI snapshot rides its own cron schedule ("15 6 * * *" UTC) so it
    // doesn't burn subrequest budget on every 10-min match-sync tick. 06:15 UTC
    // sits in the WC26 quiet window (matches run ~16:00–03:00 UTC, NA stadiums),
    // so we always snapshot well clear of any in-progress action. Dispatch by
    // event.cron and return early — the 10-min cron path stays untouched.
    if (event.cron === '15 6 * * *') {
      try {
        const r = await snapshotBobaiBalances(env);
        console.log('[CRON] bobai snapshot:', JSON.stringify(r));
      } catch (e) {
        console.log('[CRON] bobai snapshot error:', e.message);
      }
      return;
    }

    // 1. Match sync (skip if no API key)
    if (env.FOOTBALL_DATA_API_KEY) {
      const r = await syncMatches(env);
      console.log('[CRON] match sync:', JSON.stringify(r));
      try {
        const s = await syncScorers(env);
        console.log('[CRON] scorers sync:', JSON.stringify(s));
      } catch (e) {
        console.log('[CRON] scorers sync error:', e.message);
      }
      try {
        const rc = await syncRedCards(env);
        console.log('[CRON] red cards sync:', JSON.stringify(rc));
      } catch (e) {
        console.log('[CRON] red cards sync error:', e.message);
      }
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
// Group pot freezes the moment the group stage ends and is shown PERMANENTLY
// (the amount that was in the group pot stays visible, even after payout).
// Value = 0.60 × prize-wallet balance at GROUP_END (2026-06-27). Keep this in
// lockstep with worldcup-bot.js.
const GROUP_POT_FROZEN = 3472587.05;

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

// BOBAI/WBNB pool — used for the price feed (same endpoint the TG bot polls)
const BOBAI_PAIR = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6';

// On-chain price fallback constants. BOBAI < WBNB hex → BOBAI is token0 in this pair
// (verified via token0() on-chain 2026-05-21). Reserves come back as (r0, r1, ts).
const CHAINLINK_BNB_USD = '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE'; // BSC mainnet feed, 8 decimals

// Sanity bounds for BOBAI/USD — protects against bad on-chain math or pair manipulation
// posting a wildly wrong price during the rare event both APIs are down.
const PRICE_MIN_USD = 1e-7;
const PRICE_MAX_USD = 1e-2;

function isSanePrice(p){ return isFinite(p) && p >= PRICE_MIN_USD && p <= PRICE_MAX_USD; }

async function fetchBobaiPriceOnchain(){
  try {
    // getReserves() — returns (uint112 r0, uint112 r1, uint32 ts) packed into 96 bytes
    const rHex = await rpcCall('eth_call', [{ to: BOBAI_PAIR, data: '0x0902f1ac' }, 'latest']);
    const rBOBAI = BigInt('0x' + rHex.slice(2,   66)); // token0
    const rWBNB  = BigInt('0x' + rHex.slice(66, 130)); // token1
    if (rBOBAI === 0n || rWBNB === 0n) { console.log('[price] onchain: zero reserves'); return null; }

    // Chainlink latestAnswer() — int256, 8 decimals
    const aHex = await rpcCall('eth_call', [{ to: CHAINLINK_BNB_USD, data: '0x50d25bcd' }, 'latest']);
    const bnbUsd = Number(BigInt(aHex)) / 1e8;
    if (!(bnbUsd > 0)) { console.log('[price] onchain: bad BNB/USD'); return null; }

    // Both BOBAI and WBNB are 18 decimals → ratio cancels out cleanly
    const bobaiPerBnb = Number(rBOBAI) / Number(rWBNB);
    const price = bnbUsd / bobaiPerBnb;
    if (!isSanePrice(price)) { console.log('[price] onchain: sanity check failed:', price); return null; }
    return price;
  } catch (e) {
    console.log('[price] onchain error:', e.message);
    return null;
  }
}

async function fetchBobaiPriceUsd(){
  // 1) GeckoTerminal pool (primary — same as TG bot)
  try {
    const r = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/bsc/pools/${BOBAI_PAIR}?_=${Date.now()}`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (r.ok) {
      const d = await r.json();
      const p = parseFloat(d?.data?.attributes?.base_token_price_usd);
      if (isSanePrice(p)) return p;
      console.log('[price] geckoterminal returned invalid price');
    } else {
      console.log('[price] geckoterminal HTTP', r.status);
    }
  } catch (e) {
    console.log('[price] geckoterminal error:', e.message);
  }

  // 2) DexScreener fallback
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${BOBAI_TOKEN}`);
    if (r.ok) {
      const d = await r.json();
      const pair = (d?.pairs || []).find(p => p.pairAddress?.toLowerCase() === BOBAI_PAIR.toLowerCase())
                || (d?.pairs || [])[0];
      const p = parseFloat(pair?.priceUsd);
      if (isSanePrice(p)) return p;
      console.log('[price] dexscreener returned no usable price');
    } else {
      console.log('[price] dexscreener HTTP', r.status);
    }
  } catch (e) {
    console.log('[price] dexscreener error:', e.message);
  }

  // 3) On-chain (pair reserves × Chainlink BNB/USD) — never down unless RPC dies
  const onchain = await fetchBobaiPriceOnchain();
  if (onchain) { console.log('[price] using on-chain fallback'); return onchain; }

  return null;
}

function computePots(total, now){
  // Pre-kickoff + Group phase: 60/30/10 split (live preview so donors see where it goes)
  if (now < GROUP_END_UTC) return {
    group:  total * 0.60,
    end:    total * 0.30,
    crypto: total * 0.10,
    phase:  now < KICKOFF_UTC ? 'pre-kickoff' : 'group',
  };
  // Group phase over. The split must NOT change on a date — only once the group
  // winners are actually paid out. We detect that from the wallet: until payout
  // the group BOBAI still sits in the prize wallet (balance > frozen group amount),
  // so we keep showing the frozen group pot + the live 30/10 of the rest.
  if (total >= GROUP_POT_FROZEN) return {
    group:  GROUP_POT_FROZEN,   // frozen snapshot — stays visible until payout
    end:    total * 0.30,
    crypto: total * 0.10,
    phase:  'group-frozen',
  };
  // Group winners paid → group BOBAI has left the wallet (balance dropped below the
  // frozen amount). Group pot goes to 0; the remaining wallet allocates 90/10.
  return { group: 0, end: total * 0.90, crypto: total * 0.10, phase: 'ko-paid' };
}

async function syncPool(env){
  const wallet = await readBobaiBalance(PRIZE_WALLET);
  const price  = await fetchBobaiPriceUsd();

  // Once admin marks the group pot paid, override the date/balance-based
  // logic: group stays at the frozen snapshot for display, new wallet
  // balance splits 90/10 between end + crypto. Total_bobai then includes
  // the historical group amount so the "Prize Pool" headline stays stable
  // across the payout (donors see the total they helped grow).
  const current = await sbReq(env, 'GET', 'wc_pool?id=eq.1&select=group_paid_at');
  const groupPaid = Array.isArray(current.body) && current.body[0]?.group_paid_at != null;

  let pots, displayTotal;
  if (groupPaid) {
    // Pre-payout (toggle on but BOBAI hasn't left the wallet yet): subtract
    // the frozen group amount from the wallet so end/crypto don't double-count it.
    // Post-payout (wallet < frozen): wallet already represents only the
    // remaining donations, so use it directly.
    const remaining = wallet >= GROUP_POT_FROZEN ? wallet - GROUP_POT_FROZEN : wallet;
    pots = {
      group:  GROUP_POT_FROZEN,
      end:    remaining * 0.90,
      crypto: remaining * 0.10,
      phase:  'ko-paid',
    };
    // Total stays at "paid + still in pool" — invariant before AND after the
    // actual on-chain transfer, so the headline doesn't jump on payout day.
    displayTotal = GROUP_POT_FROZEN + remaining;
  } else {
    pots = computePots(wallet, Date.now());
    displayTotal = wallet;
  }

  const update = {
    total_bobai:     displayTotal,
    group_pot:       pots.group,
    endpool:         pots.end,
    crypto_pot:      pots.crypto,
    bobai_price_usd: price,
    updated_at:      new Date().toISOString(),
  };
  await sbReq(env, 'PATCH', 'wc_pool?id=eq.1', update);
  return { wallet, displayTotal, price, phase: pots.phase, pots, groupPaid };
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

// ============================================================
// BOBAI BALANCE SNAPSHOT — hourly cron, drives the leaderboard tie-breaker
// ============================================================
// Reads on-chain BOBAI balance for every linked wc_users.wallet and stores
// it in wc_users.bobai_balance + wc_users.bobai_snapshot_at. Consumed by the
// SECURITY DEFINER RPCs `wc_group_leaderboard_ranked` / `wc_overall_leaderboard_ranked`
// to break point-ties (rules.html §7). The column is REVOKEd from anon/authenticated
// so the actual amount is never exposed — only the resulting `rank` + `tied_above`/
// `tied_below` flags reach the UI.
//
// Auto-stop: after FINAL_END_UTC the snapshot becomes a no-op (the final payout
// calculator does its own fresh on-chain read at lock time anyway).

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

// Batched JSON-RPC call (some public BSC RPCs accept arrays; we fall back to
// per-call rpcCall() if a backend returns a non-array response, so this stays
// robust against quirky providers).
async function rpcBatchCall(calls){
  const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params }));
  for (const rpc of BSC_RPCS) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) continue;
      const arr = await res.json();
      if (!Array.isArray(arr) || arr.length !== calls.length) continue;
      const out = new Array(calls.length);
      for (const r of arr) if (r && typeof r.id === 'number' && r.result !== undefined) out[r.id] = r.result;
      // If every slot filled, batch succeeded
      if (out.every(x => x !== undefined)) return out;
    } catch (_) { /* try next rpc */ }
  }
  return null;  // signal "batch unsupported / failed — caller falls back"
}

// Resolve N BOBAI balances. Tries one big batched JSON-RPC; on failure falls
// back to sequential rpcCall (still cheap — only used when batch is unavailable).
async function readBobaiBalancesBatch(addresses){
  if (!addresses.length) return [];
  const calls = addresses.map(a => ({
    method: 'eth_call',
    params: [{
      to:   BOBAI_TOKEN,
      data: '0x70a08231' + a.toLowerCase().replace('0x','').padStart(64, '0'),
    }, 'latest'],
  }));

  const batched = await rpcBatchCall(calls);
  if (batched) {
    return batched.map(hex => {
      const wei = BigInt(hex);
      const whole = wei / (10n ** 18n);
      const frac  = wei % (10n ** 18n);
      return Number(whole) + Number(frac) / 1e18;
    });
  }

  // Sequential fallback — capped because CF Free workers allow ≤50 subrequests
  // per invocation. With ~5 subrequests already burned by the rest of the cron,
  // 40 sequential reads is the safe headroom. Anything beyond that gets picked
  // up on the next hourly tick (snapshot is best-effort, not strict).
  const FALLBACK_MAX = 40;
  const out = [];
  for (let i = 0; i < Math.min(addresses.length, FALLBACK_MAX); i++) {
    try { out.push(await readBobaiBalance(addresses[i])); }
    catch (_) { out.push(null); }
  }
  while (out.length < addresses.length) out.push(null);
  return out;
}

async function snapshotBobaiBalances(env){
  if (Date.now() > FINAL_END_UTC) {
    return { ok: true, skipped: 'post-final' };
  }

  // 1) Fetch all linked wallets
  const r = await sbReq(env, 'GET', 'wc_users?select=id,wallet&wallet=not.is.null&limit=2000');
  if (!Array.isArray(r.body)) return { ok: false, error: 'failed to list wallets', status: r.status };
  const users = r.body.filter(u => u.wallet && WALLET_RE.test(u.wallet));
  if (!users.length) return { ok: true, total: 0, updated: 0 };

  // 2) Batch reads in chunks of 100 (keeps per-batch JSON-RPC payload ~30KB)
  const CHUNK = 100;
  const payload = [];
  for (let i = 0; i < users.length; i += CHUNK) {
    const slice = users.slice(i, i + CHUNK);
    const balances = await readBobaiBalancesBatch(slice.map(u => u.wallet));
    for (let j = 0; j < slice.length; j++) {
      const b = balances[j];
      if (b == null || !isFinite(b)) continue;  // skip failures — next cron retries
      payload.push({ id: slice[j].id, balance: b });
    }
  }

  if (!payload.length) return { ok: false, error: 'no balances read', total: users.length };

  // 3) Bulk update via the SECURITY DEFINER RPC (one Supabase round-trip)
  const upd = await sbReq(env, 'POST', 'rpc/wc_update_bobai_snapshots', { payload });
  if (!upd.ok) return { ok: false, error: 'rpc update failed', status: upd.status, body: upd.body };

  return { ok: true, total: users.length, batched: payload.length, updated: upd.body };
}
