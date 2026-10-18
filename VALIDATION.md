# Validation and repair record

Validation date: 2026-10-18.

## Confirmed repairs

- Removed narration-import auto-edit execution.
- Replaced fabricated metadata durations and successful seek-timeout fallbacks with explicit decode errors.
- Fixed the frame-presentation callback registration race found by browser export testing.
- Preserved manual caption and sound-event ownership during timeline/effects rebuilding.
- Fixed estimated word spans mixing absolute times with cue-relative times; invalid imported/manual timings are rejected.
- Active caption highlights use word intervals; progressive reveal hides future words, and caption onset/end gates prevent persistence outside speech.
- Fixed scene histogram normalization, false sampling-gap boundaries, and per-shot edge statistics.
- Removed forced last-shot normalization that could violate source bounds; plans show insufficient picture coverage.
- Preserved locked source ranges and absolute positions; incompatible builds are rejected.
- Fixed timeline shot click handlers seeking to a shared final accumulator rather than the selected shot's start.
- Shared checked frame compositor and mixed audio between full/moment preview and export.
- Added encoder configuration checks, bounded encoder queues, AudioData/VideoFrame disposal, encoder cleanup, cancellation and batch cancellation handling.
- Added schema-validated metadata persistence, explicit project loading, relinking, JSON backup, session undo/redo and overwrite review.
- Fixed the preview canvas aspect ratio on shorter windows; retained the three-column workspace and responsive stacked view.

## Executed checks

`npm install`: completed, 0 reported vulnerabilities at installation.

`npm test`: 36 passing Node tests covering the original editor checks plus reference layout, narration silence, stereo activity, internal word gaps, repaired cue bounds, pause splitting, unchanged word timestamps, script mismatches, silent-tail hallucinations, and nearby late-onset anchoring.

`npm run test:browser`: 4 passing Chrome/Playwright scenarios. All four were run against the production build. The synthetic-tone edit-generation tests explicitly select approximate timing; tone fixtures cannot be transcribed as speech.

1. Import real synthetic MP4/audio; verify narration does not build an edit; review/apply a plan; undo/redo; save/load; check progressive caption gating; export MP4; exercise streamed file output using a real origin-private FileSystemWritableFileStream; cancel a subsequent export; reopen and relink missing media.
2. Analyze two source clips through the analysis worker; generate/apply a multiple-clips plan; retain manually edited captions through rebuilding; regenerate without changing a locked shot; check desktop/small-screen rendering without uncaught browser errors.
3. Apply the reference preset without changing source timing; protect a locked shot; save/load per-caption emphasis; render reference captions at preview and 1080×1920 sizes; check manual labeled callouts; load the bundled font successfully with Google Fonts requests blocked.
4. Feed voiced/silent/voiced narration with stale caption spans; verify captions hide in the actual quiet intervals, then import correctly aligned words and verify the cue bounds move to those words.

`npm run test:speech`: one additional browser check passed on the supplied output's real audio, in development and production. It recognized 100 words and confirmed no caption drawing at 5.35 s, 26.20 s, and 29.95 s; captions were drawn at 5.85 s and 26.75 s. The local sample is excluded from the ZIP, so the dedicated check skips when that sample is unavailable.

The tests use included synthetic fixtures. They do not measure semantic relevance or speech-ground-truth accuracy.

Independent `ffprobe` inspection of the exported browser-test file confirmed H.264 video at 360×640 and AAC audio. After removal of the artificial caption hold, the one-second narration fixture exports with its separate half-second end tail; measured video/audio duration is reported by the browser verification and independent stream inspection. Browser post-export checks also decoded first, middle, and final frames.

`npm run build`: production static build completed with both HTML entry pages and worker assets in `dist/`.

The browser-native save picker itself remains untested; streaming was exercised using the same file-writer implementation with an origin-private file handle.

See `CAPTION_SYNC_FIX.md` for the actual-export diagnosis. See `LIMITATIONS.md` for features not completed or not exercised, including native save-picker UI, long exports, other resolutions/devices, and Vercel publishing. Speech recognition was exercised on this sample but remains model-estimated, not manually verified transcription.
