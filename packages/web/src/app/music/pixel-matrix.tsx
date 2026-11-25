import React from 'react';

export type MatrixMode = 'off' | 'minimal' | 'immersive';

/** Actual local Web Audio bins when available; otherwise an abstract ambient field.
 * Never infer a spectrum from playback time or capture system audio. */
export function PixelMatrix({ mode, accent, paused, analyser }: {
  mode: Exclude<MatrixMode, 'off'>; accent: string; paused: boolean; analyser?: AnalyserNode | null;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    let frame = 0;
    let last = -Infinity;
    let width = 0, height = 0;
    const paint = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      const step = Math.max(mode === 'immersive' ? 15 : 23, Math.ceil(Math.sqrt(width * height / 3200)));
      const columns = Math.ceil(width / step);
      const rows = Math.ceil(height / step);
      if (bins && analyser && analyser.context.state === 'running' && !paused && !reduced.matches) analyser.getByteFrequencyData(bins);
      else bins?.fill(0);
      ctx.fillStyle = accent;
      const phase = time / 1700;
      for (let x = 0; x < columns; x++) {
        const energy = bins ? bins[Math.min(bins.length - 1, Math.floor(x / columns * bins.length * .65))] / 255 : 0;
        for (let y = 0; y < rows; y++) {
          const nx = x / columns, ny = y / rows;
          const wave = .5 + .5 * Math.sin(nx * 11 + ny * 7 + phase + Math.sin(ny * 6 - phase));
          const edge = .28 + .72 * Math.min(1, Math.abs(nx - .5) * 1.9 + Math.abs(ny - .5) * .85);
          const strength = bins ? .08 + energy * Math.max(0, 1 - Math.abs(ny - .5) / (.08 + energy * .5)) : wave * wave;
          ctx.globalAlpha = (mode === 'immersive' ? .26 : .09) * edge * strength;
          ctx.fillRect(x * step, y * step, Math.max(2, step * .36), Math.max(2, step * .36));
        }
      }
      ctx.globalAlpha = 1;
    };
    const loop = (time: number) => {
      if (time - last >= 1000 / 24) { paint(time); last = time; }
      frame = requestAnimationFrame(loop);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (document.hidden) return;
      if (paused || reduced.matches) paint(0);
      else { last = -Infinity; frame = requestAnimationFrame(loop); }
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    sync();
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', sync);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reduced.removeEventListener('change', sync);
    };
  }, [mode, accent, paused, analyser]);
  return <canvas ref={ref} className="tsugi-matrix" data-ui="tsugi-pixel-matrix" aria-hidden="true" />;
}
