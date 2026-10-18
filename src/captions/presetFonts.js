import {clearPresetLayouts} from './presetRenderer.js';
const pending=new Map();
export async function preparePresetFont(font,fonts=globalThis.document?.fonts){
 if(!fonts)return font;
 if(!pending.has(font))pending.set(font,(async()=>{
  let timer;
  try{
   await Promise.race([fonts.load('900 30px '+font),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('font timeout')),2500)})]);
   clearPresetLayouts();return font;
  }catch{return "Montserrat,'Arial Black',sans-serif"}
  finally{clearTimeout(timer)}
 })());
 return pending.get(font);
}

