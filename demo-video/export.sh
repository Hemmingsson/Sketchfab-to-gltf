#!/usr/bin/env bash
# Render the README demo (index.html) at 4K/60 → docs/demo.webp only
# (animated, 1280px, 60fps, transparent squircle corners). No WebM/MP4 deliverable.
# Needs ffmpeg and img2webp (`brew install ffmpeg webp`).
set -euo pipefail
cd "$(dirname "$0")"

DOCS=../docs
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
MASTER="$TMP/master-4k-60fps.mp4"

npx --yes hyperframes@0.8.77 render --resolution 4k --fps 60 --crf 6 --output "$MASTER"

# Squircle mask (superellipse, n=4, R px, anti-aliased).
R=72
ffmpeg -loglevel error -f lavfi -i "color=black:s=1280x720,format=gray" -frames:v 1 \
  -vf "geq=lum='st(0,max(max($R-X,X-(W-1-$R)),0));st(1,max(max($R-Y,Y-(H-1-$R)),0));255*clip((1-pow(pow(ld(0)/$R,4)+pow(ld(1)/$R,4),0.25))*$R+0.5,0,1)'" \
  "$TMP/mask.png"

mkdir "$TMP/frames"
ffmpeg -loglevel error -i "$MASTER" -loop 1 -i "$TMP/mask.png" \
  -filter_complex "[0]scale=1280:720:flags=lanczos,format=rgba[v];[v][1]alphamerge" \
  -frames:v 900 "$TMP/frames/%04d.png"

# WebP frame times are whole ms, so 17/17/16 repeats to average exactly 60fps.
# A keyframe every 20-30 frames stops lossy sub-frame blends from piling up
# into streaks on flat colors.
frames=()
i=0
for f in "$TMP"/frames/*.png; do
  frames+=(-d $(( i % 3 == 2 ? 16 : 17 )) "$f")
  i=$(( i + 1 ))
done
img2webp -loop 0 -lossy -q 80 -m 4 -sharp_yuv -kmin 20 -kmax 30 "${frames[@]}" -o "$DOCS/demo.webp"

ls -lh "$DOCS/demo.webp"
