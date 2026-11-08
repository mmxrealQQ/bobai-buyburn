// Generate decorative BOBAI Worldcup illustrations via OpenAI gpt-image-1.
//
// Mirrors the avatar generator: uses the same BOBAI character refs as visual
// anchors so the heroes feel like the same mascot across the whole app.
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/openai-generate-illustrations.js                # all
//   node -r dotenv/config dashboard/worldcup/scripts/openai-generate-illustrations.js dashboard-hero  # one
//   node -r dotenv/config dashboard/worldcup/scripts/openai-generate-illustrations.js --force         # overwrite
//   node -r dotenv/config dashboard/worldcup/scripts/openai-generate-illustrations.js --quality=high  # quality
//
// Output: dashboard/worldcup/app/illus/<slot>.png (transparent)

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const ILLUS_DIR  = path.resolve(__dirname, '..', 'app', 'illus');
const ANCHOR_IMG = path.resolve(__dirname, '..', '_refs', 'avatar-DZ.jpg');
const CHAR_REF_2 = path.resolve(__dirname, '..', '_refs', 'argentinia.jpg');
const CHAR_REF_3 = path.resolve(__dirname, '..', '_refs', '1.jpg');
const CHAR_REF_4 = path.resolve(__dirname, '..', '_refs', '2.jpg');
const API_EDIT   = 'https://api.openai.com/v1/images/edits';
const API_GEN    = 'https://api.openai.com/v1/images/generations';

// Shared style block — pasted into every prompt so the look stays cohesive.
const STYLE_NOTE = `The BOBAI mascot identity (when present) MUST stay identical to the references: same body, same friendly face, same pose proportions, with the signature glossy brain on top that has subtle holographic RGB highlights (faint cyan, magenta and yellow tints on the brain edges) — tasteful, not glitchy. Style: friendly cartoon mascot, vibrant but tasteful, dark-mode compatible. Plain transparent background. No text, no wordmarks, no sponsor logos, no FIFA branding.`;

const ICON_STYLE = `Style: clean glossy modern coin icon, vibrant but tasteful, slight holographic RGB rim glow in faint cyan and magenta tints (BOBAI signature look). Centered, single coin face-on, no mascot character in the image. Plain transparent background. No text outside what's specified.`;

// Each illustration: prompt + output size + whether to include character refs.
// size = OpenAI generation size (square 1024x1024 or landscape 1536x1024)
// out  = final PNG dimensions after sharp resize (transparent)
const SLOTS = {
  // ============== HEROES (landscape banners, one per tab) ==============
  'dashboard-hero': {
    size: '1536x1024',
    out: { w: 1500, h: 1000 },
    useCharRefs: true,
    prompt: `Wide landscape hero banner for the Dashboard page of a football-prediction game. The BOBAI mascot stands confidently in the center-left, friendly welcoming pose with arms slightly open, holding a glowing translucent tablet showing tournament stats. Soft golden confetti gently drifts in the air. A faint stadium silhouette and goal posts hint in the background. ${STYLE_NOTE}`,
  },
  'tips-hero': {
    size: '1536x1024',
    out: { w: 1500, h: 1000 },
    useCharRefs: true,
    prompt: `Wide landscape hero banner for the Tips page. The BOBAI mascot is in a "thinker" pose — one hand resting on the chin, eyes focused — with a clean glowing white football at its feet. Behind it, a faint translucent floating tactical whiteboard with tiny arrows, X's and O's, and small national flag pins. Cyan and magenta accent glow. ${STYLE_NOTE}`,
  },
  'bonus-hero': {
    size: '1536x1024',
    out: { w: 1500, h: 1000 },
    useCharRefs: true,
    prompt: `Wide landscape hero banner for the Bonus / Champion page. The BOBAI mascot stares intently and curiously at a glowing tournament bracket diagram floating in front of it, with tiny country flag chips arranged on the bracket lines. Soft magical sparkles drift around the bracket. A subtle crystal-ball softness to the glow. ${STYLE_NOTE}`,
  },
  'crypto-hero': {
    size: '1536x1024',
    out: { w: 1500, h: 1000 },
    useCharRefs: true,
    prompt: `Wide landscape hero banner for the Crypto-predictions page. The BOBAI mascot stands at the center, looking up curiously, surrounded by three large floating glossy coins orbiting around it: an orange Bitcoin coin, a gold Binance BNB coin, and a pink-and-cyan BOBAI brain coin. A faint glowing upward price-chart curve sweeps across the background in cyan and magenta. ${STYLE_NOTE}`,
  },
  'leaderboard-hero': {
    size: '1536x1024',
    out: { w: 1500, h: 1000 },
    useCharRefs: true,
    prompt: `Wide landscape hero banner for the Leaderboard page. The BOBAI mascot stands on top of the highest step of a three-tier winner's podium (gold step in the center, silver to the left, bronze to the right), lifting a small golden football trophy above its head with both hands in a celebration pose. Two smaller subtle silhouette mascots stand on the silver and bronze steps. Golden confetti rains gently from above. ${STYLE_NOTE}`,
  },
  'prize-pool-hero': {
    size: '1536x1024',
    out: { w: 1500, h: 1000 },
    useCharRefs: true,
    prompt: `Wide landscape hero banner for the Prize Pool page. The BOBAI mascot sits relaxed and joyful on top of an open wooden treasure chest that is overflowing with small glowing pink-and-cyan brain-shaped BOBAI tokens. A few coins gently float in the air around it, soft golden sparkles. The chest sits on a faint reflective floor. ${STYLE_NOTE}`,
  },
  'rules-hero': {
    size: '1536x1024',
    out: { w: 1500, h: 1000 },
    useCharRefs: true,
    prompt: `Wide landscape hero banner for the Rules page. The BOBAI mascot is dressed as a friendly football referee: black-and-white vertical striped referee jersey, dark shorts, a silver whistle at the lips (gently puffing), holding up a yellow card with one hand in a "friendly warning" pose, raised pointer finger of the other hand explaining a rule. Confident but warm expression. ${STYLE_NOTE}`,
  },

  // ============== CARD CORNER ACCENTS (square, decorative) ==============
  'pool-trophy': {
    size: '1024x1024',
    out: { w: 512, h: 512 },
    useCharRefs: true,
    prompt: `Decorative square illustration of the BOBAI mascot lifting a small ornate golden football trophy with both hands above its head, joyful pose, eyes closed in a happy smile. Small golden coins, sparkles and soft confetti float around the mascot. Centered, full body. ${STYLE_NOTE}`,
  },
  'bonus-crystal': {
    size: '1024x1024',
    out: { w: 512, h: 512 },
    useCharRefs: true,
    prompt: `Decorative square illustration of the BOBAI mascot in a fortune-teller pose, sitting cross-legged with both hands cradling a softly glowing translucent crystal ball at chest height. Tiny floating mystical sparkles and a few small white football icons orbit gently around the crystal ball. Curious, intrigued expression as the mascot peers into the ball. Centered, full body. ${STYLE_NOTE}`,
  },
  'tips-ball': {
    size: '1024x1024',
    out: { w: 512, h: 512 },
    useCharRefs: true,
    prompt: `Decorative square illustration of the BOBAI mascot in a dynamic football-kick pose, one leg extending forward to softly kick a small glowing white football, a faint trail of motion-line sparkles arcing behind the foot. Joyful confident expression, slight forward lean for momentum. Centered, full body. ${STYLE_NOTE}`,
  },

  // ============== COIN ICONS (square, no mascot) ==============
  'coin-btc': {
    size: '1024x1024',
    out: { w: 512, h: 512 },
    useCharRefs: false,  // pure icon, no mascot
    prompt: `A glossy circular Bitcoin coin icon, face-on view. Orange-to-gold gradient surface with the iconic Bitcoin "₿" symbol embossed in the center, slightly raised. A subtle holographic RGB rim glow with faint cyan and magenta tints. Tiny pink-and-cyan brain emblem subtly visible just above the ₿ symbol as a BOBAI co-branding accent. ${ICON_STYLE}`,
  },
  'coin-bnb': {
    size: '1024x1024',
    out: { w: 512, h: 512 },
    useCharRefs: false,
    prompt: `A glossy circular Binance BNB coin icon, face-on view. Gold-yellow gradient surface with the iconic BNB diamond / four-rhombus logo embossed in the center, slightly raised. A subtle holographic RGB rim glow with faint cyan and magenta tints. Tiny pink-and-cyan brain emblem subtly visible just above the BNB logo as a BOBAI co-branding accent. ${ICON_STYLE}`,
  },
  'coin-bobai': {
    size: '1024x1024',
    out: { w: 512, h: 512 },
    useCharRefs: false,
    prompt: `A glossy circular coin icon, face-on view. The center of the coin is a stylized human brain rendered with a glossy pink-and-cyan gradient surface, soft holographic RGB highlights (faint cyan, magenta and yellow tints on the brain edges), looking iconic and clean as a mark / logo. The brain sits raised on a dark coin face with a subtle holographic RGB rim glow. No text, just the brain mark. ${ICON_STYLE}`,
  },
};

async function pngBuffer(filePath) {
  const buf = fs.readFileSync(filePath);
  return await sharp(buf).png().toBuffer();
}

async function openaiEdit(charPngs, prompt, size, quality) {
  const fd = new FormData();
  fd.append('model', 'gpt-image-1');
  charPngs.forEach((png, i) => {
    fd.append('image[]', new Blob([png], { type: 'image/png' }), `character${i+1}.png`);
  });
  fd.append('prompt', prompt);
  fd.append('size', size);
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

// Pure text-to-image — for slots that don't need a character reference (icons).
async function openaiGenerate(prompt, size, quality) {
  const res = await fetch(API_GEN, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size,
      quality,
      background: 'transparent',
      n: 1,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI generations HTTP ${res.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`No image in response: ${text.slice(0, 300)}`);
  return Buffer.from(b64, 'base64');
}

async function processSlot(name, spec, charPngs, opts) {
  const { force, quality } = opts;
  const outPath = path.join(ILLUS_DIR, `${name}.png`);
  if (fs.existsSync(outPath) && !force) {
    console.log(`  [skip] ${name} (already exists)`);
    return { name, status: 'skipped' };
  }

  const tag = spec.useCharRefs ? '[gen+char] ' : '[gen-icon] ';
  console.log(`  ${tag} ${name} (size=${spec.size}, quality=${quality})...`);

  const raw = spec.useCharRefs
    ? await openaiEdit(charPngs, spec.prompt, spec.size, quality)
    : await openaiGenerate(spec.prompt, spec.size, quality);
  const out = await sharp(raw)
    .resize(spec.out.w, spec.out.h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  fs.writeFileSync(outPath, out);
  console.log(`  [ok]      ${name} -> ${path.basename(outPath)} (${(out.length / 1024).toFixed(0)} KB)`);
  return { name, status: 'ok' };
}

async function main() {
  if (!fs.existsSync(ILLUS_DIR)) fs.mkdirSync(ILLUS_DIR, { recursive: true });
  const charRefPaths = [ANCHOR_IMG, CHAR_REF_2, CHAR_REF_3, CHAR_REF_4].filter(p => fs.existsSync(p));
  if (charRefPaths.length < 2) { console.error(`Need at least 2 character refs (got ${charRefPaths.length})`); process.exit(1); }

  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const qualityArg = args.find(a => a.startsWith('--quality='));
  const quality = qualityArg ? qualityArg.split('=')[1] : 'medium';
  const namesArg = args.filter(a => !a.startsWith('--'));

  const allSlotNames = Object.keys(SLOTS);
  const target = namesArg.length
    ? namesArg.filter(n => SLOTS[n])
    : allSlotNames;

  if (namesArg.length && target.length !== namesArg.length) {
    const unknown = namesArg.filter(n => !SLOTS[n]);
    console.error('Unknown slot names:', unknown.join(', '));
    console.error('Available slots:', allSlotNames.join(', '));
    process.exit(1);
  }

  const charPngs = await Promise.all(charRefPaths.map(pngBuffer));

  console.log('=================================');
  console.log('OpenAI gpt-image-1 Illustration Generation');
  charRefPaths.forEach((p, i) => console.log(`Char ref ${i+1}:`, path.basename(p)));
  console.log('Quality:   ', quality);
  console.log('Targets:   ', target.length, 'slots');
  console.log('=================================\n');

  const results = [];
  for (const name of target) {
    try {
      results.push(await processSlot(name, SLOTS[name], charPngs, { force, quality }));
    } catch (e) {
      console.error(`  [err]     ${name}:`, e.message);
      results.push({ name, status: 'error', error: e.message });
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
