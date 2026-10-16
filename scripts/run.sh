#!/usr/bin/env bash
# Build and run Strike Zone. Prints the LAN URLs to share. Loads .env if present.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then set -a; . ./.env; set +a; fi
command -v go >/dev/null 2>&1 || { echo "Go is not installed. Install it from https://go.dev/dl/ or run a prebuilt binary from dist/." >&2; exit 1; }

mkdir -p dist
go build -trimpath -o dist/strike-zone ./server
exec ./dist/strike-zone
