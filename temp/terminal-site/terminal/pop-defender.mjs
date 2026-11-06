// BOBAI DEFENDER — Brain Pop 6.9's game (2026-11-06, operator: "the game must play IN the terminal and be much better,
// not click-click" → chosen: BOBAI Defender, right in the live scene). ONE FILE FOR BOTH SIDES, as before: the terminal
// plays it, the bobai-pop worker bundles it and replays a round from its shots. Pure: no clock, no Math.random, no DOM,
// and NO Math.sin/cos/atan in the simulation — browsers may differ in their last bit there; + - * / and sqrt are exact
// everywhere (IEEE 754), so Chrome, Safari and the server count the very same score.
//
// THE GAME, as the start screen says it:
//   BOBAI stands in the middle of the scene, the seven stations of the tax split around him. Brainrot creatures come
//   from every side to wreck the stations and BOBAI.
//   PULL AND RELEASE (anywhere): a brain flies from BOBAI the other way, harder the further you pull; it bounces off the
//   edges twice — a bank shot counts double. A shot that hits nothing breaks your streak.
//   NEVER shoot a red RUG candle. A creature that reaches a station takes one of its 3 lives; a station at 0 is out, and
//   its super power with it. Every 6 hits in a row a living station fires its super power by itself.
// The field is 1000 x 1000 units laid over the scene, centred on BOBAI — the same on every screen.
export const V = 3, RUN_MS = 60000, TICK = 16, UNIT = 1e7, STREAK = 6;
export const BOBAI = { x: 500, y: 500, r: 70 };
// the stations' battle places in a ring around BOBAI (fixed numbers, no trig at run time), in the order they fire
export const STATIONS = [
  { k: 'burn', name: 'BURN $BOBAI', pic: 'stburn', x: 175, y: 300, say: 'NEXT SHOT EXPLODES' },
  { k: 'hammer', name: 'BURN $BOB', pic: 'stbobs', x: 825, y: 300, say: 'HAMMER: 5 SHOTS GO THROUGH' },
  { k: 'liq', name: 'LIQ BOOST', pic: 'stliq', x: 140, y: 560, say: 'SLOW MOTION' },
  { k: 'defi', name: 'DEFI AGENT', pic: 'stdefi', x: 860, y: 560, say: 'STATIONS HEALED, 8 HITS DOUBLE' },
  { k: 'giggle', name: 'GIGGLE POT', pic: 'stgiggle', x: 250, y: 800, say: 'GOLD RUSH: TRIPLE POINTS' },
  { k: 'creator', name: 'CREATOR', pic: 'stcreator', x: 750, y: 800, say: 'RUGS PAINTED GOLD: SHOOT THEM' },
  { k: 'trades', name: 'TRADES', pic: 'sttrade', x: 500, y: 890, say: 'CASH BONUS: STREAK x 2,500' },
];
export const ST_R = 46, ST_HP = 3, SHOT_R = 11, MISS_COST = 1500, KEEP_PTS = 5000, MAX_SHOTS = 3, COOLDOWN = 350, BOUNCES = 2, SHOT_LIFE = 2400;
export const SPRITES = ['octo', 'bulb', 'astro', 'fridge', 'sock', 'shrimp', 'eyeball', 'duck', 'banana', 'pigeon', 'cactus', 'pizza', 'washer', 'dj'];
export const fmt = (u) => (u / UNIT).toLocaleString('en-US', { minimumFractionDigits: 7, maximumFractionDigits: 7 });
export const multOf = (combo) => Math.min(10, 1 + Math.floor(combo / 4));
const rng = (seed) => { let h = 1779033703 ^ seed.length; for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  let a = h >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const R = (r, a, b) => Math.round(a + r() * (b - a));
// THE PLAN: the DAY's die sets what makes a round hard (when, which kind, how fast, how tough, how many rugs and golden
// ones) — the same for every round that day; the ROUND's die (a seed the server draws at the start) sets where each one
// comes from, which station it goes for, its zigzag and its look. Every round new, every round equally hard.
export function plan(day, seed = 0) {
  const r = rng('defender:' + day), q = rng('defender:' + day + ':' + (seed >>> 0)), out = [];
  for (let t = 1500; t < 56000;) {
    const k = t / 56000, roll = r(), rug = t > 8000 && roll < 0.12, gold = !rug && roll > 0.93, fast = !rug && !gold && t > 10000 && r() < 0.18;
    const e = { n: rug ? 'rug' : SPRITES[Math.floor(q() * SPRITES.length)], rug, gold, at: Math.round(t), sp: R(r, 55 + 60 * k, 80 + 75 * k) * (fast ? 1.8 : 1), hp: 1, r: fast ? 30 : R(r, 34, 44), pts: fast ? 9 : 5 };
    // where it comes from: a point on the edge (the round's), what it goes for (a station or BOBAI; a rug crosses to the other side)
    const side = Math.floor(q() * 4), a1 = R(q, 60, 940); [e.x0, e.y0] = side === 0 ? [a1, -40] : side === 1 ? [1040, a1] : side === 2 ? [a1, 1040] : [-40, a1];
    e.goal = rug ? -1 : Math.floor(q() * 8); // 0..6 a station, 7 BOBAI
    // a rug never crosses the middle (6.11.: every shot starts at BOBAI, rugs through the centre were bad luck, not logic):
    // it walks along one outer band, edge to edge — shooting at what is behind it is the mistake to avoid
    if (rug) { const band = R(q, 50, 190), far = q() < 0.5; if (side === 0 || side === 2) { e.x0 = side === 0 ? -40 : 1040; e.y0 = far ? 1000 - band : band; e.tx = 1040 - e.x0 + 0; e.ty = e.y0; e.tx = side === 0 ? 1040 : -40; } else { e.y0 = side === 1 ? -40 : 1040; e.x0 = far ? 1000 - band : band; e.ty = side === 1 ? 1040 : -40; e.tx = e.x0; } e.zig = Math.min(e.zig, 25); }
    e.zig = R(q, 0, 70); e.per = R(q, 140, 260);
    out.push(e);
    t += (1150 - 700 * k) * (0.7 + 0.6 * r());
  }
  for (const at of [16000, 32000, 47000]) { const side = Math.floor(q() * 4), a1 = R(q, 100, 900); const [x0, y0] = side === 0 ? [a1, -40] : side === 1 ? [1040, a1] : side === 2 ? [a1, 1040] : [-40, a1]; out.push({ n: 'snail', rug: false, gold: true, at, sp: 230, hp: 1, r: 34, pts: 25, x0, y0, goal: 7, zig: 40, per: 120 }); }
  { const side = Math.floor(q() * 2); out.push({ n: 'kaiju', rug: false, gold: false, at: 38000, sp: 34, hp: 12, r: 95, pts: 150, x0: side ? 1080 : -80, y0: R(q, 300, 700), goal: 7, zig: 0, per: 200 }); }
  out.sort((a, b) => a.at - b.at);
  return out.map((e, i) => ({ i, ...e }));
}
const tri = (v) => { const f = v - Math.floor(v); return f < 0.5 ? 4 * f - 1 : 3 - 4 * f; }; // a zigzag in -1 … 1, no trig
// ONE ROUND: step(t) to time t (ms, multiples of TICK), shoot(t, dx, dy) at a tick, read S
export function createRun(P) {
  const S = { t: 0, score: 0, combo: 0, maxc: 0, hits: 0, shots: 0, misses: 0, rugs: 0, lost: 0, fired: 0, used: [], armed: null, pierce: 0, defi: 0, giggle: -1, creator: -1, slowTo: -1,
    st: STATIONS.map((s) => ({ ...s, hp: ST_HP })), foes: [], balls: [], next: 0, lastShot: -1e9, ev: [], timeline: [], done: false };
  const goalOf = (e) => { if (e.rug) return { x: e.tx, y: e.ty, r: 10 }; if (e.goal === 7) return BOBAI; const s = S.st[e.goal]; return s.hp > 0 ? s : BOBAI; };
  const golden = (e, t) => e.gold || (e.rug && t < S.creator);
  function addPts(u, t) { S.score = Math.max(0, S.score + u); S.timeline.push([t, S.score]); }
  function power(t) {
    for (let n = 0; n < 7; n++) { const k = (S.fired + n) % 7; if (S.st[k].hp > 0) { S.fired += n + 1; S.used.push(k); S.ev.push(['fire', k, t]); const w = STATIONS[k].k;
      if (w === 'burn') S.armed = 'burn'; else if (w === 'hammer') S.pierce = 5; else if (w === 'liq') S.slowTo = t + 4000;
      else if (w === 'defi') { S.defi = 8; for (const s of S.st) if (s.hp > 0 && s.hp < ST_HP) s.hp++; } else if (w === 'giggle') S.giggle = t + 4000; else if (w === 'creator') S.creator = t + 5000;
      else if (w === 'trades') { const v = S.combo * 2500 * UNIT; addPts(v, t); S.ev.push(['cash', k, t, v]); } return; } }
  }
  function pop(e, b, t) {
    e.dead = true;
    if (e.rug && !(t < S.creator)) { S.rugs++; S.combo = 0; addPts(-2500 * UNIT, t); S.ev.push(['rug', e.i, t, -2500 * UNIT, e.x, e.y]); return; }
    S.combo++; S.maxc = Math.max(S.maxc, S.combo); S.hits++; if (b) b.hit = true;
    // long shots, bank shots and quick kills pay more — all without steps, so no two scores are alike and none is perfect
    const far = b ? Math.min(1.8, 0.7 + b.dist / 900) : 1, bank = b ? 1 + 0.5 * b.bounce : 1, fresh = 1 + 400 / (t - e.at + 400);
    let pts = (e.rug ? 5 : e.pts) * 100 * multOf(S.combo) * (golden(e, t) ? 5 : 1) * far * bank * fresh;
    if (S.defi > 0) { pts *= 2; S.defi--; } if (t < S.giggle) pts *= 3;
    const u = Math.round(pts * UNIT); addPts(u, t); S.ev.push(['pop', e.i, t, u, e.x, e.y, b ? b.bounce : 0]);
    if (S.combo % STREAK === 0) power(t);
  }
  // a shot: from BOBAI, the way (dx, dy) points, as hard as its length (up to 300 units of pull)
  function shoot(t, dx, dy) {
    if (S.done || t < S.t || t > RUN_MS || t - S.lastShot < COOLDOWN || S.balls.length >= MAX_SHOTS) return false;
    const L = Math.sqrt(dx * dx + dy * dy); if (!(L >= 20)) return false;
    const pw = Math.min(L, 300) / 300, sp = 520 + 980 * pw;
    S.lastShot = t; S.shots++;
    S.balls.push({ x: BOBAI.x, y: BOBAI.y, vx: dx / L * sp, vy: dy / L * sp, born: t, bounce: 0, dist: 0, hit: false, big: S.pierce > 0, burn: S.armed === 'burn', pierce: S.pierce > 0 ? 99 : 0 });
    if (S.pierce > 0) S.pierce--; if (S.armed === 'burn') S.armed = null;
    S.ev.push(['shot', S.balls.length - 1, t]); return true;
  }
  function tick() {
    const t = S.t + TICK, dt = TICK / 1000, slow = t < S.slowTo ? 0.4 : 1;
    while (S.next < P.length && P[S.next].at <= t) { const e = P[S.next++]; S.foes.push({ ...e, x: e.x0, y: e.y0, bx: e.x0, by: e.y0, went: 0, dead: false }); }
    for (const e of S.foes) {
      if (e.dead) continue;
      const g = e.rug ? { x: e.tx, y: e.ty, r: 10 } : goalOf(e), dx = g.x - e.bx, dy = g.y - e.by, L = Math.sqrt(dx * dx + dy * dy) || 1, step = e.sp * dt * slow;
      e.bx += dx / L * step; e.by += dy / L * step; e.went += step;
      const z = e.zig * tri(e.went / e.per); e.x = e.bx - dy / L * z; e.y = e.by + dx / L * z;
      if (Math.sqrt((g.x - e.bx) * (g.x - e.bx) + (g.y - e.by) * (g.y - e.by)) <= (g.r || 0) + e.r * 0.6) {
        e.dead = true; if (e.rug) continue;
        if (g === BOBAI) { S.combo = 0; addPts(-2000 * UNIT, t); S.ev.push(['bobai', e.i, t, -2000 * UNIT]); }
        else { g.hp--; S.ev.push(['station', STATIONS.indexOf(STATIONS.find((s) => s.k === g.k)), t, g.hp]); if (g.hp === 0) { S.lost++; S.ev.push(['down', STATIONS.findIndex((s) => s.k === g.k), t]); } }
      }
    }
    for (const b of S.balls) {
      if (b.gone) continue;
      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt; b.dist += Math.sqrt((nx - b.x) * (nx - b.x) + (ny - b.y) * (ny - b.y)); b.x = nx; b.y = ny;
      if (b.x < 0 || b.x > 1000) { if (b.bounce >= BOUNCES) { b.gone = true; } else { b.vx = -b.vx; b.x = b.x < 0 ? -b.x : 2000 - b.x; b.bounce++; } }
      if (b.y < 0 || b.y > 1000) { if (b.bounce >= BOUNCES) { b.gone = true; } else { b.vy = -b.vy; b.y = b.y < 0 ? -b.y : 2000 - b.y; b.bounce++; } }
      if (t - b.born > SHOT_LIFE) b.gone = true;
      if (b.gone) { if (!b.hit) { S.misses++; S.combo = 0; addPts(-MISS_COST * UNIT, t); S.ev.push(['miss', -1, t, -MISS_COST * UNIT, b.x, b.y]); } /* spraying never pays */ continue; }
      const br = b.big ? 40 : SHOT_R;
      for (const e of S.foes) {
        if (e.dead || b.gone) continue;
        if (Math.sqrt((e.x - b.x) * (e.x - b.x) + (e.y - b.y) * (e.y - b.y)) > e.r + br) continue;
        if (b.burn) { // the explosion: everything within 200 pops (rugs too — think before it lands)
          b.burn = false; b.hit = true; S.ev.push(['boom', -1, t, 0, b.x, b.y]);
          for (const f of S.foes) if (!f.dead && Math.sqrt((f.x - b.x) * (f.x - b.x) + (f.y - b.y) * (f.y - b.y)) <= 200 + f.r) { if (f.hp > 1) { f.hp -= 3; if (f.hp > 0) continue; } pop(f, b, t); }
          b.gone = true; break;
        }
        if (e.hp > 1 && !(e.rug)) { e.hp--; b.hit = true; S.ev.push(['hit', e.i, t, e.hp]); if (!b.pierce) { b.gone = true; } continue; }
        pop(e, b, t); if (!b.pierce) b.gone = true;
      }
    }
    S.balls = S.balls.filter((b) => !b.gone); S.foes = S.foes.filter((e) => !e.dead || false);
    S.t = t;
    if (t >= RUN_MS && !S.done) { // the end: every life a station kept is worth something
      S.done = true; let keep = 0; for (const s of S.st) keep += s.hp; const v = Math.round(keep * KEEP_PTS * UNIT * (1 + S.maxc / 100)); addPts(v, t); S.ev.push(['end', -1, t, v]);
    }
  }
  const stepTo = (t) => { while (S.t + TICK <= Math.min(t, RUN_MS)) tick(); };
  return { S, stepTo, shoot, golden, goalOf };
}
// the aiming help: where a shot would fly (with its bank shots), for the dotted line while pulling
export function preview(dx, dy, steps = 60) {
  const L = Math.sqrt(dx * dx + dy * dy); if (!(L >= 20)) return [];
  const pw = Math.min(L, 300) / 300, sp = 520 + 980 * pw, dt = TICK / 1000; let x = BOBAI.x, y = BOBAI.y, vx = dx / L * sp, vy = dy / L * sp, bounce = 0; const out = [];
  for (let i = 0; i < steps * 3; i++) { x += vx * dt; y += vy * dt;
    if (x < 0 || x > 1000) { if (bounce >= BOUNCES) break; vx = -vx; x = x < 0 ? -x : 2000 - x; bounce++; }
    if (y < 0 || y > 1000) { if (bounce >= BOUNCES) break; vy = -vy; y = y < 0 ? -y : 2000 - y; bounce++; }
    if (i % 3 === 0) out.push([Math.round(x), Math.round(y)]); }
  return out;
}
// THE SERVER'S CHECK: the shots [t, dx, dy] in order, replayed tick by tick; a shot the rules do not allow is not applied
export function replay(day, inputs, seed = 0) {
  if (!Array.isArray(inputs) || inputs.length > 400) return null;
  const run = createRun(plan(day, seed)); let applied = 0;
  for (const v of inputs) { if (!Array.isArray(v) || v.length !== 3) continue; const t = Math.round(+v[0] / TICK) * TICK; run.stepTo(t); if (run.shoot(t, Math.round(+v[1]), Math.round(+v[2]))) applied++; }
  run.stepTo(RUN_MS);
  const S = run.S;
  return { score: S.score, maxc: S.maxc, pops: S.hits, misses: S.misses, rugs: S.rugs, taps: S.shots, lost: S.lost, weapons: S.used.length, applied, timeline: S.timeline };
}
