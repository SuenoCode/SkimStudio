const OPENROUTER_URL='https://openrouter.ai/api/v1/chat/completions';
const MODELS_URL='https://openrouter.ai/api/v1/models';
export const DEFAULT_AUDIT_MODEL='openrouter/free';
export const AUDIT_VERDICTS=['PASS','NEEDS_REVISION','FAIL'];

const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))?Number(value):0));
const text=value=>typeof value==='string'?value.trim():'';
const asArray=value=>Array.isArray(value)?value:[];
const ISSUE_SCHEMA={type:'object',additionalProperties:false,properties:{timestamp:{type:'number'},severity:{type:'string',enum:['low','medium','high']},confidence:{type:'number'},expectedMeaning:{type:'string'},observedMeaning:{type:'string'},evidence:{type:'array',items:{type:'string'}},rootCause:{type:'string'},recommendedFix:{type:'string'},acceptanceCriteria:{type:'string'}},required:['timestamp','severity','confidence','expectedMeaning','observedMeaning','evidence','rootCause','recommendedFix','acceptanceCriteria']};

export const AUDIT_RESPONSE_SCHEMA={
 type:'object',additionalProperties:false,
 properties:{
  verdict:{type:'string',enum:AUDIT_VERDICTS},
  scores:{type:'object',additionalProperties:false,properties:{storyAccuracy:{type:'number'},visualSupport:{type:'number'},captionAccuracy:{type:'number'},pacing:{type:'number'},overall:{type:'number'}},required:['storyAccuracy','visualSupport','captionAccuracy','pacing','overall']},
  reconstructedStory:{type:'string'},
  segments:{type:'array',items:{type:'object',additionalProperties:true}},
  issues:{type:'array',items:ISSUE_SCHEMA},
  solutionPlan:{type:'object',additionalProperties:true},
  revisedTimeline:{type:'array',items:{type:'object',additionalProperties:true}},
  validationChecklist:{type:'array',items:{type:'string'}},
  limitations:{type:'array',items:{type:'string'}}
 },
 required:['verdict','scores','reconstructedStory','segments','issues','solutionPlan','revisedTimeline','validationChecklist','limitations']
};

const BEAT_SCHEMA={
 type:'object',additionalProperties:false,
 properties:{beats:{type:'array',items:{type:'object',additionalProperties:false,properties:{id:{type:'string'},label:{type:'string'},expectedMeaning:{type:'string'},subjects:{type:'array',items:{type:'string'}},requiredEvidence:{type:'array',items:{type:'string'}},start:{type:'number'},end:{type:'number'},importance:{type:'string',enum:['low','medium','high']}},required:['id','label','expectedMeaning','subjects','requiredEvidence','start','end','importance']}}},
 required:['beats']
};

export const STORY_PLAN_SCHEMA={
 type:'object',additionalProperties:false,
 properties:{
  beats:BEAT_SCHEMA.properties.beats,
  shotPlan:{type:'array',items:{type:'object',additionalProperties:false,properties:{sectionIndex:{type:'integer'},shotId:{type:'string'},order:{type:'integer'},sourceStart:{type:'number'},sourceEnd:{type:'number'},speed:{type:'number'},camera:{type:'string',enum:['wide','medium','close','drift','close_left','close_right']},transition:{type:'string',enum:['cut','dissolve','leak','burn']},rationale:{type:'string'}},required:['sectionIndex','shotId','order','sourceStart','sourceEnd','speed','camera','transition','rationale']}},
  payoff:{type:'string'},
  validationChecklist:{type:'array',items:{type:'string'}}
 },
 required:['beats','shotPlan','payoff','validationChecklist']
};

export function scriptLines(script){
 return String(script||'').replace(/\r/g,'\n').split(/\n+|(?<=[.!?])\s+/u).map(line=>line.trim()).filter(Boolean);
}

export function localBeatPlan(script,duration=0){
 const lines=scriptLines(script),total=Math.max(0,Number(duration)||0);
 const labels=['Hook','Context','Development','Evidence or escalation','Payoff','Closing statement or call-to-action'];
 return labels.map((label,index)=>{
  const start=total*index/labels.length,end=total*(index+1)/labels.length;
  const line=lines[Math.min(lines.length-1,Math.floor(index*Math.max(1,lines.length)/labels.length))]||'';
  return{id:'beat-'+(index+1),label,expectedMeaning:line||`The ${label.toLowerCase()} should be understandable from the visuals.`,subjects:[],requiredEvidence:[],start:+start.toFixed(3),end:+end.toFixed(3),importance:index===0||index===4?'high':'medium'};
 });
}

export function normalizeBeats(value,script,duration){
 const raw=Array.isArray(value?.beats)?value.beats:[];
 const fallback=localBeatPlan(script,duration);
 return fallback.map((base,index)=>{
  const beat=raw[index]||{};
  const start=clamp(Number.isFinite(Number(beat.start))?Number(beat.start):base.start,0,Math.max(0,duration));
  const end=Math.max(start,Math.min(Math.max(0,duration),Number.isFinite(Number(beat.end))?Number(beat.end):base.end));
  return{...base,...beat,id:text(beat.id)||base.id,label:text(beat.label)||base.label,expectedMeaning:text(beat.expectedMeaning)||base.expectedMeaning,subjects:asArray(beat.subjects).map(text).filter(Boolean),requiredEvidence:asArray(beat.requiredEvidence).map(text).filter(Boolean),start:+start.toFixed(3),end:+end.toFixed(3),importance:['low','medium','high'].includes(beat.importance)?beat.importance:base.importance};
 });
}

export function normalizeStoryPlan(value,{duration=0,sectionCount=1,shots=[]}={}){
 const raw=value&&typeof value==='object'?value:{};
 const ids=new Set(asArray(shots).map(shot=>text(shot.id)).filter(Boolean));
 const maxSection=Math.max(0,sectionCount-1);
 const plan=asArray(raw.shotPlan).map((item,index)=>{
  const shotId=text(item?.shotId);if(!ids.has(shotId))return null;
  const start=Number(item?.sourceStart),end=Number(item?.sourceEnd);
  const section=Number.isFinite(Number(item?.sectionIndex))?Math.max(0,Math.min(maxSection,Math.round(Number(item.sectionIndex)))):0;
  return{sectionIndex:section,shotId,order:Number.isFinite(Number(item?.order))?Math.max(0,Math.round(Number(item.order))):index,sourceStart:Number.isFinite(start)?start:0,sourceEnd:Number.isFinite(end)?end:start,speed:Number.isFinite(Number(item?.speed))?Number(item.speed):1,camera:['wide','medium','close','drift','close_left','close_right'].includes(item?.camera)?item.camera:'wide',transition:['cut','dissolve','leak','burn'].includes(item?.transition)?item.transition:'cut',rationale:text(item?.rationale)||'OpenRouter selected this shot for the narration beat.'};
 }).filter(Boolean).sort((a,b)=>a.sectionIndex-b.sectionIndex||a.order-b.order);
 return{beats:normalizeBeats(raw,'',duration),shotPlan:plan,payoff:text(raw.payoff),validationChecklist:asArray(raw.validationChecklist).map(text).filter(Boolean)};
}

function parseJson(value){
 if(value&&typeof value==='object')return value;
 const raw=String(value||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 try{return JSON.parse(raw)}catch{
  const start=raw.indexOf('{'),end=raw.lastIndexOf('}');
  if(start>=0&&end>start)return JSON.parse(raw.slice(start,end+1));
  throw new Error('The model returned invalid JSON.');
 }
}

function responseText(body){
 const content=body?.choices?.[0]?.message?.content;
 if(Array.isArray(content))return content.map(part=>part?.text||'').join('');
 return content||'';
}

async function postChat({apiKey,model,messages,responseFormat,maxTokens=3500,signal}){
 const body={model,messages,temperature:0.1,max_tokens:maxTokens};
 if(responseFormat)body.response_format=responseFormat;
 const response=await fetch(OPENROUTER_URL,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','HTTP-Referer':location.origin||'https://skimstudio.local','X-Title':'SkimStudio AI Story Auditor'},body:JSON.stringify(body),signal});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok){const error=new Error(payload?.error?.message||`OpenRouter request failed (${response.status}).`);error.status=response.status;throw error}
 return parseJson(responseText(payload));
}

async function completeJson(options){
 try{return await postChat(options)}catch(error){
  // Some free endpoints do not expose JSON-schema response formatting. The prompt
  // still requires strict JSON, so retry once without the optional response_format.
  if(options.responseFormat&&[400,404,422].includes(error.status))return postChat({...options,responseFormat:null});
  throw error;
 }
}

export async function listFreeVisionModels(apiKey,fetchImpl=fetch){
 const response=await fetchImpl(`${MODELS_URL}?input_modalities=image&output_modalities=text`,{headers:{Authorization:`Bearer ${apiKey}`}});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(body?.error?.message||`Could not load OpenRouter models (${response.status}).`);
 return asArray(body.data).filter(model=>{
  const pricing=model.pricing||{};
  const free=String(model.id||'').includes(':free')||model.id===DEFAULT_AUDIT_MODEL||[pricing.prompt,pricing.completion,pricing.image,pricing.request].every(value=>value==null||Number(value)===0||value==='0');
  return free&&model.architecture?.input_modalities?.includes('image');
 }).map(model=>({id:model.id,name:model.name||model.id,contextLength:model.context_length||0})).sort((a,b)=>a.name.localeCompare(b.name));
}

export async function sampleExportFrames(blob,{duration,captions=[],edl=[],beats=[],count=12,maxWidth=768,onProgress=()=>{}}={}){
 if(!blob)throw new Error('Export a video before running the story audit.');
 const video=document.createElement('video');video.preload='auto';video.muted=true;video.playsInline=true;
 const url=URL.createObjectURL(blob);video.src=url;
 try{
  await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error('The exported MP4 could not be decoded for frame sampling.'))});
  const actualDuration=Number.isFinite(video.duration)?video.duration:duration;
  const candidates=[];
  const add=(time,reason,priority=1)=>{if(!Number.isFinite(time)||time<0||time>actualDuration)return;candidates.push({time:Math.max(0,Math.min(actualDuration-.001,time)),reason,priority})};
  add(0,'beginning',100);add(actualDuration/2,'middle',100);add(Math.max(0,actualDuration-.05),'ending',100);
  const timeline=[];let cursor=0;
  for(const shot of asArray(edl)){const start=Number.isFinite(shot.timelineStart)?shot.timelineStart:cursor;const end=Number.isFinite(shot.timelineEnd)?shot.timelineEnd:start+Math.max(0,(shot.e-shot.s)/(shot.sp||1));timeline.push({start,end});cursor=end;}
  timeline.forEach((shot,index)=>{add(shot.start,`cut ${index+1} start`,90);add(Math.max(0,shot.end-.04),`cut ${index+1} end`,80);if(shot.end-shot.start<1.8)add((shot.start+shot.end)/2,`rapid shot ${index+1}`,70)});
  asArray(captions).forEach((cue,index)=>{add(cue.s,`caption ${index+1} start`,60);add(cue.e-.02,`caption ${index+1} end`,50)});
  asArray(beats).forEach(beat=>{add(beat.start,`${beat.label||'beat'} start`,85);add(beat.end-.02,`${beat.label||'beat'} end`,75)});
  candidates.sort((a,b)=>b.priority-a.priority||a.time-b.time);
  const unique=[];for(const candidate of candidates)if(!unique.some(item=>Math.abs(item.time-candidate.time)<.08))unique.push(candidate);
  const wanted=Math.max(3,Math.min(32,Math.round(Number(count)||12)));
  if(unique.length<wanted){for(let i=0;i<wanted;i++)add(actualDuration*(i/Math.max(1,wanted-1)),'uniform coverage',20)}
  const selected=[];for(const candidate of candidates.concat([{time:0,reason:'beginning',priority:100},{time:actualDuration/2,reason:'middle',priority:100},{time:Math.max(0,actualDuration-.05),reason:'ending',priority:100}])){
   if(selected.length>=wanted)break;if(selected.some(item=>Math.abs(item.time-candidate.time)<.08))continue;selected.push(candidate);
  }
  if(selected.length<wanted){const fill=unique.concat(candidates).sort((a,b)=>a.time-b.time);for(const candidate of fill){if(selected.length>=wanted)break;if(!selected.some(item=>Math.abs(item.time-candidate.time)<.08))selected.push(candidate)}}
  selected.sort((a,b)=>a.time-b.time);
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  const seek=time=>new Promise((resolve,reject)=>{const done=()=>{video.removeEventListener('seeked',done);video.removeEventListener('error',fail);resolve()};const fail=()=>{video.removeEventListener('seeked',done);video.removeEventListener('error',fail);reject(new Error('The exported video could not seek to a sampled frame.'))};video.addEventListener('seeked',done,{once:true});video.addEventListener('error',fail,{once:true});video.currentTime=Math.max(0,Math.min(actualDuration-.001,time));});
  const frames=[];
  for(let index=0;index<selected.length;index++){
   const candidate=selected[index];await seek(candidate.time);const scale=Math.min(1,maxWidth/video.videoWidth);canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));ctx.drawImage(video,0,0,canvas.width,canvas.height);frames.push({timestamp:+candidate.time.toFixed(3),reason:candidate.reason,width:canvas.width,height:canvas.height,dataUrl:canvas.toDataURL('image/jpeg',.78)});onProgress((index+1)/selected.length,frames.at(-1));
  }
  return{duration:actualDuration,width:video.videoWidth,height:video.videoHeight,frames};
 }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url)}
}

function beatPrompt(script,duration){
 return `Analyze this narration script before seeing any video. Divide it into exactly six story beats: Hook, Context, Development, Evidence or escalation, Payoff, and Closing statement or call-to-action. Return JSON only matching the supplied schema. Each beat must state expected meaning, important subjects, required visual evidence, approximate seconds from 0 to ${duration.toFixed(3)}, and importance. Script:\n${script}`;
}

function auditPrompt(context){
 return `Audit the final rendered video against the narration plan. The frames are timestamped and come from the exported MP4, not the editor preview. Do not infer unseen frames. Distinguish verified mismatch, possible mismatch, and uncertainty caused by sparse sampling. Return JSON only matching the supplied schema. Confidence is a number from 0 to 1; scores are 0 to 100.\n\nNARRATION SCRIPT:\n${context.script}\n\nSCRIPT BEATS:\n${JSON.stringify(context.beats)}\n\nCAPTIONS WITH TIMING:\n${JSON.stringify(context.captions)}\n\nVOICE TRANSCRIPT WHEN AVAILABLE:\n${context.transcript||'Unavailable'}\n\nEXPORT:\n${JSON.stringify({duration:context.duration,resolution:context.resolution})}\n\nTIMELINE / EDL:\n${JSON.stringify(context.edl)}\n\nFor every issue include timestamp, severity, confidence, expectedMeaning, observedMeaning, evidence, rootCause, recommendedFix, and acceptanceCriteria. PASS requires no high-severity verified mismatch; NEEDS_REVISION is for fixable or uncertain concerns; FAIL is for a major verified story contradiction, missing payoff, or unusable captions.`;
}

function plannerPrompt(context){
 return `You are the lead editor for a short-form commentary video. OpenRouter is the editorial mind: decide the intended story, pacing, shot order, source in/out points, camera emphasis, and transitions. Return JSON only matching the supplied schema.

First divide the narration into the six beats Hook, Context, Development, Evidence or escalation, Payoff, and Closing statement or call-to-action. Then choose the best available source shots for each numbered timeline section. Use only exact shot IDs from SOURCE SHOTS; never invent an ID. Prefer visual evidence that supports the words, avoid repeating the same shot unless necessary, and make the final section deliver the payoff or closing promise. The browser will clamp unsafe source ranges and validate the final EDL.

NARRATION SCRIPT:
${context.script}

TIMELINE SECTIONS:
${JSON.stringify(context.sections)}

SOURCE SHOTS:
${JSON.stringify(context.shots)}

REPRESENTATIVE FRAME ORDER:
${JSON.stringify(asArray(context.shotFrames).map(frame=>({id:frame.id,timestamp:frame.timestamp})))}

For every shotPlan item, sectionIndex must refer to TIMELINE SECTIONS, order is editorial order within that section, sourceStart/sourceEnd are source-video seconds, speed must be between 0.25 and 2.5, and rationale must explain the match. Use the supplied representative frame images when present, but do not claim certainty beyond the evidence.`;
}

export function normalizeAudit(value,context){
 const raw=value&&typeof value==='object'?value:{};
 const scores=raw.scores||{};
 const issues=asArray(raw.issues).map(issue=>({...issue,timestamp:Number.isFinite(Number(issue.timestamp))?Number(issue.timestamp):null,severity:['low','medium','high'].includes(issue.severity)?issue.severity:'medium',confidence:clamp(issue.confidence,0,1),expectedMeaning:text(issue.expectedMeaning),observedMeaning:text(issue.observedMeaning),evidence:asArray(issue.evidence).map(text).filter(Boolean),rootCause:text(issue.rootCause),recommendedFix:text(issue.recommendedFix),acceptanceCriteria:text(issue.acceptanceCriteria)}));
 const limitations=asArray(raw.limitations).map(text).filter(Boolean);if(!limitations.some(item=>/frame sampling/i.test(item)))limitations.push(`Evidence is limited to ${context.frames.length} sampled frames; unseen frames may contain additional mismatches.`);if(!limitations.some(item=>/audio|transcript/i.test(item)))limitations.push('Visual audit confidence does not replace listening review or a reliable voice transcript.');
 return{verdict:AUDIT_VERDICTS.includes(raw.verdict)?raw.verdict:'NEEDS_REVISION',scores:{storyAccuracy:clamp(scores.storyAccuracy),visualSupport:clamp(scores.visualSupport),captionAccuracy:clamp(scores.captionAccuracy),pacing:clamp(scores.pacing),overall:clamp(scores.overall)},reconstructedStory:text(raw.reconstructedStory),segments:asArray(raw.segments),issues,solutionPlan:raw.solutionPlan&&typeof raw.solutionPlan==='object'?raw.solutionPlan:{},revisedTimeline:asArray(raw.revisedTimeline),validationChecklist:asArray(raw.validationChecklist).map(text).filter(Boolean),limitations,beats:context.beats,frames:context.frames,model:context.model,exportMeta:{duration:context.duration,resolution:context.resolution},generatedAt:new Date().toISOString()};
}

export async function runStoryAudit({apiKey,model=DEFAULT_AUDIT_MODEL,script,captions=[],transcript=null,duration=0,resolution={width:0,height:0},edl=[],frames=[],onProgress=()=>{},signal}={}){
 if(!text(apiKey))throw new Error('Enter an OpenRouter API key to run the story audit.');
 if(!text(script))throw new Error('Add a narration script before running the story audit.');
 if(!frames.length)throw new Error('No exported frames were sampled. Export the video again and retry.');
 const beatResult=await completeJson({apiKey,model,messages:[{role:'system',content:'You are a story editor. Return only valid JSON.'},{role:'user',content:beatPrompt(script,duration)}],responseFormat:{type:'json_schema',json_schema:{name:'skimstudio_story_beats',strict:true,schema:BEAT_SCHEMA}},maxTokens:1800,signal});
 const beats=normalizeBeats(beatResult,script,duration);onProgress(.28,'Script beats extracted. Auditing sampled export frames…');
 const context={script,captions,transcript,duration,resolution,edl,frames,beats,model};
 const content=[{type:'text',text:auditPrompt(context)},...frames.map(frame=>({type:'image_url',image_url:{url:frame.dataUrl,detail:'low'}}))];
 const result=await completeJson({apiKey,model,messages:[{role:'system',content:'You are a rigorous multimodal video auditor. Return only valid JSON.'},{role:'user',content}],responseFormat:{type:'json_schema',json_schema:{name:'skimstudio_story_audit',strict:true,schema:AUDIT_RESPONSE_SCHEMA}},maxTokens:4200,signal});
 onProgress(1,'Story audit complete.');return normalizeAudit(result,context);
}

export async function runStoryPlanner({apiKey,model=DEFAULT_AUDIT_MODEL,script,duration=0,sections=[],shots=[],shotFrames=[],onProgress=()=>{},signal}={}){
 if(!text(apiKey))throw new Error('Enter an OpenRouter API key to build the commentary story.');
 if(!text(script))throw new Error('Add a narration script before building the commentary story.');
 if(!shots.length)throw new Error('No analyzed source shots are available for the story planner.');
 const context={script,duration,sections,shots,shotFrames,model};
 const content=[{type:'text',text:plannerPrompt(context)},...asArray(shotFrames).map(frame=>({type:'image_url',image_url:{url:frame.dataUrl,detail:'low'}}))];
 const result=await completeJson({apiKey,model,messages:[{role:'system',content:'You are the lead video editor. Return only valid JSON.'},{role:'user',content}],responseFormat:{type:'json_schema',json_schema:{name:'skimstudio_story_plan',strict:true,schema:STORY_PLAN_SCHEMA}},maxTokens:4200,signal});
 const plan=normalizeStoryPlan(result,{duration,sectionCount:sections.length,shots});
 onProgress(1,`OpenRouter planned ${plan.shotPlan.length} source shots.`);
 return plan;
}

export function auditMarkdown(audit){
 if(!audit)return '';
 const lines=['# SkimStudio AI Story Audit','',`- Verdict: **${audit.verdict}**`,`- Model: ${audit.model||'unknown'}`,`- Export: ${audit.exportMeta?.resolution?.width||'?'}×${audit.exportMeta?.resolution?.height||'?'} / ${(audit.exportMeta?.duration||0).toFixed(2)}s`,`- Generated: ${audit.generatedAt||'unknown'}`,'','## Scores','',...Object.entries(audit.scores||{}).map(([key,value])=>`- ${key}: ${value}/100`),'','## Reconstructed story','',audit.reconstructedStory||'No reconstruction returned.','','## Issues',''];
 if(audit.issues?.length)for(const issue of audit.issues)lines.push(`### ${issue.timestamp==null?'Unknown time':`${Number(issue.timestamp).toFixed(2)}s`} — ${issue.severity} / ${Math.round((issue.confidence||0)*100)}% confidence`,'',`- Expected: ${issue.expectedMeaning||'—'}`,`- Observed: ${issue.observedMeaning||'—'}`,`- Evidence: ${(issue.evidence||[]).join('; ')||'—'}`,`- Root cause: ${issue.rootCause||'—'}`,`- Recommended fix: ${issue.recommendedFix||'—'}`,`- Acceptance criteria: ${issue.acceptanceCriteria||'—'}`,'');
 else lines.push('No issues returned.','');
 lines.push('## Segments','',...(audit.segments?.length?[...audit.segments].map(segment=>`- ${JSON.stringify(segment)}`):['No segment analysis returned.']),'','## Proposed revised timeline','',...(audit.revisedTimeline?.length?[...audit.revisedTimeline].map(segment=>`- ${JSON.stringify(segment)}`):['No revised timeline returned.']),'','## Validation checklist','',...(audit.validationChecklist||[]).map(item=>`- ${item}`),'','## Limitations','',...(audit.limitations||[]).map(item=>`- ${item}`));
 return lines.join('\n');
}
