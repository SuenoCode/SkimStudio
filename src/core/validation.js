export function finite(value, name, min = 0, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return value;
}
export function validateCues(cues, limit = Infinity) {
  if (!Array.isArray(cues)) throw new Error('Captions must be an array.');
  let end = 0;
  for (const cue of cues) {
    finite(cue.s, 'Caption start', 0, limit); finite(cue.e, 'Caption end', 0, limit);
    if (cue.e <= cue.s || cue.s < end - 0.001) throw new Error('Caption intervals overlap or have no duration.');
    if (typeof cue.t !== 'string') throw new Error('Caption text is missing.');
    end = cue.e;
    if (cue.w) {
      if (cue.w.length !== cue.t.trim().split(/\s+/).filter(Boolean).length) throw new Error('Word count does not match caption text.');
      let previous = 0;
      for (const word of cue.w) {
        finite(word.s, 'Word start', 0, cue.e - cue.s + 0.001); finite(word.e, 'Word end', 0, cue.e - cue.s + 0.001);
        if (word.e <= word.s || word.s < previous - 0.001) throw new Error('Word timestamps overlap or have no duration.');
        previous = word.e;
      }
    }
  }
  return cues;
}
export function validateTimeline(edl, assets, owner) {
  if (!Array.isArray(edl)) throw new Error('Timeline must be an array.');
  let at = 0;
  for (const segment of edl) {
    const asset = segment.assetId ? assets.find(a => a.id === segment.assetId) : assets[segment.clipIdx ?? assets.indexOf(owner)];
    if (!asset || asset.missing || !asset.videoEl) throw new Error('A timeline source is missing. Relink its media.');
    const duration = asset.videoEl.duration;
    finite(duration, 'Media duration', 0.001);
    finite(segment.s, 'Source in', 0, duration); finite(segment.e, 'Source out', 0, duration + 0.001);
    finite(segment.sp, 'Playback speed', 0.25, 4);
    if (segment.e <= segment.s) throw new Error('A shot has no duration.');
    segment.clipIdx = assets.indexOf(asset); segment.assetId = asset.id;
    segment.id ||= crypto.randomUUID(); segment.trackId = 'video';
    segment.timelineStart = at; at += (segment.e - segment.s) / segment.sp; segment.timelineEnd = at;
    if (segment.tr) finite(segment.tr.d, 'Transition duration', 0, Math.min(1.2, segment.timelineEnd - segment.timelineStart));
  }
  return at;
}
export function validateWords(tokens, limit = Infinity) {
  if (!Array.isArray(tokens) || !tokens.length) throw new Error('No word timestamps supplied.');
  let previous = 0;
  for (const token of tokens) {
    finite(token.start, 'Word start', 0, limit); finite(token.end, 'Word end', 0, limit);
    if (token.end <= token.start || token.start < previous - 0.001) throw new Error('Word timestamps must be ordered and nonoverlapping.');
    previous = token.end;
  }
  return tokens;
}
export function assertLocksUnchanged(before,after){
  let time=0;
  for(let i=0;i<before.length;i++){
    const old=before[i];
    if(old.lock){const next=after[i];const keys=['id','assetId','s','e','sp','rev','z','fx','fy','camera','lock','tr'];
      if(!next||Math.abs((next.timelineStart??0)-time)>.001||keys.some(key=>JSON.stringify(old[key])!==JSON.stringify(next[key])))throw new Error('The plan would change a locked shot or its timeline position. Unlock it before rebuilding.');
    }
    time+=(old.e-old.s)/old.sp;
  }
}
