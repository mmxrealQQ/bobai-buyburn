#!/usr/bin/env python3
"""
Render X/GIPHY/Tenor GIFs from the captioned sticker frames
(stickers/frames/<slug>-sora/f*.png, written by build_sora_sticker.py).
480px, 20fps, two-pass palette — same specs as the saga X GIFs (~5MB).

Usage: python stickers/build_gif.py <slug ...>
"""
import os, sys, subprocess

STK = r'd:/ai/fourmeme/stickers'
OUT = f'{STK}/out/x'
os.makedirs(OUT, exist_ok=True)
# ffmpeg is taken from PATH. It used to be an absolute WinGet path, which
# carried the build machine's Windows account name into every published copy of
# this file. Set FFMPEG=/full/path/to/ffmpeg if yours is somewhere PATH cannot
# see it.
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')

SIZE = 480  # override with --size N (e.g. 640 for GIPHY/Klipy quality builds)

def build(slug):
    fdir = f'{STK}/frames/{slug}-sora'
    if not os.path.isdir(fdir):
        print(f"ERR {slug}: no frames dir {fdir} (run build_sora_sticker.py first)"); return
    pal = f'{fdir}/_palette.png'
    out = f'{OUT}/bobai-{slug}.gif'
    vf = f'fps=20,scale={SIZE}:{SIZE}:flags=lanczos'
    subprocess.run([FFMPEG, '-y', '-hide_banner', '-loglevel', 'error',
        '-framerate', '24', '-i', f'{fdir}/f%03d.png',
        '-vf', f'{vf},palettegen=stats_mode=diff', pal], check=True)
    subprocess.run([FFMPEG, '-y', '-hide_banner', '-loglevel', 'error',
        '-framerate', '24', '-i', f'{fdir}/f%03d.png', '-i', pal,
        '-lavfi', f'{vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4',
        '-loop', '0', out], check=True)
    os.remove(pal)
    print(f"{slug}: {os.path.getsize(out)//1024} KB -> {out}")

if __name__ == '__main__':
    args = []
    it = iter(sys.argv[1:])
    for a in it:
        if a == '--size':
            SIZE = int(next(it))
        else:
            args.append(a)
    for s in args:
        build(s)
