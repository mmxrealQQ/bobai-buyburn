// Test: single BOBAI mascot illustration for the page-polish push.
// Portrait 2:3 (1024x1536), gpt-image-2 high quality, opaque.
// Same 4 char-refs as the weekend-vibes banner so the mascot stays on-model.
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/generate-page-illu-test.js

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const REFS_DIR = path.resolve(__dirname, '..', '_refs');
const OUT_DIR  = path.resolve(__dirname, '..', '..', 'illus');

const REFS = ['1.jpg', '2.jpg', '3.jpg', '4.jpg'].map(f => path.join(REFS_DIR, f));

const API_EDIT = 'https://api.openai.com/v1/images/edits';

// TEST PROMPT — single BOBAI mascot, exchange/listing weekend vibes.
const PROMPT = `Single warm cartoon portrait of the BOBAI mascot character, calm friday-afternoon weekend-vibe energy. ONE BOBAI standing center-frame in a softly lit modern penthouse loft office at golden-hour — large floor-to-ceiling windows behind him glowing warm orange-gold sunset, distant city skyline silhouette, no readable signage.

CHARACTER LOCK — CRITICAL: All input images show the SAME BOBAI mascot from different angles. The BOBAI figure must look EXACTLY like the input reference: same friendly cartoon face, same big round eyes, same body proportions, same head shape, same glossy detailed brain on top of the head with subtle holographic RGB highlights (faint cyan/magenta/yellow tints on the brain edges, tasteful — not glitchy). Identical character.

NO TEXT, NO LOGOS, NO CAPTIONS, NO WATERMARKS, NO URLS, NO PERCENTAGES anywhere in the image — pure visual.

POSE & OUTFIT: BOBAI in smart-casual outfit — open black blazer over a white t-shirt, sleeves rolled. Holding a slim metallic-gold clipboard in one hand, the other hand giving a relaxed thumbs-up gesture toward the viewer. Calm confident smile, eyes slightly crinkled. Standing relaxed, body weight on one leg.

ENVIRONMENT: Warm golden-yellow lighting from sunset windows mixing with a soft BNB-yellow (#F0B90B) accent rim-light from the left side. A floating subtle BNB-yellow hex/honeycomb pattern visible faintly in the background like an ambient hologram. A small holographic floating coin (plain rounded shape, NO letters or symbols) hovers near his clipboard, glowing soft gold.

VISUAL STYLE: Cinematic, premium polished 3D cartoon illustration, rich saturated colors, sharp focus on the character, soft warm bokeh background. Friendly, optimistic, weekend-relaxed mood — not corporate, not stiff. Portrait composition, head and full body fully visible, generous empty space at top and bottom for layout flexibility.

COMPOSITION: Vertical 2:3 portrait. Character centered horizontally, framed roughly from feet to top of brain with breathing room. Background soft and out-of-focus; character is the clear focal point.

DO NOT include: real brand logos, real exchange names, ticker symbols, FIFA wordmark, watermarks, dates, URLs, captions, titles, percentages, dollar values, or ANY floating text whatsoever. No realistic human faces — every figure is the cartoon BOBAI mascot.`;

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
  fd.append('size', '1024x1536');
  fd.append('quality', 'high');
  fd.append('n', '1');

  console.log('Calling OpenAI gpt-image-2 (high, 1024x1536 portrait, 4 refs, listing test)...');
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
  const out = path.join(OUT_DIR, 'test-listing.png');
  fs.writeFileSync(out, raw);
  console.log(`Saved: ${out}`);
}

generate().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
