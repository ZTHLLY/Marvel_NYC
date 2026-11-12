import * as THREE from 'three';
import { extendMaterial, pbr, U } from '../engine/materials';
import { beacon } from '../landmarks/kit';
import { Mannequin } from './mannequin';

/**
 * Original costume interpretations painted procedurally onto the mannequin in bind (T-pose) space,
 * so no third-party character textures or meshes are shipped.
 */
const SUIT_V = { vPars: 'varying vec3 vBind;', vMain: 'vBind = position;' };
const SUIT_COMMON = /* glsl */ `
varying vec3 vBind;
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float suitAA = 0.001;   // pixel footprint in bind space, set once per fragment (derivatives are undefined inside branches)
float lineMask(float d, float w){ return 1.0 - smoothstep(w, w + suitAA, d); }
`;

const SPIDEY_SURFACE = /* glsl */ `
{
  vec3 p = vBind; float ax = abs(p.x);
  suitAA = max(length(fwidth(vBind)) * 0.9, 1e-5);
  vec3 red = vec3(0.47, 0.022, 0.03), blue = vec3(0.022, 0.06, 0.26), black = vec3(0.01);
  float head = step(1.535, p.y) * step(ax, 0.14);
  float arm = step(0.2, ax) * step(1.2, p.y);
  vec3 col = red; float isRed = 1.0;
  if (head < 0.5) {
    if (arm > 0.5) {
      // upper arm: red shoulder cap & top stripe, blue underside; forearm + glove red
      float under = step(p.y, 1.425) * step(ax, 0.5) * step(0.27, ax);
      isRed = 1.0 - under;
    } else if (p.y < 0.955) {
      isRed = step(p.y, 0.43 + 0.03 * cos(atan(p.z, ax - 0.09) * 2.0));           // boots
    } else if (p.y < 1.02) {
      isRed = step(0.985, p.y);                                                    // belt
    } else {
      float w = mix(0.06, 0.2, smoothstep(1.06, 1.4, p.y));
      isRed = step(ax, w);                                                         // red torso panel, blue flanks
    }
    col = mix(blue, red, isRed);
    // black piping between panels
    float edge = 0.0;
    if (arm < 0.5 && p.y > 1.02) edge = lineMask(abs(ax - mix(0.06, 0.2, smoothstep(1.06, 1.4, p.y))), 0.006);
    if (arm < 0.5) edge = max(edge, lineMask(abs(p.y - 0.985), 0.005) + lineMask(abs(p.y - 1.02), 0.004));
    col = mix(col, black, clamp(edge, 0.0, 1.0));
  }
  // ---- raised web lines on the red panels
  float web = 0.0;
  if (head > 0.5) {
    vec3 d = p - vec3(0.0, 1.668, 0.085);
    float ang = atan(d.y, d.x), rad = length(d);
    float spokes = abs(fract(ang / 6.2832 * 14.0) - 0.5) * rad * 6.2832 / 14.0;
    float sag = pow(abs(fract(ang / 6.2832 * 14.0) - 0.5) * 2.0, 2.0);
    float rings = abs(fract((rad - 0.012 * sag) / 0.034) - 0.5) * 0.034;
    web = max(lineMask(spokes, 0.0016), lineMask(rings, 0.0016));
  } else if (arm > 0.5) {
    float ang = atan(p.y - 1.44, p.z);
    float sp = abs(fract(ang / 6.2832 * 8.0) - 0.5) * 0.05 * 6.2832 / 8.0;
    float sag = pow(abs(fract(ang / 6.2832 * 8.0) - 0.5) * 2.0, 2.0);
    float rg = abs(fract((ax - 0.012 * sag) / 0.045) - 0.5) * 0.045;
    web = max(lineMask(sp, 0.0016), lineMask(rg, 0.0016));
  } else {
    float cx = p.y < 0.955 ? ax - 0.095 : p.x;
    float ang = atan(cx, p.z);
    float n = p.y < 0.955 ? 8.0 : 16.0; float r0 = p.y < 0.955 ? 0.07 : 0.15;
    float sp = abs(fract(ang / 6.2832 * n) - 0.5) * r0 * 6.2832 / n;
    float sag = pow(abs(fract(ang / 6.2832 * n) - 0.5) * 2.0, 2.0);
    float rg = abs(fract((p.y + 0.014 * sag) / 0.05) - 0.5) * 0.05;
    web = max(lineMask(sp, 0.0016), lineMask(rg, 0.0016));
  }
  web *= isRed;
  col = mix(col, black, web * 0.9);
  // ---- chest spider
  if (p.z > 0.0 && head < 0.5 && arm < 0.5) {
    vec2 q = vec2(ax, p.y);
    float sp = length((q - vec2(0.0, 1.335)) / vec2(0.011, 0.03)) - 1.0;
    float legs = min(min(sdSeg(q, vec2(0.006, 1.35), vec2(0.045, 1.385)), sdSeg(q, vec2(0.045, 1.385), vec2(0.06, 1.37))),
                     min(sdSeg(q, vec2(0.006, 1.34), vec2(0.055, 1.345)), min(sdSeg(q, vec2(0.006, 1.328), vec2(0.05, 1.305)), sdSeg(q, vec2(0.05, 1.305), vec2(0.056, 1.28)))));
    col = mix(col, black, max(1.0 - smoothstep(0.0, 0.3, sp), lineMask(legs, 0.0035)));
  }
  float rough = mix(0.62, 0.5, isRed); float lens = 0.0;
  // ---- eye lenses
  if (head > 0.5 && p.z > 0.02) {
    vec2 e = vec2(ax - 0.043, p.y - 1.676);
    float c = cos(-0.42), s = sin(-0.42); e = vec2(c * e.x - s * e.y, s * e.x + c * e.y);
    float d = length(e / vec2(0.034, 0.02));
    float frame = 1.0 - smoothstep(1.5, 1.62, d);
    lens = 1.0 - smoothstep(0.96, 1.04, d);
    col = mix(col, black, frame);
    col = mix(col, vec3(0.86, 0.9, 0.92), lens);
    rough = mix(rough, 0.18, lens);
  }
  // fine knit texture
  float knit = h21(floor(p.xy * 700.0) + floor(p.z * 700.0));
  col *= 0.9 + 0.14 * knit * (1.0 - lens);
  diffuseColor.rgb = col;
  roughnessFactor = mix(rough, 0.4, web);
  metalnessFactor = 0.0;
  totalEmissiveRadiance += vec3(0.5, 0.55, 0.6) * lens * 0.12;
}
`;

const STRANGE_SURFACE = /* glsl */ `
{
  vec3 p = vBind; float ax = abs(p.x);
  suitAA = max(length(fwidth(vBind)) * 0.9, 1e-5);
  vec3 tunic = vec3(0.03, 0.075, 0.17), tunicHi = vec3(0.05, 0.12, 0.25), navy = vec3(0.015, 0.025, 0.05);
  vec3 skin = vec3(0.56, 0.36, 0.27), leather = vec3(0.11, 0.06, 0.03), hair = vec3(0.03, 0.025, 0.022);
  float head = step(1.535, p.y) * step(ax, 0.14);
  float arm = step(0.2, ax) * step(1.2, p.y);
  vec3 col = tunic; float rough = 0.78;
  if (head > 0.5) {
    // face & neck in skin, sculpted hair cap with silver temples, goatee
    col = skin; rough = 0.55;
    float hairline = 1.728 - 0.06 * smoothstep(0.02, 0.09, ax) + 0.5 * max(0.0, -p.z + 0.02);
    float isHair = step(hairline, p.y + 0.02 * vnoise(p.xz * 90.0));
    isHair = max(isHair, step(p.z, -0.035) * step(1.6, p.y));
    isHair = max(isHair, step(0.068, ax) * step(1.64, p.y) * step(p.z, 0.035));           // sideburns
    vec3 hc = mix(hair, vec3(0.42, 0.42, 0.44), smoothstep(0.06, 0.085, ax) * step(1.63, p.y) * step(p.y, 1.75) * step(-0.02, p.z));
    hc *= 0.7 + 0.6 * vnoise(vec2(p.x * 260.0, p.y * 30.0));
    col = mix(col, hc, isHair); rough = mix(rough, 0.45, isHair);
    if (p.z > 0.045) {
      float goat = (1.0 - smoothstep(0.03, 0.04, length(vec2(ax, (p.y - 1.588) * 0.9)))) * step(p.y, 1.616);
      float stache = lineMask(sdSeg(vec2(ax, p.y), vec2(0.0, 1.632), vec2(0.03, 1.624)), 0.0065);
      float mouthGap = lineMask(abs(p.y - 1.612), 0.004) * step(ax, 0.02);
      col = mix(col, hair * 1.3, max(goat, stache) * (1.0 - mouthGap * 0.6));
      // brows & eyes
      float brow = lineMask(sdSeg(vec2(ax, p.y), vec2(0.016, 1.698), vec2(0.052, 1.7)), 0.0042);
      float eye = 1.0 - smoothstep(0.8, 1.1, length(vec2(ax - 0.034, p.y - 1.682) / vec2(0.013, 0.0052)));
      col = mix(col, hair, brow); col = mix(col, vec3(0.04, 0.035, 0.04), eye);
      col = mix(col, skin * 0.72, lineMask(sdSeg(vec2(ax, p.y), vec2(0.0, 1.69), vec2(0.008, 1.645)), 0.004) * 0.5);   // nose shadow
    }
  } else if (arm > 0.5) {
    col = ax > 0.735 ? skin : (ax > 0.5 ? mix(leather, navy, step(0.5, fract(ax * 38.0))) : tunic);    // wrapped bracers, bare hands
    if (ax > 0.735) rough = 0.55;
  } else if (p.y < 0.47) { col = leather * 0.6; rough = 0.5; }               // boots
  else if (p.y < 0.66) { col = navy; }                                       // trousers
  else {
    // layered tunic: diagonal wrap, lighter trim, long skirt panels
    float wrap = lineMask(abs((p.x * 0.75 + (p.y - 1.34)) ) , 0.007) * step(1.05, p.y) * step(0.0, p.z);
    float fold = vnoise(vec2(p.x * 26.0, p.y * 3.0));
    col = mix(tunic, tunicHi, 0.35 * fold + 0.3 * step(0.0, p.x * 0.75 + (p.y - 1.34)) * step(1.05, p.y));
    col = mix(col, tunicHi * 1.5, wrap);
    // belts: two leather sashes with a brass ring
    float belt = step(0.985, p.y) * step(p.y, 1.105);
    float strap = step(0.5, fract((p.y - 0.985) / 0.06));
    col = mix(col, mix(leather, leather * 1.8, strap), belt);
    float ring = lineMask(abs(length(vec2(p.x - 0.03, p.y - 1.045)) - 0.026), 0.006) * step(0.0, p.z);
    col = mix(col, vec3(0.62, 0.45, 0.16), ring);
    if (ring > 0.5) { metalnessFactor = 0.9; rough = 0.35; }
  }
  col *= 0.9 + 0.14 * h21(floor(p.xy * 500.0) + floor(p.z * 500.0));
  diffuseColor.rgb = col;
  roughnessFactor = rough;
}
`;

const IRON_SURFACE = /* glsl */ `
{
  vec3 p = vBind; float ax = abs(p.x);
  suitAA = max(length(fwidth(vBind)) * 0.9, 1e-5);
  vec3 red = vec3(0.42, 0.015, 0.02), gold = vec3(0.78, 0.52, 0.16);
  float head = step(1.535, p.y) * step(ax, 0.14);
  float arm = step(0.2, ax) * step(1.2, p.y);
  float g = 0.0;
  if (head > 0.5) {
    // faceplate
    float plate = step(0.035, p.z) * step(p.y, 1.745) * step(ax, 0.07 + 0.1 * (p.y - 1.56));
    g = plate;
  } else if (arm > 0.5) g = step(0.3, ax) * step(ax, 0.5);                                   // biceps
  else if (p.y < 0.95) g = step(0.55, p.y) * step(p.y, 0.9);                                 // thighs
  else g = step(1.02, p.y) * step(p.y, 1.2) * step(0.07, ax);                                // flanks
  vec3 col = mix(red, gold, g);
  // panel seams
  float seams = 0.0;
  seams = max(seams, lineMask(abs(fract(p.y * 9.0) - 0.5) / 9.0, 0.0022) * step(0.3, h21(floor(vec2(p.y * 9.0, ax * 5.0)))));
  seams = max(seams, lineMask(abs(ax - 0.07), 0.0022) * step(1.0, p.y) * (1.0 - arm) * (1.0 - head));
  seams = max(seams, lineMask(abs(fract(ax * 11.0) - 0.5) / 11.0, 0.0022) * arm);
  col = mix(col, vec3(0.015), seams);
  float eyes = 0.0;
  if (head > 0.5 && p.z > 0.04) {
    vec2 e = vec2(ax - 0.036, p.y - 1.684);
    eyes = (1.0 - smoothstep(0.9, 1.1, length(e / vec2(0.02, 0.0055))));
    float mouth = lineMask(abs(p.y - 1.6), 0.0025) * step(ax, 0.03);
    col = mix(col, vec3(0.02), mouth);
  }
  diffuseColor.rgb = mix(col, vec3(0.0), eyes);
  metalnessFactor = 1.0 - seams;
  roughnessFactor = mix(0.24, 0.3, g) + 0.04 * vnoise(p.xy * 60.0);
  totalEmissiveRadiance += vec3(0.75, 0.95, 1.0) * eyes * mix(2.0, 5.0, uNight);
}
`;

function suit(key: string, surface: string, base: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, ...base });
  return extendMaterial(m, { key, ...SUIT_V, fPars: SUIT_COMMON, fSurface: surface, weather: false });
}

export interface Hero { group: THREE.Group; name: string }

function wrap(m: Mannequin, name: string): Hero {
  m.finish();
  const group = new THREE.Group();
  group.name = name;
  group.add(m.root);
  return { group, name };
}

/** Spider-Man: a deep rooftop crouch, one hand on the stone, watching the avenue. */
export async function buildSpiderMan(): Promise<Hero> {
  const m = await Mannequin.create();
  m.setMaterial(suit('suit-spidey', SPIDEY_SURFACE));
  m.hips(0, 0.37, -0.1);
  m.twist('Hips', 1, 0, 0, 0.5);
  m.aim('Spine', 0, 0.74, 0.67).aim('Spine1', 0, 0.7, 0.71).aim('Spine2', 0, 0.74, 0.67);
  m.aim('Neck', 0.05, 0.93, 0.36).aim('Head', 0.1, 0.99, 0.02);
  m.twist('Head', 0, 1, 0, 0.32).twist('Head', 1, 0, 0, 0.16);
  // legs: knees high and wide, weight on the balls of the feet
  m.aim('LeftUpLeg', 0.66, 0.3, 0.69).aim('LeftLeg', -0.2, -0.86, -0.47).aim('LeftFoot', 0.42, -0.42, 0.8);
  m.aim('RightUpLeg', -0.6, 0.36, 0.71).aim('RightLeg', 0.16, -0.88, -0.44).aim('RightFoot', -0.4, -0.42, 0.82);
  // left hand planted on the coping between the knees, right forearm draped over the knee
  m.aim('LeftShoulder', 0.9, -0.1, 0.42).aim('LeftArm', 0.02, -0.78, 0.62).aim('LeftForeArm', -0.22, -0.9, 0.38).aim('LeftHand', -0.05, -0.5, 0.86);
  m.aim('RightShoulder', -0.92, 0.05, 0.38).aim('RightArm', -0.5, -0.34, 0.8).aim('RightForeArm', 0.28, -0.42, 0.86).aim('RightHand', 0.3, -0.62, 0.72);
  m.curl('Left', 12, 1).curl('Right', 28);
  const hero = wrap(m, 'spider-man');
  // seat the feet on the support plane (y = 0 in hero space)
  const lowest = Math.min(m.pos('LeftToeBase').y, m.pos('RightToeBase').y, m.pos('LeftHandMiddle1').y + 0.02);
  m.root.position.y = -lowest + 0.035;
  return hero;
}

function cloakGeometry(shoulderY: number): THREE.BufferGeometry {
  // A draped cape: wraps 250° around the back from collar-bone to collar-bone, flaring to the hem with deep folds.
  const U = 56, V = 26;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= V; j++) {
    const v = j / V;
    for (let i = 0; i <= U; i++) {
      const u = i / U;
      const a = (u - 0.5) * Math.PI * 1.42;                // 0 = straight back
      const fold = Math.sin(u * Math.PI * 9 + 0.6) * 0.035 + Math.sin(u * Math.PI * 23) * 0.012;
      const flare = 1 + v * 0.95 + Math.sin(v * 2.6) * 0.12;
      const wind = v * v * 0.2;                             // a breath of wind carries the hem to one side
      const r = (0.215 + fold * v * 1.6) * flare;
      const drop = shoulderY - 0.03 - v * (shoulderY - 0.12) - Math.cos(a) * 0.04 * (1 - v);
      const x = Math.sin(a) * r * (1 - 0.1 * v) + wind * 0.6;
      const z = -Math.cos(a) * r * (0.78 + 0.5 * v) - 0.03 - wind * 0.35 + (Math.abs(a) > 1.6 ? (Math.abs(a) - 1.6) * 0.12 : 0);
      pos.push(x, drop + Math.sin(u * 30) * 0.004 * v, z);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) { const a = j * (U + 1) + i, b = a + 1, c = a + U + 2, d = a + U + 1; idx.push(a, d, b, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function collarGeometry(y: number): THREE.BufferGeometry {
  // The Cloak's tall, stiff collar with its swept points
  const U = 40, V = 6;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= V; j++) {
    const v = j / V;
    for (let i = 0; i <= U; i++) {
      const u = i / U, a = (u - 0.5) * Math.PI * 1.55;
      const tip = Math.pow(Math.abs(u - 0.5) * 2, 2.4);                // rises to points at the front edges
      const h = (0.1 + 0.11 * tip) * v;
      const r = 0.12 + v * (0.055 + 0.03 * tip);
      pos.push(Math.sin(a) * r * 1.12, y + h, -Math.cos(a) * r * 0.95 + 0.012);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) { const a = j * (U + 1) + i, b = a + 1, c = a + U + 2, d = a + U + 1; idx.push(a, d, b, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Doctor Strange: off duty, takeaway coffee in hand, the Cloak of Levitation over his shoulders. */
export async function buildDoctorStrange(): Promise<Hero> {
  const m = await Mannequin.create();
  m.setMaterial(suit('suit-strange', STRANGE_SURFACE));
  // relaxed contrapposto
  m.twist('Hips', 0, 0, 1, 0.045).twist('Hips', 0, 1, 0, -0.12);
  m.aim('Spine', 0.02, 1, 0.03).aim('Spine2', -0.02, 1, -0.01).aim('Neck', 0, 1, 0.06);
  m.twist('Head', 0, 1, 0, 0.42).twist('Head', 1, 0, 0, -0.05);
  m.aim('LeftUpLeg', 0.04, -1, 0.02).aim('LeftLeg', 0.02, -1, -0.02);
  m.aim('RightUpLeg', -0.1, -0.98, 0.13).aim('RightLeg', -0.02, -0.98, -0.14).aim('RightFoot', -0.3, -0.28, 0.9);
  // right hand raises the cup; left hand rests easy
  m.aim('RightShoulder', -1, -0.06, 0.02).aim('RightArm', -0.2, -0.95, 0.16).aim('RightForeArm', 0.3, 0.42, 0.86).aim('RightHand', 0.5, 0.3, 0.8);
  m.roll('RightForeArm', -1.1);
  m.aim('LeftShoulder', 1, -0.08, 0).aim('LeftArm', 0.16, -0.98, 0.0).aim('LeftForeArm', 0.07, -0.96, 0.24).aim('LeftHand', 0.02, -0.92, 0.36);
  m.curl('Left', 22).curl('Right', 52);
  const hero = wrap(m, 'doctor-strange');
  const lowest = Math.min(m.pos('LeftToeBase').y, m.pos('RightToeBase').y);
  m.root.position.y = -lowest + 0.025;
  hero.group.updateMatrixWorld(true);
  const P = (n: string) => m.bones[n].getWorldPosition(new THREE.Vector3());

  // ---- Cloak of Levitation
  const shoulderY = (P('LeftArm').y + P('RightArm').y) / 2 + 0.05;
  const cloakMat = extendMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, side: THREE.DoubleSide }), {
    key: 'cloak', weather: false,
    vPars: 'varying vec2 vCUv;', vMain: 'vCUv = uv;',
    fPars: 'varying vec2 vCUv;',
    fSurface: /* glsl */ `{
      vec3 outer = vec3(0.36, 0.022, 0.03) * (0.8 + 0.3 * vnoise(vCUv * vec2(60.0, 9.0)));
      // lining: a dark tartan
      vec2 t = vCUv * vec2(46.0, 38.0);
      float plaid = 0.5 * step(0.5, fract(t.x)) + 0.5 * step(0.5, fract(t.y));
      vec3 lining = mix(vec3(0.13, 0.012, 0.02), vec3(0.3, 0.05, 0.03), plaid) + vec3(0.25, 0.18, 0.05) * step(0.94, fract(t.x * 0.5)) * 0.5;
      float trim = step(vCUv.y, 0.012) + step(0.985, vCUv.y) + step(vCUv.x, 0.012) + step(0.988, vCUv.x);
      vec3 c = gl_FrontFacing ? lining : outer;
      c = mix(c, vec3(0.5, 0.36, 0.1), clamp(trim, 0.0, 1.0) * 0.8);
      diffuseColor.rgb = c; roughnessFactor = gl_FrontFacing ? 0.7 : 0.58;
    }`,
  });
  const cloak = new THREE.Mesh(cloakGeometry(shoulderY), cloakMat);
  const collar = new THREE.Mesh(collarGeometry(shoulderY - 0.035), cloakMat);
  for (const c of [cloak, collar]) { c.castShadow = true; c.receiveShadow = true; hero.group.add(c); }
  // tunic skirt: hides the mannequin's hip joints and gives the layered-robe silhouette
  {
    const hip = P('Hips');
    const N = 28, rows = [[0.115, 0.185, 0.15], [-0.02, 0.2, 0.165], [-0.2, 0.225, 0.19], [-0.38, 0.25, 0.215]];
    const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
    rows.forEach(([dy, rx, rz], j) => { for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI * 2 + Math.PI / 2; const f = 1 + 0.035 * Math.sin(a * 7) * j; pos.push(hip.x + Math.cos(a) * rx * f, hip.y + dy, hip.z + 0.012 + Math.sin(a) * rz * f); uvs.push(i / N, j / 3); } });
    for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 2, d = a + N + 1; idx.push(a, b, d, b, c, d); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); sg.setIndex(idx); sg.computeVertexNormals();
    const skirtMat = extendMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }), {
      key: 'tunic-skirt', weather: false, vPars: 'varying vec2 vCUv;', vMain: 'vCUv = uv;', fPars: 'varying vec2 vCUv;',
      fSurface: `{ vec3 t = vec3(0.03, 0.075, 0.17); float fold = vnoise(vec2(vCUv.x * 40.0, vCUv.y * 2.0));
        vec3 c = mix(t, vec3(0.05, 0.12, 0.25), 0.4 * fold); c = mix(c, vec3(0.11, 0.06, 0.03) * (1.0 + 0.8 * step(0.5, fract(vCUv.y * 9.0))), step(vCUv.y, 0.26));
        c = mix(c, vec3(0.07, 0.16, 0.32), step(0.965, vCUv.y)); diffuseColor.rgb = c * (0.9 + 0.14 * h21(floor(vCUv * 400.0))); roughnessFactor = 0.8; }`,
    });
    const skirt = new THREE.Mesh(sg, skirtMat); skirt.castShadow = true; skirt.receiveShadow = true; hero.group.add(skirt);
  }
  // brass clasps
  const brass = pbr({ color: 0x9a7424, roughness: 0.35, metalness: 1 });
  for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.012, 14), brass); c.rotation.x = Math.PI / 2; c.position.set(s * 0.115, shoulderY - 0.075, 0.105); hero.group.add(c); }
  // Eye of Agamotto
  const chest = P('Spine2');
  const eye = new THREE.Group();
  const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.008, 8, 20), brass);
  const gem = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), extendMaterial(new THREE.MeshBasicMaterial({ color: 0x4cff9a, toneMapped: false }), { key: 'agamotto', uniforms: { uMagic: U.uMagic }, fPars: 'uniform float uMagic;', fFinal: 'gl_FragColor.rgb *= 0.4 + 2.2 * uMagic;' }));
  gem.scale.z = 0.5;
  eye.add(ringM, gem);
  eye.position.set(chest.x, chest.y + 0.06, chest.z + 0.135);
  hero.group.add(eye);
  // ---- takeaway coffee
  const hand = P('RightHand'), mid = P('RightHandMiddle1'), palm = m.palm('Right');
  const cup = new THREE.Group();
  const paper = pbr({ color: 0xf1ede4, roughness: 0.6 }), kraft = pbr({ color: 0x9a6a3c, roughness: 0.8 }), lid = pbr({ color: 0x141414, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.03, 0.125, 20), paper);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.0405, 0.0345, 0.055, 20), kraft); sleeve.position.y = 0.004;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.012, 20), lid); top.position.y = 0.068;
  const sip = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.041, 0.01, 20), lid); sip.position.y = 0.078;
  cup.add(body, sleeve, top, sip);
  cup.traverse((o) => { o.castShadow = true; });
  cup.position.copy(hand).lerp(mid, 0.62).addScaledVector(palm, 0.05);
  cup.position.y += 0.012;
  hero.group.add(cup);
  // a wisp of steam & a stray spark of magic by the free hand
  const lh = P('LeftHandMiddle1');
  const sparkMat = extendMaterial(new THREE.MeshBasicMaterial({ color: 0xff9a30, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), { key: 'spark', uniforms: { uMagic: U.uMagic }, fPars: 'uniform float uMagic;', fFinal: 'gl_FragColor.rgb *= uMagic * mix(0.6, 2.4, uNight);' });
  const spark = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.0035, 6, 40), sparkMat);
  const spark2 = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.0025, 6, 4), sparkMat);
  spark.position.copy(lh).add(new THREE.Vector3(0.02, -0.04, 0.05)); spark.rotation.set(1.2, 0.3, 0);
  spark2.position.copy(spark.position); spark2.rotation.copy(spark.rotation);
  hero.group.add(spark, spark2);
  hero.group.userData.spin = [spark, spark2];
  return hero;
}

/** Iron Man: standing watch on the tower's landing deck. */
export async function buildIronMan(): Promise<Hero> {
  const m = await Mannequin.create();
  m.setMaterial(suit('suit-iron', IRON_SURFACE, { metalness: 1, roughness: 0.25, envMapIntensity: 1.4 }));
  m.twist('Hips', 0, 1, 0, 0.1);
  m.aim('Spine2', 0, 1, -0.03).twist('Head', 0, 1, 0, -0.25);
  m.aim('LeftUpLeg', 0.12, -0.99, 0.02).aim('RightUpLeg', -0.12, -0.99, 0.02).aim('LeftLeg', 0.03, -1, -0.01).aim('RightLeg', -0.03, -1, -0.01);
  m.aim('LeftShoulder', 1, 0.02, 0).aim('LeftArm', 0.3, -0.95, 0.02).aim('LeftForeArm', 0.16, -0.97, 0.16);
  m.aim('RightShoulder', -1, 0.02, 0).aim('RightArm', -0.3, -0.95, 0.02).aim('RightForeArm', -0.16, -0.97, 0.16);
  m.curl('Left', 62).curl('Right', 62);
  const hero = wrap(m, 'iron-man');
  const lowest = Math.min(m.pos('LeftToeBase').y, m.pos('RightToeBase').y);
  m.root.position.y = -lowest + 0.025;
  hero.group.updateMatrixWorld(true);
  const chest = m.bones.Spine2.getWorldPosition(new THREE.Vector3());
  const arc = new THREE.Mesh(new THREE.CircleGeometry(0.036, 20), beacon(0xbfefff, 3, 7, false));
  arc.position.set(chest.x, chest.y + 0.035, chest.z + 0.128);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.007, 8, 20), pbr({ color: 0x555a60, roughness: 0.3, metalness: 1 }));
  rim.position.copy(arc.position);
  hero.group.add(arc, rim);
  return hero;
}
