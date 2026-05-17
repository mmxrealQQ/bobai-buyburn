// Generate BOBAI country avatars via OpenAI gpt-image-1.
// Uses /v1/images/edits with the BOBAI character (avatar-DZ.jpg) as the visual anchor
// and a detailed text prompt per country. Optional jersey reference image per country.
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/openai-generate-avatars.js               # all 48
//   node -r dotenv/config dashboard/worldcup/scripts/openai-generate-avatars.js BR DE FR     # selected
//   node -r dotenv/config dashboard/worldcup/scripts/openai-generate-avatars.js --force BR    # overwrite
//   node -r dotenv/config dashboard/worldcup/scripts/openai-generate-avatars.js --quality=high BR  # high quality
//
// Optional jersey refs: dashboard/worldcup/_refs/jerseys/jersey-<CODE>.{png,jpg,webp}
// Output: dashboard/worldcup/app/illus/avatars/avatar-<CODE>.png (transparent, 512x512)

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const COUNTRIES_JS = path.resolve(__dirname, '..', 'app', 'assets', 'countries.js');
const AVATARS_DIR  = path.resolve(__dirname, '..', 'app', 'illus', 'avatars');
const ANCHOR_IMG   = path.resolve(__dirname, '..', 'app', 'illus', 'avatars', 'avatar-DZ.jpg');
const CHAR_REF_2   = path.resolve(__dirname, '..', '_refs', 'argentinia.jpg');
const JERSEYS_DIR  = path.resolve(__dirname, '..', '_refs', 'jerseys');
const API_EDIT = 'https://api.openai.com/v1/images/edits';

// Country home kit details (color + pattern hints).
const KIT = {
  DZ: { primary: 'green', accent: 'white', desc: 'green jersey with white trim' },
  AR: { primary: 'sky blue', accent: 'white', desc: 'sky blue and white vertical stripes' },
  AU: { primary: 'gold yellow', accent: 'green', desc: 'gold yellow jersey with green trim and shorts' },
  AT: { primary: 'red', accent: 'white', desc: 'red jersey with white shorts' },
  BE: { primary: 'red', accent: 'black', desc: 'deep red jersey with black trim' },
  BA: { primary: 'royal blue', accent: 'yellow', desc: 'royal blue jersey with yellow trim' },
  BR: { primary: 'bright yellow', accent: 'green', desc: 'bright canary yellow jersey with green collar and blue shorts' },
  CA: { primary: 'red', accent: 'white', desc: 'red jersey with white maple-leaf-inspired accents' },
  CV: { primary: 'blue', accent: 'white', desc: 'blue jersey with white trim' },
  CO: { primary: 'yellow', accent: 'blue', desc: 'yellow jersey with blue shorts and red accents' },
  HR: { primary: 'red and white checkerboard', accent: 'white', desc: 'iconic red and white checkered jersey' },
  CW: { primary: 'royal blue', accent: 'yellow', desc: 'royal blue jersey with yellow accents' },
  CZ: { primary: 'red', accent: 'white', desc: 'red jersey with white shorts and blue socks' },
  CD: { primary: 'blue', accent: 'yellow', desc: 'blue jersey with yellow trim' },
  EC: { primary: 'yellow', accent: 'blue', desc: 'yellow jersey with blue shorts and red trim' },
  EG: { primary: 'red', accent: 'white', desc: 'red jersey with white and black trim' },
  ENG: { primary: 'white', accent: 'navy', desc: 'all white jersey with navy blue trim' },
  FR: { primary: 'navy blue', accent: 'white', desc: 'navy blue jersey with white shorts and red socks' },
  DE: { primary: 'white', accent: 'black', desc: 'white jersey with black shorts and stripes' },
  GH: { primary: 'white', accent: 'red yellow green', desc: 'white jersey with red, yellow and green Ghana flag stripes' },
  HT: { primary: 'blue', accent: 'red', desc: 'blue jersey with red trim' },
  IR: { primary: 'white', accent: 'red green', desc: 'white jersey with red and green Iran flag trim' },
  IQ: { primary: 'green', accent: 'white', desc: 'green jersey with white trim' },
  CI: { primary: 'orange', accent: 'green white', desc: 'bright orange jersey with green and white trim' },
  JP: { primary: 'navy blue', accent: 'white', desc: 'dark navy blue jersey with white trim and Samurai Blue accents' },
  JO: { primary: 'white', accent: 'red', desc: 'white jersey with red trim and shorts' },
  MX: { primary: 'green', accent: 'white red', desc: 'green jersey with white shorts and red socks' },
  MA: { primary: 'red', accent: 'green', desc: 'red jersey with green collar and trim' },
  NL: { primary: 'bright orange', accent: 'white', desc: 'bright orange jersey with white shorts and orange socks' },
  NZ: { primary: 'white', accent: 'black', desc: 'all white jersey with black trim (All Whites)' },
  NO: { primary: 'red', accent: 'white blue', desc: 'red jersey with white shorts and blue trim' },
  PA: { primary: 'red', accent: 'white blue', desc: 'red jersey with white trim' },
  PY: { primary: 'red and white stripes', accent: 'red', desc: 'red and white vertical stripes jersey with blue shorts' },
  PT: { primary: 'deep red', accent: 'green', desc: 'deep red jersey with green trim' },
  QA: { primary: 'maroon', accent: 'white', desc: 'dark maroon jersey with white trim' },
  SA: { primary: 'white', accent: 'green', desc: 'white jersey with green collar and trim' },
  SCO: { primary: 'dark navy blue', accent: 'white', desc: 'dark navy blue jersey with white trim' },
  SN: { primary: 'white', accent: 'green', desc: 'white jersey with green collar (Lions of Teranga)' },
  ZA: { primary: 'yellow', accent: 'green', desc: 'yellow jersey with green collar and trim (Bafana Bafana)' },
  KR: { primary: 'red', accent: 'black', desc: 'red jersey with black shorts (Taeguk Warriors)' },
  ES: { primary: 'red', accent: 'navy yellow', desc: 'red jersey with navy blue shorts and yellow trim (La Roja)' },
  SE: { primary: 'yellow', accent: 'blue', desc: 'bright yellow jersey with blue shorts' },
  CH: { primary: 'red', accent: 'white', desc: 'red jersey with a large white Swiss cross on the chest' },
  TN: { primary: 'red', accent: 'white', desc: 'red jersey with white trim' },
  TR: { primary: 'red', accent: 'white', desc: 'red jersey with white trim' },
  UY: { primary: 'sky blue', accent: 'white black', desc: 'sky blue jersey (La Celeste) with black shorts' },
  US: { primary: 'white', accent: 'red blue', desc: 'white jersey with red and blue trim' },
  UZ: { primary: 'white', accent: 'blue', desc: 'white jersey with sky blue trim' },
};

function loadCountries() {
  const src = fs.readFileSync(COUNTRIES_JS, 'utf8');
  const list = [];
  const re = /\{\s*code:\s*'([^']+)',\s*name:\s*'([^']+)',\s*flag:\s*'([^']+)'\s*\}/g;
  let m;
  while ((m = re.exec(src))) list.push({ code: m[1], name: m[2], flag: m[3] });
  return list;
}

function buildPrompt(name, kit, hasJerseyRef) {
  const jerseyImgIdx = hasJerseyRef ? 3 : null;
  const refNote = jerseyImgIdx
    ? ` Use image ${jerseyImgIdx} as the exact jersey design reference — copy its colors, pattern, stripes, and collar style precisely.`
    : '';
  return `Images 1 and 2 are character references showing the BOBAI mascot in Algeria and Argentina kits. ` +
    `Keep the EXACT same character identity as in images 1 and 2: same body, same pose, same friendly face, same overall mascot proportions and style. Do NOT change the character — only the outfit. ` +
    `Refine the brain on top of the head a little: keep its shape from images 1 and 2 but make it slightly cuter and more detailed, with a soft glossy surface and subtle vibrant RGB color highlights (faint cyan, magenta and yellow tints on the brain edges) — the signature BOBAI holographic look, but kept tasteful and subtle, not glitchy. ` +
    `Re-skin the character so it wears the official ${name} national football team home kit (${kit.desc}). Jersey, shorts and socks must match the ${name} colors.${refNote} ` +
    `Centered, full body visible, friendly confident pose. Plain transparent background. No shadows, no extras, no text, no sponsor logos.`;
}

function findJerseyRef(code) {
  if (!fs.existsSync(JERSEYS_DIR)) return null;
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const p = path.join(JERSEYS_DIR, `jersey-${code}.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function pngBuffer(filePath) {
  const buf = fs.readFileSync(filePath);
  return await sharp(buf).png().toBuffer();
}

async function openaiEdit(charPng1, charPng2, jerseyPng, prompt, quality) {
  const fd = new FormData();
  fd.append('model', 'gpt-image-1');
  fd.append('image[]', new Blob([charPng1], { type: 'image/png' }), 'character1.png');
  fd.append('image[]', new Blob([charPng2], { type: 'image/png' }), 'character2.png');
  if (jerseyPng) {
    fd.append('image[]', new Blob([jerseyPng], { type: 'image/png' }), 'jersey.png');
  }
  fd.append('prompt', prompt);
  fd.append('size', '1024x1024');
  fd.append('quality', quality);
  fd.append('background', 'transparent');
  fd.append('n', '1');

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
  return Buffer.from(b64, 'base64');
}

async function processCountry(c, anchorPng, charRef2Png, opts) {
  const { force, quality } = opts;
  const outPath = path.join(AVATARS_DIR, `avatar-${c.code}.png`);
  if (fs.existsSync(outPath) && !force) {
    console.log(`  [skip] ${c.code} ${c.name} (already exists)`);
    return { code: c.code, status: 'skipped' };
  }

  const kit = KIT[c.code];
  if (!kit) {
    console.log(`  [warn] ${c.code} ${c.name} — no kit info, skipping`);
    return { code: c.code, status: 'skipped' };
  }

  const jerseyPath = findJerseyRef(c.code);
  const jerseyPng = jerseyPath ? await pngBuffer(jerseyPath) : null;
  const prompt = buildPrompt(c.name, kit, !!jerseyPng);

  const tag = jerseyPng ? '[gen+jersey]' : '[gen]       ';
  console.log(`  ${tag} ${c.code} ${c.name} (quality=${quality})...`);

  const raw = await openaiEdit(anchorPng, charRef2Png, jerseyPng, prompt, quality);
  const out = await sharp(raw)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  fs.writeFileSync(outPath, out);
  console.log(`  [ok]      ${c.code} -> ${path.basename(outPath)} (${(out.length / 1024).toFixed(0)} KB)`);
  return { code: c.code, status: 'ok' };
}

async function main() {
  if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
  if (!fs.existsSync(ANCHOR_IMG)) { console.error(`Anchor image not found: ${ANCHOR_IMG}`); process.exit(1); }
  if (!fs.existsSync(CHAR_REF_2)) { console.error(`Char ref 2 not found: ${CHAR_REF_2}`); process.exit(1); }

  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const qualityArg = args.find(a => a.startsWith('--quality='));
  const quality = qualityArg ? qualityArg.split('=')[1] : 'medium';
  const codesArg = args
    .filter(a => !a.startsWith('--'))
    .map(a => a.toUpperCase());

  const all = loadCountries();
  const target = codesArg.length
    ? all.filter(c => codesArg.includes(c.code))
    : all.filter(c => c.code !== 'DZ'); // Algeria IS the anchor

  if (codesArg.length && target.length !== codesArg.length) {
    const found = target.map(t => t.code);
    const missing = codesArg.filter(c => !found.includes(c));
    console.error('Unknown country codes:', missing.join(', '));
    process.exit(1);
  }

  const anchorPng    = await pngBuffer(ANCHOR_IMG);
  const charRef2Png  = await pngBuffer(CHAR_REF_2);

  console.log('=================================');
  console.log('OpenAI gpt-image-1 Avatar Generation');
  console.log('Char ref 1:', path.basename(ANCHOR_IMG));
  console.log('Char ref 2:', path.basename(CHAR_REF_2));
  console.log('Quality:   ', quality);
  console.log('Jersey refs dir:', fs.existsSync(JERSEYS_DIR) ? 'yes' : 'no');
  console.log('Targets:   ', target.length, 'countries');
  console.log('=================================\n');

  const results = [];
  for (const c of target) {
    try {
      results.push(await processCountry(c, anchorPng, charRef2Png, { force, quality }));
    } catch (e) {
      console.error(`  [err]     ${c.code}:`, e.message);
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
