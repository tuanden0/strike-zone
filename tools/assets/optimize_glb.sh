#!/usr/bin/env bash
# Make a downloaded glb game-ready: weld, simplify, shrink textures, webp. Needs node + npm (installs @gltf-transform/cli in a temp dir).
# usage: tools/assets/optimize_glb.sh in.glb out.glb [tex_px=512] [simplify_ratio=0.3]
set -euo pipefail
in=$1 out=$2 px=${3:-512} ratio=${4:-0.3}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
(cd "$tmp" && npm init -y >/dev/null && npm i --silent @gltf-transform/cli@4 >/dev/null)
g="$tmp/node_modules/.bin/gltf-transform"
"$g" resize "$in" "$tmp/a.glb" --width "$px" --height "$px"
"$g" weld "$tmp/a.glb" "$tmp/b.glb"
"$g" simplify "$tmp/b.glb" "$tmp/c.glb" --ratio "$ratio" --error 0.002
"$g" webp "$tmp/c.glb" "$out" --quality 85
"$g" inspect "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -E "glPrimitives|image/|TRIANGLES" || true
ls -l "$out"
