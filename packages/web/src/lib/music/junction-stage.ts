import type { EclipsePlayerTemplate, PlayerLayer, PlayerLayerKind } from './player-template';

type Spec = [PlayerLayerKind, number, number, number, number, string, number?, string?];
const specs: Spec[] = [
  ['close', .032, .062, .032, .049, '#A7AFC5'],
  ['threeDotMenu', .965, .063, .036, .048, '#A7AFC5'],
  ['text', .178, .073, .255, .049, '#D6E4FA', 27, 'TSUGI / JUNCTION'],
  ['line', .5, .117, .928, .002, '#303646'],
  ['text', .668, .144, .302, .038, '#A7B2CA', 17, 'NOW PLAYING / CONNECTED SOUND'],
  ['artwork', .258, .475, .373, .662, '#FFFFFF'],
  ['qualityBadge', .184, .840, .215, .041, '#A7C9F3'],
  ['songTitle', .740, .230, .435, .086, '#F2F4FF', 59],
  ['artistName', .740, .304, .435, .055, '#B3BACB', 28],
  ['albumName', .735, .356, .425, .043, '#8E9BB3', 20],
  ['favorite', .945, .240, .043, .063, '#E8EFFF'],
  ['lyricsInline', .743, .455, .410, .165, '#D7E2F8', 35],
  ['progressBar', .745, .589, .415, .024, '#AAC8F3'],
  ['elapsed', .560, .630, .077, .034, '#96A2BC', 21],
  ['remaining', .938, .630, .079, .034, '#96A2BC', 21],
  ['shuffle', .560, .735, .039, .060, '#A6B0C7'],
  ['previous', .651, .736, .053, .077, '#E7EBF7'],
  ['playPause', .742, .737, .081, .106, '#E7F1FF'],
  ['next', .834, .736, .052, .077, '#E7EBF7'],
  ['repeat', .920, .735, .039, .060, '#A6B0C7'],
  ['line', .746, .814, .42, .001, '#303746'],
  ['lyrics', .615, .864, .043, .052, '#B8C6DC'],
  ['queue', .856, .864, .043, .052, '#B8C6DC'],
  ['volumeKnob', .937, .864, .11, .052, '#B8C6DC'],
  ['text', .140, .923, .190, .034, '#B2C7E4', 17, 'UP NEXT / YOUR QUEUE'],
  ['upNext', .310, .951, .360, .031, '#D8DDEE', 21],
  ['releaseInfo', .740, .948, .425, .042, '#8E9DB4', 17],
];

export const JUNCTION_STAGE: EclipsePlayerTemplate = {
  name: '',
  background: '#0c0d14',
  skippedLayers: 0,
  layers: specs.map(([kind, x, y, width, height, color, size, content], index): PlayerLayer => ({
    id: 'junction-' + index,
    kind, x, y, width, height,
    opacity: 1, color, fontSize: size ?? 22,
    align: 'left', weight: 'medium', content: content ?? '',
  })),
};
