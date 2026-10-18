# Caption delay and silence repair

## Findings from the supplied export

The output is 30.233 seconds long. Video and audio both start at timestamp zero, so a container-level stream offset does not explain the problem.

Frames show **“THEY'RE ACTUALLY” at 5.35 s** and **“BRO DIDN'T ASK FOR” at 26.20 s** during quiet narration intervals. Audio analysis detected low-level gaps at approximately 5.311–5.505 s and 25.996–26.392 s. The final half-second is also quiet.

Source review identified four causes: the renderer retained the previous caption group across internal gaps; rendering did not check narration activity; estimated timing distributed words by text weights instead of recognized speech; and the estimator extended cue endings or squeezed word intervals to reserve a display hold. Imported word times were also rejected when they fell outside already-inaccurate cue bounds.

## Implemented changes

- Every caption style now shares a narration-activity guard. Old cues cannot display text across measured narration silence. Meaningful gaps between word intervals are also blank. Activity is measured on narration alone, independently of original video audio and effects.
- Removed artificial end holds and word-time compression. Captions are not stretched to make a last word finish.
- Speech recognition is the default timing mode. Its English model runs locally in a cancellable worker after explicit download consent. Narration import does not start recognition or edit generation.
- The speech runtime is bundled and version-locked. Model words completely inside measured silence are discarded. Nearby late utterance starts are anchored to narration activity without shifting later words. This refinement does not modify imported/manual timestamps.
- Recognized/imported word times rebuild cue bounds and split at pauses. Stale cue bounds no longer clamp or reject correctly timed words.
- Script matching rejects unmatched words. **Use recognized speech** is an explicit alternative when the script and recognition differ. Recognition wording still needs review.
- Word alignment survives project save/load and regrouping. Changing narration invalidates old alignment. Speech mode prevents export with unaligned estimates; estimated/manual modes remain explicit alternatives.

## Apply to an existing project

1. Open the updated app and load the project. Relink original footage and reimport original narration if needed.
2. Leave **Caption timing → Recognize spoken words** selected.
3. Choose **Match my script**, or explicitly choose **Use recognized speech** to build caption text from the recording.
4. Click **Sync captions to speech**, approve the first-use download, and review recognition wording.
5. Preview and re-export. Captions already baked into an old MP4 are not editable project data.

Audio estimation remains approximate: it now has silence protection but cannot establish exact word positions from energy alone. Imported/manual timing remains available without downloading a model.

## Verification

- **36 Node tests** cover silence detection, stereo activity, internal gaps, stale cue repair, unchanged imported timestamps, mismatch rejection, silent-tail hallucination removal and late-onset anchoring, alongside the existing checks.
- **Four standard browser scenarios** cover the existing editor/export workflow plus voiced/silent/voiced narration and repair of delayed cue bounds from imported words.
- A separate **real-audio browser regression** used the supplied export's extracted audio. It recognized 100 words, verified no caption drawing at **5.35 s, 26.20 s and 29.95 s**, and verified caption drawing at **5.85 s and 26.75 s**. The same test was run against the production build.
- The production build contains the worker, speech runtime and WASM asset. User audio, analysis files, and downloaded model caches are excluded from the application ZIP.

These checks do not establish manually verified transcription or universal frame-accurate forced alignment. Models can mishear words. Background music mixed into a narration file can weaken silence detection; use clean narration where possible.

Implementation references: [word-timestamp pipeline API](https://huggingface.co/docs/transformers.js/api/pipelines), [Transformers.js](https://github.com/huggingface/transformers.js).
