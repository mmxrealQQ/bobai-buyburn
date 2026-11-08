// 1920x1280, "السلام عليكم" + "brainonbnb.com · now in Arabic", JPG without metadata (no X "Made with AI" label)
const sharp = require('sharp'), path = require('path');
const W = 1920, H = 1280, DIR = __dirname;
const svg = (x, y, size) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>
<filter id="s" x="-20%" y="-50%" width="140%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="9" flood-color="#0c0a1e" flood-opacity=".9"/></filter>
<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF6D0"/><stop offset="1" stop-color="#FFB733"/></linearGradient></defs>
<text x="${x}" y="${y}" direction="rtl" text-anchor="start" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${size}" fill="url(#gold)" filter="url(#s)">السلام عليكم</text>
<text x="${x - 2}" y="${y + 62}" text-anchor="end" font-family="Arial, sans-serif" font-weight="700" font-size="26" letter-spacing="5" fill="#FFEBC2" filter="url(#s)">BRAINONBNB.COM · NOW IN ARABIC</text></svg>`);
const JOBS = { a: { x: 660, y: 175, size: 124 }, b: { x: 660, y: 118, size: 104 } };
(async () => {
  for (const v of (process.argv[2] ? process.argv.slice(2) : Object.keys(JOBS))) {
    const j = JOBS[v];
    const base = await sharp(path.join(DIR, `raw-${v}.png`)).resize(W, H, { kernel: 'lanczos3' }).sharpen({ sigma: 0.6 }).toBuffer();
    await sharp(base).composite([{ input: svg(j.x, j.y, j.size) }]).jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(path.join(DIR, `salam-${v}.jpg`));
    console.log(v, 'ok');
  }
})().catch(e => { console.error(e); process.exit(1); });
