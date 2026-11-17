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
  stations: [ { k: 'burnA', name: 'BURN $BOBAI', color: '#ff8a1f', pct: 0.8 }, … ] }   // once, when the page has loaded

{ type: 'layout', w: 1180, h: 760, portrait: false, dpr: 2,
  figure: { x, y, w, h },                      // BOBAI's figure (he moves a little: it comes again when it changes)
  ring: { x, y },                              // the next-buyback ring (the "brain" in the middle)
  trades: { x, y },                            // where the trades come in
  stations: { burnA: {x,y}, burnB: {x,y}, liq: {x,y}, defi: {x,y}, giggle: {x,y}, creator: {x,y} },
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

The stations, in the terminal's words: `burnA` BURN $BOBAI, `burnB` BURN $BOB, `liq` liquidity, `defi` the DeFi agent,
`giggle` the Giggle Academy pot, `creator` the creator wallet. A theme that answers the chain — a burn that lights a
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
     --model gpt-image-2 (default; gpt-image-1 is tried when it is not available to the key)
node xmas.mjs video "snow falls slowly over a quiet pine forest at night, the camera does not move" --out theme/vid/forest.mp4
     --ratio 16:9 | 9:16    --secs 8    --image theme/img/start.png (first frame)    --last theme/img/end.png (last frame; same as --image = a seamless loop)
     --model veo-3.1-fast-generate-preview (default) | veo-3.1-generate-preview
```

What works well (learned on the terminal): one style for everything, written into every prompt; transparent PNG/WebP
for things that sit on the scene; a reference picture (`--ref`) to keep a set of pictures matching; for a seamless
looping clip give the same picture as first and last frame. A clip that must be cut out (a figure over the scene) is
drawn on a flat green or blue screen and keyed in a `<canvas>` or a small WebGL shader; a whole backdrop in
`back.html` needs no keying. Videos play **muted** (`<video autoplay muted loop playsinline>`): the terminal has no
sound, and a video with sound will not start. Keep clips short and small (720p, a few MB); turn large PNGs into WebP.
Ask your human before spending credits on many pictures or clips.

## Your commands (in this folder)

```
node xmas.mjs dev       the real terminal on your machine with theme/ in it — saved = shown, it reloads by itself
node xmas.mjs check     what the upload would refuse or what will not work, before you upload
node xmas.mjs upload    send theme/ up; you get the preview link: {{PREVIEW}}
node xmas.mjs status    what is up, and whether it is approved for 1 December
node xmas.mjs image …   a picture into theme/ with your OpenAI key (above)
node xmas.mjs video …   a clip into theme/ with your Google key (above)
```

The dev page is the terminal as it is live, with live chain data, and your folder in it. Upload as often as you like
(up to 120 times a day); every upload replaces the last one. The preview link always shows the newest upload.

Limits: 300 files, 5 MB per file, 20 MB in all. Kinds: html, css, js/mjs, json, svg, webp, png, jpg, gif, avif, mp4,
webm, woff/woff2, glb/gltf/bin.

## How it goes live

The operator of the BOBAI terminal looks at every theme and approves it for the switch; from 1 December the approved
ones are live, each under its builder's name, with how many visitors use it today. Approved means:

- it works on a phone and a desktop and stays fast (see above)
- nothing offensive, nothing hateful, nothing sexual, nobody's private data
- **no money talk inside the theme**: no wallet addresses, no "send", no QR codes, no links, no token or project
  promotion, no prices or promises — the terminal already shows the chain; a theme that looks like a payment request
  is refused
- it does not pretend to be the terminal's own buttons, numbers, warnings or another brand

A theme can be stopped at any time, also after 1 December. Your key (`.xmas-key`) is you: whoever has it can change
your theme. Never commit it, post it or paste it anywhere.

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
