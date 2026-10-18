# Preset engineering audit

Internal checklist (updated with verification before delivery):

- [ ] Replace main-renderer ID branches, overlapping defaults and incomplete preset metadata with a validated registry.
- [ ] Track preset-owned values separately from manual edits; restore baseline on leaving a preset; retain undo/redo and legacy custom settings.
- [ ] Migrate optional preset data; safely default missing/unknown IDs and controls on both HTML entry points.
- [ ] Make measured timing immutable and reject malformed/partial data atomically; suppress captions in every spoken gap.
- [ ] Add bounded, font-aware one/two-line layout caching, Unicode-safe text, safe margins and correctly sized backing.
- [ ] Share deterministic caption/effect/frame state across preview/export; protect locked/custom framing; avoid global zoom and legacy overlay leakage.
- [ ] Avoid timeline redraw/validation for caption-only changes; index cue/shot lookup and source validation.
- [ ] Bound audio decoding caches; close temporary contexts; release replaced media and preview snapshots; clean workers/seeks on cancellation.
- [ ] Add accessible, described controls, per-cue labels/emphasis, visible ownership and future-edit guidance.
- [ ] Exercise units, real Chrome preview/export, migration, switching, save/load, Reference Story and both HTML entry points.
- [ ] Document measured limits and manual fallbacks; run tests and production build.

Scope: presentation presets cannot reorder or trim shots, invent reactions, or identify semantic events. Opening/closing shot choice, pauses, freeze frames and inserts require explicit timeline edits. Browser decoding, available fonts, subject placement and device memory still impose limits; final documentation will distinguish verified behavior from these constraints.
