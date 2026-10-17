# Strike Zone wire protocol

Transport: one WebSocket per client at `/ws` (same origin as the page: `ws://<host>/ws`).
Frames: **text only**, one JSON object per frame, field `t` = message type. Max frame **4096 bytes**
(larger closes the connection). Server tick = **30 Hz**; every duration below is derived from
`client/shared/spec.json`, which is the single source for hitboxes, speeds, weapons and match rules,
and `client/shared/map.json` (geometry + spawns).

Coordinates: metres, `y` up. Yaw 0 looks toward **-Z**; forward vector = `(-sin yaw·cos pitch, sin pitch, -cos yaw·cos pitch)`;
right = `(cos yaw, 0, -sin yaw)`. Positions are feet positions. Teams are `"A"` (Ember, red) and `"B"` (Cobalt, blue).

## Connection flow

```mermaid
sequenceDiagram
  participant C as Client
  participant S as Server
  C->>S: hello {nick}
  S-->>C: welcome {id, nick, tickRate}
  loop every ~3 s
    C->>S: rooms
    S-->>C: rooms {rooms:[...]}
  end
  C->>S: create {...} / join {...}
  S-->>C: joined {room, id, team}
  S-->>C: roster {...}
  loop 30 Hz
    C->>S: in {seq, f, s, yaw, pitch, ...}
    S-->>C: snap {k, ack, ps, you, ev, ...}
  end
  C->>S: leave
  S-->>C: left
```

Before `hello` only `hello` and `ping` are accepted. Protocol violations get an `error` message; after
10 of them (or on malformed JSON / binary frames / rate-limit abuse) the server closes the socket.

## Client → server

| `t` | Fields | Notes |
|-----|--------|-------|
| `hello` | `nick` string | Once. Control/format characters stripped, trimmed, max 16 runes; empty → `PlayerN`. |
| `ping` | `ts` number | Echoed in `pong`. Send every ~4 s (idle timeout is 30 s). |
| `rooms` | – | Request room list. |
| `create` | `name` (1–24 runes), `password` (≤32 bytes, `""` = open), `max` (2–10), `timeLimit` seconds (60–1800), `scoreLimit` (5–100), `map` id from `shared/maps.json` (`""` = default; unknown → `bad_request`), `bots` (0 … max-1 AI players added at creation), `skill` (`easy`/`normal`/`hard`, default `normal`), `team` (`"A"`,`"B"`,`"auto"`) | Creator joins immediately. Max 20 rooms server-wide. |
| `join` | `room` id, `password`, `team` (`"A"`,`"B"`,`"auto"`) | |
| `team` | `team` `"A"`/`"B"` | In a room. Respawns you on the new team if alive; refused if that team is full. |
| `addbot` | `team` (`"A"`,`"B"`,`"auto"`), `skill` | Add an AI player to your room (`room_full`/`team_full` if there is no slot). |
| `rmbot` | – | Remove the most recently added bot (`no_bots` if none). |
| `leave` | – | Leave the room; the room is deleted when empty. |
| `in` | see below | One per client tick (30/s). Only valid inside a room. |

### `in` (player input)

```json
{"t":"in","seq":1234,"f":1,"s":0,"yaw":1.57,"pitch":-0.1,"jump":false,"walk":false,"fire":true,"reload":false,"weapon":-1,"drop":false,"use":false,"scope":false,"nade":0}
```

| Field | Type / range | Meaning |
|-------|--------------|---------|
| `seq` | uint32, strictly increasing | Acknowledged back in `you.ack`; stale/duplicate → rejected. |
| `f`, `s` | number in [-1, 1] | Forward / strafe axes. Out of range → rejected (not clamped). |
| `yaw`, `pitch` | finite; `|yaw| ≤ 1e4`, `pitch ∈ [-1.6, 1.6]` | View angles (radians). |
| `jump`, `walk`, `fire`, `reload` | bool | Buttons. `walk` = Alt (slow, quiet). `fire` = held state. |
| `crouch` | bool | Shift held. The server keeps you crouched while a ceiling blocks standing; starting a crouch needs the ground; no jumping while crouched. Missing = false. |
| `weapon` | int, -1 … (weapons-1) | -1 keep, else request switch to slot (0 rifle, 1 pistol, 2 knife, 3 sniper). Switching to a weapon you do not own is ignored. Missing = -1. |
| `scope` | bool | Zoom held. Only has an effect while holding a weapon with `scopeFov > 0` (the sniper) and not reloading; scoped shots use `scopedSpread` instead of `spread`. Missing = false. |
| `nade` | int 0 … grenade types | 0 = none, else throw grenade type `nade-1` (0 frag, 1 smoke, 2 flash) along the view. Inventory, a 1 s cooldown and the alive check are enforced by the server; a held key cannot spam. Missing = 0. |
| `drop`, `use` | bool | Edge-detected server side. `drop` throws the current weapon (knife cannot be dropped); `use` picks up the nearest weapon within `pickups.radius` (swaps with the held weapon if that slot is occupied). Missing = false. |

The client **never sends positions**. The server simulates each input with the fixed step
(identical to `client/js/physics.js`, enforced by golden tests). Anti-abuse: at most 1 input/tick is
processed sustained (burst 3, ≤ 2/tick), queue ≤ 8 (oldest dropped), NaN/Inf/range checks, message rate
limit 80/s (burst 120).

## Server → client

| `t` | Fields |
|-----|--------|
| `welcome` | `id` (your player id), `nick` (sanitized), `tickRate` |
| `rooms` | `rooms`: `[{id,name,players,max,locked,timeLimit,scoreLimit,st,map,bots}]` (`st` = `playing`/`ended`) |
| `joined` | `room` (same shape as above, plus `map`), `id`, `team` |
| `pk` | `list`: `[{id,w,x,y,z,m,r}]` weapons lying on the ground (`w` weapon index, `m`/`r` mag/reserve). Sent after `joined` and whenever the set changes (drop, pick-up, expiry, respawn, match restart). |
| `roster` | `players`: `[{id,nick,team,kills,deaths,bot?}]` (bots have nick `[BOT] …` and `bot:true`), `sc`: `[scoreA, scoreB]`. Sent on join/leave/team change/kill/match reset. |
| `left` | – |
| `pong` | `ts` echoed |
| `error` | `code`, `msg` (see below) |
| `snap` | 30 Hz world state (below) |

Error codes: `bad_request`, `not_ready`, `bad_password`, `room_full`, `team_full`, `no_room`, `in_room`,
`not_in_room`, `too_many_rooms`, `server_full`, `no_bots`.

### `snap`

```json
{"t":"snap","k":1021,"st":"playing","tl":412,"sc":[7,5],
 "ps":[{"i":1,"x":3.1,"y":0,"z":12.2,"yw":0.4,"pt":0,"a":true,"w":0,"c":false}],
 "you":{"x":3.1,"y":0,"z":12.2,"vy":0,"g":true,"yw":0.4,"hp":100,"a":true,"w":0,
        "has":[true,true,true,false],"mag":[30,12,0,0],"res":[90,48,0,0],"rl":0,"cd":0,"pf":false,"bu":0,"bx":0,"gn":[1,1,1],"fl":0,"resp":0,"prot":false,"ack":1234},
 "ev":[{"e":"shot","by":1,"w":0,"from":[3.1,1.62,12.2],"to":[3.0,1.0,-8.0],"hit":"body"}]}
```

* `k` server tick, `st` match state, `win` (`A`/`B`/`draw`, only when `st="ended"`), `tl` seconds left in
  the current phase (match, or intermission), `sc` team scores.
* `ps` all players (including you): feet position, view angles, alive flag, current weapon index, `c` (only when crouching: lower hitboxes, crouch pose).
* `you` private state: authoritative kinematics (`vy`, `g` = on ground) for **reconciliation**, `ack` = last
  processed `seq`; health; per-weapon `has` (weapon owned; false after dropping it) / `mag` / `res`; `rl` ticks until reload completes; `cd` ticks until next
  shot allowed; `pf` fire was held last input (semi-auto edge); `cr` crouching (needed to replay inputs with the right stance); `gn` grenades left per type; `fl` ticks of flashbang blindness left; `bu`/`bx` consecutive shots in the current burst / ticks until it expires (drives spread bloom and the view-kick ramp, see below); `resp` ticks until respawn; `prot` spawn protection.
* `ev` events produced this tick:
  * `shot` `{by,w,from,to,hit}` — `hit` ∈ `""`(nothing in range), `"wall"`, `"body"`, `"head"`. Also sent for knife swings.
  * `hit` `{by,v,w,dmg,head}` — damage dealt (`dmg` includes the headshot multiplier).
  * `kill` `{by,v,w,head}`. For grenade damage `w` is `weapons.length + grenade index` (so `hit`/`kill` weapon names come from `spec.grenades` past the end of `spec.weapons`); a kill of yourself scores nothing.
  * `throw` `{by,g}` someone threw grenade type `g` (sound). `boom` `{by,g,at:[x,y,z]}` a grenade went off.
* `gr` (optional) grenades in flight `[{i,g,x,y,z}]`; `sm` (optional) standing smoke clouds `[{g,x,y,z,l}]` (`l` = ticks left).
  Frag damage is `damage × (1 - distance/radius)` with a clear line to the victim's body (walls block it), none to teammates, half to the thrower. Flash blindness depends on distance, line of sight and how directly you look at it. Smoke blocks bot vision (and is drawn as a cloud for players).

**Recoil model** (`spec.recoil`, mirrored in `client/js/weapons.js`, parity-tested with golden files): a shot's view kick is
`perDamage × damage × recoilScale` radians (harder-hitting weapons kick harder). Shots that follow the previous one within
`intervalTicks + graceTicks` form a burst; the kick ramps by `rampPerShot` per shot and the **server** widens the shot's random
cone by `bloomRatio × kick × bloomScale` per extra shot (both capped at `maxShots`). Switching weapon or reloading ends the burst.
The view kick itself is client-side (it moves the yaw/pitch the client sends); the spread bloom is server-authoritative.

Client behaviour (not enforced by the server): predict own movement and weapon state, on each `snap`
reset to `you`, drop acked inputs and replay the rest; render other players ~100 ms in the past by
interpolating between snapshots.

## Rules summary (values from `spec.json`)

* Health 100. Rifle 30 dmg, pistol 25, knife 40 (range 2.2 m); headshot ×4 (not knife). Head box 0.36×0.35×0.36 m above a 0.6 m-wide body box.
* No friendly fire. Respawn 3 s after death, 1.5 s spawn protection (ends when you fire).
* Match: first team to `scoreLimit` kills or highest score at `timeLimit`; 10 s intermission, then scores reset and everyone respawns.

## HTTP endpoints

| Path | Purpose |
|------|---------|
| `/` and static files | embedded client |
| `/healthz` | `ok` |
| `/ws` | WebSocket |
| `/admin/stats` | JSON `{sessions, rooms}`; only when `ADMIN_TOKEN` is set, `Authorization: Bearer <token>` |
