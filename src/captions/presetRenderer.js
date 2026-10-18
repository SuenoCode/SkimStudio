import {inActivity} from './activity.js';
import {intervalAt} from './timing.js';
import {normalizeToken,presetColor} from './presetUtils.js';
const layouts=new Map(),pages=new WeakMap(),LIMIT=256;
export const clearPresetLayouts=()=>layouts.clear();
export const presetCacheSize=()=>layouts.size;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function accentColor(config,text,cue,options={}){
 const token=normalizeToken(text),manual=String(cue.presetEmphasis??cue.refEmphasis??'').split(/\s+/u).map(normalizeToken);
 const selected=cue.presetAccent??cue.refAccent??'auto';
 if(manual.includes(token))return presetColor(selected!=='auto'?selected:options.presetAccent,config.colors,options.acc||config.colors.cyan||config.colors.green);
 const override=presetColor(options.presetAccent,config.colors,null);
 if(override&&manual.length===0)return override;
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
export function captionLayout(ctx,texts,{font,size=30,x=.5,y=.54,speaker=''}={}){
 let fs=clamp(Number(size)||30,16,110);
 const measure=()=>{ctx.font='900 '+fs+'px '+font;return texts.map(t=>ctx.measureText(t).width)};
 let widths=measure(),space=ctx.measureText(' ').width;
 const width=(a,b)=>widths.slice(a,b).reduce((n,w)=>n+w,0)+space*Math.max(0,b-a-1);
 let split=texts.length;
 if(texts.length>1&&width(0,texts.length)>260){
  let best=Infinity;
  for(let i=1;i<texts.length;i++){const a=width(0,i),b=width(i,texts.length),score=Math.max(a,b)+Math.abs(a-b)*.25;if(score<best){best=score;split=i}}
 }
 const ranges=split<texts.length?[[0,split],[split,texts.length]]:[[0,texts.length]];
 const labelWidth=speaker?ctx.measureText(speaker).width*.65:0;
 const widest=Math.max(labelWidth,...ranges.map(([a,b])=>width(a,b)),1);
 // 24px outer safe area + padding, outline, shadow and motion reserve.
 if(widest>272){fs*=272/widest;widths=measure();space=ctx.measureText(' ').width}
 const maxWidth=Math.max(speaker?ctx.measureText(speaker).width*.65:0,...ranges.map(([a,b])=>width(a,b)),1);
 const pad=12,height=fs*1.25*ranges.length+(speaker?fs*.85:0)+pad*2;
 const boxWidth=maxWidth+pad*2,cx=clamp(360*x,24+boxWidth/2,336-boxWidth/2),cy=clamp(640*y,80+height/2,520-height/2);
 const box={x:cx-boxWidth/2,y:cy-height/2,w:boxWidth,h:height};
 const lines=ranges.map(([a,b],i)=>({start:a,end:b,x:cx-width(a,b)/2,y:box.y+pad+(speaker?fs*.85:0)+fs*(.9+i*1.25)}));
 return {font,size:fs,widths,space,lines,box,speaker,label:{x:box.x+pad,y:box.y+pad+fs*.58}};
}
export function presetCaptionState(ctx,cue,time,options,words,config){
 // Positive legacy highlight offsets must never reveal a new preset before speech.
 const relative=time-cue.s+Math.min(0,options.wordOffset||0);
 if(!words?.length||!Number.isFinite(relative)||time<cue.s||time>=cue.e||!inActivity(options.speechRuns,time))return null;
 const active=intervalAt(words,relative);if(active<0)return null;
 const count=clamp(parseInt(options.chunk_size,10)||config.maxWords,config.minWords,config.maxWords);
 const starts=groups(words,count),start=starts[active];let end=active+1;
 while(end<words.length&&starts[end]===start)end++;
 const group=words.slice(start,end),texts=group.map(w=>options.caps_lock===false?w.t:w.t.toUpperCase());
 const speaker=config.labels?String(cue.presetSpeaker||'').trim().toUpperCase().replace(/:$/,''):'';
 const font=options.cf||config.defaults.cf;
 const params={font,size:options.fs||Number(config.defaults.csz),x:options.cx_pos??.5,y:options.cy??Number(config.defaults.cy)/100,speaker:speaker?speaker+':':''};
 const key=JSON.stringify([config.id,texts,params,cue.presetEmphasis,cue.presetAccent,cue.refEmphasis,cue.refAccent,options.presetAccent,options.acc,options.tc]);
 let cached=layouts.get(key);
 if(!cached){
  cached={layout:captionLayout(ctx,texts,params),colors:texts.map(t=>config.labels&&/:$/.test(t)?config.colors.magenta:accentColor(config,t,cue,options))};
  if(layouts.size>=LIMIT)layouts.delete(layouts.keys().next().value);layouts.set(key,cached);
 }
 const intro=clamp(Number(options.captionIntro??config.intro),0,.12),age=relative-group[0].s;
 // Keep short words visible on their first sampled frame; never extend their end.
 const alpha=intro?clamp(.4+age/intro*.6,.4,1):1;
 return {...cached,texts,visible:group.map(w=>relative>=w.s),active:active-start,alpha,
  backing:options.presetBacking??config.defaults.preset_backing,glow:options.presetGlow??config.defaults.preset_glow};
}
export function renderPresetCaption(ctx,cue,time,options,words,config){
 ctx.save();
 try{
  const state=presetCaptionState(ctx,cue,time,options,words,config);if(!state)return;
  const {layout,texts,visible,colors}=state,scale=options.w/360;
  ctx.scale(scale,scale);ctx.globalAlpha*=state.alpha;ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.lineJoin='round';
  const {size,box}=layout;
  if(state.backing){ctx.fillStyle='rgba(0,0,0,.70)';ctx.fillRect(box.x,box.y,box.w,box.h)}
  ctx.font='900 '+size+'px '+layout.font;
  ctx.strokeStyle=options.sc_col||'#050505';ctx.lineWidth=size*(options.sw==='none'?0:options.sw==='thin'?.035:options.sw==='normal'?.065:config.stroke);
  ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=size*.16;ctx.shadowOffsetY=size*.06;
  for(const line of layout.lines){let x=line.x;
   for(let i=line.start;i<line.end;i++){
    if(visible[i]){
     ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=size*.16;
     if(ctx.lineWidth)ctx.strokeText(texts[i],x,line.y);
     ctx.fillStyle=colors[i];ctx.shadowColor=colors[i];ctx.shadowBlur=state.glow?size*config.glow:0;
     ctx.fillText(texts[i],x,line.y);
    }
    x+=layout.widths[i]+layout.space;
   }
  }
  if(layout.speaker){ctx.shadowBlur=0;ctx.font='900 '+size*.65+'px '+layout.font;ctx.fillStyle=config.colors.magenta;ctx.fillText(layout.speaker,layout.label.x,layout.label.y)}
 }finally{ctx.restore()}
}

