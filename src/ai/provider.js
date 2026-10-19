export const DEFAULT_MODEL='openrouter/free';

export class AIError extends Error {
  constructor(code,message,{status=400,retryable=false,retryAt,diagnostics}={}){
    super(message);this.name='AIError';this.code=code;this.status=status;this.retryable=retryable;
    if(retryAt!==undefined)this.retryAt=retryAt;
    if(diagnostics)this.diagnostics=diagnostics;
  }
  toJSON(){return {code:this.code,message:this.message,retryable:this.retryable,...(this.retryAt!==undefined?{retryAt:this.retryAt}:{}),...(this.diagnostics?{diagnostics:this.diagnostics}:{})};}
}

export function cancelled(signal){
  if(signal?.aborted)throw new AIError('CANCELLED','AI request cancelled.',{status:499});
}

export async function readJSON(response,maxBytes,signal){
  const reader=response.body?.getReader();
  if(!reader)throw new AIError('INVALID_RESPONSE','AI service returned an empty response.',{status:502});
  const chunks=[];let bytes=0;
  const abort=()=>reader.cancel().catch(()=>{});
  signal?.addEventListener('abort',abort,{once:true});
  try{
    while(true){
      cancelled(signal);
      const {done,value}=await reader.read();cancelled(signal);if(done)break;
      bytes+=value.byteLength;
      if(bytes>maxBytes)throw new AIError('RESOURCE_LIMIT','AI response exceeded the allowed size.',{status:502});
      chunks.push(value);
    }
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
  const all=new Uint8Array(bytes);let at=0;for(const chunk of chunks){all.set(chunk,at);at+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(all));}
  catch{throw new AIError('INVALID_RESPONSE','AI service returned invalid JSON.',{status:502});}
}
