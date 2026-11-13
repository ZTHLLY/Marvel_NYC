# Implementation plan (as executed)

1. **Research & planning** — reference images studied; data sources probed (Overpass unavailable → NYC Open Data); world bounds fixed.
2. **3D foundation** — Vite/TS scaffold, engine loop, sky/IBL, fog, camera rig, HDR post chain.
3. **City scale** — geo pipeline, chunk streaming, real-footprint massing, ground/roads/water/parks, outer boroughs, NJ, far field.
4. **Architectural quality** — 12 families, style palette, façade shader (parallax, interiors), setbacks/crowns, detail layer.
5. **Marvel landmarks** — Avengers Tower, Sanctum + coffee shop, Baxter, Bugle, perch tower; Empire State & Chrysler; billboards/easter eggs.
6. **Cinematic rendering** — golden/blue hour, midnight, rain (planar reflections, streaks), snow, fog, overcast; AgX grade.
7. **Static characters** — mannequin posing system; Spider-Man, Doctor Strange, Iron Man.
8. **Controls** — schema-driven panel, presets, bookmarks, persistence.
9. **Photography** — photo mode, guides, aspect masks, HQ capture to 8K.
10. **Refinement** — screenshot-driven passes (see `docs/progress.md`).

## Phase 2 (as executed)

1. **P0** — remove the three character figures and their pipeline; keep the locations; migrate old settings.
2. **P1** — façade shader overhaul, rooftop plant, sidewalk sheds; raised sidewalks, roads, cars, trees, street furniture.
3. **P2** — cascaded shadows, golden-hour / night light, landmark rebuilds (Sanctum, Avengers Tower, ESB, Chrysler, rooftop tower, Brooklyn Bridge).
4. **P3** — bookmarks and presets re-composed, before/after frames, performance comparison, documentation.

Next steps live in `docs/progress.md`.
