// Generate the Group-Pot Receipt modal illustration.
// Same recipe as generate-cap-modal-illus.js: gpt-image-1 /v1/images/edits,
// 4 character refs, transparent PNG, 512×512 final.
//
// Run: node -r dotenv/config dashboard/worldcup/scripts/generate-receipt-illus.js

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
  'receipt-payout': {
    prompt: `Decorative square illustration of the BOBAI mascot in a ceremonial "winners paid" pose: standing proudly, holding up a large official-looking receipt scroll in one hand. The scroll has a small visible green checkmark seal at the bottom and a faint glow. Around the mascot, golden coins (each with a faint pink-and-cyan brain emblem) float gracefully in the air like confetti. Soft green sparkles suggest "transaction confirmed". Friendly content expression with a small celebratory smile. Centered, full body mascot. ${STYLE_NOTE}`,
  },
};

async function pngBuffer(filePath) {
  return await sharp(fs.readFileSync(filePath)).png().toBuffer();
}

async function genOne(name, prompt, charPngs) {
  const outPath = path.join(ILLUS_DIR, `${name}.png`);
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
    .png()
    .toBuffer();
  fs.writeFileSync(outPath, out);

  // Also write a WebP companion (the cap modal uses both)
  const webp = await sharp(out).webp({ quality: 90 }).toBuffer();
  fs.writeFileSync(path.join(ILLUS_DIR, `${name}.webp`), webp);
  console.log(`  [ok]  ${name} → ${(out.length/1024).toFixed(0)} KB png · ${(webp.length/1024).toFixed(0)} KB webp`);
}

(async () => {
  if (CHAR_REFS.length < 2) { console.error(`Need ≥2 char refs, got ${CHAR_REFS.length}`); process.exit(1); }
  const charPngs = await Promise.all(CHAR_REFS.map(pngBuffer));
  for (const [name, spec] of Object.entries(SLOTS)) {
    try { await genOne(name, spec.prompt, charPngs); }
    catch (e) { console.error(`  [fail] ${name}: ${e.message}`); }
  }
  console.log('\nDone. Output: dashboard/worldcup/app/illus/receipt-payout.{png,webp}');
})();
