import { validateCues, validateTimeline, validateWords } from './validation.js';
export const PROJECT_VERSION = 1;
export function readProject(value) {
  if (!value || value.version !== PROJECT_VERSION || !Array.isArray(value.clips) || value.clips.length > 100) throw new Error('Unsupported project version or invalid media list.');
  if (typeof value.script !== 'string' || value.script.length > 200000) throw new Error('Invalid project script.');
  const ids = new Set();
  for (const asset of value.clips) {
    if (!asset || typeof asset.id !== 'string' || ids.has(asset.id) || typeof asset.name !== 'string' || !Array.isArray(asset.edl) || !Array.isArray(asset.fx)) throw new Error('Invalid or duplicate media reference.');
    ids.add(asset.id);
    if (!Number.isFinite(asset.metadata?.duration) || asset.metadata.duration <= 0) throw new Error('Invalid media duration.');
    validateCues(asset.cues);
    if(asset.wordAlignment){validateWords(asset.wordAlignment.words,asset.narration?.dur??Infinity);if(!['imported','whisper'].includes(asset.wordAlignment.source))throw new Error('Invalid saved word-alignment source.');}
    if (asset.fx.some(f => !Number.isFinite(f.t) || f.t < 0 || !['whoosh','hit','ding','pop','scratch','riser'].includes(f.k))) throw new Error('Invalid sound event.');
  }
  const sources = value.clips.map(c => ({ ...c, videoEl: {duration:c.metadata.duration} }));
  for (const source of sources) validateTimeline(source.edl, sources, source);
  return value;
}
