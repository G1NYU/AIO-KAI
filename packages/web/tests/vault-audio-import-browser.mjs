// Real browser storage and playback against authored completed jobs.
import assert from 'node:assert/strict';
function wav(freq){
  const n=8000*4,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(6000*Math.sin(i*freq*2*Math.PI/8000)),44+2*i);return b;
}
function installAudioFixture(bytes){
  if(window.top!==window)return;
  localStorage.setItem('tsugi-onboarding-complete-v1','true');
  localStorage.setItem('tsugi-startup-area-v1',JSON.stringify('vault'));
  localStorage.setItem('tsugi.vault.intro','seen');
  const fixture=window.__vaultAudioFixture={mutations:[],abortNextWrite:false};
  window.__readerFixture.installed=true;
  window.__readerFixture.vaultJobs=['one','duplicate','invalid','missing','interrupted'].map(id=>({id:'vault-audio-'+id,vault_title:'Fixture '+id+'.wav',bytes,total:bytes,state:'done',error:null}));
  const host=window.aiostreamsApp,send=host.send.bind(host);
  host.send=message=>{if(['download-add','download-control','download-remove'].includes(message.type))fixture.mutations.push(message);return send(message);};
  const add=IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add=function(...args){const result=add.apply(this,args);if(this.name==='files'&&this.transaction.db.name==='tsugi-vault-audio-v1'&&fixture.abortNextWrite){fixture.abortNextWrite=false;this.transaction.abort();}return result;};
}
async function saved(page){
  return page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('tsugi-vault-audio-v1',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    try{const tx=db.transaction(['tracks','files']);const read=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});const [tracks,files]=await Promise.all([read(tx.objectStore('tracks').getAll()),read(tx.objectStore('files').count())]);return {tracks,files};}finally{db.close();}
  });
}
export async function verifyVaultAudioImportsBrowser({browser,origin,installDesktopFixture}){
  const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'en-GB',reducedMotion:'reduce'});
  const one=wav(220),other=wav(330),third=wav(440),errors=[];
  let missing=true;
  page.setDefaultTimeout(20_000);page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.addInitScript(installDesktopFixture);
    await page.addInitScript(installAudioFixture,one.length);
    await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    await page.route('**/__tsugi_vault/file/*',route=>{
      assert.equal(route.request().headers()['x-tsugi-vault-import'],'1');
      const id=new URL(route.request().url()).pathname.split('/').at(-1);
      if(id==='vault-audio-missing'&&missing)return route.fulfill({status:404,body:'Fixture unavailable'});
      return route.fulfill({contentType:'audio/wav',body:id==='vault-audio-invalid'?Buffer.alloc(one.length):id==='vault-audio-missing'?other:id==='vault-audio-interrupted'?third:one});
    });
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    const row=id=>page.locator('[data-vault-job-id="vault-audio-'+id+'"]');
    const review=page.getByRole('dialog',{name:'Review audio import',exact:true});
    const start=async(id,retry=false)=>{await row(id).getByRole('button',{name:retry?'Retry audio import':'Import into Music',exact:true}).click();await review.waitFor();};
    const confirm=()=>review.getByRole('button',{name:'Confirm import',exact:true}).click();
    const state=(id,value)=>row(id).locator('[data-vault-audio-import-state="'+value+'"]').waitFor();
    await start('one');assert.equal((await saved(page)).files,0);
    await review.getByRole('button',{name:'Cancel import',exact:true}).click();
    assert.equal((await saved(page)).files,0);
    await start('one');await confirm();await state('one','imported');
    let library=await saved(page);assert.equal(library.files,1);assert.match(library.tracks[0].id,/^vault-audio:[a-f0-9]{64}$/);
    await start('duplicate');await review.getByRole('region',{name:'Identical audio already saved'}).waitFor();
    await review.getByRole('button',{name:'Reuse saved copy',exact:true}).click();await state('duplicate','existing');
    library=await saved(page);assert.equal(library.files,1);assert.deepEqual(library.tracks[0].jobs,['vault-audio-one','vault-audio-duplicate']);
    await row('invalid').getByRole('button',{name:'Import into Music',exact:true}).click();await state('invalid','failed');
    await row('missing').getByRole('button',{name:'Import into Music',exact:true}).click();await state('missing','failed');
    missing=false;await start('missing',true);await confirm();await state('missing','imported');
    await start('interrupted');await page.evaluate(()=>{window.__vaultAudioFixture.abortNextWrite=true;});await confirm();await state('interrupted','failed');
    library=await saved(page);assert.deepEqual([library.tracks.length,library.files],[2,2],'aborted transaction leaves no orphan');
    await start('interrupted',true);await confirm();await state('interrupted','imported');
    assert.equal((await saved(page)).files,3);
    assert.deepEqual(await page.evaluate(()=>window.__vaultAudioFixture.mutations),[]);
    await page.reload({waitUntil:'domcontentloaded'});await state('one','existing');await state('duplicate','existing');
    await row('one').getByRole('button',{name:'Open saved Music',exact:true}).click();
    const music=page.locator('[data-page="music"]');
    await music.getByRole('button',{name:/Fixture one/}).first().click();
    await page.waitForFunction(()=>{const audio=document.querySelector('[data-ui="tsugi-audio-engine"]');return audio&&!audio.paused&&audio.currentTime>0;});
    assert.equal(await music.getByRole('button',{name:'Remove saved audio copy',exact:true}).count(),3);
    await page.reload({waitUntil:'domcontentloaded'});
    await row('one').getByRole('button',{name:'Open saved Music',exact:true}).click();
    // Select the remove action by its associated track rather than list order.
    const remove=music.getByRole('button',{name:'Remove saved audio copy',exact:true});
    await remove.first().waitFor();
    await music.getByRole('button',{name:/Fixture one/}).first().evaluate(el=>el.parentElement.querySelector('button[aria-label="Remove saved audio copy"]')?.click());
    const removal=page.getByRole('dialog',{name:'Remove saved audio copy',exact:true});
    await removal.waitFor();await removal.getByRole('button',{name:'Remove copy',exact:true}).click();await removal.waitFor({state:'hidden'});
    library=await saved(page);assert.equal(library.files,2);assert.equal(library.tracks.some(x=>x.jobs.includes('vault-audio-one')),false);
    await music.locator('[data-ui="tsugi-desktop-rail"]').getByRole('button',{name:'Vault',exact:true}).click();
    await row('one').getByRole('button',{name:'Import into Music',exact:true}).waitFor();
    await row('duplicate').getByRole('button',{name:'Import into Music',exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.__vaultAudioFixture.mutations),[]);
    assert.deepEqual(errors,[]);
    console.log('Vault saved audio: review, deduplication, retry, rollback, persistence, playback and copy removal passed.');
  }finally{await page.close();}
}
