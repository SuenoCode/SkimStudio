export function analyzeSamples(samples,w,h,fps){
  const n=samples.length;
  const R={shots:[],events:[],dead:[],profile:null,ok:false};
  if(n<3){R.profile=null;return R}
  const motion=new Float32Array(n),hdiff=new Float32Array(n),edge=new Float32Array(n),lum=new Float32Array(n);
  const chg=new Float32Array(n);      // fraction of the frame that changed
  for(let i=1;i<n;i++){
    const a=samples[i-1],b=samples[i];
    let d=0,hd=0,c=0;
    for(let p=0;p<b.g.length;p+=2){
      const delta=b.g[p]-a.g[p];
      d+=delta<0?-delta:delta;
      if(delta>12||delta<-12)c++;
    }
    motion[i]=d/(b.g.length/2);
    chg[i]=c/(b.g.length/2);
    for(let k=0;k<16;k++)hd+=b.hx[k]-a.hx[k]<0?a.hx[k]-b.hx[k]:b.hx[k]-a.hx[k];
    hdiff[i]=hd/16;
    edge[i]=b.edge;lum[i]=b.lum;
  }
  motion[0]=motion[1];
  edge[0]=samples[0].edge;lum[0]=samples[0].lum;
  const mean=a=>{let s=0;for(const x of a)s+=x;return s/a.length};
  const std=a=>{const m=mean(a);let s=0;for(const x of a)s+=(x-m)*(x-m);return Math.sqrt(s/a.length)};
  const mMean=mean(motion),mStd=std(motion);
  const hMean=mean(hdiff),hStd=std(hdiff);
  const eMean=mean(edge),lMean=mean(lum);

  // ---- shot boundaries -----------------------------------------------------
  // A cut changes almost the WHOLE frame at once (a camera change of scene). Action
  // inside a shot only changes part of it, so it is never read as a cut. This is what
  // stops the detector inventing a cut every time the subject starts moving.
  const minShot=0.7;
  let start=0;
  for(let i=1;i<n-1;i++){
    const dt=samples[i].t-samples[i-1].t;
    const globalChange=chg[i]>0.45;
    const histJump=hdiff[i]>hMean+1.6*hStd;
    const motionJump=motion[i]>Math.max(mMean+3.0*mStd,mMean*2.6);
    const bigGap=false; // Sampling cadence is not evidence of a scene cut.
    if((globalChange&&(histJump||motionJump))||bigGap){
      if((samples[i].t-samples[start].t)>=minShot){
        R.shots.push({s:samples[start].t,e:samples[i].t});
        start=i;
      }
    }
  }
  R.shots.push({s:samples[start].t,e:samples[n-1].t});

  // ---- motion energy per shot ----
  R.shots.forEach(sh=>{
    let s=0,c=0,mx=0,mn=1e9,l=0,detail=0;
    for(let i=0;i<n;i++){
      if(samples[i].t<sh.s-0.05||samples[i].t>sh.e+0.05)continue;
      s+=motion[i];c++;if(motion[i]>mx)mx=motion[i];if(motion[i]<mn)mn=motion[i];
      l+=lum[i];detail+=edge[i];
    }
    sh.motion=c?s/c:0;
    sh.peak=c?mx:0;
    sh.calm=c?mn:0;
    sh.edge=c?detail/c:0;
    sh.lum=c?l/c:0;
    sh.len=+(sh.e-sh.s).toFixed(3);
    // action = the shot actually contains movement worth cutting to
    sh.action=Math.max(0,(sh.peak-mMean)*0.6+(sh.motion-mMean)*0.9);
    // steady = it holds a subject without much movement (reaction / talking head)
    sh.steady=Math.max(0,(mMean-sh.motion)*0.8+(eMean-sh.edge)*0.4);
  });

  // ---- key moments: local peaks in motion = actions / reactions / outcomes ----
  // Requires real variance: a perfectly static clip has none and must report none.
  const W=Math.max(1,Math.round(fps*0.35));
  if(mStd>=1.0&&mMean>=0.8){
    for(let i=1;i<n-1;i++){
      const v=motion[i];
      if(v<3||v<mMean+1.0*mStd||v<mMean*1.5)continue;
      let isPeak=true;
      for(let k=Math.max(0,i-W);k<=Math.min(n-1,i+W);k++){if(motion[k]>v){isPeak=false;break}}
      if(!isPeak)continue;
      if(R.events.some(e=>Math.abs(e.t-samples[i].t)<0.6))continue;
      R.events.push({t:+samples[i].t.toFixed(3),v:+v.toFixed(2),
        strength:+((v-mMean)/(mStd||1)).toFixed(2)});
    }
  }
  R.events.sort((a,b)=>b.strength-a.strength);
  R.events=R.events.slice(0,40).sort((a,b)=>a.t-b.t);
  R.events.forEach(e=>{
    e.shot=R.shots.findIndex(sh=>e.t>=sh.s&&e.t<=sh.e);
  });

  // ---- dead time: still, detail-free stretches worth trimming out ----
  const still=mMean*0.5,flat=eMean*0.75;
  let ds=-1;
  for(let i=0;i<n;i++){
    const isDead=(motion[i]<still&&edge[i]<flat);
    if(isDead&&ds<0)ds=i;
    if((!isDead||i===n-1)&&ds>=0){
      const a=samples[ds].t,b=samples[i].t;
      if(b-a>=0.5)R.dead.push({s:+a.toFixed(3),e:+b.toFixed(3),len:+(b-a).toFixed(3)});
      ds=-1;
    }
  }

  // ---- overall profile, used to keep cuts from feeling random ----
  let act=0,deadT=0;
  R.shots.forEach(sh=>act+=Math.max(0,sh.action));
  R.dead.forEach(d=>deadT+=d.len);
  R.profile={
    motion:+mMean.toFixed(3),motionStd:+mStd.toFixed(3),
    edge:+eMean.toFixed(3),lum:+lMean.toFixed(3),
    shots:R.shots.length,events:R.events.length,
    deadTime:+deadT.toFixed(2),
    duration:+(samples[n-1].t-samples[0].t).toFixed(2),
    action:+(act/Math.max(1,R.shots.length)).toFixed(3)
  };
  R.ok=true;
  return R;
}
