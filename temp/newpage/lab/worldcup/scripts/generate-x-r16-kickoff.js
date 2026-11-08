// R16 kickoff banner — 16 remaining nations as BOBAI mascots, floodlit knockout
// lineup, NO text anywhere in the image (all numbers/facts live in the tweet).
// Landscape 3:2 (1536x1024), gpt-image-2 high quality.
//
// Usage:
//   node -r dotenv/config dashboard/worldcup/scripts/generate-x-r16-kickoff.js

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

const PROMPT = `Cinematic knockout-stage banner for BOBAI Worldcup '26 — a FIFA 2026 World Cup crypto prediction tipgame on BNB Chain. The Round of 16 kicks off TONIGHT: the 16 remaining nations, embodied by 16 BOBAI mascots in their national home kits, stand in a dramatic floodlit walk-out lineup. Vibe: win-or-go-home intensity, epic night-match atmosphere, "the real tournament starts now".

CHARACTER LOCK — CRITICAL: All input images show the SAME BOBAI mascot from different angles. Images 1, 2 and 3 are the PRIMARY MASTER CHARACTER SHEET — every BOBAI player in the banner must look EXACTLY like that character: same friendly cartoon face, same big round eyes, same body proportions, same head shape, same glossy detailed brain on top of the head with subtle holographic RGB highlights (faint cyan/magenta/yellow tints on the brain edges, tasteful — not glitchy). All 16 players are IDENTICAL BOBAI characters, only differing in their country kit.

ABSOLUTELY NO TEXT ANYWHERE — no banner text, no title, no URL, no caption, no numbers, no names on jerseys, no letters on kits, no scoreboard, no leaderboard UI, no logo strip, no signs, no watermarks. The image contains ZERO readable characters. Country identity is communicated purely through kit colors, crest-free jersey designs and small waist-level flag patches. No exceptions.

THE LINEUP — 16 BOBAI mascots as PLAYERS in national home kits, arranged in TWO ROWS on the pitch facing the camera (front row of 8 slightly crouched hands-on-knees like a team photo, back row of 8 standing tall, arms crossed or hands behind backs, game faces — determined grins, a few with playful competitive smirks):

Front row, left to right:
1. CANADA — solid red kit with a white maple-leaf motif band across the chest.
2. FRANCE — navy blue kit with white and red trim.
3. BRAZIL — vivid yellow kit with green trim, blue shorts.
4. ENGLAND — clean white kit with navy trim.
5. SPAIN — bright red kit with yellow trim, navy shorts.
6. ARGENTINA — sky-blue and white vertical striped kit, black shorts.
7. SWITZERLAND — solid red kit with a large white Swiss cross motif on the chest.
8. USA — white kit with a red-and-blue diagonal stripe sash.

Back row, left to right:
9. MOROCCO — deep red kit with green trim and green shorts.
10. PARAGUAY — red-and-white vertical striped kit, blue shorts.
11. NORWAY — red kit with navy-and-white trim.
12. MEXICO — emerald green kit with white and red trim.
13. PORTUGAL — deep maroon-red kit with green collar and green shorts.
14. BELGIUM — red kit with black-and-yellow trim.
15. EGYPT — red kit with crisp white trim and white shorts.
16. COLOMBIA — yellow kit with navy and red trim.

All kits are crest-free and sponsor-free (plain color-blocked designs, NO club/federation logos, NO letters, NO numbers).

SETTING: Night knockout match. Massive stadium bathed in cold white floodlight beams cutting through light haze. The 16 mascots stand on the center circle, wet pitch reflecting the floodlights. Behind them the packed stands are a dark blurred sea of tiny crowd lights and phone flashes. Four tall floodlight towers blaze at the corners. Subtle golden confetti has settled on the grass from the earlier celebration. A faint BNB-chain-style honeycomb hex pattern is woven into the floodlight lens flare, tasteful and subtle. Light stadium mist at ankle height for drama.

COLOR PALETTE: Deep night navy/black base, cold floodlight white, BOBAI signature gold (#F0B90B) accent glow along the horizon of the stands, vivid national kit colors popping against the dark: Canada red, France navy, Brazil yellow, England white, Spain red, Argentina sky-blue, Switzerland red, USA white, Morocco red-green, Paraguay red-white, Norway red, Mexico green, Portugal maroon, Belgium red, Egypt red-white, Colombia yellow. High contrast, cinematic, premium.

COMPOSITION: Landscape 3:2 aspect. Epic wide team-photo hero shot, camera slightly low for monumental feel. All 16 mascots clearly visible, evenly spaced, no overlapping faces. Strong symmetry, the two rows centered on the frame. Highly detailed BOBAI faces. Premium, poster-grade.

DO NOT include: FIFA logo, FIFA wordmark, real sponsor logos, real player faces, realistic human faces, federation crests, letters, numbers, watermarks, dates, URLs, titles, captions, or any readable text anywhere in the image.`;

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

  console.log('Calling OpenAI gpt-image-2 (high quality, 1536x1024, 6 refs, R16 lineup)...');
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
  const outMain   = path.join(OUT_DIR, 'worldcup-x-r16-kickoff.png');
  const outBackup = path.join(OUT_DIR, `worldcup-x-r16-kickoff-${ts}.png`);
  fs.writeFileSync(outMain, raw);
  fs.writeFileSync(outBackup, raw);
  console.log(`Saved: ${outMain}`);
  console.log(`Saved: ${outBackup}`);
}

generate().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });
