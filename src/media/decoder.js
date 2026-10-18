export function waitMedia(video, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); video.removeEventListener('loadeddata', ready); video.removeEventListener('error', failed); error ? reject(error) : resolve(video.duration); };
    const ready = () => { if (video.readyState >= 2 && Number.isFinite(video.duration) && video.duration > 0 && video.videoWidth > 0) finish(); };
    const failed = () => finish(new Error('The browser could not decode this video. Try an H.264 MP4.'));
    const timer = setTimeout(() => finish(new Error('Video decoding timed out.')), timeout);
    video.addEventListener('loadeddata', ready); video.addEventListener('error', failed); ready();
  });
}
export async function seekFrame(video, requested, cancelled = () => false) {
  if (cancelled()) throw new Error('cancelled');
  if (!Number.isFinite(requested)) throw new Error('Invalid frame timestamp.');
  await waitMedia(video);
  const target = Math.max(0, Math.min(video.duration - 0.001, requested));
  if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2 && !video.seeking) return;
  await new Promise((resolve, reject) => {
    let callback, sought=false, presented=false;
    const finish = error => { clearTimeout(timer); clearInterval(poll); video.removeEventListener('seeked', ready); video.removeEventListener('error', failed); if (callback !== undefined) video.cancelVideoFrameCallback?.(callback); error ? reject(error) : resolve(); };
    const ready = () => {
      if (cancelled()) return finish(new Error('cancelled'));
      if (video.readyState < 2 || Math.abs(video.currentTime - target) > 0.05) return;
      sought=true;
      if (!video.requestVideoFrameCallback || presented) finish();
    };
    const failed = () => finish(new Error('Video decoding failed while seeking.'));
    const timer = setTimeout(() => finish(new Error(`No decoded frame arrived at ${target.toFixed(3)}s.`)), 10000);
    const poll = setInterval(() => { if (cancelled()) finish(new Error('cancelled')); }, 50);
    video.addEventListener('seeked', ready); video.addEventListener('error', failed);
    if(video.requestVideoFrameCallback) callback=video.requestVideoFrameCallback(()=>{presented=true;if(sought)finish()});
    video.currentTime = target;
  });
}
