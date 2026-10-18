const indexes=new WeakMap();
export function invalidateTimeline(edl){indexes.delete(edl)}
export function timelineIndex(edl){
 let result=indexes.get(edl);
 if(!result||result.length!==edl.length){
  let at=0;result={length:edl.length,entries:edl.map((g,i)=>{const a=at,d=(g.e-g.s)/g.sp;at+=d;return{g,a,d,i,end:at}}),duration:0};
  result.duration=at;indexes.set(edl,result);
 }
 return result;
}
export function shotAt(edl,time){
 const {entries}=timelineIndex(edl);if(!entries.length)return null;
 let lo=0,hi=entries.length;
 while(lo<hi){const mid=(lo+hi)>>>1;if(entries[mid].end<=time)lo=mid+1;else hi=mid}
 return entries[Math.min(lo,entries.length-1)];
}

