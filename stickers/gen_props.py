#!/usr/bin/env python3
"""
Generate cute transparent crypto-sticker props via OpenAI gpt-image-2.
The BOBAI brain is NEVER generated here (brand rule) — only accessory props.
Saves PNGs (transparent) to stickers/assets/props/. Skips files that already exist.

Usage:
  python gen_props.py            # generate all defined props (skip existing)
  python gen_props.py rocket     # generate only named prop(s)
  python gen_props.py --force    # regenerate all
"""
import os, sys, base64, json, urllib.request

# load OPENAI_API_KEY from ../.env
KEY = None
for line in open(r'd:/ai/fourmeme/.env', encoding='utf-8'):
    if line.startswith('OPENAI_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'")
        break
assert KEY, "OPENAI_API_KEY not found in .env"

MODEL = 'gpt-image-1.5'  # quality leader AND supports transparent bg (gpt-image-2 does not)
OUT = r'd:/ai/fourmeme/stickers/assets/props'
os.makedirs(OUT, exist_ok=True)

STYLE = ("premium glossy 3D render, {subj}, soft studio lighting with gentle glossy "
         "reflections and a soft drop shadow, smooth rounded shapes, Binance gold "
         "(#F3BA2F) and white color accents, vibrant, polished, cute premium mascot "
         "sticker, centered, full object clearly visible, transparent background, "
         "no text, no words")

PROPS = {
    'rocket':     "a sleek glossy cartoon rocket ship flying upward with a small cute flame, side three-quarter view, smooth empty top where a small round character could ride",
    'moneybag':   "a plump glossy money bag tied at the top with a shiny golden coin popping out",
    'sun':        "a big friendly glossy sun with a soft smiling face and warm rounded rays",
    'sunglasses': "a pair of cool glossy black sunglasses floating, slightly tilted",
    'chart':      "a glossy green upward trending arrow with a small bar chart climbing, energetic",
    'confetti':   "a small burst of colorful glossy confetti and golden sparkles",
    'candle':     "a single tall glossy green bullish trading candlestick (up candle) with a rounded body and thin wick, energetic and clean",
    'moon':       "a cute glossy crescent moon with a soft friendly smiling face, pale gold",
    'lightning':  "a single thick stylized cartoon lightning bolt in vivid BNB gold (#F3BA2F) with a soft white-hot inner core, sharp zig-zag silhouette, glossy 3D volume, slight blue-white outer glow, vertical orientation, dynamic energetic shape",
}

def gen(name, force=False, quality='medium'):
    path = os.path.join(OUT, f'{name}.png')
    if os.path.exists(path) and not force:
        print(f"skip {name} (exists)"); return
    prompt = STYLE.format(subj=PROPS[name])
    body = json.dumps({
        "model": MODEL, "prompt": prompt, "size": "1024x1024",
        "quality": quality, "background": "transparent",
        "output_format": "png", "n": 1,
    }).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/images/generations", data=body,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        print(f"ERROR {name}: HTTP {e.code} {e.read().decode()[:300]}"); sys.exit(1)
    b64 = data['data'][0]['b64_json']
    open(path, 'wb').write(base64.b64decode(b64))
    print(f"OK   {name} -> {path} ({os.path.getsize(path)//1024} KB)")

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    quality = 'high' if '--high' in sys.argv else 'medium'
    names = args if args else list(PROPS.keys())
    for n in names:
        if n not in PROPS: print(f"unknown prop '{n}', known: {list(PROPS)}"); continue
        gen(n, force, quality)
