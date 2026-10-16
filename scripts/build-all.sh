#!/usr/bin/env bash
# Cross-compile single-file binaries (client embedded) for Windows/macOS/Linux, amd64 + arm64, into dist/.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64 windows/arm64; do
  os=${target%/*}; arch=${target#*/}
  ext=""; [ "$os" = windows ] && ext=".exe"
  out="dist/strike-zone-${os}-${arch}${ext}"
  echo "building $out"
  CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath -ldflags "-s -w" -o "$out" ./server
done
(cd dist && (sha256sum strike-zone-* 2>/dev/null || shasum -a 256 strike-zone-*) > SHA256SUMS)
ls -la dist
