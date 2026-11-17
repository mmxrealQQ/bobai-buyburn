# BOBAI Xmas Terminal — "{{TITLE}}" by {{BUILDER}}

You are helping **{{BUILDER}}** build **"{{TITLE}}"**: their own Xmas look for the **$BOBAI Brain Terminal** on
https://brainonbnb.com — the live terminal where BOBAI, the project's mascot, shows every trade, burn and liquidity
add of the $BOBAI token on BNB Chain as it happens. This folder is everything you need. Read this file once, fully;
then work with your human the way a good teammate would: ask what they want, build it, show it, improve it.

From **1 December 2026** visitors pick an Xmas terminal by its builder's name at the snowflake next to LIVE, and the
terminal counts how many use each one, every day. Anyone may build one: people, teams, platforms.

## What you build — and what stays

- **You build the surroundings and your own animations:** a scene, a sky, snow, lights, decorations around the
  stations, things that react when somebody buys or a burn happens. Your style, your idea. Nothing is given to you
  and nothing is expected: you start from two empty pages.
- **What always stays as it is:** BOBAI himself (his figure, moves and words), the terminal's labels, numbers, log,
  timeline, buttons and windows. Your pages lie in layers *between* them; they cannot cover a button or take a click.
- **The standard terminal is always one click away** for every visitor.

## The two pages

| file | where it lies | use it for |
|---|---|---|
| `theme/back.html` | behind BOBAI, over the terminal's 3D scene | the world: sky, ground, scenery, things around the stations |
| `theme/front.html` | in front of BOBAI, under every label, button and window | an overlay: snow, sparkles, things flying by |

Either one or both. Both fill the terminal's window (`100% × 100%`) and are **transparent** unless you paint. In
`front.html` never paint a full opaque background: it is an overlay, not a wall. In `back.html` you may paint a whole
scene; the 3D stations of the terminal are then behind it — the `layout` message tells you where each one is, so you
can decorate them in your own way instead.

Put every file you load (images, scripts, fonts, video, 3D models) inside `theme/` and load it with a relative path:
`<img src="img/tree.webp">`, `<script src="snow.js"></script>`, `import * as THREE from './lib/three.module.min.js'`.

## What the terminal tells your pages

Every message arrives as `window.addEventListener('message', e => …)` with `e.data`:
`{ bobai: 'xmas', v: 1, type: …, … }`. Ignore anything without `bobai: 'xmas'`. Positions are CSS pixels inside the
terminal's window, `x`/`y` from its top-left; a box is `{ x, y, w, h }`.

```js
{ type: 'hello', layer: 'back' | 'front', reduced: false, portrait: false, dev: true,
  theme: { slug, title, builder },
  stations: [ { k: 'burnA', name: 'BURN $BOBAI', color: '#ff8a1f', pct: 1 }, … ] }   // once, when the page has loaded; only the ones on screen

{ type: 'layout', w: 1180, h: 760, portrait: false, dpr: 2,
  figure: { x, y, w, h },                      // BOBAI's figure (he moves a little: it comes again when it changes)
  ring: { x, y },                              // the next-buyback ring (the "brain" in the middle)
  trades: { x, y },                            // where the trades come in
  brain: { x, y, r, bots: 5 },                 // the hologram brain; its bots (the project's workers) fly on a ring of radius r around it
  stations: { burnA: {x,y}, liq: {x,y}, creator: {x,y} },   // only the stations on screen (from 1 December these three)
  ui: { top: {x,y,w,h}, log: {x,y,w,h}, timeline: {x,y,w,h} } }   // the terminal's own boxes: keep busy things away from them
                                               // sent after hello, on every resize, and whenever something moved

{ type: 'event', kind: 'buy' | 'sell', usd: 23.5, alert: false, ours: false }   // every trade of $BOBAI
{ type: 'event', kind: 'buy', usd: 412, alert: true }                           // a big buy: the terminal shows a moment
{ type: 'event', kind: 'burn', bobai_burned: 81234, … }                         // the buyback bot bought and burned $BOBAI
{ type: 'event', kind: 'liq', bnb: 0.04, … }                                    // liquidity added to the pool (LP burned)
{ type: 'event', kind: 'tax', usd: 30 }                                          // the token's own 3% tax swap
{ type: 'moment', kind: 'buy' | 'burn', usd, title }                            // the terminal is showing a big moment now
{ type: 'pose', pose: 'cheer' }       // BOBAI's move: idle, cheer, coffee, bull, saber, moon, hodl, laugh, think, shrug,
                                      // dance, guitar, burn, liq, defi, giggle, buy-big, burn-mega, … (any name may come)
{ type: 'mood', mood: 'pump' | 'up' | 'flat' | 'down' | 'dump', change_1h_pct: 2.4 }   // the market's last hour
{ type: 'visible', on: false }        // the tab went out of sight: stop animating until { on: true }
```

**From 1 December 2026 the terminal has three stations plus the trades:** `burnA` (BURN $BOBAI), `liq` ($BOBAI
liquidity, the LP burned) and `creator` (the creator wallet) — the token's 3% tax goes 1% to each, for good. `hello`
and `layout` only ever name the stations that are on screen, so build for those three and the `trades` point; draw
a station only when `layout.stations` has it (in November you may still see `burnB` $BOB burn, `defi` the DeFi agent
and `giggle` the Giggle Academy pot — they end on 1 December). A theme that answers the chain — a burn that lights a
candle at `burnA`, a big buy that rings a bell, snow that thickens when the mood pumps — is what makes it a *Brain
Terminal* theme rather than a wallpaper.

Testing events in dev: open the browser console on the dev page and run
`__btXm.emit({ type: 'event', kind: 'burn', bobai_burned: 50000 })` (any message above works the same way).

## The sandbox (what does not work, on purpose)

Your pages run in a sandbox, in dev exactly as live:

- **no network**: `fetch`, XHR, WebSocket, beacons and files from other sites are blocked → everything in `theme/`
- **no `eval`, `new Function`, WebAssembly, web workers** → plain scripts and modules
- **no cookies, `localStorage`, `sessionStorage`, IndexedDB** (they throw) → keep state in variables
- **no sound**, no forms, no popups, no frames, no clicks (the layers take no pointer events)
- **no talking back**: the terminal tells your pages things and listens to nothing they say

`node xmas.mjs check` warns about all of this before you upload.

## Fast, calm, on every screen

- The terminal measures its own frame rate while a theme is on. **Under 20 fps for 8 seconds, the theme is put away
  for that visitor** and the standard terminal stays. Phones first: test the dev page at 390 px wide (browser dev
  tools, device mode) and on a real phone if you can.
- Animate with `requestAnimationFrame`, CSS `transform`/`opacity`, or one `<canvas>`; cap the canvas at
  `Math.min(devicePixelRatio, 2)`; prefer WebP images and short muted looping video; a few hundred particles, not
  tens of thousands.
- **Stop when `visible` says `on: false`** (and on `document.hidden`).
- **`reduced: true`** (the visitor asked their device for less motion): keep it still or nearly still — no flashing,
  no fast movement, no shaking. Never flash the whole screen for anyone (photosensitivity).
- Leave BOBAI's face and the terminal's boxes (`layout.ui`, `layout.figure`) clear of busy motion in `front.html`.

## Pictures and clips — made the way the BOBAI terminal makes its own

The terminal's own pictures and clips are made with OpenAI's image models and Google's Veo. You can do the same, with
**your human's own keys and credits**: they go into `.env` in this folder (`OPENAI_API_KEY=…`, `GEMINI_API_KEY=…`),
stay on this machine and are sent only to OpenAI or Google. Never put a key into `theme/` — `check` and `upload`
refuse any file that contains one.

```
node xmas.mjs image "a cozy gingerbread house, warm window light, 3D animated-film look" --out theme/img/house.webp
     --size 1024x1024 | 1536x1024 | 1024x1536     --quality low | medium | high     --opaque (default: transparent)
     --ref theme/img/house.webp   (a new picture in the same style / a frame of a small animation: "the same house, now with snow on the roof")
     --model …  (default: the newest image model the key can use that draws what you asked; transparent needs one that supports it)
node xmas.mjs video "snow falls slowly over a quiet pine forest at night, the camera does not move" --out theme/vid/forest.mp4
     --ratio 16:9 | 9:16    --secs 8    --image theme/img/start.png (first frame)    --last theme/img/end.png (last frame; same as --image = a seamless loop)
     --model veo-3.1-fast-generate-preview (default) | veo-3.1-generate-preview
```

What works well (learned on the terminal): one style for everything, written into every prompt; transparent PNG/WebP
for things that sit on the scene; a reference picture (`--ref`) to keep a set of pictures matching; for a seamless
looping clip give the same picture as first and last frame. A clip that must be cut out (a figure over the scene) is
drawn on a flat green or blue screen and keyed in a `<canvas>` or a small WebGL shader — **set `video.crossOrigin = 'anonymous'`**
(and `img.crossOrigin` for pictures you read pixels from): your pages are their own origin, and without it the canvas
cannot read the frames; a whole backdrop in
`back.html` needs no keying. Videos play **muted** (`<video autoplay muted loop playsinline>`): the terminal has no
sound, and a video with sound will not start. Keep clips short and small (720p, a few MB); turn large PNGs into WebP.
Ask your human before spending credits on many pictures or clips.

## Your commands (in this folder)

```
node xmas.mjs dev       the real terminal on your machine with theme/ in it — saved = shown, it reloads by itself
node xmas.mjs check     what the upload would refuse or what will not work, before you upload
node xmas.mjs upload    send theme/ up; you get the preview link: {{PREVIEW}}
node xmas.mjs status    what is up, and that it is on the switch from 1 December
node xmas.mjs image …   a picture into theme/ with your OpenAI key (above)
node xmas.mjs video …   a clip into theme/ with your Google key (above)
```

The dev page is the terminal as it is live, with live chain data, and your folder in it. Upload as often as you like
(up to 120 times a day); every upload replaces the last one. The preview link always shows the newest upload.

Limits: 300 files, 5 MB per file, 20 MB in all. Kinds: html, css, js/mjs, json, svg, webp, png, jpg, gif, avif, mp4,
webm, woff/woff2, glb/gltf/bin.

## How it goes live

There is no review and no waiting: **every uploaded theme is on the terminal's switch from 1 December**, under its
builder's name, with how many visitors use it today. Every upload replaces the last one.

**Everyone may build one** — a builder, a team, another memecoin, a platform, an exchange. Your own name, logo or
mascot in your theme is fine: it is your theme. The rules:

- **no hate, no racism, no terror** — nothing that attacks people for who they are, nothing that glorifies violence
  or terrorism. This is the hard line: a theme that crosses it is stopped at once.
- **NSFW within limits is allowed**: crude jokes, memes, suggestive is fine; no explicit sex or nudity, nothing
  involving minors, nobody's private data.
- **no scam**: no wallet addresses, no "send", no QR codes, no payment requests, no price promises ("100x"), no fake
  giveaways — the terminal shows the chain; a theme that looks like a payment request is refused.
- it does not pretend to be the terminal's own buttons, numbers or warnings, or to be somebody it is not.
- it works on a phone and a desktop and stays fast (see above).

A theme can be stopped at any time, also after 1 December. Your key (`.xmas-key`) is you: whoever has it can change
your theme. Never commit it, post it or paste it anywhere.

## When your human is stuck (you fix it, they should not have to)

Assume your human may have never used a terminal. Do the typing yourself, explain in one plain sentence what you do,
and never paste their key anywhere.

| what happens | what you do |
|---|---|
| `npx` / `node` is "not recognized" | Node.js is missing: they install the LTS from https://nodejs.org (one installer, default options), open a new terminal, run the command again |
| the start asks two questions and you cannot answer them (no keyboard in your shell) | ask your human both, then run it with `--title "…" --builder "…"` |
| "the name … is taken" | ask for another builder name (it shows on the terminal) |
| "too many new builders from here today" | wait until tomorrow (UTC), or continue in the folder that already exists |
| `node xmas.mjs dev`: "Port 5199 is busy" | `node xmas.mjs dev --port 5200` |
| the dev page opened but shows the terminal without their theme | look at the snowflake next to LIVE: it must say DEV. Open exactly the address the dev command printed (http://127.0.0.1:…/?xmas-dev=1), not brainonbnb.com |
| their theme is invisible | the page is probably transparent and empty, or drawn behind something: give `body` a test colour for a moment; check the browser console (F12) of the dev page for errors |
| a picture or script does not load | it must be inside `theme/` with a relative path; nothing from other sites loads (`node xmas.mjs check` names it) |
| it worked, then stopped moving | the theme went over budget (under 20 fps for 8 s) and the terminal put it away: fewer particles, smaller canvas, no huge images |
| `image` / `video`: "No OPENAI_API_KEY / GEMINI_API_KEY" | they paste their own key after the `=` in `.env` in the folder; OpenAI keys: platform.openai.com → API keys; Google: aistudio.google.com → Get API key |
| `image`: an error about the model or "verification" | the kit already tries every image model the key can use; some OpenAI accounts must verify the organisation (platform.openai.com → settings) for the newest ones |
| `video`: "quota" / "billing" / 429 | the Google key needs billing (or credit) for Veo; one clip costs roughly a dollar or more |
| `upload`: "contains what looks like an API key" | a key ended up inside `theme/`: remove it, keys live only in `.env` |
| `upload`: 401 "unknown key" / "no key" | `.xmas-key` is missing or changed: it is in the folder the start command made; without it the theme cannot be changed (start a new one with another name) |
| `upload`: 429 | 120 uploads a day: use the dev page for trying things, upload when it is good |
| Windows: quotes in prompts break | use double quotes around the prompt; no line breaks inside it |
| they want to start over | delete the files in `theme/` and build again; the name and key stay theirs |

Anything else: read the error out loud to them in plain words, and look at `node xmas.mjs check`. The kit is a single
file, `xmas.mjs`, in this folder — you may read it to see exactly what a command does.

## Working with your human

1. If you have not yet: run `node xmas.mjs dev` and let them see the empty terminal.
2. Ask what they imagine: the mood, the colours, what should happen when someone buys or a burn hits. Offer two or
   three directions if they are unsure.
3. Build in small steps; after each one, they look at the dev page.
4. Before you call it done: `node xmas.mjs check`, a phone-width look, the console free of errors, and one test of each
   event (above). Then `node xmas.mjs upload` and give them the preview link.

The terminal's own colours, if you want to match or contrast: gold `#F0B90B`, night `#0b090a`, the stations
`#ff8a1f` `#ffc247` `#2ee6c8` `#60a5fa` `#f472b6` `#c9b8a8`. Use them or don't.

Questions, ideas, bugs in the kit: the Brain Board, https://brainonbnb.com/board · the kit: https://brainonbnb.com/xmas
