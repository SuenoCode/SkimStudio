import test from 'node:test';
import assert from 'node:assert/strict';
import {AUDIT_RESPONSE_SCHEMA,STORY_PLAN_SCHEMA,auditMarkdown,localBeatPlan,normalizeAudit,normalizeBeats,normalizeStoryPlan,runStoryAudit,scriptLines} from '../src/audit/storyAuditor.js';
import {plan,audit,beats,metadata} from './fixtures/ai.js';

test('story script parsing produces six ordered beats before visual review',()=>{
 const script='Hook now. Context follows. Evidence appears. Payoff lands.';
 assert.deepEqual(scriptLines(script),['Hook now.','Context follows.','Evidence appears.','Payoff lands.']);
 const beats=localBeatPlan(script,12);
 assert.equal(beats.length,6);assert.equal(beats[0].label,'Hook');assert.equal(beats[5].label,'Closing statement or call-to-action');
 assert.ok(beats.every((beat,index)=>beat.start<=beat.end&&(index===0||beat.start>=beats[index-1].end)));
});

test('model beat output is normalized without losing fallback timing',()=>{
 const beats=normalizeBeats({beats:[{label:'Opening',expectedMeaning:'Start',importance:'high'}]},'A line.',6);
 assert.equal(beats.length,6);assert.equal(beats[0].label,'Opening');assert.equal(beats[0].start,0);assert.equal(beats[0].end,1);assert.equal(beats[1].start,1);
});

test('audit output is safe to display and markdown includes evidence fields',()=>{
 const audit=normalizeAudit({verdict:'PASS',scores:{overall:91},reconstructedStory:'A clear story.',issues:[{timestamp:2.2,severity:'high',confidence:.8,expectedMeaning:'Show the result',observedMeaning:'No result',evidence:['Frame 4'],rootCause:'Wrong shot',recommendedFix:'Replace shot',acceptanceCriteria:'Result is visible'}]}, {beats:[],frames:[{timestamp:0}],model:'openrouter/free',script:'A line.',duration:4,resolution:{width:360,height:640}});
 assert.equal(audit.verdict,'PASS');assert.equal(audit.scores.overall,91);assert.equal(audit.scores.storyAccuracy,0);assert.equal(audit.issues[0].confidence,.8);
 const report=auditMarkdown(audit);assert.match(report,/## Issues/);assert.match(report,/Wrong shot/);assert.match(report,/Acceptance criteria: Result is visible/);
});

test('audit response schema requires the contract fields',()=>{
 assert.deepEqual(AUDIT_RESPONSE_SCHEMA.required,['verdict','scores','reconstructedStory','segments','issues','solutionPlan','revisedTimeline','validationChecklist','limitations']);
 assert.deepEqual(AUDIT_RESPONSE_SCHEMA.properties.verdict.enum,['PASS','NEEDS_REVISION','FAIL']);
});

test('story planner rejects invalid references, intervals, enums, sections and incomplete plans atomically',()=>{
 const context={duration:1,sectionCount:1,shots:[{id:'shot-a',sourceStart:0,sourceEnd:1}]};
 assert.deepEqual(normalizeStoryPlan(plan(),context),plan());
 for(const patch of [{shotId:'invented'},{sectionIndex:9},{sourceStart:-1},{sourceEnd:2},{sourceEnd:0},{camera:'invented'},{transition:'invented'},{speed:'1'},{order:1}]){
  const input=plan();Object.assign(input.shotPlan[0],patch);const before=structuredClone(input);
  assert.throws(()=>normalizeStoryPlan(input,context),error=>error.code==='INVALID_MODEL_OUTPUT');assert.deepEqual(input,before);
 }
 const empty=plan();empty.shotPlan=[];assert.throws(()=>normalizeStoryPlan(empty,context));
 assert.throws(()=>normalizeStoryPlan(plan(),{...context,sectionCount:2}));
 assert.deepEqual(STORY_PLAN_SCHEMA.required,['beats','shotPlan','payoff','validationChecklist']);
});

test('schema-valid but inconsistent audit PASS requires revision and retains actual provider metadata',async()=>{
 const data=audit();data.issues=[{timestamp:.5,severity:'high',confidence:.9,expectedMeaning:'Result',observedMeaning:'Unrelated shot',evidence:['frame-1'],rootCause:'Shot choice',recommendedFix:'Review source',acceptanceCriteria:'Result shown'}];
 let request;
 const result=await runStoryAudit({script:'A result.',duration:1,beatResult:{...beats(1),metadata:metadata()},frames:[{id:'frame-1',timestamp:.5,dataUrl:'test-only'}],provider:{async completeJSON(options){request=options;return {data,metadata:metadata()};}}});
 assert.equal(result.verdict,'NEEDS_REVISION');assert.equal(result.model,'test/vision:free');assert.equal(result.requestMetadata.length,2);
 assert.equal(JSON.parse(request.messages.at(-1).content[1].text).sourceTimestampSeconds,.5);
});
