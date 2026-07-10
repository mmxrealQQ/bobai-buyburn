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
FFMPEG = (r'C:/Users/graff/AppData/Local/Microsoft/WinGet/Packages/'
          r'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/'
          r'ffmpeg-8.1.1-full_build/bin/ffmpeg.exe')
if not os.path.exists(FFMPEG): FFMPEG = 'ffmpeg'

def build(slug):
    fdir = f'{STK}/frames/{slug}-sora'
    if not os.path.isdir(fdir):
        print(f"ERR {slug}: no frames dir {fdir} (run build_sora_sticker.py first)"); return
    pal = f'{fdir}/_palette.png'
    out = f'{OUT}/bobai-{slug}.gif'
    vf = 'fps=20,scale=480:480:flags=lanczos'
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
    for s in sys.argv[1:]:
        build(s)
