// X-post hero for the WC26 Group Stage payout announcement.
// gpt-image-1 /v1/images/edits with 4 BOBAI character refs, 1536x1024, JPG strip.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const OUT_DIR = path.resolve(__dirname, '..', '..', '..', 'x-posts');
const REF_DIR = path.resolve(__dirname, '..', '_refs');
const CHAR_REFS = [
  path.join(REF_DIR, 'avatar-DZ.jpg'),
  path.join(REF_DIR, 'argentinia.jpg'),
  path.join(REF_DIR, '1.jpg'),
  path.join(REF_DIR, '2.jpg'),
].filter(p => fs.existsSync(p));

const STYLE = `The BOBAI mascot identity MUST stay identical to the references: same friendly body, same face, signature glossy brain on top with subtle holographic RGB highlights (faint cyan, magenta, yellow tints). Friendly cartoon mascot, vibrant but tasteful, dark-mode compatible. No text, no wordmarks, no FIFA branding, no jersey numbers.`;

const PROMPT = `Celebratory hero illustration (16:9): the BOBAI mascot standing on a small wooden podium under bright stadium floodlights, raising a glossy golden trophy with both hands, big content smile. Around the trophy and floating gently in the air, soft confetti of small golden coins each subtly marked with the pink-and-cyan BOBAI brain emblem. Behind the podium, 12 small abstract flags in a soft arc representing the 12 groups, blurred slightly to keep focus on the mascot. Soft green sparkles around the trophy hint at "completed payout" and on-chain confirmation. Warm friendly atmosphere, no aggression, no FIFA branding. ${STYLE}`;

const NAME = `wc26-group-payout-${new Date().toISOString().slice(0,10)}`;

async function pngBuffer(file) {
  return await sharp(fs.readFileSync(file)).png().toBuffer();
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (CHAR_REFS.length < 2) { console.error(`Need >= 2 char refs, got ${CHAR_REFS.length}`); process.exit(1); }
  const charPngs = await Promise.all(CHAR_REFS.map(pngBuffer));

  const fd = new FormData();
  fd.append('model', 'gpt-image-2');
  charPngs.forEach((png, i) => {
    fd.append('image[]', new Blob([png], { type: 'image/png' }), `character${i+1}.png`);
  });
  fd.append('prompt', PROMPT);
  fd.append('size', '1536x1024');     // closest to X hero 16:9
  fd.append('quality', 'high');
  fd.append('n', '1');

  console.log('Calling gpt-image-2 (high quality, 1536x1024)...');
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

  // Save PNG (full quality)
  const pngPath = path.join(OUT_DIR, `${NAME}.png`);
  fs.writeFileSync(pngPath, raw);
  console.log(`PNG: ${pngPath} (${(raw.length/1024).toFixed(0)} KB)`);

  // X AI-label strip: re-encode to JPG, drop all metadata (C2PA).
  // sharp with withMetadata({}) doesn't copy any metadata.
  const jpgPath = path.join(OUT_DIR, `${NAME}.jpg`);
  const jpg = await sharp(raw)
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .withMetadata({})
    .toBuffer();
  fs.writeFileSync(jpgPath, jpg);
  console.log(`JPG (X-ready): ${jpgPath} (${(jpg.length/1024).toFixed(0)} KB)`);
})().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
