import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, DepthOfFieldEffect, SMAAEffect, SMAAPreset, Effect, BlendFunction, EdgeDetectionMode,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { Params } from '../state/params';
import type { AtmoState } from './atmosphere';
import { lerp } from '../util/rng';

const GRADE_FRAG = /* glsl */ `
uniform float uExposure; uniform float uContrast; uniform float uSaturation; uniform float uVignette; uniform float uGrain;
uniform vec3 uTint; uniform float uSplit; uniform float uAspect;
vec3 agxCurve(vec3 x){ vec3 x2 = x*x; vec3 x4 = x2*x2;
  return 15.5*x4*x2 - 40.14*x4*x + 31.96*x4 - 6.868*x2*x + 0.4298*x2 + 0.1191*x - 0.00232; }
vec3 agx(vec3 v){
  const mat3 m = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  v = m * max(v, vec3(0.0));
  v = clamp(log2(max(v, vec3(1e-10))), -12.47393, 4.026069);
  v = (v + 12.47393) / 16.5;
  return agxCurve(v);
}
vec3 agxEotf(vec3 v){
  const mat3 mi = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  return mi * v;
}
float gh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
  vec3 c = inputColor.rgb * uExposure;
  c = agx(c);                                   // display-referred, gamma-like 0..1
  // filmic look: contrast pivoted on mid grey, then saturation
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = pow(max(c, vec3(0.0)), vec3(mix(0.9, 1.8, uContrast)));
  c *= mix(1.15, 1.08, uContrast);
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = l + (c - l) * mix(0.0, 2.6, uSaturation);
  // split toning: cool shadows, warm highlights
  c += uSplit * (vec3(-0.012, 0.004, 0.022) * (1.0 - smoothstep(0.0, 0.45, l)) + vec3(0.02, 0.008, -0.016) * smoothstep(0.5, 1.0, l));
  c *= uTint;
  c = agxEotf(c);
  vec2 q = (uv - 0.5) * vec2(min(uAspect, 1.8) / 1.8 + 0.0, 1.0) * 2.0;
  float vg = smoothstep(0.55, 1.75, length(q));
  c *= 1.0 - uVignette * 0.75 * vg;
  float g = gh(uv * resolution.xy + fract(time) * 100.0) - 0.5;
  c += g * uGrain * 0.07 * (1.0 - 0.6 * l);
  c = clamp(c, 0.0, 1.0);
  outputColor = vec4(pow(c, vec3(2.2)), 1.0);    // back to linear; the composer encodes sRGB
}`;

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE_FRAG, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, THREE.Uniform>([
        ['uExposure', new THREE.Uniform(1)], ['uContrast', new THREE.Uniform(0.5)], ['uSaturation', new THREE.Uniform(0.5)],
        ['uVignette', new THREE.Uniform(0.3)], ['uGrain', new THREE.Uniform(0.1)], ['uTint', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['uSplit', new THREE.Uniform(1)], ['uAspect', new THREE.Uniform(1.78)],
      ]),
    });
  }
}

/** HDR post pipeline: AO → bloom → depth of field → filmic grade → SMAA. */
export class Post {
  composer: EffectComposer;
  private renderPass: RenderPass;
  private ao: N8AOPostPass;
  private bloom: BloomEffect;
  private dof: DepthOfFieldEffect;
  private grade = new GradeEffect();
  private bloomPass: EffectPass; private dofPass: EffectPass; private gradePass: EffectPass; private smaaPass: EffectPass;
  private msaa = -1;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.ao = new N8AOPostPass(scene, camera);
    const c = this.ao.configuration;
    c.aoRadius = 7; c.distanceFalloff = 1.2; c.intensity = 2.4; c.halfRes = true; c.screenSpaceRadius = false; c.gammaCorrection = false;
    c.depthAwareUpsampling = true; c.color = new THREE.Color(0.02, 0.025, 0.04);
    this.composer.addPass(this.ao as any);
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.05, luminanceSmoothing: 0.35, intensity: 0.5, radius: 0.78, levels: 8 });
    this.bloomPass = new EffectPass(camera, this.bloom);
    this.composer.addPass(this.bloomPass);
    this.dof = new DepthOfFieldEffect(camera, { worldFocusDistance: 60, worldFocusRange: 40, bokehScale: 3, resolutionScale: 0.6 });
    this.dofPass = new EffectPass(camera, this.dof);
    this.composer.addPass(this.dofPass);
    this.gradePass = new EffectPass(camera, this.grade);
    this.composer.addPass(this.gradePass);
    this.smaaPass = new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH, edgeDetectionMode: EdgeDetectionMode.COLOR }));
    this.composer.addPass(this.smaaPass);
    // we toggle passes at runtime, so decide explicitly which one presents to the screen
    this.composer.autoRenderToScreen = false;
    this.smaaPass.renderToScreen = true;
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
    this.grade.uniforms.get('uAspect')!.value = w / h;
  }

  apply(p: Params, a: AtmoState, capture = false) {
    const q = capture ? 3 : p.postQuality;
    // night scenes get a photographic exposure lift so lit windows and neon read properly
    const autoExp = lerp(1, 2.6, a.night) * lerp(1, 1.25, a.overcast * (1 - a.night));
    const u = this.grade.uniforms;
    u.get('uExposure')!.value = p.exposure * autoExp * 0.82;
    u.get('uContrast')!.value = p.contrast;
    u.get('uSaturation')!.value = p.saturation;
    u.get('uVignette')!.value = p.vignette;
    u.get('uGrain')!.value = p.filmGrain;
    u.get('uSplit')!.value = 1;
    this.bloom.intensity = p.bloom * lerp(0.9, 1.5, a.night);
    this.bloom.luminanceMaterial.threshold = lerp(1.1, 0.55, a.night);
    this.bloomPass.enabled = q >= 1 && p.bloom > 0.005;
    this.ao.enabled = q >= 2;
    this.ao.setQualityMode(q >= 3 ? 'High' : 'Medium');
    this.ao.configuration.halfRes = q < 3;
    this.dofPass.enabled = p.dof > 0.005 && q >= 1;
    const cm = this.dof.cocMaterial;
    cm.worldFocusDistance = p.focusDistance;
    cm.worldFocusRange = lerp(p.focusDistance * 2.2 + 30, p.focusDistance * 0.35 + 1.5, Math.min(1, p.dof));
    this.dof.bokehScale = lerp(1.2, 5.5, p.dof) * (capture ? 1.6 : 1);
    this.smaaPass.enabled = q >= 1;
    this.smaaPass.renderToScreen = this.smaaPass.enabled;
    this.gradePass.renderToScreen = !this.smaaPass.enabled;
    const msaa = q >= 3 ? 4 : q >= 2 ? 2 : 0;
    if (msaa !== this.msaa) { this.msaa = msaa; this.composer.multisampling = msaa; }
  }

  render(dt: number) { this.composer.render(dt); }
  dispose() { this.composer.dispose(); }
}
