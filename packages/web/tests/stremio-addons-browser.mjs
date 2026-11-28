import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mkdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';

export function installStremioFixture(initializeStartup=true){
  if(window.top!==window)return;
  if(initializeStartup){
    localStorage.setItem('tsugi-onboarding-complete-v1','true');
    localStorage.setItem('tsugi-startup-area-v1',JSON.stringify('welcome'));
  }
  const host=window.aiostreamsApp;
  host.stremioAddons=true;
  const send=host.send.bind(host),subscribe=host.subscribe.bind(host),listeners=new Set();
  const fixtureLogo='https://raw.githubusercontent.com/example/fixture/main/logo.svg';
  const manifest={id:'org.fixture',name:'Original addon fixture',version:'1.0.0',resources:['catalog','stream','subtitles'],configurable:false,configurationRequired:false,p2p:false,adult:false,catalogs:[{id:'search',mediaType:'movie',name:'Original films',extras:[{name:'search',required:true,options:[],optionsLimit:null},{name:'skip',required:false,options:[],optionsLimit:null}]}]};
  const emptyRefract=()=>({connected:false,username:null,enabled:false,pending:0,sent:0,skipped:0,retryAt:0,lastError:null});
  const f=window.__stremioFixture={calls:[],profiles:[{profileId:1,name:'Default',sources:[],history:[],mdblistConnected:false,refract:emptyRefract()}],active:1,pending:null,import:null,sequence:1,mediaReview:null,streamReviews:[],mediaGrant:null,mediaCalls:[],presenceMessages:[],refractSyncAttempts:0};
  f.emitPlayer=message=>{for(const listener of listeners)listener(message);};
  // Controlled native delivery notification. No real provider traffic and
  // no renderer-side registry request is needed to advance this fixture.
  f.tickRefract=()=>{
    const profile=f.profiles.find(p=>p.profileId===f.active);
    if(!profile.refract.enabled||!profile.refract.pending||profile.refract.retryAt>Date.now())return false;
    if(++f.refractSyncAttempts===1){
      profile.refract.retryAt=Date.now()+60000;profile.refract.lastError='refract-network';
    }else{
      profile.refract.pending--;profile.refract.sent++;profile.refract.retryAt=0;profile.refract.lastError=null;
    }
    f.emitPlayer({type:'refract-status-changed',profileId:profile.profileId,data:structuredClone(profile.refract),error:null});
    return true;
  };
  host.subscribe=listener=>{listeners.add(listener);const remove=subscribe(listener);return()=>{listeners.delete(listener);remove();};};
  let fullscreen=false;
  host.send=message=>{
    if(message.type==='fullscreen'){
      fullscreen=message.value??!fullscreen;
      queueMicrotask(()=>f.emitPlayer({type:'fullscreen',value:fullscreen}));
      return;
    }
    if(message.type==='presence'||message.type==='discord-configure')f.presenceMessages.push(structuredClone(message));
    if(message.type==='stremio-consume-grant'){
      const grant=f.mediaGrant;f.mediaGrant=null;f.mediaCalls.push({type:message.type,grantId:message.grantId});
      queueMicrotask(()=>{
        const result=grant?.id===message.grantId?{grantId:grant.id,accepted:true,subtitles:grant.subtitles}:null;
        for(const l of listeners)l({type:'stremio-result',request:message.request,data:result,error:result?null:'expired-review'});
        if(result&&!grant.subtitles){
          const track=(id,type,title,language)=>({id,type,title,language,default:id==='1',forced:false,hearingImpaired:false,visualImpaired:false,external:false});
          f.emitPlayer({type:'player-event',name:'start'});
          f.emitPlayer({type:'player-tracks',tracks:[track('1','audio','English audio','eng'),track('2','audio','Japanese audio','jpn'),track('3','subtitle','English subtitles','eng')]});
          f.emitPlayer({type:'player-state',paused:false,positionMs:grant.startMs,durationMs:120000,volume:1,maxVolume:1,muted:false,speed:1,audio:'1',subtitle:null});
          f.emitPlayer({type:'player-event',name:'loaded'});f.emitPlayer({type:'player-event',name:'restart'});
        }
      });return;
    }
    if(['player-stop','player-set','player-seek','player-frame','player-style','player-sync','player-stats-overlay','player-controls'].includes(message.type)){
      f.mediaCalls.push(structuredClone(message));
      if(message.type==='player-stop')f.mediaGrant=null; // same invalidation as Windows
      if(message.type==='player-set')queueMicrotask(()=>f.emitPlayer({...message,type:'player-state'}));
      if(message.type==='player-seek')queueMicrotask(()=>f.emitPlayer({type:'player-state',positionMs:message.positionMs}));
      return;
    }
    if(message.type!=='stremio-request')return send(message);
    const raw=message.action;f.calls.push(structuredClone(raw));
    const emit=(data,error=null)=>{
      const sendResult=()=>{for(const l of listeners)l({type:'stremio-result',request:message.request,data,error});};
      if(f.boardFixture&&raw.action?.kind==='browse-catalog'){
        f.catalogPending=(f.catalogPending??0)+1;f.catalogPeak=Math.max(f.catalogPeak??0,f.catalogPending);
        setTimeout(()=>{f.catalogPending--;sendResult();},raw.action.catalogId==='broken'?350:25);
      }else if(raw.action?.kind==='import-apply')setTimeout(sendResult,150);
      else queueMicrotask(sendResult);
    };
    const profileState=()=>({activeProfileId:f.active,profiles:f.profiles.map(p=>({profileId:p.profileId,name:p.name,sourceCount:p.sources.length}))});
    switch(raw.kind){
      case 'profile-list':return emit(profileState());
      case 'profile-create':f.profiles.push({profileId:++f.sequence,name:raw.name,sources:[],history:[],mdblistConnected:false,refract:emptyRefract()});return emit(profileState());
      case 'profile-rename':{
        const target=f.profiles.find(p=>p.profileId===raw.profileId),name=raw.name.trim();
        if(!target)return emit(null,'profile-changed');
        if(!name||Array.from(name).length>64||/[\x00-\x1f\x7f]/.test(name))return emit(null,'invalid-profile-name');
        if(f.profiles.some(p=>p!==target&&p.name.toLowerCase()===name.toLowerCase()))return emit(null,'duplicate-profile');
        target.name=name;return emit(profileState());
      }
      case 'profile-switch':f.active=raw.profileId;f.pending=null;f.import=null;f.mediaReview=null;f.streamReviews=[];f.mediaGrant=null;return emit(profileState());
      case 'profile-remove':{
        const target=f.profiles.find(p=>p.profileId===raw.profileId);
        if(!target||target.profileId===f.active||target.name!==raw.confirmedName)return emit(null,'profile-confirmation');
        f.profiles=f.profiles.filter(p=>p!==target);return emit(profileState());
      }
    }
    if(raw.kind!=='profile-request'||raw.profileId!==f.active)return emit(null,'profile-changed');
    const a=raw.action,profile=f.profiles.find(p=>p.profileId===f.active);
    const reply=data=>emit({...data,profileId:raw.profileId});
    if(['catalog','metadata','item-options','all-stream-options','begin-stream-options','install','remove','move','set-enabled','import-apply','import-retry'].includes(a.kind)){f.mediaReview=null;f.streamReviews=[];f.streamQuery=null;}
    switch(a.kind){
      case 'list':return reply({sources:profile.sources});
      case 'mal-anime-list':return reply({entries:profile.malAnime??[],matches:profile.malMatches??[]});
      case 'mal-anime-import':{
        const entries=new Map((profile.malAnime??[]).map(row=>[row.malId,row]));
        for(const row of a.entries)if(!entries.has(row.malId))entries.set(row.malId,row);
        profile.malAnime=[...entries.values()];return reply({entries:profile.malAnime,matches:profile.malMatches??[]});
      }
      case 'mal-anime-remove':
        profile.malAnime=(profile.malAnime??[]).filter(row=>row.malId!==a.malId);
        profile.malMatches=(profile.malMatches??[]).filter(row=>row.malId!==a.malId);
        return reply({entries:profile.malAnime,matches:profile.malMatches});
      case 'mal-anime-match':{
        const reviewed=profile.malReview;profile.malReview=null;
        if(!reviewed||reviewed.sourceId!==a.sourceId||!profile.sources.some(s=>s.sourceId===a.sourceId&&s.enabled))return emit(null,'expired-review');
        const item=reviewed.items.find(i=>i.mediaType===a.mediaType&&i.id===a.itemId);
        if(!item||!profile.malAnime?.some(row=>row.malId===a.malId))return emit(null,'mal-invalid');
        profile.malMatches=[...(profile.malMatches??[]).filter(row=>row.malId!==a.malId),{malId:a.malId,sourceId:a.sourceId,mediaType:a.mediaType,itemId:a.itemId,name:item.name}];
        return reply({entries:profile.malAnime,matches:profile.malMatches});
      }
      case 'mal-anime-unmatch':profile.malMatches=(profile.malMatches??[]).filter(row=>row.malId!==a.malId);return reply({entries:profile.malAnime??[],matches:profile.malMatches});
      case 'watch-setup-status':return reply(profile.watchSetup??{tmdbConnected:true,accountProvider:'stremio'});
      case 'tmdb-connect':{
        if(a.key!=='00000000000000000000000000000000')return emit(null,'tmdb-auth');
        profile.watchSetup={...(profile.watchSetup??{accountProvider:null}),tmdbConnected:true};
        return reply(profile.watchSetup);
      }
      case 'mdblist-status':return reply({connected:profile.mdblistConnected});
      case 'mdblist-connect':{
        if(a.key!=='fixture-mdblist-key')return emit(null,'mdblist-auth');
        profile.mdblistConnected=true;return reply({connected:true});
      }
      case 'mdblist-disconnect':profile.mdblistConnected=false;return reply({connected:false});
      case 'mdblist-lists':
        return profile.mdblistConnected?reply({lists:[{id:42,name:'Fixture list',count:3}]}):emit(null,'mdblist-disconnected');
      case 'mdblist-page':{
        if(!profile.mdblistConnected)return emit(null,'mdblist-disconnected');
        if(a.listId===43)return emit(null,'mdblist-rate');
        if(a.listId!==42)return emit(null,'mdblist-not-found');
        const film={id:'tt123',mediaType:'movie',name:'MDBList fixture film',ratings:{imdb:85,unknown:100}};
        const series={id:'tmdb:tv:99',mediaType:'series',name:'MDBList fixture series',ratings:{}};
        const second={id:'tt456',mediaType:'movie',name:'MDBList second film',ratings:{tmdb:70}};
        return reply(a.offset===0?{items:[film,series],nextOffset:2}:{items:[film,second,second],nextOffset:a.offset+3});
      }
      case 'refract-status':return reply(profile.refract);
      case 'refract-connect':{
        if(a.key==='rfk_other_account'&&profile.refract.connected)return emit(null,'refract-account-changed');
        if(a.key!=='rfk_fixture-only')return emit(null,'refract-auth');
        profile.refract={...profile.refract,connected:true,username:'Fixture member'};return reply(profile.refract);
      }
      case 'refract-enable':
        if(!profile.refract.connected)return emit(null,'refract-disconnected');
        profile.refract.enabled=a.enabled;return reply(profile.refract);
      case 'refract-threshold':profile.refract.threshold=a.percent;return reply(profile.refract);
      case 'refract-disconnect':
        if(profile.refract.pending&&!a.discardPending)return emit(null,'refract-pending');
        profile.refract=emptyRefract();return reply(profile.refract);
      case 'refract-sync':
        return profile.refract.enabled?reply(profile.refract):emit(null,'refract-paused');
      case 'refract-watchlist':
        if(!profile.refract.connected)return emit(null,'refract-disconnected');
        if(a.mediaType!=='movie'||a.itemId!=='tt123')return emit(null,'refract-unmatched');
        return reply({result:a.add?'queued':'protected'});
      case 'watch-collections':return reply(profile.collections??{favorites:[],queue:[]});
      case 'watch-collection-set':{
        const collections=profile.collections??{favorites:[],queue:[]};
        const rows=collections[a.collection],matches=row=>row.id===a.item.id&&row.mediaType===a.item.mediaType;
        if(a.enabled&&!rows.some(matches))rows.push(a.item);
        if(!a.enabled)collections[a.collection]=rows.filter(row=>!matches(row));
        profile.collections=collections;return reply(collections);
      }
      case 'watch-history':return reply({history:profile.history});
      case 'watch-record':{
        const p=a.progress;
        const completed=profile.history.some(({progress:q,viewingId})=>q.completed&&q.mediaType===p.mediaType&&q.itemId===p.itemId&&q.videoId===p.videoId&&(!a.viewingId||a.viewingId===viewingId));
        if(p.completed&&!completed&&profile.refract.enabled)profile.refract.pending++;
        profile.history=profile.history.filter(({progress:q})=>q.mediaType!==p.mediaType||q.itemId!==p.itemId||q.videoId!==p.videoId);
        profile.history.unshift({progress:p,updatedAt:Date.now(),viewingId:a.viewingId});
        return reply({saved:true});
      }
      case 'watch-remove':{
        profile.history=profile.history.filter(({progress:q})=>q.mediaType!==a.mediaType||q.itemId!==a.itemId||q.videoId!==a.videoId);
        return reply({history:profile.history});
      }
      case 'move':{
        const index=profile.sources.findIndex(s=>s.sourceId===a.sourceId);
        if(index<0||a.position<0||a.position>=profile.sources.length)return emit(null,'invalid-position');
        const [source]=profile.sources.splice(index,1);profile.sources.splice(a.position,0,source);return reply({sources:profile.sources});
      }
      case 'import-connect':{
        if(a.email!=='fixture@example.org'||a.password!=='synthetic-password')return emit(null,'account-auth');
        const id=++f.sequence;f.import={id,provider:a.provider,phase:a.provider==='nuvio'?'profiles':'candidates'};
        if(a.provider==='nuvio')return reply({importId:id,provider:'nuvio',phase:'profiles',remoteProfiles:[
          {profileIndex:1,name:'Protected main',usesPrimaryAddons:false,locked:true},
          {profileIndex:2,name:'Shared protected',usesPrimaryAddons:true,locked:true},
          {profileIndex:3,name:'Independent',usesPrimaryAddons:false,locked:false},
          ...(f.nuvioMultipleProfiles?[{profileIndex:4,name:'Second accessible',usesPrimaryAddons:false,locked:false}]:[])
        ]});
        return reply({importId:id,provider:'stremio',phase:'candidates',availableSlots:128-profile.sources.length,skipped:1,candidates:[
          {candidateId:1,name:'Account film addon',host:'films.example.invalid',enabled:true,alreadyInstalled:false,logo:fixtureLogo},
          {candidateId:2,name:'Unavailable fixture',host:'offline.example.invalid',enabled:true,alreadyInstalled:false}
        ]});
      }
      case 'import-nuvio-profile':{
        if(f.import?.id!==a.importId||f.import.phase!=='profiles'||a.remoteProfile!==3)return emit(null,'locked-remote-profile');
        f.import.phase='candidates';
        return reply({importId:a.importId,provider:'nuvio',phase:'candidates',availableSlots:128-profile.sources.length,skipped:0,remoteProfile:3,effectiveProfile:3,candidates:[
          {candidateId:1,name:'Nuvio audio fixture',host:'nuvio-addon.example.invalid',enabled:false,alreadyInstalled:false}
        ]});
      }
      case 'import-review':{
        if(f.import?.id!==a.importId||f.import.phase!=='candidates'||!a.selected.includes(1))return emit(null,'import-selection');
        const nuvio=f.import.provider==='nuvio';f.import.phase='review';
        const ready={candidateId:1,name:nuvio?'Nuvio audio fixture':'Account film addon',host:nuvio?'nuvio-addon.example.invalid':'films.example.invalid',enabled:!nuvio,manifest:{...manifest,logo:fixtureLogo,name:nuvio?'Nuvio audio fixture':'Account film addon'}};
        f.import.ready=[ready];
        return reply({importId:a.importId,provider:f.import.provider,phase:'review',ready:[ready],rejected:nuvio?[]:[{candidateId:2,name:'Unavailable fixture',reason:'network'}]});
      }
      case 'import-apply':{
        if(f.import?.id!==a.importId||f.import.phase!=='review')return emit(null,'expired-review');
        profile.sources.unshift(...f.import.ready.map(ready=>({sourceId:++f.sequence,enabled:ready.enabled,manifest:ready.manifest})));
        if(profile.watchSetup&&f.import.ready.length)profile.watchSetup.accountProvider=f.import.provider;
        const rejected=f.import.provider==='nuvio'?[]:[{candidateId:2,name:'Unavailable fixture',reason:'network'}];
        const retryImportId=rejected.length?f.import.id:null;
        const historyImport=f.import.provider==='stremio'?{imported:1,unavailable:false}:undefined;
        if(historyImport&&!profile.history.some(row=>row.progress.itemId==='tt90123'))profile.history.push({
          progress:{mediaType:'series',itemId:'tt90123',videoId:'tt90123:2:3',title:'Imported continue watching fixture',episodeTitle:null,positionMs:45000,durationMs:120000,completed:false},
          updatedAt:1704164645000,importedStremio:true
        });
        if(retryImportId!==null)f.import.phase='retry';else f.import=null;
        return reply({sources:profile.sources,rejected,retryImportId,historyImport});
      }
      case 'import-retry':{
        if(f.import?.id!==a.importId||f.import.phase!=='retry')return emit(null,'expired-review');
        profile.sources.splice(1,0,{sourceId:++f.sequence,enabled:true,manifest:{...manifest,name:'Recovered fixture'}});
        f.import=null;return reply({sources:profile.sources,rejected:[],retryImportId:null});
      }
      case 'import-cancel':f.import=null;return reply({cancelled:true});
      case 'review':
        assertFixtureUrl(a.url);
        if(f.manifestMode==='bad-extras'){f.pending=null;return emit(null,'manifest-extras');}
        f.pending=++f.sequence;
        return reply({reviewId:f.pending,manifest:f.manifestMode==='large'?{...manifest,catalogs:[...manifest.catalogs,...Array.from({length:199},(_,index)=>({id:'fixture-'+index,mediaType:'movie',name:'Catalogue '+index,extras:[]}))]}:manifest});
      case 'cancel-review':if(f.pending===a.reviewId)f.pending=null;return reply({cancelled:true});
      case 'install':
        if(f.pending!==a.reviewId)return emit(null,'expired-review');
        profile.sources.push({sourceId:f.pending,enabled:true,manifest});f.pending=null;return reply({sources:profile.sources});
      case 'set-enabled':profile.sources=profile.sources.map(s=>s.sourceId===a.sourceId?{...s,enabled:a.enabled}:s);return reply({sources:profile.sources});
      case 'remove':profile.sources=profile.sources.filter(s=>s.sourceId!==a.sourceId);return reply({sources:profile.sources});
      case 'metadata':{
        const source=profile.sources.find(s=>s.sourceId===a.sourceId&&s.enabled&&s.manifest.resources.includes('meta'));
        if(a.sourceId===0&&f.boardFixture&&a.itemId==='tt90007')return reply({sourceId:0,metadata:{id:a.itemId,mediaType:'movie',name:'Fixture alias movie',description:null,videos:[{id:a.itemId,name:'Fixture alias movie',season:null,episode:null}]}});
        if(f.boardFixture&&source?.sourceId===103&&a.itemId==='tmdb:90007')return reply({sourceId:103,metadata:{id:a.itemId,mediaType:'movie',name:'Fixture alias movie',description:null,videos:[{id:a.itemId,name:'Fixture alias movie',season:null,episode:null}],identities:['tt90007','tmdb:90007']}});
        if(f.boardFixture&&a.itemId==='tmdb:tv:90021')return emit(null,'unsupported-resource');
        if(f.boardFixture&&a.itemId==='tt90021'){
          if(a.sourceId!==0)return emit(null,'unsupported-resource');
          return reply({sourceId:0,metadata:{id:a.itemId,mediaType:'series',name:'Family Guy',description:'Synthetic ordinary TV series.',videos:[{id:'tt90021:1:1',name:'TV fixture pilot',season:1,episode:1,thumbnail:'https://image.tmdb.org/t/p/w300/episode.jpg'}]}});
        }
        if(a.sourceId===0&&f.boardFixture&&a.itemId==='kitsu:90005'&&a.mediaType==='movie')return reply({sourceId:0,metadata:{id:a.itemId,mediaType:'movie',name:'Public anime film fixture',description:'Public mapped anime film metadata.',videos:[{id:a.itemId,name:'Public anime film fixture',season:null,episode:null}]}});
        if(a.sourceId===0&&f.boardFixture&&a.itemId==='tt90003')return reply({sourceId:0,metadata:{id:a.itemId,mediaType:'movie',name:'Public movie fixture',description:'Public metadata without a catalogue addon.',videos:[]}});
        if(a.sourceId===0&&f.boardFixture&&a.itemId==='kitsu:90004'&&a.mediaType==='series')return reply({sourceId:0,metadata:{id:a.itemId,mediaType:'series',name:'Public anime discovery fixture',description:'Public mapped anime metadata.',videos:[{id:'kitsu:90004:1',name:'Episode one',season:1,episode:1},{id:'kitsu:90004:2',name:'Episode two',season:1,episode:2}]}});
        if(f.boardFixture&&a.itemId==='tmdb:movie:90008')return emit(null,'unsupported-resource');
        if(f.boardFixture&&a.itemId==='tt90008'){
          if(a.sourceId!==0)return emit(null,'unsupported-resource');
          return reply({sourceId:0,metadata:{id:a.itemId,mediaType:'movie',name:'Fixture franchise sequel',description:'A separate franchise movie.',videos:[{id:a.itemId,name:'Fixture franchise sequel',season:null,episode:null}]}});
        }
        if(f.boardFixture&&a.itemId==='tmdb:tv:90025')return emit(null,'unsupported-resource');
        if(f.boardFixture&&a.itemId==='tt90025'){
          if(a.sourceId!==0)return emit(null,'unsupported-resource');
          return reply({sourceId:0,metadata:{id:a.itemId,mediaType:'series',name:'Related fixture series',description:'A separate related title.',videos:[{id:'tt90025:1:1',name:'Related first episode',season:1,episode:1}]}});
        }
        if(!f.boardFixture||!source||source.sourceId!==103)return emit(null,'unsupported-resource');
        if(f.failMetadata)return emit(null,'request');
        const videos=!f.emptyMetadata&&a.mediaType==='series'?[{id:'tt90002:1:1',name:'Episode one',season:1,episode:1,thumbnail:'https://image.tmdb.org/t/p/w300/episode.jpg',description:'Episode overview from the provider.'},{id:'tt90002:1:2',name:'Episode two',season:1,episode:2},{id:'tt90002:0:1',name:'Special',season:0,episode:1},{id:'tt90002:2:1',name:'Second season',season:2,episode:1},{id:'tt90002:extra',name:'Unnumbered episode',season:null,episode:null}]:[];
        return reply({sourceId:a.sourceId,mediaType:a.mediaType,itemId:a.itemId,metadata:{id:a.itemId,name:a.mediaType==='series'?'Fixture anime series':'Fixture cinema film',mediaType:a.mediaType,description:'Metadata from the separate metadata addon.',poster:'https://image.tmdb.org/t/p/w500/detail.jpg',background:'https://images.metahub.space/background/medium/tt90001/img',imdbRating:8.6,releaseInfo:'2024',runtime:'57 min',genres:['Drama'],cast:['Fixture Actor'],directors:['Fixture Director'],videos}});
      }
      case 'tmdb-search':return reply({items:f.boardFixture&&a.query.toLowerCase()==='family guy'?[
        {id:'tmdb:movie:90022',mediaType:'movie',name:'Family Guy Presents: Blue Harvest',poster:'https://image.tmdb.org/t/p/w500/film-fixture.jpg',description:'Synthetic movie result.',releaseInfo:'2007'},
        {id:'tmdb:tv:90021',mediaType:'series',name:'Family Guy',poster:'https://image.tmdb.org/t/p/w500/series-fixture.jpg',background:'https://image.tmdb.org/t/p/w1280/series-fixture.jpg',description:'Synthetic series result.',releaseInfo:'1999'},
        {id:'tmdb:movie:90023',mediaType:'movie',name:'Family Guy Presents: Something, Something, Something, Dark Side',poster:'https://image.tmdb.org/t/p/w500/second-film-fixture.jpg',releaseInfo:'2009'},
        {id:'tmdb:tv:90024',mediaType:'series',name:'Unrelated series',poster:'https://image.tmdb.org/t/p/w500/unrelated.jpg'}
      ]:[]});
      case 'tmdb-title':
        if(f.boardFixture&&['tmdb:tv:90021','tt90021'].includes(a.itemId))return reply({item:{id:'tmdb:tv:90021',tmdbId:90021,mediaType:'series',name:'Family Guy',imdbId:'tt90021',poster:'https://image.tmdb.org/t/p/w500/series-fixture.jpg',background:'https://image.tmdb.org/t/p/w1280/series-fixture.jpg',releaseInfo:'1999'}});
        if(f.boardFixture&&['tt90001','tmdb:movie:90001','tmdb:90001'].includes(a.itemId))return reply({item:{id:'tmdb:movie:90001',tmdbId:90001,mediaType:'movie',name:'Fixture cinema film',imdbId:'tt90001',collectionId:99001,poster:'https://image.tmdb.org/t/p/w500/cinema.jpg',background:'https://image.tmdb.org/t/p/w1280/cinema.jpg',tmdbRating:8.1,releaseInfo:'2024'}});
        if(f.boardFixture&&['tt90008','tmdb:movie:90008'].includes(a.itemId))return reply({item:{id:'tmdb:movie:90008',tmdbId:90008,mediaType:'movie',name:'Fixture franchise sequel',imdbId:'tt90008',poster:'https://image.tmdb.org/t/p/w500/sequel.jpg',releaseInfo:'2025'}});
        if(f.boardFixture&&a.itemId==='tt90002')return reply({item:{id:'tmdb:tv:90002',tmdbId:90002,mediaType:'series',name:'Fixture anime series',imdbId:'tt90002',genres:['Drama','Animation'],tagline:'A fixture tagline',castMembers:[{id:1,name:'Fixture Actor',character:'Lead role',portrait:'https://image.tmdb.org/t/p/w185/person.jpg'},{id:2,name:'Another actor'}],crewCredits:[{role:'director',names:['Fixture Director']},{role:'writer',names:['Fixture Writer']}],related:[{id:'tmdb:tv:90002',mediaType:'series',name:'Current title',poster:'https://image.tmdb.org/t/p/w500/anime.jpg'},{id:'tmdb:tv:90025',mediaType:'series',name:'Related fixture series',poster:'https://image.tmdb.org/t/p/w500/related.jpg',tmdbRating:7.7,releaseInfo:'2023'},{id:'tmdb:tv:90025',mediaType:'series',name:'Duplicate fixture',poster:'https://image.tmdb.org/t/p/w500/related.jpg'},{id:'invalid',mediaType:'series',name:'Malformed fixture'},{id:'tmdb:movie:90026',mediaType:'movie',name:'Wrong-kind fixture',poster:'https://image.tmdb.org/t/p/w500/wrong.jpg'}],poster:'https://image.tmdb.org/t/p/w500/anime.jpg',background:'https://image.tmdb.org/t/p/w1280/anime.jpg',description:'A synthetic series used for layout verification.',releaseInfo:'2024',tmdbRating:8.4}});
        if(f.boardFixture&&['tmdb:tv:90025','tt90025'].includes(a.itemId))return reply({item:{id:'tmdb:tv:90025',tmdbId:90025,mediaType:'series',name:'Related fixture series',imdbId:'tt90025',identities:['tmdb:tv:90025','tt90025'],poster:'https://image.tmdb.org/t/p/w500/related.jpg',description:'A separate related title.',tmdbRating:7.7}});
        return emit(null,'tmdb-not-found');
      case 'tmdb-watch-providers':return reply({mediaType:a.mediaType,tmdbId:a.tmdbId,regions:f.boardFixture&&a.tmdbId===90001?[{country:'BE',providers:{flatrate:[{id:11,name:'Fixture Plus',logo:'https://image.tmdb.org/t/p/w92/provider.png'}],rent:[{id:12,name:'Fixture Rental'}]}},{country:'US',providers:{buy:[{id:13,name:'Fixture Store'}]}}]:[]});
      case 'tmdb-collection':return reply({collectionId:a.collectionId,tmdbId:a.tmdbId,name:'Fixture franchise',items:f.boardFixture&&a.collectionId===99001&&a.tmdbId===90001?[{id:'tmdb:movie:90008',mediaType:'movie',name:'Fixture franchise sequel',poster:'https://image.tmdb.org/t/p/w500/sequel.jpg',releaseInfo:'2025'},{id:'tmdb:movie:90008',mediaType:'movie',name:'Duplicate'},{id:'tmdb:movie:90001',mediaType:'movie',name:'Current'},{id:'tmdb:tv:90009',mediaType:'series',name:'Wrong type'}]:[]});
      case 'tmdb-season':return reply({tmdbId:a.tmdbId,season:a.season,episodes:a.tmdbId===90002&&a.season===1?[{episode:1,thumbnail:'https://image.tmdb.org/t/p/w500/episode-one.jpg',runtime:24,tmdbRating:8.5},{episode:2,thumbnail:'https://image.tmdb.org/t/p/w500/episode-two.jpg',description:'A synopsis supplied by TMDB.',runtime:25,tmdbRating:8.2}]:[]});
      case 'begin-stream-options':
      case 'all-stream-options':{
        f.streamQuery={mediaType:a.mediaType,videoId:a.videoId,sourceIds:profile.sources.filter(s=>s.enabled&&s.manifest.resources.includes('stream')).map(s=>s.sourceId)};
        const groups=profile.sources.filter(s=>s.enabled&&s.manifest.resources.includes('stream')).map(source=>{
          if(f.boardFixture&&source.sourceId===104)return {sourceId:source.sourceId,reviewId:null,options:[],error:'request'};
          const id=++f.sequence;f.streamReviews.push({id,sourceId:source.sourceId,subtitles:false});
          return {sourceId:source.sourceId,reviewId:id,error:null,options:[{name:'HD fixture',...(f.boardFixture&&source.sourceId===102?{detail:'720p AAC\n700 MB · uncached'}:{}),supported:true,reason:'direct-https',language:null},...(f.boardFixture&&source.sourceId===102?[{name:'Alternate HD fixture\n⚡  Provider',detail:'1080p HEVC\nTrueHD Atmos · 8.5 GB · cached\n\n'+'LongFixtureReleaseName.'.repeat(30)+'mkv',supported:true,reason:'direct-https',language:null}]:[]),{name:'Unsupported fixture',supported:false,reason:'unsupported-transport',language:null}]};
        });
        if(a.kind==='begin-stream-options'){
          const queryId=++f.sequence;f.progressive={queryId,mediaType:a.mediaType,videoId:a.videoId,groups};
          const pending=groups.length>1?groups.slice(1):[];
          return reply({queryId,mediaType:a.mediaType,videoId:a.videoId,groups:groups.slice(0,1),pendingSourceIds:pending.map(g=>g.sourceId),done:pending.length===0});
        }
        return reply({mediaType:a.mediaType,videoId:a.videoId,groups});
      }
      case 'poll-stream-options':{
        if(!f.progressive||f.progressive.queryId!==a.queryId||!f.streamQuery)return emit(null,'expired-review');
        const pending=f.progressive.groups.slice(1);
        if(f.holdStreamCompletion&&pending.length)return reply({...f.progressive,groups:f.progressive.groups.slice(0,1),pendingSourceIds:pending.map(g=>g.sourceId),done:false});
        return reply({...f.progressive,pendingSourceIds:[],done:true});
      }
      case 'cancel-stream-options':{
        if(f.progressive?.queryId===a.queryId){f.progressive=null;f.streamQuery=null;f.streamReviews=[];}
        return reply({cancelled:true});
      }
      case 'retry-stream-options':{
        if(!f.streamQuery||f.streamQuery.mediaType!==a.mediaType||f.streamQuery.videoId!==a.videoId)return emit(null,'expired-review');
        if(!f.streamQuery.sourceIds.includes(a.sourceId))return emit(null,'unsupported-resource');
        f.streamReviews=f.streamReviews.filter(r=>r.sourceId!==a.sourceId);
        const id=++f.sequence;f.streamReviews.push({id,sourceId:a.sourceId,subtitles:false});
        return reply({mediaType:a.mediaType,videoId:a.videoId,group:{sourceId:a.sourceId,reviewId:id,error:null,options:[{name:'Recovered fixture',detail:'720p',supported:true,reason:'direct-https',language:null}]}});
      }
      case 'item-options':{
        if(!profile.sources.some(s=>s.sourceId===a.sourceId&&s.enabled)||a.videoId!=='tt123')return emit(null,'unsupported-resource');
        const id=++f.sequence;
        f.mediaReview={id,subtitles:a.subtitles};
        return reply({sourceId:a.sourceId,mediaType:a.mediaType,videoId:a.videoId,subtitles:a.subtitles,reviewId:id,options:a.subtitles?
          [{name:'English fixture',supported:true,reason:'direct-https',language:'eng'}]:
          [{name:'HD fixture',supported:true,reason:'direct-https',language:null},{name:'Unsupported fixture',supported:false,reason:'unsupported-transport',language:null}]});
      }
      case 'prepare-media':{
        const review=f.mediaReview?.id===a.reviewId?f.mediaReview:f.streamReviews.find(r=>r.id===a.reviewId);
        if(f.holdStreamCompletion&&f.progressive&&f.streamQuery&&review?.id===a.reviewId){
          f.preparedWhilePending={videoId:f.streamQuery.videoId,sourceId:review.sourceId,pendingSourceIds:f.progressive.groups.slice(1).map(g=>g.sourceId)};
        }
        f.mediaReview=null;f.streamReviews=[];f.streamQuery=null;
        if(review?.id!==a.reviewId||(a.optionIndex!==0&&!(f.boardFixture&&a.optionIndex===1&&!review.subtitles)))return emit(null,'expired-review');
        f.mediaCalls.push({type:'prepare-media',optionIndex:a.optionIndex,startMs:a.startMs});
        f.mediaGrant={id:++f.sequence,subtitles:review.subtitles,startMs:a.startMs};
        return reply({grantId:f.mediaGrant.id,subtitles:review.subtitles});
      }
      case 'browse-catalog':
      case 'catalog':{
        if(a.sourceId===0){
          const items=f.boardFixture&&a.mediaType==='movie'&&a.catalogId==='top'?[{id:'tt90003',mediaType:'movie',name:'Public movie fixture',poster:'https://image.tmdb.org/t/p/w342/public.jpg'}]:[];
          return reply({sourceId:0,mediaType:a.mediaType,catalogId:a.catalogId,items,sourceCount:items.length,nextSkip:null});
        }
        if(f.boardFixture){
          const source=profile.sources.find(s=>s.sourceId===a.sourceId&&s.enabled);
          const catalogue=source?.manifest.catalogs.find(c=>c.id===a.catalogId&&c.mediaType===a.mediaType);
          if(!catalogue)return emit(null,'unsupported-resource');
          if(a.catalogId==='broken')return emit(null,'request');
          if(a.catalogId==='empty')return reply({sourceId:a.sourceId,mediaType:a.mediaType,catalogId:a.catalogId,items:[],sourceCount:0,nextSkip:null});
          if(a.catalogId==='mal.airing')return reply({sourceId:a.sourceId,mediaType:a.mediaType,catalogId:a.catalogId,items:[
            {id:'mal:123',mediaType:'anime.series',name:'MAL airing series fixture',poster:'https://image.tmdb.org/t/p/w342/anime.jpg'},
            {id:'mal:456',mediaType:'anime.movie',name:'MAL airing film fixture',poster:'https://image.tmdb.org/t/p/w342/anime.jpg'}
          ],sourceCount:2,nextSkip:null});
          const items=a.extras.search?(a.catalogId==='films'?[
            {id:'tmdb:90001',imdbId:'tt90001',mediaType:'movie',name:'Fixture cinema film',poster:'https://image.tmdb.org/t/p/w342/cinema.jpg'},
            {id:'local:9',mediaType:'movie',name:'Another film'},
            {id:'tmdb:90007',imdbId:'tt90007',mediaType:'movie',name:'Fixture alias movie'}
          ]:a.catalogId==='duplicate-search'?[
            {id:'tt90001',mediaType:'movie',name:'Fixture cinema film'},
            {id:'tt90005',mediaType:'movie',name:'Fixture cinema film sequel'}
          ]:a.catalogId==='anime'&&a.extras.search.toLowerCase()==='fixture anime series'?[{id:'tt90002',mediaType:'series',name:'Fixture anime series',poster:'https://image.tmdb.org/t/p/w342/anime.jpg'}]:[]):a.mediaType==='series'?[{id:'tt90002',mediaType:'series',name:'Fixture anime series',poster:'https://image.tmdb.org/t/p/w342/anime.jpg'}]:[{id:'tt90001',mediaType:'movie',name:'Fixture cinema film',poster:'https://image.tmdb.org/t/p/w342/cinema.jpg',addonPoster:'http://tsugi-addon-art.localhost/poster/'+'a'.repeat(32),background:'https://image.tmdb.org/t/p/w780/cinema.jpg'}];
          return reply({sourceId:a.sourceId,mediaType:a.mediaType,catalogId:a.catalogId,items,sourceCount:items.length,nextSkip:null});
        }
        if(!profile.sources.some(s=>s.sourceId===a.sourceId&&s.enabled)||a.catalogId!=='search'||a.mediaType!=='movie'||a.extras.search!=='original')return emit(null,'invalid-extras');
        const skip=Number(a.extras.skip??0);
        const items=[{id:skip===0?'tt123':'tt456',name:skip===0?'First original film':'Second original film',mediaType:'movie'}];
        if(a.kind==='catalog')profile.malReview={sourceId:a.sourceId,items};
        return reply({sourceId:a.sourceId,mediaType:'movie',catalogId:'search',items,sourceCount:1,nextSkip:skip+1});
      }
      default:return emit(null,'request');
    }
  };
  function assertFixtureUrl(url){if(url!=='https://example.invalid/private-fixture/manifest.json?token=fixture')throw Error('unexpected fixture endpoint');}
}

async function verifyContentFirstWatch({browser,origin,installDesktopFixture,screenshotDir}){
  const page=await browser.newPage({viewport:{width:1600,height:900}});
  try{
    await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    await page.route('https://raw.githubusercontent.com/example/fixture/main/logo.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"><rect x="5" y="5" width="62" height="62" rx="14" fill="#b3624e"/><path d="M24 20L52 36 24 52Z" fill="white"/></svg>'}));
    await page.route('https://relations.yuna.moe/api/ids?**',route=>route.fulfill({json:{kitsu:new URL(route.request().url()).searchParams.get('id')==='90005'?90005:90004},headers:{'access-control-allow-origin':'*'}}));
    const posterImage=await readFile(new URL('../public/design/anime/art-torii.webp',import.meta.url));
    const heroImage=await readFile(new URL('../public/design/shared/hero-neon.webp',import.meta.url));
    const episodeImage=await readFile(new URL('../public/design/anime/art-train.webp',import.meta.url));
    const movieImage=await readFile(new URL('../public/design/shared/hero-train.webp',import.meta.url));
    async function assertArtwork(card){
      await card.scrollIntoViewIfNeeded();
      const image=card.locator('img[src]:not([src=""])');
      await image.waitFor({state:'visible'});
      assert.ok(await image.evaluate(async el=>{await el.decode();return el.naturalWidth>0&&el.naturalHeight>0;}),'actual artwork decodes');
      await page.waitForFunction(el=>Number(getComputedStyle(el).opacity)>=0.95,await image.elementHandle());
    }
    const discoveryPoster='https://cdn.myanimelist.net/images/anime/1/90004.jpg';
    const missingDiscoveryPoster='https://cdn.myanimelist.net/images/anime/1/90004l.webp';
    let missingDiscoveryArtRequests=0,discoveryArtRequests=0;
    await page.route(missingDiscoveryPoster,route=>{missingDiscoveryArtRequests++;return route.fulfill({status:404,headers:{'access-control-allow-origin':'*'},body:''});});
    await page.route(discoveryPoster,route=>{discoveryArtRequests++;return route.fulfill({contentType:'image/webp',body:posterImage,headers:{'access-control-allow-origin':'*'}});});
    const missingResumePoster='https://image.tmdb.org/t/p/w500/resume-missing.jpg';
    const availableResumePoster='https://image.tmdb.org/t/p/w500/resume-present.jpg';
    let missingResumeRequests=0,availableResumeRequests=0;
    await page.route('https://image.tmdb.org/t/p/**',route=>{
      const url=route.request().url();
      if(url===missingResumePoster){missingResumeRequests++;return route.fulfill({status:404,headers:{'access-control-allow-origin':'*'},body:''});}
      if(url===availableResumePoster)availableResumeRequests++;
      const body=url.includes('episode')?episodeImage:url.includes('/w1280/')||url.includes('/w780/')?heroImage:url.includes('film')||url.includes('cinema')?movieImage:posterImage;
      return route.fulfill({contentType:'image/webp',body,headers:{'access-control-allow-origin':'*'}});
    });
    await page.route('https://images.metahub.space/background/**',route=>route.fulfill({contentType:'image/webp',body:heroImage,headers:{'access-control-allow-origin':'*'}}));
    let addonArtRequests=0;
    await page.route('http://tsugi-addon-art.localhost/poster/**',route=>{
      addonArtRequests++;return route.fulfill({contentType:'image/webp',body:posterImage,headers:{'access-control-allow-origin':'*','cache-control':'no-store'}});
    });
    const tvmazeRequests=[];
    let tvmazeSearchUnavailable=false;
    const tvmazePoster='https://static.tvmaze.com/uploads/images/medium_portrait/1/90021.jpg';
    await page.route(tvmazePoster,route=>route.fulfill({contentType:'image/webp',body:posterImage,headers:{'access-control-allow-origin':'*'}}));
    await page.route('https://api.tvmaze.com/**',route=>{
      const url=new URL(route.request().url());
      tvmazeRequests.push(url.pathname);
      if(tvmazeSearchUnavailable&&url.pathname==='/search/shows')return route.fulfill({status:503,body:'unavailable',headers:{'access-control-allow-origin':'*'}});
      const show={id:21,name:'Family Guy',type:'Animation',genres:['Comedy'],externals:{imdb:'tt90021'},image:{medium:tvmazePoster},premiered:'1999-01-31'};
      if(url.pathname==='/shows')return route.fulfill({json:[show,
        {...show,id:22,name:'Korean drama fixture',type:'Scripted',language:'Korean',genres:['Drama','Romance'],network:{country:{code:'KR'}},externals:{imdb:'tt90022'}},
        {...show,id:23,name:'Crime and thriller fixture',type:'Scripted',genres:['Crime','Thriller','Mystery','Action'],externals:{imdb:'tt90023'}}
      ],headers:{'access-control-allow-origin':'*'}});
      const row=url.pathname==='/schedule/web'?{_embedded:{show}}:{show};
      return route.fulfill({json:[row,row,{show:{...show,name:'Unmapped series',externals:{imdb:null}}}],headers:{'access-control-allow-origin':'*'}});
    });
    await page.route('https://api.tenrai.org/v1/**',route=>{
      const films=new URL(route.request().url()).searchParams.get('type')==='movie';
      return route.fulfill({json:{data:[{mal_id:films?90005:90004,title:films?'Public anime film fixture':'Public anime discovery fixture',type:films?'Movie':'TV',rating:'PG-13 - Teens 13 or older',score:8.6,images:{webp:{large_image_url:missingDiscoveryPoster},jpg:{image_url:discoveryPoster}},synopsis:'Independent discovery without addon installation.'}]},headers:{'access-control-allow-origin':'*'}});
    });
    await page.addInitScript({content:'('+installDesktopFixture.toString()+')();('+installStremioFixture.toString()+')();('+function(){
      const f=window.__stremioFixture;f.boardFixture=true;f.sequence=110;
      localStorage.setItem('tsugi.landscape.local-only','true');
      const addon=(sourceId,name,resources,catalogs=[],enabled=true)=>({sourceId,enabled,manifest:{id:'fixture.'+sourceId,name,version:'1.0.0',resources,configurable:false,configurationRequired:false,p2p:false,adult:false,catalogs}});
      const catalog=(id,mediaType,name,extras=[])=>({id,mediaType,name,extras});
      const searchExtra={name:'search',required:false,options:[],optionsLimit:null};
      f.profiles[0].sources=[
        addon(101,'Catalogue only',['catalog','meta'],[catalog('films','movie','Popular films',[searchExtra]),catalog('anime','series','Trending anime',[searchExtra]),catalog('mal.airing','anime','MAL Airing Now'),catalog('broken','movie','Unavailable catalogue'),catalog('empty','movie','Empty catalogue'),catalog('duplicate-search','movie','More films',[{...searchExtra,required:true}])]),
        addon(102,'Streaming only',['stream']),
        addon(103,'Metadata only',['meta']),
        addon(104,'Failed stream addon',['stream']),
        addon(105,'Disabled addon',['catalog','stream'],[catalog('disabled','movie','Disabled films')],false)
      ];
      f.profiles.push({...structuredClone(f.profiles[0]),profileId:2,name:'Stream only',sources:[addon(106,'Independent stream',['stream'])]});
      f.profiles.push({...structuredClone(f.profiles[0]),profileId:3,name:'Browse only',sources:[]});
      // Model persisted native history and local artwork at a fresh renderer startup.
      const history=(id,title)=>({progress:{mediaType:'movie',itemId:id,videoId:id,title,episodeTitle:null,positionMs:45000,durationMs:120000,completed:false},updatedAt:Date.now()});
      f.profiles[0].history=[history('tt90031','Saved fallback fixture')];
      const key=id=>JSON.stringify(['movie',id,id]);
      localStorage.setItem('tsugi-watch-artwork-v2:1',JSON.stringify({[key('tt90031')]:['https://image.tmdb.org/t/p/w500/resume-missing.jpg','https://image.tmdb.org/t/p/w500/resume-present.jpg','https://example.invalid/private-fixture/manifest.json?token=fixture']}));
      localStorage.setItem('tsugi-watch-artwork-v1:2',JSON.stringify({[key('tt90032')]:'https://image.tmdb.org/t/p/w500/resume-present.jpg'}));
      f.profiles[1].history=[history('tt90032','Legacy artwork fixture')];
    }.toString()+')();'});
    await page.goto(origin);
    await page.getByRole('button',{name:'Movies & TV',exact:true}).first().click();
    const watch=page.locator('[data-page="direct-watch"]');
    const profilePicker=watch.locator('[data-ui="watch-profile-picker"]');
    await profilePicker.getByRole('button',{name:'Default 5 addons',exact:true}).waitFor();
    async function assertProfileFits(label){
      await page.waitForFunction(()=>document.fonts.status==='loaded');
      const size=await watch.evaluate(root=>{
        const p=root.querySelector('[data-ui="watch-profile-picker"]'),r=root.getBoundingClientRect();
        const controls=Array.from(p.querySelectorAll('button,input')).filter(node=>node.getBoundingClientRect().width>0);
        return {height:root.clientHeight,scrollHeight:root.scrollHeight,width:root.clientWidth,scrollWidth:root.scrollWidth,
          allVisible:controls.every(node=>{const b=node.getBoundingClientRect();return b.top>=r.top&&b.bottom<=r.bottom+1&&b.left>=r.left&&b.right<=r.right+1;})};
      });
      assert.ok(size.scrollHeight<=size.height+1&&size.scrollWidth<=size.width+1&&size.allVisible,label+' profile chooser fits: '+JSON.stringify(size));
    }
    await assertProfileFits('1600x900');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-profile-desktop-fit.png'),animations:'disabled'});
    await page.setViewportSize({width:1024,height:640});
    await assertProfileFits('1024x640');
    await profilePicker.getByRole('button',{name:'Create profile',exact:true}).click();
    await profilePicker.getByLabel('Profile name',{exact:true}).fill('New profile fixture');
    await assertProfileFits('1024x640 create form');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-profile-create-fit.png'),animations:'disabled'});
    await profilePicker.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.setViewportSize({width:1600,height:900});
    await profilePicker.getByRole('button',{name:'Default 5 addons',exact:true}).click();
    const hubPicker=watch.locator('[data-ui="watch-hub-picker"]');
    await hubPicker.waitFor();
    for(const [destination,asset] of [['aio','aio'],['standalone','movies'],['anime','anime']]){
      const img=hubPicker.locator('[data-watch-destination="'+destination+'"] img');
      assert.equal(await img.getAttribute('src'),'/design/watch/watch-'+asset+'.webp');
      await img.evaluate(node=>node.decode());
      assert.equal(await img.evaluate(node=>getComputedStyle(node).filter),'blur(2px)');
      assert.equal(await hubPicker.locator('[data-watch-destination="'+destination+'"] svg').evaluate(node=>getComputedStyle(node).filter),'none');
    }
    assert.equal(await hubPicker.locator('header').evaluate(node=>getComputedStyle(node,'::before').filter),'blur(2px)');
    assert.equal(await hubPicker.locator('header').evaluate(node=>getComputedStyle(node).filter),'none');
    const banner=await hubPicker.locator('header').evaluate(node=>getComputedStyle(node).getPropertyValue('--tsugi-watch-art'));
    assert.ok(banner.includes('/design/watch/watch-hero.webp'));
    await page.evaluate(async()=>{const img=new Image();img.src='/design/watch/watch-hero.webp';await img.decode();});
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-minimalist-hubs.png'),animations:'disabled'});
    await hubPicker.locator('[data-watch-destination="standalone"]').click();
    const board=watch.locator('[data-ui="watch-catalogue-board"]');
    const film=board.locator('[data-ui="poster-card"][aria-label="Fixture cinema film"]');
    await film.waitFor();
    assert.equal(await board.locator('[data-ui="media-row"]').count()>0,true);
    assert.equal(await film.getAttribute('data-ui'),'poster-card');
    await assertArtwork(film);
    assert.ok(await film.locator('img').evaluateAll(nodes=>nodes.length>0&&nodes.every(node=>getComputedStyle(node).filter==='none')),'addon poster remains sharp');
    assert.ok(addonArtRequests>0,'the imported addon poster is requested without an override');
    const malRow=board.locator('[data-ui="watch-catalogue-shelf"]').filter({hasText:'MAL Airing Now'});
    await malRow.getByRole('button',{name:'MAL airing series fixture',exact:true}).waitFor();
    assert.equal(await malRow.getByRole('button',{name:'MAL airing film fixture',exact:true}).count(),1);
    assert.equal(await malRow.locator('[data-ui="poster-card"]').first().getAttribute('aria-label'),'MAL airing series fixture');
    const customUrl='https://btttr.cc/poster/imdb/poster-default/tt90001.jpg';
    let customRequests=0;
    await page.route('https://btttr.cc/**',route=>{if(route.request().url()===customUrl)customRequests++;return route.fulfill({status:404});});
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Settings',exact:true}).click();
    await watch.locator('[data-ui="watch-settings-navigation"]').getByRole('button',{name:'Artwork',exact:true}).click();
    const posterSettings=watch.locator('[data-ui="watch-poster-settings"]');
    await posterSettings.getByRole('button',{name:'BetterPosters',exact:true}).click();
    await posterSettings.getByRole('button',{name:'Save poster preference',exact:true}).click();
    await posterSettings.getByText('Custom posters enabled for this profile.',{exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('tsugi-watch-poster-pattern-v1:1')).startsWith('https://btttr.cc/')));
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Home',exact:true}).click();
    await film.waitFor();
    await film.scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-ui="poster-card"][aria-label="Fixture cinema film"] img')).some(img=>img.complete&&img.naturalWidth>0));
    assert.ok(customRequests>0,'public custom poster was requested');
    await assertArtwork(film);
    console.log('PASS: opt-in custom poster requests fall back to original catalogue art on provider failure.');
    const cachedResume=board.locator('[data-ui="watch-continue-shelf"] [data-ui="wide-card"]').filter({hasText:'Saved fallback fixture'});
    await cachedResume.waitFor();
    await cachedResume.scrollIntoViewIfNeeded();
    await cachedResume.locator('[data-ui="wide-card-time"]').filter({hasText:'2 min left'}).waitFor();
    await page.waitForFunction(card=>Array.from(card.querySelectorAll('img')).some(image=>image.complete&&image.naturalWidth>0),await cachedResume.elementHandle());
    await assertArtwork(cachedResume);
    assert.ok(missingResumeRequests>0&&availableResumeRequests>0,'persisted resume artwork falls back after a failed first URL');
    assert.equal(await page.evaluate(()=>window.__stremioFixture.calls.some(a=>a.kind==='profile-request'&&a.action.kind==='tmdb-title'&&a.action.itemId==='tt90031')),false);
    const shelfFont=await board.locator('[data-ui="media-row-title"]').first().evaluate(el=>({family:getComputedStyle(el).fontFamily,weight:Number(getComputedStyle(el).fontWeight)}));
    assert.match(shelfFont.family,/^Interface(?:,|$)/);
    assert.ok(await page.evaluate(async()=>{const faces=await document.fonts.load('600 18px Interface','Popular films');return faces.some(face=>face.family==='Interface'&&face.status==='loaded');}));
    assert.ok(shelfFont.weight>=600&&shelfFont.weight<=750);
    const heroFont=await board.locator('[data-ui="hero"] h2').evaluate(el=>({family:getComputedStyle(el).fontFamily,weight:Number(getComputedStyle(el).fontWeight)}));
    assert.match(heroFont.family,/^Interface(?:,|$)/);
    assert.ok(heroFont.weight>=600&&heroFont.weight<=750);
    await watch.evaluate(node=>node.scrollTo({top:0}));
    const hero=board.locator('[data-ui="hero"]');
    assert.equal(await hero.evaluate(node=>getComputedStyle(node).borderRadius),'0px');
    assert.ok(await hero.evaluate(node=>{
      const r=node.getBoundingClientRect(),root=node.closest('.tsugi-direct-watch'),rail=root.querySelector('.tsugi-watch-shared-rail');
      const bounds=root.getBoundingClientRect(),side=rail.getBoundingClientRect();
      return Math.abs(r.left-side.right)<=3&&Math.abs(r.right-(bounds.left+root.clientLeft+root.clientWidth))<=3&&r.top>=0;
    }),'home feature reaches the rail and content edges');
    assert.equal(await board.locator('[data-ui="watch-catalogue-shelf"]>small').count(),0);
    async function assertWatchRailChrome(searchLabel, refreshLabel) {
      const rail=watch.locator('.tsugi-watch-shared-rail');
      const header=watch.locator('.tsugi-watch-hub>header');
      assert.equal(await header.locator('.tsugi-watch-heading-copy>p').count(),1,'masthead retains only the profile context, not helper copy');
      assert.equal(await header.locator('button,.tsugi-watch-header-search').count(),0,'no search or actions obstruct the desktop masthead');
      const slot=rail.locator('[data-ui="watch-rail-search"]');
      const search=slot.getByRole('button',{name:searchLabel,exact:true});
      await search.waitFor();
      assert.equal(await search.count(),1);
      assert.equal(await search.getAttribute('aria-haspopup'),'dialog');
      assert.equal(await search.locator('[data-movie-glyph="search"]').count(),1);
      assert.equal(await slot.locator('button').count(),1,'one scoped search action');
      const utility=rail.locator('[data-ui="watch-rail-actions"]');
      if(refreshLabel)await utility.getByRole('button',{name:refreshLabel,exact:true}).waitFor();
      assert.deepEqual(await utility.locator('button').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label'))),[...(refreshLabel?[refreshLabel]:[]),'Streaming hubs','Switch profile'],'refresh, streaming hubs and profile switching form one adjacent group');
      assert.ok(await utility.locator('button').evaluateAll(nodes=>nodes.every((node,index)=>index===0||node.getBoundingClientRect().top-nodes[index-1].getBoundingClientRect().bottom<=12)),'utility rows have ordinary rail spacing');
      for(const label of ['Streaming hubs','Switch profile']){
        assert.equal(await utility.getByRole('button',{name:label,exact:true}).count(),1);
        assert.equal(await watch.getByRole('button',{name:label,exact:true}).count(),1,'single desktop action: '+label);
      }
      await search.scrollIntoViewIfNeeded();
      assert.ok(await search.evaluate(node=>{
        const a=node.getBoundingClientRect(),b=node.closest('.tsugi-watch-shared-rail').getBoundingClientRect();
        return a.left>=b.left-1&&a.right<=b.right+1&&a.width>0&&a.height>=32&&getComputedStyle(node).borderTopWidth==='0px';
      }),'search is a flat, contained sidebar control');
      return search;
    }
    await assertWatchRailChrome('Search movies & series','Refresh catalogues');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-edge-to-edge-hero.png'),animations:'disabled'});
    await page.setViewportSize({width:720,height:720});
    const compactSearch=await assertWatchRailChrome('Search movies & series','Refresh catalogues');
    await compactSearch.click();
    const compactDialog=page.getByRole('dialog',{name:'Search titles',exact:true});
    await compactDialog.waitFor();
    assert.ok(await compactDialog.getByRole('searchbox',{name:'Search across addons',exact:true}).evaluate(node=>node===document.activeElement),'sidebar opens focused search on compact rail');
    await page.keyboard.press('Escape');
    await compactDialog.waitFor({state:'hidden'});
    assert.equal(await compactSearch.getAttribute('aria-expanded'),'false','Escape clears the dialog trigger state');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-rail-search-compact.png'),animations:'disabled'});
    await page.setViewportSize({width:1600,height:900});
    console.log('PASS: compact and full-width Watch rail own search and profile/hub actions without obstructing the hero.');
    assert.equal(await watch.locator('.tsugi-watch-nav').getByRole('button',{name:/Stremio|Nuvio|Add addon/}).count(),0);
    await page.waitForFunction(()=>{const f=window.__stremioFixture;return f.catalogPending===0&&['broken','empty'].every(id=>f.calls.some(a=>a.kind==='profile-request'&&a.action.kind==='browse-catalog'&&a.action.catalogId===id));});
    assert.equal(await board.getByText('This catalogue is unavailable.',{exact:true}).count(),0);
    assert.equal(await board.getByText('No titles returned by this catalogue.',{exact:true}).count(),0);
    assert.equal(await board.getByText('Empty catalogue',{exact:true}).count(),0);
    assert.equal(await board.getByText('Unavailable catalogue',{exact:true}).count(),0);
    await board.getByRole('button',{name:'Retry Unavailable catalogue',exact:true}).waitFor();
    assert.equal(await board.getByText(/^\d+ catalogues$/).count(),0,'provider counts and empty shelves do not appear in browsing');
    assert.ok(await page.evaluate(()=>window.__stremioFixture.catalogPeak>=2));
    assert.ok(await page.evaluate(()=>window.__stremioFixture.calls.some(a=>a.kind==='profile-request'&&a.action.kind==='browse-catalog')));
    assert.equal(await board.getByText('Disabled films',{exact:true}).count(),0);
    assert.equal(await watch.getByRole('heading',{name:'Installed addons',exact:true}).count(),0);
    async function assertDetailHero(label){
      const hero=watch.locator('[data-ui="watch-detail-hero"][data-has-backdrop]');
      await hero.waitFor();
      await page.waitForFunction(()=>{const node=document.querySelector('[data-ui="watch-detail-hero"] .tsugi-watch-close-title');return node&&!node.disabled;});
      await hero.evaluate(async node=>{
        node.closest('.tsugi-direct-watch').scrollTo({top:0,behavior:'instant'});
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      });
      const layout=await hero.evaluate(node=>{
        const r=node.getBoundingClientRect(),root=node.closest('.tsugi-direct-watch'),rail=root.querySelector('.tsugi-watch-shared-rail');
        const bounds=root.getBoundingClientRect(),side=rail.getBoundingClientRect(),header=root.querySelector('.tsugi-watch-hub>header');
        const close=node.querySelector('.tsugi-watch-close-title'),copy=node.querySelector('.tsugi-watch-title-copy');
        const c=close.getBoundingClientRect(),h=header.getBoundingClientRect(),b=copy.getBoundingClientRect();
        const hit=document.elementFromPoint(c.x+c.width/2,c.y+c.height/2);
        return {left:r.left,railRight:side.right,right:r.right,rootRight:bounds.left+root.clientLeft+root.clientWidth,
          top:r.top,rootTop:bounds.top+root.clientTop,rootScroll:root.scrollTop,headerBottom:h.bottom,closeTop:c.top,closeBottom:c.bottom,
          copyTop:b.top,hit:hit?.outerHTML.slice(0,200),closeReachable:close.contains(hit),
          radius:getComputedStyle(node).borderRadius,blur:getComputedStyle(node.querySelector('.tsugi-watch-title-backdrop'),'::before').backdropFilter};
      });
      console.log('DETAIL HERO '+label+' '+JSON.stringify(layout));
      if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-detail-'+label+'.png'),animations:'disabled'});
      assert.equal(layout.radius,'0px',label+' square full-bleed art');
      assert.ok(Math.abs(layout.left-layout.railRight)<=3,label+' hero begins at rail edge: '+JSON.stringify(layout));
      assert.ok(Math.abs(layout.right-layout.rootRight)<=3,label+' hero reaches right edge: '+JSON.stringify(layout));
      assert.ok(Math.abs(layout.top-layout.rootTop)<=3,label+' hero begins beneath native title strip: '+JSON.stringify(layout));
      assert.ok(layout.headerBottom<layout.closeTop&&layout.closeBottom<=layout.copyTop&&layout.closeReachable,label+' masthead, close and title copy remain separate: '+JSON.stringify(layout));
      assert.ok(layout.blur.includes('blur'),label+' bottom blur applied');
      const header=watch.locator('.tsugi-watch-hub>header');
      assert.equal(await header.locator('button,.tsugi-watch-header-search').count(),0,label+' detail artwork has no header actions');
      assert.equal(await header.locator('.tsugi-watch-heading-copy>p').count(),1,label+' only profile context remains');
      const actions=watch.locator('.tsugi-watch-shared-rail [data-ui="watch-rail-actions"]');
      assert.equal(await actions.getByRole('button',{name:'Streaming hubs',exact:true}).count(),1);
      assert.equal(await actions.getByRole('button',{name:'Switch profile',exact:true}).count(),1);
    }
    const discoverCallsStart=await page.evaluate(()=>window.__stremioFixture.calls.length);
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Discover',exact:true}).click();
    await watch.getByRole('heading',{name:'Series hub',exact:true}).waitFor();
    assert.equal(await board.getAttribute('data-discovery-provider'),'tvmaze');
    await assertWatchRailChrome('Search TVmaze series','Refresh schedules');
    const discovery=board.locator('[data-ui="series-discovery"]');
    const feeds=discovery.locator('[data-ui="series-discovery-feed"]');
    for(const feed of ['streaming-today','streaming-tomorrow','broadcast-us','broadcast-gb','broadcast-ca','broadcast-au']){
      const row=discovery.locator('[data-ui="series-discovery-feed"][data-feed="'+feed+'"]');
      await row.getByRole('button',{name:'Family Guy',exact:true}).waitFor();
      assert.equal(await row.getByRole('button',{name:'Family Guy',exact:true}).count(),1);
    }
    assert.equal(await board.locator('[data-ui="watch-catalogue-shelf"]').count(),0);
    assert.equal(await board.locator('[data-ui="watch-continue-shelf"]').count(),0);
    assert.equal(await discovery.getByRole('button',{name:'Unmapped series',exact:true}).count(),0);
    await assertArtwork(feeds.first().getByRole('button',{name:'Family Guy',exact:true}));
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-tvmaze-discovery.png'),animations:'disabled'});
    const korean=discovery.locator('[data-ui="series-discovery-category"][data-category="korean-dramas"]');
    await korean.getByRole('button',{name:'Korean drama fixture',exact:true}).waitFor();
    await discovery.locator('[data-category="crime"]').getByRole('button',{name:'Crime and thriller fixture',exact:true}).waitFor();
    await discovery.locator('[data-category="thriller"]').getByRole('button',{name:'Crime and thriller fixture',exact:true}).waitFor();
    assert.ok(tvmazeRequests.includes('/schedule')&&tvmazeRequests.includes('/schedule/web')&&tvmazeRequests.includes('/shows'));
    await watch.locator('[data-ui="watch-rail-search"]').getByRole('button',{name:'Search TVmaze series',exact:true}).click();
    const tvmazeSearch=board.getByRole('searchbox',{name:'Search TVmaze series',exact:true});
    tvmazeSearchUnavailable=true;
    await tvmazeSearch.fill('provider unavailable fixture');
    await board.locator('[data-ui="tvmaze-search-unavailable"]').waitFor();
    assert.equal(await board.locator('[data-ui="watch-search-result"]').count(),0);
    tvmazeSearchUnavailable=false;
    await tvmazeSearch.fill('family guy');
    const mazeResult=board.locator('[data-ui="watch-search-results"]').getByRole('button',{name:'Family Guy',exact:true});
    await mazeResult.waitFor();
    assert.ok(tvmazeRequests.includes('/search/shows'));
    assert.equal(await page.evaluate(start=>window.__stremioFixture.calls.slice(start).some(a=>a.kind==='profile-request'&&['tmdb-search','browse-catalog'].includes(a.action.kind)),discoverCallsStart),false,'Discover never substitutes TMDB or addon catalogue search for TVmaze');
    await mazeResult.click();
    const mazeDetail=watch.locator('[data-ui="watch-item-details"]');
    await mazeDetail.locator('[data-video-id="tt90021:1:1"]').waitFor();
    await assertDetailHero('discover');
    await mazeDetail.getByRole('button',{name:'Close title',exact:true}).click();
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Home',exact:true}).click();
    await film.waitFor();
    const watchCarouselHero=board.locator('[data-ui="hero"]');
    const seriesSlide=watchCarouselHero.getByRole('button',{name:'Show Fixture anime series',exact:true});
    await seriesSlide.waitFor();
    await seriesSlide.click();
    await watchCarouselHero.getByRole('heading',{name:'Fixture anime series',exact:true}).waitFor();
    assert.equal(await seriesSlide.getAttribute('aria-current'),'true');
    await assertArtwork(watchCarouselHero.locator('[data-ui="backdrop-frame"]'));
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-tv-carousel.png'),animations:'disabled'});
    const filmSlide=watchCarouselHero.getByRole('button',{name:'Show Fixture cinema film',exact:true});
    await filmSlide.click();
    await watchCarouselHero.getByRole('heading',{name:'Fixture cinema film',exact:true}).waitFor();
    if(screenshotDir){await mkdir(screenshotDir,{recursive:true});await board.locator('[data-ui="hero"]').scrollIntoViewIfNeeded();await page.screenshot({path:join(screenshotDir,'watch-content-board.png'),animations:'disabled'});}
    await film.click();
    const item=watch.locator('[data-ui="watch-item-details"]');
    const groups=page.locator('[data-ui="watch-stream-groups"]');
    await item.locator('[data-ui="watch-play-title"]').waitFor();
    assert.equal(await item.locator('[data-ui="watch-refract-watchlist"]').count(),0,'disconnected optional tracker is hidden');
    await item.getByText('IMDb 8.6/10',{exact:true}).waitFor();
    await item.getByText('Fixture Director',{exact:true}).waitFor();
    await item.getByText('Fixture Actor',{exact:true}).waitFor();
    assert.equal(await item.locator('.tsugi-watch-title-backdrop').count(),1);
    await assertArtwork(item.locator('.tsugi-watch-title-backdrop'));
    await assertDetailHero('movie');
    await page.setViewportSize({width:390,height:844});
    const narrowHero=item.locator('[data-ui="watch-detail-hero"]');
    assert.ok(await narrowHero.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=window.innerWidth+1&&node.scrollWidth<=node.clientWidth+1;}),'narrow title hero does not overflow');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-detail-movie-narrow.png'),animations:'disabled'});
    await page.setViewportSize({width:1600,height:900});
    assert.ok(await page.evaluate(()=>!!document.elementFromPoint(Math.floor(window.innerWidth/2),20)?.closest('[data-page="direct-watch"]')),'Watch scroll region preserves its opaque window strip');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-movie-details.png'),animations:'disabled'});
    assert.equal(await groups.count(),0);
    const availability=item.locator('[data-ui="watch-availability"]');
    const region=availability.getByRole('combobox',{name:'Availability region',exact:true});
    await region.selectOption('BE');
    await availability.getByText('Fixture Plus',{exact:true}).waitFor();
    await availability.getByText('Fixture Rental',{exact:true}).waitFor();
    await region.selectOption('US');
    await availability.getByText('Fixture Store',{exact:true}).waitFor();
    assert.equal(await availability.getByText('Fixture Plus',{exact:true}).count(),0);
    await region.selectOption('BE');
    const franchise=item.locator('[data-ui="watch-franchise"]');
    const sequel=franchise.getByRole('button',{name:'Fixture franchise sequel',exact:true});
    await sequel.waitFor();
    assert.equal(await franchise.locator('[data-ui="poster-card"]').count(),1);
    await assertArtwork(sequel);
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-franchise.png'),animations:'disabled'});
    await sequel.click();
    await item.getByRole('heading',{name:'Fixture franchise sequel',exact:true}).waitFor();
    assert.equal(await groups.count(),0);
    await item.getByRole('button',{name:'Close title',exact:true}).click();
    await film.click();
    await item.locator('[data-ui="watch-play-title"]').waitFor();
    await item.getByRole('button',{name:'Add to favorites',exact:true}).click();
    await item.getByRole('button',{name:'Favorited',exact:true}).waitFor();
    await item.getByRole('button',{name:'Add to queue',exact:true}).click();
    await item.getByRole('button',{name:'In queue',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__stremioFixture.calls.some(a=>a.kind==='profile-request'&&['all-stream-options','begin-stream-options'].includes(a.action.kind))),false);
    await item.locator('[data-ui="watch-play-title"]').click();
    await groups.getByRole('heading',{name:'Streaming only',exact:true}).waitFor();
    await groups.getByRole('button',{name:'Play',exact:true}).first().waitFor();
    await assertArtwork(page.locator('.tsugi-watch-stream-background'));
    const streamPage=page.getByRole('dialog',{name:'Choose your stream',exact:true});
    const streamBounds=await streamPage.boundingBox();
    const streamHeader=await streamPage.locator('.tsugi-watch-stream-header').boundingBox();
    const windowBounds=await page.locator('[data-ui="window-controls"]').boundingBox();
    assert.ok(streamBounds&&streamHeader&&windowBounds&&streamBounds.y===0&&streamHeader.y>=windowBounds.y+windowBounds.height+8,'stream selector covers the viewport and clears native controls');
    assert.ok(await page.evaluate(()=>!!document.elementFromPoint(Math.floor(window.innerWidth/2),20)?.closest('.tsugi-watch-stream-page')),'previous page cannot show through the title-bar strip');
    const filterWidths=await groups.locator('[data-ui="watch-version-filters"] > label > select').evaluateAll(nodes=>nodes.map(node=>({width:node.getBoundingClientRect().width,available:node.closest('[data-ui="watch-version-filters"]').clientWidth})));
    assert.ok(filterWidths.length>=7&&filterWidths.every(({width,available})=>width>=Math.min(192,available)-1),'desktop stream filters reserve enough room for the option label');
    assert.ok(Math.max(...filterWidths.map(f=>f.width))-Math.min(...filterWidths.map(f=>f.width))<=1,'stream filter columns retain equal widths on the final row');
    assert.ok(await groups.locator('[data-ui="watch-version-filters"] > label > select').evaluateAll(nodes=>nodes.every(node=>{const s=getComputedStyle(node);return s.appearance==='auto'&&parseFloat(s.borderTopWidth)>=1&&node.getBoundingClientRect().height>=42;})),'stream selects retain native dropdown affordances and control boundaries');
    assert.equal(await streamPage.locator('[data-ui="watch-stream-context"]').count(),0,'movie selector does not repeat the movie title as an eyebrow');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-stream-selector.png'),animations:'disabled'});
    await groups.getByText('This addon could not return streams. Other sources remain available.',{exact:true}).waitFor();
    assert.equal(await groups.getByRole('button',{name:'Play',exact:true}).count(),2);
    const provider=groups.getByRole('combobox',{name:'Source provider',exact:true});
    await provider.selectOption('102');
    assert.equal(await groups.locator('[data-stream-source]').count(),1);
    assert.equal(await groups.locator('[data-stream-source="102"]').count(),1);
    await provider.selectOption('all');
    assert.equal(await groups.getByRole('button',{name:'Play',exact:true}).count(),2);
    const audioFilter=groups.getByRole('combobox',{name:'Audio format filter',exact:true});
    const sizeFilter=groups.getByRole('combobox',{name:'File size filter',exact:true});
    const cacheFilter=groups.getByRole('combobox',{name:'Provider cache filter',exact:true});
    await audioFilter.selectOption('AAC');
    assert.equal(await groups.getByRole('button',{name:'Play',exact:true}).count(),1);
    await sizeFilter.selectOption('under-1');
    await cacheFilter.selectOption('uncached');
    assert.equal(await groups.getByRole('button',{name:'Play',exact:true}).count(),1);
    await cacheFilter.selectOption('cached');
    assert.equal(await groups.getByRole('button',{name:'Play',exact:true}).count(),0);
    await audioFilter.selectOption('Atmos');
    await sizeFilter.selectOption('5-to-15');
    assert.equal(await groups.locator('[data-ui="version"]').filter({hasText:'Alternate HD fixture'}).getByRole('button',{name:'Play',exact:true}).count(),1);
    const formattedRow=groups.locator('[data-ui="version"]').filter({hasText:'Alternate HD fixture'});
    const formattedName=formattedRow.locator('[data-ui="version-name"]');
    const formattedDetail=formattedRow.locator('[data-ui="version-description"]');
    async function assertFormatterLayout(narrow){
      await formattedRow.scrollIntoViewIfNeeded();
      assert.equal(await formattedName.textContent(),'Alternate HD fixture\n⚡  Provider');
      assert.equal(await formattedDetail.textContent(),'1080p HEVC\nTrueHD Atmos · 8.5 GB · cached\n\n'+'LongFixtureReleaseName.'.repeat(30)+'mkv');
      for(const label of [formattedName,formattedDetail]){
        assert.ok(await label.evaluate(node=>getComputedStyle(node).whiteSpace==='pre-wrap'&&node.scrollWidth<=node.clientWidth+1&&node.scrollHeight<=node.clientHeight+1),'provider text retains line breaks and spaces without clipping');
      }
      const textBounds=await formattedDetail.boundingBox();
      const playBounds=await formattedRow.getByRole('button',{name:'Play',exact:true}).boundingBox();
      assert.ok(textBounds&&playBounds&&(narrow?playBounds.y>=textBounds.y+textBounds.height:playBounds.x>=textBounds.x+textBounds.width-1),'play action does not consume formatter text space on narrow layouts');
    }
    await assertFormatterLayout(false);
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-stream-formatter-wide.png'),animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    const moreFilters=groups.getByRole('button',{name:/More filters/});
    await moreFilters.waitFor();
    assert.equal(await moreFilters.getAttribute('aria-expanded'),'false');
    assert.equal(await audioFilter.isVisible(),false);
    assert.equal(await groups.getByRole('button',{name:'Play',exact:true}).count(),1,'collapsed filters retain active selection');
    await moreFilters.click();
    await audioFilter.waitFor({state:'visible'});
    assert.equal(await audioFilter.inputValue(),'Atmos');
    await groups.getByRole('button',{name:/Fewer filters/}).click();
    assert.equal(await audioFilter.isVisible(),false);
    const filterGeometry=await groups.locator('[data-ui="watch-version-filters"]').evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth}));
    assert.ok(filterGeometry.scroll<=filterGeometry.width+1,'reported stream filters wrap without horizontal overflow');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-stream-selector-narrow.png'),animations:'disabled'});
    await assertFormatterLayout(true);
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-stream-formatter-narrow.png'),animations:'disabled'});
    await page.setViewportSize({width:1600,height:900});
    await page.waitForFunction(()=>document.activeElement?.closest('.tsugi-watch-stream-page')!=null);
    // Also exercise the transient document focus during breakpoint reflow,
    // rather than depending on a visible button to receive the key event.
    await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
    await page.keyboard.press('Escape');
    await groups.waitFor({state:'detached'});
    await page.waitForFunction(()=>document.activeElement?.matches('[data-ui="watch-play-title"]')===true);
    await item.locator('[data-ui="watch-play-title"]').click();
    await groups.getByRole('heading',{name:'Streaming only',exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>window.__stremioFixture.calls.some(a=>a.kind==='profile-request'&&a.action.kind==='metadata'&&a.action.sourceId===103)));
    assert.equal(await page.evaluate(()=>window.__stremioFixture.mediaCalls.some(a=>a.type==='stremio-consume-grant')),false);
    const originalReview=await page.evaluate(()=>window.__stremioFixture.streamReviews.find(r=>r.sourceId===102).id);
    await groups.locator('[data-stream-source="104"]').getByRole('button',{name:'Retry provider',exact:true}).click();
    await groups.getByText('Recovered fixture',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__stremioFixture.streamReviews.find(r=>r.sourceId===102).id),originalReview);
    assert.equal(await groups.getByRole('button',{name:'Play',exact:true}).count(),3);
    await groups.getByRole('button',{name:'Play',exact:true}).first().click();
    const player=watch.locator('[data-ui="direct-watch-player"]');
    await player.locator('[data-ui="player-controls"]:not([data-loading])').waitFor();
    const assertUnobstructedVideo=async(mode)=>{
      const geometry=await watch.evaluate(root=>{
        const r=root.querySelector('[data-ui="direct-watch-player"]').getBoundingClientRect();
        const style=getComputedStyle(root);
        return {strip:parseFloat(style.borderTopWidth),left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,background:style.backgroundColor};
      });
      assert.equal(geometry.strip,0,mode+' has no opaque browsing strip');
      assert.equal(geometry.background,'rgba(0, 0, 0, 0)',mode+' leaves the native video surface visible');
      assert.ok(Math.abs(geometry.left)<=1&&Math.abs(geometry.top)<=1&&Math.abs(geometry.right-geometry.width)<=1&&Math.abs(geometry.bottom-geometry.height)<=1,mode+' fills viewport: '+JSON.stringify(geometry));
    };
    await assertUnobstructedVideo('Windowed playback');
    await player.hover();
    assert.equal(await player.locator('[data-ui="player-top-bar"]').count(),1);
    await player.getByRole('button',{name:'Full screen',exact:true}).click();
    await player.getByRole('button',{name:'Exit full screen',exact:true}).waitFor({state:'visible'});
    await page.setViewportSize({width:1920,height:1080});
    await assertUnobstructedVideo('Fullscreen playback');
    await player.hover();
    await player.getByRole('button',{name:'Exit full screen',exact:true}).click();
    await player.getByRole('button',{name:'Full screen',exact:true}).waitFor({state:'visible'});
    await page.setViewportSize({width:1600,height:900});
    await assertUnobstructedVideo('Restored windowed playback');
    await player.hover();
    await player.getByRole('button',{name:'Audio',exact:true}).click();
    await page.locator('[data-ui="player-menu"][data-name="audio"] [data-ui="player-menu-item"]').filter({hasText:'Japanese audio'}).click();
    await page.waitForFunction(()=>window.__stremioFixture.mediaCalls.some(m=>m.type==='player-set'&&m.audio==='2'));
    await player.hover();
    await player.getByRole('button',{name:'Subtitles',exact:true}).click();
    await page.locator('[data-ui="player-menu"][data-name="subtitles"] [data-ui="player-menu-item"]').filter({hasText:'English subtitles'}).click();
    await page.waitForFunction(()=>window.__stremioFixture.mediaCalls.some(m=>m.type==='player-set'&&m.subtitle==='3'));
    await player.hover();
    await player.getByRole('button',{name:'Subtitles',exact:true}).click();
    await page.locator('[data-ui="player-menu"][data-name="subtitles"]').getByText('Off',{exact:true}).click();
    await page.waitForFunction(()=>window.__stremioFixture.mediaCalls.some(m=>m.type==='player-set'&&m.subtitle===null));
    await page.evaluate(()=>window.__stremioFixture.emitPlayer({type:'player-state',positionMs:45000,durationMs:120000}));
    await player.hover();
    await player.getByRole('button',{name:'Versions',exact:true}).click();
    const versions=page.locator('[data-ui="watch-player-versions"]');
    await versions.locator('[data-stream-source="104"]').getByRole('button',{name:'Retry provider',exact:true}).click();
    await versions.getByText('Recovered fixture',{exact:true}).waitFor();
    await versions.getByRole('combobox',{name:'Quality filter',exact:true}).selectOption('1080p');
    await versions.getByRole('combobox',{name:'Audio format filter',exact:true}).selectOption('TrueHD');
    await versions.getByRole('combobox',{name:'File size filter',exact:true}).selectOption('5-to-15');
    await versions.getByRole('combobox',{name:'Provider cache filter',exact:true}).selectOption('cached');
    assert.equal(await versions.getByRole('button',{name:'Switch stream',exact:true}).count(),1);
    const alternateVersion=versions.locator('[data-ui="version"]').filter({hasText:'Alternate HD fixture'});
    await alternateVersion.getByText(/1080p HEVC/).waitFor();
    assert.equal(((await alternateVersion.innerText()).match(/1080p/gi)??[]).length,1,'resolution already in provider detail is not repeated as a generated badge');
    await versions.locator('[data-ui="version"]').filter({hasText:'Alternate HD fixture'}).getByRole('button',{name:'Switch stream',exact:true}).click();
    await page.waitForFunction(()=>window.__stremioFixture.mediaCalls.filter(m=>m.type==='stremio-consume-grant').length===2);
    await player.locator('[data-ui="player-controls"]:not([data-loading])').waitFor();
    const switched=await page.evaluate(()=>window.__stremioFixture.mediaCalls.filter(m=>['player-stop','prepare-media','stremio-consume-grant'].includes(m.type)).slice(-3));
    assert.deepEqual(switched.map(m=>m.type),['player-stop','prepare-media','stremio-consume-grant']);
    assert.equal(switched[1].startMs,45000);assert.equal(switched[1].optionIndex,1);
    console.log('PASS: shared video player audio/subtitle switching and in-player source selection retain position with a fresh native grant.');
    await player.hover();
    await player.getByRole('button',{name:'Back',exact:true}).click();
    await player.waitFor({state:'detached'});
    assert.ok(await watch.evaluate(root=>parseFloat(getComputedStyle(root).borderTopWidth)>=40),'opaque browsing strip restored after playback');
    console.log('PASS: direct player fills windowed/fullscreen viewport without opaque top strip; browsing chrome returns.');
    await item.getByRole('button',{name:'Close title',exact:true}).click();
    const resumedCard=board.locator('[data-ui="watch-continue-shelf"] [data-ui="wide-card"]').filter({hasText:'Fixture cinema film'});
    await resumedCard.waitFor();
    assert.equal(await resumedCard.getAttribute('data-in-progress'),'true');
    await assertArtwork(resumedCard);
    const savedArtwork=await page.evaluate(()=>JSON.parse(localStorage.getItem('tsugi-watch-artwork-v2:1')));
    const filmArtwork=savedArtwork[JSON.stringify(['movie','tt90001','tt90001'])];
    assert.ok(Array.isArray(filmArtwork)&&filmArtwork.length>=2,'persist multiple same-title artwork candidates');
    assert.equal(JSON.stringify(savedArtwork).includes('private-fixture'),false,'invalid stored URLs are excluded on write');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-resume-art.png'),animations:'disabled'});
    await film.click();
    await item.locator('[data-ui="watch-play-title"]').filter({hasText:/^Resume$/}).waitFor();
    await item.locator('[data-ui="watch-play-title"]').click();
    await groups.getByRole('button',{name:'Resume',exact:true}).first().waitFor();
    await page.keyboard.press('Escape');
    await groups.waitFor({state:'detached'});
    await item.getByRole('button',{name:'Close title',exact:true}).click();
    await watch.locator('[data-ui="watch-rail-search"]').getByRole('button',{name:'Search movies & series',exact:true}).click();
    await board.getByRole('searchbox',{name:'Search across addons',exact:true}).fill('Fixture cinema film');
    const results=board.locator('[data-ui="watch-search-results"]');
    await results.getByRole('button',{name:'Fixture cinema film sequel',exact:true}).waitFor();
    assert.equal(await results.getByRole('button',{name:'Fixture cinema film',exact:true}).count(),1);
    assert.equal(await results.locator('[data-ui="watch-search-result"]').first().getAttribute('aria-label'),'Fixture cinema film');
    assert.equal(await results.getByRole('button',{name:'Fixture alias movie',exact:true}).count(),0);
    await results.locator('[data-ui="watch-top-match"]').waitFor();
    await board.getByRole('searchbox',{name:'Search across addons',exact:true}).fill('family guy');
    const seriesResults=results.locator('[data-search-kind="series"]');
    const movieResults=results.locator('[data-search-kind="movie"]');
    await seriesResults.getByRole('button',{name:'Family Guy',exact:true}).waitFor();
    await movieResults.getByRole('button',{name:'Family Guy Presents: Blue Harvest',exact:true}).waitFor();
    assert.deepEqual(await results.locator('[data-search-kind]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-search-kind'))),['series','movie']);
    assert.equal(await movieResults.locator('[data-ui="watch-search-result"]').count(),2);
    const longResult=movieResults.getByRole('button',{name:'Family Guy Presents: Something, Something, Something, Dark Side',exact:true});
    const longTitle=longResult.locator('[data-ui="watch-search-result-title"]');
    assert.equal(await longTitle.innerText(),'Family Guy Presents: Something, Something, Something, Dark Side');
    assert.ok(await longTitle.evaluate(node=>node.scrollHeight<=node.clientHeight+1&&node.scrollWidth<=node.clientWidth+1),'related titles are fully readable rather than identical truncated labels');
    assert.equal(await movieResults.getByRole('button',{name:'Family Guy Presents: Blue Harvest',exact:true}).locator('.tsugi-watch-search-result-description').innerText(),'Synthetic movie result.');
    assert.equal(await results.getByRole('button',{name:'Unrelated series',exact:true}).count(),0);
    assert.equal(await results.locator('[data-ui="watch-top-match"] h4').innerText(),'Family Guy');
    await assertArtwork(seriesResults.getByRole('button',{name:'Family Guy',exact:true}));
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-search-overlay.png'),animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    await longResult.scrollIntoViewIfNeeded();
    assert.ok(await longTitle.evaluate(node=>node.scrollHeight<=node.clientHeight+1&&node.scrollWidth<=node.clientWidth+1),'long related title stays readable in the narrow overlay');
    const searchDialog=page.getByRole('dialog',{name:'Search titles',exact:true});
    assert.ok(await searchDialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'only result rows, not the whole search dialog, scroll horizontally');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-search-overlay-narrow.png'),animations:'disabled'});
    await page.setViewportSize({width:1600,height:900});
    await searchDialog.getByRole('button',{name:'Clear search',exact:true}).click();
    const clearedSearch=searchDialog.getByRole('searchbox',{name:'Search across addons',exact:true});
    assert.equal(await clearedSearch.inputValue(),'');
    assert.ok(await clearedSearch.evaluate(node=>node===document.activeElement),'clear returns keyboard focus to the search field');
    assert.equal(await searchDialog.getByRole('button',{name:'Clear search',exact:true}).count(),0);
    console.log('PASS: TMDB title search places the exact series match first and separates related movies below it.');
    await searchDialog.getByRole('button',{name:'Anime',exact:true}).click();
    await clearedSearch.fill('Public anime discovery fixture');
    const globalAnimeResult=results.locator('[data-search-kind="series"]').getByRole('button',{name:'Public anime discovery fixture',exact:true});
    await globalAnimeResult.waitFor();
    await assertArtwork(globalAnimeResult);
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-global-anime-filter.png'),animations:'disabled'});
    await searchDialog.getByRole('button',{name:'All titles',exact:true}).click();
    await searchDialog.getByRole('button',{name:'Clear search',exact:true}).click();
    await clearedSearch.fill('Fixture alias movie');
    await results.getByRole('button',{name:'Fixture alias movie',exact:true}).click();
    await item.locator('[data-ui="watch-play-title"]').click();
    await groups.getByRole('button',{name:'Play',exact:true}).first().waitFor();
    assert.ok(await page.evaluate(()=>window.__stremioFixture.calls.some(a=>a.kind==='profile-request'&&['all-stream-options','begin-stream-options'].includes(a.action.kind)&&a.action.videoId==='tmdb:90007'&&a.action.alternatives?.some(route=>route.videoId==='tt90007'&&route.mediaType==='movie'))));
    await page.keyboard.press('Escape');
    await groups.waitFor({state:'detached'});
    await item.getByRole('button',{name:'Close title',exact:true}).click();
    await watch.locator('[data-ui="watch-rail-search"]').getByRole('button',{name:'Search movies & series',exact:true}).click();
    await board.getByRole('searchbox',{name:'Search across addons',exact:true}).fill('family guy');
    await seriesResults.getByRole('button',{name:'Family Guy',exact:true}).click();
    await item.getByRole('heading',{name:'Family Guy',exact:true}).waitFor();
    await assertDetailHero('series');
    assert.equal(await groups.count(),0,'ordinary TV detail does not query streams before episode selection');
    await item.locator('[data-video-id="tt90021:1:1"]').click();
    await groups.getByRole('heading',{name:'TV fixture pilot',exact:true}).waitFor();
    await groups.locator('[data-ui="watch-stream-context"]').filter({hasText:/S1 E1/}).waitFor();
    await assertFormatterLayout(false);
    assert.ok(await page.evaluate(()=>window.__stremioFixture.calls.some(a=>a.kind==='profile-request'&&a.action.kind==='begin-stream-options'&&a.action.mediaType==='series'&&a.action.videoId==='tt90021:1:1')));
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-stream-tv-episode.png'),animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    await assertFormatterLayout(true);
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-stream-tv-episode-narrow.png'),animations:'disabled'});
    await page.setViewportSize({width:1600,height:900});
    await page.keyboard.press('Escape');
    await groups.waitFor({state:'detached'});
    await item.getByRole('button',{name:'Close title',exact:true}).click();
    console.log('PASS: ordinary TV search opens exact episode stream selector with multiline formatter layout.');
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Anime Hub',exact:true}).click();
    const anime=watch.locator('[data-ui="mal-anime-library"]');
    await assertWatchRailChrome('Search anime');
    await watch.locator('[data-ui="watch-rail-search"]').getByRole('button',{name:'Search anime',exact:true}).click();
    const animeSearchDialog=page.getByRole('dialog',{name:'Search titles',exact:true});
    await animeSearchDialog.getByRole('searchbox',{name:'Search across addons',exact:true}).fill('Fixture anime series');
    await animeSearchDialog.locator('[data-search-kind="series"]').getByRole('button',{name:'Fixture anime series',exact:true}).click();
    assert.ok(await page.evaluate(()=>window.__stremioFixture.calls.some(a=>a.kind==='profile-request'&&a.action.kind==='browse-catalog'&&a.action.catalogId==='anime'&&a.action.extras.search==='Fixture anime series')));
    await item.locator('[data-rating-source="tmdb"]').filter({hasText:'8.4'}).waitFor();
    await item.getByText('Fixture Writer',{exact:true}).waitFor();
    await item.getByText('Lead role',{exact:true}).waitFor();
    await assertArtwork(item.locator('[data-ui="watch-cast-card"]').first());
    await item.getByText('A fixture tagline',{exact:true}).waitFor();
    
    const season=item.getByRole('combobox',{name:'Select season',exact:true});
    await season.selectOption('0');
    await item.locator('[data-video-id="tt90002:0:1"]').waitFor();
    assert.equal(await item.locator('[data-video-id="tt90002:1:2"]').count(),0);
    await season.selectOption('2');
    await item.locator('[data-video-id="tt90002:2:1"]').waitFor();
    await season.selectOption('other');
    await item.locator('[data-video-id="tt90002:extra"]').waitFor();
    await season.selectOption('1');
    await item.getByText('Episode overview from the provider.',{exact:true}).waitFor();
    assert.equal(await item.locator('.tsugi-watch-episode-art').count(),2);
    const episode=item.locator('[data-video-id="tt90002:1:2"]');
    await episode.getByText('A synopsis supplied by TMDB.',{exact:true}).waitFor();
    await assertArtwork(episode);
    assert.equal(await anime.isVisible(),false,'title details replace the Anime Hub rather than stacking above it');
    await assertDetailHero('anime-series');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-episode-list.png'),animations:'disabled'});
    await episode.click();
    await groups.getByRole('button',{name:'Play',exact:true}).first().waitFor();
    await groups.locator('[data-ui="watch-stream-context"]').filter({hasText:/S1 E2/}).waitFor();
    await assertFormatterLayout(false);
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-stream-anime-series.png'),animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    await assertFormatterLayout(true);
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-stream-anime-series-narrow.png'),animations:'disabled'});
    await page.setViewportSize({width:1600,height:900});
    await page.keyboard.press('Escape');
    await groups.waitFor({state:'detached'});
    await item.locator('details.tsugi-watch-provider-details summary').click();
    const metadataButton=item.getByRole('button',{name:/Details.*Metadata only/});
    await page.evaluate(()=>{window.__stremioFixture.failMetadata=true;});
    await metadataButton.click();
    await page.waitForFunction(()=>!document.querySelector('[data-ui="watch-item-details"] select')?.disabled);
    assert.equal(await episode.getAttribute('aria-current'),'true');
    await page.evaluate(()=>{window.__stremioFixture.failMetadata=false;window.__stremioFixture.emptyMetadata=true;});
    await metadataButton.click();
    await page.waitForFunction(()=>!document.querySelector('[data-ui="watch-item-details"] select')?.disabled);
    assert.equal(await episode.getAttribute('aria-current'),'true');
    assert.equal(await item.locator('[data-video-id]').count(),2);
    await page.evaluate(()=>{const f=window.__stremioFixture;f.emptyMetadata=false;f.holdStreamCompletion=true;f.preparedWhilePending=null;});
    await episode.click();
    await page.getByRole('status').filter({hasText:'1 providers still loading'}).waitFor();
    await groups.locator('[data-ui="watch-stream-context"]').filter({hasText:/S1 E2/}).waitFor();
    assert.equal(await groups.locator('[data-stream-source="104"]').count(),0);
    await groups.locator('[data-stream-source="102"]').getByRole('button',{name:'Play',exact:true}).first().click();
    await player.locator('[data-ui="player-controls"]:not([data-loading])').waitFor();
    assert.deepEqual(await page.evaluate(()=>window.__stremioFixture.preparedWhilePending),{videoId:'tt90002:1:2',sourceId:102,pendingSourceIds:[104]});
    await page.evaluate(()=>{window.__stremioFixture.holdStreamCompletion=false;});
    console.log('PASS: exact episode selected while a second provider remains pending.');
    await player.hover();
    assert.ok(await page.evaluate(()=>window.__stremioFixture.calls.some(a=>a.kind==='profile-request'&&['all-stream-options','begin-stream-options'].includes(a.action.kind)&&a.action.videoId==='tt90002:1:2')));
    assert.equal(await page.evaluate(()=>window.__stremioFixture.profiles[0].malAnime?.length??0),0);
    await player.hover();
    await player.getByRole('button',{name:'Back',exact:true}).click();
    await player.waitFor({state:'detached'});
    const related=item.locator('[data-ui="watch-related-titles"]');
    await related.waitFor();
    assert.equal(await related.locator('[data-ui="poster-card"]').count(),1,'related shelf excludes self, duplicate and malformed/wrong-kind entries');
    const relatedCard=related.getByRole('button',{name:'Related fixture series',exact:true});
    await relatedCard.scrollIntoViewIfNeeded();
    await assertArtwork(relatedCard);
    await relatedCard.getByText('TMDB 7.7',{exact:true}).waitFor();
    const episodeBounds=await item.locator('[data-ui="watch-episode-grid"]').boundingBox();
    const castBounds=await item.locator('[data-ui="watch-cast-card"]').first().boundingBox();
    assert.ok(episodeBounds&&castBounds&&episodeBounds.y+episodeBounds.height<=castBounds.y+2,'series episodes precede optional cast and recommendation shelves');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-related-titles.png'),animations:'disabled'});
    const streamCallsBeforeRelated=await page.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request'&&['begin-stream-options','all-stream-options'].includes(a.action.kind)).length);
    await relatedCard.click();
    await item.getByRole('heading',{name:'Related fixture series',exact:true}).waitFor();
    await item.locator('[data-video-id="tt90025:1:1"]').waitFor();
    assert.equal(await related.count(),0,'stale recommendations do not survive title changes');
    assert.equal(await page.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request'&&['begin-stream-options','all-stream-options'].includes(a.action.kind)).length),streamCallsBeforeRelated,'opening a related title does not request streams before playback selection');
    await item.getByRole('button',{name:'Close title',exact:true}).click();
    await anime.waitFor({state:'visible'});
    console.log('PASS: related TMDB titles use real artwork, explicit IMDb aliases, exact episodes and the normal browsing return path.');
    console.log('PASS: imported standalone Watch profile loads ordered shelves, isolates failures, resolves metadata and streams across addons, and plays an exact anime episode without MAL or a media server.');
    await watch.getByRole('button',{name:'Switch profile',exact:true}).click();
    await watch.locator('[data-ui="watch-profile-picker"]').getByRole('button',{name:'Stream only 1 addons',exact:true}).click();
    await watch.locator('[data-ui="watch-hub-picker"] [data-watch-destination="standalone"]').click();
    const legacyResume=board.locator('[data-ui="watch-continue-shelf"] [data-ui="wide-card"]').filter({hasText:'Legacy artwork fixture'});
    await legacyResume.waitFor();
    await assertArtwork(legacyResume);
    assert.equal(await board.getByText('Saved fallback fixture',{exact:true}).count(),0,'resume artwork remains profile-local');
    await board.getByRole('button',{name:'Public movie fixture',exact:true}).click();
    await item.locator('[data-ui="watch-play-title"]').click();
    await groups.getByRole('heading',{name:'Independent stream',exact:true}).waitFor();
    await groups.getByRole('button',{name:'Play',exact:true}).first().click();
    await player.locator('[data-ui="player-controls"]:not([data-loading])').waitFor();
    await player.hover();
    await player.hover();
    await player.getByRole('button',{name:'Back',exact:true}).click();
    await player.waitFor({state:'detached'});
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Anime Hub',exact:true}).click();
    await watch.locator('[data-ui="anime-public-discovery"]').getByRole('button',{name:'Public anime discovery fixture',exact:true}).first().click();
    await item.locator('[data-video-id="kitsu:90004:1"]').click();
    await groups.getByRole('button',{name:'Play',exact:true}).first().click();
    await player.locator('[data-ui="player-controls"]:not([data-loading])').waitFor();
    assert.ok(await page.evaluate(()=>window.__stremioFixture.calls.some(a=>a.kind==='profile-request'&&['all-stream-options','begin-stream-options'].includes(a.action.kind)&&a.action.videoId==='kitsu:90004:1')));
    const beforeNext=await page.evaluate(()=>window.__stremioFixture.mediaCalls.filter(m=>m.type==='stremio-consume-grant').length);
    await page.evaluate(()=>{window.__stremioFixture.emitPlayer({type:'player-state',positionMs:119000,durationMs:120000});window.__stremioFixture.emitPlayer({type:'player-ended',reason:'eof',error:null});});
    await page.waitForFunction(n=>window.__stremioFixture.mediaCalls.filter(m=>m.type==='stremio-consume-grant').length===n+1,beforeNext);
    await player.locator('[data-ui="player-controls"]:not([data-loading])').waitFor();
    assert.ok(await page.evaluate(()=>window.__stremioFixture.calls.some(a=>a.kind==='profile-request'&&['all-stream-options','begin-stream-options'].includes(a.action.kind)&&a.action.videoId==='kitsu:90004:2')));
    await player.hover();
    await player.getByRole('button',{name:'Back',exact:true}).click();
    await player.waitFor({state:'detached'});
    await item.locator('[data-video-id="kitsu:90004:2"][aria-current="true"]').waitFor();
    assert.equal(await groups.count(),0);
    console.log('PASS: public MAL discovery maps to verified Kitsu metadata and advances to the exact next episode using a stream-only addon profile.');
    await item.getByRole('button',{name:'Close title',exact:true}).click();
    await watch.locator('[data-ui="anime-public-discovery"]').getByRole('button',{name:'Public anime film fixture',exact:true}).first().click();
    await item.getByRole('heading',{name:'Public anime film fixture',exact:true}).waitFor();
    assert.equal(await groups.count(),0,'anime movie details do not request streams before Play');
    await assertDetailHero('anime-film');
    await item.locator('[data-ui="watch-play-title"]').click();
    await groups.getByRole('heading',{name:'Public anime film fixture',exact:true}).waitFor();
    await groups.getByRole('button',{name:'Play',exact:true}).first().waitFor();
    assert.equal(await groups.locator('[data-ui="watch-stream-context"]').count(),0,'anime film uses movie presentation');
    assert.ok(await page.evaluate(()=>window.__stremioFixture.calls.some(a=>a.kind==='profile-request'&&a.action.kind==='begin-stream-options'&&a.action.mediaType==='movie'&&a.action.videoId==='kitsu:90005')));
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-stream-anime-film.png'),animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.getByRole('dialog',{name:'Choose your stream',exact:true}).evaluate(node=>node.scrollWidth<=node.clientWidth+1),'anime film selector fits narrow viewport');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-stream-anime-film-narrow.png'),animations:'disabled'});
    await page.setViewportSize({width:1600,height:900});
    await groups.getByRole('button',{name:'Play',exact:true}).first().click();
    await player.locator('[data-ui="player-controls"]:not([data-loading])').waitFor();
    await player.hover();
    await player.getByRole('button',{name:'Back',exact:true}).click();
    await player.waitFor({state:'detached'});
    console.log('PASS: public anime movie resolves the verified movie identity, opens its stream selector and consumes a native playback grant.');
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Settings',exact:true}).click();
    const config=watch.locator('[data-ui="watch-settings-navigation"]');
    const addonRows=watch.locator('[data-stremio-source-id]');
    await addonRows.first().waitFor({state:'visible'});
    assert.ok(await addonRows.evaluateAll(nodes=>nodes.length>0&&nodes.every(node=>{const s=getComputedStyle(node);return ['transparent','rgba(0, 0, 0, 0)'].includes(s.backgroundColor)&&s.backgroundImage==='none'&&s.boxShadow==='none'&&parseFloat(s.borderTopWidth)===0&&parseFloat(s.borderBottomWidth)===0;})),'installed addon rows are flat rather than striped rectangles');
    const refresh=watch.getByRole('button',{name:'Refresh installed addons',exact:true});
    const addonBounds=await addonRows.first().boundingBox();
    const refreshBounds=await refresh.boundingBox();
    assert.ok(addonBounds&&refreshBounds&&refreshBounds.width<addonBounds.width,'refresh remains a compact action');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-addon-settings-flat.png'),animations:'disabled'});
    await config.getByRole('button',{name:'Profile settings',exact:true}).click();
    const management=watch.locator('[data-ui="stremio-profile-management"]');
    await management.waitFor({state:'visible'});
    const managementBounds=await management.boundingBox();
    const activeProfileField=management.getByRole('combobox',{name:'Active addon profile',exact:true});
    await activeProfileField.waitFor({state:'visible'});
    const activeField=await activeProfileField.boundingBox();
    const nameField=await management.getByLabel('Profile name',{exact:true}).boundingBox();
    assert.ok(managementBounds&&managementBounds.width<=705&&activeField&&nameField&&nameField.y-activeField.y-activeField.height>=16,'profile form is bounded and fields are vertically separated');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-profile-settings-spaced.png'),animations:'disabled'});
    await config.getByRole('button',{name:'Playback',exact:true}).click();
    const playbackSettings=watch.locator('[data-ui="watch-playback-settings"]');
    await playbackSettings.locator('[data-ui="settings-tab"]').first().waitFor({state:'visible'});
    assert.ok(await playbackSettings.locator('[data-ui="settings-tab-group"],[data-ui="settings-tab"],[data-ui="settings-card-body"],[data-ui="settings-card-item"],[data-ui="settings-header-icon"]').evaluateAll(nodes=>nodes.length>=3&&nodes.every(node=>{const s=getComputedStyle(node);return ['transparent','rgba(0, 0, 0, 0)'].includes(s.backgroundColor)&&s.backgroundImage==='none'&&s.boxShadow==='none'&&parseFloat(s.borderTopWidth)===0&&parseFloat(s.borderBottomWidth)===0;})),'Watch playback settings use the same unboxed styling as connected Movies');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-playback-settings-flat.png'),animations:'disabled'});
    const autoPlay=watch.getByRole('switch',{name:'Auto-play the first version',exact:true});
    assert.equal(await autoPlay.getAttribute('aria-checked'),'false');
    await autoPlay.click();
    assert.equal(await autoPlay.getAttribute('aria-checked'),'true');
    // An explicit device choice is retained across the settings and hub boundaries.
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tsugi-watch-first-version-mode'))),'on');
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Home',exact:true}).click();
    await board.getByRole('button',{name:'Public movie fixture',exact:true}).click();
    await item.locator('[data-ui="watch-play-title"]').click();
    await player.locator('[data-ui="player-controls"]:not([data-loading])').waitFor();
    await player.hover();
    assert.equal(await page.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request'&&a.action.kind==='prepare-media').at(-1).action.optionIndex),0);
    await player.hover();
    await player.getByRole('button',{name:'Back',exact:true}).click();
    await player.waitFor({state:'detached'});
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Settings',exact:true}).click();
    await config.getByRole('button',{name:'Playback',exact:true}).click();
    assert.equal(await autoPlay.getAttribute('aria-checked'),'true');
    await autoPlay.click();
    assert.equal(await autoPlay.getAttribute('aria-checked'),'false');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tsugi-watch-first-version-mode'))),'off');
    await config.getByRole('button',{name:'Stremio import',exact:true}).click();
    async function importAccount(provider){
      const account=watch.locator('[data-ui="stremio-account-import"]');
      await account.getByLabel('Account email',{exact:true}).fill('fixture@example.org');
      await account.getByLabel('Account password',{exact:true}).fill('synthetic-password');
      await account.getByRole('button',{name:'Log in',exact:true}).click();
      const candidates=account.locator('[data-import-phase="candidates"]');
      await candidates.waitFor();
      if(provider==='nuvio')assert.equal(await account.locator('[data-import-phase="profiles"]').count(),0,'sole accessible Nuvio profile opens its addons automatically');
      await candidates.getByRole('button',{name:'Select available addons',exact:true}).click();
      if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-import-'+provider+'.png'),animations:'disabled'});
      await candidates.getByRole('button',{name:'Import selected addons',exact:true}).click();
      await watch.locator('[data-watch-pane="home"]').waitFor();
      assert.equal(await watch.locator('[data-ui="watch-settings-navigation"]').count(),0);
    }
    await watch.getByRole('heading',{name:'Connect Stremio',exact:true}).waitFor();
    await importAccount('stremio');
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Settings',exact:true}).click();
    await config.getByRole('button',{name:'Artwork',exact:true}).click();
    await watch.locator('[data-ui="watch-poster-settings"]').getByText('Using original catalogue artwork.',{exact:true}).waitFor();
    await config.getByRole('button',{name:'Nuvio import',exact:true}).click();
    await watch.getByRole('heading',{name:'Connect Nuvio',exact:true}).waitFor();
    await importAccount('nuvio');
    await watch.getByRole('button',{name:'Switch profile',exact:true}).click();
    await watch.locator('[data-ui="watch-profile-picker"]').getByRole('button',{name:'Browse only 0 addons',exact:true}).click();
    const destinations=watch.locator('[data-ui="watch-hub-picker"]');
    await destinations.waitFor();
    assert.equal(await destinations.locator('[data-watch-destination]').count(),3);
    assert.ok(await destinations.locator('[data-watch-destination="standalone"]').isEnabled());
    assert.ok(await destinations.locator('[data-watch-destination="anime"]').isEnabled());
    await destinations.locator('[data-watch-destination="standalone"]').click();
    await watch.getByRole('button',{name:'Public movie fixture',exact:true}).waitFor();
    await watch.getByRole('button',{name:'Streaming hubs',exact:true}).click();
    await destinations.locator('[data-watch-destination="anime"]').click();
    const publicAnime=watch.locator('[data-ui="anime-public-discovery"]');
    const publicPoster=publicAnime.getByRole('button',{name:'Public anime discovery fixture',exact:true}).first();
    await publicPoster.waitFor();
    await publicPoster.scrollIntoViewIfNeeded();
    await page.waitForFunction(card=>Array.from(card.querySelectorAll('img')).some(image=>image.complete&&image.naturalWidth>0),await publicPoster.elementHandle());
    await assertArtwork(publicPoster);
    assert.ok(missingDiscoveryArtRequests>0&&discoveryArtRequests>0,'Tenrai failed large poster falls back to the same title’s valid MAL poster');
    const animeFonts=await watch.locator('.tsugi-anime-hub').locator('.tsugi-anime-heading,[data-ui="media-row-title"],[data-ui="poster-card-title"]').evaluateAll(nodes=>nodes.map(el=>({family:getComputedStyle(el).fontFamily,weight:Number(getComputedStyle(el).fontWeight)})));
    assert.ok(animeFonts.length>=3);
    assert.ok(animeFonts.every(font=>/^Interface(?:,|$)/.test(font.family)&&font.weight>=600&&font.weight<=750),'Anime Hub uses the same Interface font as Movies & TV: '+JSON.stringify(animeFonts));
    const featuredHero=watch.locator('.tsugi-anime-hero[data-feature-id="mal:90004"]');
    await featuredHero.waitFor();
    await publicPoster.locator('[data-ui="poster-card-badge"]').filter({hasText:'MAL 8.6'}).waitFor();
    const heroGeometry=await featuredHero.evaluate(hero=>{
      const r=hero.getBoundingClientRect(),style=getComputedStyle(hero),root=hero.closest('.tsugi-direct-watch'),rail=root.querySelector('.tsugi-watch-shared-rail'),bounds=root.getBoundingClientRect();
      return {left:r.left,right:r.right,innerLeft:r.left+parseFloat(style.paddingLeft),innerRight:r.right-parseFloat(style.paddingRight),railRight:rail.getBoundingClientRect().right,viewportRight:bounds.left+root.clientLeft+root.clientWidth};
    });
    const posterRails=await watch.locator('[data-ui="media-row"][data-shape="poster"][data-contained]').evaluateAll(rows=>rows.filter(row=>row.getBoundingClientRect().width>0).map(row=>({left:row.getBoundingClientRect().left,right:row.getBoundingClientRect().right})));
    assert.ok(Math.abs(heroGeometry.left-heroGeometry.railRight)<=3&&Math.abs(heroGeometry.right-heroGeometry.viewportRight)<=3,'Anime featured art reaches both workspace edges: '+JSON.stringify(heroGeometry));
    assert.ok(posterRails.length>0&&posterRails.every(row=>Math.abs(row.left-heroGeometry.innerLeft)<=2&&Math.abs(row.right-heroGeometry.innerRight)<=2),'Anime poster rails align with the inner content gutters: '+JSON.stringify({heroGeometry,posterRails}));
    await page.waitForFunction(()=>{const hero=document.querySelector('.tsugi-anime-hero[data-feature-id="mal:90004"]');const a=hero?.querySelector('img.tsugi-anime-title-art'),b=hero?.querySelector('.tsugi-anime-feature-poster img');return a?.complete&&b?.complete&&a.naturalWidth>0&&b.naturalWidth>0&&a.currentSrc===b.currentSrc;});
    assert.equal(await featuredHero.locator('[data-ui="landscape-artwork-controls"]').count(),0,'a title never shares a decorative rotating background');
    assert.equal(await featuredHero.locator('.tsugi-anime-hero-controls').count(),0,'one featured title needs no 1/1 carousel controls');
    assert.equal(await watch.locator('[data-ui="watch-catalogue-board"][data-search-only] .tsugi-watch-shelf').count(),0,'Anime uses public shelves without a duplicate addon browsing board');
    assert.equal(await watch.getByText('No matching catalogues',{exact:true}).count(),0);
    await watch.evaluate(node=>node.scrollTo({top:0,left:0,behavior:'instant'}));
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-anime-populated.png'),animations:'disabled'});
    await watch.locator('[data-ui="watch-rail-search"]').getByRole('button',{name:'Search anime',exact:true}).click();
    const animeSearch=page.getByRole('dialog',{name:'Search titles',exact:true});
    await animeSearch.getByRole('searchbox',{name:'Search across addons',exact:true}).fill('Public anime discovery fixture');
    const animeResult=animeSearch.locator('[data-ui="watch-search-results"]').getByRole('button',{name:'Public anime discovery fixture',exact:true});
    await animeResult.waitFor();
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-anime-search.png'),animations:'disabled'});
    await animeResult.click();
    await item.getByRole('heading',{name:'Public anime discovery fixture',exact:true}).waitFor();
    await item.getByText('Independent discovery without addon installation.',{exact:true}).waitFor();
    const publicBackdrop=item.locator('.tsugi-watch-title-backdrop');
    await page.waitForFunction(card=>Array.from(card.querySelectorAll('img')).some(image=>image.complete&&image.naturalWidth>0),await publicBackdrop.elementHandle());
    await assertArtwork(publicBackdrop);
    assert.equal(await item.getByRole('button',{name:'Play',exact:true}).count(),0);
    await item.getByRole('button',{name:'Search this title across addons',exact:true}).click();
    await watch.locator('[data-watch-pane="home"]').waitFor();
    await board.getByRole('searchbox',{name:'Search across addons',exact:true}).waitFor();
    assert.equal(await board.getByRole('searchbox',{name:'Search across addons',exact:true}).inputValue(),'Public anime discovery fixture');
    console.log('PASS: shared streaming cards, stream-only Cinemeta fallback, settings-only account imports, and independent anime discovery with zero addons.');
  }finally{await page.close();}
}

export async function verifyStremioAddonsBrowser({browser,origin,installDesktopFixture,screenshotDir}){
  await verifyContentFirstWatch({browser,origin,installDesktopFixture,screenshotDir});
  const page=await browser.newPage();
  try{
    await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    await page.route('https://raw.githubusercontent.com/example/fixture/main/logo.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"><rect x="5" y="5" width="62" height="62" rx="14" fill="#b3624e"/><path d="M24 20L52 36 24 52Z" fill="white"/></svg>'}));
    await page.addInitScript({content:'('+installDesktopFixture.toString()+')();('+installStremioFixture.toString()+')();'});
    await page.goto(origin);
    await page.getByRole('button',{name:'App settings',exact:true}).first().click();
    const appSettings=page.getByRole('dialog',{name:'App settings',exact:true});
    assert.equal(await appSettings.locator('[data-ui="stremio-addon-settings"]').count(),0,'general settings excludes installed addon management');
    await appSettings.getByRole('button',{name:'Manage Watch addons',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Watch addon manager',exact:true});
    const panel=dialog.locator('[data-ui="stremio-addon-settings"]');
    const review=panel.locator('[data-ui="stremio-review"]');
    const field=panel.getByLabel('Configured manifest URL');
    const button=panel.getByRole('button',{name:'Review addon',exact:true});
    await panel.getByText('No addons installed for this profile.').waitFor();
    const calls=()=>page.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request').map(a=>a.action));
    assert.deepEqual((await calls()).filter(a=>!['list','watch-setup-status'].includes(a.kind)),[],'opening settings only reads profile and setup status');
    async function inspect(){
      await field.fill('https://example.invalid/private-fixture/manifest.json?token=fixture');
      assert.equal(await field.getAttribute('type'),'password');
      assert.equal(await button.isEnabled(),false);
      await panel.getByRole('checkbox').check();await button.click();await review.waitFor();
      assert.equal(await field.inputValue(),'');
      assert.equal((await panel.innerText()).includes('private-fixture'),false);
      assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('private-fixture')),false);
    }
    await page.evaluate(()=>{window.__stremioFixture.manifestMode='bad-extras';});
    await field.fill('https://example.invalid/private-fixture/manifest.json?token=fixture');
    await panel.getByRole('checkbox').check();await button.click();
    await panel.getByText('Invalid catalogue extra fields or required filters',{exact:true}).waitFor();
    assert.equal(await field.inputValue(),'');
    assert.equal(await review.count(),0);
    assert.equal((await panel.innerText()).includes('private-fixture'),false);
    await page.evaluate(()=>{window.__stremioFixture.manifestMode='large';});
    await inspect();assert.equal((await calls()).some(a=>a.kind==='install'),false);
    await review.getByText('200 catalogues',{exact:true}).waitFor();
    await review.getByRole('button',{name:'Cancel review'}).click();await review.waitFor({state:'detached'});
    await page.evaluate(()=>{window.__stremioFixture.manifestMode=null;});
    await inspect();await review.getByRole('button',{name:'Install into profile'}).click();
    const row=panel.locator('[data-stremio-source-id="3"]');
    await row.waitFor();
    assert.deepEqual((await calls()).find(a=>a.kind==='install'),{kind:'install',reviewId:3});
    await row.getByRole('button',{name:'Browse catalogues'}).click();
    const catalog=panel.locator('[data-ui="stremio-catalog"]');
    assert.equal(await catalog.getByRole('button',{name:'Load catalogue'}).isEnabled(),false);
    await catalog.getByLabel('Search',{exact:true}).fill('original');
    await catalog.getByRole('button',{name:'Load catalogue'}).click();
    await catalog.getByText('First original film',{exact:true}).waitFor();
    assert.deepEqual((await calls()).find(a=>a.kind==='catalog'),{kind:'catalog',sourceId:3,mediaType:'movie',catalogId:'search',extras:{search:'original'}});
    await catalog.getByRole('button',{name:'Next page'}).click();
    await catalog.getByText('Second original film',{exact:true}).waitFor();
    await catalog.getByRole('button',{name:'Next page'}).click();
    await panel.getByText('This source repeated a page. Pagination stopped.').waitFor();
    assert.equal(await catalog.getByRole('button',{name:'Next page'}).count(),0);
    await row.getByRole('button',{name:'Disable',exact:true}).click();
    await row.getByRole('button',{name:'Enable',exact:true}).waitFor();
    assert.equal(await row.getByRole('button',{name:'Browse catalogues'}).isEnabled(),false);
    await row.getByRole('button',{name:'Enable',exact:true}).click();
    await row.getByRole('button',{name:'Disable',exact:true}).waitFor();
    const profiles=panel.locator('[data-ui="stremio-profile-management"]');
    const profileName=profiles.getByLabel('Profile name',{exact:true});
    assert.equal(await profileName.inputValue(),'Default');
    await profiles.getByLabel('New profile name',{exact:true}).fill('Second');
    await profiles.getByRole('button',{name:'Create profile',exact:true}).click();
    const active=profiles.getByRole('combobox',{name:'Active addon profile',exact:true});
    await active.locator('option').filter({hasText:'Second'}).waitFor({state:'attached'});
    await active.selectOption({label:'Second'});
    await panel.getByText('No addons installed for this profile.').waitFor();
    assert.equal(await row.count(),0);
    await inspect();
    await review.getByRole('button',{name:'Install into profile'}).click();
    const secondRow=panel.locator('[data-stremio-source-id="5"]');
    await secondRow.waitFor();
    assert.equal(await profileName.inputValue(),'Second');
    await profileName.fill('Default');
    await profiles.getByRole('button',{name:'Rename active profile',exact:true}).click();
    await panel.getByRole('alert').filter({hasText:'A profile already uses that name.'}).waitFor();
    assert.equal(await profileName.inputValue(),'Default','duplicate-name failure retains the draft');
    await secondRow.waitFor();
    await profileName.fill('Renamed');
    await profiles.getByRole('button',{name:'Rename active profile',exact:true}).click();
    await active.locator('option').filter({hasText:'Renamed'}).waitFor({state:'attached'});
    await secondRow.waitFor();
    await active.selectOption({label:'Default'});
    await row.waitFor();
    assert.equal(await secondRow.count(),0);
    const scoped=await page.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request'&&a.action.kind==='install'));
    assert.deepEqual(scoped.map(a=>[a.profileId,a.action.reviewId]),[[1,3],[4,5]]);
    await profiles.getByText('Delete an inactive profile',{exact:true}).click();
    await profiles.getByRole('combobox',{name:'Profile to delete',exact:true}).selectOption({label:'Renamed'});
    const deletion=profiles.getByRole('button',{name:'Delete profile',exact:true});
    assert.equal(await deletion.isEnabled(),false);
    await profiles.getByLabel('Confirm profile name',{exact:true}).fill('Renamed');
    await deletion.click();
    await active.locator('option').filter({hasText:'Renamed'}).waitFor({state:'detached'});
    await row.waitFor();
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'App settings',exact:true}).first().click();
    assert.equal(await appSettings.locator('[data-stremio-source-id]').count(),0);
    await appSettings.getByRole('button',{name:'Manage Watch addons',exact:true}).click();
    await row.waitFor();
    await row.getByRole('button',{name:'Remove',exact:true}).click();
    await panel.getByText('No addons installed for this profile.').waitFor();
    const account=panel.locator('[data-ui="stremio-account-import"]');
    async function signIn(provider){
      await account.getByRole('combobox',{name:'Import provider',exact:true}).selectOption(provider);
      await account.getByLabel('Account email',{exact:true}).fill('fixture@example.org');
      await account.getByLabel('Account password',{exact:true}).fill('synthetic-password');
      await account.getByRole('button',{name:'Log in',exact:true}).click();
    }
    async function reviewAccount(){
      const candidates=account.locator('[data-import-phase="candidates"]');
      await candidates.waitFor();
      assert.equal(await candidates.getByRole('button',{name:'Import selected addons',exact:true}).isEnabled(),false);
      await candidates.getByRole('button',{name:'Select available addons',exact:true}).click();
      await candidates.getByRole('button',{name:'Import selected addons',exact:true}).click();
    }
    await page.evaluate(()=>{
      const f=window.__stremioFixture;f.visibleImportReview=false;
      new MutationObserver(()=>{if(document.querySelector('[data-import-phase="review"]'))f.visibleImportReview=true;}).observe(document.body,{childList:true,subtree:true});
    });
    await signIn('stremio');
    await account.locator('[data-import-phase="candidates"]').waitFor();
    const candidateLogo=account.locator('[data-ui="addon-logo"] img');
    await candidateLogo.waitFor();
    assert.ok(await candidateLogo.evaluate(async img=>{await img.decode();return img.naturalWidth>0&&img.referrerPolicy==='no-referrer';}));
    assert.equal((await account.innerText()).includes('synthetic-password'),false);
    assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('synthetic-password')),false);
    assert.equal((await calls()).some(a=>a.kind==='import-review'||a.kind==='import-apply'),false);
    await reviewAccount();
    await panel.getByText('Unavailable fixture · Manifest request failed; check the connection and retry',{exact:true}).waitFor();
    await panel.getByText('1 Continue watching entries imported from Stremio.',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.__stremioFixture.profiles.find(p=>p.profileId===window.__stremioFixture.active).history.find(row=>row.importedStremio)?.progress.videoId),'tt90123:2:3');
    await panel.locator('[data-stremio-source-id]').filter({hasText:'Account film addon'}).waitFor();
    await panel.getByRole('button',{name:'Retry failed addons',exact:true}).click();
    await panel.locator('[data-stremio-source-id]').filter({hasText:'Recovered fixture'}).waitFor();
    assert.equal((await calls()).filter(a=>a.kind==='import-connect').length,1);
    await page.evaluate(()=>{window.__stremioFixture.nuvioMultipleProfiles=true;});
    await signIn('nuvio');
    const remote=account.getByRole('combobox',{name:'Nuvio profile',exact:true});
    await remote.waitFor();
    assert.equal(await remote.locator('option[value="1"]').evaluate(option=>option.disabled),true);
    assert.equal(await remote.locator('option[value="2"]').evaluate(option=>option.disabled),true);
    assert.equal(await remote.locator('option[value="4"]').evaluate(option=>option.disabled),false);
    await remote.selectOption('3');
    await reviewAccount();
    const imported=panel.locator('[data-stremio-source-id]').filter({hasText:'Nuvio audio fixture'});
    await imported.waitFor();
    assert.ok((await imported.innerText()).includes('Disabled'));
    const installedLogo=imported.locator('[data-ui="addon-logo"] img');
    await installedLogo.scrollIntoViewIfNeeded();
    assert.ok(await installedLogo.evaluate(async img=>{await img.decode();return img.naturalWidth>0;}));
    assert.equal(await page.evaluate(()=>window.__stremioFixture.visibleImportReview),false,'neither account import exposes an intermediate review confirmation');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-installed-addon-logos.png'),animations:'disabled'});
    await panel.locator('[data-stremio-source-id]').first().filter({hasText:'Nuvio audio fixture'}).waitFor();
    const accountFilm=panel.locator('[data-stremio-source-id]').filter({hasText:'Account film addon'});
    await accountFilm.getByRole('button',{name:'Move up',exact:true}).click();
    await panel.locator('[data-stremio-source-id]').first().filter({hasText:'Account film addon'}).waitFor();
    const providerCalls=(await calls()).filter(a=>a.kind.startsWith('import-')).map(a=>a.kind);
    assert.deepEqual(providerCalls,['import-connect','import-review','import-apply','import-retry','import-connect','import-nuvio-profile','import-review','import-apply']);
    await page.evaluate(()=>{
      const f=window.__stremioFixture,profile=f.profiles.find(p=>p.profileId===f.active);
      const manifest=profile.sources[0].manifest;
      profile.sources=Array.from({length:128},(_,index)=>({sourceId:1000+index,enabled:index%3!==0,
        manifest:{...manifest,name:'Capacity fixture '+index}}));
    });
    await panel.getByRole('button',{name:'Refresh installed addons',exact:true}).click();
    await panel.locator('[data-stremio-source-id="1127"]').waitFor();
    assert.equal(await panel.locator('[data-stremio-source-id]').count(),128);
    assert.equal(await panel.locator('[data-stremio-source-id]').first().getAttribute('data-stremio-source-id'),'1000');
    await panel.locator('[data-stremio-source-id="1127"]').scrollIntoViewIfNeeded();
    assert.ok(await dialog.getByRole('button',{name:'Close',exact:true}).evaluate(button=>{
      const r=button.getBoundingClientRect(),d=button.closest('dialog').getBoundingClientRect();
      return r.top>=d.top&&r.bottom<=d.bottom&&button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
    }),'close remains reachable even after scrolling a full addon stack');
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,'watch-addon-manager-close.png'),animations:'disabled'});
    console.log('Stremio/Nuvio account import, profile isolation, single-action import, manifest diagnostics and large source/catalogue limits passed');
  }finally{await page.close();}
  // Do not trust an existing introduction flag or preferred startup area.
  const requiredSetup=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    await requiredSetup.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    await requiredSetup.addInitScript({content:'('+installDesktopFixture.toString()+')();('+installStremioFixture.toString()+')();window.__stremioFixture.profiles[0].watchSetup={tmdbConnected:false,accountProvider:null};'});
    await requiredSetup.goto(origin);
    const gate=requiredSetup.locator('[data-ui="watch-required-setup"]');
    await gate.getByLabel('TMDB v3 API key',{exact:true}).waitFor();
    assert.deepEqual(await gate.locator('.tsugi-required-art').evaluate(async node=>{
      const match=getComputedStyle(node).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
      if(!match)throw new Error('Missing setup artwork');
      const image=new Image();image.src=match[1];await image.decode();
      return {path:new URL(image.src).pathname,width:image.naturalWidth,height:image.naturalHeight};
    }),{path:'/design/launch/launch-purple.jpg',width:2048,height:1152});
    if(screenshotDir)await requiredSetup.screenshot({path:join(screenshotDir,'watch-purple-first-launch.png'),animations:'disabled'});
    assert.equal(await requiredSetup.locator('[data-page="desktop-landing"]').count(),0);
    assert.equal(await requiredSetup.locator('[data-page="direct-watch"]').count(),0);
    await requiredSetup.keyboard.press('Escape');
    await gate.getByLabel('TMDB v3 API key',{exact:true}).fill('invalid');
    await gate.getByRole('button',{name:'Validate and save key',exact:true}).click();
    await gate.getByRole('alert').waitFor();
    await gate.getByLabel('TMDB v3 API key',{exact:true}).fill('00000000000000000000000000000000');
    await gate.getByRole('button',{name:'Validate and save key',exact:true}).click();
    await gate.getByLabel('Account email',{exact:true}).fill('fixture@example.org');
    await gate.getByLabel('Account password',{exact:true}).fill('synthetic-password');
    await gate.getByRole('button',{name:'Log in',exact:true}).click();
    await gate.getByRole('button',{name:'Select available addons',exact:true}).click();
    await gate.getByRole('button',{name:'Import selected addons',exact:true}).click();
    await gate.getByRole('button',{name:'Retry failed addons',exact:true}).click();
    await requiredSetup.locator('[data-page="desktop-landing"]').waitFor();
    assert.equal(await requiredSetup.evaluate(()=>JSON.stringify(localStorage).includes('00000000000000000000000000000000')),false);
    assert.equal(await requiredSetup.evaluate(()=>JSON.stringify(localStorage).includes('synthetic-password')),false);
  }finally{await requiredSetup.close();}
  const firstLaunch=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    await firstLaunch.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    await firstLaunch.addInitScript({content:'('+installDesktopFixture.toString()+')();('+installStremioFixture.toString()+')();localStorage.removeItem("tsugi-onboarding-complete-v1");localStorage.setItem("tsugi.landscape.local-only","true");localStorage.setItem("tsugi-discord-presence-v1",JSON.stringify({enabled:true,applicationId:"123456789012345678",privateMode:false,media:{video:true,music:true,manga:true,books:true}}));'});
    await firstLaunch.goto(origin,{waitUntil:'domcontentloaded'});
    await firstLaunch.getByRole('navigation',{name:'Media sections'}).waitFor();
    assert.equal(await firstLaunch.getByRole('dialog').count(),0);
    await firstLaunch.getByRole('button',{name:'Introduction',exact:true}).click();
    await firstLaunch.getByRole('button',{name:'Set up addons',exact:true}).click();
    const setup=firstLaunch.getByRole('dialog',{name:'Set up your addon profile',exact:true});
    const picker=setup.locator('[data-ui="watch-profile-picker"]');
    await picker.getByRole('button',{name:'Default 0 addons',exact:true}).waitFor();
    assert.equal(await setup.locator('[data-ui="stremio-addon-settings"]').count(),0);
    if(screenshotDir){await mkdir(screenshotDir,{recursive:true});await firstLaunch.screenshot({path:join(screenshotDir,'watch-profile-picker.png'),animations:'disabled'});}
    await picker.getByRole('button',{name:'Create profile',exact:true}).click();
    await picker.getByLabel('Profile name',{exact:true}).fill('Cinema');
    await picker.getByRole('button',{name:'Create and continue',exact:true}).click();
    const manager=setup.locator('[data-ui="stremio-addon-settings"]');
    await manager.getByRole('button',{name:'Stremio import',exact:true}).click();
    await manager.getByRole('heading',{name:'Connect Stremio',exact:true}).waitFor();
    await manager.getByRole('button',{name:'Nuvio import',exact:true}).click();
    await manager.getByRole('heading',{name:'Connect Nuvio',exact:true}).waitFor();
    await manager.getByRole('button',{name:'Add addon',exact:true}).click();
    await manager.getByLabel('Configured manifest URL').waitFor();
    await manager.getByRole('button',{name:'Source order',exact:true}).click();
    await manager.getByRole('heading',{name:'Source order',exact:true}).waitFor();
    await manager.getByRole('button',{name:'Switch profile',exact:true}).click();
    await picker.getByRole('button',{name:'Cinema 0 addons',exact:true}).waitFor();
    await picker.getByRole('button',{name:'Default 0 addons',exact:true}).click();
    await manager.getByRole('heading',{name:'Your addon stack.',exact:true}).waitFor();
    const requests=await firstLaunch.evaluate(()=>window.__stremioFixture.calls);
    assert.ok(requests.every(a=>['profile-list','profile-create','profile-switch'].includes(a.kind)||(a.kind==='profile-request'&&['list','watch-setup-status'].includes(a.action.kind))));
    await manager.locator('.tsugi-watch-settings-nav').getByRole('button',{name:'Anime',exact:true}).click();
    const setupAnime=manager.locator('[data-ui="mal-anime-library"]');
    const setupAnimePanel=setupAnime.locator('[data-ui="mal-collection"]');
    const setupXml='<myanimelist><anime><series_animedb_id>700</series_animedb_id><series_title>Onboarding anime</series_title><series_type>Movie</series_type><series_episodes>1</series_episodes><my_status>Plan to Watch</my_status><my_watched_episodes>0</my_watched_episodes><my_score>0</my_score></anime></myanimelist>';
    await setupAnimePanel.getByLabel('Choose MyAnimeList export',{exact:true}).setInputFiles({name:'animelist.xml',mimeType:'application/xml',buffer:Buffer.from(setupXml)});
    const setupPreview=setupAnimePanel.locator('[data-ui="mal-import-preview"]');
    await setupPreview.getByRole('button',{name:'Import reviewed list',exact:true}).click();
    const setupRow=setupAnimePanel.locator('[data-mal-id="700"]');
    await setupRow.waitFor();assert.equal(await setupRow.evaluate(node=>node.tagName),'DIV');
    await setupRow.locator('xpath=..').getByRole('button',{name:'Remove',exact:true}).click();
    await setupAnimePanel.getByRole('button',{name:'Confirm removal',exact:true}).click();
    await setupRow.waitFor({state:'detached'});
    await setupAnime.locator('[data-ui="anime-connection-shortcuts"]').getByRole('button',{name:/Refract/}).click();
    const setupRefract=setupAnime.locator('[data-ui="watch-refract"]');
    await setupRefract.getByLabel('Refract API key',{exact:true}).fill('rfk_fixture-only');
    await setupRefract.getByRole('button',{name:'Verify and connect',exact:true}).click();
    await setupRefract.getByText('Fixture member',{exact:true}).waitFor();
    await setupRefract.getByRole('button',{name:'Disconnect',exact:true}).click();
    await setupRefract.getByRole('button',{name:'Confirm disconnect',exact:true}).click();
    await setupRefract.getByRole('button',{name:'Verify and connect',exact:true}).waitFor();
    assert.equal(await firstLaunch.evaluate(()=>JSON.stringify(localStorage).includes('rfk_fixture-only')),false);
    await setup.getByRole('button',{name:'Appearance',exact:true}).click();
    const intro=firstLaunch.getByRole('dialog',{name:'Make Tsugi yours',exact:true});
    await intro.getByRole('button',{name:'Set up addons',exact:true}).waitFor();
    await intro.locator('[data-ui="first-launch-connections"]').getByRole('button',{name:'Set up Anime and Watch connections',exact:true}).waitFor();
    const mangaIntro=intro.getByRole('button',{name:'Import manga list',exact:true});
    if(await mangaIntro.count()){
      await mangaIntro.click();
      const mangaPanel=intro.locator('[data-ui="mal-manga-library"] [data-ui="mal-collection"]');
      const mangaXml='<myanimelist><manga><manga_mangadb_id>701</manga_mangadb_id><manga_title>Onboarding manga</manga_title><my_status>Reading</my_status><my_read_chapters>2</my_read_chapters></manga></myanimelist>';
      await mangaPanel.getByLabel('Choose MyAnimeList export',{exact:true}).setInputFiles({name:'mangalist.xml',mimeType:'application/xml',buffer:Buffer.from(mangaXml)});
      await mangaPanel.getByRole('button',{name:'Import reviewed list',exact:true}).click();
      const mangaRow=mangaPanel.locator('[data-mal-id="701"]');await mangaRow.waitFor();
      assert.equal(await mangaRow.evaluate(node=>node.tagName),'DIV');
      assert.equal(await firstLaunch.evaluate(()=>JSON.parse(localStorage.getItem('tsugi-mal-manga-v1')).entries[0].malId),701);
      await mangaRow.locator('xpath=..').getByRole('button',{name:'Remove',exact:true}).click();
      await mangaPanel.getByRole('button',{name:'Confirm removal',exact:true}).click();
      await mangaRow.waitFor({state:'detached'});
    }
    console.log('PASS: First-launch optional MAL anime import and Refract connection; appearance introduces Anime Hub and Reader collections.');
    await intro.getByRole('button',{name:'Skip for now',exact:true}).click();
    await intro.waitFor({state:'hidden'});
    assert.equal(await firstLaunch.evaluate(()=>JSON.parse(localStorage.getItem('tsugi-onboarding-complete-v1'))),true);
    await firstLaunch.getByRole('button',{name:'Movies & TV',exact:true}).first().click();
    const watch=firstLaunch.locator('[data-page="direct-watch"]');
    await watch.locator('[data-ui="watch-hub-picker"]').waitFor();
    assert.equal(await watch.locator('[data-ui="watch-profile-picker"]').count(),0);
    await watch.locator('[data-ui="watch-hub-picker"] [data-watch-destination="standalone"]').click();
    await watch.getByRole('heading',{name:'Movies & TV',exact:true}).waitFor();
    const watchGlyphs=await watch.locator('.tsugi-watch-nav [data-movie-glyph]').evaluateAll(nodes=>nodes.map(node=>({name:node.getAttribute('data-movie-glyph'),fill:node.getAttribute('fill'),stroke:node.getAttribute('stroke')})));
    assert.deepEqual(watchGlyphs.map(g=>g.name),['home','discover','anime','heart','list','history','settings']);assert.ok(watchGlyphs.every(g=>g.fill==='currentColor'&&g.stroke==='none'));
    async function watchSetting(name){
      const nav=watch.locator('[data-ui="watch-settings-navigation"]');
      if(!await nav.isVisible())await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Settings',exact:true}).click();
      await nav.getByRole('button',{name,exact:true}).click();
    }
    await watchSetting('MyAnimeList XML');
    const settingsAnime=watch.locator('[data-ui="mal-anime-library"] [data-ui="mal-collection"]');
    await settingsAnime.getByLabel('Choose MyAnimeList export',{exact:true}).setInputFiles({name:'animelist.xml',mimeType:'application/xml',buffer:Buffer.from(setupXml)});
    await settingsAnime.getByRole('button',{name:'Import reviewed list',exact:true}).click();
    await settingsAnime.locator('div[data-mal-id="700"]').waitFor();
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Anime Hub',exact:true}).click();
    await watch.locator('[data-ui="mal-anime-library"] button[data-mal-id="700"]').waitFor();
    await watchSetting('MyAnimeList XML');
    const importedSettingsRow=settingsAnime.locator('div[data-mal-id="700"]');
    await importedSettingsRow.waitFor();
    await importedSettingsRow.locator('xpath=..').getByRole('button',{name:'Remove',exact:true}).click();
    await settingsAnime.getByRole('button',{name:'Confirm removal',exact:true}).click();
    await importedSettingsRow.waitFor({state:'detached'});
    console.log('PASS: Watch Settings exposes profile-local MyAnimeList XML import and shares the Anime Hub collection.');
    await watchSetting('Add addon');
    await watch.getByLabel('Configured manifest URL').fill('https://example.invalid/private-fixture/manifest.json?token=fixture');
    await watch.getByRole('checkbox').check();
    await watch.getByRole('button',{name:'Review addon',exact:true}).click();
    await watch.getByRole('button',{name:'Install into profile',exact:true}).click();
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Anime Hub',exact:true}).click();
    const anime=watch.locator('[data-ui="mal-anime-library"]');
    const animePanel=anime.locator('[data-ui="mal-collection"]');
    const hubNav=anime.getByRole('navigation',{name:'Anime Hub sections',exact:true});
    const hero=anime.locator('.tsugi-anime-hero');
    await hero.waitFor();
    const fallback=hero.locator('img.tsugi-design-illustration');
    assert.equal(await fallback.getAttribute('src'),'/design/anime/hero-kagezora.webp');
    await hero.getByRole('button',{name:'Enable external illustration',exact:true}).waitFor();
    await hero.getByRole('button',{name:'Next bundled illustration',exact:true}).click();
    assert.equal(await fallback.getAttribute('src'),'/design/anime/art-neon.webp');
    await hero.getByRole('button',{name:'Previous bundled illustration',exact:true}).click();
    assert.equal(await fallback.getAttribute('src'),'/design/anime/hero-kagezora.webp');
    const creditBounds=await hero.locator('[data-ui="landscape-artwork-controls"]').boundingBox();
    const carouselBounds=await hero.locator('.tsugi-anime-hero-controls').boundingBox();
    assert.ok(creditBounds&&carouselBounds,'Anime hero controls are visible');
    assert.ok(creditBounds.x+creditBounds.width<=carouselBounds.x||creditBounds.y+creditBounds.height<=carouselBounds.y,'Artwork attribution must not overlap carousel controls');
    await anime.locator('[data-ui="anime-connection-shortcuts"]').getByRole('button',{name:/MyAnimeList/}).waitFor();
    const malFile=animePanel.getByLabel('Choose MyAnimeList export',{exact:true});
    const malPreview=animePanel.locator('[data-ui="mal-import-preview"]');
    await malFile.setInputFiles({name:'mangalist.xml',mimeType:'application/xml',buffer:Buffer.from('<myanimelist><manga/></myanimelist>')});
    await animePanel.getByRole('alert').waitFor();
    assert.equal(await malPreview.count(),0);
    const animeXml='<myanimelist><myinfo><user_name>private-anime-fixture</user_name></myinfo>'+
      '<anime><series_animedb_id>601</series_animedb_id><series_title>Imported anime film</series_title><series_type>Movie</series_type><series_episodes>1</series_episodes><my_status>Completed</my_status><my_watched_episodes>1</my_watched_episodes><my_score>9</my_score></anime>'+
      '<anime><series_animedb_id>602</series_animedb_id><series_title>Imported anime series</series_title><series_type>TV</series_type><series_episodes>12</series_episodes><my_status>Watching</my_status><my_watched_episodes>4</my_watched_episodes><my_score>8</my_score></anime></myanimelist>';
    const beforeAnimeImport=await firstLaunch.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request'&&a.action.kind==='mal-anime-import').length);
    await malFile.setInputFiles({name:'animelist.xml.gz',mimeType:'application/gzip',buffer:gzipSync(Buffer.from(animeXml))});
    await malPreview.getByRole('heading',{name:'Review MAL import',exact:true}).waitFor();
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request'&&a.action.kind==='mal-anime-import').length),beforeAnimeImport);
    await malPreview.getByRole('button',{name:'Import reviewed list',exact:true}).click();
    const animeFilm=animePanel.locator('button[data-mal-id="601"]'), animeSeries=animePanel.locator('button[data-mal-id="602"]');
    await animeFilm.waitFor();await animeSeries.waitFor();
    assert.match(await animeSeries.innerText(),/4\s*\/\s*12 episodes/);
    const format=animePanel.getByRole('combobox',{name:'Anime format',exact:true});
    await format.selectOption('movie');await animeSeries.waitFor({state:'detached'});
    await format.selectOption('series');await animeFilm.waitFor({state:'detached'});
    await format.selectOption('');
    await malFile.setInputFiles({name:'animelist.xml',mimeType:'application/xml',buffer:Buffer.from(animeXml)});
    await malPreview.waitFor();
    assert.equal(await malPreview.getByRole('button',{name:'Import reviewed list',exact:true}).isEnabled(),false);
    await malPreview.getByRole('button',{name:'Cancel',exact:true}).click();
    const storedAnime=await firstLaunch.evaluate(()=>window.__stremioFixture.profiles.find(p=>p.profileId===1).malAnime);
    assert.deepEqual(storedAnime.map(row=>[row.malId,row.format,row.progress,row.score]),[[601,'Movie',1,9],[602,'TV',4,8]]);
    assert.equal(JSON.stringify(storedAnime).includes('private-anime-fixture'),false);
    assert.equal(await firstLaunch.evaluate(()=>JSON.stringify(localStorage).includes('Imported anime film')),false);
    let coverRequests=0;
    const coverUrl='https://cdn.myanimelist.net/images/anime/1/601.jpg';
    await firstLaunch.route('https://api.tenrai.org/v1/anime/**',route=>{
      coverRequests++;
      const id=Number(new URL(route.request().url()).pathname.split('/').at(-1));
      assert.ok([601,602].includes(id));
      assert.equal(route.request().url(),'https://api.tenrai.org/v1/anime/'+id);
      return route.fulfill({json:{data:{mal_id:id,rating:'PG-13 - Teens 13 or older',images:{jpg:{image_url:'https://cdn.myanimelist.net/images/anime/1/'+id+'.jpg'}}}},headers:{'access-control-allow-origin':'*'}});
    });
    await firstLaunch.route('https://cdn.myanimelist.net/images/anime/1/*.jpg',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4uUAAAAASUVORK5CYII=','base64')}));
    await anime.locator('[data-ui="anime-connection-shortcuts"]').getByRole('button',{name:/Refract/}).click();
    const connections=anime.locator('[data-ui="anime-connections"]');
    await connections.getByLabel('Refract API key',{exact:true}).waitFor();
    assert.equal(coverRequests,0);
    await connections.getByRole('checkbox',{name:'Fetch anime covers',exact:true}).check();
    await hubNav.getByRole('button',{name:'My List',exact:true}).click();
    await animeFilm.scrollIntoViewIfNeeded();
    await animeFilm.locator('img[src="'+coverUrl+'"]').waitFor({state:'attached'});
    assert.ok(coverRequests>0);
    await hubNav.getByRole('button',{name:'Connections',exact:true}).click();
    await connections.getByRole('checkbox',{name:'Fetch anime covers',exact:true}).uncheck();
    await hubNav.getByRole('button',{name:'Anime Hub',exact:true}).click();
    assert.equal(await animePanel.locator('[data-ui="anime-cover"]').count(),0);
    console.log('PASS: Anime Hub shared artwork fallback, exact opt-in MAL covers, and direct MAL/Refract shortcuts.');
    if(screenshotDir)await firstLaunch.screenshot({path:join(screenshotDir,'watch-mal-anime.png'),animations:'disabled'});
    await hubNav.getByRole('button',{name:'Anime films',exact:true}).click();
    await animeFilm.waitFor();await animeSeries.waitFor({state:'detached'});
    await hubNav.getByRole('button',{name:'Discover',exact:true}).click();
    const discovery=anime.locator('[data-ui="anime-discover"]');
    await discovery.getByRole('combobox',{name:'Anime discovery catalogue',exact:true}).selectOption({index:1});
    await discovery.getByRole('textbox',{name:'Search',exact:true}).fill('original');
    await discovery.getByRole('button',{name:'Load catalogue',exact:true}).click();
    await discovery.getByRole('button',{name:/First original film/}).click();
    await watch.locator('[data-ui="watch-item-details"]').getByRole('heading',{name:'First original film',exact:true}).waitFor();
    assert.equal(await anime.isVisible(),false,'Title detail replaces the Anime Hub while open');
    await watch.locator('[data-ui="watch-item-details"]').getByRole('button',{name:'Close title',exact:true}).click();
    await hubNav.getByRole('button',{name:'My List',exact:true}).click();
    await animeFilm.click();
    const animeSource=anime.locator('[data-ui="mal-anime-source"]');
    await animeSource.getByRole('combobox',{name:'Anime source catalogue',exact:true}).selectOption({index:1});
    await animeSource.getByRole('textbox',{name:'Search imported anime',exact:true}).fill('original');
    await animeSource.getByRole('button',{name:'Search anime',exact:true}).click();
    await animeSource.getByRole('button',{name:/First original film/}).click();
    await animeSource.locator('[data-ui="mal-anime-match"]').getByRole('button',{name:'Save and open matched anime',exact:true}).click();
    await watch.locator('[data-ui="watch-item-details"]').getByRole('heading',{name:'First original film',exact:true}).waitFor();
    assert.match(await animeFilm.innerText(),/Source selected/);
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.profiles.find(p=>p.profileId===1).malMatches[0].itemId),'tt123');
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.calls.some(a=>a.kind==='profile-request'&&a.action.kind==='watch-record')),false);
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.calls.some(a=>a.kind==='profile-request'&&a.action.kind==='refract-watchlist')),false);
    await watchSetting('Refract');
    const refract=watch.locator('[data-ui="watch-refract"]');
    const refractKey=refract.getByLabel('Refract API key',{exact:true});
    const refractConnect=refract.getByRole('button',{name:'Verify and connect',exact:true});
    await refractKey.fill('rfk_fixture-rejected');
    assert.equal(await refractKey.getAttribute('type'),'password');
    await refractConnect.click();
    await refract.getByText('Refract rejected this key. Check the key, its expiry and your API access.',{exact:true}).waitFor();
    assert.equal(await refractKey.inputValue(),'');
    await refractKey.fill('rfk_fixture-only');await refractConnect.click();
    await refract.getByText('Fixture member',{exact:true}).waitFor();
    assert.equal(await firstLaunch.evaluate(()=>JSON.stringify(localStorage).includes('rfk_fixture-only')),false);
    const track=refract.getByRole('checkbox',{name:'Track completed movies and episodes',exact:true});
    assert.equal(await track.isChecked(),false);
    const checkboxLayout=await track.evaluate(node=>({display:getComputedStyle(node.closest('label')).display,control:node.getBoundingClientRect().top,text:node.closest('label').querySelector('span').getBoundingClientRect().top}));
    assert.equal(checkboxLayout.display,'flex');
    assert.ok(Math.abs(checkboxLayout.control-checkboxLayout.text)<=8,'Tracking checkbox and caption should share one row');
    await track.check();
    await firstLaunch.waitForFunction(()=>window.__stremioFixture.profiles.find(p=>p.profileId===1).refract.enabled);
    const threshold=refract.getByRole('combobox',{name:'Log a watch at'});
    await threshold.selectOption('70');
    await firstLaunch.waitForFunction(()=>window.__stremioFixture.profiles.find(p=>p.profileId===1).refract.threshold===70);
    await threshold.selectOption('');
    await refractKey.fill('rfk_other_account');
    await refract.getByRole('button',{name:'Verify replacement key',exact:true}).click();
    await refract.getByText('This key belongs to another account. Disconnect the current account before connecting a different one.',{exact:true}).waitFor();
    assert.equal(await track.isChecked(),true);
    if(screenshotDir)await firstLaunch.screenshot({path:join(screenshotDir,'watch-refract.png'),animations:'disabled'});
    await watchSetting('MDBList');
    const mdb=watch.locator('[data-ui="watch-mdblist"]');
    const key=mdb.getByLabel('MDBList API key',{exact:true});
    const connect=mdb.getByRole('button',{name:'Verify and connect',exact:true});
    await key.fill('fixture-rejected-key');assert.equal(await key.getAttribute('type'),'password');
    await connect.click();await mdb.getByText('MDBList rejected the key or list access.',{exact:true}).waitFor();
    assert.equal(await key.inputValue(),'');
    await key.fill('fixture-mdblist-key');await connect.click();
    await mdb.getByText('Connected to MDBList for this profile.',{exact:true}).waitFor();
    assert.equal(await firstLaunch.evaluate(()=>JSON.stringify(localStorage).includes('fixture-mdblist-key')),false);
    await mdb.getByRole('button',{name:'Load my lists',exact:true}).click();
    await mdb.getByRole('combobox',{name:'My lists',exact:true}).selectOption('42');
    const listId=mdb.getByLabel('MDBList list ID',{exact:true});
    const loadList=mdb.getByRole('button',{name:'Load list',exact:true});
    await listId.fill('4294967296');assert.equal(await loadList.isEnabled(),false);
    await listId.fill('43');await loadList.click();
    await mdb.getByText('MDBList is rate limiting requests. Try again later.',{exact:true}).waitFor();
    await listId.fill('42');await loadList.click();
    await mdb.getByText('IMDB 85/100',{exact:true}).waitFor();
    assert.equal(await mdb.getByText('UNKNOWN 100/100',{exact:true}).count(),0);
    await mdb.getByRole('button',{name:'Next page',exact:true}).click();
    await mdb.getByRole('button',{name:'MDBList second film',exact:true}).waitFor();
    assert.equal(await mdb.getByRole('button',{name:'MDBList fixture film',exact:true}).count(),1);
    assert.equal(await mdb.getByRole('button',{name:'MDBList second film',exact:true}).count(),1);
    await mdb.getByRole('button',{name:'Next page',exact:true}).click();
    await mdb.getByText('MDBList repeated a page. Pagination stopped.',{exact:true}).waitFor();
    await mdb.getByRole('button',{name:'MDBList fixture film',exact:true}).click();
    await watch.locator('[data-ui="watch-item-details"]').getByRole('heading',{name:'MDBList fixture film',exact:true}).waitFor();
    const watchlist=watch.locator('[data-ui="watch-refract-watchlist"]');
    await watchlist.getByText('Refract watchlist',{exact:true}).click();
    await watchlist.getByRole('button',{name:'Add to Refract watchlist',exact:true}).click();
    await watchlist.getByText('Watchlist change queued for this profile.',{exact:true}).waitFor();
    await watchlist.getByRole('button',{name:'Remove from Refract watchlist',exact:true}).click();
    await watchlist.getByText('Refract kept existing tracked library data unchanged.',{exact:true}).waitFor();
    assert.deepEqual(await firstLaunch.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request'&&a.action.kind==='refract-watchlist').map(a=>a.action)),[
      {kind:'refract-watchlist',mediaType:'movie',itemId:'tt123',add:true},
      {kind:'refract-watchlist',mediaType:'movie',itemId:'tt123',add:false}
    ]);
    if(screenshotDir)await firstLaunch.screenshot({path:join(screenshotDir,'watch-mdblist.png'),animations:'disabled'});
    await watchSetting('Your addons');
    await watch.getByRole('button',{name:'Browse catalogues',exact:true}).click();
    const catalog=watch.locator('[data-ui="stremio-catalog"]');
    await catalog.getByLabel('Search',{exact:true}).fill('original');
    await catalog.getByRole('button',{name:'Load catalogue'}).click();
    await catalog.getByRole('button',{name:'First original film',exact:true}).click();
    const item=watch.locator('[data-ui="watch-item-details"]');
    await item.getByRole('button',{name:'Streams · Original addon fixture',exact:true}).click();
    const options=item.locator('[data-ui="watch-item-options"]');
    await options.getByText('HD fixture',{exact:true}).waitFor();
    assert.equal(await options.getByRole('button',{name:'Play',exact:true}).count(),1);
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.mediaCalls.some(a=>a.type==='stremio-consume-grant')),false);
    await options.getByRole('button',{name:'Play',exact:true}).click();
    const player=watch.locator('[data-ui="direct-watch-player"]');
    await player.locator('[data-ui="player-controls"]:not([data-loading])').waitFor();
    await player.hover();
    await player.getByRole('button',{name:'Subtitles',exact:true}).click();
    await firstLaunch.locator('[data-ui="player-menu"][data-name="subtitles"]').getByText('Addon subtitles',{exact:true}).click();
    const subtitles=firstLaunch.locator('[data-ui="watch-player-subtitles"]');
    await subtitles.getByRole('button',{name:'Original addon fixture',exact:true}).click();
    await subtitles.getByRole('button',{name:'English fixture eng',exact:true}).click();
    await subtitles.getByText('Subtitle request accepted.',{exact:true}).waitFor();
    await firstLaunch.keyboard.press('Escape');
    await subtitles.waitFor({state:'detached'});
    await firstLaunch.evaluate(()=>window.__stremioFixture.emitPlayer({type:'player-state',paused:false,positionMs:45000,durationMs:120000}));
    await player.hover();
    await player.locator('[data-ui="player-time"]').filter({hasText:'0:45 / 2:00'}).waitFor();
    await firstLaunch.waitForFunction(()=>window.__stremioFixture.presenceMessages.filter(m=>m.type==='presence').at(-1)?.presence?.position===45000);
    const presence=await firstLaunch.evaluate(()=>window.__stremioFixture.presenceMessages.filter(m=>m.type==='presence').at(-1).presence);
    assert.deepEqual(presence,{media:'video',title:'First original film',subtitle:null,imdb:'tt123',position:45000,duration:120000,paused:false,browsing:false});
    await player.hover();
    await player.getByRole('button',{name:'Back',exact:true}).click();
    await player.waitFor({state:'detached'});
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.mediaCalls.filter(a=>a.type==='stremio-consume-grant').length),2);
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.mediaCalls.some(a=>a.type==='player-stop')),true);
    await firstLaunch.waitForFunction(()=>window.__stremioFixture.presenceMessages.filter(m=>m.type==='presence').at(-1)?.presence===null);
    const record=await firstLaunch.evaluate(()=>window.__stremioFixture.profiles.find(p=>p.profileId===1).history[0].progress);
    assert.deepEqual(record,{mediaType:'movie',itemId:'tt123',videoId:'tt123',title:'First original film',episodeTitle:null,positionMs:45000,durationMs:120000,completed:false});
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.profiles.find(p=>p.profileId===1).refract.pending),0);
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Watch history',exact:true}).click();
    const history=watch.locator('[data-ui="watch-history"]');
    await history.getByRole('button',{name:'Load history',exact:true}).click();
    await history.getByText('00:00:45 / 00:02:00',{exact:true}).waitFor();
    await history.getByRole('button',{name:'Open saved title',exact:true}).click();
    await item.getByText('Saved playback position: 00:00:45',{exact:true}).waitFor();
    await item.getByRole('button',{name:'Streams · Original addon fixture',exact:true}).click();
    await options.getByRole('button',{name:'Resume',exact:true}).click();
    await player.locator('[data-ui="player-controls"]:not([data-loading])').waitFor();
    await player.hover();
    await player.hover();
    await player.locator('[data-ui="player-time"]').filter({hasText:'0:45 / 2:00'}).waitFor();
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request'&&a.action.kind==='prepare-media').at(-1).action.startMs),45000);
    await firstLaunch.evaluate(()=>{window.__stremioFixture.emitPlayer({type:'player-state',positionMs:119000,durationMs:120000});window.__stremioFixture.emitPlayer({type:'player-ended',reason:'eof',error:null});});
    await player.getByText('Playback ended.',{exact:true}).waitFor();
    await player.hover();
    await player.getByRole('button',{name:'Back',exact:true}).click();
    await player.waitFor({state:'detached'});
    await history.getByRole('button',{name:'Load history',exact:true}).click();
    await history.getByText('Completed',{exact:true}).waitFor();
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.profiles.find(p=>p.profileId===1).refract.pending),1);
    const viewingIds=await firstLaunch.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request'&&a.action.kind==='watch-record').map(a=>a.action.viewingId));
    assert.ok(viewingIds.every(id=>/^[0-9a-f-]{36}$/.test(id)));
    assert.equal(new Set(viewingIds).size,2);
    await watch.getByRole('button',{name:'Switch profile',exact:true}).click();
    await watch.locator('[data-ui="watch-profile-picker"]').getByRole('button',{name:'Cinema 0 addons',exact:true}).click();
    await watch.locator('[data-ui="watch-hub-picker"] [data-watch-destination="standalone"]').click();
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Anime Hub',exact:true}).click();
    await animePanel.getByText('No imported titles yet.',{exact:true}).waitFor();
    assert.equal(await animeFilm.count(),0);
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Watch history',exact:true}).click();
    await history.getByRole('button',{name:'Load history',exact:true}).click();
    await history.getByText('No Watch history for this profile.',{exact:true}).waitFor();
    await watchSetting('MDBList');
    await mdb.getByLabel('MDBList API key',{exact:true}).waitFor();
    assert.equal(await mdb.getByText('Connected to MDBList for this profile.',{exact:true}).count(),0);
    await watchSetting('Refract');
    await refractConnect.waitFor();
    assert.equal(await refract.getByText('Fixture member',{exact:true}).count(),0);
    assert.equal(await firstLaunch.evaluate(()=>{
      const f=window.__stremioFixture;
      f.emitPlayer({type:'refract-status-changed',profileId:1,data:structuredClone(f.profiles.find(p=>p.profileId===1).refract),error:null});
      return f.tickRefract();
    }),false);
    assert.equal(await refract.getByText('Fixture member',{exact:true}).count(),0);
    await watch.getByRole('button',{name:'Switch profile',exact:true}).click();
    await watch.locator('[data-ui="watch-profile-picker"]').getByRole('button',{name:'Default 1 addons',exact:true}).click();
    await watch.locator('[data-ui="watch-hub-picker"] [data-watch-destination="standalone"]').click();
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Anime Hub',exact:true}).click();
    await animeFilm.waitFor();await animeSeries.waitFor();
    assert.match(await animeFilm.innerText(),/Source selected/);
    await animeFilm.click();
    await animeSource.getByRole('button',{name:'Open saved anime source',exact:true}).click();
    await watch.locator('[data-ui="watch-item-details"]').getByRole('heading',{name:'First original film',exact:true}).waitFor();
    await watch.locator('[data-ui="watch-item-details"]').getByRole('button',{name:'Close title',exact:true}).click();
    await hubNav.getByRole('button',{name:'History',exact:true}).click();
    await anime.locator('[data-ui="anime-history"]').getByRole('button',{name:/First original film/}).waitFor();
    await hubNav.getByRole('button',{name:'My List',exact:true}).click();
    await animeSeries.locator('xpath=..').getByRole('button',{name:'Remove',exact:true}).click();
    await animePanel.getByRole('button',{name:'Confirm removal',exact:true}).click();
    await animeSeries.waitFor({state:'detached'});await animeFilm.waitFor();
    await animeFilm.click();
    await animeSource.getByRole('button',{name:'Forget anime source',exact:true}).click();
    await animeSource.getByRole('button',{name:'Confirm forget source',exact:true}).click();
    await animeSource.locator('[data-ui="mal-anime-saved-match"]').waitFor({state:'detached'});
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.profiles.find(p=>p.profileId===1).malMatches.length),0);
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.profiles.find(p=>p.profileId===1).history.length),1);
    console.log('PASS: Anime Hub illustration navigation, real catalogue discovery, MAL movie/series filters, reviewed source persistence, history, profile isolation and removal.');
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Watch history',exact:true}).click();
    await history.getByRole('button',{name:'Load history',exact:true}).click();
    await history.getByText('Completed',{exact:true}).waitFor();
    await history.getByRole('button',{name:'Remove from history',exact:true}).click();
    await history.getByRole('button',{name:'Confirm removal',exact:true}).click();
    await history.getByText('No Watch history for this profile.',{exact:true}).waitFor();
    await watchSetting('Refract');
    await refract.getByText('Fixture member',{exact:true}).waitFor();
    await refract.getByText('Pending: 1',{exact:true}).waitFor();
    // Native delivery attempts and retries update the settings without
    // a user clicking Sync or a status request invalidating a media grant.
    const syncRequests=await firstLaunch.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request'&&a.action.kind==='refract-sync').length);
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.tickRefract()),true);
    await refract.getByText('Refract could not be reached. Local Watch history is preserved.',{exact:true}).waitFor();
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.tickRefract()),false);
    await refract.getByRole('button',{name:'Sync next watch',exact:true}).click();
    await refract.getByText('Pending: 1',{exact:true}).waitFor();
    assert.equal(await firstLaunch.evaluate(()=>{
      const f=window.__stremioFixture;f.profiles.find(p=>p.profileId===1).refract.retryAt=0;return f.tickRefract();
    }),true);
    await refract.getByText('Sent: 1',{exact:true}).waitFor();
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request'&&a.action.kind==='refract-sync').length),syncRequests+1);
    await refract.getByText('Pending: 0',{exact:true}).waitFor();
    await refract.getByRole('button',{name:'Disconnect',exact:true}).click();
    await refract.getByRole('button',{name:'Confirm disconnect',exact:true}).click();
    await refractConnect.waitFor();
    console.log('Refract personal-key connection, profile isolation, watchlist protection, native status notifications and automatic retry fixture passed');
    await watchSetting('MDBList');
    await mdb.getByText('Connected to MDBList for this profile.',{exact:true}).waitFor();
    await mdb.getByRole('button',{name:'Disconnect',exact:true}).click();
    await mdb.getByLabel('MDBList API key',{exact:true}).waitFor();
    await firstLaunch.setViewportSize({width:390,height:844});
    await watchSetting('Your addons');
    await watch.getByRole('heading',{name:'Your addon stack.',exact:true}).waitFor();
    await watch.evaluate(node=>node.scrollTo({top:0,left:0,behavior:'instant'}));
    const narrow=await watch.evaluate(node=>({scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,nav:node.querySelector('.tsugi-watch-nav').getBoundingClientRect().width,content:node.querySelector('.tsugi-watch-content').getBoundingClientRect().width}));
    assert.ok(narrow.scrollWidth<=narrow.clientWidth+2,`Watch workspace overflow: ${JSON.stringify(narrow)}`);
    const settingsNav=watch.locator('[data-ui="watch-settings-navigation"]');
    const narrowTabs=await settingsNav.evaluate(node=>({height:node.clientHeight,width:node.clientWidth,scroll:node.scrollWidth}));
    assert.ok(narrowTabs.height<=80&&narrowTabs.scroll>narrowTabs.width,'narrow settings navigation is one scrollable row rather than a viewport-tall stack');
    const finalTab=settingsNav.getByRole('button',{name:'Profile settings',exact:true});
    await finalTab.focus();
    assert.ok(await settingsNav.evaluate(node=>Math.abs(node.scrollLeft)>0),'keyboard focus brings later settings tabs into view');
    await settingsNav.getByRole('button',{name:'Your addons',exact:true}).focus();
    // The shared rail hides the legacy outer header; measure the visible workspace instead.
    const visibleHeader=watch.locator('[data-ui="stremio-addon-settings"] > header');
    await visibleHeader.waitFor({state:'visible'});
    assert.equal(await visibleHeader.locator('.tsugi-watch-header-brand').isVisible(),false,'shared rail is the only visible Watch brand');
    assert.equal(await watch.locator(':scope > div > header').isVisible(),false,'Shared rail replaces the legacy Watch header');
    const controls=await firstLaunch.locator('[data-ui="window-controls"]').boundingBox();
    const header=await visibleHeader.boundingBox();
    assert.ok(controls&&header&&controls.height>=32&&header.height>0&&header.y>=controls.y+controls.height+8,`Watch header must clear the native window controls: ${JSON.stringify({controls,header})}`);
    if(screenshotDir)await firstLaunch.screenshot({path:join(screenshotDir,'watch-workspace-narrow.png'),animations:'disabled'});
    console.log('Watch history, direct Watch Rich Presence, MDBList connection/pagination/isolation and narrow layout passed');
    await watch.getByRole('button',{name:'All media',exact:true}).click();
    await firstLaunch.locator('[data-page="desktop-landing"]').waitFor();
    await firstLaunch.setViewportSize({width:1600,height:900});
    await firstLaunch.getByRole('button',{name:'Movies & TV',exact:true}).first().click();
    const remembered=watch.locator('[data-ui="watch-profile-badge"]');
    await remembered.waitFor();
    assert.equal(await watch.locator('[data-ui="watch-profile-picker"]').count(),0,'returning from another category retains the confirmed profile');
    assert.equal(await remembered.innerText().then(s=>s.trim().endsWith('Default')),true);
    await remembered.click();
    await watch.locator('[data-ui="stremio-profile-management"]').waitFor();
    assert.equal(await watch.getByLabel('Active addon profile',{exact:true}).inputValue(),'1');
    const rename=watch.locator('[data-ui="watch-rename-profile"]');
    const nameField=rename.getByRole('textbox',{name:'Profile name',exact:true});
    assert.equal(await nameField.inputValue(),'Default','original profile is editable and prefilled');
    const beforeRename=await firstLaunch.evaluate(()=>{const f=window.__stremioFixture,p=f.profiles.find(p=>p.profileId===1);return {start:f.calls.length,active:f.active,sources:p.sources.map(s=>s.sourceId),history:p.history.length};});
    await nameField.fill('Cinema home');
    await nameField.press('Enter');
    await remembered.getByText('Cinema home',{exact:true}).waitFor();
    assert.equal(await watch.getByLabel('Active addon profile',{exact:true}).inputValue(),'1');
    assert.equal(await watch.locator('[data-ui="watch-profile-picker"]').count(),0);
    const afterRename=await firstLaunch.evaluate(start=>{const f=window.__stremioFixture,p=f.profiles.find(p=>p.profileId===1);return {calls:f.calls.slice(start),active:f.active,sources:p.sources.map(s=>s.sourceId),history:p.history.length};},beforeRename.start);
    assert.deepEqual(afterRename.calls.filter(a=>a.kind.startsWith('profile-')&&a.kind!=='profile-request'),[{kind:'profile-rename',profileId:1,name:'Cinema home'}]);
    assert.equal(afterRename.active,beforeRename.active);
    assert.deepEqual(afterRename.sources,beforeRename.sources);
    assert.equal(afterRename.history,beforeRename.history);
    assert.equal(afterRename.calls.some(a=>a.kind==='profile-request'&&a.action.kind==='watch-setup-status'),false,'rename must not restart connection setup');
    if(screenshotDir)await firstLaunch.screenshot({path:join(screenshotDir,'watch-default-profile-renamed.png'),animations:'disabled'});
    await watch.getByRole('button',{name:'All media',exact:true}).click();
    await firstLaunch.locator('[data-page="desktop-landing"]').waitFor();
    await firstLaunch.getByRole('button',{name:'Movies & TV',exact:true}).first().click();
    await remembered.getByText('Cinema home',{exact:true}).waitFor();
    assert.equal(await watch.locator('[data-ui="watch-profile-picker"]').count(),0);
    console.log('PASS: Default renamed in place; exact profile ID, sources, history and navigation persist without setup restart.');
    console.log('First launch profile and account import entry and optional skip passed');
  }finally{await firstLaunch.close();}
}
