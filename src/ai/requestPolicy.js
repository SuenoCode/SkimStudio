import {AIError,cancelled} from './provider.js';

export const DEFAULT_POLICY=Object.freeze({timeoutMs:90000,totalTimeoutMs:180000,minIntervalMs:4000,maxRetries:2,maxAttempts:4,maxRequestBytes:2*1024*1024,maxResponseBytes:2*1024*1024,maxImages:12,maxImageEdge:512,maxTokens:4096,catalogTtlMs:300000});

export function retryTime(headers,attempt,now=Date.now(),random=Math.random){
  const hint=headers.get('retry-after');
  if(hint!==null){const seconds=Number(hint);if(Number.isFinite(seconds))return now+Math.max(0,seconds*1000);const date=Date.parse(hint);if(Number.isFinite(date))return Math.max(now,date);}
  const reset=headers.get('x-ratelimit-reset');
  if(reset!==null){const value=Number(reset);if(Number.isFinite(value))return Math.max(now,value<1e12?value*1000:value);}
  return now+Math.min(30000,1000*2**attempt)+Math.round(random()*250);
}

export function pause(ms,signal){
  cancelled(signal);if(ms<=0)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const finish=()=>{signal?.removeEventListener('abort',abort);resolve();};
    const timer=setTimeout(finish,ms);
    const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new AIError('CANCELLED','AI request cancelled.',{status:499}));};
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
  });
}

// One queue per provider instance/credential. Failed or cancelled work releases it.
export function serialQueue(){
  let tail=Promise.resolve(),pending=0;
  return async(task,signal)=>{
    cancelled(signal);
    if(pending>=8)throw new AIError('RATE_LIMITED','AI request queue is full. Retry later.',{status:429,retryable:true});
    const previous=tail;let release;
    tail=new Promise(resolve=>{release=resolve;});pending++;
    let abort;
    try{
      await Promise.race([previous,new Promise((_,reject)=>{abort=()=>reject(new AIError('CANCELLED','AI request cancelled.',{status:499}));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();})]);
      cancelled(signal);return await task();
    }finally{
      signal?.removeEventListener('abort',abort);pending--;
      // A cancelled queued task must not let later work overtake its predecessor.
      previous.finally(release);
    }
  };
}
