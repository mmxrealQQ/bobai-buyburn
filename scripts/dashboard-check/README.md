# Dashboard checks

Headless-Chrome probes for the liquidity depth panel on `brainonbnb.com`. They read
measurements out of a real browser instead of taking screenshots, so the result is
something that can be compared rather than looked at.

    node scripts/dashboard-check/depth-panel.mjs      # 1280px: values + guards
    node scripts/dashboard-check/depth-panel-390.mjs  # 390px: overflow, tap targets, bar length

No install needed — Node 22+ ships a global `WebSocket`, so CDP is spoken directly.
Chrome is expected at `C:/Program Files/Google/Chrome/Application/chrome.exe`.

**What `depth-panel.mjs` asserts.** It clicks every depth multiplier and checks that the
real pool tiles never move, that the hypothetical warning appears only in a simulated
state, and that the sub-labels stop saying "right now" the moment a multiplier is picked.
The bars must shorten in proportion as depth grows — pinned to the live scale, a doubled
pool halves every bar.

**What `depth-panel-390.mjs` asserts.** Nothing overflows the viewport, no pill sits past
the edge, tap targets stay usable, and no bar collapses to a sub-pixel sliver. A bar around
1px is the failure this file exists to catch: the maths is right and the display is not.

The figures themselves are checked separately, against an independent swap simulation —
the closed forms in `dashboard/app.js` must agree with a real constant-product swap at
every multiplier, and the two "moves the price 1%" sizes must reproduce exactly ±1%.

## Every check in this folder

| script | asks |
|---|---|
| `bnb-source-parity.mjs` | the page and the Telegram bot give the same BNB/USD figure from the same Chainlink feed |
| `link-colors.mjs` | every link on a page by the colour the browser paints it; a browser-default blue is a link no stylesheet claimed |
| `page-weight.mjs` | what a page costs to open, request by request |
| `registry-coldstart.mjs` | a stranger lands on /registry and reaches a real price in every one of the four categories |
| `registry-hire.mjs` | the hire panel driven in a real browser, up to the wallet |
| `registry-hire-wallet.mjs` | the hire panel through a REAL wallet, past where the other check stops |
| `registry-telemetry.mjs` | the live-telemetry lines on /registry really reach the reader |
| `reload-scroll.mjs` | a plain load starts at the top, a deep link still jumps to its section |
| `reveal.mjs` | is anything on the page invisible that should not be (the worst failure this site ever had) |
| `scanner-honeypot.mjs` | the honeypot line on /scanner, pinned both ways |
| `scanner-rescan.mjs` | scanning a second token on /scanner the way a visitor does |
| `table-fit.mjs` | every log table on the homepage on a phone (430 to 320px): does the table end inside its `.txw` box — a table that is wider scrolls inside the box, the PAGE does not, so the layout audit never sees it (Live Burns, 2026-09-19); `SELFTEST=1` forces a table wide and passes only if that is reported |
| `tier-panel.mjs` | the three button cards on /scanner, pressed the way a visitor presses them and picked by name (`data-card`), never by position: fee tiers (default), `PANEL=range` the range replay, `PANEL=route` the route card for trading — names a route that is in the table and marked best, the size asked, the round trip, the tax (measured or said unknown), the slippage, no row losing more than everything, no overflow at `W=390`; `SELFTEST=1 PANEL=route` plants three faults in the rendered card and passes only if all three are reported |
| `type-click.mjs` | type into a field, press a button, read what appears |
| `submission-screens.mjs` | the hackathon screenshots, written to files only, never read back |
| `style-arrival.mjs` | every visible class on every page meets a rule in a loaded stylesheet |
| `scan-consistency.mjs` | the REST scan answers the same question the same way every time |
| `depth-panel.mjs / depth-panel-390.mjs` | the liquidity depth panel at 1280 and at 390 (described above) |
| `page-text.mjs / text-overflow.mjs` | a page as a stranger reads it; the text run that overflows a phone (described below) |

## page-text.mjs and text-overflow.mjs (2026-09-03)

    node scripts/dashboard-check/page-text.mjs https://brainonbnb.com/scanner "#sc-out" 6000 390
    node scripts/dashboard-check/text-overflow.mjs https://brainonbnb.com/services 390

The first prints a page as a visitor reads it — text in order, console errors, failed
requests, sideways scroll — so the page can be *read* rather than asserted about. Use it
first on every page you change; it finds what no checker was written to look for. The
second names the exact text run that makes a page wider than the phone.

## scan-consistency.mjs (2026-09-08)

    node scripts/dashboard-check/scan-consistency.mjs [address] [N]

Asks `/api/pool-scan` the same question N times, one at a time, and counts how the tax
was answered — measured from trades, simulated on-chain, or copied from a GoPlus label —
with the sell test and the latency. The scan answers 200 either way; only `tax.source`
tells them apart, and this is how a change to the RPC path is measured rather than
believed (2026-09-08: one answer in ten was a label; after the retry, none of ten). A
measurement, not a gate: exit code 0 always.

## style-arrival.mjs (2026-09-09)

Does the style arrive? Every visible element's classes are held against every
selector in the stylesheets the page really loaded, in a real browser, on the
live site. A finding is an element none of whose classes any rule mentions,
with text of its own, looking bare (no padding, border, background, same font
and colour as its parent). That is the shape of the three links on /advantage
that stood unstyled for weeks because `.back-btn` lived inline on two other
pages. Wrappers, second classes on styled elements and elements a descendant
selector dresses are counted as hooks, not findings (`--all` lists them).

    node scripts/dashboard-check/style-arrival.mjs --self-test     all pages, plus a planted unstyled class that must be reported
    node scripts/dashboard-check/style-arrival.mjs --only=services --all

First full run 2026-09-09: 16 pages, 0 findings, 17 hooks.
