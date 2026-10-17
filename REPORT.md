# Report — realistic low-poly asset overhaul

Branch `feature/realistic-assets` (based on `feature/fps-mvp`). Gameplay, network protocol and server logic are unchanged
(`server/` only gained a CSP `blob:` entry and two assertions in a static-file test). The original MVP report is in
[docs/REPORT_MVP.md](docs/REPORT_MVP.md); model list, budgets and licences are in [ASSETS.md](ASSETS.md).

## What was done

* **Replaced every box-built visual** — soldiers, rifle, pistol, knife, map and props — with generated `.glb` models
  (`client/assets/models/`, 9 files, **7.75 MB**, 256–512 px textures): see ASSETS.md for the table.
* **Pipeline** (`tools/assets/`): one deterministic Blender script per asset (`map_kit.py`, `rifle.py`, `pistol.py`, `knife.py`,
  `character.py`) + shared helpers; `python tools/assets/build_all.py` rebuilds all models and preview renders. Blender 5.2.2 LTS came
  from the PyPI `bpy` wheel (no Blender binary in the sandbox); textures are numpy-procedural, embedded as JPEG.
  No third-party art packs were available (`client/assets/third_party/` does not exist), so nothing external is used.
* **Soldier**: ~4.9k-tri armature-rigged model (helmet, goggles, gaiter, plate carrier, pouches, pads, gloves, boots), two team colours,
  clips `idle, run, crouch, death, hold_rifle/pistol/knife, shoot_rifle/pistol/knife`; weapons are bone-parented low-poly meshes.
  Authored at exactly 1.80 m so the shared hitbox spec is untouched.
* **Weapons**: generic fictional AR-7 rifle (2.1k tris), P-9 pistol (1.1k), combat knife (0.4k) with named moving parts
  (`slide`, `mag`, `bolt`); first-person variants with gloved hands and sleeves; muzzle-flash sprite and ejected brass in first person.
* **Map**: one bevelled prop per collision box generated from `client/shared/map.json` (concrete barriers with lamps, sandbag walls,
  corrugated containers, braced crates, perimeter walls with hazard band, pilasters, doors and lamps, tiled floor) so visuals equal collision.
* **Rendering**: PBR materials, ACES tone mapping, sRGB output, procedural sky → PMREM reflections, hemisphere + sun with 2048² shadow map
  (characters and props), separate first-person pass, shader warm-up at load, `Graphics: High/Low` option, shadow LOD for far soldiers.

## Visual review (rendered, viewed, corrected — max 3 rounds per asset)

Blender (Cycles) previews of every asset are in `docs/previews/` (3 views for weapons/character; close-ups for the map; run / crouch / death
pose renders for the soldier). In-game Chromium screenshots (software GL, Graphics = High) are in `docs/screenshots/`.

| Asset | Rounds | Problems found by looking at the renders → fix |
|-------|-------:|-----------------------------------------------|
| Map | 3 | container corrugated side panels floated off the box; door leaf near-black; door preview pointed at the wrong side; sandbags and crates accepted |
| Rifle | 3 | floating front sight/optic block; segmented magazine → lofted curve; baseplate detached; too dark/scratchy; two-tone polymer added |
| Pistol | 2 | gap between slide and frame; rest accepted |
| Knife | 2 | fist wrapped from above with the forearm through the handle → hand rebuilt from below |
| Soldier | 3 | helmet covered the face (open brim, rear skirt); back-pack and straps stuck out above the 1.45 m body box (e2e caught it); death fell forwards; **finger meshes had no skin weights and hung in the air when posed (seen in the death render)** |

Representative images (all in the repo): `docs/screenshots/fp_rifle.jpg`, `fp_pistol.jpg`, `fp_knife.jpg`, `fp_rifle_muzzle_flash.jpg`,
`enemy_5m_front.jpg`, `enemy_5m_back.jpg`, `enemy_20m_back.jpg`, `tp_rifle_{front,threequarter,side,back}.jpg`, `tp_pistol.jpg`, `tp_knife.jpg`,
`tp_death.jpg`, `map_overview.jpg`, `map_top.jpg`, `map_spawn_view.jpg`.

![first person rifle](docs/screenshots/fp_rifle.jpg)
![opponent at 5 m](docs/screenshots/enemy_5m_front.jpg)
![map overview](docs/screenshots/map_overview.jpg)

My honest assessment of the result: a clear step up from boxes — readable, coherent PBR look, working animation and first-person hands — but it
is **stylised low-poly, not truly realistic**: limbs are rigid segments, faces are covered, hands are simplified, textures are procedural noise.

## Tests (actually run)

| Check | Result |
|-------|--------|
| `./scripts/check.sh` (gofmt, vet, `go test -race ./...`, gitleaks tree + history) | **passes**: app, config, game, lobby, netutil, wsserver `ok`; gitleaks 0 findings (also re-run before each commit); `govulncheck` **SKIPPED** (vuln DB blocked by the sandbox, as before) |
| Server unaffected | all pre-existing Go tests pass unchanged; new assertions: `/assets/models/*.glb` and `GLTFLoader.js` are served from the embedded FS |
| Browser e2e (`e2e/smoke, online, xss, assets`), Chromium, **94 checks, 0 failures**, run on `http://localhost:8080` and on the container IP `http://192.0.2.2:8080` (non-secure context) | pass |
| `e2e/assets.mjs` | all 9 `.glb` load with **no console errors/warnings**; budgets: body 4,942 ≤ 5k, rifle 2,148 ≤ 3k, pistol 1,088 ≤ 1.5k, knife 429 ≤ 0.8k, total 7.75 MB ≤ 20 MB; clips present on both teams |
| Hitbox fit (`assets.mjs`) | model scale factor 1.0000; head-bone vertices y 1.5275–1.80 (head box 1.45–1.80), x ≤ 0.129, z ≤ 0.148 (box 0.18); torso/back ≤ 1.45 m, half-width ≤ 0.245 (box 0.30); legs reach y = 0 |
| Head vs body hits on the new model | aiming at the head-bone vertex centroid (y 1.68) from 12 m: 20/20 shots scored **headshots**; aiming at the chest centroid (y 1.25): 20/20 body hits, **0 headshots** (client-side hit code = same maths as the unchanged server hit test) |
| Existing game flows | smoke (pointer lock, WebAudio, weapon keys, reload, movement), online (two browsers, prediction error 1.3 mm, ammo prediction), xss: all pass with the new renderer |

## Performance

* **FPS was NOT measured on real hardware** — the sandbox has no GPU; SwiftShader (software GL) renders ~2 fps with PBR + skinning, so the
  ≥ 60 fps target is **unverified**. Numbers that do transfer (`e2e/perf.mjs`, 8 soldiers on screen, 1280×720):
  Graphics High: **261 draw calls, 198k triangles per frame** (shadow pass + world + first-person pass); Low (no shadows): **177 calls, 114k tris**;
  animating all 8 soldiers costs **~0.26 ms of JS per frame**. That is well inside what an integrated laptop GPU handles, but treat it as an estimate.
* Reduction measures: the whole map is one merged static mesh (10 draw calls, beats instancing), shader warm-up at load, distant soldiers
  (> 32 m) stop casting shadows, `Graphics: Low` option, pixel ratio capped at 1.5. No LOD meshes (soldier is already ≤ 5k tris).

## Known issues

1. Style is stylised, not photo-real (see assessment above); soldier faces are fully covered (no face texture/model).
2. Third-person soldiers do not pitch their weapon with the player's view angle (aim is horizontal); run cycle has some foot sliding;
   `crouch` is authored but unused (there is no crouch gameplay).
3. Outstretched arms and the held rifle extend beyond the 0.6 m body hitbox in depth (hitboxes were deliberately not changed).
4. First-person hands are blocky gloves; grip poses were tuned by eye on renders, not on real weapon references.
5. Soldiers use 19 materials (19 draw calls each, ×2 with shadows): an atlas would cut draw calls ~3–4× if needed on weak GPUs.
6. Gunmetal scratch texture reads slightly "spider-web" at 256 px close-up; sky is a flat colour behind the PMREM environment;
   a faint sawtooth appears on the near wall tops in the high-angle `map_overview` shadow.
7. `docs/reference/` was absent, so the style match to reference images could not be checked.
8. **PR not opened**: the remote still has no `main` branch (empty repository originally) and creating it would be a push to `main`,
   which is forbidden. Push `feature/realistic-assets` is done; open the PR into `main` once `main` exists, using this report as the description.

## Next steps

* Real-GPU playtest: measure FPS (try `Graphics: High` vs `Low`), tune shadow extent/bias, then atlas the soldier materials if needed.
* Aim-pitch (spine/chest rotation) and a crouch mechanic to use the existing clip; foot IK to remove sliding.
* Replace procedural noise with painted/baked detail (or a CC0 pack in `client/assets/third_party/` with licence notes), add normal-mapped face and skin.
* Optional: dropped-weapon pickups using the world models `rifle.glb/pistol.glb/knife.glb` (currently unused at runtime), decals, dust, tracers as meshes.

---

# Gameplay extras (branch `feature/gameplay-extras`)

Requested after the asset overhaul: bullet holes / blood, weapon drop + pick-up + map weapon spawns, a four-way "crossroads" map,
phone support, a sniper rifle with scope logic. **These change the protocol and server (additively)**, unlike the asset task; see DECISIONS.md #34–42.

| Feature | Where | Verified by |
|---------|-------|-------------|
| Bullet holes on walls/floor/crates, blood splats + pools + spray on characters | `client/js/decals.js` (client-only cosmetics) | `e2e/extras.mjs` (hole/blood counts), screenshots `docs/screenshots/decals_*.jpg` |
| Drop (`G`), pick up (`E`), swap, expiry 60 s, map spawn points respawn 20 s | `server/internal/game/pickups.go`, `client/js/pickups.js`, `pk` message | `pickups_test.go`, `lobby/maps_pickups_test.go`, `e2e/mobile.mjs` (drop + pick up online) |
| Crossroads map: empty four-way intersection, four enterable corner buildings, no vehicles/obstacles; map choice per room and in practice | `tools/assets/gen_crossroads_map.py`, `crossroads_kit.py`, `shared/maps.json`, `MapSet` | `maps_test.go` (BFS: every spawn/pickup mutually reachable), `e2e/extras.mjs`, previews `docs/previews/crossroads_*.jpg`, `docs/screenshots/crossroads_*.jpg` |
| Phone/tablet browser: floating stick, drag-to-look, FIRE/JUMP/R/USE/DROP/SCOPE buttons, weapon list taps, pause button, landscape hint, Graphics Low by default | `client/js/touch.js`, `input.js` touch mode, CSS | `e2e/mobile.mjs` (Chromium touch emulation, 800x360): stick, look, fire (no double fire), slot tap, menu, online drop/use, portrait hint; screenshots `docs/screenshots/mobile_*.jpg` |
| SR-9 sniper (pickup-only, one-shot kill, bolt cycle) + scope (right mouse / SCOPE): FOV 78→14°, sensitivity scaled, overlay, server-side accuracy | `spec.json`, `weapons.go`, `combat.go`, `game.js updateScope`, `sniper.py` | `sniper_test.go` (incl. scoped = 60/60 hits vs hip fire misses; mutation-checked), `e2e/extras.mjs`, `docs/screenshots/{fp_sniper,scope_view,tp_sniper*}.jpg` |

Test status when this was written: `scripts/check.sh` (gofmt, vet, `go test -race ./...`, gitleaks tree + history) all OK, govulncheck skipped (no network);
e2e against a local server: smoke, online, xss, assets, extras, mobile — all checks passed (software GL, Graphics Low except extras/screenshots at High).

**Not verified / limits**
* Touch controls were tested with Chromium touch *emulation*, not on a physical phone (no device here); iOS Safari has no Fullscreen API for pages and was not tested at all.
* No movement slowdown while scoped, and other players do not see who is scoped (not requested).
* Blood and holes are local: two clients see different splat shapes in the same place.
* The Firefox "Permission denied to access object" error reported earlier is still unconfirmed (diagnostics + fallback are in, see git log).

---

# Visual upgrade: inventory, findings, proof of concept (branch `feature/asset-pipeline-poc`)

**Request:** realistic "CS-like" visuals with free assets, no gameplay change, staged. Counter-scope note: we do not use or imitate assets from Counter-Strike or any commercial game (earlier project rule); "realistic tactical-shooter look" is the target.

## 1. Inventory (from the code, not assumed)
* **Engine:** three.js r170 (vendored, no build step), WebGL2 renderer: ACES tone mapping, sRGB, PCF-soft sun shadow (High only), procedural sky → PMREM environment, hemisphere + sun, separate first-person pass. Server is Go; visuals never reach it.
* **Loader pipeline:** `client/js/assets.js` (`GLTFLoader`, `CORE_FILES`/`MODEL_FILES`, `?safeimg=1` `<img>` texture fallback) → `models.js` (`Soldier`: skinned glb, `AnimationMixer` clips `idle/run/hold_*/shoot_*/death`, weapon nodes `w_*`), `game.js` first-person table `FP`, `world.js` (`buildWorld` on `map*.glb`), `pickups.js`, `decals.js`.
* **Assets (all generated by `tools/assets/*.py` with Blender/bpy, 12 glb, 10.7 MB):** character_a/b 7.6k tris (4.9k body), rifle 2.1k, sniper 1.5k, pistol 1.1k, knife 0.4k (+ first-person variants), map 61.7k, map_crossroads 34k. Textures 256–512 px procedural.
* **Fixed by contract (must not change):** hitboxes in `spec.json` (character authored at 1.80 m, torso ≤ 1.45 m, checked by `e2e/assets.mjs`), collision = map JSON boxes (one prop per box), weapon numbers.

## 2. Highest-impact visual problems (from `docs/screenshots/`)
1. **Sky/lighting:** flat procedural blue, no clouds/HDRI, no ambient occlusion or colour grading → everything reads as "CG toy".
2. **Map variety:** every visual is bound to a collision box, so the yard is crates + slabs + containers only; nothing small (barrels, cones, signs, clutter) breaks it up. Floors/walls repeat one texture with visible tiling.
3. **Characters:** uniform team colour, no face/skin, 512 px flat-looking fabric; readable but low fidelity.
4. **Weapons:** good silhouette, small textures (256 px); fine in first person at current size.

## 3. Constraints discovered
* **Free-asset hosts reachable from this sandbox:** only GitHub raw and the npm/PyPI registries. Poly Haven, Kenney, Quaternius, ambientCG and Sketchfab are blocked by the egress proxy, so CC0 packs from those cannot be fetched here (a user can drop files in and follow `docs/ASSET_WORKFLOW.md`). Khronos glTF-Sample-Assets (per-model licences, many CC0) is reachable.
* Downloaded models are not game-ready: the sample bottle is 9 MB (2048² textures, 13.5k tris, pivot at bbox centre) → needed `tools/assets/optimize_glb.sh` (80 KB, 1.46k tris, 512² webp).
* Rigged characters/weapons from random sources do not match our clip names, hitbox or hand slots; they need retargeting work, so they are *not* proposed as drop-ins.

## 4. Manifest + proof of concept (done)
* `client/assets/manifest.json`: id, file, source, license, pivot, scale, expectedSize, materials, animations, fallback, placements. `client/js/props.js` loads it **non-fatally** (own loader instance, per-prop try/catch); a wrong-size file (±5 %) is rejected at load.
* One static prop: CC0 **WaterBottle** ×2 on top of two yard crates (top at 1.4 m, above jump height, so no collision needed). Original generated map untouched; `?noprops=1` disables it.
* `e2e/props.mjs` actual results: **13/13 pass** — loaded, 0.260 m tall (expected 0.26), base at y 1.4000, upright, map/normal/metal-rough/emissive/AO present at 512 px, casts + receives shadows, collision data byte-identical with/without props, +2,928 triangles (61,748 → 64,676), missing glb → skipped and game runs, broken manifest → game runs, no JS errors. Frame time under software GL is too noisy to be meaningful (705 ms without vs 614 ms with); no GPU available, so real-GPU performance is **not measured**.
* Screenshot: `docs/screenshots/prop_waterbottle.png`.

## 5. Proposed next stages (need your go-ahead; nothing below is done)
A. **Environment** (highest impact, no asset risk): real HDRI sky (CC0 — must be supplied, hosts blocked) or better procedural sky with clouds, SSAO/contact shadows on High, colour grading, texture variation on floor/walls (macro noise / decals) — changes `world.js` only.
B. **Map props:** more small CC0 props (barrels, cones, signs) via the manifest, never inside walkable space without matching collision; any new *collision* object is a map-geometry change and stays out of scope.
C. **Weapons:** replace generated weapons only after a candidate passes: node names `body/mag/bolt/slide`, origin at grip, ≤ 3k tris, hands fit `FP` table; generated model remains the fallback.
D. **Characters:** only with a rigged CC0 model retargeted to our clip names and passing the hitbox-fit test; otherwise improve materials on the current model (face/skin, team detail).
