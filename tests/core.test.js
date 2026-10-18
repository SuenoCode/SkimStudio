import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCues,validateTimeline,validateWords,assertLocksUnchanged} from '../src/core/validation.js';
import {analyzeSamples} from '../src/analysis/sceneAnalysis.js';
import {scoreShot} from '../src/analysis/shotRanking.js';
import {History} from '../src/core/history.js';
import {readProject} from '../src/core/project.js';
import {exportConfig,verifyExport} from '../src/export/capabilities.js';
import {waitMedia,seekFrame} from '../src/media/decoder.js';
import {easeInOutCubic,transitionSourceTime,transitionDuration} from '../src/core/transitions.js';
const asset=()=>({id:'video',videoEl:{duration:10}});
const shot=()=>({id:'shot',assetId:'video',s:1,e:5,sp:2,tr:{type:'cut',d:0}});
test('timestamps reject negative, nonfinite and overlapping captions',()=>{
 for(const cues of [[{s:-1,e:1,t:'bad'}],[{s:NaN,e:1,t:'bad'}],[{s:0,e:2,t:'a'},{s:1,e:3,t:'b'}]])assert.throws(()=>validateCues(cues));
});
test('words must be ordered, nonnegative, complete and inside narration',()=>{
 for(const tokens of [[{start:-1,end:1}],[{start:0,end:1},{start:.5,end:2}],[{start:1,end:3}]])assert.throws(()=>validateWords(tokens,2));
 assert.equal(validateWords([{start:.5,end:1}],2).length,1);
});
test('word offsets cannot produce invalid cue-relative intervals',()=>{
 assert.throws(()=>validateCues([{s:2,e:3,t:'word',w:[{s:-.1,e:.5}]}]));
 assert.throws(()=>validateCues([{s:2,e:3,t:'word',w:[{s:.1,e:2}]}]));
});
test('source boundaries, speed and missing media are checked',()=>{
 for(const overrides of [{s:-1},{e:11},{sp:0},{sp:Infinity},{assetId:'absent'}])assert.throws(()=>validateTimeline([{...shot(),...overrides}],[asset()]));
 assert.throws(()=>validateTimeline([shot()],[{...asset(),missing:true}]));
});
test('timeline durations derive from source length / speed with ripple positions',()=>{
 const clips=[asset()],edl=[shot(),{...shot(),id:'second',s:5,e:8,sp:1}];
 assert.equal(validateTimeline(edl,clips),5);assert.equal(edl[1].timelineStart,2);assert.equal(edl[1].timelineEnd,5);
});
test('in-shot transition does not add extra timeline duration',()=>{
 const edl=[{...shot(),tr:{type:'dissolve',d:.3}}];assert.equal(validateTimeline(edl,[asset()]),2);
});
test('transition timing eases without freezing the outgoing shot',()=>{
 assert.equal(easeInOutCubic(0),0);assert.equal(easeInOutCubic(.5),.5);assert.equal(easeInOutCubic(1),1);
 const segment={s:10,e:14,sp:2,rev:false};assert.equal(transitionSourceTime(segment,1),12);
 assert.equal(transitionSourceTime({...segment,rev:true},1),12);
 assert.equal(transitionDuration(.34,1),.22);assert.equal(transitionDuration(.34,.2),.044);
});
test('history restores independent snapshots and supports redo',()=>{
 const h=new History(2),state={edl:[shot()]};h.push(state);state.edl[0].e=8;
 const prior=h.undo(state);assert.equal(prior.edl[0].e,5);assert.equal(h.redo(prior).edl[0].e,8);
});
test('project roundtrip validates stable references and schema version',()=>{
 const project={version:1,script:'hello',clips:[{id:'video',name:'test.mp4',metadata:{duration:10},edl:[shot()],cues:[],fx:[]}]};
 assert.equal(readProject(JSON.parse(JSON.stringify(project))).clips[0].edl[0].assetId,'video');
 assert.throws(()=>readProject({...project,version:999}));
 assert.throws(()=>readProject({...project,clips:[{...project.clips[0],edl:[{...shot(),assetId:'missing'}]}]}));
 assert.throws(()=>readProject({...project,clips:[{...project.clips[0],wordAlignment:{source:'whisper',words:[{start:-1,end:1}]}}]}));
});
test('codec fallback checks every advertised configuration',async()=>{
 const old={VideoEncoder:globalThis.VideoEncoder,AudioEncoder:globalThis.AudioEncoder,VideoFrame:globalThis.VideoFrame,AudioData:globalThis.AudioData};
 try{
  globalThis.VideoFrame=class{};globalThis.AudioData=class{};
  globalThis.AudioEncoder={isConfigSupported:async()=>({supported:true})};
  globalThis.VideoEncoder={isConfigSupported:async c=>({supported:c.codec==='avc1.420028'})};
  assert.equal((await exportConfig(720,1280,3e6)).video.codec,'avc1.420028');
  globalThis.AudioEncoder={isConfigSupported:async()=>({supported:false})};
  await assert.rejects(exportConfig(720,1280,3e6),/AAC/);
 }finally{Object.assign(globalThis,old)}
});
test('locked source ranges, speed and absolute positions cannot change',()=>{
 const before=[{...shot(),lock:true,timelineStart:0}];
 assert.doesNotThrow(()=>assertLocksUnchanged(before,structuredClone(before)));
 for(const override of [{e:6},{sp:.5},{timelineStart:1},{assetId:'other'}])assert.throws(()=>assertLocksUnchanged(before,[{...before[0],...override}]));
});
test('static footage has no invented action events or sampling-gap cuts',()=>{
 const samples=Array.from({length:8},(_,i)=>({t:i,g:new Uint8Array(64).fill(128),hx:new Float32Array(16).fill(1/16),edge:10,lum:128}));
 const result=analyzeSamples(samples,8,8,1);assert.equal(result.ok,true);assert.equal(result.events.length,0);assert.equal(result.shots.length,1);
});
test('ranking without keyword evidence does not invent a semantic match',()=>{
 const candidate={ev:{words:new Set()},ci:0,si:0,len:3,events:[],steady:0,action:0,bright:.5,edge:10};
 const context={used:[],variety:1,neutralPenalty:1,prevClip:1};const result=scoreShot(candidate,{keys:['goal'],role:'develop'},context);
 assert.equal(result.hit,false);assert.equal(result.kw,0);assert.ok(Number.isFinite(result.score));
});
test('ranking penalizes repeated footage with identical visual signals',()=>{
 const candidate={ev:{words:new Set(['stadium'])},ci:0,si:0,len:3,events:[],steady:0,action:0,bright:.5,edge:10};
 const context={used:[],variety:1,neutralPenalty:1,prevClip:1};const section={keys:['stadium'],role:'develop'};
 assert.ok(scoreShot(candidate,section,context).score>scoreShot(candidate,section,{...context,used:[{ci:0,si:0,uses:1}]}).score);
});
test('decode errors release temporary media listeners',async()=>{
 const listeners=new Map();const video={readyState:0,duration:NaN,videoWidth:0,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const pending=waitMedia(video);listeners.get('error')();await assert.rejects(pending,/decode/);assert.equal(listeners.size,0);
});
test('cancelling a frame seek rejects and releases listeners and frame callbacks',async()=>{
 const listeners=new Map();let cancelled=false,callbackCancelled=false;
 const video={readyState:2,duration:2,videoWidth:10,currentTime:0,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),requestVideoFrameCallback:()=>7,cancelVideoFrameCallback:id=>callbackCancelled=id===7};
 const pending=seekFrame(video,1,()=>cancelled);setTimeout(()=>cancelled=true,5);await assert.rejects(pending,/cancelled/);assert.equal(listeners.size,0);assert.equal(callbackCancelled,true);
});
test('invalid export bytes cannot be reported as a successful MP4',async()=>{
 await assert.rejects(verifyExport(new Blob([new Uint8Array(64)]),1),/invalid MP4/);
});
test('history is bounded and a new edit invalidates redo',()=>{
 const h=new History(2);h.push({id:1});h.push({id:2});h.push({id:3});assert.equal(h.past.length,2);assert.equal(h.undo({id:4}).id,3);h.push({id:5});assert.equal(h.redo({id:6}),null);
});
