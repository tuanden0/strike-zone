# Strike Zone

An original 3D tactical team shooter for playing with colleagues on an office LAN.
Browser client (Three.js, no build step) + Go server (authoritative, one binary, client embedded).
Non-commercial. All code, geometry, textures, characters and sounds are generated procedurally; nothing from any commercial game is used.

* Team Deathmatch, 2–10 players per room, rooms with optional password
* Rifle, pistol, knife; headshots ×4; scoreboard, kill feed, hit markers, synthesized sound
* Works over plain `http://<LAN-IP>:8080`: no internet, no TLS, no CDN needed

## Quick start (one command)

```bash
cd server && go run .
```

Open the URL it prints, e.g. `http://localhost:8080`. Needs Go 1.24+ ([go.dev/dl](https://go.dev/dl/)).
`scripts/run.sh` (Linux/macOS) or `scripts/run.ps1` (Windows PowerShell) do the same via a build into `dist/`.

Startup prints every address players can use:

```
Strike Zone listening on 0.0.0.0:8080
  open: http://localhost:8080
  open: http://192.168.1.20:8080
```

Single machine only? `HOST=127.0.0.1 go run .`

## Run without installing Go (binary)

Build all targets once on any machine with Go:

```bash
./scripts/build-all.sh        # -> dist/strike-zone-{linux,darwin,windows}-{amd64,arm64}[.exe] + SHA256SUMS
```

Copy **one file** to the host machine (the client is embedded) and run it:

| OS | Command |
|----|---------|
| Linux | `chmod +x strike-zone-linux-amd64 && ./strike-zone-linux-amd64` |
| macOS (Apple silicon) | `chmod +x strike-zone-darwin-arm64 && xattr -d com.apple.quarantine strike-zone-darwin-arm64; ./strike-zone-darwin-arm64` |
| Windows | `.\strike-zone-windows-amd64.exe` |

`dist/` is git-ignored. Binaries are unsigned: macOS/Windows may warn on first run.

## Play over the LAN

1. **Host** starts the server (default `HOST=0.0.0.0`, port `8080`) and reads the printed `http://192.168.x.x:8080` URL.
   If you need to find the address yourself:
   * Windows: `ipconfig` → "IPv4 Address" of your Wi-Fi/Ethernet adapter
   * macOS: `ipconfig getifaddr en0` (Wi-Fi; try `en1` if empty)
   * Linux: `hostname -I` or `ip -4 addr`
2. **Allow the port through the host's firewall** (only the host needs this):
   * Windows (Admin PowerShell): `netsh advfirewall firewall add rule name="Strike Zone" dir=in action=allow protocol=TCP localport=8080 profile=private`
     (remove later: `netsh advfirewall firewall delete rule name="Strike Zone"`).
     Make sure the network is marked *Private*, not *Public*.
   * macOS: allow the incoming-connection prompt, or `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$PWD/strike-zone-darwin-arm64" && sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$PWD/strike-zone-darwin-arm64"`
   * Linux ufw: `sudo ufw allow 8080/tcp` · firewalld: `sudo firewall-cmd --add-port=8080/tcp --permanent && sudo firewall-cmd --reload` · iptables: `sudo iptables -I INPUT -p tcp --dport 8080 -j ACCEPT`
3. **Everyone else** opens the host's URL in a current Chrome/Edge/Firefox/Safari, enters a nickname, **Play online**, then creates or joins a room.
   Click **Resume** to capture the mouse; `Esc` releases it (pause menu: team switch, sensitivity, volume, leave).

### Controls

`W A S D` move · mouse aim · `Space` jump · `Shift` walk (quiet) · `R` reload · `1` rifle `2` pistol `3` knife · left mouse fire/slash · `Tab` scoreboard

**Practice range** (title screen) works offline with target dummies and needs no server connection once the page is loaded.

## Configuration (environment variables)

Nothing is required. Invalid values make the server exit at startup with a clear message.

| Variable | Default | Meaning |
|----------|---------|---------|
| `HOST` | `0.0.0.0` | Listen address. `127.0.0.1` = this machine only. IP or `localhost`. |
| `PORT` | `8080` | Listen port (1–65535). |
| `ALLOWED_ORIGINS` | *(empty)* | Extra WebSocket origins, comma separated, e.g. `http://game.lan:8080`. Same-origin (page host:port = WS host:port) is always allowed, so `localhost` and LAN IPs need no setup. |
| `ADMIN_TOKEN` | *(unset)* | ≥16 chars. Enables `GET /admin/stats` (`Authorization: Bearer …`). Unset = endpoint returns 404. |
| `MAX_CONN_PER_IP` | `8` | Concurrent WebSocket connections per client IP (1–1000). |

`.env.example` lists them; `scripts/run.*` load a local `.env` if you create one. Never commit `.env`.

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Others get "site can't be reached" / timeout | Host firewall blocks the port (step 2 above), or the Windows network profile is *Public*. Test from the host first with its LAN URL. |
| Works on the host, not from other PCs, even with firewall open | **Wi-Fi AP / client isolation** or a **guest network**: devices cannot see each other. Use the main office SSID or wired LAN; ask IT to disable client isolation. |
| Wrong URL / connection refused | Use the URL printed at startup. VPN, Docker, WSL and virtual adapters add extra private IPs; pick the one in the same subnet as the other players (same first three numbers, e.g. `192.168.1.x`). |
| "Address already in use" | Another program uses 8080. Pick another: `PORT=9090 go run .` (and open that port in the firewall). |
| Page loads but "Cannot reach the game server" | Reverse proxy without WebSocket upgrade, or the Origin was rejected: the server log prints `ws: rejected origin …`; add it to `ALLOWED_ORIGINS`. |
| "too many connections" | More than `MAX_CONN_PER_IP` tabs/clients from one IP (e.g. everyone behind one NAT). Raise `MAX_CONN_PER_IP`. |
| No sound | Browsers start audio only after a click: press **Resume**. Check the Volume slider. |
| Mouse not captured | Click **Resume** (a click is required); a browser may refuse re-capture for ~1 s after `Esc`. |
| Laggy / low FPS | Needs WebGL. Close other tabs; use a discrete GPU/hardware acceleration. Ping is shown top-left. |
| macOS "cannot be opened" | `xattr -d com.apple.quarantine <file>` or right-click → Open. |

## Development

```bash
go test -race ./...                 # unit + integration (real sockets); needs no browser
./scripts/check.sh                  # gofmt, vet, race tests, gitleaks (tree + history), govulncheck
node scripts/gen-golden.mjs         # regenerate JS<->Go golden files after touching physics/weapons
cd e2e && npm ci && node smoke.mjs && node online.mjs   # headless Chromium; server must be running (BASE_URL=http://host:port)
```

Layout:

```
client/            static web client (ES modules, vendored three.js), embed.go (go:embed)
  shared/          spec.json + map.json: ONE source for hitboxes, speeds, weapons, map (client and server)
server/            main.go + internal/{config,netutil,game,lobby,wsserver,app}
  internal/game    pure simulation (no I/O): movement, weapons, hit detection, match
  internal/lobby   rooms, sessions, JSON protocol (no network I/O)
  internal/wsserver origin check, limits, timeouts, WebSocket <-> lobby
docs/PROTOCOL.md   wire protocol
scripts/           run.sh, run.ps1, build-all.sh, check.sh, gen-golden.mjs
e2e/               Playwright smoke tests
```

More: [DECISIONS.md](DECISIONS.md) (design choices), [SECURITY.md](SECURITY.md), [REPORT.md](REPORT.md) (status, test results, known issues).
Bundled third-party: three.js r170 (MIT) in `client/vendor/`.
