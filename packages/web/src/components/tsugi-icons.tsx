/* eslint-disable lingui/no-unlocalized-strings -- SVG path data and glyph identifiers are not UI copy. */
import type { SVGProps } from 'react';

/** Tsugi's compact, gently tapered outline family. The filled wedges give
 * direction and transport icons a brush-like terminal without compromising legibility. */
const paths = {
  video: 'M5 5.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z',
  music: 'M4 14v-3a8 8 0 0 1 16 0v3M4 12h2.5a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 6.5 19H5a1 1 0 0 1-1-1ZM20 12h-2.5a1.5 1.5 0 0 0-1.5 1.5v4A1.5 1.5 0 0 0 17.5 19H19a1 1 0 0 0 1-1Z',
  book: 'M12 6C9 4 6 4 3.5 5.5v13C7 17 9.5 17.5 12 19c2.5-1.5 5-2 8.5-.5v-13C18 4 15 4 12 6Zm0 0v13M6.5 8.5l3 .5M14.5 9l3-.5',
  home: 'M3.5 11.5 12 4l8.5 7.5M6 10v10h12V10M10 20v-6h4v6',
  compass: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM15.5 15.5 21 21',
  grid: 'M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6Z',
  history: 'M4 11a8 8 0 1 1 2 6M4 5v6h6M12 7.5V12l3 2',
  bell: 'M5 17c2-2 2-4 2-7a5 5 0 0 1 10 0c0 3 0 5 2 7ZM10 20h4',
  folder: 'M3.5 7a1.5 1.5 0 0 1 1.5-1.5h5l2 2h7a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18Z',
  migrate: 'M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4',
  repeat: 'M17 3l4 4-4 4M21 7H7a3 3 0 0 0-3 3v2M7 21l-4-4 4-4m-4 4h14a3 3 0 0 0 3-3v-2',
  sliders: 'M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-6 2v4',
  folderPlus: 'M3.5 7A1.5 1.5 0 0 1 5 5.5h5l2 2h7a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18ZM12 10.5v6m-3-3h6',
  plus: 'M12 5v14M5 12h14',
  settings: 'M9 3.5h6l.7 3 2.7 1.5 2.9-.8 1.2 4.8-2.2 2 .1 3-2.8 2.5-2.7-1.3-2.9 1.6-2.9-1.6-2.7 1.3-2.8-2.5.1-3-2.2-2 1.2-4.8 2.9.8 2.7-1.5ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  plug: 'M8 3.5v5m8-5v5M5 8.5h14M7 8.5V12a5 5 0 0 0 10 0V8.5M12 17v4',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.1M4 12h.1M4 18h.1',
  bookmark: 'M6 4h12v16l-6-4-6 4Z',
  heart: 'M12 20 4.5 12.5C-.5 7 7 2.5 12 8c5-5.5 12.5-1 7.5 4.5Z',
  calendar: 'M4 6h16v14H4ZM4 10h16M8 3.5v5m8-5v5M8 14h.1m4 0h.1m4 0h.1',
  people: 'M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20v-2a6 6 0 0 1 12 0v2M16 5.5a3.5 3.5 0 0 1 0 6.5m1 2a5 5 0 0 1 4 5',
  download: 'M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4',
  vault: 'M6.5 21a5 5 0 0 1-1-9.9A6.8 6.8 0 0 1 18.7 9a6 6 0 0 1-.7 12H6.5ZM8 12a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1ZM11.4 14a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 0 0-2.2 0ZM9.8 13v2',
  disc: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm0 6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  play: '', pause: '', previous: 'M5 6v12', next: 'M19 6v12',
  back: 'M20 12H5m6-6-6 6 6 6',
  left: 'm15 5-7 7 7 7', right: 'm9 5 7 7-7 7', down: 'm5 9 7 7 7-7',
  check: 'm4.5 12 5 5 10-10', close: 'm6 6 12 12M18 6 6 18',
  expand: 'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5',
  shrink: 'M4 9h5V4m11 5h-5V4M9 20v-5H4m11 5v-5h5',
  minus: 'M5 12h14',
  refresh: 'M20 10a8 8 0 1 0-2 8M20 4v6h-6',
  shuffle: 'M4 6h2c4 0 8 12 12 12h2m-3-3 3 3-3 3M4 18h2c4 0 8-12 12-12h2m-3-3 3 3-3 3',
  lyrics: 'M4 5h16v12h-9l-5 4v-4H4ZM8 9h8m-8 4h5',
  trash: 'M4 6h16M9 6V3.5h6V6M6 6l1 14h10l1-14M10 10v6m4-6v6',
  file: 'M5 3.5h9l5 5V21H5ZM14 3.5V9h5M9 15h6m-3-3v6',
} as const;
export type TsugiIconName = keyof typeof paths;
export function TsugiIcon({ name, ...props }: Omit<SVGProps<SVGSVGElement>, 'name'> & { name: TsugiIconName }) {
  const wedge = name === 'video' ? 'M10 9l5.5 3-5.5 3Z' : name === 'compass' ? 'm15.8 8.2-2.4 5.2-5.2 2.4 2.4-5.2Z' : name === 'play' ? 'M7 4.5 20 12 7 19.5Z' : name === 'previous' ? 'M18 5.5 7 12l11 6.5Z' : name === 'next' ? 'M6 5.5 17 12 6 18.5Z' : name === 'pause' ? 'M7 5h3v14H7Zm7 0h3v14h-3Z' : '';
  return <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {paths[name] && <path d={paths[name]} />}
    {wedge && <path d={wedge} fill="currentColor" stroke="none" />}
  </svg>;
}
export function tsugiIcon(name: TsugiIconName) {
  return function Icon(props: Omit<SVGProps<SVGSVGElement>, 'name'>) { return <TsugiIcon {...props} name={name} />; };
}
export const BrushBook = tsugiIcon('book'), BrushCompass = tsugiIcon('compass'), BrushSearch = tsugiIcon('search'), BrushGrid = tsugiIcon('grid'), BrushSettings = tsugiIcon('settings'), BrushHistory = tsugiIcon('history'), BrushBell = tsugiIcon('bell'), BrushFolder = tsugiIcon('folder'), BrushMigrate = tsugiIcon('migrate'), BrushPlus = tsugiIcon('plus'), BrushBookmark = tsugiIcon('bookmark'), BrushBack = tsugiIcon('back'), BrushLeft = tsugiIcon('left'), BrushRight = tsugiIcon('right'), BrushDown = tsugiIcon('down'), BrushCheck = tsugiIcon('check'), BrushRefresh = tsugiIcon('refresh'), BrushList = tsugiIcon('list'), BrushPlay = tsugiIcon('play'), BrushPause = tsugiIcon('pause'), BrushPrevious = tsugiIcon('previous'), BrushNext = tsugiIcon('next'), BrushDisc = tsugiIcon('disc'), BrushPlug = tsugiIcon('plug'), BrushHeart = tsugiIcon('heart'), BrushExpand = tsugiIcon('expand'), BrushShrink = tsugiIcon('shrink'), BrushMinus = tsugiIcon('minus'), BrushClose = tsugiIcon('close'), BrushShuffle = tsugiIcon('shuffle'), BrushLyrics = tsugiIcon('lyrics'), BrushTrash = tsugiIcon('trash'), BrushFile = tsugiIcon('file'), BrushDownload = tsugiIcon('download');

export const BrushRepeat = tsugiIcon('repeat'), BrushSliders = tsugiIcon('sliders'), BrushFolderPlus = tsugiIcon('folderPlus');
