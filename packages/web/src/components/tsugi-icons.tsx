import type { SVGProps } from 'react';

/** Original geometric line glyphs inspired by folded paper and Japanese
 * seals, with familiar silhouettes at small navigation sizes. */
type Props = SVGProps<SVGSVGElement>;
function glyph(d: string) {
  return function TsugiGlyph(props: Props) {
    return (
      <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none"
        stroke="currentColor" strokeWidth="1.55" strokeLinecap="round"
        strokeLinejoin="round" aria-hidden="true" {...props}>
        <path d={d} />
      </svg>
    );
  };
}
export const TsugiFilmIcon = glyph('M3 5H21V19H3Z M7 5V19M17 5V19M3 10H7M3 14H7M17 10H21M17 14H21M10 9L15 12L10 15Z');
export const TsugiMusicIcon = glyph('M4 13V11A8 8 0 0 1 20 11V13 M4 13H7L8 15V20H5L4 18Z M20 13H17L16 15V20H19L20 18Z');
export const TSUGI_NAV_ICONS = {
  home: glyph('M3 11L12 3L21 11M5 10V20H19V10M9 20V14H15V20M3 11H21'),
  music: TsugiMusicIcon,
  discover: glyph('M12 2.5L21.5 12L12 21.5L2.5 12Z M9 9L16 8L15 15L8 16Z M12 2.5V5M21.5 12H19M12 21.5V19M2.5 12H5'),
  search: glyph('M16.5 10A6.5 6.5 0 1 1 3.5 10A6.5 6.5 0 1 1 16.5 10 M15 15L21 21'),
  favourites: glyph('M12 21L4.5 13.5A5.2 5.2 0 0 1 12 6.5A5.2 5.2 0 0 1 19.5 13.5Z'),
  live: glyph('M4 7H20V19H4Z M8 3L12 7L16 3M10 10L15 13L10 16Z'),
  calendar: glyph('M4 6H20V21H4Z M8 3V8M16 3V8M4 11H20M8 15H10M14 15H16M8 18H10'),
  activity: glyph('M4 12A8 8 0 1 1 7 18.2 M4 5V12H10 M12 7V12L16 14'),
  playlists: glyph('M4 5H20M4 10H16M4 15H12M4 20H12M17 14L21 17L17 20Z'),
  party: glyph('M12 3L16 7L12 11L8 7Z M3 20V16L7 12L11 16V20M13 20V16L17 12L21 16V20M3 20H21'),
  downloads: glyph('M12 3V15M7 10L12 15L17 10M4 16V21H20V16'),
  settings: glyph('M12 2.5L15 5.5L19 6L18.5 10L21.5 12L18.5 15L19 19L15 18.5L12 21.5L9 18.5L5 19L5.5 15L2.5 12L5.5 9L5 5L9 5.5Z M12 8.5L15.5 12L12 15.5L8.5 12Z'),
  'switch-user': glyph('M4 7H20M16 3L20 7L16 11M20 17H4M8 13L4 17L8 21'),
} as const;
