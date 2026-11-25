import type { HostEvent } from '@/lib/downloads/types';
type Row = Extract<HostEvent,{type:'state'}>['jobs'][number] & {speed?:number};
export function vaultTransferRate(speed:number):string {
  if(!Number.isFinite(speed)||speed<=0)return '—';
  return speed>=1048576?[(speed/1048576).toFixed(1),'MiB/s'].join(' '):[(speed/1024).toFixed(1),'KiB/s'].join(' ');
}
export function vaultEta(bytes:number,total:number|null,speed:number):number|null {
  if(total===null||!Number.isFinite(total)||total<=0||!Number.isFinite(bytes)||bytes<0||!Number.isFinite(speed)||speed<=0)return null;
  return Math.ceil(Math.max(0,total-bytes)/speed);
}
/** Preserve row identity across native snapshots, and clear stale speed on state changes. */
export function reconcileVaultRows(old:Row[],next:Row[]):Row[]{
  const previous=new Map(old.map(row=>[row.id,row]));
  return next.map(row=>{
    const before=previous.get(row.id);
    const speed=row.state==='downloading'&&before?.state==='downloading'?before.speed||0:0;
    const updated={...row,speed};
    return before&&JSON.stringify(before)===JSON.stringify(updated)?before:updated;
  });
}
