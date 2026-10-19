// Server-side provider. Browser code imports proxyClient.js, never this module.
import {AIError,DEFAULT_MODEL,cancelled,readJSON} from './provider.js';
import {DEFAULT_POLICY,pause,retryTime,serialQueue} from './requestPolicy.js';
import {SCHEMAS} from './schemas.js';
import {parseModelJSON,validateResponse} from './validateResponse.js';

const ROOT='https://openrouter.ai/api/v1';
const priceFields=['prompt','completion','image','request','input_cache_read','input_cache_write','internal_reasoning','web_search'];
const zeroPrice=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number(value)===0;
export function isKnownFree(model){
  const price=model?.pricing;
  return !!price&&['prompt','completion'].every(key=>zeroPrice(price[key]))&&priceFields.every(key=>price[key]===undefined||zeroPrice(price[key]));
}
function capability(model){return {id:model.id,name:model.name||model.id,inputModalities:model.architecture?.input_modalities||[],outputModalities:model.architecture?.output_modalities||[],structuredOutputs:(model.supported_parameters||[]).includes('structured_outputs'),contextLength:model.context_length||0,free:isKnownFree(model)};}

export function inspectMessages(messages,policy){
  if(!Array.isArray(messages)||!messages.length||messages.length>32)throw new AIError('INVALID_REQUEST','AI messages must be a bounded, nonempty array.');
  let images=0;
  for(const message of messages){
    if(!message||!['user','assistant','system'].includes(message.role)||Object.keys(message).some(key=>!['role','content'].includes(key)))throw new AIError('INVALID_REQUEST','Unsupported AI message.');
    if(typeof message.content==='string')continue;
    if(!Array.isArray(message.content)||message.content.length>64)throw new AIError('INVALID_REQUEST','Invalid multimodal content.');
    for(const part of message.content){
      if(part?.type==='text'&&typeof part.text==='string')continue;
      if(part?.type!=='image_url'||!/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(part.image_url?.url||''))throw new AIError('INVALID_REQUEST','Only embedded JPEG/PNG evidence images are supported.');
      images++;
      const encoded=part.image_url.url.split(',')[1];
      if(encoded.length>400000)throw new AIError('RESOURCE_LIMIT','An evidence image is too large.');
      let bytes;
      try{bytes=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0));}
      catch{throw new AIError('INVALID_REQUEST','Evidence image Base64 is invalid.');}
      const [width,height]=imageSize(bytes);
      if(!width||!height||Math.max(width,height)>policy.maxImageEdge)throw new AIError('RESOURCE_LIMIT',`Evidence images must be at most ${policy.maxImageEdge}px on the long edge.`);
    }
  }
  if(images>policy.maxImages)throw new AIError('RESOURCE_LIMIT',`Use at most ${policy.maxImages} evidence images per request.`);
  return {images};
}
function imageSize(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length>=24&&view.getUint32(0)===0x89504e47&&view.getUint32(4)===0x0d0a1a0a)return [view.getUint32(16),view.getUint32(20)];
  if(bytes[0]!==255||bytes[1]!==216)return [];
  for(let i=2;i+8<bytes.length;){
    if(bytes[i]!==255)return [];const marker=bytes[i+1];
    if(marker===216||marker===217){i+=2;continue;}
    const length=view.getUint16(i+2);if(length<2||i+2+length>bytes.length)return [];
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return [view.getUint16(i+7),view.getUint16(i+5)];
    i+=2+length;
  }
  return [];
}

export function createOpenRouter({apiKey,defaultModel=DEFAULT_MODEL,fetchImpl=fetch,policy:overrides={},onTrack=()=>{},origin='http://localhost',title='SkimStudio',now=Date.now,random=Math.random,sleep=pause}={}){
  const policy={...DEFAULT_POLICY,...overrides},queue=serialQueue();
  let cache=null,cacheTime=0,nextAttemptAt=0;
  function requireKey(){if(typeof apiKey!=='string'||!apiKey.trim())throw new AIError('AUTH_REQUIRED','Configure OPENROUTER_API_KEY on the local server.',{status:503});}
  function track(record){try{onTrack(Object.freeze(record));}catch{/* Telemetry must never break editing. */}}
  async function request(path,{body,signal,retry=0}={}){
    cancelled(signal);
    const requestSignal=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(policy.timeoutMs)]);
    try{
      const response=await fetchImpl(ROOT+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${apiKey}`,...(body?{'Content-Type':'application/json'}:{}),'HTTP-Referer':origin,'X-Title':title},...(body?{body:JSON.stringify(body)}:{}),signal:requestSignal});
      // Error bodies are untrusted and may echo credentials; only status/headers
      // are needed to classify/retry HTTP failures.
      let payload;
      if(response.ok)payload=await readJSON(response,policy.maxResponseBytes,requestSignal);
      else{await response.body?.cancel().catch(()=>{});payload={};}
      if(!response.ok||payload.error){
        const status=response.ok?Number(payload.error?.code)||502:response.status;
        const temporary=status===429||[500,502,503,504].includes(status);
        const code=status===401?'AUTH_REQUIRED':status===402||status===403?'QUOTA_EXHAUSTED':status===429?'RATE_LIMITED':status===404?'MODEL_UNAVAILABLE':temporary?'PROVIDER_UNAVAILABLE':'INVALID_REQUEST';
        // Never reflect provider error text: it can echo secrets/prompts.
        const error=new AIError(code,status===401?'OpenRouter authentication failed.':status===402||status===403?'OpenRouter quota or account budget is exhausted.':`OpenRouter request failed (${status}).`,{status,retryable:temporary,...(temporary?{retryAt:retryTime(response.headers,retry,now(),random)}:{})});
        throw error;
      }
      return payload;
    }catch(error){
      if(signal?.aborted){if(signal.reason?.name==='TimeoutError')throw new AIError('TIMEOUT','AI job exceeded its time budget.',{status:504});cancelled(signal);}
      if(requestSignal.aborted)throw new AIError('TIMEOUT',`OpenRouter did not respond within ${Math.max(1,Math.round(policy.timeoutMs/1000))} seconds. Retry, or choose another free vision model; your current timeline was not changed.`,{status:504});
      if(error instanceof AIError)throw error;
      throw new AIError('NETWORK_ERROR','Could not reach OpenRouter.',{status:502,retryable:true});
    }
  }
  async function models(signal){
    requireKey();
    if(cache&&now()-cacheTime<policy.catalogTtlMs)return cache;
    const data=await request('/models',{signal});
    if(!Array.isArray(data.data))throw new AIError('INVALID_RESPONSE','OpenRouter model catalog is invalid.',{status:502});
    cache=data.data.map(capability).filter(item=>item.id);cacheTime=now();return cache;
  }
  async function catalog({signal}={}){return queue(()=>models(signal),signal);}
  async function completeJSON({model=defaultModel,messages,schemaName,maxTokens=3500,signal}={}){
    requireKey();
    const totalSignal=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(policy.totalTimeoutMs)]);
    return queue(async()=>{
      const schema=SCHEMAS[schemaName];if(!schema)throw new AIError('INVALID_REQUEST','Unknown response schema.');
      if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>policy.maxTokens)throw new AIError('RESOURCE_LIMIT',`Output token budget must be between 1 and ${policy.maxTokens}.`);
      const {images}=inspectMessages(messages,policy);
      const available=await models(totalSignal);
      const eligible=available.filter(item=>item.free&&item.outputModalities.includes('text')&&(!images||item.inputModalities.includes('image')));
      const selected=model===DEFAULT_MODEL?{id:DEFAULT_MODEL,structuredOutputs:true}:available.find(item=>item.id===model);
      if(!selected||model!==DEFAULT_MODEL&&(!selected.free||!eligible.includes(selected))||model===DEFAULT_MODEL&&!eligible.length)throw new AIError('MODEL_UNAVAILABLE','No eligible, confirmed free model supports this request.',{status:422});
      let structured=selected.structuredOutputs,formatRetried=false,retries=0;
      const started=now(),trackingId=crypto.randomUUID();
      for(let attempt=0;attempt<policy.maxAttempts;attempt++){
        const body={model,messages:[{role:'system',content:`Return only JSON matching this complete schema. Do not include code fences or explanatory text.\n${JSON.stringify(schema)}`},...messages],temperature:.1,max_tokens:maxTokens,...(structured?{response_format:{type:'json_schema',json_schema:{name:schemaName,strict:true,schema}}}:{})};
        if(new TextEncoder().encode(JSON.stringify(body)).length>policy.maxRequestBytes)throw new AIError('RESOURCE_LIMIT','AI request exceeded the 2 MiB size budget. Reduce script or evidence.');
        await sleep(Math.max(0,nextAttemptAt-now()),totalSignal);cancelled(totalSignal);
        nextAttemptAt=now()+policy.minIntervalMs;
        track({trackingId,event:'attempt',attempt:attempt+1,requestedModel:model,schemaName});
        try{
          const payload=await request('/chat/completions',{body,signal:totalSignal,retry:retries});
          const choice=payload.choices?.[0];
          if(choice?.finish_reason!=='stop'){
            const rawReason=choice?.finish_reason;
            const finishReason=typeof rawReason==='string'&&/^[a-z0-9_-]{1,40}$/i.test(rawReason)?rawReason.toLowerCase():'unknown';
            const diagnostics={finishReason,usage:payload.usage||null};
            if(finishReason==='length')throw new AIError('OUTPUT_TRUNCATED','The model reached its output limit before completing JSON.',{status:422,diagnostics});
            if(finishReason==='content_filter')throw new AIError('MODEL_REFUSAL','The selected model filtered the story planning response. Try another free vision model.',{status:422,diagnostics});
            throw new AIError('OUTPUT_INCOMPLETE',`OpenRouter ended the response early (finish reason: ${finishReason}).`,{status:422,diagnostics});
          }
          const content=choice.message?.content;
          const data=validateResponse(schemaName,parseModelJSON(Array.isArray(content)?content.map(part=>part.text||'').join(''):content));
          const usage={};for(const key of ['prompt_tokens','completion_tokens','total_tokens'])if(Number.isFinite(payload.usage?.[key]))usage[key]=payload.usage[key];
          const metadata={trackingId,requestId:typeof payload.id==='string'?payload.id:null,requestedModel:model,actualModel:typeof payload.model==='string'?payload.model:null,provider:typeof payload.provider==='string'?payload.provider:null,usage,finishReason:choice.finish_reason,attempts:attempt+1,latencyMs:now()-started};
          if(!metadata.actualModel)throw new AIError('INVALID_RESPONSE','Provider omitted the actual model identity.',{status:502});
          track({...metadata,event:'success',schemaName});
          return {data,metadata};
        }catch(error){
          track({trackingId,event:'error',attempt:attempt+1,requestedModel:model,schemaName,code:error.code||'UNKNOWN'});
          if(structured&&!formatRetried&&[400,422].includes(error.status)&&error.code==='INVALID_REQUEST'){
            structured=false;formatRetried=true;continue;
          }
          if(error.retryable&&retries<policy.maxRetries&&attempt+1<policy.maxAttempts){
            retries++;const retryAt=error.retryAt??retryTime(new Headers(),retries-1,now(),random);
            // Long resets return to the caller instead of holding a local API request.
            if(retryAt-now()>30000)throw error;
            nextAttemptAt=Math.max(nextAttemptAt,retryAt);continue;
          }
          throw error;
        }
      }
      throw new AIError('PROVIDER_UNAVAILABLE','OpenRouter request attempt budget exhausted.',{status:503});
    },totalSignal).catch(error=>{if(signal?.aborted)cancelled(signal);if(totalSignal.aborted&&error.code==='CANCELLED')throw new AIError('TIMEOUT','AI job exceeded its time budget.',{status:504});throw error;});
  }
  return Object.freeze({catalog,completeJSON,defaultModel,configured:typeof apiKey==='string'&&!!apiKey.trim()});
}
