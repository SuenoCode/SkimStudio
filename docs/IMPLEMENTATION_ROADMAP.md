# Implementation roadmap

Baseline: `ed4f493`, audited 2026-10-19. No implementation milestone was started during the documentation audit. Follow [ARCHITECTURE.md](ARCHITECTURE.md) contracts and [ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md) finding IDs. Paths marked **new** are proposed files to create; other paths exist.

## Execution rules and dependency order

Work serially: **M1 -> M2 -> M3 -> M4 -> M5 -> M6 -> M7 -> M8**. M9 is optional after M8 and is not required for a fully functional local editor. Finish and record each milestone's acceptance results before starting the next. Do not add an entire backend or rewrite `main.js` in M1. Keep legacy browser workflows operational behind adapters throughout.

An acceptance test is an observable behavior, not a check that a particular function name exists. Mock paid/external calls in required automated tests. Live model quality tests are opt-in and separate from transport/contract tests. Do not claim a skipped speech test, a passing build or a UI label verifies semantic editing. Fix the known browser-runner teardown before treating its process exit as a clean gate.

| Milestone | Deliverable | Dependencies / exit boundary |
| --- | --- | --- |
| M1 | Honest, bounded and testable OpenRouter integration | Current app; no worker |
| M2 | Shared contracts and revisioned project/timeline ownership | M1; adapters preserve old rendering |
| M3 | Local worker, streamed ingestion, probe and durable jobs | M2; no AI decision compiler yet |
| M4 | Timestamped evidence and speech-analysis pipeline | M3; real media provenance |
| M5 | Evidence-grounded AI decisions compiled into timeline | M4; no heuristic replacement of AI decisions |
| M6 | Executable bounded FFmpeg preview/final renderer | M5; CLI/protocol integration verified |
| M7 | Interactive draft review, preview and approval workflow | M6; end-to-end local AI editor |
| M8 | Final-output audit, recovery, caching and 4 GiB hardening | M7; reliable release candidate |
| M9 | Optional authenticated hosted control/remote processing | M8; not needed for no-payment local baseline |

## M1 — Repair the OpenRouter boundary and expose actual behavior

Implementation directive adjustment: the user now requires server-only environment credentials. The key-field UI tests below are replaced with local gateway authorization tests plus browser tests proving no credential is present. M1 includes the minimal loopback Vite gateway (`server/aiGateway.js`), `src/ai/proxyClient.js`, `src/ai/schemas.js`, `.env.example`, and test-server/live-check scripts. This does not begin M3 media processing or M9 hosted deployment. Genuine live API verification is required before M1 is marked fully accepted; missing credentials remain an explicit blocker.

**Dependencies:** none beyond the audited repository. Findings A01, A02, A06-A08, A10-A11 and A17. This is the next concrete development task.

**Exact modules:** modify `src/audit/storyAuditor.js`, `src/main.js` (`installStoryAuditor`, OpenRouter block in `buildStoryEdit`, `reviewedBuilder`), `index.html`, `SkimStudio_Enhanced.html`, `tests/storyAuditor.test.js`, `playwright.config.js`, `README.md`, `LIMITATIONS.md`, `package.json`, `package-lock.json`. Add **new** `src/ai/provider.js`, `src/ai/openrouter.js`, `src/ai/requestPolicy.js`, `src/ai/validateResponse.js`, `tests/openrouter.test.js`, `tests/ai.browser.spec.js`. Update the Playwright testMatch to include the new spec; add shared schema engine dependency only as needed, not an SDK/framework.

**Features and integration:**

1. Extract existing chat HTTP/JSON handling to an injected transport with explicit model capabilities, deadline, cancellation, bounded response bytes, schema validation, actual-model metadata and typed errors. Keep planner/auditor public call shapes compatible initially. Provide explicit origin/title instead of assuming browser `location`.
2. Resolve OPENROUTER_API_KEY only on the local server and validate server configuration before sampling. Remove frontend provider-key controls. Verify that the server credential reaches OpenRouter and never enters browser assets/requests, snapshots, history, autosave or project exports.
3. Reject malformed/empty/partial executable AI plans, invalid IDs and out-of-range sections before the local selection loop. Keep valid current-schema proposals working; do not claim this intermediate loop is the final AI compiler. Surface invalid output without committing or replacing shots silently.
4. Make local/offline planning an explicit mode or explicit fallback action. Missing key, provider error or invalid output cannot silently produce a plan labeled OpenRouter. Keep optional speech-estimation fallback separately labeled; it is not AI-provider fallback.
5. Pair each audit image with its timestamp/evidence text; reuse decoder helpers for timeout, cancellation and same-position seeks. Fix beat-before-sampling ordering or remove unsupported sampling claims until M8.
6. Enforce image capability and known zero pricing under free-only mode. Schema-less provider retry must include the schema in the prompt and still validate. Limit retries and preserve `Retry-After`; do not retry auth/quota exhaustion blindly.
7. Establish clean local dependency installation from the tracked lockfile in an isolated checkout and repair Playwright server shutdown without killing unrelated Node processes. Do not modify the user's ancestor dependency installation.

**Acceptance tests:**

- Audit UI flow in both entry pages: export a real fixture MP4, click audit, intercept the two local API responses as explicitly labeled test data, verify image/timestamp associations, displayed report and download. A separate HTTP gateway integration test proves server-only Authorization forwarding. No browser key and no live API expense in these deterministic tests.
- Mocked planner: a valid response reaches review; unknown shot ID, invalid section, empty plan, truncated JSON, invalid enums and malformed schema leave the existing timeline unchanged and show actionable error.
- 401 stops immediately; 429 honors retry time and attempt cap; timeout/cancel releases busy state; text-only model with images fails before inference; unknown/nonzero pricing is not classified free.
- Search serialized autosave and exported project data for a fake credential marker: absent. Assert actual returned model metadata is retained in the result.
- Existing Node suite/build pass, relevant browser regression passes and the runner exits on its own. Clean `npm ci` + build uses project-local dependencies.

**Definition of done:** transport and UI wiring are verified without external credentials; invalid AI output cannot masquerade as a successful AI edit; current limitations are accurately stated. Record results in IMPLEMENTATION_STATUS. No native worker/schema-v2 migration in this milestone.

**Potential failure points:** model catalog reports incomplete pricing; schema support varies; provider response is truncated; a test accidentally exercises no-key local fallback; project snapshot convention leaks a new key field; Playwright process ownership on Windows. All must be diagnosed explicitly, not hidden by passing normalizer tests.

**Suggested implementation order within M1:** first write failing mocked audit test for A01; extract provider without changing domain logic; fix credential propagation; enforce runtime response checks; introduce explicit offline mode; harden sampling/request lifecycle; verify isolated install and clean test teardown. Commit only the completed M1 scope.

## M2 — Shared contracts and a single project/timeline authority

**Dependencies:** M1. Findings A03, A05, A12-A13, A16.

**Exact modules:** add **new** `shared/contracts/{media,evidence,decision,timeline,project,job,audit}.schema.json`, `shared/contracts/validate.js`, `shared/time.js`, `shared/hash.js`, `src/core/projectStore.js`, `src/core/legacyAdapter.js`, `src/core/editingOperations.js`, `tests/contracts.test.js`, `tests/projectMigration.test.js`. Modify `src/core/project.js`, `src/core/validation.js`, `src/core/history.js`, `src/core/timelineIndex.js`, `src/storage/indexedDb.js`, `src/main.js` snapshot/restore/stage/apply/structural-edit seams, and `package.json`/lockfile if the shared validator is not already present.

**Features:** implement the v2 contracts, integer time rules, revision/input hashes, structured validation diagnostics, immutable draft/proposal/approval records and explicit settings allowlist. Add multi-project IndexedDB stores, backups and migration from v1. Unknown media details remain unknown until probe; no fabricated fps/rotation/evidence. Legacy adapter supplies derived EDL to current renderer. Editing operations clone, validate and commit atomically with lock enforcement and undo.

**Integration:** browser components read the new project store after migration; current `clips[]` becomes a runtime/legacy view with DOM/File handles outside serialized state. Store the complete AI proposal even before M5 replaces the current compiler. Do not run two independent timeline authorities. Persist drafts with evidence refs, not image Base64. Clear or correctly associate old export/audit state on project changes.

**Acceptance tests:** v1 import/export and undo roundtrip preserve caption timings/manual locks; old settings do not persist credentials; pure validator does not mutate rejected data; invalid trim or locked-position shift makes no partial changes; long sequences do not accumulate frame drift; stale base revision returns conflict; changed narration/media/settings invalidate proposal/approval; project switching cannot audit another project's output as current.

**Definition of done:** one versioned project/timeline authority controls both entry pages and browser rendering through adapters; legacy fixtures still play/export; approval/draft hashes are reproducible across browser/Node.

**Potential failure points:** v1 source indexes change after removal; preset ownership/custom settings lost in migration; seconds-to-frame rounding shifts captions; legacy transition semantics accidentally converted to overlap; DOM snapshot and store diverge.

## M3 — Local worker, media ingestion and durable job foundation

**Dependencies:** M2. Findings A14-A16, A18.

**Exact modules:** add **new** `worker/server.js`, `worker/routes.js`, `worker/config.js`, `worker/security/session.js`, `worker/security/credentials.js`, `worker/media/{ingest,probe,hash,proxy}.js`, `worker/storage/{projectRepository,artifactStore,jobRepository}.js`, `worker/jobs/{queue,runner}.js`, `worker/process/spawn.js`, `src/media/workerClient.js`, `tests/workerProtocol.test.js`, `tests/workerMedia.test.js`. Modify `package.json`, `package-lock.json`, `vite.config.js`, `.gitignore`, `src/main.js` ingestion/capability seam, and setup instructions in `README.md`. Generated project/media/job data must be outside tracked source or explicitly ignored. Keep worker out of the Vercel frontend bundle.

**Features:** same-origin local editor hosting and loopback `/v1` protocol; sessions with strict origin/host checks; streaming chunk uploads, hashing, ffprobe metadata; managed paths; local project/artifact manifests; one worker lock; serialized durable jobs with cancel/interrupted/retry states; process-tree cleanup and version/capability checks. Support process/memory-only credentials first. Add secure Windows credential-store adapter only if verified; otherwise keep persistence unavailable, not plaintext fallback.

**Integration:** worker imports shared contracts, provider and job policy; frontend discovers capabilities and explicitly connects. Vite dev proxy enables local development without changing Vercel behavior. Source media IDs resolve in worker storage; frontend File/Blob URLs remain preview conveniences. Native FFmpeg/probe errors report missing executable or unsupported build. No local process is launched by the browser without the user starting the worker.

**Acceptance tests:** Windows paths with spaces, Unicode and shell metacharacters ingest safely; chunks retry idempotently; partial/corrupt uploads never finalize; ffprobe detects audio/rotation/VFR metadata; reimport hash matches; invalid Origin/token/path traversal rejected; restart retains project and queued job, marks running job interrupted; duplicate job key deduplicates; cancel stops only owned child processes; FFmpeg missing is actionable; original files survive cleanup. Verify worker-served UI independently of hosted-to-local pairing.

**Definition of done:** worker runs with documented Windows commands, serves the existing editor, accepts media in bounded chunks and executes recoverable probe/proxy jobs; no cloud account required. Actual inference/rendering pipeline remains future work.

**Potential failure points:** native FFmpeg build/filter variation, long Windows paths, antivirus file locks, full disk, duplicate worker instance, browser local-network restrictions, accidental secrets in logs/manifests. An HTTPS-hosted page failing to reach localhost does not block the same-origin local workflow.

## M4 — Grounded video evidence and speech analysis

**Dependencies:** M3. Findings A09-A10 and structural/semantic distinction.

**Exact modules:** add **new** `worker/analysis/{scenes,frames,audio,transcribe,evidence}.js`, `src/analysis/evidenceStore.js`, `tests/evidence.test.js`, `tests/evidenceWorker.test.js`, `tests/fixtures/evidence/README.md` and generated/consented labeled fixtures. Modify `src/analysis/sceneAnalysis.js`, `src/analysis/workerClient.js`, `src/workers/alignment.worker.js` only where needed for adapter/cancellation, `src/ai/openrouter.js`, and `worker/jobs/runner.js`. Reuse `src/captions/activity.js`, `alignedCues.js`, `timing.js` rather than duplicating timing rules.

**Features:** native sequential scene signals/frame extraction, real source timestamps, normalized orientation, hash/version cache, clip-balanced adaptive samples, explicit temporal coverage. Vision observations cite exact frame IDs; metadata names are annotations, never proof. Add speech adapter returning measured ASR/imported/estimated provenance. Native quantized small ASR is optional; browser Whisper remains a separate compatibility route. Serialize ASR with FFmpeg under low-RAM profile.

**Integration:** structural features shortlist evidence candidates; OpenRouter vision consumes bounded labeled images through M1 provider; text reasoning can consume only observations/transcripts/user notes. One-frame observations cannot assert motion/outcome chronology. Frame requests include final outcome areas and rapid edits, and missing/uncertain evidence schedules additional sampling only within quota. Clip-level hashes invalidate evidence after replacement.

**Acceptance tests:** a fixture with an outcome between midpoint frames is either captured through adaptive sampling or explicitly flagged as uncovered; motion/static tests preserve existing behavior; frames record correct source timestamps after rotation/VFR proxying; a misleading filename does not become an observed label; text-only route receives no images; absent audio stays absent; ASR text errors retain mismatch diagnostics; quota outage preserves extracted evidence for resume; measured peak memory satisfies the declared low-memory extraction profile.

**Definition of done:** every semantic observation has an inspectable source artifact and provenance; coverage/uncertainty are persisted; speech limitations are measurable rather than concealed. Mocked vision tests establish plumbing; live model correctness remains separately evaluated.

**Potential failure points:** transition false positives, VFR mapping errors, rapid events missed by sparse sampling, ASR language/model quality, full PCM duplication, provider interpretation mistakes, inference costs caused by over-sampling. Never equate visual model confidence with ground truth.

## M5 — OpenRouter decisions and deterministic timeline compilation

**Dependencies:** M4. Findings A02-A06, A12 and A17.

**Exact modules:** add **new** `src/planning/{prompts,planService,decisionCompiler}.js`, `tests/decisionCompiler.test.js`, `tests/planningIntegration.test.js`. Modify `src/main.js` (`buildStoryEdit` integration only), `src/audit/storyAuditor.js` to delegate planning, `src/core/projectStore.js`, `worker/jobs/runner.js`, `src/analysis/shotRanking.js` to remain offline/shortlisting-only, and decision/timeline contracts if justified by versioned tests.

**Features:** send actual user intent/pacing/constraints, narration timings, locked intervals, renderer capabilities and evidence to OpenRouter. Persist beats, payoff, checklist, evidence-linked choices and actual model. Compile valid source order/in/out/speed directly instead of injecting ranking bonuses. Support deliberate source reuse with cited rationale. Missing evidence yields an incomplete proposal/gap, not invented support. Use one bounded repair request for validation failures.

**Integration:** shared validation and compiler run in browser tests/worker without DOM. Caption timing stays anchored to narration; the AI cannot fabricate spoken word timing. Compiler must cover each narration interval or reject/require explicit hold. Proposed camera/transition choices become supported numeric operations or diagnostics; local presets cannot silently override them. Current timeline changes only through review/apply operations.

**Acceptance tests:** mocked AI returns source B then A; compiled timeline preserves that order/ranges; invalid ID/enum/bounds/evidence/fake certainty is rejected atomically; same asset can be reused at a valid different range; locked absolute positions survive; too-short source and contradictory duration produce errors, not hidden freeze-tail; selected camera and hard cut reach renderer parameters; stale plan cannot replace newer script/media; valid gap response is reviewable but not render-approved.

**Definition of done:** OpenRouter is the editorial decision maker in AI mode, compiler behavior is deterministic and evidence-traceable, and every local adjustment is visible. Offline heuristics remain clearly separate. The complete proposal survives reload and drives the timeline.

**Potential failure points:** free model cannot return a long complete plan; competing timing constraints; duplicate sources/evidence from another revision; uncertain payoff; excessive JSON tokens. Chunk reasoning by beat and merge deterministically, preserving global coverage/locks rather than accepting partial output.

## M6 — Native FFmpeg preview and final renderer

**Dependencies:** M5. Findings A05, A15 and renderer/resource gaps.

**Exact modules:** add **new** `src/export/{renderer,browserRenderer,workerRenderer}.js`, `worker/render/{capabilities,compile,run,verify,captions}.js`, `tests/ffmpegRender.test.js`, `tests/renderParity.test.js`. Modify `worker/jobs/runner.js`, `worker/process/spawn.js`, `src/main.js` render/compose integration seams and `src/export/capabilities.js` only to expose browser capabilities. Reuse `src/core/transitions.js` and caption timing contracts; preserve Canvas implementations.

**Features:** real FFmpeg render compilation for the initial profile defined in ARCHITECTURE: trims, speed, crop/scale, contiguous placement, explicit holds, audio policy, supported basic captions, H.264/AAC; then validated incoming-window transitions. Disk-backed short intermediates bound memory. Preview/final differ only in declared resolution/encoding quality. Verify output before success. Renderer rejects unsupported legacy effects or offers explicit browser rendering/style change.

**Integration:** jobs consume an immutable timeline hash and worker-owned asset IDs, never raw model text/paths. Final render requires matching approval; protocol tests may create approval fixtures before the M7 UI is connected. Browser export stays functional for existing presets. Segment/artifact hash includes renderer/filter/font versions; no stale render cache.

**Acceptance tests:** render multiple actual clips with trim/speed/crop/caption/audio; ffprobe and full-decode verify streams, duration/frame count and synchronization markers; source bounds such as 8.659186s never overflow; compare preview/final framing/caption timing and transition boundary frames; no timeline shortening from xfade; speed audio policy matches declaration; unsupported preset fails before starting a long job; cancellation/full disk/corrupt media/missing font produces terminal error, not success; Windows command characters are harmless; measure process-tree memory.

**Definition of done:** a validated AI-generated timeline produces a playable FFmpeg preview and final MP4 under the baseline resource budget; output is tied to input hashes and passes independent media verification. Unsupported features are explicit. This gate proves executable media rendering, not perfect story quality.

**Potential failure points:** VFR/rotation/color handling, AAC padding, ASS/Canvas font differences, unsupported filters, repeated encode quality loss, large filtergraphs, process cleanup, source-audio time stretching. Support scope must stay narrow until measured.

## M7 — Interactive Plan Viewer and approval-driven execution

**Dependencies:** M6. Finding A13.

**Exact modules:** add **new** `src/ui/planViewer.js`, `tests/planViewer.browser.spec.js`. Modify `src/main.js` (`stagePlan`, `renderPlan`, apply/cancel handlers), `src/ui/simple-editor.js` service bindings, `index.html`, `SkimStudio_Enhanced.html` plan dialog content only, `src/core/editingOperations.js`, `src/core/projectStore.js`, `src/media/workerClient.js`, Playwright testMatch. No visual redesign.

**Features:** bind existing viewer to persisted draft, narration beats and actual evidence images/timestamps; show confidence/gaps/selection reasons, model and payoff. Editing range/source/order recalculates displayed timing/coverage immediately. Draft preview plays the M6 artifact. Approve exact current timeline/profile; final render button submits approval reference. Display progress and resume job state after reconnect.

**Integration:** edits use validated commands, not direct object mutation. Human replacement marks evidence/rationale for reassessment; existing lock/undo behavior retained. All unresolved blocking gaps/unsupported effects are addressed before approval. A user editing while preview runs invalidates that preview for approval without losing it as history.

**Acceptance tests:** full import -> analysis -> mocked OpenRouter -> draft -> FFmpeg preview -> edit -> refreshed preview -> approve -> final render path; evidence click opens correct source time; invalid ranges are rejected with visible diagnostics; source/range edits refresh coverage; stale preview cannot approve new draft; changes after approval disable final job submission; reload restores draft/job; locked shot changes fail without mutation; both HTML entry points work.

**Definition of done:** another user can complete the entire local AI editing sequence from the app, inspect why each shot was chosen, approve the actual preview and obtain the corresponding final video. No manual copying of AI JSON or terminal rendering is required.

**Potential failure points:** async stale state, dialog ownership, simultaneous tab updates, orphan jobs, confusing heuristic/AI labels, claims of visual certainty unsupported by shown evidence.

## M8 — Audit, recovery, caching and resource acceptance

**Dependencies:** M7. Findings A06, A10-A11, A14-A16 and low-RAM constraints.

**Exact modules:** add **new** `src/audit/auditService.js`, `worker/analysis/finalExport.js`, `tests/auditIntegration.test.js`, `tests/jobRecovery.test.js`, `tests/resourceProfile.test.js`. Modify `src/audit/storyAuditor.js`, `src/main.js` audit panel binding, `worker/jobs/{queue,runner}.js`, `worker/storage/{artifactStore,jobRepository,projectRepository}.js`, `src/analysis/evidenceStore.js`, audit contract, and `docs/IMPLEMENTATION_STATUS.md` with measured release evidence.

**Features:** audit the actual final artifact against persisted approved beats/payoff, sample after beat construction, include frame timestamps and explicit mismatch certainty. Optional final-audio extraction/ASR must reference actual output audio, not simply reuse source transcript as proof. Persist downloadable report without keys. Add deterministic PASS/NEEDS_REVISION/FAIL consistency checks. Suggestions create new drafts; never auto-apply.

Hash-based cache and changed-section invalidation include neighboring transition handles, affected narration/captions and global payoff consistency. Long jobs use bounded evidence/beat chunks. Persist retry/backoff/interrupt state and deduplicate restarts. Quota exhaustion remains recoverable without losing media/evidence/draft. Add disk cache cleanup and memory admission controls.

**Acceptance tests:** deliberately swapped shot and missing payoff are visible in report with correct timestamp/evidence; fake unsupported PASS is downgraded/rejected by verdict rules; sparse or unreadable evidence prevents unwarranted certainty; audio mismatch is detected only when final-audio evidence exists; report survives reload; changed media/script invalidates affected evidence/plans/renders; interrupt worker mid-render then recover without duplicate publication; verify output cannot be labeled latest after project switch; 60-second and then 300-second low-RAM cases record peak working set, elapsed time, disk, decode validity and cancellation responsiveness. Live semantic benchmark uses consenting/labeled media and records actual model, quota failures and reviewer assessment separately.

**Definition of done:** local pipeline has restartable jobs, bounded resource behavior on the approximately 4 GiB target, actual-output audit and documented model/coverage limitations. Automation and human benchmark evidence support each public capability claim.

**Potential failure points:** free model inconsistency, sparse evidence giving false PASS, output audio transcription cost, cache poisoning/cross-project leakage, eviction of referenced originals, nondeterministic effects, unavailable long-duration capacity. Do not claim scalable unlimited use from a single successful short clip.

## M9 — Optional hosted API / remote worker

**Dependencies:** M8 and an actual deployment requirement; skip for baseline personal/local delivery.

**Exact modules:** add **new** `api/ai/complete.js`, `api/ai/models.js`, `api/auth/session.js`, `api/limits/requestBudget.js`, `tests/hostedBoundary.test.js`; extend `worker/security/session.js`, `worker/routes.js`, `src/media/workerClient.js`, `vercel.json` and deployment instructions. Any external auth/storage adapter must be selected explicitly at this stage, with verified free-tier limits and no mandatory paid dependency.

**Features/integration:** authenticated bounded AI proxy, per-user authorization/quotas and encrypted credential references; optional remote worker on user-owned hardware with TLS; direct media transfer to worker/object storage rather than Vercel Functions. Serverless requests enqueue only through a durable worker/repository, never process-local arrays. Preserve same-origin local mode if hosted pairing is unavailable. No multi-tenant key storage until identity and isolation are verified.

**Acceptance tests:** unauthenticated and cross-project access denied; <=2 MiB body cap; no credentials in bundle/logs; no source video via serverless routes; timeout/retry idempotency; free model unavailable without paid fallback; hosted-to-local origin policy tested in supported browsers with documented local-editor fallback; deployment respects personal-use eligibility and measured quotas.

**Definition of done:** optional deployment can be operated securely within documented limits, without changing local core contracts or making a paid platform necessary. Hosting is not advertised as free always-on video processing.

**Potential failure points:** per-instance rate counters on serverless, idle remote worker, storage egress/quota, public shared proxy abuse, cross-tenant caches, mixed-content/local-network restrictions, secret ownership and Hobby eligibility.

## Handoff after each milestone

Update IMPLEMENTATION_STATUS with exact commit, commands/results, skipped/external tests, known remaining defects and next ready milestone. Keep ARCHITECTURE current if contracts change, with a migration explanation. Preserve working user changes and legacy exports. Do not mark an implementation milestone complete merely because a schema file, UI label, mock or build exists.
