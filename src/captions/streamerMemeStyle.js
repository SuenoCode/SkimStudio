import {definePreset,applyPresetConfig} from './presetUtils.js';
export const STREAMER_FLASHBANG_MEME=definePreset({
 id:'streamer-flashbang-meme',label:'Streamer Flashbang Meme',
 description:'Condensed lime punchlines, cyan technology words, red failures, brief digital glitch and shake.',
 guidance:'Choose the opening reaction and alternate existing gameplay/webcam shots manually. Use red cue emphasis for optional B&W. Add short hit, ding or scratch events with existing SFX controls; Apply creates no sounds or inserts.',
 buttonId:'apply_streamer_flashbang',button:'Apply Streamer Flashbang',minWords:1,maxWords:3,
 motion:{zoom:.055,hardCuts:true},intro:.04,stroke:.14,glow:.22,setupColor:'lime',
 colors:{cyan:'#13e7ff',blue:'#13e7ff',green:'#a8ff12',lime:'#a8ff12',red:'#ff2848',magenta:'#ff49d7'},
 accentRules:[
  {color:'red',words:['fail','failed','dead','death','wrong','no','way','bruh','rip','shock','shocked']},
  {color:'cyan',words:['flash','glitch','lag','ping','buffer','error','loading','game','gaming','tech','click','screen']}
 ],
 defaults:{cf:'Impact,Haettenschweiler,sans-serif',csz:'29',cy:'50',chunk_size:'3',cfade:'4',contrast:'1.12',saturation:'1.15',preset_glitch:true,preset_shake:true}
});
export function applyStreamerFlashbangMeme(args){return applyPresetConfig(args,STREAMER_FLASHBANG_MEME)}

