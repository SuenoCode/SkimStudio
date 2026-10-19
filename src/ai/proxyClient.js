import {AIError,readJSON} from './provider.js';

async function call(path,body,{signal}={}){
  try{
    const response=await fetch('/api/ai/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(185000)])});
    if(!response.headers.get('content-type')?.includes('application/json'))throw new AIError('AI_UNAVAILABLE','OpenRouter AI requires the configured local server. Start npm run dev or npm run preview, or select Offline planner.',{status:503});
    const result=await readJSON(response,2*1024*1024,signal);
    if(!response.ok||result.error)throw new AIError(result.error?.code||'AI_UNAVAILABLE',result.error?.message||'The local AI service is unavailable.',{status:response.status,retryable:!!result.error?.retryable,retryAt:result.error?.retryAt,diagnostics:result.error?.diagnostics});
    return result;
  }catch(error){
    if(signal?.aborted)throw new AIError('CANCELLED','AI request cancelled.',{status:499});
    if(error instanceof AIError)throw error;
    if(error.name==='TimeoutError'||error.name==='AbortError')throw new AIError('TIMEOUT','The AI service timed out.',{status:504});
    throw new AIError('AI_UNAVAILABLE','Start the local server and configure OPENROUTER_API_KEY.',{status:503});
  }
}
export const browserAI=Object.freeze({
  status:options=>call('status',{},options),
  catalog:options=>call('models',{},options),
  completeJSON:({signal,...body})=>call('complete',body,{signal})
});
