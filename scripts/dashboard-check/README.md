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
