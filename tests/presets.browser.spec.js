import {test,expect} from '@playwright/test';
const presets=[
 {id:'kinetic-sports-upset',name:'Kinetic Sports Upset',button:'Apply Sports Upset'},
 {id:'streamer-flashbang-meme',name:'Streamer Flashbang Meme',button:'Apply Streamer Flashbang'},
 {id:'dialogue-meme-caption',name:'Dialogue Meme Caption',button:'Apply Dialogue Meme'}
];
async function openTools(page){
 await page.locator('#simple-open-tools').click();
 await page.evaluate(()=>{window.studioConfirm=async()=>true});
}
async function setup(page,path='/'){
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 await page.goto(path);await openTools(page);
 await page.locator('#tm').selectOption('story');await page.locator('#caption_engine').selectOption('manual');
 await page.locator('#file').setInputFiles('tests/fixtures/source.mp4');
 await expect(page.locator('#list')).toContainText('source.mp4');
 await page.locator('#mp3').setInputFiles('tests/fixtures/narration.wav');await expect(page.locator('#ai')).toContainText('narration.wav');
 await page.locator('[data-tab=tab_raw]').click();
 await page.locator('#ed').fill('0|1.2|1');await page.locator('#ed').dispatchEvent('change');
 await page.locator('#ct').fill('0|1.2|Only we won today|w:0.1:0.3,0.3:0.5,0.65:0.9,0.9:1.1');
 await page.evaluate(()=>window.showCues());
 await page.locator('[data-tab=tab_captions]').click();
}
for(const path of ['/','/SkimStudio_Enhanced.html']){
 test('exactly three new presets are visible and keyboard accessible on '+path,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(path);await openTools(page);
  await expect(page.locator('.preset-card')).toHaveCount(3);
  const options=await page.locator('#cs option').allTextContents();expect(options).toHaveLength(10);
  for(const p of presets){
   expect(options).toContain(p.name);const button=page.getByRole('button',{name:p.button,exact:true});
   await button.scrollIntoViewIfNeeded();await expect(button).toBeVisible();await button.focus();await page.keyboard.press('Enter');
   await expect(page.locator('#cs')).toHaveValue(p.id);await expect(button).toHaveAttribute('aria-pressed','true');
  }
  await page.screenshot({path:'test-results/preset-controls'+(path==='/'?'':'-enhanced')+'.png',fullPage:true});
  expect(errors).toEqual([]);
 });
}
for(const p of presets){
 test(p.name+' previews, exports MP4 and restores saved ownership/timing',async({page})=>{
  test.setTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await setup(page);
  const cues=await page.locator('#ct').inputValue(),edl=await page.locator('#ed').inputValue();
  await page.getByRole('button',{name:p.button,exact:true}).click();
  await expect(page.locator('#ct')).toHaveValue(cues);await expect(page.locator('#ed')).toHaveValue(edl);
  await expect(page.locator('#st')).toContainText('applied to preview and export');
  await page.locator('#csz').fill('38');await page.locator('#csz').dispatchEvent('input');
  for(const other of presets)await page.getByRole('button',{name:other.button,exact:true}).click();
  await page.getByRole('button',{name:p.button,exact:true}).click();await expect(page.locator('#csz')).toHaveValue('38');
  await page.locator('#export_resolution').selectOption('360x640');
  await page.locator('#project_save').click();await page.locator('#project_load').click();await expect(page.locator('#st')).toContainText('Project loaded');
  await expect(page.locator('#cs')).toHaveValue(p.id);await expect(page.locator('#ct')).toHaveValue(cues);
  // Actual timeline playback uses the same mixer and compositor as export.
  await page.locator('#simple-tools-close').click();
  await page.locator('#play').click();await expect(page.locator('#audio_meter')).toContainText('dBFS',{timeout:20000});
  await expect(page.locator('#play')).toHaveText('▶ Play / Pause',{timeout:15000});
  await page.locator('#exp').click();await expect(page.locator('#st')).toContainText('Export finished',{timeout:60000});
  await expect(page.locator('#share_dlg')).toBeVisible();
  const output=await page.locator('#share_v').evaluate(async video=>{const blob=await(await fetch(video.src)).blob();return {size:blob.size,width:video.videoWidth,height:video.videoHeight}});
  expect(output.size).toBeGreaterThan(1000);
  const download=page.waitForEvent('download');await page.locator('#share_dl').click();await(await download).saveAs('test-results/'+p.id+'.mp4');
  await page.evaluate(()=>window.closeShareDialog());
  await page.reload();await openTools(page);await page.locator('#project_load').click();await expect(page.locator('#cs')).toHaveValue(p.id);
  await expect(page.locator('#csz')).toHaveValue('38');await expect(page.locator('#ct')).toHaveValue(cues);
  await expect(page.locator('#list')).toContainText('Relink video');
  expect(errors).toEqual([]);
 });
}
test('real canvas layouts fit at both resolutions and preview/export frame pixels are deterministic',async({page})=>{
 await setup(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const p of presets){
  await page.getByRole('button',{name:p.button,exact:true}).click();
  const result=await page.evaluate(async()=>{
   await document.fonts.ready;
   const cue={s:0,e:2,t:'W'.repeat(100)+' 😮 你好 0.01',presetSpeaker:'FAN',w:[{s:0,e:.3},{s:.3,e:.6},{s:.6,e:.9},{s:.9,e:1.2}]};
   const records=[];
   for(const [w,h]of [[360,640],[1080,1920]]){
    const cv=document.createElement('canvas');cv.width=w;cv.height=h;const ctx=cv.getContext('2d'),texts=[],boxes=[];
    const fill=ctx.fillText.bind(ctx),box=ctx.fillRect.bind(ctx);
    ctx.fillText=(t,x,y)=>{texts.push({t,x,y,width:ctx.measureText(t).width});fill(t,x,y)};
    ctx.fillRect=(x,y,w,h)=>{boxes.push({x,y,w,h});box(x,y,w,h)};
    const o={...window.opts(w,h),speechRuns:null,cx_pos:.9,cy:.9};window.caps(ctx,cue,.8,o);
    records.push({texts,boxes});
   }
   const canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;
   const source=document.createElement('canvas');source.width=360;source.height=640;source.videoWidth=360;source.videoHeight=640;source.getContext('2d').fillRect(0,0,360,640);
   const draw=()=>{window.draw(canvas.getContext('2d'),source,[cue],{...window.opts(360,640),speechRuns:null,vt:.04,el:.04,segDur:1,shot:{},timeline:null});return canvas.toDataURL()};
   return{records,match:draw()===draw()};
  });
  expect(result.match).toBe(true);expect(result.records[0]).toEqual(result.records[1]);
  for(const r of result.records)for(const t of r.texts){expect(t.x).toBeGreaterThanOrEqual(24);expect(t.x+t.width).toBeLessThanOrEqual(337);expect(t.y).toBeLessThanOrEqual(520)}
 }
 expect(errors).toEqual([]);
});
test('preset switching leaves locked framing and all cue timing unchanged; Reference still applies',async({page})=>{
 await setup(page);await page.evaluate(()=>window.toggleShotLock(0));
 const timeline=await page.locator('#ed').inputValue(),cues=await page.locator('#ct').inputValue();
 for(const p of presets){await page.locator('#cs').selectOption(p.id);await expect(page.locator('#ed')).toHaveValue(timeline);await expect(page.locator('#ct')).toHaveValue(cues)}
 await page.locator('#apply_reference').click();await expect(page.locator('#cs')).toHaveValue('reference');await expect(page.locator('#ed')).toHaveValue(timeline);
 await expect(page.locator('#ct')).toHaveValue(cues);
});

