// One-off: generate a tipgame banner for the MAIN dashboard (brainonbnb.com).
// Embedded between the top stats row and the BOB Liq Boost block.
// Landscape 3:2 (1536x1024). Saves to dashboard/worldcup-tipgame-banner.png
// (PNG-to-WebP conversion handled separately by scripts/png-to-webp.js if needed).
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/generate-dashboard-tipgame-banner.js

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const REFS_DIR  = path.resolve(__dirname, '..', '_refs');
const OUT_DIR   = path.resolve(__dirname, '..', '..'); // dashboard/

// Ref 4 is the SOLE character + style anchor (user flagged previous gens as
// "brain doesn't look like the refs"). Using ONLY ref 4, repeated multiple times,
// to maximize visual weight and prevent gpt-image-1 from inventing a generic brain.
const REF_4     = path.join(REFS_DIR, '4.jpg');

const API_EDIT = 'https://api.openai.com/v1/images/edits';

const PROMPT = `Promotional banner for the BOBAI Worldcup '26 Tipgame — a FIFA 2026 World Cup crypto prediction game on BNB Chain.

ABSOLUTE BRAIN + CHARACTER LOCK — THIS IS THE #1 PRIORITY: ALL FIVE reference images are the EXACT SAME CHARACTER — the BOBAI mascot. Every single mascot you draw in this banner MUST have a brain that looks IDENTICAL to the brain in the reference: same shape, same texture, same colour, same surface detail, same proportions, same wrinkles/folds, same glossy highlights. DO NOT invent a different brain. DO NOT simplify it. DO NOT make it generic, smooth, pink-cartoon-style, or any other variation. The brain in the references is the ONLY acceptable brain — copy its visual style precisely as if you were making fan-art of an existing character. Same applies to the face: same eye style, same mouth, same body proportions, same overall rendering. If the reference is illustrated in a specific style (anime / 3D / cartoon / etc.), match THAT exact style. Do not switch styles.

SCENE: A stadium during a BOBAI Worldcup match — composed in two halves:

LEFT HALF — STANDS / FANS: 3 BOBAI fans in stadium seats, cheering. Each wears a different national football kit (e.g. Brazil yellow, Germany white, Argentina sky-blue stripes). One waves a flag, one holds a scarf overhead, one raises both arms. KEEP THE FAN COUNT SMALL so every brain renders clearly.

RIGHT HALF — PITCH / PLAYERS: 3 BOBAI players on the green pitch, mid-action — one kicking a glowing golden football toward camera, one running alongside, one as goalkeeper with gloves in the background. Each wears a different national kit. KEEP THE PLAYER COUNT SMALL so every brain renders clearly.

BACKGROUND: Open-air stadium, warm celebratory lighting. The rendering style, lighting, palette and overall mood must match the reference images exactly — same artistic feel.

TEXT:
- TOP CENTER: "BOBAI WORLDCUP '26" in bold modern sans-serif, metallic gold gradient, large display size, subtle outer glow.
- DIRECTLY BELOW the title, smaller: "TIP · PREDICT · WIN $BOBAI" in clean white sans-serif, well-spaced caps.

COMPOSITION: Landscape 3:2. Wide shot. Total of 6 BOBAI mascots (3 fans + 3 players) — no more — so every face and brain can be rendered with full detail. Leave breathing room around the top title.

DO NOT include: FIFA logo, FIFA wordmark, real sponsor logos, real player faces, realistic human faces, watermarks, dates, or any text besides the two lines specified above. No URL on the banner. Do NOT draw a different brain than the reference shows.`;

async function loadBuf(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Ref not found: ${filePath}`);
  return fs.readFileSync(filePath);
}

async function generate() {
  // ONLY ref 4, repeated 5x. User flagged previous gens (which used 1+3+4 mix) as
  // "brain doesn't look like the refs at all". Going monolithic ref-wise so
  // gpt-image-1 has zero ambiguity about which brain to render.
  const refs = [REF_4, REF_4, REF_4, REF_4, REF_4];
  const bufs = await Promise.all(refs.map(loadBuf));

  const fd = new FormData();
  fd.append('model', 'gpt-image-1');
  bufs.forEach((buf, i) => {
    fd.append('image[]', new Blob([buf], { type: 'image/jpeg' }), `ref${i+1}.jpg`);
  });
  fd.append('prompt', PROMPT);
  fd.append('size', '1536x1024');
  fd.append('quality', 'high');
  fd.append('n', '1');

  console.log('Calling OpenAI gpt-image-1 (high, 1536x1024, ref4×5 monolithic)...');
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
  const outMain   = path.join(OUT_DIR, 'worldcup-tipgame-banner.png');
  const outBackup = path.join(OUT_DIR, `worldcup-tipgame-banner-${ts}.png`);
  fs.writeFileSync(outMain, raw);
  fs.writeFileSync(outBackup, raw);
  console.log(`Saved: ${outMain}`);
  console.log(`Saved: ${outBackup}`);
}

generate().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
