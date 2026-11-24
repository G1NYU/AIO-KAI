import type { SVGProps } from 'react';

/** Original solid Tsugi glyphs: compact seal-like silhouettes, angular folds,
 * and negative-space details. Inherit the foreground, including theme changes. */
type Props = SVGProps<SVGSVGElement>;
function glyph(d: string) {
  return function TsugiGlyph(props: Props) {
    return (
      <svg viewBox="0 0 24 24" width="1em" height="1em"
        fill="currentColor" aria-hidden="true" {...props}>
        <path d={d} fillRule="evenodd" clipRule="evenodd" />
      </svg>
    );
  };
}

// SVG path geometry is machine data, never user-facing translatable text.
/* eslint-disable lingui/no-unlocalized-strings */
export const TsugiFilmIcon = glyph('M2 5H22V19H2ZM4 7V9H6V7ZM4 11V13H6V11ZM4 15V17H6V15ZM18 7V9H20V7ZM18 11V13H20V11ZM18 15V17H20V15ZM9 8V16L16 12Z');
export const TsugiMusicIcon = glyph('M2 12A10 10 0 0 1 22 12V18L19 21H15V12H19A7 7 0 0 0 5 12H9V21H5L2 18Z');
export const TsugiReadIcon = glyph('M2 4H8L12 7L16 4H22V19H16L12 22L8 19H2ZM4 7V17H8L11 19V9L8 7ZM13 9V19L16 17H20V7H16Z');
export const TSUGI_NAV_ICONS = {
  home: glyph('M1 11L12 2L23 11H20V21H14V14H10V21H4V11Z'),
  music: TsugiMusicIcon,
  discover: glyph('M12 1L23 12L12 23L1 12ZM8 8L6 18L16 16L18 6Z M10 10L14 10L14 14L10 14Z'),
  search: glyph('M10 2A8 8 0 1 1 10 18A8 8 0 1 1 10 2ZM10 5A5 5 0 1 0 10 15A5 5 0 1 0 10 5ZM15 17L17 15L23 21L21 23Z'),
  favourites: glyph('M12 22L3.2 14A6.2 6.2 0 0 1 12 5.3A6.2 6.2 0 0 1 20.8 14Z'),
  live: glyph('M2 7H22V21H2ZM7 9V19H17V9ZM6 3L8 1L12 5L16 1L18 3L12 9ZM10 11L15 14L10 17Z'),
  calendar: glyph('M2 5H6V2H9V5H15V2H18V5H22V22H2ZM4 10V20H20V10ZM6 12H9V15H6ZM11 12H14V15H11ZM16 12H19V15H16ZM6 16H9V19H6ZM11 16H14V19H11Z'),
  activity: glyph('M2 3H5V7A10 10 0 1 1 3 16L6 15A7 7 0 1 0 7 8H11V11H2ZM11 7H14V12L18 14L16 17L11 14Z'),
  playlists: glyph('M2 4H22V7H2ZM2 10H17V13H2ZM2 16H12V19H2ZM15 14L23 19L15 24Z'),
  party: glyph('M12 1L17 6L12 11L7 6ZM6 10L11 15V22H1V15ZM18 10L23 15V22H13V15Z'),
  downloads: glyph('M10 2H14V12L18 8L21 11L12 20L3 11L6 8L10 12ZM2 19H5V21H19V19H22V24H2Z'),
  settings: glyph('M12 1L16 4L21 4L20 9L23 12L20 16L20 21L15 20L12 23L8 20L3 20L4 15L1 12L4 8L4 3L9 4ZM12 7L17 12L12 17L7 12Z'),
  'switch-user': glyph('M2 5H15V1L22 7L15 13V9H2ZM22 15H9V11L2 17L9 23V19H22Z'),
} as const;
/* eslint-enable lingui/no-unlocalized-strings */
