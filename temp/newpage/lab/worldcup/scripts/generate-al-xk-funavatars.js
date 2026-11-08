// One-off: generate BOBAI avatars for Albania (AL) and Kosovo (XK) — for fun, NOT for deploy.
// Saves into two locations:
//   1. dashboard/worldcup/app/illus/avatars/avatar-<CODE>.png  (normal avatar slot, but not in countries.js so unused)
//   2. d:/ai/fourmeme/worldcup/avatar-<CODE>.png               (extra copy as requested)
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/generate-al-xk-funavatars.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const AVATARS_DIR  = path.resolve(__dirname, '..', 'app', 'illus', 'avatars');
const EXTRA_DIR    = 'd:/ai/fourmeme/worldcup';
const ANCHOR_IMG   = path.resolve(__dirname, '..', '_refs', 'avatar-DZ.jpg');
const CHAR_REF_2   = path.resolve(__dirname, '..', '_refs', 'argentinia.jpg');
const CHAR_REF_3   = path.resolve(__dirname, '..', '_refs', '1.jpg');
const CHAR_REF_4   = path.resolve(__dirname, '..', '_refs', '2.jpg');
const API_EDIT = 'https://api.openai.com/v1/images/edits';

const TARGETS = [
  {
    code: 'AL',
    name: 'Albania',
    kit:  { desc: 'red jersey with black trim and a black double-headed eagle emblem on the chest, black shorts and red socks' },
    motif: 'a small traditional white qeleshe felt cap tilted on the head',
  },
  {
    code: 'XK',
    name: 'Kosovo',
    kit:  { desc: 'dark royal blue jersey with golden yellow trim and collar, dark blue shorts' },
    motif: 'a small white peony flower (Kosovo national flower) pinned to the jersey',
  },
];

function buildPrompt(name, kit, motif, charRefCount) {
  const motifNote = motif
    ? ` Include ${motif} as a small cultural element that hints at ${name}'s identity. The motif must stay subtle and not dominate the figure — the mascot is the hero.`
    : '';
  const refRange = `images 1 through ${charRefCount}`;
  return `Images 1 through ${charRefCount} are character references showing the BOBAI mascot. ` +
    `Keep the EXACT same character identity as in ${refRange}: same body, same pose, same friendly face, same overall mascot proportions and style. Do NOT change the character — only the outfit and accessories. ` +
    `Refine the brain on top of the head a little: keep its shape from the references but make it slightly cuter and more detailed, with a soft glossy surface and subtle vibrant RGB color highlights (faint cyan, magenta and yellow tints on the brain edges) — the signature BOBAI holographic look, but kept tasteful and subtle, not glitchy. ` +
    `Re-skin the character so it wears the official ${name} national football team home kit (${kit.desc}). Jersey, shorts and socks must match the ${name} home colors precisely.${motifNote} ` +
    `Centered, full body visible, friendly confident pose. Plain transparent background. No shadows, no extras, no text, no sponsor logos, no FIFA wordmark.`;
}

async function pngBuffer(filePath) {
  const buf = fs.readFileSync(filePath);
  return await sharp(buf).png().toBuffer();
}

async function openaiEdit(charPngs, prompt, quality) {
  const fd = new FormData();
  fd.append('model', 'gpt-image-1');
  charPngs.forEach((png, i) => {
    fd.append('image[]', new Blob([png], { type: 'image/png' }), `character${i+1}.png`);
  });
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

async function main() {
  for (const d of [AVATARS_DIR, EXTRA_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }

  const charRefPaths = [ANCHOR_IMG, CHAR_REF_2, CHAR_REF_3, CHAR_REF_4].filter(p => fs.existsSync(p));
  if (charRefPaths.length < 2) { console.error('Need at least 2 character refs'); process.exit(1); }
  const charPngs = await Promise.all(charRefPaths.map(pngBuffer));

  const quality = 'high';
  console.log('=== Fun avatars: Albania + Kosovo ===');
  console.log('Char refs:', charRefPaths.map(p => path.basename(p)).join(', '));
  console.log('Quality:', quality);
  console.log();

  for (const t of TARGETS) {
    const prompt = buildPrompt(t.name, t.kit, t.motif, charPngs.length);
    console.log(`[gen] ${t.code} ${t.name}...`);
    try {
      const raw = await openaiEdit(charPngs, prompt, quality);
      const out = await sharp(raw)
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      const a = path.join(AVATARS_DIR, `avatar-${t.code}.png`);
      const b = path.join(EXTRA_DIR,   `avatar-${t.code}.png`);
      fs.writeFileSync(a, out);
      fs.writeFileSync(b, out);
      console.log(`  [ok] ${t.code} -> ${a}`);
      console.log(`  [ok] ${t.code} -> ${b}`);
    } catch (e) {
      console.error(`  [err] ${t.code}:`, e.message);
    }
  }
  console.log('\nDone.');
}

main().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
