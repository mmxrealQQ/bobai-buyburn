// Generate the remaining 3 hero illustrations for brainonbnb pages
// (dashboard-hero, nft-hero, whitepaper-hero). Each one matches the
// listing-hero.png style — single BOBAI mascot, weekend-vibe, portrait 2:3,
// gpt-image-2 high quality, opaque. Run sequentially (rate-limit friendly).
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/generate-page-illus-batch.js
//   node -r dotenv/config dashboard/worldcup/scripts/generate-page-illus-batch.js dashboard-hero    # just one slot

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const REFS_DIR = path.resolve(__dirname, '..', '_refs');
const OUT_DIR  = path.resolve(__dirname, '..', '..', 'illus');

const REFS = ['1.jpg', '2.jpg', '3.jpg', '4.jpg'].map(f => path.join(REFS_DIR, f));
const API_EDIT = 'https://api.openai.com/v1/images/edits';

const CHARACTER_LOCK = `CHARACTER LOCK — CRITICAL: All input images show the SAME BOBAI mascot from different angles. The BOBAI figure must look EXACTLY like the input reference: same friendly cartoon face, same big round eyes, same body proportions, same head shape, same glossy detailed brain on top of the head with subtle holographic RGB highlights (faint cyan/magenta/yellow tints on the brain edges, tasteful — not glitchy). Identical character.

NO TEXT, NO LOGOS, NO CAPTIONS, NO WATERMARKS, NO URLS, NO PERCENTAGES, NO READABLE TICKER SYMBOLS anywhere in the image — pure visual.

VISUAL STYLE: Cinematic, premium polished 3D cartoon illustration, rich saturated colors, sharp focus on the character, soft warm bokeh background. Friendly, optimistic, weekend-relaxed mood — not corporate, not stiff. Portrait composition, head and full body fully visible, generous empty space at top and bottom for layout flexibility.

COMPOSITION: Vertical 2:3 portrait. Character centered horizontally, framed roughly from feet to top of brain with breathing room. Background soft and out-of-focus; character is the clear focal point.

DO NOT include: real brand logos, real exchange names, ticker symbols, FIFA wordmark, watermarks, dates, URLs, captions, titles, percentages, dollar values, or ANY floating text whatsoever. No realistic human faces — every figure is the cartoon BOBAI mascot.`;

const SLOTS = {
  'dashboard-hero': `Single warm cartoon portrait of the BOBAI mascot character, calm friday-afternoon weekend-vibe energy. ONE BOBAI standing center-frame as a relaxed autonomous AI overseer in a softly lit modern living space at golden-hour — a floor-to-ceiling window behind him with warm gold-orange dusk light, distant city skyline silhouette in soft bokeh, indoor pothos and monstera plants framing the edges.

POSE & OUTFIT: BOBAI in cozy weekend wear — open beige cardigan over a plain heather-grey t-shirt, soft drawstring chinos, slip-on sneakers. Holding a steaming ceramic mug in one hand (no readable logo on the mug), other hand resting in pocket. Warm contented smile, body weight relaxed on one leg, looking slightly off-camera with a thoughtful expression. A subtle BNB-yellow holographic data-stream glow gently swirls around him in the background, soft and unobtrusive.

LIGHTING: Warm golden-yellow sunset key light from the window mixing with a soft BNB-yellow (#F0B90B) accent rim-light. Cozy mood, not dramatic.

${CHARACTER_LOCK}`,

  'nft-hero': `Single warm cartoon portrait of the BOBAI mascot character, calm collector / curator weekend-vibe energy. ONE BOBAI standing center-frame in a softly lit modern gallery-style living room — exposed-brick wall behind him with several rectangular and square framed art pieces hanging at slight tilted angles (the canvases inside the frames are abstract gold/cyan/magenta gradient swatches, NO recognizable images, NO readable text), warm pendant lights overhead casting cozy spotlights on the frames.

POSE & OUTFIT: BOBAI in smart-casual collector outfit — relaxed navy cardigan over a crisp white tee, dark jeans, slip-on loafers. One hand thoughtfully cradling a small softly-glowing diamond-shaped gem (plain faceted shape, NO letters or symbols), the other hand gesturing slightly toward one of the framed pieces, head tilted in approving admiration. Calm satisfied smile. A few subtle floating sparkle particles drift around the gem.

LIGHTING: Warm gallery pendant light from above mixing with a soft BNB-yellow (#F0B90B) accent rim-light from the left. Cozy art-collector mood.

${CHARACTER_LOCK}`,

  'whitepaper-hero': `Single warm cartoon portrait of the BOBAI mascot character, calm builder / architect weekend-vibe energy. ONE BOBAI standing center-frame at a softly lit wooden study desk in a cozy library-loft — wall-to-wall bookshelves filled with hardcover books in muted browns/greens/blues behind him (NO readable spine text), a brass desk lamp glowing warm on the desk, a vintage globe and a small potted succulent on the desk corner.

POSE & OUTFIT: BOBAI in scholarly weekend wear — open dark-green flannel shirt over a white tee, sleeves rolled to the elbows, dark chinos, brown leather slip-on shoes. Round wire-frame glasses perched on his round face (over the cartoon eyes). Holding a rolled-up architectural blueprint scroll in one hand (the visible roll edge has soft abstract blue lines, NO readable text), other hand resting on the desk near a quill pen and inkwell. Thoughtful confident smile, looking slightly off-camera as if mid-thought.

LIGHTING: Warm brass desk-lamp glow mixing with soft daylight from an off-frame window and a subtle BNB-yellow (#F0B90B) accent rim-light. Quiet thinker mood.

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
  fd.append('size', '1024x1536');
  fd.append('quality', 'high');
  fd.append('n', '1');

  console.log(`[${slot}] Calling OpenAI gpt-image-2 ...`);
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
  console.log(`[${slot}] Got image in ${((Date.now() - t0)/1000).toFixed(1)}s (${(raw.length / 1024).toFixed(0)} KB)`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${slot}.png`);
  fs.writeFileSync(out, raw);
  console.log(`[${slot}] Saved: ${out}`);
}

async function main() {
  const only = process.argv[2];  // optional: just one slot name
  const targets = only ? [only] : Object.keys(SLOTS);
  if (targets.some(s => !SLOTS[s])) {
    console.error(`Unknown slot. Known: ${Object.keys(SLOTS).join(', ')}`);
    process.exit(1);
  }
  const bufs = await Promise.all(REFS.map(loadBuf));
  // Run in parallel — OpenAI image-edit allows concurrent calls.
  await Promise.all(targets.map(s => generate(s, SLOTS[s], bufs)));
}

main().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
