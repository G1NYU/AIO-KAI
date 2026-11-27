import assert from 'node:assert/strict';

function installStremioFixture(){
  if(window.top!==window)return;
  localStorage.setItem('tsugi-onboarding-complete-v1','true');
  localStorage.setItem('tsugi-startup-area-v1',JSON.stringify('welcome'));
  const host=window.aiostreamsApp;
  host.stremioAddons=true;
  const send=host.send.bind(host),subscribe=host.subscribe.bind(host),listeners=new Set();
  const manifest={id:'org.fixture',name:'Original addon fixture',version:'1.0.0',resources:['catalog','stream'],configurable:false,configurationRequired:false,p2p:false,adult:false,catalogs:[{id:'search',mediaType:'movie',name:'Original films',extras:[{name:'search',required:true,options:[],optionsLimit:null},{name:'skip',required:false,options:[],optionsLimit:null}]}]};
  const f=window.__stremioFixture={calls:[],sources:[],pending:null,sequence:0};
  host.subscribe=listener=>{listeners.add(listener);const remove=subscribe(listener);return()=>{listeners.delete(listener);remove();};};
  host.send=message=>{
    if(message.type!=='stremio-request')return send(message);
    const a=message.action;f.calls.push(structuredClone(a));
    const emit=(data,error=null)=>queueMicrotask(()=>{for(const l of listeners)l({type:'stremio-result',request:message.request,data,error});});
    switch(a.kind){
      case 'list':return emit({sources:f.sources});
      case 'review':
        assertFixtureUrl(a.url);f.pending=++f.sequence;return emit({reviewId:f.pending,manifest});
      case 'cancel-review':if(f.pending===a.reviewId)f.pending=null;return emit({cancelled:true});
      case 'install':
        if(f.pending!==a.reviewId)return emit(null,'expired-review');
        f.sources.push({sourceId:f.pending,enabled:true,manifest});f.pending=null;return emit({sources:f.sources});
      case 'set-enabled':f.sources=f.sources.map(s=>s.sourceId===a.sourceId?{...s,enabled:a.enabled}:s);return emit({sources:f.sources});
      case 'remove':f.sources=f.sources.filter(s=>s.sourceId!==a.sourceId);return emit({sources:f.sources});
      case 'catalog':{
        if(!f.sources.some(s=>s.sourceId===a.sourceId&&s.enabled)||a.catalogId!=='search'||a.mediaType!=='movie'||a.extras.search!=='original')return emit(null,'invalid-extras');
        const skip=Number(a.extras.skip??0);
        return emit({sourceId:a.sourceId,mediaType:'movie',catalogId:'search',items:[{id:skip===0?'tt123':'tt456',name:skip===0?'First original film':'Second original film',mediaType:'movie'}],sourceCount:1,nextSkip:skip+1});
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
    await panel.getByText('No addons installed for this session.').waitFor();
    const calls=()=>page.evaluate(()=>window.__stremioFixture.calls);
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
    await inspect();await review.getByRole('button',{name:'Install for this session'}).click();
    const row=panel.locator('[data-stremio-source-id="2"]');
    await row.waitFor();
    assert.deepEqual((await calls()).find(a=>a.kind==='install'),{kind:'install',reviewId:2});
    await row.getByRole('button',{name:'Browse catalogues'}).click();
    const catalog=panel.locator('[data-ui="stremio-catalog"]');
    assert.equal(await catalog.getByRole('button',{name:'Load catalogue'}).isEnabled(),false);
    await catalog.getByLabel('Search',{exact:true}).fill('original');
    await catalog.getByRole('button',{name:'Load catalogue'}).click();
    await catalog.getByText('First original film',{exact:true}).waitFor();
    assert.deepEqual((await calls()).find(a=>a.kind==='catalog'),{kind:'catalog',sourceId:2,mediaType:'movie',catalogId:'search',extras:{search:'original'}});
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
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'App settings',exact:true}).first().click();await row.waitFor();
    await row.getByRole('button',{name:'Remove',exact:true}).click();
    await panel.getByText('No addons installed for this session.').waitFor();
    console.log('Stremio addon review, scoped catalogue, pagination and session lifecycle passed');
  }finally{await page.close();}
}
