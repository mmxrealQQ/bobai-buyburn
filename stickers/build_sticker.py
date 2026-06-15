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
FFMPEG = (r'C:/Users/graff/AppData/Local/Microsoft/WinGet/Packages/'
          r'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/'
          r'ffmpeg-8.1.1-full_build/bin/ffmpeg.exe')
if not os.path.exists(FFMPEG): FFMPEG = 'ffmpeg'

def load(p): return Image.open(p).convert('RGBA')
BRAIN = load(STK + '/assets/brain.png')
COIN  = load(ROOT + '/dashboard/worldcup/app/illus/coin-bnb.webp')
PROPS = {os.path.splitext(os.path.basename(p))[0]: load(p)
         for p in glob.glob(STK + '/assets/props/*.png')}

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

MOTIFS = {'moon': m_moon, 'cool': m_cool, 'sunshine': m_sunshine}

# ---------- render + encode ----------
def encode(motif):
    fdir = f'{STK}/frames/{motif}'; out = f'{STK}/out/bobai-{motif}.webm'
    os.makedirs(fdir, exist_ok=True)
    for old in glob.glob(fdir + '/*.png'): os.remove(old)
    fn = MOTIFS[motif]
    for f in range(N):
        fn(f).resize((SIZE, SIZE), Image.LANCZOS).save(f'{fdir}/f{f:03d}.png')
    for crf in (32, 36, 40, 44, 48, 52):
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
