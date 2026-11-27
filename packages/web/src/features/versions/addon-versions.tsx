import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { AddonOption, AddonOptions, AddonStreamGroup } from '@/lib/hosts/shell/stremio';
import { VersionFrame } from './version-frame';

const qualities=['4K','1080p','720p','480p'] as const;
type Quality=(typeof qualities)[number];
function qualityOf(row:AddonOption):Quality|undefined{
  const label=[row.name,row.detail].filter(Boolean).join(' ');
  if(/\b(?:4k|uhd|2160p?)\b/i.test(label))return '4K';
  if(/\b(?:1080p?|fhd)\b/i.test(label))return '1080p';
  if(/\b720p?\b/i.test(label))return '720p';
  if(/\b480p?\b/i.test(label))return '480p';
  return undefined;
}

const codecs=['HEVC','AVC','AV1','VP9'] as const;
function codecOf(row:AddonOption){const label=row.name+' '+(row.detail??'');return /\b(?:hevc|h[ .]?265|x265)\b/i.test(label)?'HEVC':/\b(?:avc|h[ .]?264|x264)\b/i.test(label)?'AVC':/\bav1\b/i.test(label)?'AV1':/\bvp9\b/i.test(label)?'VP9':undefined;}
// Protocol/edition labels, not prose.
/* eslint-disable lingui/no-unlocalized-strings */
const editions=['WEB','BluRay','Remux','HDTV'] as const;
function editionOf(row:AddonOption){const label=row.name+' '+(row.detail??'');return /\bremux\b/i.test(label)?'Remux':/blu[ .-]?ray|bdrip/i.test(label)?'BluRay':/web[ .-]?(?:dl|rip)|\bweb\b/i.test(label)?'WEB':/\bhdtv\b/i.test(label)?'HDTV':undefined;}
/* eslint-enable lingui/no-unlocalized-strings */

/** The same reviewed addon choices appear on the title and inside the player.
 * Rows carry only native review handles, never playback URLs. */
export function AddonVersionList({groups,sources,busy,resumeMs=0,switching=false,onPick,onRetry}:{
  groups:AddonStreamGroup[];sources:{sourceId:number;name:string}[];busy:boolean;resumeMs?:number;switching?:boolean;
  onPick(group:AddonStreamGroup,options:AddonOptions,index:number,resume:boolean):void;
  onRetry?(sourceId:number):void;
}){
  const [provider,setProvider]=React.useState('all');
  const [quality,setQuality]=React.useState('all');
  const [codec,setCodec]=React.useState('all'),[edition,setEdition]=React.useState('all'),[playable,setPlayable]=React.useState(false);
  const [limits,setLimits]=React.useState<Record<number,number>>({});
  const chosen=groups.some(group=>String(group.sourceId)===provider)?provider:'all';
  const count=(group:AddonStreamGroup)=>group.options?.rows.length??0;
  const total=groups.reduce((sum,group)=>sum+count(group),0);
  const visible=chosen==='all'?groups:groups.filter(group=>String(group.sourceId)===chosen);
  const rowsFor=(group:AddonStreamGroup)=>(group.options?.rows??[]).map((row,index)=>({row,index,quality:qualityOf(row)}))
    .filter(entry=>(quality==='all'||(quality==='unknown'?!entry.quality:entry.quality===quality))&&(codec==='all'||codecOf(entry.row)===codec)&&(edition==='all'||editionOf(entry.row)===edition)&&(!playable||entry.row.supported));
  return <div className="space-y-3">
    {groups.length===0?<p><Trans>No enabled addon declares support for this video.</Trans></p>:<div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1"><Trans>Source provider</Trans>
        <select aria-label={t`Source provider`} className="tsugi-menu-select block w-full" value={chosen} onChange={e=>setProvider(e.target.value)}>
          <option value="all"><Trans>All sources</Trans> ({total})</option>
          {groups.map(group=><option key={group.sourceId} value={String(group.sourceId)}>{sources.find(s=>s.sourceId===group.sourceId)?.name??t`Unknown addon`} ({count(group)})</option>)}
        </select>
      </label>
      <label className="min-w-0 flex-1"><Trans>Quality</Trans>
        <select aria-label={t`Quality filter`} className="tsugi-menu-select block w-full" value={quality} onChange={e=>setQuality(e.target.value)}>
          <option value="all"><Trans>All qualities</Trans></option>
          {qualities.map(value=><option key={value} value={value}>{value}</option>)}
          <option value="unknown"><Trans>Unspecified</Trans></option>
        </select>
      </label>
      <label className="min-w-0 flex-1"><Trans>Codec</Trans><select aria-label={t`Codec filter`} className="tsugi-menu-select block w-full" value={codec} onChange={e=>setCodec(e.target.value)}><option value="all"><Trans>All codecs</Trans></option>{codecs.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      <label className="min-w-0 flex-1"><Trans>Release</Trans><select aria-label={t`Release filter`} className="tsugi-menu-select block w-full" value={edition} onChange={e=>setEdition(e.target.value)}><option value="all"><Trans>All releases</Trans></option>{editions.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={playable} onChange={e=>setPlayable(e.target.checked)}/><Trans>Playable only</Trans></label>
      <span role="status">{visible.reduce((sum,group)=>sum+rowsFor(group).length,0)} <Trans>returned streams</Trans></span>
    </div>}
    {visible.map(group=>{
      const result=group.options,rows=rowsFor(group),limit=limits[group.sourceId]??24;
      const sourceName=sources.find(s=>s.sourceId===group.sourceId)?.name;
      return <section key={group.sourceId} className="space-y-2" data-stream-source={group.sourceId}>
        <h5 className="font-medium flex items-center gap-3"><span aria-hidden="true" className="grid place-items-center size-9 rounded-lg bg-[--tsugi-wash] text-[--tsugi-ink] font-bold">{sourceName?.trim()[0]?.toUpperCase()??'?'}</span>{sourceName}</h5>
        {!result||result.rows.length===0?<div className="space-y-2">
          {group.error==='unsupported-resource'?<p><Trans>This addon does not support this video identity.</Trans></p>:!result?<><p><Trans>This addon could not return streams. Other sources remain available.</Trans></p>
            {group.error==='network'?<small><Trans>Network request failed.</Trans></small>:group.error==='rate'?<small><Trans>Provider rate limit reached.</Trans></small>:group.error==='auth'?<small><Trans>Provider authorization failed.</Trans></small>:null}</>:<p><Trans>No streams returned.</Trans></p>}
          {onRetry&&group.error!=='unsupported-resource'&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>onRetry(group.sourceId)}><Trans>Retry provider</Trans></button>}
        </div>:rows.length===0?<p><Trans>No streams match these filters.</Trans></p>:<><ul className="space-y-2">{rows.slice(0,limit).map(({row,index,quality:reportedQuality})=><li key={index}>
          <VersionFrame><div className="flex w-full flex-wrap items-center justify-between gap-3 p-3">
            <span className="min-w-0 flex-1 break-words">
              {reportedQuality&&qualityOf({...row,detail:undefined})!==reportedQuality&&<small className="block font-semibold">{reportedQuality}</small>}
              <strong>{row.name}</strong>
              {row.detail&&<span className="block text-sm whitespace-pre-line">{row.detail}</span>}
              <small className="block text-[--muted]">{row.supported?<Trans>Direct HTTPS</Trans>:row.reason==='proxy-headers'?<Trans>Proxy headers required</Trans>:row.reason==='invalid-media-url'?<Trans>Invalid media URL</Trans>:<Trans>Unsupported transport</Trans>}</small>
            </span>
            {row.supported&&<div className="flex flex-wrap gap-2">{resumeMs>0&&!switching&&<button className="tsugi-read-action tsugi-series-primary" type="button" disabled={busy} onClick={()=>onPick(group,result,index,true)}><Trans>Resume</Trans></button>}
              <button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>onPick(group,result,index,switching)}>{switching?<Trans>Switch stream</Trans>:resumeMs>0?<Trans>Play from beginning</Trans>:<Trans>Play</Trans>}</button>
            </div>}
          </div></VersionFrame>
        </li>)}</ul>{rows.length>limit&&<button type="button" className="tsugi-read-action" onClick={()=>setLimits(old=>({...old,[group.sourceId]:limit+24}))}><Trans>Show more streams</Trans> ({rows.length-limit})</button>}</>}
      </section>;
    })}
  </div>;
}
