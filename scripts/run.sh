#!/usr/bin/env bash
# Build and run Strike Zone. Prints the LAN URLs to share. Loads .env if present.
#
#   scripts/run.sh                 LAN only
#   scripts/run.sh --open-port     also open the port for the internet while the server runs, and close it again when it stops:
#                                  - UPnP port forward on the router (done by the server itself, removed on exit, expires after 1 h anyway)
#                                  - temporary rule in the local firewall (ufw / firewalld) if one is active and we may use sudo
#                                  Anyone who knows the address can then connect: give your rooms a password.
set -euo pipefail
cd "$(dirname "$0")/.."

OPEN=${OPEN_PORT:-0}
for a in "$@"; do
  case "$a" in
    --open-port|-o) OPEN=1 ;;
    -h|--help) sed -n 2,10p "$0"; exit 0 ;;
    *) echo "unknown option: $a (try --help)" >&2; exit 2 ;;
  esac
done

if [ -f .env ]; then set -a; . ./.env; set +a; fi
PORT=${PORT:-8080}

BIN=${SZ_BIN:-}
if [ -z "$BIN" ]; then
  command -v go >/dev/null 2>&1 || { echo "Go is not installed. Install it from https://go.dev/dl/ or run a prebuilt binary from dist/." >&2; exit 1; }
  mkdir -p dist
  go build -trimpath -o dist/strike-zone ./server
  BIN=./dist/strike-zone
fi

FW_UNDO=()   # commands that undo exactly what this run changed (never touches rules that were already there)

# run a command as root: directly, or through non-interactive sudo; fail quietly when neither works
priv() {
  if [ "$(id -u)" = 0 ]; then "$@"
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then sudo -n "$@"
  else return 1
  fi
}

fw_open() {
  local st
  if command -v ufw >/dev/null 2>&1 && st=$(priv ufw status 2>/dev/null) && grep -q '^Status: active' <<<"$st"; then
    if grep -Eq "^${PORT}/tcp +ALLOW" <<<"$st"; then
      echo "firewall (ufw): port ${PORT}/tcp is already open, leaving it as it is"
    elif priv ufw allow "${PORT}/tcp" >/dev/null; then
      FW_UNDO+=("ufw delete allow ${PORT}/tcp")
      echo "firewall (ufw): opened ${PORT}/tcp until the server stops"
    else
      echo "firewall (ufw): could not open ${PORT}/tcp; run: sudo ufw allow ${PORT}/tcp" >&2
    fi
  elif command -v firewall-cmd >/dev/null 2>&1 && st=$(priv firewall-cmd --state 2>/dev/null) && grep -q running <<<"$st"; then
    if priv firewall-cmd --query-port="${PORT}/tcp" >/dev/null 2>&1; then
      echo "firewall (firewalld): port ${PORT}/tcp is already open, leaving it as it is"
    elif priv firewall-cmd --add-port="${PORT}/tcp" >/dev/null; then
      FW_UNDO+=("firewall-cmd --remove-port=${PORT}/tcp")
      echo "firewall (firewalld): opened ${PORT}/tcp (runtime only) until the server stops"
    else
      echo "firewall (firewalld): could not open ${PORT}/tcp; run: sudo firewall-cmd --add-port=${PORT}/tcp" >&2
    fi
  else
    echo "firewall: no active ufw/firewalld that this script can manage (or no sudo): nothing opened locally"
  fi
}

fw_close() {
  local c
  for c in ${FW_UNDO[@]+"${FW_UNDO[@]}"}; do
    # shellcheck disable=SC2086
    if priv $c >/dev/null 2>&1; then echo "firewall: closed again ($c)"; else echo "WARNING: could not undo: sudo $c" >&2; fi
  done
  FW_UNDO=()
}

if [ "$OPEN" = 1 ]; then
  case "${HOST:-0.0.0.0}" in 127.0.0.1|localhost) echo "WARNING: HOST=${HOST} only listens on this machine; --open-port will not make it reachable" >&2 ;; esac
  echo "== opening port ${PORT} temporarily (stops when the server stops). Anyone with the address can connect: use room passwords."
  fw_open
  export UPNP=1
fi
trap fw_close EXIT

"$BIN" &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null || true' INT TERM   # let the server shut down (it removes its own router mapping)
status=0
while kill -0 "$pid" 2>/dev/null; do wait "$pid" && status=0 || status=$?; done
exit "$status"
