// R16 kickoff banner v2 — penalty-shootout drama, NO national kits/flags
// (v1's 16 country kits mangled). Two neutral BOBAI kits: gold vs navy.
// Landscape 3:2 (1536x1024), gpt-image-2 high quality, NO text anywhere.
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/generate-x-r16-kickoff-v2.js

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const REFS_DIR = path.resolve(__dirname, '..', '_refs');
const OUT_DIR  = 'd:/ai/fourmeme/worldcup';

const REF_MAIN = path.join(REFS_DIR, '1.jpg');
const REF_2    = path.join(REFS_DIR, '2.jpg');
const REF_3    = path.join(REFS_DIR, 'avatar-DZ.jpg');
const REF_4    = path.join(REFS_DIR, 'argentinia.jpg');

const API_EDIT = 'https://api.openai.com/v1/images/edits';

const PROMPT = `Cinematic penalty-shootout hero banner for BOBAI Worldcup '26 — a FIFA 2026 World Cup crypto prediction tipgame on BNB Chain. The knockout stage is here: one frozen, heart-stopping penalty moment under the floodlights. Vibe: win-or-go-home drama, epic night-match atmosphere, "the real tournament starts now".

CHARACTER LOCK — CRITICAL: All input images show the SAME BOBAI mascot from different angles. Images 1, 2 and 3 are the PRIMARY MASTER CHARACTER SHEET — every BOBAI character in the banner must look EXACTLY like that character: same friendly cartoon face, same big round eyes, same body proportions, same head shape, same glossy detailed brain on top of the head with subtle holographic RGB highlights (faint cyan/magenta/yellow tints on the brain edges, tasteful — not glitchy).

ABSOLUTELY NO TEXT ANYWHERE — no banner text, no title, no URL, no caption, no numbers, no names or letters on jerseys, no scoreboard digits, no signs, no watermarks. The image contains ZERO readable characters. No national flags, no country kits, no federation crests — only the two neutral BOBAI team kits described below.

THE SCENE — a penalty kick frozen at the decisive split second, viewed from slightly behind and beside the penalty spot at low camera height:
- The GOALKEEPER: a BOBAI mascot in a glossy BOBAI-GOLD kit (rich #F0B90B gold jersey with black trim, black shorts, black gloves) is mid-air in a full spectacular diving stretch toward the top corner, body horizontal, one glove fully extended, eyes locked on the ball, determined game face. His glossy holographic brain catches the floodlight.
- The BALL: a classic white-and-black football with a subtle golden motion streak, frozen a hand's width from the keeper's outstretched glove, right at the top corner of the goal — the moment is deliberately ambiguous: save or goal, nobody knows yet.
- The SHOOTER: a second BOBAI mascot in a DEEP NAVY kit with white trim stands near the penalty spot in follow-through pose, leg swung, body leaning, mouth open — hoping.
- The GOAL: crisp white posts and taut white net, rippling slightly in anticipation, goal-line chalk bright against the wet grass.

SETTING: Night knockout match. Massive dark stadium bathed in cold white floodlight beams cutting through light haze. Wet pitch mirrors the floodlights and the gold kit. Behind the goal a packed stand — a dark blurred sea of tiny crowd lights and phone flashes, thousands of blurry silhouettes half-risen from their seats, frozen mid-gasp. Two tall floodlight towers blaze in the upper corners. Light stadium mist at ankle height. A faint BNB-chain-style honeycomb hex pattern woven into the floodlight lens flare, tasteful and subtle. A little golden confetti drifting in the beams.

COLOR PALETTE: Deep night navy/black base, cold floodlight white, BOBAI signature gold (#F0B90B) as the hero accent (keeper kit, lens-flare glow, confetti), deep navy for the shooter. High contrast, cinematic, premium poster-grade.

COMPOSITION: Landscape 3:2 aspect. Dynamic diagonal composition — keeper flying from lower-left toward upper-right where the ball hangs at the top corner. Shooter smaller in the right foreground, back half-turned to camera. Strong depth of field: keeper and ball razor-sharp, crowd soft bokeh. Highly detailed BOBAI faces. Monumental, dramatic, premium.

DO NOT include: FIFA logo, FIFA wordmark, real sponsor logos, real player faces, realistic human faces, national flags, federation crests, letters, numbers, watermarks, dates, URLs, titles, captions, or any readable text anywhere in the image.`;

async function loadBuf(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Ref not found: ${filePath}`);
  return fs.readFileSync(filePath);
}

async function generate() {
  const refs = [REF_MAIN, REF_MAIN, REF_MAIN, REF_2, REF_3, REF_4];
  const bufs = await Promise.all(refs.map(loadBuf));

  const fd = new FormData();
  fd.append('model', 'gpt-image-2');
  bufs.forEach((buf, i) => {
    fd.append('image[]', new Blob([buf], { type: 'image/jpeg' }), `ref${i+1}.jpg`);
  });
  fd.append('prompt', PROMPT);
  fd.append('size', '1536x1024');
  fd.append('quality', 'high');
  fd.append('n', '1');

  console.log('Calling OpenAI gpt-image-2 (high quality, 1536x1024, 6 refs, penalty drama)...');
  const t0 = Date.now();
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
  const raw = Buffer.from(b64, 'base64');
  console.log(`Got image in ${((Date.now() - t0)/1000).toFixed(1)}s (${(raw.length / 1024).toFixed(0)} KB)`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:T.]/g,'-').slice(0,19);
  const outMain   = path.join(OUT_DIR, 'worldcup-x-r16-kickoff-v2.png');
  const outBackup = path.join(OUT_DIR, `worldcup-x-r16-kickoff-v2-${ts}.png`);
  fs.writeFileSync(outMain, raw);
  fs.writeFileSync(outBackup, raw);
  console.log(`Saved: ${outMain}`);
  console.log(`Saved: ${outBackup}`);
}

generate().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
