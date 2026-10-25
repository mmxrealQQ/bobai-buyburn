// (moneywords1025, 2026-10-25, A-Z pass) what BOBAI says about where money goes matches the code: the DeFi agent's fees
// go in thirds since 14.10. (capital, $BOBAI held, the operator), and an AI payment's $BOBAI half is bought and held or
// partly added to the pool since 22.10. (SWEEP_LIQ). Reads the SERVED terminal.js and looks for the sentences that said
// otherwise; each must be gone, and the corrected wording must be there.
// usage: node moneywords1025.mjs [base]   exit code 1 on any FAIL
const base = (process.argv[2] || 'https://brainonbnb.com/').replace(/\/?$/, '/');
let fails = 0; const is = (ok, t) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t}`); };
const html = await fetch(base + '?r=' + Date.now()).then((r) => r.text());
const src = html.match(/terminal\/terminal\.js\?v=[0-9a-z]+/)?.[0] || 'terminal/terminal.js';
const js = await fetch(base + src + '&r=' + Date.now()).then((r) => r.text());
is(js.length > 100000, `the served terminal.js was read (${src}, ${js.length} bytes)`);
is(!/half of what it earns buys BOBAI/.test(js) && /a third of what it earns buys BOBAI/.test(js), 'the DeFi bot\'s note: a third of what it earns buys $BOBAI (not half)');
is(!/Half of it buys \$BOBAI at a sweep, held for good/.test(js) && /Half of it goes to \$BOBAI at a sweep/.test(js), 'a payment moment: its $BOBAI half goes to $BOBAI, bought and held or added to the pool (not only held)');
console.log(fails ? `FAIL  ${fails}` : 'PASS  the terminal says where the money goes as the code does');
process.exit(fails ? 1 : 0);
