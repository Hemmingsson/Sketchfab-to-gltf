#!/usr/bin/env bash
# Render the three 16:9 feature clips (clips.html, `clip` variable) at 4K/60, then derive:
#   ../docs/clips/<name>.webp         animated 4 s loop, 1280x720, 60fps, transparent squircle corners
#   renders/clip-<name>-4k-60fps.mp4  opaque master
# Needs ffmpeg and img2webp (`brew install ffmpeg webp`).
# Usage: demo-video/export-clips.sh [model|cards|collection ...]   (default: all three)
set -euo pipefail
cd "$(dirname "$0")"

OUT=../docs/clips
mkdir -p "$OUT" renders
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# clip variable → output name
name_for() { case $1 in model) echo model-page ;; *) echo "$1" ;; esac; }

render_clip() {
  local clip=$1 name master frames
  name=$(name_for "$clip")
  master="renders/clip-$name-4k-60fps.mp4"
  npx --yes hyperframes@0.8.77 render -c clips.html --resolution 4k --fps 60 --crf 6 \
    --variables "{\"clip\":\"$clip\"}" --output "$master"

  # Same frame and squircle as the main demo WebP (1280x720, R=72 superellipse, n=4).
  local r=72
  [[ -f "$TMP/mask.png" ]] || ffmpeg -loglevel error -f lavfi -i "color=black:s=1280x720,format=gray" -frames:v 1 \
    -vf "geq=lum='st(0,max(max($r-X,X-(W-1-$r)),0));st(1,max(max($r-Y,Y-(H-1-$r)),0));255*clip((1-pow(pow(ld(0)/$r,4)+pow(ld(1)/$r,4),0.25))*$r+0.5,0,1)'" \
    "$TMP/mask.png"

  frames="$TMP/$name"
  mkdir "$frames"
  ffmpeg -loglevel error -i "$master" -loop 1 -i "$TMP/mask.png" \
    -filter_complex "[0]scale=1280:720:flags=lanczos,format=rgba[v];[v][1]alphamerge" \
    -frames:v 240 "$frames/%04d.png"

  # WebP frame times are whole ms: 17/17/16 averages exactly 60fps.
  local args=() i=0 f
  for f in "$frames"/*.png; do
    args+=(-d $(( i % 3 == 2 ? 16 : 17 )) "$f")
    i=$(( i + 1 ))
  done
  img2webp -loop 0 -lossy -q 80 -m 4 -sharp_yuv -kmin 20 -kmax 30 "${args[@]}" -o "$OUT/$name.webp"
}

for clip in ${@:-model cards collection}; do render_clip "$clip"; done

ls -lh "$OUT" renders/clip-*
