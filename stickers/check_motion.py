#!/usr/bin/env python3
"""
Numeric motion QA for Sora clips: extract frames (2 fps), compute mean
absolute pixel diff between consecutive frames. Low score = near-static clip
(regen candidate). No images are displayed — pure numbers.

Usage: python stickers/check_motion.py <slug ...>
"""
import os, sys, glob, subprocess, tempfile
from PIL import Image, ImageChops
from PIL.ImageStat import Stat

STK = r'd:/ai/fourmeme/stickers'
# ffmpeg is taken from PATH. It used to be an absolute WinGet path, which
# carried the build machine's Windows account name into every published copy of
# this file. Set FFMPEG=/full/path/to/ffmpeg if yours is somewhere PATH cannot
# see it.
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')

# Empirical: healthy saga clips score ~3-10; <1.5 = suspicious (near static)
THRESHOLD = 1.5

def score(slug):
    src = f'{STK}/assets/video/{slug}.mp4'
    if not os.path.exists(src):
        print(f"{slug:18s} MISSING {src}"); return None
    with tempfile.TemporaryDirectory() as td:
        subprocess.run([FFMPEG, '-y', '-hide_banner', '-loglevel', 'error',
            '-i', src, '-vf', 'fps=2,crop=720:720:0:280,scale=256:256',
            f'{td}/f%03d.png'], check=True)
        frames = sorted(glob.glob(f'{td}/f*.png'))
        if len(frames) < 3:
            print(f"{slug:18s} ERR too few frames ({len(frames)})"); return None
        diffs = []
        prev = Image.open(frames[0]).convert('L')
        for fp in frames[1:]:
            cur = Image.open(fp).convert('L')
            diffs.append(Stat(ImageChops.difference(prev, cur)).mean[0])
            prev = cur
        avg = sum(diffs) / len(diffs)
        flag = 'OK ' if avg >= THRESHOLD else '⚠ LOW-MOTION'
        print(f"{slug:18s} motion={avg:5.2f}  peak={max(diffs):5.2f}  frames={len(frames)}  {flag}")
        return avg

if __name__ == '__main__':
    for s in sys.argv[1:]:
        score(s)
