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
