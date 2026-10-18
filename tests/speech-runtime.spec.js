import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
const speechAudio=process.env.SKIMSTUDIO_SPEECH_AUDIO||'analysis/caption-sync/output-audio.wav';
test.skip(!existsSync(speechAudio),'Set SKIMSTUDIO_SPEECH_AUDIO to a local narration WAV. The user media is excluded from the package.');
test('real browser speech sync measures the supplied output and hides captions in its pauses',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());page.on('console',message=>{if(message.type()==='error')console.log('SPEECH RUNTIME:',message.text().slice(0,250))});
 await page.goto('/');await page.locator('#file').setInputFiles('tests/fixtures/source.mp4');await expect(page.locator('#list')).toContainText('source.mp4');
 await page.locator('#mp3').setInputFiles(speechAudio);await expect(page.locator('#ai')).not.toHaveText('No voice loaded');
 await page.locator('#caption_text_source').selectOption('transcript');await page.locator('#sync_speech').click();
 await expect(page.locator('#st')).toHaveText(/Synchronized \d+ words|Speech sync failed:/,{timeout:570000});
 const status=await page.locator('#st').textContent();console.log(status);expect(status).toMatch(/^Synchronized/);
 const result=await page.evaluate(()=>{
   const rows=document.getElementById('ct').value.split('\n').map(line=>{const values=line.split('|');return{s:+values[0],e:+values[1],t:values[2],w:window.parseWords(values[3])}});
   const ctx=document.createElement('canvas').getContext('2d');let count=0;ctx.strokeText=()=>{};ctx.fillText=()=>count++;
   const draws=time=>{count=0;for(const cue of rows)window.caps(ctx,cue,time,window.opts(360,640));return count};
   return{cues:rows,activity:window.opts(360,640).speechRuns,draws:[5.35,26.2,29.95].map(draws),spoken:[5.85,26.75].map(draws)};
 });
 await writeFile('analysis/caption-sync/browser-alignment.json',JSON.stringify(result,null,2));
 console.log('CAPTION GATING:',JSON.stringify({silence:result.draws,spoken:result.spoken,cues:result.cues.filter(cue=>cue.s>4.5&&cue.s<7)}));
 expect(result.draws).toEqual([0,0,0]);expect(result.spoken.every(count=>count>0)).toBe(true);expect(errors).toEqual([]);
});
