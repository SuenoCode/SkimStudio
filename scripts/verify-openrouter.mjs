import {existsSync} from 'node:fs';
import {createOpenRouter} from '../src/ai/openrouter.js';
import {extractScriptBeats} from '../src/audit/storyAuditor.js';

// loadEnvFile never overwrites process variables: load the highest-priority
// local file first, then fill missing values from .env.
for(const file of ['.env.local','.env'])if(existsSync(file))process.loadEnvFile(file);
if(!process.env.OPENROUTER_API_KEY?.trim()){
  console.error('BLOCKED: configure server-only OPENROUTER_API_KEY in .env.local. No live API check was performed.');
  process.exitCode=2;
}else{
  try{
    const provider=createOpenRouter({apiKey:process.env.OPENROUTER_API_KEY,defaultModel:process.env.OPENROUTER_MODEL||'openrouter/free'});
    const result=await extractScriptBeats({provider,model:provider.defaultModel,script:'A runner approaches the finish. She crosses the line. The crowd celebrates the result.',duration:12});
    console.log(JSON.stringify({verified:'Live OpenRouter structured response',beats:result.beats.length,metadata:result.metadata},null,2));
  }catch(error){console.error(JSON.stringify({code:error.code||'LIVE_CHECK_FAILED',message:error.code?error.message:'Live OpenRouter verification failed.'}));process.exitCode=1;}
}
