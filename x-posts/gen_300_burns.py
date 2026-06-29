#!/usr/bin/env python3
"""
Generate the "300 Burns" milestone hero image for the X post.
gpt-image-2, character-locked to nft/refs. Saves JPG (no C2PA) for X.
"""
import os, base64, requests
from io import BytesIO
from PIL import Image

KEY = None
for line in open(r'd:/ai/fourmeme/.env', encoding='utf-8'):
    if line.startswith('OPENAI_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'"); break
assert KEY, "OPENAI_API_KEY not found in .env"

REFS = [
    r'd:/ai/fourmeme/nft/refs/ref1.jpg',
    r'd:/ai/fourmeme/nft/refs/ref2.webp',
]
OUT_PNG = r'd:/ai/fourmeme/x-posts/300-burns-2026-06-29.png'
OUT_JPG = r'd:/ai/fourmeme/x-posts/300-burns-2026-06-29.jpg'

PROMPT = (
    "Cinematic hero illustration of the BOBAI brain-headed cartoon character standing "
    "confidently in front of a glowing industrial forge / furnace, calmly tossing two "
    "stylized BNB-gold coins into the roaring flames — one coin embossed with 'BOB', the "
    "other embossed with 'BOBAI'. Warm orange-and-gold fire light, drifting embers and "
    "sparks, soft smoke. The character looks proud and steady, not chaotic. "
    "CHARACTER LOCK — CRITICAL: BOBAI is identical to the reference (same brain head with "
    "subtle holographic RGB tints, same big round friendly eyes, same body proportions, "
    "same black hoodie with BNB-gold $BOBAI print across the chest, same shoes). "
    "Same premium polished cartoon style as the reference — cinematic dramatic lighting, "
    "sharp focus, rich saturated colors, painterly rendering. Strong BNB-gold (#F0B90B) "
    "rim-light on the character from the furnace glow. Dark dramatic backdrop so the fire "
    "pops. Landscape 3:2 composition (1536x1024) with negative space top and bottom. "
    "The only allowed text is 'BOB' and 'BOBAI' embossed on the two coins and the $BOBAI "
    "hoodie print. NO captions, NO numbers, NO watermark, NO extra floating text."
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

def main():
    files = [('image[]', load_ref(r)) for r in REFS if os.path.exists(r)]
    print(f'Calling gpt-image-2 with {len(files)} refs ...')
    r = requests.post(
        'https://api.openai.com/v1/images/edits',
        headers={'Authorization': f'Bearer {KEY}'},
        files=files,
        data={'model': 'gpt-image-2', 'prompt': PROMPT,
              'size': '1536x1024', 'quality': 'high', 'n': '1'},
        timeout=600,
    )
    if r.status_code != 200:
        print(f'ERR {r.status_code}: {r.text[:500]}'); raise SystemExit(1)
    raw = base64.b64decode(r.json()['data'][0]['b64_json'])
    open(OUT_PNG, 'wb').write(raw)
    print(f'OK -> {OUT_PNG} ({len(raw)//1024} KB)')

    im = Image.open(OUT_PNG).convert('RGB')
    im.save(OUT_JPG, 'JPEG', quality=88, optimize=True)
    print(f'JPG -> {OUT_JPG} ({os.path.getsize(OUT_JPG)//1024} KB)')

if __name__ == '__main__':
    main()
