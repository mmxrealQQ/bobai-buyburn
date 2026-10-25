// (mood1025, 2026-10-25, operator: "jetzt sagt BOBAI immer, dass seine Lieblingsfarbe grün ist; gestern war's 'wen moon,
// asking for a friend'. Das Moon kann schon wieder rein. Mach ihn abwechslungsreicher, lustiger und sympathischer"):
// the moods he is in most carry many lines, "favourite colour" is gone, the moon line is back once, the new jokes stand.
// Reads terminal.js of a given origin. usage: node mood1025.mjs [base]
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const page = await fetch(base + '/?r=' + Date.now()).then((r) => r.text());
const v = (page.match(/terminal\/terminal\.js\?v=(\d+)/) || [])[1];
const js = await fetch(`${base}/terminal/terminal.js?v=${v}`).then((r) => r.text());
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const linesOf = (k) => { const m = js.match(new RegExp(`'${k}': \\{ name: '[^']+', moves: \\[[^\\]]*\\], lines: \\[([\\s\\S]*?)\\] \\},`)); return m ? (m[1].match(/^\s*c => /gm) || []).length : 0; };
const counts = Object.fromEntries(['up-normal', 'up-quiet', 'side-normal', 'side-quiet'].map((k) => [k, linesOf(k)]));
say(counts['up-normal'] >= 12 && counts['up-quiet'] >= 10 && counts['side-normal'] >= 9 && counts['side-quiet'] >= 9, `the everyday moods carry many lines: ${JSON.stringify(counts)}`);
say(!/favourite colour/i.test(js), '"Green is my favourite colour" is gone');
const moon = (js.match(/wen moon\? Asking for a friend/g) || []).length;
say(moon === 1, `the moon line is back, once (${moon})`);
const fresh = ['group therapy with stack traces', 'like a dad at a recital', 'Role model.', 'choose a buyback'];
say(fresh.every((s) => js.includes(s)), 'the new jokes stand in the list');
console.log(bad ? `${bad} FAIL` : 'all PASS');
process.exit(bad ? 1 : 0);
