import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import type { CityData } from '../city/geo';
import type { GroundBuild } from '../city/ground';
import type { Params } from '../state/params';
import type { AtmoState } from '../engine/atmosphere';
import { BOOKMARKS } from '../state/presets';
import { buildAvengersTower, buildBaxter, buildBugle, buildChrysler, buildEmpireState, buildPerchTower, Anchor } from '../landmarks/towers';
import { buildSanctum, SanctumBuild } from '../landmarks/sanctum';
import { buildDoctorStrange, buildIronMan, buildSpiderMan, Hero } from '../characters/heroes';
import { OuterCity } from './outer';
import { StreetProps } from './props';
import { WeatherFx } from './fx';
import { Billboards } from './billboards';
import { buildBridges } from './bridges';
import { SITES } from '../landmarks/sites';
import { CROSSTOWN, UPTOWN } from '../city/geo';
import { yawFacing } from '../landmarks/kit';

/** Everything in the world that is not the streamed real-footprint city: landmarks, heroes, outer boroughs, props, weather FX. */
export interface WorldExtras {
  group: THREE.Group;
  clearZones: { x: number; z: number; r: number }[];
  apply(p: Params, a: AtmoState, prev: Params | null): void;
  regenerate(p: Params): void;
  update(dt: number, now: number, camera: THREE.PerspectiveCamera): void;
  dispose(): void;
}

function setBookmark(id: string, pos: THREE.Vector3, target: THREE.Vector3, fov?: number) {
  const b = BOOKMARKS.find((x) => x.id === id);
  if (!b) return;
  b.pos = [pos.x, pos.y, pos.z]; b.target = [target.x, target.y, target.z];
  if (fov) b.fov = fov;
}

function place(h: Hero, a: Anchor) { h.group.position.copy(a.pos); h.group.rotation.y = a.yaw; h.group.updateMatrixWorld(true); }

export async function buildWorldExtras(engine: Engine, data: CityData, ground: GroundBuild): Promise<WorldExtras> {
  const group = new THREE.Group();
  group.name = 'extras';
  engine.scene.add(group);
  const palette = engine.palette;

  // ---- landmarks
  const marvelGroup = new THREE.Group(); marvelGroup.name = 'marvel-landmarks';
  const avengers = buildAvengersTower(palette);
  const baxter = buildBaxter(palette);
  const bugle = await buildBugle(palette);
  const sanctum: SanctumBuild = buildSanctum(palette, data);
  marvelGroup.add(avengers.group, baxter, bugle, sanctum.group);
  const perch = buildPerchTower(palette);
  group.add(marvelGroup, perch.group, buildEmpireState(palette), buildChrysler(palette), buildBridges(palette));

  // ---- signage & outer city & street life
  const boards = new Billboards(data, ground);
  group.add(boards.group);
  const outer = new OuterCity(data, ground);
  outer.build(engine.params);
  group.add(outer.group);
  const clearZones = [...sanctum.clear];
  const props = new StreetProps(data, ground, clearZones.map((c) => ({ ...c, r: c.r + 14 })));
  group.add(props.group);
  const fx = new WeatherFx();
  engine.scene.add(fx.group);

  // hand-placed traffic for the Sanctum scene
  const taxi = props.car(0xd9a50c), sedan = props.car(0x14161a);
  const tp = sanctum.toWorld(-8, 0, 5.2), sp = sanctum.toWorld(21, 0, 10.9);
  const along = sanctum.toWorld(1, 0, 0).sub(sanctum.toWorld(0, 0, 0));
  taxi.position.copy(tp); taxi.rotation.y = Math.atan2(along.x, along.z);
  sedan.position.copy(sp); sedan.rotation.y = Math.atan2(-along.x, -along.z);
  group.add(taxi, sedan);

  // ---- heroes (static figures)
  const heroGroup = new THREE.Group(); heroGroup.name = 'heroes';
  group.add(heroGroup);
  let spidey: Hero | null = null, strange: Hero | null = null, iron: Hero | null = null;
  // alternate, curated positions
  const bugleSite = SITES.bugle;
  const spideyAlt: Anchor = {
    pos: new THREE.Vector3(bugleSite.x + CROSSTOWN[0] * 12.4 - UPTOWN[0] * -10.9, 119.05, bugleSite.z + CROSSTOWN[1] * 12.4 - UPTOWN[1] * -10.9),
    yaw: yawFacing(UPTOWN[0] * 0.5 - CROSSTOWN[0], UPTOWN[1] * 0.5 - CROSSTOWN[1]),
  };
  const ironAlt: Anchor = { pos: new THREE.Vector3(SITES.baxter.x + 6, 183.2, SITES.baxter.z + 4), yaw: yawFacing(0.4, 0.9) };
  const anchors = () => {
    const alt = engine.params.heroVariant === 1;
    if (spidey) place(spidey, alt ? spideyAlt : perch.perch);
    if (strange) place(strange, alt ? sanctum.strangeAlt : sanctum.strange);
    if (iron) place(iron, alt ? ironAlt : avengers.ironman);
    engine.closeTargets = [spidey, strange, iron].filter((h): h is Hero => !!h).map((h) => h.group.position.clone().add(new THREE.Vector3(0, 1, 0)));
  };
  try {
    [spidey, strange, iron] = await Promise.all([buildSpiderMan(), buildDoctorStrange(), buildIronMan()]);
    heroGroup.add(spidey.group, strange.group, iron.group);
    anchors();
  } catch (err) {
    console.error('Hero figures failed to load', err);
  }

  // ---- compose the hero bookmarks from the actual scene anchors
  {
    const p = perch.perch.pos, fwd = new THREE.Vector3(Math.sin(perch.perch.yaw), 0, Math.cos(perch.perch.yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    setBookmark('spidey', p.clone().addScaledVector(fwd, -3.7).addScaledVector(right, 2.2).add(new THREE.Vector3(0, 1.1, 0)), p.clone().addScaledVector(fwd, 40).addScaledVector(right, -13).add(new THREE.Vector3(0, -2.5, 0)), 44);
    setBookmark('sanctum', sanctum.toWorld(19.2, 1.3, 14.7), sanctum.toWorld(19.2 - 16.6, 1.3 + 4.6, 14.7 - 10.8), 46);
    const a = avengers.ironman.pos;
    setBookmark('avengers', new THREE.Vector3(a.x + 150, 232, a.z + 470), new THREE.Vector3(SITES.avengers.x - 20, 250, SITES.avengers.z), 34);
  }

  let lastDetail = -1;
  const apply = (p: Params, a: AtmoState, prev: Params | null) => {
    marvelGroup.visible = p.landmarkVisibility > 0.02;
    heroGroup.visible = p.superheroVisibility >= 0.5;
    if (!prev || prev.heroVariant !== p.heroVariant) anchors();
    if (p.marvelDetail !== lastDetail) { lastDetail = p.marvelDetail; boards.apply(p.marvelDetail); }
    for (const l of sanctum.lights) l.intensity = a.night * 38;
    const rain = p.weather === 'rain' ? Math.min(1, p.wetness * 1.2) : 0;
    const snow = p.weather === 'snow' ? Math.min(1, 0.25 + p.snowCoverage) : 0;
    fx.apply(rain, snow, a.fogColor.clone().lerp(new THREE.Color(1, 1, 1), 0.45).multiplyScalar(0.5 + 0.5 * (1 - a.night)), a.night);
  };
  apply(engine.params, engine.atmo, null);

  return {
    group, clearZones,
    apply,
    regenerate(p) { outer.build(p); },
    update(dt, _now, camera) {
      sanctum.mandala.rotation.z += dt * 0.12;
      const spin = strange?.group.userData.spin as THREE.Mesh[] | undefined;
      if (spin) { spin[0].rotation.z += dt * 0.5; spin[1].rotation.z -= dt * 0.35; }
      props.update(camera.position, 1150 * engine.params.lodBias);
    },
    dispose() { engine.scene.remove(group); engine.scene.remove(fx.group); outer.dispose(); },
  };
}
