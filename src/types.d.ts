declare module 'n8ao' {
  import type { Scene, Camera, Color } from 'three';
  export class N8AOPostPass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    enabled: boolean;
    configuration: {
      aoRadius: number; distanceFalloff: number; intensity: number; color: Color; aoSamples: number; denoiseSamples: number;
      denoiseRadius: number; halfRes: boolean; screenSpaceRadius: boolean; gammaCorrection: boolean; depthAwareUpsampling: boolean;
      [k: string]: unknown;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(w: number, h: number): void;
  }
}
