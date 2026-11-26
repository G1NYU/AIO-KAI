import React from 'react';
import { BrushDisc } from '@/components/tsugi-icons';
import { artworkCandidates, artworkAcceptable, artworkPixelTarget, ArtworkChoiceCache } from '@/lib/music/artwork';

const choices = new ArtworkChoiceCache();

/** Choose resolution by rendered context; retry a same-image variant on a
 * failed or implausibly small decode. Local and signed images remain intact. */
export function MusicArtwork({ source, className, target = 1024, loading = 'eager', responsive = false }: {
  source: string; className: string; target?: number; loading?: 'eager' | 'lazy'; responsive?: boolean;
}) {
  if (responsive) return <ResponsiveArtwork key={source} source={source} className={className} target={target} loading={loading} />;
  return <ArtworkImage key={source + ':' + target} source={source} className={className} target={target} loading={loading} />;
}

function ResponsiveArtwork({ source, className, target, loading }: {
  source: string; className: string; target: number; loading: 'eager' | 'lazy';
}) {
  const [element, setElement] = React.useState<HTMLImageElement | HTMLSpanElement | null>(null);
  const [pixels, setPixels] = React.useState(target);
  const measure = React.useCallback(() => {
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const image = element instanceof HTMLImageElement ? element : null;
    const required = artworkPixelTarget(target, width, height, window.devicePixelRatio, image?.naturalWidth, image?.naturalHeight);
    // Keep a sharper loaded image when the window shrinks. A source change
    // resets this component; enlargement/zoom may request a larger candidate.
    setPixels(current => Math.max(current, required));
  }, [element, target]);
  React.useEffect(() => {
    if (!element) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [element, measure]);
  return <ArtworkImage key={pixels} source={source} className={className} target={pixels} loading={loading}
    elementRef={setElement} onDecoded={measure} />;
}

function ArtworkImage({ source, className, target, loading, elementRef, onDecoded }: {
  source: string; className: string; target: number; loading: 'eager' | 'lazy';
  elementRef?: React.RefCallback<HTMLImageElement | HTMLSpanElement>; onDecoded?: () => void;
}) {
  const [candidates] = React.useState(() => {
    const all = artworkCandidates(source, target);
    const remembered = choices.get(source, target);
    return remembered && all.includes(remembered) ? [remembered, ...all.filter(url => url !== remembered)] : all;
  });
  const [attempt, setAttempt] = React.useState(0);
  const [best, setBest] = React.useState<{ url: string; size: number } | null>(null);
  const exhausted = attempt >= candidates.length;
  const current = candidates[attempt] ?? best?.url;
  const retry = () => setAttempt(value => value === attempt ? value + 1 : value);
  if (!current) return <span ref={elementRef} aria-hidden className={className + ' grid place-items-center'} style={{background:'var(--tsugi-surface)',color:'var(--tsugi-muted)'}}><BrushDisc className="size-1/3" /></span>;
  return <img key={current} ref={elementRef} src={current} alt="" draggable={false} referrerPolicy="no-referrer"
    loading={loading} decoding="async" className={className} onError={() => exhausted ? setBest(null) : retry()}
    onLoad={event => {
      onDecoded?.();
      if (exhausted) return;
      const { naturalWidth, naturalHeight } = event.currentTarget;
      const size = Math.min(naturalWidth, naturalHeight);
      if (size > (best?.size ?? 0)) setBest({ url: current, size });
      if (!artworkAcceptable(current, source, naturalWidth, naturalHeight, target)) retry();
      // If every high-resolution request was undersized or failed, retain the
      // best successful decode instead of replacing it with a smaller original.
      else if (current === source && best && best.size > size) setAttempt(candidates.length);
      else choices.remember(source, target, current, naturalWidth, naturalHeight);
    }} />;
}
