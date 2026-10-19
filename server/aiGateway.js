import {AIError} from '../src/ai/provider.js';
import {createOpenRouter} from '../src/ai/openrouter.js';

// Local-development/preview gateway only. Hosted authenticated deployment is M9.
export function createAIGateway({env=process.env,provider,fetchImpl=fetch,onTrack}={}){
  const tracking=[];
  const ai=provider||createOpenRouter({apiKey:env.OPENROUTER_API_KEY,defaultModel:env.OPENROUTER_MODEL||'openrouter/free',fetchImpl,onTrack(record){tracking.push(record);if(tracking.length>64)tracking.shift();onTrack?.(record);}});
  return async function gateway(req,res,next){
    const path=(req.url||'').split('?')[0];
    if(!path.startsWith('/api/ai/')){if(next)return next();res.writeHead(404).end();return;}
    const send=(status,body)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
    const controller=new AbortController();
    const close=()=>{if(!res.writableEnded)controller.abort();};res.on('close',close);req.on('aborted',close);
    try{
      const remote=req.socket.remoteAddress;
      if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))throw new AIError('FORBIDDEN','AI gateway accepts local connections only.',{status:403});
      const host=req.headers.host||'';
      if(!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))throw new AIError('FORBIDDEN','Unrecognized local Host.',{status:403});
      const origin=req.headers.origin;
      if(origin!==`http://${host}`&&origin!==`https://${host}`)throw new AIError('FORBIDDEN','AI requests require the same local origin.',{status:403});
      if(req.method!=='POST')throw new AIError('INVALID_REQUEST','Use POST for local AI requests.',{status:405});
      if(!req.headers['content-type']?.startsWith('application/json'))throw new AIError('INVALID_REQUEST','Expected application/json.',{status:415});
      if(Number(req.headers['content-length']||0)>2*1024*1024)throw new AIError('RESOURCE_LIMIT','AI request is too large.',{status:413});
      if(!['/api/ai/status','/api/ai/models','/api/ai/complete'].includes(path))throw new AIError('INVALID_REQUEST','Unknown AI endpoint.',{status:404});
      if(path==='/api/ai/status'){req.resume();send(200,{configured:ai.configured,defaultModel:ai.defaultModel,freeOnly:true,recentRequests:tracking.filter(record=>record.event==='success').map(({trackingId,actualModel,usage,attempts,latencyMs})=>({trackingId,actualModel,usage,attempts,latencyMs}))});return;}
      if(!ai.configured)throw new AIError('AUTH_REQUIRED','Configure OPENROUTER_API_KEY in .env.local and restart the local server.',{status:503});
      const body=await readRequest(req,controller.signal);
      if(path==='/api/ai/models'){
        const models=await ai.catalog({signal:controller.signal});send(200,{models:models.filter(model=>model.free&&model.inputModalities.includes('image')&&model.outputModalities.includes('text'))});return;
      }
      if(!body||Object.keys(body).some(key=>!['model','messages','schemaName','maxTokens'].includes(key)))throw new AIError('INVALID_REQUEST','Unsupported AI request fields.');
      const result=await ai.completeJSON({...body,signal:controller.signal});send(200,result);
    }catch(error){
      req.resume();
      const safe=error instanceof AIError?error:new AIError('INTERNAL_ERROR','The local AI service failed.',{status:500});
      if(safe.retryAt)res.setHeader('Retry-After',String(Math.max(1,Math.ceil((safe.retryAt-Date.now())/1000))));
      send(safe.status,{error:safe.toJSON()});
    }finally{res.removeListener('close',close);req.removeListener('aborted',close);}
  };
}

function readRequest(req,signal){
  return new Promise((resolve,reject)=>{
    const chunks=[];let bytes=0;
    const cleanup=()=>{clearTimeout(timer);req.removeListener('data',data);req.removeListener('end',end);req.removeListener('error',fail);signal.removeEventListener('abort',abort);};
    const fail=error=>{cleanup();req.resume();reject(error);};
    const abort=()=>fail(new AIError('CANCELLED','AI request cancelled.',{status:499}));
    const data=chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024)return fail(new AIError('RESOURCE_LIMIT','AI request is too large.',{status:413}));chunks.push(chunk);};
    const end=()=>{cleanup();try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new AIError('INVALID_REQUEST','Invalid JSON request body.'));}};
    const timer=setTimeout(()=>fail(new AIError('TIMEOUT','AI request upload timed out.',{status:408})),15000);
    req.on('data',data);req.once('end',end);req.once('error',fail);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}
