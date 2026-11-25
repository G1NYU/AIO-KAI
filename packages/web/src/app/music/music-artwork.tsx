import React from 'react';
import { BrushDisc } from '@/components/tsugi-icons';
import { artworkCandidates, artworkAcceptable, ArtworkChoiceCache } from '@/lib/music/artwork';

const choices = new ArtworkChoiceCache();

/** Choose resolution by rendered context; retry a same-image variant on a
 * failed or implausibly small decode. Local and signed images remain intact. */
export function MusicArtwork({ source, className, target = 1024, loading = 'eager' }: {
  source: string; className: string; target?: number; loading?: 'eager' | 'lazy';
}) {
  return <ArtworkImage key={source + ':' + target} source={source} className={className} target={target} loading={loading} />;
}
function ArtworkImage({ source, className, target, loading }: {
  source: string; className: string; target: number; loading: 'eager' | 'lazy';
}) {
  const [candidates] = React.useState(() => {
    const all = artworkCandidates(source, target);
    const remembered = choices.get(source, target);
    return remembered && all.includes(remembered) ? [remembered, ...all.filter(url => url !== remembered)] : all;
  });
  const [attempt, setAttempt] = React.useState(0);
  const current = candidates[attempt];
  const retry = () => setAttempt(value => value === attempt ? value + 1 : value);
  if (!current) return <span aria-hidden className={className + ' grid place-items-center'} style={{background:'var(--tsugi-surface)',color:'var(--tsugi-muted)'}}><BrushDisc className="size-1/3" /></span>;
  return <img key={current} src={current} alt="" draggable={false} referrerPolicy="no-referrer"
    loading={loading} decoding="async" className={className} onError={retry}
    onLoad={event => {
      const { naturalWidth, naturalHeight } = event.currentTarget;
      if (!artworkAcceptable(current, source, naturalWidth, naturalHeight, target)) retry();
      else choices.remember(source, target, current);
    }} />;
}
