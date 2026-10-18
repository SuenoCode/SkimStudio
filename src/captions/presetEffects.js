import {protectedShot,presetMotion} from './presetUtils.js';
import {intervalAt} from './timing.js';
import {inActivity} from './activity.js';
export function presetFrameState(config,options,cues,wordsFor,time,elapsed=0,shot=null){
 if(!config)return {zoom:1,shakeX:0,shakeY:0,glitch:0,bw:false,hardCut:false};
 const index=intervalAt(cues,time),cue=index<0?null:cues[index];
 const words=cue?wordsFor(cue):[],spoken=cue&&inActivity(options.speechRuns,time)&&intervalAt(words,time-cue.s)>=0;
 const safe=!protectedShot(shot),pulse=shot?.cut===0?0:Math.max(0,1-elapsed/.12);
 const amount=safe&&options.presetShake?pulse*2.5:0;
 return {
  zoom:safe&&options.presetMotion?presetMotion(config,{fz:1},elapsed,options.segDur||3,shot,true).fz:1,
  shakeX:amount?Math.sin(time*173)*amount:0,shakeY:amount?Math.sin(time*227+1)*amount:0,
  glitch:safe&&options.presetGlitch?pulse:0,
  bw:!!(spoken&&options.presetBw&&(cue.presetAccent??cue.refAccent)==='red'),
  hardCut:!!(safe&&config.motion.hardCuts)
 };
}
export function renderPresetOverlay(ctx,state,w,h){
 if(!(state.glitch>0))return;
 ctx.save();ctx.globalAlpha=.22*state.glitch;ctx.globalCompositeOperation='screen';
 const shift=state.shakeX*w/360;
 for(let i=0;i<3;i++){ctx.fillStyle=i%2?'#ff2ad4':'#13e7ff';ctx.fillRect(shift,h*(.2+i*.2),w,w/360*(i+2))}
 ctx.restore();
}

