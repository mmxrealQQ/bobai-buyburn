// One-off: generate a promotional banner for the BOBAI Worldcup '26 X post.
// Landscape 3:2 (1536x1024), saves to:
//   1. d:/ai/fourmeme/worldcup/worldcup-x-promo.png  (extra copy, NOT deployed)
//   2. d:/ai/fourmeme/worldcup/worldcup-x-promo-<timestamp>.png  (backup w/ timestamp)
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/generate-x-promo-banner.js

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const REFS_DIR  = path.resolve(__dirname, '..', '_refs');
const OUT_DIR   = 'd:/ai/fourmeme/worldcup';

// Character refs — 1.jpg as MAIN, others as supporting identity anchors
const REF_MAIN  = path.join(REFS_DIR, '1.jpg');
const REF_2     = path.join(REFS_DIR, '2.jpg');
const REF_3     = path.join(REFS_DIR, 'avatar-DZ.jpg');
const REF_4     = path.join(REFS_DIR, 'argentinia.jpg');

const API_EDIT = 'https://api.openai.com/v1/images/edits';

const PROMPT = `Cinematic promotional banner for BOBAI Worldcup '26 — a FIFA 2026 World Cup crypto prediction tipgame on BNB Chain.

CHARACTER LOCK — CRITICAL: All input images show the SAME BOBAI mascot from different angles. Images 1, 2 and 3 are the PRIMARY MASTER CHARACTER SHEET (the same hero shot) — every mascot in the banner must look EXACTLY like that character: same friendly cartoon face, same big round eyes, same body proportions, same head shape, same glossy detailed brain on top of the head with subtle holographic RGB highlights (faint cyan/magenta/yellow tints on the brain edges, tasteful — not glitchy). Images 4, 5 and 6 are supporting identity anchors that confirm this same character. DO NOT mix in other cartoon styles, do not change the face shape, do not alter the brain. The mascot's face and brain must be CONSISTENT and identical across all eight figures in the banner — same character, just different national jerseys.

SCENE: A wide group of EIGHT BOBAI mascots stand together in a triumphant hero pose, arranged in a slight V-formation (lead mascot front-center, the others fanned out behind to the sides). Each mascot wears a DIFFERENT national football team home kit:
1. BRAZIL — bright canary yellow jersey with green collar, blue shorts
2. GERMANY — white jersey with black trim and shorts
3. ARGENTINA — sky-blue and white vertical stripes
4. FRANCE — navy blue jersey with white shorts and red socks
5. ENGLAND — all white with navy blue trim
6. SWITZERLAND — red jersey with a large white Swiss cross on the chest
7. JAPAN — dark navy blue with subtle white trim
8. MEXICO — green jersey with white shorts and red socks

The LEAD mascot (front-center, slightly larger) holds a glowing golden football aloft like a trophy. The other seven cheer or hold smaller footballs.

BACKGROUND: Dramatic night-time football stadium with bright golden-yellow stadium lights, soft bokeh, glowing geometric BNB-chain-style honeycomb patterns subtly woven into the lighting, gentle floating particle effects, confetti drifting. Atmosphere: epic, premium, celebratory.

COLOR PALETTE: Black/dark-navy base, BOBAI signature gold (#F0B90B) accents, deep BNB yellow highlights, with vivid jersey colors popping (yellow, green, blue, red, white). High contrast, vibrant.

TEXT (must be rendered clearly and correctly):
- TOP CENTER: "BOBAI WORLDCUP '26" in bold modern sans-serif, metallic gold gradient, large dramatic display size, with a subtle outer glow.
- DIRECTLY BELOW the title, smaller: "TIP · PREDICT · WIN $BOBAI" in clean white sans-serif, well-spaced caps.
- BOTTOM CENTER, prominent and easy to read: "brainonbnb.com/worldcup" in a clean modern white sans-serif. Make this URL visually stand out — large enough to read on a mobile screen, with a slight gold underline accent.

COMPOSITION: Landscape 3:2 aspect. Cinematic group shot. Eight mascots clearly visible and distinguishable. Strong central focal point on the lead mascot. Symmetrical group composition. Highly detailed faces. Vibrant, eye-catching, premium feel. Leave breathing room around the title at the top and the URL at the bottom so the text reads instantly.

DO NOT include: FIFA logo, FIFA wordmark, real sponsor logos, real player faces, realistic human faces, watermarks, dates, or any other text besides the three lines specified above.`;

async function loadBuf(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Ref not found: ${filePath}`);
  return fs.readFileSync(filePath);
}

async function generate() {
  // REF_MAIN repeated 3x to give it ~3x the visual weight as the character anchor.
  const refs = [REF_MAIN, REF_MAIN, REF_MAIN, REF_2, REF_3, REF_4];
  const bufs = await Promise.all(refs.map(loadBuf));

  const fd = new FormData();
  fd.append('model', 'gpt-image-1');
  bufs.forEach((buf, i) => {
    fd.append('image[]', new Blob([buf], { type: 'image/jpeg' }), `ref${i+1}.jpg`);
  });
  fd.append('prompt', PROMPT);
  fd.append('size', '1536x1024');     // landscape 3:2
  fd.append('quality', 'high');
  fd.append('n', '1');

  console.log('Calling OpenAI gpt-image-1 (high quality, 1536x1024, 4 refs)...');
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
  const outMain   = path.join(OUT_DIR, 'worldcup-x-promo.png');
  const outBackup = path.join(OUT_DIR, `worldcup-x-promo-${ts}.png`);
  fs.writeFileSync(outMain, raw);
  fs.writeFileSync(outBackup, raw);
  console.log(`Saved: ${outMain}`);
  console.log(`Saved: ${outBackup}`);
}

generate().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
