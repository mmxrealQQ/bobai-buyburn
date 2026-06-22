#!/usr/bin/env python3
"""
Generate the NFT Buy Drops hero banner — group portrait of all 6 motifs.
Uses gpt-image-2 with refs from nft/refs/ (and existing scene PNGs for motif anchors).
Saves to dashboard/nft/banner.jpg (compressed, no C2PA metadata).
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
    r'd:/ai/fourmeme/nft/scenes/whale-buy.png',
    r'd:/ai/fourmeme/nft/scenes/kraken-buy.png',
]
OUT_PNG = r'd:/ai/fourmeme/nft/banner.png'
OUT_JPG = r'd:/ai/fourmeme/dashboard/nft/banner.jpg'

PROMPT = (
    "Cinematic group portrait of SIX BOBAI brain-headed cartoon characters lined up "
    "in a heroic team pose, looking confident, each carrying ONE distinct BOBAI buy-tier "
    "motif. Left to right: "
    "(1) BOBAI hugging a huge BNB-gold money bag with a glowing dollar symbol, "
    "(2) BOBAI clutching a sparkling deep-blue crystal diamond, "
    "(3) BOBAI gripping a sleek metallic rocket lifting off with BNB-gold flames, "
    "(4) BOBAI riding a friendly cartoon whale that spouts BNB-gold coins from its blowhole, "
    "(5) BOBAI fearlessly gripping a huge jagged BNB-gold lightning bolt, "
    "(6) BOBAI heroically framed by glowing purple kraken tentacles holding a giant BNB-gold coin overhead. "
    "CHARACTER LOCK — CRITICAL: every BOBAI is identical to the reference (same brain head with "
    "subtle holographic RGB tints, same big round friendly eyes, same body proportions, same black "
    "hoodie with BNB-gold $BOBAI print across the chest, same shoes). Only the pose and motif differ. "
    "Same premium polished cartoon style as the reference — cinematic dramatic lighting, sharp focus, "
    "rich saturated colors, painterly rendering. Subtle BNB-gold (#F0B90B) rim-light on all 6 "
    "characters. Dramatic dark backdrop with soft golden glow behind the lineup. "
    "Landscape 3:2 composition (1536x1024). Plenty of negative space at the top and bottom. "
    "NO floating text, NO captions, NO numbers, NO watermark — only the $BOBAI hoodie print is allowed."
)

def load_ref(path):
    if path.lower().endswith('.webp'):
        im = Image.open(path).convert('RGB')
        buf = BytesIO(); im.save(buf, 'JPEG', quality=92); buf.seek(0)
        return ('ref.jpg', buf.getvalue(), 'image/jpeg')
    elif path.lower().endswith('.png'):
        im = Image.open(path).convert('RGB')
        buf = BytesIO(); im.save(buf, 'JPEG', quality=92); buf.seek(0)
        return (os.path.basename(path).replace('.png', '.jpg'), buf.getvalue(), 'image/jpeg')
    else:
        with open(path, 'rb') as f:
            return (os.path.basename(path), f.read(), 'image/jpeg')

def main():
    files = []
    for r in REFS:
        if os.path.exists(r):
            files.append(('image[]', load_ref(r)))
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

    # Re-encode to JPG, strip C2PA, optimize for web
    im = Image.open(OUT_PNG).convert('RGB')
    os.makedirs(os.path.dirname(OUT_JPG), exist_ok=True)
    im.save(OUT_JPG, 'JPEG', quality=88, optimize=True)
    print(f'JPG -> {OUT_JPG} ({os.path.getsize(OUT_JPG)//1024} KB)')

if __name__ == '__main__':
    main()
