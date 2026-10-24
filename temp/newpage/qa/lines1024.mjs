// (lines1024, 2026-10-24, operator: "der Spruch 'is this the moon, asking for a friend' sagt er immer"; "intelligenter
// und witziger, darf auch 16+ sein") read from the terminal.js a page serves: that line is gone; "May the pump be with
// you." stands in at most two places (it was five); a line comes back after six hours, not twenty minutes; the 16+
// jokes are in. usage: node lines1024.mjs [base]
const base = (process.argv[2] || 'https://brainonbnb.com').replace(/\/$/, '');
const page = await fetch(base + '/?r=' + Date.now()).then((r) => r.text());
const v = (page.match(/terminal\/terminal\.js\?v=(\d+)/) || [])[1];
const js = await fetch(`${base}/terminal/terminal.js?v=${v}`).then((r) => r.text());
let bad = 0; const say = (ok, t) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
// it may come (operator, same day: it fits the moon clip), but from one place, one of eight moon lines
const friend = js.split('Asking for a friend.').length - 1;
say(friend === 1 && /moon: \[[^\]]*Asking for a friend\./.test(js), `"Is this the moon? Asking for a friend." stands once (${friend}), among the moon move's lines`);
const pump = js.split('May the pump be with you.').length - 1;
say(pump <= 2, `"May the pump be with you." in ${pump} places (at most 2)`);
say(/keep = \(LIFEFAST \? 360 \/ 12 : 360\) \* 60e3/.test(js), 'a line comes back after six hours');
const jk = ['My love life is like my LP', 'Exit liquidity? Babe, I am the bouncer.', 'Leverage is like tequila'];
say(jk.every((j) => js.includes(j)), 'the 16+ jokes are in');
console.log(bad ? `\n${bad} FAIL (v=${v})` : `\nall PASS (v=${v})`); process.exit(bad ? 1 : 0);
