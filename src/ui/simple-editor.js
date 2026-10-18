// The ZIP's everyday editor shell, adapted to the current engine. It moves the
// existing controls into a focused workflow; it does not create a second media
// store or a second timeline state.
export function installSimpleEditor(engine) {
  const { $, pv, setStatus, seekToTimelineTime, getState } = engine;
  let renderTimeline = engine.renderTimeline;

  const original = document.createElement('div');
  original.hidden = true;
  original.id = 'original-editor';
  for (const node of [...document.body.children]) {
    if (node.tagName !== 'SCRIPT' && !node.matches('.modal-overlay, dialog, .sdlg, .export-overlay')) original.append(node);
  }
  document.body.prepend(original);

  const nav = document.createElement('nav');
  nav.className = 'frame-navigation';
  nav.setAttribute('aria-label', 'Studio views');
  nav.innerHTML = '<div class="frame-navigation-tabs"><button data-view="simple" class="active" aria-pressed="true"><span>01</span> SKIMSTUDIO <i></i></button><button data-view="timeline" aria-pressed="false"><span>02</span> TIMELINE</button></div><span class="workshop-label">THE SHORT-FORM WORKSHOP / V.01</span>';
  document.body.prepend(nav);

  const shell = document.createElement('main');
  shell.className = 'simple-editor';
  shell.innerHTML = `
    <header class="simple-header">
      <a class="simple-brand" href="#" aria-label="SkimStudio home">SS<span>SkimStudio<small>A LITTLE ROUGH. A LOT EASIER.</small></span></a>
      <div class="simple-header-actions"><span class="simple-local">ON YOUR DEVICE. JUST FOR YOU.</span><button id="simple-guide" class="simple-header-button" type="button">Quick guide</button></div>
    </header>
    <div class="simple-intro"><span class="simple-kicker">LESS FUSS. MORE FOOTAGE.</span><h1>A GOOD CLIP.<br>A GREAT <em>FINISH.</em></h1><p>Add your video, pick a look, and make the cut.</p></div>
    <div class="simple-workspace">
      <section class="simple-controls" aria-label="Edit your clip">
        <section class="simple-step"><h2><span>01</span> Add your video</h2><div id="simple-upload"></div><div id="simple-clips"></div></section>
        <section class="simple-step"><h2><span>02</span> Pick a look</h2><div class="simple-presets" role="group" aria-label="Video look">
          <button data-look="none" aria-pressed="false"><i class="look-original"></i>Original<small>Keep it natural</small></button>
          <button data-look="cine" aria-pressed="true"><i class="look-cinematic"></i>Cinematic<small>A little drama</small></button>
          <button data-look="bw" aria-pressed="false"><i class="look-noir"></i>Noir<small>Black &amp; white</small></button>
        </div></section><div id="simple-details-slot"></div>
        <details class="simple-extras"><summary>A few extras <span>+</span></summary><div class="simple-extra-fields">
          <label class="simple-option">Framing <select id="simple-framing"><option value="fill">Fill the screen</option><option value="fit">Keep the full video</option></select></label>
          <div class="simple-caption-import"><span>Captions <small>Optional · bring your own subtitle file</small></span><button id="simple-import" type="button">Add SRT file →</button></div>
          <label class="simple-option">Film grain <input type="checkbox" id="simple-grain"></label>
        </div></details>
        <p class="simple-left-note">Your edits stay on this device. Export when the preview feels right.</p>
      </section>
      <section class="simple-preview" aria-label="Video preview"><div class="simple-preview-top"><div class="simple-preview-label"><span>YOUR PREVIEW</span><small>9:16</small></div><div class="simple-preview-export"><span>03 / EXPORT VIDEO</span><div id="simple-export"></div></div></div><div id="simple-canvas"></div><div class="simple-player"><div id="simple-play"></div><span id="simple-time">00:00 / 00:00</span><span class="simple-preview-quality">720 × 1280</span></div><div id="simple-status" role="status" aria-live="polite"></div></section>
    </div>
    <footer class="simple-bottom"><span>LESS POLISH. MORE PERSONALITY.</span><span>MADE TO BE MADE.</span></footer>
  `;
  document.body.append(shell);

  const openSystemDialog = ({ title, message, confirm = false }) => new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'simple-system-dialog';
    dialog.innerHTML = `<div class="simple-dialog-header"><div><span class="simple-kicker">SKIMSTUDIO</span><h2></h2></div></div><p class="simple-system-message"></p><div class="simple-system-actions"></div>`;
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('.simple-system-message').textContent = message;
    const actions = dialog.querySelector('.simple-system-actions');
    if (confirm) {
      const cancel = document.createElement('button');
      cancel.className = 'simple-dialog-close';
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.onclick = () => { dialog.returnValue = 'cancel'; dialog.close(); };
      actions.append(cancel);
    }
    const ok = document.createElement('button');
    ok.className = 'simple-dialog-confirm';
    ok.type = 'button';
    ok.textContent = confirm ? 'OK' : 'Close';
    ok.onclick = () => { dialog.returnValue = confirm ? 'confirm' : 'close'; dialog.close(); };
    actions.append(ok);
    dialog.addEventListener('close', () => { resolve(!confirm || dialog.returnValue === 'confirm'); dialog.remove(); }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  });
  window.studioConfirm = message => openSystemDialog({ title: 'Confirm action', message, confirm: true });
  window.studioAlert = message => openSystemDialog({ title: 'Browser capabilities', message });

  const move = (id, destination) => document.getElementById(destination).append(document.getElementById(id));
  move('drop', 'simple-upload');
  move('list', 'simple-clips');
  document.getElementById('simple-canvas').append(document.querySelector('.canvas-wrap'));
  move('play', 'simple-play');
  move('exp', 'simple-export');
  move('st', 'simple-status');

  const timelineView = document.createElement('section');
  timelineView.className = 'simple-timeline';
  timelineView.hidden = false;
  timelineView.setAttribute('aria-label', 'Clip timeline');
  timelineView.innerHTML = '<div class="timeline-view-heading"><div><span class="simple-kicker">A CLOSER LOOK</span><h2>Your timeline.</h2></div><p>Click the ruler to jump to a moment.<br>Your clip and captions, all in one place.</p></div><p class="timeline-empty">Add a video in Frame 01 to see it here.</p>';
  timelineView.append(document.querySelector('.timeline-panel'));
  const timelineDialog = document.createElement('dialog');
  timelineDialog.id = 'simple_timeline_dialog';
  timelineDialog.className = 'simple-timeline-dialog';
  timelineDialog.innerHTML = '<div class="simple-dialog-header"><div><span class="simple-kicker">FRAME 02</span><h2>Timeline</h2></div><button id="simple-timeline-close" class="simple-dialog-close" type="button">Close</button></div>';
  timelineDialog.append(timelineView);
  document.body.append(timelineDialog);

  const advanced = document.createElement('details');
  advanced.className = 'timeline-advanced';
  advanced.innerHTML = '<summary>More editing tools <span>+</span></summary><p class="advanced-description">Only when you need them: narration, captions, project files, and detailed effects.</p><div class="advanced-mode"></div><div class="advanced-project"></div><div class="advanced-panels"></div>';
  advanced.querySelector('.advanced-mode').append($('tm'));
  advanced.querySelector('.advanced-project').append($('project_toolbar'));
  for (const panel of original.querySelectorAll('.workspace > .panel')) advanced.querySelector('.advanced-panels').append(panel);
  const toolsDialog = document.createElement('dialog');
  toolsDialog.id = 'advanced_tools_dialog';
  toolsDialog.className = 'simple-tools-dialog';
  toolsDialog.innerHTML = '<div class="simple-dialog-header"><div><span class="simple-kicker">CONTROL ROOM</span><h2>More editing tools</h2></div><button id="simple-tools-close" class="simple-dialog-close" type="button">Close</button></div>';
  toolsDialog.append(advanced);
  document.body.append(toolsDialog);
  const toolsButton = document.createElement('button');
  toolsButton.id = 'simple-open-tools';
  toolsButton.className = 'simple-inline-button';
  toolsButton.type = 'button';
  toolsButton.textContent = 'Edit details';
  shell.querySelector('#simple-details-slot').append(toolsButton);

  const originalRenderTimeline = renderTimeline;
  renderTimeline = () => {
    originalRenderTimeline();
    const { clips, cur, tlPixelsPerSec } = getState();
    const clip = clips[cur];
    timelineView.querySelector('.timeline-empty').hidden = Boolean(clip);
    if (!clip || clip.edl?.length) return;
    const duration = Number.isFinite(pv.duration) ? pv.duration : 0;
    $('tl_info').textContent = '1 clip';
    if (!duration) return;
    const block = document.createElement('button');
    block.className = 'tl-block tl-block-video';
    block.style.left = '0px';
    block.style.width = `${Math.max(16, duration * tlPixelsPerSec)}px`;
    block.textContent = clip.file.name;
    block.title = `${clip.file.name} - ${duration.toFixed(1)} seconds`;
    block.onclick = event => { event.stopPropagation(); seekToTimelineTime(0); };
    $('tl_video_lane').append(block);
  };
  engine.setTimelineRenderer(renderTimeline);

  const switchView = view => {
    const timeline = view === 'timeline';
    nav.querySelectorAll('[data-view]').forEach(button => {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (timeline) {
      timelineView.hidden = false;
      if (typeof timelineDialog.showModal === 'function' && !timelineDialog.open) timelineDialog.showModal();
      else timelineDialog.setAttribute('open', '');
    } else if (timelineDialog.open) timelineDialog.close();
    renderTimeline();
  };
  nav.querySelectorAll('[data-view]').forEach(button => button.onclick = () => switchView(button.dataset.view));
  timelineDialog.querySelector('#simple-timeline-close').onclick = () => {
    timelineDialog.close();
    nav.querySelector('[data-view="simple"]').click();
  };
  timelineDialog.addEventListener('close', () => {
    const active = nav.querySelector('[data-view="timeline"]')?.classList.contains('active');
    if (active) nav.querySelector('[data-view="simple"]').click();
  });
  const openTools = () => {
    advanced.open = true;
    if (typeof toolsDialog.showModal === 'function') toolsDialog.showModal();
    else toolsDialog.setAttribute('open', '');
  };
  toolsButton.onclick = openTools;
  toolsDialog.querySelector('#simple-tools-close').onclick = () => toolsDialog.close();
  toolsDialog.addEventListener('click', event => { if (event.target === toolsDialog) toolsDialog.close(); });
  $('simple-guide').onclick = () => {
    const guide = document.createElement('dialog');
    guide.className = 'simple-guide-dialog';
    guide.innerHTML = '<div class="simple-dialog-header"><div><span class="simple-kicker">A SHORTER PATH</span><h2>Three easy moves</h2></div><button class="simple-dialog-close" type="button">Close</button></div><ol><li><strong>Add your video</strong><span>Drop a clip into the upload area. The preview updates in the same frame.</span></li><li><strong>Pick a look</strong><span>Use Cinematic for the polished default, or open Extras for framing, captions, and grain.</span></li><li><strong>Make it yours</strong><span>Use Edit details only when you need narration, project files, effects, or the full inspector.</span></li></ol>';
    document.body.append(guide);
    guide.querySelector('button').onclick = () => guide.close();
    guide.addEventListener('close', () => guide.remove(), { once: true });
    guide.showModal();
  };
  pv.addEventListener('loadedmetadata', () => renderTimeline());

  $('tm').value = 'cap';
  $('tm').dispatchEvent(new Event('change'));
  $('grade').value = 'cine';
  for (const id of ['sfx', 'zoom', 'bar', 'cap', 'vig']) $(id).checked = false;
  $('exp').textContent = 'Export video →';
  $('exp').disabled = true;
  $('play').textContent = 'Play';
  $('play').disabled = true;
  $('drop').firstChild.textContent = 'Drop a video here, or click to browse';
  setStatus('Your preview will appear here.');

  const empty = document.createElement('div');
  empty.className = 'simple-empty-preview';
  empty.innerHTML = '<span>+</span><strong>YOUR NEXT GREAT CLIP.</strong><small>Start with a video.</small>';
  document.querySelector('.canvas-wrap').append(empty);
  pv.addEventListener('loadeddata', () => { if (getState().clips.length) empty.hidden = true; });

  const updateClip = () => {
    const { clips, busy } = getState();
    const ready = clips.length > 0;
    empty.hidden = ready;
    $('exp').disabled = !ready || busy;
    $('play').disabled = !ready || busy;
    renderTimeline();
    const currentStatus = $('st').textContent || '';
    if (!ready) setStatus('Your preview will appear here.');
    else if (!busy && clips.every(clip => clip.status === 'Ready') && /^(Your preview|Your clip is ready)/.test(currentStatus)) setStatus('Your clip is ready. Pick a look, preview, and export.');
  };
  new MutationObserver(updateClip).observe($('list'), { childList: true, subtree: true });

  for (const button of shell.querySelectorAll('[data-look]')) {
    button.addEventListener('click', () => {
      $('grade').value = button.dataset.look;
      shell.querySelectorAll('[data-look]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    });
  }
  $('simple-framing').onchange = event => { $('mode').value = event.target.value; };
  $('simple-grain').onchange = event => { $('grain').checked = event.target.checked; };
  $('simple-import').onclick = () => {
    if (!getState().clips.length) { setStatus('Add your video first, then import its subtitles.'); return; }
    $('srt').click();
  };
  $('srt').addEventListener('change', event => { if (event.target.files.length) $('cap').checked = true; });
  pv.addEventListener('play', () => { $('play').textContent = 'Pause'; });
  pv.addEventListener('pause', () => { $('play').textContent = 'Play'; });
  pv.addEventListener('timeupdate', () => {
    const time = seconds => {
      const s = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    $('simple-time').textContent = `${time(pv.currentTime)} / ${time(pv.duration)}`;
  });
}
