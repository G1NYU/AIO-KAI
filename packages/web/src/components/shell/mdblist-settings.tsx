import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { AddonError,mdblistStatus,mdblistConnect,mdblistDisconnect,mdblistLists,mdblistPage,type MdblistItem } from '@/lib/hosts/shell/stremio';

export function MdblistSettings({profileId,openTitle}:{profileId:number;openTitle:(item:MdblistItem)=>void}){
  const [connected,setConnected]=React.useState(false),[ready,setReady]=React.useState(false);
  const [key,setKey]=React.useState(''),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  const [lists,setLists]=React.useState<Awaited<ReturnType<typeof mdblistLists>>>([]);
  const [listId,setListId]=React.useState(''),[page,setPage]=React.useState<Awaited<ReturnType<typeof mdblistPage>>|null>(null);
  const mounted=React.useRef(false),flight=React.useRef(false);
  const seen=React.useRef(new Set<string>());
  async function run(work:()=>Promise<void>){
    if(flight.current)return;
    flight.current=true;setBusy(true);setError('');
    try{await work();}catch(e){
      if(mounted.current)setError(e instanceof AddonError&&e.code==='mdblist-rate'?t`MDBList is rate limiting requests. Try again later.`:
        e instanceof AddonError&&e.code==='mdblist-auth'?t`MDBList rejected the key or list access.`:t`MDBList could not complete the request.`);
    }finally{flight.current=false;if(mounted.current)setBusy(false);}
  }
  React.useEffect(()=>{
    mounted.current=true;
    const timer=setTimeout(()=>void run(async()=>{const result=await mdblistStatus(profileId);if(mounted.current){setConnected(result);setReady(true);}}),0);
    return ()=>{mounted.current=false;clearTimeout(timer);};
  },[profileId]);
  async function load(offset:number){
    const id=Number(listId);if(!Number.isSafeInteger(id)||id<1||id>0xffffffff)return;
    await run(async()=>{
      if(offset===0){setPage(null);seen.current.clear();}
      const result=await mdblistPage(profileId,id,offset);
      if(!mounted.current)return;
      const fingerprint=JSON.stringify(result.items.map(item=>[item.mediaType,item.id]));
      if(seen.current.has(fingerprint)){setPage(old=>old?{...old,nextOffset:null}:null);setError(t`MDBList repeated a page. Pagination stopped.`);return;}
      seen.current.add(fingerprint);
      setPage(old=>{
        const items=offset===0?[]:old?.items??[];
        const ids=new Set(items.map(item=>JSON.stringify([item.mediaType,item.id])));
        return {items:[...items,...result.items.filter(item=>!ids.has(JSON.stringify([item.mediaType,item.id])))],nextOffset:result.nextOffset};
      });
    });
  }
  return <section className="space-y-3" data-ui="watch-mdblist">
    <h4>MDBList</h4>
    <p><Trans>Connect your account to browse lists and ratings. Only read requests are sent. Titles open through your installed Watch addons.</Trans></p>
    {!connected&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();const candidate=key.trim();setKey('');void run(async()=>{const result=await mdblistConnect(profileId,candidate);if(mounted.current){setConnected(result);setReady(true);}});}}>
      <label><Trans>MDBList API key</Trans><input className="tsugi-read-input w-full" type="password" autoComplete="off" value={key} maxLength={512} onChange={e=>setKey(e.target.value)} disabled={busy}/></label>
      <button type="submit" className="tsugi-read-action" disabled={busy||!ready||!key.trim()}><Trans>Verify and connect</Trans></button>
    </form>}
    {connected&&<>
      <p><Trans>Connected to MDBList for this profile.</Trans></p>
      <div className="flex flex-wrap gap-2"><button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void run(async()=>{const result=await mdblistLists(profileId);if(mounted.current)setLists(result);})}><Trans>Load my lists</Trans></button>
        <button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>void run(async()=>{const result=await mdblistDisconnect(profileId);if(mounted.current){setConnected(result);setLists([]);setPage(null);setListId('');}})}><Trans>Disconnect</Trans></button></div>
      {lists.length>0&&<label><Trans>My lists</Trans><select className="tsugi-menu-select w-full" value={listId} onChange={e=>{setListId(e.target.value);setPage(null);}} disabled={busy}><option value=""><Trans>Select a list</Trans></option>{lists.map(list=><option key={list.id} value={list.id}>{list.name} · {list.count}</option>)}</select></label>}
      <form className="space-y-2" onSubmit={e=>{e.preventDefault();void load(0);}}><label><Trans>MDBList list ID</Trans><input className="tsugi-read-input w-full" inputMode="numeric" value={listId} onChange={e=>{setListId(e.target.value);setPage(null);}} disabled={busy}/></label><button className="tsugi-read-action" type="submit" disabled={busy||!/^[1-9]\d{0,9}$/.test(listId)}><Trans>Load list</Trans></button></form>
      {page&&<><ul className="max-h-96 overflow-auto">{page.items.map(item=><li className="tsugi-read-row flex-wrap" key={item.mediaType+':'+item.id}><button type="button" className="tsugi-read-action" disabled={busy} onClick={()=>openTitle(item)}>{item.name}</button><span className="text-sm">{Object.entries(item.ratings).map(([source,value])=>source.toUpperCase()+' '+value+'/100').join(' · ')}</span></li>)}</ul>
      {page.nextOffset!==null&&<button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>void load(page.nextOffset!)}><Trans>Next page</Trans></button>}</>}
    </>}
    {busy&&<p role="status"><Trans>Contacting MDBList…</Trans></p>}{error&&<p role="alert">{error}</p>}
    {!ready&&!busy&&<button className="tsugi-read-action" type="button" onClick={()=>void run(async()=>{const result=await mdblistStatus(profileId);if(mounted.current){setConnected(result);setReady(true);}})}><Trans>Retry</Trans></button>}
  </section>;
}
