// One-off: generate an image for the X reply to CoinGecko's "best project to buy?" tweet.
// Angle: you don't need to BUY to win — the free $BOBAI World Cup '26 tip game.
// Landscape 3:2 (1536x1024), saves to d:/ai/fourmeme/worldcup/ (NOT deployed).
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/generate-coingecko-reply.js

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const REFS_DIR = path.resolve(__dirname, '..', '_refs');
const OUT_DIR  = 'd:/ai/fourmeme/worldcup';

// Character refs — 1.jpg as MAIN (repeated 3x for weight), others as identity anchors.
const REF_MAIN = path.join(REFS_DIR, '1.jpg');
const REF_2    = path.join(REFS_DIR, '2.jpg');
const REF_3    = path.join(REFS_DIR, 'avatar-DZ.jpg');
const REF_4    = path.join(REFS_DIR, 'argentinia.jpg');

const API_EDIT = 'https://api.openai.com/v1/images/edits';

const PROMPT = `Eye-catching promotional image for a Twitter/X reply — BOBAI Worldcup '26, a FIFA 2026 World Cup crypto prediction tip game on BNB Chain.

CHARACTER LOCK — CRITICAL: All input images show the SAME BOBAI mascot. Images 1, 2 and 3 are the PRIMARY MASTER reference (same hero character) — the mascot MUST look EXACTLY like that: same friendly cartoon face, same big round eyes, same body proportions, same head shape, same glossy detailed brain on top of the head with subtle holographic RGB highlights (faint cyan/magenta/yellow tints on the brain edges, tasteful — not glitchy). Images 4, 5 and 6 are supporting identity anchors. DO NOT mix in other cartoon styles, do not change the face shape, do not alter the brain.

SCENE: A SINGLE BOBAI mascot in a triumphant hero/celebration pose, holding a glowing golden World-Cup-style football trophy aloft with both hands, big confident joyful grin. The mascot wears a sleek gold-and-black football jersey with subtle BNB-yellow accents (a generic team kit — NO real national team, NO real logos).

BACKGROUND: Dramatic night-time football stadium with bright golden-yellow stadium lights, soft bokeh, glowing geometric BNB-chain honeycomb patterns subtly woven into the lighting, gentle floating gold particles and confetti drifting. Atmosphere: epic, premium, celebratory.

COLOR PALETTE: Black/dark-navy base, BOBAI signature gold (#F0B90B) accents, deep BNB yellow highlights. High contrast, vibrant, eye-catching.

TEXT (must be rendered clearly and correctly):
- TOP CENTER: "FREE TO PLAY. WIN $BOBAI." in bold modern sans-serif, metallic gold gradient, large dramatic display size, with a subtle outer glow.
- DIRECTLY BELOW, smaller white sans-serif caps, well-spaced: "WORLD CUP '26 TIP GAME · ON BNB".
- BOTTOM CENTER, prominent and easy to read: "brainonbnb.com/worldcup" in a clean modern white sans-serif, large enough to read on mobile, with a slight gold underline accent.

COMPOSITION: Landscape 3:2 aspect. Single mascot as a strong central focal point, slightly off-center is fine. Highly detailed face. Vibrant, premium feel. Leave clear breathing room around the title at the top and the URL at the bottom so the text reads instantly.

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
  fd.append('size', '1536x1024');
  fd.append('quality', 'high');
  fd.append('n', '1');

  console.log('Calling OpenAI gpt-image-1 (high, 1536x1024, 4 refs)...');
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
  const outMain   = path.join(OUT_DIR, 'coingecko-reply.png');
  const outBackup = path.join(OUT_DIR, `coingecko-reply-${ts}.png`);
  fs.writeFileSync(outMain, raw);
  fs.writeFileSync(outBackup, raw);
  console.log(`Saved: ${outMain}`);
  console.log(`Saved: ${outBackup}`);
}

generate().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
