// Generate 3 BOBAI-style illustrations for the cap-explainer modal.
// Same recipe as openai-generate-illustrations.js: gpt-image-1 /v1/images/edits
// with 4 character refs, transparent PNG, 512×512 final.
//
// Run: node -r dotenv/config dashboard/worldcup/scripts/generate-cap-modal-illus.js

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
  'wallet-overflow': {
    prompt: `Decorative square illustration of the BOBAI mascot looking curiously and slightly amused at a small glossy gold wallet that is clearly overflowing — bright golden coins (each with a subtle pink-and-cyan brain emblem) gently spilling out of the top and gathering at the wallet's base. The wallet has a tiny lock icon on its front, visibly "full to the brim". Centered, full body mascot, expressive face. ${STYLE_NOTE}`,
  },
  'wallet-cascade': {
    prompt: `Decorative square illustration of the BOBAI mascot in a guiding / conductor pose, both hands gently directing a glowing flowing arc of golden coins (each with a faint pink-and-cyan brain emblem) that streams from a small full wallet on the upper-left, curves gracefully through the air, and lands into a slightly larger open wallet on the lower-right. Friendly explainer expression, slight smile. Centered, full body mascot. ${STYLE_NOTE}`,
  },
  'liquidity-lock': {
    prompt: `Decorative square illustration of the BOBAI mascot calmly placing a large glossy golden padlock onto the lid of a glowing wooden treasure chest filled with pink-and-cyan brain-shaped BOBAI tokens. A thin chain wraps around the chest. Soft sparkles in the air suggest "permanent / forever". Reverent but content expression, both hands working the padlock. Centered, full body mascot. ${STYLE_NOTE}`,
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

  // Resize 1024 → 512 transparent PNG
  const out = await sharp(raw)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
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
  console.log('\nDone. Output: dashboard/worldcup/app/illus/{wallet-overflow,wallet-cascade,liquidity-lock}.png');
})();
