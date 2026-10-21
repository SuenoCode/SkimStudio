import '@fontsource/montserrat/latin-900.css';
import '@fontsource/bebas-neue/latin-400.css';
import './styles/preset-demo.css';
import { SHORTS_PRESETS } from './captions/shortsPresetCollection.js';
import { renderPresetCaption, clearPresetLayouts } from './captions/presetRenderer.js';
import { measuredWords } from './captions/timing.js';

const sentence = 'Small choices can change a story…';
const starts = [.35, .76, 1.20, 1.82, 2.26, 3.00], ends = [.75, 1.18, 1.46, 2.24, 2.48, 3.65];
const cue = {
  s: starts[0], e: ends.at(-1), t: sentence,
  w: starts.map((start, index) => ({ s: start - starts[0], e: ends[index] - starts[0] })),
  presetSpeaker: 'NARRATOR', presetEmphasis: 'change story…', presetAccent: '#FF3AD4',
  presetWordColors: { change: '#36F5DD', 'story…': '#A855F7' }
};
const words = measuredWords(cue), canvases = new Map();
const grid = document.querySelector('#demo-grid');
for (const config of SHORTS_PRESETS) {
  const card = document.createElement('article'); card.className = 'demo-card';
  const header = document.createElement('div'); header.className = 'demo-card-head';
  const title = document.createElement('h2'); title.textContent = config.label;
  const id = document.createElement('code'); id.textContent = config.id;
  header.append(title, id);
  const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 640; canvas.setAttribute('aria-label', `${config.label} caption preview`);
  const note = document.createElement('p'); note.textContent = config.description;
  card.append(header, canvas, note); grid.append(card); canvases.set(config.id, canvas);
}

function drawBackground(ctx, width, height, time, index) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, ['#173d49', '#252345', '#413227', '#173e37', '#333018', '#3b2438'][index]);
  gradient.addColorStop(1, '#101218'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff0c'; ctx.beginPath(); ctx.arc(width * (.23 + (time % 1) * .1), height * .28, width * .62, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#00000032'; ctx.fillRect(0, height * .76, width, height * .24);
  ctx.fillStyle = '#ffffff75'; ctx.font = '500 10px Arial'; ctx.textAlign = 'left'; ctx.fillText('SAMPLE FRAME · TIMING ONLY', 15, 22);
}

function draw(time) {
  document.querySelector('#demo-time-label').textContent = `${time.toFixed(2)} s`;
  document.querySelector('#demo-time').value = String(time);
  const active = words.findIndex(word => time >= cue.s + word.s && time < cue.s + word.e);
  document.querySelector('#demo-state').textContent = active < 0 ? (time < cue.s ? 'Before narration · no caption' : time >= cue.e ? 'After narration · no caption' : 'Narration pause · caption hidden') : `Speaking: ${words[active].t}`;
  SHORTS_PRESETS.forEach((config, index) => {
    const canvas = canvases.get(config.id), ctx = canvas.getContext('2d'); drawBackground(ctx, canvas.width, canvas.height, time, index);
    const d = config.defaults;
    renderPresetCaption(ctx, cue, time, {
      w: canvas.width, h: canvas.height, cf: d.cf, fs: Number(d.csz), cx_pos: .5, cy: Number(d.cy) / 100,
      chunk_size: Number(d.chunk_size), maxLines: 2,
      revealMode: config.revealMode, emphasisMode: config.emphasisMode, tc: d.tc, acc: d.acc,
      accentColor: d.acc, presetAccent: d.acc, sc_col: d.sc_col, outlineColor: d.sc_col,
      outlineWidth: config.outlineRatio, sw: 'normal', shadowStrength: config.shadowStrength,
      glowStrength: config.glow, presetGlow: !!d.preset_glow, presetBacking: !!d.preset_backing,
      activeWordBacking: !!config.activeWordBacking, speakerColor: config.speakerColor,
      captionIntroMs: 0, entranceScale: config.introScale || .96, safeMargin: 24, captionPadding: config.padding
    }, words, config);
  });
}

const slider = document.querySelector('#demo-time'), play = document.querySelector('#demo-play');
let animation = null, started = 0, offset = 0;
function stop() { if (animation !== null) cancelAnimationFrame(animation); animation = null; play.textContent = 'Play timing'; }
function tick(now) { const time = Math.min(4.5, offset + (now - started) / 1000); draw(time); if (time >= 4.5) { stop(); offset = 0; return; } animation = requestAnimationFrame(tick); }
slider.addEventListener('input', () => { stop(); offset = Number(slider.value); draw(offset); });
play.addEventListener('click', () => { if (animation !== null) { stop(); return; } if (offset >= 4.5) offset = 0; started = performance.now(); play.textContent = 'Pause timing'; animation = requestAnimationFrame(tick); });
document.querySelector('#demo-record').addEventListener('click', async event => {
  if (!HTMLCanvasElement.prototype.captureStream || !window.MediaRecorder) { document.querySelector('#demo-state').textContent = 'This browser cannot record the visual demo.'; return; }
  const button = event.currentTarget, output = document.createElement('canvas'), ctx = output.getContext('2d');
  output.width = 1080; output.height = 1280;
  const stream = output.captureStream(30), mime = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mime) { document.querySelector('#demo-state').textContent = 'No supported visual demo recording format is available.'; return; }
  stop(); button.disabled = true; const chunks = [], recorder = new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:1800000});
  recorder.ondataavailable = item => { if (item.data.size) chunks.push(item.data); };
  const finished = new Promise(resolve => { recorder.onstop = resolve; });
  const paint = time => { draw(time); ctx.fillStyle = '#101412'; ctx.fillRect(0,0,1080,1280); SHORTS_PRESETS.forEach((config,index)=>{const x=(index%3)*360,y=Math.floor(index/3)*640,canvas=canvases.get(config.id);ctx.drawImage(canvas,x,y,360,640);ctx.fillStyle='#07100de0';ctx.fillRect(x+9,y+10,205,26);ctx.fillStyle='#f1f5ef';ctx.font='600 13px Arial';ctx.textAlign='left';ctx.fillText(config.label,x+17,y+28)}); };
  paint(0); recorder.start(100);
  const base = performance.now();
  await new Promise(resolve => {
    const frame = now => {
      const time = Math.min(4.5,(now-base)/1000); paint(time);
      if (time>=4.5) resolve(); else requestAnimationFrame(frame);
    }; requestAnimationFrame(frame);
  });
  recorder.stop(); await finished; stream.getTracks().forEach(track=>track.stop());
  const blob = new Blob(chunks,{type:mime}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='skimstudio-caption-preset-timing-demo.webm';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  button.disabled = false; document.querySelector('#demo-state').textContent = 'Downloaded 4.5-second visual timing demo.'; draw(Number(slider.value));
});
document.fonts.ready.then(() => { clearPresetLayouts(); draw(0); });
