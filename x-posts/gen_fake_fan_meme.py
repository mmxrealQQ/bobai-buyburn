#!/usr/bin/env python3
"""
"Fake fan" meme for the @Binance_intern reply (2026-07-03).
Scene: BOBAI as a self-proclaimed Binance Intern fan — while swapping his token
to Solana on the laptop and taking a call from the biggest competitor.
gpt-image-2, character-locked to nft/refs. Caption rendered with PIL (clean text),
JPG re-encode strips C2PA for X.
"""
import os, base64, requests
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont

KEY = None
for line in open(r'd:/ai/fourmeme/.env', encoding='utf-8'):
    if line.startswith('OPENAI_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'"); break
assert KEY, "OPENAI_API_KEY not found in .env"

REFS = [
    r'd:/ai/fourmeme/nft/refs/ref1.jpg',
    r'd:/ai/fourmeme/nft/refs/ref2.webp',
]
OUT_PNG = r'd:/ai/fourmeme/x-posts/fake-fan-meme-2026-07-03.png'
OUT_JPG = r'd:/ai/fourmeme/x-posts/fake-fan-meme-2026-07-03.jpg'

CAPTION_1 = "this is BOBAI."
CAPTION_2 = "BOBAI is a Binance Intern fan."

PROMPT = (
    "Funny meme illustration of the BOBAI brain-headed cartoon character sitting at a "
    "desk at night, caught red-handed with an innocent, slightly guilty smile. "
    "With one hand he holds a smartphone to his ear — the phone screen facing the viewer "
    "shows an incoming call labeled 'Coinbase'. His other hand is on a laptop whose screen "
    "clearly shows a crypto swap interface: swapping 'BOBAI' into 'SOL' with the purple-green "
    "Solana gradient logo, big 'SWAP' button highlighted. On the wall behind him hangs a "
    "framed fan poster with the BNB-gold Binance diamond logo and a small heart. "
    "The contrast is the joke: proud fan decor, disloyal actions. "
    "CHARACTER LOCK — CRITICAL: BOBAI is identical to the reference (same brain head with "
    "subtle holographic RGB tints, same big round friendly eyes, same body proportions, "
    "same black hoodie with BNB-gold $BOBAI print across the chest, same shoes). "
    "Same premium polished cartoon style as the reference — cinematic lighting, sharp focus, "
    "rich saturated colors, painterly rendering, warm desk-lamp glow with BNB-gold (#F0B90B) "
    "accents. Square 1:1 composition (1024x1024), character centered, a bit of clean negative "
    "space at the very top. The only allowed text: 'Coinbase' on the phone screen, 'BOBAI', "
    "'SOL' and 'SWAP' on the laptop screen, the '$BOBAI' hoodie print. "
    "NO captions, NO watermark, NO other floating text."
)

def load_ref(path):
    p = path.lower()
    if p.endswith(('.webp', '.png')):
        im = Image.open(path).convert('RGB')
        buf = BytesIO(); im.save(buf, 'JPEG', quality=92); buf.seek(0)
        name = os.path.basename(path).rsplit('.', 1)[0] + '.jpg'
        return (name, buf.getvalue(), 'image/jpeg')
    with open(path, 'rb') as f:
        return (os.path.basename(path), f.read(), 'image/jpeg')

def add_caption(im):
    """White meme bar on top with two caption lines, black bold text."""
    w = im.width
    try:
        f1 = ImageFont.truetype('arialbd.ttf', 64)
        f2 = ImageFont.truetype('arialbd.ttf', 52)
    except OSError:
        f1 = f2 = ImageFont.load_default()
    pad, gap = 36, 14
    d = ImageDraw.Draw(im)
    h1 = d.textbbox((0, 0), CAPTION_1, font=f1)[3]
    h2 = d.textbbox((0, 0), CAPTION_2, font=f2)[3]
    bar_h = pad + h1 + gap + h2 + pad
    out = Image.new('RGB', (w, bar_h + im.height), 'white')
    out.paste(im, (0, bar_h))
    d = ImageDraw.Draw(out)
    w1 = d.textbbox((0, 0), CAPTION_1, font=f1)[2]
    w2 = d.textbbox((0, 0), CAPTION_2, font=f2)[2]
    d.text(((w - w1) // 2, pad), CAPTION_1, font=f1, fill='black')
    d.text(((w - w2) // 2, pad + h1 + gap), CAPTION_2, font=f2, fill='black')
    return out

def main():
    files = [('image[]', load_ref(r)) for r in REFS if os.path.exists(r)]
    print(f'Calling gpt-image-2 with {len(files)} refs ...')
    r = requests.post(
        'https://api.openai.com/v1/images/edits',
        headers={'Authorization': f'Bearer {KEY}'},
        files=files,
        data={'model': 'gpt-image-2', 'prompt': PROMPT,
              'size': '1024x1024', 'quality': 'high', 'n': '1'},
        timeout=600,
    )
    if r.status_code != 200:
        print(f'ERR {r.status_code}: {r.text[:500]}'); raise SystemExit(1)
    raw = base64.b64decode(r.json()['data'][0]['b64_json'])
    open(OUT_PNG, 'wb').write(raw)
    print(f'OK -> {OUT_PNG} ({len(raw)//1024} KB)')

    im = add_caption(Image.open(OUT_PNG).convert('RGB'))
    im.save(OUT_JPG, 'JPEG', quality=88, optimize=True)
    print(f'JPG -> {OUT_JPG} ({os.path.getsize(OUT_JPG)//1024} KB)')

if __name__ == '__main__':
    main()
