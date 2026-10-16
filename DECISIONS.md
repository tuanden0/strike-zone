# Decisions

Autonomous run (no human to ask). Ambiguities resolved with the simplest safe option; reasons below.

| # | Topic | Decision | Why |
|---|-------|----------|-----|
| 1 | Go module location | `go.mod` at repo root, module `strikezone`; server in `/server`, client embed package in `/client` | `go:embed` cannot reach outside its package dir. Root module lets `client/embed.go` embed `/client` while `cd server && go run .` still works. |
| 2 | Go version | `go 1.24` (toolchain installed in the sandbox: 1.24.7) | "Latest stable" = what is installable offline-ish here. Nothing 1.25-specific is used. |
| 3 | three.js | r170 `three.module.min.js` copied to `client/vendor/` (+ MIT license) | No CDN: must work on LAN without internet. Only the core module is needed (no loaders/controls). |
| 4 | Shared spec | `client/shared/spec.json` (hitboxes, movement, weapons, match rules) and `client/shared/map.json` are the single source for client **and** server. Server reads them through the same `go:embed` FS. | Spec said hitbox dims must live in one place; same for map collision. |
| 5 | Empty remote | `tuanden0/strike-zone` was empty (no `main`). Work lives on `feature/fps-mvp`. | A PR needs a base branch; see REPORT.md for how that was handled. Instructions forbid pushing `main`. |
| 6 | `.env` | Server reads only real env vars. `.env.example` is reference; `scripts/run.*` source `.env` if present. | No dotenv dependency (YAGNI). |
| 7 | CSP | Strict CSP header (`'self'` only, `ws:`/`wss:` for connect). No inline script/style. | Cheap defence-in-depth; client has no inline code. |
| 8 | Practice mode | Offline range (dummies) kept as a permanent lobby button, not just a milestone-1 stub. | Cheap, useful for smoke tests, no server needed. |
| 9 | Netcode | Client sends one input per 30 Hz tick (`seq`, axes, yaw/pitch, buttons) — never positions. Server simulates with the same fixed step; snapshot carries `ack` + authoritative state; client replays unacked inputs (prediction + reconciliation); remote players are interpolated 100 ms behind. | Speed/teleport hacks impossible by construction; JS and Go movement are locked together by a golden test. |
| 10 | Input flooding | Server processes ≤1 input/tick sustained (token budget, burst 3, ≤2/tick), queue capped at 8. | Without this, sending 60 inputs/s would give 2x speed. |
| 11 | Movement model | Full air control, instant velocity (no accel), AABB vs boxes, no step-up, no player-vs-player collision. | Deterministic and tiny to port exactly to Go; good enough for MVP. |
| 12 | Origin policy | Same-origin = Origin host:port equals request Host (scheme ignored); absent Origin allowed (non-browser); extras via `ALLOWED_ORIGINS`. The websocket library's own check is disabled (`InsecureSkipVerify`) because ours replaces it. | Spec; works for localhost and any LAN IP with zero config. |
| 13 | Room passwords | Stored as salted SHA-256, compared with `subtle.ConstantTimeCompare`; never logged or echoed; 5 wrong tries disconnects. | LAN game, not an auth system; avoids plaintext in memory dumps/logs. |
| 14 | Team cap | Each team holds at most ceil(max/2) players; `auto` joins the smaller team. | Keeps teams balanced without extra rules. |
| 15 | govulncheck | Cannot reach vuln.go.dev from the sandbox (egress policy 403). `scripts/check.sh` reports it as SKIPPED loudly instead of passing silently. | Do not route around the egress policy; see SECURITY.md. |
| 16 | Hit detection | Hitscan from the eye, nearest of {map geometry, floor, enemy head/body AABBs}. All players' movement for a tick is applied first, then shots resolve (id order cannot decide a duel; mutual kills possible). Spread uses a server RNG; friendly fire off; spawn-protected and dead players are skipped; firing ends own spawn protection. | Server-authoritative, simple, deterministic in tests (seeded RNG, spread zeroed in tests). |
| 17 | No lag compensation | Server tests the shot against current positions (remote players are rendered ~100 ms in the past). | LAN latency is a few ms; rewind buffers add complexity. Add if Wi-Fi play feels off. |
| 18 | Knife | Same ray code, range 2.2 m, 40 dmg, head multiplier 1. | Reuses hit code; keeps knife from one-shotting on head. |
| 19 | Team switch while dead | Changes team but does not respawn early. | Prevents instant-respawn exploit. |
| 20 | Ammo prediction | Client mirrors the weapon state machine (`weapons.js` == `weapons.go`); snapshot carries ammo/cooldown/reload and client replays unacked inputs through it. | Avoids ammo-counter flicker without trusting the client. |
