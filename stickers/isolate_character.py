#!/usr/bin/env python3
"""
Isolate the BOBAI brain-headed character from the ChatGPT ref stickers.
Removes lightning bolt / octopus / other props via gpt-image-1.5 /v1/images/edits.
Keeps the figure exactly as-is, transparent background.

Usage:
  python isolate_character.py            # process both 3 and 4
  python isolate_character.py 3          # only character-3
"""
import os, sys, base64, requests
from io import BytesIO
from PIL import Image

KEY = None
for line in open(r'd:/ai/fourmeme/.env', encoding='utf-8'):
    if line.startswith('OPENAI_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'"); break
assert KEY, "OPENAI_API_KEY not found in .env"

PROMPT = (
    "Keep the brain-headed cartoon character figure exactly as it is — "
    "do not alter its style, pose, body, clothes, shoes, or face. "
    "Remove every other element from the image: the lightning bolt, the octopus, "
    "any tentacles, props, decorations, or background objects. "
    "Output ONLY the standalone character, centered, with a fully transparent background."
)

SRC = r'd:/ai/fourmeme/stickers/incoming'
DST = r'd:/ai/fourmeme/stickers/assets'

def isolate(n):
    src = f'{SRC}/sticker ({n}).webp'
    dst = f'{DST}/character-{n}.png'
    im = Image.open(src).convert('RGBA')
    # OpenAI edits wants a square PNG — pad to square on transparent bg, preserve scale.
    s = max(im.size)
    sq = Image.new('RGBA', (s, s), (0,0,0,0))
    sq.paste(im, ((s-im.width)//2, (s-im.height)//2), im)
    sq = sq.resize((1024, 1024), Image.LANCZOS)
    buf = BytesIO(); sq.save(buf, 'PNG'); buf.seek(0)

    r = requests.post(
        'https://api.openai.com/v1/images/edits',
        headers={'Authorization': f'Bearer {KEY}'},
        files={'image': ('input.png', buf, 'image/png')},
        data={'model': 'gpt-image-1.5', 'prompt': PROMPT,
              'size': '1024x1024', 'quality': 'high',
              'background': 'transparent', 'output_format': 'png', 'n': '1'},
        timeout=300,
    )
    if r.status_code != 200:
        print(f'ERR {src}: {r.status_code} {r.text[:400]}'); sys.exit(1)
    open(dst, 'wb').write(base64.b64decode(r.json()['data'][0]['b64_json']))
    print(f'OK {dst} ({os.path.getsize(dst)//1024} KB)')

if __name__ == '__main__':
    nums = sys.argv[1:] or ['3', '4']
    for n in nums:
        isolate(n)
