import * as THREE from 'three';
import type { Params } from '../state/params';
import { sunFromTime } from '../state/params';
import { U, GLSL_NOISE } from './materials';
import { clamp, lerp, smoothstep } from '../util/rng';

/** Fully resolved lighting state for a frozen moment. Pure function of Params. */
export interface AtmoState {
  sunDir: THREE.Vector3;       // direction TO the sun (even below horizon)
  lightDir: THREE.Vector3;     // direction TO the key light (sun, or moon at night)
  lightColor: THREE.Color;
  lightIntensity: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  sunGlow: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  envIntensity: number;
  fogColor: THREE.Color;
  fogSunColor: THREE.Color;
  fogBase: number;
  fogGround: number;
  fogScaleHeight: number;
  fogSun: number;
  night: number;               // 0 day .. 1 night (drives windows, street lights)
  overcast: number;
  cloudCoverage: number;
  starVisibility: number;
  sunDisc: number;
  moon: number;
}

interface Key { el: number; zenith: number; horizon: number; glow: number; sun: number; sunI: number; amb: number; ambI: number; fog: number }
// Art-directed keyframes over sun elevation (degrees). Colours are sRGB hex.
const KEYS: Key[] = [
  { el: -18, zenith: 0x04060f, horizon: 0x161a2e, glow: 0x1c1b30, sun: 0x8fa8dc, sunI: 0.12, amb: 0x2a3558, ambI: 0.2, fog: 0x141829 },
  { el: -9, zenith: 0x070d24, horizon: 0x243056, glow: 0x5a3d55, sun: 0x8fa8dc, sunI: 0.12, amb: 0x2e3d68, ambI: 0.3, fog: 0x1c2440 },
  { el: -4.5, zenith: 0x0f2150, horizon: 0x46578c, glow: 0xd97b4e, sun: 0x9db4e0, sunI: 0.12, amb: 0x3f5590, ambI: 0.62, fog: 0x35426a },
  { el: -1, zenith: 0x21407c, horizon: 0x8a7d9a, glow: 0xff8a45, sun: 0xff6a30, sunI: 0.5, amb: 0x5f6f9c, ambI: 0.72, fog: 0x6c6c8c },
  { el: 2.5, zenith: 0x2c5398, horizon: 0xe3a273, glow: 0xffa050, sun: 0xff9550, sunI: 3.4, amb: 0x7888ae, ambI: 0.78, fog: 0x9c93a6 },
  { el: 8, zenith: 0x356ab2, horizon: 0xeec695, glow: 0xffc27a, sun: 0xffb872, sunI: 4.6, amb: 0x8ea3cc, ambI: 0.86, fog: 0xa9b0c2 },
  { el: 18, zenith: 0x2f6cc0, horizon: 0xcfd6dc, glow: 0xffe2b8, sun: 0xffdcb4, sunI: 3.9, amb: 0x9db6dd, ambI: 0.95, fog: 0xc3cbd4 },
  { el: 35, zenith: 0x2a66c0, horizon: 0xb7d0e8, glow: 0xfff1dc, sun: 0xfff0dc, sunI: 4.3, amb: 0xa8c0e6, ambI: 1.0, fog: 0xb5c8dc },
  { el: 75, zenith: 0x2560bc, horizon: 0xbdd5ec, glow: 0xfff6e8, sun: 0xfff8ee, sunI: 4.6, amb: 0xaac4ea, ambI: 1.05, fog: 0xb8cbe0 },
];

const cA = new THREE.Color(), cB = new THREE.Color();
function keyColor(sel: (k: Key) => number, i: number, t: number, out: THREE.Color) {
  cA.setHex(sel(KEYS[i]));
  cB.setHex(sel(KEYS[i + 1]));
  return out.copy(cA).lerp(cB, t);
}

function kelvinTint(k: number, out: THREE.Color) {
  // gentle white-balance tint: 6500K neutral, lower = warmer
  const t = clamp((k - 6500) / 4500, -1, 1);
  return out.setRGB(1 - 0.16 * t, 1 - 0.02 * Math.abs(t), 1 + 0.2 * t);
}

export function computeAtmosphere(p: Params): AtmoState {
  const { az } = sunFromTime(p.timeOfDay);
  const el = p.sunElevation;
  const elR = (el * Math.PI) / 180;
  // azimuth clockwise from north (-Z): x = sin(az), z = -cos(az)
  const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(elR), Math.sin(elR), -Math.cos(az) * Math.cos(elR)).normalize();

  let i = 0;
  while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
  const t = clamp((el - KEYS[i].el) / (KEYS[i + 1].el - KEYS[i].el), 0, 1);
  const zenith = keyColor((k) => k.zenith, i, t, new THREE.Color());
  const horizon = keyColor((k) => k.horizon, i, t, new THREE.Color());
  const sunGlow = keyColor((k) => k.glow, i, t, new THREE.Color());
  const lightColor = keyColor((k) => k.sun, i, t, new THREE.Color());
  const hemiSky = keyColor((k) => k.amb, i, t, new THREE.Color());
  const fogColor = keyColor((k) => k.fog, i, t, new THREE.Color());
  let lightIntensity = lerp(KEYS[i].sunI, KEYS[i + 1].sunI, t);
  let hemiIntensity = lerp(KEYS[i].ambI, KEYS[i + 1].ambI, t);

  const night = smoothstep(5, -7, el);
  const deepNight = smoothstep(-3, -11, el);
  const cloud = clamp(p.cloudCoverage, 0, 1);
  const overcast = smoothstep(0.6, 0.98, cloud);
  const wetWeather = p.weather === 'rain' ? 1 : 0;
  const snowWeather = p.weather === 'snow' ? 1 : 0;
  const fogWeather = p.weather === 'fog' ? 1 : 0;

  // overcast: desaturate & flatten the sky, kill direct light, lift ambient
  const grey = new THREE.Color();
  const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const dayLum = lerp(0.03, 0.62, 1 - night) * (1 - 0.35 * wetWeather);
  grey.setRGB(dayLum * 0.94, dayLum * 0.97, dayLum * 1.03);
  if (night > 0.5) {
    // city-lit cloud deck at night: dull sodium/rose glow
    grey.setRGB(0.06 + 0.03 * snowWeather, 0.05 + 0.03 * snowWeather, 0.06 + 0.035 * snowWeather).lerp(new THREE.Color(dayLum, dayLum, dayLum * 1.05), 1 - smoothstep(0.5, 1, night));
  }
  zenith.lerp(grey.clone().multiplyScalar(0.8), overcast * 0.92);
  horizon.lerp(grey.clone().multiplyScalar(1.12), overcast * 0.9);
  sunGlow.lerp(grey.clone().multiplyScalar(1.3), overcast * 0.85);
  fogColor.lerp(grey.clone().multiplyScalar(1.05), overcast * 0.9);
  lightIntensity *= 1 - 0.9 * overcast * (1 - deepNight);
  hemiIntensity *= 1 + 0.45 * overcast * (1 - night);
  hemiSky.lerp(grey.clone().multiplyScalar(1.2 / Math.max(lum(grey), 0.05) * lum(hemiSky)), overcast * 0.85);
  if (snowWeather) { hemiIntensity *= 1.18; fogColor.lerp(new THREE.Color(0.8, 0.84, 0.9).multiplyScalar(lerp(0.9, 0.12, night)), 0.5); }
  if (fogWeather) { fogColor.lerp(new THREE.Color(0.82, 0.83, 0.84).multiplyScalar(lerp(1, 0.1, night)), 0.55); lightIntensity *= 0.55; }

  // key light: sun by day, a cool high moon once the sun is well below the horizon
  const moonDir = new THREE.Vector3(-0.42, 0.62, -0.35).normalize();
  const lightDir = deepNight > 0.5 ? moonDir : sunDir.clone();
  if (deepNight <= 0.5 && lightDir.y < 0.035) { lightDir.y = 0.035; lightDir.normalize(); }
  const fadeAtSwitch = Math.abs(deepNight - 0.5) * 2; // avoid a pop when swapping sun→moon
  lightIntensity *= lerp(0.15, 1, fadeAtSwitch);
  lightIntensity *= p.lightIntensity;

  // user colour temperature shifts the key & ambient light
  const tint = kelvinTint(p.colorTemperature, new THREE.Color());
  lightColor.multiply(tint);
  hemiSky.multiply(tint);

  const ambUser = p.ambient * 2; // 0.5 → 1
  // skylight is blue, but bounce light off sunlit masonry is warm: keep fill light close to neutral
  { const l = lum(hemiSky); hemiSky.lerp(new THREE.Color(l * 1.04, l, l * 0.97).lerp(lightColor.clone().multiplyScalar(l / Math.max(lum(lightColor), 0.05)), 0.3 * (1 - night)), 0.72); }
  hemiIntensity *= ambUser * 1.35;
  const envIntensity = lerp(0.4, 0.54, 1 - night) * (0.4 + 0.6 * ambUser);

  // fog: slider 0..1 maps exponentially; weather adds a ground layer
  const fd = p.fogDensity;
  const fogBase = 0.0000075 * Math.pow(18, fd) * (0.6 + 0.8 * p.atmosphere);
  const fogGround = 0.000022 * Math.pow(70, fd) * (1 + 1.5 * fogWeather + 0.6 * wetWeather + 0.4 * snowWeather);
  const fogScaleHeight = lerp(260, 520, fd) * (1 + 0.6 * snowWeather);
  const fogSunColor = sunGlow.clone().lerp(lightColor, 0.35).multiplyScalar(lerp(1.0, 1.25, 1 - night));
  const fogSun = p.atmosphere * (1 - overcast * 0.85) * lerp(1, 0.35, deepNight);
  // night fog picks up city glow
  if (night > 0) fogColor.lerp(new THREE.Color(0.075, 0.06, 0.07), night * 0.35 * (0.4 + fd));

  const hemiGround = fogColor.clone().multiplyScalar(0.3).lerp(lightColor.clone().multiplyScalar(0.22 * (1 - night)), 0.5).lerp(new THREE.Color(0.1, 0.09, 0.08), 0.3);

  return {
    sunDir, lightDir, lightColor, lightIntensity, zenith, horizon, sunGlow, hemiSky, hemiGround, hemiIntensity, envIntensity,
    fogColor, fogSunColor, fogBase, fogGround, fogScaleHeight, fogSun, night, overcast, cloudCoverage: cloud,
    starVisibility: deepNight * (1 - overcast), sunDisc: (1 - overcast) * (1 - fogWeather * 0.7), moon: deepNight * (1 - overcast * 0.9),
  };
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uGlow, uFogColor, uFogSunColor, uSunDir, uLightColor, uMoonDir;
uniform float uCloud, uOvercast, uStars, uSunDisc, uMoon, uNight, uFogAmt, uFogSun, uSeed;
${GLSL_NOISE}
float cloudField(vec2 p){
  float n = fbm2(p) * 0.62 + fbm2(p * 2.7 + 9.1) * 0.28 + vnoise(p * 9.0) * 0.1;
  return n;
}
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  float sd = max(dot(d, uSunDir), 0.0);
  // base gradient
  float g = pow(1.0 - clamp(h, 0.0, 1.0), 3.2);
  vec2 sflat = normalize(uSunDir.xz + vec2(1e-5)); vec2 dflat = normalize(d.xz + vec2(1e-5));
  float sunSide = pow(0.5 + 0.5 * dot(dflat, sflat), 1.6);
  // away from the sun the horizon is a pale, cool band rather than the warm glow
  vec3 hzAnti = mix(uHorizon, uZenith * 1.55 + vec3(0.07, 0.05, 0.07) * (1.0 - uNight), 0.62);
  vec3 hzCol = mix(hzAnti, uHorizon, mix(sunSide, 1.0, uOvercast));
  vec3 col = mix(uZenith, hzCol, g);
  // warm glow around the sun, hugging the horizon
  float low = pow(1.0 - clamp(h, 0.0, 1.0), 5.0);
  col += uGlow * (pow(sd, 3.0) * 0.55 * low + pow(sd, 24.0) * 0.5) * (1.0 - uOvercast);
  // opposite-side belt of Venus (subtle pink) near sunset
  float anti = max(dot(d, -normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
  col += vec3(0.25, 0.08, 0.12) * uGlow * pow(anti, 3.0) * low * 0.25 * (1.0 - uOvercast);
  // stars
  if (uStars > 0.01 && h > 0.0) {
    vec2 sp = d.xz / (0.35 + h) * 180.0;
    vec2 id = floor(sp); vec2 f = fract(sp) - 0.5;
    float r = h21(id + uSeed);
    float star = (1.0 - smoothstep(0.0, 0.09, length(f + (vec2(h21(id + 3.0), h21(id + 7.0)) - 0.5) * 0.7))) * step(0.93, r);
    col += vec3(0.9, 0.95, 1.0) * star * uStars * (0.35 + 0.65 * h21(id + 11.0)) * smoothstep(0.02, 0.3, h) * 1.4;
  }
  // sun disc & moon
  float disc = smoothstep(0.99985, 0.99996, dot(d, uSunDir));
  col += uLightColor * disc * 40.0 * uSunDisc * step(-0.02, uSunDir.y + 0.02);
  float md = dot(d, uMoonDir);
  col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.99975, 0.9999, md) * 2.2 + pow(max(md, 0.0), 900.0) * 0.25) * uMoon;
  // clouds on a virtual dome
  if (h > -0.02) {
    vec2 cp = d.xz / (h + 0.22) * 1.35 + uSeed * 0.37;
    float n = cloudField(cp);
    float cov = mix(0.78, 0.18, uCloud);
    float c = smoothstep(cov, cov + 0.3, n);
    float thick = smoothstep(cov, cov + 0.55, n);
    // lighting: bright silver-lined toward sun, darker bellies when thick
    vec3 lit = mix(uHorizon * 1.15 + uGlow * 0.35, uGlow * 1.5, pow(sd, 4.0) * (1.0 - uOvercast));
    vec3 shade = mix(uZenith * 0.75 + uHorizon * 0.22, uHorizon * 0.6, 0.4);
    vec3 cc = mix(lit, shade, thick * (0.55 + 0.35 * uOvercast));
    cc = mix(cc, mix(uHorizon, uZenith, 0.35) * (0.72 + 0.5 * n), uOvercast);
    cc += vec3(0.07, 0.05, 0.06) * uNight * (1.0 - h) * c; // city glow on cloud base
    float horizonFade = smoothstep(-0.02, 0.16, h);
    col = mix(col, cc, c * horizonFade * mix(0.92, 1.0, uOvercast));
  }
  // horizon haze: melt into fog colour so distant geometry blends with the sky
  vec3 fogc = mix(uFogColor, uFogSunColor, clamp((pow(sd, 6.0) + 0.45 * pow(sd, 2.0)) * uFogSun, 0.0, 1.0));
  float hz = exp(-max(h, 0.0) * mix(26.0, 5.0, uFogAmt));
  col = mix(col, fogc, clamp(hz, 0.0, 1.0));
  if (h < 0.0) col = mix(fogc, fogc * 0.55, 1.0 - smoothstep(-0.4, 0.0, h));
  gl_FragColor = vec4(min(max(col, vec3(0.0)), vec3(48.0)), 1.0);
}`;

/** Sky dome + image-based-lighting environment generated from the same shader. */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private dirty = true;
  private lastEnv = 0;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true,
      uniforms: {
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
        uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uSunDir: U.uSunDir, uLightColor: { value: new THREE.Color() },
        uMoonDir: { value: new THREE.Vector3(-0.42, 0.62, -0.35).normalize() },
        uCloud: { value: 0.3 }, uOvercast: { value: 0 }, uStars: { value: 0 }, uSunDisc: { value: 1 }, uMoon: { value: 0 },
        uNight: { value: 0 }, uFogAmt: { value: 0.3 }, uFogSun: { value: 0.5 }, uSeed: { value: 1 },
      },
    });
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.scale.setScalar(50000);
    scene.add(this.mesh);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const envMesh = new THREE.Mesh(geo, this.material);
    envMesh.scale.setScalar(100);
    this.envScene.add(envMesh);
  }

  apply(a: AtmoState, p: Params) {
    const u = this.material.uniforms;
    u.uZenith.value.copy(a.zenith);
    u.uHorizon.value.copy(a.horizon);
    u.uGlow.value.copy(a.sunGlow);
    u.uLightColor.value.copy(a.lightColor);
    u.uCloud.value = a.cloudCoverage;
    u.uOvercast.value = a.overcast;
    u.uStars.value = a.starVisibility;
    u.uSunDisc.value = a.sunDisc;
    u.uMoon.value = a.moon;
    u.uNight.value = a.night;
    u.uFogAmt.value = p.fogDensity;
    u.uFogSun.value = a.fogSun;
    u.uSeed.value = (p.seed % 97) + 1;
    this.dirty = true;
  }

  /** Re-bake the IBL environment (throttled). Returns true if it re-rendered. */
  update(now: number, quality: number, force = false): boolean {
    if (!this.dirty || (!force && now - this.lastEnv < 140)) return false;
    this.dirty = false;
    this.lastEnv = now;
    // hide the sun disc in the env bake: the directional light already provides its specular
    const u = this.material.uniforms;
    const disc = u.uSunDisc.value;
    u.uSunDisc.value = disc * 0.12;
    const old = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene, quality > 1 ? 0.012 : 0.03, 1, 500);
    u.uSunDisc.value = disc;
    this.scene.environment = this.envTarget.texture;
    old?.dispose();
    return true;
  }

  follow(camera: THREE.Camera) { this.mesh.position.copy(camera.position); }

  dispose() { this.pmrem.dispose(); this.envTarget?.dispose(); this.material.dispose(); this.mesh.geometry.dispose(); }
}
