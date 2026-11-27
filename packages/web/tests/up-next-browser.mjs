import assert from 'node:assert/strict';
import { pdfFixture } from './ebook-fixtures.mjs';

function fixture() {
  if (window.top !== window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1','true');
  localStorage.setItem('tsugi-startup-area-v1', JSON.stringify('welcome'));
  window.__readerFixture.titleSettingsFixture = true;
  localStorage.setItem('tsugi-reader-preferences', JSON.stringify({mode:'single',width:65,gap:true,rtl:false,fit:'height',background:'graphite',focus:false,autoNext:false,wheelZoom:true,resume:true}));
  const sourceId='eeaa2cb3-5735-43ad-bff6-f1f9f23acdb9';
  localStorage.setItem('aiostreams-desktop-music-remember-v1','true');
  localStorage.setItem('aiostreams-desktop-music-sources-v1',JSON.stringify([{id:sourceId,kind:'youtube-music',url:'https://music.youtube.com/'}]));
  localStorage.setItem('tsugi-recent-music-v1',JSON.stringify([
    {sourceId,playedAt:1760000000000,track:{id:'abcdefghijk',title:'Resume music fixture',artist:'Original artist'}},
    {sourceId:'missing-source',track:{id:'abcdefghijk',title:'Disconnected music fixture',artist:'Original artist'}},
  ]));
}
export async function verifyUpNextBrowser({browser,origin,installDesktopFixture}) {
  const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'en-GB',reducedMotion:'reduce'});
  page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.addInitScript({content:'('+installDesktopFixture.toString()+')();('+fixture.toString()+')();'});
    await page.route('**/*',route=>(route.request().url().startsWith(origin+'/')||route.request().url().startsWith(origin.replace('127.0.0.1','localhost')+'/tsugi-books/'))?route.continue():route.abort());
    await page.route('**/__tsugi_read/page/*',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAHUlEQVR4nGOsqF3FQApgIkn1qIZRDaMaRjWQrAEA4jkBz8UryC4AAAAASUVORK5CYII=','base64')}));
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.evaluate(async bytes=>{
      const db=await new Promise((resolve,reject)=>{
        const request=indexedDB.open('tsugi-local-books-v1',1);
        request.onupgradeneeded=()=>{request.result.createObjectStore('books',{keyPath:'id'});request.result.createObjectStore('files');};
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      });
      try {
        const id='a'.repeat(32), tx=db.transaction(['books','files'],'readwrite');
        const completed=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);});
        tx.objectStore('books').put({id,name:'Resume PDF.pdf',title:'Resume PDF fixture',format:'pdf',size:bytes.length,addedAt:1760000000000,position:1,fraction:.5,lastReadAt:1760000000001});
        tx.objectStore('files').put(new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),id);
        await completed;
      } finally {db.close();}
    },Array.from(pdfFixture()));
    const landing=page.locator('[data-page="desktop-landing"]');
    const dialog=page.getByRole('dialog',{name:'Up next',exact:true});
    const open=()=>landing.locator('.tsugi-world-toolbar').getByRole('button',{name:'Up next',exact:true}).click();
    const row=title=>dialog.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})});
    assert.equal(await page.evaluate(()=>window.__readerFixture.requests.filter(item=>item.kind==='history').length),0,'no history request before opening Up next');
    await open();
    await row('Tsugi Original Fixture').getByText('Page 3',{exact:true}).waitFor();
    await row('Resume PDF fixture').waitFor();
    await row('Resume music fixture').waitFor();
    assert.equal(await row('Disconnected music fixture').getByRole('button',{name:'Play again',exact:true}).isEnabled(),false);
    await row('Resume PDF fixture').getByRole('button',{name:'Hide Resume PDF fixture',exact:true}).click();
    assert.equal(await row('Resume PDF fixture').count(),0);
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    await open();
    await row('Resume music fixture').waitFor();
    assert.equal(await row('Resume PDF fixture').count(),0);
    await dialog.getByRole('button',{name:'Show hidden',exact:true}).click();
    await row('Resume PDF fixture').waitFor();
    await row('Resume music fixture').getByRole('button',{name:'Play again',exact:true}).click();
    await page.waitForFunction(()=>window.__readerFixture.nativeMessages.some(message=>message.type==='music-audio-load'&&message.url.includes('abcdefghijk')));
    const loadCount=await page.evaluate(()=>window.__readerFixture.nativeMessages.filter(message=>message.type==='music-audio-load').length);
    const music=page.locator('[data-page="music"]');
    await music.getByRole('button',{name:'All media',exact:true}).click();
    await open();
    await row('Resume music fixture').getByRole('button',{name:'Open player',exact:true}).click();
    await page.locator('[data-page="music"]').waitFor();
    assert.equal(await page.evaluate(()=>window.__readerFixture.nativeMessages.filter(message=>message.type==='music-audio-load').length),loadCount,'the current player shortcut does not reload audio');
    // Reload the desktop and verify a reader-local exact chapter handoff.
    await page.reload({waitUntil:'domcontentloaded'});
    await open();
    await row('Tsugi Original Fixture').getByRole('button',{name:'Resume',exact:true}).click();
    await page.locator('.tsugi-chapter-reader').waitFor();
    assert.equal(await page.evaluate(()=>window.__readerFixture.activeChapter?.id),11);
    assert.equal(await page.evaluate(()=>window.__readerFixture.requests.some(item=>item.kind==='cached-manga'&&item.id===1)),true);
    // Opening a saved ebook uses its original local file and position.
    await page.reload({waitUntil:'domcontentloaded'});
    await open();
    await row('Resume PDF fixture').getByRole('button',{name:'Resume',exact:true}).click();
    await page.locator('[data-ui="tsugi-book-reader"]').waitFor();
    await page.locator('[data-ui="book-progress"]').getByText('50%',{exact:true}).waitFor({timeout:30000});
    assert.deepEqual(errors,[]);
    console.log('PASS: cross-media Up next is lazy, source-scoped, non-destructive and resumes exact music, manga and local book records.');
  } finally {await page.close();}
}
