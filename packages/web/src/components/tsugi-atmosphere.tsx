import { TsugiBrand } from './tsugi-brand';

/** Decorative, noninteractive brand layer. Artwork is supplied by the current
 * collection only; no extra provider lookup or continuously animated effects. */
export function TsugiAtmosphere({ placement, artwork }: {
  placement: 'entry' | 'collection' | 'library';
  artwork?: string;
}) {
  return (
    <div className="tsugi-atmosphere" data-placement={placement} aria-hidden="true">
      {artwork && <img className="tsugi-atmosphere-art" src={artwork} alt="" draggable={false}
        referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}
      <div className="tsugi-atmosphere-wash" />
      <TsugiBrand className="tsugi-atmosphere-brand" />
    </div>
  );
}
