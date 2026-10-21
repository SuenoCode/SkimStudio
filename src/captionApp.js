import './core/structuredCloneCompat.js';
import '@fontsource/montserrat/latin-900.css';
import '@fontsource/bebas-neue/latin-400.css';
import './styles/caption-app.css';
import { alignedCues } from './captions/alignedCues.js';
import { getPreset } from './captions/presetRegistry.js';
import { REFERENCE_STORY_PRESET, SHORTS_PRESETS } from './captions/shortsPresetCollection.js';
import { measuredWords } from './captions/timing.js';
import { validateCues } from './core/validation.js';
import { exportConfig, verifyExport } from './export/capabilities.js';
import Mp4Muxer from './vendor/mp4-muxer.js';
import { seekFrame } from './media/decoder.js';
import { renderPresetCaption, clearPresetLayouts } from './captions/presetRenderer.js';

const $ = id => document.getElementById(id);
const videoInput = $('video-file'), audioInput = $('audio-file'), scriptInput = $('script');
const video = $('video-preview'), audio = $('audio-preview'), canvas = $('caption-canvas'), ctx = canvas.getContext('2d');
let videoUrl = null, audioUrl = null, videoFile = null, audioFile = null, cues = [], selectedPreset = 'streamer-flashbang-meme';
let worker = null, recorder = null, exportTimer = null, fontName = '', cancelRecognition = null;
let userCancelled = false;
let captionX = 50, captionY = 54, captionSize = 30;
let presetOverrides = {};
let currentProject = null, saveTimer = null;
const objectUrls = new Set();

const projectDb = new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) { reject(new Error('Project storage is not available.')); return; }
  const request = indexedDB.open('skimstudio-caption-projects', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function projectDbCall(method, value) {
  const db = await projectDb;
  return new Promise((resolve, reject) => {
    const request = db.transaction('projects', 'readwrite').objectStore('projects')[method](value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
function editedLabel(timestamp) {
  const age = Math.max(0, Date.now() - Number(timestamp || Date.now()));
  if (age < 60000) return 'Edited just now';
  if (age < 3600000) return `Edited ${Math.floor(age / 60000)} min ago`;
  if (age < 86400000) return `Edited ${Math.floor(age / 3600000)} hr ago`;
  return `Edited ${Math.floor(age / 86400000)} days ago`;
}
async function renderProjects() {
  let projects = [];
  try { projects = (await projectDbCall('getAll')).sort((a, b) => b.updatedAt - a.updatedAt); } catch { /* allow the editor to work if storage is unavailable */ }
  const query = $('project-search').value.trim().toLowerCase();
  $('project-count').textContent = String(projects.length).padStart(2, '0');
  const matches = projects.filter(project => project.name.toLowerCase().includes(query));
  const cards = matches.slice(0, 8).map((project, index) => `<button class="project-card glass" type="button" data-open-project="${escapeHtml(project.id)}"><div class="project-image image-${index % 3}">${project.poster ? `<img src="${project.poster}" alt="">` : '<div class="project-placeholder"></div>'}<span class="project-duration">${project.videoName ? 'VIDEO' : 'NEW PROJECT'}</span><div class="snapshot-copy">${escapeHtml((project.script || 'Your next story').split(/\s+/).slice(0, 5).join(' '))}</div><span class="project-open">↗</span></div><div class="project-info"><div><h3>${escapeHtml(project.name)}</h3><p>${editedLabel(project.updatedAt)}<span>·</span>9:16</p></div><span class="status-dot"></span></div></button>`);
  cards.push('<button class="new-project-card" id="new-project-card" type="button"><span class="new-plus">＋</span><span><h3>A fresh canvas</h3><p>Start a new caption project</p></span></button>');
  $('project-grid').innerHTML = cards.join('');
  $('project-grid').querySelectorAll('[data-open-project]').forEach(card => card.addEventListener('click', () => openProject(card.dataset.openProject)));
  $('new-project-card').addEventListener('click', showCreateProject);
}
function showCreateProject() {
  $('project-name').value = '';
  $('project-modal').hidden = false;
  requestAnimationFrame(() => $('project-name').focus());
}
function showEditor() {
  $('home-screen').hidden = true;
  $('editor-screen').hidden = false;
  $('current-project-title').textContent = currentProject?.name || 'Caption your story.';
  window.scrollTo(0, 0);
}
async function showHome() {
  clearTimeout(saveTimer);
  await saveProject();
  video.pause(); audio.pause();
  $('editor-screen').hidden = true;
  $('home-screen').hidden = false;
  window.scrollTo(0, 0);
  await renderProjects();
}
function resetEditor() {
  clearObjectUrl(videoUrl); clearObjectUrl(audioUrl);
  videoUrl = audioUrl = null; videoFile = audioFile = null; cues = []; fontName = '';
  video.removeAttribute('src'); audio.removeAttribute('src'); video.load(); audio.load();
  videoInput.value = ''; audioInput.value = ''; $('font-file').value = '';
  scriptInput.value = ''; $('video-file-name').textContent = 'Import video'; $('audio-file-name').textContent = 'Narration audio';
  $('font-choice').selectedIndex = 0; $('caption-source').value = 'script';
  selectedPreset = 'streamer-flashbang-meme'; presetOverrides = {}; $('preset-choice').value = selectedPreset;
  captionX = 50; captionY = 54; captionSize = 30; updatePresetControls(); updateCueOverrideControls(); updateCounts();
  setStatus('Add your video, narration, and script to get started.');
}
async function createProject() {
  currentProject = { id: crypto.randomUUID(), name: $('project-name').value.trim() || 'Untitled project', updatedAt: Date.now(), cues: [] };
  resetEditor();
  $('project-modal').hidden = true;
  showEditor();
  await saveProject();
}
async function openProject(id) {
  try {
    const record = await projectDbCall('get', id);
    if (!record) return;
    currentProject = record; resetEditor();
    if (record.videoBlob) {
      videoFile = record.videoBlob; videoUrl = URL.createObjectURL(videoFile); objectUrls.add(videoUrl);
      video.src = videoUrl; video.load(); video.loop = true; video.muted = true;
      $('video-file-name').textContent = record.videoName || 'Imported video';
    }
    if (record.audioBlob) {
      audioFile = record.audioBlob; audioUrl = URL.createObjectURL(audioFile); objectUrls.add(audioUrl);
      audio.src = audioUrl; audio.load(); $('audio-file-name').textContent = record.audioName || 'Narration audio';
    }
    scriptInput.value = record.script || ''; cues = record.cues || [];
    selectedPreset = getPreset(record.preset)?.id || (record.preset === 'reference' ? 'reference' : 'streamer-flashbang-meme');
    presetOverrides = record.presetVersion === 1 && record.presetOverrides && typeof record.presetOverrides === 'object'
      ? { ...record.presetOverrides }
      : Object.fromEntries(Object.entries({ x: record.captionX, y: record.captionY, size: record.captionSize, font: record.fontChoice }).filter(([, value]) => value !== undefined && value !== null && value !== ''));
    $('preset-choice').value = selectedPreset;
    captionX = Number(record.captionX) || 50; captionY = Number(record.captionY) || 54; captionSize = Number(record.captionSize) || 30;
    $('caption-source').value = record.captionSource || 'script';
    if (record.fontChoice) $('font-choice').value = record.fontChoice;
    if (record.fontBlob && record.fontFileName) {
      const family = `UserFont${Date.now()}`, fontUrl = URL.createObjectURL(record.fontBlob); objectUrls.add(fontUrl);
      const face = new FontFace(family, `url(${fontUrl})`); await face.load(); document.fonts.add(face); fontName = family;
      $('font-choice').add(new Option(record.fontFileName, `"${family}"`)); $('font-choice').value = `"${family}"`;
    }
    updatePresetControls(); updateCueOverrideControls(); updateCounts(); drawPreview();
    $('preview-empty').hidden = Boolean(videoFile);
    $('current-project-title').textContent = currentProject.name;
    showEditor();
  } catch (error) { setStatus(`Could not open project: ${error.message}`, true); }
}
async function saveProject() {
  if (!currentProject) return;
  let poster = currentProject.poster || '';
  if (!poster && video.readyState >= 2) {
    try { const thumb = document.createElement('canvas'); thumb.width = 320; thumb.height = 568; thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height); poster = thumb.toDataURL('image/jpeg', .68); } catch { /* retain the gradient thumbnail */ }
  }
  currentProject = {
    ...currentProject, updatedAt: Date.now(), script: scriptInput.value,
    videoBlob: videoFile || null, videoName: videoFile?.name || currentProject.videoName || '',
    audioBlob: audioFile || null, audioName: audioFile?.name || currentProject.audioName || '',
    cues, preset: selectedPreset, presetId: selectedPreset, presetVersion: 1, presetOverrides: { ...presetOverrides }, captionX, captionY, captionSize,
    captionSource: $('caption-source').value, fontChoice: $('font-choice').value,
    fontBlob: currentProject.fontBlob || null, fontFileName: currentProject.fontFileName || '', poster
  };
  try { await projectDbCall('put', currentProject); if (!$('home-screen').hidden) renderProjects(); }
  catch (error) { setStatus(`Project could not be saved: ${error.message}`, true); }
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveProject(), 450); }

$('create-project').addEventListener('click', showCreateProject);
$('confirm-create-project').addEventListener('click', createProject);
$('cancel-create-project').addEventListener('click', () => { $('project-modal').hidden = true; });
$('project-modal').addEventListener('click', event => { if (event.target === $('project-modal')) $('project-modal').hidden = true; });
$('project-name').addEventListener('keydown', event => { if (event.key === 'Enter') createProject(); });
$('project-search').addEventListener('input', renderProjects);
$('home-link').addEventListener('click', event => { event.preventDefault(); showHome(); });
$('back-home').addEventListener('click', showHome);

function setStatus(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function showProgress(title, detail, cancelAction) {
  $('progress-title').textContent = title; $('progress-detail').textContent = detail;
  $('progress-bar').removeAttribute('value'); $('progress-overlay').hidden = false;
  $('cancel-task').onclick = cancelAction || (() => {}); $('cancel-task').hidden = typeof cancelAction !== 'function';
}
function hideProgress() { $('progress-overlay').hidden = true; $('cancel-task').hidden = false; }
function invalidateCaptions() {
  if (worker) { userCancelled = true; worker.terminate(); worker = null; cancelRecognition?.(new Error('Inputs changed during recognition.')); }
  cues = []; updateCounts(); drawPreview();
}
function updateCounts() {
  $('caption-count').textContent = cues.length ? `${cues.length} caption${cues.length === 1 ? '' : 's'}` : 'No captions yet';
  const mediaReady = video.readyState >= 2 && audio.readyState >= 2;
  $('play-preview').disabled = !(videoFile && audioFile && mediaReady);
  $('export-video').disabled = !(videoFile && audioFile && mediaReady && cues.length);
}
function clearObjectUrl(value) { if (value) { URL.revokeObjectURL(value); objectUrls.delete(value); } }

videoInput.addEventListener('change', () => {
  const file = videoInput.files?.[0]; if (!file) return;
  clearObjectUrl(videoUrl); videoFile = file; videoUrl = URL.createObjectURL(file); objectUrls.add(videoUrl);
  video.src = videoUrl; video.load(); $('video-file-name').textContent = file.name; $('preview-empty').hidden = true;
  video.loop = true; video.muted = true; invalidateCaptions(); updateCounts(); setStatus('Video ready. Add narration and your script.'); drawPreview();
  scheduleSave();
});

audioInput.addEventListener('change', () => {
  const file = audioInput.files?.[0]; if (!file) return;
  clearObjectUrl(audioUrl); audioFile = file; audioUrl = URL.createObjectURL(file); objectUrls.add(audioUrl);
  audio.src = audioUrl; audio.load(); $('audio-file-name').textContent = file.name; invalidateCaptions();
  setStatus('Narration ready. Add your script, then generate auto-captions.'); updateCounts();
  scheduleSave();
});

function captionPreset(id = selectedPreset) { return id === 'reference' ? REFERENCE_STORY_PRESET : getPreset(id); }
function defaultStyle(config = captionPreset()) {
  const d = config?.defaults || {};
  return {
    font: d.cf || 'Montserrat, Arial, sans-serif', size: Number(d.csz) || 28,
    x: Number(d.cx_pos) || 50, y: Number(d.cy) || 54, maxWords: Number(d.chunk_size) || config?.maxWords || 4,
    maxLines: 2, revealMode: config?.revealMode || 'progressive',
    emphasisMode: config?.emphasisMode || 'editorial', baseColor: d.tc || '#ffffff',
    accentColor: d.acc || '#00e5ff', speakerColor: config?.speakerColor || config?.colors?.red || '#D92D45', outlineColor: d.sc_col || '#050505', outlineWidth: Math.round((config?.outlineRatio ?? config?.stroke ?? .065) * 100),
    shadowStrength: Math.round((config?.shadowStrength ?? .16) * 100), glowStrength: Math.round((config?.glow ?? .08) * 100),
    entranceDuration: Number(config?.entranceMs ?? (config?.intro || 0) * 1000), entranceScale: Math.round((config?.introScale || .96) * 100), exitDuration: Number(config?.exitMs) || 0,
    safeMargin: 24, activeBacking: !!config?.activeWordBacking, activePulse: !!config?.activePulse
  };
}
function styleValues(config = captionPreset()) { return { ...defaultStyle(config), ...presetOverrides }; }
function setControl(id, value) { const control = $(id); if (control) control.value = String(value); }
function updatePresetControls() {
  const values = styleValues();
  captionX = values.x; captionY = values.y; captionSize = values.size;
  setControl('caption-x', values.x); setControl('caption-y', values.y); setControl('caption-size', values.size);
  setControl('caption-max-words', values.maxWords); setControl('caption-max-lines', values.maxLines);
  setControl('caption-reveal', values.revealMode); setControl('caption-emphasis-mode', values.emphasisMode);
  setControl('caption-base-color', values.baseColor); setControl('caption-accent-color', values.accentColor); setControl('caption-speaker-color', values.speakerColor); setControl('caption-outline-color', values.outlineColor);
  setControl('caption-outline-width', values.outlineWidth); setControl('caption-shadow-strength', values.shadowStrength); setControl('caption-glow-strength', values.glowStrength);
  setControl('caption-entrance-duration', values.entranceDuration); setControl('caption-entrance-scale', values.entranceScale); setControl('caption-safe-margin', values.safeMargin);
  setControl('caption-exit-duration', values.exitDuration);
  $('caption-active-backing').checked = !!values.activeBacking; $('caption-active-pulse').checked = !!values.activePulse;
  const font = $('font-choice');
  if (![...font.options].some(option => option.value === values.font)) font.add(new Option('Preset font', values.font));
  font.value = values.font;
  $('caption-x-value').textContent = `${values.x}%`; $('caption-y-value').textContent = `${values.y}%`;
  $('caption-size-value').textContent = `${(values.size / 360 * 100).toFixed(1)}% · ${values.size} px`;
  $('caption-outline-value').textContent = `${values.outlineWidth}%`; $('caption-shadow-value').textContent = `${values.shadowStrength}%`; $('caption-glow-value').textContent = `${values.glowStrength}%`;
  $('caption-entrance-value').textContent = `${values.entranceDuration} ms`; $('caption-entrance-scale-value').textContent = `${values.entranceScale}%`; $('caption-safe-margin-value').textContent = `${values.safeMargin} px`;
  $('caption-exit-value').textContent = `${values.exitDuration} ms`;
  const preset = captionPreset();
  document.querySelectorAll('[data-short-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.shortPreset === selectedPreset)));
  $('font-fallback-notice').hidden = true;
  if (preset) checkFontAvailability(values.font, values.font.split(',')[0].replace(/['"]/g, '').trim());
  clearPresetLayouts(); drawPreview(); scheduleSave();
}
function checkFontAvailability(font, label) {
  const family = font.split(',')[0].replace(/['"]/g, '').trim();
  requestAnimationFrame(() => {
    if ($('font-choice').value === font && document.fonts && !document.fonts.check(`700 24px "${family}"`)) {
      $('font-fallback-notice').textContent = `${label} did not load. The browser is using its listed condensed fallback; import a font file to choose a replacement.`;
      $('font-fallback-notice').hidden = false;
    }
  });
}
function renderPresetCards() {
  const all = [REFERENCE_STORY_PRESET, ...SHORTS_PRESETS];
  $('preset-preview-cards').innerHTML = all.map(config => `<button type="button" class="preset-preview-card" data-short-preset="${config.id === 'reference-story' ? 'reference' : config.id}" aria-pressed="false" title="${escapeHtml(config.description)}"><span class="preset-swatch" style="--preset-accent:${config.defaults.acc};--preset-base:${config.defaults.tc}">Aa</span><strong>${escapeHtml(config.label)}</strong><small>${escapeHtml(config.description)}</small></button>`).join('');
  $('preset-preview-cards').querySelectorAll('[data-short-preset]').forEach(button => button.addEventListener('click', () => selectPreset(button.dataset.shortPreset)));
}
function selectPreset(presetId, resetOverrides = true) {
  if (!captionPreset(presetId)) return;
  selectedPreset = presetId;
  if (resetOverrides) { presetOverrides = {}; fontName = ''; }
  $('preset-choice').value = selectedPreset;
  updatePresetControls(); updateCueOverrideControls();
}
$('preset-choice').addEventListener('change', event => selectPreset(event.target.value));

function updateCaptionControls() {
  const values = styleValues(); captionX = values.x; captionY = values.y; captionSize = values.size;
  $('caption-x').value = captionX; $('caption-y').value = captionY; $('caption-size').value = captionSize;
  $('caption-x-value').textContent = `${captionX}%`; $('caption-y-value').textContent = `${captionY}%`;
  $('caption-size-value').textContent = `${(captionSize / 360 * 100).toFixed(1)}% · ${captionSize} px`;
  clearPresetLayouts(); drawPreview(); scheduleSave();
}
for (const [id, key] of [['caption-x', 'x'], ['caption-y', 'y'], ['caption-size', 'size']]) {
  $(id).addEventListener('input', event => {
    presetOverrides[key] = Number(event.target.value);
    let cleared = 0;
    for (const cue of cues) if (cue.presetOverride && Object.hasOwn(cue.presetOverride, key)) {
      delete cue.presetOverride[key]; cleared++;
      if (!Object.keys(cue.presetOverride).length) delete cue.presetOverride;
    }
    updateCaptionControls();
    if (cleared) setStatus(`Applied this ${key === 'x' ? 'horizontal position' : key === 'y' ? 'vertical position' : 'size'} to all captions; cleared ${cleared} cue-specific override${cleared === 1 ? '' : 's'}.`);
  });
}
const controlOverrides = {
  'caption-max-words':'maxWords','caption-max-lines':'maxLines','caption-reveal':'revealMode','caption-emphasis-mode':'emphasisMode',
  'caption-base-color':'baseColor','caption-accent-color':'accentColor','caption-speaker-color':'speakerColor','caption-outline-color':'outlineColor',
  'caption-outline-width':'outlineWidth','caption-shadow-strength':'shadowStrength','caption-glow-strength':'glowStrength',
  'caption-entrance-duration':'entranceDuration','caption-entrance-scale':'entranceScale','caption-safe-margin':'safeMargin',
  'caption-exit-duration':'exitDuration',
  'caption-active-backing':'activeBacking','caption-active-pulse':'activePulse'
};
for (const [id, key] of Object.entries(controlOverrides)) {
  $(id).addEventListener(id.includes('color') || ['caption-reveal','caption-emphasis-mode','caption-max-words','caption-max-lines'].includes(id) ? 'change' : 'input', event => {
    presetOverrides[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.type === 'range' || event.target.tagName === 'SELECT' && ['caption-max-words','caption-max-lines'].includes(id) ? Number(event.target.value) : event.target.value;
    if (id === 'caption-outline-width') $('caption-outline-value').textContent = `${event.target.value}%`;
    if (id === 'caption-shadow-strength') $('caption-shadow-value').textContent = `${event.target.value}%`;
    if (id === 'caption-glow-strength') $('caption-glow-value').textContent = `${event.target.value}%`;
    if (id === 'caption-entrance-duration') $('caption-entrance-value').textContent = `${event.target.value} ms`;
    if (id === 'caption-entrance-scale') $('caption-entrance-scale-value').textContent = `${event.target.value}%`;
    if (id === 'caption-exit-duration') $('caption-exit-value').textContent = `${event.target.value} ms`;
    if (id === 'caption-safe-margin') $('caption-safe-margin-value').textContent = `${event.target.value} px`;
    clearPresetLayouts(); drawPreview(); scheduleSave();
  });
}
$('font-choice').addEventListener('change', () => { fontName = ''; presetOverrides.font = $('font-choice').value; clearPresetLayouts(); drawPreview(); scheduleSave(); });

function cueLabel(cue) { return `${cue.s.toFixed(2)}s · ${cue.t.slice(0, 48)}`; }
function updateCueOverrideControls() {
  const select = $('cue-override-select'), previous = select.value;
  select.replaceChildren();
  cues.forEach((cue, index) => select.add(new Option(cueLabel(cue), String(index))));
  if (cues.length && [...select.options].some(option => option.value === previous)) select.value = previous;
  else if (cues.length) select.value = '0';
  fillCueOverrideControls();
}
function fillCueOverrideControls() {
  const cue = cues[Number($('cue-override-select').value)];
  $('cue-position-x').value = cue ? (cue.presetOverride?.x ?? '') : '';
  $('cue-position-y').value = cue ? (cue.presetOverride?.y ?? '') : '';
  $('cue-font-size').value = cue ? (cue.presetOverride?.size ?? '') : '';
  $('cue-speaker').value = cue?.presetSpeaker || '';
  $('cue-emphasis').value = cue?.presetEmphasis || '';
  $('cue-emphasis-color').value = /^#[0-9a-f]{6}$/i.test(cue?.presetAccent || '') ? cue.presetAccent : styleValues().accentColor;
  $('cue-word-times').value = cue ? measuredWords(cue).map(word => `${(cue.s + word.s).toFixed(3)}-${(cue.s + word.e).toFixed(3)}`).join(', ') : '';
  const words = cue && measuredWords(cue);
  $('cue-timing-source').textContent = !cue ? 'No cue selected. Word times are required for active-word rendering.' : words?.length ? `${cue.src === 'whisper' ? 'Recognized word timestamps' : cue.src === 'manual' ? 'Manually corrected word timestamps' : 'Estimated or imported word timestamps'} · ${words.length} words. Correct the ranges above if needed.` : 'Word timing is missing or invalid. Enter one absolute start-end range for every word to enable word-following styles.';
}
function saveCueOverrides() {
  const index = Number($('cue-override-select').value), cue = cues[index];
  if (!cue) { setStatus('Generate captions before changing cue settings.', true); return; }
  const before = { ...cue, w: cue.w?.map(word => typeof word === 'object' ? { ...word } : word) };
  try {
    cue.presetSpeaker = $('cue-speaker').value.trim();
    cue.presetEmphasis = $('cue-emphasis').value.trim();
    cue.presetAccent = $('cue-emphasis-color').value;
    const x = $('cue-position-x').value === '' ? null : Number($('cue-position-x').value);
    const y = $('cue-position-y').value === '' ? null : Number($('cue-position-y').value);
    const size = $('cue-font-size').value === '' ? null : Number($('cue-font-size').value);
    for (const [label, value, min, max] of [['Horizontal', x, 10, 90], ['Vertical', y, 10, 90], ['Font size', size, 12, 42]]) if (value !== null && (!Number.isFinite(value) || value < min || value > max)) throw new Error(`${label} override must be between ${min} and ${max}.`);
    cue.presetOverride = Object.fromEntries(Object.entries({ x, y, size }).filter(([, value]) => value !== null));
    const emphasis = new Set(cue.presetEmphasis.split(/\s+/u).map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLocaleLowerCase()).filter(Boolean));
    cue.presetWordColors = Object.fromEntries(cue.t.trim().split(/\s+/u).filter(word => emphasis.has(word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLocaleLowerCase())).map(word => [word, cue.presetAccent]));
    const input = $('cue-word-times').value.trim();
    if (input) {
      const ranges = input.split(/[,\n]+/u).map(value => value.trim()).filter(Boolean).map(value => {
        const match = value.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/u);
        if (!match) throw new Error('Use absolute start-end seconds, such as 0.20-0.44.');
        return { s: Number(match[1]), e: Number(match[2]) };
      });
      const tokens = cue.t.trim().split(/\s+/u).filter(Boolean);
      if (ranges.length !== tokens.length) throw new Error(`Enter exactly ${tokens.length} word time ranges for this caption.`);
      let end = 0;
      for (const range of ranges) {
        if (!(range.s >= end && range.e > range.s)) throw new Error('Word times must be positive, ordered, and non-overlapping.');
        end = range.e;
      }
      cue.s = ranges[0].s; cue.e = ranges.at(-1).e;
      cue.w = ranges.map(range => ({ s: +(range.s - cue.s).toFixed(4), e: +(range.e - cue.s).toFixed(4) }));
      cue.src = 'manual'; cue.verified = true;
      validateCues(cues, audio.duration || Infinity);
    }
    updateCueOverrideControls(); clearPresetLayouts(); drawPreview(); scheduleSave();
    setStatus('Cue annotations and word timing saved. The spoken text was not changed.');
  } catch (error) { Object.assign(cue, before); setStatus(`Cue update not applied: ${error.message}`, true); updateCueOverrideControls(); }
}
$('cue-override-select').addEventListener('change', fillCueOverrideControls);
$('save-cue-overrides').addEventListener('click', saveCueOverrides);

function regroupCues(sourceCues, maxWords) {
  const words = [];
  for (const cue of sourceCues) {
    const timed = measuredWords(cue);
    if (!timed.length) throw new Error(`“${cue.t}” has no complete word timing; correct its times before regrouping.`);
    const emphasis = new Set(String(cue.presetEmphasis || '').split(/\s+/u).map(word => word.toLocaleLowerCase()));
    timed.forEach((word, index) => words.push({ ...word, absS: cue.s + word.s, absE: cue.s + word.e, cue, emphasized: emphasis.has(word.t.toLocaleLowerCase()), color: cue.presetWordColors?.[word.t] }));
  }
  const groups = []; let group = [];
  const flush = () => { if (group.length) groups.push(group); group = []; };
  for (const word of words) {
    const previous = group.at(-1);
    const sentenceEnd = /[.!?…]$/.test(previous?.t || '');
    if (previous && (group.length >= maxWords || word.absS - previous.absE >= .24 || sentenceEnd || word.cue.presetSpeaker !== previous.cue.presetSpeaker)) flush();
    group.push(word);
  }
  flush();
  return groups.map(groupWords => {
    const first = groupWords[0], last = groupWords.at(-1), s = first.absS, e = last.absE;
    return {
      id: crypto.randomUUID(), s, e, t: groupWords.map(word => word.t).join(' '),
      w: groupWords.map(word => ({ s: +(word.absS - s).toFixed(4), e: +(word.absE - s).toFixed(4) })),
      src: groupWords.every(word => word.cue.src === first.cue.src) ? first.cue.src : 'manual',
      verified: groupWords.every(word => word.cue.verified), presetSpeaker: first.cue.presetSpeaker || '',
      presetEmphasis: groupWords.filter(word => word.emphasized).map(word => word.t).join(' '),
      presetAccent: first.cue.presetAccent || 'auto',
      presetWordColors: Object.fromEntries(groupWords.filter(word => word.color).map(word => [word.t, word.color])),
      presetOverride: { ...(first.cue.presetOverride || {}) }
    };
  });
}
$('regroup-captions').addEventListener('click', () => {
  try { const next = regroupCues(cues, Number(styleValues().maxWords)); validateCues(next, audio.duration || Infinity); cues = next; updateCueOverrideControls(); clearPresetLayouts(); drawPreview(); scheduleSave(); setStatus('Captions regrouped. Every word timestamp was retained; timing was not redistributed.'); }
  catch (error) { setStatus(`Could not regroup captions: ${error.message}`, true); }
});
$('reset-preset').addEventListener('click', () => { presetOverrides = {}; updatePresetControls(); setStatus(`${captionPreset()?.label || 'Preset'} defaults restored.`); });

function renderPresetCardsOnInit() { renderPresetCards(); updatePresetControls(); updateCueOverrideControls(); }

$('font-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const family = `UserFont${Date.now()}`;
    const fontUrl = URL.createObjectURL(file); objectUrls.add(fontUrl);
    const face = new FontFace(family, `url(${fontUrl})`);
    await face.load(); document.fonts.add(face); fontName = family;
    $('font-choice').add(new Option(file.name, `"${family}"`)); $('font-choice').value = `"${family}"`;
    if (currentProject) { currentProject.fontBlob = file; currentProject.fontFileName = file.name; }
    presetOverrides.font = $('font-choice').value;
    clearPresetLayouts(); drawPreview(); setStatus(`Font loaded: ${file.name}`);
    scheduleSave();
  } catch (error) { setStatus(`Could not load this font: ${error.message}`, true); }
  event.target.value = '';
});

scriptInput.addEventListener('input', () => { invalidateCaptions(); scheduleSave(); });
$('caption-source').addEventListener('change', scheduleSave);

function mono16k(buffer) {
  const sampleRate = 16000, count = Math.max(1, Math.ceil(buffer.duration * sampleRate));
  const output = new Float32Array(count), channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const ratio = buffer.sampleRate / sampleRate;
  for (let i = 0; i < count; i++) {
    const at = i * ratio, low = Math.floor(at), fraction = at - low;
    let sum = 0;
    for (const channel of channels) sum += channel[Math.min(channel.length - 1, low)] * (1 - fraction) + channel[Math.min(channel.length - 1, low + 1)] * fraction;
    output[i] = sum / channels.length;
  }
  return output;
}

async function decodeAudioMono(file) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Audio decoding is not available on this device.');
  const decoder = new AudioContextClass();
  try {
    const decoded = await decoder.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration > 180) throw new Error('For reliable on-device captioning, shorten narration to 3 minutes or less.');
    return { pcm: mono16k(decoded), duration: decoded.duration };
  }
  finally { await decoder.close(); }
}

function waitForAudioMetadata() {
  if (Number.isFinite(audio.duration)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Could not read the narration duration. Try importing the audio again.')); }, 10000);
    const cleanup = () => { clearTimeout(timeout); audio.removeEventListener('loadedmetadata', ready); audio.removeEventListener('error', failed); };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('Could not read the narration audio.')); };
    audio.addEventListener('loadedmetadata', ready, { once: true }); audio.addEventListener('error', failed, { once: true });
  });
}

async function makeCaptions() {
  if (!videoFile || !audioFile) { setStatus('Choose a video and narration audio first.', true); return; }
  const script = scriptInput.value.trim();
  if (!script) { setStatus('Add the narration script first.', true); scriptInput.focus(); return; }
  if (!globalThis.Worker) { setStatus('Speech recognition is not available in this browser.', true); return; }
  userCancelled = false;
  $('auto-caption').disabled = true;
  showProgress('Preparing narration', 'Loading local speech recognition. The first use downloads the model.', () => { userCancelled = true; worker?.terminate(); worker = null; cancelRecognition?.(new Error('Caption generation cancelled.')); hideProgress(); $('auto-caption').disabled = false; setStatus('Caption generation cancelled.'); });
  try {
    await waitForAudioMetadata();
    if (audio.duration > 180) throw new Error('For reliable on-device captioning, shorten narration to 3 minutes or less.');
    const { pcm, duration } = await decodeAudioMono(audioFile);
    if (userCancelled) return;
    worker = new Worker(new URL('./workers/alignment.worker.js', import.meta.url), { type: 'module' });
    const tokens = await new Promise((resolve, reject) => {
      cancelRecognition = reject;
      const timeout = setTimeout(() => reject(new Error('Recognition took too long. Try a shorter recording.')), 600000);
      worker.onmessage = event => {
        const result = event.data;
        if (result.error) { clearTimeout(timeout); reject(new Error(result.error)); }
        else if (result.tokens) { clearTimeout(timeout); resolve(result.tokens); }
        else if (result.progress) {
          const p = result.progress;
          $('progress-title').textContent = 'Recognizing speech';
          $('progress-detail').textContent = p.file || p.status || 'Loading speech model…';
          if (p.total) $('progress-bar').value = Math.round(100 * p.loaded / p.total);
        }
      };
      worker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message || 'Speech recognition failed.')); };
      worker.postMessage({ pcm }, [pcm.buffer]);
    });
    worker?.terminate(); worker = null;
    if (userCancelled) return;
    const source = $('caption-source').value;
    const lines = source === 'recognized' ? [] : script.split(/\r?\n/).map(text => text.trim()).filter(Boolean).map(t => ({ t }));
    const next = alignedCues(lines, tokens, { source: 'whisper', duration, transcript: source === 'recognized', maxWords: 4 });
    cues = next; updateCueOverrideControls(); updateCounts(); drawPreview();
    scheduleSave();
    setStatus(`Created ${cues.length} captions from recognized speech. Play the preview to review timing.`);
  } catch (error) {
    worker?.terminate(); worker = null;
    if (!userCancelled) setStatus(`Could not create captions: ${error.message}`, true);
  } finally {
    cancelRecognition = null; hideProgress(); $('auto-caption').disabled = false;
  }
}

$('auto-caption').addEventListener('click', makeCaptions);

function captionOptions(config, cue = null) {
  const values = { ...styleValues(config), ...(cue?.presetOverride || {}) };
  return {
    w: canvas.width, h: canvas.height, cf: fontName || values.font, fs: values.size,
    cx_pos: values.x / 100, cy: values.y / 100, caps_lock: config.uppercase !== false,
    chunk_size: values.maxWords, maxLines: values.maxLines, revealMode: values.revealMode, emphasisMode: values.emphasisMode,
    captionTimingStale: false, wordOffset: 0, speechRuns: cues.map(cue => ({ s: cue.s, e: cue.e })),
    tc: values.baseColor, acc: values.accentColor, accentColor: values.accentColor,
    presetAccent: values.accentColor, sc_col: values.outlineColor, outlineColor: values.outlineColor,
    outlineWidth: values.outlineWidth / 100, sw: values.outlineWidth === 0 ? 'none' : 'normal',
    shadowStrength: values.shadowStrength / 100, glowStrength: values.glowStrength / 100,
    presetGlow: values.glowStrength > 0, presetBacking: !!config.defaults.preset_backing,
    activeWordBacking: values.activeBacking, activePulse: values.activePulse,
    captionIntroMs: values.entranceDuration, entranceScale: values.entranceScale / 100,
    exitDurationMs: values.exitDuration, safeMargin: values.safeMargin, captionPadding: config.padding ?? 7,
    speakerColor: values.speakerColor
  };
}

function drawPreview(requestedTime = null) {
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#10140f'; ctx.fillRect(0, 0, w, h);
  if (video.readyState >= 2 && video.videoWidth) {
    const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
    const dw = video.videoWidth * scale, dh = video.videoHeight * scale;
    ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  const time = Number.isFinite(requestedTime) ? requestedTime : audio.currentTime || video.currentTime || 0, config = captionPreset();
  if (config && cues.length) {
    for (const cue of cues) if (time >= cue.s && time < cue.e) renderPresetCaption(ctx, cue, time, captionOptions(config, cue), measuredWords(cue), config);
  }
  $('preview-state').textContent = videoFile ? (cues.length ? 'Caption preview ready' : 'Video ready · captions pending') : 'Add a video to begin';
  $('preview-empty').hidden = Boolean(videoFile);
}

$('play-preview').addEventListener('click', async () => {
  if (!videoFile || !audioFile) return;
  if (!video.paused) { video.pause(); audio.pause(); $('play-preview').textContent = 'Play preview'; return; }
  video.currentTime = 0; audio.currentTime = 0;
  try { await Promise.all([video.play(), audio.play()]); $('play-preview').textContent = 'Pause preview'; }
  catch (error) { setStatus(`Could not play preview: ${error.message}`, true); }
});
audio.addEventListener('ended', () => { video.pause(); $('play-preview').textContent = 'Play preview'; });
video.addEventListener('loadedmetadata', () => { $('play-preview').disabled = false; updateCounts(); });
video.addEventListener('loadeddata', () => { updateCounts(); scheduleSave(); });
audio.addEventListener('loadedmetadata', updateCounts);
audio.addEventListener('loadeddata', updateCounts);

async function exportVideo() {
  if (!cues.length || !videoFile || !audioFile) return;
  if (!window.VideoEncoder || !window.AudioEncoder || !window.VideoFrame || !window.AudioData || !Mp4Muxer) { setStatus('MP4 export needs a browser with WebCodecs H.264 and AAC support.', true); return; }
  const originalTime = video.currentTime; let audioEncoder = null, videoEncoder = null;
  userCancelled = false; video.pause(); audio.pause();
  try {
    showProgress('Preparing MP4 export', 'Encoding H.264 video and AAC narration. Keep SkimStudio open.', () => { userCancelled = true; });
    const duration = await waitForAudioDuration();
    const width = canvas.width, height = canvas.height, config = await exportConfig(width, height, 8000000);
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({ target, video: { codec: 'avc', width, height }, audio: { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 }, fastStart: 'in-memory' });
    const offline = await decodeNarrationForExport(audioFile, duration);
    let encoderError = null;
    audioEncoder = new AudioEncoder({ output: (chunk, meta) => { try { muxer.addAudioChunk(chunk, meta); } catch (error) { encoderError = error; } }, error: error => { encoderError = error; } });
    audioEncoder.configure(config.audio);
    const left = offline.getChannelData(0), right = offline.getChannelData(1), frames = offline.length, block = 4800;
    for (let start = 0; start < frames; start += block) {
      if (userCancelled) throw new Error('cancelled'); if (encoderError) throw encoderError;
      const count = Math.min(block, frames - start), data = new Float32Array(count * 2);
      data.set(left.subarray(start, start + count), 0); data.set(right.subarray(start, start + count), count);
      const audioData = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: count, numberOfChannels: 2, timestamp: Math.round(start / 48000 * 1e6), data });
      try { audioEncoder.encode(audioData); } finally { audioData.close(); }
      while (audioEncoder.encodeQueueSize > 12) { if (userCancelled) throw new Error('cancelled'); if (encoderError) throw encoderError; await new Promise(resolve => setTimeout(resolve, 4)); }
      if (start % (block * 16) === 0) { $('progress-detail').textContent = `Encoding narration · ${(start / frames * 100).toFixed(0)}%`; await new Promise(resolve => setTimeout(resolve)); }
    }
    await audioEncoder.flush(); if (encoderError) throw encoderError;
    videoEncoder = new VideoEncoder({ output: (chunk, meta) => { try { muxer.addVideoChunk(chunk, meta); } catch (error) { encoderError = error; } }, error: error => { encoderError = error; } });
    videoEncoder.configure(config.video);
    const fps = 30, frameCount = Math.ceil(duration * fps);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      if (userCancelled) throw new Error('cancelled'); if (encoderError) throw encoderError;
      const time = frameIndex / fps, sourceTime = video.duration > 0 ? time % video.duration : 0;
      await seekFrame(video, sourceTime, () => userCancelled);
      drawPreview(time);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(time * 1e6), duration: Math.round(1e6 / fps) });
      try { videoEncoder.encode(frame, { keyFrame: frameIndex % 60 === 0 }); } finally { frame.close(); }
      while (videoEncoder.encodeQueueSize > 12) { if (userCancelled) throw new Error('cancelled'); if (encoderError) throw encoderError; await new Promise(resolve => setTimeout(resolve, 4)); }
      if (frameIndex % 4 === 0) { $('progress-detail').textContent = `Rendering ${time.toFixed(1)} / ${duration.toFixed(1)} seconds`; $('progress-bar').value = Math.round((frameIndex + 1) / frameCount * 100); await new Promise(resolve => setTimeout(resolve)); }
    }
    await videoEncoder.flush(); if (encoderError) throw encoderError;
    if (userCancelled) throw new Error('cancelled');
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    await verifyExport(blob, duration);
    const url = URL.createObjectURL(blob); objectUrls.add(url);
    const link = document.createElement('a'); link.href = url; link.download = 'skimstudio-captions.mp4'; link.click();
    setTimeout(() => clearObjectUrl(url), 60000);
    setStatus(`MP4 exported and verified (${(blob.size / 1024 / 1024).toFixed(1)} MB).`);
  } catch (error) {
    setStatus(error.message === 'cancelled' ? 'MP4 export cancelled.' : `MP4 export failed: ${error.message}`, error.message !== 'cancelled');
  } finally {
    for (const encoder of [audioEncoder, videoEncoder]) if (encoder && encoder.state !== 'closed') encoder.close();
    video.pause(); audio.pause(); if (Number.isFinite(originalTime)) { try { await seekFrame(video, originalTime); } catch {} }
    drawPreview(); hideProgress(); $('play-preview').textContent = 'Play preview'; updateCounts();
  }
}
async function waitForAudioDuration() {
  await waitForAudioMetadata();
  if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > 180) throw new Error('MP4 export duration must be between 0 and 180 seconds.');
  return audio.duration;
}
async function decodeNarrationForExport(file, duration) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext, OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioContextClass || !OfflineContext) throw new Error('Web Audio decoding is unavailable for MP4 export.');
  const decoder = new AudioContextClass();
  try {
    const decoded = await decoder.decodeAudioData(await file.arrayBuffer());
    const frames = Math.ceil(duration * 48000), offline = new OfflineContext(2, frames, 48000), source = offline.createBufferSource();
    source.buffer = decoded; source.connect(offline.destination); source.start(0, 0, Math.min(duration, decoded.duration));
    return await offline.startRendering();
  } finally { await decoder.close(); }
}
$('export-video').addEventListener('click', exportVideo);

let previewFrame = null;
function previewLoop() {
  drawPreview();
  if (!video.paused || !audio.paused) previewFrame = requestAnimationFrame(previewLoop);
  else previewFrame = null;
}
function startPreviewLoop() { if (previewFrame === null) previewFrame = requestAnimationFrame(previewLoop); }
function stopPreviewLoop() {
  if (video.paused && audio.paused) {
    if (previewFrame !== null) cancelAnimationFrame(previewFrame);
    previewFrame = null; drawPreview();
  }
}
video.addEventListener('play', startPreviewLoop); audio.addEventListener('play', startPreviewLoop);
video.addEventListener('pause', stopPreviewLoop); audio.addEventListener('pause', stopPreviewLoop);
video.addEventListener('timeupdate', drawPreview); audio.addEventListener('timeupdate', drawPreview);
window.addEventListener('beforeunload', () => { worker?.terminate(); for (const url of objectUrls) URL.revokeObjectURL(url); });
renderPresetCards();
$('preset-choice').value = selectedPreset;
selectPreset(selectedPreset, false);
renderProjects();
