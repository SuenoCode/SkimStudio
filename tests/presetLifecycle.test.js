import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseMedia,AudioBufferCache} from '../src/media/lifecycle.js';
import {analyzeInWorker} from '../src/analysis/workerClient.js';
import {waitMedia,seekFrame} from '../src/media/decoder.js';
import {mixTimelineAudio} from '../src/export/audioMix.js';
import {preparePresetFont} from '../src/captions/presetFonts.js';

test('media removal releases URL, video, reverse frames, analysis and narration exactly once',()=>{
 let paused=0,revoked=0,closed=0;
 const frame={width:10,height:10,close:()=>closed++};
 const c={url:'blob:test',videoEl:{pause(){paused++},removeAttribute(){},load(){}},edl:[{_f:[frame]}],_analysis:{},_facv:{width:64,height:112},_trSnapCanvas:{width:360,height:640},_ab:{},aud:{},thumbnail:'data:'};
 releaseMedia(c,()=>revoked++);releaseMedia(c,()=>revoked++);
 assert.equal(paused,1);assert.equal(revoked,1);assert.equal(closed,1);assert.equal(c.aud,null);assert.equal(c._analysis,undefined);assert.equal(frame.width,0);
});
test('decoded audio cache obeys its byte budget and does not retain oversized buffers',()=>{
 const cache=new AudioBufferCache(32),buffer={length:4,numberOfChannels:1};cache.set('a',buffer);cache.set('b',buffer);cache.set('c',buffer);
 assert.equal(cache.get('a'),undefined);assert.equal(cache.bytes,32);
 cache.set('huge',{length:100,numberOfChannels:2});assert.equal(cache.get('huge'),undefined);cache.clear();assert.equal(cache.bytes,0);
});
test('cancelled worker, worker failure and postMessage failure always terminate and clear handlers',async()=>{
 const Original=globalThis.Worker;let terminated=0,current;
 try{
  globalThis.Worker=class{constructor(){current=this}postMessage(){ }terminate(){terminated++}};
  let stop=false;const task=analyzeInWorker([],1,1,1,()=>stop);stop=true;await assert.rejects(task,/cancelled/);
  assert.equal(terminated,1);assert.equal(current.onmessage,null);
  const errorTask=analyzeInWorker([],1,1,1);current.onerror({message:'failed'});await assert.rejects(errorTask,/failed/);assert.equal(terminated,2);
  globalThis.Worker=class{postMessage(){throw new Error('clone failure')}terminate(){terminated++}};
  await assert.rejects(analyzeInWorker([],1,1,1),/clone failure/);assert.equal(terminated,3);
 }finally{globalThis.Worker=Original}
});
test('cancel during metadata wait or throwing seek removes every media listener',async()=>{
 const listeners=new Map();let stop=false;
 const video={readyState:0,duration:1,videoWidth:10,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
 const task=waitMedia(video,1000,()=>stop);stop=true;await assert.rejects(task,/cancelled/);assert.equal(listeners.size,0);
 video.readyState=2;Object.defineProperty(video,'currentTime',{get:()=>0,set(){throw new Error('seek failed')}});
 await assert.rejects(seekFrame(video,.5),/seek failed/);assert.equal(listeners.size,0);
});
test('failed font resolves to an offline fallback',async()=>{
 assert.match(await preparePresetFont('MissingAuditFont',{load:async()=>{throw new Error('offline')}}),/Montserrat/);
});
function fakeAudio(){
 const nodes=[];
 const buffer={length:4800,numberOfChannels:2,sampleRate:48000,getChannelData:()=>new Float32Array(4800)};
 class Context{
  constructor(){this.destination={}}
  createGain(){return this.make()}
  createDynamicsCompressor(){return this.make()}
  createBufferSource(){return this.make(true)}
  createBuffer(){return buffer}
  async startRendering(){return buffer}
  make(source=false){const n={disconnected:false,buffer:source?null:undefined,gain:{value:1,setTargetAtTime(){},setValueAtTime(){},linearRampToValueAtTime(){}},playbackRate:{value:1},connect(){},disconnect(){this.disconnected=true},start(){},stop(){}};nodes.push(n);return n}
 }
 return {Context,nodes,buffer};
}
test('alternating clips decode once each, and audio cancellation disconnects graph and releases buffers',async()=>{
 const {Context,nodes,buffer}=fakeAudio(),clips=[{id:'a',file:{name:'a'}},{id:'b',file:{name:'b'}}];let decodes=0;
 const owner={edl:Array.from({length:100},(_,i)=>({clipIdx:i%2,s:0,e:.1,sp:1}))};
 await mixTimelineAudio({Context,clips,owner,story:true,total:10,decode:async()=>{decodes++;return buffer}});
 assert.equal(decodes,2);assert.ok(nodes.every(n=>n.disconnected&&n.buffer==null));
 let cancelled=false;
 await assert.rejects(mixTimelineAudio({Context,clips,owner,story:true,total:10,cancelled:()=>cancelled,decode:async()=>{cancelled=true;return buffer}}),/cancelled/);
 assert.ok(nodes.every(n=>n.disconnected&&n.buffer==null));
 await assert.rejects(mixTimelineAudio({Context,clips,owner,total:301}),/five minutes/);
});

