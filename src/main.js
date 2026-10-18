import {scoreShot} from './analysis/shotRanking.js';
import {renderReferenceCaption,splitReferencePhrases,referenceMotion} from './captions/referenceStyle.js';
import {installReferenceControls} from './captions/referenceControls.js';
import {getPreset,migratePresetData} from './captions/presetRegistry.js';
import {renderPresetCaption,clearPresetLayouts} from './captions/presetRenderer.js';
import {protectedShot} from './captions/presetUtils.js';
import {presetFrameState,renderPresetOverlay} from './captions/presetEffects.js';
import {installPresetControls} from './captions/presetControls.js';
import {preparePresetFont} from './captions/presetFonts.js';
import {measuredWords,intervalAt,buildStoryCue} from './captions/timing.js';
import {shotAt,timelineIndex,invalidateTimeline} from './core/timelineIndex.js';
import {releaseMedia} from './media/lifecycle.js';
import {mixTimelineAudio} from './export/audioMix.js';
import {analyzeNarration,captionIsActive,anchorRecognizedOnsets,captionEndTime} from './captions/activity.js';
import {alignedCues,alignmentForLines} from './captions/alignedCues.js';
import '@fontsource/montserrat/latin-900.css';
import {analyzeSamples} from './analysis/sceneAnalysis.js';
import {thumbnail} from './media/thumbnail.js';
import {analyzeInWorker} from './analysis/workerClient.js';
import './styles/studio.css';
import './styles/simple-studio.css';
import Mp4Muxer from './vendor/mp4-muxer.js';
import {waitMedia,seekFrame} from './media/decoder.js';
import {validateTimeline,validateCues,validateWords,assertLocksUnchanged} from './core/validation.js';
import {exportConfig,verifyExport} from './export/capabilities.js';
import {History} from './core/history.js';
import {storeProject,loadProject} from './storage/indexedDb.js';
import {easeInOutCubic,transitionSourceTime,transitionDuration} from './core/transitions.js';
import {installSimpleEditor} from './ui/simple-editor.js';

const $=id=>document.getElementById(id);
let W=720,H=1280;
let clips=[],cur=-1,cx=null,det=null,lastDet=0,busy=false;
let activeSegIdx=0, edlPlaying=false, edlStopFn=null;
let tlPixelsPerSec=40, isScrubbing=false;
let exportCancelled=false;
let refreshReferenceCues=()=>{};
let presetUI=null;

const pv=document.createElement('video');pv.playsInline=true;pv.loop=true;pv.muted=true;
const pc=$('pc'),px=pc.getContext('2d');

if('FaceDetector' in window){
  try{det=new FaceDetector({fastMode:true,maxDetectedFaces:3});$('fd').textContent='(Face tracker ready)'}catch(e){}
}else $('fd').textContent='(Face detector not supported, using smart center)';

function setStatus(t){$('st').textContent=t}

let taskProgressOverlay=null;
function ensureTaskProgress(){
  if(taskProgressOverlay)return taskProgressOverlay;
  taskProgressOverlay=document.createElement('div');
  taskProgressOverlay.className='task-progress-overlay';
  taskProgressOverlay.setAttribute('role','status');
  taskProgressOverlay.setAttribute('aria-live','polite');
  taskProgressOverlay.innerHTML='<div class="task-progress-card"><div class="task-progress-kicker">SKIMSTUDIO / WORKING</div><div class="task-progress-title"></div><div class="task-progress-detail"></div><div class="task-progress-track"><div class="task-progress-fill"></div></div><div class="task-progress-meta"><span class="task-progress-percent"></span><button class="task-progress-cancel" type="button">Cancel</button></div></div>';
  document.body.append(taskProgressOverlay);
  return taskProgressOverlay;
}
function showTaskProgress(title,detail='',percent=null,onCancel=null){
  const el=ensureTaskProgress();
  el.querySelector('.task-progress-title').textContent=title;
  el.querySelector('.task-progress-detail').textContent=detail;
  const fill=el.querySelector('.task-progress-fill'),label=el.querySelector('.task-progress-percent'),cancel=el.querySelector('.task-progress-cancel');
  const determinate=Number.isFinite(percent);
  fill.style.width=determinate?Math.max(0,Math.min(100,percent))+'%':'35%';
  fill.classList.toggle('indeterminate',!determinate);
  label.textContent=determinate?Math.round(percent)+'%':'Working…';
  cancel.hidden=typeof onCancel!=='function';
  cancel.onclick=()=>onCancel?.();
  el.hidden=false;
}
function updateTaskProgress(percent,detail,title){
  if(!taskProgressOverlay||taskProgressOverlay.hidden)return;
  if(title)taskProgressOverlay.querySelector('.task-progress-title').textContent=title;
  if(detail!=null)taskProgressOverlay.querySelector('.task-progress-detail').textContent=detail;
  const fill=taskProgressOverlay.querySelector('.task-progress-fill'),label=taskProgressOverlay.querySelector('.task-progress-percent');
  const determinate=Number.isFinite(percent);
  fill.style.width=determinate?Math.max(0,Math.min(100,percent))+'%':'35%';
  fill.classList.toggle('indeterminate',!determinate);
  label.textContent=determinate?Math.round(percent)+'%':'Working…';
}
function hideTaskProgress(){if(taskProgressOverlay)taskProgressOverlay.hidden=true}

// Tab Switching
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    ['tab_captions','tab_effects','tab_sfx','tab_raw'].forEach(id=>{
      $(id).style.display=(btn.dataset.tab===id)?'block':'none';
    });
  };
});

function list(){
  $('list').innerHTML='';
  clips.forEach((c,i)=>{
    const d=document.createElement('div');
    d.className='item'+(i===cur?' sel':'');
    d.innerHTML='<label class="usebox" title="Include this clip in the story edit"><input type="checkbox"'+(c.use!==false?' checked':'')+'></label><b></b><small></small>';
    const box=d.firstChild.firstChild;
    box.checked=c.use!==false;
    box.onclick=e=>e.stopPropagation();
    box.onchange=()=>{c.use=box.checked};
    d.childNodes[1].textContent=c.file.name;
    d.lastChild.textContent=c.status+(c.metadata?' • '+c.metadata.width+'×'+c.metadata.height+' • '+c.metadata.duration.toFixed(1)+'s':'')+(c.aud?' • Voice: '+c.aud.name:'');
    if(c.videoEl&&!c.thumbnail)try{c.thumbnail=thumbnail(c.videoEl)}catch{}
    if(c.thumbnail){const image=document.createElement('img');image.src=c.thumbnail;image.alt='Video thumbnail';image.width=36;image.height=64;image.style.float='right';d.append(image)}
    d.onclick=()=>select(i);
    $('list').appendChild(d);
  });
}

async function add(fs){
  if(busy)return; busy=true;
  const files=[...fs].filter(f=>f.type.startsWith('video/'));
  if(files.length)showTaskProgress('Importing video',`Preparing ${files.length} clip${files.length===1?'':'s'}…`,0);
  let completed=0;
  try{
  for(const f of fs){
    if(f.type.startsWith('video/')){
      if(clips.length>=100){setStatus('Media bin limit is 100 clips.');break}
      updateTaskProgress((completed/files.length)*100,`Loading ${f.name} and reading its metadata…`,'Importing video');
      const vEl=document.createElement('video');
      vEl.playsInline=true;vEl.muted=true;vEl.preload='auto';
      if(f.size>512*1024*1024){setStatus('Skipped '+f.name+': video import limit is 512 MB per file.');continue}
      if(clips.reduce((sum,c)=>sum+(c.file.size||0),0)+f.size>1024*1024*1024){setStatus('Media bin limit is 1 GB of source files. Remove unused media or start another project.');continue}
      vEl.src=URL.createObjectURL(f);
      try{await waitMedia(vEl); clips.push({id:crypto.randomUUID(),file:f,url:vEl.src,videoEl:vEl,cues:[],fx:[],edl:[],status:'Ready',aud:null,metadata:{duration:vEl.duration,width:vEl.videoWidth,height:vEl.videoHeight,size:f.size,type:f.type,audio:'unknown',fps:null,rotation:null}})}catch(error){URL.revokeObjectURL(vEl.src);vEl.removeAttribute('src');vEl.load();setStatus(f.name+': '+error.message)}
      completed++;
      updateTaskProgress((completed/files.length)*100,`${completed} of ${files.length} clip${files.length===1?'':'s'} ready.`,'Importing video');
    }
  }
  }finally{busy=false;hideTaskProgress()}
  if(cur<0&&clips.length)select(0);else list();
}

async function ensureClipLoaded(clip){if(!clip||clip.missing||!clip.videoEl)throw new Error("Missing media. Relink the video first.");return waitMedia(clip.videoEl)}

$('drop').onclick=()=>$('file').click();
$('file').onchange=async e=>{try{await add(e.target.files)}finally{e.target.value=''}};
$('drop').ondragover=e=>{e.preventDefault();$('drop').classList.add('on')};
$('drop').ondragleave=()=>$('drop').classList.remove('on');
$('drop').ondrop=e=>{e.preventDefault();$('drop').classList.remove('on');add(e.dataTransfer.files)};

function select(i){
  cur=i;cx=null;activeSegIdx=0;syncPlayLabel();
  if(edlStopFn){edlStopFn();edlStopFn=null}
  pv.src=clips[i].url;pv.muted=true;pv.playbackRate=1;
  pv.pause();
  const c=clips[cur];
  if(c.aud){$('ai').textContent=c.aud.name+' ('+c.aud.dur.toFixed(1)+'s)'}else $('ai').textContent='No voice loaded';
  $('st_tags').value=c.tags||'';
if(c.edl&&c.edl.length){$('ed').value=edlToText(c.edl);renderTimeline();updateDurBanner(c)}
  showCues();
  list();
}

function showCues(){
  if(cur<0)return;
  const c=clips[cur];
  $('ct').value=c.cues.map(q=>q.s.toFixed(2)+'|'+q.e.toFixed(2)+'|'+q.t+(q.w?'|'+serWords(q.w):'')).join('\n');
  $('ft').value=c.fx.map(f=>f.t.toFixed(2)+'|'+f.k).join('\n');
  reportWordTimingSource(c);
  refreshReferenceCues();
  presetUI?.refreshCues();
}

// Caption/SFX textareas re-parse on every keystroke but only redraw the timeline after a pause
let tlRedrawTimer=0;
function debouncedRenderTimeline(){
  clearTimeout(tlRedrawTimer);
  tlRedrawTimer=setTimeout(()=>renderTimeline(),150);
}

$('ct').oninput=()=>{
  if(cur<0||busy)return;
  const c=clips[cur];
  const proposed=$('ct').value.split('\n').map(l=>{
    const p=l.split('|');
    if(p.length<3)return null;
    // Optional trailing field: w:s:e,s:e,...  (never confused with '|' inside the text)
    const w=parseWords(p[p.length-1]);
    const txt=p.slice(2,w?p.length-1:p.length).join('|');
    const q={s:+p[0],e:+p[1],t:txt};
    if(w){q.w=w;q.src='manual'}
    return q;
  }).filter(Boolean);
  try{validateCues(proposed);c.cues=proposed;$('ct').setCustomValidity('')}catch(error){$('ct').setCustomValidity(error.message);setStatus('Caption changes not applied: '+error.message);return}
  // From here the caption list is the user's, so later rebuilds must not overwrite it
  c.storyCues=null;
  c.cuesEdited=true;
  c.wordAlignment=null;c.captionTimingStale=false;
  clearWordCache(c);
  presetUI?.refreshCues();
  debouncedRenderTimeline();
};

$('ft').oninput=()=>{
  if(cur<0)return;
  clips[cur].fxEdited=true;
  clips[cur].fx=$('ft').value.split('\n').map(l=>{
    const p=l.split('|');
    return{t:+p[0],k:(p[1]||'').trim()};
  }).filter(f=>!isNaN(f.t)&&/^(whoosh|hit|ding|pop|scratch|riser)$/.test(f.k));
  debouncedRenderTimeline();
};

function ts(s){
  const m=s.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  return m?+m[1]*3600+ +m[2]*60+ +m[3]+ +('0.'+m[4]):NaN;
}

function adoptAlignWords(c,cues){
  validateCues(cues);
  c.cues=cues.map(q=>({s:+q.s,e:+q.e,t:q.t,w:q.w||null,src:q.w?'measured':'accum'}));
  c.cues.sort((a,b)=>a.s-b.s);
  c.cuesEdited=true;
  c.storyCues=null;
  c.wordAlignment=null;c.captionTimingStale=false;
}

$('srt').onchange=async e=>{
  const f=e.target.files[0];if(!f||cur<0||busy)return;
  try{
  const tx=(await f.text()).replace(/\r/g,'');
  const cues=tx.split(/\n\n+/).map(b=>{
    const l=b.trim().split('\n');
    const k=l.findIndex(x=>x.includes('-->'));
    if(k<0)return null;
    const[a,z]=l[k].split('-->');
    // Some tools emit karaoke/SRT-with-tags; strip them and keep the text
    const txt=l.slice(k+1).join(' ').replace(/<[^>]*>/g,'').trim();
    return{s:ts(a),e:ts(z),t:txt};
  }).filter(c=>c&&!isNaN(c.s));
  const c=clips[cur];
  // Original cue timing is preserved verbatim. Word spans are adopted only when the
  // cue text actually matches an existing alignment, otherwise they are estimated.
  adoptAlignWords(c,cues);
  showCues();
  clearWordCache(c);
  renderTimeline();
  setStatus('Loaded '+c.cues.length+' captions from SRT. '+(reportWordTimingSource(c)||'')+'.');
  }catch(error){setStatus('Caption import failed: '+error.message)}finally{e.target.value=''}
};

// Custom Font Upload
$('custom_font').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  const fontName=f.name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9]/g,'_')+'_custom';
  try{
    const fontData=await f.arrayBuffer();
    const font=new FontFace(fontName,fontData);
    await font.load();
    document.fonts.add(font);
    const opt=document.createElement('option');
    opt.value="'"+fontName+"',sans-serif";
    opt.textContent=f.name+' (Custom)';
    opt.selected=true;
    $('cf').prepend(opt);
    presetUI?.controller.markManual('cf');clearPresetLayouts();
    setStatus('Custom font loaded: '+f.name);
  }catch(err){
    setStatus('Could not load font: '+err.message);
  }
};

// Sliders numeric feedback
const bindSlider=(id,outId,suffix='')=>{
  $(id).oninput=()=>{$(outId).textContent=$(id).value+suffix};
};
bindSlider('csz','csz_val','px');
// cfade is in hundredths of a second (0-40 => 0-400ms)
$('cfade').oninput=()=>{$('cfade_val').textContent=($('cfade').value*10)+' ms'};
bindSlider('cy','cy_val','%');
bindSlider('cx_pos','cx_val','%');
bindSlider('pos','pos_val','%');
bindSlider('og','og_val','%');
bindSlider('sv','sv_val','%');
bindSlider('m_zoom','m_zoom_val','x');
bindSlider('m_fx','m_fx_val','%');
bindSlider('m_fy','m_fy_val','%');

$('tl_zoom').oninput=()=>{
  const scrollEl=$('tl_scroll');
  const oldScroll=scrollEl.scrollLeft;
  const viewCenter=oldScroll+scrollEl.clientWidth/2;
  const oldPPS=tlPixelsPerSec;

  $('tl_zoom_val').textContent=$('tl_zoom').value+'x';
  tlPixelsPerSec=40*+$('tl_zoom').value;

  // Preserve zoom center point
  const ratio=tlPixelsPerSec/oldPPS;
  const newCenter=viewCenter*ratio;
  renderTimeline();
  scrollEl.scrollLeft=newCenter-scrollEl.clientWidth/2;
};

$('tm').onchange=()=>{
  const s=isStoryMode();
  $('edbox').style.display=s?'block':'none';
  $('chint').style.display=s?'block':'none';
  $('stbox').style.display=$('tm').value==='story_multi'?'block':'none';
  $('st_go').style.display=$('tm').value==='story_multi'?'inline-block':'none';
};
$('tm').dispatchEvent(new Event('change'));

// The two story modes share the same playback/caption/export pipeline; only the
// editing engine that builds the EDL differs. Switching the selector never
// touches the media bin, narration, captions or any manual edit.
function isStoryMode(){const v=$('tm').value;return v==='story'||v==='story_multi'}

function formatTime(s){
  if(isNaN(s)||s<0)s=0;
  const m=Math.floor(s/60),sec=Math.floor(s%60),ms=Math.floor((s%1)*10);
  return (m<10?'0':'')+m+':'+(sec<10?'0':'')+sec+'.'+ms;
}

// Transport Buttons
function syncPlayLabel(){
  const b=$('play');if(!b)return;
  b.textContent=edlPlaying?'⏸ Pause':'▶ Play / Pause';
}
$('play').onclick=()=>{
  if(cur<0)return;
  if(isStoryMode()&&clips[cur].edl&&clips[cur].edl.length){
    if(edlPlaying&&edlStopFn){edlStopFn();return}
    previewCommentary();
  }else{
    pv.paused?pv.play():pv.pause();
  }
  setTimeout(syncPlayLabel,0);
};

$('btn_start').onclick=()=>{
  seekToTimelineTime(0);
};
$('btn_prev_cut').onclick=()=>{
  if(cur<0||!clips[cur].edl||!clips[cur].edl.length)return;
  const c=clips[cur];
  activeSegIdx=Math.max(0,activeSegIdx-1);
  let segStart=0;
  for(let i=0;i<activeSegIdx;i++)segStart+=(c.edl[i].e-c.edl[i].s)/c.edl[i].sp;
  seekToTimelineTime(segStart);
};
$('btn_next_cut').onclick=()=>{
  if(cur<0||!clips[cur].edl||!clips[cur].edl.length)return;
  const c=clips[cur];
  activeSegIdx=Math.min(c.edl.length-1,activeSegIdx+1);
  let segStart=0;
  for(let i=0;i<activeSegIdx;i++)segStart+=(c.edl[i].e-c.edl[i].s)/c.edl[i].sp;
  seekToTimelineTime(segStart);
};

// USER REQUESTED: DEDICATED PREVIEW MOMENT & EDIT MOMENT BUTTONS
$('btn_preview_moment').onclick=()=>previewSelectedMoment();
$('btn_edit_moment').onclick=()=>openSelectedMomentEditor();

function wrap(ctx,t,mw){
  const w=t.split(' ');const out=[];let l='';
  for(const x of w){
    const n=l?l+' '+x:x;
    if(ctx.measureText(n).width>mw&&l){out.push(l);l=x}else l=n;
  }
  if(l)out.push(l);return out;
}

const GR={
  cine:'contrast(1.12) saturate(1.15) sepia(.12) hue-rotate(-8deg) brightness(.98)',
  warm:'sepia(.25) saturate(1.2) contrast(1.05) brightness(1.03)',
  vivid:'saturate(1.5) contrast(1.12)',
  moody:'contrast(1.2) saturate(.8) brightness(.88)',
  bw:'grayscale(1) contrast(1.25)'
};

function rr(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.roundRect?ctx.roundRect(x,y,w,h,r):ctx.rect(x,y,w,h);
}

function zf(t,o){
  if(getPreset(o.cs))return 1;
  if(o.referenceStyle)return 1;
  if(!o.zoom)return 1;
  let z=1+.05*(.5-.5*Math.cos(t*.8));
  for(const e of o.fx)if(e.k==='hit'&&t>=e.t&&t<e.t+.3)z+=.08*(1-(t-e.t)/.3);
  return z;
}

// ============================================================
// TRUE WORD-LEVEL CAPTION SYNC
//
// Every caption word is timed as {text, start, end} on the narration clock.
// Rule: a word turns into the highlight style only once narration time
//       reaches word.end  ->  wordHasFinished = narrationTime >= word.end
// The first word of a cue therefore stays in its normal style until it has
// actually been spoken, and never highlights early.
//
// cue.w holds RELATIVE seconds from the cue start and may be:
//   [{s,e}, ...]        measured / aligned word spans   (preferred)
//   [n, n, n, ...]      legacy start-only array          (ends derived)
//   absent              -> estimated fallback (flagged, never claimed precise)
// ============================================================
const WP_DEBUG=/[?&]wpdebug=1/.test(location.search);

function wordOffsetSec(){return ((+($('wo')||{}).value||0))/1000}

// Normalized token used to match caption words against aligner output
function normTok(s){return String(s||'').toLowerCase().replace(/[^a-z0-9']/g,'')}

// FALLBACK ONLY: spread words across the voiced speech inside the cue so real
// pauses between words are preserved instead of being smeared away.
function estWordSpans(c,ws){
  const dur=Math.max(0.12,(c.e-c.s)||0);
  const wt=w=>Math.max(1,(w.match(/[aeiouy]+/gi)||[]).length)+(normTok(w).length)*0.12;
  const W=ws.map(wt),T=W.reduce((a,b)=>a+b,0)||1;
  const pieces=[];
  const runs=(c.aud&&c.aud.runs)||[];
  for(const r of runs){
    const a=Math.max(r[0],c.s),b=Math.min(r[1],c.e);
    if(b>a)pieces.push([a,b]);
  }
  if(!pieces.length)pieces.push([c.s,c.s+dur]);
  const real=vt=>{
    let v=0;
    for(const p of pieces){
      const L=p[1]-p[0];
      if(vt<v+L)return p[0]+Math.max(0,vt-v);
      v+=L;
    }
    return pieces[pieces.length-1][1];
  };
  const voiced=pieces.reduce((a,p)=>a+(p[1]-p[0]),0)||dur;
  const out=[];
  let acc=0;
  for(let i=0;i<ws.length;i++){
    const s=Math.max(0,Math.min(dur,real(acc/T*voiced)-c.s));
    acc+=W[i];
    const e=Math.max(0,Math.min(dur,real(acc/T*voiced)-c.s));
    out.push({t:ws[i],s:s,e:Math.max(s+0.06,e)});
  }
  // The final word finishes with the speech of the cue, not after it
  const last=out[out.length-1];
  if(last){
    if(!(last.e>last.s))last.e=Math.min(dur,last.s+0.12);
    else last.e=Math.max(last.s+0.04,Math.min(last.e,dur-0.04));
  }
  return out;
}

// Normalized, monotonic word spans for one cue (relative seconds, cached)
function cueWords(c){
  if(c.w!=null)return measuredWords(c);
  const ws=(c.t||'').split(/\s+/).filter(Boolean);
  if(!ws.length)return [];
  const sig=JSON.stringify(c.w)+'|'+c.t+'|'+ws.length+'|'+(c.w?c.w.length:0)+'|'+(c.e-c.s).toFixed(3);
  if(c._wc&&c._wcs===sig)return c._wc;
  const dur=Math.max(0.12,(c.e-c.s)||0);
  let out=null,est=false;
  if(c.w&&c.w.length===ws.length){
    // Measured data arrives as {s,e} objects; legacy data arrives as start-only numbers
    const obj=ws.map((t,i)=>{const e=c.w[i];return !!(e&&typeof e==='object')});
    out=ws.map((t,i)=>{
      const e=c.w[i];
      return (e&&typeof e==='object')?{t,s:+e.s||0,e:+e.e||0}:{t,s:+e||0,e:0};
    });
    // Legacy start-only data: a word ends where the next one starts
    for(let i=0;i<out.length-1;i++)if(!obj[i])out[i].e=out[i+1].s;
    if(!obj[out.length-1])out[out.length-1].e=dur;
  }else{
    out=estWordSpans(c,ws);
    est=true;
  }
  for(let i=0;i<out.length;i++){
    let s=out[i].s,e=out[i].e;
    if(!isFinite(s))s=i?out[i-1].e:0;
    if(!isFinite(e))e=i?out[i-1].e:0;
    s=Math.max(0,Math.min(dur,s));
    if(!(e>s))e=i<out.length-1?Math.max(s+0.05,out[i+1].s):dur;
    if(!(e>s))e=s+0.05;
    out[i].s=s;
    out[i].e=Math.max(s+0.02,Math.min(dur,e));
  }
  c._wc=out;c._wcs=sig;c._wcEst=est;
  return out;
}

function clearWordCache(c){
  if(!c||!c.cues)return;
  c.cues.forEach(q=>{q._wc=null;q._wcs=null;q._wcEst=false});
}

// The single source of truth for "which words have been spoken".
// driven by the one authoritative narration clock t.
function wpInfo(c,t){
  const ws=cueWords(c);
  if(!ws.length)return{done:0,total:0,read:0,active:-1,page:0,idx:-1,phase:0,est:false,tt:0};
  const tt=(t-c.s)+wordOffsetSec();
  let done=0;
  while(done<ws.length&&tt>=ws[done].e)done++;
  let active=-1;
  for(let i=0;i<ws.length;i++){
    if(tt>=ws[i].s&&tt<ws[i].e){
      active=i;break;
    }
  }
  const read=active>=0?active:Math.min(ws.length-1,done);
  const from=done>0?ws[done-1].e:0;
  const to=ws[read].e;
  const phase=(to>from)?Math.min(1,Math.max(0,(tt-from)/(to-from))):0;
  let page=read;
  if(read>0&&(tt-ws[read].s)<0.10)page=read;
  else if(read>0&&(tt-ws[read-1].e)<0.12)page=read-1;
  const info={done,total:ws.length,read,active,page,idx:done-1,phase,est:!!c._wcEst,tt,words:ws,
    age:done>0?(tt-ws[done-1].e):1e9,
    wordAge:active>=0?(tt-ws[active].s):1e9};
  if(WP_DEBUG&&(!c._wplog||t-c._wplog>0.05||done!==c._wplogd)){
    c._wplog=t;c._wplogd=done;
    console.log('[wpsync] t='+t.toFixed(3),'cue='+JSON.stringify(c.t.slice(0,28)),
      'idx='+done,'read='+read,'active='+active,'est='+info.est);
  }
  return info;
}

// Fractional progress: integer part = words finished, fraction = time since the
// last word finished. Monotonic in t, so it can never flicker.
function wp(c,t){
  const i=wpInfo(c,t);
  return i.done+i.phase;
}

// Measured word spans -> cue-relative spans (accepts objects, legacy numbers, null)
function relWords(w,cs){
  if(!w||!w.length)return null;
  const out=w.map(x=>{
    const s=x&&typeof x==='object'?+x.s:+x;
    const e=x&&typeof x==='object'?+x.e:NaN;
    return {s:Math.max(0,(isFinite(s)?s:0)-cs),e:isFinite(e)?Math.max(0,e-cs):NaN};
  });
  for(let i=0;i<out.length-1;i++)if(!(out[i].e>out[i].s))out[i].e=out[i+1].s;
  return out;
}
function serWords(w){
  if(!w||!w.length)return '';
  return 'w:'+w.map(x=>(+x.s||0).toFixed(3)+':'+(isFinite(+x.e)?(+x.e).toFixed(3):'')).join(',');
}
function parseWords(s){
  if(typeof s!=='string'||s.slice(0,2)!=='w:')return null;
  const out=[];
  s.slice(2).split(',').forEach(p=>{
    const a=p.split(':');
    if(a.length<2)return;
    const st=parseFloat(a[0]),en=parseFloat(a[1]);
    if(isFinite(st))out.push({s:st,e:isFinite(en)?en:NaN});
  });
  return out.length?out:null;
}

// Masterpiece Smart Splicer: Automatically splits sentences into concise, viral short lines (2-4 words)
function splitLines(t,maxWords){
  if(maxWords==null&&$('cs')?.value==='reference')return splitReferencePhrases(t,8);
  maxWords=maxWords||getPreset($('cs')?.value)?.maxWords||4;
  if(!t)return [];
  const rawParagraphs=t.split('\n').map(s=>s.trim()).filter(Boolean);
  const sentences=[];
  for(const p of rawParagraphs){
    // If text already has line breaks, treat each line as deliberate unless very long
    if(rawParagraphs.length>1){
      sentences.push(p);
    }else{
      const sents=p.match(/[^.!?]+[.!?]*/g)||[p];
      for(const s of sents){
        const tr=s.trim();
        if(tr)sentences.push(tr);
      }
    }
  }

  const chunks=[];
  const breakWords=new Set([
    'and','but','or','so','because','when','while','after','before',
    'that','which','who','to','in','on','at','with','into','from','by','for','as','if'
  ]);

  for(const sent of sentences){
    // Split into clauses by comma, colon, semicolon, dash if long
    const clauses=sent.split(/(?<=[,;:\-–—])\s+/).map(s=>s.trim()).filter(Boolean);
    for(const cl of clauses){
      const words=cl.split(/\s+/).filter(Boolean);
      if(words.length<=maxWords){
        chunks.push(cl);
        continue;
      }
      let cur=[];
      for(let i=0;i<words.length;i++){
        cur.push(words[i]);
        const rem=words.length-(i+1);
        const count=cur.length;
        const nextWord=(words[i+1]||'').toLowerCase().replace(/[^a-z]/g,'');
        const nextIsBreak=breakWords.has(nextWord);

        if(count>=2&&rem>=2&&nextIsBreak){
          chunks.push(cur.join(' '));
          cur=[];
        }else if(count>=3&&rem>=2){
          chunks.push(cur.join(' '));
          cur=[];
        }else if(count>=maxWords){
          chunks.push(cur.join(' '));
          cur=[];
        }
      }
      if(cur.length){
        if(cur.length===1&&chunks.length>0){
          chunks[chunks.length-1]+=' '+cur[0];
        }else{
          chunks.push(cur.join(' '));
        }
      }
    }
  }
  return chunks.length>0?chunks:[t.trim()];
}

// CAPTION RENDERING ENGINE
function caps(ctx,c,t,o){
  const config=getPreset(o.cs);
  if(config)return renderPresetCaption(ctx,c,t,{...o,wordOffset:wordOffsetSec()},measuredWords(c),config);
  if(!captionIsActive(c,t,cueWords(c),{...o,wordOffset:wordOffsetSec()}))return;
  if(o.cs==='reference')return renderReferenceCaption(ctx,c,t,{...o,wordOffset:wordOffsetSec()},cueWords(c));
  if(t<c.s||t>=c.e)return;
  const textRaw=o.caps_lock?c.t.toUpperCase():c.t;
  const ws=textRaw.split(/\s+/).filter(Boolean);
  if(!ws.length)return;
  const sc=o.w/360;
  let fs=o.fs*sc;
  ctx.font='800 '+fs+'px '+o.cf;
  ctx.lineJoin='round';
  const WI=wpInfo(c,t);
  const done=WI.done;
  const activeIdx=WI.active;
  const yCenter=Math.round(Math.max(fs*1.3,Math.min(o.h*.85-fs*.5,o.h*o.cy))*2)/2;
  const xOffset=(o.cx_pos!=null?o.cx_pos:0.5);

  const capWords=WI.words||[];
  const firstS=capWords.length?capWords[0].s:0;
  const lastE=capWords.length?capWords[capWords.length-1].e:Math.max(0.1,c.e-c.s);
  if(WI.tt<firstS||WI.tt>=lastE)return;

  // Fade envelope: smooth onset and fade out after narration
  let fade=(+($('cfade')||{value:15}).value||0)/100;
  if(!isFinite(fade)||fade<0)fade=0;
  const cueDur=Math.max(0.12,c.e-c.s);
  fade=Math.min(fade,cueDur/3);
  let capAlpha=1;
  if(fade>0.001){
    const fin=Math.min(1,Math.max(0,(t-c.s)/fade));
    const fout=Math.min(1,Math.max(0,(c.e-t)/fade));
    capAlpha=Math.min(fin,fout);
    if(capAlpha<=0.004)return;
  }
  if(capAlpha<0.999)ctx.save();
  if(capAlpha<0.999)ctx.globalAlpha=capAlpha;

  const getLineWidth=()=>o.sw==='none'?0:o.sw==='thin'?fs/7:o.sw==='thick'?fs/3.2:fs/4.5;
  const lw=getLineWidth();

  // Words per screen limit: 2 to 4 words at a time keeps captions short and punchy
  const rawChunkVal=o.chunk_size||($('chunk_size')?$('chunk_size').value:'3');
  const maxChunkWords=rawChunkVal==='all'?ws.length:(parseInt(rawChunkVal,10)||3);

  const fullSentence=o.cs==='pop';
  if(!fullSentence&&(o.cs==='shorts'||maxChunkWords<ws.length)){
    const chunkSize=Math.max(1,Math.min(maxChunkWords,ws.length));
    const groupStart=Math.floor(WI.page/chunkSize)*chunkSize;
    const chunk=ws.slice(groupStart,groupStart+chunkSize);
    let curFs=fs*(chunkSize<=2?1.22:chunkSize<=3?1.15:1.05);
    ctx.font='800 '+curFs+'px '+o.cf;
    let sp=ctx.measureText(' ').width;
    let tw=chunk.reduce((a,w)=>a+ctx.measureText(w).width,0)+sp*(chunk.length-1);
    if(tw>o.w*.92){
      curFs*=o.w*.92/tw;
      ctx.font='800 '+curFs+'px '+o.cf;
      sp=ctx.measureText(' ').width;
      tw=chunk.reduce((a,w)=>a+ctx.measureText(w).width,0)+sp*(chunk.length-1);
    }
    let x=Math.round(Math.max(o.w*.04,Math.min(o.w-tw-o.w*.04,o.w*xOffset-tw/2))*2)/2;

    if(o.cs==='pill'){
      const bw=tw+curFs*1.2,bh=curFs*1.55;
      ctx.fillStyle='rgba(0,0,0,.72)';
      rr(ctx,o.w*xOffset-bw/2,yCenter-curFs*.95,bw,bh,curFs*.35);
      ctx.fill();
    }

    chunk.forEach((w,i)=>{
      const gi=groupStart+i;
      if(o.cs==='progressive'&&WI.tt<capWords[gi].s){x+=ctx.measureText(w).width+sp;return}
      const isActive=(gi===activeIdx);
      const isSpoken=(gi<done)||(isActive);
      const wd=ctx.measureText(w).width;
      ctx.save();
      // shorts: punchy bounce pop on the active word as it is spoken!
      const wordAge=isActive?(WI.tt-capWords[gi].s):1e9;
      const pulse=(o.cs==='shorts'&&isActive&&wordAge>=0&&wordAge<0.22)?Math.max(0,1-wordAge/0.22):0;
      if(pulse>0){
        const scl=1+0.06*pulse;
        ctx.translate(Math.round((x+wd/2)*2)/2,yCenter);
        ctx.scale(scl,scl);
        ctx.translate(-Math.round((x+wd/2)*2)/2,-yCenter);
      }
      const drawX=Math.round(x*2)/2;
      if(lw>0&&o.cs!=='pill'){
        ctx.lineWidth=lw;
        ctx.strokeStyle=o.sc_col||'#000';
        ctx.shadowColor='rgba(0,0,0,.75)';
        ctx.shadowBlur=curFs/4.5;
        if(o.cs==='bold'){ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=curFs/3.2}
        ctx.strokeText(w,drawX,yCenter);
        ctx.shadowBlur=0;
      }
      const isHl=o.cs==='pop'?isActive:(o.cs==='shorts'?isSpoken:isSpoken);
      ctx.fillStyle=isHl?(o.acc||'#ffe14a'):(o.tc||'#fff');
      if(o.cs==='karaoke'&&isSpoken){
        ctx.shadowColor=o.acc||'#ffe14a';
        ctx.shadowBlur=curFs*0.42;
      }
      ctx.fillText(w,drawX,yCenter);
      ctx.restore();
      x+=wd+sp;
    });
    if(capAlpha<0.999)ctx.restore();
    return;
  }

  const mw=o.w*.88;
  const sp=ctx.measureText(' ').width;
  let lines=[],curL=[],cw=0;
  ws.forEach((w,i)=>{
    const wd=ctx.measureText(w).width;
    if(cw+wd>mw&&curL.length){
      lines.push({words:curL,w:cw-sp});curL=[];cw=0;
    }
    curL.push({w,i,wd});cw+=wd+sp;
  });
  lines.push({words:curL,w:cw-sp});

  let y=yCenter-(lines.length-1)*fs*.6;

  if(o.cs==='pill'){
    const maxLineW=Math.max(...lines.map(l=>l.w));
    const bw=maxLineW+fs*1.2,bh=lines.length*fs*1.25+fs*.5;
    ctx.fillStyle='rgba(0,0,0,.68)';
    rr(ctx,o.w*xOffset-bw/2,y-fs*.95,bw,bh,fs*.35);
    ctx.fill();
  }

  for(const l of lines){
    let x=Math.max(o.w*.04,Math.min(o.w-l.w-o.w*.04,o.w*xOffset-l.w/2));
    for(const item of l.words){
      if(o.cs==='progressive'&&WI.tt<capWords[item.i].s){x+=item.wd+sp;continue}
      const isActive=(item.i===activeIdx);
      const isSpoken=(item.i<done)||(isActive);
      ctx.save();
      if(lw>0&&o.cs!=='pill'){
        ctx.lineWidth=lw;
        ctx.strokeStyle=o.sc_col||'#000';
        if(o.cs==='bold'){ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=fs/3.5}
        ctx.strokeText(item.w,x,y);
      }
      const isHl=o.cs==='pop'?isActive:(o.cs==='shorts'?isSpoken:isSpoken);
      ctx.fillStyle=isHl?(o.acc||'#ffe14a'):(o.tc||'#ffffff');
      if(o.cs==='karaoke'&&isSpoken){
        ctx.shadowColor=o.acc||'#ffe14a';
        ctx.shadowBlur=fs*0.42;
      }
      ctx.fillText(item.w,x,y);
      ctx.restore();
      x+=item.wd+sp;
    }
    y+=fs*1.25;
  }
  if(capAlpha<0.999)ctx.restore();
}

// Visual Effects Overlays
// One 96x96 grain tile for the whole session; the pattern is built once per drawing context
const _grainTile=(function(){
  const n=document.createElement('canvas');n.width=n.height=96;
  const x=n.getContext('2d'),d=x.createImageData(96,96);
  for(let i=0;i<d.data.length;i+=4){
    d.data[i]=d.data[i+1]=d.data[i+2]=Math.random()*255;d.data[i+3]=26;
  }
  x.putImageData(d,0,0);
  return n;
})();
const _grainPats=new WeakMap();
function grainPattern(ctx){
  let p=_grainPats.get(ctx);
  if(!p){p=ctx.createPattern(_grainTile,'repeat');_grainPats.set(ctx,p)}
  return p;
}
function fx2(ctx,v,o){
  const w=o.w,h=o.h,sc=w/360,t=o.vt!=null?o.vt:v.currentTime;
  if(o.glow){
    // A restrained bloom reads as lens response; a bright self-copy reads as a sticker.
    ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=.16;
    ctx.filter='blur('+Math.max(5,10*sc)+'px)';ctx.drawImage(ctx.canvas,0,0);ctx.restore();
  }
  if(o.vig){
    const g=ctx.createRadialGradient(w/2,h/2,h*.25,w/2,h/2,h*.65);
    g.addColorStop(0,'rgba(0,0,0,0)');
    g.addColorStop(.78,'rgba(0,0,0,.08)');
    g.addColorStop(1,'rgba(0,0,0,.38)');
    ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  }
  if(o.grain){
    ctx.save();
    ctx.globalCompositeOperation='soft-light';
    ctx.globalAlpha=.42;
    ctx.fillStyle=grainPattern(ctx);ctx.fillRect(0,0,w,h);
    ctx.restore();
  }
  if(o.hook&&t<2.8){
    ctx.save();ctx.globalAlpha=Math.max(0,Math.min(1,t/.3,(2.8-t)/.4));
    const fs=36*sc;ctx.font='800 '+fs+'px '+o.cf;
    const ls=wrap(ctx,o.hook.toUpperCase(),w*.82);
    const bw=Math.max(...ls.map(l=>ctx.measureText(l).width))+fs*1.2,bh=ls.length*fs*1.2+fs*.5,y0=h*.13;
    ctx.fillStyle='rgba(0,0,0,.75)';rr(ctx,(w-bw)/2,y0,bw,bh,fs*.25);ctx.fill();
    ctx.fillStyle=o.acc||'#ffe14a';ctx.fillRect((w-bw)/2,y0+bh-5*sc,bw,5*sc);
    ctx.fillStyle='#fff';ctx.textAlign='center';
    ls.forEach((l,i)=>ctx.fillText(l,w/2,y0+fs*1.05+i*fs*1.2));
    ctx.restore();
  }
  const D=o.vd||v.duration;
  if(o.bar&&D){
    const p=Math.min(1,t/D),g=ctx.createLinearGradient(0,0,w,0);
    g.addColorStop(0,o.acc||'#ffe14a');g.addColorStop(1,'rgba(255,255,255,.9)');
    ctx.save();ctx.globalAlpha=.9;ctx.fillStyle=g;ctx.fillRect(0,h-2.5*sc,w*p,2.5*sc);ctx.restore();
  }
  if(o.mark){
    ctx.font='700 '+13*sc+'px system-ui,sans-serif';ctx.textAlign='right';
    ctx.fillStyle='rgba(255,255,255,.8)';ctx.fillText(o.mark,w-16*sc,h*.94);
  }
  if(o.cutFlash>0){
    ctx.save();
    ctx.fillStyle='rgba(255,255,255,'+o.cutFlash+')';
    ctx.fillRect(0,0,w,h);
    ctx.restore();
  }
}

// Subject Highlights
function hl2(ctx,o){
  if(!o.hl||!o.hp)return;
  const sc=o.w/360,t=o.vt||0,x=o.hp.x,y=o.hp.y;
  ctx.save();
  ctx.globalAlpha=Math.min(1,(o.el==null?1:o.el)/.2);

  if(o.hl==='spot'){
    const g=ctx.createRadialGradient(x,y,65*sc,x,y,260*sc);
    g.addColorStop(0,'rgba(0,0,0,0)');
    g.addColorStop(1,'rgba(0,0,0,.5)');
    ctx.fillStyle=g;ctx.fillRect(0,0,o.w,o.h);
  }
  // A refined focus treatment uses two quiet strokes and a soft halo instead of
  // the old saturated neon outline.
  const r=(o.hr?Math.max(34*sc,o.hr):62*sc)+(o.referenceStyle?0:Math.sin(t*5)*1.5*sc);
  const calloutColor=o.referenceStyle?'#ff2828':(o.acc||'#ffe14a');
  if(o.hl==='ring'){
    ctx.globalAlpha=.72;
    ctx.strokeStyle=calloutColor;
    ctx.lineWidth=1.5*sc;
    ctx.shadowColor=calloutColor;
    ctx.shadowBlur=(o.referenceStyle?2:6)*sc;
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    ctx.stroke();
    ctx.globalAlpha=.24;
    ctx.lineWidth=7*sc;
    ctx.beginPath();
    ctx.arc(x,y,r+2*sc,0,Math.PI*2);
    ctx.stroke();
    ctx.shadowBlur=0;
  }

  if(o.lb){
    const fs=14*sc;ctx.font='800 '+fs+'px '+o.cf;
    const tx=o.lb.toUpperCase();
    const tw=ctx.measureText(tx).width+fs*1.4;
    const lx=Math.min(Math.max(x,tw/2+8*sc),o.w-tw/2-8*sc);
    const ly=Math.max(y-r-fs*1.6,fs*2.2);
    ctx.fillStyle='rgba(8,12,18,.78)';
    rr(ctx,lx-tw/2,ly-fs*.95,tw,fs*1.8,fs*.4);ctx.fill();
    ctx.strokeStyle=calloutColor;ctx.lineWidth=1*sc;ctx.stroke();
    ctx.fillStyle=calloutColor;ctx.fillRect(lx-tw/2,ly-fs*.95,3*sc,fs*1.8);
    ctx.fillStyle='#fff';ctx.textAlign='center';ctx.shadowColor='rgba(0,0,0,.7)';ctx.shadowBlur=4*sc;
    ctx.fillText(tx,lx,ly+fs*.35);
  }
  ctx.restore();
}

const EMO=[[/^(haha|lol|funny|laugh|joke)$/,'😂'],[/^(wow|insane|crazy|unbelievable|omg|shocking)$/,'😱'],[/^(fire|hot|legendary|clutch|epic)$/,'🔥'],[/^(money|cash|rich|million|dollars?)$/,'💰'],[/^(win|won|winner|scored|goal|champion)$/,'🏆'],[/^(lost|lose|fail|failed|regret|dead)$/,'💀'],[/^(love|heart)$/,'❤️'],[/^(look|watch|see|eyes)$/,'👀'],[/^(wait|what|huh|hold)$/,'🤨'],[/^(fast|quick|speed|rush)$/,'⚡'],[/^(boom|bang|crash|blast|explode|exploded)$/,'💥'],[/^(sad|cry|crying)$/,'😢'],[/^(think|hmm|maybe)$/,'🤔'],[/^(cool|nice|smooth|perfect)$/,'😎']];
const KWD=/^(never|always|insane|crazy|impossible|secret|biggest|worst|best|free|only|first|last|million|ridiculous|unbelievable|legendary)$/;
function ov(ctx,o,cues){
  const t=o.vt!=null?o.vt:0,W=o.w,H=o.h,sc=W/360;
  // Same cue selection as the caption renderer, so overlays never sit on a different line
  let c=null;
  for(const q of cues){if(q.s<=t)c=q;else break}
  if(c&&t>c.e)c=null;
  if(c&&!captionIsActive(c,t,cueWords(c),{...o,wordOffset:wordOffsetSec()}))c=null;
  const text=c?(c.t||''):'';
  const lower=text.toLowerCase();
  const words=text.split(/\s+/).filter(Boolean);
  const norm=words.map(w=>w.toLowerCase().replace(/[^a-z']/g,''));
  const cws=c?cueWords(c):[];
  const wspan=k=>cws.length===words.length?cws[k]:null;
  // Same clock and same word spans as the caption text: start -> measured end
  const wordStart=k=>{const w=wspan(k);return w?c.s+w.s:(c?c.s+(c.e-c.s)*k/Math.max(1,words.length):t)};
  const wordEnd=k=>{const w=wspan(k);return w?(c.s+w.e):wordStart(k)+.55};
  const activeWord=norm.findIndex((w,i)=>t>=wordStart(i)&&t<wordEnd(i));
  const hasAny=arr=>arr.some(re=>re.test(lower));
  const focus=o.hp||{x:(o.hx!=null?o.hx:.68)*W,y:(o.hy!=null?o.hy:.48)*H};
  const pop=(d,dur)=>{if(d<0||d>dur)return null;const a=Math.min(1,d/.18),b=1.70158;return{s:a<1?1+(b+1)*Math.pow(a-1,3)+b*Math.pow(a-1,2):1,al:Math.max(0,Math.min(1,(dur-d)/.22))}};

  // Keyword pop-ups are tied to meaningful words, rather than arbitrary sentence positions.
  if(c&&$('ov_kw').checked){
    const k=norm.findIndex(w=>KWD.test(w));
    if(k>=0){
      const p=pop(t-wordStart(k),1.05);
      if(p){
        const fs=42*sc,tx=words[k].toUpperCase().replace(/[^A-Z0-9']/g,'');
        ctx.save();ctx.globalAlpha=p.al;ctx.font='900 '+fs+'px '+o.cf;ctx.textAlign='center';
        const tw=Math.min(W*.86,ctx.measureText(tx).width+fs);
        ctx.translate(W/2,H*.19);ctx.rotate(-.035);ctx.scale(p.s,p.s);
        ctx.fillStyle=o.acc||'#ffe14a';rr(ctx,-tw/2,-fs*.78,tw,fs*1.25,fs*.16);ctx.fill();
        ctx.lineWidth=2*sc;ctx.strokeStyle='#111';ctx.stroke();
        ctx.fillStyle='#111';ctx.fillText(tx,0,fs*.12,tw-fs*.25);ctx.restore();
      }
    }
  }

  // Emoji only appears when the narration contains a matching reaction cue.
  if(c&&$('ov_emo').checked){
    const matches=[
      [/\b(wow|unbelievable|shocking|what happened|no way)\b/,'😳'],
      [/\b(funny|laugh|joke|hilarious)\b/,'😂'],
      [/\b(legendary|clutch|epic|insane)\b/,'🔥'],
      [/\b(look|watch|eyes|notice)\b/,'👀'],
      [/\b(fail|failed|mistake|disaster)\b/,'💀'],
      [/\b(cute|adorable|sweet)\b/,'🥹']
    ];
    const match=matches.find(([re])=>re.test(lower));
    if(match){
      const d=t-c.s,p=pop(d,1.0);
      if(p){ctx.save();ctx.globalAlpha=p.al;ctx.font=(78*sc)+'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';ctx.textAlign='center';ctx.translate(W*.79,H*.31);ctx.rotate(.08);ctx.scale(p.s,p.s);ctx.fillText(match[1],0,0);ctx.restore()}
    }
  }

  // Arrow callouts only appear when the narration explicitly points something out.
  if(c&&$('ov_arrow').checked&&hasAny([/\b(look at|watch|right here|focus on|there it is|notice|look closely)\b/])){
    const d=t-c.s,p=pop(d,.85);
    if(p){
      const x=focus.x,y=focus.y, sx=Math.max(18*sc,Math.min(W-18*sc,x+(x<W*.5?65:-65)*sc)), sy=Math.max(28*sc,Math.min(H-30*sc,y-76*sc));
      ctx.save();ctx.globalAlpha=p.al;ctx.lineWidth=4*sc;ctx.strokeStyle=o.acc||'#ffe14a';ctx.fillStyle=o.acc||'#ffe14a';
      ctx.lineCap='round';ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(x,y);ctx.stroke();
      const a=Math.atan2(y-sy,x-sx),ah=13*sc;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-ah*Math.cos(a-.55),y-ah*Math.sin(a-.55));ctx.lineTo(x-ah*Math.cos(a+.55),y-ah*Math.sin(a+.55));ctx.closePath();ctx.fill();
      ctx.restore();
    }
  }

  // Reaction stamp: short, readable editorial annotation for a matching moment.
  if(c&&$('ov_stamp').checked){
    const stamps=[
      [/\b(wait|hold on|wait for it)\b/,'WAIT...'],
      [/\b(replay|again|rewind|double take)\b/,'RUN THAT BACK'],
      [/\b(what|huh|questions|confused|zero answers)\b/,'EXPLAIN THIS'],
      [/\b(legendary|clutch|perfect|incredible)\b/,'ICONIC'],
      [/\b(meanwhile|mean time)\b/,'MEANWHILE...']
    ];
    const item=stamps.find(([re])=>re.test(lower));
    if(item){
      const p=pop(t-c.s,.95);
      if(p){
        const fs=25*sc,tx=item[1];ctx.save();ctx.globalAlpha=p.al;ctx.translate(W*.5,H*.34);ctx.rotate(-.025);ctx.scale(p.s,p.s);
        ctx.font='900 '+fs+'px '+o.cf;ctx.textAlign='center';
        const tw=Math.min(W*.9,ctx.measureText(tx).width+28*sc);
        ctx.fillStyle='#111';rr(ctx,-tw/2,-fs*.9,tw,fs*1.5,7*sc);ctx.fill();
        ctx.strokeStyle=o.acc||'#ffe14a';ctx.lineWidth=3*sc;ctx.stroke();
        ctx.fillStyle=o.acc||'#ffe14a';ctx.fillText(tx,0,fs*.15,tw-12*sc);ctx.restore();
      }
    }
  }

  // Comic impact burst: restrained, brief, and only on strong impact words.
  if(c&&$('ov_burst').checked&&hasAny([/\b(boom|crash|slam|explode|exploded|smash|impact)\b/])){
    const p=pop(t-c.s,.42);
    if(p){
      const x=W*.5,y=H*.43,r=46*sc*p.s;
      ctx.save();ctx.globalAlpha=p.al*.85;ctx.translate(x,y);ctx.rotate((t-c.s)*.8);
      ctx.fillStyle=o.acc||'#ffe14a';ctx.strokeStyle='#111';ctx.lineWidth=3*sc;
      ctx.beginPath();
      for(let i=0;i<24;i++){const a=i*Math.PI/12,rrr=i%2?r*.72:r;const px=Math.cos(a)*rrr,py=Math.sin(a)*rrr;if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py)}
      ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillStyle='#111';ctx.font='900 '+(22*sc)+'px '+o.cf;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('BAM!',0,0);ctx.restore();
    }
  }

  // Lower-third can be enabled globally; it uses the current narration line as a concise label.
  if(c&&$('ov_lower').checked&&text){
    const d=t-c.s;
    if(d>=0&&d<1.5){
      const label=text.length>44?text.slice(0,41).trimEnd()+'…':text;
      const fs=16*sc;ctx.save();ctx.globalAlpha=Math.min(1,d/.18,(1.5-d)/.2);
      ctx.font='800 '+fs+'px system-ui,sans-serif';ctx.textAlign='left';
      const tw=Math.min(W*.9,ctx.measureText(label).width+24*sc),x=W*.05,y=H*.79;
      ctx.fillStyle='rgba(5,10,12,.86)';rr(ctx,x,y,tw,fs*2.1,7*sc);ctx.fill();
      ctx.fillStyle=o.acc||'#ffe14a';ctx.fillRect(x,y,4*sc,fs*2.1);
      ctx.fillStyle='#fff';ctx.fillText(label,x+12*sc,y+fs*1.35,tw-18*sc);ctx.restore();
    }
  }

  // Motion accents are reserved for actual speed-up segments.
  if($('ov_spd').checked&&o.sp>1.2){
    ctx.save();ctx.strokeStyle='rgba(255,255,255,.18)';ctx.lineWidth=2*sc;
    const sd=Math.floor(t*18);
    for(let i=0;i<16;i++){const a=((i*37+sd*13)%100)/100*Math.PI*2,r1=H*.48,r2=H*.78;ctx.beginPath();ctx.moveTo(W/2+Math.cos(a)*r1,H/2+Math.sin(a)*r1);ctx.lineTo(W/2+Math.cos(a)*r2,H/2+Math.sin(a)*r2);ctx.stroke()}
    ctx.restore();
  }
  if($('ov_gl').checked&&o.el!=null&&o.el<.12){
    const k=1-o.el/.12;ctx.save();ctx.globalAlpha=.45*k;
    for(let i=0;i<3;i++){const y=(i+1)*H/5,hh=H*.025,dx=(i%2?1:-1)*18*sc*k;ctx.drawImage(ctx.canvas,0,y,W,hh,dx,y,W,hh)}
    ctx.restore();
  }
}
function draw(ctx,v,cues,o){
  const sw=v.videoWidth,sh=v.videoHeight;if(!sw)return;
  const time=o.vt??v.currentTime??0,config=getPreset(o.cs);
  const shot=o.shot||(o.timeline?.length?segAt({edl:o.timeline},time)?.g:null);
  const state=presetFrameState(config,o,cues,cueWords,time,o.el??time,shot);
  o={...o,vt:time};
  if(!o.noClear)ctx.clearRect(0,0,o.w,o.h);
  // Layered rendering lets a transition composite two shots while captions and
  // overlays are still painted once, on top, fully legible.
  if(o.layers==='fx'){trFx(ctx,o);return}
  const frame=o.layers!=='over',over=o.layers!=='frame';
  const outer=(o.alpha!=null&&o.alpha<1);
  if(outer)ctx.save();
  if(outer)ctx.globalAlpha=o.alpha;
  const reactionBw=state.bw;
  const gf=[GR[o.grade],reactionBw?'grayscale(1) contrast(1.25)':null,`brightness(${Math.pow(2,o.exposure||0)}) contrast(${o.contrast??1}) saturate(${o.saturation??1})`].filter(Boolean).join(' ');ctx.filter=gf;
  let SHK=0;if($('ov_shk').checked&&o.fx&&o.vt!=null){for(const f of o.fx)if(f.k==='hit'){const d=o.vt-f.t;if(d>=0&&d<.3)SHK=Math.max(SHK,(1-d/.3)*9*o.w/360)}}
  if(config)SHK=0;
  const presetTransform=config&&frame&&(state.zoom!==1||state.shakeX||state.shakeY);
  if(presetTransform){ctx.save();ctx.translate(o.w/2+state.shakeX*o.w/360,o.h/2+state.shakeY*o.w/360);ctx.scale(state.zoom,state.zoom);ctx.translate(-o.w/2,-o.h/2)}
  if(SHK){ctx.save();ctx.translate(o.w/2+Math.sin(time*173)*SHK/2,o.h/2+Math.sin(time*227)*SHK/2);ctx.scale(1.04,1.04);ctx.translate(-o.w/2,-o.h/2)}

  if(frame){
  if(o.mode==='fit'){
    ctx.save();ctx.filter=(gf==='none'?'':gf+' ')+'blur(30px)';
    const s=Math.max(o.w/sw,o.h/sh);
    ctx.drawImage(v,(o.w-sw*s)/2,(o.h-sh*s)/2,sw*s,sh*s);
    ctx.restore();
    const f=o.w/sw;
    ctx.drawImage(v,0,(o.h-sh*f)/2,o.w,sh*f);
  }else{
    let cw=sh*9/16,ch=sh;
    if(cw>sw){cw=sw;ch=sw*16/9}
    const z=zf(o.vt!=null?o.vt:v.currentTime,o)*(o.fz||1);
    cw/=z;ch/=z;
    const targetX=(o.cx!=null?o.cx:sw/2);
    const targetY=(o.fy!=null?o.fy*sh:sh/2);
    const x=Math.min(Math.max(targetX-cw/2,0),sw-cw);
    const y=Math.min(Math.max(targetY-ch/2,0),Math.max(sh-ch,0));
    ctx.drawImage(v,x,y,cw,ch,0,0,o.w,o.h);
    if(o.hl){const fb=v._fb&&performance.now()-(v._fbt||0)<1200?v._fb:null;
      if(fb){o.hp={x:(fb.cx-x)/cw*o.w,y:(fb.cy-y)/ch*o.h};o.hr=fb.w/cw*o.w*.75}else{o.hp={x:((o.hx??.5)*sw-x)/cw*o.w,y:((o.hy??.5)*sh-y)/ch*o.h};o.hr=Math.min(o.w,o.h)*.13}}
  }
  ctx.filter='none';
  hl2(ctx,o);
  fx2(ctx,v,o);
  }
  if(SHK)ctx.restore();
  if(presetTransform)ctx.restore();
  if(outer)ctx.restore();
  if(!over)return;
  ctx.filter='none';

  if(config)renderPresetOverlay(ctx,state,o.w,o.h);else ov(ctx,o,cues);

  if(o.cap){
    const t=o.vt!=null?o.vt:v.currentTime;
    // Pick the LAST cue that has started. A plain find() would return an older cue at
    // an exact boundary, which reads as the caption lagging behind the voice.
    const index=intervalAt(cues,t),c=index>=0?cues[index]:null;
    if(c&&t<=c.e)caps(ctx,c,t,o);
  }
}

// Light leak / film burn: painted ONLY between two shots, aligned to the edit
// boundary, peaking in the middle of the transition and fading out at both ends.
// Drawn under the captions so text is never obscured.
function trFx(ctx,o){
  if(!o.trType||o.trType==='dissolve'||!(o.trK>0))return;
  const k=Math.max(0,Math.min(1,o.trK));
  const peak=Math.sin(Math.PI*easeInOutCubic(k));
  if(peak<=0)return;
  ctx.save();
  if(o.trType==='leak'){
    ctx.globalCompositeOperation='screen';
    const lx=o.w*(1.12-easeInOutCubic(k)*1.24);
    const g=ctx.createRadialGradient(lx,o.h*.42,0,lx,o.h*.42,o.w*.72);
    g.addColorStop(0,'rgba(255,244,205,'+(0.22*peak).toFixed(3)+')');
    g.addColorStop(.4,'rgba(255,184,105,'+(0.12*peak).toFixed(3)+')');
    g.addColorStop(1,'rgba(255,90,40,0)');
    ctx.fillStyle=g;ctx.fillRect(0,0,o.w,o.h);
  }else if(o.trType==='burn'){
    ctx.globalCompositeOperation='screen';
    ctx.filter='blur('+Math.max(8,o.w*.025)+'px)';
    ctx.globalAlpha=.28*peak;
    const g=ctx.createLinearGradient(0,0,o.w,0);
    g.addColorStop(0,'rgba(255,82,32,0)');
    g.addColorStop(.28,'rgba(255,126,47,.55)');
    g.addColorStop(.55,'rgba(255,226,147,.7)');
    g.addColorStop(1,'rgba(255,82,32,0)');
    ctx.fillStyle=g;ctx.fillRect(o.w*(.12-k*.18),0,o.w*.9,o.h);
    ctx.filter='none';ctx.globalAlpha=.14*peak;
    ctx.fillStyle='rgba(255,239,184,1)';ctx.fillRect(0,0,o.w,o.h);
  }
  ctx.restore();
}

async function track(v){
  const sw=v.videoWidth;if(cx==null)cx=sw/2;let tg=sw*$('pos').value/100;
  if($('face').checked&&det&&performance.now()-lastDet>180){
    lastDet=performance.now();
    try{
      const f=await det.detect(v);
      if(f.length){
        const b=f.sort((a,b)=>b.boundingBox.width-a.boundingBox.width)[0].boundingBox;
        tg=b.x+b.width/2;v._ft=tg;v._fb={cx:tg,cy:b.y+b.height/2,w:b.width};v._fbt=performance.now();
      }
    }catch(e){}
  }else if($('face').checked&&det&&v._ft!=null)tg=v._ft;
  cx+=(tg-cx)*0.12;
}

function opts(w,h,c){
  c=c||clips[cur]||{};
  return{
    w,h,
    mode:$('mode').value,
    cx,
    cap:$('cap').checked,
    fs:+$('csz').value,
    grade:$('grade').value,
    exposure:Number($('exposure')?.value)||0,
    contrast:Number($('contrast')?.value)||1,
    saturation:$('saturation')?Number($('saturation').value):1,
    acc:$('acc').value,
    tc:$('tc').value,
    sc_col:$('sc_col').value,
    sw:$('sw').value,
    caps_lock:$('caps_lock').checked,
    zoom:$('zoom').checked,
    vig:$('vig').checked,
    grain:$('grain').checked,
    glow:getPreset($('cs').value)?false:$('glow').checked,
    bar:$('bar').checked,
    cs:$('cs').value,
    timeline:isStoryMode()?c.edl:null,
    presetMotion:$('preset_motion')?.checked??true,
    presetGlitch:$('preset_glitch')?.checked??false,
    presetShake:$('preset_shake')?.checked??false,
    presetBacking:$('preset_backing')?.checked??false,
    presetBw:$('preset_bw')?.checked??false,
    presetGlow:$('preset_glow')?.checked??true,
    presetAccent:$('preset_accent')?.value||'auto',
    captionIntro:Number($('cfade').value)/100,
    referenceStyle:$('cs').value==='reference',
    speechRuns:c.aud?.speechRuns??c.aud?.runs??null,
    referenceAccent:$('reference_accent')?.value||'auto',
    referenceWords:Number($('reference_words')?.value)||8,
    referenceReveal:$('reference_reveal')?.value||'line',
    referenceIntro:Number($('reference_intro')?.value)/1000||0,
    hook:$('hook').value.trim(),
    mark:$('mark').value.trim(),
    fx:c.fx||[],
    cf:$('cf').value,
    cy:+$('cy').value/100,
    cx_pos:+$('cx_pos').value/100,
    chunk_size:$('chunk_size')?$('chunk_size').value:'3'
  };
}

(function loop(){
  if(cur>=0&&!busy&&!edlPlaying&&!isScrubbing&&!(isStoryMode()&&clips[cur].edl.length)){
    track(pv);
    draw(px,pv,clips[cur].cues,opts(360,640));
  }
  requestAnimationFrame(loop);
})();

// Canvas click to interactively position subject focus / highlight in commentary mode
$('pc').onclick=e=>{
  if(cur<0)return;
  const c=clips[cur];
  const rect=$('pc').getBoundingClientRect();
  const clickX=Math.max(0.05,Math.min(0.95,(e.clientX-rect.left)/rect.width));
  const clickY=Math.max(0.05,Math.min(0.95,(e.clientY-rect.top)/rect.height));
  if(c.edl&&c.edl.length){
    const segIdx=activeSegIdx>=0&&activeSegIdx<c.edl.length?activeSegIdx:0;
    c.edl[segIdx].fx=+clickX.toFixed(2);
    c.edl[segIdx].fy=+clickY.toFixed(2);
    if($('moment_modal').style.display==='flex'){
      $('m_fx').value=Math.round(clickX*100);$('m_fx_val').textContent=$('m_fx').value+'%';
      $('m_fy').value=Math.round(clickY*100);$('m_fy_val').textContent=$('m_fy').value+'%';
    }
    $('ed').value=edlToText(c.edl);
    renderTimeline();
    setStatus('Subject focus updated for moment #'+(segIdx+1)+': ('+clickX.toFixed(2)+', '+clickY.toFixed(2)+')');
  }
};

// Studio-Grade Sound Effects Synthesizer (Warm, organic, non-piercing)
// The noise bed is identical for every cue, so it is generated once per AudioContext
const _nzCache=new WeakMap();
function nz(ac){
  let b=_nzCache.get(ac);
  if(!b){
    b=ac.createBuffer(1,Math.floor(ac.sampleRate*0.6),ac.sampleRate);
    const d=b.getChannelData(0);
    let seed=123456789;for(let i=0;i<d.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;d[i]=(seed/4294967296*2-1)*.6}
    _nzCache.set(ac,b);
  }
  return b;
}
function sfx(ac,m,k,t){
  const g=ac.createGain();g.connect(m);
  const N=()=>{const s=ac.createBufferSource();s.buffer=nz(ac);return s};
  const env=(a,pk,d)=>{
    g.gain.setValueAtTime(0.0001,t);
    g.gain.linearRampToValueAtTime(pk*0.45,t+a);
    g.gain.exponentialRampToValueAtTime(0.0001,t+a+d);
  };
  if(k==='whoosh'||k==='riser'){
    const s=N(),f=ac.createBiquadFilter();f.type='bandpass';f.Q.value=0.85;
    const r=k==='riser',d=r?0.6:0.32;
    f.frequency.setValueAtTime(r?250:350,t);
    f.frequency.exponentialRampToValueAtTime(r?2200:1600,t+d);
    s.connect(f);f.connect(g);env(d*0.4,0.45,d*0.6);s.start(t);s.stop(t+d+0.05);
  }else if(k==='hit'){
    // Warm cinema sub-bass thump instead of harsh treble bang
    const o=ac.createOscillator();o.frequency.setValueAtTime(95,t);o.frequency.exponentialRampToValueAtTime(32,t+0.3);
    o.connect(g);env(0.008,0.65,0.35);o.start(t);o.stop(t+0.45);
    const s=N(),f=ac.createBiquadFilter();f.type='lowpass';f.frequency.value=400;
    s.connect(f);f.connect(g);s.start(t);s.stop(t+0.08);
  }else if(k==='ding'){
    // Warm acoustic marimba / celesta chime
    [880,1320].forEach((fr,i)=>{
      const o=ac.createOscillator();o.type='sine';o.frequency.value=fr;const q=ac.createGain();
      q.gain.value=i?0.2:0.4;o.connect(q);q.connect(g);o.start(t);o.stop(t+0.7);
    });
    env(0.006,0.38,0.65);
  }else if(k==='pop'){
    // Organic wooden knock pop
    const o=ac.createOscillator();o.frequency.setValueAtTime(450,t);o.frequency.exponentialRampToValueAtTime(120,t+0.07);
    o.connect(g);env(0.002,0.48,0.07);o.start(t);o.stop(t+0.12);
  }else if(k==='scratch'){
    const o=ac.createOscillator();o.type='triangle';o.frequency.setValueAtTime(600,t);
    o.frequency.exponentialRampToValueAtTime(140,t+0.22);
    const f=ac.createBiquadFilter();f.type='bandpass';f.frequency.value=900;
    o.connect(f);f.connect(g);env(0.008,0.35,0.22);o.start(t);o.stop(t+0.28);
  }
}

$('tfx').onclick=()=>{
  const ac=new AudioContext(),m=ac.createGain();
  m.gain.value=$('sv').value/100;m.connect(ac.destination);
  ['whoosh','hit','ding','pop','scratch','riser'].forEach((k,i)=>sfx(ac,m,k,ac.currentTime+i*1.1));
  setTimeout(()=>ac.close().catch(()=>{}),7500);
};

const KW={scratch:/\b(what|wait|huh|hold on|rewind|oops)\b/,ding:/\b(wow|amazing|yes|win|won|finally|look|watch)\b/,hit:/\b(boom|bang|crash|stop|no|insane|crazy)\b/,whoosh:/\b(go|run|fast|quick|jump|then|suddenly)\b/,pop:/\b(haha|lol|funny|gotcha)\b/};

$('an').onclick=async()=>{
  if(cur<0||busy)return;
  const c=clips[cur];let ev=[];busy=true;pv.pause();
  showTaskProgress('Analyzing audio',`Reading ${c.file.name} for impact points…`,0);
  try{
    setStatus('Analyzing audio energy…');
    const ac=new AudioContext();
    let buf;try{buf=await ac.decodeAudioData(await c.file.arrayBuffer())}finally{await ac.close()}
    const d=buf.getChannelData(0),w=Math.floor(buf.sampleRate*.05),r=[];
    const totalWindows=Math.max(1,Math.floor((d.length-w)/w));
    let windowIndex=0;
    for(let i=0;i+w<d.length;i+=w){
      let s=0;for(let j=0;j<w;j++)s+=d[i+j]*d[i+j];r.push(Math.sqrt(s/w));
      if((windowIndex++%80)===0)updateTaskProgress(windowIndex/totalWindows*70,`Scanning audio energy… ${Math.round(windowIndex/totalWindows*70)}%`,'Analyzing audio');
    }
    for(let i=40;i<r.length;i++){
      let a=0;for(let j=i-40;j<i;j++)a+=r[j];a/=40;
      // Only detect truly massive audio impacts (above 0.22 amplitude and 3.5x baseline)
      if(r[i]>0.22&&r[i]>a*3.5)ev.push({t:i*.05,k:'hit'});
    }
  }catch(e){busy=false;hideTaskProgress();setStatus('Audio analysis failed: '+(e?.message||e));return}
  updateTaskProgress(82,'Matching detected peaks to caption words…','Analyzing audio');
  c.cues.forEach(q=>{
    const s=q.t.toLowerCase();
    for(const k in KW)if(KW[k].test(s)){ev.push({t:q.s,k});break;}
  });
  const gap={light:8.0,normal:4.5,heavy:2.5}[$('fxi').value]||6.0;
  ev.sort((a,b)=>a.t-b.t);
  let out=[],last=-99;
  for(const e of ev){if(e.t-last>=gap){out.push(e);last=e.t}}
  c.fx=out.map(e=>({t:+e.t.toFixed(2),k:e.k}));
  showCues();updateTaskProgress(100,'Audio analysis complete.','Analyzing audio');busy=false;
  renderTimeline();
  setStatus('Found '+c.fx.length+' clean, non-intrusive SFX accent points.');
  hideTaskProgress();
};

// VOICESTUDIO AUDIO LOADER & WAVEFORM EXTRACTOR
async function loadAud(f,c){
  if(f.size>100*1024*1024)throw new Error('Narration limit is 100 MB.');
  const ac=new AudioContext();let buf;
  try{buf=await ac.decodeAudioData(await f.arrayBuffer())}finally{await ac.close()}
  if(buf.duration>300)throw new Error('Narration limit is five minutes.');
  const previous=c.aud||c.narration,activity=analyzeNarration(Array.from({length:buf.numberOfChannels},(_,channel)=>buf.getChannelData(channel)),buf.sampleRate);
  if(previous&&(previous.name!==f.name||Math.abs((previous.dur||0)-buf.duration)>.05)){c.wordAlignment=null;c.captionTimingStale=!!c.cues.length;}
  c.aud={buf,name:f.name,dur:buf.duration,runs:activity.runs,speechRuns:activity.runs,waveform:activity.levels};
}

// SMART AUDIO-TO-CAPTION ALIGNMENT (Precision Snapping to VoiceStudio speech pauses & syllables)
function align(c,lines){
  if(c.wordAlignment?.words?.length)return alignmentForLines(lines,c.wordAlignment.words);
  const Rn=(c.aud&&c.aud.runs)||[];
  const audDur=(c.aud&&c.aud.dur)||30;
  if(c.aud&&!Rn.length)throw new Error('The narration contains no detected audio activity. No caption times were generated.');
  if(!Rn.length||!lines.length){
    return lines.map((l,i)=>{
      const s=i*audDur/lines.length;
      const e=(i+1)*audDur/lines.length;
      const ws=l.split(/\s+/).filter(Boolean);
    const span=Math.max(0.1,e-s);
    // No speech energy detected: predictable fallback, one evenly shared span per word
    return {s:+s.toFixed(2),e:+e.toFixed(2),w:ws.map((_,k)=>{
      const a=s+k*(span/Math.max(1,ws.length)),b=s+(k+1)*(span/Math.max(1,ws.length));
      return {s:+Math.max(s,a).toFixed(3),e:+Math.min(e,Math.max(a+.05,b)).toFixed(3)};
    })};
    });
  }

  // Weight each word by vowel density, syllables, and length
  const wt=w=>Math.max(1,(w.match(/[aeiouy]+/gi)||[]).length)+w.length*0.14;
  const lw=lines.map(l=>l.split(/\s+/).filter(Boolean));
  const lg=lw.map(a=>a.reduce((s,w)=>s+wt(w),0)||1);

  // Cumulative voiced speech time
  const cv=[];
  let V=0;
  Rn.forEach(q=>{cv.push(V);V+=Math.max(0.01,q[1]-q[0])});

// Map virtual voiced time to actual audio seconds.
// A line boundary must land in the SILENCE between two utterances - centred in the
// gap. Landing it on the end of the previous utterance made every cue disappear at
// the instant its last word finished, so that word could never show as highlighted.
const real=(vt,isStart)=>{
  for(let i=0;i<Rn.length;i++){
    const L=Rn[i][1]-Rn[i][0];
    if(isStart?vt<cv[i]+L:vt<=cv[i]+L){
      const atEnd=!isStart&&Math.abs(vt-(cv[i]+L))<1e-6;
      if(atEnd){
        return Rn[i][1]; // Never extend speech timing into the pause.
      }
      return Rn[i][0]+Math.max(0,vt-cv[i]);
    }
  }
  return Rn[Rn.length-1][1];
};

  const n=lines.length;
  const T=lg.reduce((a,b)=>a+b,0);
  const tg=[];
  let cs=0;
  for(let i=0;i<n-1;i++){
    cs+=lg[i];
    tg.push(cs/T*V);
  }

  // Dynamic programming alignment to speech gaps
  let cut=tg.slice();
  const G=Rn.length-1;
  if(n>1&&G>=n-1){
    const f=[],bk=[];
    for(let i=0;i<n-1;i++){
      f.push([]);bk.push([]);
      for(let k=0;k<G;k++){
        const dev=cv[k+1]-tg[i];
        const gapLen=Math.max(0.02,Rn[k+1][0]-Rn[k][1]);
        const cost=dev*dev-2.5*gapLen;
        let best=1e18,bj=-1;
        if(i===0){
          best=0;
        }else{
          for(let j=0;j<k;j++){
            if(f[i-1][j]<best){
              best=f[i-1][j];
              bj=j;
            }
          }
        }
        f[i].push(best+cost);
        bk[i].push(bj);
      }
    }
    let k=0,bv=1e18;
    for(let j=0;j<G;j++){
      if(f[n-2][j]<bv){bv=f[n-2][j];k=j;}
    }
    const ks=[];
    for(let i=n-2;i>=0;i--){
      ks[i]=k;
      k=bk[i][k]<0?0:bk[i][k];
    }
    cut=ks.map(k=>cv[k+1]);
  }

  const out=lines.map((_,i)=>{
    const vs=i?cut[i-1]:0;
    const ve=i<n-1?cut[i]:V;
    const sTime=real(vs,true);
    const eTime=real(ve,false);
    const span=Math.max(0.1,eTime-sTime);

    // Voiced sub-runs inside this line: word boundaries land on the real speech
    // segments, so genuine pauses between words are not filled with fake speech.
    const sub=Rn.filter(r=>r[1]>sTime&&r[0]<eTime)
      .map(r=>[Math.max(r[0],sTime),Math.min(r[1],eTime)])
      .filter(r=>r[1]>r[0]);
    const cv2=[];let V2=0;
    sub.forEach(r=>{cv2.push(V2);V2+=r[1]-r[0]});
    if(!V2)V2=span;
    const real2=(vt,isStart)=>{
      if(!sub.length)return sTime+Math.min(span,Math.max(0,vt));
      for(let k=0;k<sub.length;k++){
        const L=sub[k][1]-sub[k][0];
        if(isStart?vt<cv2[k]+L:vt<=cv2[k]+L)return sub[k][0]+Math.max(0,vt-cv2[k]);
      }
      return sub[sub.length-1][1];
    };

    // Per-word start AND end, in absolute narration seconds
    let a=0;
    const words=lw[i].map(x=>{
      const sB=real2(a/lg[i]*V2,true);
      a+=wt(x);
      const eB=real2(a/lg[i]*V2,false);
      const ws2=Math.min(eTime-.02,Math.max(sTime,sB));
      const we2=Math.max(ws2+.06,Math.min(eTime,eB));
      return {s:+ws2.toFixed(3),e:+we2.toFixed(3)};
    });

    return {
      s:+sTime.toFixed(3),
      e:+eTime.toFixed(3),
      w:words
    };
  });

  return out;
}

// ============================================================
// APPLYING REAL WORD TIMINGS
// Preferred order: (1) real word timestamps already in the project,
// (2) forced alignment (Whisper word timestamps, or an imported JSON
//     produced by whisperx / stable-ts / MFA / any local aligner),
// (3) the predictable estimate above, always labelled as an estimate.
// ============================================================

// Write absolute word times onto the cues as cue-relative spans
function applyWordTimings(c,toks,label,transcript=false,baseCues=c.cues){
 const source=label==='measured'?'estimated':label;
 const timed=alignedCues(baseCues,toks,{source:source||'imported',duration:c.aud?.dur??Infinity,maxWords:Number($('reference_words')?.value)||8,transcript});
 if(!timed.length)throw new Error('No spoken words could be aligned.');
 c.cues=timed;c.cuesEdited=true;c.storyCues=null;c.captionTimingStale=false;
 if(source==='imported'||source==='whisper')c.wordAlignment={words:toks.map(word=>({text:word.text??word.word,start:word.start,end:word.end})),source,narration:c.aud?.name||null};
 clearWordCache(c);showCues();renderTimeline();reportWordTimingSource(c);scheduleSave();
 return timed.reduce((count,cue)=>count+cue.w.length,0);
}
// Re-time every word from the imported narration (speech-run based, no text change)
function retimeWords(){
  if(cur<0)return;
  const c=clips[cur];
  if(!c.cues||!c.cues.length){setStatus('Generate captions first (Step 1/3), then re-time words.');return}
  if(!c.aud){setStatus('Import the VoiceStudio MP3 first (Step 2) to measure word times.');return}
  try{
  const lines=c.cues.map(q=>q.t);
  const A=align(c,lines);
  const toks=[];
  A.forEach((a,li)=>{
    const ws=lines[li].split(/\s+/).filter(Boolean);
    if(!a.w||a.w.length!==ws.length)return;
    a.w.forEach((w,wi)=>toks.push({text:ws[wi],start:w.s,end:w.e}));
  });
  const n=applyWordTimings(c,toks,c.wordAlignment?.source||'estimated');
  const src=reportWordTimingSource(c);
  setStatus((c.aud.runs&&c.aud.runs.length)
    ?'Re-timed '+n+' words from the narration audio ('+src+').'
    :'No speech detected in the audio: word times are estimated, not precise. Import word timings or run Whisper alignment.');
  }catch(error){setStatus('Re-time failed: '+error.message)}
}

// Accepts whisper / whisperx / stable-ts / MFA style JSON
$('wpjson').onchange=async e=>{
  const f=e.target.files[0];if(!f||cur<0)return;
  try{
    const j=JSON.parse(await f.text());
    const toks=[];
    const push=x=>{if(x&&(x.start!=null))toks.push({text:x.word!=null?x.word:x.text,start:+x.start,end:+x.end})};
    if(Array.isArray(j))j.forEach(push);
    else if(Array.isArray(j.words))j.words.forEach(push);
    else if(Array.isArray(j.segments))j.segments.forEach(s=>(s.words||[]).forEach(push));
    else if(Array.isArray(j.chunks))j.chunks.forEach(push);
    else if(Array.isArray(j.cues))j.cues.forEach(q=>(q.words||[]).forEach(push));
    else if(j.result)j.result.forEach(push);
    if(!toks.length){setStatus('That file contained no recognisable word timestamps.');return}
    const c=clips[cur];
    validateWords(toks,c.aud?.dur??Infinity);
    const n=applyWordTimings(c,toks,'imported',$('caption_text_source')?.value==='transcript');
    setStatus('Imported '+n+' word timestamps from '+f.name+'.');
  }catch(err){
    setStatus('Could not read that word-timing file: '+(err&&err.message||err));
  }
  e.target.value='';
};

async function toMono16k(buf){
  const sr=16000,len=Math.max(1,Math.ceil(buf.duration*sr)),out=new Float32Array(len);
  const d0=buf.getChannelData(0),d1=buf.numberOfChannels>1?buf.getChannelData(1):null;
  const ratio=buf.sampleRate/sr,L0=d0.length-1,L1=d1?d1.length-1:L0;
  for(let i=0;i<len;i++){
    const p=i*ratio,i0=Math.floor(p),f=p-i0;
    const a0=d0[Math.min(L0,i0)],a1=d0[Math.min(L0,i0+1)];
    const b0=d1?d1[Math.min(L1,i0)]:a0,b1=d1?d1[Math.min(L1,i0+1)]:a1;
    out[i]=((a0*(1-f)+a1*f)+(b0*(1-f)+b1*f))/2;
  }
  return out;
}

// OPTIONAL genuine forced alignment. The model is fetched only when this button is
// pressed, so the app keeps working fully offline with the estimated fallback.
function hasSpeechTimings(c){return !c.captionTimingStale&&(!!c.wordAlignment?.words?.length||!!c.cues?.length&&c.cues.every(cue=>cue.w?.length&&['manual','imported','whisper'].includes(cue.src)));}
async function whisperAlignWords(){
 if(cur<0||busy)return false;const c=clips[cur];
 if(!c.aud){setStatus('Import narration first.');return false}
 if(!c.aud.runs.length){setStatus('No narration activity was detected. Silent audio cannot produce captions.');return false}
 const transcript=$('caption_text_source')?.value==='transcript';
 const baseCues=c.cues.length?c.cues:splitLines($('sc').value).map(t=>({t}));
 if(!transcript&&!baseCues.length){setStatus('Enter the narration script, or select “Use recognized speech”.');return false}
 if(!window.Worker||navigator.deviceMemory&&navigator.deviceMemory<4){setStatus('This device cannot run local speech recognition. Import word timing JSON or select manual timing.');return false}
 if(!await (window.studioConfirm?.('Synchronize captions to spoken words? The English speech model downloads on first use (roughly 150 MB plus runtime), then runs locally. Your audio is not uploaded.')??Promise.resolve(false)))return false;
 checkpoint();busy=true;let worker,timer;const cancel=document.createElement('button');cancel.textContent='Cancel speech sync';cancel.className='warn sm alignment-cancel';$('project_toolbar').append(cancel);
 showTaskProgress('Syncing captions',`Preparing local speech recognition for ${c.aud.name}…`,5,()=>cancel.click());
 try{
  updateTaskProgress(15,'Converting narration to speech-sync samples…','Syncing captions');
  const pcm=await toMono16k(c.aud.buf);worker=new Worker(new URL('./workers/alignment.worker.js',import.meta.url),{type:'module'});
  const rawTokens=await new Promise((resolve,reject)=>{
   cancel.onclick=()=>reject(new Error('Speech sync cancelled.'));
   timer=setTimeout(()=>reject(new Error('Speech sync exceeded the ten-minute resource limit.')),600000);
   worker.onerror=event=>reject(new Error(event.message||'Speech recognition worker failed.'));
   worker.onmessage=event=>{const result=event.data;if(result.error)reject(new Error(result.error));else if(result.tokens)resolve(result.tokens);else if(result.progress){const p=result.progress;const pct=p.total?Math.round(p.loaded/p.total*75):35;updateTaskProgress(Math.min(90,20+pct),p.file||p.status||'Loading speech model…','Syncing captions');setStatus('Speech sync: '+(p.file||p.status||'loading')+(p.total?' '+Math.round(p.loaded/p.total*100)+'%':''))}};
   worker.postMessage({pcm},[pcm.buffer]);
  });
  updateTaskProgress(92,'Aligning recognized words to caption phrases…','Syncing captions');
  const tokens=anchorRecognizedOnsets(rawTokens,c.aud.speechRuns||c.aud.runs);
  validateWords(tokens,c.aud.dur);const count=applyWordTimings(c,tokens,'whisper',transcript,baseCues);
  if(transcript)$('sc').value=c.cues.map(cue=>cue.t).join('\n');
  setStatus('Synchronized '+count+' words to recognized speech; silent intervals are blank. Review recognition accuracy before exporting.');return true;
 }catch(error){setStatus('Speech sync failed: '+error.message+' Existing caption times were kept.');return false}
 finally{clearTimeout(timer);worker?.terminate();cancel.remove();busy=false;hideTaskProgress()}
}const SFX_KEYS=['','whoosh','hit','ding','pop','scratch','riser'];
const CAM_KEYS=['wide','medium','close_face','drift','close_left','close_right','pan','custom'];
function validSfx(k){return SFX_KEYS.indexOf(k)>=0}
function validCam(k){return CAM_KEYS.indexOf(k)>=0}
const TR_KEYS=['cut','dissolve','leak','burn'];
function parseTr(s){
  if(typeof s!=='string'||!s)return{type:'cut',d:0};
  const p=s.split(':');
  if(TR_KEYS.indexOf(p[0])<0)return{type:'cut',d:0};
  const d=parseFloat(p[1]);
  return{type:p[0],d:(isFinite(d)&&d>0)?d:0};
}

function edlToText(edl){
  return edl.map(g=>[
    g.s.toFixed(2),
    g.e.toFixed(2),
    g.sp,
    g.rev?1:0,
    g.z,
    g.fx!=null?g.fx:.5,
    g.fy!=null?g.fy:.5,
    g.hl||'',
    g.lb||'',
    g.camera||'wide',
    g.clipIdx!=null?g.clipIdx:0,
    g.t,
    validSfx(g.sfx)?g.sfx:'',
    g.cut===0?0:1,
    g.o0||0,
    g.sd||0,
    (g.tr&&g.tr.d>0)?(g.tr.type+':'+g.tr.d):''
  ].join('|')).join('\n');
}

function textToEdl(text){
  return text.split('\n').map(l=>{
    if(!l.trim())return null;
    const p=l.split('|');
    if(p.length<2)return null;
    const n=(x,d)=>x===''||x==null||isNaN(+x)?d:+x;
    let s=+p[0], e=+p[1];
    let sp=n(p[2],1);
    let rev=p[3]==='1';
    let z=n(p[4],1);
    let fx=n(p[5],.5);
    let fy=n(p[6],.5);
    let hl=p[7]==='ring'||p[7]==='spot'?p[7]:'';
    let lb=p[8]||'';
    let camera=validCam(p[9])?p[9]:'wide';
    let clipIdx=n(p[10],0);

    let txt='', sfxRaw='', cut=1, o0=0, sd=0, tr={type:'cut',d:0};
    if(p.length>=17){
      const tailCount=5;
      txt=p.slice(11, p.length-tailCount).join('|');
      sfxRaw=(p[p.length-5]||'').trim();
      cut=p[p.length-4]==='0'?0:1;
      o0=n(p[p.length-3],0);
      sd=n(p[p.length-2],0);
      tr=parseTr(p[p.length-1]);
    }else if(p.length>=13){
      const hasSfx=validSfx((p[p.length-1]||'').trim());
      if(hasSfx){
        sfxRaw=(p[p.length-1]||'').trim();
        txt=p.slice(11, p.length-1).join('|');
      }else{
        txt=p.slice(11).join('|');
      }
    }else if(p.length>=12){
      txt=p.slice(11).join('|');
    }else{
      txt=p.slice(9).join('|');
    }

    return{
      s, e, sp, rev, z, fx, fy, hl, lb, camera, clipIdx,
      t: txt,
      sfx: validSfx(sfxRaw)?sfxRaw:'',
      cut, o0, sd, tr
    };
  }).filter(g=>g&&isFinite(g.s)&&isFinite(g.e)&&g.e>g.s);
}

function updateDurBanner(c){
  const banner=$('dur_match_banner');
  const txt=$('dur_match_text');
  if(!banner||!txt)return;
  if(c&&c.aud&&c.edl&&c.edl.length){
    banner.style.display='inline-flex';
    const audDur=c.aud.dur;
    const vidDur=c.edl.reduce((a,g)=>a+(g.e-g.s)/g.sp,0);
    txt.textContent=`Voice: ${audDur.toFixed(2)}s • Picture: ${vidDur.toFixed(2)}s • Output: ${storyDuration(c).end.toFixed(2)}s`;
  }else{
    banner.style.display='none';
  }
}

function rebuildCuesAndFx(c){
  invalidateTimeline(c.edl);
  let t=0;if(!c.cuesEdited)c.cues=[];if(!c.fxEdited)c.fx=[];
  const totalEdl=c.edl.length;
  const fxiVal=$('fxi')?$('fxi').value:'light';
  // Minimum spacing between sound effects based on user intensity preference
  const minSpacing=fxiVal==='heavy'?2.0:fxiVal==='normal'?4.0:7.0;
  let lastFxTime=-999;

  // Story mode: captions are owned by the narration master timeline, so a sentence
    // that spans a video cut continues across it instead of restarting.
    // A hand-edited caption box also owns the list and must never be overwritten.
    if(c.cuesEdited&&c.cues&&c.cues.length){
      // keep the user's cues exactly as typed; only the sound design is rebuilt below
    }else if(c.storyCues&&c.storyCues.length){
      c.cues=c.storyCues.map(q=>({s:q.s,e:q.e,t:q.t,w:q.w||null,src:q.src||'accum'}));
    }

    c.edl.forEach((g,i)=>{
    const d=(g.e-g.s)/g.sp;
    const a=c.aud&&c.align&&c.align[i];

    if(!(c.cuesEdited&&c.cues&&c.cues.length)&&!(c.storyCues&&c.storyCues.length)){
      if(g.cap&&g.cap.length){
        g.cap.forEach(cp=>{
          const txt=(typeof cp==='string')?cp:cp.t;
          if(!txt)return;
          c.cues.push({s:+t.toFixed(2),e:+(t+d).toFixed(2),t:txt,src:'accum'});
        });
      }else if(g.t){
        c.cues.push(a?{s:a.s,e:a.e,t:g.t,w:relWords(a.w,a.s),src:'measured'}:{s:+t.toFixed(2),e:+(t+d).toFixed(2),t:g.t,src:'accum'});
      }
    }

    // Professional Sound Design: Only accent genuine visual shifts, never spam every line
    const textLower=((g.t||'')+(g.cap?g.cap.map(x=>typeof x==='string'?x:(x&&x.t)||'').join(' '):'')).toLowerCase();
    const isRewind=!!g.rev;
    const isBigClimax=g.z>=1.55||/\b(boom|clutch|unbelievable|legendary|disaster|champion)\b/.test(textLower);
    const hasIntentionalHighlight=!!g.hl;
    const isNoticeableTransition=i>0&&g.camera!=='wide'&&c.edl[i-1].camera!==g.camera&&(fxiVal!=='light'||i%3===0);

    // Manual per-moment SFX always wins: use it and skip every auto rule for this segment
    const manualSfx=validSfx(g.sfx)?g.sfx:'';
    const currentTime=+t.toFixed(2);
    if(c.fxEdited){ /* Keep manually edited sound events. */ }else if(manualSfx){
      c.fx.push({t:currentTime,k:manualSfx});
      lastFxTime=currentTime;
    }else if(currentTime-lastFxTime>=minSpacing){
      if(isRewind){
        c.fx.push({t:currentTime,k:'scratch'});
        lastFxTime=currentTime;
      }else if(isBigClimax){
        c.fx.push({t:+(currentTime+0.1).toFixed(2),k:'hit'});
        lastFxTime=currentTime;
      }else if(hasIntentionalHighlight){
        c.fx.push({t:+(currentTime+0.08).toFixed(2),k:'ding'});
        lastFxTime=currentTime;
      }else if(isNoticeableTransition&&(fxiVal==='heavy'||fxiVal==='normal')){
        c.fx.push({t:currentTime,k:'whoosh'});
        lastFxTime=currentTime;
      }
    }
    t+=d;
  });
  c.fx.sort((a,b)=>a.t-b.t);
  clearWordCache(c);
  showCues();
  updateDurBanner(c);
  renderTimeline();
  reportWordTimingSource(c);
}

// Reports honestly whether captions are running on measured word times or the estimate
function reportWordTimingSource(c){
 const b=$('wp_src');if(!b)return '';
 const sources=new Set((c?.cues||[]).map(cue=>cue.src));
 const text=!(c?.cues?.length)?'no captions yet':sources.size>1?'mixed timing sources — review against audio':sources.has('whisper')?'speech-recognized word timing — review wording':sources.has('imported')?'imported word timing — review against audio':sources.has('manual')?'manual word timing':'estimated word timing — approximate';
 b.textContent=text;return text;
}

$('ed').onchange=()=>{
  if(cur<0)return;
  const c=clips[cur];
  const proposed=textToEdl($('ed').value);
  try{validateTimeline(proposed,clips,c);if(c.edl.some((g,i)=>g.lock&&JSON.stringify({...g,_f:undefined})!==JSON.stringify({...proposed[i],_f:undefined})))throw new Error('Unlock shots before changing their raw timeline.');c.edl=proposed}catch(error){setStatus(error.message);return}
  // Hand-edited s/e invalidate the word alignment, so rebuild from the accumulator
  delete c.align;
  activeSegIdx=Math.max(0,Math.min(activeSegIdx,c.edl.length-1));
  rebuildCuesAndFx(c);
};

// ==========================================
// PROFESSIONAL TIMELINE NLE RENDERER & SCRUBBER
// (REBUILT: 2-column layout, proper scrolling, draggable playhead)
// ==========================================
function renderTimeline(){
  if(cur<0)return;
  const c=clips[cur];
  const edlArr=c.edl||[];
  const edlDur=edlArr.length?edlArr.reduce((a,g)=>a+(g.e-g.s)/g.sp,0):0;
  const audDur=c.aud?(c.aud.dur||0):0;
  // Ruler always spans the longest available source: raw video, voice track, or 30s minimum
  const outputDuration=edlArr.length?storyDuration(c).end:0;
  const rulerDur=Math.max(Number.isFinite(pv.duration)?pv.duration:0,audDur,outputDuration,30);
  const tot=outputDuration||audDur||edlDur||pv.duration||30;
  const width=Math.max(800,Math.round(rulerDur*tlPixelsPerSec+40));

  $('tl_inner').style.width=width+'px';
  $('tl_info').textContent=edlArr.length+' Moments • '+tot.toFixed(1)+'s';

  // Lane backgrounds are always drawn so the 4 tracks read as a timeline even with no EDL
  ['tl_video_lane','tl_audio_lane','tl_cap_lane','tl_fx_lane'].forEach(id=>{
    $(id).style.background='rgba(255,255,255,.035)';
  });

  // 1. Render Ruler Lane (directly in the lane row, no header offset)
  const rLane=$('tl_ruler_lane');rLane.innerHTML='';
  const step=tlPixelsPerSec<30?5:tlPixelsPerSec<60?2:1;
  for(let sec=0;sec<=rulerDur+1;sec+=step){
    const tick=document.createElement('div');
    tick.style.cssText=`position:absolute;left:${sec*tlPixelsPerSec}px;top:0;bottom:0;width:1px;background:rgba(255,255,255,.2);font-size:9px;color:var(--mu);padding-left:3px;pointer-events:none`;
    tick.textContent=sec+'s';
    rLane.appendChild(tick);
  }
  // Add half-second minor ticks when zoomed in
  if(tlPixelsPerSec>=60){
    for(let sec=0.5;sec<=rulerDur+1;sec+=1){
      const tick=document.createElement('div');
      tick.style.cssText=`position:absolute;left:${sec*tlPixelsPerSec}px;top:12px;bottom:0;width:1px;background:rgba(255,255,255,.08);pointer-events:none`;
      rLane.appendChild(tick);
    }
  }

  // 2. Render Video Track (V1)
  const vLane=$('tl_video_lane');vLane.innerHTML='';
  let accum=0;
  edlArr.forEach((g,i)=>{
    const d=(g.e-g.s)/g.sp;
    const segmentStart=accum;
    const block=document.createElement('div');
    block.className='tl-block tl-block-video'+(i===activeSegIdx?' sel':'');
    block.style.left=(accum*tlPixelsPerSec)+'px';
    block.style.width=Math.max(16,d*tlPixelsPerSec)+'px';
    const isMulti=$('tm').value==='story_multi';
    block.title=`Shot #${i+1}${isMulti?' • '+((clips[g.clipIdx]&&clips[g.clipIdx].file.name)||'clip '+g.clipIdx):''}`+
      (g.tr&&g.tr.d>0?` • ${g.tr.type} ${g.tr.d.toFixed(2)}s`:'')+`\n${g.why||g.t||''}`+
      (g.lock?'\n[locked]':'');
    block.textContent=`#${i+1}${isMulti?' ['+(((clips[g.clipIdx]&&clips[g.clipIdx].file.name)||'clip').replace(/\.[^.]+$/,'').split(' ')[0].slice(0,8))+']':` [${g.camera||'wide'}]`} ${g.sp}x${g.tr&&g.tr.d>0?' '+({dissolve:'~',leak:'*',burn:'%'}[g.tr.type]||''):''}${g.lock?' L':''}`;
    block.onclick=e=>{
      e.stopPropagation();
      activeSegIdx=i;
      seekToTimelineTime(segmentStart);
      renderTimeline();
    };
    block.ondblclick=e=>{
      e.stopPropagation();
      activeSegIdx=i;
      openSelectedMomentEditor();
    };
    if(isMulti){
      block.oncontextmenu=e=>{
        e.preventDefault();e.stopPropagation();
        toggleShotLock(i);
      };
    }
    vLane.appendChild(block);
    accum+=d;
  });
  if(!edlArr.length){
    const hint=document.createElement('div');
    hint.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--mu);pointer-events:none;letter-spacing:.04em';
    hint.textContent='Generate an edit in Step 3';
    vLane.appendChild(hint);
  }

  // 3. Render Audio Waveform Track (A1)
  const wCanvas=$('tl_waveform_canvas');
  wCanvas.width=width;wCanvas.height=34;
  const wCtx=wCanvas.getContext('2d');
  wCtx.clearRect(0,0,width,34);
  if(c.aud&&c.aud.waveform){
    const wf=c.aud.waveform;
    wCtx.fillStyle='rgba(34,195,208,.45)';
    const totalSamples=wf.length;
    for(let x=0;x<audDur*tlPixelsPerSec;x+=2){
      const sIdx=Math.floor(x/(audDur*tlPixelsPerSec)*totalSamples);
      const amp=Math.min(1,(wf[sIdx]||0)*3.5);
      const barH=Math.max(2,amp*30);
      wCtx.fillRect(x,(34-barH)/2,1.5,barH);
    }
  }

  // 4. Render Captions Track (T1)
  const tLane=$('tl_cap_lane');tLane.innerHTML='';
  (c.cues||[]).forEach(q=>{
    const d=q.e-q.s;
    const block=document.createElement('div');
    block.className='tl-block tl-block-cap';
    block.style.left=(q.s*tlPixelsPerSec)+'px';
    block.style.width=Math.max(12,d*tlPixelsPerSec)+'px';
    block.title=q.t;
    block.textContent=q.t;
    block.onclick=e=>{
      e.stopPropagation();
      seekToTimelineTime(q.s);
    };
    tLane.appendChild(block);
  });

  // 5. Render FX Track
  const fxLane=$('tl_fx_lane');fxLane.innerHTML='';
  (c.fx||[]).forEach(f=>{
    const block=document.createElement('div');
    block.className='tl-block tl-block-fx';
    block.style.left=(f.t*tlPixelsPerSec)+'px';
    block.style.width='45px';
    block.textContent='⚡ '+f.k;
    fxLane.appendChild(block);
  });

  updatePlayheadPosition(lastKnownTime||0);
}

let lastKnownTime=0;

function updatePlayheadPosition(t){
  lastKnownTime=t;
  const c=cur>=0?clips[cur]:null;
  const tot=(c&&c.edl&&c.edl.length)?storyDuration(c).end:(c&&c.aud?c.aud.dur:pv.duration||30);
  // No offset needed — playhead is inside scrollable lanes area, left=0 corresponds to time=0
  const x=t*tlPixelsPerSec;
  $('playhead').style.left=x+'px';
  $('timecode_display').textContent=`${formatTime(t)} / ${formatTime(tot)}`;

  // Auto-scroll timeline to follow playhead during playback
  if(edlPlaying&&!isScrubbing){
    const scrollEl=$('tl_scroll');
    const viewLeft=scrollEl.scrollLeft;
    const viewRight=viewLeft+scrollEl.clientWidth;
    const margin=scrollEl.clientWidth*0.2;
    if(x>viewRight-margin){
      scrollEl.scrollLeft=x-scrollEl.clientWidth*0.3;
    }else if(x<viewLeft+margin){
      scrollEl.scrollLeft=Math.max(0,x-scrollEl.clientWidth*0.3);
    }
  }
}

// Timeline Scrubbing Logic (REBUILT — uses lanes scroll area directly)
$('tl_ruler_lane').onmousedown=e=>handleScrubStart(e);
$('tl_inner').onmousedown=e=>{
  if(e.target.classList.contains('tl-block'))return;
  handleScrubStart(e);
};

function handleScrubStart(e){
  isScrubbing=true;
  if(edlStopFn){edlStopFn();edlStopFn=null}
  pv.pause();
  handleScrubMove(e);
  window.addEventListener('mousemove',handleScrubMove);
  window.addEventListener('mouseup',handleScrubEnd);
}
function handleScrubMove(e){
  if(!isScrubbing||cur<0)return;
  const rect=$('tl_inner').getBoundingClientRect();
  // No header offset — tl_inner is purely the scrollable lanes area
  const clickX=e.clientX-rect.left;
  const t=Math.max(0,clickX/tlPixelsPerSec);
  seekToTimelineTime(t);
}
function handleScrubEnd(){
  isScrubbing=false;
  window.removeEventListener('mousemove',handleScrubMove);
  window.removeEventListener('mouseup',handleScrubEnd);
}

let queuedPreviewTime=null,previewSeeking=false;
function seekToTimelineTime(t){
 if(cur<0||busy||clips[cur].missing)return;queuedPreviewTime=Math.max(0,t);if(previewSeeking)return;
 previewSeeking=true;
 (async()=>{try{while(queuedPreviewTime!==null){const time=queuedPreviewTime;queuedPreviewTime=null;const c=clips[cur];updatePlayheadPosition(time);
 if(isStoryMode()&&c.edl.length){activeSegIdx=segAt(c,time).i;await storyFrame(px,c,time,storyDuration(c).end,false,360,640)}
 else{await seekV(pv,time);await track(pv);draw(px,pv,c.cues,opts(360,640,c))}
 }}catch(error){setStatus('Preview seek failed: '+error.message)}finally{previewSeeking=false}})();
}

// DEDICATED PREVIEW MOMENT: Plays ONLY the selected segment in isolation!
async function previewSelectedMoment(){
 if(cur<0||busy||!clips[cur].edl.length)return;
 const c=clips[cur],index=Math.max(0,Math.min(c.edl.length-1,activeSegIdx));
 const start=c.edl.slice(0,index).reduce((sum,g)=>sum+(g.e-g.s)/g.sp,0),g=c.edl[index];
 return previewCommentary(start,start+(g.e-g.s)/g.sp);
}
// DEDICATED MOMENT EFFECT CUSTOMIZER MODAL
function openSelectedMomentEditor(){
  if(cur<0||!clips[cur].edl||!clips[cur].edl.length){
    setStatus('Generate commentary edit first (Step 3).');return;
  }
  const c=clips[cur];
  const idx=activeSegIdx>=0&&activeSegIdx<c.edl.length?activeSegIdx:0;
  const seg=c.edl[idx];

  $('m_text').value='';
  $('m_s').value=seg.s.toFixed(2);
  $('m_e').value=seg.e.toFixed(2);
  $('m_camera').value=seg.camera||'wide';
  $('m_zoom').value=seg.z||1.0;$('m_zoom_val').textContent=$('m_zoom').value+'x';
  $('m_fx').value=Math.round((seg.fx!=null?seg.fx:0.5)*100);$('m_fx_val').textContent=$('m_fx').value+'%';
  $('m_fy').value=Math.round((seg.fy!=null?seg.fy:0.45)*100);$('m_fy_val').textContent=$('m_fy').value+'%';
  $('m_sp').value=seg.sp||1.0;
  $('m_rev').checked=!!seg.rev;
  $('m_hl').value=seg.hl||'';
  $('m_lb').value=seg.lb||'';

  // Per-moment SFX is stored on the segment itself, not inferred from the FX track
  $('m_sfx').value=validSfx(seg.sfx)?seg.sfx:'';

  // Story shots carry their own caption lines and transition settings
  const storyShot=!!(seg.cap&&seg.cap.length);
  $('m_text').value=seg.t||(storyShot&&seg.cap[0]?(typeof seg.cap[0]==='string'?seg.cap[0]:seg.cap[0].t):'');
  $('m_trbox').style.display=idx>0?'block':'none';
  const tr=seg.tr||{type:'cut',d:0};
  $('m_tr').value=tr.type||'cut';
  $('m_trd').value=tr.d>0?tr.d.toFixed(2):'0.30';
  $('m_lock').textContent=seg.lock?'Unlock shot':'Lock shot';
  $('modal_title').textContent=seg.why
    ?`✏ Shot #${idx+1} • ${seg.why}`
    :`✏ Customize Moment #${idx+1} [${seg.camera||'wide'}]`;
  $('moment_modal').style.display='flex';
}
$('m_lock').onclick=()=>{
  if(cur<0)return;
  toggleShotLock(activeSegIdx>=0?activeSegIdx:0);
  const seg=clips[cur].edl[activeSegIdx];
  if(seg)$('m_lock').textContent=seg.lock?'Unlock shot':'Lock shot';
};
$('m_tr').onchange=()=>{
  const d=parseFloat($('m_trd').value);
  setStatus($('m_tr').value==='cut'?'Hard cut selected.':'Transition: '+$('m_tr').value+(isFinite(d)?' '+d+'s':'')+'. Press Save to apply.');
};

function closeMomentEditor(){
  cancelFocusPick();
  $('moment_modal').style.display='none';
}

function saveModalMoment(){
  if(cur<0)return;
  const c=clips[cur];
  if(!c.edl||!c.edl.length){setStatus('Generate an edit in Step 3 first.');return}
  const idx=activeSegIdx>=0&&activeSegIdx<c.edl.length?activeSegIdx:0;
  const seg=c.edl[idx];
  if(!seg){setStatus('Invalid number');return}

  // Validate BEFORE writing: an empty/garbage field used to produce NaN and silently drop the moment
  const raw=(id)=>parseFloat($(id).value);
  const rs=raw('m_s'),re=raw('m_e'),rz=raw('m_zoom'),rfx=raw('m_fx'),rfy=raw('m_fy'),rsp=raw('m_sp');
  if(![rs,re,rz,rfx,rfy,rsp].every(v=>isFinite(v))){
    setStatus('Invalid number');
    return;
  }

  // Clamp into the ranges the preview/export engine can actually render
  if(seg.lock){setStatus('Unlock this moment before editing it.');return}
  const source=clips.find(k=>k.id===seg.assetId)||clips[seg.clipIdx??cur];
  if(rs<0||re<=rs||re>source.videoEl.duration){setStatus('Source interval must fit inside the video.');return}
  const nS=Math.max(0,rs);
  const nE=re;
  const nZ=Math.min(2.4,Math.max(1,rz));
  const nFX=Math.min(100,Math.max(0,rfx))/100;
  const nFY=Math.min(100,Math.max(0,rfy))/100;
  const nSP=Math.min(4,Math.max(0.25,rsp));
  const nRev=$('m_rev').checked;

  // Rewind frames are a cache of the old source range: drop it whenever the source changed
  if(seg.rev!==nRev||Math.abs(seg.s-nS)>0.001||Math.abs(seg.e-nE)>0.001)delete seg._f;

  seg.t=$('m_text').value.trim();
  seg.s=+nS.toFixed(2);
  seg.e=+nE.toFixed(2);
  seg.camera=$('m_camera').value;
  seg.manualFraming=true;
  seg.z=+nZ.toFixed(2);
  seg.fx=+nFX.toFixed(2);
  seg.fy=+nFY.toFixed(2);
  seg.sp=+nSP.toFixed(2);
  seg.rev=nRev;
  seg.hl=$('m_hl').value;
  seg.lb=$('m_lb').value.trim();
  const sk=$('m_sfx').value;
  seg.sfx=validSfx(sk)?sk:'';

  // Transition + lock (story shots only; hidden in the other modes)
  if($('m_trbox').style.display!=='none'){
    const ty=$('m_tr').value;
    let td=parseFloat($('m_trd').value);
    if(!isFinite(td))td=0.3;
    td=Math.min(1.2,Math.max(0.1,td));
    seg.tr=(ty==='cut'||ty==='dissolve'||ty==='leak'||ty==='burn')?{type:ty,d:(ty==='cut'?0:td)}:{type:'cut',d:0};
  }

  // The word-alignment map was built for the old s/e: force the accumulator fallback
  delete c.align;

  // Write the clamped values back so the preview matches exactly what was saved
  $('m_s').value=seg.s.toFixed(2);
  $('m_e').value=seg.e.toFixed(2);
  $('m_sp').value=seg.sp;
  $('m_zoom').value=seg.z;seg.z=+$('m_zoom').value;$('m_zoom_val').textContent=seg.z+'x';
  $('m_fx').value=Math.round(seg.fx*100);$('m_fx_val').textContent=$('m_fx').value+'%';
  $('m_fy').value=Math.round(seg.fy*100);$('m_fy_val').textContent=$('m_fy').value+'%';

  $('ed').value=edlToText(c.edl);
  rebuildCuesAndFx(c);
  closeMomentEditor();
  setStatus(`Saved custom effects for Moment #${idx+1}.`);
}

function setModalSpeed(sp){
  const v=parseFloat(sp);
  if(!isFinite(v))return;
  $('m_sp').value=Math.min(4,Math.max(0.25,v));
  // Adjust end time so timeline line duration remains consistent
  const c=cur>=0?clips[cur]:null;
  const idx=c&&c.edl&&c.edl.length?(activeSegIdx>=0&&activeSegIdx<c.edl.length?activeSegIdx:0):-1;
  const al=idx>=0&&c.align&&c.align[idx];
  const lineDur=al?(al.e-al.s):3.0;
  const s0=parseFloat($('m_s').value);
  if(!isFinite(s0))return;
  const base=Math.max(0,s0);
  $('m_e').value=(base+Math.max(0.2,lineDur)*$('m_sp').value).toFixed(2);
}

function nudgeModalTiming(delta){
  const d=parseFloat(delta);const dd=isFinite(d)?d:0;
  let s=parseFloat($('m_s').value);
  let e=parseFloat($('m_e').value);
  if(!isFinite(s))s=0;
  if(!isFinite(e))e=s+0.2;
  s=Math.max(0,s+dd);
  e=Math.max(s+0.2,e+dd);
  $('m_s').value=s.toFixed(2);
  $('m_e').value=e.toFixed(2);
}

// CLICK-TO-PIN FOCUS: the modal overlay sits above the canvas, so it is made click-through
let pickState=null;
function cancelFocusPick(){
  const p=pickState;if(!p)return;
  pickState=null;
  pc.removeEventListener('pointerdown',p.down,true);
  document.removeEventListener('keydown',p.key,true);
  p.md.style.pointerEvents='';p.md.style.background='';p.md.style.backdropFilter='';
  p.cv.style.cursor='';
}
function pickFocusFromCanvas(){
  if(pickState)return;
  const md=$('moment_modal');
  if(md.style.display==='none'){setStatus('Open a moment editor first.');return}
  pickState={md:md,cv:pc,down:null,key:null};
  const finish=function(cancelled){
    cancelFocusPick();
    if(cancelled)setStatus('Focus pick cancelled.');
    else setStatus(`Focus pinned at ${$('m_fx').value}%, ${$('m_fy').value}%. Save to apply.`);
  };
  const onDown=function(ev){
    ev.preventDefault();ev.stopPropagation();
    const r=pc.getBoundingClientRect();
    if(!r.width||!r.height){finish(true);return}
    const fx=Math.min(100,Math.max(0,(ev.clientX-r.left)/r.width*100));
    const fy=Math.min(100,Math.max(0,(ev.clientY-r.top)/r.height*100));
    $('m_fx').value=Math.round(fx);$('m_fy').value=Math.round(fy);
    $('m_fx_val').textContent=$('m_fx').value+'%';
    $('m_fy_val').textContent=$('m_fy').value+'%';
    finish(false);
  };
  const onKey=function(ev){
    if(ev.key==='Escape'){ev.preventDefault();ev.stopPropagation();finish(true)}
  };
  pickState.down=onDown;pickState.key=onKey;
  pc.addEventListener('pointerdown',onDown,true);
  document.addEventListener('keydown',onKey,true);
  // Deferred by a tick: the overlay must stay clickable until the button's own click finishes,
  // otherwise the browser never delivers the click that started this mode.
  setTimeout(function(){
    if(!pickState)return;
    md.style.pointerEvents='none';
    md.style.background='transparent';
    md.style.backdropFilter='none';
    pc.style.cursor='crosshair';
  },0);
  setStatus('Click the preview video to place the subject focus. Esc cancels.');
}

function testModalSfx(){
  const k=$('m_sfx').value;if(!k)return;
  const ac=new AudioContext(),m=ac.createGain();m.gain.value=$('sv').value/100;m.connect(ac.destination);
  setTimeout(()=>ac.close().catch(()=>{}),1500);
  sfx(ac,m,k,ac.currentTime+0.05);
}

function previewModalMoment(){
  saveModalMoment();
  previewSelectedMoment();
}

// Camera Preset Selection Handler
$('m_camera').onchange=()=>{
  const val=$('m_camera').value;
  if(val==='wide'){
    $('m_zoom').value=1.05;$('m_fx').value=50;$('m_fy').value=50;
  }else if(val==='medium'){
    $('m_zoom').value=1.22;$('m_fx').value=50;$('m_fy').value=46;
  }else if(val==='close_face'){
    $('m_zoom').value=1.95;$('m_fx').value=50;$('m_fy').value=38;
  }else if(val==='drift'){
    $('m_zoom').value=1.2;$('m_fx').value=50;$('m_fy').value=45;
  }else if(val==='close_left'){
    $('m_zoom').value=1.85;$('m_fx').value=32;$('m_fy').value=42;
  }else if(val==='close_right'){
    $('m_zoom').value=1.85;$('m_fx').value=68;$('m_fy').value=42;
  }else if(val==='pan'){
    $('m_zoom').value=1.3;$('m_fx').value=35;$('m_fy').value=45;
  }
  $('m_zoom_val').textContent=$('m_zoom').value+'x';
  $('m_fx_val').textContent=$('m_fx').value+'%';
  $('m_fy_val').textContent=$('m_fy').value+'%';
};

// PREVIEW & EDL PLAYBACK WITH DYNAMIC CAMERA MOVEMENT
async function seek(v,t){return seekFrame(v,t,()=>exportCancelled&&busy)}

async function grab(v,s,e,fps){
  if(e-s>8)throw new Error('Reverse preview is limited to eight-second shots to bound memory use.');
  const n=Math.max(2,Math.round((e-s)*fps)),k=Math.min(1,720/v.videoHeight),out=[];v.pause();
  for(let i=0;i<n;i++){
    await seek(v,s+(e-s)*i/n);
    const cv=document.createElement('canvas');cv.width=Math.round(v.videoWidth*k);cv.height=Math.round(v.videoHeight*k);
    cv.getContext('2d').drawImage(v,0,0,cv.width,cv.height);
    cv.videoWidth=cv.width;cv.videoHeight=cv.height;out.push(cv);
  }
  return out;
}
async function pre(v,c){
  for(const g of c.edl)if(g.rev&&!g._f){
    const sc=(g.clipIdx!=null&&clips[g.clipIdx])||c;
    g._f=await grab(sc.videoEl||v,g.s,g.e,10);
  }
}

async function previewCommentary(rangeStart=0,rangeEnd=null){
 if(cur<0||busy)return;const c=clips[cur];if(!c.edl?.length)return;
 let ac,source,cancelled=false;busy=true;edlPlaying=true;exportCancelled=false;syncPlayLabel();pv.pause();
 edlStopFn=()=>{cancelled=true;exportCancelled=true;try{source?.stop()}catch{};};
 try{
  if($('cs').value==='reference')await document.fonts.load('900 28px Montserrat');
  if(getPreset($('cs').value))await preparePresetFont($('cf').value);
  validateTimeline(c.edl,clips,c);validateCues(c.cues);const total=storyDuration(c).end;
  setStatus('Preparing preview audio…');showTaskProgress('Preparing preview','Mixing the preview audio…',null,()=>edlStopFn?.());ac=new AudioContext();await ac.resume();const mixed=await mixAudio(c,total,true);if(cancelled)return;hideTaskProgress();
  const end=rangeEnd===null?total:Math.min(total,rangeEnd);source=ac.createBufferSource();source.buffer=mixed;source.connect(ac.destination);const start=ac.currentTime+.05;source.start(start,rangeStart,end-rangeStart);
  setStatus('Previewing the edit. Press Play / Pause to stop.');
  while(!cancelled){const t=rangeStart+Math.max(0,ac.currentTime-start);if(t>=end)break;const seg=segAt(c,t);activeSegIdx=seg.i;updatePlayheadPosition(t);await storyFrame(px,c,t,total,!seg.g.rev,360,640);await new Promise(requestAnimationFrame)}
 }catch(error){setStatus('Preview failed: '+error.message)}
  finally{hideTaskProgress();if(ac&&ac.state!=='closed')await ac.close();clips.forEach(k=>{k.videoEl?.pause();if(k.videoEl){k.videoEl.playbackRate=1;delete k.videoEl._liveKey}delete k._ab});busy=false;edlPlaying=false;edlStopFn=null;syncPlayLabel()}
}

// Copy Script Button
$('cp').onclick=()=>{
  const t=$('sc');t.select();
  try{navigator.clipboard.writeText(t.value)}catch(e){document.execCommand('copy')}
  setStatus('Script copied! Paste into VoiceStudio to generate your MP3.');
};

// VoiceStudio MP3 File Import
$('mp3').onchange=async e=>{
  const f=e.target.files[0];if(!f||cur<0||busy)return;
  const target=clips[cur];busy=true;
  showTaskProgress('Loading narration',`Decoding ${f.name} and measuring speech pauses…`,8);
  setStatus('Reading narration audio…');
  try{
    updateTaskProgress(32,'Decoding audio samples…','Loading narration');
    await loadAud(f,target);
    updateTaskProgress(88,'Measuring narration activity and timing…','Loading narration');
    $('ai').textContent=f.name+' ('+clips[cur].aud.dur.toFixed(1)+'s)';
    list();
    setStatus('Voice loaded: '+f.name+' ('+clips[cur].aud.dur.toFixed(1)+'s). Press "Auto-Edit & Sync".');
    renderTimeline();
    // Import prepares narration only. Building always requires a button action.
  }catch(err){
    setStatus('Could not read that audio file: '+err.message);
  }finally{busy=false;hideTaskProgress()}
};

// Format & Smart Splice Lines Helper (Masterpiece Splicing)
$('fmt_lines').onclick=()=>{
  const text=$('sc').value;
  const lines=splitLines(text, 4);
  $('sc').value=lines.join('\n');
  setStatus('Masterpiece spliced: '+lines.length+' short, punchy narration lines created.');
};

// AUTO-SYNC & DYNAMIC RETIMING ENGINE: MANIPULATES VIDEO TO EXACT AUDIO DURATION WITHOUT REDUNDANCY
async function autoSyncAndEdit(){
  if(cur<0){setStepState('fail','No clip selected. Import a video clip first.');setStatus('Import a video clip first.');return}
  if(busy)return;
  const c=clips[cur];
  if(c.edl.some(g=>g.lock)){setStatus('Unlock shots before using Auto-Edit; use the story planner to retain locks.');return}
  if(!c.aud){
    setStepState('fail','No narration loaded. Import your VoiceStudio MP3 (Step 2) and try again.');
    setStatus('Import your VoiceStudio MP3 first (Step 2).');return;
  }
  let lines=splitLines($('sc').value);
  if(!lines.length){
    setStepState('fail','No script found. Write or paste the narration in Step 1, then build again.');
    setStatus('Please type or paste your narration script in Step 1 first.');
    return;
  }
  busy=true;pv.pause();
  showTaskProgress('Auto-edit & sync','Aligning narration, timing captions, and planning the edit…',0);
  setStepState('work','Aligning captions to the narration and planning the shot list…');
  setStatus('Retiming video to exact voiceover duration & planning non-repetitive cuts…');

  try{
    for(let i=0;i<clips.length;i++){await ensureClipLoaded(clips[i]);updateTaskProgress(10+(i+1)/clips.length*15,`Checking source media ${i+1} of ${clips.length}…`,'Auto-edit & sync');}

    updateTaskProgress(30,'Aligning narration to the script…','Auto-edit & sync');
    c.align=align(c,lines);
    const A=c.align;
    const B=[0];
    for(let i=0;i<A.length-1;i++)B.push((A[i].e+A[i+1].s)/2);
    B.push(c.aud.dur);
    const rawD=lines.map((_,i)=>Math.max(.35,B[i+1]-B[i]));
    const sumRawD=rawD.reduce((a,b)=>a+b,0)||1;
    const normFactor=c.aud.dur/sumRawD;
    const D=rawD.map(d=>d*normFactor);

    const vidDur=pv.duration||c.aud.dur;
    const N=lines.length;
    const variety=$('variety_engine')?$('variety_engine').value:'cinematic';
    const useMultiClip=$('multi_clip')&&$('multi_clip').checked&&clips.length>1;
    const trStyle=$('st_tr')?$('st_tr').value:'cut';
    const wantLeak=$('st_leak')&&$('st_leak').checked;

    const paceThresholds={
      speedramp: {maxHold:2.6, minHold:1.4, climaxHold:1.5},
      multicam:  {maxHold:3.8, minHold:2.2, climaxHold:1.8},
      cinematic: {maxHold:6.2, minHold:3.5, climaxHold:2.8},
      slowmo:    {maxHold:4.8, minHold:2.6, climaxHold:2.0}
    };
    const pThresh=paceThresholds[variety]||paceThresholds.cinematic;

    // PROFESSIONAL CINEMATOGRAPHIC SHOT PALETTE
    const angles=[
      {camera:'wide',z:1.02,fx:0.5,fy:0.5},
      {camera:'medium',z:1.22,fx:0.5,fy:0.46},
      {camera:'drift',z:1.08,fx:0.5,fy:0.48},
      {camera:'close_face',z:1.45,fx:0.5,fy:0.42},
      {camera:'close_left',z:1.35,fx:0.40,fy:0.45},
      {camera:'close_right',z:1.35,fx:0.60,fy:0.45}
    ];

    const edl=[];
    let currentAngle=angles[0];
    let shotElapsedTime=0;
    let currentClipIdx=cur;

    // PASS 1 - editorial plan: motivated cuts following pacing style
    const plan=[];
    for(let i=0;i<N;i++){
      const text=lines[i];
      const lineDur=D[i];
      const lower=text.toLowerCase();

      const isClimax=i>=Math.floor(N*0.65)&&i<=Math.floor(N*0.82);
      const isEmotional=/\b(insane|crazy|boom|unbelievable|look at|watch|scored|omg|legendary|lost|won|champion)\b/.test(lower);
      const directsAttention=/\b(look at|watch|right here|focus on|there it is|notice|look closely)\b/.test(lower);

      const timeSinceCut=shotElapsedTime;
      const shouldCut=i===0||timeSinceCut>=pThresh.maxHold||(timeSinceCut>=pThresh.climaxHold&&(isClimax||directsAttention));
      const prevClip=currentClipIdx;

      if(shouldCut&&i>0){
        shotElapsedTime=0;
        if(useMultiClip){
          currentClipIdx=(currentClipIdx+1)%clips.length;
        }
        if(isClimax||directsAttention){
          currentAngle=angles[3]; // close_face / intimate focus
        }else if(currentAngle.camera==='medium'||currentAngle.camera==='close_face'){
          currentAngle=angles[0]; // Cut back to wide establishing shot
        }else if(variety==='cinematic'){
          currentAngle=(i%2===1)?angles[2]:angles[1]; // Smooth Ken Burns drift or clean medium
        }else{
          currentAngle=(currentAngle===angles[0])?angles[1]:angles[0];
        }
      }
      shotElapsedTime+=lineDur;

      let sp=1.0;
      if(variety==='slowmo'&&isClimax){
        sp=0.75;
      }else if(variety==='speedramp'&&(lower.includes('fast')||lower.includes('quick'))){
        sp=1.18;
      }

      const hasHl=directsAttention;
      const rev=lineDur<2.0&&(lower.includes('rewind')||lower.includes('replay that'));

      plan.push({
        text,lineDur,lower,sp,rev,
        angle:currentAngle,
        clipIdx:currentClipIdx,
        cut:i===0||shouldCut||rev||currentClipIdx!==prevClip,
        hl:hasHl?'spot':'',
        lb:hasHl?(lower.includes('look at')?'LOOK HERE':lower.includes('focus on')?'FOCUS HERE':'WATCH THIS'):''
      });
    }

    // PASS 2 - shot list with precise timeline duration locking
    let si=0,cutCount=0,prevShift=0;
    while(si<N){
      let sj=si,srcSum=0;
      while(sj+1<N&&!plan[sj+1].cut&&!plan[sj].rev){
        srcSum+=plan[sj].lineDur*plan[sj].sp;
        if(srcSum>pThresh.maxHold*1.4)break;
        sj++;
      }
      const clipIdx=plan[si].clipIdx;
      const targetClipDur=(clips[clipIdx]&&clips[clipIdx].videoEl&&clips[clipIdx].videoEl.duration)||vidDur;

      let shotDur=0;
      for(let k=si;k<=sj;k++)shotDur+=plan[k].lineDur;

      const shift=(sj<N-1&&plan[sj].lineDur>=1.5&&(si%2===1))
        ?+(plan[sj].lineDur*0.35).toFixed(3):0;
      const tlDur=Math.max(0.6,shotDur+shift-prevShift);
      prevShift=shift;

      const avail=Math.max(0.5,targetClipDur-0.05);
      let shotSp=1.0;
      let srcNeed=tlDur;
      if(srcNeed>avail){
        shotSp=Math.max(.25,Math.min(2.5,avail/tlDur));
        srcNeed=tlDur*shotSp;
      }
      const slack=Math.max(0,targetClipDur-srcNeed);
      const arc0=si/(N-1||1),arc1=sj/(N-1||1);
      const shotStart=Math.max(0,Math.min(slack,((arc0+arc1)/2)*slack));
      const srcEnd=shotStart+srcNeed;

      const shotAngle=$('cs').value==='reference'?{camera:'wide',z:1.05,fx:.5,fy:.5}:plan[si].angle;
      const shotRev=plan.slice(si,sj+1).some(p=>p.rev);
      const shotHl=plan.slice(si,sj+1).some(p=>p.hl);
      const shotLb=(plan.slice(si,sj+1).find(p=>p.lb)||{}).lb||'';

      const isCine=trStyle==='cine';
      let tr={type:'cut',d:0};
      if(edl.length>0&&isCine){
        tr={type:(wantLeak&&edl.length%3===0)?'leak':'dissolve', d:transitionDuration(.3,tlDur)};
      }

      cutCount++;
      edl.push({
        s:+shotStart.toFixed(2),
        e:+srcEnd.toFixed(2),
        sp:+shotSp.toFixed(3),
        rev:shotRev,
        z:shotAngle.z,
        fx:shotAngle.fx,
        fy:shotAngle.fy,
        camera:shotAngle.camera,
        clipIdx,
        cut:1,
        o0:0,
        sd:+tlDur.toFixed(3),
        hl:shotHl?'spot':'',
        lb:shotLb,
        t:'',
        sfx:plan[si].rev?'scratch':(variety==='speedramp'&&edl.length%2===1?'whoosh':''),
        tr:tr,
        cap:[],
        why:'shot covering '+plan.slice(si,sj+1).length+' caption line'+(sj>si?'s':'')
      });
      si=sj+1;
    }

    // Normalization pass so sum of shot durations exactly equals c.aud.dur
    // Coverage is validated and reported; never force a mismatch into the final shot.

    // Captions are built on the narration master timeline, so they are independent of
    // these shots: a caption can span a cut, and a shot can carry several captions.
    assignStoryCues(c,edl,lines,{lines,marks:[],dur:[],total:c.aud.dur});

    validateTimeline(edl,clips,c);
    stagePlan(c,edl);
  }catch(err){
    const m=(err&&err.message)||String(err);
    setStepState('fail','The edit could not be built: '+m);
    setStatus('Auto-Edit & Sync could not finish: '+m);
  }finally{
    busy=false;hideTaskProgress();
  }
}

// How many captions continue across a video cut (cuts and captions are separate systems)
function cutsInsideCaptions(edl,cues){
  const bounds=[];let t=0;
  edl.forEach((g,i)=>{t+=(g.e-g.s)/g.sp;if(i<edl.length-1)bounds.push(t)});
  let spanning=0;
  (cues||[]).forEach(q=>{
    if(bounds.some(b=>b>q.s+0.01&&b<q.e-0.01))spanning++;
  });
  return{spanning,boundaries:bounds.length};
}
const PACE_LABEL={cinematic:'Pro Narrative (steady shots, intentional cuts)',
  multicam:'Dynamic Multi-Cam (alternating wide & medium)',
  slowmo:'Cinematic Slowmo & Climax',speedramp:'High-Energy Speed Ramp'};
// ============================================================================
// FOOTAGE ANALYSIS - what is actually happening in the clip
//
// This measures REAL signal from the decoded pixels: shot boundaries, how much
// is moving, where the motion is, how dense the detail is, whether a face is
// present, and which stretches are dead time (nothing happening).
//
// It deliberately does NOT claim to recognise objects or meaning. It reports
// observable structure - cuts, action, reactions, stillness - and the edit is
// built from that. Nothing is invented: a beat with no matching footage is
// reported as neutral rather than faked.
// ============================================================================

// ---- pure analysis over a list of samples (testable without a video file) ----
// sample: {t, g:Uint8Array(w*h), hx:Float32Array(16), edge, lum}
// ---- read real frames out of a video element ----
const FA_W=64,FA_H=112;
async function sampleFootage(clip,onProgress){
  const v=clip.videoEl;
  if(!v||!v.videoWidth||!v.duration)return null;
  const dur=Math.min(v.duration,900);
  const fps=Math.min(8,Math.max(3,Math.round(dur>120?3:(dur>40?5:8))));
  const N=Math.max(6,Math.min(1200,Math.round(dur*fps)));
  if(!clip._facv){
    const cv=document.createElement('canvas');cv.width=FA_W;cv.height=FA_H;
    clip._facv=cv;clip._fctx=cv.getContext('2d',{willReadFrequently:true});
  }
  const cv=clip._facv,cx=clip._fctx;
  const samples=[];
  const wasMuted=v.muted;
  v.pause();
  try{v.muted=true}catch(e){}
  try{for(let k=0;k<N;k++){
    if(exportCancelled)throw new Error('cancelled');
    const t=(k/(N-1))*Math.max(0,dur-0.001);
    await seekV(v,t);
    let d;
    try{cx.drawImage(v,0,0,FA_W,FA_H);d=cx.getImageData(0,0,FA_W,FA_H).data}catch(e){continue}
    const g=new Uint8Array(FA_W*FA_H),hx=new Float32Array(16);
    let edgeAcc=0,lumAcc=0;
    for(let p=0,y=0;y<FA_H;y++){
      for(let x=0;x<FA_W;x++,p++){
        const i=(y*FA_W+x)*4;
        const l=(d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114)|0;
        g[p]=l;lumAcc+=l;
        const bin=Math.min(15,l>>4);hx[bin]++;
        if(x>0&&x<FA_W-1)edgeAcc+=Math.abs(d[i+4]-d[i-4]);
        if(y>0&&y<FA_H-1)edgeAcc+=Math.abs(d[i+FA_W*4]-d[i-FA_W*4]);
      }
    }
    for(let b=0;b<16;b++)hx[b]/=(FA_W*FA_H);
    samples.push({t:+t.toFixed(3),g:g,hx:hx,
      edge:edgeAcc/(FA_W*FA_H*2),lum:lumAcc/(FA_W*FA_H)});
    if(k%12===0&&onProgress)onProgress(Math.round((k+1)/N*100));
    if(k%6===0)await new Promise(r=>setTimeout(r,0));   // keep the UI alive
  }
  }finally{v.muted=wasMuted}
return{fps:(N-1)/Math.max(.001,dur-.001),samples};
}

// ---- public entry point, cached on the clip ----
async function analyzeFootage(clip,onProgress){
  if(clip._analysis)return clip._analysis;
  await ensureClipLoaded(clip);
  const s=await sampleFootage(clip,onProgress);
  if(!s){clip._analysis={ok:false,shots:[],events:[],dead:[],profile:null};return clip._analysis}
  const res=await analyzeInWorker(s.samples,FA_W,FA_H,s.fps,()=>exportCancelled);
  res.semantic=false;   // structural analysis only - no object recognition
  clip._analysis=res;
  return res;
}

// Pick the part of a shot that actually has something happening in it,
// so the cut lands on action instead of on dead time.
function bestRangeInShot(sh,ana,want){
  const dead=(ana&&ana.dead)||[];
  const len=+(sh.e-sh.s).toFixed(3);
  if(len<=want+0.01)return{s:sh.s,e:sh.e};
  const ev=(ana&&ana.events)||[];
  // prefer a range that contains a detected key moment
  let best=null;
  for(const e of ev){
    if(e.shot!==sh.idx)continue;
    const a=Math.max(sh.s,Math.min(e.t-want/2,sh.e-want));
    const inDead=dead.some(d=>a<d.e&&a+want>d.s);
    const sc=e.strength-(inDead?3:0);
    if(!best||sc>best.sc)best={s:+a.toFixed(3),e:+(a+want).toFixed(3),sc};
  }
  if(best)return{s:best.s,e:best.e};
  // otherwise slide to dodge dead time
  let a=sh.s;
  for(let k=0;k<8;k++){
    const hit=dead.find(d=>a<d.e-0.05&&a+want>d.s+0.05);
    if(!hit)break;
    a=+(hit.e+0.02).toFixed(3);
    if(a+want>sh.e){a=sh.s;break}
  }
  if(a+want>sh.e)a=+(sh.e-want).toFixed(3);
  return{s:Math.max(sh.s,a),e:Math.min(sh.e,a+want)};
}

// ============================================================================
// FINAL DURATION - the video must never end before the narration and the
// last caption have finished.
//
// end = max(narration end, last caption fully faded out, shot list length)
//       + END_ALLOWANCE (0.5s minimum on screen after everything is done)
//
// If the footage runs out first, the last shot simply holds its final frame
// (the segment position is clamped), so there is no black frame and no
// unrelated footage is looped. The narration is never re-timed to fit.
// ============================================================================
const END_ALLOWANCE=0.5;
function storyDuration(c){
  const audioEnd=(c.aud&&c.aud.dur)||0;
  let captionEnd=0;
  for(let i=(c.cues?.length||0)-1;i>=0;i--){const q=c.cues[i];
    const cw=cueWords(q);
    const done=captionEndTime(q,cw,wordOffsetSec());
    if(done>captionEnd){captionEnd=done;break}
  }
  const foot=c.edl?.length?timelineIndex(c.edl).duration:0;
  const end=Math.max(audioEnd,captionEnd,foot)+END_ALLOWANCE;
  return{
    end:+end.toFixed(3),
    audioEnd:+audioEnd.toFixed(3),
    captionEnd:+captionEnd.toFixed(3),
    foot:+foot.toFixed(3),
    allowance:END_ALLOWANCE,
    // true when the picture runs out before the narration does and holds its last frame
    willHoldLastFrame:foot<Math.max(audioEnd,captionEnd)-0.05
  };
}

$('sy').onclick=autoSyncAndEdit;

// ============================================================================
// STEP 3 STATE - always declares whether the edit finished, which pacing style was
// applied, and - when it could not be built - exactly why.
// ============================================================================
function setStepState(state,msg){
  const b=$('st3_state'),m=$('st3_msg');
  const map={
    idle:  ['Not built yet','#888','Press “Auto-Edit & Sync” to build the edit.'],
    work:  ['Building…','var(--mu)','Planning cuts and syncing captions to the narration.'],
    done:  ['Finished','#37d67a','Edit built and ready to preview or export.'],
    warn:  ['Finished with warnings','#e8a33d','Edit built, but read the notes below.'],
    fail:  ['Could not finish','#e5534b','The edit could not be built. See the reason below.']
  };
  const sel=map[state]||map.idle;
  if(b){b.textContent=sel[0];b.style.color=sel[1];b.style.borderColor=sel[1]}
  if(m)m.textContent=msg||sel[2];
  if(cur>=0&&clips[cur])clips[cur].step3={state:state,msg:msg||sel[2],at:Date.now()};
}

// Story-edit panel wiring
$('st_vary').oninput=()=>{$('st_vary_val').textContent=$('st_vary').value};
$('st_tags').oninput=()=>{
  if(cur<0)return;
  clips[cur].tags=$('st_tags').value;
};
$('st_json').onchange=async e=>{
  const f=e.target.files[0];if(!f||cur<0)return;
  try{
    const j=JSON.parse(await f.text());
    const segs=j.segments||j.edl||j;
    if(!Array.isArray(segs)||!segs.length){setStatus('That storyboard file has no segments.');return}
    const c=clips[cur];
    const proposed=segs.map(g=>Object.assign({s:0,e:1,sp:1,rev:false,z:1.05,fx:.5,fy:.5,hl:'',lb:'',camera:'wide',clipIdx:0,cut:1,o0:0,sd:0,t:'',sfx:'',tr:{type:'cut',d:0},cap:[]},g));
    validateTimeline(proposed,clips,c);
    if(c.edl.some(g=>g.lock))throw new Error('Unlock existing shots before importing a storyboard.');
    checkpoint();c.edl=proposed;
    $('ed').value=edlToText(c.edl);
    rebuildCuesAndFx(c);
    renderTimeline();
    setStatus('Imported storyboard with '+c.edl.length+' shots.');
  }catch(err){
    setStatus('Could not read that storyboard: '+(err&&err.message||err));
  }
  e.target.value='';
};
function resetShotLocks(){
  if(cur<0)return;
  const c=clips[cur];
  c.edl.forEach(g=>g.lock=false);
  c.storyLocks=[];
  renderTimeline();
  setStatus('Shot locks cleared - the next build will rearrange freely.');
}
function toggleShotLock(i){
  if(cur<0)return;
  const g=clips[cur].edl[i];if(!g)return;
  g.lock=!g.lock;
  clips[cur].storyLocks=clips[cur].edl.filter(x=>x.lock);
  renderTimeline();
  setStatus(g.lock?('Shot '+(i+1)+' locked: regeneration will keep it.'):('Shot '+(i+1)+' unlocked.'));
}

// ============================================================================
// STORY EDIT ENGINE (Multiple Clips / Story Edit)
// The narration is the master timeline. Footage is selected and trimmed to fit it.
// Captions live on the narration clock and are never restarted by a visual cut.
// ============================================================================
const STOPW=new Set(('the a an and or but if then that this these those is are was were be been being of to in on at for with from as it its his her their our your my he she they we you i not no so very just really about into over under out up down more most some any all can will would could should there here when while after before because what which who whom whose how why do does did done get got go going went one two three now new best big great good first last next also even back much many said says say make made see saw seen look looks watching watch thing things really actually probably maybe we\'re it\'s').split(' '));

// Descriptive evidence about a clip. NOTE: this is filename/notes metadata only.
// It is a documented fallback, not visual understanding - nothing here claims to
// recognise what is actually on screen.
function clipEvidence(c){
  const raw=[c.file.name.replace(/\.[^.]+$/,''),c.tags||''].join(' ');
  const toks=(raw.toLowerCase().match(/[a-z][a-z0-9'-]{1,}/g)||[]).map(w=>w.replace(/[-']/g,''));
  const words=new Set(toks.filter(w=>w.length>2&&!STOPW.has(w)));
  return{words,toks};
}

// Runs the real footage analysis and exposes the detected shots to the selection engine.
async function analyzeClipScenes(c,onProgress){
  const res=await analyzeFootage(c,onProgress);
  c._analysis=res;
  c._scenes=(res.shots||[]).map((s,i)=>({
    id:c.id+'-shot-'+i,assetId:c.id,sourceStart:s.s,sourceEnd:s.e,duration:s.e-s.s,semantic:false,tags:c.tags||'',qualityScore:Math.max(0,Math.min(1,(s.edge/30)))*(1-Math.abs(s.lum/255-.5)),
    s:+s.s.toFixed(3),e:+s.e.toFixed(3),
    motion:+s.motion.toFixed(3),action:+s.action.toFixed(3),steady:+s.steady.toFixed(3),
    edge:+s.edge.toFixed(3),bright:s.lum,idx:i
  }));
  return c._scenes;
}

// ---- Narration -> story sections (beats), not one shot per sentence ----
function storySections(lines,A,narrationDuration){
  const n=lines.length;
  const dur=[];
  if(A&&A.length===n)for(let i=0;i<n;i++)dur.push(Math.max(.35,A[i].e-A[i].s));
  else for(let i=0;i<n;i++)dur.push(3);
  const marks=[];
  let acc=0;
  for(let i=0;i<n;i++){marks.push(acc);acc+=dur[i]}
  if(A&&A.length===n){for(let i=0;i<n;i++){marks[i]=i===0?0:(A[i-1].e+A[i].s)/2;dur[i]=(i===n-1?(narrationDuration||A[i].e):(A[i].e+A[i+1].s)/2)-marks[i]}}
  const total=narrationDuration||acc;
  const keys=lines.map(l=>[...new Set((l.toLowerCase().match(/[a-z][a-z'-]{2,}/g)||[]).map(w=>w.replace(/'/g,'')))].filter(w=>!STOPW.has(w)));
  const TURN=/^(but|then|next|after|afterwards|meanwhile|finally|however|instead|now|so|and then|right then)\b/;
  const CLOSE=/\b(finally|in the end|to sum up|overall|in conclusion|at the end|the end)\b/;
  const secs=[];let cur=null;
  for(let i=0;i<n;i++){
    const low=lines[i].toLowerCase();
    const isTurn=TURN.test(low)||CLOSE.test(low);
    const overlap=cur?keys[i].filter(k=>cur.keys.includes(k)).length:0;
    const shift=cur&&keys[i].length>0&&overlap===0;
    const long=cur&&(cur.end-cur.start)>=8;
    const tooLong=cur&&cur.count>=6;
    if(!cur||(long&&(isTurn||shift))||tooLong){
      cur={start:marks[i],end:marks[i]+dur[i],keys:[],lines:[],count:0};
      secs.push(cur);
    }
    cur.end=marks[i]+dur[i];cur.count++;
    cur.keys=cur.keys.concat(keys[i]);
    cur.lines.push(i);
  }
  secs.forEach((s,i)=>{
    const f=secs.length>1?i/(secs.length-1):0;
    s.role=(i===0)?'open':(i===secs.length-1)?'close':(f<.30?'context':(f<.74?'develop':'climax'));
  });
  return{secs,marks,dur,total,keys,linesText:lines.slice(),lines:lines.map((_,i)=>i)};
}

// ---- Candidate shots, taken from the footage the analyser actually found ----
function shotPool(pool){
  const shots=[];
  pool.forEach(o=>{
    const c=o.c,ci=o.i,ana=c._analysis;
    const dur=(c.videoEl&&c.videoEl.duration)||0;
    const sc=(c._scenes&&c._scenes.length)
      ?c._scenes
      :[{s:0,e:Math.min(dur,30),motion:0,action:0,steady:0,edge:0,bright:.5,idx:0}];
    sc.forEach(s=>{
      const len=s.e-s.s;
      if(len<0.6)return;
      // Long takes are split into usable pieces, but each piece keeps the key moments
      // and dead stretches that fall inside it.
      const parts=Math.max(1,Math.floor(len/9));
      for(let p=0;p<parts;p++){
        const a=s.s+len*(p/parts),b=s.s+len*((p+1)/parts);
        const mine=((ana&&ana.events)||[]).filter(e=>e.t>=a&&e.t<=b);
        const dead=((ana&&ana.dead)||[]).filter(d=>d.s<b&&d.e>a);
        shots.push({ci,si:s.idx!=null?s.idx:0,p,s:a,e:b,len:b-a,
          motion:s.motion||0,action:s.action||0,steady:s.steady||0,
          edge:s.edge||0,bright:s.bright==null?.5:s.bright,
          events:mine,dead,ev:clipEvidence(c),ana:ana});
      }
    });
  });
  return shots;
}

// ---- Relevance scoring, driven by what the footage actually contains ----
const PACE={relaxed:[4.5,8],balanced:[3,5],fast:[1.8,3]};

// ============================================================================
// BUILD THE STORY EDIT
// ============================================================================
async function buildStoryEdit(){
  if(cur<0){setStepState('fail','No clip selected. Import at least one video clip first.');setStatus('Import at least one video clip first.');return}
  if(busy)return;
  const c=clips[cur];
  if(!c.aud){setStepState('fail','No narration loaded. Import your VoiceStudio MP3 (Step 2) and try again.');setStatus('Import your VoiceStudio MP3 first (Step 2).');return}
  const lines=splitLines($('sc').value);
  if(!lines.length){setStepState('fail','No script found. Write or paste the narration in Step 1, then build again.');setStatus('Write the narration script in Step 1 first.');return}

  busy=true;pv.pause();
  showTaskProgress('Building story edit','Analyzing footage and matching shots to the narration…',0);
  setStepState('work','Analysing the source clips and matching them to the narration…');
  const info=$('st_info');
  const say=t=>{if(info)info.textContent=t;updateTaskProgress(null,t,'Building story edit');};
  try{
    // 1. Narration is the master timeline
    c.align=align(c,lines);
    const S=storySections(lines,c.align,c.aud.dur);
    const total=S.total;

    // 2. Source pool
    const useAll=$('st_src').value==='all';
    const pool=clips.map((k,i)=>({c:k,i})).filter(o=>useAll||o.c.use!==false);
    if(!pool.length){
      setStepState('fail','No clips are selected. Tick at least one clip in the media bin (or choose “All imported clips”) and build again.');
      setStatus('No clips selected for the story edit.');return}
    if(pool.length===1&&!useAll&&clips.length>1){
      // one ticked clip is a valid, if simple, choice
    }

    say('Reading the footage…');
    for(const o of pool) await ensureClipLoaded(o.c);
    for(const o of pool){
      if(o.c._analysis&&o.c._analysis.ok){say('Footage read: '+o.c.file.name);continue}
      if(!o.c._analysis){
        await analyzeClipScenes(o.c,p=>say('Analysing '+o.c.file.name+' — '+p+'%'));
      }else{await analyzeClipScenes(o.c)}
    }
    const analysisSummary=()=>{
      let shots=0,events=0,dead=0,failed=0;
      pool.forEach(o=>{
        const a=o.c._analysis;
        if(!a||!a.ok){failed++;return}
        shots+=a.shots.length;events+=a.events.length;dead+=a.profile.deadTime;
      });
      return{shots,events,dead:+dead.toFixed(1),failed,total:pool.length};
    };

    updateTaskProgress(72,'Scoring source shots against the narration…','Building story edit');
    // 3. Editorial settings
    const pace=$('st_pace').value;
    const [loLen,hiLen]=PACE[pace]||PACE.balanced;
    const trStyle=$('st_tr').value;
    const wantLeak=$('st_leak').checked, wantBurn=$('st_burn').checked;
    const variety=$('st_vary')?+$('st_vary').value:1;
    const varietyPenalty=1.5/(1+Math.max(0,variety-1)*0.8);

    // Keep locked shots so regeneration never destroys a manual edit.
    // The ORIGINAL shot index matters: a lock must land back on the same slot.
    const locks=[];
    (c.edl||[]).forEach((g,i)=>{if(g&&g.lock)locks.push({seg:g,i})});
    const lockedByIndex={};
    c.edl.forEach((g,i)=>{if(g&&g.lock)lockedByIndex[i]=g});

    const poolShots=shotPool(pool);
    if(!poolShots.length){
      setStepState('fail','The selected clips contain no usable footage (nothing longer than 0.6s was found). Import longer clips and build again.');
      setStatus('No usable footage found in the selected clips.');return}

    const ctx={used:[],prevClip:pool[0].i,variety:varietyPenalty,wantEstablish:true,neutralPenalty:1.1};
    const edl=[];
    let tCursor=0;
    let lastLeak=-99,lastBurn=-99,lastStylized=-99;
    let prevClip=pool[0].i;

    for(let si=0;si<S.secs.length;si++){
      const sec=S.secs[si];
      ctx.wantEstablish=(sec.role==='open');
      const secLen=sec.end-sec.start;
      const nShots=Math.max(1,Math.round(secLen/((loLen+hiLen)/2)));
      const shotLen=secLen/nShots;

      for(let k=0;k<nShots;k++){
        // Best evidence first; shots that cannot cover the slot are penalised
        let best=null,bestInfo=null;
        for(const sh of poolShots){
          if(sh.len<0.5||ctx.used.some(u=>u.ci===sh.ci&&u.si===sh.si&&u.p===sh.p))continue;
          const infoS=scoreShot(sh,sec,ctx);
          let s=infoS.score;
          const stretch=Math.min(1.35,sh.len/shotLen);     // slow-mo only if the source is short
          if(stretch<0.55)s-=1.6;
          else if(Math.abs(sh.len-shotLen)<1.2)s+=0.7;     // natural length
          if(sh.len>shotLen*2.6)s-=0.4;                    // don't use a huge block for a short beat
          if(!best||s>best.score){best={shot:sh,score:s};bestInfo=infoS}
        }
        if(!best)throw new Error('Insufficient unused footage. Import additional clips or shorten the narration.');

        const sh=best.shot;
        // Where inside that shot we take the footage: the analyser tells us which part
        // actually contains action and which part is dead time. We cut to the action.
        const ana=sh.ana||null;
        const wantSrc=Math.min(sh.len,Math.max(0.6,shotLen));
        const range=(ana&&ana.ok)?bestRangeInShot({s:sh.s,e:sh.e,idx:sh.si},ana,wantSrc):{s:sh.s,e:sh.s+wantSrc};
        const avail=+(range.e-range.s).toFixed(2);
        // Footage adapts to the narration: trim or gently slow to fill the beat
        let useLen=Math.min(avail,shotLen);
        let sp=1;
        if(avail<shotLen){
          sp=Math.max(.25,avail/shotLen);              // never more than 1.35x slow
          useLen=shotLen*sp;
        }
        const sPos=+Math.max(0,range.s).toFixed(2);
        const ePos=Math.min(clips[sh.ci].videoEl.duration,range.e,range.s+useLen);
        const onAction=((sh.events||[]).some(e=>e.t>=range.s&&e.t<=range.e));

        // Keep the transition language consistent across every edit. A short,
        // eased blend is less distracting than mixing hard cuts with random FX.
        let tr={type:'cut',d:0};
        const secChanged=(si>0&&sec!==S.secs[si-1]);
        const clipChanged=(sh.ci!==prevClip);
        if(edl.length&&trStyle==='cine'){
          tr={type:'dissolve',d:transitionDuration(.34,shotLen)};
        }
        if(edl.length&&trStyle==='manual'&&lockedByIndex[edl.length]&&lockedByIndex[edl.length].tr){
          tr=lockedByIndex[edl.length].tr;
        }
        // Light leaks / burns: rare, short, only across a clip or section change, and they
    // share ONE cooldown so two stylised transitions can never stack up.
    if(edl.length&&(trStyle==='cine'||trStyle==='manual')&&(clipChanged||secChanged)
       &&tCursor-lastStylized>12&&edl.length>=2){
      if(wantBurn&&tCursor-lastBurn>24&&edl.length%3===0){tr={type:'burn',d:0.3};lastBurn=tCursor;lastStylized=tCursor}
      else if(wantLeak&&edl.length%2===0){tr={type:'leak',d:0.3};lastLeak=tCursor;lastStylized=tCursor}
    }

        const camPick=pickStoryCamera(sec.role,sh,k===0);
        edl.push({
          s:sPos,
          e:ePos,
          sp:+sp.toFixed(3),
          rev:false,
          z:camPick.z,fx:camPick.fx,fy:camPick.fy,
          camera:camPick.camera,
          clipIdx:sh.ci,
          cut:1,
          o0:0,
          sd:+shotLen.toFixed(3),
          hl:'',lb:'',
          t:'',
          sfx:'',
          tr:tr,
          why:((bestInfo&&bestInfo.hit?('keyword match: '+(sec.keys.filter(w=>sh.ev.words.has(w)).join(', '))):'neutral contextual footage')+
             (onAction?' • action detected':(ana&&ana.ok?' • held shot, no action detected':''))),
          score:+best.score.toFixed(2),
          sec:sec.role,
          secI:si,
          lock:false,
          cap:[]
        });
        // bookkeeping
        const u=ctx.used.find(x=>x.ci===sh.ci&&x.si===sh.si&&x.p===sh.p);
        if(u)u.uses++;else ctx.used.push({ci:sh.ci,si:sh.si,p:sh.p,uses:1});
        ctx.prevClip=sh.ci;
        ctx.prevLum=sh.bright;
        ctx.prevEdge=sh.edge;
        prevClip=sh.ci;
        tCursor+=shotLen;
      }
    }

    // 4. Captions mapped onto the narration master timeline, independent of the cuts
    assignStoryCues(c,edl,lines,S);

    // Locked shots keep the editor's source choice (clip, in-point, speed, framing).
    // Their length still follows the narration so the timeline can never drift.
    locks.forEach(({seg,i})=>{if(i>=edl.length)throw new Error('The new plan cannot preserve a locked slot. Unlock it first.');edl[i]={...seg};});

    // Coverage is validated and reported; never force a mismatch into the final shot.

    validateTimeline(edl,clips,c);
    stagePlan(c,edl);
  }catch(err){
    const m=(err&&err.message)||String(err);
    setStepState('fail','The story edit could not be built: '+m);
    setStatus('Story edit failed: '+m);
  }finally{
    busy=false;hideTaskProgress();
  }
}

// Framing is deliberately plain in story mode: the footage carries the edit.
function pickStoryCamera(role,shot,first){
  if($('cs').value==='reference')return{camera:'wide',z:1.05,fx:.5,fy:.5};
  if(role==='open')return{camera:'wide',z:1.02,fx:.5,fy:.5};
  if(role==='climax')return{camera:'wide',z:1,fx:.5,fy:.5};
  if(role==='close')return{camera:'wide',z:1.05,fx:.5,fy:.5};
  return shot.motion>14?{camera:'medium',z:1.2,fx:.5,fy:.46}:{camera:'wide',z:1.03,fx:.5,fy:.5};
}

// Captions belong to the NARRATION, not to the shots. Building one master cue list
// means a sentence that spans a video cut simply continues across it - it is never
// restarted, duplicated or stretched to fit a shot.
function assignStoryCues(c,edl,lines,S){
  const A=c.align||[];
  const cues=[];
lines.forEach((txt,lineIdx)=>{
  const a=A[lineIdx];
  // Round the cue bounds first: the cue and its words must agree about the cue duration.
  const s=+((a?a.s:S.marks[lineIdx])).toFixed(2);
  const e=+((a?a.e:S.marks[lineIdx]+S.dur[lineIdx])).toFixed(2);
  const rw=a&&a.w&&a.w.length?relWords(a.w,s):null;
  // A narration line too short to round into a usable cue is dropped rather than emitted
  // as a zero-length cue that validateCues would reject.
  const cue=buildStoryCue(txt,s,e,rw);
  if(cue)cues.push(cue);
 });
  c.storyCues=cues;

  // Each shot still records which narration lines play over it (used for the
  // automatic sound-design rules and for inspecting the edit).
  let from=0;
  edl.forEach(g=>{
    const d=(g.e-g.s)/g.sp;
    const to=from+d;
    g.cap=[];
    lines.forEach((txt,i)=>{
      const a=A[i];
      const ls=a?a.s:S.marks[i], le=a?a.e:S.marks[i]+S.dur[i];
      if(le<=from+0.04||ls>=to-0.04)return;
      g.cap.push(txt);
    });
    from=to;
  });
}

// ==========================================
// EXPORT ENGINE (REBUILT: Proper audio routing, progress overlay)
// ==========================================
function showExportOverlay(text,note){
  $('export_overlay').style.display='flex';
  $('export_text').textContent=text||'Exporting...';
  $('export_note').textContent=note||'';
  $('export_progress').style.width='0%';
}
function updateExportProgress(pct,text){
  $('export_progress').style.width=pct+'%';
  if(text)$('export_text').textContent=text;
}
function hideExportOverlay(){
  $('export_overlay').style.display='none';
}
function cancelExport(){
  exportCancelled=true;
}

const seekV=(v,t)=>seekFrame(v,t,()=>exportCancelled&&busy);
const decF=async f=>new OfflineAudioContext(2,1,48000).decodeAudioData(await f.arrayBuffer());
function segAt(c,vt){return shotAt(c.edl,vt)}

// Framing for one segment, shared by every renderer so preview and export stay identical.
// A segment with cut === 0 continues the previous shot: it keeps the previous framing and its
// motion is timed from the start of the shot, so nothing visibly resets between two captions.
function segFraming(list,i,el,dur,vSrc,sw){
  const seg=list[i];
  const prev=(i>0&&seg.cut===0)?list[i-1]:null;
  const cam=((prev&&prev.camera)||seg.camera||'wide');
  const sd=(seg.sd>0?seg.sd:dur)||dur;
  const mt=(seg.cut===0?((+seg.o0||0)+el):el);   // time since the shot started
  let fz=seg.z||1.0;
  let curFx=seg.fx!=null?seg.fx:.5;
  let curFy=seg.fy!=null?seg.fy:.45;
  if(cam==='drift'){
    const referenceDrift=$('cs').value==='reference'&&$('reference_motion')?.checked&&!seg.lock&&!seg.manualFraming;
    fz=(seg.z||1.15)+(referenceDrift?0:0.35*Math.min(1,mt/sd));
  }else if(cam==='pan'){
    curFx=0.3+0.4*Math.min(1,mt/sd);
    fz=seg.z||1.3;
  }else if(cam==='medium'){
    curFx=.5;curFy=.46;fz=seg.z||1.22;
  }else if(cam==='close_face'){
    curFx=(vSrc&&vSrc._ft!=null&&sw)?vSrc._ft/sw:.5;
    curFy=.38;fz=seg.z||1.95;
  }else if(cam==='close_left'){
    curFx=.32;curFy=.42;fz=seg.z||1.85;
  }else if(cam==='close_right'){
    curFx=.68;curFy=.42;fz=seg.z||1.85;
  }else if(cam==='wide'){
    curFx=.5;curFy=.5;fz=1.05;
  }else{
    const k=Math.min(1,mt/.28);
    fz=seg.z>1?1+(seg.z-1)*(1-Math.pow(1-k,3)):1;
  }
  const framing={fz,fx:curFx,fy:curFy};
  const referenceFraming=$('cs').value==='reference'&&$('reference_motion')?.checked&&!seg.lock&&!seg.manualFraming&&(cam==='wide'||cam==='drift')?referenceMotion(framing,mt,sd):framing;
  return referenceFraming;
}
// A cut flash marks a real cut only. Caption changes inside a shot must not flash.
function segCutFlash(seg,el){return(getPreset($('cs').value)||$('cs').value==='reference'||seg.cut===0)?0:(el<0.08?(1-el/0.08)*0.25:0)}

// ============================================================================
// STORY RENDERER - one function for BOTH preview and export.
// Because preview and export call this exact function, a transition can never
// appear in the preview and vanish from the exported file.
// live=true  -> preview: the incoming clip is already playing, only draw it.
// live=false -> export: seek every shot to the exact source frame.
// ============================================================================
function syncLiveVideo(v,target,rate,key){
  if(!v||!v.videoWidth)return;
  const t=Math.max(0,Math.min(Number.isFinite(v.duration)?v.duration:target,target));
  v.playbackRate=rate||1;
  if(v._liveKey!==key){
    v.pause();
    try{v.currentTime=t}catch(e){}
    v._liveKey=key;
    const playing=v.play();
    if(playing&&playing.catch)playing.catch(()=>{});
  }else if(Math.abs((v.currentTime||0)-t)>.16){
    // Keep the media clock close to the narration clock without seeking every RAF.
    try{v.currentTime=t}catch(e){}
  }
}

async function storyFrame(ctx,c,vt,total,live,w,h){
  const{g,a,d,i:gi}=segAt(c,vt);
  const el=Math.max(0,Math.min(d,vt-a));
  const clip=(g.clipIdx!=null&&clips[g.clipIdx])||c;
  const vs=clip.videoEl||pv,sw=vs.videoWidth||1;

  // A transition belongs to the shot it opens, and never extends past it
  const config=getPreset($('cs').value);
  const hardCut=config?.motion.hardCuts&&!protectedShot(g)&&!protectedShot(c.edl[gi-1]);
  const tr=(!hardCut&&g.tr&&g.tr.d>0&&gi>0&&el<g.tr.d)
    ?(()=>{const progress=Math.max(0,Math.min(1,el/g.tr.d));return{type:g.tr.type||'dissolve',d:g.tr.d,k:progress,blend:easeInOutCubic(progress)}})():null;

  if(tr){
    const pg=c.edl[gi-1];
    const pDur=(pg.e-pg.s)/pg.sp;
    const pclip=(pg.clipIdx!=null&&clips[pg.clipIdx])||c;
    const pvs=pclip.videoEl||pv,psw=pvs.videoWidth||1;

      const FR=segFraming(c.edl,gi,el,d,vs,sw);
    if(live&&!config){
      // Preview follows the audio clock. Seeking every RAF was the source of the
      // visible hitching; media playback now supplies the frames while we only
      // correct drift when it becomes perceptible.
      const outEl=Math.max(0,pDur-tr.d+el);
      const sameSource=pvs===vs;
      if(sameSource){
        // One HTMLVideoElement cannot show two source times at once. Preserve the
        // outgoing frame at the cut and let the incoming side remain live.
        if(c._trSnapGi!==gi){
          if(!c._trSnapCanvas)c._trSnapCanvas=document.createElement('canvas');
          c._trSnapCanvas.width=w;c._trSnapCanvas.height=h;
          c._trSnapCanvas.getContext('2d').drawImage(ctx.canvas,0,0,w,h);
          c._trSnapGi=gi;
        }
        syncLiveVideo(vs,transitionSourceTime(g,el),g.sp,`shot-${gi}`);
        ctx.clearRect(0,0,w,h);ctx.drawImage(c._trSnapCanvas,0,0,w,h);
      }else{
        syncLiveVideo(pvs,transitionSourceTime(pg,outEl),pg.sp,`out-${gi}`);
        syncLiveVideo(vs,transitionSourceTime(g,el),g.sp,`shot-${gi}`);
        const pFR=segFraming(c.edl,gi-1,outEl,pDur,pvs,psw);
        draw(ctx,pvs,c.cues,Object.assign(opts(w,h,c),{vt,vd:total,layers:'frame',
          fz:pFR.fz,fy:pFR.fy,cx:pFR.fx*psw,hl:pg.hl,lb:pg.lb,sp:pg.sp,hx:pFR.fx,hy:pFR.fy,
          el:outEl,segDur:pDur,cutFlash:0}));
      }

      draw(ctx,vs,c.cues,Object.assign(opts(w,h,c),{vt,vd:total,layers:'frame',noClear:true,alpha:tr.blend,
        fz:FR.fz,fy:FR.fy,cx:FR.fx*sw,hl:g.hl,lb:g.lb,sp:g.sp,hx:FR.fx,hy:FR.fy,
        el,segDur:d,cutFlash:0}));

      if(tr.type!=='dissolve'){
        draw(ctx,vs,c.cues,Object.assign(opts(w,h,c),{vt,vd:total,layers:'fx',noClear:true,
          fz:FR.fz,fy:FR.fy,cx:FR.fx*sw,hx:FR.fx,hy:FR.fy,el,segDur:d,trType:tr.type,trK:tr.k}));
      }

      draw(ctx,vs,c.cues,Object.assign(opts(w,h,c),{vt,vd:total,layers:'over',noClear:true,
        fz:FR.fz,fy:FR.fy,cx:FR.fx*sw,hl:g.hl,lb:g.lb,sp:g.sp,hx:FR.fx,hy:FR.fy,el,segDur:d}));
      return;
    }else{
      // OFFLINE EXPORT / SCRUBBING: Frame-accurate seek on both shots. The
      // outgoing plate is sampled across its final transition window instead of
      // freezing on the last frame, which removes the stiff “stutter” at the cut.
      pvs.pause();
      const outEl=Math.max(0,pDur-tr.d+el);
      await seekV(pvs,transitionSourceTime(pg,outEl));
      const pFR=segFraming(c.edl,gi-1,outEl,pDur,pvs,psw);
      draw(ctx,pvs,c.cues,Object.assign(opts(w,h,c),{vt,vd:total,layers:'frame',
        fz:pFR.fz,fy:pFR.fy,cx:pFR.fx*psw,hl:pg.hl,lb:pg.lb,sp:pg.sp,hx:pFR.fx,hy:pFR.fy,
         el:outEl,segDur:pDur,cutFlash:0}));

      let src=vs;
      if(g.rev){
        if(g._f&&g._f.length)src=g._f[Math.min(g._f.length-1,Math.floor((1-Math.min(1,el/d))*g._f.length))];
        else {vs.pause();if(!live)await seekV(vs,Math.max(g.s,g.e-el*g.sp-1/30))}
      }else{
        await seekV(vs,g.s+Math.max(0,Math.min(el*g.sp,g.e-g.s)));
      }
      const FR=segFraming(c.edl,gi,el,d,vs,sw);
      draw(ctx,src,c.cues,Object.assign(opts(w,h,c),{vt,vd:total,layers:'frame',noClear:true,alpha:tr.blend,
        fz:FR.fz,fy:FR.fy,cx:FR.fx*sw,hl:g.hl,lb:g.lb,sp:g.sp,hx:FR.fx,hy:FR.fy,
        el,segDur:d,cutFlash:0}));

      if(tr.type!=='dissolve'){
        draw(ctx,src,c.cues,Object.assign(opts(w,h,c),{vt,vd:total,layers:'fx',noClear:true,
          fz:FR.fz,fy:FR.fy,cx:FR.fx*sw,hx:FR.fx,hy:FR.fy,el,segDur:d,trType:tr.type,trK:tr.k}));
      }

      draw(ctx,src,c.cues,Object.assign(opts(w,h,c),{vt,vd:total,layers:'over',noClear:true,
        fz:FR.fz,fy:FR.fy,cx:FR.fx*sw,hl:g.hl,lb:g.lb,sp:g.sp,hx:FR.fx,hy:FR.fy,el,segDur:d}));
      return;
    }
  }

  c._trSnapGi=-1;
  let src=vs;
  if(live)syncLiveVideo(vs,transitionSourceTime(g,el),g.sp,`shot-${gi}`);
  if(g.rev){
    if(!config&&g._f&&g._f.length)src=g._f[Math.min(g._f.length-1,Math.floor((1-Math.min(1,el/d))*g._f.length))];
    else {vs.pause();if(!live)await seekV(vs,Math.max(g.s,g.e-el*g.sp-1/30))}
  }else if(!live){
    await seekV(vs,g.s+Math.max(0,Math.min(el*g.sp,g.e-g.s)));
  }
  const FR=segFraming(c.edl,gi,el,d,vs,sw);
  draw(ctx,src,c.cues,Object.assign(opts(w,h,c),{vt,vd:total,
    fz:FR.fz,fy:FR.fy,cx:FR.fx*sw,hl:g.hl,lb:g.lb,sp:g.sp,hx:FR.fx,hy:FR.fy,
    el,segDur:d,cutFlash:segCutFlash(g,el)}));
}
let lastExportURL=null;
function releaseExportURL(){
  if(!lastExportURL)return;
  try{URL.revokeObjectURL(lastExportURL)}catch(e){}
  lastExportURL=null;
}
function closeShareDialog(){
  const d=$('share_dlg');
  if(d)d.style.display='none';
  const v=$('share_v');if(v){v.pause();v.removeAttribute('src');v.load()}
  const dl=$('share_dl');if(dl)dl.removeAttribute('href');
  releaseExportURL();
}
async function mixAudio(c,total,story,cancelled=()=>exportCancelled){
 return mixTimelineAudio({clips,owner:c,total,story,sourceGain:story&&c.aud?Number($('og').value)/100:1,allowPitch:$('allow_pitch').checked,sounds:$('sfx').checked,soundGain:Number($('sv').value)/100,playSound:sfx,decode:decF,cancelled,
 onPeak:peak=>{if($('audio_meter'))$('audio_meter').textContent='Mix peak: '+(peak>0?(20*Math.log10(peak)).toFixed(1)+' dBFS':'silent')+(peak>=1?' — clipping detected':'')}});
}
async function composeAt(c,ctx,vt,total,story){
const v=c.videoEl;
if(story){await storyFrame(ctx,c,vt,total,false,W,H)}
else{await seekV(v,vt);await track(v);draw(ctx,v,c.cues,opts(W,H,c))}}
async function render(i,batch,fileHandle){
const c=clips[i];if(busy&&!batch)return;let ae,ve,fileStream;busy=true;exportCancelled=false;c.status='Exporting…';list();cx=null;
const story=isStoryMode()&&c.edl&&c.edl.length;
try{
if($('cs').value==='reference')await document.fonts.load('900 28px Montserrat');
if(getPreset($('cs').value))await preparePresetFont($('cf').value);
if(story&&!c.aud){
  showExportOverlay('Import the VoiceStudio MP3 first','Story mode exports need a VoiceStudio MP3 for the voice track. Add it in Step 2, then export again.');
  await new Promise(r=>setTimeout(r,1500));
  hideExportOverlay();
  busy=false;c.status='Needs voice audio';list();
  setStatus('Import the VoiceStudio MP3 first (Step 2) before exporting story mode.');
  return;
}
if(!window.VideoEncoder||!window.AudioEncoder||!Mp4Muxer)throw new Error('This browser cannot export MP4. Use a current Chrome, Edge, Firefox or Safari.');
pv.pause();clips.forEach(k=>{k.videoEl.pause();k.videoEl.muted=true});
// Same rule as the exporter: narration, last caption and the tail allowance.
await ensureClipLoaded(c);
if(story)validateTimeline(c.edl,clips,c);validateCues(c.cues);
if(story&&c.aud&&c.cues.length&&$('caption_engine')?.value==='speech'&&!hasSpeechTimings(c))throw new Error('Captions still use estimated timing. Select Sync captions to speech, or explicitly choose estimated/manual timing.');
if(c.captionTimingStale)throw new Error('Narration changed. Synchronize caption timing to the new audio before exporting.');
const preset=$('export_resolution').value.split('x').map(Number);[W,H]=preset;
const total=story?storyDuration(c).end:c.videoEl.duration,FPS=30;
if(!Number.isFinite(total)||total<=0||total>300)throw new Error('Export duration must be between zero and five minutes.');
const config=await exportConfig(W,H,+$('export_quality').value);
showExportOverlay('Preparing export…','Rendering every frame and mixing the audio, then your MP4 is ready to share. Keep this tab open.');
if(fileHandle){updateExportProgress(1,'Opening destination file…');fileStream=await fileHandle.createWritable();$('export_text').textContent='Writing MP4 to selected file…';$('export_note').textContent='Rendering and writing directly to your chosen destination. Keep this tab open.'}
const target=fileStream?new Mp4Muxer.FileSystemWritableFileStreamTarget(fileStream):new Mp4Muxer.ArrayBufferTarget();
const mux=new Mp4Muxer.Muxer({target,video:{codec:'avc',width:W,height:H},audio:{codec:'aac',numberOfChannels:2,sampleRate:48000},fastStart:fileStream?false:'in-memory'});let err=null;const fail=e=>{err=e};
updateExportProgress(2,'Mixing audio…');const out=await mixAudio(c,total,story);if(exportCancelled)throw new Error('cancelled');
ae=new AudioEncoder({output:(k,m)=>{try{mux.addAudioChunk(k,m)}catch(error){fail(error)}},error:fail});ae.configure(config.audio);
const L=out.getChannelData(0),Rr=out.getChannelData(1),N=out.length,CH=4800;
for(let s=0;s<N;s+=CH){const n=Math.min(CH,N-s),d=new Float32Array(n*2);d.set(L.subarray(s,s+n),0);d.set(Rr.subarray(s,s+n),n);if(exportCancelled)throw new Error('cancelled');const ad=new AudioData({format:'f32-planar',sampleRate:48000,numberOfFrames:n,numberOfChannels:2,timestamp:Math.round(s/48000*1e6),data:d});try{ae.encode(ad)}finally{ad.close()}if(s%(CH*8)===0)updateExportProgress(3+Math.min(2,s/N*2),'Encoding audio…');while(ae.encodeQueueSize>12){if(err)throw err;if(exportCancelled)throw new Error('cancelled');await new Promise(r=>setTimeout(r,4))}}await ae.flush();
ve=new VideoEncoder({output:(k,m)=>{try{mux.addVideoChunk(k,m)}catch(error){fail(error)}},error:fail});ve.configure(config.video);
const cv=document.createElement('canvas');cv.width=W;cv.height=H;const ctx=cv.getContext('2d'),nF=Math.ceil(total*FPS);
for(let f=0;f<nF;f++){if(exportCancelled)throw new Error('cancelled');if(err)throw err;const t=f/FPS;await composeAt(c,ctx,t,total,story);
const fr=new VideoFrame(cv,{timestamp:Math.round(t*1e6),duration:Math.round(1e6/FPS)});try{ve.encode(fr,{keyFrame:f%60===0})}finally{fr.close()}while(ve.encodeQueueSize>12){if(err)throw err;if(exportCancelled)throw new Error('cancelled');await new Promise(r=>setTimeout(r,4))}
if(f%4===0){const pct=Math.min(99,5+Math.round(f/nF*94));updateExportProgress(pct,'Rendering '+pct+'%  ('+t.toFixed(1)+'s of '+total.toFixed(1)+'s)');await new Promise(r=>setTimeout(r))}}
await ve.flush();if(err)throw err;if(exportCancelled)throw new Error('cancelled');mux.finalize();
let blob;if(fileStream){await fileStream.close();fileStream=null;blob=await fileHandle.getFile()}else blob=new Blob([mux.target.buffer],{type:'video/mp4'});
const name=c.file.name.replace(/\.[^.]+$/,'')+'_Commentary_9x16.mp4';
updateExportProgress(99,'Checking MP4 playback…');
const verification=await verifyExport(blob,total);if(exportCancelled)throw new Error('cancelled');
releaseExportURL();
const u=URL.createObjectURL(blob);lastExportURL=u;
hideExportOverlay();c.status='Exported (mp4)';
if(batch){const a=document.createElement('a');a.href=u;a.download=name;a.click()}
else{const f=new File([blob],name,{type:'video/mp4'});$('share_v').src=u;$('share_dl').href=u;$('share_dl').download=name;$('share_dlg').style.display='flex';$('share_btn').style.display=navigator.canShare&&navigator.canShare({files:[f]})?'':'none';$('share_btn').onclick=()=>navigator.share({files:[f],title:'My edit'}).catch(()=>{})}
setStatus('Export finished: '+name+'. '+verification+(clips.some(k=>k.audioWarning)?' Some original source audio was unavailable.':'')+(story&&c.edl.some(g=>g.sp!==1)&&!allow_pitch.checked?' Source audio on speed-adjusted shots was muted to avoid pitch changes.':''))}
catch(e){hideExportOverlay();const m=(e&&e.message)||String(e);c.status=m==='cancelled'?'Export cancelled':'Export failed';setStatus(m==='cancelled'?'Export cancelled.':'Export failed: '+m)}
finally{if(fileStream)await fileStream.abort().catch(()=>{});for(const encoder of [ae,ve])if(encoder&&encoder.state!=='closed')encoder.close();clips.forEach(k=>{delete k._ab;(k.edl||[]).forEach(g=>delete g._f)});busy=false;list();cx=null}}

$('exp').onclick=async()=>{
  if(cur>=0&&!busy){pv.pause();await render(cur)}
};
$('all').onclick=async()=>{
  if(busy)return;pv.pause();
  for(let i=0;i<clips.length;i++){await render(i,true);if(exportCancelled)break}
  pv.play().catch(()=>{});
};
$('wo').addEventListener('input',()=>{$('wo_val').textContent=$('wo').value+' ms'});
setInterval(async()=>{if(!det||busy)return;for(const v of [pv,...clips.map(k=>k.videoEl)]){if(!v||v.paused||!v.videoWidth)continue;try{const f=await det.detect(v);if(f.length){const b=f.sort((p,q)=>q.boundingBox.width-p.boundingBox.width)[0].boundingBox;v._fb={cx:b.x+b.width/2,cy:b.y+b.height/2,w:b.width};v._fbt=performance.now()}else v._fb=null}catch(e){}}},220);

Object.assign(window,{$,setStatus,list,add,ensureClipLoaded,select,showCues,debouncedRenderTimeline,ts,adoptAlignWords,isStoryMode,formatTime,syncPlayLabel,wrap,rr,zf,wordOffsetSec,normTok,estWordSpans,cueWords,clearWordCache,wpInfo,wp,relWords,serWords,parseWords,splitLines,caps,grainPattern,fx2,hl2,ov,draw,trFx,track,opts,nz,sfx,loadAud,align,applyWordTimings,retimeWords,toMono16k,whisperAlignWords,validSfx,validCam,parseTr,edlToText,textToEdl,updateDurBanner,rebuildCuesAndFx,reportWordTimingSource,renderTimeline,updatePlayheadPosition,handleScrubStart,handleScrubMove,handleScrubEnd,seekToTimelineTime,previewSelectedMoment,openSelectedMomentEditor,closeMomentEditor,saveModalMoment,setModalSpeed,nudgeModalTiming,cancelFocusPick,pickFocusFromCanvas,testModalSfx,previewModalMoment,seek,grab,pre,previewCommentary,autoSyncAndEdit,cutsInsideCaptions,analyzeSamples,sampleFootage,analyzeFootage,bestRangeInShot,storyDuration,setStepState,resetShotLocks,toggleShotLock,clipEvidence,analyzeClipScenes,storySections,shotPool,scoreShot,buildStoryEdit,pickStoryCamera,assignStoryCues,showTaskProgress,updateTaskProgress,hideTaskProgress,showExportOverlay,updateExportProgress,hideExportOverlay,cancelExport,segAt,segFraming,segCutFlash,storyFrame,releaseExportURL,closeShareDialog,mixAudio,composeAt,render});
// This integration shares the original clips/EDL model; no second playback state.
const projectHistory = new History();
let pendingPlan = null, buildBase = null, saveTimer = null, lastSaved = '';
const cleanData = value => JSON.parse(JSON.stringify(value, (key,item) => key.startsWith('_') ? undefined : item));
function projectSnapshot() {
  return {
    version:1, script:$('sc').value, selectedId:clips[cur]?.id, captionPreset:$('cs').value,presetState:presetUI?.controller.snapshot(),
    settings:Object.fromEntries([...document.querySelectorAll('input[id],select[id]')].filter(el=>el.type!=='file'&&!el.id.startsWith('m_')).map(el=>[el.id,el.type==='checkbox'?el.checked:el.value])),
    clips:clips.map(c=>({id:c.id,name:c.file.name,size:c.file.size,type:c.file.type,metadata:c.metadata||{duration:c.videoEl?.duration},tags:c.tags||'',use:c.use!==false,cues:cleanData(c.cues),fx:cleanData(c.fx),edl:cleanData(c.edl),align:cleanData(c.align||null),wordAlignment:cleanData(c.wordAlignment||null),captionTimingStale:!!c.captionTimingStale,storyCues:cleanData(c.storyCues||null),cuesEdited:!!c.cuesEdited,fxEdited:!!c.fxEdited,narration:c.aud?{name:c.aud.name,dur:c.aud.dur}:c.narration||null}))
  };
}
function restoreProject(data) {
  data=migratePresetData(data);
  presetUI?.controller.restore(data.presetState);
  if(edlStopFn){edlStopFn();edlStopFn=null}pv.pause();pendingPlan=null;
  const previous = new Map(clips.map(c=>[c.id,c]));
  clips=data.clips.map(saved=>{
    const existing=previous.get(saved.id);
    const matches=existing&&!existing.missing&&existing.file?.name===saved.name&&existing.file?.size===saved.size;
    if(existing&&!matches)releaseClip(existing);
    return {...(matches?existing:{}),...structuredClone(saved),file:matches?existing.file:{name:saved.name,size:saved.size,type:saved.type},videoEl:matches?existing.videoEl:null,url:matches?existing.url:null,aud:existing?.aud?.name===saved.narration?.name?existing.aud:null,missing:!matches,status:matches?'Ready':'Relink video required',_analysis:matches?existing._analysis:null};
  });
  for(const [id,c] of previous)if(!clips.some(k=>k.id===id))releaseClip(c);
  for(const [id,value] of Object.entries(data.settings||{})){
    const el=$(id);if(!el||el.type==='file'||el.id.startsWith('m_'))continue;
    if(el.type==='checkbox')el.checked=!!value;else el.value=String(value);
  }
  presetUI?.refresh();
  $('sc').value=data.script;cur=clips.findIndex(c=>c.id===data.selectedId);if(cur<0&&clips.length)cur=0;
  $('tm').dispatchEvent(new Event('change'));activeSegIdx=0;
  if(cur>=0){$('ed').value=edlToText(clips[cur].edl);showCues();renderTimeline();updateDurBanner(clips[cur]);if(clips[cur].url)pv.src=clips[cur].url;else pv.removeAttribute('src')}
  else{$('ed').value='';$('ct').value='';$('ft').value='';pv.removeAttribute('src');px.clearRect(0,0,pc.width,pc.height)}
  list();syncPlayLabel();
}
function releaseClip(c){releaseMedia(c)}
function checkpoint(){if(!busy)projectHistory.push(projectSnapshot())}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{if(busy)return scheduleSave();try{const snapshot=projectSnapshot();const key=JSON.stringify(snapshot);if(key!==lastSaved){await storeProject(snapshot);lastSaved=key}}catch(error){setStatus('Autosave unavailable: '+error.message+'. Export project JSON to keep your edits.')}},1000)}
document.addEventListener('input',scheduleSave);
document.addEventListener('change',scheduleSave);
// Record the pre-edit state once per interaction, including existing inline actions.
document.addEventListener('pointerdown',event=>{if(event.target.closest('#project_undo,#project_redo,#project_load,#project_reset,#project_import,#project_toolbar,#plan_dialog'))return;checkpoint()},true);
document.addEventListener('focusin',event=>{if(event.target.matches('textarea,input:not([type=file]),select'))checkpoint()},true);
$('project_undo').onclick=()=>{if(busy)return;const state=projectHistory.undo(projectSnapshot());if(state){restoreProject(state);scheduleSave();setStatus('Undid the last edit.')}};
$('project_redo').onclick=()=>{if(busy)return;const state=projectHistory.redo(projectSnapshot());if(state){restoreProject(state);scheduleSave();setStatus('Redid the edit.')}};
$('project_save').onclick=async()=>{try{if(busy)return;showTaskProgress('Saving project','Writing project settings to this browser…',20);await storeProject(projectSnapshot());updateTaskProgress(100,'Project saved.','Saving project');setStatus('Project saved in this browser. Media bytes are not stored; keep your original files for relinking.')}catch(error){setStatus('Save failed: '+error.message)}finally{hideTaskProgress()}};
async function importProjectData(data){
  const {readProject}=await import('./core/project.js');data=readProject(data);
  if(busy)return;if(clips.length&&!await (window.studioConfirm?.('Replace the current project with this saved project?')??Promise.resolve(false)))return;
  newHistoryReset(projectHistory);restoreProject(data);scheduleSave();
  setStatus('Project loaded. Relink missing videos and reimport narration if needed.'+(data.presetWarning?' '+data.presetWarning:''));
}
function newHistoryReset(history){history.past=[];history.future=[];return history}
$('project_load').onclick=async()=>{try{showTaskProgress('Loading project','Reading the saved project from this browser…',20);const data=await loadProject();if(!data){setStatus('No saved project in this browser.');return}updateTaskProgress(70,'Restoring clips, captions, and settings…','Loading project');await importProjectData(data)}catch(error){setStatus('Load failed: '+error.message)}finally{hideTaskProgress()}};
$('project_export').onclick=()=>{
  const blob=new Blob([JSON.stringify(projectSnapshot(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='SkimStudio-project.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
};
$('project_import').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>10*1024*1024)throw new Error('Project JSON exceeds 10 MB.');await importProjectData(JSON.parse(await file.text()))}catch(error){setStatus('Import failed: '+error.message)}finally{event.target.value=''}};
$('project_reset').onclick=async()=>{if(busy||!await (window.studioConfirm?.('Reset the current project? Export project JSON first if you need a copy.')??Promise.resolve(false)))return;projectHistory.past=[];projectHistory.future=[];restoreProject({clips:[],script:'',settings:{}});scheduleSave();setStatus('Project reset.');};
const originalList=list;
list=function(){originalList();[...$('list').children].forEach((row,index)=>{
  const clip=clips[index];if(!clip.missing)return;
  const label=document.createElement('label');label.className='pill-btn';label.textContent='Relink video';
  const input=document.createElement('input');input.type='file';input.accept='video/*';input.hidden=true;label.append(input);label.onclick=e=>e.stopPropagation();
  input.onchange=async()=>{if(busy)return;const file=input.files[0];if(!file)return;busy=true;const video=document.createElement('video');video.muted=true;video.playsInline=true;video.src=URL.createObjectURL(file);
    try{await waitMedia(video);if(file.size!==clip.size||file.name!==clip.name||Math.abs(video.duration-clip.metadata.duration)>.1)throw new Error('Choose the original video with matching name, size, and duration.');releaseClip(clip);Object.assign(clip,{file,url:video.src,videoEl:video,missing:false,status:'Relinked'});list();setStatus('Relinked '+file.name)}catch(error){URL.revokeObjectURL(video.src);video.removeAttribute('src');video.load();setStatus(error.message)}finally{busy=false}};row.append(label);
})};
const oldSelect=select;select=function(index){if(busy)return;if(clips[index]?.missing){cur=index;list();showCues();renderTimeline();setStatus('Relink this video before playback or export.');return}oldSelect(index)};
const oldDuration=storyDuration;storyDuration=function(c){const result=oldDuration(c);const allowance=Math.max(0,Math.min(3,Number($('end_tail').value)||0));result.end=+(result.end-result.allowance+allowance).toFixed(3);result.allowance=allowance;return result};
$('capabilities').onclick=async()=>{
 const report=['Video decode: '+(document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"')||'unavailable'),'IndexedDB: '+!!window.indexedDB,'Worker: '+!!window.Worker,'Web Audio: '+!!window.AudioContext,'WebCodecs: '+!!window.VideoEncoder,'Reported device memory: '+(navigator.deviceMemory?navigator.deviceMemory+' GB':'unavailable'),'Processing stays on this device; fonts and optional Whisper need network access.'];
 try{await exportConfig(W,H,8e6);report.push('H.264 + AAC export: supported at '+W+' × '+H)}catch(error){report.push(error.message)}await (window.studioAlert?.(report.join('\n'))??Promise.resolve());
};
$('analyze_media').onclick=async()=>{if(busy||!clips.length)return;busy=true;exportCancelled=false;showTaskProgress('Analyzing video',`Reading ${clips.length} clip${clips.length===1?'':'s'} for real cuts and motion…`,0,()=>{exportCancelled=true});try{for(let i=0;i<clips.length;i++){const clip=clips[i];await ensureClipLoaded(clip);await analyzeClipScenes(clip,p=>{const pct=(i+p/100)/clips.length*100;updateTaskProgress(pct,`Analyzing ${clip.file.name}: ${p}%`,'Analyzing video');setStatus('Analyzing '+clip.file.name+': '+p+'%')})}updateTaskProgress(100,'Image analysis finished.','Analyzing video');setStatus('Image analysis finished. '+clips.reduce((n,c)=>n+(c._scenes?.length||0),0)+' candidate shots. Scene labels and narrative relevance require your review.')}catch(error){setStatus('Analysis failed: '+error.message)}finally{busy=false;hideTaskProgress()}};
function stagePlan(c,edl){assertLocksUnchanged(c.edl,edl);pendingPlan={assetId:c.id,edl:cleanData(edl),align:cleanData(c.align||null),storyCues:cleanData(c.storyCues||null)};}
function renderPlan(){
 if(!pendingPlan){setStatus('Generate a story plan first.');return}
 const owner=clips.find(c=>c.id===pendingPlan.assetId);
 // The owning clip can disappear between staging and reviewing. Report it instead of
 // throwing on a missing owner, which would leave the dialog open-but-empty with no message.
 if(!owner){pendingPlan=null;setStatus('The clip this plan belongs to is no longer available. Generate the plan again.');return}
 const rows=$('plan_rows');rows.replaceChildren();let at=0;
 for(const segment of pendingPlan.edl){
  const duration=(segment.e-segment.s)/segment.sp;const tr=document.createElement('tr');
  const text=document.createElement('td');const narration=(pendingPlan.storyCues||[]).filter(q=>q.s<at+duration&&q.e>at).map(q=>q.t).join(' ');text.textContent=narration||segment.t||'No narration in this interval';
  const role=document.createElement('input');role.type='text';role.value=segment.sec||'context';role.setAttribute('aria-label','Narrative role');role.onchange=()=>segment.sec=role.value;text.append(document.createElement('br'),role);
  const source=document.createElement('td');const select=document.createElement('select');select.setAttribute('aria-label','Source video');clips.forEach(c=>{const option=document.createElement('option');option.value=c.id;option.textContent=c.file.name;select.append(option)});select.value=segment.assetId;
  const start=document.createElement('input'),end=document.createElement('input');for(const el of [start,end]){el.type='number';el.step='0.001';el.min='0';el.style.width='80px'}start.value=segment.s;end.value=segment.e;start.setAttribute('aria-label','Source in');end.setAttribute('aria-label','Source out');
  select.disabled=start.disabled=end.disabled=!!segment.lock;
  select.onchange=()=>{segment.assetId=select.value;segment.clipIdx=clips.findIndex(c=>c.id===select.value);segment.why='Manually selected by editor'};
  start.onchange=()=>{segment.s=Number(start.value)};end.onchange=()=>{segment.e=Number(end.value)};
  source.append(select,document.createElement('br'),start,end);
  const timing=document.createElement('td');timing.textContent=at.toFixed(2)+'–'+(at+duration).toFixed(2)+'s';
  const why=document.createElement('td');why.textContent=(segment.lock?'Locked. ':segment.why||'Pacing suggestion.')+' '+(segment.why?.includes('keyword')?'Filename or manual note match; visual meaning unverified.':'No semantic match verified — select footage manually.');
  tr.append(text,source,timing,why);rows.append(tr);at+=duration;
 }
 const difference=at-(owner.aud?.dur||0);$('plan_note').textContent=`${pendingPlan.edl.length} shots; ${at.toFixed(2)}s picture; ${owner.aud?.dur.toFixed(2)||0}s narration. `+(difference<-.05?'Insufficient picture coverage: the last valid frame will hold.':difference>.05?'Picture continues after narration.':'Picture covers narration.');
 if(!$('plan_dialog').open)$('plan_dialog').showModal();
}
$('review_plan').onclick=renderPlan;$('plan_cancel').onclick=()=>$('plan_dialog').close();
$('plan_apply').onclick=async()=>{
 if(!pendingPlan){setStatus('Generate a story plan first.');return}
 if(busy){setStatus('Still working on another operation. Try applying the plan again in a moment.');return}
 const owner=clips.find(c=>c.id===pendingPlan.assetId);
 if(!owner){pendingPlan=null;$('plan_dialog').close();setStatus('The clip this plan belongs to is no longer available. Generate the plan again.');return}
 try{validateTimeline(pendingPlan.edl,clips,owner);assertLocksUnchanged(owner.edl,pendingPlan.edl);if(owner.edl.length&&!await (window.studioConfirm?.('Replace the current timeline with this reviewed plan? You can undo this change.')??Promise.resolve(false)))return;checkpoint();owner.edl=structuredClone(pendingPlan.edl);owner.align=pendingPlan.align;owner.storyCues=pendingPlan.storyCues;pendingPlan=null;cur=clips.indexOf(owner);$('ed').value=edlToText(owner.edl);rebuildCuesAndFx(owner);$('plan_dialog').close();scheduleSave();seekToTimelineTime(0);setStatus('Applied reviewed plan. Preview and check caption timing before export.')}catch(error){setStatus('Plan needs correction: '+error.message)}
};
function reviewedBuilder(builder){return async()=>{
 if(busy)return;const owner=clips[cur];
 // Recognized word timing improves accuracy but is never a prerequisite for an editorial
 // plan: the plan is built from the narration audio and the script alone. A failed,
 // unavailable, declined or cancelled sync records a note and the plan is still built,
 // so the review dialog always appears.
 let syncNote='';
 if(owner?.aud&&$('caption_engine')?.value==='speech'&&!hasSpeechTimings(owner)&&!await whisperAlignWords())
  syncNote=($('st').textContent||'Speech recognition did not run.').trim();
 buildBase=projectSnapshot();pendingPlan=null;exportCancelled=false;const currentAssets=new Map(clips.map(c=>[c.id,c]));
 try{await builder();const staged=pendingPlan;const status=$('st').textContent;restoreProject(buildBase);for(const c of clips){const old=currentAssets.get(c.id);if(old?._analysis){c._analysis=old._analysis;c._scenes=old._scenes}}pendingPlan=staged;
  if(staged){renderPlan();setStepState('idle','Plan ready. Review source choices and apply when ready.');
   setStatus('Story plan ready for review. Your current timeline is unchanged.'+(syncNote?' Captions use audio-estimated timing: '+syncNote:''));
  }else setStatus(status)
 }catch(error){const message=(error&&error.message)||String(error);setStepState('fail','The edit could not be built: '+message);setStatus('Auto-Edit & Sync could not finish: '+message)}
 finally{buildBase=null}
}}
autoSyncAndEdit=reviewedBuilder(autoSyncAndEdit);buildStoryEdit=reviewedBuilder(buildStoryEdit);$('sy').onclick=autoSyncAndEdit;window.autoSyncAndEdit=autoSyncAndEdit;window.buildStoryEdit=buildStoryEdit;window.select=select;window.list=list;
// Explicit timeline tools retain the source model used by the original moment editor.
const tools=document.createElement('div');tools.className='row';
for(const [label,action] of [['Split at playhead','split'],['Move left','left'],['Move right','right'],['Delete shot','delete']]){
 const button=document.createElement('button');button.className='g sm';button.textContent=label;tools.append(button);
 button.onclick=()=>{if(busy||cur<0)return;const c=clips[cur],i=activeSegIdx,g=c.edl[i];if(!g)return;
  try{if(c.edl.some(k=>k.lock))throw new Error('Unlock shots before structural timeline changes; their positions are protected.');const proposal=structuredClone(cleanData(c.edl));const shot=proposal[i];
   if(action==='split'){const at=Number(lastKnownTime);const offset=at-(g.timelineStart??c.edl.slice(0,i).reduce((n,k)=>n+(k.e-k.s)/k.sp,0));const source=g.rev?g.e-offset*g.sp:g.s+offset*g.sp;if(source<=g.s+.033||source>=g.e-.033)throw new Error('Place the playhead inside the selected shot.');const right={...shot,id:crypto.randomUUID(),s:g.rev?g.s:source,e:g.rev?source:g.e,tr:{type:'cut',d:0}};shot.s=g.rev?source:g.s;shot.e=g.rev?g.e:source;proposal.splice(i+1,0,right)}
   else if(action==='delete')proposal.splice(i,1);
   else{const other=i+(action==='left'?-1:1);if(other<0||other>=proposal.length)return;[proposal[i],proposal[other]]=[proposal[other],proposal[i]];activeSegIdx=other}
   validateTimeline(proposal,clips,c);checkpoint();c.edl=proposal;$('ed').value=edlToText(proposal);rebuildCuesAndFx(c);scheduleSave();setStatus('Timeline updated with ripple positioning. Narration captions retain their times.');
  }catch(error){setStatus(error.message)}
 };
}
document.querySelector('.timeline-toolbar').append(tools);
document.addEventListener('keydown',event=>{if(event.target.matches('input,textarea,select')||busy)return;if(event.code==='Space'){event.preventDefault();$('play').click()}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();$(event.shiftKey?'project_redo':'project_undo').click()}});
for(const el of document.querySelectorAll('input,textarea,select'))if(!el.labels?.length&&!el.hasAttribute('aria-label'))el.setAttribute('aria-label',el.id.replaceAll('_',' '));
window.addEventListener('beforeunload',()=>{for(const c of clips)releaseClip(c);releaseExportURL()});
const diskExport=document.createElement('button');diskExport.className='g sm';diskExport.textContent='Export directly to file';diskExport.disabled=!window.showSaveFilePicker;diskExport.title=window.showSaveFilePicker?'Stream encoded video to a local file to reduce memory use.':'Direct file export is unavailable in this browser; use Export Video.';
$('project_toolbar').append(diskExport);
diskExport.onclick=async()=>{if(busy||cur<0)return;showTaskProgress('Choose export destination','Select the folder and filename for the MP4…');try{const handle=await window.showSaveFilePicker({suggestedName:'SkimStudio.mp4',types:[{description:'MP4 video',accept:{'video/mp4':['.mp4']}}]});hideTaskProgress();await render(cur,false,handle)}catch(error){hideTaskProgress();if(error.name==='AbortError')setStatus('Direct export cancelled.');else setStatus('Direct export failed: '+error.message)}};
const audioMeter=document.createElement('span');audioMeter.id='audio_meter';audioMeter.setAttribute('role','status');audioMeter.textContent='Mix peak: preview or export to measure';$('project_toolbar').append(audioMeter);
document.addEventListener('click',event=>{if(busy&&!event.target.closest('#export_cancel,.alignment-cancel,.task-progress-cancel,#plan_dialog')&&!(edlPlaying&&event.target.closest('#play'))){event.preventDefault();event.stopImmediatePropagation()}},true);
document.addEventListener('input',()=>{if(!busy&&cur>=0&&isStoryMode()&&clips[cur].edl.length)seekToTimelineTime(lastKnownTime)});
document.addEventListener('click',scheduleSave);
const listWithRelink=list;list=function(){listWithRelink();[...$('list').children].forEach((row,index)=>{
 const button=document.createElement('button');button.className='g sm';button.textContent='Remove';button.onclick=event=>{
  event.stopPropagation();if(busy)return;const clip=clips[index];
  if(clips.some(owner=>owner.edl.some(g=>g.assetId===clip.id||!g.assetId&&(g.clipIdx===index||g.clipIdx==null&&owner===clip)))){setStatus('This media is used by a timeline. Delete or replace those shots before removing the source.');return}
  checkpoint();releaseClip(clip);clips.splice(index,1);for(const owner of clips)validateTimeline(owner.edl,clips,owner);cur=Math.min(cur,clips.length-1);if(cur>=0)select(cur);else restoreProject({clips:[],script:$('sc').value,settings:{}});list();scheduleSave();
 };row.append(button);
})};window.list=list;
refreshReferenceCues=installReferenceControls({$,checkpoint,getClip:()=>clips[cur],setStatus,changed:timelineChanged=>{if(cur>=0){if(timelineChanged)$('ed').value=edlToText(clips[cur].edl);renderTimeline();if(clips[cur].edl.length)seekToTimelineTime(lastKnownTime)}scheduleSave()}});
const applyPresetChanged=()=>{
  if(cur>=0&&isStoryMode()&&clips[cur].edl.length)seekToTimelineTime(lastKnownTime);
  scheduleSave();
};
presetUI=installPresetControls({$,checkpoint,changed:applyPresetChanged,setStatus,getClip:()=>clips[cur],isBusy:()=>busy});
document.fonts?.addEventListener('loadingdone',()=>{clearPresetLayouts();applyPresetChanged()});
$('sync_speech').onclick=whisperAlignWords;
installSimpleEditor({
  $, pv, setStatus, seekToTimelineTime,
  renderTimeline,
  setTimelineRenderer(renderer){renderTimeline=renderer;window.renderTimeline=renderer;},
  getState:()=>({clips,cur,busy,tlPixelsPerSec})
});
