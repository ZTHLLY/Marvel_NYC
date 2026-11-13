# Architecture

Stack: Vite · TypeScript (strict) · React 19 (UI only) · zustand · three.js r180 · `postprocessing` · `n8ao`.

**Deviation from the suggested stack:** the 3D world is an imperative three.js engine, not React Three Fiber.
Chunk streaming, time-sliced generation, a mirrored reflection pass and an off-cadence high-resolution capture path are
simpler and faster without a reconciler in the loop. React renders only the editor chrome and talks to the engine
through the zustand store (state) and a tiny typed event bus (commands).

## World coordinates
Metres. `+X` east, `+Z` south (north is `-Z`), `+Y` up. Origin = 200 Park Avenue (40.7527 N, 73.9772 W).
`src/city/geo.ts` also exposes Manhattan grid coordinates (`streetOf`, `aveOf`, `gridToWorld`; grid rotated 28.9°).

## Module map
| Path | Responsibility |
| --- | --- |
| `scripts/fetch-geo.mjs` | Reproducible pipeline: NYC Open Data → `public/data/buildings.bin` + `city.json` (cached in `data-cache/`) |
| `src/state/params.ts` | The `Params` model, `CONTROL_SCHEMA` (drives every UI control), quality / weather presets, solar model |
| `src/state/store.ts` | zustand store, persistence (localStorage), import sanitising, UI→engine command bus |
| `src/state/presets.ts` | Cinematic bookmarks and scene presets |
| `src/engine/Engine.ts` | Renderer, frame loop, parameter application, adaptive shadow frustum, loading sequence |
| `src/engine/atmosphere.ts` | `computeAtmosphere(params)` (pure) → sun/moon, sky, fog, ambient; sky dome shader; PMREM environment bake |
| `src/engine/materials.ts` | Shared uniforms; `extendMaterial()` injects height fog, weather response and HDR clamping into three materials |
| `src/engine/post.ts` | HDR composer: N8AO → bloom → depth of field → AgX grade (exposure, contrast, saturation, split-tone, vignette, grain) → SMAA |
| `src/engine/shadows.ts` | Cascaded sun shadows: three camera-centred cascades + the whole-view far map; injects three's CSM light chunks; `csmUniforms` / `csmDefines` are added to every material by `extendMaterial` |
| `src/engine/reflection.ts` | Planar mirror of the world about y = 0, sampled by rivers and wet streets |
| (in `atmosphere.ts` / `Engine.ts`) | Local reflection probe: when the view settles, the IBL environment is re-baked from the real city around the camera (≥ Texture Quality 2), so glass reflects the skyline band and lit windows rather than bare sky |
| `src/engine/cameraRig.ts` | Damped orbit + free-fly camera, eased bookmark transitions, manual pose |
| `src/city/facade.ts` | Style palette (12 families × 48 variants in a float texture) and the façade shader |
| `src/city/buildingGen.ts` | `planBuilding` (family, style, height, setbacks, crown) · `emitMass` · `emitDetail` |
| `src/city/meshBuilder.ts` | Growable merged-geometry builder + polygon helpers (inset, OBB) |
| `src/city/chunks.ts` | 400 m spatial chunks: nearest-first streaming, disposal, near-camera detail layer, in-place regeneration |
| `src/city/sidewalks.ts`, `streets.ts`, `trees.ts`, `instLod.ts` | Phase 2 street layer: raised sidewalk slabs and kerbs, road surface shader, tree geometry / shader, instanced LOD helper |
| `src/world/cars.ts`, `furniture.ts` | Car body types and street furniture used by `props.ts` |
| `src/city/ground.ts` | Land, seawalls, water shader, parks, road ribbons (markings, crossings, lamp pools, wet/snow), trees, raster grid |
| `src/landmarks/*` | Bespoke buildings and the sign/loft toolkit |
| `src/world/*` | Outer boroughs / New Jersey / far skyline (instanced), street props & traffic, billboards & easter eggs, weather particles |
| `src/photo/capture.ts` | High-quality still path |
| `src/ui/*` | Editor chrome (panel generated from `CONTROL_SCHEMA`), photography mode, overlays |
| `tools/shots.mjs` | Headless-Chrome visual validation harness |

## Levels of detail
* **A – hero**: bespoke geometry (landmarks, Sanctum street, rooftop tower).
* **B – Manhattan core** (tier 0, ≈ Canal St → 66th St, river to river, ≈ 23 km²): real footprints, full family rules,
  setbacks & crowns; within the detail radius a second mesh adds copings, cornices, water tanks, HVAC, fire escapes,
  stoops, awnings, balconies; street props and traffic tiles appear within ~1.1 km.
* **C – rest of Manhattan + tall buildings of Brooklyn / Queens / Bronx**: real footprints, mass only.
  Low-rise fabric of the boroughs: instanced boxes that line the real street centre-lines.
* **D – New Jersey and far field**: synthetic grid and skyline clusters (instanced), melted into height fog.

All levels share one façade shader, so the city is visually continuous. Window patterns fade analytically to their mean
coverage per axis as they minify (floor bands outlive bays), which avoids moiré and popping.

## Façade shader
Per-vertex: wall UV in metres (snapped so each wall holds whole bays), a style row, a per-building seed and the tier top.
The shader draws masonry/metal/curtain-wall materials, parallax-recessed windows with reveals, frames and mullions,
interior-mapped rooms with blinds and furniture, lit windows (per-floor coherence for offices), storefronts and signs,
crown up-lighting, snow on ledges/roofs and wetness. Glass panes get a small random tilt so the low sun breaks into glints.

## Parameter flow
`store.params` → `Engine.applyParams` → (a) uniforms/lights immediately, (b) sky/IBL re-bake throttled to 140 ms,
(c) city regeneration debounced 280 ms and rebuilt nearest-first with old meshes kept until replaced.
Scene presets never touch generation or performance keys.

## Capture path
`capturePhoto` raises the detail radius, waits for streaming, switches to an 8192² shadow map, MSAA ×4 + high AO,
renders at the exact output size (matching the on-screen crop), encodes PNG, then restores interactive settings.

## Performance notes
~9–13 M triangles/frame including shadow and reflection passes; 12–17 ms/frame at 1600×900 on High in headless Chrome
on an Apple M5. Shadow map updates only when the light or focus region changes. Rendering drops to a slow cadence when idle.
`Low` disables shadows and reflections and shortens the render distance (≈5 ms/frame).

## Phase 2 notes
* **No characters.** `src/characters/` and the GLB are gone; `closeTargets` now only protects the rooftop parapet and tower deck from near-plane clipping.
* **Every lit material must be created through `extendMaterial()` / `pbr()`.** The sun is four directional lights (one per cascade);
  a raw `MeshStandardMaterial` would add all four. `Engine.adoptStrayMaterials()` patches any stragglers after load and warns in dev.
* **Façade shader relief**: each branch writes a height in metres to `hgt`; one `forgeBump()` call after the branches turns it into a normal.
  Fine detail fades with `fine` / `mid` (metres per pixel) so nothing shimmers at distance. `Surf.Painted = 10` was added for sidewalk sheds.
* **Sign atlas**: `makeSignAtlas()` draws 32 shop names into a canvas (4 × 8 cells) sampled by the storefront branch; in a DOM-less test run it is a 1×1 texture.
* **Eye adaptation**: `Post.setCameraExposure()` is driven from `Engine.renderFrame` by camera altitude, daylight only.
* **Sidewalk height**: `CURB_H` in `city/geo.ts`; anything standing on a sidewalk sits at that height, roads stay at 0.05.
