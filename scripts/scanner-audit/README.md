# Pool Scanner audit harness

Drives `/scanner` in headless Chrome over a few dozen live BSC tokens and checks
what a screenshot cannot: that every figure is a figure. This has lived in a
session scratchpad twice and was lost twice, which is why it is in the repo now.

No install: Node 22+ has a global `WebSocket`, so Chrome is driven over CDP
directly. No puppeteer, no playwright.

## Run

    # serve the site locally (from dashboard/)
    python -m http.server 8899 --bind 127.0.0.1

    # then, from this directory
    node audit.mjs                 # desktop, ~29 tokens
    W=390 H=780 N=10 node audit.mjs                     # phone width
    BASE=https://brainonbnb.com/scanner node audit.mjs   # the live page

`N` sets how many currently-trading tokens are pulled from GeckoTerminal on top
of the fixed list; the fixed list is the set of tokens that broke something in
an earlier round ($TUT's side pocket, $BTCB's depth, a pasted pair, an address
that is not a token at all).

## What it fails on

- a blank result with no error — the worst thing this page can do
- `NaN` / `undefined` / `Infinity` anywhere in the rendered text
- a cost below the pool's own fee floor. This is the sharpest check of the lot:
  the fee is payable at any size, so a figure under it means the cost was
  measured against a stale price, which is exactly how negative costs appeared
- impact or cost that does not rise with trade size
- an element overflowing its parent, or the page scrolling sideways
- uncaught exceptions

RPC 403s in the console are the public endpoints throttling a machine that has
just scanned forty tokens in a row. The failover handles them and they are
filtered out — they are noise from testing, not a defect.
