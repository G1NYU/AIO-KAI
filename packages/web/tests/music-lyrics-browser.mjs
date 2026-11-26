// Real Music UI, controlled native-clock events and an original PCM recording.
// Lyrics and recording metadata are original fixtures; no provider is contacted.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';

function installLyricsFixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1', 'true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('music'));
  localStorage.setItem('tsugi.landscape.local-only', 'true');
  localStorage.setItem('aiostreams-desktop-music-remember-v1', 'true');
  localStorage.setItem('aiostreams-desktop-music-sources-v1', JSON.stringify([{ id:'eeaa2cb3-5735-43ad-bff6-f1f9f23acdb9',kind:'youtube-music',url:'https://music.youtube.com/' }]));
  const host=window.aiostreamsApp,listeners=new Set(),send=host.send.bind(host),subscribe=host.subscribe.bind(host);
  const state=window.__lyricsFixture={request:'',position:13,duration:188,seeks:[],lyricsRequests:[]};
  host.subscribe=listener=>{listeners.add(listener);const remove=subscribe(listener);return()=>{listeners.delete(listener);remove();};};
  state.emit=(position=state.position,duration=state.duration,status='playing')=>{
    state.position=position;state.duration=duration;
    for(const listener of listeners)listener({type:'music-audio-state',request:state.request,status,position,duration,error:null});
  };
  host.send=message=>{
    if(message.type==='youtube-music-request'&&['home','search'].includes(message.operation)){
      const data=message.operation==='home'?[]:[['lyricvideo1','Original video','Video','3:08'],['lyricaudio1','Original audio','Song','2:00']].map(([id,title,type,duration])=>({musicResponsiveListItemRenderer:{
        playlistItemData:{videoId:id},flexColumns:[{musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:title}]}}},
          {musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:type},{text:' · '},{text:'Original artist',navigationEndpoint:{browseEndpoint:{browseId:'UCoriginal'}}},{text:' · '},{text:duration}]}}}],
      }}));
      queueMicrotask(()=>{for(const listener of listeners)listener({type:'youtube-music-result',request:message.request,data,error:null});});return;
    }
    if(message.type==='music-audio-load'){
      state.request=message.request;state.position=13;state.duration=message.url.includes('lyricaudio1')?0:188;
      window.__readerFixture.nativeRequest=message.request;
      queueMicrotask(()=>state.emit());return;
    }
    if(message.type==='music-audio-control'&&message.request===state.request&&['seek','pause'].includes(message.action)){
      if(message.action==='seek'){state.seeks.push(message.value);queueMicrotask(()=>state.emit(message.value));}
      else queueMicrotask(()=>state.emit(state.position,state.duration,message.value?'paused':'playing'));
      return;
    }
    return send(message);
  };
}

function originalTone() {
  const rate=8000,samples=188*rate,wav=Buffer.alloc(44+samples*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  for(let at=0;at<samples;at++)wav.writeInt16LE(Math.round(4000*Math.sin(2*Math.PI*220*at/rate)),44+at*2);
  return wav;
}

export async function verifyMusicLyricsBrowser({browser,origin,installDesktopFixture,screenshotDir}) {
  const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'en-GB',reducedMotion:'reduce'});
  page.setDefaultTimeout(20_000);
  const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
  const source='https://original-lyrics-source.example',media='https://original-lyrics-media.example';
  const wav=originalTone();
  const mediaServer=createServer((request,response)=>{
    const headers={'access-control-allow-origin':'*','content-type':'audio/wav','accept-ranges':'bytes','cache-control':'no-store'};
    const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range??'');
    if(range){
      const start=Number(range[1]),end=Math.min(wav.length-1,range[2]?Number(range[2]):wav.length-1);
      if(start>end){response.writeHead(416,{...headers,'content-range':'bytes */'+wav.length});response.end();return;}
      response.writeHead(206,{...headers,'content-length':end-start+1,'content-range':`bytes ${start}-${end}/${wav.length}`});response.end(wav.subarray(start,end+1));return;
    }
    response.writeHead(200,{...headers,'content-length':wav.length});response.end(wav);
  });
  const lrc='[00:10.00]First original line\n[00:20.00]Second original line\n[00:30.00]Third original line';
  try {
    await new Promise((resolve,reject)=>{mediaServer.once('error',reject);mediaServer.listen(0,'127.0.0.1',resolve);});
    const mediaLoopback='http://127.0.0.1:'+mediaServer.address().port;
    await page.addInitScript({content:`(${installDesktopFixture.toString()})();(${installLyricsFixture.toString()})();`});
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      const headers={'access-control-allow-origin':'*','access-control-allow-headers':'Lrclib-Client','access-control-allow-methods':'GET, OPTIONS','cache-control':'no-store'};
      if(url.origin===origin||url.origin===mediaLoopback)return route.continue();
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
      if(url.hostname==='lrclib.net'){
        requests.push(url.href);const title=url.searchParams.get('track_name');
        const row={id:title==='Original audio'?20:10,trackName:title,artistName:'Original artist',albumName:'Original studio',duration:title==='Original audio'?180:188,syncedLyrics:lrc};
        return route.fulfill({headers,json:title==='Original audio'?[{...row,id:19,duration:120,syncedLyrics:'[00:10.00]Wrong catalog timing'},row]:[row]});
      }
      if(url.origin===source){
        if(url.pathname==='/manifest.json')return route.fulfill({headers,json:{id:'original.lyrics',name:'Original lyrics source',version:'1',resources:['search','stream']}});
        if(url.pathname==='/search')return route.fulfill({headers,json:{tracks:[{id:'lyricvideo1',title:'Original video',artist:'Original artist',album:'Original studio',duration:120}]}});
        if(url.pathname.startsWith('/stream/'))return route.fulfill({headers,json:{url:media+'/tone.wav',format:'WAV'}});
      }
      if(url.origin===media&&url.pathname==='/tone.wav')return route.fulfill({status:302,headers:{...headers,location:mediaLoopback+'/tone.wav'}});
      return route.abort();
    });
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    const music=page.locator('[data-page="music"]');
    await music.getByRole('navigation',{name:'Music sections'}).getByRole('button',{name:'Search',exact:true}).click();
    await music.getByRole('textbox',{name:'Search music',exact:true}).fill('Original');
    await music.locator('.tsugi-music-search form').getByRole('button',{name:'Search',exact:true}).click();
    const expanded=music.getByRole('dialog',{name:'Now playing',exact:true});
    const play=async title=>{
      await music.locator('[data-ui="music-track-row"]').filter({hasText:title}).click();
      await music.getByRole('button',{name:'Expand player',exact:true}).click();
      await expanded.getByRole('button',{name:'Show lyrics',exact:true}).click();
    };
    const close=()=>expanded.getByRole('button',{name:'Minimise player',exact:true}).click();
    const openTiming=()=>expanded.getByRole('button',{name:'Adjust lyrics timing',exact:true}).click();
    const offset=()=>expanded.locator('.tsugi-lyrics-timing output').textContent();
    const unconfirmed=()=>expanded.getByText('This video may have a different intro or edit. Lyric timing is unconfirmed.',{exact:true});
    const alignFirst=async()=>{
      await openTiming();await expanded.getByRole('button',{name:'Match a sung line',exact:true}).click();
      await expanded.getByRole('button',{name:'First original line',exact:true}).click();
      await expanded.locator('.oto-lyric-line[aria-current="true"]').filter({hasText:'First original line'}).waitFor();
    };
    await play('Original video');await unconfirmed().waitFor();
    assert.equal(await expanded.locator('.oto-lyric-line').count(),0,'unconfirmed video timestamps do not highlight or seek automatically');
    await alignFirst();assert.equal(await offset(),'+3.00 s');
    assert.deepEqual(await page.evaluate(()=>window.__lyricsFixture.seeks),[],'matching a sung line never seeks audio');
    await expanded.locator('.oto-lyric-line').filter({hasText:'Second original line'}).click();
    await page.waitForFunction(()=>window.__lyricsFixture.seeks.at(-1)===23);
    await expanded.locator('.oto-lyric-line[aria-current="true"]').filter({hasText:'Second original line'}).waitFor();
    assert.equal(await expanded.locator('.oto-lyric-line[aria-current="true"] .oto-lyric-time').textContent(),'0:23');
    await expanded.getByRole('button',{name:'Lyrics earlier',exact:true}).click();assert.equal(await offset(),'+2.50 s');
    await expanded.getByRole('button',{name:'Lyrics later',exact:true}).click();assert.equal(await offset(),'+3.00 s');
    await expanded.getByRole('button',{name:'Reset timing',exact:true}).click();await unconfirmed().waitFor();
    assert.equal(await expanded.locator('.oto-lyric-line[aria-current]').count(),0);
    await page.evaluate(()=>window.__lyricsFixture.emit(13));
    await expanded.getByRole('button',{name:'Match a sung line',exact:true}).click();
    await expanded.getByRole('button',{name:'First original line',exact:true}).click();
    assert.equal(await offset(),'+3.00 s');
    const stableRequests=requests.length;
    await page.evaluate(()=>{window.__lyricsFixture.emit(13,188.012);window.__lyricsFixture.emit(13,188.009);});
    await expanded.locator('.oto-lyric-line[aria-current="true"]').filter({hasText:'First original line'}).waitFor();
    await expanded.getByRole('button',{name:'Lyrics later',exact:true}).click();
    assert.equal(await offset(),'+3.50 s');
    await expanded.getByRole('button',{name:'Lyrics earlier',exact:true}).click();
    assert.equal(await offset(),'+3.00 s','tiny decoder jitter keeps the current correction');
    assert.equal(requests.length,stableRequests,'tiny decoder jitter does not repeat the lookup');
    await close();

    await play('Original audio');
    await expanded.getByText('Lyrics found; timing is unconfirmed for this recording.',{exact:true}).waitFor();
    assert.equal(await expanded.locator('.oto-lyric-line').count(),0,'playing with unknown media duration never synchronizes the catalog estimate');
    await page.evaluate(()=>window.__lyricsFixture.emit(13,180));
    await expanded.locator('.oto-lyric-line[aria-current="true"]').filter({hasText:'First original line'}).waitFor();
    assert.equal(await expanded.getByText('Wrong catalog timing',{exact:true}).count(),0,'actual native duration outranks stale catalog duration');
    await openTiming();assert.equal(await offset(),'0.00 s','another selected track starts without the prior correction');
    await page.evaluate(()=>window.__lyricsFixture.emit(25,180,'paused'));
    await expanded.locator('.oto-lyric-line[aria-current="true"]').filter({hasText:'Second original line'}).waitFor();
    await close();await play('Original video');
    await expanded.locator('.oto-lyric-line[aria-current="true"]').filter({hasText:'First original line'}).waitFor();
    await openTiming();assert.equal(await offset(),'+3.00 s','the exact recording retains its session adjustment');
    await page.evaluate(()=>window.__lyricsFixture.emit(13,190));await unconfirmed().waitFor();
    await openTiming();assert.equal(await offset(),'0.00 s','changed media duration invalidates the correction');
    await close();

    await music.getByRole('button',{name:'Music sources',exact:true}).click();
    const sources=music.getByRole('dialog',{name:'Music sources',exact:true});
    await sources.getByRole('textbox',{name:'Eclipse addon manifest URL'}).fill(source+'/manifest.json');
    await sources.getByRole('button',{name:'Connect',exact:true}).click();await sources.waitFor({state:'hidden'});
    await music.getByRole('textbox',{name:'Search music',exact:true}).fill('Original');
    await music.locator('.tsugi-music-search form').getByRole('button',{name:'Search',exact:true}).click();
    await music.locator('[data-ui="music-track-row"]').filter({hasText:'Original video'}).click();
    await page.waitForFunction(()=>{const audio=document.querySelector('audio[data-ui="tsugi-audio-engine"]');return audio?.duration===188&&!audio.paused;});
    await music.getByRole('button',{name:'Expand player',exact:true}).click();
    await expanded.getByRole('button',{name:'Show lyrics',exact:true}).click();
    await expanded.locator('.oto-lyric-line').filter({hasText:'Second original line'}).waitFor();
    await openTiming();assert.equal(await offset(),'0.00 s','same track ID on a different source has no inherited correction');
    await expanded.getByRole('button',{name:'Pause',exact:true}).click();
    await expanded.locator('.oto-lyric-line').filter({hasText:'Second original line'}).click();
    await page.waitForFunction(()=>{const audio=document.querySelector('audio[data-ui="tsugi-audio-engine"]');return audio?.paused&&Math.abs(audio.currentTime-20)<.01;});
    await expanded.locator('.oto-lyric-line[aria-current="true"]').filter({hasText:'Second original line'}).waitFor();
    await expanded.getByRole('button',{name:'Lyrics later',exact:true}).click();
    await expanded.locator('.oto-lyric-line').filter({hasText:'Second original line'}).click();
    await page.waitForFunction(()=>Math.abs(document.querySelector('audio[data-ui="tsugi-audio-engine"]').currentTime-20.5)<.01);
    await page.setViewportSize({width:390,height:844});
    await expanded.locator('.tsugi-lyrics-timing').scrollIntoViewIfNeeded();
    assert.equal(await expanded.locator('.tsugi-lyrics-timing').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,'timing controls fit narrow screens');
    if(screenshotDir){await mkdir(screenshotDir,{recursive:true});await page.screenshot({path:join(screenshotDir,'music-lyrics-timing.png'),animations:'disabled'});}
    await page.setViewportSize({width:1440,height:1000});
    await expanded.getByRole('button',{name:'Player settings',exact:true}).click();
    const settings=expanded.getByRole('dialog',{name:'Player settings',exact:true});
    const template={schemaVersion:4,formFactor:'desktop',name:'Original lyrics stage',layers:[
      {id:'title',kind:'songTitle',visible:true,transform:{x:.5,y:.12,width:.7,height:.1}},
      {id:'lyrics',kind:'lyricsInline',visible:true,transform:{x:.5,y:.45,width:.7,height:.4}},
    ]};
    await settings.locator('input[type=file]').setInputFiles({name:'original-lyrics.eclipseplayer',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(template))});
    const studio=page.locator('[data-ui="tsugi-studio-viewport"]');
    await studio.getByRole('button',{name:'Show lyrics',exact:true}).click();
    await studio.getByRole('button',{name:'Adjust lyrics timing',exact:true}).click();
    const studioTiming=studio.getByRole('complementary',{name:'Lyrics timing',exact:true});
    assert.equal(await studioTiming.locator('output').textContent(),'+0.50 s','imported Studio uses the same exact-recording correction');
    await studioTiming.getByRole('button',{name:'Lyrics later',exact:true}).click();
    await studioTiming.locator('.oto-lyric-line').filter({hasText:'Third original line'}).click();
    await page.waitForFunction(()=>Math.abs(document.querySelector('audio[data-ui="tsugi-audio-engine"]').currentTime-31)<.01);
    await studioTiming.locator('.oto-lyric-line[aria-current="true"]').filter({hasText:'Third original line'}).waitFor();
    assert.ok(requests.length>=5);assert.ok(requests.every(url=>!url.includes('lyricvideo1')&&!url.includes('source.example')),'lookup transmits only public title/artist metadata');
    assert.deepEqual(errors,[]);
    console.log('PASS: Lyrics rank actual duration, keep video timing unconfirmed, align without seeking, correct native/browser/Studio seek and highlight, reset and isolate session offsets, and fit narrow controls');
  } finally { await page.close();mediaServer.closeAllConnections();await new Promise(resolve=>mediaServer.close(resolve)); }
}
