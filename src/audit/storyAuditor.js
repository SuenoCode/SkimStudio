import {browserAI} from '../ai/proxyClient.js';
import {AIError} from '../ai/provider.js';
import {validateResponse,validatePlanReferences,validateBeatTimes} from '../ai/validateResponse.js';
import {waitMedia,seekFrame} from '../media/decoder.js';
import {AUDIT_RESPONSE_SCHEMA,AUDIT_VERDICTS,STORY_PLAN_SCHEMA,VISUAL_EVIDENCE_SCHEMA} from '../ai/schemas.js';
export {AUDIT_RESPONSE_SCHEMA,AUDIT_VERDICTS,STORY_PLAN_SCHEMA,VISUAL_EVIDENCE_SCHEMA};
export const DEFAULT_AUDIT_MODEL='openrouter/free';

const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))?Number(value):0));
const text=value=>typeof value==='string'?value.trim():'';
const asArray=value=>Array.isArray(value)?value:[];

export function scriptLines(script){
 return String(script||'').replace(/\r/g,'\n').split(/\n+|(?<=[.!?])\s+/u).map(line=>line.trim()).filter(Boolean);
}

export function localBeatPlan(script,duration=0){
 const lines=scriptLines(script),total=Math.max(0,Number(duration)||0);
 const labels=['Hook','Context','Development','Payoff','Ending'];
 return labels.map((label,index)=>{
  const start=total*index/labels.length,end=total*(index+1)/labels.length;
  const line=lines[Math.min(lines.length-1,Math.floor(index*Math.max(1,lines.length)/labels.length))]||'';
  return{id:'beat-'+(index+1),label,expectedMeaning:line||`The ${label.toLowerCase()} should be understandable from the visuals.`,subjects:[],requiredEvidence:[],start:+start.toFixed(3),end:+end.toFixed(3),importance:index===0||index===3?'high':'medium'};
 });
}

export function normalizeBeats(value,script,duration){
 const raw=Array.isArray(value?.beats)?value.beats:[];
 const fallback=localBeatPlan(script,duration);
 return fallback.map((base,index)=>{
  const beat=raw[index]||{};
  const start=clamp(Number.isFinite(Number(beat.start))?Number(beat.start):base.start,0,Math.max(0,duration));
  const end=Math.max(start,Math.min(Math.max(0,duration),Number.isFinite(Number(beat.end))?Number(beat.end):base.end));
  return{...base,...beat,id:text(beat.id)||base.id,label:base.label,expectedMeaning:text(beat.expectedMeaning)||base.expectedMeaning,subjects:asArray(beat.subjects).map(text).filter(Boolean),requiredEvidence:asArray(beat.requiredEvidence).map(text).filter(Boolean),start:+start.toFixed(3),end:+end.toFixed(3),importance:['low','medium','high'].includes(beat.importance)?beat.importance:base.importance};
 });
}

export function normalizeStoryPlan(value,{duration=0,sectionCount=1,shots=[]}={}){
 return validatePlanReferences(value,{duration,sectionCount,shots});
}

export async function listFreeVisionModels({provider=browserAI,signal}={}){
 const result=await provider.catalog({signal});
 return result.models||result;
}

export async function sampleExportFrames(blob,{duration,captions=[],edl=[],beats=[],count=12,maxWidth=512,onProgress=()=>{},signal}={}){
 if(!blob)throw new Error('Export a video before running the story audit.');
 const video=document.createElement('video');video.preload='auto';video.muted=true;video.playsInline=true;
 const url=URL.createObjectURL(blob);video.src=url;
 try{
  await waitMedia(video,15000,()=>signal?.aborted);
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
  const wanted=Math.max(3,Math.min(12,Math.round(Number(count)||12)));
  if(unique.length<wanted){for(let i=0;i<wanted;i++)add(actualDuration*(i/Math.max(1,wanted-1)),'uniform coverage',20)}
  const selected=[];for(const candidate of candidates.concat([{time:0,reason:'beginning',priority:100},{time:actualDuration/2,reason:'middle',priority:100},{time:Math.max(0,actualDuration-.05),reason:'ending',priority:100}])){
   if(selected.length>=wanted)break;if(selected.some(item=>Math.abs(item.time-candidate.time)<.08))continue;selected.push(candidate);
  }
  if(selected.length<wanted){const fill=unique.concat(candidates).sort((a,b)=>a.time-b.time);for(const candidate of fill){if(selected.length>=wanted)break;if(!selected.some(item=>Math.abs(item.time-candidate.time)<.08))selected.push(candidate)}}
  selected.sort((a,b)=>a.time-b.time);
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  const frames=[];
  for(let index=0;index<selected.length;index++){
   const candidate=selected[index];await seekFrame(video,candidate.time,()=>signal?.aborted);const scale=Math.min(1,maxWidth/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));ctx.drawImage(video,0,0,canvas.width,canvas.height);frames.push({id:`export-frame-${index+1}`,timestamp:+candidate.time.toFixed(3),reason:candidate.reason,width:canvas.width,height:canvas.height,dataUrl:canvas.toDataURL('image/jpeg',.72)});onProgress((index+1)/selected.length,frames.at(-1));
  }
  return{duration:actualDuration,width:video.videoWidth,height:video.videoHeight,frames};
 }finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url)}
}

function beatPrompt(script,duration){
 return `Analyze this narration script before seeing any video. Divide it into exactly five story beats: Hook, Context, Development, Payoff, and Ending. Return JSON only matching the supplied schema. Each beat must state expected meaning, important subjects, required visual evidence, approximate seconds from 0 to ${duration.toFixed(3)}, and importance. Script:\n${script}`;
}

function auditPrompt(context){
 return `Audit the final rendered video against the narration plan. The frames are timestamped and come from the exported MP4, not the editor preview. Do not infer unseen frames. Distinguish verified mismatch, possible mismatch, and uncertainty caused by sparse sampling. Return JSON only matching the supplied schema. Confidence is a number from 0 to 1; scores are 0 to 100.\n\nNARRATION SCRIPT:\n${context.script}\n\nSCRIPT BEATS:\n${JSON.stringify(context.beats)}\n\nCAPTIONS WITH TIMING:\n${JSON.stringify(context.captions)}\n\nVOICE TRANSCRIPT WHEN AVAILABLE:\n${context.transcript||'Unavailable'}\n\nEXPORT:\n${JSON.stringify({duration:context.duration,resolution:context.resolution})}\n\nTIMELINE / EDL:\n${JSON.stringify(context.edl)}\n\nFor every issue include timestamp, severity, confidence, expectedMeaning, observedMeaning, evidence, rootCause, recommendedFix, and acceptanceCriteria. PASS requires no high-severity verified mismatch; NEEDS_REVISION is for fixable or uncertain concerns; FAIL is for a major verified story contradiction, missing payoff, or unusable captions.`;
}

function plannerPrompt(context,{compact=false}={}){
 if(compact)return `Create a concise edit plan for this short-form commentary video. Return JSON only matching the supplied schema. Use the analyzed story beats below and preserve their intent. Address the repair findings where the available footage supports a fix; do not invent evidence. Choose exactly one source shot for every timeline section to keep the plan within the model's output limit. Use exact shot IDs only, each at most once. Keep each rationale to one short sentence (12 words maximum), payoff to one sentence, and checklist to at most four short items. Repeat each candidate's exact sourceStart/sourceEnd values and set speed to 1; SkimStudio calculates trims and all timeline timing. Set order to 0 for each section.

NARRATION SCRIPT:
${context.script}

TIMELINE SECTIONS:
${JSON.stringify(context.sections)}

ANALYZED STORY BEATS:
${JSON.stringify(context.beats||[])}

VISUAL EVIDENCE OBSERVATIONS:
${JSON.stringify(context.visualEvidence||[])}

AUDIT REPAIR FINDINGS:
${JSON.stringify(context.repairContext||[])}

SOURCE SHOTS:
${JSON.stringify(context.shots)}

EDITING SETTINGS:
${JSON.stringify(context.settings||{})}

REPRESENTATIVE FRAME ORDER:
${JSON.stringify(asArray(context.shotFrames).map(frame=>({id:frame.id,timestamp:frame.timestamp})))}

Use supplied representative images as evidence when present; do not claim certainty beyond them.`;
 return `You are the story reasoning and visual matching stage for a short-form commentary video. Use the analyzed story beats to understand the intended narrative, then select matching source shots and explain the visual match. Address audit repair findings where the available footage supports a fix; treat them as review guidance, not permission to claim unseen evidence. SkimStudio deterministically chooses trim points, speed, narration timing, and timeline duration. Set sourceStart/sourceEnd to the exact candidate bounds and speed to 1 only because the response schema requires these fields; they are not executable instructions. Return JSON only matching the supplied schema.

Choose one to five available source shots for EVERY numbered timeline section. Use only exact shot IDs from SOURCE SHOTS, each at most once in the entire plan; never invent an ID. Order starts at zero and is consecutive within each section. Repeat each candidate's exact sourceStart and sourceEnd values and set speed to 1. Prefer visual evidence that supports the analyzed beats, and make the final section deliver the payoff or closing promise. Invalid proposals are rejected; unsupported reuse is not repaired silently.

NARRATION SCRIPT:
${context.script}

TIMELINE SECTIONS:
${JSON.stringify(context.sections)}

ANALYZED STORY BEATS:
${JSON.stringify(context.beats||[])}

VISUAL EVIDENCE OBSERVATIONS:
${JSON.stringify(context.visualEvidence||[])}

AUDIT REPAIR FINDINGS:
${JSON.stringify(context.repairContext||[])}

SOURCE SHOTS:
${JSON.stringify(context.shots)}

EDITING SETTINGS:
${JSON.stringify(context.settings||{})}

REPRESENTATIVE FRAME ORDER:
${JSON.stringify(asArray(context.shotFrames).map(frame=>({id:frame.id,timestamp:frame.timestamp})))}

For every shotPlan item, sectionIndex must refer to TIMELINE SECTIONS, order is editorial order within that section, sourceStart/sourceEnd are source-video seconds with at least 0.6 seconds per source interval, speed must be between 0.25 and 2.5, and rationale must explain the match. Use the supplied representative frame images when present, but do not claim certainty beyond the evidence.`;
}

export function normalizeAudit(value,context){
 const raw=value&&typeof value==='object'?value:{};
 const scores=raw.scores||{};
 const issues=asArray(raw.issues).map(issue=>({...issue,timestamp:Number.isFinite(Number(issue.timestamp))?Number(issue.timestamp):null,severity:['low','medium','high'].includes(issue.severity)?issue.severity:'medium',confidence:clamp(issue.confidence,0,1),expectedMeaning:text(issue.expectedMeaning),observedMeaning:text(issue.observedMeaning),evidence:asArray(issue.evidence).map(text).filter(Boolean),rootCause:text(issue.rootCause),recommendedFix:text(issue.recommendedFix),acceptanceCriteria:text(issue.acceptanceCriteria)}));
 const limitations=asArray(raw.limitations).map(text).filter(Boolean);if(!limitations.some(item=>/frame sampling/i.test(item)))limitations.push(`Evidence is limited to ${context.frames.length} sampled frames; unseen frames may contain additional mismatches.`);if(!limitations.some(item=>/audio|transcript/i.test(item)))limitations.push('Visual audit confidence does not replace listening review or a reliable voice transcript.');
 return{verdict:AUDIT_VERDICTS.includes(raw.verdict)?raw.verdict:'NEEDS_REVISION',scores:{storyAccuracy:clamp(scores.storyAccuracy),visualSupport:clamp(scores.visualSupport),captionAccuracy:clamp(scores.captionAccuracy),pacing:clamp(scores.pacing),overall:clamp(scores.overall)},reconstructedStory:text(raw.reconstructedStory),segments:asArray(raw.segments),issues,solutionPlan:raw.solutionPlan&&typeof raw.solutionPlan==='object'?raw.solutionPlan:{},revisedTimeline:asArray(raw.revisedTimeline),validationChecklist:asArray(raw.validationChecklist).map(text).filter(Boolean),limitations,beats:context.beats,frames:context.frames,model:context.model,exportMeta:{duration:context.duration,resolution:context.resolution},generatedAt:new Date().toISOString()};
}

export async function extractScriptBeats({model=DEFAULT_AUDIT_MODEL,script,duration,signal,provider=browserAI}){
 validatePlanningInput(script,duration);
 const result=await provider.completeJSON({model,messages:[{role:'system',content:'You are a story editor.'},{role:'user',content:beatPrompt(script,duration)}],schemaName:'skimstudio_story_beats',maxTokens:1800,signal});
 validateResponse('skimstudio_story_beats',result.data);
 validateBeatTimes(result.data.beats,duration);
 return {beats:normalizeBeats(result.data,script,duration),metadata:result.metadata};
}

export async function analyzeShotVisualEvidence({model=DEFAULT_AUDIT_MODEL,script='',shots=[],frames=[],provider=browserAI,signal}={}){
 if(!shots.length||!frames.length)throw new Error('Analyze footage needs candidate shots and representative frames.');
 const shotIds=new Set(shots.map(shot=>shot.id));
 const frameById=new Map(frames.map(frame=>[frame.id,frame]));
 const visibleShots=shots.filter(shot=>frameById.has(shot.id));
 const prompt=`Describe only what is visible in the supplied representative frames. Return one observation for every supplied frame, using its exact shotId and evidenceId (which are the frame ID). Identify visible subjects, observable actions, and evidence relevant to the narration. Do not infer identity, off-screen events, or details hidden by the single-frame sample. Motion measurements are supplied separately from SkimStudio's deterministic footage analysis; do not invent motion from a still image. Confidence reflects only the visible evidence.\n\nNARRATION SCRIPT:\n${script}\n\nCANDIDATE SHOT SIGNALS:\n${JSON.stringify(visibleShots.map(shot=>({shotId:shot.id,sourceStart:shot.s,sourceEnd:shot.e,measuredMotion:shot.motion,measuredAction:shot.action,structuralEvents:(shot.events||[]).map(event=>event.t)})))}\n\nReturn concise JSON observations for all ${visibleShots.length} frames.`;
 const content=[{type:'text',text:prompt},...imageParts(frames)];
 const result=await provider.completeJSON({model,messages:[{role:'system',content:'You are a careful visual evidence annotator.'},{role:'user',content}],schemaName:'skimstudio_visual_evidence',maxTokens:2200,signal});
 validateResponse('skimstudio_visual_evidence',result.data);
 const seen=new Set();
 const observations=result.data.observations.map(item=>{
  const frame=frameById.get(item.evidenceId);
  if(!shotIds.has(item.shotId)||!frame||frame.id!==item.shotId||seen.has(item.shotId))throw new AIError('INVALID_MODEL_OUTPUT','Visual evidence must cite each sampled candidate frame by its exact shot ID.',{status:422});
  seen.add(item.shotId);
  return{shotId:item.shotId,evidenceId:item.evidenceId,subjects:item.subjects.map(text).filter(Boolean),visibleActions:item.visibleActions.map(text).filter(Boolean),visualEvidence:item.visualEvidence.map(text).filter(Boolean),confidence:clamp(item.confidence,0,1),uncertainty:text(item.uncertainty)};
 });
 if(visibleShots.some(shot=>!seen.has(shot.id)))throw new AIError('INVALID_MODEL_OUTPUT','Visual evidence omitted a sampled shot.',{status:422});
 return{observations,metadata:result.metadata};
}

function imageParts(frames){
 return frames.flatMap((frame,index)=>[
  {type:'text',text:JSON.stringify({evidenceId:frame.id||`frame-${index+1}`,sourceTimestampSeconds:frame.timestamp,reason:frame.reason||'representative source frame'})},
  {type:'image_url',image_url:{url:frame.dataUrl,detail:'low'}}
 ]);
}

export async function runStoryAudit({model=DEFAULT_AUDIT_MODEL,script,captions=[],transcript=null,duration=0,resolution={width:0,height:0},edl=[],frames=[],beatResult,provider=browserAI,onProgress=()=>{},signal}={}){
 if(!text(script))throw new Error('Add a narration script before running the story audit.');
 if(!frames.length)throw new Error('No exported frames were sampled. Export the video again and retry.');
 const extracted=beatResult||await extractScriptBeats({model,script,duration,provider,signal});
 validateResponse('skimstudio_story_beats',{beats:extracted.beats});validateBeatTimes(extracted.beats,duration);
 const beats=extracted.beats;onProgress(.28,'Script beats extracted. Auditing sampled export frames…');
 const context={script,captions,transcript,duration,resolution,edl,frames,beats,model};
 const content=[{type:'text',text:auditPrompt(context)},...imageParts(frames)];
 const result=await provider.completeJSON({model,messages:[{role:'system',content:'You are a rigorous multimodal video auditor.'},{role:'user',content}],schemaName:'skimstudio_story_audit',maxTokens:4096,signal});
 validateResponse('skimstudio_story_audit',result.data);
 if(result.data.issues.some(issue=>issue.timestamp>duration))throw new AIError('INVALID_MODEL_OUTPUT','Audit issue timestamps exceed this export.',{status:422});
 const audit=normalizeAudit(result.data,context);
 audit.model=result.metadata.actualModel;audit.requestMetadata=[extracted.metadata,result.metadata];
 if(audit.verdict==='PASS'&&audit.issues.some(issue=>issue.severity==='high')){audit.verdict='NEEDS_REVISION';audit.limitations.push('PASS was inconsistent with a high-severity issue; review is required.');}
 onProgress(1,'Story audit complete.');return audit;
}

export async function runStoryPlanner({model=DEFAULT_AUDIT_MODEL,script,duration=0,sections=[],beats=[],visualEvidence=[],repairContext=[],shots=[],shotFrames=[],settings={},provider=browserAI,onProgress=()=>{},signal}={}){
 validatePlanningInput(script,duration);
 if(!shots.length)throw new Error('No analyzed source shots are available for the story planner.');
 if(shots.length>128||!sections.length||sections.length>128)throw new AIError('RESOURCE_LIMIT','Reduce the number of source candidates or narration sections.');
 const context={script,duration,sections,beats,visualEvidence,repairContext,shots,shotFrames,settings,model};
 const messages=prompt=>[{role:'system',content:'You are the lead video editor.'},{role:'user',content:[{type:'text',text:prompt},...imageParts(shotFrames)]}];
 let result;
 try{
  result=await provider.completeJSON({model,messages:messages(plannerPrompt(context)),schemaName:'skimstudio_story_plan',maxTokens:4096,signal});
 }catch(error){
  if(!['OUTPUT_TRUNCATED','OUTPUT_INCOMPLETE'].includes(error.code))throw error;
  onProgress(.8,'The first plan was incomplete. Retrying once with a compact plan…');
  result=await provider.completeJSON({model,messages:messages(plannerPrompt(context,{compact:true})),schemaName:'skimstudio_story_plan',maxTokens:4096,signal});
  result.metadata.recoveredFromIncompleteOutput=true;
 }
 const plan=normalizeStoryPlan(result.data,{duration,sectionCount:sections.length,shots});
 plan.requestMetadata=result.metadata;
 onProgress(1,`OpenRouter planned ${plan.shotPlan.length} source shots.`);
 return plan;
}

function validatePlanningInput(script,duration){
 if(!text(script))throw new AIError('INVALID_REQUEST','Add a narration script before using AI.');
 if(script.length>20000)throw new AIError('RESOURCE_LIMIT','The narration script exceeds 20,000 characters.');
 if(!Number.isFinite(duration)||duration<=0||duration>300)throw new AIError('INVALID_REQUEST','AI narration duration must be positive and at most five minutes.');
}

export function auditMarkdown(audit){
 if(!audit)return '';
 const lines=['# SkimStudio AI Story Audit','',`- Verdict: **${audit.verdict}**`,`- Model: ${audit.model||'unknown'}`,`- Export: ${audit.exportMeta?.resolution?.width||'?'}×${audit.exportMeta?.resolution?.height||'?'} / ${(audit.exportMeta?.duration||0).toFixed(2)}s`,`- Generated: ${audit.generatedAt||'unknown'}`,'','## Scores','',...Object.entries(audit.scores||{}).map(([key,value])=>`- ${key}: ${value}/100`),'','## Reconstructed story','',audit.reconstructedStory||'No reconstruction returned.','','## Issues',''];
 if(audit.issues?.length)for(const issue of audit.issues)lines.push(`### ${issue.timestamp==null?'Unknown time':`${Number(issue.timestamp).toFixed(2)}s`} — ${issue.severity} / ${Math.round((issue.confidence||0)*100)}% confidence`,'',`- Expected: ${issue.expectedMeaning||'—'}`,`- Observed: ${issue.observedMeaning||'—'}`,`- Evidence: ${(issue.evidence||[]).join('; ')||'—'}`,`- Root cause: ${issue.rootCause||'—'}`,`- Recommended fix: ${issue.recommendedFix||'—'}`,`- Acceptance criteria: ${issue.acceptanceCriteria||'—'}`,'');
 else lines.push('No issues returned.','');
 lines.push('## Segments','',...(audit.segments?.length?[...audit.segments].map(segment=>`- ${JSON.stringify(segment)}`):['No segment analysis returned.']),'','## Proposed revised timeline','',...(audit.revisedTimeline?.length?[...audit.revisedTimeline].map(segment=>`- ${JSON.stringify(segment)}`):['No revised timeline returned.']),'','## Validation checklist','',...(audit.validationChecklist||[]).map(item=>`- ${item}`),'','## Limitations','',...(audit.limitations||[]).map(item=>`- ${item}`));
 return lines.join('\n');
}
