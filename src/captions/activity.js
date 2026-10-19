// Audio activity is measured from narration alone, never from music/source/SFX.
// This is a silence guard, not a claim of speech recognition.
export function analyzeNarration(channels,sampleRate){
  const hop=Math.max(1,Math.round(sampleRate*.01)),length=channels[0]?.length||0,levels=[];
  for(let at=0;at<length;at+=hop){let power=0;
    for(const channel of channels){let sum=0;const end=Math.min(length,at+hop);for(let i=at;i<end;i++)sum+=channel[i]*channel[i];power=Math.max(power,sum/Math.max(1,end-at))}
    levels.push(Math.sqrt(power));
  }
  const sorted=[...levels].sort((a,b)=>a-b),peak=sorted[Math.floor(sorted.length*.95)]||0,noise=sorted[Math.floor(sorted.length*.1)]||0;
  const threshold=Math.max(.0015,peak*.025,Math.min(noise*2.5,peak*.12)),raw=[];let start=null;
  levels.forEach((level,index)=>{if(level>=threshold){if(start===null)start=index*hop/sampleRate}else if(start!==null){raw.push([start,index*hop/sampleRate]);start=null}});
  if(start!==null)raw.push([start,length/sampleRate]);
  const runs=[];
  for(const range of raw){const last=runs.at(-1);if(last&&range[0]-last[1]<=.04)last[1]=range[1];else runs.push([...range])}
  return{runs,levels,threshold,duration:length/sampleRate};
}
export function inActivity(runs,time){
  if(!Array.isArray(runs))return true;
  // Half-open intervals: no carry into the first silent frame.
  let lo=0,hi=runs.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(runs[mid][0]<=time)lo=mid+1;else hi=mid}
  return lo>0&&time<runs[lo-1][1];
}
export function captionEndTime(cue,words,offset=0){
  return words?.length?Math.max(0,Math.min(cue.e,cue.s+words.at(-1).e-offset)):0;
}
export function captionIsActive(cue,time,words,options={}){
  if(options.captionTimingStale)return false;
  const offset=options.wordOffset||0,clock=time+offset;
  if(!Number.isFinite(time)||clock<cue.s||clock>=cue.e||!words?.length)return false;
  if(!inActivity(options.speechRuns,time))return false;
  const relative=clock-cue.s;
  if(relative<words[0].s||relative>=words.at(-1).e)return false;
  // A measured pause is part of the audio timing. Never bridge it by leaving the
  // previous word on screen or by starting the next one early.
  return words.some(word=>relative>=word.s&&relative<word.e);
}
export function clipTokensToActivity(tokens,runs){
  return tokens.flatMap(token=>{
    if(!Number.isFinite(token.start)||!Number.isFinite(token.end)||token.end<=token.start)return [];
    const overlaps=runs.map(([s,e])=>[Math.max(s,token.start),Math.min(e,token.end)]).filter(([s,e])=>e>s);
    if(!overlaps.length)return [];
    // A recognizer token can straddle a detector pause. Choosing the largest
    // contiguous overlap keeps the word inside voiced audio instead of stretching
    // its caption across silence.
    const overlap=overlaps.reduce((best,current)=>current[1]-current[0]>best[1]-best[0]?current:best);
    return [{...token,start:overlap[0],end:overlap[1]}];
  });
}
export function anchorRecognizedOnsets(tokens,runs){
  const result=clipTokensToActivity(tokens,runs).map(token=>({...token})),utterances=[];
  for(const range of runs){const last=utterances.at(-1);if(last&&range[0]-last[1]<.14)last[1]=range[1];else utterances.push([...range])}
  // Whisper's attention timestamps can miss the beginning of an utterance.
  // Anchor only its first word to nearby measured activity, without shifting
  // later words or importing silence into a word. Manual/imported times never
  // pass through this refinement.
  for(const [start,end] of utterances){
    const index=result.findIndex(token=>token.end>start&&token.start<end);
    if(index<0)continue;const word=result[index],lateness=word.start-start;
    if(lateness>0&&lateness<=.6&&(index===0||result[index-1].end<=start))word.start=start;
  }
  return result;
}
