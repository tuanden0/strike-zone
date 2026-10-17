#!/usr/bin/env bash
# Tests scripts/run.sh --open-port with stub ufw/sudo and a fake server: rules are opened, and closed again on normal exit,
# SIGTERM and SIGINT; pre-existing rules are left alone; nothing happens without the flag.
set -uo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fails=0
ok() { echo "PASS $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }

mkdir -p "$T/bin"
cat > "$T/server" <<'S'
#!/usr/bin/env bash
trap 'echo "server got TERM" >> "$LOG"; exit 0' TERM INT
echo "UPNP=${UPNP:-unset}" >> "$LOG"  # (last: once this line is in the log the trap is installed, see the polling below)
[ -n "${SERVER_LIFETIME:-}" ] && { sleep "$SERVER_LIFETIME"; exit 0; }
while true; do sleep 0.2; done
S
cat > "$T/bin/ufw" <<'S'
#!/usr/bin/env bash
echo "ufw $*" >> "$LOG"
case "$1" in
  status) echo "Status: active"; if [ -n "${UFW_HAS_RULE:-}" ]; then echo "8080/tcp                   ALLOW       Anywhere"; fi ;;
esac
exit 0
S
cat > "$T/bin/sudo" <<'S'
#!/usr/bin/env bash
[ "$1" = "-n" ] && shift
[ "$1" = "true" ] && exit 0
exec "$@"
S
cat > "$T/bin/id" <<'S'
#!/usr/bin/env bash
echo 1000
S
chmod +x "$T/server" "$T/bin/"*
run() { # env..., args...
  : > "$T/log"
  LOG="$T/log" PATH="$T/bin:$PATH" SZ_BIN="$T/server" PORT=8080 "$@"
}

# 1. without the flag: no firewall calls, UPNP not forced
SERVER_LIFETIME=0.3 run env scripts/run.sh >/dev/null 2>&1
grep -q '^ufw' "$T/log" && bad "ufw touched without --open-port" || ok "no --open-port: firewall untouched"
grep -q 'UPNP=unset' "$T/log" && ok "no --open-port: UPNP not enabled" || bad "UPNP leaked into a plain run"

# 2. flag + normal exit: opened, UPNP=1, closed
SERVER_LIFETIME=0.5 run env scripts/run.sh --open-port >"$T/out" 2>&1
grep -q "ufw allow 8080/tcp" "$T/log" && ok "opens the ufw port" || { bad "port not opened"; cat "$T/log" "$T/out"; }
grep -q 'UPNP=1' "$T/log" && ok "passes UPNP=1 to the server" || bad "UPNP=1 missing"
grep -q 'ufw delete allow 8080/tcp' "$T/log" && ok "closes the ufw port after the server exits by itself" || { bad "port left open after exit"; cat "$T/log"; }

# 3. SIGTERM / SIGINT while running: server told to stop first, then port closed
for sig in TERM INT; do
  : > "$T/log"
  # started from python so SIGINT has its default disposition (a bash `&` job would ignore it, which a real terminal does not)
  LOG="$T/log" PATH="$T/bin:$PATH" SZ_BIN="$T/server" PORT=8080 python3 -c '
import os, signal, sys
signal.signal(signal.SIGINT, signal.SIG_DFL)
pid = os.fork()
if pid == 0:
    os.execv("scripts/run.sh", ["scripts/run.sh", "--open-port"])
open(sys.argv[1], "w").write(str(pid))
' "$T/pid" >/dev/null 2>&1
  for _ in $(seq 1 50); do grep -q '^UPNP=' "$T/log" 2>/dev/null && break; sleep 0.1; done  # wait until the stub server is really up
  pid=$(cat "$T/pid")
  kill -"$sig" "$pid" 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.3; done
  kill -0 "$pid" 2>/dev/null && { bad "run.sh survived SIG$sig"; kill -9 "$pid"; } || ok "run.sh exits on SIG$sig"
  grep -q 'server got TERM' "$T/log" && ok "SIG$sig reaches the server (graceful shutdown)" || bad "server not signalled on $sig"
  grep -q 'ufw delete allow 8080/tcp' "$T/log" && ok "SIG$sig: port closed" || { bad "SIG$sig: port left open"; cat "$T/log"; }
done

# 4. a rule that was already there is not ours to remove
UFW_HAS_RULE=1 SERVER_LIFETIME=0.4 run env UFW_HAS_RULE=1 scripts/run.sh --open-port >"$T/out" 2>&1
grep -q 'ufw delete' "$T/log" && bad "removed a pre-existing rule" || ok "pre-existing rule left alone"
grep -q 'ufw allow' "$T/log" && bad "re-added an existing rule" || ok "existing rule not duplicated"

# 5. bad option
scripts/run.sh --nope >/dev/null 2>&1; [ $? = 2 ] && ok "unknown option rejected" || bad "unknown option accepted"

echo; [ "$fails" = 0 ] && echo "all checks passed" || { echo "$fails check(s) failed"; exit 1; }
