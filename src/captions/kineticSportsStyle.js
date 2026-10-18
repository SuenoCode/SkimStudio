import {definePreset,applyPresetConfig} from './presetUtils.js';
export const KINETIC_SPORTS_UPSET=definePreset({
 id:'kinetic-sports-upset',label:'Kinetic Sports Upset',
 description:'Sports narration: white setup, cyan action, lime setup accents and red setbacks.',
 guidance:'Manually choose the strongest action for the first 0.5 seconds, alternate action and reactions, and finish on a decisive moment. Apply preserves shot order and timing.',
 buttonId:'apply_sports_upset',button:'Apply Sports Upset',minWords:1,maxWords:4,
 motion:{zoom:.035,hardCuts:true},intro:.06,stroke:.10,glow:.12,
 colors:{cyan:'#19d9ff',blue:'#19d9ff',green:'#a6ff00',lime:'#a6ff00',red:'#ff3030',magenta:'#ff49d7'},
 accentRules:[
  {color:'red',words:['lose','lost','defeat','defeated','danger','hurt','pain','crash','failed','fail','shock','shocking']},
  {color:'cyan',words:['win','won','winner','goal','lead','overtake','pass','attack','clutch','race','finish','turning','point','action']},
  {color:'lime',words:['before','first','ready','start','only','almost']}
 ],
 defaults:{csz:'30',cy:'54',chunk_size:'4',contrast:'1.10',saturation:'1.12'}
});
export function applyKineticSportsUpset(args){return applyPresetConfig(args,KINETIC_SPORTS_UPSET)}

