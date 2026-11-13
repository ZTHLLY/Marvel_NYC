import * as THREE from 'three';
import { csmDefines, csmUniforms, injectCsmChunks } from './shadows';

// every lit material reads the sun through the cascade-aware light chunks (see shadows.ts)
injectCsmChunks();

/**
 * Shared uniforms: every material in the world references these objects, so weather,
 * fog and time-of-day update everywhere by mutating a single value.
 */
export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.5, 0.3, 0.5).normalize() },
  uFogColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
  uFogSunColor: { value: new THREE.Color(1, 0.8, 0.6) },
  /** x: base density, y: ground-layer density, z: 1/scale height, w: sun in-scatter amount */
  uFogParams: { value: new THREE.Vector4(0.00002, 0.00008, 1 / 400, 0.6) },
  uSnow: { value: 0 },
  uWet: { value: 0 },
  uNight: { value: 0 },
  uWindowLight: { value: 1 },
  uDetail: { value: 2 },
  uMagic: { value: 0.6 },
  uLandmarkGlow: { value: 1 },
  uReflTex: { value: null as THREE.Texture | null },
  uReflMatrix: { value: new THREE.Matrix4() },
  uReflStrength: { value: 0 },
  uSkyZenith: { value: new THREE.Color() },
  uSkyHorizon: { value: new THREE.Color() },
  uSunColor: { value: new THREE.Color() },
};

export const GLSL_NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm2(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 17.7; a *= 0.5; } return s; }
`;

const FOG_PARS_FRAG = /* glsl */ `
uniform vec3 uFogColor; uniform vec3 uFogSunColor; uniform vec4 uFogParams; uniform vec3 uSunDir;
uniform float uSnow; uniform float uWet; uniform float uNight;
varying vec3 vFogWorld;
vec3 applyCityFog(vec3 col){
  vec3 d = vFogWorld - cameraPosition;
  float L = length(d);
  vec3 rd = d / max(L, 1e-4);
  float a = exp(-max(cameraPosition.y, 0.0) * uFogParams.z);
  float b = exp(-max(vFogWorld.y, 0.0) * uFogParams.z);
  float hInt = abs(d.y) > 1.0 ? (a - b) / (d.y * uFogParams.z) : a;
  float tau = L * (uFogParams.x + uFogParams.y * hInt);
  float f = 1.0 - exp(-tau);
  float sd0 = max(dot(rd, uSunDir), 0.0);
  float s = pow(sd0, 6.0) + 0.45 * sd0 * sd0;
  vec3 fc = mix(uFogColor, uFogSunColor, clamp(s * uFogParams.w, 0.0, 1.0));
  return mix(col, fc, f);
}
`;

const FOG_VERT = /* glsl */ `
{
  vec4 fogWP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fogWP = instanceMatrix * fogWP;
  #endif
  vFogWorld = (modelMatrix * fogWP).xyz;
}
`;

const WEATHER_SURFACE = /* glsl */ `
{
  vec3 wNw = inverseTransformDirection(normal, viewMatrix);
  float up = smoothstep(0.45, 0.8, wNw.y);
  float sn = up * smoothstep(0.02, 0.35, uSnow + (h21(floor(vFogWorld.xz * 1.5)) - 0.5) * 0.25 * step(0.01, uSnow));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.96), sn);
  roughnessFactor = mix(roughnessFactor, 0.9, sn);
  metalnessFactor *= 1.0 - sn;
  float wet = uWet * (1.0 - sn) * (0.35 + 0.65 * up);
  diffuseColor.rgb *= 1.0 - 0.3 * wet * (1.0 - metalnessFactor);
  roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.22), wet);
}
`;

export interface MaterialExt {
  /** unique cache key for this shader variant */
  key: string;
  uniforms?: Record<string, THREE.IUniform>;
  vPars?: string;
  vMain?: string;
  fPars?: string;
  /** runs after normals are resolved: may edit diffuseColor, roughnessFactor, metalnessFactor, normal, totalEmissiveRadiance */
  fSurface?: string;
  /** runs last, on gl_FragColor (before fog) */
  fFinal?: string;
  /** apply generic snow / wetness response */
  weather?: boolean;
  defines?: Record<string, string | number>;
  noFog?: boolean;
}

/** Patch a built-in three material with shared fog + optional shader extensions. */
export function extendMaterial<T extends THREE.Material>(mat: T, ext: MaterialExt = { key: 'std' }): T {
  const anyMat = mat as any;
  anyMat.fog = false;
  anyMat.defines = { ...(anyMat.defines || {}), ...csmDefines, ...(ext.defines || {}) };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uFogParams: U.uFogParams, uSunDir: U.uSunDir,
      uSnow: U.uSnow, uWet: U.uWet, uNight: U.uNight,
    }, csmUniforms, ext.uniforms || {});
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFogWorld;\n${ext.vPars || ''}`)
      .replace('#include <fog_vertex>', `${FOG_VERT}\n${ext.vMain || ''}`);
    let fs = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FOG_PARS_FRAG}\n${GLSL_NOISE}\n${ext.fPars || ''}`);
    const hasNormals = fs.includes('#include <normal_fragment_maps>');
    if (hasNormals && (ext.fSurface || ext.weather)) {
      fs = fs.replace('#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${ext.fSurface || ''}\n${ext.weather ? WEATHER_SURFACE : ''}`);
    }
    fs = fs.replace('#include <fog_fragment>',
      // HDR safety: mirror-like sun glints can exceed half-float range and turn into Inf/NaN that bloom would smear over the frame
      `${ext.fFinal || ''}\n${ext.noFog ? '' : 'gl_FragColor.rgb = applyCityFog(gl_FragColor.rgb);'}\ngl_FragColor.rgb = min(max(gl_FragColor.rgb, vec3(0.0)), vec3(48.0));`);
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'forge:' + ext.key + (ext.weather ? ':w' : '') + (ext.noFog ? ':nf' : '');
  return mat;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

/** Cached PBR material with weather + fog. */
export function pbr(opts: {
  color: THREE.ColorRepresentation; roughness?: number; metalness?: number; emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number; side?: THREE.Side; envMapIntensity?: number; weather?: boolean; flatShading?: boolean;
  transparent?: boolean; opacity?: number;
}): THREE.MeshStandardMaterial {
  const key = JSON.stringify(opts);
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: opts.color, roughness: opts.roughness ?? 0.8, metalness: opts.metalness ?? 0,
      emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 1,
      side: opts.side ?? THREE.FrontSide, envMapIntensity: opts.envMapIntensity ?? 1, flatShading: opts.flatShading ?? false,
      transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1,
    });
    extendMaterial(m, { key: 'pbr', weather: opts.weather ?? true });
    cache.set(key, m);
  }
  return m;
}

/** Unlit emissive material (signs, light sources) that still fogs correctly. */
export function glow(color: THREE.ColorRepresentation, intensity = 1, opts: { map?: THREE.Texture; side?: THREE.Side; transparent?: boolean } = {}) {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  const m = new THREE.MeshBasicMaterial({ color: c, map: opts.map ?? null, side: opts.side ?? THREE.FrontSide, transparent: opts.transparent ?? false, toneMapped: false });
  return extendMaterial(m, { key: 'glow' });
}
