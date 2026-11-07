// BRAIN POP DAILY (2026-11-06, operator: "make the game really viral — a real highscore and real gameplay"; "do 1 and 2").
// The pure part: the day's plan, the names, and the check of a finished run. No I/O here, so node can test it
// (worker-pop/test.mjs) and the worker and the test run the very same code.
//
// THE PLAN IS THE SERVER'S. Every visitor plays the same 60 seconds a day: which creature comes when, how it moves, how
// long it can be hit, which one is golden. The terminal fetches the plan and plays it as it is; it never makes its own.
// THE SCORE IS THE SERVER'S TOO. The browser sends only "creature i, hit at t ms"; the score is counted here again with the
// terminal's own rules (most 5, the rocket snail 10, the kaiju 50 after six hits, golden x5, a pop within 2.2 s of the one
// before raises the combo up to x10). A pop outside its creature's time in sight, twice the same, faster than a hand, or a
// run sent before its minute was over, does not count. Where on the screen a creature was the server cannot know, so a
// perfect bot could still reach the day's maximum — it cannot go past it, and an equal score ranks by who sent it first.

export const RUN_MS = 60000;
export const FIRST_DAY = '2026-11-06';
// the season (operator, 6.11.): a board for every day until 30 Nov (the brainrot look ends 1 Dec); the overall winner of
// the season gets ONE $BOBAI, every daily winner gets NOTHING (the operator's joke, said so on the page)
export const LAST_DAY = '2026-11-30';
export const seasonOver = today => today > LAST_DAY;
// the creatures and their moves, as the terminal's CREW (snail and kaiju come at fixed beats, not from this list)
export const CREW = { octo: ['fly', 'pop', 'spin', 'float'], bulb: ['run'], astro: ['float', 'spin'], fridge: ['run', 'pop', 'rise'], sock: ['rise', 'pop'],
  shrimp: ['run', 'pop', 'spin'], eyeball: ['run', 'pop'], duck: ['fly', 'zoom'], banana: ['pop', 'rise', 'zoom'], pigeon: ['fly'], cactus: ['run', 'pop', 'rise'],
  pizza: ['run', 'spin', 'zoom'], washer: ['run', 'pop', 'spin'], dj: ['pop', 'rise', 'run'] };
// how long each move keeps a creature in reach (ms); the terminal sets the same duration on its animation
export const LIFE = { run: 4600, fly: 5600, float: 6500, spin: 3200, pop: 2900, rise: 4000, zoom: 1500, snail: 2800, kaiju: 9000 };
export const PTS = { snail: 10, kaiju: 50 }, BASE = 5, GOLD = 5, COMBO_MS = 2200, COMBO_MAX = 10, KAIJU_HP = 6;
// names without free text: nobody can write anything on the board, they pick from these
export const ADJ = ['TURBO', 'GALAXY', 'MEGA', 'ULTRA', 'SPICY', 'COSMIC', 'NEON', 'ATOMIC', 'SNEAKY', 'HYPER', 'FUNKY', 'LASER', 'DISCO', 'ROCKET', 'GOLDEN', 'CHAOS'];
// 7.11. (operator: "take the Italian style out"): English degen words, same places (a stored [a, b, n] keeps working)
export const NOUN = ['LUMACONE', 'CERVELLINO', 'DEGEN', 'BANANINO', 'WHALE', 'PICCIONE', 'JEET', 'PIZZETTA', 'RUGPULLER', 'OCCHIONE', 'BAGHOLDER', 'NEURONAUTA', 'GIGACHAD', 'TARTARUGA', 'MOONBOY', 'SPAGHETTOPO'];
// AN OWN NAME TOO, BRAINROTTED (operator, 6.11.: "can't one type one's own name?" — "and when it is saved, brainrot it:
// the same name made into a pet name that is a brainfuck, like mmx_QQ and something funny with mmx_QQ"): letters, digits
// and _ (3 to 16, as typed), so no link can ever stand on the board (no dot, no slash, no space); a short block list for
// insults and for names that pose as us; the name goes into one of these, picked by the player (v); the operator can
// still hide one (POST /api/pop/hide with the admin key)
// 7.11. (operator: "the name has to MELT into one name like the first ones, rather fewer but really funny"): the first 14 are
// the 6.11. forms on their old places; the rest melt the name into a crypto degen word (some NSFW), Italian brainrot style.
// A player keeps an index (v): a list that got shorter wraps around (nameOf, myName), so no stored name ever breaks.
export const ROT = ['Il Grande {N}one', '{N}ini Cervellini', 'Barone {N}elli', '{N}ino Lobotomino', 'Signor {N}etti Spaghetti', 'Capitano {N} Neuronauta', '{N}accio Discotecaccio',
  'Don {N}otto Pizzotto', 'Mega {N}ella Mozzarella', '{N}one Gigacervellone', 'Papa {N}uccio Bombardiro', 'Dottor {N} Senza Neuroni', '{N}ito Turbolito', 'La Leggenda {N}ina',
  '{N}ino Rugpullino', '{N}one Bagholderone', '{N}accio Pumpaccio Dumpaccio', '{N}etto Shitcoinetto', '{N}ella Lamborghinella',
  '{N}otto Liquidotto', '{N}uccio Degenuccio', '{N}ito Jeetito', '{N}one Moonboyone', '{N}ino Gasolino', '{N}ini Copiumini',
  '{N}ella Hopiumella', '{N}otto Mangiawickotto', 'Ser {N}ini Leveraggini', '{N}ona Gyattona', '{N}ino Rizzino',
  '{N}ella Tettarella', '{N}one Culone', '{N}ino Pisellino', '{N}accio Sculacciaccio', '{N}etto Mutandetto',
  '{N}ona Bunga Bungona', '{N}one Sugar Paparone', '{N}ino Orgasmino Verde', '{N}ella MILFarella', 'Nonna {N}ina Perizomina'];
// (6.11. evening, operator: "every name is allowed, it is brainrot; otherwise I delete them by hand") — the block list is gone;
// only the shape stays: letters, digits, _ (no link, no space, no HTML); the operator hides one with POST /api/pop/hide
export const ROT_MAX = 86; // the longest the list ever was live (7.11.): a form beyond it never existed
export const ownName = v => { if (typeof v !== 'string') return null; const s = v.normalize('NFKC').trim();
  return /^[A-Za-z0-9_]{3,16}$/.test(s) && /[A-Za-z]/.test(s) ? s : null; };
export const nameOf = v => {
  if (v && typeof v === 'object' && !Array.isArray(v)) { const base = ownName(v.own), k = Number(v.v); if (!base || !Number.isInteger(k) || k < 0 || k >= ROT_MAX) return null; return ROT[k % ROT.length].replace('{N}', base); }
  if (!Array.isArray(v) || v.length !== 3) return null; const [a, b, n] = v.map(Number);
  if (![a, b, n].every(Number.isInteger) || a < 0 || a >= ADJ.length || b < 0 || b >= NOUN.length || n < 1 || n > 99) return null; return ADJ[a] + ' ' + NOUN[b] + ' ' + n; };

export const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
export const dayNo = day => Math.round((Date.parse(day + 'T00:00:00Z') - Date.parse(FIRST_DAY + 'T00:00:00Z')) / 86400e3) + 1;
export const validDay = (day, today) => /^\d{4}-\d{2}-\d{2}$/.test(day || '') && day >= FIRST_DAY && day <= today && day <= LAST_DAY && dayOf(Date.parse(day + 'T00:00:00Z')) === day;

function rng(seedText) {
  let h = 1779033703 ^ seedText.length; for (let i = 0; i < seedText.length; i++) { h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  let a = h >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// the day's 60 seconds: closer and closer beats, the rocket snail three times, the kaiju once (six hits)
export function plan(day) {
  const r = rng('brainpop:' + day), names = Object.keys(CREW), out = [];
  for (let t = 1200; t < 57000;) {
    const n = names[Math.floor(r() * names.length)], ms = CREW[n], m = ms[Math.floor(r() * ms.length)], gold = m !== 'zoom' && r() < 1 / 12;
    out.push({ n, m, at: Math.round(t), life: LIFE[m], gold });
    t += (1150 - 760 * (t / 57000)) * (0.7 + 0.6 * r());
  }
  for (const at of [14000, 33000, 50500]) out.push({ n: 'snail', m: 'run', at, life: LIFE.snail, gold: false });
  out.push({ n: 'kaiju', m: 'kaiju', at: 38000, life: LIFE.kaiju, gold: false });
  out.sort((x, y) => x.at - y.at);
  return out.map((s, i) => ({ i, ...s, life: Math.min(s.life, RUN_MS - s.at) }));
}
const ptsOf = s => (PTS[s.n] || BASE) * (s.gold ? GOLD : 1);
// the check of a finished run. pops: [[i, t], ...] in the order they happened; hits: the kaiju's hits before its pop
export function check(day, pops, hits = []) {
  const P = plan(day), seen = new Set(), tl = [];
  if (!Array.isArray(pops) || pops.length > P.length || !Array.isArray(hits) || hits.length > 40) return { ok: false, why: 'bad shape' };
  const inside = (s, t) => Number.isInteger(t) && t >= s.at - 150 && t <= s.at + s.life + 400 && t <= RUN_MS + 400;
  let score = 0, combo = 0, last = -1e9, maxc = 0, prev = -1, dropped = 0; const drops = [], drop = (p, why) => { dropped++; if (drops.length < 10) drops.push([p, why]); };
  for (const p of pops) {
    // a pop that breaks a rule does not count (and does not feed the combo); the run itself stays (6.11.: one late
    // creature on a busy device threw a whole honest minute away)
    if (!Array.isArray(p) || p.length !== 2) { drop(p, "bad pop"); continue; }
    const [i, t] = p, s = P[i];
    if (!s || seen.has(i)) { drop(p, "unknown or twice"); continue; }
    if (!inside(s, t)) { drop(p, "outside its time"); continue; }
    if (t < prev || t - prev < 30) { drop(p, "order or faster than a hand"); continue; }
    if (s.n === 'kaiju') { const h = hits.filter(x => Array.isArray(x) && x[0] === i && inside(s, x[1]) && x[1] <= t).map(x => x[1]).sort((a, b) => a - b);
      let ok = h.length >= KAIJU_HP - 1; for (let k = 1; k < h.length; k++) if (h[k] - h[k - 1] < 60) ok = false; if (h.length && t - h[h.length - 1] < 60) ok = false;
      if (!ok) { drop(p, "kaiju without six hits"); continue; } }
    seen.add(i); prev = t;
    combo = t - last < COMBO_MS ? combo + 1 : 1; last = t; maxc = Math.max(maxc, Math.min(combo, COMBO_MAX));
    score += ptsOf(s) * Math.min(combo, COMBO_MAX); tl.push([t, score]);
  }
  return { ok: true, score, maxc, n: tl.length, dropped, drops, timeline: tl };
}
