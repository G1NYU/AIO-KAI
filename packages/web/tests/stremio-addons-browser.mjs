import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function installStremioFixture(){
  if(window.top!==window)return;
  localStorage.setItem('tsugi-onboarding-complete-v1','true');
  localStorage.setItem('tsugi-startup-area-v1',JSON.stringify('welcome'));
  const host=window.aiostreamsApp;
  host.stremioAddons=true;
  const send=host.send.bind(host),subscribe=host.subscribe.bind(host),listeners=new Set();
  const manifest={id:'org.fixture',name:'Original addon fixture',version:'1.0.0',resources:['catalog','stream','subtitles'],configurable:false,configurationRequired:false,p2p:false,adult:false,catalogs:[{id:'search',mediaType:'movie',name:'Original films',extras:[{name:'search',required:true,options:[],optionsLimit:null},{name:'skip',required:false,options:[],optionsLimit:null}]}]};
  const emptyRefract=()=>({connected:false,username:null,enabled:false,pending:0,sent:0,skipped:0,retryAt:0,lastError:null});
  const f=window.__stremioFixture={calls:[],profiles:[{profileId:1,name:'Default',sources:[],history:[],mdblistConnected:false,refract:emptyRefract()}],active:1,pending:null,import:null,sequence:1,mediaReview:null,mediaGrant:null,mediaCalls:[],presenceMessages:[],refractSyncAttempts:0};
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
  host.send=message=>{
    if(message.type==='presence'||message.type==='discord-configure')f.presenceMessages.push(structuredClone(message));
    if(message.type==='stremio-consume-grant'){
      const grant=f.mediaGrant;f.mediaGrant=null;f.mediaCalls.push({type:message.type,grantId:message.grantId});
      queueMicrotask(()=>{
        const result=grant?.id===message.grantId?{grantId:grant.id,accepted:true,subtitles:grant.subtitles}:null;
        for(const l of listeners)l({type:'stremio-result',request:message.request,data:result,error:result?null:'expired-review'});
        if(result&&!grant.subtitles)for(const l of listeners){l({type:'player-event',name:'loaded'});l({type:'player-state',paused:false,positionMs:grant.startMs,durationMs:120000});}
      });return;
    }
    if(message.type==='player-stop'||message.type==='player-set'||message.type==='player-seek')f.mediaCalls.push(structuredClone(message));
    if(message.type!=='stremio-request')return send(message);
    const raw=message.action;f.calls.push(structuredClone(raw));
    const emit=(data,error=null)=>queueMicrotask(()=>{for(const l of listeners)l({type:'stremio-result',request:message.request,data,error});});
    const profileState=()=>({activeProfileId:f.active,profiles:f.profiles.map(p=>({profileId:p.profileId,name:p.name,sourceCount:p.sources.length}))});
    switch(raw.kind){
      case 'profile-list':return emit(profileState());
      case 'profile-create':f.profiles.push({profileId:++f.sequence,name:raw.name,sources:[],history:[],mdblistConnected:false,refract:emptyRefract()});return emit(profileState());
      case 'profile-rename':f.profiles.find(p=>p.profileId===raw.profileId).name=raw.name;return emit(profileState());
      case 'profile-switch':f.active=raw.profileId;f.pending=null;f.import=null;f.mediaReview=null;f.mediaGrant=null;return emit(profileState());
      case 'profile-remove':{
        const target=f.profiles.find(p=>p.profileId===raw.profileId);
        if(!target||target.profileId===f.active||target.name!==raw.confirmedName)return emit(null,'profile-confirmation');
        f.profiles=f.profiles.filter(p=>p!==target);return emit(profileState());
      }
    }
    if(raw.kind!=='profile-request'||raw.profileId!==f.active)return emit(null,'profile-changed');
    const a=raw.action,profile=f.profiles.find(p=>p.profileId===f.active);
    const reply=data=>emit({...data,profileId:raw.profileId});
    switch(a.kind){
      case 'list':return reply({sources:profile.sources});
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
      case 'refract-disconnect':
        if(profile.refract.pending&&!a.discardPending)return emit(null,'refract-pending');
        profile.refract=emptyRefract();return reply(profile.refract);
      case 'refract-sync':
        return profile.refract.enabled?reply(profile.refract):emit(null,'refract-paused');
      case 'refract-watchlist':
        if(!profile.refract.connected)return emit(null,'refract-disconnected');
        if(a.mediaType!=='movie'||a.itemId!=='tt123')return emit(null,'refract-unmatched');
        return reply({result:a.add?'updated':'protected'});
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
          {profileIndex:3,name:'Independent',usesPrimaryAddons:false,locked:false}
        ]});
        return reply({importId:id,provider:'stremio',phase:'candidates',availableSlots:16-profile.sources.length,skipped:1,candidates:[
          {candidateId:1,name:'Account film addon',host:'films.example.invalid',enabled:true,alreadyInstalled:false},
          {candidateId:2,name:'Unavailable fixture',host:'offline.example.invalid',enabled:true,alreadyInstalled:false}
        ]});
      }
      case 'import-nuvio-profile':{
        if(f.import?.id!==a.importId||f.import.phase!=='profiles'||a.remoteProfile!==3)return emit(null,'locked-remote-profile');
        f.import.phase='candidates';
        return reply({importId:a.importId,provider:'nuvio',phase:'candidates',availableSlots:16-profile.sources.length,skipped:0,remoteProfile:3,effectiveProfile:3,candidates:[
          {candidateId:1,name:'Nuvio audio fixture',host:'nuvio-addon.example.invalid',enabled:false,alreadyInstalled:false}
        ]});
      }
      case 'import-review':{
        if(f.import?.id!==a.importId||f.import.phase!=='candidates'||!a.selected.includes(1))return emit(null,'import-selection');
        const nuvio=f.import.provider==='nuvio';f.import.phase='review';
        const ready={candidateId:1,name:nuvio?'Nuvio audio fixture':'Account film addon',host:nuvio?'nuvio-addon.example.invalid':'films.example.invalid',enabled:!nuvio,manifest:{...manifest,name:nuvio?'Nuvio audio fixture':'Account film addon'}};
        f.import.ready=[ready];
        return reply({importId:a.importId,provider:f.import.provider,phase:'review',ready:[ready],rejected:nuvio?[]:[{candidateId:2,name:'Unavailable fixture',reason:'network'}]});
      }
      case 'import-apply':{
        if(f.import?.id!==a.importId||f.import.phase!=='review')return emit(null,'expired-review');
        for(const ready of f.import.ready)profile.sources.push({sourceId:++f.sequence,enabled:ready.enabled,manifest:ready.manifest});
        f.import=null;return reply({sources:profile.sources});
      }
      case 'import-cancel':f.import=null;return reply({cancelled:true});
      case 'review':
        assertFixtureUrl(a.url);f.pending=++f.sequence;return reply({reviewId:f.pending,manifest});
      case 'cancel-review':if(f.pending===a.reviewId)f.pending=null;return reply({cancelled:true});
      case 'install':
        if(f.pending!==a.reviewId)return emit(null,'expired-review');
        profile.sources.push({sourceId:f.pending,enabled:true,manifest});f.pending=null;return reply({sources:profile.sources});
      case 'set-enabled':profile.sources=profile.sources.map(s=>s.sourceId===a.sourceId?{...s,enabled:a.enabled}:s);return reply({sources:profile.sources});
      case 'remove':profile.sources=profile.sources.filter(s=>s.sourceId!==a.sourceId);return reply({sources:profile.sources});
      case 'item-options':{
        if(!profile.sources.some(s=>s.sourceId===a.sourceId&&s.enabled)||a.videoId!=='tt123')return emit(null,'unsupported-resource');
        const id=++f.sequence;
        f.mediaReview={id,subtitles:a.subtitles};
        return reply({sourceId:a.sourceId,mediaType:a.mediaType,videoId:a.videoId,subtitles:a.subtitles,reviewId:id,options:a.subtitles?
          [{name:'English fixture',supported:true,reason:'direct-https',language:'eng'}]:
          [{name:'HD fixture',supported:true,reason:'direct-https',language:null},{name:'Unsupported fixture',supported:false,reason:'unsupported-transport',language:null}]});
      }
      case 'prepare-media':{
        const review=f.mediaReview;f.mediaReview=null;
        if(review?.id!==a.reviewId||a.optionIndex!==0)return emit(null,'expired-review');
        f.mediaGrant={id:++f.sequence,subtitles:review.subtitles,startMs:a.startMs};
        return reply({grantId:f.mediaGrant.id,subtitles:review.subtitles});
      }
      case 'catalog':{
        if(!profile.sources.some(s=>s.sourceId===a.sourceId&&s.enabled)||a.catalogId!=='search'||a.mediaType!=='movie'||a.extras.search!=='original')return emit(null,'invalid-extras');
        const skip=Number(a.extras.skip??0);
        return reply({sourceId:a.sourceId,mediaType:'movie',catalogId:'search',items:[{id:skip===0?'tt123':'tt456',name:skip===0?'First original film':'Second original film',mediaType:'movie'}],sourceCount:1,nextSkip:skip+1});
      }
      default:return emit(null,'request');
    }
  };
  function assertFixtureUrl(url){if(url!=='https://example.invalid/private-fixture/manifest.json?token=fixture')throw Error('unexpected fixture endpoint');}
}

export async function verifyStremioAddonsBrowser({browser,origin,installDesktopFixture,screenshotDir}){
  const page=await browser.newPage();
  try{
    await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    await page.addInitScript({content:'('+installDesktopFixture.toString()+')();('+installStremioFixture.toString()+')();'});
    await page.goto(origin);
    await page.getByRole('button',{name:'App settings',exact:true}).first().click();
    const dialog=page.getByRole('dialog',{name:'App settings',exact:true});
    const panel=dialog.locator('[data-ui="stremio-addon-settings"]');
    const review=panel.locator('[data-ui="stremio-review"]');
    const field=panel.getByLabel('Configured manifest URL');
    const button=panel.getByRole('button',{name:'Review addon',exact:true});
    await panel.getByText('No addons installed for this profile.').waitFor();
    const calls=()=>page.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request').map(a=>a.action));
    assert.equal((await calls()).filter(a=>a.kind!=='list').length,0);
    async function inspect(){
      await field.fill('https://example.invalid/private-fixture/manifest.json?token=fixture');
      assert.equal(await field.getAttribute('type'),'password');
      assert.equal(await button.isEnabled(),false);
      await panel.getByRole('checkbox').check();await button.click();await review.waitFor();
      assert.equal(await field.inputValue(),'');
      assert.equal((await panel.innerText()).includes('private-fixture'),false);
      assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('private-fixture')),false);
    }
    await inspect();assert.equal((await calls()).some(a=>a.kind==='install'),false);
    await review.getByRole('button',{name:'Cancel review'}).click();await review.waitFor({state:'detached'});
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
    await profileName.fill('Second');
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
    await page.getByRole('button',{name:'App settings',exact:true}).first().click();await row.waitFor();
    await row.getByRole('button',{name:'Remove',exact:true}).click();
    await panel.getByText('No addons installed for this profile.').waitFor();
    const account=panel.locator('[data-ui="stremio-account-import"]');
    async function signIn(provider){
      await account.getByRole('combobox',{name:'Import provider',exact:true}).selectOption(provider);
      await account.getByLabel('Account email',{exact:true}).fill('fixture@example.org');
      await account.getByLabel('Account password',{exact:true}).fill('synthetic-password');
      await account.getByRole('button',{name:'Connect and read addons',exact:true}).click();
    }
    async function reviewAccount(){
      const candidates=account.locator('[data-import-phase="candidates"]');
      await candidates.waitFor();
      assert.equal(await candidates.getByRole('button',{name:'Review selected addons',exact:true}).isEnabled(),false);
      await candidates.getByRole('button',{name:'Select available addons',exact:true}).click();
      await candidates.getByRole('checkbox',{name:'I trust the selected addon hosts and want Tsugi to fetch their manifests.',exact:true}).check();
      await candidates.getByRole('button',{name:'Review selected addons',exact:true}).click();
      await account.locator('[data-import-phase="review"]').waitFor();
    }
    await signIn('stremio');
    await account.locator('[data-import-phase="candidates"]').waitFor();
    assert.equal((await account.innerText()).includes('synthetic-password'),false);
    assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('synthetic-password')),false);
    assert.equal((await calls()).some(a=>a.kind==='import-review'||a.kind==='import-apply'),false);
    await reviewAccount();
    assert.equal((await calls()).some(a=>a.kind==='import-apply'),false);
    await account.getByText('Unavailable fixture · Manifest unavailable or unsupported',{exact:true}).waitFor();
    await account.getByRole('button',{name:'Import reviewed addons',exact:true}).click();
    await panel.locator('[data-stremio-source-id]').filter({hasText:'Account film addon'}).waitFor();
    await signIn('nuvio');
    const remote=account.getByRole('combobox',{name:'Nuvio profile',exact:true});
    await remote.waitFor();
    assert.equal(await remote.locator('option[value="1"]').evaluate(option=>option.disabled),true);
    assert.equal(await remote.locator('option[value="2"]').evaluate(option=>option.disabled),true);
    await remote.selectOption('3');
    await account.getByRole('button',{name:'Read selected profile',exact:true}).click();
    await reviewAccount();
    await account.getByRole('button',{name:'Import reviewed addons',exact:true}).click();
    const imported=panel.locator('[data-stremio-source-id]').filter({hasText:'Nuvio audio fixture'});
    await imported.waitFor();
    assert.ok((await imported.innerText()).includes('Disabled'));
    await imported.getByRole('button',{name:'Move up',exact:true}).click();
    await panel.locator('[data-stremio-source-id]').first().filter({hasText:'Nuvio audio fixture'}).waitFor();
    const accountFilm=panel.locator('[data-stremio-source-id]').filter({hasText:'Account film addon'});
    await accountFilm.getByRole('button',{name:'Move up',exact:true}).click();
    await panel.locator('[data-stremio-source-id]').first().filter({hasText:'Account film addon'}).waitFor();
    const providerCalls=(await calls()).filter(a=>a.kind.startsWith('import-')).map(a=>a.kind);
    assert.deepEqual(providerCalls,['import-connect','import-review','import-apply','import-connect','import-nuvio-profile','import-review','import-apply']);
    console.log('Stremio/Nuvio account import, profile isolation, explicit review and local-only apply passed');
  }finally{await page.close();}
  const firstLaunch=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    await firstLaunch.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    await firstLaunch.addInitScript({content:'('+installDesktopFixture.toString()+')();('+installStremioFixture.toString()+')();localStorage.removeItem("tsugi-onboarding-complete-v1");localStorage.setItem("tsugi-discord-presence-v1",JSON.stringify({enabled:true,applicationId:"123456789012345678",privateMode:false,media:{video:true,music:true,manga:true,books:true}}));'});
    await firstLaunch.goto(origin,{waitUntil:'domcontentloaded'});
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
    assert.ok(requests.every(a=>['profile-list','profile-create','profile-switch'].includes(a.kind)||(a.kind==='profile-request'&&a.action.kind==='list')));
    await setup.getByRole('button',{name:'Appearance',exact:true}).click();
    const intro=firstLaunch.getByRole('dialog',{name:'Make Tsugi yours',exact:true});
    await intro.getByRole('button',{name:'Set up addons',exact:true}).waitFor();
    await intro.getByRole('button',{name:'Skip for now',exact:true}).click();
    await intro.waitFor({state:'hidden'});
    assert.equal(await firstLaunch.evaluate(()=>JSON.parse(localStorage.getItem('tsugi-onboarding-complete-v1'))),true);
    await firstLaunch.getByRole('button',{name:'Movies & TV',exact:true}).first().click();
    const watch=firstLaunch.locator('[data-page="direct-watch"]');
    await watch.locator('[data-ui="watch-profile-picker"]').getByRole('button',{name:'Default 0 addons',exact:true}).click();
    await watch.getByRole('heading',{name:'Your addon stack.',exact:true}).waitFor();
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Add addon',exact:true}).click();
    await watch.getByLabel('Configured manifest URL').fill('https://example.invalid/private-fixture/manifest.json?token=fixture');
    await watch.getByRole('checkbox').check();
    await watch.getByRole('button',{name:'Review addon',exact:true}).click();
    await watch.getByRole('button',{name:'Install into profile',exact:true}).click();
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Refract',exact:true}).click();
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
    await refractKey.fill('rfk_other_account');
    await refract.getByRole('button',{name:'Verify replacement key',exact:true}).click();
    await refract.getByText('This key belongs to another account. Disconnect the current account before connecting a different one.',{exact:true}).waitFor();
    assert.equal(await track.isChecked(),true);
    if(screenshotDir)await firstLaunch.screenshot({path:join(screenshotDir,'watch-refract.png'),animations:'disabled'});
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'MDBList',exact:true}).click();
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
    await watchlist.getByText('Refract watchlist updated.',{exact:true}).waitFor();
    await watchlist.getByRole('button',{name:'Remove from Refract watchlist',exact:true}).click();
    await watchlist.getByText('Refract kept existing tracked library data unchanged.',{exact:true}).waitFor();
    assert.deepEqual(await firstLaunch.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request'&&a.action.kind==='refract-watchlist').map(a=>a.action)),[
      {kind:'refract-watchlist',mediaType:'movie',itemId:'tt123',add:true},
      {kind:'refract-watchlist',mediaType:'movie',itemId:'tt123',add:false}
    ]);
    if(screenshotDir)await firstLaunch.screenshot({path:join(screenshotDir,'watch-mdblist.png'),animations:'disabled'});
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Your addons',exact:true}).click();
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
    await player.getByRole('button',{name:'Pause',exact:true}).waitFor();
    await player.getByText('Addon subtitles',{exact:true}).click();
    await player.getByRole('button',{name:'Original addon fixture',exact:true}).click();
    await player.getByRole('button',{name:'English fixture eng',exact:true}).click();
    await player.getByText('Subtitle request accepted.',{exact:true}).waitFor();
    await firstLaunch.evaluate(()=>window.__stremioFixture.emitPlayer({type:'player-state',paused:false,positionMs:45000,durationMs:120000}));
    await player.getByText('00:00:45 / 00:02:00',{exact:true}).waitFor();
    await firstLaunch.waitForFunction(()=>window.__stremioFixture.presenceMessages.filter(m=>m.type==='presence').at(-1)?.presence?.position===45000);
    const presence=await firstLaunch.evaluate(()=>window.__stremioFixture.presenceMessages.filter(m=>m.type==='presence').at(-1).presence);
    assert.deepEqual(presence,{media:'video',title:'First original film',subtitle:null,imdb:'tt123',position:45000,duration:120000,paused:false,browsing:false});
    await player.getByRole('button',{name:'Back to Watch',exact:true}).click();
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
    await player.getByRole('button',{name:'Pause',exact:true}).waitFor();
    await player.getByText('00:00:45 / 00:02:00',{exact:true}).waitFor();
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request'&&a.action.kind==='prepare-media').at(-1).action.startMs),45000);
    await firstLaunch.evaluate(()=>window.__stremioFixture.emitPlayer({type:'player-ended',reason:'eof'}));
    await player.getByText('Playback ended.',{exact:true}).waitFor();
    await player.getByRole('button',{name:'Back to Watch',exact:true}).click();
    await player.waitFor({state:'detached'});
    await history.getByRole('button',{name:'Load history',exact:true}).click();
    await history.getByText('Completed',{exact:true}).waitFor();
    assert.equal(await firstLaunch.evaluate(()=>window.__stremioFixture.profiles.find(p=>p.profileId===1).refract.pending),1);
    const viewingIds=await firstLaunch.evaluate(()=>window.__stremioFixture.calls.filter(a=>a.kind==='profile-request'&&a.action.kind==='watch-record').map(a=>a.action.viewingId));
    assert.ok(viewingIds.every(id=>/^[0-9a-f-]{36}$/.test(id)));
    assert.equal(new Set(viewingIds).size,2);
    await watch.getByRole('button',{name:'Switch profile',exact:true}).click();
    await watch.locator('[data-ui="watch-profile-picker"]').getByRole('button',{name:'Cinema 0 addons',exact:true}).click();
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Watch history',exact:true}).click();
    await history.getByRole('button',{name:'Load history',exact:true}).click();
    await history.getByText('No Watch history for this profile.',{exact:true}).waitFor();
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'MDBList',exact:true}).click();
    await mdb.getByLabel('MDBList API key',{exact:true}).waitFor();
    assert.equal(await mdb.getByText('Connected to MDBList for this profile.',{exact:true}).count(),0);
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Refract',exact:true}).click();
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
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Watch history',exact:true}).click();
    await history.getByRole('button',{name:'Load history',exact:true}).click();
    await history.getByText('Completed',{exact:true}).waitFor();
    await history.getByRole('button',{name:'Remove from history',exact:true}).click();
    await history.getByRole('button',{name:'Confirm removal',exact:true}).click();
    await history.getByText('No Watch history for this profile.',{exact:true}).waitFor();
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Refract',exact:true}).click();
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
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'MDBList',exact:true}).click();
    await mdb.getByText('Connected to MDBList for this profile.',{exact:true}).waitFor();
    await mdb.getByRole('button',{name:'Disconnect',exact:true}).click();
    await mdb.getByLabel('MDBList API key',{exact:true}).waitFor();
    await firstLaunch.setViewportSize({width:390,height:844});
    await watch.locator('.tsugi-watch-nav').getByRole('button',{name:'Your addons',exact:true}).click();
    await watch.getByRole('heading',{name:'Your addon stack.',exact:true}).waitFor();
    const narrow=await watch.evaluate(node=>({scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,nav:node.querySelector('.tsugi-watch-nav').getBoundingClientRect().width,content:node.querySelector('.tsugi-watch-content').getBoundingClientRect().width}));
    assert.ok(narrow.scrollWidth<=narrow.clientWidth+2,`Watch workspace overflow: ${JSON.stringify(narrow)}`);
    if(screenshotDir)await firstLaunch.screenshot({path:join(screenshotDir,'watch-workspace-narrow.png'),animations:'disabled'});
    console.log('Watch history, direct Watch Rich Presence, MDBList connection/pagination/isolation and narrow layout passed');
    await watch.getByRole('button',{name:'Home',exact:true}).click();
    await firstLaunch.locator('[data-page="desktop-landing"]').waitFor();
    console.log('First launch profile and account import entry and optional skip passed');
  }finally{await firstLaunch.close();}
}
