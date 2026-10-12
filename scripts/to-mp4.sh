#!/usr/bin/env bash
# Convert an Iris: Resonance WebM recording into an MP4 that X / Instagram accept
# (H.264 High, yuv420p, AAC 48 kHz, even dimensions, fast-start).
#
#   npm run to-mp4 -- path/to/iris-resonance-….webm [out.mp4]
#
# Uses $FFMPEG if set, else the ffmpeg-static dev dependency, else ffmpeg on PATH.
set -euo pipefail

in="${1:-}"
if [[ -z "$in" || ! -f "$in" ]]; then
  echo "usage: npm run to-mp4 -- <recording.webm> [output.mp4]" >&2
  exit 1
fi
out="${2:-${in%.*}.mp4}"

here="$(cd "$(dirname "$0")/.." && pwd)"
ff="${FFMPEG:-}"
if [[ -z "$ff" && -x "$here/node_modules/ffmpeg-static/ffmpeg" ]]; then ff="$here/node_modules/ffmpeg-static/ffmpeg"; fi
if [[ -z "$ff" ]]; then ff="$(command -v ffmpeg || true)"; fi
if [[ -z "$ff" ]]; then
  echo "ffmpeg not found — run npm install, or set FFMPEG=/path/to/ffmpeg" >&2
  exit 1
fi

# MediaRecorder output has a variable frame rate; resample to a steady 60 fps.
"$ff" -hide_banner -y -i "$in" \
  -vf "fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2:out_range=tv,format=yuv420p" -color_range tv \
  -c:v libx264 -profile:v high -preset slow -crf 17 \
  -c:a aac -b:a 256k -ar 48000 \
  -movflags +faststart \
  "$out"

echo "wrote $out"
