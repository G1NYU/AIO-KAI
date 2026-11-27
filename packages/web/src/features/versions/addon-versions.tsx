import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { AddonOptions, AddonStreamGroup } from '@/lib/hosts/shell/stremio';
import { VersionFrame } from './version-frame';

/** The same reviewed addon choices appear on the title and inside the player.
 * Rows carry only native review handles, never playback URLs. */
export function AddonVersionList({groups,sources,busy,resumeMs=0,switching=false,onPick}:{
  groups:AddonStreamGroup[];sources:{sourceId:number;name:string}[];busy:boolean;resumeMs?:number;switching?:boolean;
  onPick(group:AddonStreamGroup,options:AddonOptions,index:number,resume:boolean):void;
}){
  const [provider,setProvider]=React.useState('all');
  const chosen=groups.some(group=>String(group.sourceId)===provider)?provider:'all';
  const count=(group:AddonStreamGroup)=>group.options?.rows.length??0;
  const total=groups.reduce((sum,group)=>sum+count(group),0);
  const visible=chosen==='all'?groups:groups.filter(group=>String(group.sourceId)===chosen);
  return <div className="space-y-3">
    {groups.length===0?<p><Trans>No enabled addon declares support for this video.</Trans></p>:<div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1"><Trans>Source provider</Trans>
        <select aria-label={t`Source provider`} className="tsugi-menu-select block w-full" value={chosen} onChange={e=>setProvider(e.target.value)}>
          <option value="all"><Trans>All sources</Trans> ({total})</option>
          {groups.map(group=><option key={group.sourceId} value={String(group.sourceId)}>{sources.find(s=>s.sourceId===group.sourceId)?.name??t`Unknown addon`} ({count(group)})</option>)}
        </select>
      </label>
      <span role="status">{visible.reduce((sum,group)=>sum+count(group),0)} <Trans>returned streams</Trans></span>
    </div>}
    {visible.map(group=>{
      const result=group.options;
      return <section key={group.sourceId} className="space-y-2" data-stream-source={group.sourceId}>
        <h5 className="font-medium">{sources.find(s=>s.sourceId===group.sourceId)?.name}</h5>
        {!result?<p><Trans>This addon could not return streams. Other sources remain available.</Trans></p>:result.rows.length===0?<p><Trans>No streams returned.</Trans></p>:<ul className="space-y-2">{result.rows.map((row,index)=><li key={index}>
          <VersionFrame><div className="flex w-full flex-wrap items-center justify-between gap-3 p-3">
            <span className="min-w-0 break-words">{row.name}<small className="block text-[--muted]">{row.supported?<Trans>Direct HTTPS</Trans>:row.reason==='proxy-headers'?<Trans>Proxy headers required</Trans>:<Trans>Unsupported transport</Trans>}</small></span>
            {row.supported&&<div className="flex flex-wrap gap-2">{resumeMs>0&&!switching&&<button className="tsugi-read-action tsugi-series-primary" type="button" disabled={busy} onClick={()=>onPick(group,result,index,true)}><Trans>Resume</Trans></button>}
              <button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>onPick(group,result,index,switching)}>{switching?<Trans>Switch stream</Trans>:resumeMs>0?<Trans>Play from beginning</Trans>:<Trans>Play</Trans>}</button>
            </div>}
          </div></VersionFrame>
        </li>)}</ul>}
      </section>;
    })}
  </div>;
}
