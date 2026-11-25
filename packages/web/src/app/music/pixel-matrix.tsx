import React from 'react';

import type { MatrixMode } from '@/lib/music/player-layout';
export type { MatrixMode } from '@/lib/music/player-layout';

/** Local PCM waveform or a time history of measured native RMS levels.
 * The native envelope is not a fabricated spectrum or reconstructed PCM.
 * No reactive mode is synthesized for unsupported streams. */
export function PixelMatrix({ mode, accent, paused, analyser, nativeMeter }: {
  mode: Exclude<MatrixMode, 'off'>; accent: string; paused: boolean; analyser?: AnalyserNode | null;
  nativeMeter?: React.RefObject<{level:number;at:number} | null>;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const pcm = analyser ? new Uint8Array(analyser.fftSize) : null;
    const history = new Float32Array(84);
    let sampleAt = -1;
    let frame = 0, last = -Infinity, width = 0, height = 0;
    const paint = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      const moving = !paused && !reduced.matches;
      const local = !!(analyser && analyser.context.state === 'running');
      const sample = nativeMeter?.current;
      const valid = moving && sample != null && performance.now() - sample.at < 650;
      if (valid && sample.at !== sampleAt) {
        history.copyWithin(0, 1); history[history.length - 1] = sample.level; sampleAt = sample.at;
      }
      if (!valid && !local) history.fill(0);
      if (local && moving && bins && pcm && analyser) {
        analyser.getByteFrequencyData(bins);
        analyser.getByteTimeDomainData(pcm);
      } else { bins?.fill(0); pcm?.fill(128); }
      ctx.fillStyle = accent;
      if (mode === 'wave') {
        // A wide, dotted audio ribbon across the lower stage. Local PCM draws
        // a signed wave; native RMS samples form a mirrored level envelope.
        const center = height * .82, amplitude = height * .16;
        const cols = Math.max(32, Math.min(140, Math.floor(width / 12)));
        for (let x = 0; x < cols; x++) {
          const fraction = x / (cols - 1);
          const level = pcm && local ? (pcm[Math.floor(fraction * (pcm.length - 1))] - 128) / 128 : history[Math.floor(fraction * (history.length - 1))];
          const value = Math.min(1, Math.abs(level));
          const maxDots = Math.ceil(value * 13);
          const xpos = fraction * (width - 18) + 9;
          if (!moving || (!local && !valid)) {
            ctx.globalAlpha = .12; ctx.fillRect(xpos, center, 3, 3); continue;
          }
          for (let k = -maxDots; k <= maxDots; k++) {
            ctx.globalAlpha = .17 + .64 * (1 - Math.abs(k) / (maxDots + 1));
            const offset = local ? level * amplitude * .75 : 0;
            ctx.fillRect(xpos, center + offset + k * amplitude / 13, 4, 4);
          }
        }
      } else {
        const immersive = mode === 'immersive';
        const step = Math.max(immersive ? 17 : 30, Math.ceil(Math.sqrt(width * height / 3000)));
        const columns = Math.ceil(width / step), rows = Math.ceil(height / step);
        const phase = moving ? time / 640 : 0;
        for (let x = 0; x < columns; x++) {
          const energy = local && bins ? bins[Math.min(bins.length - 1, Math.floor(x / columns * bins.length * .65))] / 255 : valid ? sample.level : 0;
          for (let y = immersive ? 0 : Math.floor(rows * .72); y < rows; y++) {
            const nx = x / columns, ny = y / rows;
            const wave = .5 + .5 * Math.sin(nx * 13 + ny * 9 + phase + 1.5 * Math.sin(ny * 6 - phase * .72));
            // Retain a traveling field even with steady RMS/FFT samples.
            // Audio controls intensity; phase supplies visible spatial motion.
            const strength = Math.min(1, wave * wave * (.65 + energy * .75));
            ctx.globalAlpha = immersive ? .13 + .75 * strength : .045 + .17 * strength;
            const size = immersive ? 2 + 5 * strength : 2;
            const drift = immersive && moving ? 2.4 * Math.sin(phase + nx * 8 + ny * 5) : 0;
            ctx.fillRect(x * step + drift, y * step - drift, size, size);
          }
        }
      }
      ctx.globalAlpha = 1;
    };
    const loop = (time: number) => {
      if (time - last >= 1000 / 24) { paint(time); last = time; }
      frame = requestAnimationFrame(loop);
    };
    const sync = () => {
      cancelAnimationFrame(frame); frame = 0;
      if (document.hidden) return;
      if (paused || reduced.matches) paint(0);
      else { last = -Infinity; frame = requestAnimationFrame(loop); }
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width)); height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); paint(0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas); resize(); sync();
    document.addEventListener('visibilitychange', sync); reduced.addEventListener('change', sync);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      document.removeEventListener('visibilitychange', sync); reduced.removeEventListener('change', sync);
    };
  }, [mode, accent, paused, analyser, nativeMeter]);
  return <canvas ref={ref} className="tsugi-matrix" data-ui="tsugi-pixel-matrix" data-mode={mode} aria-hidden="true" />;
}
