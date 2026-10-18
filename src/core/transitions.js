// Shared transition math. Keeping this independent of the DOM makes it easy to
// validate the timing rules without booting the editor.
export function easeInOutCubic(progress) {
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function transitionSourceTime(segment, elapsed) {
  const sourceDuration = Math.max(0, (segment.e || 0) - (segment.s || 0));
  const playhead = Math.max(0, Math.min(sourceDuration / Math.max(0.25, segment.sp || 1), elapsed || 0));
  const sourceOffset = Math.min(sourceDuration, playhead * Math.max(0.25, segment.sp || 1));
  return segment.rev ? segment.e - sourceOffset : segment.s + sourceOffset;
}

export function transitionDuration(duration, shotDuration, ratio = 0.22, cap = 0.34) {
  const safeShot = Math.max(0, Number(shotDuration) || 0);
  return Number(Math.min(cap, safeShot * ratio, Math.max(0, Number(duration) || 0)).toFixed(3));
}
