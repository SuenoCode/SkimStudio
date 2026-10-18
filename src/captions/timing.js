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

