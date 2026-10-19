import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenRouter,isKnownFree} from '../src/ai/openrouter.js';
import {validateResponse,parseModelJSON} from '../src/ai/validateResponse.js';
import {beats,model,reply} from './fixtures/ai.js';

const options={messages:[{role:'user',content:'Test script'}],schemaName:'skimstudio_story_beats',maxTokens:500};
function harness(chat,overrides={}){
  const requests=[],events=[];let clock=1000;
  const provider=createOpenRouter({apiKey:'server-test-credential',policy:{minIntervalMs:0,...overrides.policy},now:()=>clock,random:()=>0,sleep:async(ms,signal)=>{signal?.throwIfAborted();clock+=ms;},onTrack:record=>events.push(record),fetchImpl:async(url,init)=>{requests.push({url,init});if(url.endsWith('/models'))return Response.json({data:overrides.models||[model()]});return chat(init,requests);}});
  return {provider,requests,events};
}
test('server provider forwards server credentials, validates JSON and records actual model/usage',async()=>{
  const {provider,requests,events}=harness(async()=>Response.json(reply(beats(6))));
  const result=await provider.completeJSON(options);
  assert.equal(requests[1].init.headers.Authorization,'Bearer server-test-credential');
  assert.equal(result.data.beats.length,6);assert.equal(result.metadata.actualModel,'test/vision:free');assert.equal(result.metadata.usage.total_tokens,30);
  assert.equal(JSON.stringify(result).includes('server-test-credential'),false);assert.equal(JSON.stringify(events).includes('server-test-credential'),false);
  assert.equal(events.filter(event=>event.event==='success').length,1);
});
test('401 never retries or reflects provider body',async()=>{
  const {provider,requests}=harness(async()=>Response.json({error:{message:'secret server-test-credential'}},{status:401}));
  await assert.rejects(provider.completeJSON(options),error=>error.code==='AUTH_REQUIRED'&&!error.message.includes('server-test-credential'));
  assert.equal(requests.length,2);
});
test('429 honors Retry-After and caps retry attempts',async()=>{
  const {provider,requests,events}=harness(async()=>new Response('busy',{status:429,headers:{'Retry-After':'2'}}));
  await assert.rejects(provider.completeJSON(options),error=>error.code==='RATE_LIMITED'&&error.retryAt>=5000);
  assert.equal(requests.filter(item=>item.url.endsWith('/completions')).length,3);assert.equal(events.filter(event=>event.event==='attempt').length,3);
});
test('schema formatting fallback includes full schema and validates the fallback response',async()=>{
  let calls=0;const {provider,requests}=harness(async()=>++calls===1?Response.json({},{status:400}):Response.json(reply(beats(6))));
  await provider.completeJSON(options);
  const fallback=JSON.parse(requests.at(-1).init.body);
  assert.equal(fallback.response_format,undefined);assert.match(fallback.messages[0].content,/'?'?required/);assert.match(fallback.messages[0].content,/expectedMeaning/);
  assert.equal(requests.length,3);
});
test('known free pricing is required, including for IDs ending in :free',async()=>{
  for(const bad of [model({pricing:{}}),model({pricing:{prompt:' ',completion:'0'}}),model({pricing:{prompt:false,completion:'0'}}),model({pricing:{prompt:'0',completion:'0',image:null}}),model({pricing:{prompt:'0',completion:'.01'}}),model({pricing:{prompt:'0',completion:'0',image:'1'}})]){
    assert.equal(isKnownFree(bad),false);
    const {provider,requests}=harness(async()=>{throw new Error('must not infer');},{models:[bad]});
    await assert.rejects(provider.completeJSON({...options,model:bad.id}),error=>error.code==='MODEL_UNAVAILABLE');assert.equal(requests.length,1);
  }
});
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+a0AAAAASUVORK5CYII=';
test('images cannot be sent to a text-only model and remote image URLs are rejected',async()=>{
  const {provider,requests}=harness(async()=>{throw new Error('must not infer');},{models:[model({architecture:{input_modalities:['text'],output_modalities:['text']}})]});
  await assert.rejects(provider.completeJSON({...options,model:'test/vision:free',messages:[{role:'user',content:[{type:'image_url',image_url:{url:png}}]}]}),error=>error.code==='MODEL_UNAVAILABLE');
  await assert.rejects(provider.completeJSON({...options,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'https://example.com/a.jpg'}}]}]}),error=>error.code==='INVALID_REQUEST');
  assert.equal(requests.length,1);
});
test('invalid JSON, schema violations, truncation and excess response bytes cannot succeed',async()=>{
  for(const body of [reply({},{}),reply(beats(6),{choices:[{finish_reason:'length',message:{content:'{}'}}]}),reply(beats(6),{choices:[{finish_reason:'stop',message:{content:'prefix {"beats":[]} suffix'}}]})]){
    const {provider}=harness(async()=>Response.json(body));await assert.rejects(provider.completeJSON(options),error=>error.code==='INVALID_MODEL_OUTPUT');
  }
  assert.throws(()=>parseModelJSON('{"incomplete":'),error=>error.code==='INVALID_MODEL_OUTPUT');
  assert.throws(()=>validateResponse('skimstudio_story_beats',{beats:[]}),error=>error.code==='INVALID_MODEL_OUTPUT');
  const {provider}=harness(async()=>new Response('x'.repeat(30000)),{policy:{maxResponseBytes:2048}});
  await assert.rejects(provider.completeJSON(options),error=>error.code==='RESOURCE_LIMIT');
});
test('timeout and caller cancellation stop requests and release the queue',async()=>{
  let hung=true;
  const provider=createOpenRouter({apiKey:'test-only',policy:{timeoutMs:30,minIntervalMs:0},fetchImpl:async(url,{signal})=>{
    if(url.endsWith('/models'))return Response.json({data:[model()]});
    if(!hung)return Response.json(reply(beats(6)));
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve(Response.json(reply(beats(6)))),1000);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});
  }});
  await assert.rejects(provider.completeJSON(options),error=>error.code==='TIMEOUT');
  const controller=new AbortController();const pending=provider.completeJSON({...options,signal:controller.signal});setTimeout(()=>controller.abort(),5);
  await assert.rejects(pending,error=>error.code==='CANCELLED');
  hung=false;assert.equal((await provider.completeJSON(options)).data.beats.length,6);
});
test('one credential serializes simultaneous requests',async()=>{
  let active=0,peak=0;
  const {provider}=harness(async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return Response.json(reply(beats(6)));});
  await Promise.all([provider.completeJSON(options),provider.completeJSON(options),provider.completeJSON(options)]);assert.equal(peak,1);
});

test('request, token and image budgets fail before inference',async()=>{
  const {provider,requests}=harness(async()=>{throw new Error('must not infer');});
  await assert.rejects(provider.completeJSON({...options,maxTokens:4097}),error=>error.code==='RESOURCE_LIMIT');
  await assert.rejects(provider.completeJSON({...options,messages:[{role:'user',content:Array.from({length:13},()=>({type:'image_url',image_url:{url:png}}))}]}),error=>error.code==='RESOURCE_LIMIT');
  const oversized=Buffer.from(png.split(',')[1],'base64');oversized.writeUInt32BE(513,16);
  await assert.rejects(provider.completeJSON({...options,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,'+oversized.toString('base64')}}]}]}),error=>error.code==='RESOURCE_LIMIT');
  assert.equal(requests.length,0);
  const small=harness(async()=>{throw new Error('must not infer');},{policy:{maxRequestBytes:512}});
  await assert.rejects(small.provider.completeJSON(options),error=>error.code==='RESOURCE_LIMIT');assert.equal(small.requests.length,1);
});

test('long provider reset returns a retry time without sleeping or paid fallback',async()=>{
  const {provider,requests}=harness(async()=>new Response('busy',{status:429,headers:{'Retry-After':'3600'}}));
  await assert.rejects(provider.completeJSON(options),error=>error.code==='RATE_LIMITED'&&error.retryAt===3601000);assert.equal(requests.length,2);
});
