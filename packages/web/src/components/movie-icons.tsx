/* eslint-disable lingui/no-unlocalized-strings -- Local SVG path data and glyph identifiers are not UI copy. */
import type { SVGProps } from 'react';
import './movie-icons.css';

// Original filled silhouettes, with negative space on a shared 24-unit grid.
const shapes = {
  home: 'M2 10.6 12 2.5 22 10.6h-3v10.2h-5.1v-6.5h-3.8v6.5H5V10.6Z',
  discover: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm5.8 4.2-3.6 8-8 3.6 3.6-8Z',
  search: 'M10 2.5a7.5 7.5 0 1 0 4.3 13.6l5.9 5.9 1.9-1.9-5.9-5.9A7.5 7.5 0 0 0 10 2.5Zm0 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z',
  heart: 'M12 21 3.3 12.8C-2.2 7 5.2.8 12 7c6.8-6.2 14.2 0 8.7 5.8Z',
  tv: 'M4 5h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm6 3.5v8l6.5-4Z',
  calendar: 'M5 4h2V2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Zm0 6v8h14v-8Zm2 2h3v2H7Zm7 0h3v2h-3Z',
  history: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.5 4.5h3v5.1l4 2.3-1.5 2.5-5.5-3.2Z',
  refresh: 'M19.4 4.6 22 2v8h-8l3.3-3.3A7 7 0 1 0 19 14h3a10 10 0 1 1-2.6-9.4Z',
  list: 'M3 5h3v3H3Zm5 0h13v3H8ZM3 10.5h3v3H3Zm5 0h13v3H8ZM3 16h3v3H3Zm5 0h13v3H8Z',
  people: 'M8.5 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM1 20v-2a7.5 7.5 0 0 1 15 0v2Zm14-16a3.5 3.5 0 0 1 1 6.8 6 6 0 0 0-1-6.8Zm2 9a6 6 0 0 1 6 6v1h-5v-2a9.5 9.5 0 0 0-1-5Z',
  download: 'M10.5 2.5h3v9.3l3.4-3.4 2.1 2.1-7 7-7-7 2.1-2.1 3.4 3.4ZM3 16h3v3h12v-3h3v6H3Z',
  settings: 'M10 2h4l.7 3 2 .9 2.7-1.6 2 3.5-2.2 2.2v4l2.2 2.2-2 3.5-2.7-1.6-2 .9-.7 3h-4l-.7-3-2-.9-2.7 1.6-2-3.5L4.8 14v-4L2.6 7.8l2-3.5L7.3 6l2-.9ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  grid: 'M3 3h8v8H3Zm10 0h8v8h-8ZM3 13h8v8H3Zm10 0h8v8h-8Z',
  anime: 'M3 4.5h18L19 8H5ZM2 9h20v2.5h-4V22h-3V11.5H9V22H6V11.5H2ZM10.8 2h2.4v2h-2.4Z',
  addons: 'M3 4h6V3a3 3 0 0 1 6 0v1h6v6h-1.3a2.8 2.8 0 0 0 0 5.6H21V22H3v-6.4h1.3a2.8 2.8 0 0 0 0-5.6H3Z',
  stremio: 'M12 2 22 12 12 22 2 12Zm-3 5.5v9l7.5-4.5Z',
  nuvio: 'M3 4.5h5L16 15V4.5h5v15h-5L8 9v10.5H3Z',
  add: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.4 4h2.8v4.6H18v2.8h-4.6V18h-2.8v-4.6H6v-2.8h4.6Z',
  order: 'M4 3h12v3H4Zm0 6h10v3H4Zm0 6h7v3H4Zm14-6h3v8l2-2v4l-3.5 3.5L16 19v-4l2 2Z',
  mdblist: 'M4 3h16a1 1 0 0 1 1 1v17H3V4a1 1 0 0 1 1-1Zm8 3 1.6 3.3 3.6.5-2.6 2.6.6 3.6-3.2-1.7L8.8 16l.6-3.6-2.6-2.6 3.6-.5Z',
  refract: 'M12 2 22 20H2Zm0 5.4L6.8 17h10.4Zm0 4.3 2 3.7h-4Z',
  back: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-.2 4 2 2-2.6 2.6H18v2.8h-6.8l2.6 2.6-2 2L6 12Z',
  forward: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm.2 4-2 2 2.6 2.6H6v2.8h6.8L10.2 16l2 2 5.8-6Z',
  switch: 'M3 7h12V3l6 5.5-6 5.5v-4H3Zm18 10H9v4l-6-5.5L9 10v4h12Z',
} as const;
export type MovieGlyphName = keyof typeof shapes;
export function MovieGlyph({name,...props}:SVGProps<SVGSVGElement>&{name:MovieGlyphName}){
  return <svg {...props} data-movie-glyph={name} aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="none"><path d={shapes[name]} fillRule="evenodd" clipRule="evenodd"/></svg>;
}
function glyph(name:MovieGlyphName){
  return function Icon(props:SVGProps<SVGSVGElement>){return <MovieGlyph {...props} name={name}/>;};
}
export const MovieIcons={
  home:glyph('home'),discover:glyph('discover'),search:glyph('search'),heart:glyph('heart'),
  tv:glyph('tv'),calendar:glyph('calendar'),history:glyph('history'),refresh:glyph('refresh'),list:glyph('list'),
  people:glyph('people'),download:glyph('download'),settings:glyph('settings'),grid:glyph('grid'),
  anime:glyph('anime'),addons:glyph('addons'),stremio:glyph('stremio'),nuvio:glyph('nuvio'),
  switch:glyph('switch'),back:glyph('back'),forward:glyph('forward'),
};
