import type { EclipsePlayerTemplate, PlayerLayerKind, PlayerLayer } from './player-template';

/**
 * Bundled Nocturne stage. Uses the same declarative layer renderer as Eclipse
 * Studio imports: no arbitrary CSS, remote images, custom JS or add-on scripts.
 */
const layers: Array<[PlayerLayerKind, number, number, number, number, number, 'left'|'center'|'right']> = [
  ['artwork', 0.275, 0.485, 0.365, 0.68, 24, 'center'],
  ['songTitle', 0.73, 0.33, 0.43, 0.1, 52, 'left'],
  ['artistName', 0.73, 0.43, 0.43, 0.07, 27, 'left'],
  ['progressBar', 0.72, 0.57, 0.44, 0.07, 16, 'center'],
  ['elapsed', 0.54, 0.635, 0.11, 0.05, 18, 'left'],
  ['remaining', 0.91, 0.635, 0.11, 0.05, 18, 'right'],
  ['previous', 0.62, 0.735, 0.065, 0.09, 22, 'center'],
  ['playPause', 0.73, 0.735, 0.075, 0.11, 22, 'center'],
  ['next', 0.84, 0.735, 0.065, 0.09, 22, 'center'],
  ['qualityBadge', 0.62, 0.86, 0.2, 0.04, 13, 'left'],
  ['upNext', 0.73, 0.92, 0.42, 0.04, 13, 'center'],
  ['close', 0.965, 0.05, 0.055, 0.07, 22, 'center'],
];

export const NOCTURNE_STAGE: EclipsePlayerTemplate = {
  name: 'Nocturne Stage',
  background: '#0f0d15',
  skippedLayers: 0,
  layers: layers.map(([kind, x, y, width, height, fontSize, align], index): PlayerLayer => ({
    id: 'nocturne-' + index,
    kind, x, y, width, height, fontSize, align, opacity: 1, color: '#f3f1fa',
  })),
};
