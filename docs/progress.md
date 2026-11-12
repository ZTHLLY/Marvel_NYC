# Progress & continuation notes

_Last updated: 2026-11-13._ A replacement engineer/agent should read this file, then `docs/architecture.md`.

## Status by milestone
| # | Milestone | Status |
| --- | --- | --- |
| 1 | Research & planning | Done — references studied; NYC Open Data chosen (Overpass was at capacity) |
| 2 | 3D foundation | Done |
| 3 | City scale | Done — 49.6k real footprints (21k in the ≈23 km² core), boroughs, NJ, far field, rivers, 4 bridges |
| 4 | Architectural quality | Done to a good level — see limitations |
| 5 | Marvel landmarks | Done — Avengers Tower, Sanctum (+ coffee shop), Baxter, Bugle, easter-egg signage |
| 6 | Cinematic rendering | Done — 10 looks incl. all 7 required environments |
| 7 | Static characters | Done with a documented quality caveat (mannequin-based) |
| 8 | Interactive controls | Done — 43 schema-driven controls, presets, persistence, import/export |
| 9 | Photography mode | Done — up to 8K verified |
| 10 | Visual refinement | Several screenshot-driven passes done; more is always possible (below) |

## Verification actually performed
* `npm run typecheck`, `npm run build`, `npm test` (15 tests) — passing.
* Headless Chrome with the real GPU (`tools/shots.mjs`, ANGLE/Metal, Apple M5) — rendered **and looked at**:
  high-altitude overview · skyline across the East River · Hudson waterfront · Avengers Tower hero shot · Midtown streets
  (Park Ave, Madison Sq, Village) · Spider-Man rooftop · Doctor Strange / Sanctum · golden hour · blue hour · midnight ·
  rainy Times Square · snow (aerial + street) · fog · overcast · bridges · UI (panel, photo mode, help).
* Slider contact sheet: height, density (low/high), skyline variation (0/1), architectural variation, seed, fog, overcast,
  snow, Marvel visibility — every one visibly changes the frame; landmarks stay put.
* Export: preview, 3840×2160 (0.7 s, 14.7 MB PNG) and 7680×4320 (55 MB PNG) produced; renderer state restored afterwards.
* Frame time (1600×900, headless): High 12–17 ms, Medium 10 ms, Low 5 ms.
* Not verified: Safari / Firefox / Windows GPUs; real-display HiDPI behaviour; long interactive sessions (memory growth).

## Measured on the development machine (Apple M5, headless Chrome + ANGLE/Metal, 1600×900)
| Scenario | Result |
| --- | --- |
| Frame time, High — skyline / whole-island overview / street level | 12 ms / 17 ms / 12.5 ms |
| Frame time, Medium / Low (skyline) | 10 ms / 5 ms |
| Retina-like 1470×956 @2x (2205×1434 rendered) — High: skyline / overview / street / rooftop | 9.5 / 21.6 / 15.2 / 17.3 ms |
| Same — Ultra skyline (2940×1912) · Medium skyline / street | 20 ms · 6.3 / 10.4 ms |
| Full-city regeneration after a seed change | ≈ 1.2 s, progressive, old meshes stay until replaced |
| Initial load to interactive (local dev server) | 1–4 s |
| Export 3840×2160 | 0.5–0.7 s, 14 MB PNG |
| Export 7680×4320 | succeeded, 53–55 MB PNG |
| Leak check (4 seed regenerations + height/density + reset + fly-away/return) | geometry count stable (673 → 678), JS heap returns to baseline |
| Interaction test (focus, fly keys, manual pose, wheel, drag, hero toggles, preset save/load/import) | all pass (scripted via `tools/shots.mjs --eval`) |

Independent reviews (sub-agents that did not write the code): code review **APPROVE** (medium findings fixed), security review
**APPROVE** after fixes, acceptance verification **APPROVE** (19 PASS, 2 PARTIAL: Doctor Strange's likeness, cross-device performance).

## Research notes (spec §2.1)
* Local references: aerial Midtown (density, haze, tree-lined canyons), sunset skyline (orange→violet gradient, silhouettes), rainy Times Square (neon on wet asphalt).
* Avengers Tower: in the films the tower stands on the MetLife / Pan Am site at 200 Park Avenue — the lower floors echo that slab while the upper tower is a fictional swept form with an aircraft deck and the "A" mark. Our version keeps that logic with an original silhouette. Sources: en.wikipedia.org/wiki/Stark_Tower, mculocationscout.com (Stark/Avengers Tower).
* Sanctum Sanctorum: 177A Bleecker Street, Greenwich Village; a three-storey townhouse whose great round "Window of the Worlds" (reported ≈14 ft across) carries the Seal of the Vishanti. Ours: three storeys + mansard, 4.6 m round window with an original leaded pattern. Sources: en.wikipedia.org/wiki/Sanctum_Sanctorum_(Marvel_Comics), marvel.fandom.com/wiki/Sanctum_Sanctorum.
* Baxter Building (42nd & Madison) and Daily Bugle (39th & Second) follow their comics addresses; MCU continuity has no canonical exterior for either, so both are original designs.
* Geography: NYC Open Data (see `docs/asset-sources.md`). OpenStreetMap/Overpass was attempted first and was at capacity.

## Bugs found and fixed during validation (keep in mind)
* Mirror-like sun glints overflowed half-float → `Inf` → bloom turned the whole frame black at certain sun angles.
  Fixed by clamping radiance in `extendMaterial` (and sky/water). Any new custom shader must clamp too.
* `postprocessing` passes toggled via `enabled` need explicit `renderToScreen` management (`post.ts`).
* `Object3D.getWorldDirection` needs `updateMatrixWorld()` first after setting a pose (`cameraRig.ts`).

## Known limitations (honest list)
* **Characters**: procedural costumes on the (re-proportioned) Mixamo X Bot mannequin. Spider-Man reads well (masked, suit-only). Doctor Strange
  is recognisable (cloak, collar, amulet, robe, coffee, sculpted hair / goatee) but his face is a stylised caricature, not a likeness. Iron Man is the weakest
  (smooth mannequin body, no armour plating geometry). No licensed film-accurate models were available.
* **Avengers Tower / Baxter / Bugle** are original interpretations, not replicas of any film asset.
* **Glass** reflects a single local environment probe (baked at the camera's position, min. 120 m up) plus the ground-plane mirror — plausible, not exact; no screen-space or ray-traced reflections.
* **Streets**: traffic signals, lamps, parked/queued cars and shop signage exist, but there are no street-name signs, scaffolding or pedestrians; cars are simple; kerbs are painted, not raised.
* **Terrain** is flat. **Bridges** are simplified; tower coordinates are approximate.
* **New Jersey** shoreline is hand-traced; its streets/buildings are synthetic. Waterfront lots without streets stay empty.
* Setbacks are procedural: a real tower's exact massing is not reproduced except for the Empire State and Chrysler buildings.
* Hiding Marvel landmarks leaves their lots empty (the real buildings there were cleared for them).
* Trees are stylised clumps; parks have no paths/furniture geometry.
* Full-city views draw 9–17 M triangles; integrated GPUs should use Low/Medium.
* **Before any public release**: re-check Adobe Mixamo's terms for shipping `public/models/Xbot.glb` (or swap in a CC0 rig — only bone names matter to `mannequin.ts`), and note this is an unofficial fan work using Marvel names.
* No CSP meta tag; `window.__forge` automation hook exists only in dev or with `?forge`.

## Next recommended actions (highest visual value first)
1. Replace the mannequin with properly licensed, sculpted character meshes (or sculpt armour/hair/face geometry).
2. Screen-space reflections (or several blended probes) for accurate inter-building reflections at street level.
3. Street dressing: street signs, scaffolding, static pedestrians, raised kerbs, richer car models.
4. Real massing for more icons (One WTC, Hudson Yards, 432 Park, Citigroup, Flatiron) and richer Art-Deco crowns.
5. Cascaded shadows for crisper street-level shadows inside wide shots.
6. Worker-thread chunk generation to remove the brief hitch when regenerating the whole city.
7. Cross-browser pass (Safari/Firefox), and a memory soak test.

## Commands
`npm run dev` · `npm run build` · `npm test` · `npm run fetch-geo` ·
`node tools/shots.mjs --w 1400 --h 800 skyline avengers:avengers:avengers "name@x,y,z@tx,ty,tz@fov:preset:{json}"`
(the dev server must be running; append `+ui` to a shot name to include the interface). `?fresh=1` ignores saved settings.
