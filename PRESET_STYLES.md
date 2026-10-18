# Editing preset system

SkimStudio adds exactly three editing presets alongside Reference Story and the six other existing caption styles. Open **Edit details → Captions**. Each preset has its own Apply button and an option in **Style**. Both HTML entry points install the same controls from the registry.

| Preset | Purpose and defaults |
| --- | --- |
| Kinetic Sports Upset | Montserrat Black (bundled locally), uppercase, 1–4 words, middle-lower placement, white setup with cyan action/lime setup/red setback words, black outline and subtle glow; 60 ms entrance, 3.5% shot push-in, contrast 1.10 and saturation 1.12. |
| Streamer Flashbang Meme | Local Impact/Haettenschweiler with sans-serif fallback, uppercase, 1–3 words, center, lime setup/cyan technology/red failure accents; 40 ms entrance, 5.5% push-in, brief deterministic glitch and shake; contrast 1.12 and saturation 1.15. |
| Dialogue Meme Caption | Bundled Montserrat Black, uppercase, 2–6 words, middle-lower placement, white text, translucent black backing, magenta speaker labels, green/red manual emphasis; 80 ms entrance, 2.5% push-in, contrast 1.05 and saturation 1.04. |

All three reveal only words whose measured start has arrived. Batches can contain fewer words at a pause or the end of a cue. Wording rules are editable color suggestions, not recognition of events in video.

## Application and manual ownership

Apply changes the preset-owned typography, size, position, casing, caption visibility, grouping, entrance, text/outline/accent colors, color grade/exposure/contrast/saturation, and the six labeled preset effects. Directly editing any of these controls protects it across subsequent applications. The UI displays the number of protected settings. Undo/redo restores both settings and ownership.

Each preset defines every owned setting, so switching does not inherit automatic glitch, backing, B&W, color or motion flags from the previous preset. Leaving a preset restores the previous baseline for its still-owned values. Manually edited values remain. Reference Story retains its existing Apply behavior and its dedicated controls; the new implementation does not change its definition.

Apply never writes media, source in/out, speed, reverse, timeline order, shot metadata, narration, cues, word timestamps, SFX, watermark or hook text. It never rebuilds a timeline. Locked, manually framed and custom-camera shots receive no additional preset motion, shake or glitch. Existing transitions on protected shots are retained; ordinary unlocked boundaries render as hard cuts. Transition settings in the moment editor remain available. Global caption/color settings apply to the whole composition.

The legacy automatic overlay toggles and footage bloom remain saved but are inactive in these three renderer modes; their dedicated controls provide the preset effects. Other styles continue to use the legacy controls. Existing SFX and their audio mix controls remain independent. No automatic SFX are added by applying a preset.

For one caption, **Speaker and emphasis** adds a speaker annotation without changing spoken text or the number of timed words. Emphasis matches complete normalized words, including Unicode text. Mark a cue red and enable **B&W on red cues** to desaturate its spoken interval. Unknown speakers are never inferred.

## Timing, fonts and layout

Complete measured/imported word intervals are authoritative. Invalid, partial, overlapping or unordered imports fail with an error and retain the previous valid data. New presets suppress untimed or malformed captions; use **Sync captions to speech** or import complete word times. SRT alone gives sentence intervals and is insufficient for strict word reveal. Existing styles keep their approximate-timing behavior. Positive legacy word-highlight offsets cannot reveal new-preset words early; negative offsets delay them. Silence from narration activity or any gap between measured words suppresses text and backing.

Picture edits, speed changes and regeneration retain narration-clock caption times. Word timing belongs to narration, not source-video time. Editing source picture does not retime the narration.

The renderer measures the selected loaded font, balances at most two lines, fits long text, and clamps text/backing to a 9:16 safe region. Layout is normalized to 360×640 and scaled for 720×1280 and 1080×1920. A bounded 256-entry layout/color cache is invalidated when fonts finish loading. Core preset fonts require no network; failed optional fonts fall back locally. Saved custom font files must be reimported.

Safe margins reserve the top/bottom and edges, but cannot identify a face, important object, or every platform's overlay UI. Set caption X/Y manually while reviewing footage. Extremely long unbroken words or annotations fit by shrinking and may become too small to read; shorten or manually divide the text and provide matching timings. Unicode uses available OS glyph fallbacks; identical glyph appearance across operating systems is not guaranteed.

## Preview/export and resource limits

Caption state, frame effects and compositing are shared by preview and export. Glitches and shake depend on timeline time, never random draws. Synthesized noise uses a fixed seed. New-mode transitions on protected shots use the same seeking path for preview and export; preview can drop frames while keeping the narration clock.

H.264 and AAC WebCodecs support is checked at the selected resolution. Export is 30 fps; use 360×640 if hardware cannot encode larger output. There is no server encoder fallback. Browser seeking cannot guarantee exact variable-frame-rate sample identity, rotation metadata or HDR color. Portrait, landscape and odd dimensions use the existing 9:16 crop or fit modes; inspect browser-decoded orientation before export. Re-encode unsupported media to ordinary H.264/AAC MP4.

Limits remain 100 clips, 512 MB per video, 1 GB compressed media, 100 MB narration, five-minute narration/preview/export and 15-minute/1,200-frame analysis sampling. The mixer reuses decoded buffers across alternating shots with a 256 MB decoded-source budget; reverse audio has a 128 MB copy budget. Forward shots use offsets into shared buffers. Oversized mixes fail clearly; shorten source files or reduce clips. Direct file export streams encoded video, but decoded media and the offline audio mix still consume memory.

Cancellation releases application listeners, workers, buffers, encoders and temporary file streams. Browser decode and OfflineAudioContext rendering have no immediate abort API: cancellation is checked after those browser operations finish, and their result is discarded. Worker analysis can terminate immediately. The synchronous statistics fallback on browsers without Worker cannot be interrupted mid-call; use a Worker-capable browser for larger analysis.

No preset detects wins, crying, flashbangs, signing, speakers, or the strongest reaction. Strong opening action within 0.5 seconds, reaction ordering, short pauses, freeze frames and meme inserts require explicit edits using existing footage. Apply intentionally cannot perform those operations while also preserving source timing and timeline structure.

## Serialization and extension

Project schema version stays 1. An additive `presetState.version: 1` stores `manual`, `baseline` and `owned` dictionaries. `captionPreset` and `settings.cs` identify the active style; the existing settings field remains authoritative. Missing fields receive safe selected-preset defaults. Unknown styles fall back to Reference Story with a load warning while retaining saved custom settings. Legacy projects without ownership data conservatively treat their saved controls as manual. Numeric legacy word-start arrays migrate to explicit intervals using the next start or cue end; malformed timing is rejected rather than guessed.

To add another preset later:

1. Create a module using `definePreset`: unique ID, label, description, guidance, button metadata, grouping, defaults, accent rules, motion rules and serialization metadata. Export its own apply function delegating to the controller.
2. Add its definition to `PRESETS` in `presetRegistry.js`. Validation rejects missing configuration and duplicate IDs. The UI, selection, renderer, effects and save/load discover the new entry without changes to `main.js`.
3. Add behavior tests and browser fixtures. Keep timeline editing separate from presentation application.

## Verification scope

Unit coverage includes migration and unknown IDs, manual ownership and switching, strict timing and silence, Unicode/overflow/backing, accents, protected shots, deterministic preview/export state, bounded caches, 1,000 shots across 80 assets, 5,000-cue lookup, 1,500 caption layouts, alternating audio sources, and cancellation/resource cleanup. These component tests do not establish an unlimited-project or low-memory-device guarantee.

Chrome browser tests exercise both entry points, all three buttons/options, actual preview and MP4 export, persistence/relinking, layout at 360 and 1080 widths, frame determinism and Reference Story. Cross-browser, real-speech accuracy, face avoidance, long real-media stress and every exported pixel still require editorial/device review.

