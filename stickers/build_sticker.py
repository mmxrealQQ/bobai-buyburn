#!/usr/bin/env python3
"""
BOBAI animated Telegram sticker builder — "Brain on BNB AI", GLOSSY 3D look.
The REAL brain (assets/brain.png, never AI-gen) RIDES/INTERACTS with one big glossy
hero prop as a single unit — never covering it. Polished with drop shadows, aura
glows, bokeh particles and smooth premium motion. Each motif has its own personality.

  moon     — brain rides a rocket "to the moon": smooth thrust sway, flame, star parallax.
  cool     — brain surfs a green pump-candle in shades: confident bob/lean, coins, sparkle.
  sunshine — brain sits on a big sun: slow sun spin + ray breathe, gentle bob, hearts.

VP9/alpha .webm, Telegram spec (512², <=3s, <=30fps, <=256KB, no audio, transparent).
Usage: python build_sticker.py [moon|cool|sunshine ...]
"""
import math, os, sys, subprocess, glob
from PIL import Image, ImageDraw, ImageFilter

SS = 2; SIZE = 512; R = SIZE * SS; FPS = 30; DUR = 2.0; N = int(FPS * DUR)
ROOT = r'd:/ai/fourmeme'; STK = ROOT + '/stickers'
# ffmpeg is taken from PATH. It used to be an absolute WinGet path, which
# carried the build machine's Windows account name into every published copy of
# this file. Set FFMPEG=/full/path/to/ffmpeg if yours is somewhere PATH cannot
# see it.
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')

def load(p): return Image.open(p).convert('RGBA')
BRAIN = load(STK + '/assets/brain.png')
CHAR3 = load(STK + '/assets/character-3.png')   # full-body BOBAI figure (314x512)
CHAR4 = load(STK + '/assets/character-4.png')   # full-body BOBAI figure (185x512)
COIN  = load(ROOT + '/dashboard/worldcup/app/illus/coin-bnb.webp')
PROPS = {os.path.splitext(os.path.basename(p))[0]: load(p)
         for p in glob.glob(STK + '/assets/props/*.png')}
SCENES = {os.path.splitext(os.path.basename(p))[0]: load(p)
          for p in glob.glob(STK + '/assets/scenes/*.png')}

# ---------- math ----------
def clamp01(x): return max(0.0, min(1.0, x))
def pulse(t, f=1): return 0.5 - 0.5*math.cos(2*math.pi*f*t)          # 0..1..0 loop
def wob(t, f=1): return math.sin(2*math.pi*f*t)                       # -1..1 loop
def jitter(t, a, f1, f2): return a*(math.sin(2*math.pi*f1*t)+0.4*math.sin(2*math.pi*f2*t+1))

# ---------- compositing ----------
def fit(img, w):
    return img.resize((max(1,int(w)), max(1,int(img.height*w/img.width))), Image.LANCZOS)

def place(canvas, img, cx, cy, w=None, rot=0, opacity=1.0):
    im = fit(img, w) if w else img
    if rot: im = im.rotate(rot, expand=True, resample=Image.BICUBIC)
    if opacity < 1.0:
        im = im.copy(); im.putalpha(im.getchannel('A').point(lambda v: int(v*clamp01(opacity))))
    canvas.alpha_composite(im, (int(cx-im.width/2), int(cy-im.height/2)))

def glow(canvas, cx, cy, rad, color, alpha, blur=0.05):
    g = Image.new('RGBA', (R, R), (0,0,0,0))
    ImageDraw.Draw(g).ellipse([cx-rad, cy-rad, cx+rad, cy+rad], fill=color+(int(max(0,min(255,alpha))),))
    canvas.alpha_composite(g.filter(ImageFilter.GaussianBlur(R*blur)))

def drop(canvas, layer, oy, dy=0.045, blur=0.028, dark=120):
    """Soft drop shadow of an RGBA full-canvas `layer`, then the layer itself, offset by oy."""
    sh = Image.new('RGBA', (R, R), (0,0,0,0))
    sh.paste(Image.new('RGBA', (R, R), (0,0,0,dark)), (0,0), layer.getchannel('A'))
    sh = sh.filter(ImageFilter.GaussianBlur(R*blur))
    canvas.alpha_composite(sh, (0, int(oy + R*dy)))
    canvas.alpha_composite(layer, (0, int(oy)))

def bokeh(canvas, t, color, n=7, blur=0.035):
    for i in range(n):
        ph = ((t + i*0.137) % 1.0)
        x = (0.10 + 0.80*((i*0.41) % 1.0)) * R
        y = R*1.15 - ((ph + i*0.07) % 1.0) * R*1.3
        rad = R*(0.018 + 0.030*((i*0.7) % 1.0))
        glow(canvas, x, y, rad, color, 30 + 35*pulse(ph), blur=blur)

def sparkle(canvas, cx, cy, rad, alpha, color=(255,255,255)):
    lay = Image.new('RGBA', (R, R), (0,0,0,0)); d = ImageDraw.Draw(lay); k = rad*0.22
    d.polygon([(cx,cy-rad),(cx+k,cy-k),(cx+rad,cy),(cx+k,cy+k),
               (cx,cy+rad),(cx-k,cy+k),(cx-rad,cy),(cx-k,cy-k)], fill=color+(int(max(0,alpha)),))
    canvas.alpha_composite(lay)

def heart(canvas, cx, cy, s, alpha, color=(255,105,160)):
    lay = Image.new('RGBA', (R, R), (0,0,0,0)); d = ImageDraw.Draw(lay)
    d.pieslice([cx-s, cy-s, cx, cy], 180, 360, fill=color+(int(max(0,alpha)),))
    d.pieslice([cx, cy-s, cx+s, cy], 180, 360, fill=color+(int(max(0,alpha)),))
    d.polygon([(cx-s*0.96, cy-s*0.16), (cx+s*0.96, cy-s*0.16), (cx, cy+s*1.12)],
              fill=color+(int(max(0,alpha)),))
    canvas.alpha_composite(lay)

def streak(canvas, cx, cy, w, h, alpha, color=(220,235,255)):
    lay = Image.new('RGBA', (R, R), (0,0,0,0))
    ImageDraw.Draw(lay).rounded_rectangle([cx-w/2, cy-h/2, cx+w/2, cy+h/2], radius=w/2,
                                          fill=color+(int(max(0,alpha)),))
    canvas.alpha_composite(lay)

def droplet(canvas, cx, cy, s, alpha, color=(120,200,255)):
    """Cyan water droplet (teardrop)."""
    lay = Image.new('RGBA', (R, R), (0,0,0,0)); d = ImageDraw.Draw(lay)
    a = int(max(0, min(255, alpha)))
    d.ellipse([cx-s, cy-s*0.4, cx+s, cy+s*1.6], fill=color+(a,))
    d.polygon([(cx-s*0.55, cy-s*0.1), (cx, cy-s*1.5), (cx+s*0.55, cy-s*0.1)],
              fill=color+(a,))
    canvas.alpha_composite(lay)

def beam(canvas, x1, y1, x2, y2, w, alpha, color=(255,60,60), core=(255,200,200)):
    """Glowing laser beam line with bright core."""
    lay = Image.new('RGBA', (R, R), (0,0,0,0))
    a = int(max(0, min(255, alpha))); ac = int(max(0, min(255, alpha*0.85)))
    d = ImageDraw.Draw(lay)
    d.line([(x1,y1),(x2,y2)], fill=color+(a,), width=max(1,int(w)))
    d.line([(x1,y1),(x2,y2)], fill=core+(ac,), width=max(1,int(w*0.40)))
    canvas.alpha_composite(lay.filter(ImageFilter.GaussianBlur(R*0.004)))

# ================= MOTIFS =================
def m_moon(f):
    """Brain RIDES the rocket to the moon — smooth thrust sway, flame, star parallax, blue bokeh."""
    t = f / N; c = Image.new('RGBA', (R,R), (0,0,0,0)); cx = R/2
    glow(c, cx, R*0.5, R*0.40, (70,140,255), 70+35*pulse(t), blur=0.09)
    bokeh(c, t, (120,180,255), n=7)
    # downward star parallax
    for i in range(5):
        tp = (t*1.6 + i/5) % 1.0
        streak(c, cx + (i-2)*R*0.18, -R*0.1 + tp*R*1.25, R*0.014, R*0.13, 130*(1-abs(tp-0.5)))
    # rocket+brain unit
    unit = Image.new('RGBA', (R,R), (0,0,0,0)); ucy = R*0.54
    place(unit, PROPS['rocket'], cx, ucy, w=R*0.42)
    place(unit, BRAIN, cx, ucy - R*0.20, w=R*0.25, rot=0)
    ang = 4*wob(t, 1) + jitter(t, 1.2, 9, 17)          # sway + fine thrust shake
    oy  = -R*0.02*wob(t, 1)
    # flame under nozzle (flicker), drawn before unit
    fl = R*0.5 + oy
    glow(c, cx, fl + R*0.30, R*0.11*(1+0.35*pulse(t,6)), (255,150,40), 170+60*pulse(t,6), blur=0.03)
    glow(c, cx, fl + R*0.34, R*0.06, (255,240,150), 220, blur=0.02)
    u = unit.rotate(ang, resample=Image.BICUBIC, center=(cx, R*0.54))
    drop(c, u, oy, dy=0.05, blur=0.03, dark=110)
    for i,(px,py) in enumerate([(0.16,0.16),(0.85,0.20),(0.80,0.74)]):
        tw = pulse(t, 1+i); sparkle(c, px*R, py*R, R*0.02+R*0.025*tw, 255*tw)
    return c

def m_cool(f):
    """Brain SURFS a green pump-candle in shades — confident bob/lean, coins, sparkle, green glow."""
    t = f / N; c = Image.new('RGBA', (R,R), (0,0,0,0)); cx = cy = R/2
    glow(c, cx, R*0.5, R*0.36, (50,225,130), 75+30*pulse(t), blur=0.09)
    bokeh(c, t, (90,240,150), n=6)
    # floating BNB coins
    for k in range(2):
        tp = (t + k*0.5) % 1.0
        place(c, COIN, cx + (k*2-1)*R*0.34, R*0.42 - tp*R*0.18 + R*0.05*wob(t,1),
              w=R*0.12, opacity=0.85)
    # candle + brain (rider in shades) unit
    unit = Image.new('RGBA', (R,R), (0,0,0,0)); ucy = R*0.58
    place(unit, PROPS['candle'], cx, ucy, w=R*0.30)
    bdy = ucy - R*0.26
    place(unit, BRAIN, cx, bdy, w=R*0.30, rot=0)
    if 'sunglasses' in PROPS:
        place(unit, PROPS['sunglasses'], cx, bdy - R*0.03, w=R*0.27)
    ang = 5*wob(t, 1); oy = -R*0.018*wob(t, 1)          # smooth confident lean/bob
    u = unit.rotate(ang, resample=Image.BICUBIC, center=(cx, ucy))
    drop(c, u, oy, dy=0.05, blur=0.03, dark=110)
    if 0.2 < (t % 1.0) < 0.45:
        sparkle(c, cx+R*0.20, cy-R*0.18, R*0.05*pulse((t-0.2)/0.25), 255, (210,255,225))
    return c

def m_sunshine(f):
    """Brain sits on a big glossy sun — slow sun spin + ray breathe, gentle happy bob, hearts."""
    t = f / N; c = Image.new('RGBA', (R,R), (0,0,0,0)); cx = R/2
    glow(c, cx, R*0.56, R*0.46*(1+0.05*pulse(t)), (255,200,75), 120+45*pulse(t), blur=0.085)
    bokeh(c, t, (255,225,120), n=6)
    # big sun behind (slow spin + breathe)
    place(c, PROPS['sun'], cx, R*0.58, w=R*0.56*(1+0.035*pulse(t)), rot=t*36)
    # brain sitting on top of the sun (own gentle bob)
    brain_layer = Image.new('RGBA', (R,R), (0,0,0,0))
    bob = R*0.02*pulse(t, 2)
    place(brain_layer, BRAIN, cx, R*0.30 - bob, w=R*0.30, rot=5*wob(t,1))
    drop(c, brain_layer, 0, dy=0.045, blur=0.028, dark=90)
    # hearts floating up
    for i in range(3):
        tp = (t + i/3) % 1.0
        x = cx + (i-1)*R*0.27 + R*0.03*math.sin(tp*2*math.pi + i)
        y = R*0.62 - tp*R*0.66
        heart(c, x, y, R*0.05*(0.7+0.5*tp), 230*(1-abs(tp-0.5)*1.6))
    return c

# ---- per-motif FX overlays (fill empty canvas space with thematic accents) ----
def fx_thunder(c, t):
    """Corner mini-bolts + stylish energy crackles around the held bolt."""
    bolt = PROPS['lightning']
    for px, py, bw, rt, ph in [
        (0.12, 0.18, 0.12, -28, 0.00),
        (0.87, 0.16, 0.14,  22, 0.25),
        (0.09, 0.62, 0.11, -18, 0.50),
        (0.90, 0.66, 0.13,  24, 0.75),
    ]:
        lt = ((t + ph) * 2) % 1.0
        if lt < 0.5:
            a = math.sin(math.pi * (lt / 0.5))
            place(c, bolt, px*R, py*R,
                  w=R*bw*(0.85 + 0.30*a), rot=rt, opacity=a*0.9)
    # stylish gold crackles dancing around the held bolt (upper-center)
    for i in range(4):
        ph = (t*3 + i/4) % 1.0
        if ph < 0.4:
            a = math.sin(math.pi * (ph / 0.4))
            ang = i*1.6 + t*0.8
            bx = R*0.50 + R*0.13*math.cos(ang)
            by = R*0.30 + R*0.13*math.sin(ang)
            sparkle(c, bx, by, R*0.014 + R*0.020*a, 230*a, color=(255,230,100))

def fx_kraken(c, t):
    """Cyan water droplets pop around the corners — splashy aquatic vibe."""
    for px, py, bw, ph in [
        (0.10, 0.20, 0.025, 0.00),
        (0.88, 0.18, 0.028, 0.25),
        (0.08, 0.62, 0.022, 0.50),
        (0.90, 0.65, 0.026, 0.75),
        (0.20, 0.88, 0.020, 0.12),
        (0.80, 0.88, 0.022, 0.62),
    ]:
        lt = ((t + ph) * 2) % 1.0
        if lt < 0.5:
            a = math.sin(math.pi * (lt / 0.5))
            droplet(c, px*R, py*R + R*0.05*(1-a),
                    R*bw*(0.8 + 0.4*a), 220*a)

def fx_laser(c, t):
    """Animated red laser beams from approximate eye position + impact sparks."""
    pv = 0.5 + 0.5 * math.sin(2*math.pi*t*2)
    beam_a = 255 * (0.50 + 0.45*pv)
    beam_len = R*0.42 * (0.80 + 0.25*pv)
    for ex, ang_deg in [(0.42, 115), (0.58, 65)]:
        x1, y1 = ex*R, R*0.28
        rad = math.radians(ang_deg)
        x2 = x1 + beam_len * math.cos(rad)
        y2 = y1 + beam_len * math.sin(rad)
        beam(c, x1, y1, x2, y2, R*0.020, beam_a, (255,50,50), (255,200,200))
        sparkle(c, x2, y2, R*(0.018 + 0.025*pv), 230*pv, color=(255,100,100))

def fx_supernova(c, t):
    """Orange/red embers pop in corners — fiery burn energy."""
    for i,(px, py, bw, ph) in enumerate([
        (0.12, 0.22, 0.025, 0.00), (0.87, 0.20, 0.028, 0.20),
        (0.10, 0.65, 0.022, 0.40), (0.88, 0.62, 0.026, 0.60),
        (0.50, 0.08, 0.020, 0.80),
    ]):
        lt = ((t + ph) * 2) % 1.0
        if lt < 0.5:
            a = math.sin(math.pi * (lt / 0.5))
            col = (255,150,40) if i % 2 == 0 else (255,210,80)
            sparkle(c, px*R, py*R - R*0.06*a, R*bw*(0.85+0.40*a), 235*a, color=col)
            glow(c, px*R, py*R - R*0.06*a, R*bw*1.8, (255,80,20), 90*a, blur=0.030)

def fx_rocket(c, t):
    """Rising white-gold star streaks + tiny twinkling stars."""
    for i in range(5):
        tp = (t*1.5 + i/5) % 1.0
        x = (0.10 + 0.80*((i*0.41) % 1.0)) * R
        y = R*1.10 - tp*R*1.30
        a = 200 * (1 - abs(tp-0.5)*1.6)
        streak(c, x, y, R*0.010, R*0.10, max(0,a), color=(255,245,200))
    for i,(px, py) in enumerate([(0.13,0.30),(0.86,0.32),(0.18,0.70),(0.82,0.68),(0.50,0.12)]):
        tw = pulse(t + i*0.13, 2)
        sparkle(c, px*R, py*R, R*0.012 + R*0.018*tw, 220*tw, color=(255,255,210))

def fx_diamond(c, t):
    """Blue-white sparkle bursts dance around the gem."""
    for i,(px, py) in enumerate([(0.15,0.25),(0.84,0.22),(0.10,0.65),(0.88,0.60),
                                  (0.30,0.85),(0.70,0.88)]):
        ph = (t + i*0.16) % 1.0
        if ph < 0.5:
            a = math.sin(math.pi * (ph / 0.5))
            sparkle(c, px*R, py*R, R*0.018 + R*0.025*a, 240*a, color=(220,240,255))
            glow(c, px*R, py*R, R*0.06*a, (180,220,255), 110*a, blur=0.030)

def fx_bull(c, t):
    """Dust puffs at the bottom + horizontal motion streaks — charging vibes."""
    for px, py, bw, ph in [
        (0.15, 0.86, 0.040, 0.00), (0.85, 0.86, 0.045, 0.30),
        (0.30, 0.91, 0.035, 0.50), (0.70, 0.91, 0.038, 0.75),
    ]:
        lt = ((t + ph) * 2) % 1.0
        if lt < 0.6:
            a = math.sin(math.pi * (lt / 0.6))
            glow(c, px*R, py*R - R*0.04*a, R*bw*(1.1 + 0.7*a),
                 (210,190,160), 130*a, blur=0.04)
    for i in range(4):
        tp = (t*1.8 + i/4) % 1.0
        y = R*0.42 + (i-1.5)*R*0.09
        x = R*0.08 + tp*R*0.20
        a = 170 * (1 - abs(tp-0.5)*1.6)
        streak(c, x, y, R*0.06, R*0.009, max(0,a), color=(230,210,180))

def fx_hodl(c, t):
    """BNB coins pop in corners — gripping the bag."""
    for px, py, bw, ph in [
        (0.13, 0.25, 0.05, 0.00), (0.87, 0.22, 0.055, 0.25),
        (0.10, 0.68, 0.045, 0.50), (0.90, 0.65, 0.050, 0.75),
    ]:
        lt = ((t + ph) * 2) % 1.0
        if lt < 0.5:
            a = math.sin(math.pi * (lt / 0.5))
            place(c, COIN, px*R, py*R, w=R*bw*(0.70 + 0.45*a),
                  rot=360*lt*2, opacity=a*0.9)

def fx_gigabrain(c, t):
    """Blue-purple electric sparkles around the figure — pure intellect."""
    for i,(px, py) in enumerate([(0.13,0.30),(0.86,0.28),(0.10,0.65),(0.88,0.60),
                                  (0.50,0.08),(0.50,0.92)]):
        ph = (t*2 + i*0.18) % 1.0
        if ph < 0.5:
            a = math.sin(math.pi * (ph / 0.5))
            sparkle(c, px*R, py*R, R*0.014 + R*0.022*a, 220*a, color=(190,205,255))
            glow(c, px*R, py*R, R*0.07*a, (140,120,255), 110*a, blur=0.035)

def fx_wagmi(c, t):
    """Pink hearts float up + warm sparkles in corners."""
    for i in range(4):
        tp = (t + i/4) % 1.0
        x = (0.20 + 0.60*((i*0.41) % 1.0))*R
        y = R*0.95 - tp*R*0.90
        a = 220 * (1 - abs(tp-0.5)*1.6)
        heart(c, x, y, R*0.040*(0.70+0.50*tp), max(0,a), color=(255,120,170))
    for i,(px, py) in enumerate([(0.13,0.20),(0.86,0.22),(0.12,0.78),(0.88,0.78)]):
        tw = pulse(t + i*0.17, 2)
        sparkle(c, px*R, py*R, R*0.015 + R*0.020*tw, 220*tw, color=(255,220,200))

def fx_gm(c, t):
    """Rotating golden sunray-burst — 8 rays pulse outward and rotate around center."""
    cx, cy = R/2, R*0.50
    base_rot = t * 30  # slow rotation
    for i in range(8):
        ang = math.radians(base_rot + i*45)
        ph = ((t*1.2 + i/8) % 1.0)
        a = math.sin(math.pi * ph)
        r0 = R*0.18
        r1 = R*(0.28 + 0.10*a)
        x1 = cx + r0*math.cos(ang); y1 = cy + r0*math.sin(ang)
        x2 = cx + r1*math.cos(ang); y2 = cy + r1*math.sin(ang)
        # ray (rounded line) + tip sparkle
        lay = Image.new('RGBA', (R, R), (0,0,0,0))
        ImageDraw.Draw(lay).line([(x1,y1),(x2,y2)],
            fill=(255,210,80,int(200*a)), width=max(1,int(R*0.018)))
        c.alpha_composite(lay.filter(ImageFilter.GaussianBlur(R*0.004)))
        sparkle(c, x2, y2, R*0.014 + R*0.020*a, 220*a, color=(255,235,150))
    # corner twinkles
    for i,(px, py) in enumerate([(0.13,0.20),(0.86,0.22),(0.12,0.80),(0.88,0.78)]):
        tw = pulse(t + i*0.17, 2)
        sparkle(c, px*R, py*R, R*0.012 + R*0.018*tw, 210*tw, color=(255,240,180))

def fx_pump(c, t):
    """Green mini-candles rise from bottom + '+%' green sparks at top."""
    for i in range(5):
        tp = (t*1.4 + i/5) % 1.0
        x = (0.12 + 0.76*((i*0.41) % 1.0)) * R
        y = R*1.05 - tp*R*1.20
        a = 220 * (1 - abs(tp-0.5)*1.6)
        # green candle body (rounded)
        w = R*0.030; h = R*0.075
        lay = Image.new('RGBA', (R, R), (0,0,0,0))
        ImageDraw.Draw(lay).rounded_rectangle(
            [x-w/2, y-h/2, x+w/2, y+h/2], radius=w*0.35,
            fill=(60,220,120, int(max(0,a))))
        ImageDraw.Draw(lay).line([(x, y-h/2-R*0.020),(x, y-h/2)],
            fill=(60,220,120, int(max(0,a*0.8))), width=max(1,int(R*0.006)))
        c.alpha_composite(lay)
    # green +% sparks top
    for i,(px, py) in enumerate([(0.18,0.18),(0.50,0.10),(0.82,0.16),(0.30,0.28),(0.72,0.30)]):
        tw = pulse(t + i*0.19, 2)
        sparkle(c, px*R, py*R, R*0.015 + R*0.025*tw, 230*tw, color=(140,255,170))
        glow(c, px*R, py*R, R*0.05*tw, (60,220,120), 100*tw, blur=0.030)

def fx_dip(c, t):
    """Red candles rain from top + cyan splash droplets at bottom on impact."""
    for i in range(5):
        tp = (t*1.5 + i/5) % 1.0
        x = (0.12 + 0.76*((i*0.41) % 1.0)) * R
        y = -R*0.10 + tp*R*1.15
        a = 230 * (1 - abs(tp-0.5)*1.6)
        w = R*0.030; h = R*0.075
        lay = Image.new('RGBA', (R, R), (0,0,0,0))
        ImageDraw.Draw(lay).rounded_rectangle(
            [x-w/2, y-h/2, x+w/2, y+h/2], radius=w*0.35,
            fill=(230,70,80, int(max(0,a))))
        ImageDraw.Draw(lay).line([(x, y+h/2),(x, y+h/2+R*0.020)],
            fill=(230,70,80, int(max(0,a*0.8))), width=max(1,int(R*0.006)))
        c.alpha_composite(lay)
        # splash droplets when candle nears bottom (tp > 0.75)
        if tp > 0.75:
            sp = (tp - 0.75) / 0.25  # 0..1
            sa = 220 * (1 - sp)
            for k in (-1, 0, 1):
                droplet(c, x + k*R*0.04, R*0.93 + R*0.04*sp,
                        R*0.018 + R*0.012*sp, sa, color=(120,220,255))
    # corner cyan twinkles
    for i,(px, py) in enumerate([(0.13,0.78),(0.86,0.80),(0.20,0.90),(0.80,0.90)]):
        tw = pulse(t + i*0.21, 2)
        sparkle(c, px*R, py*R, R*0.012 + R*0.018*tw, 210*tw, color=(180,235,255))

def fx_builder(c, t):
    """Orange/white welding sparks shoot in arcs outward from hammer + glow pulse."""
    # hammer impact point (upper-center-right where character would swing)
    hx, hy = R*0.58, R*0.42
    # pulse glow at impact (rhythmic hammer hit)
    hit = pulse(t, 2)
    glow(c, hx, hy, R*0.08*(1+0.6*hit), (255,170,40), 160*hit, blur=0.035)
    glow(c, hx, hy, R*0.04*(1+0.4*hit), (255,240,150), 220*hit, blur=0.020)
    # spark arcs spraying outward (parabolic trajectories)
    for i in range(8):
        ph = ((t*2 + i/8) % 1.0)
        if ph < 0.7:
            a = math.sin(math.pi * (ph / 0.7))
            # initial direction (mostly right and up-right)
            ang = math.radians(-30 - i*15 + 10*math.sin(i))
            speed = R*0.28 + R*0.04*((i*7) % 5)
            # parabolic: x linear, y = sin upward then gravity down
            dx = speed * math.cos(ang) * ph
            dy = speed * math.sin(ang) * ph + R*0.45 * ph * ph
            x = hx + dx; y = hy + dy
            col = (255,180,50) if i % 2 == 0 else (255,235,170)
            sparkle(c, x, y, R*0.012 + R*0.018*a, 230*a, color=col)
    # corner warm twinkles
    for i,(px, py) in enumerate([(0.13,0.20),(0.86,0.22),(0.12,0.78),(0.88,0.76)]):
        tw = pulse(t + i*0.18, 2)
        sparkle(c, px*R, py*R, R*0.012 + R*0.017*tw, 200*tw, color=(255,220,160))

def fx_shield(c, t):
    """Concentric pulsing energy rings expand outward from shield + red rug-arrows
    fly in and spark on impact at the shield rim."""
    cx, cy = R/2, R*0.50
    # 3 expanding rings, phase-staggered
    for i in range(3):
        ph = ((t + i/3) % 1.0)
        rad = R*(0.20 + 0.20*ph)
        a = 180 * (1 - ph)
        ring = Image.new('RGBA', (R, R), (0,0,0,0))
        ImageDraw.Draw(ring).ellipse(
            [cx-rad, cy-rad, cx+rad, cy+rad],
            outline=(140,200,255,int(max(0,a))), width=max(1,int(R*0.008)))
        c.alpha_composite(ring.filter(ImageFilter.GaussianBlur(R*0.004)))
    # 4 red rug-arrows flying in from corners, spark on impact at rim
    SHIELD_R = R*0.20
    for i,(sx, sy, hit_ang_deg, ph_off) in enumerate([
        (0.05, 0.10, 225, 0.00),
        (0.95, 0.10, 315, 0.25),
        (0.05, 0.85, 135, 0.50),
        (0.95, 0.85,  45, 0.75),
    ]):
        ph = ((t*1.3 + ph_off) % 1.0)
        # impact point on shield rim
        rad = math.radians(hit_ang_deg)
        ix = cx + SHIELD_R*math.cos(rad)
        iy = cy + SHIELD_R*math.sin(rad)
        # arrow start = corner, end = impact (animate fly-in 0..0.6, then spark 0.6..1.0)
        if ph < 0.6:
            p = ph / 0.6  # 0..1 fly-in
            a = 220
            x1 = sx*R + (ix - sx*R) * (p*0.6)
            y1 = sy*R + (iy - sy*R) * (p*0.6)
            x2 = sx*R + (ix - sx*R) * (p*1.0)
            y2 = sy*R + (iy - sy*R) * (p*1.0)
            # arrow shaft
            lay = Image.new('RGBA', (R, R), (0,0,0,0))
            ImageDraw.Draw(lay).line([(x1,y1),(x2,y2)],
                fill=(230,60,70,a), width=max(1,int(R*0.010)))
            # arrow head (small triangle at tip)
            dxh = x2 - x1; dyh = y2 - y1
            mag = max(1e-6, math.sqrt(dxh*dxh + dyh*dyh))
            ux, uy = dxh/mag, dyh/mag
            px_, py_ = -uy, ux
            hs = R*0.022
            ImageDraw.Draw(lay).polygon([
                (x2, y2),
                (x2 - ux*hs + px_*hs*0.6, y2 - uy*hs + py_*hs*0.6),
                (x2 - ux*hs - px_*hs*0.6, y2 - uy*hs - py_*hs*0.6),
            ], fill=(230,60,70,a))
            c.alpha_composite(lay)
        else:
            # impact spark
            sp = (ph - 0.6) / 0.4  # 0..1
            sa = 240 * (1 - sp)
            sparkle(c, ix, iy, R*0.018 + R*0.030*(1-sp), sa, color=(255,180,180))
            glow(c, ix, iy, R*0.06*(1-sp), (255,80,80), 120*(1-sp), blur=0.030)

def fx_force(c, t):
    """pump-force (Yoda-BOBAI): green-gold sage aura — rising energy orbs + sparkles."""
    for i, xf in enumerate((0.10, 0.90, 0.16, 0.84, 0.06)):
        ph = ((t*0.9 + i*0.21) % 1.0)
        x = xf*R + R*0.02*wob(t*2 + i)
        y = R*(1.0 - ph*1.05)
        a = 150 * (1 - abs(ph-0.5)*2)
        col = (120, 230, 140) if i % 2 == 0 else (243, 186, 47)
        glow(c, x, y, R*(0.015 + 0.02*pulse(ph, 1)), col, a, blur=0.02)
    for i, (xf, yf) in enumerate([(0.08, 0.14), (0.92, 0.10), (0.10, 0.78), (0.90, 0.82)]):
        ph = ((t*1.4 + i*0.27) % 1.0)
        a = 220 * (1 - abs(ph-0.5)*2)
        col = (170, 255, 180) if i % 2 == 0 else (255, 220, 120)
        sparkle(c, xf*R, yf*R, R*(0.012 + 0.022*pulse(ph, 1)), a, color=col)

def m_scene(slug, fx=None):
    """Comic-scene motif: pre-rendered illustration breathes calmly + grounded
    (no vertical bob — doesn't float). Optional per-motif fx overlay."""
    def fn(f):
        t = f / N
        c = Image.new('RGBA', (R, R), (0,0,0,0))
        cx = R/2; cy = R/2
        scl = 1 + 0.030 * pulse(t, 1)
        rot = 0.6 * math.sin(2*math.pi*t + math.pi/3)
        place(c, SCENES[slug], cx, cy, w=R*0.96*scl, rot=rot)
        if fx: fx(c, t)
        return c
    return fn

m_thunder_buy    = m_scene('thunder-buy',    fx=fx_thunder)
m_kraken_buy     = m_scene('kraken-buy',     fx=fx_kraken)
m_laser          = m_scene('laser',          fx=fx_laser)
m_supernova_burn = m_scene('supernova-burn', fx=fx_supernova)
m_rocket         = m_scene('rocket',         fx=fx_rocket)
m_diamond        = m_scene('diamond',        fx=fx_diamond)
m_bull           = m_scene('bull',           fx=fx_bull)
m_hodl           = m_scene('hodl',           fx=fx_hodl)
m_gigabrain      = m_scene('gigabrain',      fx=fx_gigabrain)
m_wagmi          = m_scene('wagmi',          fx=fx_wagmi)
m_gm             = m_scene('gm',             fx=fx_gm)
m_pump           = m_scene('pump',           fx=fx_pump)
m_dip            = m_scene('dip',            fx=fx_dip)
m_builder        = m_scene('builder',        fx=fx_builder)
m_shield         = m_scene('shield',         fx=fx_shield)

# ---------- Yoda-BOBAI collection (realistic style) ----------
# Static body (no bob, no breathe) — ONLY the pointing arm animates (shoulder
# pivot jab like the reference GIF), plus fingertip energy, aura fx and the
# baked-in statement text. Ears are separate props tucked BEHIND the head
# (the image generator refuses Yoda-like ears baked into the character).

def _crop_alpha(im):
    b = im.getbbox()
    return im.crop(b) if b else im

_FONT_CACHE = {}
def _font(px):
    from PIL import ImageFont
    px = int(px)
    if px not in _FONT_CACHE:
        for p in (r'C:/Windows/Fonts/impact.ttf', r'C:/Windows/Fonts/arialbd.ttf'):
            if os.path.exists(p):
                _FONT_CACHE[px] = ImageFont.truetype(p, px); break
        else:
            _FONT_CACHE[px] = ImageFont.load_default()
    return _FONT_CACHE[px]

def _ease_back(p):
    """Ease-out-back — overshoots slightly past 1 then settles."""
    c3 = 1.70158
    p = clamp01(p)
    return 1 + (c3 + 1) * ((p - 1) ** 3) + c3 * ((p - 1) ** 2)

def sage_statement(c, t, lines, t0s=(0.06, 0.34), dur=0.20):
    """Animated gold meme caption: each line pops in (scale overshoot + fade),
    line by line, then holds until the loop restarts."""
    base_px = R * 0.078
    sw = max(2, int(R * 0.007))
    lay = Image.new('RGBA', (R, R), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    fb = _font(base_px)
    y = R * 0.012
    for ln, t0 in zip(lines, t0s):
        bb = d.textbbox((0, 0), ln, font=fb, stroke_width=sw)
        lh = bb[3] - bb[1]
        p = clamp01((t - t0) / dur)
        if p > 0:
            sc = 0.5 + 0.5 * _ease_back(p)
            f = _font(base_px * sc)
            b2 = d.textbbox((0, 0), ln, font=f, stroke_width=sw)
            w2, h2 = b2[2] - b2[0], b2[3] - b2[1]
            a = int(255 * min(1.0, p * 1.8))
            d.text((R/2 - w2/2 - b2[0], y + lh/2 - h2/2 - b2[1]), ln, font=f,
                   fill=(243, 186, 47, a), stroke_width=sw, stroke_fill=(25, 18, 5, a))
        y += lh * 1.22
    c.alpha_composite(lay)

def m_pump_force(f):
    t = f / N
    c = Image.new('RGBA', (R, R), (0,0,0,0))
    SC = SCENES['pump-force']                    # 1024² scene, large centered sage
    W = R*0.86; s = W/1024.0                     # scene→canvas scale
    ox = (R - W)/2; oy = R*0.62 - W/2
    def S(x, y): return (ox + x*s, oy + y*s)     # scene coords → canvas coords

    # green pointed ears BEHIND the head (head band y≈235, edges x≈290/752)
    ear = _crop_alpha(PROPS['sage-ears'])
    place(c, ear, *S(240, 235), w=200*s)
    place(c, ear.transpose(Image.FLIP_LEFT_RIGHT), *S(805, 235), w=200*s)

    # static body — NO bob, NO breathe
    place(c, SC, R/2, R*0.62, w=W)

    # pointing arm IN FRONT — mirrored to his LEFT side (viewer-right shoulder),
    # foreshortened, finger at the viewer. Jab = scale pulse toward the camera.
    arm = _crop_alpha(PROPS['sage-arm']).transpose(Image.FLIP_LEFT_RIGHT)
    jab = pulse(t, 2)                            # two jabs per loop
    aw = 520*s * (1.0 + 0.10*jab)
    armF = fit(arm, aw)
    shx, shy = S(755, 350)                       # sleeve UR corner = shoulder
    px0, py0 = int(shx - armF.width), int(shy)
    c.alpha_composite(armF, (px0, py0))

    # subtle energy at the pointing hand (hand center ≈ 53%/50% after mirror)
    hx, hy = px0 + 0.53*armF.width, py0 + 0.50*armF.height
    glow(c, hx, hy + armF.height*0.12, R*0.030 + R*0.014*jab, (140, 240, 150), 60 + 45*jab, blur=0.025)

    sage_statement(c, t, ("MAY THE PUMP", "BE WITH YOU"))
    return c

MOTIFS = {'moon': m_moon, 'cool': m_cool, 'sunshine': m_sunshine,
          'thunder-buy': m_thunder_buy, 'kraken-buy': m_kraken_buy, 'laser': m_laser,
          'supernova-burn': m_supernova_burn, 'rocket': m_rocket,
          'diamond': m_diamond, 'bull': m_bull, 'hodl': m_hodl,
          'gigabrain': m_gigabrain, 'wagmi': m_wagmi,
          'gm': m_gm, 'pump': m_pump, 'dip': m_dip,
          'builder': m_builder, 'shield': m_shield,
          'pump-force': m_pump_force}

# ---------- Sage BOBAI saga (meme-GIF film stills, opaque bg, caption bottom) ----------
SAGA = {
    'saga-patience': ("PATIENCE", "YOU MUST HAVE"),
    'saga-pump':     ("MAY THE PUMP", "BE WITH YOU"),
    'saga-nosell':   ("SELL", "YOU MUST NOT"),
    'saga-hodl':     ("STRONG", "THE HODL IS"),
    'saga-fear':     ("FEAR LEADS TO", "PAPER HANDS"),
}

def saga_caption(c, t, lines, t0=0.08, dur=0.18):
    """Classic GIF meme caption: white impact, black stroke, bottom, pop-in."""
    p = clamp01((t - t0) / dur)
    if p <= 0: return
    sc = 0.6 + 0.4 * _ease_back(p)
    a = int(255 * min(1.0, p * 2.0))
    sw = max(2, int(R * 0.008))
    lay = Image.new('RGBA', (R, R), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    ys = R * 0.985
    for ln in reversed(lines):
        f = _font(R * 0.082 * sc)
        bb = d.textbbox((0, 0), ln, font=f, stroke_width=sw)
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        ys -= h * 1.16
        d.text((R/2 - w/2 - bb[0], ys - bb[1]), ln, font=f,
               fill=(255, 255, 255, a), stroke_width=sw, stroke_fill=(0, 0, 0, a))
    c.alpha_composite(lay)

# Moving-element config per saga motif: ONE part of BOBAI moves (feathered
# polygon layer, scale-jab about a pivot at the limb base — scale >= 1 always
# covers the baked-in copy underneath, so no clean plate is needed).
# Coords in 1024 scene space.
# Each motif animates one or more tightly-masked PARTS (polygon hugs the limb
# silhouette — no background pixels move). phase shifts the pulse per part.
SAGA_MOVE = {
    'saga-pump': {       # pointing hand+cuff jabs at the viewer
        'parts': [{
            'poly': [(245, 398), (298, 418), (360, 486), (418, 548), (455, 590),
                     (462, 650), (440, 710), (370, 738), (290, 730), (240, 690),
                     (222, 640), (220, 560), (230, 480), (242, 432)],
            'pivot': (400, 750), 'amp': 0.13, 'freq': 1,
        }],
    },
    'saga-patience': {   # mouth "speaks" the line (small talk pulses, no plate)
        'parts': [{
            'poly': [(350, 380), (590, 380), (610, 440), (520, 490), (400, 490), (340, 440)],
            'pivot': (470, 435), 'amp': 0.09, 'freq': 3,
        }],
        'noplate': True,
    },
    'saga-nosell': {     # stop palm pushes HARD at the viewer (snappy)
        'parts': [{
            'poly': [(230, 415), (295, 423), (312, 460), (318, 530), (345, 562),
                     (390, 585), (394, 648), (350, 700), (340, 780), (210, 785),
                     (175, 700), (158, 600), (160, 505), (185, 450)],
            'pivot': (420, 790), 'amp': 0.15, 'freq': 1, 'snap': 1.3,
        }],
    },
    'saga-hodl': {       # both fists clench slowly — big/small about their centers
        'parts': [{
            'poly': [(265, 640), (340, 622), (405, 650), (428, 705), (420, 775),
                     (378, 825), (305, 842), (255, 810), (237, 745), (242, 680)],
            'pivot': (333, 730), 'amp': 0.10, 'freq': 1, 'phase': 0.0,
        }, {
            'poly': [(600, 615), (680, 622), (735, 662), (752, 720), (730, 780),
                     (668, 818), (600, 812), (565, 760), (558, 695), (575, 648)],
            'pivot': (655, 715), 'amp': 0.10, 'freq': 1, 'phase': 0.1,
        }],
    },
    'saga-fear': {       # folded hands breathe calmly (+ mist)
        'parts': [{
            'poly': [(440, 550), (600, 530), (720, 600), (730, 760), (650, 830),
                     (480, 820), (420, 700)],
            'pivot': (580, 840), 'amp': 0.05, 'freq': 1,
        }],
        'mist': True, 'noplate': True,
    },
}

def _part_layer(src, part):
    """Feathered layer for one moving part — polygon hugs the limb silhouette,
    so NO background pixels travel with the motion."""
    m = Image.new('L', (1024, 1024), 0)
    ImageDraw.Draw(m).polygon(part['poly'], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(3))
    lay = src.copy(); lay.putalpha(m)
    return lay

def mist(c, t):
    """Gentle drifting swamp mist near the bottom — subtle life for static scenes."""
    for i, (yf, sp, ph0) in enumerate(((0.82, 0.05, 0.0), (0.90, -0.035, 0.4), (0.72, 0.025, 0.7))):
        x = R * ((0.5 + sp * math.sin(2*math.pi*(t + ph0))) )
        glow(c, x, R*yf, R*0.30, (210, 230, 215), 16 + 8*pulse(t + ph0, 1), blur=0.10)

def _saga_base(slug, cfg):
    """Static base frame. If a clean plate exists, patch ONLY the limb region
    from the plate into the ORIGINAL scene (feathered) — face/background stay
    the untouched original, and the resting limb is removed so the moving
    layer never ghosts against a baked-in copy."""
    src = SCENES[slug].resize((1024, 1024), Image.LANCZOS)
    plate_key = f'{slug}-plate'
    if not cfg or cfg.get('noplate') or plate_key not in SCENES:
        return src
    plate = SCENES[plate_key].resize((1024, 1024), Image.LANCZOS)
    m = Image.new('L', (1024, 1024), 0)
    for part in cfg['parts']:
        ImageDraw.Draw(m).polygon(part['poly'], fill=255)
    m = m.filter(ImageFilter.MaxFilter(15))      # dilate past the limb edge
    m = m.filter(ImageFilter.GaussianBlur(6))    # feather the patch seam
    return Image.composite(plate, src, m)

def m_saga(slug):
    """Film-still motif: static frame, tightly-masked moving part(s), caption
    pop. No whole-image motion."""
    lines = SAGA[slug]
    cfg = SAGA_MOVE.get(slug)
    base = _saga_base(slug, cfg)
    src = SCENES[slug].resize((1024, 1024), Image.LANCZOS)
    parts = [(p, _part_layer(src, p)) for p in cfg['parts']] if cfg else []
    def fn(f):
        t = f / N
        c = Image.new('RGBA', (R, R), (0, 0, 0, 0))
        place(c, base, R/2, R/2, w=R)
        if not cfg or cfg.get('mist'): mist(c, t)
        s0 = R / 1024.0
        for part, layer in parts:
            if part.get('mode') == 'shake':
                ph = part.get('phase', 0.0) * 2 * math.pi
                sf = part.get('sfreq', 4)
                dx = part.get('ax', 6) * s0 * math.sin(2*math.pi*sf*t + ph)
                dy = part.get('ay', 3) * s0 * math.sin(2*math.pi*sf*2*t + ph)
                lay = layer.resize((R, R), Image.LANCZOS)
                c.alpha_composite(lay, (int(dx), int(dy)))
            else:
                p = pulse(t + part.get('phase', 0.0), part.get('freq', 2)) ** part.get('snap', 1.0)
                k = 1.0 + part['amp'] * p
                lw = max(1, int(R * k))
                lay = layer.resize((lw, lw), Image.LANCZOS)
                px, py = part['pivot'][0] * s0, part['pivot'][1] * s0
                c.alpha_composite(lay, (int(px * (1 - k)), int(py * (1 - k))))
        saga_caption(c, t, lines)
        return c
    return fn

for _slug in SAGA:
    if _slug in SCENES:
        MOTIFS[_slug] = m_saga(_slug)

# ---------- render + encode ----------
def encode(motif):
    fdir = f'{STK}/frames/{motif}'; out = f'{STK}/out/bobai-{motif}.webm'
    os.makedirs(fdir, exist_ok=True)
    for old in glob.glob(fdir + '/*.png'): os.remove(old)
    fn = MOTIFS[motif]
    for f in range(N):
        fn(f).resize((SIZE, SIZE), Image.LANCZOS).save(f'{fdir}/f{f:03d}.png')
    for crf in (32, 36, 40, 44, 48, 52, 56, 60, 63):
        subprocess.run([FFMPEG, '-y', '-hide_banner', '-loglevel', 'error',
            '-framerate', str(FPS), '-i', f'{fdir}/f%03d.png',
            '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0',
            '-crf', str(crf), '-an', '-auto-alt-ref', '0', out], check=True)
        kb = os.path.getsize(out) / 1024
        if kb <= 250:
            print(f"{motif}: {kb:.0f} KB (crf {crf}) -> {out}"); return
    print(f"{motif}: {kb:.0f} KB (crf 52) -> {out}")

if __name__ == '__main__':
    for n in (sys.argv[1:] or list(MOTIFS)):
        encode(n) if n in MOTIFS else print(f"unknown motif '{n}'")
