# Implementation status

Updated 2026-10-19. Audited application baseline: `ed4f493` on `master`. **M1 is complete:** local acceptance checks and genuine authenticated OpenRouter structured-response verification passed. Code remains in the current worktree. No M2 or later implementation was started and no deployment is claimed.

## M1 implementation record

The implementation directive supersedes the original browser-BYOK design: API keys now stay exclusively in the local Node server's environment. `.env.example` documents OPENROUTER_API_KEY and OPENROUTER_MODEL. No provider key field exists in either frontend entry. Vite development and local preview mount a same-origin loopback-only gateway; static Vercel hosting alone does not enable AI. This gateway is the minimum credential boundary for M1, not the media worker or hosted multi-user API.

Implemented behavior:

- Shared OpenRouter provider with injected transport, model discovery, confirmed-zero pricing, modality checks, strict JSON Schema validation (Ajv), actual-model/request/usage metadata, and a bounded in-memory telemetry ring without prompts or keys.
- One active request per credential; four-second attempt spacing; 90-second per-request and 180-second total budgets; 2 MiB request/response ceilings, 12 images, 512px long edge and 4,096 output-token maximum. At most two temporary-error retries; long resets return retryAt. Schema-format retry includes the entire schema and still validates the result. No paid fallback.
- Gateway rejects untrusted Origin/Host, non-loopback clients, oversized bodies, unknown schemas/fields and browser credentials. Disconnect cancellation reaches the provider. No media processing or arbitrary provider endpoint is exposed.
- AI/offline planning modes are explicit. Missing configuration or invalid model output retains the current timeline. Empty/partial plans, unknown shots, invalid source ranges/sections/enums/order and repeated candidates fail validation. Complete decision compilation and reusable subranges remain M5 work.
- Audit resolves configuration before sampling, extracts script beats first, samples a real exported MP4 with hardened timeout/cancel/seek helpers, and pairs every image with a timestamp/evidence ID. Response model metadata reaches the report. Inconsistent PASS plus a high-severity issue becomes NEEDS_REVISION.
- Audit and planning cancellation release controls. Plans preserve model metadata/beats/payoff/checklist in the transient draft; durable revisions remain M2. Existing caption/speech-estimation fallback stays independent of AI-provider failure.
- Browser test setup now owns Vite in-process and closes it directly, removing the Windows taskkill dependency that hung teardown. Legacy regression tests explicitly select the offline mode.

Modified/added modules:

| Area | Files |
| --- | --- |
| AI boundary | `src/ai/provider.js`, `openrouter.js`, `requestPolicy.js`, `schemas.js`, `validateResponse.js`, `proxyClient.js` |
| Local gateway | `server/aiGateway.js`, `vite.config.js`, `.env.example` |
| Integration | `src/audit/storyAuditor.js`, `src/main.js`, `index.html`, `SkimStudio_Enhanced.html` |
| Verification | `tests/openrouter.test.js`, `tests/aiGateway.test.js`, `tests/ai.browser.spec.js`, `tests/storyAuditor.test.js`, `tests/browser.spec.js`, `tests/fixtures/ai.js`, `scripts/browser-test-server.mjs`, `scripts/verify-openrouter.mjs`, `playwright.config.js` |
| Dependencies/docs | `package.json`, `package-lock.json` (Ajv only), `README.md`, `LIMITATIONS.md`, architecture/status/roadmap notes |

### M1 verification

| Check | Actual result |
| --- | --- |
| Initial gateway regression | Failed before implementation because the module did not exist; subsequently passes. |
| `npm.cmd test` | 87 passed, 0 failed. Includes server Authorization forwarding, secret exclusion, free/capability rejection, response validation, budgets, retry caps/times, serialization, timeout and cancellation. These provider responses are deterministic test doubles, not genuine AI results. |
| `npm.cmd run build` | Passed for both entry pages with workspace-local dependencies. |
| `npm.cmd run test:browser -- tests/ai.browser.spec.js` | 5 passed (25.5s), clean process exit. Both pages performed real browser MP4 export, sampling, report display/download using labeled local API test responses; invalid plans preserve edit and cancellation releases controls. |
| `$env:SKIMSTUDIO_TEST_PRODUCTION='1'; npm.cmd run test:browser` | 18 passed (1.2m), clean exit. Covers both entry pages, new AI boundary UI, old offline/commentary flows, speech-recognition refusal/failure, caption synchronization, locks, all preset exports and persistence. No live AI completion is part of these tests. |
| Isolated `.cache/m1-clean-20261019`: `npm.cmd ci --no-audit --no-fund`, then build | Both passed. All 65 packages installed into that isolated directory; Vite resolved from its own node_modules, not an ancestor. |
| Build with server-only test secret marker | Seven JS/HTML artifacts scanned; neither marker nor direct OpenRouter transport URL appeared. No actual credential was used. |
| Public OpenRouter `/api/v1/models` (unauthenticated, real network) | HTTP 200, 788,509 bytes, 471 models, 11 eligible free vision models under the implemented classifier at check time. Actual catalog fits the 2 MiB response budget; these counts are not availability guarantees. |
| Independent verification of `test-results/verified-export.mp4` | ffprobe: H.264 360x640 at 30/1 fps plus AAC; duration 1.514667s including the editor tail/encoder padding; 367,518 bytes. FFmpeg full decode completed without errors. This is the preserved browser renderer's real output, not a newly implemented native rendering worker. |
| `npm.cmd run test:ai:live` | PASSED, exit 0 with network access after local credential configuration. Requested `openrouter/free`; actual model `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, provider Nvidia. Returned six schema-valid, timestamp-validated script beats; finishReason `stop`, one attempt, 41,555ms. Usage: 392 prompt + 2,016 completion = 2,408 tokens. Request ID `gen-1792399881-RSIb9yWmwN913Ngj4fyw`. Credential was neither printed nor stored in reports. This proves live structured text inference, not semantic video accuracy or a live final-export audit. |

Intermediate failures were investigated rather than counted as passes. A development run reloaded during edits. The first full production run had 16 passes and two failures: speech/caption tests supplied 8–9 seconds of narration with a single 3-second source candidate, correctly rejected by the current no-reuse planner. Their setup now provides two independent source entries to exercise the intended speech/caption behavior; insufficient-footage rejection remains intact. A minification-sensitive preflight check was replaced by an explicit wrapper option. The final stable production suite passes all 18 cases.

M1 acceptance is complete. The initial missing-credential check and restricted-network failure were not counted as passes; the subsequent genuine authenticated request above succeeded. Free-model quota/availability remains variable. **Next milestone: M2, shared contracts/project ownership. It has not been started.**

Remaining architecture limitations: native FFmpeg/ffprobe app integration, durable jobs/state/evidence, complete deterministic AI timeline compilation, camera/transition parity, selection-aware contextual plan revision and low-memory benchmarks remain future milestones. No fresh ASR quality or semantic video-understanding benchmark was performed.

## Read order and immediate action

1. [ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md): current code paths, defects and preservation decisions.
2. [ARCHITECTURE.md](ARCHITECTURE.md): target ownership, contracts, deployment and resource constraints.
3. [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md): exact files, dependency order, tests and completion gates.

**Next implementation task: M2, shared contracts/project ownership**, following its roadmap acceptance criteria. M1's credential boundary and live inference are verified; do not repeat completed M1 work or reintroduce browser key controls.

## Current capability inventory

Legend: **verified subset** = exercised in fresh checks below; **implemented/unverified** = source exists but fresh live behavior was not proved; **partial/broken** = specific deficiencies identified; **planned** = target architecture only.

| Capability | Status | Evidence / qualification |
| --- | --- | --- |
| Vite/vanilla frontend, two HTML entry builds | Verified subset | Production build succeeded for both; local-only Vite AI gateway configured. |
| Video/narration ingestion and browser decoding | Verified subset | Source/audio fixture imported in Chrome; ffprobe metadata integration absent. |
| Structural scene/motion analysis | Verified subset | Worker browser test and pure unit tests pass; output is not semantic recognition. |
| Speech/activity timing and caption validation | Verified subset | Existing Node guards pass; fresh browser workflows use estimated timing. |
| Live Whisper download/transcription accuracy | Implemented/unverified | Optional worker exists; real speech test not run during this audit. Test requires user-provided sample path. |
| OpenRouter request construction and planner UI | Locally verified; live structured inference verified | Server transport/UI tests and authenticated six-beat extraction pass. Live visual planning accuracy remains unverified. |
| OpenRouter as complete editorial authority | Partial | Validated shot order and transient beats/payoff/checklist are retained, but local timing slots and several camera/transition settings still modify decisions. Full compilation remains M5. |
| Explicit offline/local planning | Locally verified | User selects offline mode; missing/invalid AI response never selects it automatically. |
| Strict AI schema/source validation | Locally verified subset | Schema, source IDs/ranges/sections and complete-plan guards pass. Full semantic evidence validation awaits M4/M5. |
| Plan Viewer/apply/undo/manual locks | Verified subset | Current table/apply/browser flows pass; no draft video preview, complete evidence view or revision-bound approval. |
| Browser WebCodecs MP4 export | Verified subset | Synthetic fixture MP4 exported/decoded in Chrome; ordinary and OPFS file path exercised by existing browser test. Native save dialog not automated. |
| FFmpeg worker/rendering integration | Planned | Native binaries found on machine; no worker or app FFmpeg invocation exists. |
| Final-export AI audit | Locally verified; live visual audit unverified | Actual MP4 sampling and UI/report tested with local response fixtures. Live final-output model audit, durable reports and full evidence evaluation remain unverified. |
| Metadata save/relink/undo | Verified subset | Browser persistence/relink test passes; files, proposals, evidence, jobs and reports are not durably stored by current system. |
| Provider credential boundary | Locally verified | Environment-only local server; no browser provider key. OS credential persistence and hosted authentication remain future work. |
| Retry/rate-limit/cancellation/recovery for AI | Locally verified subset | Bounded request lifecycle and short retries; no durable queue/restart recovery yet. |
| Operation within approximately 4 GiB RAM | Unverified | Existing local budgets are not total working-set guarantees; no representative measurement performed. |

## Historical audit verification record (before M1)

Environment: Windows PowerShell, Node v24.21.0. Commands used `npm.cmd` to avoid PowerShell script execution-policy conflicts.

| Check | Result | What it establishes / does not establish |
| --- | --- | --- |
| `git status --short` before work | Clean | Architecture files are the only intended changes. |
| `npm.cmd test` | 72 passed, 0 failed | Current pure unit suite passes. It does not test actual OpenRouter requests or semantic accuracy. |
| `npm.cmd run build` | Passed, Vite 7.3.7 | Both HTML entry points compile. Generated artifacts are ignored, not deployment evidence. |
| `npm.cmd run test:browser -- tests/browser.spec.js -g "media import, reviewed build\|worker footage analysis"` | Two individual tests reported passed (8.6s, 4.7s); runner then hung and was interrupted | Import, reviewed local build, save/undo/relink, MP4 export and multi-clip analysis/lock/manual-caption flows worked for fixtures. Runner exit was not clean; fix teardown in M1. |
| Direct `normalizeStoryPlan` call with only an unknown shot ID | Returned empty shotPlan without error | Confirms acceptance of unusable AI output; does not exercise a live provider. |
| Direct `runStoryAudit` call without apiKey | Rejected with missing-key message | Confirms guard; code inspection proves UI omits the collected key. Full audit UI failure was not separately reproduced end to end. |
| `npm.cmd ls --depth=0` | Reports four unmet local dependencies | Build succeeds through ancestor packages; isolated installation is unverified. |
| `require.resolve('vite/package.json')` | Resolved under `F:/apps/SkimStudio/node_modules` | Confirms ancestor dependency resolution. Tracked package-lock.json exists. |
| ffmpeg discovery/version | 9.0.2 full build found through Windows PATH | Installed tool available for future worker; not integrated or rendered by app. |
| ffprobe included source fixture | 3s; H.264 180x320 at 30/1; AAC | Native probing works on this synthetic fixture. |
| Official Vercel/OpenRouter/FFmpeg docs | Checked 2026-10-19 | Infrastructure decisions and source links are recorded in ARCHITECTURE; limits remain deployment/account dependent. |

The browser test command above uses a literal regex alternation `|` within a quoted argument; the Markdown escape is only for the table. Equivalent PowerShell command:

~~~powershell
npm.cmd run test:browser -- tests/browser.spec.js -g 'media import, reviewed build|worker footage analysis'
~~~

Not performed: isolated `npm ci`, full browser suite, live OpenRouter planning/audit, new ASR inference, FFmpeg rendering, remote/local pairing, process-memory profiling, or production deployment. No credentials are needed to complete the first milestone's mocked acceptance tests.

## Milestone ledger

| Milestone | State | Next dependency |
| --- | --- | --- |
| Documentation audit/design | Complete | Four requested documents written and reviewed |
| M1 OpenRouter boundary repair | Complete; local checks and authenticated inference passed | None |
| M2 Shared state/contracts | Not started | M1 accepted |
| M3 Local worker/ingestion/jobs | Not started | M2 accepted |
| M4 Evidence/speech | Not started | M3 accepted |
| M5 AI decision compilation | Not started | M4 accepted |
| M6 FFmpeg rendering | Not started | M5 accepted |
| M7 Plan Viewer integration | Not started | M6 accepted |
| M8 Audit/recovery/resource gates | Not started | M7 accepted |
| M9 Hosted API/remote worker | Optional, deferred | M8 plus deployment requirement |

## Highest remaining risks

1. **False confidence in AI completion:** the shipped implementation is a hybrid heuristic planner with unverified vision output, not a complete evidence-to-render contract. Do not present the previous 72 passing tests as proof otherwise.
2. **Provider variability:** free models can be unavailable, throttle, truncate or misinterpret frames. Capability checks, bounded retries and evidence review improve reliability but cannot guarantee semantic accuracy or uninterrupted free service.
3. **Renderer parity:** existing Canvas presets, camera behavior and incoming-window transitions need explicit FFmpeg support or compatibility routing. ASS does not reproduce all Canvas animation automatically.
4. **Memory/disk:** total browser/native/ASR peak usage on a 4 GiB machine is unmeasured. Disk-backed chunking and serialized heavy jobs must be benchmarked before expanding resolution/duration.
5. **Windows/browser connection:** local binary/process/path handling and HTTPS-to-local restrictions need tests. Worker-served same-origin UI is the dependable baseline; hosted pairing remains optional.
6. **Deployment/security:** current frontend keys are session-only, not securely persisted. Personal Vercel Hobby eligibility and account quotas constrain hosted use; no free always-on rendering service is assumed.
7. **Build/test environment:** M1 established isolated installation/build and clean test teardown. Keep the lockfile and in-process server cleanup regression protected; no ancestor package changes were made.

## Updating this file

After each completed milestone, record commit, commands, actual exit/results, live/mock distinction, measured resource figures where relevant, and remaining gaps. Mark only demonstrated capabilities as verified. New paths in ARCHITECTURE/ROADMAP remain proposed until committed and tested. Do not start more than one implementation milestone at once.
