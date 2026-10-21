import {KINETIC_SPORTS_UPSET} from './kineticSportsStyle.js';
import {STREAMER_FLASHBANG_MEME} from './streamerMemeStyle.js';
import {DIALOGUE_MEME_CAPTION} from './dialogueMemeStyle.js';
import {SHORTS_PRESETS,REFERENCE_STORY_PRESET} from './shortsPresetCollection.js';
import {validatePreset,OWNED_KEYS} from './presetUtils.js';
export const LEGACY_STYLES=Object.freeze(['reference','shorts','pop','pill','bold','progressive','karaoke']);
export const PRESETS=Object.freeze([KINETIC_SPORTS_UPSET,STREAMER_FLASHBANG_MEME,DIALOGUE_MEME_CAPTION,REFERENCE_STORY_PRESET,...SHORTS_PRESETS]);
const registry=new Map();
for(const config of PRESETS){validatePreset(config);if(registry.has(config.id)||LEGACY_STYLES.includes(config.id))throw new Error('Duplicate preset ID');registry.set(config.id,config)}
export const getPreset=id=>registry.get(id)||null;
export const safeStyle=id=>getPreset(id)||LEGACY_STYLES.includes(id)?id:'reference';
// Optional schema inside project v1; old tools still read settings.cs.
export function migratePresetData(project){
 const settings={...(project.settings||{})},requested=settings.cs||project.captionPreset||'reference',id=safeStyle(requested),config=getPreset(id);
 settings.cs=id;
 if(config)for(const [key,value] of Object.entries(config.defaults))if(settings[key]===undefined)settings[key]=value;
 const state=project.presetState;
 const allowed=object=>Object.fromEntries(Object.entries(object||{}).filter(([key,value])=>OWNED_KEYS.includes(key)&&['string','boolean','number'].includes(typeof value)));
 // Without ownership metadata, saved settings are conservatively user-owned.
 const manual=state?.version===1?allowed(state.manual):allowed(project.settings);
 return {...project,settings,captionPreset:id,presetState:{version:1,manual,baseline:allowed(state?.baseline),owned:allowed(state?.owned)},
 ...(requested!==id?{presetWarning:'Unknown caption style “'+requested+'”; using Reference Story. Other saved settings retained.'}:{})};
}

