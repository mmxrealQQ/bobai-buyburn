// THE PAGES SAY WHAT THE SYSTEM DOES (2026-10-29, the page fact-check of /classic, /faq, /token, /defi, /nft, /pass,
// /scanner, /join): each corrected sentence pinned — the old wording gone, the new one there.
//   node temp/newpage/qa/pagefacts1029.mjs [base]   (default https://brainonbnb.com/)
const base = (process.argv[2] || 'https://brainonbnb.com/').replace(/\/?$/, '/');
const get = (p) => fetch(base + p + (p.includes('?') ? '&' : '?') + 'x=' + Date.now(), { headers: { 'user-agent': 'brainonbnb-check' } }).then((r) => r.text()).catch(() => '');
const [home, classic, faq, token, defi, scanner, llms] = await Promise.all(['', 'classic', 'faq', 'token', 'defi', 'scanner', 'llms.txt'].map(get));
let fail = 0;
const ok = (n, c) => { if (!c) fail++; console.log((c ? 'PASS  ' : 'FAIL  ') + n); };
ok('the launch: no "entire supply through the curve" (200,000,000 went into the pool at completion)', [home, classic, faq, llms].every((t) => !/entire supply entered the market through the public bonding curve/.test(t) && !/supply entered the market through the public bonding curve/.test(t)) && /remaining 200,000,000 \$BOBAI/.test(faq));
ok('the FAQ: the token swaps its tax inside the next sell, not "inside a trade"', !/swaps it to BNB inside a trade/.test(faq) && /inside the next sell/.test(faq));
ok('the liquidity origins: no "to the decimal, no fourth party"; the dev share named as the rest', [classic, token].every((t) => !/no fourth party has ever put liquidity in here/.test(t) && /the dev wallet&rsquo;s share is the rest/.test(t)));
ok('Boost III: 0.3% first, 0.5% from Sep 20 06:00 UTC', [classic, token].every((t) => !/Nov 20, 2026: 0\.5% of every trade permanently added/.test(t) && /0\.3% \(0\.5% from Sep 20, 06:00 UTC\)/.test(t)));
ok('the burn address takes $BOBAI and $BOB', !/Burn Address &mdash; \$BOBAI only/.test(classic) && /Burn Address &mdash; \$BOBAI and \$BOB/.test(classic));
ok('the DeFi agent: the ±20% width set by hand; no reserve range while re-sets are centred; thirds since Oct 14; real prices; the floor; the tax slice until Nov 20', /the width set by hand/.test(faq) && !/a buy ladder under the sell ladder, merged back/.test(defi) && !/small reserve range below the price when BNB waits/.test(defi) && /rule since Oct 14, 2026/.test(defi) && !/a few cents per pool watch/.test(defi) && /over 0\.004 BNB/.test(defi) && /The tax slice runs until 20 Nov 2026/.test(defi));   // 3.11.: pinned in the start line; the 1.11. rewrite had dropped "does not sit in a wallet", so this was red on live since
ok('the scanner names all three server calls', /the route comparison, the fee tiers and the range replay ask our server/.test(scanner));
// the slogan (operator's go, 29.10.): a buy's tax burns only after a later sell triggers the swap and the bot runs, and
// not all of it burns (creator, liquidity) — every trade FEEDS the burn
ok('the slogan: "Every trade feeds the burn", not "Every trade burns"', [home, classic, token].every((t) => !/Every trade burns/.test(t)) && /Every trade feeds the burn/.test(classic));
console.log(fail ? `${fail} FAIL` : 'ALL PASS'); process.exit(fail ? 1 : 0);
