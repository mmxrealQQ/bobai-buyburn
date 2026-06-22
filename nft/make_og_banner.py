#!/usr/bin/env python3
"""
Compose the BOBAI Buy Drops OG banner (1200x630) from the 6 motif scenes.
- 6 motif tiles in a row across the top
- Title + tagline strip at the bottom
- C2PA metadata stripped via JPG re-encode (avoids X "made with AI" label)

Output: dashboard/nft/og-banner.jpg
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SCENES_DIR = r'd:/ai/fourmeme/nft/scenes'
OUT        = r'd:/ai/fourmeme/dashboard/nft/og-banner.jpg'

TIERS = [
    ('nice-buy',    '💰', 'NICE',    '$100+'),
    ('big-buy',     '💎', 'BIG',     '$150+'),
    ('huge-buy',    '🚀', 'HUGE',    '$250+'),
    ('whale-buy',   '🐋', 'WHALE',   '$500+'),
    ('thunder-buy', '⚡', 'THUNDER', '$1000+'),
    ('kraken-buy',  '🦑', 'KRAKEN',  '$2500+'),
]

GOLD   = (240, 185, 11)
GOLD2  = (255, 213, 79)
WHITE  = (255, 255, 255)
MUTED  = (167, 173, 192)
BG     = (5, 5, 16)
CARD   = (12, 12, 28)
BORDER = (240, 185, 11, 22)

def load_font(size, bold=True):
    candidates = [
        r'C:/Windows/Fonts/arialbd.ttf' if bold else r'C:/Windows/Fonts/arial.ttf',
        r'C:/Windows/Fonts/seguibl.ttf',
    ]
    for p in candidates:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def main():
    W, H = 1200, 630
    canvas = Image.new('RGB', (W, H), BG)

    # subtle gold radial glow at top
    glow = Image.new('RGB', (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-200, -350, W+200, 350], fill=(60, 46, 5))
    glow = glow.filter(ImageFilter.GaussianBlur(80))
    canvas = Image.blend(canvas, Image.eval(glow, lambda v: min(int(v*1.5), 255)), 0.45)

    # Motif strip — 6 tiles across the top
    margin_x = 40
    margin_top = 64
    gap = 14
    tile_w = (W - 2*margin_x - 5*gap) // 6
    tile_h = tile_w  # square
    for i, (slug, emoji, name, threshold) in enumerate(TIERS):
        x = margin_x + i * (tile_w + gap)
        y = margin_top
        # tile bg card with gold-tinted border
        tile_bg = Image.new('RGBA', (tile_w, tile_h + 56), (12, 12, 28, 235))
        canvas.paste(tile_bg, (x, y), tile_bg)

        # motif image
        motif_path = f'{SCENES_DIR}/{slug}.png'
        if os.path.exists(motif_path):
            im = Image.open(motif_path).convert('RGB').resize((tile_w, tile_h), Image.LANCZOS)
            canvas.paste(im, (x, y))

        d = ImageDraw.Draw(canvas)
        # frame line
        for k in range(2):
            d.rectangle([x+k, y+k, x+tile_w-1-k, y+tile_h+55-k], outline=(GOLD[0], GOLD[1], GOLD[2], 30))
        # label below image
        f_l = load_font(20, bold=True)
        f_t = load_font(15, bold=False)
        label = f"{emoji} {name}"
        bbox = d.textbbox((0, 0), label, font=f_l)
        lw = bbox[2] - bbox[0]
        d.text((x + (tile_w - lw)//2, y + tile_h + 6), label, font=f_l, fill=WHITE)
        bbox = d.textbbox((0, 0), threshold, font=f_t)
        tw = bbox[2] - bbox[0]
        d.text((x + (tile_w - tw)//2, y + tile_h + 32), threshold, font=f_t, fill=GOLD)

    # Bottom title strip
    d = ImageDraw.Draw(canvas)
    # gold divider line
    div_y = margin_top + tile_h + 56 + 40
    d.rectangle([margin_x, div_y, W - margin_x, div_y + 2], fill=GOLD)

    f_title = load_font(56, bold=True)
    f_sub   = load_font(24, bold=False)
    f_brand = load_font(18, bold=True)

    title = "BOBAI Buy Drops"
    bbox = d.textbbox((0, 0), title, font=f_title)
    tw = bbox[2] - bbox[0]
    title_y = div_y + 24
    # soft shadow
    d.text(((W - tw)//2 + 2, title_y + 2), title, font=f_title, fill=(0, 0, 0))
    d.text(((W - tw)//2,     title_y),     title, font=f_title, fill=WHITE)

    sub = "Every $BOBAI buy ≥ $100  =  1 collectible NFT to your wallet · 1,925 total · auto-minted on BNB Chain"
    bbox = d.textbbox((0, 0), sub, font=f_sub)
    sw = bbox[2] - bbox[0]
    d.text(((W - sw)//2, title_y + 76), sub, font=f_sub, fill=MUTED)

    brand = "brainonbnb.com/nft"
    bbox = d.textbbox((0, 0), brand, font=f_brand)
    bw = bbox[2] - bbox[0]
    d.text(((W - bw)//2, H - 38), brand, font=f_brand, fill=GOLD)

    # Save JPG (no C2PA metadata)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    canvas.save(OUT, 'JPEG', quality=90, optimize=True)
    print(f'OK -> {OUT} ({os.path.getsize(OUT)//1024} KB)')

if __name__ == '__main__':
    main()
