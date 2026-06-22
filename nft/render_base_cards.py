#!/usr/bin/env python3
"""
Render the 42 base NFT cards (6 motifs x 7 rarities) WITHOUT serial number.
Each cell type gets one image; the serial number lives in metadata as a trait.

Output: nft/cards/base/<tier_slug>-<rarity_slug>.png
        e.g. nice-buy-common.png, kraken-buy-immortal.png
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SCENES_DIR = r'd:/ai/fourmeme/nft/scenes'
OUT_DIR    = r'd:/ai/fourmeme/nft/cards/base'
os.makedirs(OUT_DIR, exist_ok=True)

RARITIES = [
    (0, 'common',    'COMMON',    '#b0c3d9'),
    (1, 'uncommon',  'UNCOMMON',  '#5e98d9'),
    (2, 'rare',      'RARE',      '#4b69ff'),
    (3, 'mythical',  'MYTHICAL',  '#8847ff'),
    (4, 'legendary', 'LEGENDARY', '#d32ce6'),
    (5, 'ancient',   'ANCIENT',   '#eb4b4b'),
    (6, 'immortal',  'IMMORTAL',  '#b28a33'),
]

TIERS = [
    ('nice-buy',    'NICE BUY',    '$100+',  '💰'),
    ('big-buy',     'BIG BUY',     '$150+',  '💎'),
    ('huge-buy',    'HUGE BUY',    '$250+',  '🚀'),
    ('whale-buy',   'WHALE BUY',   '$500+',  '🐋'),
    ('thunder-buy', 'THUNDER BUY', '$1000+', '⚡'),
    ('kraken-buy',  'KRAKEN BUY',  '$2500+', '🦑'),
]

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def load_font(size, bold=True):
    candidates = [
        r'C:/Windows/Fonts/arialbd.ttf' if bold else r'C:/Windows/Fonts/arial.ttf',
        r'C:/Windows/Fonts/seguibl.ttf',
    ]
    for p in candidates:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def render(motif_slug, tier_name, tier_threshold, tier_emoji,
           rar_slug, rar_label, rar_hex):
    motif_path = f'{SCENES_DIR}/{motif_slug}.png'
    rar_rgb = hex_to_rgb(rar_hex)

    W, H = 1024, 1280
    FOOTER_H = 256

    card = Image.new('RGB', (W, H), (15, 17, 22))
    motif = Image.open(motif_path).convert('RGB').resize((W, W), Image.LANCZOS)
    card.paste(motif, (0, 0))

    # Footer band
    footer = Image.new('RGB', (W, FOOTER_H), (10, 12, 16))
    card.paste(footer, (0, W))

    # Soft inner glow in rarity color
    glow = Image.new('RGB', (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rectangle([0, 0, W-1, H-1], outline=rar_rgb, width=40)
    glow = glow.filter(ImageFilter.GaussianBlur(28))
    card = Image.blend(card, Image.eval(glow, lambda v: min(v*2, 255)), 0.35)

    d = ImageDraw.Draw(card)

    # Crisp outer frame in rarity color (8 px)
    for i in range(8):
        d.rectangle([i, i, W-1-i, H-1-i], outline=rar_rgb)

    # Top header
    f_tier  = load_font(38, bold=True)
    f_thr   = load_font(28, bold=False)
    f_brand = load_font(28, bold=True)

    header_y = 24
    d.text((40, header_y), f"{tier_emoji}  {tier_name}", font=f_tier, fill=(255, 255, 255))
    d.text((40, header_y + 50), tier_threshold, font=f_thr, fill=(243, 186, 47))  # BNB gold
    brand_text = "$BOBAI"
    bbox = d.textbbox((0, 0), brand_text, font=f_brand)
    bw = bbox[2] - bbox[0]
    d.text((W - 40 - bw, header_y + 8), brand_text, font=f_brand, fill=(243, 186, 47))

    # Footer: rarity name large left, collection wordmark right
    f_rar    = load_font(72, bold=True)
    f_coll   = load_font(34, bold=True)
    f_sub    = load_font(26, bold=False)

    foot_top = W
    d.rectangle([24, foot_top + 12, W - 24, foot_top + 14], fill=rar_rgb)

    d.text((48, foot_top + 50), rar_label, font=f_rar, fill=rar_rgb)
    d.text((48, foot_top + 50 + 80), "RARITY", font=f_sub, fill=(160, 160, 170))

    # Right side: collection brand text
    coll_text = "BUY DROPS"
    bbox_c = d.textbbox((0, 0), coll_text, font=f_coll)
    cw = bbox_c[2] - bbox_c[0]
    d.text((W - 48 - cw, foot_top + 70), coll_text, font=f_coll, fill=(255, 255, 255))
    sub_text = "BOBAI Collection"
    bbox_s = d.textbbox((0, 0), sub_text, font=f_sub)
    sw = bbox_s[2] - bbox_s[0]
    d.text((W - 48 - sw, foot_top + 130), sub_text, font=f_sub, fill=(160, 160, 170))

    out = f'{OUT_DIR}/{motif_slug}-{rar_slug}.png'
    card.save(out, 'PNG', optimize=True)
    return out

def main():
    n = 0
    for tier_slug, tier_name, tier_thr, tier_emoji in TIERS:
        for rar_id, rar_slug, rar_label, rar_hex in RARITIES:
            out = render(tier_slug, tier_name, tier_thr, tier_emoji,
                         rar_slug, rar_label, rar_hex)
            n += 1
            print(f"[{n:2d}/42] {out.replace(chr(92), '/')}")
    print(f"\nDone — {n} cards in {OUT_DIR}")

if __name__ == '__main__':
    main()
