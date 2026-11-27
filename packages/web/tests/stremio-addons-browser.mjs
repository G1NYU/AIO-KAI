import assert from 'node:assert/strict';

function installStremioFixture(){
  if(window.top!==window)return;
  localStorage.setItem('tsugi-onboarding-complete-v1','true');
  localStorage.setItem('tsugi-startup-area-v1',JSON.stringify('welcome'));
  const host=window.aiostreamsApp;
  host.stremioAddons=true;
  const send=host.send.bind(host),subscribe=host.subscribe.bind(host),listeners=new Set();
  const manifest={id:'org.fixture',name:'Original addon fixture',version:'1.0.0',resources:['catalog','stream'],configurable:false,configurationRequired:false,p2p:false,adult:false,catalogs:[{id:'search',mediaType:'movie',name:'Original films',extras:[{name:'search',required:true,options:[],optionsLimit:null},{name:'skip',required:false,options:[],optionsLimit:null}]}]};
  const f=window.__stremioFixture={calls:[],profiles:[{profileId:1,name:'Default',sources:[]}],active:1,pending:null,import:null,sequence:1};
  host.subscribe=listener=>{listeners.add(listener);const remove=subscribe(listener);return()=>{listeners.delete(listener);remove();};};
  host.send=message=>{
    if(message.type!=='stremio-request')return send(message);
    const raw=message.action;f.calls.push(structuredClone(raw));
    const emit=(data,error=null)=>queueMicrotask(()=>{for(const l of listeners)l({type:'stremio-result',request:message.request,data,error});});
    const profileState=()=>({activeProfileId:f.active,profiles:f.profiles.map(p=>({profileId:p.profileId,name:p.name,sourceCount:p.sources.length}))});
    switch(raw.kind){
      case 'profile-list':return emit(profileState());
      case 'profile-create':f.profiles.push({profileId:++f.sequence,name:raw.name,sources:[]});return emit(profileState());
      case 'profile-rename':f.profiles.find(p=>p.profileId===raw.profileId).name=raw.name;return emit(profileState());
      case 'profile-switch':f.active=raw.profileId;f.pending=null;f.import=null;return emit(profileState());
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

export async function verifyStremioAddonsBrowser({browser,origin,installDesktopFixture}){
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
    const active=profiles.getByLabel('Active addon profile',{exact:true});
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
    await profiles.getByLabel('Profile to delete',{exact:true}).selectOption({label:'Renamed'});
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
      await account.getByLabel('Import provider',{exact:true}).selectOption(provider);
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
    const remote=account.getByLabel('Nuvio profile',{exact:true});
    await remote.waitFor();
    assert.equal(await remote.locator('option[value="1"]').isDisabled(),true);
    assert.equal(await remote.locator('option[value="2"]').isDisabled(),true);
    await remote.selectOption('3');
    await account.getByRole('button',{name:'Read selected profile',exact:true}).click();
    await reviewAccount();
    await account.getByRole('button',{name:'Import reviewed addons',exact:true}).click();
    const imported=panel.locator('[data-stremio-source-id]').filter({hasText:'Nuvio audio fixture'});
    await imported.waitFor();
    assert.ok((await imported.innerText()).includes('Disabled'));
    const providerCalls=(await calls()).filter(a=>a.kind.startsWith('import-')).map(a=>a.kind);
    assert.deepEqual(providerCalls,['import-connect','import-review','import-apply','import-connect','import-nuvio-profile','import-review','import-apply']);
    console.log('Stremio/Nuvio account import, profile isolation, explicit review and local-only apply passed');
  }finally{await page.close();}
  const firstLaunch=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    await firstLaunch.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    await firstLaunch.addInitScript({content:'('+installDesktopFixture.toString()+')();('+installStremioFixture.toString()+')();localStorage.removeItem("tsugi-onboarding-complete-v1");'});
    await firstLaunch.goto(origin,{waitUntil:'domcontentloaded'});
    const setup=firstLaunch.getByRole('dialog',{name:'Set up your addon profile',exact:true});
    const picker=setup.locator('[data-ui="watch-profile-picker"]');
    await picker.getByRole('button',{name:'Default 0 addons',exact:true}).waitFor();
    assert.equal(await setup.locator('[data-ui="stremio-addon-settings"]').count(),0);
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
    await picker.getByRole('button',{name:'Default 0 addons',exact:true}).waitFor();
    await setup.getByRole('button',{name:'Skip for now',exact:true}).click();
    await setup.waitFor({state:'hidden'});
    console.log('First launch profile and account import entry and optional skip passed');
  }finally{await firstLaunch.close();}
}
