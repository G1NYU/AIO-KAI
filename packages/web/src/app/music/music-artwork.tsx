import React from 'react';
import { artworkCandidates } from '@/lib/music/artwork';

/** Only the expanded stage requests larger images; lists and mini player
 * continue using their small originals. Failure retries the same image at a smaller size. */
export function MusicArtwork({ source, className }: { source: string; className: string }) {
  return <ArtworkImage key={source} source={source} className={className} />;
}
function ArtworkImage({ source, className }: { source: string; className: string }) {
  const candidates = artworkCandidates(source);
  const [attempt, setAttempt] = React.useState(0);
  return <img src={candidates[Math.min(attempt, candidates.length - 1)]} alt="" draggable={false} referrerPolicy="no-referrer"
    className={className} onError={() => setAttempt(value => Math.min(value + 1, candidates.length - 1))} />;
}
