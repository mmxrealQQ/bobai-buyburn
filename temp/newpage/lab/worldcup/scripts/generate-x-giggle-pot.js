// One-off: X banner for the Giggle Academy community pot (2026-09-09).
// The BOBAI mascot and a crowd of tiny hands filling one glowing community
// pot under a big warm sun — "WE are the donation" — with a sunlit learning
// scene behind it. Landscape 3:2 (1536x1024), gpt-image-2, no text, no real
// logos. Post-processed to a clean JPG (metadata stripped) for X.
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/generate-x-giggle-pot.js

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const REFS_DIR = path.resolve(__dirname, '..', '_refs');
const OUT_DIR  = 'd:/ai/fourmeme/temp/giggle-pot';

const REF_BANNER = 'd:/ai/fourmeme/worldcup/weekend-vibes-banner.png'; // clean in-style BOBAI renders — strongest character+style lock
const REF_MAIN = path.join(REFS_DIR, '1.jpg');
const REF_4    = path.join(REFS_DIR, '4.jpg');

const API_EDIT = 'https://api.openai.com/v1/images/edits';

const PROMPT = `A single warm, joyful, cinematic premium-cartoon illustration in EXACTLY the visual style and character design of the reference images (same BOBAI mascot: the round pink cartoon BRAIN character with the big friendly eyes and smile — keep the face, proportions, colors and rendering identical to the references; do NOT invent a different brain, do NOT simplify it).

SCENE — "WE are the donation": Center-right, the BOBAI brain mascot stands LARGE (about a third of the image height, face clearly visible, front three-quarter view), beaming, holding a big glowing golden coin with both hands and gently dropping it into a large round GLASS COMMUNITY JAR / POT that sits on a low wooden table at the center of the picture. The jar is already a third full of glowing golden coins and warm golden light. From all around the jar, MANY small diverse HANDS (children's and grown-ups' hands of different skin tones, sleeves of different colors, only hands and forearms visible) reach in from the edges of the frame, each dropping ONE golden coin into the same jar — a community filling one pot together. Golden sparkles and soft light-motes drift up from the jar.

BACKGROUND — a sunlit learning scene: a bright, friendly open-air classroom / reading garden — a few children of different backgrounds sitting on cushions and low benches with picture books, tablets and colorful building blocks, laughing and giggling, a small chalkboard with simple doodles (shapes only, no letters), paper planes in the air, a globe, a stack of books, potted plants. Everything bathed in warm morning light.

THE SUN — a big, warm, glowing SUN high in the sky top-left, rendered in the same soft cartoon style, its rays reaching across the whole scene. On a closer look the sun has a very subtle, kind SMILEY face (two soft dot eyes and a gentle smile), almost invisible, an easter egg. Brilliant blue sky, a few fluffy white clouds.

PALETTE & MOOD: warm gold (#F0B90B) as the hero accent — the coins, the jar's glow, the sun; soft sky blues, fresh greens, warm creams and wood tones; the BOBAI pink of the mascot. Mood: generous, sunny, playful, hopeful, wholesome — a children's-book kind of warmth, premium and polished, NOT cheesy, NOT sad, NOT a charity-appeal poster.

NO TEXT WHATSOEVER: NO title, NO caption, NO URL, NO letters on the chalkboard or books, NO numbers, NO percentages, NO watermark. NO real brand logos of any kind, NO real organisation logos, NO real currency symbols, NO ticker symbols, NO exchange logos. Pure visual storytelling.

COMPOSITION: Landscape 3:2. The glass jar of golden coins is the visual center; BOBAI large and clearly readable beside it; the crowd of hands frames the jar; the sun top-left; the learning scene softly behind with gentle depth of field. Crisp, richly detailed, high-end illustration finish, consistent lighting from the sun.`;

async function loadBuf(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Ref not found: ${filePath}`);
  return fs.readFileSync(filePath);
}
function mimeFor(p) {
  const e = p.toLowerCase().split('.').pop();
  return e === 'png' ? 'image/png' : e === 'webp' ? 'image/webp' : 'image/jpeg';
}

async function generate() {
  const refs = [REF_BANNER, REF_MAIN, REF_4];
  const bufs = await Promise.all(refs.map(loadBuf));
  const fd = new FormData();
  fd.append('model', 'gpt-image-2');
  bufs.forEach((buf, i) => {
    const type = mimeFor(refs[i]);
    fd.append('image[]', new Blob([buf], { type }), `ref${i + 1}.${type.split('/')[1]}`);
  });
  fd.append('prompt', PROMPT);
  fd.append('size', '1536x1024');
  fd.append('quality', 'high');
  fd.append('n', '1');
  console.log('Calling OpenAI gpt-image-2 (high, 1536x1024, 3 refs, Giggle pot)...');
  const t0 = Date.now();
  const res = await fetch(API_EDIT, { method: 'POST', headers: { Authorization: `Bearer ${API_KEY}` }, body: fd });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI edits HTTP ${res.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`No image in response: ${text.slice(0, 300)}`);
  const raw = Buffer.from(b64, 'base64');
  console.log(`Got image in ${((Date.now() - t0) / 1000).toFixed(1)}s (${(raw.length / 1024).toFixed(0)} KB)`);
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 19);
  const outPng = path.join(OUT_DIR, `giggle-pot-${ts}.png`);
  fs.writeFileSync(outPng, raw);
  console.log(`Saved: ${outPng}`);
  // X-ready: 2x upscale + light sharpen + mozjpeg (drops the C2PA metadata that makes X label the post "Made with AI").
  try {
    const sharp = require('sharp');
    const outJpg = path.join(OUT_DIR, `giggle-pot-${ts}-x.jpg`);
    await sharp(raw).resize({ width: 3072, kernel: 'lanczos3' }).sharpen({ sigma: 0.8 }).jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(outJpg);
    console.log(`Saved: ${outJpg}`);
  } catch (e) {
    console.log('sharp not available (' + e.message.slice(0, 60) + ') — strip with: ffmpeg -y -i ' + outPng + ' -map_metadata -1 -q:v 2 out.jpg');
  }
}

generate().catch((e) => { console.error('Fatal:', e.message || e); process.exit(1); });
