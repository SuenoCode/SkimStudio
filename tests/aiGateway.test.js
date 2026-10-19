import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createAIGateway} from '../server/aiGateway.js';
import {createOpenRouter} from '../src/ai/openrouter.js';
import {beats,model,reply} from './fixtures/ai.js';

test('unconfigured gateway rejects inference before making a provider request', async()=>{
  const gateway=createAIGateway({env:{}});
  const server=createServer(gateway);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const origin=`http://127.0.0.1:${server.address().port}`;
    const response=await fetch(origin+'/api/ai/complete',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({})});
    assert.equal(response.status,503);
    assert.equal((await response.json()).error.code,'AUTH_REQUIRED');
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('gateway keeps environment credential server-side and forwards it to OpenRouter',async()=>{
  let auth;const events=[];
  const gateway=createAIGateway({env:{OPENROUTER_API_KEY:'server-only-marker'},onTrack:record=>events.push(record),fetchImpl:async(url,init)=>{
    auth=init.headers.Authorization;
    return Response.json(url.endsWith('/models')?{data:[model()]}:reply(beats(6)));
  }});
  const server=createServer(gateway);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const origin=`http://127.0.0.1:${server.address().port}`;
    const response=await fetch(origin+'/api/ai/complete',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({schemaName:'skimstudio_story_beats',messages:[{role:'user',content:'Test narration'}]})});
    assert.equal(response.status,200);const text=await response.text();assert.equal(auth,'Bearer server-only-marker');assert.equal(text.includes('server-only-marker'),false);assert.equal(JSON.stringify(events).includes('server-only-marker'),false);
    assert.equal(JSON.parse(text).metadata.actualModel,'test/vision:free');
    const status=await fetch(origin+'/api/ai/status',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    assert.equal((await status.json()).recentRequests.length,1);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('gateway rejects cross-origin, untrusted Host, browser credentials and oversized requests',async()=>{
  const provider=createOpenRouter({apiKey:'server-only',fetchImpl:()=>{throw new Error('must not contact provider');}});
  const server=createServer(createAIGateway({provider}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const origin=`http://127.0.0.1:${server.address().port}`;
    const post=(headers,body='{}')=>fetch(origin+'/api/ai/complete',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body});
    assert.equal((await post({Origin:'https://attacker.example'})).status,403);
    assert.equal((await post({Host:'attacker.example',Origin:'http://attacker.example'})).status,403);
    assert.equal((await post({},JSON.stringify({apiKey:'browser-key'}))).status,400);
    assert.equal((await post({},'x'.repeat(2*1024*1024+1))).status,413);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
