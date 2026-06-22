#!/usr/bin/env python3
"""
Generate FULL comic-style sticker scenes via gpt-image-1.5 /v1/images/edits.
Uses sticker (3).webp as character anchor — figure stays consistent across all 10.

Saves PNGs (transparent) to stickers/assets/scenes/.

Usage:
  python gen_scene.py                # generate all 10 (skip existing)
  python gen_scene.py thunder-buy    # generate one
  python gen_scene.py --force        # regenerate all
"""
import os, sys, base64, requests
from io import BytesIO
from PIL import Image

KEY = None
for line in open(r'd:/ai/fourmeme/.env', encoding='utf-8'):
    if line.startswith('OPENAI_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'"); break
assert KEY, "OPENAI_API_KEY not found in .env"

REF = r'd:/ai/fourmeme/stickers/incoming/sticker (3).webp'
OUT = r'd:/ai/fourmeme/stickers/assets/scenes'
os.makedirs(OUT, exist_ok=True)

STYLE = (
    "Keep the exact same brain-headed cartoon character from the input image "
    "(do not change its design, brain head, face, body proportions, clothes, or shoes). "
    "Render the character in a NEW POSE for this scene. "
    "Comic book illustration style: bold thick black outlines, flat shaded colors with "
    "cell shading and crisp comic highlights, dynamic motion lines, vivid saturated palette, "
    "Binance gold (#F3BA2F) accents. Character LARGE in frame, full body visible from "
    "brain head to shoes, centered. Fully transparent background, no border. "
    "The character wears a black hoodie. Across the hoodie chest, print the text "
    "'$BOBAI' (exactly six characters: dollar sign, capital B, O, B, A, I) in bold "
    "Binance gold (#F3BA2F) sans-serif letters — crisp, large, perfectly spelled, "
    "looking like a printed hoodie graphic. This $BOBAI hoodie print is the ONLY "
    "text allowed in the image — absolutely no other letters, numbers, words, "
    "labels, or text-like symbols anywhere else."
)

SCENES = {
    'thunder-buy':   "Character stands heroically with one fist raised, gripping a huge "
                     "glowing BNB-gold lightning bolt that has just struck — electric blue "
                     "and gold spark bursts radiate outward, crackling energy lines.",

    'supernova-burn': "Character throws a massive supernova fireball with both hands — "
                      "intense orange/red/gold flames with white-hot core, swirling burn "
                      "embers, dramatic comic explosion behind the character.",

    'kraken-buy':    "Character is lifted up by giant friendly purple kraken tentacles "
                     "holding a huge BNB-gold coin overhead — splash droplets, comic "
                     "bubbles, dynamic ocean motion lines.",

    'rocket':        "Character rides a sleek cartoon rocket flying upward — rocket flames "
                     "below, stars and motion streaks all around, character holds tight, "
                     "wide grin, full speed to the moon.",

    'diamond':       "Character clutches a giant sparkling blue diamond to its chest with "
                     "both hands — confident pose, diamond hands! Light rays shooting from "
                     "the gem, sparkle bursts.",

    'laser':         "Character fires bright red laser beams from its brain eyes — "
                     "powerful confident stance, beams cutting through the frame with "
                     "explosive impact glow.",

    'bull':          "Character rides a charging cartoon bull, fist raised in the air — "
                     "dust clouds behind, motion lines, dynamic action pose.",

    'hodl':          "Character grips a huge BNB-gold coin firmly with both hands and "
                     "raises it overhead with a determined battle cry — strain lines, "
                     "gritty hodler vibe.",

    'gigabrain':     "Character with its brain glowing massively oversized — electric "
                     "neural lightning arcs around the brain, intense intelligent stare, "
                     "powerful aura.",

    'wagmi':         "Character giving a big thumbs up with a huge friendly grin — pink "
                     "hearts floating around, sparkle bursts, warm comic vibes.",

    'gm':            "Character stretches its arms wide with a big morning yawn-grin, "
                     "a huge friendly glowing sun rising behind it — warm golden "
                     "sunrise rays radiating outward, soft cloud puffs at the bottom, "
                     "cozy daybreak vibes.",

    'pump':          "Character pumps both fists triumphantly into the air on top of a "
                     "giant green bullish candlestick — rising green candles in the "
                     "background, motion lines, joyful victorious grin.",

    'dip':           "Character calmly catches a falling red candlestick with one hand "
                     "while holding a huge BNB-gold coin in the other ready to buy — "
                     "red candles raining from above, cyan splash droplets at the feet, "
                     "cool confident DCA smirk.",

    'builder':       "Character wears a yellow hard hat and swings a glossy hammer onto "
                     "a stack of golden BNB bricks — bright welding sparks flying "
                     "outward, Binance-gold bricks stacked into a small wall, focused "
                     "builder grin, sleeves rolled up.",

    'shield':        "Character holds up a huge glossy round shield emblazoned with a "
                     "Binance-gold BNB diamond, deflecting incoming red rug-arrows — "
                     "pulsing protective aura around the shield, sparks where arrows "
                     "bounce off, confident guardian stance.",
}

def gen(slug, force=False):
    if slug not in SCENES:
        print(f"unknown scene '{slug}', known: {list(SCENES)}"); return
    dst = f'{OUT}/{slug}.png'
    if os.path.exists(dst) and not force:
        print(f"skip {slug} (exists)"); return
    # square 1024 input
    im = Image.open(REF).convert('RGBA')
    s = max(im.size); sq = Image.new('RGBA', (s, s), (0,0,0,0))
    sq.paste(im, ((s-im.width)//2, (s-im.height)//2), im)
    sq = sq.resize((1024, 1024), Image.LANCZOS)
    buf = BytesIO(); sq.save(buf, 'PNG'); buf.seek(0)

    prompt = STYLE + " SCENE: " + SCENES[slug]
    r = requests.post(
        'https://api.openai.com/v1/images/edits',
        headers={'Authorization': f'Bearer {KEY}'},
        files={'image': ('input.png', buf, 'image/png')},
        data={'model': 'gpt-image-1.5', 'prompt': prompt,
              'size': '1024x1024', 'quality': 'high',
              'background': 'transparent', 'output_format': 'png', 'n': '1'},
        timeout=300,
    )
    if r.status_code != 200:
        print(f"ERR {slug}: {r.status_code} {r.text[:400]}"); sys.exit(1)
    open(dst, 'wb').write(base64.b64decode(r.json()['data'][0]['b64_json']))
    print(f"OK {slug} ({os.path.getsize(dst)//1024} KB) -> {dst}")

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    names = args if args else list(SCENES)
    for n in names:
        gen(n, force)
