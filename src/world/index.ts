import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import type { CityData } from '../city/geo';
import type { GroundBuild } from '../city/ground';
import type { Params } from '../state/params';
import type { AtmoState } from '../engine/atmosphere';
import { BOOKMARKS } from '../state/presets';
import { buildAvengersTower, buildBaxter, buildBugle, buildChrysler, buildEmpireState, buildRooftopTower } from '../landmarks/towers';
import { buildSanctum, SanctumBuild } from '../landmarks/sanctum';
import { OuterCity } from './outer';
import { StreetProps } from './props';
import { WeatherFx } from './fx';
import { Billboards } from './billboards';
import { buildBridges } from './bridges';
import { SITES } from '../landmarks/sites';

/** Everything in the world that is not the streamed real-footprint city: landmarks, outer boroughs, props, weather FX. */
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
  const rooftop = buildRooftopTower(palette);
  group.add(marvelGroup, rooftop.group, buildEmpireState(palette), buildChrysler(palette), buildBridges(palette));

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

  // the camera may sit right on the rooftop parapet or the tower deck: keep the near plane from clipping them
  engine.closeTargets = [rooftop.perch.pos.clone(), avengers.deck.pos.clone()];

  // ---- compose the location bookmarks from the actual scene anchors
  {
    const p = rooftop.perch.pos, fwd = new THREE.Vector3(Math.sin(rooftop.perch.yaw), 0, Math.cos(rooftop.perch.yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    setBookmark('rooftop', p.clone().addScaledVector(fwd, -3.7).addScaledVector(right, 2.2).add(new THREE.Vector3(0, 1.1, 0)), p.clone().addScaledVector(fwd, 40).addScaledVector(right, -13).add(new THREE.Vector3(0, -2.5, 0)), 44);
    setBookmark('sanctum', sanctum.toWorld(19.2, 1.3, 14.7), sanctum.toWorld(19.2 - 16.6, 1.3 + 4.6, 14.7 - 10.8), 46);
    // from the east at dusk: the blade-fin and landing deck in profile against the sunset, Chrysler alongside
    const s = SITES.avengers;
    setBookmark('avengers', new THREE.Vector3(s.x + 468, 255, s.z + 406), new THREE.Vector3(s.x - 70, 284, s.z - 10), 34);
  }

  let lastDetail = -1;
  const apply = (p: Params, a: AtmoState, _prev: Params | null) => {
    marvelGroup.visible = p.landmarkVisibility > 0.02;
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
      props.update(camera.position, 1150 * engine.params.lodBias);
    },
    dispose() { engine.scene.remove(group); engine.scene.remove(fx.group); outer.dispose(); },
  };
}
