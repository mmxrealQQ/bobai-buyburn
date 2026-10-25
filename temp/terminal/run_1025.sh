#!/bin/bash
# 25 OCTOBER 2026 (operator: "2-3 Veo-Clips für das Brain Board als Animation im Terminal, etwas Cooleres als BOBAI
# auf dem Handy"; chosen: bug -> fix, paper-plane mail, detective): ONE standard take each — hub-board-bug,
# hub-board-plane, hub-board-detective (prompts in gen_veo.py HUB). Every take goes into cut.txt as PENDING REVIEW
# first (never played before it is checked with clipcheck.py).
# usage: bash /d/ai/fourmeme/temp/terminal/run_1025.sh [take ...]
cd /d/ai/fourmeme/temp/terminal
takes="$*"; [ -z "$takes" ] && takes="hub-board-bug hub-board-plane hub-board-detective"
for p in $takes; do
  [ -f anim/$p.mp4 ] && { echo "skip $p (exists)"; continue; }
  grep -qx "$p" anim/cut.txt || printf "# 25.10. PENDING REVIEW:\n$p\n" >> anim/cut.txt
  python gen_veo.py $p --std --wide 2>&1 | grep "^OK\|^ERR\|^skip\|Error\|^Traceback" | cut -c1-300
  if [ -f anim/$p.mp4 ]; then python trim_hub.py $p 2>&1 | tail -1; python key_clip.py $p --w 640 2>&1 | tail -1; fi
done
echo DONE
