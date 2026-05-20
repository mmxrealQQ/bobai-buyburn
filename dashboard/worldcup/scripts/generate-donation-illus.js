// Generate 2 BOBAI-style donation illustrations for the TG donation alert.
// Same recipe as generate-cap-modal-illus.js: gpt-image-1 /v1/images/edits
// with 4 character refs, transparent → final 512×512 WEBP.
//
// Run: node -r dotenv/config dashboard/worldcup/scripts/generate-donation-illus.js

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

const SLOTS = {
  'donation-bnb': {
    prompt: `Decorative square illustration of the BOBAI mascot standing next to a large open golden FIFA-style World-Cup-26 trophy. The mascot is happily dropping a single big glossy yellow Binance-style coin (a tilted diamond/rhombus shape with subtle gold-yellow gradient, no logo text) into the open trophy. Soft golden sparkles and tiny floating coins around. Joyful "thank-you" expression on the mascot. Centered, full body mascot. ${STYLE_NOTE}`,
  },
  'donation-usdt': {
    prompt: `Decorative square illustration of the BOBAI mascot standing next to a large open golden FIFA-style World-Cup-26 trophy. The mascot is happily sliding a single crisp green US-dollar-style banknote (no readable text, just abstract green note with subtle "$" mark) into the open trophy. Soft green sparkles and tiny floating banknotes around. Joyful "thank-you" expression on the mascot. Centered, full body mascot. ${STYLE_NOTE}`,
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

  // Resize 1024 → 512 transparent WEBP
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
  for (const [name, spec] of Object.entries(SLOTS)) {
    try { await genOne(name, spec.prompt, charPngs); }
    catch (e) { console.error(`  [fail] ${name}: ${e.message}`); }
  }
  console.log('\nDone. Output: dashboard/worldcup/app/illus/{donation-bnb,donation-usdt}.webp');
})();
