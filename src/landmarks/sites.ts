import { ll, gridToWorld } from '../city/geo';

/** World-space anchor points (x, z) for landmarks. These never move when city parameters change. */
export interface Site {
  id: string;
  name: string;
  x: number;
  z: number;
  /** radius (m) inside which real building footprints are cleared for the bespoke model */
  clear: number;
  /** grid-aligned rectangle half extents for clearing instead of a circle (along street / along avenue) */
  marvel: boolean;
  blurb: string;
  /** suggested orbit distance & height for Landmark Focus */
  focus: { dist: number; height: number; lookY: number };
}

const at = (lat: number, lon: number) => { const [x, z] = ll(lat, lon); return { x, z }; };

export const SITES: Record<string, Site> = {
  avengers: { id: 'avengers', name: 'Avengers Tower', ...at(40.75336, -73.97675), clear: 62, marvel: true,
    blurb: '200 Park Avenue — Stark Tower, rebuilt as Avengers headquarters above Grand Central.', focus: { dist: 520, height: 330, lookY: 250 } },
  sanctum: { id: 'sanctum', name: 'Sanctum Sanctorum', ...at(40.72908, -74.00052), clear: 17, marvel: true,
    blurb: '177A Bleecker Street, Greenwich Village — residence of the Sorcerer Supreme.', focus: { dist: 46, height: 16, lookY: 10 } },
  baxter: { id: 'baxter', name: 'Baxter Building', ...at(40.75247, -73.98005), clear: 30, marvel: true,
    blurb: '42nd & Madison — headquarters of the Fantastic Four.', focus: { dist: 330, height: 200, lookY: 140 } },
  bugle: { id: 'bugle', name: 'Daily Bugle', ...at(40.74748, -73.97262), clear: 30, marvel: true,
    blurb: '39th & Second — New York\'s loudest newspaper.', focus: { dist: 240, height: 150, lookY: 110 } },
  spidey: { id: 'spidey', name: 'Spider-Man Rooftop', ...at(40.74495, -73.98715), clear: 22, marvel: true,
    blurb: 'A quiet perch below the Empire State Building.', focus: { dist: 30, height: 135, lookY: 128 } },
  empire: { id: 'empire', name: 'Empire State Building', ...at(40.74843, -73.98566), clear: 70, marvel: false,
    blurb: '350 Fifth Avenue.', focus: { dist: 600, height: 380, lookY: 260 } },
  chrysler: { id: 'chrysler', name: 'Chrysler Building', ...at(40.75162, -73.97546), clear: 36, marvel: false,
    blurb: '405 Lexington Avenue.', focus: { dist: 380, height: 300, lookY: 220 } },
  timessquare: { id: 'timessquare', name: 'Times Square', ...at(40.75800, -73.98553), clear: 0, marvel: false,
    blurb: 'Broadway & Seventh.', focus: { dist: 160, height: 40, lookY: 22 } },
};

export const MARVEL_SITE_IDS = ['avengers', 'sanctum', 'baxter', 'bugle', 'spidey'];
export { gridToWorld };
