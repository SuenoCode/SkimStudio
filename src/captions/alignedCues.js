import {validateWords,validateCues} from '../core/validation.js';
const normalized=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function alignedCues(existing,tokens,{source='imported',duration=Infinity,pause=.12,maxWords=8,transcript=false}={}){
  validateWords(tokens,duration);
  const sourceWords=tokens.map(token=>({...token,text:String(token.text??token.word??'').trim()})).filter(token=>token.text);
  let groups;
  if(transcript){groups=[{cue:{},words:sourceWords}]}else{
    let at=0;groups=existing.map(cue=>{
      const script=cue.t.trim().split(/\s+/).filter(Boolean),words=[];
      for(const text of script){let matched=null;
        // Recognizers can split contractions into multiple tokens. Only exact
        // normalized matches are accepted; no guessing another word's timestamp.
        for(let count=1;count<=3&&at+count<=sourceWords.length;count++){
          const chunk=sourceWords.slice(at,at+count);
          if(normalized(chunk.map(word=>word.text).join(''))===normalized(text)){matched={text,start:chunk[0].start,end:chunk.at(-1).end};at+=count;break}
        }
        if(!matched)throw new Error(`The spoken words do not match the script near “${text}”. Select “Use recognized speech” or correct the script. No caption times were changed.`);
        words.push(matched);
      }
      return{cue,words};
    });
    if(at!==sourceWords.length)throw new Error('The narration has extra recognized words. Select “Use recognized speech” or correct the script.');
  }
  const cues=[];
  for(const {cue,words} of groups){let batch=[];
    const flush=()=>{if(!batch.length)return;const start=batch[0].start,end=batch.at(-1).end;
      cues.push({...cue,id:crypto.randomUUID(),s:start,e:end,t:batch.map(word=>word.text).join(' '),w:batch.map(word=>({id:crypto.randomUUID(),s:word.start-start,e:word.end-start})),src:source,verified:false});batch=[];
    };
    for(const word of words){if(batch.length&&(word.start-batch.at(-1).end>=pause||batch.length>=maxWords))flush();batch.push(word)}flush();
  }
  validateCues(cues,duration);return cues;
}
export function alignmentForLines(lines,tokens){
  // Reuse word timing without changing it to satisfy new caption grouping.
  const cues=alignedCues(lines.map(t=>({t})),tokens,{pause:Infinity,maxWords:Infinity});
  return cues.map(cue=>({s:cue.s,e:cue.e,w:cue.w.map(word=>({s:cue.s+word.s,e:cue.s+word.e}))}));
}
