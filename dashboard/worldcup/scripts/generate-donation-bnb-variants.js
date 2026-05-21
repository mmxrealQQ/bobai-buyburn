// Generate 2 candidate variants of donation-bnb.webp.
// Previous render cropped the trophy — this script enforces full-frame
// composition and emits v1/v2 so the user can pick the better one.
//
// Run: node -r dotenv/config dashboard/worldcup/scripts/generate-donation-bnb-variants.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const ILLUS_DIR = path.resolve(__dirname, '..', 'app', 'illus');
const REF_DIR   = path.resolve(__dirname, '..', '_refs');
const CHAR_REFS = [
  path.join(REF_DIR, 'avatar-DZ.jpg'),
  path.join(REF_DIR, 'argentinia.jpg'),
  path.join(REF_DIR, '1.jpg'),
  path.join(REF_DIR, '2.jpg'),
].filter(p => fs.existsSync(p));

const STYLE_NOTE = `The BOBAI mascot identity MUST stay identical to the references: same friendly body, same face, signature glossy brain on top with subtle holographic RGB highlights (faint cyan, magenta and yellow tints on the brain edges). Style: friendly cartoon mascot, vibrant but tasteful, dark-mode compatible. Plain transparent background. No text, no wordmarks, no FIFA branding.`;

const FRAMING_NOTE = `CRITICAL FRAMING: The composition must be a centered square with generous padding (at least 8% margin) on ALL four sides. The complete golden FIFA-style World-Cup-26 trophy MUST be fully visible from its base to the very top tip — never cropped at the top, sides, or bottom. The mascot MUST be fully visible from head to feet, standing next to the trophy. Both subjects together fit comfortably inside the square frame.`;

const VARIANTS = {
  'donation-bnb-v1': {
    prompt: `Decorative square illustration. Composition: the BOBAI mascot stands on the LEFT, the golden FIFA-style World-Cup-26 trophy stands on the RIGHT, both at similar height. The mascot is happily tossing a single big glossy yellow Binance-style coin (a tilted diamond/rhombus shape with subtle gold-yellow gradient, no logo text) toward the open top of the trophy. Soft golden sparkles and tiny floating coins around. Joyful "thank-you" expression on the mascot. ${FRAMING_NOTE} ${STYLE_NOTE}`,
  },
  'donation-bnb-v2': {
    prompt: `Decorative square illustration. Composition: the golden FIFA-style World-Cup-26 trophy is centered slightly behind the BOBAI mascot, both fully visible. The mascot is in the foreground holding up a single big glossy yellow Binance-style coin (a tilted diamond/rhombus shape with subtle gold-yellow gradient, no logo text), about to drop it into the open top of the trophy. Soft golden sparkles and tiny floating coins around. Joyful "thank-you" expression on the mascot. ${FRAMING_NOTE} ${STYLE_NOTE}`,
  },
};

async function pngBuffer(filePath) {
  return await sharp(fs.readFileSync(filePath)).png().toBuffer();
}

async function genOne(name, prompt, charPngs) {
  const outPath = path.join(ILLUS_DIR, `${name}.webp`);
  console.log(`  [gen] ${name}…`);
  const fd = new FormData();
  fd.append('model', 'gpt-image-1');
  charPngs.forEach((png, i) => {
    fd.append('image[]', new Blob([png], { type: 'image/png' }), `character${i+1}.png`);
  });
  fd.append('prompt', prompt);
  fd.append('size', '1024x1024');
  fd.append('quality', 'high');
  fd.append('background', 'transparent');
  fd.append('n', '1');

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${text.slice(0, 400)}`);
  const json = JSON.parse(text);
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image in response');
  const raw = Buffer.from(b64, 'base64');

  const out = await sharp(raw)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 90 })
    .toBuffer();
  fs.writeFileSync(outPath, out);
  console.log(`  [ok]  ${name} → ${(out.length/1024).toFixed(0)} KB`);
}

(async () => {
  if (CHAR_REFS.length < 2) { console.error(`Need ≥2 char refs, got ${CHAR_REFS.length}`); process.exit(1); }
  const charPngs = await Promise.all(CHAR_REFS.map(pngBuffer));
  for (const [name, spec] of Object.entries(VARIANTS)) {
    try { await genOne(name, spec.prompt, charPngs); }
    catch (e) { console.error(`  [fail] ${name}: ${e.message}`); }
  }
  console.log('\nDone. Variants in dashboard/worldcup/app/illus/{donation-bnb-v1,donation-bnb-v2}.webp');
  console.log('Compare them, then I will copy the chosen one over donation-bnb.webp.');
})();
