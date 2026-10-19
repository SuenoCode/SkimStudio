import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeNarration,captionIsActive,clipTokensToActivity,anchorRecognizedOnsets,captionEndTime} from '../src/captions/activity.js';
import {alignedCues,alignmentForLines} from '../src/captions/alignedCues.js';
import {renderReferenceCaption} from '../src/captions/referenceStyle.js';
test('narration detector retains real pauses instead of bridging them into captions',()=>{
 const sr=1000,pcm=new Float32Array(2000);for(let i=100;i<500;i++)pcm[i]=.2;for(let i=900;i<1300;i++)pcm[i]=.15;
 const result=analyzeNarration([pcm],sr);assert.deepEqual(result.runs,[[.1,.5],[.9,1.3]]);
});
test('silent narration produces no invented speech regions',()=>assert.deepEqual(analyzeNarration([new Float32Array(1000)],1000).runs,[]));
test('activity checks both audio channels and does not cancel opposite-polarity speech',()=>{
 const first=new Float32Array(500).fill(.1),second=new Float32Array(500).fill(-.1);assert.deepEqual(analyzeNarration([first,second],1000).runs,[[0,.5]]);
});
test('captions cannot display inside a real narration pause, even with stale word estimates',()=>{
 const cue={s:0,e:2},words=[{s:0,e:2}],options={speechRuns:[[0,.5],[1,1.5]]};assert.equal(captionIsActive(cue,.7,words,options),false);assert.equal(captionIsActive(cue,1.2,words,options),true);
});
test('word timing gaps blank captions when no narration file is available',()=>{
 const cue={s:0,e:2},words=[{s:0,e:.5},{s:1,e:1.5}];assert.equal(captionIsActive(cue,.7,words),false);assert.equal(captionIsActive(cue,1.1,words),true);
 assert.equal(captionEndTime(cue,words),1.5);assert.equal(captionEndTime(cue,[]),0);
});
test('short measured gaps are silent and stale timings never render',()=>{
 const cue={s:0,e:1,t:'one two'},words=[{s:0,e:.4},{s:.45,e:.8}];
 assert.equal(captionIsActive(cue,.425,words),false);
 assert.equal(captionIsActive(cue,.5,words),true);
 assert.equal(captionIsActive(cue,.5,words,{captionTimingStale:true}),false);
});
test('reference captions do not use the previous word to fill a silent gap',()=>{
 let draws=0;const ctx={save(){},restore(){},measureText:text=>({width:text.length*10}),translate(){},scale(){},strokeText(){},fillText(){draws++},globalAlpha:1};
 renderReferenceCaption(ctx,{s:0,e:2,t:'hello world'},.8,{w:360,h:640},[{t:'hello',s:0,e:.5},{t:'world',s:1,e:1.5}]);assert.equal(draws,0);
});
test('recognized words move inaccurate cue bounds instead of being rejected or clamped',()=>{
 const existing=[{s:1,e:4,t:'Hello world',refAccent:'green'}],tokens=[{text:'Hello',start:.2,end:.5},{text:'world',start:.55,end:.9}];
 const cues=alignedCues(existing,tokens,{duration:2});assert.equal(cues[0].s,.2);assert.equal(cues[0].e,.9);assert.equal(cues[0].refAccent,'green');assert.equal(cues[0].w[0].s,0);
});
test('utterance pauses split cues without extending or squeezing a spoken word',()=>{
 const tokens=[{text:'Wait',start:0,end:.3},{text:'why',start:.9,end:1.1},{text:'frog',start:1.1,end:1.5}];const cues=alignedCues([{t:'Wait why frog'}],tokens,{duration:2});
 assert.equal(cues.length,2);assert.equal(cues[0].e,.3);assert.equal(cues[1].s,.9);assert.equal(cues[1].e,1.5);
});
test('regrouping an aligned script preserves word onset and end timestamps',()=>{
 const tokens=[{text:'a',start:.1,end:.2},{text:'frog',start:.2,end:.5},{text:'waits',start:1,end:1.3}];const result=alignmentForLines(['a frog','waits'],tokens);assert.equal(result[0].w[0].s,.1);assert.equal(result[0].w[1].e,.5);assert.equal(result[1].w[0].s,1);
});
test('mismatched words are rejected atomically rather than assigned someone else’s timing',()=>{
 const cues=[{s:0,e:1,t:'hello frog'}],before=structuredClone(cues);assert.throws(()=>alignedCues(cues,[{text:'hello',start:0,end:.3},{text:'world',start:.4,end:.8}]),/do not match/);assert.deepEqual(cues,before);
});
test('recognizer hallucinations in a silent end tail are removed',()=>{
 const result=clipTokensToActivity([{text:'frog',start:.9,end:1.3},{text:'you',start:2,end:2.2}],[[.8,1.2]]);assert.deepEqual(result,[{text:'frog',start:.9,end:1.2}]);
});
test('recognized words never span a detected pause',()=>{
 const result=clipTokensToActivity([{text:'word',start:.4,end:.8}],[[0,.5],[.7,1]]);
 assert.deepEqual(result,[{text:'word',start:.7,end:.8}]);
});
test('split contraction tokens map only to the same normalized script word',()=>{
 const result=alignedCues([{t:"Didn't ask"}],[{text:'Did',start:0,end:.2},{text:"n't",start:.2,end:.3},{text:'ask',start:.3,end:.6}]);assert.equal(result[0].w[0].e,.3);
});
test('late recognized utterance starts anchor to nearby real narration activity',()=>{
 const words=[{text:'Bro',start:26.78,end:27.04},{text:"didn't",start:27.04,end:27.3}];const result=anchorRecognizedOnsets(words,[[26.39,26.61],[26.68,27.3]]);
 assert.equal(result[0].start,26.39);assert.equal(result[1].start,27.04);assert.equal(words[0].start,26.78);
});
