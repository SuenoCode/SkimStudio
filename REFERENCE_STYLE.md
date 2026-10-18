# Reference edit style

Reference: [YouTube Short supplied by the user](https://www.youtube.com/shorts/LCvKfVcvi7o).

The reference was inspected in playback and at several positions across its approximately 18-second duration. YouTube's optional CC overlay was switched off to distinguish it from captions embedded in the video.

## Observed visual language

- Heavy uppercase sans-serif captions, centered horizontally around the middle of the image rather than on the bottom subtitle line.
- Short, balanced phrase blocks, often with a white setup line and a bright emphasis line. Lime green, magenta, and red serve as editorial accents. Color is not simply a cumulative karaoke highlight.
- Small dark shadows and edges keep text legible over moving footage. The caption does not require a large rectangular background.
- Quick caption entrances, short fades, close subject framing and restrained camera/reframing changes support a continuous emotional story.
- Occasional red arrows/circles direct attention to a subject. These are intentional annotations; automatic object recognition cannot safely determine their target.
- The latter part of the clip leaves room for the source action and reactions without filling every frame with narration captions. Music is present, but its recording is not included in this application.

## Implemented in SkimStudio

**Reference Story** is the new default caption look. Existing saved projects keep their saved style; **Apply reference look** switches an existing edit. Other caption styles remain selectable.

- Montserrat Black 900 is bundled locally. Export and full preview wait for the reference font to load. A system fallback remains available for unsupported characters.
- Reference captions use a dedicated renderer called by the same `caps` entry point for preview and export, at any supported resolution.
- Groups contain up to eight words by default, with a configurable 4/6/8/10-word display size. Natural sentence/script phrases replace the older default three/four-word splitting in this style. Long text is fitted to safe horizontal bounds.
- Two lines are balanced by measured text width. Explicit emphasis text can favor the corresponding second line. On single-line captions, the final word is accented by default.
- Phrase lines start when their first word starts. Word-by-word mode hides each future word until its timestamp. Caption groups disappear after their final spoken interval. Manual and imported timing remain authoritative.
- The default entrance is 80 ms, with a small eased rise/scale and a brief exit fade. It is deterministic and does not depend on playback frame rate.
- Accent choices are editable globally and per caption. Automatic color uses transparent wording rules: pain/injury/loss terms suggest red, opposition/turning-point wording suggests magenta, and other phrases use lime. These are design suggestions, not semantic footage analysis.
- Reference framing adds a bounded 4.5% eased push-in across eligible wide/drift shots. Locked or manually framed shots do not receive this adjustment. Source intervals and playback speed do not change when applying the look.
- New reference plans use restrained wide framing and normal hard-cut defaults. Applying the preset restyles eligible unlocked framing/transitions, keeps locks/manual framing, and suppresses unrelated decorative overlays. It does not automatically rebuild the timeline.
- Manual ring callouts are red in this style. Manual focus coordinates work even without browser face detection. A pre-existing undefined-radius error in labeled callouts was repaired.
- The reference video's watermarks, platform controls, music recording and subject-specific choreography are not embedded or copied.

An example rendered with the actual caption engine is included as `release/reference-style-preview.png` in the workspace and `reference-style-preview.png` in the downloadable ZIP.

## Validation

Six additional unit tests cover phrase balancing, editable colors, grouping, bounded motion, word reveal, and caption end gating. A third browser integration scenario checks preset timing preservation, locked framing protection, emphasis save/load, local font loading with Google Fonts blocked, manual labeled callouts, and rendering at 360×640 and 1080×1920.

The existing MP4 export test also runs with Reference Story as the default style. Exact semantic cut selection and speech-ground-truth accuracy still need user review; copying typography cannot establish those capabilities.
# Additional reusable presets

Kinetic Sports Upset, Streamer Flashbang Meme and Dialogue Meme Caption are separate additions described in [PRESET_STYLES.md](PRESET_STYLES.md). Reference Story retains its definition, dedicated Apply control and renderer.

