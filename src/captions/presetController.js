import {OWNED_KEYS} from './presetUtils.js';
export function createPresetController({read,write,checkpoint,changed,setStatus}){
 let state={version:1,manual:{},baseline:{},owned:{}};
 const snapshot=()=>structuredClone(state);
 function release(){
  for(const key of Object.keys(state.owned))if(!(key in state.manual)&&read(key)===state.owned[key]&&key in state.baseline)write(key,state.baseline[key]);
  state.owned={};
 }
 return {
  snapshot,release,
  restore(value){state={version:1,manual:{...(value?.manual||{})},baseline:{...(value?.baseline||{})},owned:{...(value?.owned||{})}}},
  markManual(key){if(OWNED_KEYS.includes(key))state.manual[key]=read(key)},
  apply(config){
   const before=snapshot(),values=Object.fromEntries([...OWNED_KEYS,'cs'].map(key=>[key,read(key)]));
   try{
    checkpoint();
    for(const [key,value] of Object.entries(state.owned))if(read(key)!==value)state.manual[key]=read(key);
    release();
    for(const [key,value] of Object.entries(config.defaults)){
     if(key in state.manual)continue;
     if(!(key in state.baseline))state.baseline[key]=read(key);
     write(key,value);state.owned[key]=read(key);
    }
    write('cs',config.id);changed();
    const kept=Object.keys(state.manual).length;
    setStatus(config.label+' applied to preview and export. Timeline and spoken timings preserved.'+(kept?' '+kept+' manual settings retained.':'')+' Undo restores the previous look.');
    return true;
   }catch(error){
    state=before;for(const [key,value] of Object.entries(values))write(key,value);
    setStatus('Preset could not be applied: '+error.message);return false;
   }
  }
 };
}

