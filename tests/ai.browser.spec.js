import {test,expect} from '@playwright/test';
import {beats,plan,audit,metadata} from './fixtures/ai.js';

async function setup(page,path='/'){
  await page.goto(path);await page.locator('#simple-open-tools').click();
  await page.evaluate(()=>{window.studioConfirm=async()=>true;});
  const details=page.locator('.timeline-advanced');if(!await details.evaluate(node=>node.open))await details.locator('summary').click();
  await page.locator('#tm').selectOption('story');await page.locator('#caption_engine').selectOption('estimated');
  await page.locator('#file').setInputFiles('tests/fixtures/source.mp4');await expect(page.locator('#list')).toContainText('source.mp4');
  await page.locator('#sc').fill('Hello world.');
  const sampleRate=16000,frames=sampleRate,buffer=Buffer.alloc(44+frames*2);
  buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(sampleRate,24);buffer.writeUInt32LE(sampleRate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(frames*2,40);
  for(let i=0;i<frames;i++)buffer.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/sampleRate)*5000),44+i*2);
  await page.locator('#mp3').setInputFiles({name:'test-tone.wav',mimeType:'audio/wav',buffer});await expect(page.locator('#ai')).toContainText('test-tone.wav');
}
async function wire(page,completion){
  await page.route('**/api/ai/**',async route=>{
    expect(route.request().headers().authorization).toBeUndefined();
    const path=new URL(route.request().url()).pathname;
    const body=path.endsWith('/status')?{configured:true,defaultModel:'openrouter/free',freeOnly:true}:path.endsWith('/models')?{models:[]} : await completion(route.request().postDataJSON());
    await route.fulfill({json:body});
  });
}
function promptJSON(request,label,next){
  const prompt=request.messages.at(-1).content[0].text;
  return JSON.parse(prompt.split(label+'\n')[1].split('\n\n'+next)[0]);
}
function plannedResponse(request){
  const shots=promptJSON(request,'SOURCE SHOTS:','EDITING SETTINGS:');
  const sections=promptJSON(request,'TIMELINE SECTIONS:','SOURCE SHOTS:');
  const result=plan(sections.at(-1).end);
  result.shotPlan[0].shotId=shots[0].id;
  result.shotPlan[0].sourceStart=shots[0].sourceStart;
  result.shotPlan[0].sourceEnd=Math.min(shots[0].sourceEnd,shots[0].sourceStart+1);
  return {data:result,metadata:metadata()};
}

for(const path of ['/','/SkimStudio_Enhanced.html'])test('audit uses the local server, samples a real export and downloads its report: '+path,async({page})=>{
  test.setTimeout(90000);const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
  await wire(page,async request=>{
    requests.push(request);
    return {data:request.schemaName==='skimstudio_story_beats'?beats(1):audit(),metadata:metadata()};
  });
  await setup(page,path);await expect(page.locator('#m_audit_key,#m_story_key')).toHaveCount(0);
  await page.locator('#st_ai_mode').selectOption('offline');await page.locator('#sy').click();await expect(page.locator('#plan_dialog')).toBeVisible({timeout:45000});await page.locator('#plan_apply').click();
  await page.locator('#export_resolution').selectOption('360x640');await page.locator('#simple-tools-close').click();await page.locator('#exp').click();
  await expect(page.locator('#st')).toContainText('Export finished',{timeout:45000});await page.evaluate(()=>window.closeShareDialog());
  await page.locator('#simple-open-tools').click();await page.locator('#story_audit_open').click();await page.locator('#story_audit_run').click();
  await expect(page.locator('#story_audit_status')).toContainText('Audit complete: PASS',{timeout:20000});
  expect(requests.map(request=>request.schemaName)).toEqual(['skimstudio_story_beats','skimstudio_story_audit']);
  const parts=requests[1].messages.at(-1).content;
  let images=0;
  parts.forEach((part,index)=>{if(part.type==='image_url'){images++;const evidence=JSON.parse(parts[index-1].text);expect(evidence.sourceTimestampSeconds).toBeGreaterThanOrEqual(0);expect(evidence.evidenceId).toMatch(/^export-frame-/);}});
  expect(images).toBeGreaterThanOrEqual(3);expect(images).toBeLessThanOrEqual(12);
  const downloaded=page.waitForEvent('download');await page.locator('#story_audit_download').click();expect((await downloaded).suggestedFilename()).toBe('skimstudio-story-audit.md');
  await page.locator('#story_audit_close').click();
  const exported=page.waitForEvent('download');await page.locator('#project_export').click();const file=await exported;const stream=await file.createReadStream();let content='';for await(const chunk of stream)content+=chunk.toString();expect(content).not.toMatch(/OPENROUTER_API_KEY|server-only-marker|apiKey|m_audit_key|m_story_key/);
  expect(errors).toEqual([]);
});

test('valid AI proposal reaches review; invalid responses never replace the current timeline',async({page})=>{
  test.setTimeout(90000);let mutate=result=>result;
  await wire(page,request=>mutate(plannedResponse(request)));await setup(page);
  await page.locator('#sy').click();await expect(page.locator('#plan_dialog')).toBeVisible({timeout:45000});await expect(page.locator('#st')).toContainText('test/vision:free');await page.locator('#plan_apply').click();
  const existing=await page.locator('#ed').inputValue();
  for(const change of [data=>{data.shotPlan[0].shotId='unknown';},data=>{data.shotPlan[0].sectionIndex=99;},data=>{data.shotPlan=[];},data=>{data.shotPlan[0].camera='unknown';},data=>{delete data.payoff;}]){
    mutate=result=>{change(result.data);return result;};
    await page.locator('#sy').click();await expect(page.locator('#st')).toContainText(/failed|schema|unknown|unavailable/i);await expect(page.locator('#plan_dialog')).not.toBeVisible();await expect(page.locator('#ed')).toHaveValue(existing);await expect(page.locator('.task-progress-overlay')).toBeHidden();
  }
});

test('missing server credential never falls back to offline editing',async({page})=>{
  await page.route('**/api/ai/status',route=>route.fulfill({json:{configured:false,defaultModel:'openrouter/free'}}));
  await setup(page);await page.locator('#sy').click();await expect(page.locator('#st')).toContainText('Configure OPENROUTER_API_KEY');await expect(page.locator('#plan_dialog')).not.toBeVisible();await expect(page.locator('#ed')).toHaveValue('');
  await expect(page.locator('#st_info')).toHaveText('no story edit yet');
});

test('audit cancellation releases the UI and permits another attempt',async({page})=>{
  test.setTimeout(90000);let release;
  await wire(page,async()=>{await new Promise(resolve=>{release=resolve;});return {data:beats(1),metadata:metadata()};});
  await setup(page);await page.locator('#st_ai_mode').selectOption('offline');await page.locator('#sy').click();await expect(page.locator('#plan_dialog')).toBeVisible({timeout:45000});await page.locator('#plan_apply').click();await page.locator('#export_resolution').selectOption('360x640');await page.locator('#simple-tools-close').click();await page.locator('#exp').click();await expect(page.locator('#st')).toContainText('Export finished',{timeout:45000});await page.evaluate(()=>window.closeShareDialog());await page.locator('#simple-open-tools').click();await page.locator('#story_audit_open').click();await page.locator('#story_audit_run').click();await expect(page.locator('#story_audit_cancel')).toBeVisible();
  await page.locator('#story_audit_cancel').click();await expect(page.locator('#story_audit_status')).toContainText('cancelled');await expect(page.locator('#story_audit_run')).toBeEnabled();release?.();
});
