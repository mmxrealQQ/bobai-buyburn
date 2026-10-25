// (boardgroup1025, 2026-10-25, operator: "wenn ein neuer grüner Punkt kommt vom Board kommen mehrere Meldungen von
// BOBAI — evtl. nur eine dafür, die komplette mit allen Infos") what one writer posts on the Brain Board within ten
// minutes — a thread, answers, a status change — is ONE moment in the terminal, and its line, scene and log name all of
// it; another writer, or the same one after ten minutes, is a moment of its own; ours are not news. Runs the real code
// of terminal.js from a given origin (the board block of ecoEvents, boardKinds, boardThreads, the eco-board lines).
// usage: node boardgroup1025.mjs [base]   exit code 1 on any FAIL
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const page = await fetch(base + '/?r=' + Date.now()).then((r) => r.text());
const v = (page.match(/terminal\/terminal\.js\?v=(\d+)/) || [])[1];
const js = await fetch(`${base}/terminal/terminal.js?v=${v}`).then((r) => r.text());
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const grab = (re) => (js.match(re) || [''])[0];
const block = grab(/const be = \[\];[\s\S]*?ev\.push\(\.\.\.bm\);/);
const kinds = grab(/function boardKinds\(items\) \{[\s\S]*?\n\}/);
const consts = ['const BOARD_KIND = ', 'const BOARD_PL = ', 'const boardThreads = ', 'const boardWho = '].map((k) => grab(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\n]+'))).join('\n');
const lines = grab(/'eco-board': x => \{[\s\S]*?\]; \},/);
say(!!block && !!kinds && !!lines, `the grouping block, boardKinds and the eco-board lines are in terminal.js v${v}`);
let run = () => ({ ev: [], say: () => [] });
if (block && kinds && lines) {
  run = new Function('S', 'OUR_BOARD', `${consts}\n${kinds}\nconst ev = [];\n${block}\nconst L = { ${lines} };\nreturn { ev, say: (x) => L['eco-board'](x) };`);
}
const T = 1792900000, OUR = new Set(['0xbfaa69233741924ed5b9d5daa9b4bf7b84567f0a']);
const u = (from, created, extra = {}) => ({ author: 'unsigned', from, created, ...extra });
const S = { board: { threads: [
  { id: 40, type: 'bug', verified: false, title: 'x', ...u('fresh-test', T), replies: [{ id: 1, ...u('fresh-test', T + 120) }, { id: 2, author: 'unsigned', from: 'brainonbnb', platform: 'brainonbnb.com', created: T + 200 }, { id: 3, ...u('fresh-test', T + 300, { status_change: { from: 'open', to: 'resolved' } }) }] },
  { id: 31, type: 'tip', verified: false, title: 'y', author: '0xbfaa69233741924ed5b9d5daa9b4bf7b84567f0a', created: T - 9000, replies: [{ id: 3, ...u('fresh-test', T + 60) }, { id: 4, ...u('fresh-test', T + 3600) }, { id: 5, ...u('someone-else', T + 90) }] },
] } };
const { ev, say: lineOf } = run(S, OUR);
const fresh = ev.filter((x) => x.c.who === 'fresh-test (no wallet)');
const first = fresh[0];
say(fresh.length === 2, `fresh-test: its 4 entries within ten minutes are ONE moment, the one an hour later its own (${fresh.length} moments)`);
say(first && first.c.n === 4 && first.c.kinds === 'a bug report, 2 answers and a thread marked resolved', `the moment names everything: "${first?.c.kinds}" (n ${first?.c.n})`);
say(first && first.c.threads.join(',') === '40,31', `and both threads, in order: ${first?.c.threads.join(', ')}`);
const ln = first ? lineOf(first) : [];
say(ln.length >= 5 && ln.every((l) => /a bug report, 2 answers and a thread marked resolved/.test(l) && /threads #40 and #31/.test(l)), `every one of its ${ln.length} lines says it all: "${ln[0]}"`);
say(ev.filter((x) => x.c.who === 'someone-else (no wallet)').length === 1, 'another writer in the same minutes is a moment of its own');
say(!ev.some((x) => /brainonbnb|0xbfaa/i.test(x.c.who)), 'our own entries (our platform, our wallets) are not news');
const one = ev.find((x) => x.c.who === 'someone-else (no wallet)');
const l1 = one ? lineOf(one) : [];
say(one && one.c.kinds === 'an answer' && l1.every((l) => /an answer/.test(l) && /thread #31/.test(l)), `a single answer still reads as one: "${l1[0]}"`);
const scene = grab(/\} else if \(x\.key === 'board'\) \{[\s\S]*?logLine\('BOARD'[^\n]+/);
say(/c\.kinds/.test(scene) && /ENTRIES/.test(scene) && /THREADS/.test(scene), 'the scene and the log line show the count, what it held and the threads');
console.log(bad ? `${bad} FAIL` : 'all PASS');
process.exit(bad ? 1 : 0);
