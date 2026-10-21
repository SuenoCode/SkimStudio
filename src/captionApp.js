import './core/structuredCloneCompat.js';
import '@fontsource/montserrat/latin-900.css';
import './styles/caption-app.css';
import { alignedCues } from './captions/alignedCues.js';
import { getPreset } from './captions/presetRegistry.js';
import { measuredWords } from './captions/timing.js';
import { renderPresetCaption, clearPresetLayouts } from './captions/presetRenderer.js';

const $ = id => document.getElementById(id);
const videoInput = $('video-file'), audioInput = $('audio-file'), scriptInput = $('script');
const video = $('video-preview'), audio = $('audio-preview'), canvas = $('caption-canvas'), ctx = canvas.getContext('2d');
let videoUrl = null, audioUrl = null, videoFile = null, audioFile = null, cues = [], selectedPreset = 'streamer-flashbang-meme';
let worker = null, recorder = null, exportTimer = null, fontName = '', cancelRecognition = null;
let userCancelled = false;
let captionX = 50, captionY = 54, captionSize = 30;
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
  selectedPreset = 'streamer-flashbang-meme'; $('preset-choice').value = selectedPreset;
  captionX = 50; captionY = 54; captionSize = 30; updateCaptionControls(); updateCounts();
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
    selectedPreset = record.preset || 'streamer-flashbang-meme'; $('preset-choice').value = selectedPreset;
    captionX = Number(record.captionX) || 50; captionY = Number(record.captionY) || 54; captionSize = Number(record.captionSize) || 30;
    $('caption-source').value = record.captionSource || 'script';
    if (record.fontChoice) $('font-choice').value = record.fontChoice;
    if (record.fontBlob && record.fontFileName) {
      const family = `UserFont${Date.now()}`, fontUrl = URL.createObjectURL(record.fontBlob); objectUrls.add(fontUrl);
      const face = new FontFace(family, `url(${fontUrl})`); await face.load(); document.fonts.add(face); fontName = family;
      $('font-choice').add(new Option(record.fontFileName, `"${family}"`)); $('font-choice').value = `"${family}"`;
    }
    updateCaptionControls(); updateCounts(); drawPreview();
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
    cues, preset: selectedPreset, captionX, captionY, captionSize,
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

function selectPreset(presetId) {
  selectedPreset = presetId;
  const defaults = getPreset(selectedPreset)?.defaults || {};
  captionX = Number(defaults.cx_pos) || 50;
  captionY = Number(defaults.cy) || 54;
  captionSize = Number(defaults.csz) || 30;
  updateCaptionControls();
  clearPresetLayouts(); drawPreview();
}
$('preset-choice').addEventListener('change', event => selectPreset(event.target.value));

function updateCaptionControls() {
  $('caption-x').value = captionX;
  $('caption-y').value = captionY;
  $('caption-size').value = captionSize;
  $('caption-x-value').textContent = `${captionX}%`;
  $('caption-y-value').textContent = `${captionY}%`;
  $('caption-size-value').textContent = `${captionSize} px`;
  clearPresetLayouts(); drawPreview();
  scheduleSave();
}
for (const [id, key] of [['caption-x', 'captionX'], ['caption-y', 'captionY'], ['caption-size', 'captionSize']]) {
  $(id).addEventListener('input', event => {
    const value = Number(event.target.value);
    if (key === 'captionX') captionX = value;
    else if (key === 'captionY') captionY = value;
    else captionSize = value;
    updateCaptionControls();
  });
}

$('font-choice').addEventListener('change', () => { fontName = ''; clearPresetLayouts(); drawPreview(); scheduleSave(); });
$('font-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const family = `UserFont${Date.now()}`;
    const fontUrl = URL.createObjectURL(file); objectUrls.add(fontUrl);
    const face = new FontFace(family, `url(${fontUrl})`);
    await face.load(); document.fonts.add(face); fontName = family;
    $('font-choice').add(new Option(file.name, `"${family}"`)); $('font-choice').value = `"${family}"`;
    currentProject.fontBlob = file; currentProject.fontFileName = file.name;
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
    cues = next; updateCounts(); drawPreview();
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

function captionOptions(config) {
  const defaults = config.defaults;
  return {
    w: canvas.width, cf: fontName || $('font-choice').value, fs: captionSize,
    cx_pos: captionX / 100, cy: captionY / 100, caps_lock: true,
    chunk_size: defaults.chunk_size || config.maxWords, captionTimingStale: false,
    wordOffset: 0, speechRuns: cues.map(cue => ({ s: cue.s, e: cue.e })),
    sc_col: '#050505', sw: 'normal', tc: '#ffffff', acc: config.colors?.cyan || '#a8ff12'
  };
}

function drawPreview() {
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#10140f'; ctx.fillRect(0, 0, w, h);
  if (video.readyState >= 2 && video.videoWidth) {
    const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
    const dw = video.videoWidth * scale, dh = video.videoHeight * scale;
    ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  const time = audio.currentTime || video.currentTime || 0, config = getPreset(selectedPreset);
  if (config && cues.length) {
    const options = captionOptions(config);
    for (const cue of cues) if (time >= cue.s && time < cue.e) renderPresetCaption(ctx, cue, time, options, measuredWords(cue), config);
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
  if (!canvas.captureStream || !window.MediaRecorder) { setStatus('Video export is not supported by this browser.', true); return; }
  const audioElementStream = audio.captureStream?.() || audio.mozCaptureStream?.();
  if (!audioElementStream?.getAudioTracks().length) { setStatus('Narration audio cannot be added to the exported video on this device.', true); return; }
  const stream = canvas.captureStream(30);
  for (const track of audioElementStream.getAudioTracks()) stream.addTrack(track);
  const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  const mimeType = types.find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) { setStatus('No supported video format is available for export on this device.', true); return; }
  const chunks = []; userCancelled = false;
  try {
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = event => { throw event.error || new Error('Video export failed.'); };
    showProgress('Exporting caption video', 'Keep SkimStudio open while the video is being created.', () => { userCancelled = true; recorder?.stop(); });
    const stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = event => reject(event.error || new Error('Video export failed.')); });
    recorder.start(500); video.currentTime = 0; audio.currentTime = 0;
    await Promise.all([video.play(), audio.play()]);
    const started = performance.now();
    const update = () => {
      if (recorder?.state !== 'recording') return;
      $('progress-detail').textContent = `${Math.min(audio.currentTime, audio.duration).toFixed(1)} / ${audio.duration.toFixed(1)} seconds`;
      if (audio.ended || audio.currentTime >= audio.duration) recorder.stop();
      else exportTimer = requestAnimationFrame(update);
    };
    update();
    setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); }, Math.ceil(audio.duration * 1000) + 1200);
    await stopped;
    video.pause(); audio.pause(); cancelAnimationFrame(exportTimer); stream.getTracks().forEach(track => track.stop());
    if (userCancelled) { setStatus('Export cancelled.'); return; }
    const blob = new Blob(chunks, { type: mimeType });
    const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(blob); objectUrls.add(url);
    const link = document.createElement('a'); link.href = url; link.download = `skimstudio-captions.${extension}`; link.click();
    setTimeout(() => clearObjectUrl(url), 60000);
    setStatus(`Caption video exported as ${extension.toUpperCase()}.`);
  } catch (error) {
    setStatus(`Export failed: ${error.message}`, true);
  } finally {
    recorder = null; cancelAnimationFrame(exportTimer); video.pause(); audio.pause(); hideProgress(); $('play-preview').textContent = 'Play preview';
  }
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
$('preset-choice').value = selectedPreset;
selectPreset(selectedPreset);
renderProjects();
