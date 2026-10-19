import test from 'node:test';
import assert from 'node:assert/strict';
import {PRESETS,getPreset,safeStyle,migratePresetData,LEGACY_STYLES} from '../src/captions/presetRegistry.js';
import {BASE_DEFAULTS,validatePreset,presetMotion} from '../src/captions/presetUtils.js';
import {createPresetController} from '../src/captions/presetController.js';
import {renderPresetCaption,presetCaptionState,captionLayout,accentColor,presetCacheSize,clearPresetLayouts} from '../src/captions/presetRenderer.js';
import {presetFrameState} from '../src/captions/presetEffects.js';
import {measuredWords,intervalAt,storyCueWords,buildStoryCue} from '../src/captions/timing.js';
import {readProject} from '../src/core/project.js';
import {validateTimeline,validateCues} from '../src/core/validation.js';
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
test('preset captions stay hidden while their narration timing is stale',()=>{
 const ctx=context(),p=PRESETS[0];
 renderPresetCaption(ctx,cue,1.1,{w:360,h:640,captionTimingStale:true},measuredWords(cue),p);
 assert.equal(ctx.records.length,0);assert.equal(ctx.boxes.length,0);
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
 assert.ok(Math.abs(state().shakeX)<=1.2&&Math.abs(state().shakeY)<=1.2);
 assert.ok(state().glitch<=.75);
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
// Story cues clamp words against the duration they are written with. Clamping against an
// unrounded duration while emitting a 2-decimal cue produced "Word end must be between 0 and
// 0.4009999999999999", which validateCues throws on and that permanently blocks preview.
test('story cue words always validate against the rounded cue they are stored in',()=>{
 const round=(a,b)=>{const s=+a.toFixed(2),e=+b.toFixed(2);return{s,e,dur:Math.max(0.1,e-s)}};
 const build=(a,b,measured,text)=>{const{s,e,dur}=round(a,b);const w=storyCueWords(measured,text,dur);return{s,e,t:text,w:w||null,src:w?'measured':'accum'}};
 for(const[a,b]of[[1.0005,1.4010],[0.995,1.395],[2.004,2.404],[0.123,0.523],[10.567,10.967],[3.005,3.405]]){
  const cue=build(a,b,[{s:0,e:99}],'one');
  assert.doesNotThrow(()=>validateCues([cue]),`cue ${a}-${b} must validate`);
 }
 // Collapsed and reversed intervals are repaired into a renderable interval inside the cue,
 // which is what the planner has always done, and the result still has to validate.
 for(const broken of[[{s:.5,e:.5}],[{s:.8,e:.2}]]){
  const cue=build(0,1,broken,'one');
  assert.equal(cue.src,'measured');
  assert.ok(cue.w[0].e>cue.w[0].s);
  assert.ok(cue.w[0].e<=cue.e-cue.s+1e-9);
  assert.doesNotThrow(()=>validateCues([cue]));
 }
 // Unordered, miscounted and missing input cannot be repaired safely: fall back.
 assert.equal(build(0,1,[{s:.6,e:.7},{s:.1,e:.2}],'two words').w,null);
 assert.equal(build(0,1,[{s:0,e:1}],'two words').w,null);
 assert.equal(build(0,1,null,'one').w,null);
 // A valid list is preserved and stays inside the cue.
 const ok=build(0,1,[{s:0,e:.5},{s:.5,e:1}],'two words');
 assert.equal(ok.src,'measured');assert.deepEqual(ok.w,[{s:0,e:.5},{s:.5,e:1}]);
 assert.doesNotThrow(()=>validateCues([ok]));
 // Words are clamped to the cue, never past it, at both 360x640 and 1080x1920 pacing.
 const tight=build(1.0005,1.4010,[{s:.2,e:99}],'one');
 assert.ok(tight.w[0].e<=tight.e-tight.s+1e-9,`clamped ${tight.w[0].e} within ${(tight.e-tight.s).toFixed(3)}`);
 assert.ok(measuredWords(ok).length===2);
});
// The real production cue builder must never emit a cue validateCues rejects. The previous
// inline version clamped words to the unrounded duration but wrote a 2-decimal cue, so almost
// every generated cue overflowed and preview failed with "Word end must be between ...".
test('buildStoryCue never emits a cue that fails validation, unlike the previous inline logic',()=>{
 const clampOld=dur=>value=>+Math.max(0,Math.min(dur,value)).toFixed(3);
 const previousInline=(s,e,measured,text)=>{
  const dur=Math.max(0.1,e-s);let w=null;
  if(measured.length&&measured.length===text.trim().split(/\s+/).filter(Boolean).length){
   w=measured.map(x=>({s:clampOld(dur)(x.s),e:clampOld(dur)(x.e)}));
   for(let i=0;i<w.length-1;i++)if(!(w[i].e>w[i].s))w[i].e=Math.min(dur,w[i].s+.05);
   const last=w.length-1;if(!(w[last].e>w[last].s))w[last].e=Math.min(dur,w[last].s+.08);
  }
  return{s:+s.toFixed(2),e:+e.toFixed(2),t:text,w};
 };
 const rejects=cue=>{if(!cue)return false;try{validateCues([cue]);return false}catch{return true}};
 let oldFailed=0,newFailed=0,dropped=0,total=0;
 // align() emits 3-decimal bounds and word ends that reach the cue end, which is the shape
 // that overflowed once the cue was rounded down to 2 decimals.
 for(let si=0;si<220;si++)for(let ei=si+4;ei<si+70;ei++)for(const n of[1,2,3]){
  const s=+(si/1000).toFixed(3),e=+(ei/1000).toFixed(3),text=Array.from({length:n},(_,k)=>'w'+k).join(' ');
  const measured=Array.from({length:n},(_,k)=>({s:k*(e-s)/n+.002,e:e-s}));
  const roundS=+s.toFixed(2);
  const relative=measured.map(x=>({s:x.s-(s-roundS),e:x.e-(s-roundS)}));
  const built=buildStoryCue(text,s,e,relative);
  total++;
  if(!built)dropped++;
  if(rejects(previousInline(s,e,measured,text)))oldFailed++;
  if(rejects(built))newFailed++;
 }
 assert.ok(total>40000);
 assert.equal(newFailed,0,'buildStoryCue must never emit an invalid cue');
 assert.ok(oldFailed/total>.5,`control: previous inline logic failed ${(100*oldFailed/total).toFixed(1)}% of ${total} cues`);
 // A line too short to round into a usable cue is dropped, not emitted as zero length.
 assert.equal(buildStoryCue('a',1,1.004,[{s:0,e:.5}]),null);
 // A word longer than the cue is clamped to it, so even a very short cue stays valid.
 const tiny=buildStoryCue('a',1,1.01,[{s:0,e:.5}]);
 assert.equal(tiny.w[0].e,0.01);assert.doesNotThrow(()=>validateCues([tiny]));
 // Real narration shapes keep measured timing.
 const real=buildStoryCue('the first moment begins',1.234,1.987,[{s:0,e:.2},{s:.2,e:.4},{s:.4,e:.6},{s:.6,e:.753}]);
 assert.equal(real.src,'measured');assert.doesNotThrow(()=>validateCues([real]));
 assert.equal(measuredWords(real).length,4);
});

