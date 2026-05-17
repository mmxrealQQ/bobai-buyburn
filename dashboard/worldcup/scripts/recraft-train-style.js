// Train a Recraft brand style from reference images in /_refs/.
// Usage: node -r dotenv/config dashboard/worldcup/scripts/recraft-train-style.js
//
// Reads RECRAFT_API_KEY from .env, uploads all images from dashboard/worldcup/_refs/,
// prints the returned style_id, and appends it to .env as RECRAFT_STYLE_ID=...

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const API_KEY = process.env.RECRAFT_API_KEY;
if (!API_KEY) {
  console.error('Missing RECRAFT_API_KEY in .env');
  process.exit(1);
}

const REFS_DIR = path.resolve(__dirname, '..', '_refs');
const ENV_PATH = path.resolve(__dirname, '..', '..', '..', '.env');
const BASE_STYLE = 'digital_illustration';
const API_URL = 'https://external.api.recraft.ai/v1/styles';

async function main() {
  if (!fs.existsSync(REFS_DIR)) {
    console.error(`Refs folder not found: ${REFS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(REFS_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .map(f => path.join(REFS_DIR, f));

  if (files.length < 1 || files.length > 5) {
    console.error(`Recraft expects 1-5 reference images, found ${files.length}`);
    process.exit(1);
  }

  console.log('=================================');
  console.log('Recraft Brand Style Training');
  console.log('Base style:', BASE_STYLE);
  console.log('Reference images:');
  for (const f of files) console.log('  -', path.basename(f), `(${(fs.statSync(f).size / 1024).toFixed(0)} KB)`);
  console.log('=================================\n');

  const fd = new FormData();
  fd.append('style', BASE_STYLE);
  fd.append('model', 'recraftv3');
  for (const f of files) {
    const raw = fs.readFileSync(f);
    const img = sharp(raw);
    const meta = await img.metadata();
    let buf = raw;
    let outName = path.basename(f);
    let mime = 'image/png';
    if ((meta.width || 0) < 256 || (meta.height || 0) < 256) {
      // Upscale to 512x512 PNG so it meets Recraft's minimum dimension rule.
      buf = await img.resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toBuffer();
      outName = path.basename(f, path.extname(f)) + '-512.png';
      console.log(`  (upscaled ${path.basename(f)} ${meta.width}x${meta.height} -> 512x512)`);
    } else {
      const ext = path.extname(f).slice(1).toLowerCase();
      mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    }
    fd.append('files', new Blob([buf], { type: mime }), outName);
  }

  console.log('Uploading...');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: fd,
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}:`, text);
    process.exit(1);
  }

  const json = JSON.parse(text);
  const styleId = json.id;
  if (!styleId) {
    console.error('No style id in response:', json);
    process.exit(1);
  }

  console.log('\nStyle trained!');
  console.log('  id:', styleId);

  // Append or update RECRAFT_STYLE_ID in .env
  let env = fs.readFileSync(ENV_PATH, 'utf8');
  if (/^RECRAFT_STYLE_ID=/m.test(env)) {
    env = env.replace(/^RECRAFT_STYLE_ID=.*$/m, `RECRAFT_STYLE_ID=${styleId}`);
  } else {
    if (!env.endsWith('\n')) env += '\n';
    env += `RECRAFT_STYLE_ID=${styleId}\n`;
  }
  fs.writeFileSync(ENV_PATH, env);
  console.log('  Saved to .env as RECRAFT_STYLE_ID');
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
