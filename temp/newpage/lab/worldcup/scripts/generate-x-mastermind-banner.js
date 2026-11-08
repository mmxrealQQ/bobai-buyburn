// X-post hero banner — BOBAI mastermind command center showcasing everything
// the project has shipped. Landscape 3:2 (1536x1024), gpt-image-2 high quality,
// opaque hero, no text. Uses 4 char-refs to lock the BOBAI mascot.
//
// Output: PNG (archival) + JPG (X-upload, C2PA stripped via sharp re-encode).
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/generate-x-mastermind-banner.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const REFS_DIR = path.resolve(__dirname, '..', '_refs');
const OUT_DIR  = 'd:/ai/fourmeme/x-posts';
const REFS = ['1.jpg', '2.jpg', '3.jpg', '4.jpg'].map(f => path.join(REFS_DIR, f));
const API_EDIT = 'https://api.openai.com/v1/images/edits';

const PROMPT = `Cinematic landscape hero shot of the BOBAI mascot character as a confident mastermind in a futuristic premium command center. Wide-angle dramatic composition — BOBAI sits centered in a sleek black leather command chair on a slightly raised platform, leaning forward with elbows on the armrests, hands clasped in front in a confident Tony-Stark pose, a big satisfied grin on his face. Six glowing floating holographic display panels arc around him in a wide semicircle — three on each side at chest height, gently angled toward him — each panel shows ONE of the six BOBAI ventures painted as a clean abstract motif (NO text, NO words, NO numbers, NO logos):

PANEL 1 (far left) — vibrant green candlestick chart climbing up-and-to-the-right, glowing BNB-yellow accents (this is the autonomous buyback bot).

PANEL 2 (left) — bright orange-red flame plumes rising over an abstract coin pile, particles drifting up (this is the burn engine).

PANEL 3 (left of center, slightly forward) — three glossy floating rectangular NFT cards in a fanned-out spread, each with its own color tint (gold, blue, purple), tilted dynamically (this is the Buy Drops NFT collection).

PANEL 4 (right of center, slightly forward) — a glowing soccer ball over a trophy silhouette, soft golden god-rays radiating outward (this is the WC26 Worldcup Tipgame).

PANEL 5 (right) — a stylized retro arcade-machine outline with a colorful pixel-art-game screen showing abstract zig-zag platforms and tiny shapes (this is the browser game).

PANEL 6 (far right) — three angular glowing hexagonal chat-bubble shapes stacked vertically, soft blue glow (this is the Telegram bot).

CHARACTER LOCK — CRITICAL: All input images show the SAME BOBAI mascot from different angles. The BOBAI figure must look EXACTLY like the input reference: same friendly cartoon face, same big round eyes, same body proportions, same head shape, same glossy detailed brain on top of the head with subtle holographic RGB highlights (faint cyan/magenta/yellow tints on the brain edges, tasteful — not glitchy). Identical character.

OUTFIT: BOBAI wears a sleek black leather jacket over a heather-gray t-shirt, dark trousers, confident commander vibe.

ENVIRONMENT: Dark cyberpunk command-center floor with soft BNB-yellow (#F0B90B) rim-lighting glowing from below the chair platform and tracing the edges of the holographic panels. A subtle BNB-yellow holographic hexagon honeycomb grid faintly visible in the deep background. Volumetric god-rays from above the central seat. Particles drift gently. Atmospheric depth.

VISUAL STYLE: Cinematic, premium polished 3D cartoon illustration, rich saturated colors, dramatic lighting, ultra-sharp focus on BOBAI, soft glowing bokeh on the panels and background. Confident and triumphant mood, not aggressive — calm mastermind energy. The six holographic panels each glow with their own color palette but harmonize: green/yellow, orange/red, gold/blue/purple, gold, multicolor pixel, soft blue.

COMPOSITION: Landscape 3:2 aspect ratio. BOBAI dead-center, three panels left + three panels right at chest height arcing around him. Camera at slight low angle looking up to emphasize hero status. Generous empty space top and bottom for layout flexibility.

NO TEXT, NO LOGOS, NO CAPTIONS, NO WATERMARKS, NO URLS, NO TICKER SYMBOLS, NO READABLE LETTERS OR NUMBERS anywhere — pure visual storytelling. No FIFA wordmark, no exchange names, no real club crests, no realistic human faces.`;

async function loadBuf(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Ref not found: ${filePath}`);
  return fs.readFileSync(filePath);
}

async function generate() {
  const bufs = await Promise.all(REFS.map(loadBuf));

  const fd = new FormData();
  fd.append('model', 'gpt-image-2');
  bufs.forEach((buf, i) => {
    fd.append('image[]', new Blob([buf], { type: 'image/jpeg' }), `ref${i+1}.jpg`);
  });
  fd.append('prompt', PROMPT);
  fd.append('size', '1536x1024');
  fd.append('quality', 'high');
  fd.append('n', '1');

  console.log('Calling OpenAI gpt-image-2 (high quality, 1536x1024 mastermind banner)...');
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
  const outPng  = path.join(OUT_DIR, `mastermind-${ts}.png`);
  const outJpg  = path.join(OUT_DIR, `mastermind-${ts}.jpg`);
  fs.writeFileSync(outPng, raw);
  // Re-encode to JPG and strip metadata — kills C2PA so X doesn't slap a
  // "Made with AI" label on the post ([[feedback_x_ai_label_strip]]).
  const jpg = await sharp(raw).jpeg({ quality: 92, mozjpeg: true }).withMetadata({}).toBuffer();
  fs.writeFileSync(outJpg, jpg);
  console.log(`Saved (PNG, archival): ${outPng}`);
  console.log(`Saved (JPG, X-ready):  ${outJpg}`);
}

generate().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
