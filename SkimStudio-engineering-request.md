# SkimStudio STUDIO: COMPLETE ENGINEERING REPAIR AND UPGRADE

## ROLE AND MISSION

You are a senior JavaScript engineer, browser media-processing specialist, nonlinear video editor architect, and professional video post-production engineer.

Your task is to **repair, refactor, and substantially improve the existing SkimStudio Studio application**, using the provided source files as the starting point.

This is an implementation task, not a brainstorming task.

You must modify the actual project files and deliver a functioning application.

The final result must remain deployable on the **Vercel Hobby free tier**, without depending on a paid service or a continuously running external backend.

### PRIMARY OBJECTIVE

Transform SkimStudio into a reliable, intelligent, narration-driven short-form video editor that can:

1. Import multiple videos and narration audio.
2. Analyze available footage using feasible browser-based techniques.
3. Understand the narration's structure and match relevant footage wherever possible.
4. Construct a coherent multi-clip storyline.
5. Create accurate, speech-synchronized animated captions.
6. Add intentional cuts, framing, camera movement, transitions, and visual effects.
7. Mix narration, original audio, and sound effects correctly.
8. Provide a fully editable timeline with manual corrections.
9. Export properly synchronized, high-quality vertical videos.
10. Preserve user work and handle errors gracefully.

All editing operations must be initiated by an explicit user action.

Do not sacrifice correctness for visually impressive but unreliable functionality.

---

# SECTION 1: NON-NEGOTIABLE CONSTRAINTS

## 1.1 Preserve the existing application

Before modifying code:

- Inspect every existing file.
- Identify actual working features, broken features, and placeholders.
- Trace event handlers and dependencies.
- Understand the existing data structures.
- Identify all rendering, editing, and export entry points.
- Determine how videos, captions, narration, effects, and timeline segments are currently managed.

Do not rebuild the application from scratch.

Preserve the current three-column editing interface, preview canvas, media bin, caption inspector, effects panel, sound effects controls, timeline, and moment editor wherever practical.

Do not replace the interface with a generic AI-generated dashboard.

Do not remove existing features merely because they are difficult to maintain.

Refactor their implementations where necessary.

## 1.2 Technology requirements

Required architecture:

- HTML5
- CSS3
- Vanilla JavaScript using ES modules
- Vite as the development and build tool
- Browser Canvas API
- Web Audio API
- WebCodecs API where supported
- IndexedDB for persistent project data
- Web Workers for CPU-heavy browser tasks where feasible
- Optional browser-compatible libraries for MP4 muxing and audio/video processing

Do not introduce React, Next.js, Angular, Vue, or another full frontend framework.

Use npm dependencies only where they provide real functionality.

Prefer established and maintainable libraries rather than writing unnecessary low-level implementations.

Do not introduce a Python backend, Node.js processing server, Docker requirement, database server, paid API, or external AI inference service as a required component.

## 1.3 Vercel deployment requirements

The project must deploy as a static Vite application.

Required commands:

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

The production build must output to `dist/`.

Do not require Node.js to remain running after deployment.

Node.js may be used during development and build time only.

Do not depend on persistent server-side storage.

Do not send large uploaded video files through Vercel Functions.

Uploaded video files should stay on the user's device unless the user explicitly initiates a separate supported upload.

Do not add serverless video encoding, serverless Whisper inference, or long-running server functions.

Heavy rendering and media analysis must happen in the user's browser, with explicit device capability checks and resource limits.

Support external processing adapters only as optional future extensions, disabled by default.

The application must remain usable without them.

## 1.4 No fake functionality

Never simulate or misrepresent actual processing.

Do not claim that the application understands footage if it only reads filenames or motion scores.

Do not label estimated word timing as verified transcription.

Do not claim that an export is successful unless a valid output was produced.

Do not display fake AI confidence values.

Do not create random cuts and describe them as semantically intelligent.

If a capability is unsupported, show its actual status and offer a working fallback.

Never silently replace a failed process with an unrelated simulated result.

---

# SECTION 2: PROJECT RESTRUCTURING

Refactor the monolithic HTML file into logical modules.

Recommended structure:

```text
SkimStudio/
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
├── public/
│   └── assets/
├── src/
│   ├── main.js
│   ├── styles/
│   │   ├── base.css
│   │   ├── layout.css
│   │   ├── timeline.css
│   │   └── editor.css
│   ├── core/
│   │   ├── state.js
│   │   ├── project.js
│   │   ├── validation.js
│   │   ├── history.js
│   │   └── errors.js
│   ├── media/
│   │   ├── importer.js
│   │   ├── metadata.js
│   │   ├── decoder.js
│   │   ├── thumbnails.js
│   │   └── sceneAnalysis.js
│   ├── analysis/
│   │   ├── narrative.js
│   │   ├── shotRanking.js
│   │   ├── continuity.js
│   │   └── capabilityDetection.js
│   ├── captions/
│   │   ├── parser.js
│   │   ├── wordTiming.js
│   │   ├── renderer.js
│   │   └── synchronization.js
│   ├── timeline/
│   │   ├── model.js
│   │   ├── editor.js
│   │   ├── transport.js
│   │   └── renderer.js
│   ├── effects/
│   │   ├── framing.js
│   │   ├── transitions.js
│   │   ├── typography.js
│   │   └── color.js
│   ├── audio/
│   │   ├── mixer.js
│   │   ├── ducking.js
│   │   └── effects.js
│   ├── export/
│   │   ├── encoder.js
│   │   ├── muxer.js
│   │   ├── exporter.js
│   │   └── verify.js
│   ├── storage/
│   │   └── indexedDb.js
│   └── workers/
│       └── analysis.worker.js
└── tests/
    ├── captions.test.js
    ├── timeline.test.js
    ├── analysis.test.js
    ├── export.test.js
    └── fixtures/
```

This structure is a target, not a requirement to create empty files.

Only introduce modules that contain meaningful working logic.

Avoid circular dependencies.

Use a single authoritative project state, rather than allowing unrelated UI components to maintain conflicting copies of timeline information.

Preserve existing feature behavior unless it is broken or conflicts with requirements.

---

# SECTION 3: FIX ALL AUTOMATIC EXECUTION PROBLEMS

The application must never begin generating or replacing an edit merely because a file was imported or a setting was changed.

Remove unintended calls such as:

```javascript
if (scriptHasContent) {
  autoSyncAndEdit();
}
```

Importing narration should only:

1. Read and validate the file.
2. Display its duration.
3. Prepare its waveform.
4. Update the media/project state.
5. Enable the appropriate editing controls.

It must NOT automatically build a video.

Required workflow:

**Import → Analyze → Review → Build Edit → Preview → Adjust → Export**

An operation may advance only through explicit button interactions.

Recommended buttons:

- Analyze Media
- Generate Story Plan
- Build Story Edit
- Preview Edit
- Apply Changes
- Export Video

The application must not export or regenerate a timeline during ordinary state changes.

Changes that would overwrite user edits require a clear warning and must be undoable.

Prevent duplicate operation starts while a job is already running.

---

# SECTION 4: MEDIA INGESTION AND VALIDATION

Implement dependable video and audio importing.

For every video, inspect:

- File type and extension
- Actual browser decode compatibility
- Duration
- Width and height
- Aspect ratio
- Audio availability
- Frame-rate information when determinable
- File size
- Rotation metadata when available
- Decode failures
- Source identifiers

Reject unsupported files gracefully.

Do not assume that every file labeled `.mp4` contains supported codecs.

Use real browser decoding checks.

Generate thumbnails asynchronously.

Avoid decoding all imported videos into memory simultaneously.

Use bounded caches and release stale resources.

Use object URL cleanup when media files are removed.

Create stable asset identifiers so timeline edits do not break when media-bin order changes.

When browser limitations prevent a feature, display a meaningful explanation.

Implement a project-level capability report identifying supported video decoding, encoding, audio codecs, available browser APIs, and memory-related limitations.

---

# SECTION 5: ACTUAL SCENE AND CONTENT ANALYSIS

The application's scene analysis must improve beyond choosing footage based on filename keywords and high motion.

Implement practical browser-compatible analysis.

## Stage A: Shot-boundary detection

Sample frames at configurable intervals.

Detect probable scene changes using changes in image statistics, color distributions, and visual similarity.

Avoid identifying every rapid camera movement as a scene transition.

Split imported footage into candidate shots.

Each candidate should store:

```javascript
{
  id,
  assetId,
  sourceStart,
  sourceEnd,
  duration,
  thumbnail,
  visualActivity,
  sceneChangeScore,
  qualityScore,
  tags,
  confidence
}
```

Validate all numerical fields.

## Stage B: Visual-quality analysis

Estimate:

- Blur
- Excessive darkness
- Overexposure
- Image activity
- Significant motion
- Static frames
- Potential unusable frames

Use these signals to reject poor-quality shots when better alternatives exist.

Do not treat motion as equivalent to narrative relevance.

## Stage C: Semantic information

Support manual tagging and optional browser-compatible visual models where realistically feasible.

Do not download huge AI models automatically.

Check model size, availability, and browser compatibility before loading anything.

Provide an opt-in option for model downloads.

If semantic analysis is unavailable, indicate that shot matching is limited.

Never infer facts such as a goal being scored, a person winning, or a particular individual appearing without sufficient evidence.

Allow the user to correct tags and scene descriptions.

## Stage D: Source-range tracking

Record exactly which portions of each imported video are used.

Avoid repeatedly selecting the same footage unless repetition is intentional.

Prevent invalid source intervals and unintended overlapping selections.

---

# SECTION 6: NARRATIVE EDITING ENGINE

Narration must define the overall story structure.

Analyze the script into meaningful narrative units rather than mechanically splitting every sentence into equal-duration clips.

Identify probable:

- Hook
- Context
- Setup
- Main event
- Escalation
- Turning point
- Climax
- Resolution
- Closing statement

These classifications should remain editable.

Do not force every script to contain every category.

## Narrative-to-video matching

For each narration unit:

1. Determine its meaning using available script cues and user-provided context.
2. Retrieve candidate footage.
3. Evaluate scene relevance using genuinely available evidence.
4. Score visual quality.
5. Check chronology and continuity.
6. Check footage already used.
7. Evaluate shot duration.
8. Select the best supported candidate.
9. Record why the candidate was chosen.

Use a weighted ranking system rather than arbitrary random selection.

Suggested dimensions:

- Relevance
- Visual quality
- Continuity
- Pacing suitability
- Subject consistency
- Repetition penalty
- Transition compatibility

Only calculate scores from actual available data.

If semantic evidence is unavailable, do not fabricate semantic confidence.

When no relevant shot exists, mark the narration unit as requiring manual footage selection.

## Story continuity

Do not arrange visually unrelated footage merely because it has a high motion score.

Preserve chronological sequences when chronology matters.

Avoid showing the outcome before the action that caused it unless the script deliberately uses that structure.

Avoid changing identifiable subjects unexpectedly.

Do not repeat the same establishing shot without a clear reason.

Provide a storyboard review before generating the final timeline.

Each planned shot should display:

- Associated narration line
- Selected source clip
- Source in/out
- Timeline in/out
- Reason for selection
- Confidence or evidence limitation
- Manual replacement control

---

# SECTION 7: WORD-LEVEL CAPTION ACCURACY

This is a critical feature.

Captions must behave according to actual spoken audio timings.

## Mandatory synchronization rules

1. Before speech begins, the corresponding caption must not appear.
2. A word must never become highlighted before its detected spoken start.
3. Highlighting must remain active for the appropriate spoken interval.
4. Previously spoken words may remain visible when the selected style requires it.
5. Future words must not appear early in progressive-reveal mode.
6. The final word must be visibly highlighted before its caption group disappears.
7. Speech pauses must not generate premature new captions.
8. Captions must end when the intended spoken content ends.
9. Timing offsets must never create invalid negative timestamps.
10. All timing computations must account for the output frame rate.

## Timing sources

Support, in priority order:

A. Validated imported word-level alignment.

B. Verified timing produced by an available speech-alignment engine.

C. Audio-informed estimated timing.

D. Clearly labeled manual timing.

Never present estimated timings as precise speech recognition.

If a browser-compatible Whisper engine is available, use it only when the device can support it.

Do not silently download large models.

Provide loading, cancellation, and failure states.

Handle unsupported languages gracefully.

## Word data structure

Use explicit timestamps:

```javascript
{
  id: "word-id",
  text: "everything",
  start: 1.32,
  end: 1.91,
  timingSource: "imported",
  verified: true
}
```

Ensure:

- `start` is finite and nonnegative.
- `end` is greater than `start`.
- Words are correctly ordered.
- Timing does not exceed the permitted narration range.
- Overlaps are intentional or flagged.

## Caption rendering

Implement:

- Progressive word reveal
- Active-word highlighting
- Karaoke captions
- Standard sentence captions
- Caption grouping
- Proper line breaks
- Text bounding-box checks
- Safe-zone checks
- Font fallback handling
- Configurable animation durations

Use a consistent timeline clock.

Do not use inconsistent timing logic between preview and export.

## Final video allowance

Provide an optional end-tail setting with a default of 0.5 seconds.

This must not stretch the narration or final word.

The spoken audio and its corresponding captions must finish naturally.

The remaining tail may show the last valid video frame or an intentional ending treatment.

Keep this option separate from caption synchronization.

---

# SECTION 8: FRAME-ACCURATE TIMELINE

Create a stable timeline model with distinct concepts for:

- Timeline start and end
- Source in and out
- Playback speed
- Track identity
- Clip identity
- Transition duration
- Caption timing
- Audio timing

Use stable unique IDs rather than positional indexes as references.

Implement explicit rules for:

- Splitting
- Trimming
- Moving
- Reordering
- Replacing footage
- Changing speed
- Locking edits
- Ripple behavior
- Undo/redo

Never allow:

- Negative durations
- Undefined source references
- Nonfinite playback speeds
- Source ranges beyond media duration
- Accidental gaps
- Uncontrolled overlaps

Timeline changes must immediately update the preview model.

Prevent editing operations from silently invalidating later segments.

Do not force an invalid duration mismatch into the final shot.

If a story is shorter than the narration, intelligently extend eligible footage within valid source boundaries, adjust the plan, or report insufficient coverage.

Locked segments must never be silently altered.

---

# SECTION 9: PROFESSIONAL VIDEO DESIGN ENGINE

Treat visual editing as a storytelling problem rather than an opportunity to apply every available effect.

## Cinematography

Support:

- Wide shots
- Medium shots
- Close-ups
- Controlled punch-ins
- Pan and zoom
- Manual focus positioning
- Subject-aware framing where supported
- Stable crop boundaries

Do not crop an important subject out of frame.

Do not automatically zoom into an unverified subject.

Smooth camera movement using appropriate easing.

Avoid excessive movement that distracts from the narration.

## Transitions

Default to hard cuts.

Use dissolves, light leaks, film burns, or other transitions only when justified by pacing, scene change, or user-selected style.

Limit repetitive transitions.

Preserve shot visibility during transitions.

Account for transition overlap in the timeline duration calculations.

## Color grading

Implement reliable presets and normalization controls.

Include:

- Exposure
- Contrast
- Saturation
- Temperature where feasible
- Brightness
- Basic color balancing
- Vignette
- Film grain

Ensure color settings affect preview and export consistently.

Avoid excessive contrast, clipped highlights, and crushed shadows.

If accurate color-space handling cannot be implemented, do not claim professional color management.

## Motion graphics

Support existing effects:

- Keyword pop-ups
- Subject callouts
- Lower thirds
- Hook titles
- Reactions
- Contextual arrows
- Zoom accents
- Controlled shake and glitch effects

Do not activate every effect simply because its checkbox is enabled.

Evaluate whether an effect adds meaning.

Prioritize captions and important subjects over decorative overlays.

Enforce safe zones for common 9:16 platforms.

Use consistent design rules across the finished video.

Preserve the user's manual effects.

---

# SECTION 10: AUDIO MIXING AND SOUND DESIGN

Separate audio into logical buses:

- Narration
- Original source audio
- Music, when supplied
- Sound effects

Use the narration as the primary speech track in commentary mode.

Implement adjustable original-audio ducking.

Improve ducking so that it responds to narration activity rather than applying one constant volume to every source.

Add short fades to prevent discontinuities at cuts.

Avoid source-audio pitch changes unless requested.

Validate playback speed.

Prevent audio clipping when effects overlap.

Provide basic level metering and clear clipping warnings.

If technically feasible, add loudness measurement and an adjustable output target.

Do not falsely claim true-peak limiting without implementing and verifying it.

Sound effects must be:

- Appropriate to the action
- Clearly audible without overpowering narration
- Applied sparingly
- Manually editable
- Synchronized with actual events

Do not randomly insert whooshes or impacts at every cut.

---

# SECTION 11: RELIABLE VIDEO EXPORT

The output file must be dependable, not merely downloadable.

## Pre-export validation

Before starting, check:

- Media availability
- Timeline integrity
- Source boundaries
- Video encoder support
- Audio encoder support
- Container compatibility
- Caption timing
- Output settings
- Expected duration

If required capabilities are missing, disable unsupported options and explain why.

## Frame decoding

Do not silently accept incomplete video seeks.

Fix seek timeouts so they reject with a meaningful error instead of returning a potentially stale frame.

Remove all temporary listeners on success, failure, timeout, or cancellation.

Prefer sequential frame decoding or reliable frame caches over repeated random seeking where feasible.

Do not assume `seeked` guarantees that a specific requested frame has been rendered.

## Video rendering

Support:

- 9:16 output
- At least one reliable resolution preset
- 30 fps baseline
- Optional 60 fps only on supported devices
- Configurable quality
- Accurate caption compositing
- Transitions
- Visual effects
- Consistent color output

Offer 1080 × 1920 when supported.

Provide a lower-resolution fallback for limited devices.

Do not promise every computer can export every resolution.

Use WebCodecs capability checks.

Maintain frame order and valid timestamps.

Avoid silent frame duplication.

## Audio rendering

Prefer broadly compatible codecs such as AAC when supported by the chosen encoding and muxing pipeline.

Do not falsely label an output as AAC when it contains Opus or another codec.

Verify actual stream configuration.

## Memory management

Avoid assembling enormous files entirely in memory when a supported streaming output mechanism exists.

Implement bounded frame buffers.

Close VideoFrames and other disposable resources.

Release unused audio buffers and object URLs.

Prevent unnecessary simultaneous analysis and export jobs.

Keep memory requirements appropriate for relatively low-end devices, including systems with around 4 GB RAM.

## Export controls

Provide:

- Start export
- Progress display
- Cancel export
- Error details
- Retry when appropriate
- Download finished video

Cancellation must release resources and not produce a misleading success message.

## Post-export verification

Where browser APIs allow, verify:

- Nonempty output
- Valid container
- Expected streams
- Approximate duration
- Playable first, middle, and final frames
- Audio presence where expected
- Basic audio/video alignment

If verification is incomplete, report that honestly.

Do not claim universal device or platform compatibility.

---

# SECTION 12: PROJECT PERSISTENCE AND ERROR RECOVERY

Implement reliable project persistence.

Use IndexedDB for project metadata.

Store:

- Project version
- Script
- Timeline decisions
- Caption data
- Imported-media references
- Media metadata
- Style settings
- Effects
- Export settings
- Manual overrides

Persist media bytes only with explicit user awareness and available storage capacity.

If media is not persisted, support relinking after reopening.

Implement autosave with protection against excessive writes.

Provide:

- Save project
- Load project
- Export project JSON
- Import project JSON
- Reset project
- Undo
- Redo

Validate imported project schemas.

Use migration rules when project structure changes.

Do not destroy current work after a recoverable error.

---

# SECTION 13: PERFORMANCE AND ACCESSIBILITY

Avoid unnecessary UI redraws.

Do not perform expensive frame analysis on every input-slider event.

Throttle preview updates where appropriate.

Use workers for suitable background processing.

Maintain responsive controls during long operations.

Limit simultaneous video decoders.

Support:

- Keyboard playback controls
- Accessible form labels
- Visible focus states
- Reduced-motion preferences
- Readable error messages
- Responsive layouts

Prioritize desktop editing, but prevent unusable layouts on smaller screens.

Do not hide critical controls behind broken responsive behavior.

---

# SECTION 14: AUTOMATED TESTING

Implement meaningful automated tests.

Use a lightweight JavaScript testing framework.

Test:

1. Timestamp validation.
2. Negative and overlapping caption timings.
3. First-word visibility.
4. Last-word highlight completion.
5. Silent gaps.
6. Source clip boundary validation.
7. Timeline duration calculations.
8. Playback-speed calculations.
9. Locked-shot preservation.
10. Scene ranking with unavailable semantic evidence.
11. Missing-media handling.
12. Export cancellation state.
13. Codec capability fallback.
14. Project serialization.
15. Undo/redo.
16. End-tail behavior.
17. No automatic editing on media import.

Provide reproducible test fixtures.

Do not mark tests as passing without running them.

If browser integration tests are possible in the environment, implement representative preview/export tests.

If tests cannot be executed, clearly distinguish written tests from verified passing tests.

---

# SECTION 15: CONTROLLED IMPLEMENTATION ORDER

You are a resource-constrained coding model.

Work incrementally to avoid introducing widespread regressions.

Execute the following phases in order within this task.

### PHASE 1: Audit and preserve

Identify the relevant functions and dependencies.

Create a short internal implementation plan.

Preserve the original interface and working functionality.

### PHASE 2: Refactor

Extract the source code into maintainable modules.

Ensure the original app loads and basic interactions work before adding features.

### PHASE 3: Repair critical errors

Prioritize:

- Unwanted automatic editing
- Invalid timestamps
- Stale frame seeks
- Export resource leaks
- Invalid media handling
- Duration mismatch
- Broken shot locks
- Audio alignment errors

### PHASE 4: Improve editing intelligence

Implement scene segmentation, shot metadata, narrative planning, continuity checks, and supported ranking improvements.

Keep unsupported semantic AI capabilities clearly labeled and optional.

### PHASE 5: Improve design and audio

Implement reliable captions, intentional effects, composition checks, and controlled sound mixing.

### PHASE 6: Harden export

Improve encoding, cancellation, resource management, and verification.

### PHASE 7: Validate deployment

Run the build and available tests.

Fix discovered regressions.

Document remaining limitations.

Do not proceed to optional visual enhancements while fundamental timeline or export bugs remain unresolved.

---

# SECTION 16: DEVELOPMENT DISCIPLINE

Follow these rules throughout implementation.

**Rule 1:** Modify actual files. Do not respond only with explanations or pseudocode.

**Rule 2:** Implement real functionality rather than decorative controls.

**Rule 3:** Preserve existing functionality unless a change is necessary.

**Rule 4:** Keep the code understandable and modular.

**Rule 5:** Prefer small, testable functions.

**Rule 6:** Validate external data and numeric inputs.

**Rule 7:** Use structured error handling.

**Rule 8:** Avoid silent catches that hide failures.

**Rule 9:** Avoid unnecessary dependencies and complicated abstractions.

**Rule 10:** Do not introduce server infrastructure incompatible with static Vercel hosting.

**Rule 11:** Avoid creating duplicate implementations of the same editing functionality.

**Rule 12:** Treat the timeline as the authoritative source for preview and export.

**Rule 13:** Respect all manual user edits.

**Rule 14:** Do not fabricate missing footage, successful analysis, or export verification.

**Rule 15:** Do not claim a feature is finished until its implementation and available tests support that claim.

**Rule 16:** If context or execution limits prevent completion, leave the application buildable, retain a clear record of unfinished items, and do not claim full completion.

---

# SECTION 17: REQUIRED ACCEPTANCE CRITERIA

The project is acceptable only when the following are satisfied.

## Functionality

- The application starts without fatal errors.
- Multiple videos can be imported.
- Narration can be imported.
- Media importing never automatically generates an edit.
- Scene analysis produces useful shot candidates from actual footage.
- Story editing uses available evidence rather than fabricated understanding.
- Users can review and modify the generated timeline.
- Captions are synchronized to the selected timing source.
- Manual edits remain stable.
- Preview and export use the same timeline data.
- Export detects unsupported configurations.
- Export errors are visible and recoverable.
- The application saves and restores editable project state.

## Video quality

- No unintended black frames.
- No stale video frames.
- No invalid clip durations.
- No premature caption highlighting relative to verified timings.
- No unexplained caption persistence during silence.
- No unexpected narration stretching.
- No arbitrary sound effect overload.
- No invalid source clipping.
- No uncontrolled repeated footage.

## Deployment

- `npm install` succeeds.
- `npm run build` succeeds.
- `dist/` contains the working static site.
- The application can deploy to Vercel Hobby.
- No always-on backend is required.
- Uploaded media does not depend on server-side temporary storage.
- Local processing remains available within documented browser/device limitations.

---

# SECTION 18: FINAL REQUIRED DELIVERABLES

When implementation is complete, provide:

1. The updated project files.
2. A summary of confirmed bugs repaired.
3. The architectural changes made.
4. The actual features implemented.
5. The remaining unsupported features.
6. The tests executed and their results.
7. The production build result.
8. Vercel deployment instructions.
9. Any required user configuration.
10. Known device and browser limitations.

Create a `README.md` containing practical setup and usage instructions.

Create a `LIMITATIONS.md` describing remaining technical restrictions honestly.

Do not substitute a long completion report for actual code changes.

**FINAL DIRECTIVE**

Your priority is not to make SkimStudio look more advanced. Your priority is to make its actual editing behavior more intelligent, its synchronization more accurate, its timeline more dependable, its effects more intentional, and its exports more reliable.

A clean, coherent video with accurate cuts and captions is more valuable than a visually excessive video with unreliable editing.

Begin by inspecting the current project. Implement the highest-priority repairs first. Continue through the ordered phases while maintaining a working, buildable application. Do not stop at planning, and do not claim any capability that has not actually been implemented.