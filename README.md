# Marvel: New York — Cinematic City Forge

An interactive, cinematic 3D recreation of Marvel's New York. Fly over a Manhattan built from the city's real
building footprints, restyle the light and weather, find Spider-Man on a rooftop and Doctor Strange on his coffee
break, and export wallpapers up to 8K.

![Golden hour](docs/img/skyline.jpg)

## Run it

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm run preview` | Type-check + production bundle, then serve it |
| `npm test` | Unit tests (generation determinism, atmosphere, geography, export sizes) |
| `npm run typecheck` | TypeScript only |
| `npm run fetch-geo` | Re-download & re-bake the NYC Open Data layers into `public/data/` (optional; baked data is committed) |
| `npm run shots -- <shot…>` | Headless visual-validation screenshots (needs Google Chrome; dev server must be running) |

Requirements: Node 20+, a WebGL2 browser (Chrome / Edge / Safari / Firefox, desktop). Developed on Apple-silicon.

## Using it

* **Orbit** (default): left-drag rotate · right-drag / shift-drag pan · wheel zoom · double-click to set the pivot.
* **Free fly** (`F`): `W A S D` move · `Q`/`E` down/up · drag to look · `Shift` fast · wheel changes speed.
* **Bookmarks** (`1`–`9`, bottom bar): curated cinematic views. *Match light* also applies the look composed for that view.
* **Presets tab**: complete looks (MCU Golden Hour, Avengers at Sunset, Blue Hour, Midnight, Rainy Manhattan, Snowy New York,
  Spider-Man Rooftop, Sanctum Coffee Shop, Foggy Morning, Overcast Day). Save / load / copy / import your own.
* **Photography Mode** (`P`): aspect masks, composition guides, lens & exposure, preview, capture (`C`). `H` hides everything.
* **Sliders**: city generation (height, density, skyline & architectural variation, detail, seed), environment, light & colour,
  Marvel content, photography, performance. City-generation changes regenerate the streamed chunks in place;
  landmarks, the street grid and buildings that carry signage never move.

Export sizes: 1080p, 1440p, 4K, 3440×1440, 5120×2160, 5K, and 8K (experimental — needs roughly 2 GB of free GPU memory;
the app falls back with a message if the GPU refuses).

## What is real and what is procedural

* **Real** (NYC Open Data, baked by `scripts/fetch-geo.mjs`): 49,581 building footprints with surveyed roof heights and
  construction years, the shoreline of all five boroughs, 26,384 street centre-line segments with kerb widths, 557 parks.
* **Procedural**: everything architectural — family and style per building (district-, era- and height-aware), setbacks,
  crowns, façades (a shader with parallax-recessed windows and interior mapping), rooftop kit, fire escapes, stoops, awnings,
  street furniture, traffic, the New Jersey bank and far-field skyline, weather, sky and lighting.
* **Bespoke**: Avengers Tower, Sanctum Sanctorum and its coffee shop, Baxter Building, Daily Bugle, the Spider-Man perch,
  plus parametric Empire State and Chrysler buildings.

See `docs/architecture.md`, `docs/progress.md` (status, known limitations, next steps) and `docs/asset-sources.md`.

## Honest limitations

* The three hero figures are an *original costume shader painted on a posed mannequin* (Mixamo X Bot), not film-accurate
  character models. They read well at the composed distances; close-ups — Doctor Strange's face in particular — look stylised.
* New Jersey's shoreline and street grid are hand-traced / synthetic (the open data stops at the state line).
* Terrain is flat; the four East River bridges are simplified; glass reflects the sky and a ground-plane mirror, not neighbouring towers.

This is an unofficial fan project. Marvel, Avengers, Spider-Man, Doctor Strange and related names are trademarks of
Marvel Characters, Inc.; no Marvel artwork, models, logos or footage are included.
