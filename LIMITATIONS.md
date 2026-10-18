# Remaining limitations

This release repairs and extends the supplied editor. It does **not** satisfy every aspirational capability in the engineering specification.

The three new editing presets and their specific fallback behavior are documented in [PRESET_STYLES.md](PRESET_STYLES.md). In particular: no semantic shot selection, automatic face avoidance, immediate interruption of browser audio decode/render, unlimited media size, guaranteed VFR frame identity, or universal font/codec availability is claimed. New presets hide captions without complete word timing. Oversized audio mixes fail with a resource-budget message; shorten sources or reduce clips.

## Editing intelligence and captions

- Footage analysis uses sampled luminance histograms, pixel changes, edge detail, and exposure estimates. It does not recognize subjects, goals, wins, chronology, or narrative meaning. Filename/manual-note keyword matches are metadata evidence only. Unmatched selections are explicitly marked for manual review.
- Generated narrative roles are editable script/pacing heuristics. Subject consistency and story continuity require editorial review. The story generator rejects exhausted candidate footage instead of silently repeating it; this can reject a plan that a human could improve by reusing a different subrange.
- Speech-energy and Whisper output are estimates, not verified word alignment. No speech-ground-truth accuracy claim has been tested. Imported timing accuracy is the user's responsibility; interval/text validation cannot verify what was spoken.
- English speech recognition was exercised on the supplied export's audio in a browser. Model hosting, memory and runtime compatibility can still prevent it from working on another device. Cancellation terminates its worker. Other languages need imported or manual timing. Word text can be misrecognized; script mode rejects mismatches instead of silently changing them.
- Imported word tokens must match caption words in order, with normalized punctuation/contraction handling. Their timestamps rebuild cue bounds, so old cue bounds cannot constrain correct timing. Selecting recognized-speech text is explicit. Approximate matching that silently assigns a different word's timing has been removed.
- Words shorter than one output frame may not appear highlighted on every output sample. Frame seeking uses browser decoding and presentation notifications, not an independent demuxer or a guarantee of exact variable-frame-rate source indexing.

## Timeline, visuals and audio

- The existing renderer and several editor subsystems remain together in `src/main.js`; this is an incremental modularization, not a complete architectural rewrite.
- Structural picture edits ripple subsequent picture positions. Narration and caption times remain anchored. General multi-track drag editing, arbitrary gaps/overlaps, and dedicated music-track editing are not implemented.
- Transitions composite the previous shot's final frame inside the incoming shot. They do not shorten the sequence or consume extra overlapping source handles. Preview/export share this rule.
- Safe framing still needs human review. The app does not guarantee preservation of an important subject. Caption horizontal bounds and baseline limits help, but unusually long manual captions and decorative overlays can still need adjustment.
- Color controls use canvas/CSS filters and presets. There is no calibrated HDR pipeline, color-space normalization, or professional color management.
- Narration-driven ducking, short cut fades and sample-peak metering are implemented. There is no LUFS normalization, true-peak limiter, or calibrated loudness target.
- The source-audio gain is adjustable; speech runs apply additional ducking. Source audio on speed-adjusted shots is muted by default to avoid pitch changes. An explicit checkbox permits resampled audio with pitch changes. Pitch-preserving time stretch is not implemented.
- The original automatic SFX suggestions and manual effects remain heuristic. Review them before export. Missing/undecodable original audio can be skipped and is reported; that does not verify that a source truly lacks an audio stream.

## Browser and resource limits

- MP4 export requires H.264 video and AAC audio WebCodecs encoding for the chosen resolution. Capability checks govern actual support. There is no WebM or server encoder fallback. Chrome was tested on this computer; other browsers/devices were not.
- Export is 30 fps at 360×640, 720×1280, or 1080×1920. The 360×640 path was verified end to end. Other resolutions are checked at runtime but were not fully rendered in validation. There is no 60 fps mode.
- Default export keeps the MP4 in memory. Direct file export uses the browser File System Access API to stream output where available. The streamed writer was verified with an origin-private file handle; its native save-picker UI was not exercised by automation. Audio mixing still uses memory even with streamed video output.
- Narration import is limited to 100 MB and five minutes; videos to 512 MB each and 1 GB total compressed source bytes. Export including its tail is limited to five minutes. These limits reduce risk but cannot guarantee success on all 4 GB devices.
- Image analysis samples at most 1,200 frames and only the first 15 minutes of a source. Very short visual events can be missed. Sampling is sequential on the browser UI side; statistics run in a worker.
- Reverse frame caches for selected legacy preview paths are limited to eight seconds per shot. Long or high-resolution reverse clips may exceed resource budgets. Export and full preview can seek reverse source frames directly.
- Metadata such as exact frame rate, codec identity, source rotation and audio-stream presence is not reliably exposed by HTML video and can remain unknown. Decode acceptance is checked with the actual browser.
- Preview can drop visual updates on slow devices. Full and moment previews share the export audio mixer, but playback cadence is not export-frame cadence.

## Storage and verification

- Projects store metadata only. Relink videos and reimport narration/custom fonts after reopening. Media content hashes are not calculated; name/size/duration matching is not a cryptographic identity check.
- IndexedDB can be unavailable or cleared. Autosave errors are shown; export JSON for portable backups. No cloud save is provided.
- Post-export verification checks MP4 signature, duration, and three decodable video positions. It does not decode every frame or automatically measure speech synchronization, perceived quality, or universal player compatibility.
- Local automated checks do not replace real-footage, long-project, low-memory, accessibility-assistive-technology, or cross-browser testing. Vercel deployment configuration and production build were checked locally; no site was published.
