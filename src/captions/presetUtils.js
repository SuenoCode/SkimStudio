export const BASE_DEFAULTS=Object.freeze({
 cf:"Montserrat,'Arial Black',sans-serif",csz:'30',cy:'54',cx_pos:'50',sw:'thick',tc:'#ffffff',acc:'#19d9ff',sc_col:'#050505',chunk_size:'4',cfade:'6',
 grade:'none',contrast:'1.10',saturation:'1.12',exposure:'0',caps_lock:true,cap:true,
 preset_motion:true,preset_glitch:false,preset_shake:false,preset_backing:false,preset_bw:false,preset_glow:true,preset_accent:'auto'
});
export const OWNED_KEYS=Object.freeze(Object.keys(BASE_DEFAULTS));
export const protectedShot=shot=>!!(shot&&(shot.lock||shot.manualFraming||shot.camera==='custom'));
export const normalizeToken=text=>String(text||'').normalize('NFKC').toLocaleLowerCase('en').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'');
export function presetColor(choice,colors,fallback){return colors[choice]||(/^#[0-9a-f]{6}$/i.test(choice||'')?choice:fallback)}
export function definePreset(config){return deepFreeze({...config,serialization:{version:1,id:config.id},defaults:{...BASE_DEFAULTS,...config.defaults}})}
function deepFreeze(value){for(const item of Object.values(value))if(item&&typeof item==='object')deepFreeze(item);return Object.freeze(value)}
export function validatePreset(config){
 if(!/^[a-z][a-z0-9_-]+$/.test(config.id)||!config.label||!config.description||!config.guidance)throw new Error('Preset identity/description is missing.');
 if(config.serialization?.id!==config.id||config.serialization?.version!==1)throw new Error('Invalid preset serialization.');
 if(!Number.isInteger(config.maxWords)||config.maxWords<1||config.maxWords>6||!Number.isInteger(config.minWords)||config.minWords<1||config.minWords>config.maxWords)throw new Error('Invalid caption grouping.');
 if(!config.motion||config.motion.zoom<0||config.motion.zoom>.15||!Array.isArray(config.accentRules))throw new Error('Invalid motion or accent rules.');
 for(const key of OWNED_KEYS)if(!(key in config.defaults)||typeof config.defaults[key]!==typeof BASE_DEFAULTS[key])throw new Error('Invalid preset default: '+key);
 for(const rule of config.accentRules)if(!Array.isArray(rule.words)||!config.colors[rule.color])throw new Error('Invalid accent rule.');
 return config;
}
export function applyPresetConfig(args,config){return args.controller.apply(config)}
export function presetMotion(config,framing,elapsed,duration,segment,enabled=true){
 if(!config||!enabled||protectedShot(segment))return framing;
 const p=Math.max(0,Math.min(1,elapsed/Math.max(.01,duration))),ease=p*p*(3-2*p);
 return {...framing,fz:framing.fz*(1+config.motion.zoom*ease)};
}

