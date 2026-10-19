import Ajv from 'ajv';
import {AIError} from './provider.js';
import {SCHEMAS} from './schemas.js';

const ajv=new Ajv({allErrors:true,strict:false,coerceTypes:false,useDefaults:false,removeAdditional:false});
const validators=new Map(Object.entries(SCHEMAS).map(([name,schema])=>[name,ajv.compile(schema)]));
export function validateResponse(name,value){
  const validator=validators.get(name);
  if(!validator)throw new AIError('INVALID_REQUEST','Unknown AI response schema.');
  if(!validator(value))throw new AIError('INVALID_MODEL_OUTPUT','The AI response did not match the required schema.',{status:422,diagnostics:validator.errors.slice(0,8).map(({instancePath,keyword})=>({path:instancePath,rule:keyword}))});
  return value;
}

export function parseModelJSON(content){
  if(typeof content!=='string')throw new AIError('INVALID_MODEL_OUTPUT','The model did not return JSON text.',{status:422});
  try{return JSON.parse(content.trim().replace(/^```json\s*([\s\S]*?)\s*```$/i,'$1'));}
  catch{throw new AIError('INVALID_MODEL_OUTPUT','The model returned invalid or truncated JSON.',{status:422});}
}

export function validatePlanReferences(plan,{duration,sectionCount,shots}){
  validateResponse('skimstudio_story_plan',plan);
  const sources=new Map(shots.map(shot=>[shot.id,shot]));
  const seen=new Set(),orders=new Map();
  for(const item of plan.shotPlan){
    const shot=sources.get(item.shotId);
    const start=shot?.sourceStart??shot?.s,end=shot?.sourceEnd??shot?.e;
    if(!shot||!Number.isFinite(start)||!Number.isFinite(end))throw new AIError('INVALID_MODEL_OUTPUT','The plan references an unknown source shot.',{status:422});
    if(item.sectionIndex>=sectionCount)throw new AIError('INVALID_MODEL_OUTPUT','The plan references an unavailable narration section.',{status:422});
    if(item.sourceEnd<=item.sourceStart||item.sourceStart<start||item.sourceEnd>end)throw new AIError('INVALID_MODEL_OUTPUT','A planned source interval is outside its available footage.',{status:422});
    if(item.sourceEnd-item.sourceStart<.6)throw new AIError('UNSUPPORTED_PLAN','This planner requires source intervals of at least 0.6 seconds. Revise the plan.',{status:422});
    if(seen.has(item.shotId))throw new AIError('UNSUPPORTED_PLAN','This planner cannot yet reuse a source shot. Choose another shot or revise the plan.',{status:422});
    seen.add(item.shotId);
    const sectionOrders=orders.get(item.sectionIndex)||[];
    if(sectionOrders.includes(item.order))throw new AIError('INVALID_MODEL_OUTPUT','The plan has duplicate shot order values.',{status:422});
    sectionOrders.push(item.order);orders.set(item.sectionIndex,sectionOrders);
  }
  for(let i=0;i<sectionCount;i++){
    const values=orders.get(i)?.sort((a,b)=>a-b);
    if(!values?.length||values.length>5||values.some((value,index)=>value!==index))throw new AIError('INVALID_MODEL_OUTPUT','The AI plan must cover every narration section in consecutive shot order (maximum five shots per section).',{status:422});
  }
  validateBeatTimes(plan.beats,duration);
  return structuredClone(plan);
}

export function validateBeatTimes(beats,duration){
  let at=0;const ids=new Set();
  for(const beat of beats){
    if(ids.has(beat.id)||beat.start<at-.001||beat.end<beat.start||beat.end>duration+.001)throw new AIError('INVALID_MODEL_OUTPUT','AI story beat timestamps are invalid.',{status:422});
    ids.add(beat.id);at=beat.end;
  }
  return beats;
}
