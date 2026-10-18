import {AudioBufferCache} from '../media/lifecycle.js';
export async function mixTimelineAudio({clips,owner,total,story,sourceGain=1,allowPitch=false,sounds=false,soundGain=.3,playSound,cancelled=()=>false,onPeak,
 Context=globalThis.OfflineAudioContext,decode}){
 if(!Number.isFinite(total)||total<=0||total>300)throw new Error('Preview/export duration must be between zero and five minutes.');
 const check=()=>{if(cancelled())throw new Error('cancelled')};check();
 const context=new Context(2,Math.max(1,Math.ceil(total*48000)),48000),nodes=[],cache=new AudioBufferCache(256*1024*1024),failed=new Set();
 const node=n=>{nodes.push(n);return n};
 const mix=node(context.createGain()),compressor=node(context.createDynamicsCompressor()),bus=node(context.createGain());
 mix.connect(compressor);compressor.connect(context.destination);bus.connect(mix);
 let decodedBytes=0,reverseBytes=0;
 try{
  if(story&&owner.aud)for(const[s,e]of owner.aud.runs||[]){bus.gain.setTargetAtTime(.25,Math.max(0,s-.03),.01);bus.gain.setTargetAtTime(1,e,.06)}
  const place=async(clip,shot,at)=>{
   check();if(shot.sp!==1&&!allowPitch)return;
   const key=clip.id||clip;
   let buffer=cache.get(key);
   if(!buffer&&!failed.has(key)){
    try{buffer=await decode(clip.file)}catch{failed.add(key)}
    check();
    if(buffer){decodedBytes+=buffer.length*buffer.numberOfChannels*4;if(decodedBytes>cache.budget)throw new Error('Source audio exceeds the 256 MB decoded-audio budget. Use shorter source files or fewer clips.');cache.set(key,buffer)}
   }
   if(!buffer){clip.audioWarning='Source audio unavailable: '+clip.file.name;return}
   clip.audioWarning='';
   let offset=shot.s;
   if(shot.rev){
    const length=Math.max(1,Math.floor((shot.e-shot.s)*buffer.sampleRate)),start=Math.floor(shot.s*buffer.sampleRate);
    reverseBytes+=length*8;if(reverseBytes>128*1024*1024)throw new Error('Reverse audio exceeds the 128 MB budget. Shorten reverse shots.');
    const reverse=context.createBuffer(2,length,buffer.sampleRate);
    for(let ch=0;ch<2;ch++){const from=buffer.getChannelData(Math.min(ch,buffer.numberOfChannels-1)),to=reverse.getChannelData(ch);for(let i=0;i<length;i++)to[i]=from[start+length-1-i]||0}
    buffer=reverse;offset=0;
   }
   const src=node(context.createBufferSource()),gain=node(context.createGain()),duration=(shot.e-shot.s)/shot.sp,fade=Math.min(.008,duration/4);
   src.buffer=buffer;src.playbackRate.value=shot.sp;
   gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(sourceGain,at+fade);gain.gain.setValueAtTime(sourceGain,at+duration-fade);gain.gain.linearRampToValueAtTime(0,at+duration);
   src.connect(gain);gain.connect(bus);src.start(at,offset,shot.e-shot.s);
  };
  if(story){
   let at=0;
   for(const shot of owner.edl){await place(clips[shot.clipIdx]||owner,shot,at);at+=(shot.e-shot.s)/shot.sp}
   if(owner.aud){const voice=node(context.createBufferSource());voice.buffer=owner.aud.buf;voice.connect(mix);voice.start(0)}
  }else await place(owner,{s:0,e:owner.videoEl.duration,sp:1},0);
  if(sounds){const gain=node(context.createGain());gain.gain.value=soundGain;gain.connect(mix);for(const event of owner.fx||[])playSound(context,gain,event.k,event.t)}
  check();const rendered=await context.startRendering();check();
  let peak=0;
  for(let ch=0;ch<rendered.numberOfChannels;ch++){const samples=rendered.getChannelData(ch);for(let i=0;i<samples.length;i++)peak=Math.max(peak,Math.abs(samples[i]))}
  onPeak?.(peak);return rendered;
 }finally{
  cache.clear();for(const n of nodes){try{n.stop?.()}catch{}try{n.disconnect()}catch{}if('buffer'in n)n.buffer=null}
 }
}

