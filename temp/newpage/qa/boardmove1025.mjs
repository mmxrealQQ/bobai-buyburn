// (boardmove1025, 2026-10-25, operator: "2-3 Veo-Clips für das Brain Board als Animation im Terminal, etwas Cooleres
// als BOBAI auf dem Handy") a Brain Board moment plays its own take: a bug, a fix or a thread marked resolved -> the
// ladybug that turns into a butterfly (hub-board-bug); only answers -> the paper plane (hub-board-plane); a new
// question, tip or note -> the detective (hub-board-detective). Reads the SERVED terminal.js and anim/clips.json of a
// base, evaluates the real choice line on sample visits, and checks the three takes ship and are known as moves.
// usage: node boardmove1025.mjs [base]   exit code 1 on any FAIL
const base = (process.argv[2] || 'https://golive.bobai-dashboard.pages.dev/').replace(/\/?$/, '/');
let pass = 0, fail = 0;
const is = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + info}`); };
const get = (p) => fetch(base + p + (p.includes('?') ? '&' : '?') + 'r=' + Date.now()).then((r) => (r.ok ? r.text() : ''));
const html = await get('');
const src = html.match(/terminal\/terminal\.js\?v=[0-9a-z]+/)?.[0] || 'terminal/terminal.js';
const js = await get(src);
const clips = JSON.parse((await get('terminal/anim/clips.json')) || '[]');
is('B0 the served terminal.js was read', js.length > 100000, `${src} ${js.length}`);
const line = js.match(/const bm = (c\.items[^;]+);/);
is('B1 the board scene chooses its move (const bm = …) and plays it', !!line && /boardScene\(x\.t, ECO_C, bm, 'ON THE BRAIN BOARD'/.test(js), line ? 'not passed to boardScene' : 'no choice line');
if (line) {
  const pick = new Function('c', 'return ' + line[1]);
  const v = (items) => pick({ items });
  const cases = [
    ['a new bug report', [{ type: 'bug', reply: false }], 'board-bug'],
    ['a new fix', [{ type: 'fix', reply: false }], 'board-bug'],
    ['an answer that marks its thread resolved', [{ type: 'question', reply: true, status: 'resolved' }], 'board-bug'],
    ['an answer in a bug thread (type inherited)', [{ type: 'bug', reply: true }], 'board-plane'],
    ['two answers', [{ type: 'tip', reply: true }, { type: 'question', reply: true }], 'board-plane'],
    ['a new question', [{ type: 'question', reply: false }], 'board-detective'],
    ['a new tip and an answer', [{ type: 'tip', reply: false }, { type: 'tip', reply: true }], 'board-detective'],
  ];
  for (const [what, items, want] of cases) { const got = v(items); is(`B2 ${what} -> ${want}`, got === want, got); }
}
for (const m of ['board-bug', 'board-plane', 'board-detective']) {
  is(`B3 hub-${m} ships in clips.json`, clips.includes('hub-' + m), clips.filter((c) => /board/.test(c)).join(' ') || 'none');
  is(`B4 ${m} is a known move (move list) with a stand-in until released`, new RegExp(`'${m}'`).test(js.match(/const moves = \[[^\]]+\]/)?.[0] || '') && new RegExp(`'${m}': '\\w+'`).test(js), 'missing');
}
console.log(`\n${pass} PASS, ${fail} FAIL  (${base})`);
process.exit(fail ? 1 : 0);
