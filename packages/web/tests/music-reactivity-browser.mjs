import assert from 'node:assert/strict';

function tone() {
  const rate=8000, frames=rate*90, wav=Buffer.alloc(44+frames*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*2,40);
  for(let i=0;i<frames;i++)wav.writeInt16LE(Math.round(11000*Math.sin(2*Math.PI*220*i/rate)),44+i*2);
  return wav;
}
function fixture() {
  if (window.top!==window) return;
  localStorage.setItem('tsugi-onboarding-complete-v1','true');
  localStorage.setItem('tsugi-startup-area-v1',JSON.stringify('music'));
  localStorage.setItem('tsugi-matrix-mode-v1',JSON.stringify('off'));
  const host=window.aiostreamsApp, listeners=new Set(), subscribe=host.subscribe.bind(host);
  host.subscribe=listener=>{
    listeners.add(listener);
    const remove=subscribe(listener);
    return ()=>{listeners.delete(listener);remove();};
  };
  window.__motionFixture={meter(level,request=window.__readerFixture.nativeRequest){
    for(const listener of listeners)listener({type:'music-audio-meter',request,level});
  }};
}
const gif=Buffer.from('R0lGODlhDAAMAIEAAHZcqAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAADAAMAAAIFgABCBxIsKDBgwgTKlzIsKHDhxARBgQAIfkEAQoAAQAsAAAAAAwADACBeMa8AAAAAAAAAAAACBYAAQgcSLCgwYMIEypcyLChw4cQEQYEADs=','base64');
export async function verifyMusicReactivityBrowser({browser,origin,installDesktopFixture}) {
  const page=await browser.newPage({viewport:{width:1440,height:900},locale:'en-GB',reducedMotion:'no-preference'});
  page.setDefaultTimeout(20_000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.addInitScript({content:'('+installDesktopFixture.toString()+')();('+fixture.toString()+')();'});
    await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    const music=page.locator('[data-page="music"]');
    const mini=music.getByRole('region',{name:'Music player',exact:true});
    const expanded=music.getByRole('dialog',{name:'Now playing',exact:true});
    const state=async(locator,expected)=>page.waitForFunction(({selector,expected})=>document.querySelector(selector)?.dataset.audioMotion===expected,{selector:locator,expected});
    const energy=selector=>page.evaluate(s=>Number(document.querySelector(s)?.style.getPropertyValue('--tsugi-audio-energy')),selector);
    const openSettings=async()=>{await expanded.getByRole('button',{name:'Player settings',exact:true}).click();return expanded.getByRole('dialog',{name:'Player settings',exact:true});};
    const closeSettings=async settings=>settings.getByRole('button',{name:'Close',exact:true}).click();
    const art=expanded.locator('[data-ui="listening-mascot"] img');

    await music.getByRole('navigation',{name:'Music sections'}).getByRole('button',{name:'Library',exact:true}).click();
    await music.getByRole('navigation',{name:'Music collection'}).getByRole('button',{name:/Local music/}).click();
    await music.locator('input[aria-label="Open local audio"]').setInputFiles({name:'Reactivity fixture.wav',mimeType:'audio/wav',buffer:tone()});
    await music.getByRole('button',{name:/Reactivity fixture/}).click();
    await mini.waitFor();
    await state('.oto-mini-player','reactive');
    assert.ok(await energy('.oto-mini-player')>.05,'real PCM moves the mini seek ribbon without expanding');
    assert.equal(await mini.locator('[data-ui="listening-mascot"]').count(),0);
    await mini.getByRole('button',{name:'Expand player',exact:true}).click();
    await state('.oto-player','reactive');
    let settings=await openSettings();
    assert.equal(await settings.getByRole('checkbox',{name:'Reactive seek bar'}).isChecked(),true);
    await settings.getByRole('combobox',{name:'Listening mascot'}).selectOption('builtin');
    await closeSettings(settings);
    await expanded.locator('[data-ui="listening-mascot"][data-mascot="builtin"]').waitFor();
    await expanded.getByRole('button',{name:'Pause',exact:true}).click();
    await state('.oto-player','still');
    assert.equal(await energy('.oto-player'),0);
    settings=await openSettings();
    const input=settings.locator('input[accept="image/png,image/webp,image/gif"]');
    await input.setInputFiles({name:'spirit.gif',mimeType:'image/gif',buffer:gif});
    await settings.getByRole('img',{name:'Saved mascot preview'}).waitFor();
    assert.equal(await settings.getByRole('combobox',{name:'Listening mascot'}).inputValue(),'custom');
    await input.setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('<svg/>')});
    await settings.getByRole('alert').filter({hasText:'Could not import the mascot'}).waitFor();
    assert.equal(await settings.getByRole('combobox',{name:'Listening mascot'}).inputValue(),'custom');
    await closeSettings(settings);
    await art.waitFor();
    await page.waitForFunction(()=>{const img=document.querySelector('.oto-player [data-motion-art]');return img?.complete&&img.naturalWidth===12&&img.getAttribute('src')===img.dataset.staticArt;});
    await expanded.getByRole('button',{name:'Play',exact:true}).click();
    await state('.oto-player','reactive');
    await page.waitForFunction(()=>{const img=document.querySelector('.oto-player [data-motion-art]');return img?.getAttribute('src')===img?.dataset.motionArt;});
    await page.emulateMedia({reducedMotion:'reduce'});
    await state('.oto-player','still');
    assert.equal(await art.getAttribute('src'),await art.getAttribute('data-static-art'));
    await page.emulateMedia({reducedMotion:'no-preference'});
    await state('.oto-player','reactive');
    await expanded.getByRole('button',{name:'Minimise player',exact:true}).click();
    await state('.oto-mini-player','reactive');
    await music.getByRole('button',{name:'Read',exact:true}).click();
    await state('.oto-mini-player','still');
    assert.equal(await page.evaluate(()=>document.querySelector('[data-ui="tsugi-audio-engine"]')?.paused),false);

    await page.reload({waitUntil:'domcontentloaded'});
    await music.getByRole('button',{name:'Music sources',exact:true}).click();
    await music.getByRole('button',{name:'Connect YouTube Music',exact:true}).click();
    await music.getByRole('navigation',{name:'Music sections'}).getByRole('button',{name:'Search',exact:true}).click();
    const search=music.getByRole('textbox',{name:'Search music',exact:true});
    await search.fill('native');await search.press('Enter');
    await music.locator('[data-ui="music-track-row"]').filter({hasText:'Native fixture track'}).click();
    await mini.getByRole('button',{name:'Expand player',exact:true}).click();
    await art.waitFor();
    await page.waitForFunction(()=>{const img=document.querySelector('.oto-player [data-motion-art]');return img?.complete&&img.naturalWidth===12;});
    await page.evaluate(()=>window.__motionFixture.meter(.65));
    await state('.oto-player','reactive');
    assert.ok(await energy('.oto-player')>.5);
    await state('.oto-player','still');
    await page.evaluate(()=>window.__motionFixture.meter(.9,'stale-request'));
    assert.equal(await energy('.oto-player'),0);
    settings=await openSettings();
    await settings.getByRole('button',{name:'Remove custom image'}).click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('tsugi-player-visuals-v1'))?.mascot==='off');
    await settings.getByRole('checkbox',{name:'Reactive seek bar'}).uncheck();
    await closeSettings(settings);
    await state('.oto-player','still');
    await page.evaluate(()=>window.__motionFixture.meter(.9));
    assert.equal(await expanded.locator('[data-ui="listening-mascot"]').count(),0);
    assert.equal(await energy('.oto-player'),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: measured mini and expanded seek motion, opt-in spirit, bounded local GIF import/poster/reload/removal, pause/reduced-motion/Read suppression and fresh native meter isolation.');
  } finally {await page.close();}
}
