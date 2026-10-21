import { definePreset } from './presetUtils.js';

const motion = { zoom: 0, hardCuts: false };
const noRules = [];
const make = config => definePreset({ motion, accentRules: noRules, stroke: .08, glow: .08, ...config });

export const PUNCH_WORD = make({
  id: 'punch_word', label: 'Punch Word', description: 'One centered word at a time, with optional per-word cyan or yellow emphasis.',
  guidance: 'Each word uses its recognized timestamp. Add emphasis words on the cue and choose cyan or yellow; entrance motion is optional and time-based.',
  buttonId: 'apply_punch_word', button: 'Apply Punch Word', minWords: 1, maxWords: 1,
  colors: { cyan: '#00E5FF', yellow: '#FFF000', red: '#FF3535', purple: '#A855F7', magenta: '#FF3AD4', white: '#FFFFFF' },
  defaults: { cf: "Montserrat,'Arial Black',sans-serif", csz: '22', cy: '53', chunk_size: '1', tc: '#FFFFFF', acc: '#00E5FF', sc_col: '#050505', sw: 'thick', preset_backing: false, preset_glow: false },
  uppercase: true, weight: 900, revealMode: 'single', emphasisMode: 'editorial', outlineRatio: .105, shadowStrength: .28, padding: 5,
  intro: 0, introScale: .96, entranceMs: 0
});

export const SPEAKER_DIALOGUE = make({
  id: 'speaker_dialogue', label: 'Speaker Dialogue', description: 'Mixed-case dialogue fragments with a speaker label and tight black backing.',
  guidance: 'Speaker names are optional annotations. Enter one only when supplied or confirmed; punctuation and supplied asterisks or ellipses are kept as written.',
  buttonId: 'apply_speaker_dialogue', button: 'Apply Speaker Dialogue', minWords: 1, maxWords: 5, labels: true,
  colors: { cyan: '#00E5FF', yellow: '#FFF000', red: '#D92D45', purple: '#A855F7', magenta: '#D92D45', white: '#FFFFFF' },
  defaults: { cf: "Arial,'Helvetica Neue',sans-serif", csz: '20', cy: '62', chunk_size: '4', tc: '#FFFFFF', acc: '#D92D45', sc_col: '#050505', sw: 'normal', preset_backing: true, preset_glow: false },
  uppercase: false, weight: 500, revealMode: 'phrase', emphasisMode: 'editorial', outlineRatio: .035, shadowStrength: .14, padding: 5,
  intro: 0, speakerColor: '#D92D45'
});

export const NEON_STORY_PHRASE = make({
  id: 'neon_story_phrase', label: 'Neon Story Phrase', description: 'Stable 3–5 word uppercase phrases with restrained editorial neon accents.',
  guidance: 'Editorial emphasis is the default. Active-word emphasis follows complete recognized word timestamps. Glow is limited to emphasized words.',
  buttonId: 'apply_neon_story_phrase', button: 'Apply Neon Story Phrase', minWords: 3, maxWords: 5,
  colors: { cyan: '#36F5DD', purple: '#A855F7', red: '#FF3535', yellow: '#FFF000', magenta: '#FF3AD4', white: '#FFFFFF' },
  defaults: { cf: "Montserrat,'Arial Black',sans-serif", csz: '16', cy: '62', chunk_size: '4', tc: '#FFFFFF', acc: '#A855F7', sc_col: '#08050D', sw: 'thick', preset_backing: false, preset_glow: true },
  uppercase: true, weight: 900, revealMode: 'phrase', emphasisMode: 'editorial', outlineRatio: .065, shadowStrength: .18, padding: 7,
  intro: .08, introScale: .97, entranceMs: 0, glowAccentsOnly: true
});

export const CONDENSED_PRESENTER = make({
  id: 'condensed_presenter', label: 'Condensed Presenter', description: 'Condensed uppercase phrases with a deterministic active-word backing.',
  guidance: 'The active word backing is part of the caption layer. This preset changes no footage framing, branding, banners, logos, or camera motion.',
  buttonId: 'apply_condensed_presenter', button: 'Apply Condensed Presenter', minWords: 3, maxWords: 6,
  colors: { cyan: '#00E5FF', yellow: '#FFF000', red: '#FF3535', purple: '#A855F7', magenta: '#FF3AD4', white: '#FFFFFF' },
  defaults: { cf: "'Bebas Neue','Arial Narrow',Impact,sans-serif", csz: '20', cy: '73', chunk_size: '5', tc: '#FFFFFF', acc: '#00E5FF', sc_col: '#050505', sw: 'thin', preset_backing: false, preset_glow: false },
  uppercase: true, weight: 900, revealMode: 'phrase', emphasisMode: 'active', outlineRatio: .035, shadowStrength: .18, padding: 7,
  intro: 0, activeWordBacking: true, backingRadius: 4
});

export const YELLOW_FOCUS = make({
  id: 'yellow_focus', label: 'Yellow Focus', description: 'A stationary 3–5 word phrase with only the active spoken word in yellow.',
  guidance: 'Active emphasis follows recognized word timestamps; previous words return to white. Captions without complete word timings stay hidden.',
  buttonId: 'apply_yellow_focus', button: 'Apply Yellow Focus', minWords: 3, maxWords: 5,
  colors: { cyan: '#00E5FF', yellow: '#FFF000', red: '#FF3535', purple: '#A855F7', magenta: '#FF3AD4', white: '#FFFFFF' },
  defaults: { cf: "Montserrat,'Arial Black',sans-serif", csz: '25', cy: '69', chunk_size: '4', tc: '#FFFFFF', acc: '#FFF000', sc_col: '#050505', sw: 'thick', preset_backing: false, preset_glow: false },
  uppercase: true, weight: 900, revealMode: 'phrase', emphasisMode: 'active', outlineRatio: .105, shadowStrength: .28, padding: 7,
  intro: 0, activePulse: false
});

export const SOFT_NEON_STORY = make({
  id: 'soft_neon_story', label: 'Soft Neon Story', description: 'Compact 2–4 word phrases with selective soft magenta or red glow.',
  guidance: 'Editorial emphasis is the default. Add emphasis words or switch to active-word mode to follow verified speech timing.',
  buttonId: 'apply_soft_neon_story', button: 'Apply Soft Neon Story', minWords: 2, maxWords: 4,
  colors: { cyan: '#36F5DD', yellow: '#FFF000', red: '#FF3535', purple: '#A855F7', magenta: '#FF3AD4', white: '#FFFFFF' },
  defaults: { cf: "Montserrat,'Arial Black',sans-serif", csz: '16', cy: '50', chunk_size: '3', tc: '#FFFFFF', acc: '#FF3AD4', sc_col: '#090509', sw: 'thin', preset_backing: false, preset_glow: true },
  uppercase: true, weight: 900, revealMode: 'phrase', emphasisMode: 'editorial', outlineRatio: .035, shadowStrength: .22, padding: 7,
  intro: 0, glowAccentsOnly: true
});

export const REFERENCE_STORY_PRESET = make({
  id: 'reference-story', label: 'Reference Story', description: 'The existing white phrase look with restrained editorial color emphasis.',
  guidance: 'The original Reference Story selection is preserved. Its wording and timestamps remain unchanged when other appearance presets are selected.',
  buttonId: 'apply_reference_story', button: 'Apply Reference Story', minWords: 1, maxWords: 6,
  colors: { cyan: '#36F5DD', yellow: '#FFF000', red: '#FF2828', purple: '#A855F7', magenta: '#FF00ED', white: '#FFFFFF', green: '#70FF00' },
  defaults: { cf: "Montserrat,'Arial Black',sans-serif", csz: '28', cy: '54', chunk_size: '8', tc: '#FFFFFF', acc: '#70FF00', sc_col: '#050505', sw: 'normal', preset_backing: false, preset_glow: false },
  uppercase: true, weight: 900, revealMode: 'phrase', emphasisMode: 'editorial', setupColor: 'green', outlineRatio: .06, shadowStrength: .16, padding: 7,
  intro: .08
});

export const SHORTS_PRESETS = Object.freeze([PUNCH_WORD, SPEAKER_DIALOGUE, NEON_STORY_PHRASE, CONDENSED_PRESENTER, YELLOW_FOCUS, SOFT_NEON_STORY]);
