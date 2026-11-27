// Real application UI with synthetic managed files. The native-file fixture is
// persisted across page reloads to model files surviving a WebView restart.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mihonFixture } from './mihon-fixture.mjs';

function installRecoveryFixture(){
  if(window.top!==window)return;
  localStorage.setItem('tsugi-onboarding-complete-v1','true');
  const key='tsugi-checkpoint-native-fixture';
  const saved=JSON.parse(sessionStorage.getItem(key)??'{}');
  const state=window.__readerFixture;
  state.managedBackups=saved.backups??[];
  state.restoreMutations=saved.mutations??[];
  const send=window.aiostreamsApp.send;
  window.aiostreamsApp.send=function(message){
    if(message.type==='read-request'&&['restore-manga-progress','save-category','assign-category','set-library'].includes(message.action.kind))
      state.restoreMutations.push(message.action.kind);
    const result=send.call(this,message);
    sessionStorage.setItem(key,JSON.stringify({backups:state.managedBackups,mutations:state.restoreMutations}));
    return result;
  };
  const setItem=Storage.prototype.setItem;
  Storage.prototype.setItem=function(name,value){
    if(name==='tsugi-portable-restore-session-v1'&&state.rejectRestoreCompletion&&JSON.parse(value).steps.some(step=>step.state==='done'))
      throw new DOMException('Synthetic post-mutation storage failure','QuotaExceededError');
    return setItem.call(this,name,value);
  };
}

export async function verifyRestoreSessionBrowser({browser,origin,installDesktopFixture,screenshotDir,includeMihon=true}){
  const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'en-GB',reducedMotion:'reduce'});
  page.setDefaultTimeout(20_000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const journal=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('tsugi-portable-restore-session-v1')));
  const theme=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('aiokai-desktop-player-theme-v1')??'"sumi"'));
  const file=value=>({name:'checkpoint-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  try{
    // A single init script fixes the fixture-install order, including reloads.
    await page.addInitScript({content:`(${installDesktopFixture.toString()})();(${installRecoveryFixture.toString()})();`});
    await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    const openSettings=()=>page.locator('[data-page="desktop-landing"] .tsugi-world-toolbar').getByRole('button',{name:'App settings',exact:true}).click();
    await openSettings();
    const settings=page.getByRole('dialog');
    const portable=settings.getByRole('region',{name:'Portable backup',exact:true});
    const prefs=settings.getByRole('region',{name:'Preferences backup',exact:true});
    const finish=async()=>{
      await portable.getByLabel('I have reviewed the current state and want to finish this restore record.').check();
      await portable.getByRole('button',{name:'Finish restore record',exact:true}).click();
      await portable.getByRole('status').filter({hasText:'Restore record finished.'}).waitFor();
      assert.equal(await journal(),null);
    };
    const originalTheme=await theme();
    await portable.getByLabel('Include manga progress',{exact:true}).uncheck();
    const downloadEvent=page.waitForEvent('download');
    await portable.getByRole('button',{name:'Export portable backup',exact:true}).click();
    const exported=await downloadEvent;
    const source=JSON.parse(await readFile(await exported.path(),'utf8'));
    const incomingTheme=originalTheme==='carbon'?'mocha':'carbon';
    const preferenceEntry=source.entries.find(entry=>entry.kind==='preferences');
    const preferenceData=JSON.parse(preferenceEntry.payload);
    preferenceData.settings.theme=incomingTheme;
    preferenceEntry.payload=JSON.stringify(preferenceData);
    preferenceEntry.bytes=Buffer.byteLength(preferenceEntry.payload);
    preferenceEntry.sha256=createHash('sha256').update(preferenceEntry.payload).digest('hex');
    await portable.locator('input[type=file]').setInputFiles(file(source));
    await portable.getByRole('heading',{name:'Portable backup preview',exact:true}).waitFor();
    await prefs.getByRole('button',{name:'Review archived preferences',exact:true}).click();
    await prefs.getByRole('alert').filter({hasText:'Prepare a restore checkpoint'}).waitFor();
    assert.equal(await theme(),originalTheme,'opening or reviewing an unprepared archive never writes preferences');
    await portable.getByRole('button',{name:'Prepare restore checkpoint',exact:true}).click();
    await portable.getByRole('status').filter({hasText:'Restore checkpoint prepared.'}).waitFor();
    assert.equal(await page.evaluate(()=>window.__readerFixture.managedBackups.length),2);
    assert.ok((await journal()).steps.every(step=>step.state==='pending'));
    await prefs.getByRole('button',{name:'Review archived preferences',exact:true}).click();
    await prefs.getByRole('heading',{name:'Restore preview',exact:true}).waitFor();
    await page.evaluate(()=>{window.__readerFixture.rejectRestoreCompletion=true;});
    await prefs.getByRole('button',{name:'Apply preferences',exact:true}).click();
    await prefs.getByRole('alert').filter({hasText:'Changes may have been applied'}).waitFor();
    assert.equal(await theme(),incomingTheme,'the injected failure occurs after the real preference write');
    assert.equal((await journal()).steps[0].state,'running','unconfirmed completion is never marked done');
    await portable.getByText('Interrupted or unconfirmed',{exact:true}).waitFor();
    if(screenshotDir){
      await mkdir(screenshotDir,{recursive:true});
      await portable.getByRole('heading',{name:'Open restore checkpoint',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:join(screenshotDir,'restore-interrupted.png'),animations:'disabled'});
    }

    await page.reload({waitUntil:'domcontentloaded'});
    await openSettings();
    await portable.getByText('Interrupted or unconfirmed',{exact:true}).waitFor();
    assert.equal(await theme(),incomingTheme);
    assert.equal((await journal()).steps[0].state,'running','opening settings after restart does not resume an action');
    assert.equal(await page.evaluate(()=>window.__readerFixture.managedBackups.length),2);
    await portable.getByRole('button',{name:'Resume saved restore',exact:true}).click();
    await portable.getByRole('status').filter({hasText:'Saved restore reopened.'}).waitFor();
    assert.equal((await journal()).steps[0].state,'failed');
    assert.equal(await theme(),incomingTheme,'resume only reopens and verifies the source');
    await prefs.getByRole('button',{name:'Review archived preferences',exact:true}).click();
    await prefs.getByRole('button',{name:'Apply preferences',exact:true}).click();
    await prefs.getByRole('status').filter({hasText:'Preferences restored.'}).waitFor();
    assert.deepEqual((await journal()).steps[0],{kind:'preferences',state:'done',attempts:2});
    const previousId=(await journal()).id;
    await portable.getByRole('button',{name:'Review recovery copy',exact:true}).click();
    await portable.getByRole('status').filter({hasText:'Earlier metadata is ready for review'}).waitFor();
    assert.notEqual((await journal()).id,previousId);
    assert.equal(await theme(),incomingTheme,'reviewing recovery never applies it automatically');
    assert.equal(await page.evaluate(()=>window.__readerFixture.managedBackups.length),4);
    await prefs.getByRole('button',{name:'Review archived preferences',exact:true}).click();
    await prefs.getByRole('button',{name:'Apply preferences',exact:true}).click();
    await prefs.getByRole('status').filter({hasText:'Preferences restored.'}).waitFor();
    assert.equal(await theme(),originalTheme);
    await finish();
    assert.equal(await page.evaluate(()=>window.__readerFixture.managedBackups.length),4,'finishing keeps both generations of managed copies');

    await portable.locator('input[type=file]').setInputFiles(file(source));
    await portable.getByRole('button',{name:'Prepare restore checkpoint',exact:true}).click();
    await portable.getByRole('status').filter({hasText:'Restore checkpoint prepared.'}).waitFor();
    const incoming=await page.evaluate(()=>{
      const record=JSON.parse(localStorage.getItem('tsugi-portable-restore-session-v1'));
      const row=window.__readerFixture.managedBackups.find(value=>value.row.name===record.source.name);
      const original={...row};row.archive='damaged';return original;
    });
    await prefs.getByRole('button',{name:'Review archived preferences',exact:true}).click();
    await prefs.getByRole('button',{name:'Apply preferences',exact:true}).click();
    await prefs.getByRole('alert').filter({hasText:'A saved source or recovery copy could not be verified.'}).waitFor();
    assert.equal(await theme(),originalTheme);
    const missing=await page.evaluate(incoming=>{
      const backups=window.__readerFixture.managedBackups;
      backups.find(value=>value.row.name===incoming.row.name).archive=incoming.archive;
      const record=JSON.parse(localStorage.getItem('tsugi-portable-restore-session-v1'));
      return backups.splice(backups.findIndex(value=>value.row.name===record.recovery.name),1)[0];
    },incoming);
    await prefs.getByRole('button',{name:'Review archived preferences',exact:true}).click();
    await prefs.getByRole('button',{name:'Apply preferences',exact:true}).click();
    await prefs.getByRole('alert').filter({hasText:'A saved source or recovery copy could not be verified.'}).waitFor();
    assert.equal(await theme(),originalTheme);
    assert.equal((await journal()).steps[0].state,'pending');
    await page.evaluate(missing=>window.__readerFixture.managedBackups.push(missing),missing);
    await finish();
    assert.equal(await page.evaluate(()=>window.__readerFixture.managedBackups.length),6);
    console.log('PASS: persistent restore checkpoint, interrupted completion, explicit resume/recovery, retained copies and damaged/missing-copy refusal.');

    if(includeMihon){
      const mihon=settings.getByRole('region',{name:'Mihon backup import',exact:true});
      await mihon.getByLabel('Choose a Mihon backup',{exact:true}).setInputFiles({name:'original-fixture.tachibk',mimeType:'application/gzip',buffer:gzipSync(mihonFixture())});
      await mihon.getByRole('heading',{name:'Decoded backup',exact:true}).waitFor();
      assert.equal(await journal(),null,'decoding the real gzip/protobuf container only reviews the input');
      await mihon.getByRole('button',{name:'Prepare Mihon import checkpoint',exact:true}).click();
      await mihon.getByRole('status').filter({hasText:'The recovery checkpoint is saved.'}).waitFor();
      assert.deepEqual((await journal()).steps.map(step=>step.kind),['manga','categories']);
      const importId=(await journal()).id;
      await mihon.getByLabel('Choose a Mihon backup',{exact:true}).setInputFiles({name:'another-fixture.tachibk',mimeType:'application/gzip',buffer:gzipSync(mihonFixture())});
      await mihon.getByRole('alert').filter({hasText:'A different restore session is open.'}).waitFor();
      assert.equal((await journal()).id,importId,'another file cannot replace the prepared import while its record is open');
      const review=mihon.getByRole('region',{name:'Review Mihon import',exact:true});
      assert.equal(await review.locator('input[type=file]').count(),0,'Mihon reuses only the shared reviewed apply controls');
      await review.getByRole('button',{name:'Review Mihon import',exact:true}).click();
      await review.getByRole('heading',{name:'Manga restore preview',exact:true}).waitFor();
      await review.getByText('Sources for missing titles',{exact:true}).click();
      await review.getByText('Source 9007199254740993 · Titles: 1',{exact:true}).waitFor();
      await review.getByText('Reconnect the original trusted source.',{exact:true}).waitFor();
      assert.equal(await review.getByRole('button',{name:'Restore matched manga progress',exact:true}).isEnabled(),false);
      const reportDownload=page.waitForEvent('download');
      await mihon.getByRole('button',{name:'Download import and unresolved entries report',exact:true}).click();
      const reportFile=await reportDownload;
      const report=JSON.parse(await readFile(await reportFile.path(),'utf8'));
      assert.equal(report.unresolved[0].sourceId,'9007199254740993');
      assert.equal(report.unresolved[0].missingTitle,true);assert.equal(report.unresolved[0].chapters.length,3);
      await finish();
      await mihon.getByRole('button',{name:'Prepare Mihon import checkpoint',exact:true}).waitFor();
      console.log('PASS: actual gzip/protobuf Mihon input, safe checkpoint, exact missing-source review and unresolved-entry report.');
    }
    assert.deepEqual(await page.evaluate(()=>window.__readerFixture.restoreMutations),[],'none of the read-only recovery or Mihon review actions mutated native metadata');
    assert.deepEqual(errors,[]);
  }catch(reason){
    console.error('Restore fixture UI alerts:',await page.getByRole('alert').allTextContents());
    if(screenshotDir){await mkdir(screenshotDir,{recursive:true});await page.screenshot({path:join(screenshotDir,'restore-failure.png'),animations:'disabled'}).catch(()=>{});}
    throw reason;
  }finally{await page.close();}
}
