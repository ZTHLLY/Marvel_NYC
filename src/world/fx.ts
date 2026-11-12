import * as THREE from 'three';
import { U } from '../engine/materials';
import { mulberry32 } from '../util/rng';

const VERT = /* glsl */ `
attribute vec3 aOffset; attribute float aRand;
uniform vec3 uBox; uniform float uStreak; uniform float uSize; uniform float uTime;
varying vec2 vQ; varying float vFade; varying float vRand;
void main(){
  // a world-anchored lattice of particles that wraps around the camera: they hang in space as you move through them
  vec3 base = aOffset * uBox;
  base.y -= uTime * uStreak * 0.0;
  vec3 rel = mod(base - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 wp = cameraPosition + rel;
  float dist = length(rel);
  vec3 toCam = normalize(cameraPosition - wp);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 upv = mix(cross(toCam, right), normalize(vec3(0.08, 1.0, 0.03)), step(0.5, uStreak));
  float sz = uSize * (0.6 + 0.9 * aRand);
  wp += right * position.x * sz + upv * position.y * sz * mix(1.0, 46.0, step(0.5, uStreak));
  vQ = position.xy; vRand = aRand;
  vFade = (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, dist)) * smoothstep(0.25, 1.6, dist);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor; uniform float uOpacity; uniform float uStreak;
varying vec2 vQ; varying float vFade; varying float vRand;
void main(){
  float a;
  if (uStreak > 0.5) a = (1.0 - abs(vQ.x) * 2.0) * (1.0 - pow(abs(vQ.y) * 2.0, 3.0));
  else { float d = length(vQ) * 2.0; a = 1.0 - smoothstep(0.25, 1.0, d); }
  a *= vFade * uOpacity * (0.45 + 0.55 * vRand);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * a, a);
}`;

function field(count: number, seed: number, box: THREE.Vector3, streak: boolean, size: number): THREE.Mesh {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const off = new Float32Array(count * 3), rnd = new Float32Array(count);
  const r = mulberry32(seed);
  for (let i = 0; i < count; i++) { off[i * 3] = r(); off[i * 3 + 1] = r(); off[i * 3 + 2] = r(); rnd[i] = r(); }
  g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
  g.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 1));
  g.instanceCount = count;
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { uBox: { value: box }, uStreak: { value: streak ? 1 : 0 }, uSize: { value: size }, uTime: U.uTime, uColor: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 0 } },
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 50;
  mesh.visible = false;
  return mesh;
}

/** Suspended precipitation: static rain streaks and soft snowflakes frozen in the air around the camera. */
export class WeatherFx {
  readonly group = new THREE.Group();
  private rain = field(9000, 11, new THREE.Vector3(70, 46, 70), true, 0.014);
  private snowNear = field(7000, 23, new THREE.Vector3(46, 30, 46), false, 0.05);
  private snowFar = field(9000, 37, new THREE.Vector3(240, 120, 240), false, 0.34);

  constructor() {
    this.group.name = 'weather-fx';
    this.group.add(this.rain, this.snowNear, this.snowFar);
  }

  apply(rain: number, snow: number, light: THREE.Color, night: number) {
    const set = (m: THREE.Mesh, amt: number, gain: number) => {
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      m.visible = amt > 0.01;
      u.uOpacity.value = amt;
      u.uColor.value.copy(light).multiplyScalar(gain);
    };
    set(this.rain, rain * 0.5, 0.55 + 0.9 * night);
    set(this.snowNear, snow * 0.95, 1.0 + 1.4 * night);
    set(this.snowFar, snow * 0.42, 0.9 + 1.2 * night);
  }
}
