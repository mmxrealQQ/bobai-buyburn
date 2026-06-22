#!/usr/bin/env python3
"""
Generate BOBAI NFT motif scenes via gpt-image-2 /v1/images/edits (multi-ref).
Uses nft/refs/ref1.jpg + ref2.webp as character + style anchors.

Saves PNGs to nft/scenes/.

Usage:
  python gen_nft.py                # all (skip existing)
  python gen_nft.py whale-buy      # one
  python gen_nft.py --force        # regenerate all
"""
import os, sys, base64, requests
from io import BytesIO
from PIL import Image

KEY = None
for line in open(r'd:/ai/fourmeme/.env', encoding='utf-8'):
    if line.startswith('OPENAI_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'"); break
assert KEY, "OPENAI_API_KEY not found in .env"

REFS_DIR = r'd:/ai/fourmeme/nft/refs'
REFS     = ['ref1.jpg', 'ref2.webp']
OUT      = r'd:/ai/fourmeme/nft/scenes'
os.makedirs(OUT, exist_ok=True)

STYLE = (
    "Premium polished cartoon illustration in the EXACT visual style of the input reference "
    "images — cinematic lighting, sharp focus, rich saturated colors, high detail, painterly "
    "rendering quality. "
    "CHARACTER LOCK — CRITICAL: render the same BOBAI brain-headed cartoon character shown "
    "in the references. Identical face, big round friendly eyes, glossy detailed brain on "
    "top of the head with SUBTLE holographic RGB highlights on the brain edges (faint cyan/"
    "magenta/yellow tints, tasteful — not heavy glitch artifacts), same body proportions, "
    "same outfit (black hoodie with BNB-gold $BOBAI print across the chest), same shoes. "
    "Solo character, centered, full body visible from brain head to feet, NFT trading-card "
    "composition (portrait/square framing). "
    "The character is paired with a LARGE bold MOTIF (described below) as the prominent "
    "focal element of the composition — rendered in the same premium polished style as the "
    "character, with BNB-gold (#F0B90B) accents and dramatic lighting on the motif. "
    "Background: a clean stylized atmospheric scene that supports the motif — NOT "
    "transparent. No floating UI text, no captions, no URLs, no watermarks anywhere — only "
    "the $BOBAI print on the hoodie is allowed."
)

SCENES = {
    'nice-buy':    "A huge BNB-gold money bag with a bold glowing $ symbol embroidered on "
                   "its side, held proudly in front of the character with both hands — "
                   "golden coins spilling out the open top, soft sparkle bursts radiating "
                   "outward, satisfied confident grin. Warm gold-and-cream backdrop with "
                   "subtle radial light.",

    'big-buy':     "A massive sparkling deep-blue crystal diamond floats in front of the "
                   "character's chest, clutched with both hands — diamond hands pose, "
                   "light rays beaming outward from the gem facets, crisp sparkle bursts. "
                   "Cool cyan-blue backdrop with bokeh sparkles.",

    'huge-buy':    "A sleek metallic rocket lifts off right beside the character with "
                   "bright BNB-gold rocket flames at the base — fast motion streaks, the "
                   "character rides upward with one fist raised and a determined grin. "
                   "Deep-night-sky backdrop with stars and streaks.",

    'whale-buy':   "A giant friendly cartoon whale (deep navy-blue, glossy) leaps out of "
                   "cyan-blue ocean waves behind the character — big splash bursts, the "
                   "whale's blowhole shoots up a geyser of BNB-gold coins, the character "
                   "stands proudly on or beside the whale with one fist raised. Ocean "
                   "horizon backdrop with sunlight on water.",

    'thunder-buy': "A huge jagged BNB-gold lightning bolt strikes down through the frame "
                   "next to the character — electric blue and gold spark bursts radiate "
                   "outward, crackling energy lines, the character grips the bolt "
                   "fearlessly with one hand, dramatic confident stance. Dark storm-sky "
                   "backdrop with electric glow.",

    'kraken-buy':  "Giant glowing purple kraken tentacles rise from below around the "
                   "character — the character lifts a huge BNB-gold coin overhead with "
                   "both hands, splash droplets and dynamic ocean swirls, dramatic heroic "
                   "pose framed by the tentacles. Deep-purple-ocean backdrop with bio-"
                   "luminescent glow.",
}

def load_refs():
    bufs = []
    for name in REFS:
        p = f'{REFS_DIR}/{name}'
        if not os.path.exists(p):
            print(f"missing ref: {p}"); sys.exit(1)
        if name.lower().endswith('.webp'):
            im = Image.open(p).convert('RGB')
            buf = BytesIO(); im.save(buf, 'JPEG', quality=92); buf.seek(0)
            bufs.append((name.replace('.webp', '.jpg'), buf.getvalue(), 'image/jpeg'))
        else:
            with open(p, 'rb') as f:
                bufs.append((name, f.read(), 'image/jpeg'))
    return bufs

def gen(slug, force=False):
    if slug not in SCENES:
        print(f"unknown scene '{slug}', known: {list(SCENES)}"); return
    dst = f'{OUT}/{slug}.png'
    if os.path.exists(dst) and not force:
        print(f"skip {slug} (exists)"); return

    refs = load_refs()
    files = [('image[]', (name, data, mime)) for (name, data, mime) in refs]

    prompt = STYLE + " MOTIF: " + SCENES[slug]
    r = requests.post(
        'https://api.openai.com/v1/images/edits',
        headers={'Authorization': f'Bearer {KEY}'},
        files=files,
        data={'model': 'gpt-image-2', 'prompt': prompt,
              'size': '1024x1024', 'quality': 'high', 'n': '1'},
        timeout=300,
    )
    if r.status_code != 200:
        print(f"ERR {slug}: {r.status_code} {r.text[:500]}"); sys.exit(1)
    open(dst, 'wb').write(base64.b64decode(r.json()['data'][0]['b64_json']))
    print(f"OK {slug} ({os.path.getsize(dst)//1024} KB) -> {dst}")

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    names = args if args else list(SCENES)
    for n in names:
        gen(n, force)
