import {definePreset,applyPresetConfig} from './presetUtils.js';
export const DIALOGUE_MEME_CAPTION=definePreset({
 id:'dialogue-meme-caption',label:'Dialogue Meme Caption',
 description:'White dialogue on black backing, magenta speaker labels and green/red manual emphasis.',
 guidance:'Start with the setup. Add speaker labels below without changing spoken text or word timings. Choose reaction close-ups and short pauses manually; use red punchline emphasis and optional B&W for the payoff.',
 buttonId:'apply_dialogue_meme',button:'Apply Dialogue Meme',minWords:2,maxWords:6,
 motion:{zoom:.025,hardCuts:true},intro:.08,stroke:.065,glow:.04,labels:true,
 colors:{cyan:'#13e7ff',green:'#69f26b',lime:'#69f26b',red:'#ff3030',magenta:'#ff49d7',pink:'#ff49d7'},
 accentRules:[{color:'red',words:['awkward','oops','uh','um','wait','what','sorry']}],
 defaults:{csz:'27',cy:'62',chunk_size:'6',cfade:'8',sw:'normal',acc:'#69f26b',contrast:'1.05',saturation:'1.04',preset_backing:true,preset_glow:false}
});
export function applyDialogueMemeCaption(args){return applyPresetConfig(args,DIALOGUE_MEME_CAPTION)}

