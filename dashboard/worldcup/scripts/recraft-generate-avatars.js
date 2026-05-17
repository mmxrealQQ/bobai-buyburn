// Generate BOBAI country avatars via Recraft API using IMAGE-TO-IMAGE.
// Uses avatar-DZ.jpg (designer-made Algeria) as the character anchor and
// re-skins it into each country's kit, with the trained brand style on top.
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/recraft-generate-avatars.js               # all 48
//   node -r dotenv/config dashboard/worldcup/scripts/recraft-generate-avatars.js BR DE FR     # selected
//   node -r dotenv/config dashboard/worldcup/scripts/recraft-generate-avatars.js --force BR    # overwrite existing
//   node -r dotenv/config dashboard/worldcup/scripts/recraft-generate-avatars.js --strength=0.55 BR
//
// Pipeline per country: image-to-image (1024x1024) -> background removal -> resize to 512x512 -> save PNG

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const API_KEY = process.env.RECRAFT_API_KEY;
const STYLE_ID = process.env.RECRAFT_STYLE_ID;
if (!API_KEY) { console.error('Missing RECRAFT_API_KEY'); process.exit(1); }
if (!STYLE_ID) { console.error('Missing RECRAFT_STYLE_ID'); process.exit(1); }

const COUNTRIES_JS = path.resolve(__dirname, '..', 'app', 'assets', 'countries.js');
const AVATARS_DIR  = path.resolve(__dirname, '..', 'app', 'illus', 'avatars');
const ANCHOR_IMG   = path.resolve(__dirname, '..', 'app', 'illus', 'avatars', 'avatar-DZ.jpg');
const API_I2I = 'https://external.api.recraft.ai/v1/images/imageToImage';
const API_BG  = 'https://external.api.recraft.ai/v1/images/removeBackground';

// Football kit colors per country (primary home kit hints for the prompt).
const KIT = {
  DZ: 'green and white',           AR: 'sky blue and white vertical stripes',
  AU: 'gold yellow with green trim', AT: 'red and white',
  BE: 'red with black trim',       BA: 'blue and yellow',
  BR: 'bright yellow with green trim and blue shorts',
  CA: 'red and white',             CV: 'blue and white',
  CO: 'yellow with blue and red trim',
  HR: 'red and white checkerboard pattern', CW: 'royal blue',
  CZ: 'red and white',             CD: 'blue with yellow trim',
  EC: 'yellow with blue trim',     EG: 'red with black and white trim',
  ENG: 'all white',                FR: 'navy blue with white and red trim',
  DE: 'white with black trim',     GH: 'white with red, yellow, green trim',
  HT: 'blue and red',              IR: 'all white with green trim',
  IQ: 'green with white trim',     CI: 'orange with green and white trim',
  JP: 'navy blue',                 JO: 'all white with red trim',
  MX: 'green with white and red trim', MA: 'red with green trim',
  NL: 'bright orange',             NZ: 'all white',
  NO: 'red with blue and white trim', PA: 'red with white trim',
  PY: 'red and white vertical stripes', PT: 'red with green trim',
  QA: 'maroon with white trim',    SA: 'white with green trim',
  SCO: 'dark navy blue',           SN: 'white with green trim',
  ZA: 'yellow with green trim',    KR: 'red with black trim',
  ES: 'red with yellow trim',      SE: 'yellow with blue trim',
  CH: 'red with white cross on chest', TN: 'red with white trim',
  TR: 'red with white trim',       UY: 'sky blue',
  US: 'white with blue and red trim', UZ: 'white with blue trim',
};

function loadCountries() {
  const src = fs.readFileSync(COUNTRIES_JS, 'utf8');
  const list = [];
  const re = /\{\s*code:\s*'([^']+)',\s*name:\s*'([^']+)',\s*flag:\s*'([^']+)'\s*\}/g;
  let m;
  while ((m = re.exec(src))) list.push({ code: m[1], name: m[2], flag: m[3] });
  return list;
}

function buildPrompt(name, kit) {
  return `The exact same brain mascot character as in the reference image — identical head shape, face, eyes, body and pose, identical skin/head colors — ` +
    `but now wearing the ${name} national football team home jersey in ${kit || 'official team colors'}. ` +
    `Only the jersey, shorts and socks change to match the ${name} kit colors. Keep the character's head color exactly as in the reference. ` +
    `Centered avatar, full body, isolated on plain white background, no shadows, no extra elements.`;
}

async function recraftImageToImage(anchorBuf, prompt, strength) {
  const fd = new FormData();
  fd.append('image', new Blob([anchorBuf], { type: 'image/jpeg' }), 'anchor.jpg');
  fd.append('prompt', prompt);
  fd.append('style_id', STYLE_ID);
  fd.append('strength', String(strength));
  fd.append('model', 'recraftv3');
  fd.append('response_format', 'b64_json');
  fd.append('n', '1');

  const res = await fetch(API_I2I, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`I2I HTTP ${res.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`No image in I2I response: ${text.slice(0, 300)}`);
  return Buffer.from(b64, 'base64');
}

async function recraftRemoveBg(buf) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'image/png' }), 'in.png');
  fd.append('response_format', 'b64_json');
  const res = await fetch(API_BG, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`BG removal HTTP ${res.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  const b64 = json?.image?.b64_json || json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`No image in BG-removal response: ${text.slice(0, 300)}`);
  return Buffer.from(b64, 'base64');
}

async function processCountry(c, anchorBuf, opts) {
  const { force, strength } = opts;
  const outPath = path.join(AVATARS_DIR, `avatar-${c.code}.png`);
  if (fs.existsSync(outPath) && !force) {
    console.log(`  [skip] ${c.code} ${c.name} (already exists)`);
    return { code: c.code, status: 'skipped' };
  }

  const kit = KIT[c.code];
  const prompt = buildPrompt(c.name, kit);
  console.log(`  [gen]  ${c.code} ${c.name} (strength=${strength})...`);

  const raw = await recraftImageToImage(anchorBuf, prompt, strength);
  const bgless = await recraftRemoveBg(raw);
  const out = await sharp(bgless)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  fs.writeFileSync(outPath, out);
  console.log(`  [ok]   ${c.code} -> ${path.basename(outPath)} (${(out.length / 1024).toFixed(0)} KB)`);
  return { code: c.code, status: 'ok' };
}

async function main() {
  if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
  if (!fs.existsSync(ANCHOR_IMG)) {
    console.error(`Anchor image not found: ${ANCHOR_IMG}`);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const strengthArg = args.find(a => a.startsWith('--strength='));
  const strength = strengthArg ? parseFloat(strengthArg.split('=')[1]) : 0.5;
  const codesArg = args
    .filter(a => !a.startsWith('--'))
    .map(a => a.toUpperCase());

  const all = loadCountries();
  const target = codesArg.length
    ? all.filter(c => codesArg.includes(c.code))
    : all.filter(c => c.code !== 'DZ'); // skip Algeria — it IS the anchor

  if (codesArg.length && target.length !== codesArg.length) {
    const found = target.map(t => t.code);
    const missing = codesArg.filter(c => !found.includes(c));
    console.error('Unknown country codes:', missing.join(', '));
    process.exit(1);
  }

  const anchorBuf = fs.readFileSync(ANCHOR_IMG);

  console.log('=================================');
  console.log('Recraft Avatar Generation (Image-to-Image)');
  console.log('Anchor:', path.basename(ANCHOR_IMG));
  console.log('Style ID:', STYLE_ID);
  console.log('Strength:', strength, '(0=keep input, 1=full change)');
  console.log('Targets:', target.length, 'countries');
  console.log('Force overwrite:', force ? 'yes' : 'no');
  console.log('=================================\n');

  const results = [];
  for (const c of target) {
    try {
      results.push(await processCountry(c, anchorBuf, { force, strength }));
    } catch (e) {
      console.error(`  [err]  ${c.code}:`, e.message);
      results.push({ code: c.code, status: 'error', error: e.message });
    }
  }

  const ok = results.filter(r => r.status === 'ok').length;
  const skip = results.filter(r => r.status === 'skipped').length;
  const err = results.filter(r => r.status === 'error').length;
  console.log('\n=================================');
  console.log(`Done. ${ok} generated, ${skip} skipped, ${err} errored.`);
  console.log('=================================');
}

main().catch(err => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
