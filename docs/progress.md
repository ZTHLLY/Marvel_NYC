# Progress & continuation notes

_Last updated: 2026-11-13 (end of Phase 2)._ A replacement engineer/agent should read this file, then `docs/architecture.md`.
The brief for each phase is kept privately by the author and is not part of the repository.

## Phase 2 — visual fidelity overhaul (environment art pass)

### What changed
| Area | Change | Where |
| --- | --- | --- |
| P0 characters | Spider-Man / Doctor Strange / Iron Man figures, the Mixamo X Bot GLB, costume shaders, pose helpers, visibility + placement controls all removed. Rooftop, Sanctum street and tower deck kept as architectural scenes. Old saves: removed keys are dropped by `sanitizeParams`; `spidey` ids alias to `rooftop` (`LEGACY_IDS`). | `src/characters/` deleted, `state/*`, `world/index.ts` |
| Façades | Bump-mapped brick (running bond, mortar, burnt headers), limestone ashlar, concrete pour lines, metal panels, brownstone; rain-wash and soot streaks; stone lintels / sills / drip stains; cornice frieze with dentils; plinth course; sash windows with meeting rails; roller shades, drapes and venetian blinds; glass that mirrors ~15 % of the sky; deep interior-mapped shops with shelving and strip lights; lettered fascia signs from a canvas atlas (32 names); per-building night activity, tenant blocks of floors, wider colour-temperature range | `city/facade.ts` |
| Rooftops | Roll-roofing seams, repair patches, ponding, gravel; cooling towers on dunnage, window-washing rigs with tracks, vent stacks, on top of the existing tanks / bulkheads / HVAC | `city/facade.ts`, `city/buildingGen.ts` |
| Street level | Raised sidewalk slabs with granite kerbs (`CURB_H` = 0.15 m), re-drawn asphalt and markings, four car body types with lamps, trees with trunks / limbs / leaf cards and a bare winter state, lamp posts, signals, street-name blades, hydrants and other furniture, sidewalk sheds | `city/sidewalks.ts`, `city/streets.ts`, `city/trees.ts`, `city/instLod.ts`, `world/cars.ts`, `world/furniture.ts`, `world/props.ts`, `city/buildingGen.ts` |
| Landmarks | Sanctum rebuilt (rusticated base, portico, moulded surrounds, mansard with dormers and chimneys, deep round window, real coffee-shop front); Avengers Tower deck / fins / bands; Empire State mast and tiers; Chrysler crown; rooftop tower roofscape (hooped tank, bulkhead, plant, railings); Brooklyn Bridge arches and cable web | `landmarks/*`, `world/bridges.ts` |
| Light | Four-cascade sun shadows (three camera-centred cascades + the Phase 1 whole-view map); cooler shade and warmer key at low sun; tighter sky gradient; eye adaptation at street level in daylight; restrained night window gain | `engine/shadows.ts`, `engine/atmosphere.ts`, `engine/post.ts`, `engine/Engine.ts` |
| Cameras | 14 bookmarks and 12 scene presets renamed and re-composed around architecture | `state/presets.ts`, `world/index.ts` |

### Verification actually performed (2026-11-13)
* `npm run typecheck`, `npm test` (15 tests), `npm run build` — passing.
* Headless Chrome, real GPU (`tools/shots.mjs`), frames **rendered and looked at** before/after: golden-hour Midtown aerial,
  East River sunset, Midtown night, Avengers Tower (hero, plus street view), Sanctum / Bleecker Street, brick façade at ~15 m,
  village street, rooftop panorama, rainy Times Square (wide + storefront close-up), blue-hour riverfront, snow, Hudson,
  42nd Street at eye level, afternoon shadow tests, editor UI. Phase 1 frames are in `docs/img/phase1/`; the working
  before/after sets live in the git-ignored `shots/` folder (`baseline/`, `final/`).
* 4K export through the real capture path: "Saved 3840 × 2160 · 16.2 MB".
* Observed improvements: brick, stone trim and window structure read correctly up close; shop signs are legible; kerbs are raised;
  near shadows are crisp; golden hour has warm lit faces against cool shade and a visible sky gradient; night has dark and busy
  buildings instead of uniform speckle; the Sanctum and the rooftop are now credible hero locations.
* **Not verified**: Safari / Firefox / Windows GPUs; real-display HiDPI; 8K export in this phase; Low / Medium looked at
  (the no-shadow path only ran without errors); long sessions (memory growth); the three non-Brooklyn bridges and the water
  shader in every preset; hot-reload of every slider against the new street layer.

### Performance (same machine, headless Chrome + ANGLE/Metal, 1600×900, High; `node tools/perf.mjs`, median of 40 frames)
| View | Phase 1 travelling | Phase 2 travelling | Phase 2 resting |
| --- | --- | --- | --- |
| East River skyline | 8.6 ms | 15.3 ms | 5.2 ms |
| High-altitude overview | 24.5 ms | 41.8 ms | 15.0 ms |
| Rainy Times Square | 16.6 ms | 23.9 ms | 4.8 ms |
| Rooftop | 21.3 ms | 34.8 ms | 7.8 ms |
| Sanctum street | 15.0 ms | 27.5 ms | 5.7 ms |
| Golden Hour Midtown (new) | — | 32.2 ms | 6.4 ms |
| 42nd Street (new) | — | 22.0 ms | 5.4 ms |

"Travelling" moves the camera 1.2 m per frame. Phase 2 is 1.5–1.8× slower in motion: a heavier façade shader, more draw
calls at street level (sidewalks, trees, furniture) and the cascade refreshes. Adaptive resolution still protects navigation;
Low / Medium remain available. No other hardware was measured.

### Remaining visual limitations (honest list)
* Cars are simple low-poly bodies; tree leaves are alpha cards and look like flakes when the camera is within ~10 m.
* Daylight street canyons are strongly blue in open shade; shadows on roofs at very low sun are still soft; cascade
  boundaries switch abruptly rather than blend.
* The Times Square bookmark shows a dark overhead slab on the right (a billboard structure seen edge-on) that was not chased down.
* Outer boroughs, New Jersey and the far field are unchanged instanced boxes; no new real landmarks (432 Park, Citigroup,
  Flatiron, One WTC) were added.
* Shop interiors and signs are generic; sign text is picked at random per bay.
* Glass still reflects a single probe; no SSR. Terrain is flat.
* The two art-pass sub-agents' own written reports were not captured; their work was judged from the rendered frames listed above.

### Next recommended actions
1. Claw back frame time: skip façade bump / weathering beyond a distance, merge street-furniture draw calls, refresh the far cascade less often.
2. Better car meshes and denser leaf geometry for close-ups; blend cascade boundaries.
3. Bespoke 432 Park, Citigroup, One Vanderbilt, Flatiron; richer outer-borough fabric.
4. Screen-space reflections for wet streets and glass; warmer bounce light in canyons.
5. Cross-browser pass and a memory soak test.

### Commands
`npm run dev` · `npm run build` · `npm test` · `node tools/perf.mjs` ·
`node tools/shots.mjs --out shots/x golden-midtown:golden-midtown:golden "name@x,y,z@tx,ty,tz@fov:preset:{json}"`
(dev server must be running; append `+ui` to a shot name to include the interface; `?fresh=1` ignores saved settings).
If the dev server answers 504 "Outdated Optimize Dep", restart it with `npx vite --force`.

---

# Phase 1 record (historical — figures and screenshots below describe the pre-Phase-2 build)

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
