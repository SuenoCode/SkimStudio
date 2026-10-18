// Style observations: https://www.youtube.com/shorts/LCvKfVcvi7o
// The source's editorial colors are phrase emphasis, not karaoke completion.
import {captionIsActive} from './activity.js';
export const REFERENCE_COLORS={green:'#70ff00',magenta:'#ff00ed',red:'#ff2828'};
export function referenceAccent(text,choice='auto'){
  if(REFERENCE_COLORS[choice])return REFERENCE_COLORS[choice];
  if(/^#[0-9a-f]{6}$/i.test(choice))return choice;
  if(/\b(pain|hurt|injur\w*|broken|lost)\b/i.test(text))return REFERENCE_COLORS.red;
  if(/\b(other|opponent|rival|but|however|suddenly)\b/i.test(text))return REFERENCE_COLORS.magenta;
  return REFERENCE_COLORS.green;
}
export function splitReferencePhrases(text,maxWords=8){
  const lines=String(text||'').split(/\n+/).map(line=>line.trim()).filter(Boolean),out=[];
  for(const line of lines)for(const sentence of line.match(/[^.!?]+[.!?]*/g)||[]){
    const words=sentence.trim().split(/\s+/).filter(Boolean);
    while(words.length){let count=Math.min(maxWords,words.length);if(words.length-count===1&&count>3)count--;out.push(words.splice(0,count).join(' '))}
  }
  return out;
}
export function balancedLines(words,measure,emphasisText=''){
  if(words.length<=2)return [words];
  const explicit=emphasisText.trim().toUpperCase();
  let best=1,score=Infinity;
  for(let split=1;split<words.length;split++){
    const first=words.slice(0,split).join(' '),second=words.slice(split).join(' '),a=measure(first),b=measure(second);
    const value=Math.max(a,b)+Math.abs(a-b)*.4+(split===1||words.length-split===1?measure('MM')*.5:0)-(explicit&&second===explicit?100000:0);
    if(value<score){score=value;best=split}
  }
  return [words.slice(0,best),words.slice(best)];
}
export function referenceMotion(base,elapsed,duration){
  const x=Math.max(0,Math.min(1,elapsed/Math.max(.01,duration))),ease=x*x*(3-2*x);
  return {...base,fz:base.fz*(1+.045*ease)};
}
export function renderReferenceCaption(ctx,cue,time,options,words){
  if(!captionIsActive(cue,time,words,options))return;
  const relative=time-cue.s+(options.wordOffset||0);
  if(!words.length||time<cue.s||time>=cue.e||relative<words[0].s||relative>=words.at(-1).e)return;
  // A gap between phrases has no lingering caption.
  let active=words.findIndex(word=>relative>=word.s&&relative<word.e);
  if(active<0)active=Math.max(0,words.findLastIndex(word=>word.s<=relative));
  const pageSize=Math.max(2,Math.min(10,Number(options.referenceWords)||8)),page=Math.floor(active/pageSize),offset=page*pageSize;
  const group=words.slice(offset,offset+pageSize);
  if(relative<group[0].s||relative>=group.at(-1).e)return;
  const texts=group.map(word=>word.t.toUpperCase()),sc=options.w/360;
  let size=Math.max(16,options.fs||28)*sc;
  ctx.save();
  try{
    ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.lineJoin='round';
    const font=()=>{ctx.font='900 '+size+'px '+(options.cf||"Montserrat,'Arial Black',sans-serif")};font();
    const lines=balancedLines(texts,text=>ctx.measureText(text).width,cue.refEmphasis||'');
    const available=options.w*.86;const widest=Math.max(...lines.map(line=>ctx.measureText(line.join(' ')).width));
    if(widest>available){size*=available/widest;font()}
    const pitch=size*1.12,centerX=Math.max(options.w*.08,Math.min(options.w*.92,options.w*(options.cx_pos??.5)));
    const centerY=Math.max(options.h*.2,Math.min(options.h*.77,options.h*(options.cy??.54)));
    const color=referenceAccent(cue.t,cue.refAccent&&cue.refAccent!=='auto'?cue.refAccent:(options.referenceAccent||'auto'));
    let index=offset;
    for(let lineIndex=0;lineIndex<lines.length;lineIndex++){
      const line=lines[lineIndex],spans=words.slice(index,index+line.length);index+=line.length;
      // Lines enter only when their first word starts; word mode is stricter.
      if(relative<spans[0].s)continue;
      const age=relative-spans[0].s,intro=Math.min(.12,Math.max(0,options.referenceIntro??.08));
      const enter=intro?Math.min(1,age/intro):1;
      const fadeOut=Math.min(1,Math.max(0,(group.at(-1).e-relative)/.055));
      const scale=.98+.02*(1-Math.pow(1-enter,3));
      const width=ctx.measureText(line.join(' ')).width;
      const lineCenter=Math.round(Math.max(width*.51+options.w*.04,Math.min(options.w-width*.51-options.w*.04,centerX))*2)/2;
      const baseline=Math.round((centerY+(lineIndex-(lines.length-1)/2)*pitch+size*.35)*2)/2;
      ctx.save();ctx.globalAlpha*=Math.max(.35,Math.min(1,enter*4))*fadeOut;ctx.translate(lineCenter,baseline+(1-enter)*size*.18);ctx.scale(scale,scale);
      let x=-width/2;
      line.forEach((text,i)=>{
        const visible=options.referenceReveal!=='word'||relative>=spans[i].s;
        const wordWidth=ctx.measureText(text).width;
        if(visible){
          const explicit=cue.refEmphasis?.toUpperCase().split(/\s+/).includes(text.replace(/[.!?,]/g,''));
          const emphasized=cue.refEmphasis?explicit:(lines.length===1?i===line.length-1:lineIndex===lines.length-1);
          ctx.shadowColor='rgba(0,0,0,.85)';ctx.shadowBlur=size*.16;ctx.shadowOffsetY=size*.07;
          ctx.fillStyle=emphasized?color:(options.tc||'#ffffff');
          ctx.strokeStyle='rgba(0,0,0,.48)';ctx.lineWidth=size*(options.sw==='thick'?.09:options.sw==='normal'?.06:.035);if(options.sw!=='none')ctx.strokeText(text,x,0);ctx.fillText(text,x,0);
        }
        x+=wordWidth+ctx.measureText(' ').width;
      });ctx.restore();
    }
  }finally{ctx.restore()}
}
