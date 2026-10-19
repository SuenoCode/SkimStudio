import test from 'node:test';
import assert from 'node:assert/strict';
import {AUDIT_RESPONSE_SCHEMA,STORY_PLAN_SCHEMA,auditMarkdown,localBeatPlan,normalizeAudit,normalizeBeats,normalizeStoryPlan,scriptLines} from '../src/audit/storyAuditor.js';

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

test('story planner keeps only real source shots and clamps section choices',()=>{
 const plan=normalizeStoryPlan({shotPlan:[{sectionIndex:9,shotId:'shot-a',order:0,sourceStart:1,sourceEnd:2,speed:1.2,camera:'close',transition:'dissolve',rationale:'Payoff evidence'},{sectionIndex:0,shotId:'invented',order:1,sourceStart:0,sourceEnd:1,speed:1,camera:'wide',transition:'cut',rationale:'Should be removed'}],payoff:'The result lands.',validationChecklist:['Check the payoff.']},{duration:8,sectionCount:3,shots:[{id:'shot-a'}]});
 assert.equal(plan.shotPlan.length,1);assert.equal(plan.shotPlan[0].sectionIndex,2);assert.equal(plan.shotPlan[0].shotId,'shot-a');assert.equal(plan.payoff,'The result lands.');
 assert.deepEqual(STORY_PLAN_SCHEMA.required,['beats','shotPlan','payoff','validationChecklist']);
});
