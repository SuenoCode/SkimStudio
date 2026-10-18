import { test, expect } from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
async function openAdvancedTools(page){
 await page.locator('[data-view="timeline"]').click();
 await page.locator('#simple-open-tools').click();
 await expect(page.locator('#advanced_tools_dialog')).toBeVisible();
 const details=page.locator('.timeline-advanced');
 if(!(await details.evaluate(element=>element.open)))await details.locator('summary').click();
 await page.locator('#tm').selectOption('story');
 await page.locator('#tm').dispatchEvent('change');
}
test('media import, reviewed build, persistence, captions and MP4 export',async({page})=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto('/');await expect(page.locator('.simple-editor')).toBeVisible();await openAdvancedTools(page);await expect(page.locator('#project_save')).toBeVisible();await page.locator('#caption_engine').selectOption('estimated');
 await page.locator('#file').setInputFiles('tests/fixtures/source.mp4');
 await expect(page.locator('#list')).toContainText('source.mp4');
 await page.locator('#sc').fill('Hello world.');
 const sampleRate=16000,frames=sampleRate,buffer=Buffer.alloc(44+frames*2);buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(sampleRate,24);buffer.writeUInt32LE(sampleRate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(frames*2,40);for(let i=0;i<frames;i++)buffer.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/sampleRate)*5000),44+i*2);
 await page.locator('#mp3').setInputFiles({name:'narration.wav',mimeType:'audio/wav',buffer});
 await expect(page.locator('#ai')).toContainText('narration.wav');await expect(page.locator('#ed')).toHaveValue('');await expect(page.locator('#plan_dialog')).not.toBeVisible();
 await page.locator('#sy').click();await expect(page.locator('#plan_dialog')).toBeVisible();await expect(page.locator('#ed')).toHaveValue('');
 await page.locator('#plan_apply').click();await expect(page.locator('#ed')).not.toHaveValue('');
 await page.locator('#project_undo').click();await expect(page.locator('#ed')).toHaveValue('');await page.locator('#project_redo').click();await expect(page.locator('#ed')).not.toHaveValue('');
 await page.locator('#project_save').click();await page.locator('#project_load').click();await expect(page.locator('#st')).toContainText('Project loaded');await expect(page.locator('#ed')).not.toHaveValue('');
 await page.locator('#play').click();await expect(page.locator('#audio_meter')).toContainText('dBFS');await page.locator('#play').click();await expect(page.locator('#play')).toHaveText(/^▶/);
 const captions=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;const ctx=canvas.getContext('2d'),drawn=[];ctx.fillText=(t)=>drawn.push(t);ctx.strokeText=()=>{};
  const cue={s:1,e:2,t:'Hello world',w:[{s:.1,e:.3},{s:.6,e:.9}]};const options={w:360,h:640,fs:36,cf:'sans-serif',sw:'none',cs:'progressive',chunk_size:'all',cy:.5,cx_pos:.5};
  window.caps(ctx,cue,1.05,options);const before=drawn.slice();drawn.length=0;window.caps(ctx,cue,1.15,options);const first=drawn.slice();drawn.length=0;window.caps(ctx,cue,2.1,options);return{before,first,after:drawn};
 });expect(captions).toEqual({before:[],first:['Hello'],after:[]});
 await page.locator('#export_resolution').selectOption('360x640');await page.locator('#exp').click();
 await expect(page.locator('#st')).toHaveText(/Export finished|Export failed/, {timeout:60000});
 const status=await page.locator('#st').textContent();console.log('EXPORT:',status);
 if(status.includes('Export finished')){await expect(page.locator('#share_dlg')).toBeVisible();expect(await page.locator('#share_v').evaluate(v=>v.src.startsWith('blob:'))).toBeTruthy();const download=page.waitForEvent('download');await page.locator('#share_dl').click();await (await download).saveAs('test-results/verified-export.mp4');await page.evaluate(()=>window.closeShareDialog())}
 else expect(status).toMatch(/AAC|H.264|WebCodecs|cannot export/);
 expect(errors).toEqual([]);
 const streamed=await page.evaluate(async()=>{
  const directory=await navigator.storage.getDirectory(),name='skimstudio-test-'+crypto.randomUUID()+'.mp4';
  try{const handle=await directory.getFileHandle(name,{create:true});await window.render(0,false,handle);const file=await handle.getFile();return{size:file.size,status:document.getElementById('st').textContent}}
  finally{await directory.removeEntry(name)}
 });expect(streamed.size).toBeGreaterThan(32);expect(streamed.status).toContain('Export finished');await page.evaluate(()=>window.closeShareDialog());
 await page.screenshot({path:'test-results/studio-desktop.png',fullPage:true});
 // Cancellation must not create a success state; the next export remains possible.
 await page.locator('#export_resolution').selectOption('1080x1920');await page.locator('#exp').click();await expect(page.locator('#export_cancel')).toBeVisible();await page.locator('#export_cancel').click();await expect(page.locator('#st')).toContainText('Export cancelled',{timeout:20000});await expect(page.locator('#share_dlg')).not.toBeVisible();
 // Reopening a metadata-only save requires explicit relinking and narration import.
 await page.reload();await page.locator('#project_load').click();await expect(page.locator('#list')).toContainText('Relink video');await page.locator('#list input[type=file]').setInputFiles('tests/fixtures/source.mp4');await expect(page.locator('#list')).toContainText('Relinked');
 expect(errors).toEqual([]);
});
test('worker footage analysis and multi-clip story review preserve manual captions',async({page})=>{
 test.setTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto('/');await openAdvancedTools(page);await page.locator('#caption_engine').selectOption('estimated');
 await page.locator('#file').setInputFiles('tests/fixtures/source.mp4');await expect(page.locator('#list')).toContainText('source.mp4');
 await page.locator('#file').setInputFiles('tests/fixtures/source.mp4');await expect(page.locator('#list .item')).toHaveCount(2);
 await page.locator('#analyze_media').click();await expect(page.locator('#st')).toContainText('Image analysis finished',{timeout:45000});
 const result=await page.evaluate(()=>{const sample={g:new Uint8Array(64).fill(64),hx:new Float32Array(16).fill(1/16),edge:2,lum:64};return window.analyzeSamples(Array.from({length:5},(_,i)=>({...sample,t:i})),8,8,1)});expect(result.events).toEqual([]);expect(result.shots).toHaveLength(1);
 await page.locator('#tm').selectOption('story_multi');await page.locator('#sc').fill('The first moment begins. Then the story continues.');await page.locator('#mp3').setInputFiles('tests/fixtures/narration.wav');await expect(page.locator('#ai')).toContainText('narration.wav');
 await page.locator('#st_go').click();await expect(page.locator('#plan_dialog')).toBeVisible({timeout:45000});await expect(page.locator('#plan_rows tr')).toHaveCount(2);await page.locator('#plan_apply').click();
 await expect(page.locator('#tl_video_lane')).not.toContainText('</span>');
 await page.locator('[data-tab=tab_raw]').click();await page.locator('#ct').fill('0|1|Manual caption');await page.locator('#ed').dispatchEvent('change');await expect(page.locator('#ct')).toHaveValue('0.00|1.00|Manual caption');
 await page.evaluate(()=>window.toggleShotLock(0));const lockedTimeline=await page.locator('#ed').inputValue();
 await page.locator('#st_go').click();await expect(page.locator('#plan_dialog')).toBeVisible();await page.locator('#plan_apply').click();await expect(page.locator('#ed')).toHaveValue(lockedTimeline);await expect(page.locator('#ct')).toHaveValue('0.00|1.00|Manual caption');
 await page.locator('#project_export').click(); // Serialization remains usable after analysis.
 await page.setViewportSize({width:600,height:850});await expect(page.locator('#drop')).toBeVisible();await page.screenshot({path:'test-results/studio-mobile.png',fullPage:true});expect(errors).toEqual([]);
});
test('reference preset preserves timing, saves emphasis, and renders the same look at export size',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());await page.route('https://fonts.googleapis.com/**',route=>route.abort());await page.route('https://fonts.gstatic.com/**',route=>route.abort());await page.goto('/');await openAdvancedTools(page);
 await expect(page.locator('#cs')).toHaveValue('reference');await page.locator('#file').setInputFiles('tests/fixtures/source.mp4');await expect(page.locator('#list')).toContainText('source.mp4');
 await page.locator('[data-tab=tab_raw]').click();await page.locator('#ed').fill('0|2|1');await page.locator('#ed').dispatchEvent('change');await page.locator('#ct').fill('0|2|But a player from the other team|w:0:0.2,0.2:0.4,0.4:0.6,0.6:0.8,0.8:1.0,1.0:1.2,1.2:1.4');
 const oldCues=await page.locator('#ct').inputValue(),oldEdit=await page.locator('#ed').inputValue();
 await page.locator('[data-tab=tab_captions]').click();await page.locator('#apply_reference').click();await expect(page.locator('#ct')).toHaveValue(oldCues);expect((await page.locator('#ed').inputValue()).split('|').slice(0,3).map(Number)).toEqual(oldEdit.split('|').slice(0,3).map(Number));
 const styledEdit=await page.locator('#ed').inputValue();await page.evaluate(()=>window.toggleShotLock(0));await page.locator('#apply_reference').click();await expect(page.locator('#ed')).toHaveValue(styledEdit);
 await page.locator('.reference-style-panel summary').click();await page.locator('#reference_emphasis').fill('THE OTHER TEAM');await page.locator('#reference_cue_accent').selectOption('magenta');await page.locator('#reference_apply_emphasis').click();await page.locator('#project_save').click();await page.locator('#project_load').click();await expect(page.locator('#st')).toContainText('Project loaded');await expect(page.locator('#reference_emphasis')).toHaveValue('THE OTHER TEAM');
 const output=await page.evaluate(async()=>{
  await document.fonts.load('900 28px Montserrat');
  const cue={s:0,e:2,t:'But a player from the other team',refEmphasis:'THE OTHER TEAM',refAccent:'magenta',w:Array.from({length:7},(_,i)=>({s:i*.2,e:(i+1)*.2}))};
  const render=(w,h)=>{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');const gradient=ctx.createLinearGradient(0,0,w,h);gradient.addColorStop(0,'#12262c');gradient.addColorStop(1,'#070b11');ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);window.caps(ctx,cue,.95,{w,h,fs:28,cs:'reference',cf:"Montserrat,'Arial Black',sans-serif",cy:.54,cx_pos:.5,referenceWords:8,referenceIntro:.08,referenceReveal:'line',tc:'#ffffff'});return canvas.toDataURL('image/png')};
  const ctx=document.createElement('canvas').getContext('2d');window.hl2(ctx,{w:360,h:640,referenceStyle:true,hl:'ring',hp:{x:180,y:180},lb:'LOOK',el:1});
  return{preview:render(360,640),export:render(1080,1920),font:document.fonts.check('900 28px Montserrat')};
 });expect(output.font).toBe(true);await mkdir('release',{recursive:true});await writeFile('release/reference-style-preview.png',Buffer.from(output.preview.split(',')[1],'base64'));await writeFile('test-results/reference-style-1080.png',Buffer.from(output.export.split(',')[1],'base64'));expect(errors).toEqual([]);
});
test('silence guard hides stale captions and imported word timing repairs delayed cue bounds',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');await openAdvancedTools(page);await page.locator('#caption_engine').selectOption('manual');
 await page.locator('#file').setInputFiles('tests/fixtures/source.mp4');await expect(page.locator('#list')).toContainText('source.mp4');
 const sr=16000,frames=sr*2,buffer=Buffer.alloc(44+frames*2);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(sr,24);buffer.writeUInt32LE(sr*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++){const t=i/sr;if(t>=.5&&t<1||t>=1.4&&t<1.8)buffer.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/sr)*5000),44+i*2)}
 await page.locator('#mp3').setInputFiles({name:'pauses.wav',mimeType:'audio/wav',buffer});await expect(page.locator('#ai')).toContainText('pauses.wav');
 await page.locator('[data-tab=tab_raw]').click();await page.locator('#ct').fill('0|2|Hello world|w:0:1,1:2');
 const visibility=await page.evaluate(()=>{
   const cue={s:0,e:2,t:'Hello world',w:[{s:0,e:1},{s:1,e:2}]},ctx=document.createElement('canvas').getContext('2d');let count=0;ctx.strokeText=()=>{};ctx.fillText=()=>count++;
   return[.25,.75,1.2,1.6,1.95].map(time=>{count=0;window.caps(ctx,cue,time,window.opts(360,640));return count>0});
 });expect(visibility).toEqual([false,true,false,true,false]);
 const words={words:[{word:'Hello',start:.52,end:.9},{word:'world',start:1.42,end:1.72}]};await page.locator('#wpjson').setInputFiles({name:'word-times.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(words))});await expect(page.locator('#st')).toContainText('Imported 2 word timestamps');
 const corrected=(await page.locator('#ct').inputValue()).split('\n').map(line=>line.split('|').slice(0,2).map(Number));expect(corrected).toEqual([[.52,.9],[1.42,1.72]]);expect(errors).toEqual([]);
});
