// Measured intervals are never stretched, sorted, rounded or repaired by rendering.
const cache=new WeakMap();
export function measuredWords(cue){
 const cached=cache.get(cue);
 if(cached&&cached.input===cue.w&&cached.text===cue.t&&cached.start===cue.s&&cached.end===cue.e)return cached.words;
 const text=String(cue.t||'').trim().split(/\s+/u).filter(Boolean),duration=cue.e-cue.s;
 let words=[],previous=0;
 if(Array.isArray(cue.w)&&cue.w.length===text.length&&duration>0){
  for(let i=0;i<text.length;i++){
   const raw=cue.w[i],legacy=typeof raw==='number';
   const s=legacy?raw:raw?.s,e=legacy?(typeof cue.w[i+1]==='number'?cue.w[i+1]:duration):raw?.e;
   if(!Number.isFinite(s)||!Number.isFinite(e)||s<previous||s<0||e<=s||e>duration+.001){words=[];break}
   words.push({t:text[i],s,e});previous=e;
  }
 }
 cache.set(cue,{input:cue.w,text:cue.t,start:cue.s,end:cue.e,words});return words;
}
export function intervalAt(items,time,startKey='s',endKey='e'){
 let lo=0,hi=items?.length||0;
 while(lo<hi){const mid=(lo+hi)>>>1;if(items[mid][startKey]<=time)lo=mid+1;else hi=mid}
 const index=lo-1;
 return index>=0&&time<items[index][endKey]?index:-1;
}
// Build measured word intervals for a story cue, clamped to the cue's own duration.
// Returns null instead of a partially valid list so the caller falls back to accumulated
// timing rather than emitting a cue that validateCues will reject.
// Clamp against the same rounded duration the cue is written with. Clamping against an
// unrounded duration let 3-decimal word ends land past the 1ms tolerance, which produced
// cues that failed validation and blocked preview and export permanently.
export function storyCueWords(measured,text,duration){
 const count=String(text||'').trim().split(/\s+/u).filter(Boolean).length;
 if(!Array.isArray(measured)||!measured.length||measured.length!==count)return null;
 // Clamp to the cue's real duration, never to a larger floor: a cue shorter than the floor
 // cannot contain the clamped word, so such input has to fall back rather than overflow.
 const limit=Math.max(0,duration);
 if(!(limit>0))return null;
 const clamp=value=>+Math.max(0,Math.min(limit,Number(value)||0)).toFixed(3);
 const words=measured.map(word=>({s:clamp(word?.s),e:clamp(word?.e)}));
 // Give a collapsed interval just enough room to animate, still inside the cue.
 for(let i=0;i<words.length-1;i++)if(!(words[i].e>words[i].s))words[i].e=clamp(words[i].s+.05);
 const last=words.length-1;
 if(!(words[last].e>words[last].s))words[last].e=clamp(words[last].s+.08);
 let previous=0;
 for(const word of words){
  if(!(word.e>word.s)||word.s<previous-.001||word.e>limit+.001)return null;
  previous=word.e;
 }
return words;
}
// Build one story cue. The cue's rounded bounds are the single source of truth: word
// intervals are clamped to that exact duration, so a cue can never be emitted in a shape
// validateCues rejects. Returns null for a line with no measurable duration instead of
// emitting a zero-length cue, and null word timings rather than an overflowing interval.
export function buildStoryCue(text,s,e,measured){
 const cue={s:+s.toFixed(2),e:+e.toFixed(2),t:text,w:null,src:'accum'};
 if(!(cue.e>cue.s))return null;
 const words=storyCueWords(measured,text,cue.e-cue.s);
 if(words){cue.w=words;cue.src='measured'}
 return cue;
}

