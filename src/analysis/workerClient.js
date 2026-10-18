import {analyzeSamples} from './sceneAnalysis.js';
export async function analyzeInWorker(samples,width,height,fps){
  if(!globalThis.Worker)return analyzeSamples(samples,width,height,fps);
  const worker=new Worker(new URL('../workers/analysis.worker.js',import.meta.url),{type:'module'});
  try{return await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Scene analysis worker timed out.')),30000);
    worker.onmessage=event=>{clearTimeout(timeout);event.data.error?reject(new Error(event.data.error)):resolve(event.data.result)};
    worker.onerror=event=>{clearTimeout(timeout);reject(new Error(event.message||'Scene analysis worker failed.'))};
    worker.postMessage({samples,width,height,fps});
  })}finally{worker.terminate()}
}
