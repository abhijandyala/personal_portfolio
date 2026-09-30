#!/usr/bin/env python3
"""Render the intro videos from shots.json.

Usage (from the repo root):  python3 tools/intro/build.py
Needs ffmpeg with libvpx-vp9 and libx264. Source clips live in source-videos/ (not in git).

Outputs to assets/intro/:
  montage-land.{webm,mp4}  1920x1080  rapid flash cuts -> hero shot (desktop)
  montage-port.{webm,mp4}  1080x1920  same edit, portrait crops (phones)
  letters.{webm,mp4}       1440x1728  4x3 grid, one 360x576 tile per letter of ABHIJANDYALA
  *.jpg                    poster frames
"""
import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHOTS = json.load(open(os.path.join(ROOT, "tools", "intro", "shots.json")))
OUT = os.path.join(ROOT, "assets", "intro")
FPS = 30
TILE_W, TILE_H, COLS = 360, 576, 4
LOOK = "eq=saturation=1.15:contrast=1.05"


def src(clip):
    if clip == "12":
        return os.path.join(ROOT, "images", "valiqai_port_video.mp4")
    return os.path.join(ROOT, "source-videos", f"{clip}.mp4")


def crop(rect):
    x, y, w, h = rect
    ev = lambda e: f"trunc({e}/2)*2"
    return f"crop={ev(f'iw*{w}')}:{ev(f'ih*{h}')}:{ev(f'iw*{x}')}:{ev(f'ih*{y}')}"


def encode(inputs, graph, name, poster_at=0.0, crf_vp9=38, crf_h264=27):
    base = os.path.join(OUT, name)
    common = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[out]", "-an"]
    print(f"  {name}.webm")
    subprocess.run([*common, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", str(crf_vp9), "-row-mt", "1",
                    "-deadline", "good", "-cpu-used", "2", "-pix_fmt", "yuv420p", base + ".webm"], check=True)
    print(f"  {name}.mp4")
    subprocess.run([*common, "-c:v", "libx264", "-crf", str(crf_h264), "-preset", "slow", "-profile:v", "high",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", base + ".mp4"], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(poster_at), "-i", base + ".mp4",
                    "-frames:v", "1", "-q:v", "3", base + ".jpg"], check=True)


def montage(orient):
    w, h = (1920, 1080) if orient == "land" else (1080, 1920)
    shots = SHOTS["flashes"] + [SHOTS["hero"]]
    inputs, chains = [], []
    for i, s in enumerate(shots):
        inputs += ["-ss", str(s["start"]), "-t", str(s["dur"]), "-i", src(s["clip"])]
        chains.append(f"[{i}:v]{crop(s[orient])},scale={w}:{h}:flags=lanczos,fps={FPS},{LOOK},setsar=1[v{i}]")
    graph = ";".join(chains) + ";" + "".join(f"[v{i}]" for i in range(len(shots))) + \
        f"concat=n={len(shots)}:v=1:a=0[out]"
    encode(inputs, graph, f"montage-{orient}")


def letters():
    shots = SHOTS["letters"]
    inputs, chains, layout = [], [], []
    for i, s in enumerate(shots):
        inputs += ["-ss", str(s["start"]), "-t", str(s["dur"]), "-i", src(s["clip"])]
        chains.append(f"[{i}:v]{crop(s['crop'])},scale={TILE_W}:{TILE_H}:flags=lanczos,fps={FPS},{LOOK},setsar=1[t{i}]")
        layout.append(f"{(i % COLS) * TILE_W}_{(i // COLS) * TILE_H}")
    graph = ";".join(chains) + ";" + "".join(f"[t{i}]" for i in range(len(shots))) + \
        f"xstack=inputs={len(shots)}:layout={'|'.join(layout)}[out]"
    encode(inputs, graph, "letters", poster_at=1.0)


if __name__ == "__main__":
    missing = [s["clip"] for s in SHOTS["letters"] + SHOTS["flashes"] + [SHOTS["hero"]] if not os.path.exists(src(s["clip"]))]
    if missing:
        sys.exit(f"Missing source clips: {sorted(set(missing))} (expected in source-videos/)")
    os.makedirs(OUT, exist_ok=True)
    montage("land")
    montage("port")
    letters()
    for f in sorted(os.listdir(OUT)):
        print(f"{f:24s} {os.path.getsize(os.path.join(OUT, f)) / 1e6:6.2f} MB")
