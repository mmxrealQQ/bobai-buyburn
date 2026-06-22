#!/usr/bin/env python3
"""
Compose a final BOBAI Buy-Drop NFT card from a motif scene + rarity layer.
Layout: 1024x1280 portrait card.
  - Motif PNG at top (1024x1024)
  - Footer band 1024x256 with rarity label + serial
  - Full frame border in rarity color, with subtle inner glow

Usage:
  python compose_card.py nice-buy 0 1 1000      # motif=nice-buy, rarity=0 (Common), #1 of 1000
  python compose_card.py whale-buy 3 42 162     # motif=whale-buy, rarity=3 (Mythical), #42 of 162
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SCENES_DIR = r'd:/ai/fourmeme/nft/scenes'
OUT_DIR    = r'd:/ai/fourmeme/nft/cards'
os.makedirs(OUT_DIR, exist_ok=True)

# rarity_id : (name, hex, accent_glow)
RARITIES = {
    0: ('COMMON',    '#b0c3d9'),
    1: ('UNCOMMON',  '#5e98d9'),
    2: ('RARE',      '#4b69ff'),
    3: ('MYTHICAL',  '#8847ff'),
    4: ('LEGENDARY', '#d32ce6'),
    5: ('ANCIENT',   '#eb4b4b'),
    6: ('IMMORTAL',  '#b28a33'),
}

TIER_LABELS = {
    'nice-buy':    ('NICE BUY',    '$100+',  '💰'),
    'big-buy':     ('BIG BUY',     '$150+',  '💎'),
    'huge-buy':    ('HUGE BUY',    '$250+',  '🚀'),
    'whale-buy':   ('WHALE BUY',   '$500+',  '🐋'),
    'thunder-buy': ('THUNDER BUY', '$1000+', '⚡'),
    'kraken-buy':  ('KRAKEN BUY',  '$2500+', '🦑'),
}

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def load_font(size, bold=True):
    candidates = [
        r'C:/Windows/Fonts/arialbd.ttf' if bold else r'C:/Windows/Fonts/arial.ttf',
        r'C:/Windows/Fonts/seguibl.ttf',
        r'C:/Windows/Fonts/segoeuib.ttf',
        r'C:/Windows/Fonts/calibrib.ttf',
    ]
    for p in candidates:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def compose(motif_slug, rarity_id, serial, total):
    motif_path = f'{SCENES_DIR}/{motif_slug}.png'
    if not os.path.exists(motif_path):
        print(f"missing motif: {motif_path}"); sys.exit(1)
    if rarity_id not in RARITIES:
        print(f"bad rarity: {rarity_id}"); sys.exit(1)
    if motif_slug not in TIER_LABELS:
        print(f"unknown tier: {motif_slug}"); sys.exit(1)

    rar_name, rar_hex = RARITIES[rarity_id]
    rar_rgb = hex_to_rgb(rar_hex)
    tier_name, tier_threshold, tier_emoji = TIER_LABELS[motif_slug]

    W, H = 1024, 1280
    FOOTER_H = 256

    # Canvas: dark backdrop
    card = Image.new('RGB', (W, H), (15, 17, 22))

    # Motif on top
    motif = Image.open(motif_path).convert('RGB').resize((W, W), Image.LANCZOS)
    card.paste(motif, (0, 0))

    # Footer band (very dark, slightly tinted by rarity)
    footer = Image.new('RGB', (W, FOOTER_H), (10, 12, 16))
    card.paste(footer, (0, W))

    # Inner glow: soft rarity-color halo just inside the frame
    glow = Image.new('RGB', (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rectangle([0, 0, W-1, H-1], outline=rar_rgb, width=40)
    glow = glow.filter(ImageFilter.GaussianBlur(28))
    card = Image.blend(card, Image.eval(glow, lambda v: min(v*2, 255)), 0.35)

    d = ImageDraw.Draw(card)

    # Crisp outer frame in rarity color (8px)
    for i in range(8):
        d.rectangle([i, i, W-1-i, H-1-i], outline=rar_rgb)

    # Top header strip — buy-tier name + threshold
    f_tier  = load_font(38, bold=True)
    f_thr   = load_font(28, bold=False)
    f_brand = load_font(28, bold=True)

    header_y = 24
    d.text((40, header_y), f"{tier_emoji}  {tier_name}", font=f_tier, fill=(255, 255, 255))
    d.text((40, header_y + 50), tier_threshold, font=f_thr, fill=(243, 186, 47))  # BNB gold
    # right side brand
    brand_text = "$BOBAI"
    bbox = d.textbbox((0, 0), brand_text, font=f_brand)
    bw = bbox[2] - bbox[0]
    d.text((W - 40 - bw, header_y + 8), brand_text, font=f_brand, fill=(243, 186, 47))

    # Footer: rarity label (left), serial (right)
    f_rar    = load_font(72, bold=True)
    f_serial = load_font(52, bold=True)
    f_sub    = load_font(26, bold=False)

    foot_top = W
    # Separator line in rarity color
    d.rectangle([24, foot_top + 12, W - 24, foot_top + 14], fill=rar_rgb)

    # Rarity name
    d.text((48, foot_top + 50), rar_name, font=f_rar, fill=rar_rgb)
    d.text((48, foot_top + 50 + 80), "RARITY", font=f_sub, fill=(160, 160, 170))

    # Serial — right aligned
    serial_text = f"#{serial:04d}"
    of_text = f"/ {total}"
    bbox_s = d.textbbox((0, 0), serial_text, font=f_serial)
    sw = bbox_s[2] - bbox_s[0]
    d.text((W - 48 - sw, foot_top + 60), serial_text, font=f_serial, fill=(255, 255, 255))
    bbox_o = d.textbbox((0, 0), of_text, font=f_sub)
    ow = bbox_o[2] - bbox_o[0]
    d.text((W - 48 - ow, foot_top + 130), of_text, font=f_sub, fill=(160, 160, 170))

    out = f'{OUT_DIR}/{motif_slug}-{rar_name.lower()}-{serial:04d}.png'
    card.save(out, 'PNG', optimize=True)
    print(f"OK -> {out}  ({os.path.getsize(out)//1024} KB)")
    return out

if __name__ == '__main__':
    if len(sys.argv) < 5:
        print("usage: compose_card.py <motif> <rarity_id 0-6> <serial> <total>"); sys.exit(1)
    compose(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))
