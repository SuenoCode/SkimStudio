export function installReferenceControls({$,checkpoint,getClip,changed,setStatus}){
  const refresh=()=>{
    const select=$('reference_cue'),current=select.value;select.replaceChildren();
    (getClip()?.cues||[]).forEach((cue,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=`${cue.s.toFixed(2)}s · ${cue.t}`;select.append(option)});
    if([...select.options].some(option=>option.value===current))select.value=current;
    const cue=getClip()?.cues[Number(select.value)];$('reference_emphasis').value=cue?.refEmphasis||'';$('reference_cue_accent').value=cue?.refAccent||'auto';
  };
  $('reference_cue').onchange=refresh;
  $('reference_apply_emphasis').onclick=()=>{
    const clip=getClip(),cue=clip?.cues[Number($('reference_cue').value)];if(!cue){setStatus('Generate or import captions first.');return}
    checkpoint();cue.refEmphasis=$('reference_emphasis').value.trim();cue.refAccent=$('reference_cue_accent').value;clip.cuesEdited=true;clip.storyCues=null;changed();setStatus('Caption emphasis updated. Its spoken timestamps are unchanged.');
  };
  $('apply_reference').onclick=()=>{
    checkpoint();
    const values={cs:'reference',cf:"Montserrat,'Arial Black',sans-serif",csz:'28',cy:'54',cx_pos:'50',sw:'thin',tc:'#ffffff',acc:'#70ff00',chunk_size:'8',cfade:'8',reference_words:'8',reference_intro:'80',reference_reveal:'line',reference_accent:'auto',st_tr:'cut',grade:'none',contrast:'1.08',saturation:'1.12',exposure:'0'};
    for(const [id,value] of Object.entries(values))if($(id))$(id).value=value;
    for(const id of ['caps_lock','cap','reference_motion'])$(id).checked=true;
    for(const id of ['zoom','vig','bar','grain','glow','ov_emo','ov_kw','ov_shk','ov_gl','ov_spd','ov_arrow','ov_burst','ov_stamp','ov_lower'])if($(id))$(id).checked=false;
    $('csz_val').textContent='28px';$('cy_val').textContent='54%';$('cx_val').textContent='50%';$('cfade_val').textContent='80 ms';
    const clip=getClip();for(const shot of clip?.edl||[])if(!shot.lock&&!shot.manualFraming&&shot.camera!=='custom'){shot.camera='wide';shot.z=1.05;shot.tr={type:'cut',d:0};shot.cut=1;}
    changed();refresh();
    document.fonts?.load('900 28px Montserrat').then(()=>changed()).catch(()=>{});
    setStatus('Reference look applied: white/accent phrase captions, smooth push-ins, clean cuts. Locked and manually framed shots were preserved.');
  };
  for(const id of ['reference_accent','reference_words','reference_reveal','reference_intro','reference_motion'])$(id).addEventListener('input',changed);
  return refresh;
}
