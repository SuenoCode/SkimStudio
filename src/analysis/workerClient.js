import {analyzeSamples} from './sceneAnalysis.js';
export async function analyzeInWorker(samples,width,height,fps,cancelled=()=>false){
 if(cancelled())throw new Error('cancelled');
 if(!globalThis.Worker)return analyzeSamples(samples,width,height,fps);
 const worker=new Worker(new URL('../workers/analysis.worker.js',import.meta.url),{type:'module'});
 let timeout,poll;
 try{return await new Promise((resolve,reject)=>{
  timeout=setTimeout(()=>reject(new Error('Scene analysis worker timed out.')),30000);
  poll=setInterval(()=>{if(cancelled())reject(new Error('cancelled'))},50);
  worker.onmessage=event=>event.data.error?reject(new Error(event.data.error)):resolve(event.data.result);
  worker.onerror=event=>reject(new Error(event.message||'Scene analysis worker failed.'));
  worker.postMessage({samples,width,height,fps});
 })}finally{clearTimeout(timeout);clearInterval(poll);worker.onmessage=worker.onerror=null;worker.terminate()}
}

