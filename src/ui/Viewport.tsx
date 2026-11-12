import { useEffect, useRef } from 'react';
import { Engine } from '../engine/Engine';

/** Full-window WebGL canvas; owns the Engine lifecycle (safe under StrictMode double-mount). */
export function Viewport() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const engine = new Engine(canvas);
    return () => engine.dispose();
  }, []);
  return <canvas ref={ref} className="viewport" tabIndex={-1} onContextMenu={(e) => e.preventDefault()} />;
}
