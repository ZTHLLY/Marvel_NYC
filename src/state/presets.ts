import type { Params } from './params';
import { WEATHER_PRESETS } from './params';
import { SITES } from '../landmarks/sites';
import { ll } from '../city/geo';

export interface Bookmark {
  id: string;
  label: string;
  caption: string;
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
  /** scene preset that best suits this view (applied when chosen from the bookmark bar with "match light") */
  preset?: string;
}

const S = SITES;
const P = (lat: number, lon: number, y: number): [number, number, number] => { const [x, z] = ll(lat, lon); return [x, y, z]; };
const off = (site: { x: number; z: number }, dx: number, y: number, dz: number): [number, number, number] => [site.x + dx, y, site.z + dz];

/** Curated cinematic viewpoints. Positions were composed by eye in the running app. */
export const BOOKMARKS: Bookmark[] = [
  { id: 'skyline', label: 'Manhattan Skyline', caption: 'Golden hour across the East River', preset: 'golden',
    pos: P(40.7402, -73.9612, 185), target: P(40.7530, -73.9800, 195), fov: 34 },
  { id: 'avengers', label: 'Avengers Tower', caption: 'Hero shot over Park Avenue', preset: 'avengers',
    pos: off(S.avengers, 300, 215, 520), target: off(S.avengers, 0, 262, 0), fov: 36 },
  { id: 'spidey', label: 'Spider-Man Rooftop', caption: 'A quiet moment above Fifth Avenue', preset: 'spidey',
    pos: off(S.spidey, -4.5, 129.2, 9.5), target: off(S.spidey, 3, 127.2, -12), fov: 40 },
  { id: 'sanctum', label: 'Sanctum Coffee Shop', caption: 'Bleecker Street, Greenwich Village', preset: 'sanctum',
    pos: off(S.sanctum, 14, 1.75, 25), target: off(S.sanctum, 4, 4.2, 6), fov: 38 },
  { id: 'midtown-night', label: 'Midtown Night', caption: 'The skyline after dark', preset: 'midnight',
    pos: P(40.7335, -73.9905, 360), target: P(40.7530, -73.9790, 190), fov: 32 },
  { id: 'riverfront', label: 'Riverfront Panorama', caption: 'Across the East River', preset: 'blue',
    pos: P(40.7452, -73.9618, 9), target: P(40.7522, -73.9770, 135), fov: 44 },
  { id: 'times-square', label: 'Rainy Times Square', caption: 'Neon on wet asphalt', preset: 'rain',
    pos: off(S.timessquare, -18, 2.4, 95), target: off(S.timessquare, 4, 22, -60), fov: 44 },
  { id: 'snow', label: 'Snowy Manhattan', caption: 'Winter over the rooftops', preset: 'snow',
    pos: P(40.7640, -73.9925, 310), target: P(40.7500, -73.9830, 120), fov: 38 },
  { id: 'hudson', label: 'Hudson Waterfront', caption: 'Amber light on the West Side', preset: 'golden',
    pos: P(40.7350, -74.0235, 120), target: P(40.7560, -73.9790, 230), fov: 30 },
  { id: 'overview', label: 'High Altitude', caption: 'The whole island', preset: 'golden',
    pos: P(40.7050, -74.0420, 3100), target: P(40.7500, -73.9850, 0), fov: 36 },
  { id: 'baxter', label: 'Baxter Building', caption: 'Home of the Fantastic Four', preset: 'blue',
    pos: off(S.baxter, -210, 150, 260), target: off(S.baxter, 0, 150, 0), fov: 38 },
  { id: 'bugle', label: 'Daily Bugle', caption: 'Stop the presses', preset: 'golden',
    pos: off(S.bugle, 160, 120, 190), target: off(S.bugle, 0, 112, 0), fov: 38 },
];

export interface ScenePreset {
  id: string;
  label: string;
  caption: string;
  bookmark: string;
  params: Partial<Params>;
}

const grade = (p: Partial<Params>): Partial<Params> => ({
  lightIntensity: 1, colorTemperature: 6500, exposure: 1, contrast: 0.5, saturation: 0.5, bloom: 0.45, ambient: 0.5,
  windowLighting: 0.5, dof: 0, magicIntensity: 0.6, ...p,
});

export const SCENE_PRESETS: ScenePreset[] = [
  { id: 'golden', label: 'MCU Golden Hour', caption: 'Warm sun, long shadows, amber glass', bookmark: 'skyline',
    params: grade({ timeOfDay: 19.45, sunElevation: 8, weather: 'clear', ...WEATHER_PRESETS.clear, cloudCoverage: 0.4, atmosphere: 0.6, fov: 34 }) },
  { id: 'avengers', label: 'Avengers at Sunset', caption: 'The tower against a burning sky', bookmark: 'avengers',
    params: grade({ timeOfDay: 20.0, sunElevation: 2.5, weather: 'clear', ...WEATHER_PRESETS.clear, cloudCoverage: 0.52, atmosphere: 0.7, bloom: 0.55, windowLighting: 0.6, fov: 36 }) },
  { id: 'blue', label: 'New York Blue Hour', caption: 'Deep blue sky, warm windows', bookmark: 'riverfront',
    params: grade({ timeOfDay: 20.7, sunElevation: -5, weather: 'clear', ...WEATHER_PRESETS.clear, cloudCoverage: 0.3, atmosphere: 0.5, bloom: 0.55, exposure: 1.05, fov: 46 }) },
  { id: 'midnight', label: 'Cinematic Midnight', caption: 'A city that never sleeps', bookmark: 'midtown-night',
    params: grade({ timeOfDay: 0.2, sunElevation: -18, weather: 'clear', ...WEATHER_PRESETS.clear, cloudCoverage: 0.25, fogDensity: 0.34, bloom: 0.6, contrast: 0.56, fov: 32 }) },
  { id: 'rain', label: 'Rainy Manhattan', caption: 'Wet asphalt and neon', bookmark: 'times-square',
    params: grade({ timeOfDay: 22.5, sunElevation: -18, weather: 'rain', ...WEATHER_PRESETS.rain, bloom: 0.7, contrast: 0.55, saturation: 0.56, fov: 44 }) },
  { id: 'snow', label: 'Snowy New York', caption: 'Rooftops under fresh snow', bookmark: 'snow',
    params: grade({ timeOfDay: 16.2, sunElevation: 14, weather: 'snow', ...WEATHER_PRESETS.snow, colorTemperature: 7200, saturation: 0.44, fov: 38 }) },
  { id: 'spidey', label: 'Spider-Man Rooftop', caption: 'Your friendly neighborhood sunset', bookmark: 'spidey',
    params: grade({ timeOfDay: 19.75, sunElevation: 5, weather: 'clear', ...WEATHER_PRESETS.clear, cloudCoverage: 0.48, atmosphere: 0.68, bloom: 0.5, dof: 0.22, focusDistance: 4.6, fov: 44 }) },
  { id: 'sanctum', label: 'Sanctum Coffee Shop', caption: 'A sorcerer on his coffee break', bookmark: 'sanctum',
    params: grade({ timeOfDay: 20.55, sunElevation: -3.5, weather: 'clear', ...WEATHER_PRESETS.clear, wetness: 0.45, cloudCoverage: 0.35, bloom: 0.6, exposure: 1.1, dof: 0.1, focusDistance: 5.0, fov: 46, magicIntensity: 0.8 }) },
  { id: 'fog', label: 'Foggy Morning', caption: 'Layered silhouettes in the mist', bookmark: 'hudson',
    params: grade({ timeOfDay: 7.4, sunElevation: 17, weather: 'fog', ...WEATHER_PRESETS.fog, saturation: 0.42, fov: 30 }) },
  { id: 'overcast', label: 'Overcast Day', caption: 'Soft light, architectural clarity', bookmark: 'overview',
    params: grade({ timeOfDay: 13.5, sunElevation: 62, weather: 'overcast', ...WEATHER_PRESETS.overcast, saturation: 0.46, bloom: 0.25, fov: 36 }) },
];
