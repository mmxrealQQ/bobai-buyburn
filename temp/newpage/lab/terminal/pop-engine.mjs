// BRAIN POP 2.0 ENGINE (2026-11-06, operator: "skill, aim, logic, luck; the seven stations as super weapons once unlocked;
// it must be e-sports world championship worthy — but 60 seconds stay, and in 60 seconds you know what to do").
// ONE FILE FOR BOTH SIDES: the terminal imports it from terminal/pop-engine.js to play, the bobai-pop worker bundles the
// very same file to check (worker-pop/index.js). Same plan, same paths, same hit test, same score — a run is its inputs
// (taps with time AND place, weapons with time), and the server replays them. Pure: no clock, no Math.random, no DOM.
//
// THE GAME, as the start screen says it:
//   TAP the creatures — quick pops in a row raise the multiplier (x1 … x10)
//   NEVER tap a red RUG candle — minus points, the combo is gone
//   A MISS (a tap on nothing) breaks the combo
//   6 IN A ROW WITHOUT A MISS fires the next station's super power BY ITSELF (operator: "the player clicks nothing, it
//   comes by itself, the super boost combo") — burn, hammer, slow motion, double, gold rush, paint, cash — and an
//   explosion's pops count for the streak too, so a clean player sets off chains
// The arena is 1000 x 1000 units, the same on every screen; a creature's hit circle shrinks as the combo grows (aim).
export const V = 2, RUN_MS = 60000, AW = 1000, AH = 1000, COMBO_MS = 2000, MIN_GAP = 40, STREAK = 4, MISS_COST = 300, SLAY_PTS = 1500;
// NO TWO SCORES ALIKE, NO PERFECT GAME (operator, 6.11.: "no equal scores — make them like 563742.4324762, exaggerated —
// and it must always be possible to score higher, nobody can play the perfect game"): every pop is worth more the nearer
// the tap is to the creature's middle (aim) and the sooner after it showed (reaction), both without steps, so a score
// carries seven decimals and the best one can always be beaten. Scores are kept as whole units of 0.0000001 (UNIT), so
// the terminal and the server add exactly the same integers.
export const UNIT = 1e7;
export const fmt = (u) => (u / UNIT).toLocaleString('en-US', { minimumFractionDigits: 7, maximumFractionDigits: 7 });
export const SPRITES = ['octo', 'bulb', 'astro', 'fridge', 'sock', 'shrimp', 'eyeball', 'duck', 'banana', 'pigeon', 'cactus', 'pizza', 'washer', 'dj'];
// the seven stations of the tax split, in the order they fire (every 6th pop of a streak fires the next), what they do
export const WEAPONS = [
  { k: 'burn', name: 'BURN $BOBAI', pic: 'stburn', need: 8, say: 'NEXT TAP EXPLODES' },
  { k: 'hammer', name: 'BURN $BOB', pic: 'stbobs', need: 10, say: 'BIG HAMMER: 6 HUGE TAPS' },
  { k: 'liq', name: 'LIQ BOOST', pic: 'stliq', need: 12, say: 'SLOW MOTION' },
  { k: 'defi', name: 'DEFI AGENT', pic: 'stdefi', need: 14, say: 'HELPER: HARVESTS FOR YOU (3 S)' },
  { k: 'giggle', name: 'GIGGLE POT', pic: 'stgiggle', need: 16, say: 'GOLD RUSH: TRIPLE POINTS' },
  { k: 'creator', name: 'RUG SLAYER', pic: 'stcreator', need: 18, say: 'EVERY RUG BLOWS UP · NEW ONES ARE GOLD (5 S)' },
  { k: 'trades', name: 'TRADES', pic: 'sttrade', need: 22, say: 'CASH BONUS: STREAK x 2,500' },
];
const rng = (seed) => { let h = 1779033703 ^ seed.length; for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  let a = h >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const R = (r, a, b) => Math.round(a + r() * (b - a));
// THE DAY'S PLAN: every creature's sprite, path, size, worth and time — in WORLD time (slow motion stretches it)
// EVERY ROUND IS NEW, EVERY ROUND IS EQUALLY HARD (operator, 6.11.: "every round must have its randomness — the overall wins
// the prize pool — random is fairest; and people play longer"): two dice. The DAY's die (r) sets what makes a round hard —
// when each creature comes, how long it stays, its size and worth, which are rugs and golden, the snails and the kaiju —
// the same for every round that day. The ROUND's die (q, a seed the server draws at the start) sets where each one shows,
// which way it flies, its wobble and its look. So no round looks like another, nothing can be learnt by heart, and luck
// never makes one round easier than another.
export function plan(day, seed = 0) {
  const r = rng('brainpop2:' + day), q = rng('brainpop2:' + day + ':' + (seed >>> 0)), out = [];
  for (let t = 900; t < 57500;) {
    const k = t / 57500, rug = t > 7000 && r() < 0.13, gold = !rug && r() < 1 / 14, pick = r(), n = SPRITES[Math.floor(q() * SPRITES.length)];
    const rad = R(r, 64 - 18 * k, 78 - 14 * k), s = { n: rug ? 'rug' : n, rug, gold, at: Math.round(t), r: rad, pts: rad < 56 ? 8 : 5 };
    if (pick < 0.5) { // a line across, with a wobble; its time across the day's, its way the round's
      const life = R(r, 3600 - 1500 * k, 4600 - 1700 * k), side = Math.floor(q() * 4), a1 = R(q, 120, 880), b1 = R(q, 120, 880);
      const [x0, y0, x1, y1] = side === 0 ? [-80, a1, 1080, b1] : side === 1 ? [1080, a1, -80, b1] : side === 2 ? [a1, -80, b1, 1080] : [a1, 1080, b1, -80];
      Object.assign(s, { p: 'line', x0, y0, x1, y1, w: R(q, 0, 90), f: 1 + Math.round(q() * 2), life });
    } else if (pick < 0.78) { // pops up in place and goes
      Object.assign(s, { p: 'pop', x0: R(q, 110, 890), y0: R(q, 110, 890), life: R(r, 2300 - 900 * k, 2700 - 900 * k) });
    } else { // jumps up from the bottom in an arc
      const x0 = R(q, 100, 900);
      Object.assign(s, { p: 'arc', x0, y0: 1080, x1: Math.min(920, Math.max(80, x0 + R(q, -420, 420))), h: R(q, 600, 940), life: R(r, 2400 - 500 * k, 3200 - 600 * k) });
    }
    out.push(s);
    t += (820 - 500 * k) * (0.7 + 0.6 * r());
  }
  for (const at of [15000, 31000, 48000]) { const y = R(q, 200, 800), ltr = q() < 0.5; out.push({ n: 'snail', rug: false, gold: false, at, r: 52, pts: 25, p: 'line', x0: ltr ? -80 : 1080, y0: y, x1: ltr ? 1080 : -80, y1: y, w: 30, f: 2, life: 2600 }); }
  const kx = R(q, 300, 700); out.push({ n: 'kaiju', rug: false, gold: false, at: 36000, r: 150, pts: 120, hp: 8, p: 'line', x0: kx, y0: 1150, x1: 1000 - kx, y1: -150, w: 260, f: 1, life: 9000 });
  out.sort((x, y) => x.at - y.at);
  return out.map((x, i) => ({ i, ...x }));
}
// where a creature is at world time w (or null when it is not in the arena)
export function pos(s, w) {
  const u = (w - s.at) / s.life; if (u < 0 || u > 1) return null;
  if (s.p === 'pop') return { x: s.x0, y: s.y0, u };
  if (s.p === 'arc') return { x: s.x0 + (s.x1 - s.x0) * u, y: s.y0 - s.h * 4 * u * (1 - u), u };
  const dx = s.x1 - s.x0, dy = s.y1 - s.y0, L = Math.hypot(dx, dy) || 1, wob = s.w * Math.sin(Math.PI * 2 * s.f * u);
  return { x: s.x0 + dx * u - dy / L * wob, y: s.y0 + dy * u + dx / L * wob, u };
}
export const multOf = (combo) => Math.min(10, 1 + Math.floor(combo / 4));
// ONE RUN: feed it taps in time order — tap(t, x, y) — and read its state; the server replays the same
export const turn = (v, x, y) => { let a = x, b = y; if (v & 4) { const c = a; a = b; b = c; } if (v & 1) a = 1000 - a; if (v & 2) b = 1000 - b; return [a, b]; };
export function createRun(P, variant = 0) {
  const vr = (variant | 0) & 7, at = (s, w) => { const q = pos(s, w); if (!q) return null; const [x, y] = turn(vr, q.x, q.y); return { x, y, u: q.u }; };
  const S = { score: 0, combo: 0, maxc: 0, misses: 0, pops: 0, taps: 0, rugs: 0, last: -1e9, prev: -1e9, dead: new Set(), hp: {}, used: [], armed: null,
    hammer: 0, defi: 0, giggle: -1, creator: -1, slow: [], fired: 0, auto: [], superTo: -1, godTo: -1, timeline: [], ev: [], extra: [], charge: [0, 0, 0, 0, 0, 0, 0] };
  const drainAll = (n) => { for (let k = 0; k < 7; k++) S.charge[k] = Math.max(0, S.charge[k] - n); };
  // world time: slow motion runs the world at half speed for 4 s
  const world = (t) => { let lost = 0; for (const [a, b] of S.slow) lost += Math.max(0, Math.min(t, b) - a) / 2; return t - lost; };
  const lostTo = (t) => { let lost = 0; for (const [a, b] of S.slow) lost += Math.max(0, Math.min(t, b) - a) / 2; return lost; };
  const endAt = () => { let t = RUN_MS; for (let k = 0; k < 8; k++) t = RUN_MS + lostTo(t); return Math.round(t); };
  const alive = (t) => { const w = world(t), L = []; for (const s of P) { if (S.dead.has(s.i)) continue; if (s.at > w) break; const q = at(s, w); if (q) L.push([s, q]); }
    for (const s of S.extra) { if (S.dead.has(s.i) || s.at > w) continue; const q = at(s, w); if (q) L.push([s, q]); } return L; };
  const golden = (s, t) => s.gold || (s.rug && t < S.creator) || (t < S.godTo && !s.rug);
  const helpAt = (t) => { S.auto.push(t); S.auto.sort((a, b) => a - b); };
  // byPlayer: only a pop of the player's own tap charges the stations (6.11.: helpers that charged them played on by
  // themselves after the last tap — 3.5 M at the last tap, 10.8 M at the end); helpers and blasts still score and keep the streak
  function popOne(s, t, chain, aim, byPlayer = true) {
    S.dead.add(s.i);
    if (s.rug && !(t < S.creator)) { S.rugs++; S.combo = 0; drainAll(6); S.score = Math.max(0, S.score - 4000 * UNIT); S.ev.push(['rug', s.i, t, -4000 * UNIT]); return; }
    S.combo = t - S.last <= COMBO_MS || chain ? S.combo + 1 : 1; S.last = t; S.maxc = Math.max(S.maxc, S.combo); S.pops++;
    // aim: 0.5 at the ring's edge … 1.5 dead centre; reaction: 2.5 at the first instant … towards 1 the longer it lives
    const rt = Math.max(0, world(t) - s.at), fAim = 0.5 + Math.max(0, Math.min(1, aim)), fRx = 1 + 600 / (rt + 400);
    let pts = (s.rug ? 5 : s.pts) * 100 * multOf(S.combo) * (golden(s, t) ? 5 : 1) * fAim * fRx;
    if (S.defi > 0) { pts *= 2; S.defi--; }
    if (t < S.giggle) pts *= 3;
    if (t < S.superTo) pts *= 2;
    const u = Math.round(pts * UNIT); S.score += u; S.ev.push(['pop', s.i, t, u]);
    if (s.n === 'kaiju') { const w = world(t), q = at(s, w) || { x: 500, y: 500 }; [[-340, -260], [340, -260], [-420, 60], [420, 60], [-200, 340], [200, 340]].forEach(([dx, dy], k) => S.extra.push({ i: 200000 + k, n: 'mini', rug: false, gold: true, at: Math.round(w), r: 56, pts: 10, p: 'line', x0: Math.round(q.x), y0: Math.round(q.y), x1: Math.round(q.x + dx), y1: Math.round(q.y + dy), w: 30, f: 1, life: 2200 })); S.ev.push(['boss', s.i, t, 6, q.x, q.y]); }
    if (s.n === 'octo' && !s.rug) { const w = world(t), q = at(s, w) || { x: 500, y: 500 }; [[-260, -220], [260, -220], [0, 300]].forEach(([dx, dy], k) => S.extra.push({ i: 100000 + s.i * 3 + k, n: 'mini', rug: false, gold: false, at: Math.round(w), r: 50, pts: 4, p: 'line', x0: Math.round(q.x), y0: Math.round(q.y), x1: Math.round(q.x + dx), y1: Math.round(q.y + dy), w: 0, f: 1, life: 1500 })); S.ev.push(['split', s.i, t, 3, q.x, q.y]); }
    if (S.combo === 8) { S.superTo = t + 3000; S.ev.push(['super', -1, t, 8]); }
    else if (S.combo === 16) { for (let k = 1; k <= 4; k++) helpAt(t + k * 150); S.ev.push(['mega', -1, t, 16]); }
    else if (S.combo >= 24 && S.combo % 8 === 0) { S.godTo = t + 5000; S.ev.push(['god', -1, t, S.combo]); }
    // every station's meter fills; a full one fires its power by itself
    if (byPlayer) for (let k = 0; k < WEAPONS.length; k++) { S.charge[k] += golden(s, t) ? 2 : 1; if (S.charge[k] >= WEAPONS[k].need) { S.charge[k] = 0; power(t, k); } }
  }
  function power(t, k) {
    const w = WEAPONS[k].k; S.fired++; S.used.push(k); S.ev.push(['fire', k, t, 0]);
    if (w === 'burn') { // the crowd's middle: the creature with the most others (rugs count against) within the blast
      const L = alive(t); let best = null, bv = 0; for (const [, q] of L) { let v = 0; for (const [y, r] of L) { const d = Math.hypot(r.x - q.x, r.y - q.y); if (d <= 230) v += y.rug ? -2 : 1; } if (v > bv) { bv = v; best = q; } }
      if (best) blast(t, best.x, best.y); else S.armed = 'burn'; } else if (w === 'hammer') S.hammer = 6; else if (w === 'liq') { const used = S.slow.reduce((a, [x, y]) => a + (y - x), 0); if (used < 24000) S.slow.push([t, t + 4000]); }
    else if (w === 'defi') { for (let k = 1; k <= 6; k++) helpAt(t + k * 500); } else if (w === 'giggle') S.giggle = t + 4000; else if (w === 'creator') { S.creator = t + 5000; for (const [x, q] of alive(t)) if (x.rug) { S.dead.add(x.i); const v = SLAY_PTS * UNIT * multOf(S.combo); S.score += v; S.ev.push(['slay', x.i, t, v, q.x, q.y]); } }
    else if (w === 'trades') { const v = S.combo * 2500 * UNIT; S.score += v; S.ev.push(['cash', k, t, v]); }
  }
  // a helper takes the creature that is closest to getting away (the one furthest along its way), never a rug
  function advance(t) {
    while (S.auto.length && S.auto[0] <= Math.min(t, endAt())) {
      const ta = S.auto.shift(), L = alive(ta).filter(([x]) => !x.rug || ta < S.creator);
      if (!L.length) continue;
      let pickq = L[0]; for (const c of L) if (c[1].u > pickq[1].u) pickq = c;
      const [x, q] = pickq; S.ev.push(['auto', x.i, ta, 0, q.x, q.y]);
      if (x.hp) { S.hp[x.i] = (S.hp[x.i] ?? x.hp) - 2; if (S.hp[x.i] > 0) continue; }
      popOne(x, ta, true, 0.6, false); S.timeline.push([ta, S.score]);
    }
  }
  function blast(t, x, y) {
    S.ev.push(['boom', -1, t, 0, x, y]); let n = 0;
    for (const [s, q] of alive(t)) if (Math.hypot(q.x - x, q.y - y) <= 230 + s.r * 0.5) { if (S.dead.has(s.i) || (s.rug && !(t < S.creator))) continue; /* a blast spares the rugs: the helper never costs you */ if (s.hp) { S.hp[s.i] = (S.hp[s.i] ?? s.hp) - 3; if (S.hp[s.i] > 0) continue; } popOne(s, t, n++ > 0, 1 - Math.hypot(q.x - x, q.y - y) / (230 + s.r * 0.5), false); }
    S.timeline.push([t, S.score]);
  }
  function tap(t, x, y) {
    if (!(t >= 0 && t <= endAt()) || t - S.prev < MIN_GAP || !(x >= -100 && x <= 1100 && y >= -100 && y <= 1100)) return false;
    advance(t);
    S.prev = t; S.taps++;
    const L = alive(t);
    if (S.armed === 'burn') { S.armed = null; blast(t, x, y); return true; } // the explosion: everything within 230 pops, rugs too
    const scale = Math.max(0.55, 1 - 0.015 * S.combo) * (S.hammer > 0 ? 3 : 1); if (S.hammer > 0) S.hammer--;
    let best = null, bd = 1e9, br = 1; for (const [s, q] of L) { const d = Math.hypot(q.x - x, q.y - y); if (d <= s.r * scale && d < bd) { bd = d; best = s; br = s.r * scale; } }
    if (!best) { S.misses++; S.combo = 0; drainAll(3); S.score = Math.max(0, S.score - MISS_COST * UNIT); S.ev.push(['miss', -1, t, -MISS_COST * UNIT, x, y]); S.timeline.push([t, S.score]); return true; }
    if (best.hp) { S.hp[best.i] = (S.hp[best.i] ?? best.hp) - 1; if (S.hp[best.i] > 0) { S.ev.push(['hit', best.i, t, 0]); S.last = t; return true; } }
    popOne(best, t, false, 1 - bd / br); S.timeline.push([t, S.score]); return true;
  }
  return { S, world, alive, tap, golden, advance, endAt };
}
// THE SERVER'S CHECK: the taps [t, x, y] in order, replayed; anything out of order or out of the minute is simply not applied
export function replay(day, inputs, seed = 0) {
  if (!Array.isArray(inputs) || inputs.length > 900) return null;
  const run = createRun(plan(day, seed)); let applied = 0;
  for (const v of inputs) { if (!Array.isArray(v)) continue; const t = Math.round(+v[0]);
    if (v.length === 3 && run.tap(t, Math.round(+v[1]), Math.round(+v[2]))) applied++; }
  run.advance(run.endAt()); const S = run.S;
  return { score: S.score, maxc: S.maxc, pops: S.pops, misses: S.misses, rugs: S.rugs, taps: S.taps, weapons: S.used.length, applied, timeline: S.timeline };
}
