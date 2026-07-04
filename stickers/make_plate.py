#!/usr/bin/env python3
"""
Clean plates for the saga stickers: gpt-image-2 full edit removes the moving
limb from each scene -> scenes/<slug>-plate.png. build_sticker.py then uses the
plate as the STATIC base and animates only the limb (cut from the original) on
top — the background never moves.

Usage: python stickers/make_plate.py <slug ...> [--force]
"""
import os, sys, base64, requests
from io import BytesIO
from PIL import Image

KEY = None
for line in open(r'd:/ai/fourmeme/.env', encoding='utf-8'):
    if line.startswith('OPENAI_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'"); break
assert KEY, "OPENAI_API_KEY not found in .env"

SCN = r'd:/ai/fourmeme/stickers/assets/scenes'

KEEP = ("Keep EVERYTHING else pixel-identical: same character, same face, same "
        "expression, same head, same robe, same background, same lighting, same "
        "colors, same framing.")

PROMPTS = {
    'saga-pump':     "Remove his raised pointing arm and hand completely — where the "
                     "arm was, show his tattered robe hanging naturally and the misty "
                     "swamp background. " + KEEP,
    'saga-patience': "Remove his raised open palm and that arm completely — where the "
                     "arm was, show his tattered robe hanging naturally and the misty "
                     "swamp background. " + KEEP,
    'saga-nosell':   "Remove his raised stop-gesture palm and that arm completely — "
                     "where the arm was, show his tattered robe hanging naturally and "
                     "the misty swamp background. " + KEEP,
    'saga-hodl':     "Remove both clenched fists and forearms completely — where they "
                     "were, show his dark shirt, tattered robe and the misty swamp "
                     "background naturally. " + KEEP,
    'saga-fear':     "Remove his folded hands completely — where they were, show his "
                     "dark shirt, tattered robe and the walking cane top naturally. " + KEEP,
}

def run(slug, force=False):
    src = f'{SCN}/{slug}.png'
    dst = f'{SCN}/{slug}-plate.png'
    if os.path.exists(dst) and not force:
        print(f"skip {slug} (plate exists)"); return
    im = Image.open(src).convert('RGBA')
    bi = BytesIO(); im.save(bi, 'PNG'); bi.seek(0)
    r = requests.post(
        'https://api.openai.com/v1/images/edits',
        headers={'Authorization': f'Bearer {KEY}'},
        files=[('image[]', ('scene.png', bi, 'image/png'))],
        data={'model': 'gpt-image-2', 'prompt': PROMPTS[slug],
              'size': '1024x1024', 'quality': 'high', 'moderation': 'low',
              'output_format': 'png', 'n': '1'},
        timeout=300,
    )
    if r.status_code != 200:
        print(f"ERR {slug}: {r.status_code} {r.text[:1500]}"); sys.exit(1)
    open(dst, 'wb').write(base64.b64decode(r.json()['data'][0]['b64_json']))
    print(f"OK {slug} plate -> {dst}")

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    for n in (args or list(PROMPTS)):
        run(n, force)
