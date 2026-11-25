import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiArrowUp, FiArrowDown, FiX } from 'react-icons/fi';
import type { MusicPlayerProps } from './player';

/** Only edit tracks after the current track; playback and history stay intact. */
export function QueueControls({p,at}:{p:MusicPlayerProps;at:number}){
  if(at<=p.index)return null;
  return <div className="tsugi-queue-controls">
    <button type="button" title={t`Move earlier`} aria-label={t`Move earlier`} disabled={p.loading||at===p.index+1} onClick={()=>p.onMoveQueue(at,-1)}><FiArrowUp aria-hidden/></button>
    <button type="button" title={t`Move later`} aria-label={t`Move later`} disabled={p.loading||at===p.queue.length-1} onClick={()=>p.onMoveQueue(at,1)}><FiArrowDown aria-hidden/></button>
    <button type="button" title={t`Remove from queue`} aria-label={t`Remove from queue`} disabled={p.loading} onClick={()=>p.onRemoveQueue(at)}><FiX aria-hidden/></button>
  </div>;
}
export function ClearUpcoming({p}:{p:MusicPlayerProps}){
  return p.queue.length>p.index+1?<button type="button" className="tsugi-queue-clear" disabled={p.loading} onClick={p.onClearUpcoming}><Trans>Clear upcoming</Trans></button>:null;
}
