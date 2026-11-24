import React from 'react';
import { expandedArtwork } from '@/lib/music/artwork';

/** Only the expanded stage requests larger images; lists and mini player
 * continue using their small originals. Failure falls back to original once. */
export function MusicArtwork({ source, className }: { source: string; className: string }) {
  return <ArtworkImage key={source} source={source} className={className} />;
}
function ArtworkImage({ source, className }: { source: string; className: string }) {
  const preferred = expandedArtwork(source);
  const [failed, setFailed] = React.useState(false);
  return <img src={failed ? source : preferred} alt="" draggable={false} referrerPolicy="no-referrer"
    className={className} onError={() => { if (preferred !== source) setFailed(true); }} />;
}
