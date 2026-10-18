import test from 'node:test';
import assert from 'node:assert/strict';
import {PRESETS,getPreset,safeStyle,migratePresetData,LEGACY_STYLES} from '../src/captions/presetRegistry.js';
import {BASE_DEFAULTS,validatePreset,presetMotion} from '../src/captions/presetUtils.js';
import {createPresetController} from '../src/captions/presetController.js';
import {renderPresetCaption,presetCaptionState,captionLayout,accentColor,presetCacheSize,clearPresetLayouts} from '../src/captions/presetRenderer.js';
import {presetFrameState} from '../src/captions/presetEffects.js';
import {measuredWords,intervalAt} from '../src/captions/timing.js';
import {readProject} from '../src/core/project.js';
import {validateTimeline} from '../src/core/validation.js';
import {shotAt,timelineIndex} from '../src/core/timelineIndex.js';
import {applyKineticSportsUpset} from '../src/captions/kineticSportsStyle.js';
import {applyStreamerFlashbangMeme} from '../src/captions/streamerMemeStyle.js';
import {applyDialogueMemeCaption} from '../src/captions/dialogueMemeStyle.js';

function context(){
 return {records:[],boxes:[],globalAlpha:1,font:'900 30px sans-serif',
 measureText(text){return {width:[...String(text)].length*(parseFloat(this.font.split(' ')[1])||30)*.65}},
 save(){},restore(){},scale(){},strokeText(){},fillText(text,x,y){this.records.push({text,x,y,color:this.fillStyle})},
 fillRect(x,y,w,h){this.boxes.push({x,y,w,h})}};
}
function harness(){
 const values={...BASE_DEFAULTS,cs:'reference',unrelated:'keep'},history=[];
 const controller=createPresetController({read:id=>values[id],write:(id,value)=>{values[id]=value},checkpoint:()=>history.push(structuredClone(values)),changed(){},setStatus(){}});
 return {values,history,controller};
}
const cue={s:1,e:3,t:"We won 0.01 😮",w:[{s:0,e:.2},{s:.2,e:.5},{s:1,e:1.2},{s:1.2,e:1.5}]};
test('registry validates exactly three distinct configurations and retains legacy styles',()=>{
 assert.equal(PRESETS.length,3);assert.equal(new Set(PRESETS.map(p=>p.id)).size,3);
 for(const p of PRESETS){assert.equal(validatePreset(p),p);assert.equal(getPreset(p.id),p);assert.ok(Object.isFrozen(p.defaults))}
 assert.throws(()=>validatePreset({...PRESETS[0],maxWords:0}));assert.throws(()=>validatePreset({...PRESETS[0],defaults:{}}));
 assert.equal(safeStyle('future-style'),'reference');for(const id of LEGACY_STYLES)assert.equal(safeStyle(id),id);
});
test('independent apply functions switch deterministically, preserve manual edits and release owned values',()=>{
 const {controller,values}=harness();
 applyKineticSportsUpset({controller});assert.equal(values.cs,PRESETS[0].id);
 values.csz='41';controller.markManual('csz');
 applyStreamerFlashbangMeme({controller});assert.equal(values.csz,'41');assert.equal(values.preset_glitch,true);
 applyDialogueMemeCaption({controller});assert.equal(values.preset_glitch,false);assert.equal(values.preset_backing,true);assert.equal(values.unrelated,'keep');
 const one={...values};applyKineticSportsUpset({controller});applyDialogueMemeCaption({controller});assert.deepEqual(values,one);
 const saved=controller.snapshot();controller.release();assert.equal(values.csz,'41');assert.equal(values.preset_backing,false);
 controller.restore(saved);assert.deepEqual(controller.snapshot(),saved);
});
test('preset application rolls back on write failure with a useful error',()=>{
 let values={...BASE_DEFAULTS,cs:'reference'},message='';
 const controller=createPresetController({read:id=>values[id],write:(id,v)=>{if(id==='cs'&&v!=='reference')throw new Error('test failure');values[id]=v},checkpoint(){},changed(){},setStatus:m=>message=m});
 assert.equal(controller.apply(PRESETS[0]),false);assert.equal(values.cs,'reference');assert.match(message,/test failure/);
});
test('old, missing, unknown and new preset saves migrate without overwriting custom settings',()=>{
 const old={version:1,script:'',settings:{cf:'custom',csz:'45'},clips:[]};
 const loaded=readProject(old);assert.equal(loaded.settings.cs,'reference');assert.equal(loaded.settings.csz,'45');assert.equal(loaded.presetState.manual.cf,'custom');
 assert.equal(old.settings.cs,undefined);
 const missing=readProject({...old,settings:{cs:PRESETS[1].id,contrast:'1.23'}});assert.equal(missing.settings.preset_glitch,true);assert.equal(missing.settings.contrast,'1.23');
 const unknown=migratePresetData({...old,captionPreset:'future'});assert.equal(unknown.captionPreset,'reference');assert.match(unknown.presetWarning,/Unknown/);
 const {controller}=harness();controller.apply(PRESETS[2]);const round=readProject({...old,settings:{...PRESETS[2].defaults,cs:PRESETS[2].id},presetState:controller.snapshot()});
 assert.deepEqual(round.presetState,controller.snapshot());
});
test('legacy numeric word starts migrate; malformed imports fail atomically',()=>{
 const asset={id:'a',name:'a.mp4',metadata:{duration:5},edl:[],fx:[],cues:[{s:0,e:1,t:'one two',w:[0,.5]}]};
 const project={version:1,script:'',clips:[asset]};
 assert.deepEqual(readProject(project).clips[0].cues[0].w,[{s:0,e:.5},{s:.5,e:1}]);assert.deepEqual(asset.cues[0].w,[0,.5]);
 assert.throws(()=>readProject({...project,clips:[{...asset,cues:[{s:0,e:1,t:'one two',w:[{s:0,e:1}]}]}]}));
});
test('measured timing stays exact and malformed, partial, overlapping or unordered data renders nothing',()=>{
 assert.deepEqual(measuredWords(cue).map(({s,e})=>({s,e})),cue.w);
 for(const w of [[{s:0,e:.4}], [{s:-1,e:1}], [{s:0,e:NaN}], [{s:.4,e:.8},{s:.2,e:.3}],[{s:0,e:.7},{s:.5,e:.9}]]){
  const invalid={s:0,e:1,t:w.length===2?'one two':'one',w};if(w.length===1&&w[0].s===0&&w[0].e===.4)invalid.t='one two';
  assert.deepEqual(measuredWords(invalid),[]);
 }
 assert.deepEqual(measuredWords({s:0,e:1,t:'',w:[]}),[]);
 const veryShort={s:0,e:1,t:'a',w:[{s:.01,e:.015}]};assert.equal(measuredWords(veryShort)[0].e,.015);
});
for(const preset of PRESETS){
 test(preset.label+': onset, all silence gaps, offsets and final end are strict',()=>{
  const ctx=context(),words=measuredWords(cue),o={w:360,h:640};
  for(const time of [.99,1.6,2.5,3])assert.equal(presetCaptionState(ctx,cue,time,o,words,preset),null);
  let state=presetCaptionState(ctx,cue,1.1,{...o,wordOffset:.4},words,preset);assert.deepEqual(state.visible,[true,false]);
  assert.equal(presetCaptionState(ctx,cue,1.1,{...o,speechRuns:[[1.2,1.4]]},words,preset),null);
  assert.deepEqual(presetCaptionState(ctx,cue,2.1,o,words,preset).texts,['0.01','😮']);
 });
 test(preset.label+': preview/export state and commands are identical at 360 and 1080',()=>{
  const words=measuredWords(cue),a=context(),b=context();
  const small={w:360,h:640,cy:.6,cx_pos:.5},large={...small,w:1080,h:1920};
  assert.deepEqual(presetCaptionState(a,cue,1.3,small,words,preset),presetCaptionState(b,cue,1.3,large,words,preset));
  renderPresetCaption(a,cue,1.3,small,words,preset);renderPresetCaption(b,cue,1.3,large,words,preset);
  assert.deepEqual(a.records,b.records);assert.deepEqual(a.boxes,b.boxes);
 });
}
test('layout balances two lines, rescales long Unicode words and clamps backing inside safe areas',()=>{
 for(const text of ['one two three four five six','W'.repeat(200),'😮 👨‍👩‍👧‍👦 你好 日本語 12.01 don’t','']){
  for(const x of [.1,.5,.9])for(const y of [.1,.9]){
   const l=captionLayout(context(),text.split(' '),{font:'sans-serif',size:50,x,y,speaker:'CELEBRITY'});
   assert.ok(l.lines.length<=2);assert.ok(l.box.x>=24-1e-6);assert.ok(l.box.x+l.box.w<=336+1e-6);
   assert.ok(l.box.y>=80-1e-6);assert.ok(l.box.y+l.box.h<=520+1e-6);
   for(const line of l.lines)assert.ok(line.y>=l.box.y&&line.y<=l.box.y+l.box.h);
  }
 }
 assert.equal(captionLayout(context(),'one two three four five six'.split(' '),{font:'sans-serif',size:40}).lines.length,2);
});
test('dialogue backing and speaker labels appear only with speech',()=>{
 const ctx=context(),p=PRESETS[2],c={...cue,presetSpeaker:'FAN'};
 renderPresetCaption(ctx,c,1.1,{w:360,h:640},measuredWords(c),p);
 assert.equal(ctx.boxes.length,1);assert.ok(ctx.records.some(r=>r.text==='FAN:'&&r.color===p.colors.magenta));
 const silent=context();renderPresetCaption(silent,c,1.8,{w:360,h:640},measuredWords(c),p);assert.equal(silent.boxes.length,0);
});
test('accents use exact normalized text or explicit words, never substring matches',()=>{
 assert.equal(accentColor(PRESETS[0],'hello',{}),'#ffffff');
 assert.equal(accentColor(PRESETS[0],'WON!',{}),PRESETS[0].colors.cyan);
 assert.equal(accentColor(PRESETS[0],'LOST',{}),PRESETS[0].colors.red);
 assert.equal(accentColor(PRESETS[1],'error',{}),PRESETS[1].colors.cyan);
 assert.equal(accentColor(PRESETS[0],'he',{presetEmphasis:'the',presetAccent:'red'}),'#ffffff');
 assert.equal(accentColor(PRESETS[2],'celebrity',{presetEmphasis:'CELEBRITY',presetAccent:'green'}),PRESETS[2].colors.green);
});
test('locked/manual/custom shots get no preset motion, shake, glitch or transition changes',()=>{
 for(const config of PRESETS)for(const shot of [{lock:true},{manualFraming:true},{camera:'custom'}]){
  const base={fz:1.3,fx:.23,fy:.7};assert.equal(presetMotion(config,base,1,2,shot),base);
  const state=presetFrameState(config,{presetMotion:true,presetShake:true,presetGlitch:true},[],()=>[],.03,.03,shot);
  assert.equal(state.zoom,1);assert.equal(state.shakeX,0);assert.equal(state.glitch,0);assert.equal(state.hardCut,false);
 }
});
test('effects are deterministic and black-and-white ends exactly with manual cue speech',()=>{
 const config=PRESETS[1],c={...cue,presetAccent:'red'},options={presetMotion:true,presetShake:true,presetGlitch:true,presetBw:true,segDur:2};
 const state=()=>presetFrameState(config,options,[c],measuredWords,1.1,.04,{});
 assert.deepEqual(state(),state());assert.equal(state().bw,true);
 assert.equal(presetFrameState(config,options,[c],measuredWords,1.8,.04,{}).bw,false);
});
test('large multi-clip timelines have indexed lookup and edits invalidate offsets without retiming narration',()=>{
 const assets=Array.from({length:80},(_,i)=>({id:String(i),videoEl:{duration:30}}));
 const edl=Array.from({length:1000},(_,i)=>({id:'shot'+i,assetId:String(i%80),s:0,e:.2,sp:1,tr:{type:'cut',d:0}}));
 validateTimeline(edl,assets);const before=structuredClone(cue);
 assert.equal(shotAt(edl,100).i,499);assert.equal(timelineIndex(edl),timelineIndex(edl));
 edl[0].sp=2;validateTimeline(edl,assets);assert.ok(Math.abs(timelineIndex(edl).duration-199.9)<1e-8);
 assert.deepEqual(cue,before);
 const cues=Array.from({length:5000},(_,i)=>({s:i,e:i+.5}));assert.equal(intervalAt(cues,4500.1),4500);
});
test('layout cache remains bounded for thousands of captions',()=>{
 clearPresetLayouts();const ctx=context();
 for(let i=0;i<1500;i++){const c={s:0,e:1,t:'word'+i,w:[{s:0,e:1}]};presetCaptionState(ctx,c,.5,{},measuredWords(c),PRESETS[0])}
 assert.ok(presetCacheSize()<=256);clearPresetLayouts();assert.equal(presetCacheSize(),0);
});

