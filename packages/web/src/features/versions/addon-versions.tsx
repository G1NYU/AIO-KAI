import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { AddonOption, AddonOptions, AddonStreamGroup } from '@/lib/hosts/shell/stremio';
import { VersionFrame } from './version-frame';
import { addonAudioTags,reportedAddonStreamTags } from '@/lib/hosts/shell/watch-stream-tags';

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
  const [audio,setAudio]=React.useState('all'),[size,setSize]=React.useState('all'),[cacheStatus,setCacheStatus]=React.useState('all');
  const [limits,setLimits]=React.useState<Record<number,number>>({});
  const chosen=groups.some(group=>String(group.sourceId)===provider)?provider:'all';
  const count=(group:AddonStreamGroup)=>group.options?.rows.length??0;
  const total=groups.reduce((sum,group)=>sum+count(group),0);
  const visible=chosen==='all'?groups:groups.filter(group=>String(group.sourceId)===chosen);
  // Parse a provider snapshot once. Filtering never rewrites its native review index.
  const indexed=React.useMemo(()=>new Map(groups.map(group=>[group.sourceId,(group.options?.rows??[]).map((row,index)=>({row,index,quality:qualityOf(row),codec:codecOf(row),edition:editionOf(row),tags:reportedAddonStreamTags(row)}))])),[groups]);
  const allEntries=React.useMemo(()=>Array.from(indexed.values()).flat(),[indexed]);
  const audioOptions=addonAudioTags.filter(tag=>allEntries.some(entry=>entry.tags.audio.includes(tag)));
  const hasSize=allEntries.some(entry=>entry.tags.size!==undefined),hasCache=allEntries.some(entry=>entry.tags.cache!==undefined);
  const selectedAudio=audioOptions.some(tag=>tag===audio)?audio:'all';
  const rowsFor=(group:AddonStreamGroup)=>(indexed.get(group.sourceId)??[])
    .filter(entry=>(quality==='all'||(quality==='unknown'?!entry.quality:entry.quality===quality))&&(codec==='all'||entry.codec===codec)&&(edition==='all'||entry.edition===edition)&&(!playable||entry.row.supported)
      &&(selectedAudio==='all'||entry.tags.audio.some(tag=>tag===selectedAudio))&&(!hasSize||size==='all'||entry.tags.size===size)&&(!hasCache||cacheStatus==='all'||entry.tags.cache===cacheStatus));
  return <div className="space-y-3">
    {groups.length===0?<p><Trans>No enabled addon declares support for this video.</Trans></p>:<div className="flex flex-wrap items-end gap-3" data-ui="watch-version-filters">
      <label className="min-w-[8rem] flex-1"><Trans>Source provider</Trans>
        <select aria-label={t`Source provider`} className="tsugi-menu-select block w-full" value={chosen} onChange={e=>setProvider(e.target.value)}>
          <option value="all"><Trans>All sources</Trans> ({total})</option>
          {groups.map(group=><option key={group.sourceId} value={String(group.sourceId)}>{sources.find(s=>s.sourceId===group.sourceId)?.name??t`Unknown addon`} ({count(group)})</option>)}
        </select>
      </label>
      <label className="min-w-[8rem] flex-1"><Trans>Quality</Trans>
        <select aria-label={t`Quality filter`} className="tsugi-menu-select block w-full" value={quality} onChange={e=>setQuality(e.target.value)}>
          <option value="all"><Trans>All qualities</Trans></option>
          {qualities.map(value=><option key={value} value={value}>{value}</option>)}
          <option value="unknown"><Trans>Unspecified</Trans></option>
        </select>
      </label>
      <label className="min-w-[8rem] flex-1"><Trans>Codec</Trans><select aria-label={t`Codec filter`} className="tsugi-menu-select block w-full" value={codec} onChange={e=>setCodec(e.target.value)}><option value="all"><Trans>All codecs</Trans></option>{codecs.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      <label className="min-w-[8rem] flex-1"><Trans>Release</Trans><select aria-label={t`Release filter`} className="tsugi-menu-select block w-full" value={edition} onChange={e=>setEdition(e.target.value)}><option value="all"><Trans>All releases</Trans></option>{editions.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      {audioOptions.length>0&&<label className="min-w-[8rem] flex-1"><Trans>Audio format</Trans><select aria-label={t`Audio format filter`} className="tsugi-menu-select block w-full" value={selectedAudio} onChange={e=>setAudio(e.target.value)}><option value="all"><Trans>All audio formats</Trans></option>{audioOptions.map(value=><option key={value} value={value}>{value}</option>)}</select></label>}
      {hasSize&&<label className="min-w-[8rem] flex-1"><Trans>Reported size</Trans><select aria-label={t`File size filter`} className="tsugi-menu-select block w-full" value={size} onChange={e=>setSize(e.target.value)}><option value="all"><Trans>Any size</Trans></option><option value="under-1"><Trans>Under 1 GB</Trans></option><option value="1-to-5"><Trans>1 GB to under 5 GB</Trans></option><option value="5-to-15"><Trans>5 GB to under 15 GB</Trans></option><option value="15-plus"><Trans>15 GB or more</Trans></option></select></label>}
      {hasCache&&<label className="min-w-[8rem] flex-1"><Trans>Provider cache</Trans><select aria-label={t`Provider cache filter`} className="tsugi-menu-select block w-full" value={cacheStatus} onChange={e=>setCacheStatus(e.target.value)}><option value="all"><Trans>Any cache status</Trans></option><option value="cached"><Trans>Reported cached</Trans></option><option value="uncached"><Trans>Reported uncached</Trans></option></select></label>}
      <div className="flex basis-full flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2"><input type="checkbox" checked={playable} onChange={e=>setPlayable(e.target.checked)}/><Trans>Playable only</Trans></label>
        <span role="status">{visible.reduce((sum,group)=>sum+rowsFor(group).length,0)} <Trans>returned streams</Trans></span>
      </div>
      {(audioOptions.length>0||hasSize||hasCache)&&<p className="basis-full text-xs text-[--muted]"><Trans>Audio, sizes and cache status are provider-reported, not independently verified.</Trans></p>}
    </div>}
    {visible.map(group=>{
      const result=group.options,rows=rowsFor(group),limit=limits[group.sourceId]??24;
      const sourceName=sources.find(s=>s.sourceId===group.sourceId)?.name;
      const filteredCount=rows.length,returnedCount=count(group);
      return <section key={group.sourceId} className="space-y-2" data-stream-source={group.sourceId}>
        <header className="flex flex-wrap items-center justify-between gap-3"><h5 className="font-medium flex items-center gap-3"><span aria-hidden="true" className="grid place-items-center size-9 rounded-lg bg-[--tsugi-wash] text-[--tsugi-ink] font-bold">{sourceName?.trim()[0]?.toUpperCase()??'?'}</span>{sourceName}</h5>{result&&<small className="text-[--muted] tabular-nums"><Trans>{filteredCount} of {returnedCount} streams</Trans></small>}</header>
        {!result||result.rows.length===0?<div className="space-y-2">
          {group.error==='unsupported-resource'?<p><Trans>This addon does not support this video identity.</Trans></p>:!result?<><p><Trans>This addon could not return streams. Other sources remain available.</Trans></p>
            {group.error==='network'?<small><Trans>Network request failed.</Trans></small>:group.error==='rate'?<small><Trans>Provider rate limit reached.</Trans></small>:group.error==='auth'?<small><Trans>Provider authorization failed.</Trans></small>:null}</>:<p><Trans>No streams returned.</Trans></p>}
          {onRetry&&group.error!=='unsupported-resource'&&<button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>onRetry(group.sourceId)}><Trans>Retry provider</Trans></button>}
        </div>:rows.length===0?<p><Trans>No streams match these filters.</Trans></p>:<><ul className="space-y-2">{rows.slice(0,limit).map(({row,index})=><li key={index}>
          <VersionFrame><div className="flex w-full flex-wrap items-center justify-between gap-3 p-3">
            <span className="min-w-0 flex-1 break-words">
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
