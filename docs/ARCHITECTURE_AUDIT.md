# SkimStudio architecture audit

Audited 2026-10-19 at commit `ed4f493` (Use OpenRouter to plan commentary edits). Scope: source inspection, existing unit/build checks, two browser integration tests, local FFmpeg discovery, and official infrastructure documentation. This is an audit and design change only; no application defects were fixed in this pass.

This document preserves the pre-M1 audit. Completed M1 repairs and live-verification evidence are recorded in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); descriptions below are historical baseline findings, not a claim that those repairs are still absent.

Read [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for verification limits, [ARCHITECTURE.md](ARCHITECTURE.md) for the target contracts, and [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) for the ordered work. Function names below are stable search anchors; line numbers will change.

## 1. Current system and ownership

SkimStudio is a static browser application. It has no backend API, native processing worker, FFmpeg integration, durable job queue, authentication service, or cloud media store. Browser Web Workers are present; these are not independent background processing services.

| Area | Current implementation | Assessment |
| --- | --- | --- |
| Frontend/build | Vanilla JavaScript ES modules, Vite, two HTML entry points; `src/ui/simple-editor.js` moves existing controls into its workspace | Preserve framework and UI. No React/Next.js migration is justified. |
| Application orchestration | Approximately 3,600 lines / 186 KB in `src/main.js`; mutable `clips`, `cur`, `busy`, `pendingPlan`, DOM settings; functions exposed on `window` | Extract boundaries incrementally. DOM and media elements currently act as parts of the data model. |
| Media | Browser File/Blob URLs, HTMLVideoElement, Canvas, Web Audio | Real decoding; metadata is incomplete and browser-dependent. |
| Analysis | `src/analysis/sceneAnalysis.js`, `shotRanking.js`, `workerClient.js`, `src/workers/analysis.worker.js` | Real pixel statistics, not semantic event recognition. |
| Speech | `src/workers/alignment.worker.js`, Transformers.js Whisper base.en q8; `src/captions/activity.js`, `alignedCues.js`, `timing.js` | Real optional ASR plus separately identified timing estimates. Preserve validation and pause handling. |
| AI | `src/audit/storyAuditor.js` contains HTTP transport, prompts, schemas, planner, auditor, sampling, report generation | Real OpenRouter request construction, but insufficient validation and integration. Split transport from domain logic. |
| Timeline | Per-owner clip EDL; `src/core/validation.js`, `timelineIndex.js`, `transitions.js` | Working single sequential video track. Not a general multitrack NLE. |
| Plan Viewer | `stagePlan`, `renderPlan`, `reviewedBuilder` and `plan_apply` in `src/main.js` | Working editable table and approval, lacking complete AI/evidence state and draft preview. |
| Export | Canvas compositor + WebCodecs H.264/AAC + vendored MP4 muxer, Web Audio mix | Actual executable browser renderer, not an export placeholder. Retain as compatibility backend. |
| Persistence | `src/storage/indexedDb.js` single `projects/autosave` record; v1 project JSON; 40-snapshot undo | Metadata only; source bytes, drafts, analysis and jobs are not durable. |
| Deployment | `vercel.json`: Vite build to `dist`; no function routes | Suitable for static hosting. Does not supply processing infrastructure. |

## 2. End-to-end trace

### Ingestion and narration

`#file` / drop -> `add` -> `waitMedia` (`src/media/decoder.js`) -> File URL and video element -> `clips[]` -> thumbnail/list/select. Import limits are 100 clips, 512 MiB per clip, 1 GiB aggregate source file sizes. These are compressed-file limits, not RAM limits. Metadata contains duration, dimensions, size and MIME; `audio: 'unknown'`, `fps: null`, `rotation: null` are explicitly incomplete. There is no content hash or ffprobe inventory.

`loadAud` decodes narration into an AudioBuffer and measures activity; import limit is 100 MiB. Optional `whisperAlignWords` delegates to a worker, asks for model-download consent, reconciles words to script or accepted transcript, and validates times. The worker is English-only, q8, one WASM thread, 20-second inference chunks with stride. Full narration PCM is still prepared in memory. Neither activity-derived timings nor ASR output constitutes independently verified speech alignment.

### Footage and AI planning

Commentary `#sy` -> reviewed `buildStoryEdit`; `#st_go` -> the same builder. The compatibility `window.autoSyncAndEdit` path still exists. Both commentary selector modes expose the story controls. With no OpenRouter key, the builder automatically uses local heuristics and writes a transient fallback message; this is not an explicit user-selected offline mode despite README wording.

`buildStoryEdit` -> script/audio alignment -> heuristic `storySections` -> selected source pool -> `analyzeClipScenes` -> `sampleFootage` -> analysis Web Worker -> `shotPool`. Sampling uses 64x112 frames, up to 1,200 samples, and at most the first 900 seconds of a clip. Pixel differences/histograms/edges estimate cuts, motion, exposure and quiet regions. `action`, `events` and `steady` are motion-derived scores, not evidence of a win, goal, reaction, identity, or story outcome. Filename/tags feed `clipEvidence` keyword ranking. Brightness is approximately 0..255, while a continuity penalty compares a difference against 0.28; units need reconciliation.

With a key, `sampleStoryPlannerFrames` sends at most 16 midpoint images, stride-selected from all candidates, at width <=384. IDs and timestamps appear in an ordered textual list. No persistent observation records, coverage map, content hashes, or per-claim evidence references are created. Unsampled shots are still eligible. The first/middle/final action progression of a candidate is not guaranteed visible.

`runStoryPlanner` posts one multimodal request to OpenRouter. It asks for six beats, shot IDs/order/ranges/speed/camera/transition, payoff and checklist. `normalizeStoryPlan` coerces the response, drops unknown shot IDs and clamps section indices. `buildStoryEdit` adds a large ranking bonus for AI-preferred shots, then its own loop selects candidates and imposes equal-duration slots. Returned beats/payoff/checklist do not reach `stagePlan`, project persistence, the auditor, or the renderer.

### Review, timeline and export

`validateTimeline` mutates EDL segments to add IDs, asset references and ripple positions. `stagePlan` asserts locks and stores a transient proposal. `reviewedBuilder` snapshots/restores the project around generation to avoid changing the current edit. `renderPlan` shows narration, editable role, source dropdown, in/out inputs, timing and reasons. `plan_apply` revalidates and checks locks, asks before replacing an existing edit, then commits with undo.

Manual edits change draft ranges but do not recompute displayed timing/coverage until rerender or application. The viewer has no evidence thumbnails, preserved AI beat/payoff/checklist, model provenance, rendered draft preview or revision-bound approval. Generic reason suffixes label every non-keyword choice as semantically unverified, including AI choices, rather than showing actual evidence quality.

`previewCommentary` mixes audio and runs `storyFrame`; `render` checks timeline/caption state and codec support, mixes audio, composes frames at 30 fps, encodes H.264/AAC, muxes MP4, and calls `verifyExport`. Ordinary export holds output in memory; direct-file export uses File System Access where supported. Resolution choices are 360x640, 720x1280 and 1080x1920; duration is capped at 300 seconds.

Current transitions belong to the incoming shot and do not shorten timeline duration. Offline rendering replays the outgoing shot's final transition window while blending the incoming window. Live same-source preview can freeze a captured outgoing frame because there is only one video element per source. A standard overlapping FFmpeg xfade would change these semantics unless explicitly adapted. `LIMITATIONS.md` describes a frozen outgoing export frame, which no longer matches `storyFrame`.

`verifyExport` checks MP4 signature, duration within 0.3s, and first/middle/end decode. It does not validate full audio/video decoding, speech accuracy, meaning, or every visual effect.

### Final-export audit

Successful `render` stores `lastExportBlob` and `auditSourceSnapshot` in memory. The audit panel samples the final Blob and calls `runStoryAudit`, which extracts script beats and requests a multimodal report. Reports and export references are lost on reload. After another project is loaded, the last-export globals can still refer to the older export; there is no project/revision association.

## 3. Findings and disposition

Priority: P0 = blocks the advertised flow; P1 = correctness/reliability before dependable AI editing; P2 = maintainability or scale. “Code-confirmed” means traced in source, not demonstrated against a live model.

| ID | Priority / evidence | Finding and impact | Action / milestone |
| --- | --- | --- | --- |
| A01 | P0, code-confirmed + function guard exercised | `installStoryAuditor` reads `apiKey` but omits it from `runStoryAudit({...})`. After sampling, the guard always rejects the UI call as missing credentials. | Repair propagation and add mocked UI-to-request coverage, M1. |
| A02 | P1, code-confirmed + normalization exercised | Unknown shot IDs are silently removed; invalid section IDs are clamped; empty/partial plans are accepted. An unknown-only response normalizes to `shotPlan: []`; the caller fills sections locally. | Reject unusable AI output without altering current timeline; explicit offline choice, M1; full decision compiler, M5. |
| A03 | P1, code-confirmed | AI beats, payoff and checklist are discarded. Decisions are score bonuses, not an authoritative plan. Max five equal slots per heuristic section; repeated candidate use is rejected even if AI requests another valid subrange. | Preserve complete decisions and implement deterministic compilation, M2/M5. |
| A04 | P1, code-confirmed | AI `close` maps to role `climax`, which `pickStoryCamera` returns as wide. Several camera values do not map distinctly. AI `cut` cannot undo an existing cinematic dissolve; preset hard-cuts can also override transitions. | Explicit renderer capabilities and conflict diagnostics; numeric framing contract, M5/M6. |
| A05 | P1, code-confirmed | Returned source range/speed are modified to fit slots. Too-short footage at minimum speed can leave picture shorter than narration; last-frame holding hides missing story coverage. | Frame-count/coverage invariant; explicit hold decision only, M2/M5. |
| A06 | P1, code-confirmed | No runtime JSON-schema validation; permissive JSON extraction/defaults can hide invalid model output. Audit accepts PASS alongside a high-severity issue; an existing unit test even supplies that combination. No structured issue certainty field. | Strict schemas, separate semantic validation, deterministic verdict guardrails, M1/M8. |
| A07 | P1, code-confirmed | HTTP fetch has no deadline, caller cancellation, rate-limit schedule, request/response byte budget, actual-model metadata retention or durable retry state. A schema-format error causes a retry without format, but the schema is not copied into the prompt. | Shared OpenRouter provider and bounded requests, M1; durable retries, M3/M8. |
| A08 | P1, code-confirmed | Free-model discovery treats missing pricing fields as free. Model selector accepts text-only or paid IDs unchecked. | Require current capabilities and known zero pricing for free-only mode; no paid fallback, M1. |
| A09 | P1, code-confirmed | Sparse midpoint images, unbounded source inventory text, index-derived shot IDs, no persisted observations/coverage/confidence. A single image cannot prove chronology/action. | Stable evidence IDs, timestamps and multi-frame inspection, M4/M5. |
| A10 | P1, code-confirmed | Audit images are sent without their timestamp/reason text mapping. Beat extraction occurs after sampling and no beats are supplied to that sampler; claimed beat-boundary sampling is disconnected. High motion is not analyzed in the exported file; short EDL shots are only a proxy. | Associate each image with its evidence record and sample after beat creation, M8; mapping repair in M1. |
| A11 | P1, code-confirmed risk, not reproduced | Audit sampler uses its own loadedmetadata/seeked promises with no timeout/cancel/presentation check or same-position shortcut. Can stall or sample a stale frame. `normalizeAudit` supplies defaults instead of proving evidence completeness. | Reuse hardened decoder helpers, explicit timeout/coverage failure, M1/M8. |
| A12 | P1, code-confirmed | `validateTimeline` protects source/speed bounds and assigns stable asset IDs, but not all enums/framing/effects, declared narration coverage, evidence refs, revision freshness or target renderer compatibility. It mutates inputs. | Retain legacy behavior behind adapter; add pure shared validator, M2. |
| A13 | P1, code-confirmed | Plan draft and AI state are transient; timings stale after field changes; no preview-before-approval or immutable approval hash. | Revisioned drafts, evidence viewer and approval-bound renders, M2/M7. |
| A14 | P1, code-confirmed | Global busy/cancel flags and DOM interception gate unrelated work; AI audit has a separate busy flag. There are no persisted jobs or recovery. | Isolated services and single-worker durable job state, M3/M8. |
| A15 | P1, code-confirmed | No ffprobe/native FFmpeg pipeline exists despite FFmpeg being installed on this machine. Browser codec support and lifetime remain export prerequisites. | Separate optional local processing service; retain browser export, M3/M6. |
| A16 | P1, code-confirmed | Project metadata uses one autosave key; source identity relies on filename/size/duration, not hash. Analysis/AI result/approval/output are not persisted. | Versioned project repository and content-addressed artifacts, M2/M3/M8. |
| A17 | P2, code-confirmed | Planner/no-key fallback can still be called “AI” in labels. Old Step 3 `variety_engine`/`multi_clip` controls belong to legacy auto-edit, while new planner uses `st_*`. `st_pace` is not explicitly passed to OpenRouter. | Make execution mode and supported settings explicit; no visual redesign, M1/M5. |
| A18 | P2, observed environment | Build/tests resolve Vite from ancestor `F:/apps/SkimStudio/node_modules`. `npm ls --depth=0` reports unmet local dependencies despite passing build. A tracked lockfile exists. | Prove isolated `npm ci` reproducibility in M1; do not treat ancestor success as clean-install verification. |

## 4. Resource and maintenance constraints

- Browser analysis retains up to 1,200 small grayscale arrays and clones them to a worker; decoding/seeking remains on the main browser path. Cache validity is per-clip object, not media+algorithm hash.
- Audio export builds a complete 48 kHz stereo float mix: 300 seconds alone is about 110 MiB before channel copies/encoder input, decoded source audio, narration and reverse buffers. Its 256 MiB decoded-source check occurs after decode allocation; it is not a process memory ceiling.
- Reverse preview caches up to 80 canvases per eight-second shot, height up to 720; multiple shots can accumulate. Large landscape frames can still consume substantial memory.
- Up to 100 preloaded video elements, in-memory MP4, Base64 image strings and snapshots compete with ASR memory. No measured 4 GiB profile exists. Do not solve this with browser FFmpeg WASM plus a vision LLM.
- Global `Object.assign(window, ...)`, inline HTML handlers, wrapped/reassigned functions and DOM-derived snapshots make ownership hard to test. Incremental adapters avoid breaking working editing features.
- Two HTML files duplicate controls and can drift. Keep both until a later shared-template cleanup is justified; test both when changing IDs/controls.
- Existing dependencies are small in count, not all small in runtime footprint. Keep Vite, Playwright, bundled Montserrat and optional Transformers.js. Build emitted a 26.9 MB ONNX WASM asset and approximately 588 KB Transformers chunk. Keep ASR lazy and serialized. Do not add a provider SDK, full UI framework, Redis, Docker or ffmpeg.wasm as baseline requirements.
- Vendored `src/vendor/mp4-muxer.js` is used; preserve it, then verify upstream version/license provenance before packaging a new distribution. Existing archive/release artifacts are not authoritative source or deployment proof.

## 5. Preserve / refactor / replace

| Preserve | Refactor behind interfaces | Replace in the new primary pipeline |
| --- | --- | --- |
| Working import/seek/lifecycle helpers; caption timing, pause guards and preset tests | `main.js` orchestration into project, planning, jobs, review and rendering services | Implicit local fallback pretending to be AI; reject invalid AI proposals |
| Timeline lock tests, history, indexed lookup and transition math | Legacy EDL via v1 adapter to a versioned canonical timeline | Keyword/motion scoring as semantic truth; use timestamped visual observations |
| Canvas/WebCodecs compositor/export as compatibility renderer | Shared validated layout/timing settings and renderer capability checks | Browser-only processing as the sole way to generate final output; add native FFmpeg |
| Plan approval and undo affordances, current visual design | Plan Viewer reads immutable revisions and evidence | Transient drafts/jobs and last-export globals as authoritative state |
| IndexedDB metadata experience and project JSON portability | Multi-project stores, migration, explicit settings allowlist | ID-prefix-only credential exclusion as the long-term security boundary |

## 6. Verification and confidence

Fresh checks: 72/72 Node tests passed; Vite production build passed for both HTML entries. Two existing Chrome tests reported passing: import/review/persistence/MP4 export (8.6s), and worker analysis/multi-clip/manual-caption preservation (4.7s). The Playwright command did not finish server teardown and was interrupted after both test passes; this is not a clean successful runner exit. No live OpenRouter request, full-browser suite, new ASR inference, memory benchmark or FFmpeg render was performed.

Direct function checks confirmed unknown-only planner output becomes an empty plan and missing-key audit calls reject. Local ffmpeg/ffprobe 9.0.2 are available; ffprobe read the included source fixture as 3s, 180x320, H.264, 30/1 fps, AAC. That verifies local binary discovery/probing, not app integration. Fixtures are synthetic patterns and tones, not a semantic editing or transcription benchmark.

Existing README claims about full AI control, explicit fallback and audit sampling overstate the implementation. Earlier conversational claims of end-to-end AI completion are not verification evidence. Use this audit/status as the baseline until the roadmap acceptance gates are met.
