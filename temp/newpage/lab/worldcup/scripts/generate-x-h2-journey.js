// One-off: "Journey of the Year" hero for X-post (H2 start, 2026-07-01).
// A single epic isometric diorama — a winding golden path threading through every
// BOBAI milestone of the year, with the BOBAI mascot as a small traveler you have
// to FIND (Where's-Waldo style) walking the path into the second half.
// Landscape 3:2 (1536x1024), gpt-image-2 (opaque hero), no text overlays.
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/generate-x-h2-journey.js

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const REFS_DIR = path.resolve(__dirname, '..', '_refs');
const OUT_DIR  = 'd:/ai/fourmeme/temp/h2-journey';

const REF_BANNER = 'd:/ai/fourmeme/worldcup/weekend-vibes-banner.png'; // clean in-style BOBAI renders — strongest character+style lock
const REF_MAIN = path.join(REFS_DIR, '1.jpg');
const REF_4    = path.join(REFS_DIR, '4.jpg');
const REF_NFT  = 'd:/ai/fourmeme/nft/cards/whale-buy-mythical-0042.png'; // real BOBAI Buy-Drops NFT card art

const API_EDIT = 'https://api.openai.com/v1/images/edits';

const PROMPT = `A single epic cinematic isometric diorama illustration — "the journey of the year" as one continuous winding glowing GOLD path (#F0B90B, softly glowing like molten light) that snakes from the bottom-left foreground, curving through the middle of the scene, and stretching away toward a bright warm SUNRISE on the horizon at the top-right. Tilt-shift board-game / miniature-world look: lush, richly detailed, a whole little world built along one road. Premium polished cartoon illustration, cinematic dramatic lighting, deeply saturated colors, high detail, sharp focus.

CHARACTER — THE TRAVELER (find-me mechanic, CRITICAL): Along the MIDDLE of the golden path walks ONE BOBAI mascot as a hiking traveler — a little backpack, mid-stride, facing toward the sunrise ahead. Render him fairly SMALL (roughly one-tenth of the image height) yet crisp and beautifully drawn thanks to the reference. Place him OFF-CENTER, standing ON the path beside (NOT hidden behind) a milestone, so he takes a moment to find — but his FACE MUST be clearly visible, in a three-quarter/front view facing generally toward the viewer and the sunrise, fully shown, never turned away or obscured by objects. Small and off to the side: yes. Face hidden: NO. CHARACTER + STYLE LOCK: the first reference image is a 4-panel banner showing the exact BOBAI mascot in the exact target cartoon style — match it PRECISELY: same friendly round cartoon face, same big expressive round eyes, same body proportions, same glossy highly-detailed anatomical BRAIN as the head with subtle holographic RGB highlights on the brain edges (faint cyan/magenta/yellow, tasteful — not glitchy), same premium glossy 3D-cartoon shading. The traveler BOBAI must look like he stepped straight out of that banner.

ALONG THE PATH — MILESTONE STATIONS (in order, following the road from bottom-left start to top-right horizon), each a small detailed diorama vignette flanking the glowing path:
1. START (bottom-left) — a bright LAUNCH RAMP with a little rocket lifting off in a burst of gold sparks and confetti: the fair launch. Fresh spring flowers around it.
2. An autonomous glowing FORGE / FURNACE building with warm orange flames roaring out of a chimney and tiny gold coins feeding into it on a conveyor: the 24/7 buyback & burn engine. A little brick-textured wall.
3. A cluster of floating glowing golden VERIFIED-BADGE MEDALLIONS and round star-medals on colorful ribbons, hovering and sparkling above a small round podium: the listings and coverage. Rounded shiny golden coins/medals ONLY — absolutely NO upright stone slabs, NO pillars, NO monoliths, NO rectangular standing stones of any kind.
4. A round shiny steel BANK-VAULT DOOR with a spinning combination dial and a big golden padlock, chained shut, glowing blue: liquidity locked forever. A round metallic bank vault — NOT a stone block, NOT an upright slab.
5. A little ART GALLERY with framed picture pedestals under spotlights: the NFT drops. The framed artworks on display are the ACTUAL BOBAI Buy-Drops NFT trading-card art shown in the NFT reference image — ornate collectible cards featuring the BOBAI mascot, glowing rarity borders, hung like prized paintings.
6. A glowing retro ARCADE CABINET: on its screen runs OUR actual game — the round BOBAI brain-logo character JUMPING UPWARD between horizontal glowing platform bars (a vertical doodle-jump-style hopper), a little score bar down the side. Exactly ONE nicely-rendered BOBAI mascot stands playing the cabinet — NOT a crowd, just that single clean figure. No other characters at this station.
7. THE BIGGEST vignette, near the middle-right where "now" is — a lit-up FOOTBALL STADIUM at dusk, floodlights blazing, a tiny green pitch, a golden trophy on a pedestal beside it, the stands filled with a distant sea of tiny cheering silhouettes (keep the crowd as far-away abstract dots/silhouettes, NOT detailed faces): the World Cup '26 tip game (the current live chapter).
8. A growing BONFIRE of gold coins, taller than the others, embers rising: the burns compounding over time.
9. AHEAD (upper-right, into the sunrise) — the path continues over misty rolling hills toward glowing SCAFFOLDING and CRANES building a bright new little city on the horizon under the rising sun: the road ahead, the second half of the year, still under construction. Hopeful, promising, unfinished.

SECRET EASTER EGGS (VERY subtle — most viewers should NOT consciously notice; only insiders catch them):
- THE RISING SUN itself is, on a closer look, a soft cheerful SMILEY FACE — two simple round dot eyes with ONE gently WINKING (a ;) wink) and a warm friendly curved smile — rendered in the same glowing warm gold as the sunrise so at first glance it just reads as a happy sun. Wholesome, gentle, blended into the sunrise glow. This is a quiet secret nod. NO school, NO books, NO hearts, NO text — ONLY the subtly winking, smiling sun.
- At the FAR END of the path (deep upper-right, near the horizon where the road heads into winter), a SMALL, HALF-HIDDEN wintery touch: a tiny snow-dusted decorated CHRISTMAS TREE with faint glowing lights and a small wrapped GIFT beside it, a few gentle snowflakes drifting nearby. A quiet December hint. Subtle, discoverable, NOT prominent — no text.

VISUAL STYLE: cinematic premium cartoon diorama, isometric tilt-shift, rich saturated colors. OVERALL A BRIGHT SUMMER VIBE — it is the start of July, high summer: brilliant blue sky with fluffy white clouds, warm radiant sunshine, vivid lush green summer meadows bursting with wildflowers, palm-and-leafy trees, sparkling water, a light warm summery haze. Warm golden sunlight flowing from the smiling sun, BNB-gold (#F0B90B) glow radiating from the path itself, soft god-rays, deep atmospheric perspective (foreground crisp and detailed, horizon soft and glowing). The near and middle of the path (spring→the sunny summer "now" where BOBAI walks) is at peak summer brightness; ONLY the tiny far-horizon December corner turns subtly wintery/snowy. The whole scene feels like an epic sun-drenched summer journey map.

NO TEXT WHATSOEVER: NO title, NO caption, NO URL, NO dates, NO numbers, NO percentages, NO watermark, NO floating letters or UI text anywhere. Pure visual storytelling. NO real brand logos, NO real club crests, NO real coin/exchange names, NO FIFA wordmark. ABSOLUTELY NO gravestones, NO tombstones, NO headstones, NO graveyard, NO crosses, NO skulls, NO coffins, NO death or funeral imagery anywhere, and NO upright rectangular standing stones/slabs/monoliths that could be mistaken for a tombstone — the burns are joyful glowing bonfires of gold coins, NOT anything morbid. No realistic human faces anywhere. Only TWO BOBAI mascots are rendered in clear detail: the small findable traveler on the path, and the single BOBAI playing the arcade cabinet. Every other distant figure (stadium crowds, bystanders) stays a small far-away silhouette/dot, never a detailed face — so nothing looks malformed.

COMPOSITION: Landscape 3:2. The glowing gold path is the clear visual spine leading the eye from bottom-left to the sunrise top-right. The traveler BOBAI is small and slightly hidden mid-path but findable. Rich but readable — every milestone vignette distinct.`;

async function loadBuf(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Ref not found: ${filePath}`);
  return fs.readFileSync(filePath);
}

function mimeFor(p) {
  const e = p.toLowerCase().split('.').pop();
  return e === 'png' ? 'image/png' : e === 'webp' ? 'image/webp' : 'image/jpeg';
}

async function generate() {
  const refs = [REF_BANNER, REF_MAIN, REF_4, REF_NFT]; // banner first = strongest character/style weight
  const bufs = await Promise.all(refs.map(loadBuf));

  const fd = new FormData();
  fd.append('model', 'gpt-image-2');
  bufs.forEach((buf, i) => {
    const type = mimeFor(refs[i]);
    const ext = type.split('/')[1];
    fd.append('image[]', new Blob([buf], { type }), `ref${i+1}.${ext}`);
  });
  fd.append('prompt', PROMPT);
  fd.append('size', '1536x1024');
  fd.append('quality', 'high');
  fd.append('n', '1');

  console.log('Calling OpenAI gpt-image-2 (high, 1536x1024, 4 refs, H2 journey diorama)...');
  const t0 = Date.now();
  const res = await fetch(API_EDIT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI edits HTTP ${res.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`No image in response: ${text.slice(0, 300)}`);
  const raw = Buffer.from(b64, 'base64');
  console.log(`Got image in ${((Date.now() - t0)/1000).toFixed(1)}s (${(raw.length / 1024).toFixed(0)} KB)`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:T.]/g,'-').slice(0,19);
  const outMain   = path.join(OUT_DIR, 'h2-journey-v8.png');
  const outBackup = path.join(OUT_DIR, `h2-journey-v8-${ts}.png`);
  fs.writeFileSync(outMain, raw);
  fs.writeFileSync(outBackup, raw);
  console.log(`Saved: ${outMain}`);
  console.log(`Saved: ${outBackup}`);
}

generate().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
