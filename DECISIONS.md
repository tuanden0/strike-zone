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
