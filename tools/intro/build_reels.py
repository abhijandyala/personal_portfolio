#!/usr/bin/env python3
"""Render a reel gallery's media (SF Trip, VentraMatch Journey) from its config.

Usage (from the repo root):  python3 tools/intro/build_reels.py tools/intro/sftrip.json
Needs ffmpeg with libx264 and aac. The config names its source folder (source clips, not in git)
and its output folder; for each clip NN it writes:
  NN-preview.mp4         240x426 silent 4 s loop (caption-free, face-centered) for the node cards
  NN.mp4                 full clip with audio, max 720 px on the short side, for the zoomed-in player
  NN.jpg                 poster frame of the preview
  clips.json             manifest the gallery reads (ids, titles, Instagram links)
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA = json.load(open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "tools", "intro", "sftrip.json")))
SRC = os.path.join(ROOT, DATA.get("source", "source-videos"))
OUT = os.path.join(ROOT, DATA.get("out", "assets/sftrip"))
PW, PH = 240, 426


def run(args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def crop(rect):
    x, y, w, h = rect
    ev = lambda e: f"trunc({e}/2)*2"
    return f"crop={ev(f'iw*{w}')}:{ev(f'ih*{h}')}:{ev(f'iw*{x}')}:{ev(f'ih*{y}')}"


def build(clip):
    cid, p = clip["id"], clip["preview"]
    src = os.path.join(SRC, f"{cid}.mp4")
    base = os.path.join(OUT, cid)
    vf = f"{crop(p['crop'])},scale={PW}:{PH}:flags=lanczos,fps=30,eq=saturation=1.1,setsar=1"
    cut = ["-ss", str(p["start"]), "-t", str(p["dur"]), "-i", src, "-vf", vf, "-an"]
    run([*cut, "-c:v", "libx264", "-crf", "27", "-preset", "slow", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", f"{base}-preview.mp4"])
    run(["-ss", "1", "-i", f"{base}-preview.mp4", "-frames:v", "1", "-q:v", "4", f"{base}.jpg"])
    # full video: short side 720, H.264 + AAC so it plays everywhere with sound
    run(["-i", src, "-vf", "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)':flags=lanczos,setsar=1",
         "-c:v", "libx264", "-crf", "29", "-preset", "slow", "-profile:v", "high", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", f"{base}.mp4"])
    return cid


if __name__ == "__main__":
    missing = [c["id"] for c in DATA["clips"] if not os.path.exists(os.path.join(SRC, f"{c['id']}.mp4"))]
    if missing:
        sys.exit(f"Missing source clips: {missing} (expected in {SRC})")
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith("-preview.webm"):
            os.remove(os.path.join(OUT, f))
    manifest = {"hub_stack": DATA["hub_stack"],
                "clips": [{k: c[k] for k in ("id", "title", "instagram", "date") if k in c} for c in DATA["clips"]]}
    json.dump(manifest, open(os.path.join(OUT, "clips.json"), "w"), indent=1, ensure_ascii=False)
    with ThreadPoolExecutor(max_workers=3) as ex:
        for cid in ex.map(build, DATA["clips"]):
            print("  built", cid)
    total = 0
    for f in sorted(os.listdir(OUT)):
        size = os.path.getsize(os.path.join(OUT, f))
        total += size
        print(f"{f:22s} {size / 1e6:6.2f} MB")
    print(f"total {total / 1e6:.1f} MB")
