# Importing a third-party 3D asset

The game has two asset sources. **Generated** assets (`tools/assets/*.py` → `client/assets/models/*.glb`, loaded by
`client/js/assets.js`) are the core visuals and the fallback for everything. **Imported props** (this document) are optional
extras described in `client/assets/manifest.json` and loaded by `client/js/props.js`; if one fails, it is skipped and the
generated map is unchanged. Imported props are visual only: no collision, no gameplay data.

## Rules

* glTF 2.0 / `.glb`, metal-roughness PBR. Free licences only (CC0 preferred; CC-BY needs credit in `ASSETS.md`). No assets from commercial games.
* Do not assume a download is game-ready: check scale, pivot, orientation, triangle count, texture size, whether it is rigged.
* Budgets: static prop ≤ 3k triangles, textures ≤ 1024 px (512 for small props), file ≤ 500 KB, total assets ≤ 20 MB.
* Never change hitboxes, collision, map geometry, weapon numbers or spawn data to fit an asset.

## Steps

1. **Pick and record.** Create `client/assets/third_party/<id>/LICENSE.md` (copy of the author's licence text) and `SOURCE.md` (URL, author, original size + sha256, what you changed). Do not commit the unoptimized original.
2. **Inspect.** `npx @gltf-transform/cli inspect in.glb` → bounding box (scale + pivot), triangles, textures, extensions, skins/animations.
3. **Optimize.** `tools/assets/optimize_glb.sh in.glb client/assets/models/props/<id>.glb [tex_px] [simplify_ratio]` (weld, simplify, resize, webp). Compare before/after; look at it.
   webp textures need `EXT_texture_webp` (all current browsers); if you must support older ones, keep PNG/JPEG instead.
4. **Describe it** in `client/assets/manifest.json`: `id`, `file`, `source`, `license`, `licenseFile`, `pivot` (`bottom-center` = loader moves the bottom to the placement's y), `scale`, `expectedSize` (metres, ±5 % checked at load: a wrong-scale file is skipped, not shown at the wrong size), `materials`, `animations`, `fallback`, `placements` (`map`, `pos`, `yaw`).
   Place props only where the player cannot be inside or on them (e.g. on a crate top above jump height) because they have no collision.
5. **Validate.** `cd e2e && node props.mjs docs/screenshots` — checks load, scale, pivot, orientation, maps, shadows, render cost, collision data unchanged, and the fallback paths (missing glb, broken manifest, `?noprops=1`). Add the file to the table in `ASSETS.md`.
6. **Weapons / characters later:** these are not props. They go through `assets.js` + `models.js` (skinned, named nodes `slide`/`mag`/`bolt`, hold/shoot clips) and keep the generated model as fallback until the replacement passes `e2e/assets.mjs` (hitbox fit, budgets).
