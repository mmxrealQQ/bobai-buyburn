// X post 8.11.2026: brainonbnb.com speaks Arabic. BOBAI large, warm, welcoming (images/edits with the BOBAI ref)
const fs = require('fs'), path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const KEY = process.env.OPENAI_API_KEY, MODEL = process.env.MODEL || 'gpt-image-2.5-sunburst', DIR = __dirname;
const BOBAI = `The provided picture is BOBAI: a little boy whose whole head is a big pink-orange brain, big friendly brown eyes, warm smile, black hoodie, black trousers, black sneakers. Keep his look exactly.`;
const SCENES = {
  a: `${BOBAI}
Scene: a warm, welcoming golden-hour evening on an elegant rooftop terrace. BOBAI stands BIG in the frame (about 60 % of the image height), right of centre, facing the viewer, smiling and waving one hand in a friendly hello, the other hand on his heart (a warm, respectful greeting). Around him: beautiful brass Arabic lanterns (fanous) glowing warm amber with intricate cut patterns, a low cushioned seating area with patterned textiles, potted palms, a terrace railing with fine geometric arabesque lattice. Behind: a modern glittering city skyline at sunset with soft desert dunes far away, a delicate crescent moon and the first stars in a deep teal-to-orange sky. Warm bokeh. Heartfelt, elegant, friendly, respectful, joyful. Painterly cinematic digital illustration, rich warm light, high detail. Keep the upper-left area calmer and darker for a title.
NO text, NO letters, NO numbers, NO logos, NO flags, NO watermark.`,
  b: `${BOBAI}
Scene: a beautiful courtyard at blue hour, walls and floor with intricate colourful geometric zellige mosaic tiles (teal, gold, white), a small fountain with soft water light, many brass lanterns glowing warm amber hanging at different heights and standing on the floor, jasmine and palms. BOBAI stands BIG in the frame (about 60 % of the image height), right of centre, facing the viewer, smiling, one hand on his heart and the other open in welcome. Above: a deep indigo night sky with a crescent moon and stars. Warm glow on his brain head and face. Heartfelt, elegant, friendly, respectful, joyful. Painterly cinematic digital illustration, high detail. Keep the upper-left area calmer for a title.
NO text, NO letters, NO numbers, NO logos, NO flags, NO watermark.`,
};
const v = process.argv[2] || 'a';
(async () => {
  const fd = new FormData(); fd.append('model', MODEL);
  fd.append('image[]', new Blob([fs.readFileSync(path.join(DIR, '..', 'xpost-1009', 'ref', '0-bobai.png'))], { type: 'image/png' }), '0-bobai.png');
  fd.append('prompt', SCENES[v]); fd.append('size', '1536x1024'); fd.append('quality', 'high'); fd.append('output_format', 'png'); fd.append('n', '1');
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: fd });
  const t = await res.text(); if (!res.ok) throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
  fs.writeFileSync(path.join(DIR, `raw-${v}.png`), Buffer.from(JSON.parse(t).data[0].b64_json, 'base64')); console.log(v, 'ok');
})().catch(e => { console.error(v, e.message); process.exit(1); });
