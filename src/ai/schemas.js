const string={type:'string',maxLength:12000};
const strings={type:'array',maxItems:128,items:string};
const object=(properties)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const number=(minimum=0,maximum=100)=>({type:'number',minimum,maximum});

export const BEAT_SCHEMA=object({beats:{type:'array',minItems:5,maxItems:5,items:object({id:{...string,minLength:1},label:{...string,minLength:1},expectedMeaning:string,subjects:strings,requiredEvidence:strings,start:number(0,300),end:number(0,300),importance:{enum:['low','medium','high']}})}});
export const STORY_PLAN_SCHEMA=object({
  beats:BEAT_SCHEMA.properties.beats,
  shotPlan:{type:'array',minItems:1,maxItems:128,items:object({sectionIndex:{type:'integer',minimum:0},shotId:{...string,minLength:1},order:{type:'integer',minimum:0},sourceStart:number(0,86400),sourceEnd:number(0,86400),speed:number(.25,2.5),camera:{enum:['wide','medium','close','drift','close_left','close_right']},transition:{enum:['cut','dissolve','leak','burn']},rationale:{...string,minLength:1}})},
  payoff:string,validationChecklist:strings
});
export const VISUAL_EVIDENCE_SCHEMA=object({observations:{type:'array',minItems:1,maxItems:12,items:object({shotId:{...string,minLength:1},evidenceId:{...string,minLength:1},subjects:strings,visibleActions:strings,visualEvidence:strings,confidence:number(0,1),uncertainty:string})}});
export const AUDIT_VERDICTS=['PASS','NEEDS_REVISION','FAIL'];
const looseObjects={type:'array',maxItems:128,items:{type:'object'}};
export const AUDIT_RESPONSE_SCHEMA=object({
  verdict:{enum:AUDIT_VERDICTS},
  scores:object({storyAccuracy:number(),visualSupport:number(),captionAccuracy:number(),pacing:number(),overall:number()}),
  reconstructedStory:string,segments:looseObjects,
  issues:{type:'array',maxItems:128,items:object({timestamp:number(0,300),severity:{enum:['low','medium','high']},confidence:number(0,1),expectedMeaning:string,observedMeaning:string,evidence:strings,rootCause:string,recommendedFix:string,acceptanceCriteria:string})},
  solutionPlan:{type:'object'},revisedTimeline:looseObjects,validationChecklist:strings,limitations:strings
});
export const SCHEMAS=Object.freeze({skimstudio_story_beats:BEAT_SCHEMA,skimstudio_story_plan:STORY_PLAN_SCHEMA,skimstudio_visual_evidence:VISUAL_EVIDENCE_SCHEMA,skimstudio_story_audit:AUDIT_RESPONSE_SCHEMA});
