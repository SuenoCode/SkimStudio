import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

test('six preset gallery compares the shared renderer and records a short timing demo',async({page})=>{
  await mkdir('test-results',{recursive:true});
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.goto('/caption-presets-demo.html');
  await expect(page.locator('.demo-card')).toHaveCount(6);
  await page.locator('#demo-time').evaluate(el=>{el.value='2';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect(page.locator('#demo-state')).toContainText('Speaking: change');
  await page.screenshot({path:'test-results/caption-preset-comparison.png',fullPage:true});
  const download=page.waitForEvent('download');
  await page.locator('#demo-record').click();
  await (await download).saveAs('release/SkimStudio-caption-presets-demo.webm');
  await expect.poll(async()=> (await import('node:fs/promises')).stat('release/SkimStudio-caption-presets-demo.webm').then(file=>file.size)).toBeGreaterThan(10000);
});

test('presets, overrides, per-cue timing, project restore, and MP4 export use the same saved captions',async({page})=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.addInitScript(()=>{
    globalThis.Worker=class MockAlignmentWorker{
      terminate(){}
      postMessage(){setTimeout(()=>this.onmessage?.({data:{tokens:[{text:'Hello',start:.05,end:.31},{text:'world.',start:.4,end:.72}]}}),0)}
    };
  });
  await page.goto('/');
  await page.locator('.caption-advanced').evaluate(el=>el.open=true);
  await page.locator('#create-project').click();
  await page.locator('#project-name').fill('Preset roundtrip');
  await page.locator('#confirm-create-project').click();
  await page.locator('#script').fill('Hello world.');
  await page.locator('#video-file').setInputFiles('tests/fixtures/source.mp4');
  await page.locator('#audio-file').setInputFiles('tests/fixtures/narration.wav');
  await expect(page.locator('#play-preview')).toBeEnabled({timeout:15000});
  await expect(page.locator('#preset-choice option')).toHaveCount(10);
  const six=['punch_word','speaker_dialogue','neon_story_phrase','condensed_presenter','yellow_focus','soft_neon_story'];
  for(const id of six){await page.locator('#preset-choice').selectOption(id);await expect(page.locator('#preset-choice')).toHaveValue(id)}
  await page.locator('#preset-choice').selectOption('yellow_focus');
  await page.locator('#auto-caption').click();
  await expect(page.locator('#caption-count')).toContainText('caption',{timeout:30000});
  await expect(page.locator('#cue-timing-source')).toContainText('Recognized word timestamps');
  const readProject=()=>page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('skimstudio-caption-projects');request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('projects','readonly'),get=tx.objectStore('projects').getAll();get.onsuccess=()=>resolve(get.result.find(item=>item.name==='Preset roundtrip'));get.onerror=()=>reject(get.error)};
  }));
  await page.waitForTimeout(700);
  const recognized=await readProject();expect(recognized.cues[0].src).toBe('whisper');
  await page.locator('#cue-word-times').fill('0.04-0.31, 0.40-0.74');
  await page.locator('#save-cue-overrides').click();
  await expect(page.locator('#cue-timing-source')).toContainText('Manually corrected word timestamps');
  await page.waitForTimeout(700);
  const before=await readProject(),timing=before.cues.flatMap(cue=>cue.w.map(word=>[+(cue.s+word.s).toFixed(4),+(cue.s+word.e).toFixed(4)]));
  await page.locator('#caption-max-words').selectOption('1');
  await page.locator('#regroup-captions').click();
  await expect(page.locator('#status')).toContainText('Every word timestamp was retained');
  const speaker=page.locator('#cue-speaker');await speaker.fill('NARRATOR');
  await page.locator('#cue-emphasis').fill('world.');await page.locator('#save-cue-overrides').click();
  await page.locator('#caption-emphasis-mode').selectOption('active');
  await page.locator('#caption-accent-color').fill('#fff000');
  await page.waitForTimeout(800);
  const saved=await readProject();
  expect(saved.preset).toBe('yellow_focus');expect(saved.presetVersion).toBe(1);expect(saved.presetOverrides.maxWords).toBe(1);
  const after=saved.cues.flatMap(cue=>cue.w.map(word=>[+(cue.s+word.s).toFixed(4),+(cue.s+word.e).toFixed(4)]));
  expect(after).toEqual(timing);expect(saved.cues[0].presetSpeaker).toBe('NARRATOR');expect(saved.cues[0].src).toBe('manual');
  await page.reload();await page.locator('[data-open-project]').filter({hasText:'Preset roundtrip'}).click();
  await expect(page.locator('#preset-choice')).toHaveValue('yellow_focus');
  await expect(page.locator('#caption-max-words')).toHaveValue('1');
  await expect(page.locator('#cue-speaker')).toHaveValue('NARRATOR');
  const mp4Download=page.waitForEvent('download',{timeout:90000}).catch(()=>null);
  await page.locator('#export-video').click();
  await expect(page.locator('#status')).toContainText(/MP4 exported and verified|MP4 export failed/,{timeout:90000});
  const status=await page.locator('#status').textContent();
  console.log('MP4 export status:',status);
  expect(status).toMatch(/MP4 exported and verified|WebCodecs|AAC encoding|H.264 encoding/);
  if(status.includes('MP4 exported and verified')){
    const download=await mp4Download;expect(download).not.toBeNull();await download.saveAs('test-results/SkimStudio-caption-presets-export.mp4');
  }
  expect(errors).toEqual([]);
});
