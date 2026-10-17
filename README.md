# Strike Zone

An original 3D tactical team shooter for playing with colleagues on an office LAN.
Browser client (Three.js, no build step) + Go server (authoritative, one binary, client embedded).
Non-commercial. All code, models (low-poly, PBR), textures and sounds are generated procedurally by scripts in this repo (`tools/assets/`, Blender + numpy); nothing from any commercial game is used.

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

`W A S D` move · mouse aim · `Space` jump · `Shift` walk (quiet) · `R` reload · `1` rifle `2` pistol `3` knife · left mouse fire/slash · `Tab` scoreboard · `E` pick up weapon · `G` drop weapon · `4` sniper (once picked up) · right click to scope in/out

**Phones/tablets:** open the same URL in the mobile browser (landscape). Left thumb = move stick, right thumb = look, buttons: FIRE · JUMP · R (reload) · USE (pick up) · DROP · tap `1 2 3` to switch weapon, `TAB` scoreboard, `II` pause menu. Touch devices default to Graphics = Low; no Pointer Lock or HTTPS is needed. iOS Safari has no fullscreen API for pages, so add the page to the home screen for a full-screen view.

**Weapons:** AR-7 rifle (auto), P-9 pistol, combat knife and the **SR-9 sniper** (bolt-action, one shot kills at any range on a body or head hit, 5 rounds, 1.4 s between shots). The sniper is *not* in the spawn loadout: pick one up from the purple-ringed spawn points (yard: two side lanes; crossroads: both ends of the cross street; the newer maps: the ends of their longest corridor or aisle). **Right click** (touch: **SCOPE** button) toggles the zoom (~5.5x); click again to leave: look sensitivity drops with the zoom and shots are perfectly accurate while standing still; moving or hip-firing spreads them wide. Reloading, switching weapon, pausing or dying leaves the scope. Dying loses the sniper. Practice range gives you the sniper from the start.

**Recoil:** a shot's view kick is proportional to the weapon's damage (sniper ≫ rifle > pistol; knife none). Holding the trigger ramps the kick up shot after shot and the server widens the spread (rifle: ~100 % of first shots hit a standing target at 30 m, ~20 % of shots 10+ of a spray). Short taps or pauses reset it, so burst-fire for accuracy; reloading or switching also resets it.

**Maps:** seven maps, chosen when creating a room or in Practice. *Yard* (cover-rich arena) and *Crossroads* (empty four-way intersection with a building on each corner), plus five more: *Piazza* (small Mediterranean village: alleys, a central square with a fountain, stucco houses with a few enterable rooms, market stalls), *Sandstone Pyramid* (desert ruin around a stepped pyramid with 0.8 m tiers you can jump up, colonnade avenue, ruined temples, obelisks), *Canyon Run* (rock canyon with a long middle corridor, two flank lanes, an adobe hut and crates), *Harbor* (container yard maze with a two-door warehouse, forklift-size crates and a long sniper aisle) and *Bunker* (indoor close quarters: 3 m corridors, rooms with doorways, a central pillared hall). The layouts are original and only inspired by classic archetypes; there are no third-party maps, textures or assets (everything is generated by the scripts in `tools/assets/`). Each map has 8 spawns per team in a walled courtyard or room at opposite ends, and 10 weapon pickups (4 rifles, 4 pistols, 2 snipers on long sight lines); the two halves are the same drawing rotated 180 degrees, so both teams get an identical map. Weapons respawn 20 s after pick-up; dropped weapons vanish after 60 s.

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
| Phone: touch controls missing / page scrolls | Use landscape; tap **Resume** first. Add the page to the home screen on iOS for fullscreen. Touch mode is chosen from the primary pointer (`pointer: coarse`); `?touch=1` forces it. |
| Mouse not captured | Click **Resume** (a click is required); a browser may refuse re-capture for ~1 s after `Esc`. |
| Laggy / low FPS | Needs WebGL. Pause menu → **Graphics: Low** (no shadows, 1x pixel ratio). Close other tabs; enable hardware acceleration. FPS and ping are shown top-left. |
| macOS "cannot be opened" | `xattr -d com.apple.quarantine <file>` or right-click → Open. |

## Development

```bash
go test -race ./...                 # unit + integration (real sockets); needs no browser
./scripts/check.sh                  # gofmt, vet, race tests, gitleaks (tree + history), govulncheck
node scripts/gen-golden.mjs         # regenerate JS<->Go golden files after touching physics/weapons
cd e2e && npm ci && node smoke.mjs && node online.mjs && node assets.mjs && node extras.mjs && node mobile.mjs   # headless Chromium; server must be running (BASE_URL=http://host:port)
pip install bpy==5.2.2 && python tools/assets/build_all.py   # regenerate every model + preview renders (or: blender -b -P tools/assets/build_all.py)
```

Layout:

```
client/            static web client (ES modules, vendored three.js + GLTFLoader), embed.go (go:embed)
  assets/models    generated .glb models (maps, soldier x2 teams, rifle/sniper/pistol/knife + first-person variants)
  shared/          spec.json + map.json: ONE source for hitboxes, speeds, weapons, map (client and server)
server/            main.go + internal/{config,netutil,game,lobby,wsserver,app}
  internal/game    pure simulation (no I/O): movement, weapons, hit detection, match
  internal/lobby   rooms, sessions, JSON protocol (no network I/O)
  internal/wsserver origin check, limits, timeouts, WebSocket <-> lobby
docs/PROTOCOL.md   wire protocol
tools/assets/      Blender scripts that generate every .glb (see tools/assets/README.md, ASSETS.md)
scripts/           run.sh, run.ps1, build-all.sh, check.sh, gen-golden.mjs
e2e/               Playwright tests: smoke, online, xss, assets (hitbox fit), extras (decals, sniper scope, crossroads), maps (the five newer maps), mobile (touch emulation), perf, screenshots
```

More: [ASSETS.md](ASSETS.md) (models, budgets, licences), [DECISIONS.md](DECISIONS.md), [SECURITY.md](SECURITY.md), [REPORT.md](REPORT.md) (asset overhaul status, tests, screenshots), [docs/REPORT_MVP.md](docs/REPORT_MVP.md) (original MVP report).
Bundled third-party: three.js r170 + GLTFLoader/BufferGeometryUtils/SkeletonUtils (MIT) in `client/vendor/`.
