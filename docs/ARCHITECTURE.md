# SkimStudio target architecture

Design dated 2026-10-19. This document specifies proposed behavior, not implemented capabilities. Current facts are in [ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md); delivery gates are in [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).

M1 implementation directive: credentials must never be present in the frontend. This supersedes the original memory-only browser-BYOK option. M1 adds a local-only Vite Node gateway using OPENROUTER_API_KEY/OPENROUTER_MODEL; it is not the media worker or the authenticated hosted API. Live acceptance is tracked separately in IMPLEMENTATION_STATUS.

## 1. Decisions

1. Retain the vanilla JavaScript/Vite frontend, existing caption work and browser renderer. Extract modules by workflow boundary; do not replace the UI or rewrite `main.js` wholesale.
2. Make OpenRouter the primary reasoning provider. A model returns a complete proposal supported by media evidence; a deterministic compiler validates and executes it. Heuristic editing remains an explicitly selected offline mode, never a silent substitute for a failed AI request.
3. Introduce a separate Node.js local worker using installed `ffmpeg.exe` and `ffprobe.exe`. It owns large files, analysis jobs, FFmpeg preview/final rendering and durable artifacts. It serves the built editor locally for a reliable same-origin workflow on Windows.
4. Vercel hosts static assets. An optional authenticated serverless API can proxy bounded AI requests/control messages; it never processes or transports source videos or runs the media pipeline.
5. Use one versioned, immutable project/timeline contract across browser and worker. Preserve the v1 EDL through an adapter. All plans, previews and approvals carry project/input revisions and content hashes.
6. Preview and final output use the same renderer/compiler and edit hash. A preview rendered by the browser is not evidence of exact FFmpeg output. Unsupported effects are reported before rendering, not dropped.
7. Baseline operation requires no paid service, Docker, Redis, hosted database, GPU or always-on remote worker. Free model availability and quality are external constraints; manual editing and saved work remain usable during outages.

## 2. Execution placement

| Subsystem | Frontend | Optional serverless API | Local / optional remote worker |
| --- | --- | --- | --- |
| Ingestion | File selection, immediate browser preview, streamed transfer or portable package handoff | No media uploads | Stream to managed storage, SHA-256, ffprobe, integrity checks |
| Understanding | Show evidence/coverage; existing browser analysis and opt-in ASR remain compatibility options | Optional bounded AI transport only | Proxy/frame/audio extraction; structural scene analysis; sequential ASR; evidence cache |
| OpenRouter | Choose model/mode, progress, display errors; no provider credential | Authenticated personal deployment proxy if enabled | Preferred request owner in worker mode; credentials and rate scheduling stay here |
| Decisions | User intent/settings, inspect proposal | No editing state in function memory | Provider request, evidence grounding checks, deterministic compilation |
| Timeline | Interactive draft edits and immediate validation | Optional validated metadata commands | Revalidate schema, assets, revisions and rendering capabilities at job boundary |
| Preview/final | Play returned MP4; browser renderer remains available | No FFmpeg/WebCodecs jobs | FFmpeg job, streamed progress, verification and output artifact |
| Persistence/jobs | IndexedDB cache, undo, portable exports | Only optional control plane with durable backing, never an in-memory queue | Project manifests, evidence, job records, outputs and recovery |

### Deployment modes

- **Browser compatibility:** Vercel static frontend, local files, existing WebCodecs renderer, explicitly selected offline planning. AI requires a server transport; no provider key is accepted by the browser. M1 supplies this through local Vite development/preview. Jobs surviving tab closure remain a worker responsibility.
- **Local worker (recommended complete free path):** run worker on `127.0.0.1`; it serves `dist` and `/v1` on the same origin, with a random session credential established on local launch. UI streams selected files to the worker. Browser keeps previews/metadata, worker owns originals/artifacts. Development uses Vite with a loopback proxy to `/v1`. No LAN listener by default.
- **Hosted UI plus worker:** optional explicit pairing to a loopback worker, strict Origin/Host checks and session token. HTTPS pages may encounter browser local-network permission/CORS/mixed-content restrictions. This path must be tested per supported browser. The reliable fallback is opening the worker-served editor and importing a portable project plus selected media; file handles and Blob URLs do not transfer between origins. Do not disable browser protections or rely on a public tunnel.
- **Remote worker (later, optional):** same protocol behind TLS, authentication, project-level authorization and per-user storage. May run on user-owned hardware. No assumed permanently free hosted compute or object storage. An unauthenticated shared API key proxy is forbidden.

### Vercel constraints

Official documentation checked 2026-10-19 lists Hobby Fluid Functions at 300 seconds maximum/default, 2 GB/1 vCPU, and a 4.5 MB request/response body limit. These limits do not make Functions a video worker. Keep optional API bodies <=2 MiB including Base64 overhead, validate byte size, and do not hold a render request open. A serverless invocation may finish or be retried without durable background work. [Vercel Functions limits](https://vercel.com/docs/functions/limitations)

Hobby is restricted to personal, non-commercial use and can pause services at usage limits. The no-payment deployment promise therefore covers local use and eligible personal hosting; commercial/shared deployment needs a separate hosting decision, not an assumed Hobby entitlement. [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)

## 3. Proposed module boundaries

New paths below are planned, not present at audit time. Keep ESM JavaScript plus JSDoc; no mandatory language/framework migration. Runtime JSON Schema validation should use one small shared validator (Ajv) introduced deliberately with lockfile updates.

| Module boundary | Paths | Responsibility and dependency rule |
| --- | --- | --- |
| Shared contracts | `shared/contracts/{media,evidence,decision,timeline,project,job,audit}.schema.json`, `shared/contracts/validate.js`, `shared/time.js`, `shared/hash.js` | Serializable types, pure validation, canonical hashing/time conversion; no DOM, fetch or filesystem |
| Provider | `src/ai/provider.js`, `src/ai/openrouter.js`, `src/ai/requestPolicy.js` | Capability discovery, bounded requests, parsed response metadata and typed errors; injected transport/origin; usable by Node and browser |
| Planning | `src/planning/{prompts,planService,decisionCompiler}.js` | Build evidence-grounded requests; validate/compile proposals; no renderer or UI writes |
| Media/evidence frontend | `src/media/workerClient.js`, existing decoder/lifecycle; `src/analysis/evidenceStore.js` | Worker transport and artifact references; compatibility analysis remains separate from semantic observations |
| Project/timeline | `src/core/{projectStore,legacyAdapter,editingOperations}.js`, existing validation/history/index | Immutable revisions and commands; translate to old EDL only at compatibility boundary |
| Review | `src/ui/planViewer.js` | Bind existing plan controls to draft/evidence/service; no provider calls or raw EDL mutation |
| Renderer frontend | `src/export/{renderer,browserRenderer,workerRenderer}.js` | Capability contracts, preview/final job invocation and verification result; wrap current renderer first |
| Audit | `src/audit/{storyAuditor,auditService}.js` | Reuse provider/evidence contracts; correlate exported artifact with approved intent |
| Worker host | `worker/{server,routes,config}.js`, `worker/security/{session,credentials}.js` | Local HTTP/static host, explicit endpoints, scoped authentication and path resolution |
| Worker ingest | `worker/media/{ingest,probe,hash,proxy}.js` | Streaming import, source inventory and normalized proxies |
| Worker evidence | `worker/analysis/{scenes,frames,audio,transcribe,evidence}.js` | Deterministic extraction plus optional ASR; model visual observations are stored with provenance |
| Worker state | `worker/storage/{projectRepository,artifactStore,jobRepository}.js`, `worker/jobs/{queue,runner}.js` | Single-owner atomic manifests, bounded jobs, recovery, cleanup |
| Worker render | `worker/render/{capabilities,compile,run,verify,captions}.js`, `worker/process/spawn.js` | Allowlisted FFmpeg graph compilation, subprocess lifecycle and media verification |
| Optional API | `api/ai/complete.js`, `api/ai/models.js` | Bounded authenticated provider proxy; shares provider, never imports media worker code |

`main.js` becomes a composition/integration layer gradually. Existing `src/core/project.js` continues reading v1 saves until migration is tested. The new canonical store is authoritative once M2 lands; mutable compatibility EDLs are derived copies, never a second independent source of truth.

## 4. Shared contracts and invariants

All envelopes include `schemaVersion`, `projectId`, `projectRevision`, `inputHash` and `createdAt`. Use UUID asset IDs and content hashes, never clip-array indexes across subsystem boundaries. Disallow unknown properties in executable objects. No object sent by a model may contain command strings, filesystem paths, fetch URLs or arbitrary filter graphs.

### Media and evidence

| Record | Required fields / semantics |
| --- | --- |
| `MediaAsset` | `assetId`, `sha256`, `byteLength`, `displayName`, `durationUs`, selected stream IDs, width/height, display rotation, sample aspect ratio, frame rate rational or unknown, time base, audio stream metadata, `probeVersion`, `state`. Local path is private worker metadata, not model input. |
| `MediaArtifact` | `artifactId`, source hash, kind (`proxy`, `frame`, `pcm`, `preview`, `final`), hash, byte length, extraction version/options, dimensions/timestamp where relevant. Browser uses authorized artifact IDs, not local paths. |
| `ShotCandidate` | `shotId`, asset ID/hash, source in/out microseconds, structural signals, evidence IDs, coverage state; boundary detection confidence is distinct from semantic confidence. |
| `EvidenceRecord` | `evidenceId`, media hash, source time range, frame/ASR artifact IDs, extraction method/version, observation, confidence 0..1, status (`observed`, `inferred` or `unknown`), actual model/provider if model-derived, limitations. Filename/user notes tagged `user_annotation`, never camera observation. |
| `Transcript` | asset hash, language, model/version, words with source microseconds, confidence when available, origin (`asr`, `imported`, `estimated`), text-reconciliation status. Missing ASR is explicit. |
| `EvidenceBundle` | candidate inventory, observation records, transcript refs, source/interval coverage map, evidence revision/hash and limits. Metadata can exist for unsampled footage; unsampled semantics remain unknown. |

Worker extraction must preserve source presentation timestamps and rotation. Proxies record mapping to original timestamps. Analyze VFR sources in their original time domain; render at fixed output frame rate. Actual source decoding supplies the evidence; never claim a text-only model watched video.

### AI decisions

`EditingProposal` contains:

- `proposalId`, base project revision, evidence hash, intent/script hash, requested and actual model/provider, prompt/schema versions, usage summary.
- `storyIntent` and ordered `beats[]`: beat ID, role, intended meaning, narration interval, required evidence, importance. Roles may be absent or combined if the script has no CTA/context; do not invent six content claims merely to fill a template.
- `shots[]`: unique decision ID, beat ID, selected candidate/asset IDs, exact source range, rational speed, order, numeric crop/framing, supported transition, evidence IDs, rationale, confidence and uncertainty. Duration derives from source range/speed; model timing proposals must reconcile to narration explicitly.
- `gaps[]`: missing evidence/coverage with reason and affected beats; `payoff`, `validationChecklist`, `limitations`.

AI output is an untrusted proposal. `validateProposal` checks schema then referential/temporal/evidence validity. Missing IDs, unobserved certainty claims, unknown enums, stale inputs or incomplete coverage fail validation with structured diagnostics. A valid no-footage result can return explicit gaps and be shown as an incomplete proposal, but cannot be approved for final render. Do not silently drop items, invent defaults, replace shots, reorder the result or clamp invalid ranges into another meaning.

`compileDecision(proposal, assets, constraints, rendererCapabilities)` returns `{timeline, diagnostics, coverage}` or a typed failure. The compiler implements timing arithmetic and checks constraints; it does not rerank shots. One bounded AI repair request may use validation errors. Exhausted quota or invalid repair leaves the draft unchanged. User edits are explicit commands with history.

### Canonical timeline v2

Source ranges and speech times use safe integer microseconds; output placement uses integer frames with frame-rate rational `{num:30, den:1}` initially. All intervals are half-open. Conversion occurs once in the compiler: round absolute boundaries to output frames, derive adjacent durations by subtraction, and report residual error. Do not round every segment independently and accumulate drift.

~~~text
TimelineV2 {
  id, projectId, revision, inputHash, fps, width, height,
  durationFrames, rendererProfile,
  video: [ { id, assetId, sourceInUs, sourceOutUs,
             rate: {num, den}, startFrame, durationFrames,
             crop: {x, y, width, height}, transition,
             evidenceIds, beatId, rationale, locked } ],
  audio: [ { id, assetId, sourceInUs, sourceOutUs, startSample,
             durationSamples, gain, automation, role, speedPolicy } ],
  captions: [ { id, startUs, endUs, text, words, styleId, provenance } ],
  explicitHolds: [ { startFrame, durationFrames, sourceShotId, reason } ]
}
~~~

Audio timeline uses 48 kHz output samples; narration anchors captions independently of picture cuts. Map speech microseconds to samples without shifting words to match shots. Allow source speed 0.25..4 only if the selected renderer supports it; provider constraints must use that same range. Reverse and richer effects remain legacy-only until implemented for the new backend.

Validation requirements:

1. Media exists and hash matches; source intervals are finite, positive and inside decoded duration. Permit only an explicitly reported sub-frame boundary tolerance, never the old blanket repair of invalid ranges.
2. Derived duration agrees with source/rate within one output frame. Video placement is contiguous; no accidental gap/overlap. Every narration frame has picture coverage or a user-visible explicit hold. Final audio/caption/tail duration agrees with the declared total.
3. Locked segment source, speed, crop, effects and absolute timeline position remain unchanged. A changed earlier duration that moves a lock is invalid.
4. Every semantic decision cites valid evidence from its selected source range; uncertain context is labeled as such. Detect same-source overlap/reuse and report it; allow deliberate reuse only with rationale and review.
5. Transition and style capabilities, limits, fonts and audio policy are executable on the selected renderer. No silent effect loss.
6. Input hash and base revision match current state. Approval references exact timeline hash, assets, renderer/compiler/style versions and output profile. Any semantic edit or renderer/profile change invalidates approval.

### Editing operations and service interfaces

Operations: `replaceShot`, `trimShot`, `setSpeed`, `reorderShots`, `splitShot`, `removeShot`, `setFraming`, `setTransition`, `editCaption`, `setLock`. Each is `{operationId, projectId, baseRevision, type, payload}`. Apply to a cloned draft, validate, then commit a new revision atomically or return diagnostics; undo restores the prior revision. No partial mutation on rejection.

~~~text
MediaService.import(readableStream, metadata, signal) -> MediaAsset
AnalysisService.analyze(assetIds, options, signal) -> JobRef<EvidenceBundle>
AIProvider.capabilities() -> ModelCapability[]
AIProvider.completeJSON({purpose, model, messages, schema, budget, signal})
  -> {data, actualModel, provider, requestId, usage, finishReason}
PlanningService.propose({projectRevision, intent, evidenceHash, constraints})
  -> JobRef<EditingProposal>
ProjectStore.apply(operation) -> {revision, timelineHash} | Diagnostics
Renderer.capabilities() -> {operations, styles, limits, version}
Renderer.preview({timelineHash, profile}) -> JobRef<RenderArtifact>
Renderer.final({approvalId, timelineHash, profile}) -> JobRef<RenderArtifact>
AuditService.inspect({renderArtifactId, approvedIntentHash}) -> JobRef<AuditReport>
~~~

UI-facing async operations return durable job IDs in worker mode. Browser-only jobs report their transient lifetime explicitly. Common errors are `{code, message, retryable, fieldPath?, evidenceId?, retryAt?, diagnostics?}`; useful codes include `AUTH_REQUIRED`, `MODEL_UNAVAILABLE`, `RATE_LIMITED`, `INVALID_MODEL_OUTPUT`, `STALE_INPUT`, `MISSING_EVIDENCE`, `INVALID_TIMELINE`, `UNSUPPORTED_RENDER_FEATURE`, `MEDIA_CHANGED`, `RESOURCE_LIMIT`, `CANCELLED`.

## 5. Complete AI editing pipeline

1. **Import media:** worker streams originals to project storage, hashes and probes; UI displays real stream metadata and immediate browser preview when decodable. Finalize only after byte/hash validation. Relinking verifies content hash.
2. **Analyze footage:** sequential FFmpeg extraction produces low-resolution scene signals, candidate cuts, waveform/activity, timestamped frame sets and optional ASR. Preserve current analysis code for structural scoring on normalized samples.
3. **Extract evidence:** sample start/middle/end of shortlisted shots, candidate cut neighborhoods, motion peaks and promised payoff candidates. Budget across clips and time, not merely the first shots. Vision-capable OpenRouter inference labels supplied images and returns evidence-linked observations. Persist unknown coverage. OCR/text in footage is content, never executable instruction.
4. **OpenRouter reasoning:** script/intent first determines required beats/evidence; visual observations are then matched to them. A text-only reasoning model may consume these structured observations, transcripts and user notes; only an image-capable model receives images. A combined vision+planning call is allowed for a small evidence-complete batch, but must return the same separate observation and decision records.
5. **Validated decisions:** validate all IDs, observations, chronology uncertainty, bounds, locked regions, privacy/budget limits and output capabilities. If an important beat has no visual evidence, request targeted extraction/reasoning within budget or return a gap; do not call a visually unrelated shot verified support.
6. **Build timeline:** deterministic compiler preserves approved AI order/ranges where valid, reconciles frame boundaries, creates narration/caption tracks, and reports every adjustment. Persist proposal and draft revision.
7. **Render preview:** worker renders a low-resolution MP4 from that draft with the chosen final backend/compiler. Viewer shows evidence and reasons next to the actual preview. Review edits rerender only affected chunks where safe.
8. **Approve:** approval records immutable timeline hash, input/evidence hashes, renderer/style versions and final profile. Editing invalidates approval. A draft preview does not mutate the currently approved timeline.
9. **Render final:** enqueue approved revision; verify metadata, full decode, frame count/duration and audio stream. Publish artifact atomically. Optional audit compares final frames and extracted final audio against the approved intent; suggestions require another review cycle.

Uncertainty is part of the result. Semantic grounding proves a cited source exists, not that the model interpretation is correct. A human-labeled test corpus and review remain necessary for editing-quality claims.

## 6. OpenRouter adapter and request policy

Use the documented chat-completions image parts, with an ID/timestamp text part immediately preceding each image. The free router selects among available models supporting requested features; it does not guarantee one fixed model or consistent quality. Persist the actual returned model. Prefer an explicitly selected, available zero-priced vision model for reproducible evaluations; use `openrouter/free` as the free routing option. [Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router)

Query model input modalities and structured-output support. Unknown pricing is not free. Never send images to text-only models, automatically fall back to paid models, or treat unsupported structured output as validation permission. When schema-mode support is absent, include the complete bounded schema in the prompt and still validate locally. [Structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

Initial application policy (configurable engineering budgets, not provider guarantees): one outstanding request per credential, >=4 seconds between attempts, <=12 images per call, <=512px long edge, <=2 MiB serialized request, bounded script/evidence text and <=4,096 requested output tokens. Downscale or split before submitting. Enforce a 90-second request deadline and a total job budget; read response bodies with a byte ceiling. A typical short edit budgets <=4 initial calls (intent, one evidence batch, decisions, optional audit) plus <=1 repair; additional evidence batches require a displayed expanded estimate. Do not spend a quota request per frame.

HTTP 429/temporary 5xx retry at most twice with jitter and provider `Retry-After`/reset information. Authentication, payment/quota exhaustion, invalid requests and cancellation are not blind retries. Persist `retry_wait` with its next time; do not keep a serverless invocation sleeping. Check key quota metadata when available, cache capability discovery, and count every retry/repair against the job budget. Current official rate documentation exposes account-dependent quota inspection and throttling behavior; numeric quotas must not be hardcoded as universal guarantees. [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits)

Cache observations by media hash + sampled timestamps + preprocessing/model/prompt version, and decisions by evidence hash + script + constraints + model/schema versions. Do not reuse a cache entry across users or claim a hit when input/model provenance differs. Retain redacted diagnostics, requested/actual model, latency and usage; never retain credentials in prompts, reports or logs.

## 7. Native FFmpeg rendering

FFmpeg/ffprobe are external executables, discovered through configured absolute paths or PATH and checked at worker startup. Probe build/version, encoders and required filters, including libass for subtitle output. Use Node `spawn(executable, argv, {shell:false, windowsHide:true})`; no shell interpolation. Model output never becomes an executable, filter expression, path or CLI flag.

ffprobe JSON supplies stream/timebase/rotation data. Restrict processing to worker-owned media IDs; URL inputs and arbitrary local paths are not accepted over HTTP. Copy/upload filenames to generated ASCII artifact paths; preserve original names only as metadata. This also avoids Windows drive-letter/quote/filter escaping hazards. [ffprobe documentation](https://ffmpeg.org/ffprobe.html)

Initial FFmpeg profile: sequential trimmed shots, fixed 30 fps, 9:16 crop/scale/pad, rational speed, explicit holds, narration plus source audio gain/ducking, simple ASS captions, H.264/AAC MP4 with faststart. Decode/reencode at trim boundaries for accuracy; keyframe stream copy is not accurate arbitrary trimming. Apply `trim`/`atrim`, timestamp reset, `setpts`, supported `atempo` chains, fixed pixel format/timebase/audio sample format, and deterministic placement. Choose a pitch policy explicitly (mute, preserve via time stretch, or approved pitch change), not backend-dependent defaults.

Bound memory by rendering one short segment/chunk at a time to normalized disk intermediates, then concatenate compatible streams and mux narration/captions. Use at most two video inputs for a transition. Validate codec/timebase equivalence before stream-copy concatenation; otherwise reencode. Cancellation stops the exact process tree and removes only that job's partial outputs. Parse `-progress pipe:1` and drain stderr to a bounded log.

Encode the final audio track once from a continuous sample timeline (disk-backed PCM intermediates are acceptable); do not concatenate separately padded AAC fragments and assume gapless narration. Each video chunk has exact output frame count and closed boundaries. Resolve font files to packaged licensed assets and record their hashes, rather than relying on a system font with the same name. Large input decoder requirements can exceed the output-resolution estimate; admission checks must account for source dimensions as well.

Transition semantics must be versioned. Preserve v1 incoming-window replay: normalize outgoing tail and incoming head, blend them during the incoming interval, then concatenate; total duration remains the sum of shot durations. Do not replace this with unadjusted overlap xfade. FFmpeg xfade requires identical constant-frame-rate dimensions/pixel format/timebase and ordinarily overlaps inputs; a future true overlap mode needs explicit source handles and different timeline arithmetic. [FFmpeg filter reference](https://ffmpeg.org/ffmpeg-filters.html#xfade)

Caption/preset parity is a release gate, not an assumption: Canvas animations, effects and font metrics do not automatically map to ASS. Preserve existing browser rendering for legacy presets. First FFmpeg profile supports declared basic styles only; unsupported presets require either the compatibility renderer or an explicit style change followed by a new preview/approval. Do not silently replace a user's style. Later support can generate bounded alpha-overlay chunks with the shared caption layout/effect logic if golden-frame tests and RAM measurements justify that cost.

Verification: ffprobe expected streams/dimensions/frame rate; full decode to null with error reporting; video frame count/duration within one output frame and audio within one frame plus documented encoder padding; sampled boundary/payoff images and output hash. Verify silence policy separately from missing-audio errors. Media checks do not imply story accuracy.

## 8. Persistence and background jobs

Baseline storage is the local filesystem, one worker instance per managed data root. No mandatory database. Use separate atomic JSON manifests for projects, immutable revisions and jobs; write temporary file, flush, then atomic rename with bounded Windows sharing-error retry. A data-root lock prevents two writers. Corrupt manifests retain the previous committed snapshot and surface a recovery error. Blob artifacts are content-addressed disk files. Store portable metadata separately from original media references and credentials.

Commit order is artifact files -> immutable revision -> manifest pointer. The manifest is the publication boundary; a crash before that step leaves unreferenced files eligible for later cleanup, not a half-committed project. Job success is recorded only after output verification and artifact publication. Compare-and-swap revision checks run inside the single writer, including commands arriving from multiple browser tabs.

~~~text
data/
  projects/<projectId>/manifest.json
  projects/<projectId>/revisions/<revision>.json
  artifacts/<sha256>.<extension>
  jobs/<jobId>/state.json
  jobs/<jobId>/work/             # generated partial files only
~~~

Job record: ID, type, project/revision/input hash, idempotency key, state, phase/progress, dependency IDs, attempts, next retry time, resource estimate, artifact IDs, bounded error/log metadata and timestamps. States: `queued -> running -> succeeded|failed|cancelled`; `running -> retry_wait -> queued`; process loss marks `interrupted`. Restart resumes validated extraction chunks or restarts the incomplete render chunk; do not claim arbitrary mid-encoder resume. Stale completed jobs may retain artifacts but cannot overwrite a newer project revision.

One CPU-heavy job at a time: ASR, proxy generation, analysis decoding and final rendering share the same resource semaphore. AI network operations also have a per-key queue. UI polls job state; SSE may be added, but correctness does not depend on a live connection. Browser closure does not stop a worker job. Worker termination does; job records permit recovery when relaunched.

### Worker protocol (v1)

| Endpoint | Contract |
| --- | --- |
| `GET /v1/capabilities` | Backend/compiler versions, FFmpeg filters/codecs, supported contracts, resource limits |
| `POST /v1/session/pair` | Local one-time pairing secret -> short-lived session; no API key in URL |
| `POST /v1/projects` | Create project manifest |
| `GET/PUT /v1/projects/:id` | Read / compare-and-swap metadata using base revision or If-Match; stale write -> 409 |
| `POST /v1/projects/:id/uploads` | Declare file byte count/hash hint; obtain opaque upload ID |
| `PUT /v1/uploads/:id/chunks/:index` | Stream fixed <=8 MiB chunk with checksum; idempotent; local/worker route only |
| `POST /v1/uploads/:id/complete` | Verify lengths, finalize SHA-256, enqueue probe; never trust declared MIME |
| `POST /v1/jobs` | Allowlisted type/input refs and idempotency key -> 202 job ID |
| `GET /v1/jobs/:id` | State/progress/artifacts; enforce project access |
| `POST /v1/jobs/:id/cancel` | Persist cancellation, stop child process, then terminal state |
| `POST /v1/projects/:id/approvals` | Validated current timeline/preview/profile hash -> immutable approval ID |
| `GET /v1/artifacts/:id` | Authorized byte-range response for previews/downloads |

Final-render jobs require an approval ID and matching hashes. Job inputs use IDs only; no command strings/paths. The optional Vercel proxy supports only model discovery and bounded AI completion, not the media upload endpoints. Optional remote storage uses direct-to-worker/object-store uploads with short-lived authorization; localhost files are never visible to Vercel.

## 9. Memory, disk and Windows profile

For approximately 4 GiB available RAM, target <=2 GiB combined incremental browser/worker/child working set in the baseline 720p workflow, leaving headroom. This is a measurement gate, not a proven bound. Start with one heavy job, one FFmpeg child, two decode/encode threads and one filter thread. Decode only current sources; stream audio and bytes; release ASR before rendering. Enforce early admission estimates and Windows process-tree working-set sampling. Stop/reduce resolution on resource pressure; JavaScript heap caps alone do not constrain FFmpeg or browser memory.

Use <=360p preview, <=512px evidence images, disk-backed 16 kHz mono speech audio, initially 60-second project benchmark before the 300-second support gate. Keep 1080p opt-in until measured. Native small quantized ASR is an optional worker adapter; model download/license and accuracy tests are separate. Existing browser Whisper can remain opt-in, never concurrent with native rendering on this profile. No local vision LLM is required.

Preflight source resolution/codec and disk space, not just file bytes. Estimate temporary storage from input copies, proxy/intermediate bitrate and final output with a margin; reject when available disk cannot cover the estimate. Cap cache size (initial 5 GiB configurable) and evict only unreferenced derived artifacts. Never delete originals, approved outputs or user folders as cache cleanup. Use managed per-job directories and resolved-path containment for all deletion. Benchmark wall time, peak working set, artifact bytes and cancellation latency on Windows.

## 10. Credentials and trust boundaries

- Worker mode: API key supplied as a server process secret. Optional persistence uses Windows Credential Manager/DPAPI under the current user with an opaque credential reference; implementation is gated on tests. No plaintext key in project JSON, IndexedDB, artifact hashes, job files, command lines or logs. `.env.local` may be a user-managed development secret, never bundled through `VITE_*`.
- Browser mode: no provider credentials. The browser submits bounded requests to the server transport. Use explicit allowlisted project fields rather than depending on `m_` input IDs for any future private controls.
- Personal serverless proxy: server environment secret, authenticated user/session, request size/schema/model allowlist and durable quota policy before public exposure. Multi-user BYOK storage is deferred until authentication and encrypted credential ownership exist.
- Bind local service to loopback; verify Host and exact configured Origin, require session credentials for all data/mutation routes, reject wildcard CORS and `null` origins, protect against DNS rebinding/CSRF. Opaque artifact IDs prevent path traversal. Tokens must not appear in logs or query strings.
- Clearly disclose that selected frames, script and transcript are transmitted to OpenRouter/model providers when AI mode is used; provider retention settings are not guaranteed by local memory-only key storage. Model output and text inside media are untrusted data.

## 11. Versioning, rollout and quality gates

Every extraction/model/prompt/schema/compiler/style version participates in relevant cache/approval hashes. Migrate v1 saves by deriving v2 source identity and marking unavailable metadata unknown, retaining a backup of the original. Missing media requires relinking before compilation/rendering. Convert legacy transitions/effects only when supported; otherwise keep the browser renderer.

Roll out one milestone at a time. Contract tests use mocked provider responses, including invalid IDs, stale revisions and failures. Integration tests use real FFmpeg binaries and timestamped fixtures. Semantic quality uses a small labeled multi-shot corpus with distractors and outcomes that happen between midpoint frames, plus spoken transcripts; synthetic tones are insufficient. Live OpenRouter tests are opt-in and report actual models and uncertain results. Free-model quality variability remains an unresolved product risk even after transport and rendering are correct.
