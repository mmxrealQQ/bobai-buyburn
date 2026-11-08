// Mini BOBAI stickers — small transparent character poses for card accents.
// Square 1024x1024, gpt-image-2, transparent background attempted.
// Saves to the SESSION SCRATCHPAD (NOT to /dashboard/illus/) so you can preview
// before they ship. Per feedback [[test-images-local]].
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/generate-mini-stickers.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const REFS_DIR = path.resolve(__dirname, '..', '_refs');
const OUT_DIR  = path.resolve(__dirname, '..', '..', 'illus', 'stickers');

const REFS = ['1.jpg', '2.jpg', '3.jpg', '4.jpg'].map(f => path.join(REFS_DIR, f));
const API_EDIT = 'https://api.openai.com/v1/images/edits';

const CHARACTER_LOCK = `CHARACTER LOCK — CRITICAL: All input images show the SAME BOBAI mascot from different angles. The BOBAI figure must look EXACTLY like the input reference: same friendly cartoon face, same big round eyes, same body proportions, same head shape, same glossy detailed brain on top of the head with subtle holographic RGB highlights (faint cyan/magenta/yellow tints on the brain edges, tasteful — not glitchy). Identical character.

NO TEXT, NO LOGOS, NO CAPTIONS, NO WATERMARKS, NO URLS anywhere — pure visual.

DO NOT include: real brand logos, ticker symbols, watermarks, dates, URLs, captions, percentages, or ANY floating text whatsoever. No realistic human faces.`;

const STYLE = `STYLE: clean polished 3D cartoon sticker illustration, vibrant saturated colors, sharp focus, single character isolated on a fully transparent background. NO shadow on the ground, NO scenery, NO background elements, NO floor — only the BOBAI character cleanly cut out. Soft inner glow around the character body for that "sticker" feel. Studio-clean rendering.

COMPOSITION: Square format. Character centered, full-body visible from head (top of brain) to feet with small margin around all sides. The BACKGROUND MUST BE FULLY TRANSPARENT — no color, no gradient, no painted backdrop.`;

const SLOTS = {
  'sticker-thumbs-up': `Single small cartoon sticker of the BOBAI mascot character, full body, giving a big enthusiastic thumbs-up gesture toward the viewer with one hand, other hand on hip, big bright friendly smile. Standing tall confident pose. Wearing a clean white t-shirt and simple dark blue jeans.

${STYLE}

${CHARACTER_LOCK}`,

  'sticker-thinker': `Single small cartoon sticker of the BOBAI mascot character, full body, in a classic "thinking" pose — one hand under the chin / fingers on cheek, head tilted slightly, eyes looking up to the side in thought, slight contemplative smile. Standing relaxed. Wearing a soft beige cardigan over a white tee, simple dark trousers, casual shoes.

${STYLE}

${CHARACTER_LOCK}`,

  'sticker-celebrate': `Single small cartoon sticker of the BOBAI mascot character, full body, both arms raised triumphantly straight up in a celebratory cheer, mouth wide open in a big joyful shout, eyes squinting with happiness. Standing on tiptoes with energetic excited body language. Wearing a clean white t-shirt and dark joggers.

${STYLE}

${CHARACTER_LOCK}`,

  'sticker-collector': `Single small cartoon sticker of the BOBAI mascot character, full body, holding a small softly-glowing diamond-shaped gem in his open palm in front of him at chest height (plain faceted gem shape, NO letters or symbols, soft yellow-gold inner glow). Looking down at the gem with a delighted gentle smile, slight head tilt. Standing relaxed. Wearing a navy cardigan over a white tee, dark jeans.

${STYLE}

${CHARACTER_LOCK}`,
};

async function loadBuf(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Ref not found: ${filePath}`);
  return fs.readFileSync(filePath);
}

async function generate(slot, prompt, refBufs) {
  const fd = new FormData();
  fd.append('model', 'gpt-image-2');
  refBufs.forEach((buf, i) => {
    fd.append('image[]', new Blob([buf], { type: 'image/jpeg' }), `ref${i+1}.jpg`);
  });
  fd.append('prompt', prompt);
  fd.append('size', '1024x1024');
  fd.append('quality', 'high');
  fd.append('background', 'transparent');
  fd.append('n', '1');

  console.log(`[${slot}] Calling OpenAI gpt-image-2 (transparent)...`);
  const t0 = Date.now();
  const res = await fetch(API_EDIT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) {
    console.log(`[${slot}] gpt-image-2 transparent failed: HTTP ${res.status}: ${text.slice(0, 200)}`);
    console.log(`[${slot}] Falling back to gpt-image-1.5 ...`);
    // Retry with gpt-image-1.5 (memory says it supports transparent reliably)
    const fd2 = new FormData();
    fd2.append('model', 'gpt-image-1.5');
    refBufs.forEach((buf, i) => {
      fd2.append('image[]', new Blob([buf], { type: 'image/jpeg' }), `ref${i+1}.jpg`);
    });
    fd2.append('prompt', prompt);
    fd2.append('size', '1024x1024');
    fd2.append('quality', 'high');
    fd2.append('background', 'transparent');
    fd2.append('n', '1');
    const r2 = await fetch(API_EDIT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: fd2,
    });
    const t2 = await r2.text();
    if (!r2.ok) throw new Error(`Both models failed. gpt-image-1.5: HTTP ${r2.status}: ${t2.slice(0, 300)}`);
    const j2 = JSON.parse(t2);
    const b64 = j2?.data?.[0]?.b64_json;
    if (!b64) throw new Error(`No image in response: ${t2.slice(0, 200)}`);
    const raw = Buffer.from(b64, 'base64');
    console.log(`[${slot}] (1.5) Got image in ${((Date.now() - t0)/1000).toFixed(1)}s (${(raw.length / 1024).toFixed(0)} KB)`);
    return raw;
  }
  const json = JSON.parse(text);
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`No image in response: ${text.slice(0, 200)}`);
  const raw = Buffer.from(b64, 'base64');
  console.log(`[${slot}] (2.0) Got image in ${((Date.now() - t0)/1000).toFixed(1)}s (${(raw.length / 1024).toFixed(0)} KB)`);
  return raw;
}

async function main() {
  const only = process.argv[2];
  const targets = only ? [only] : Object.keys(SLOTS);
  if (targets.some(s => !SLOTS[s])) {
    console.error(`Unknown slot. Known: ${Object.keys(SLOTS).join(', ')}`);
    process.exit(1);
  }
  const bufs = await Promise.all(REFS.map(loadBuf));
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  await Promise.all(targets.map(async slot => {
    const raw = await generate(slot, SLOTS[slot], bufs);
    // Save both: full-res PNG (archival) + downscaled WebP (production use as sticker).
    const outPng  = path.join(OUT_DIR, `${slot}.png`);
    const outWebp = path.join(OUT_DIR, `${slot}.webp`);
    fs.writeFileSync(outPng, raw);
    const webp = await sharp(raw)
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 88, alphaQuality: 92 })
      .toBuffer();
    fs.writeFileSync(outWebp, webp);
    console.log(`[${slot}] Saved: ${outPng}  (${(raw.length/1024).toFixed(0)} KB)`);
    console.log(`[${slot}] Saved: ${outWebp} (${(webp.length/1024).toFixed(0)} KB)`);
  }));
}

main().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
