import {PRESETS,getPreset,safeStyle} from './presetRegistry.js';
import {createPresetController} from './presetController.js';
import {BASE_DEFAULTS} from './presetUtils.js';
import {preparePresetFont} from './presetFonts.js';
import {measuredWords} from './timing.js';

export function installPresetControls({$,checkpoint,changed,setStatus,getClip,isBusy}){
 let panel=document.querySelector('.preset-style-panel');
 if(!panel){panel=document.createElement('section');panel.className='sec preset-style-panel';$('tab_captions').prepend(panel)}
 panel.setAttribute('aria-label','Reusable editing presets');
 panel.innerHTML='<div class="sec-title">Reusable editing presets</div><div class="preset-cards"></div><p class="reference-note">Apply affects preview and export. Manual settings are kept; Undo restores the previous look. Shot order, timing and audio stay under your control.</p><p id="preset_guidance" class="reference-note"></p><div id="preset_options"></div><p id="preset_manual" class="reference-note" role="status"></p><details><summary>Speaker and emphasis for one caption</summary><label for="preset_cue">Caption</label><select id="preset_cue"></select><label for="preset_speaker">Speaker label (Dialogue only)</label><input id="preset_speaker" maxlength="80" placeholder="FAN or CELEBRITY"><label for="preset_emphasis">Emphasis words</label><input id="preset_emphasis" placeholder="Words already in this caption"><label for="preset_cue_accent">Emphasis color</label><select id="preset_cue_accent"><option value="auto">Automatic</option><option value="green">Green / main subject</option><option value="cyan">Cyan / action</option><option value="red">Red / punchline</option><option value="magenta">Magenta</option></select><button id="preset_apply_cue" class="g sm" type="button">Apply to this caption</button><p class="reference-note">Labels are annotations, not spoken words. Red emphasis also marks this cue for optional B&amp;W. No visual event detection is used.</p></details>';
 for(const config of PRESETS){
  if(!$('cs').querySelector('option[value="'+config.id+'"]')){const opt=new Option(config.label,config.id);$('cs').append(opt)}
  const card=document.createElement('div');card.className='preset-card';
  const title=document.createElement('strong');title.textContent=config.label;
  const description=document.createElement('p');description.className='reference-note';description.id=config.id+'-description';description.textContent=config.description;
  const button=document.createElement('button');button.id=config.buttonId;button.type='button';button.className='g sm';button.textContent=config.button;button.title=config.description;button.setAttribute('aria-describedby',description.id);button.setAttribute('aria-pressed','false');
  card.append(title,description,button);panel.querySelector('.preset-cards').append(card);
 }
 for(const [id,label,tip] of [
  ['preset_motion','Shot motion','Gentle zoom on unlocked, non-manually-framed shots.'],
  ['preset_glitch','Glitch on cuts','Short digital bars at existing shot boundaries.'],
  ['preset_shake','Short shake','Deterministic shake at existing shot boundaries.'],
  ['preset_backing','Black caption backing','Resizes around the complete caption group and speaker label.'],
  ['preset_bw','B&W on red cues','Applies only during speech in manually marked red cues.'],
  ['preset_glow','Caption glow','Glow around letters; does not alter the footage.']
 ]){
  const wrapper=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.id=id;input.checked=BASE_DEFAULTS[id];input.title=tip;wrapper.append(input,document.createTextNode(' '+label));$('preset_options').append(wrapper);
 }
 const accent=document.createElement('label');accent.textContent='Preset accent ';
 const select=document.createElement('select');select.id='preset_accent';
 for(const [id,label]of [['auto','By wording'],['green','Green'],['cyan','Cyan'],['red','Red'],['magenta','Magenta']])select.add(new Option(label,id));
 accent.append(select);$('preset_options').append(accent);
 for(const value of ['1','6'])if(![...$('chunk_size').options].some(o=>o.value===value))$('chunk_size').add(new Option(value+' words',value));
 const read=id=>{const el=$(id);return el?.type==='checkbox'?el.checked:el?.value};
 const write=(id,value)=>{const el=$(id);if(!el)throw new Error('Missing control: '+id);if(el.type==='checkbox')el.checked=!!value;else el.value=String(value??'')};
 const refresh=()=>{
  const config=getPreset($('cs').value);
  for(const c of PRESETS)$(c.buttonId).setAttribute('aria-pressed',String(config===c));
  $('preset_guidance').textContent=config?.guidance||'Choose a preset above. Reference Story and other caption styles keep their own rendering controls.';
  $('preset_options').hidden=!config;
  const untimed=(getClip()?.cues||[]).filter(cue=>!measuredWords(cue).length).length;
  $('preset_manual').textContent=Object.keys(controller.snapshot().manual).length+' manual settings protected. Change a setting directly to keep it across preset changes.'+(config&&untimed?' '+untimed+' captions need complete word timing: import word timestamps or sync speech. Untimed captions stay hidden.':'');
  for(const [id,target,suffix,multiplier]of [['csz','csz_val','px',1],['cy','cy_val','%',1],['cx_pos','cx_val','%',1],['cfade','cfade_val',' ms',10]])if($(target))$(target).textContent=Number($(id).value)*multiplier+suffix;
 };
 const controller=createPresetController({read,write,checkpoint,setStatus,changed:()=>{lastStyle=$('cs').value;refresh();changed();const requested=$('cf').value;preparePresetFont(requested).then(font=>{if(font!==requested&&$('cf').value===requested&&getPreset($('cs').value)){setStatus('Selected font unavailable; using a local fallback.');$('cf').value=font}changed()})}});
 for(const config of PRESETS)$(config.buttonId).onclick=()=>{if(isBusy()){setStatus('Stop playback or wait for the current operation before applying a preset.');return}controller.apply(config)};
 let lastStyle=$('cs').value;
 $('cs').addEventListener('change',()=>{
  const requested=$('cs').value,config=getPreset(requested);
  if(isBusy()){$('cs').value=lastStyle;return}
  if(config){$('cs').value=lastStyle;controller.apply(config)}else{controller.release();$('cs').value=safeStyle(requested);refresh();changed()}
  lastStyle=$('cs').value;
 });
 $('apply_reference').addEventListener('click',()=>{controller.release();lastStyle='reference';refresh()},true);
 document.addEventListener('input',event=>{controller.markManual(event.target.id);refresh()});
 document.addEventListener('change',event=>{controller.markManual(event.target.id);lastStyle=$('cs').value;refresh()});
 function refreshCues(){
  const select=$('preset_cue'),current=select.value;select.replaceChildren();
  for(const [index,cue]of (getClip()?.cues||[]).entries())select.add(new Option(cue.s.toFixed(2)+'s · '+cue.t.slice(0,100),String(index)));
  if([...select.options].some(o=>o.value===current))select.value=current;
  fillCue();
 }
 function fillCue(){const cue=getClip()?.cues[Number($('preset_cue').value)];$('preset_speaker').value=cue?.presetSpeaker||'';$('preset_emphasis').value=cue?.presetEmphasis||'';$('preset_cue_accent').value=cue?.presetAccent||'auto'}
 $('preset_cue').onchange=fillCue;
 $('preset_apply_cue').onclick=()=>{
  if(isBusy())return;
  const clip=getClip(),cue=clip?.cues[Number($('preset_cue').value)];
  if(!cue){setStatus('Import or generate captions before editing emphasis.');return}
  checkpoint();Object.assign(cue,{presetSpeaker:$('preset_speaker').value.trim(),presetEmphasis:$('preset_emphasis').value.trim(),presetAccent:$('preset_cue_accent').value});
  clip.cuesEdited=true;changed();setStatus('Speaker and emphasis updated for preview and export. Spoken text and timing preserved.');
 };
 refresh();
 return {controller,refresh:()=>{lastStyle=$('cs').value;refresh()},refreshCues};
}

