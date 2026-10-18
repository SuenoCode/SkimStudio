import test from 'node:test';
import assert from 'node:assert/strict';
import {balancedLines,referenceAccent,referenceMotion,splitReferencePhrases,renderReferenceCaption} from '../src/captions/referenceStyle.js';
test('reference captions balance the setup and emphasis into two lines',()=>{
 assert.deepEqual(balancedLines('BUT A PLAYER FROM THE OTHER TEAM'.split(' '),text=>text.length,'THE OTHER TEAM').map(line=>line.join(' ')),['BUT A PLAYER FROM','THE OTHER TEAM']);
});
test('reference emphasis uses editable editorial colors',()=>{
 assert.equal(referenceAccent('He was in pain'),'#ff2828');assert.equal(referenceAccent('The other team'),'#ff00ed');assert.equal(referenceAccent('He could play again'),'#70ff00');assert.equal(referenceAccent('pain','green'),'#70ff00');
});
test('reference grouping preserves all words without forcing tiny three-word cuts',()=>{
 const text='But a player from the other team helped him.';const phrases=splitReferencePhrases(text);assert.equal(phrases.join(' '),text);assert.ok(phrases.every(phrase=>phrase.split(' ').length<=8));assert.equal(splitReferencePhrases('He thought he could never play again.').length,1);
});
test('reference camera motion is bounded, smooth and deterministic',()=>{
 const base={fz:1.05,fx:.4,fy:.5};assert.equal(referenceMotion(base,0,3).fz,base.fz);assert.equal(referenceMotion(base,3,3).fz,base.fz*1.045);assert.deepEqual(referenceMotion(base,3,3),referenceMotion(base,5,3));assert.equal(referenceMotion(base,1,3).fx,.4);
});
function recordingContext(){
 const records=[],context={globalAlpha:1,measureText:text=>({width:text.length*16}),save(){},restore(){},translate(){},scale(){},strokeText(){},fillText(text){records.push({text,color:this.fillStyle})}};return {records,context};
}
const cue={s:1,e:3,t:'HE COULD PLAY AGAIN',refAccent:'green'},words=cue.t.split(' ').map((t,i)=>({t,s:.2+i*.35,e:.5+i*.35}));
const options={w:360,h:640,fs:28,cy:.54,cx_pos:.5,referenceWords:8,referenceIntro:.08,referenceReveal:'word'};
test('reference word reveal respects speech onset and hides future words',()=>{
 const {context,records}=recordingContext();renderReferenceCaption(context,cue,1.1,options,words);assert.equal(records.length,0);renderReferenceCaption(context,cue,1.25,options,words);assert.deepEqual(records.map(record=>record.text),['HE']);
});
test('reference captions end with the final word and honor per-cue color',()=>{
 const {context,records}=recordingContext();renderReferenceCaption(context,cue,2.4,options,words);assert.ok(records.some(record=>record.color==='#70ff00'));records.length=0;renderReferenceCaption(context,cue,2.6,options,words);assert.equal(records.length,0);
});
