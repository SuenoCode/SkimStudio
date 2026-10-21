import {inActivity} from './activity.js';
import {intervalAt} from './timing.js';
import {normalizeToken,presetColor} from './presetUtils.js';
const layouts=new Map(),pages=new WeakMap(),LIMIT=256;
export const clearPresetLayouts=()=>layouts.clear();
export const presetCacheSize=()=>layouts.size;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function accentColor(config,text,cue,options={}){
 const token=normalizeToken(text),manual=String(cue.presetEmphasis??cue.refEmphasis??'').split(/\s+/u).map(normalizeToken);
 const mode=options.emphasisMode||config.emphasisMode;
 if(mode==='active')return options.activeWord?presetColor(options.accentColor||options.acc||config.defaults.acc,config.colors,options.tc||'#ffffff'):options.tc||config.defaults.tc||'#ffffff';
 const wordColors=cue.presetWordColors&&typeof cue.presetWordColors==='object'?cue.presetWordColors:{};
 const wordColor=Object.entries(wordColors).find(([word])=>normalizeToken(word)===token)?.[1];
 if(/^#[0-9a-f]{6}$/i.test(wordColor||''))return wordColor;
 const selected=cue.presetAccent??cue.refAccent??'auto';
 if(manual.includes(token))return presetColor(selected!=='auto'?selected:options.presetAccent,config.colors,options.acc||config.colors.cyan||config.colors.green);
 const rule=config.accentRules.find(rule=>rule.words.includes(token));
 return rule?config.colors[rule.color]:(config.setupColor?config.colors[config.setupColor]:options.tc||'#ffffff');
}
function groups(words,count){
 let configs=pages.get(words);if(!configs){configs=new Map();pages.set(words,configs)}
 if(configs.has(count))return configs.get(count);
 const result=[];let from=0;
 for(let i=0;i<words.length;i++){
  if(i>from&&(i-from>=count||words[i].s-words[i-1].e>=.08))from=i;
  result[i]=from;
 }
 configs.set(count,result);return result;
}
// Pure normalized layout: measure at 360px then scale the same state to any 9:16 output.
export function captionLayout(ctx,texts,{font,weight=900,size=30,x=.5,y=.54,speaker='',maxLines=2,safeMargin=24,padding=12,outlineRatio=.06,shadowStrength=.16}={}){
 let fs=clamp(Number(size)||30,16,110);
 const measure=()=>{ctx.font=weight+' '+fs+'px '+font;return texts.map(t=>ctx.measureText(t).width)};
 let widths=measure(),space=ctx.measureText(' ').width;
 const width=(a,b)=>widths.slice(a,b).reduce((n,w)=>n+w,0)+space*Math.max(0,b-a-1);
 const linesLimit=clamp(parseInt(maxLines,10)||2,1,2);
 let split=texts.length;
 if(linesLimit>1&&texts.length>1&&width(0,texts.length)>360-safeMargin*2-2*padding){
  let best=Infinity;
  for(let i=1;i<texts.length;i++){const a=width(0,i),b=width(i,texts.length),score=Math.max(a,b)+Math.abs(a-b)*.25;if(score<best){best=score;split=i}}
 }
 const ranges=split<texts.length?[[0,split],[split,texts.length]]:[[0,texts.length]];
 const labelWidth=speaker?ctx.measureText(speaker).width*.65:0;
 const widest=Math.max(labelWidth,...ranges.map(([a,b])=>width(a,b)),1);
 // Safe margin includes outline, shadow, and optional entrance motion.
 const edgeReserve=fs*(outlineRatio/2+shadowStrength*.4),available=Math.max(80,360-(safeMargin+edgeReserve)*2-2*padding);
 if(widest>available){fs*=available/widest;widths=measure();space=ctx.measureText(' ').width}
 const maxWidth=Math.max(speaker?ctx.measureText(speaker).width*.65:0,...ranges.map(([a,b])=>width(a,b)),1);
 const pad=Math.max(0,Number(padding)||0),height=fs*1.25*ranges.length+(speaker?fs*.85:0)+pad*2;
 const edge=fs*(outlineRatio/2+shadowStrength*.4),boxWidth=maxWidth+pad*2,cx=clamp(360*x,safeMargin+edge+boxWidth/2,360-safeMargin-edge-boxWidth/2),cy=clamp(640*y,safeMargin+edge+height/2,640-safeMargin-edge-height/2);
 const box={x:cx-boxWidth/2,y:cy-height/2,w:boxWidth,h:height};
 const lines=ranges.map(([a,b],i)=>({start:a,end:b,x:cx-width(a,b)/2,y:box.y+pad+(speaker?fs*.85:0)+fs*(.9+i*1.25)}));
 return {font,size:fs,widths,space,lines,box,speaker,label:{x:box.x+pad,y:box.y+pad+fs*.58}};
}
export function presetCaptionState(ctx,cue,time,options,words,config){
 if(options.captionTimingStale)return null;
 // Positive legacy highlight offsets must never reveal a new preset before speech.
 const relative=time-cue.s+Math.min(0,options.wordOffset||0);
 if(!words?.length||!Number.isFinite(relative)||time<cue.s||time>=cue.e||!inActivity(options.speechRuns,time))return null;
 const active=intervalAt(words,relative);if(active<0)return null;
 const count=clamp(parseInt(options.chunk_size,10)||config.defaults.chunk_size||config.maxWords,1,6);
 const starts=groups(words,count),start=starts[active];let end=active+1;
 while(end<words.length&&starts[end]===start)end++;
 const group=words.slice(start,end),uppercase=config.uppercase??options.caps_lock!==false,texts=group.map(w=>uppercase?w.t.toLocaleUpperCase():w.t);
 const speaker=config.labels?String(cue.presetSpeaker||'').trim().toUpperCase().replace(/:$/,''):'';
 const font=options.cf||config.defaults.cf;
 const params={font,weight:config.weight||900,size:options.fs||Number(config.defaults.csz),x:options.cx_pos??.5,y:options.cy??Number(config.defaults.cy)/100,speaker:speaker?speaker+':':'',maxLines:options.maxLines||config.maxLines||2,safeMargin:options.safeMargin??24,padding:options.captionPadding??config.padding??12,outlineRatio:options.outlineWidth??config.outlineRatio??config.stroke??.06,shadowStrength:options.shadowStrength??config.shadowStrength??.16};
 const key=JSON.stringify([config.id,texts,params]);
 let cached=layouts.get(key);
 if(!cached){
  cached={layout:captionLayout(ctx,texts,params)};
  if(layouts.size>=LIMIT)layouts.delete(layouts.keys().next().value);layouts.set(key,cached);
 }
 // Emphasis depends on the active timestamp. Keep only geometry in the layout cache
 // so seeking or playback never freezes the first word's color across a whole cue.
 const colors=texts.map((t,i)=>config.labels&&/:$/.test(t)?(options.speakerColor||config.speakerColor||config.colors.magenta):accentColor(config,t,cue,{...options,activeWord:i===active-start}));
 const intro=clamp(Number(options.captionIntroMs??config.entranceMs??(config.intro||0)*1000)/1000,0,.3),age=relative-group[0].s;
 // Keep short words visible on their first sampled frame; never extend their end.
 let alpha=intro?clamp(age/intro,0,1):1;
 const exit=clamp(Number(options.exitDurationMs||0)/1000,0,.3),remaining=group.at(-1).e-relative;
 if(exit)alpha*=clamp(remaining/exit,0,1);
 const entranceScale=clamp(Number(options.entranceScale??config.introScale??1),.8,1);
 const scale=intro?entranceScale+(1-entranceScale)*alpha:1;
 const mode=options.revealMode||config.revealMode||'progressive';
 const visible=group.map((w,i)=>mode==='single'?i===active-start:mode==='progressive'?relative>=w.s:true);
 const backing=options.presetBacking??config.defaults.preset_backing;
 return {...cached,colors,texts,visible,active:active-start,alpha,scale,
  backing,activeWordBacking:options.activeWordBacking??config.activeWordBacking,
  activePulse:!!options.activePulse,
  glow:options.presetGlow??config.defaults.preset_glow,
  glowAccentsOnly:config.glowAccentsOnly,glowStrength:options.glowStrength??config.glow,
  outlineWidth:options.outlineWidth??config.outlineRatio??config.stroke,
  shadowStrength:options.shadowStrength??config.shadowStrength??.16,
  backingColor:options.backingColor||'rgba(0,0,0,.70)',backingRadius:config.backingRadius||0};
}
export function renderPresetCaption(ctx,cue,time,options,words,config){
 ctx.save();
 try{
  const state=presetCaptionState(ctx,cue,time,options,words,config);if(!state)return;
  const {layout,texts,visible,colors}=state,scale=options.w/360;
  ctx.scale(scale,scale);if(state.scale!==1){ctx.translate(layout.box.x+layout.box.w/2,layout.box.y+layout.box.h/2);ctx.scale(state.scale,state.scale);ctx.translate(-(layout.box.x+layout.box.w/2),-(layout.box.y+layout.box.h/2))}ctx.globalAlpha*=state.alpha;ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.lineJoin='round';
  const {size,box}=layout;
  if(state.backing){ctx.fillStyle=state.backingColor;ctx.fillRect(box.x,box.y,box.w,box.h)}
  ctx.font=(config.weight||900)+' '+size+'px '+layout.font;
  ctx.strokeStyle=options.outlineColor||options.sc_col||'#050505';ctx.lineWidth=size*(options.sw==='none'?0:options.outlineWidth??state.outlineWidth);
  ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=size*state.shadowStrength;ctx.shadowOffsetY=size*.06;
  for(const line of layout.lines){let x=line.x;
   for(let i=line.start;i<line.end;i++){
    if(visible[i]){
     const activePulse=state.activePulse&&i===state.active?1+Math.sin((time-(cue.s+group[active-start].s))*Math.PI*10)*.008:1;
     if(activePulse!==1){const center=x+layout.widths[i]/2;ctx.save();ctx.translate(center,line.y-size*.42);ctx.scale(activePulse,activePulse);ctx.translate(-center,-(line.y-size*.42))}
     const wordWidth=layout.widths[i];
     if(state.activeWordBacking&&i===state.active){ctx.save();ctx.shadowBlur=0;ctx.fillStyle=state.backingColor;const pad=layout.size*.2,bx=x-pad,by=line.y-layout.size*.88,bw=wordWidth+pad*2,bh=layout.size*1.05;if(ctx.roundRect){ctx.beginPath();ctx.roundRect(bx,by,bw,bh,Math.min(state.backingRadius,layout.size*.12));ctx.fill()}else ctx.fillRect(bx,by,bw,bh);ctx.restore()}
     ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=size*state.shadowStrength;
     if(ctx.lineWidth)ctx.strokeText(texts[i],x,line.y);
     ctx.fillStyle=colors[i];ctx.shadowColor=colors[i];ctx.shadowBlur=state.glow&&(!state.glowAccentsOnly||colors[i]!==options.tc&&colors[i]!==config.colors.white)?size*state.glowStrength:0;
     ctx.fillText(texts[i],x,line.y);
     if(activePulse!==1)ctx.restore();
    }
    x+=layout.widths[i]+layout.space;
   }
  }
  if(layout.speaker){ctx.shadowBlur=0;ctx.font=(config.weight||700)+' '+size*.65+'px '+layout.font;ctx.fillStyle=options.speakerColor||config.speakerColor||config.colors.magenta;ctx.fillText(layout.speaker,layout.label.x,layout.label.y)}
 }finally{ctx.restore()}
}

