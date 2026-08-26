#!/usr/bin/env python3
"""
Build Telegram video stickers from the Sora clips: center-crop square, 512²,
24fps, ≤2.9s, caption pop-in overlay (same meme style as build_sticker.py),
VP9 encode with CRF sweep to ≤250 KB.

Usage: python stickers/build_sora_sticker.py <slug ...>
"""
import os, sys, glob, math, subprocess
from PIL import Image, ImageDraw, ImageFont

STK = r'd:/ai/fourmeme/stickers'
# ffmpeg is taken from PATH. It used to be an absolute WinGet path, which
# carried the build machine's Windows account name into every published copy of
# this file. Set FFMPEG=/full/path/to/ffmpeg if yours is somewhere PATH cannot
# see it.
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')

SIZE = 512; FPS = 24; DUR = 2.9

CAPTIONS = {
    'saga-pump':     ("MAY THE PUMP", "BE WITH YOU"),
    'saga-patience': ("PATIENCE", "YOU MUST HAVE"),
    'saga-nosell':   ("SELL", "YOU MUST NOT"),
    'saga-hodl':     ("STRONG", "THE HODL IS"),
    'saga-fear':     ("FEAR LEADS TO", "PAPER HANDS"),
    'saga-snap':     ("THE PUMP IS", "INEVITABLE"),
    'saga-smash':    ("HODL", "SMASH"),
    'saga-thunder':  ("BRING ME", "THE GREEN CANDLES"),
    'saga-captain':  ("I CAN HODL", "THIS ALL DAY"),
    'saga-spidey':   ("PAPER HANDS", "SPOTTED"),
    'saga-sayagain': ("SAY PAPER HANDS", "ONE MORE TIME"),
    'saga-confused': ("WHERE IS", "THE DIP?"),
    'saga-dance':    ("SIDEWAYS MARKET?", "JUST DANCE"),
    'saga-wallet':   ("WHAT'S IN", "THE WALLET?"),
    'saga-shake':    ("THAT'S A 5 BNB", "MILKSHAKE"),
    'degen-3am':        ("ONE LAST", "CHART CHECK"),
    'degen-upsidedown': ("LOOKS BULLISH", "FROM HERE"),
    'degen-ironing':    ("FIXING", "PAPER HANDS"),
    'degen-snail':      ("STILL", "GOING UP"),
    'degen-furnace':    ("THE BURNS", "CONTINUE"),
    'degen-wen':        ("WEN",),
    'degen-defib':      ("STAY", "WITH ME"),
    'degen-fishing':    ("CAUGHT", "THE BOTTOM"),
    'degen-trustmebro': ("TRUST ME", "BRO"),
    'degen-bouncer':    ("HOLDERS", "ONLY"),
    'saga-moonwalk':    ("MOONWALKING", "TO THE MOON"),
    'degen-lean':       ("THE DIP", "CAN'T TILT ME"),
    'saga-thriller':    ("DEAD MARKET?", "STILL DANCING"),
    'degen-popcorn':    ("JUST HERE FOR", "THE DRAMA"),
    'saga-toespin':     ("GREEN CANDLES?", "SHOWTIME"),
    'saga-march':       ("THEY DON'T REALLY", "CARE ABOUT US"),
    'saga-futures':     ("I'VE SEEN THE FUTURE", "IT'S GREEN"),
    'saga-rocky':       ("STILL HOLDING", "STILL STANDING"),
    'saga-matrix':      ("DODGING", "THE FUD"),
    'saga-wolf':        ("PUMP CHANT", "ACTIVATED"),
    'saga-delorean':    ("I'VE BEEN TO 2030", "WE MADE IT"),
}

# offset (s) into the sora clip — skip the still first moments if needed
START = {s: 0.15 for s in CAPTIONS}

_FONTS = {}
def font(px):
    px = int(px)
    if px not in _FONTS:
        _FONTS[px] = ImageFont.truetype(r'C:/Windows/Fonts/impact.ttf', px)
    return _FONTS[px]

def clamp01(x): return max(0.0, min(1.0, x))

def ease_back(p):
    c3 = 1.70158
    p = clamp01(p)
    return 1 + (c3 + 1) * ((p - 1) ** 3) + c3 * ((p - 1) ** 2)

def caption(im, t, lines, t0=0.06, dur=0.16):
    p = clamp01((t - t0) / dur)
    if p <= 0: return
    sc = 0.6 + 0.4 * ease_back(p)
    a = int(255 * min(1.0, p * 2.0))
    sw = max(2, int(SIZE * 0.008))
    lay = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    ys = SIZE * 0.985
    for ln in reversed(lines):
        px = SIZE * 0.082
        f = font(px * sc)
        bb = d.textbbox((0, 0), ln, font=f, stroke_width=sw)
        while bb[2] - bb[0] > SIZE * 0.94 and px > 20:   # auto-shrink long lines
            px *= 0.93
            f = font(px * sc)
            bb = d.textbbox((0, 0), ln, font=f, stroke_width=sw)
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        ys -= h * 1.16
        d.text((SIZE/2 - w/2 - bb[0], ys - bb[1]), ln, font=f,
               fill=(255, 255, 255, a), stroke_width=sw, stroke_fill=(0, 0, 0, a))
    im.alpha_composite(lay)

def build(slug):
    src = f'{STK}/assets/video/{slug}.mp4'
    fdir = f'{STK}/frames/{slug}-sora'
    out = f'{STK}/out/bobai-{slug}.webm'
    os.makedirs(fdir, exist_ok=True)
    for old in glob.glob(fdir + '/*.png'): os.remove(old)
    # extract square frames (input is 720x1280 with content at y=280)
    subprocess.run([FFMPEG, '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', str(START[slug]), '-t', str(DUR), '-i', src,
        '-vf', f'crop=720:720:0:280,scale={SIZE}:{SIZE},fps={FPS}',
        f'{fdir}/f%03d.png'], check=True)
    frames = sorted(glob.glob(fdir + '/f*.png'))
    n = len(frames)
    for i, fp in enumerate(frames):
        im = Image.open(fp).convert('RGBA')
        caption(im, i / n, CAPTIONS[slug])
        im.save(fp)
    for crf in (34, 38, 42, 46, 50, 54, 58, 62):
        subprocess.run([FFMPEG, '-y', '-hide_banner', '-loglevel', 'error',
            '-framerate', str(FPS), '-i', f'{fdir}/f%03d.png',
            '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0',
            '-crf', str(crf), '-an', '-auto-alt-ref', '0', out], check=True)
        kb = os.path.getsize(out) / 1024
        if kb <= 250:
            print(f"{slug}: {n} frames, {kb:.0f} KB (crf {crf}) -> {out}"); return
    print(f"{slug}: {kb:.0f} KB (crf {crf}) -> {out} (over budget!)")

if __name__ == '__main__':
    for s in (sys.argv[1:] or list(CAPTIONS)):
        build(s)
