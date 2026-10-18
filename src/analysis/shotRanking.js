export function scoreShot(shot,sec,ctx){
  const ev=shot.ev;
  let kw=0;
  for(const k of sec.keys)if(ev.words.has(k))kw++;
  const hit=kw>0;
  let score=hit?kw*3:0.35;                       // no keyword evidence -> neutral contextual footage

  // ---- what the footage is actually doing ----
  const hasEvent=shot.events&&shot.events.length>0;
  if(sec.role==='open'){
    // an establishing shot wants something readable and held, not a burst of action
    if(shot.len>=3.5)score+=0.8;
    if(hasEvent)score-=0.9;
    if(shot.steady>0.4)score+=0.4;
  }else if(sec.role==='climax'||sec.role==='close'){
    // the payoff wants the strongest thing the footage actually contains
    if(hasEvent)score+=0.6+Math.min(1.2,shot.action*0.5);
    if(sec.role==='close'&&hasEvent)score-=0.8;   // let the ending breathe
  }else if(sec.role==='develop'){
    if(hasEvent)score+=0.5;
    if(shot.steady>0.5)score+=0.35;               // variety: mix action with held shots
  }
  if(ctx.wantEstablish&&shot.len>=4)score+=0.6;

  // ---- continuity: avoid a jarring change of look back to back ----
  if(ctx.prevLum!=null){
    const dL=Math.abs((shot.bright||0)-ctx.prevLum);
    if(dL>0.28)score-=0.9;                        // exposure jump
  }
  if(ctx.prevEdge!=null&&Math.abs((shot.edge||0)-ctx.prevEdge)>10)score-=0.35;

  // ---- reuse and variety ----
  if(ctx.used.some(u=>u.ci===shot.ci&&u.si===shot.si)){
    const u=ctx.used.find(x=>x.ci===shot.ci&&x.si===shot.si);
    score-=2.4+u.uses*1.6;                       // heavily penalise reusing the same source
  }
  if(shot.ci===ctx.prevClip)score-=ctx.variety;  // don't sit on one clip
  if(!hit)score-=ctx.neutralPenalty;             // do not fill gaps with unrelated footage
  return{score,hit,kw};
}

