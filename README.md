# SkimStudio

Browser-based vertical video editor, repaired from the supplied application. The original three-column workspace, canvas preview, media bin, caption and effects inspectors, timeline, and moment editor are retained.

## Run locally

Install Node.js 22.12 or later, then run these commands in the extracted project folder:

```sh
npm install
npm run dev
```

Open the local address printed by Vite. The HTML now loads JavaScript modules; opening it by double-clicking a file is not supported.

```sh
npm test
npm run test:browser
npm run build
npm run preview
```

Browser tests use an installed Google Chrome through Playwright. To use Edge, change `channel: 'chrome'` to `channel: 'msedge'` in `playwright.config.js`. Node tests do not need a browser. Test media is included in `tests/fixtures`; it is synthetic color-pattern footage and tones, not spoken-language ground truth.

## Editing workflow

The default **Reference Story** look is adapted from the supplied YouTube Short: locally bundled Montserrat Black, white setup text with lime/magenta/red emphasis, balanced phrase lines near the middle of the picture, quick eased entrances and restrained push-ins. **Apply reference look** updates an existing edit without rebuilding its source timing. Locked and manually framed shots are retained. Expand **Adjust a caption's emphasis** to choose the words and color for one caption. Phrase-line and stricter word-by-word reveal are both available. See [REFERENCE_STYLE.md](REFERENCE_STYLE.md) for the analysis and implementation details.

1. Import videos into the media bin. Each file is checked using actual browser decoding. Importing media does not generate an edit. The bin shows dimensions, duration, and a thumbnail.
2. Enter your narration script and import narration audio. Import prepares activity intervals and a waveform only. **Sync captions to speech** runs local word recognition after explicit download consent. Recognized-word timing is the default; approximate audio estimation and manual/imported timing are explicit alternatives.
3. Select **Analyze media** to sample footage and detect probable scene boundaries and motion changes. Add clip notes in the multiple-clips story panel to supply context. Analysis does not identify people, actions, or outcomes.
4. Use **Auto-Edit & Sync** or choose the multiple-clips mode and **Generate Story Plan**. Review the plan's narration, source intervals, timeline intervals, roles, and selection reasons. Change source choices or in/out points as needed. Source edits update the final timeline when the plan is validated and applied.
5. Select **Apply reviewed plan** to commit it. Replacing a timeline requires confirmation and can be undone. A locked shot's source, duration, speed, framing, and absolute position cannot silently change.
6. Preview the timeline. Full and selected-moment previews use the export audio mixer and frame compositor. Preview is a best-effort real-time view; slow devices can skip visual updates while the audio clock continues.
7. Select shots to trim, change speed or framing, and set transitions in the moment editor. Split at the playhead, reorder, or delete with the timeline tools. Structural changes ripple picture positions; narration captions retain their timestamps. Unlock shots before structural changes that could move them.
8. Review captions against the actual narration. Use the raw tables for manual corrections, import SRT, or import word-level timing JSON. Progressive reveal hides future words. Active highlighting uses each word's start/end; captions hide before the first word and after the final spoken interval. The optional end tail holds the final valid picture without stretching narration.
9. Select resolution and quality, then export. MP4 requires supported H.264 and AAC encoders. Use a lower resolution if the configuration is unsupported. **Export directly to file**, where available, streams encoded output to a file chosen with the browser's save dialog. Ordinary export creates a downloadable file in memory.

Export checks container signature, duration, and decoding at the first, middle, and final frames. It does not automatically prove intelligibility, semantic relevance, exact speech alignment, or audio quality; listen to the finished video.

## Captions and timing

Three additional reusable styles are available in **Edit details → Captions**: **Kinetic Sports Upset**, **Streamer Flashbang Meme**, and **Dialogue Meme Caption**, each with a separate Apply button. They share the preview/export renderer, preserve the existing timeline and measured word times, retain manually edited settings, and support undo. New presets require complete word timings; untimed captions stay hidden until synchronized or imported. Dialogue speaker labels are manual annotations.

See [PRESET_STYLES.md](PRESET_STYLES.md) for defaults, ownership, safe layout, offline fonts, migration, resource limits, manual editing guidance and adding future presets. The engineering checklist is [PRESET_AUDIT.md](PRESET_AUDIT.md).

Speech-energy timing is an estimate, even when every word has a numeric interval. It is never verified transcription. Imported word times must be ordered, nonoverlapping and match the current caption text. Cue bounds are rebuilt from those words, so an old delayed cue cannot clamp correct timestamps. Cues split at meaningful pauses. Supported examples:

```json
{"words":[{"word":"Hello","start":0.2,"end":0.5},{"word":"world","start":0.55,"end":0.9}]}
```

SRT gives sentence intervals; word boundaries within them remain estimated. Use the raw caption table format `start|end|text|w:relativeStart:relativeEnd,...` to correct individual word intervals. Invalid caption changes retain the previous valid data and display an error.

Speech recognition runs only after explicit download consent and can be cancelled by terminating its worker. Its English model produces estimated word timings requiring wording review. Its browser download/inference path was verified with the supplied output's audio. Narration silence suppresses captions in both preview and export. Select **Use recognized speech** if recognition and your script differ; **Match my script** retains the script and rejects unmatched words. See [CAPTION_SYNC_FIX.md](CAPTION_SYNC_FIX.md) for the repair and re-export steps.

The optional `npm run test:speech` regression requires the analyzed sample audio at `analysis/caption-sync/output-audio.wav` (or the same sample via `SKIMSTUDIO_SPEECH_AUDIO`). User media is excluded from the ZIP, so this test skips without that local sample. Normal tests use included synthetic fixtures.

## Saving and relinking

Save metadata and editing decisions in this browser with **Save project**; changes also autosave after a short delay. **Load saved** is explicit so opening the app cannot overwrite current work. Use **Export project JSON** for a portable backup.

Media bytes, narration bytes, custom font bytes, and downloaded model files are not embedded in project JSON or the project autosave. Keep your original media. After reopening a saved project, use **Relink video** for every missing source, then select its owner clip and import narration again. Relinking checks the original filename, size, and duration. Reimport a custom font if used. Browser storage can be cleared or exhausted; JSON backups are recommended.

Undo/redo covers editor snapshots within the active session. Resetting or loading a different project clears history. Undoing source removal can require relinking because the app releases the removed media resources.

## Deploy on Vercel Hobby

1. Extract the ZIP and place its source files in a Git repository.
2. Import that repository into Vercel and choose its project root.
3. Use the **Vite** preset, install command `npm install` (or `npm ci`), build command `npm run build`, and output directory `dist`.
4. Deploy. No environment variables, server functions, database, or persistent Node process are required.

The included `vercel.json` supplies the build/output settings. The ZIP also includes the verified `dist/` build for static hosting. Both `/` and `/SkimStudio_Enhanced.html` are built. Uploaded media remains on the user's device. Optional fonts and the explicitly requested Whisper runtime/model use external networks.

## Source layout

- `index.html`, `SkimStudio_Enhanced.html`: preserved editor markup.
- `src/main.js`: original renderer/editor integration, authoritative clips/EDL state, reviewed planning, project controls and audio mixing.
- `src/styles/studio.css`: extracted original styling plus layout/accessibility fixes.
- `src/core/`: validation, schema checks, undo/redo.
- `src/media/`: checked decoding, frame seeking and thumbnails.
- `src/captions/`: reference phrase layout, editorial emphasis, animation and preset controls. Montserrat Black's Latin font files ship with the build; its OFL license is in `public/licenses/`.
- `src/analysis/`, `src/workers/`: image-statistics analysis, worker lifecycle, optional alignment worker.
- `src/storage/`: IndexedDB transactions for metadata.
- `src/export/`: checked codec selection and output verification.
- `src/vendor/mp4-muxer.js`: muxer extracted from the supplied application.

See [LIMITATIONS.md](LIMITATIONS.md) for scope and [VALIDATION.md](VALIDATION.md) for executed checks.
