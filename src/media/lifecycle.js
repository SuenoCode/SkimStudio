export function releaseMedia(clip,revoke=URL.revokeObjectURL.bind(URL)){
 const video=clip.videoEl;
 if(video){video.pause();video.removeAttribute('src');video.load();delete video._liveKey}
 if(clip.url){revoke(clip.url);clip.url=null}
 for(const shot of clip.edl||[]){for(const frame of shot._f||[]){frame.close?.();if('width'in frame)frame.width=frame.height=0}delete shot._f}
 for(const key of ['_facv','_trSnapCanvas'])if(clip[key]){clip[key].width=clip[key].height=0;delete clip[key]}
 for(const key of ['_ab','_fctx','_analysis','_scenes','thumbnail'])delete clip[key];
 clip.videoEl=null;clip.aud=null;
}
// Retained decoded buffers have a fixed budget; a single oversized decode is
// returned to its caller but never retained in the cache.
export class AudioBufferCache{
 constructor(budget=64*1024*1024){this.budget=budget;this.bytes=0;this.items=new Map()}
 get(key){return this.items.get(key)?.buffer}
 set(key,buffer){
  if(!buffer)return;
  const bytes=buffer.length*buffer.numberOfChannels*4;
  if(bytes>this.budget)return;
  if(this.items.has(key)){this.bytes-=this.items.get(key).bytes;this.items.delete(key)}
  while(this.bytes+bytes>this.budget&&this.items.size){const [id,item]=this.items.entries().next().value;this.items.delete(id);this.bytes-=item.bytes}
  this.items.set(key,{buffer,bytes});this.bytes+=bytes;
 }
 clear(){this.items.clear();this.bytes=0}
}

