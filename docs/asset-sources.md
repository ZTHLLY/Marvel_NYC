# Third-party data & assets

| Asset | Source | Licence / terms | Use |
| --- | --- | --- | --- |
| Building Footprints (`5zhs-2jue`) | NYC Open Data — https://data.cityofnewyork.us | NYC Open Data Terms of Use (public, free to use) | Footprints, roof heights, construction years |
| Borough Boundaries (`gthc-hcne`) | NYC Open Data | same | Shorelines / land polygons |
| Centerline / CSCL (`inkn-q76z`) | NYC Open Data | same | Street geometry, kerb-to-kerb widths |
| Parks Properties (`enfh-gkve`) | NYC Open Data | same | Park polygons |
| `public/models/Xbot.glb` | three.js examples (`examples/models/gltf/Xbot.glb`), originally Adobe Mixamo "X Bot" | Mixamo characters are royalty-free for use in projects (Adobe Mixamo FAQ); not to be redistributed as a standalone asset | Rig + body for the three static figures |
| `public/fonts/helvetiker_bold.typeface.json` | three.js examples | MIT (three.js) / MgOpen-derived | Reserved for 3D lettering (not currently loaded) |
| Oswald, Inter (via `@fontsource`) | Fontsource | SIL Open Font License 1.1 | UI typography |
| three.js, postprocessing, n8ao, zustand, React, Vite, earcut | npm | MIT / ISC (n8ao: CC0) | Code |

Reference photographs in `reference/` (Unsplash / Pexels) were studied for palette, density and lighting only; none is used as a texture.

**Publishing note:** the project has only been run locally. Before deploying it publicly, confirm that redistributing `Xbot.glb` inside a web build is covered by Mixamo's licence for your use, or replace it with a CC0 humanoid rig that uses the same `mixamorig` bone names.

No Marvel artwork, logos, models or footage are included. All signage, emblems, costumes and buildings are original
interpretations created in code; in-universe names appear as text only. OpenStreetMap was evaluated (Overpass was at
capacity during development) and is not used, so no ODbL attribution is required.
