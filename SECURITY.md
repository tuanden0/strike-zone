# Security

Scope: a LAN-only hobby game (HTTP + WebSocket on a trusted office network). Not hardened for the open internet:
there is **no TLS and no accounts**. Do not port-forward it.

## Controls implemented

| Area | Control | Where / test |
|------|---------|--------------|
| Config | All settings from ENV with safe local defaults; bad values abort startup with the variable named; no secrets in repo; `.env`, `*.pem`, `*.key`, `/dist`, binaries are git-ignored; `.env.example` has placeholders only | `server/internal/config` + tests |
| WebSocket origin | Only same-origin (`Origin` host:port == request `Host`) plus optional `ALLOWED_ORIGINS`; rejects `null`, other ports/hosts, suffix tricks. Rejections are logged | `wsserver.CheckOrigin` + unit tests; real-socket test with a LAN-IP `Host`; real Chromium over a non-localhost IP |
| Message size | 4096-byte read limit; text frames only | `TestOversizedMessageClosesConnection`, `TestBinaryFramesRejected` |
| Rate limit | Token bucket 80 msg/s (burst 120) per connection, disconnect after 200 drops | `TestBucket`, `TestMessageFloodIsRateLimitedThenDisconnected` |
| Connection caps | `MAX_CONN_PER_IP` (default 8), 200 sessions, 20 rooms | `TestIPLimiter`, `TestPerIPConnectionLimit`, `TestServerFullClosesNewConnection`, `TestRoomLimit` |
| Timeouts | 30 s read-idle (client pings every 4 s), 5 s write, `ReadHeaderTimeout` 5 s, slow consumers (full 64-message queue) are dropped | `TestIdleConnectionTimesOut`, `TestSlowClientIsDropped`, `TestConnectionSurvivesHTTPTimeouts` |
| Input validation | Every field checked (NaN/Inf, ranges, enum, strictly increasing `seq`); invalid → rejected, 10 violations → disconnect. Names: control/format/bidi characters stripped, length-capped | `game.Input.Validate`, `lobby.SanitizeName`, hub tests, `FuzzHandle` (332k executions, no panic) |
| Anti-cheat by design | Client sends inputs only, never positions; server owns movement, ammo, hit detection, damage, score. Speed bounded (≤1 input/tick sustained), fire rate by server cooldown, spawn protection ends on firing, no friendly fire | `TestSpeedCannotExceedRunSpeed`, combat tests |
| Room passwords | Salted SHA-256, `subtle.ConstantTimeCompare`, never logged or echoed, 5 wrong tries disconnect | `TestPasswordRoom`, `TestPasswordBruteForceDisconnects` |
| XSS | Client renders all server/user strings with `textContent`/`createElement`; no `innerHTML` anywhere; strict CSP (`script-src 'self'`, no inline) | `e2e/xss.mjs` (hostile nick/room name in lobby, scoreboard, kill feed) |
| HTTP headers | CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-cache` | `TestStaticClientServedWithSecurityHeaders` |
| Admin | `/admin/stats` exists only if `ADMIN_TOKEN` (≥16 chars) is set; Bearer token compared in constant time; otherwise 404 | `TestAdminStatsToken` |
| Resilience | Panic recovery per connection (handler + writer), per room tick and per tick loop; graceful shutdown on SIGINT/SIGTERM closes sockets with "going away" | `TestPanicInHandleKillsOnlyThatConnection`, `TestPanicInTickDoesNotStopLoop`, `TestShutdownClosesClients` |

## Scans (what was actually run)

| Check | Result |
|-------|--------|
| `gitleaks dir .` + `gitleaks git .` before every commit (`scripts/check.sh`) | **0 findings** at every commit. One false positive occurred once: a dummy admin-token literal in a test matched `generic-api-key`; fixed by building the value at runtime (no allow-list used). |
| Manual pattern grep (`api key / secret / password / token / private key / AKIA… / ghp_… / xox…`) over the tree excluding vendored code | Only identifier names and test fixtures; no credentials. No tracked `.env`/`*.pem`/`*.key`. |
| `govulncheck ./...` | **NOT RUN SUCCESSFULLY**: the sandbox's egress policy blocks `vuln.go.dev` (HTTP 403), so the vulnerability database cannot be downloaded. `scripts/check.sh` prints `WARNING: govulncheck SKIPPED` instead of passing silently. Run it on a networked machine: `go install golang.org/x/vuln/cmd/govulncheck@latest && govulncheck ./...`. Toolchain used: Go 1.24.7 (later 1.24.x/1.25 patch releases may contain stdlib fixes); the only third-party Go dependency is `github.com/coder/websocket v1.8.15`. |
| `gofmt`, `go vet`, `go test -race ./...` | pass (see REPORT.md) |

Provenance of vendored code: `client/vendor/three.module.js` is `three@0.170.0` `build/three.module.min.js` from the npm registry
(sha256 `08fd7545d13d2c7fb65ab691530a802dafefd638596501854f267d0fb13c39e7`), MIT license in `client/vendor/three.LICENSE`.

## Known limitations / residual risk

* **Plain HTTP/WS**: anyone who can sniff the LAN sees traffic, including room passwords typed into the lobby. Treat room passwords as a "keep casual joiners out" feature, not authentication.
* **No identity**: nicknames can be duplicated or impersonated; there is no kick/ban UI (restart the server or use `ADMIN_TOKEN` stats only for visibility).
* **Client trust**: aim assistance (aimbot/wallhack from the data the client receives) cannot be prevented in this design; all players are assumed to be colleagues.
* **Per-IP limits** assume distinct client IPs; `X-Forwarded-For` is deliberately ignored (a reverse proxy would make all clients share one IP; raise `MAX_CONN_PER_IP` then).
* **DoS**: limits bound memory and CPU for a LAN, not a determined attacker with many source addresses.
* Unsigned release binaries (`dist/`); verify with `SHA256SUMS`.
