/**
 * Scene parameter model. This is the single source of truth for everything the
 * user can tweak; the UI is generated from CONTROL_SCHEMA and the engine reacts to changes.
 */

export type WeatherKind = 'clear' | 'overcast' | 'fog' | 'rain' | 'snow';
export type QualityKind = 'low' | 'medium' | 'high' | 'ultra';
export type AspectKind = 'free' | '16:9' | '21:9' | '2.39:1' | '4:3' | '3:2' | '1:1' | '9:16';
export type GuideKind = 'none' | 'thirds' | 'golden' | 'center' | 'diagonal';
export type ResolutionKind = '1080p' | '1440p' | '4k' | 'uw1440' | 'uw2160' | '5k' | '8k';

export interface Params {
  // --- city generation (changes trigger debounced regeneration)
  heightScale: number;
  density: number;
  skylineVariation: number;
  archVariation: number;
  detailLevel: number;
  seed: number;
  // --- environment
  timeOfDay: number;
  weather: WeatherKind;
  fogDensity: number;
  snowCoverage: number;
  wetness: number;
  cloudCoverage: number;
  atmosphere: number;
  // --- lighting & colour
  sunElevation: number;
  lightIntensity: number;
  colorTemperature: number;
  exposure: number;
  contrast: number;
  saturation: number;
  bloom: number;
  ambient: number;
  windowLighting: number;
  // --- marvel
  landmarkVisibility: number;
  marvelDetail: number;
  magicIntensity: number;
  // --- photography
  fov: number;
  dof: number;
  focusDistance: number;
  aspect: AspectKind;
  guides: GuideKind;
  resolution: ResolutionKind;
  vignette: number;
  filmGrain: number;
  // --- performance
  quality: QualityKind;
  shadowQuality: number;
  lodBias: number;
  renderDistance: number;
  textureQuality: number;
  postQuality: number;
  reflections: boolean;
  showFps: boolean;
}

export const DEFAULT_PARAMS: Params = {
  heightScale: 1,
  density: 0.7,
  skylineVariation: 0.5,
  archVariation: 0.75,
  detailLevel: 0.6,
  seed: 1962,
  timeOfDay: 19.45,
  weather: 'clear',
  fogDensity: 0.3,
  snowCoverage: 0,
  wetness: 0,
  cloudCoverage: 0.38,
  atmosphere: 0.55,
  sunElevation: 8,
  lightIntensity: 1,
  colorTemperature: 6500,
  exposure: 1,
  contrast: 0.5,
  saturation: 0.5,
  bloom: 0.45,
  ambient: 0.5,
  windowLighting: 0.5,
  landmarkVisibility: 1,
  marvelDetail: 0.7,
  magicIntensity: 0.6,
  fov: 38,
  dof: 0,
  focusDistance: 60,
  aspect: 'free',
  guides: 'none',
  resolution: '4k',
  vignette: 0.35,
  filmGrain: 0.15,
  quality: 'high',
  shadowQuality: 2,
  lodBias: 1,
  renderDistance: 16,
  textureQuality: 2,
  postQuality: 2,
  reflections: true,
  showFps: false,
};

/** Keys whose change requires rebuilding procedural city geometry. */
export const REGEN_KEYS: (keyof Params)[] = ['heightScale', 'density', 'skylineVariation', 'archVariation', 'seed'];

export type GroupId = 'city' | 'environment' | 'lighting' | 'marvel' | 'photo' | 'performance';

export interface ControlDef {
  key: keyof Params;
  label: string;
  group: GroupId;
  kind: 'slider' | 'select' | 'toggle' | 'seed';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string | number; label: string }[];
  advanced?: boolean;
  hint?: string;
  /** number of decimals to display for sliders */
  digits?: number;
}

export const GROUPS: { id: GroupId; label: string; blurb: string }[] = [
  { id: 'city', label: 'City', blurb: 'Procedural massing of Manhattan. Landmarks & street grid stay fixed.' },
  { id: 'environment', label: 'Environment', blurb: 'Time, weather and atmosphere of the frozen moment.' },
  { id: 'lighting', label: 'Light & Colour', blurb: 'Sun, exposure and the cinematic grade.' },
  { id: 'marvel', label: 'Marvel', blurb: 'Fictional landmarks, signage and easter eggs of a Marvel-flavoured New York.' },
  { id: 'photo', label: 'Photography', blurb: 'Lens, framing and wallpaper export.' },
  { id: 'performance', label: 'Performance', blurb: 'Trade fidelity for frame-rate.' },
];

export const CONTROL_SCHEMA: ControlDef[] = [
  // city
  { key: 'heightScale', label: 'Building Height', group: 'city', kind: 'slider', min: 0.6, max: 1.6, step: 0.01, unit: '×', digits: 2, hint: 'Scales procedural building heights. Real landmarks keep their true height.' },
  { key: 'density', label: 'Building Density', group: 'city', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2, hint: 'Below 0.7 lots are cleared to low-rise; above, infill towers rise.' },
  { key: 'skylineVariation', label: 'Skyline Variation', group: 'city', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2, hint: '0.5 = true Manhattan. Lower flattens, higher exaggerates the peaks.' },
  { key: 'archVariation', label: 'Architectural Variation', group: 'city', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2, hint: 'Diversity of facade styles, materials and roof types.' },
  { key: 'detailLevel', label: 'Building Detail Level', group: 'city', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2, hint: 'Radius and richness of rooftop / facade detail around the camera.' },
  { key: 'seed', label: 'Generation Seed', group: 'city', kind: 'seed', min: 1, max: 9999, step: 1 },
  // environment
  { key: 'timeOfDay', label: 'Time of Day', group: 'environment', kind: 'slider', min: 0, max: 24, step: 0.05, unit: 'h', digits: 2 },
  { key: 'weather', label: 'Weather Preset', group: 'environment', kind: 'select', options: [
    { value: 'clear', label: 'Clear' }, { value: 'overcast', label: 'Overcast' }, { value: 'fog', label: 'Fog' },
    { value: 'rain', label: 'Rain' }, { value: 'snow', label: 'Snow' } ] },
  { key: 'fogDensity', label: 'Fog Density', group: 'environment', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'snowCoverage', label: 'Snow Coverage', group: 'environment', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'wetness', label: 'Wet Surface Intensity', group: 'environment', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'cloudCoverage', label: 'Cloud Coverage', group: 'environment', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'atmosphere', label: 'Atmosphere', group: 'environment', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2, hint: 'Aerial perspective / haze glow toward the sun.' },
  // lighting
  { key: 'sunElevation', label: 'Sun Elevation', group: 'lighting', kind: 'slider', min: -18, max: 75, step: 0.25, unit: '°', digits: 1 },
  { key: 'lightIntensity', label: 'Light Intensity', group: 'lighting', kind: 'slider', min: 0, max: 2, step: 0.01, digits: 2 },
  { key: 'colorTemperature', label: 'Color Temperature', group: 'lighting', kind: 'slider', min: 3000, max: 11000, step: 50, unit: 'K', digits: 0 },
  { key: 'exposure', label: 'Exposure', group: 'lighting', kind: 'slider', min: 0.3, max: 2.5, step: 0.01, digits: 2 },
  { key: 'contrast', label: 'Contrast', group: 'lighting', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'saturation', label: 'Saturation', group: 'lighting', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'bloom', label: 'Bloom Intensity', group: 'lighting', kind: 'slider', min: 0, max: 1.5, step: 0.01, digits: 2 },
  { key: 'ambient', label: 'Ambient Lighting', group: 'lighting', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'windowLighting', label: 'Window Lighting', group: 'lighting', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2 },
  // marvel
  { key: 'landmarkVisibility', label: 'Marvel Landmark Visibility', group: 'marvel', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2, hint: '0 hides the fictional landmarks; higher values strengthen their signature lighting.' },
  { key: 'marvelDetail', label: 'Marvel Environmental Detail', group: 'marvel', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2, hint: 'How many billboards, signs and easter eggs populate the city.' },
  { key: 'magicIntensity', label: 'Magical Effect Intensity', group: 'marvel', kind: 'slider', min: 0, max: 1.5, step: 0.01, digits: 2 },
  // photo
  { key: 'fov', label: 'Field of View', group: 'photo', kind: 'slider', min: 12, max: 100, step: 0.5, unit: '°', digits: 1 },
  { key: 'dof', label: 'Depth of Field', group: 'photo', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2, hint: '0 = everything sharp.' },
  { key: 'focusDistance', label: 'Focus Distance', group: 'photo', kind: 'slider', min: 1, max: 600, step: 0.5, unit: 'm', digits: 1 },
  { key: 'aspect', label: 'Aspect Ratio', group: 'photo', kind: 'select', options: [
    { value: 'free', label: 'Viewport' }, { value: '16:9', label: '16:9' }, { value: '21:9', label: '21:9 Ultrawide' },
    { value: '2.39:1', label: '2.39:1 Scope' }, { value: '3:2', label: '3:2' }, { value: '4:3', label: '4:3' },
    { value: '1:1', label: '1:1' }, { value: '9:16', label: '9:16 Phone' } ] },
  { key: 'guides', label: 'Composition Guides', group: 'photo', kind: 'select', options: [
    { value: 'none', label: 'None' }, { value: 'thirds', label: 'Rule of Thirds' }, { value: 'golden', label: 'Golden Ratio' },
    { value: 'center', label: 'Center Cross' }, { value: 'diagonal', label: 'Diagonals' } ] },
  { key: 'resolution', label: 'Screenshot Resolution', group: 'photo', kind: 'select', options: [
    { value: '1080p', label: '1920 × 1080' }, { value: '1440p', label: '2560 × 1440' }, { value: '4k', label: '3840 × 2160 (4K)' },
    { value: 'uw1440', label: '3440 × 1440 (21:9)' }, { value: 'uw2160', label: '5120 × 2160 (21:9)' },
    { value: '5k', label: '5120 × 2880 (5K)' }, { value: '8k', label: '7680 × 4320 (8K, experimental)' } ] },
  { key: 'vignette', label: 'Vignette', group: 'photo', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2, advanced: true },
  { key: 'filmGrain', label: 'Film Grain', group: 'photo', kind: 'slider', min: 0, max: 1, step: 0.01, digits: 2, advanced: true },
  // performance
  { key: 'quality', label: 'Rendering Quality', group: 'performance', kind: 'select', options: [
    { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' } ] },
  { key: 'shadowQuality', label: 'Shadow Quality', group: 'performance', kind: 'slider', min: 0, max: 3, step: 1, digits: 0, advanced: true },
  { key: 'lodBias', label: 'LOD Bias', group: 'performance', kind: 'slider', min: 0.4, max: 2, step: 0.05, digits: 2, advanced: true },
  { key: 'renderDistance', label: 'Render Distance', group: 'performance', kind: 'slider', min: 3, max: 24, step: 0.5, unit: 'km', digits: 1, advanced: true },
  { key: 'textureQuality', label: 'Texture Quality', group: 'performance', kind: 'slider', min: 0, max: 2, step: 1, digits: 0, advanced: true, hint: 'Facade shader detail, interior parallax, environment resolution.' },
  { key: 'postQuality', label: 'Postprocessing Quality', group: 'performance', kind: 'slider', min: 0, max: 3, step: 1, digits: 0, advanced: true },
  { key: 'reflections', label: 'Planar Reflections', group: 'performance', kind: 'toggle', advanced: true },
  { key: 'showFps', label: 'FPS Display', group: 'performance', kind: 'toggle' },
];

export const RESOLUTIONS: Record<ResolutionKind, [number, number]> = {
  '1080p': [1920, 1080], '1440p': [2560, 1440], '4k': [3840, 2160],
  uw1440: [3440, 1440], uw2160: [5120, 2160], '5k': [5120, 2880], '8k': [7680, 4320],
};

export const ASPECTS: Record<AspectKind, number | null> = {
  free: null, '16:9': 16 / 9, '21:9': 21 / 9, '2.39:1': 2.39, '4:3': 4 / 3, '3:2': 3 / 2, '1:1': 1, '9:16': 9 / 16,
};

export const QUALITY_PRESETS: Record<QualityKind, Partial<Params>> = {
  low: { shadowQuality: 0, lodBias: 0.6, renderDistance: 9, textureQuality: 0, postQuality: 1, reflections: false },
  medium: { shadowQuality: 1, lodBias: 0.85, renderDistance: 13, textureQuality: 1, postQuality: 1, reflections: true },
  high: { shadowQuality: 2, lodBias: 1, renderDistance: 16, textureQuality: 2, postQuality: 2, reflections: true },
  ultra: { shadowQuality: 3, lodBias: 1.4, renderDistance: 22, textureQuality: 2, postQuality: 3, reflections: true },
};

/** Weather preset → the environment sliders it drives. */
export const WEATHER_PRESETS: Record<WeatherKind, Partial<Params>> = {
  clear: { fogDensity: 0.3, snowCoverage: 0, wetness: 0, cloudCoverage: 0.35, atmosphere: 0.55 },
  overcast: { fogDensity: 0.38, snowCoverage: 0, wetness: 0.12, cloudCoverage: 0.97, atmosphere: 0.3 },
  fog: { fogDensity: 0.62, snowCoverage: 0, wetness: 0.25, cloudCoverage: 0.8, atmosphere: 0.85 },
  rain: { fogDensity: 0.55, snowCoverage: 0, wetness: 1, cloudCoverage: 0.95, atmosphere: 0.6 },
  snow: { fogDensity: 0.58, snowCoverage: 0.85, wetness: 0.1, cloudCoverage: 0.9, atmosphere: 0.5 },
};

/** Simple solar model for NYC (declination chosen so sunsets align with the street grid). */
export function sunFromTime(t: number): { az: number; el: number } {
  const lat = (40.75 * Math.PI) / 180, dec = (20 * Math.PI) / 180;
  const H = ((t - 13) * 15 * Math.PI) / 180;
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(sinEl);
  // azimuth measured clockwise from north
  const y = -Math.sin(H) * Math.cos(dec);
  const x = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(H);
  let az = Math.atan2(y, x);
  if (az < 0) az += Math.PI * 2;
  return { az, el: (el * 180) / Math.PI };
}
