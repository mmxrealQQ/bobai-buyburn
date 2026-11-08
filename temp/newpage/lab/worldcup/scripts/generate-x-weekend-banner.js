// One-off: weekend-vibes 4-quadrant banner for X-post — BOBAI mascot living its best Friday.
// Landscape 3:2 (1536x1024), gpt-image-2 (opaque hero), no text overlays.
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/generate-x-weekend-banner.js

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const REFS_DIR = path.resolve(__dirname, '..', '_refs');
const OUT_DIR  = 'd:/ai/fourmeme/worldcup';

const REF_MAIN = path.join(REFS_DIR, '1.jpg');
const REF_2    = path.join(REFS_DIR, '2.jpg');
const REF_3    = path.join(REFS_DIR, '3.jpg');
const REF_4    = path.join(REFS_DIR, '4.jpg');

const API_EDIT = 'https://api.openai.com/v1/images/edits';

const PROMPT = `Vibrant 4-panel weekend-vibes collage banner for BOBAI — the same friendly BOBAI cartoon mascot living its best Friday in four different scenarios. ONE single landscape image split into a clean 2x2 grid of four equally sized square panels (top-left, top-right, bottom-left, bottom-right), separated by thin glowing gold dividers (#F0B90B) forming a crisp + cross in the center.

CHARACTER LOCK — CRITICAL: All input images show the SAME BOBAI mascot from different angles. Every BOBAI figure across all four panels must look EXACTLY like the input reference: same friendly cartoon face, same big round eyes, same body proportions, same head shape, same glossy detailed brain on top of the head with subtle holographic RGB highlights (faint cyan/magenta/yellow tints on the brain edges, tasteful — not glitchy). Identical character, only outfit/pose/scenery changes between panels.

NO BANNER TEXT, NO TITLE, NO URL, NO CAPTION, NO WATERMARK. The image must contain absolutely NO floating UI text or letters anywhere — pure visual storytelling.

PANEL 1 — TOP-LEFT — WORLDCUP '26 WATCH PARTY:
Three BOBAI mascots on a cozy couch in a dim living room, glued to a giant flat-screen TV showing a brightly-lit football stadium pitch with tiny generic players. Each BOBAI wears a different generic football jersey (red, yellow, navy — no real club logos). One BOBAI throwing both arms up cheering, mouth wide open in a triumphant shout. Beer bottles and a bowl of popcorn on the coffee table. Soft TV-glow lighting the scene in cool blue. Festive but cozy.

PANEL 2 — TOP-RIGHT — WEEKEND NIGHT OUT:
One BOBAI mascot in a stylish black blazer over a white t-shirt, leaning casually against a glowing neon-lit bar counter holding up a cocktail glass with a cheeky grin. Two more BOBAI mascots dancing in the background under purple-pink-magenta neon disco lights, one with a beer mug, one with arms in the air. Bokeh nightclub atmosphere, neon signage glowing (abstract shapes, NOT readable text), confetti drifting. Vibrant fun party energy, tasteful and playful, not explicit.

PANEL 3 — BOTTOM-LEFT — NATURE WEEKEND:
Two BOBAI mascots outdoors on a sunny alpine adventure. One BOBAI in hiking gear (small backpack, hiking boots, walking stick) standing on a rocky mountain ridge with arms wide open enjoying the view over a vast green valley and snow-capped peaks under a bright blue sky with fluffy clouds. The second BOBAI splashing happily in a crystal-clear turquoise mountain lake nearby, wearing yellow swim shorts and floating on a yellow rubber duck inflatable. Pine trees, wildflowers, warm sunshine, fresh outdoor vibes.

PANEL 4 — BOTTOM-RIGHT — CRYPTO TRADING STATION:
One BOBAI mascot sitting in a high-end black gaming chair at a multi-monitor desk setup — three large curved monitors showing colorful candlestick charts going UP-AND-TO-THE-RIGHT in vivid green, glowing crypto price tickers, abstract glowing BNB-yellow hex/honeycomb patterns. (No readable tickers, no real exchange logos, no real coin names.) BOBAI wearing wireless headphones, both hands raised in a triumphant fist-pump celebration, big grin. A small BNB-yellow logo coin floating in the air. Dark cyberpunk room with BNB-yellow (#F0B90B) RGB rim-lighting glowing behind the desk.

VISUAL STYLE: Cinematic, premium polished cartoon illustration, rich saturated colors, dramatic per-panel lighting, sharp focus, high detail. Same consistent BOBAI character design across all four panels. Each panel has its own distinct color palette but they harmonize — warm/cozy blue (Panel 1), vivid neon purple/magenta (Panel 2), bright natural green/blue (Panel 3), dark cyberpunk yellow/green (Panel 4).

COMPOSITION: Landscape 3:2 aspect ratio, 4 perfectly equal square panels arranged in a clean 2x2 grid, thin glowing gold crosshair divider. Every BOBAI clearly visible, faces well-lit, character design instantly recognizable.

DO NOT include: real brand logos, real club crests, real coin/exchange names, FIFA wordmark, watermarks, dates, URLs, captions, titles, percentages, dollar values, or ANY floating text whatsoever. No realistic human faces — every figure is the cartoon BOBAI mascot.`;

async function loadBuf(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Ref not found: ${filePath}`);
  return fs.readFileSync(filePath);
}

async function generate() {
  const refs = [REF_MAIN, REF_2, REF_3, REF_4];
  const bufs = await Promise.all(refs.map(loadBuf));

  const fd = new FormData();
  fd.append('model', 'gpt-image-2');
  bufs.forEach((buf, i) => {
    fd.append('image[]', new Blob([buf], { type: 'image/jpeg' }), `ref${i+1}.jpg`);
  });
  fd.append('prompt', PROMPT);
  fd.append('size', '1536x1024');
  fd.append('quality', 'high');
  fd.append('n', '1');

  console.log('Calling OpenAI gpt-image-2 (high quality, 1536x1024, 4 refs, weekend 4-panel)...');
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
  const outMain   = path.join(OUT_DIR, 'weekend-vibes-banner.png');
  const outBackup = path.join(OUT_DIR, `weekend-vibes-banner-${ts}.png`);
  fs.writeFileSync(outMain, raw);
  fs.writeFileSync(outBackup, raw);
  console.log(`Saved: ${outMain}`);
  console.log(`Saved: ${outBackup}`);
}

generate().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
