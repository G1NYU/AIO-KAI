/** Request a larger version of the SAME known Google album image. Never
 * guess an unrelated album, rewrite signed URLs, or upscale local artwork. */
export function expandedArtwork(original: string, target = 1024): string {
  let url: URL;
  try { url = new URL(original); } catch { return original; }
  if (url.protocol !== 'https:' || url.hostname !== 'lh3.googleusercontent.com'
    || url.port || url.username || url.password || url.search || url.hash) return original;
  const size = /=w(\d{1,4})-h(\d{1,4})(?=-|$)/.exec(url.pathname);
  if (size) {
    const w = Number(size[1]), h = Number(size[2]), largest = Math.max(w, h);
    if (w <= 0 || h <= 0 || largest >= target) return original;
    const scale = target / largest;
    url.pathname = url.pathname.replace(size[0], '=w' + Math.round(w * scale) + '-h' + Math.round(h * scale));
    return url.href;
  }
  const square = /=s(\d{1,4})(?=-|$)/.exec(url.pathname);
  if (square && Number(square[1]) > 0 && Number(square[1]) < target) {
    url.pathname = url.pathname.replace(square[0], '=s' + target);
    return url.href;
  }
  return original;
}

/** Retry the same image at an intermediate size before the thumbnail. */
export function artworkCandidates(original: string): string[] {
  return [...new Set([expandedArtwork(original), expandedArtwork(original, 544), original])];
}
